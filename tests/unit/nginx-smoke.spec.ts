import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/nginx-smoke.sh');
const BASH = execFileSync('sh', ['-c', 'command -v bash']).toString().trim();

/**
 * A fake nginx behind stub `docker` and `curl` commands: curl records every request it is asked to send, and
 * `docker logs` prints an access log built from those requests the way the mode says the server logs them, plus the
 * error line nginx writes for a request whose body is over its limit. Each `docker run` starts another container,
 * published on its own port, and records its arguments.
 */
const DOCKER_STUB = `
state="$SMOKE_STATE"
case "$1" in
  image) echo "\${STUB_USER-1001}" ;;
  run)
    shift
    count=$(( $(cat "$state/runs" 2> /dev/null || echo 0) + 1 ))
    echo "$count" > "$state/runs"
    printf '%s\\n' "$@" -- >> "$state/run-args"
    echo "stub-container-$count" ;;
  port) echo "127.0.0.1:4012\${2#stub-container-}" ;;
  rm) shift; [ "$1" = -f ] && shift; echo "$*" >> "$state/removed" ;;
  logs)
    [ "$STUB_MODE" = silent ] && exit 0
    touch "$state/requests"
    while IFS=$'\\t' read -r method url headers; do
      target="/\${url#https://localhost:*/}"
      if [ "$method" = POST ]; then
        [ "$STUB_MODE" = error-silent ] && continue
        line="request: \\"POST $target HTTP/1.1\\", host: \\"localhost:40123\\""
        [ "$STUB_MODE" = leak-error-header ] && line="$line $headers"
        echo "2026/10/30 09:00:00 [error] 22#22: *9 client intended to send too large body: 2097152 bytes, client: 172.17.0.1, server: , $line" >&2
        continue
      fi
      case "$STUB_MODE" in
        leak-query) line="\\"GET $target\\"" ;;
        leak-header) line="\\"GET \${target%%\\?*}\\" $headers" ;;
        *) line="\\"GET \${target%%\\?*}\\"" ;;
      esac
      echo "172.17.0.1 [30/Oct/2026:09:00:00 +0000] $line 200 100"
    done < "$state/requests"
    [ "$STUB_MODE" = emerg ] && echo '2026/10/30 09:00:00 [emerg] 1#1: bind() failed' >&2
    exit 0 ;;
  *) echo "unexpected docker $*" >&2; exit 64 ;;
esac
`;

const CURL_STUB = `
out=/dev/null; format=""; url=""; headers=""; method=GET
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -w) format="$2"; shift ;;
    -H) headers="$headers $2"; shift ;;
    -u) headers="$headers basic:$2"; shift ;;
    --data-binary) method=POST; shift ;;
    --cacert|--resolve|--max-time|--retry) shift ;;
    https://*) url="$1" ;;
  esac
  shift
done
printf '%s\\t%s\\t%s\\n' "$method" "$url" "$headers" >> "$SMOKE_STATE/requests"
path="\${url%%\\?*}"
port="\${url#https://localhost:}"; port="\${port%%/*}"
if [ "$STUB_MODE" = uid-denied ] && [ "$port" = 40122 ]; then
  echo 'forbidden' > "$out"; [ -n "$format" ] && printf '403 text/html'; exit 0
fi
case "$path" in
  */plugin-manifest.json)
    if [ "$method" = POST ]; then
      echo 'too large' > "$out"; [ -n "$format" ] && printf '413 text/html'; exit 0
    fi
    echo '{"loadScripts":["plugin-entry.0123abcd.min.js"]}' > "$out"
    type=application/json
    [ "$STUB_MODE" = content-type ] && type=text/plain ;;
  */plugin-entry.0123abcd.min.js) echo 'entry' > "$out"; type=application/javascript ;;
  *) echo 'not found' > "$out"; [ -n "$format" ] && printf '404 text/html'; exit 0 ;;
esac
[ -n "$format" ] && printf '200 %s' "$type"
exit 0
`;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  /** The arguments of each docker run, in order. */
  runs: string[][];
  /** The containers docker rm removed. */
  removed: string[];
}

function smoke(mode: string, extraEnv: Record<string, string> = {}): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nginx-smoke-'));
  const bin = path.join(dir, 'bin');
  const state = path.join(dir, 'state');
  fs.mkdirSync(bin);
  fs.mkdirSync(state);
  const stub = (name: string, body: string) =>
    fs.writeFileSync(path.join(bin, name), `#!${BASH}\n${body}\n`, { mode: 0o755 });
  stub('docker', DOCKER_STUB);
  stub('curl', CURL_STUB);
  stub('sleep', 'exit 0');
  const result = spawnSync(BASH, [SCRIPT, 'localhost/osplugin:test'], {
    encoding: 'utf-8',
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      TMPDIR: os.tmpdir(),
      SMOKE_STATE: state,
      STUB_MODE: mode,
      ...extraEnv,
    },
  });
  const read = (file: string) =>
    fs.existsSync(path.join(state, file)) ? fs.readFileSync(path.join(state, file), 'utf-8') : '';
  const run = {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    runs: read('run-args')
      .split('--\n')
      .filter(Boolean)
      .map((args) => args.split('\n').filter(Boolean)),
    removed: read('removed').split(/\s+/).filter(Boolean).sort(),
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return run;
}

describe('scripts/nginx-smoke.sh', () => {
  it('passes against a server that logs only the method and the path', () => {
    const run = smoke('clean');
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    for (const check of [
      'PASS image user 1001',
      'PASS manifest 200 application/json',
      'PASS entry plugin-entry.0123abcd.min.js 200 application/javascript',
      'PASS TLS 1.3',
      'PASS requests logged',
      'PASS no token in the log',
      'PASS no emerg or alert in the log',
      'PASS error log: a rejected request is logged without its Authorization header or cookie',
      'PASS arbitrary uid 1000690000:0: manifest 200 application/json',
      'PASS arbitrary uid 1000690000:0: entry plugin-entry.0123abcd.min.js 200 application/javascript',
    ]) {
      expect(run.stdout).toContain(check);
    }
  });

  it('runs the image read-only with /tmp writable, IPv6 on and the certificate mounted', () => {
    const run = smoke('clean');
    expect(run.runs).toHaveLength(2);
    for (const runArgs of run.runs) {
      const args = runArgs.join(' ');
      expect(args).toContain('--read-only');
      expect(args).toContain('--tmpfs /tmp');
      expect(args).toContain('--sysctl net.ipv6.conf.all.disable_ipv6=0');
      expect(args).toMatch(/-v \S+:\/var\/cert:ro/);
      expect(args).toContain('-p 127.0.0.1::9443');
      expect(runArgs[runArgs.length - 1]).toBe('localhost/osplugin:test');
    }
    expect(run.removed).toEqual(['stub-container-1', 'stub-container-2']);
  });

  // OpenShift's restricted-v2 runs the image as an arbitrary uid in group 0, never as its own user 1001.
  it('runs the image a second time as an arbitrary uid in group 0', () => {
    const run = smoke('clean');
    expect(run.runs[0]).not.toContain('--user');
    expect(run.runs[1].join(' ')).toContain('--user 1000690000:0');
  });

  it.each([
    ['the query string reaches the log', 'leak-query', 'token in the log'],
    ['a request header reaches the log', 'leak-header', 'token in the log'],
    ['no request reaches the log', 'silent', 'requests logged'],
    ['the log holds an emerg line', 'emerg', 'emerg or alert'],
    ['the manifest has another content type', 'content-type', 'manifest'],
    ['the error log names a header of a rejected request', 'leak-error-header', 'error log'],
    ['the error log does not record the rejected request', 'error-silent', 'error log'],
    ['an arbitrary uid cannot serve the plugin', 'uid-denied', 'arbitrary uid'],
  ])('fails when %s', (_label, mode, check) => {
    const run = smoke(mode);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(`FAIL ${check}`);
    expect(run.removed).toHaveLength(run.runs.length);
    expect(run.removed.length).toBeGreaterThan(0);
  });

  it('fails when the image does not run as user 1001', () => {
    const run = smoke('clean', { STUB_USER: 'root' });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('FAIL image user');
  });

  it('removes its temporary directory on exit', () => {
    const before = fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('nginx-smoke.'));
    smoke('leak-query');
    const after = fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('nginx-smoke.'));
    expect(after).toEqual(before);
  });
});
