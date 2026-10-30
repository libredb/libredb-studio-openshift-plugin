import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/e2e/run-dev-lane.sh');
const which = (command: string) =>
  execFileSync('sh', ['-c', `command -v ${command}`])
    .toString()
    .trim();
const BASH = which('bash');
const TOKEN = 'devlane-token-4b1e9c';
const IMAGE = 'quay.io/openshift/origin-console:4.22';
const LOOPBACK = [
  'LISTEN 0 511 127.0.0.1:9001 0.0.0.0:* users:(("node",pid=11,fd=20))',
  'LISTEN 0 4096 127.0.0.1:9000 0.0.0.0:*',
].join('\n');

interface Run {
  status: number | null;
  output: string;
  oc: string[];
  docker: string[];
  playwright: string;
  playwrightEnv: Record<string, string>;
  consoleEnv: Record<string, string>;
  consoleArgs: string;
  evidence: string;
}

function readEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) {
      env[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  return env;
}

/**
 * Runs a copy of run-dev-lane.sh in a scratch tree with stub `oc`, `docker`, `yarn`, `curl`, `ss` and
 * start-console.sh, so the test sees the cluster calls, what the console and the test process get, and the evidence.
 */
function run(env: Record<string, string> = {}, omit: string[] = []): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-dev-lane-'));
  const tree = path.join(dir, 'tree');
  fs.mkdirSync(path.join(tree, 'scripts/e2e'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(tree, 'scripts/e2e/run-dev-lane.sh'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const write = (file: string, body: string) => {
    fs.writeFileSync(file, `#!${BASH}\n${body}\n`, { mode: 0o755 });
  };
  const stub = (name: string, body: string) => write(path.join(bin, name), body);
  for (const tool of ['grep', 'awk', 'cat', 'dirname', 'mktemp', 'rm', 'mkdir', 'seq', 'sleep']) {
    fs.symlinkSync(which(tool), path.join(bin, tool));
  }
  fs.symlinkSync(which('setsid'), path.join(bin, 'setsid'));
  fs.symlinkSync(which('env'), path.join(bin, 'env'));
  fs.symlinkSync(which('tail'), path.join(bin, 'tail'));
  stub(
    'oc',
    [
      `echo "$*" >> "${dir}/oc"`,
      'case "$*" in',
      '  "get namespace "*) [ -n "$OC_NAMESPACE_EXISTS" ] ;;',
      '  "get consolelink libredb-studio") [ "$OC_LINK" = present ] ;;',
      `  "create token devlane -n os-lab-devlane --duration=1h") echo ${TOKEN} ;;`,
      '  create*|delete*) ;;',
      '  *) exit 1 ;;',
      'esac',
    ].join('\n'),
  );
  stub(
    'docker',
    [
      `echo "$*" >> "${dir}/docker"`,
      `case "$1" in ps) cat "${dir}/running" 2> /dev/null || true ;; esac`,
    ].join('\n'),
  );
  stub(
    'yarn',
    [
      'case "$1" in',
      '  start) exec sleep 60 ;;',
      `  playwright) echo "$*" > "${dir}/playwright"; env > "${dir}/playwright-env"; exit "\${YARN_RC:-0}" ;;`,
      'esac',
      'exit 1',
    ].join('\n'),
  );
  stub('curl', 'exit 0');
  stub('ss', 'printf "%s\\n" "$SS_OUTPUT"');
  write(
    path.join(tree, 'start-console.sh'),
    [
      `echo "$*" > "${dir}/console-args"`,
      `env > "${dir}/console-env"`,
      `echo c0ffee > "${dir}/running"`,
      'exec sleep 60',
    ].join('\n'),
  );
  if (env.RUNNING_BEFORE !== undefined) {
    fs.writeFileSync(path.join(dir, 'running'), 'beef00\n');
  }
  const evidence = path.join(dir, 'evidence');
  const fullEnv: Record<string, string> = {
    PATH: bin,
    HOME: dir,
    CONSOLE_IMAGE: IMAGE,
    OC_LINK: 'present',
    SS_OUTPUT: LOOPBACK,
    E2E_EVIDENCE_DIR: evidence,
    BRIDGE_BASE_ADDRESS: 'https://console.from.the.caller',
    ...env,
  };
  for (const name of omit) {
    delete fullEnv[name];
  }
  const result = spawnSync(
    BASH,
    [path.join(tree, 'scripts/e2e/run-dev-lane.sh'), '--reporter=list'],
    {
      cwd: dir,
      env: fullEnv,
      encoding: 'utf-8',
      timeout: 60_000,
    },
  );
  const readOr = (file: string) =>
    fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf-8') : '';
  const outcome: Run = {
    status: result.status,
    output: result.stdout + result.stderr,
    oc: readOr('oc').split('\n').filter(Boolean),
    docker: readOr('docker').split('\n').filter(Boolean),
    playwright: readOr('playwright').trim(),
    playwrightEnv: readEnv(readOr('playwright-env')),
    consoleEnv: readEnv(readOr('console-env')),
    consoleArgs: readOr('console-args').trim(),
    evidence: readOr('evidence/dev-lane-ss.txt'),
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return outcome;
}

const SETUP = [
  'create namespace os-lab-devlane',
  'create serviceaccount devlane -n os-lab-devlane',
  'create rolebinding devlane-view -n team-a --clusterrole=view --serviceaccount=os-lab-devlane:devlane',
];
const TEARDOWN = [
  'delete rolebinding devlane-view -n team-a --ignore-not-found',
  'delete namespace os-lab-devlane --ignore-not-found --wait=true',
];

describe('scripts/e2e/run-dev-lane.sh', () => {
  it('runs the dev-lane project against the loopback console with a view-only one-hour token', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.oc).toEqual(
      expect.arrayContaining([
        ...SETUP,
        'create token devlane -n os-lab-devlane --duration=1h',
        ...TEARDOWN,
      ]),
    );
    expect(result.oc.slice(-2)).toEqual(TEARDOWN);
    expect(result.consoleEnv.BRIDGE_K8S_AUTH_BEARER_TOKEN).toBe(TOKEN);
    expect(result.consoleEnv.CONSOLE_IMAGE).toBe(IMAGE);
    expect(result.consoleEnv.BRIDGE_BASE_ADDRESS).toBeUndefined();
    expect(result.consoleArgs).toBe('');
    expect(result.playwright).toBe('playwright test --project=dev-lane --reporter=list');
    expect(result.playwrightEnv).toMatchObject({
      E2E_DEV_LANE: '1',
      E2E_DEV_LANE_LOCATOR: 'present',
      BRIDGE_BASE_ADDRESS: 'http://127.0.0.1:9000',
    });
    expect(result.playwrightEnv.BRIDGE_K8S_AUTH_BEARER_TOKEN).toBeUndefined();
    expect(result.evidence).toBe(`${LOOPBACK}\n`);
    expect(result.output + result.evidence).not.toContain(TOKEN);
  });

  it('tells the spec when the cluster holds no locator link', () => {
    expect(run({ OC_LINK: 'absent' }).playwrightEnv.E2E_DEV_LANE_LOCATOR).toBe('absent');
  });

  it.each([
    [
      'the console on every interface',
      'LISTEN 0 511 127.0.0.1:9001 0.0.0.0:*\nLISTEN 0 4096 0.0.0.0:9000 0.0.0.0:*',
    ],
    [
      'the dev server on every IPv6 interface',
      'LISTEN 0 511 [::]:9001 [::]:*\nLISTEN 0 4096 127.0.0.1:9000 0.0.0.0:*',
    ],
    [
      'a second console socket on every interface',
      `${LOOPBACK}\nLISTEN 0 4096 0.0.0.0:9000 0.0.0.0:*`,
    ],
    ['no console socket', 'LISTEN 0 511 127.0.0.1:9001 0.0.0.0:*'],
  ])('refuses to run the suite with %s, and still cleans up', (_case, sockets) => {
    const result = run({ SS_OUTPUT: sockets });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('must listen on 127.0.0.1 only');
    expect(result.playwright).toBe('');
    expect(result.oc.slice(-2)).toEqual(TEARDOWN);
  });

  it('keeps the exit code of a failed suite and cleans up', () => {
    const result = run({ YARN_RC: '5' });
    expect(result.status).toBe(5);
    expect(result.oc.slice(-2)).toEqual(TEARDOWN);
  });

  it('stops the console container on exit', () => {
    const result = run();
    expect(result.docker).toContain(`ps -q --filter ancestor=${IMAGE}`);
    expect(result.docker).toContain('stop c0ffee');
  });

  it('refuses to start while a container of the console image runs', () => {
    const result = run({ RUNNING_BEFORE: '1' });
    expect(result.status).toBe(2);
    expect(result.output).toContain('is already running');
    expect(result.oc).toEqual(['get namespace os-lab-devlane']);
    expect(result.docker.filter((line) => line.startsWith('stop'))).toEqual([]);
  });

  it('refuses a namespace that already exists and touches nothing', () => {
    const result = run({ OC_NAMESPACE_EXISTS: '1' });
    expect(result.status).toBe(2);
    expect(result.output).toContain('namespace os-lab-devlane exists');
    expect(result.oc).toEqual(['get namespace os-lab-devlane']);
  });

  it('refuses to start without CONSOLE_IMAGE', () => {
    const result = run({}, ['CONSOLE_IMAGE']);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('CONSOLE_IMAGE');
    expect(result.oc).toEqual([]);
  });
});
