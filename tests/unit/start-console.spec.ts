import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'start-console.sh');
const source = fs.readFileSync(SCRIPT, 'utf-8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
  consolePlugin: { name: string };
};
const which = (command: string) =>
  execFileSync('sh', ['-c', `command -v ${command}`])
    .toString()
    .trim();
const BASH = which('bash');

interface Run {
  status: number | null;
  args: string;
  env: Record<string, string>;
  oc: string;
}

/**
 * Runs start-console.sh with stub `uname`, `oc` and container runtimes on a PATH that holds nothing else, so the test
 * sees the exact arguments and the env file the console container would get.
 */
function run(
  system: string,
  runtimes: readonly string[],
  extraEnv: Record<string, string> = {},
): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-console-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const stub = (name: string, body: string) => {
    fs.writeFileSync(path.join(bin, name), `#!${BASH}\n${body}\n`, { mode: 0o755 });
  };
  for (const tool of ['grep', 'cat']) {
    fs.symlinkSync(which(tool), path.join(bin, tool));
  }
  stub('uname', `echo ${system}`);
  stub(
    'oc',
    [
      `echo "$*" >> "${dir}/oc"`,
      'case "$*" in',
      '  "whoami --show-server") echo https://api.crc.testing:6443 ;;',
      '  "whoami --show-token") echo sha256~not-a-real-token-from-oc ;;',
      '  *) exit 1 ;;',
      'esac',
    ].join('\n'),
  );
  for (const runtime of runtimes) {
    stub(
      runtime,
      [
        `echo "${runtime} $*" > "${dir}/args"`,
        'while [ $# -gt 0 ]; do',
        `  if [ "$1" = "--env-file" ]; then cat "$2" > "${dir}/env"; fi`,
        '  shift',
        'done',
      ].join('\n'),
    );
  }
  const result = spawnSync(BASH, [SCRIPT], {
    cwd: ROOT,
    env: { PATH: bin, HOME: dir, ...extraEnv },
    encoding: 'utf-8',
  });
  const readOr = (file: string) =>
    fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf-8') : '';
  const env: Record<string, string> = {};
  for (const line of readOr('env').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) {
      env[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  const outcome = { status: result.status, args: readOr('args').trim(), env, oc: readOr('oc') };
  fs.rmSync(dir, { recursive: true, force: true });
  return outcome;
}

describe('start-console.sh', () => {
  it('publishes the console only on the loopback interface', () => {
    const published = [...source.matchAll(/\s(?:-p|--publish)[\s=]+"?([^\s"]+)/g)].map(
      (match) => match[1],
    );
    expect(published.length).toBeGreaterThan(0);
    for (const port of published) {
      expect(port.startsWith('127.0.0.1:')).toBe(true);
    }
  });

  it('names this plugin', () => {
    expect(source).toContain(`PLUGIN_NAME="${pkg.consolePlugin.name}"`);
    expect(pkg.consolePlugin.name).toBe('libredb-studio');
  });

  it.each(['docker', 'podman'])(
    'runs %s on Linux with host networking and the console bound to 127.0.0.1',
    (runtime) => {
      const result = run('Linux', [runtime]);
      expect(result.status).toBe(0);
      expect(result.args.startsWith(`${runtime} run `)).toBe(true);
      expect(result.args).toContain('--network=host');
      expect(result.args).not.toMatch(/\s(-p|--publish)\s/);
      expect(result.env.BRIDGE_LISTEN).toBe('http://127.0.0.1:9000');
      expect(result.env.BRIDGE_PLUGINS).toBe('libredb-studio=http://localhost:9001');
      expect(result.env.BRIDGE_USER_AUTH).toBe('disabled');
    },
  );

  it.each([
    ['docker', 'host.docker.internal'],
    ['podman', 'host.containers.internal'],
  ])('runs %s elsewhere with the port published on 127.0.0.1', (runtime, host) => {
    const result = run('Darwin', [runtime]);
    expect(result.status).toBe(0);
    expect(result.args).toContain('-p 127.0.0.1:9000:9000');
    expect(result.args).not.toContain('--network=host');
    expect(result.env.BRIDGE_LISTEN).toBeUndefined();
    expect(result.env.BRIDGE_PLUGINS).toBe(`libredb-studio=http://${host}:9001`);
  });

  it('prefers podman when both runtimes are installed', () => {
    expect(run('Linux', ['podman', 'docker']).args.startsWith('podman run ')).toBe(true);
  });

  it('follows CONSOLE_PORT', () => {
    expect(run('Linux', ['docker'], { CONSOLE_PORT: '9100' }).env.BRIDGE_LISTEN).toBe(
      'http://127.0.0.1:9100',
    );
    expect(run('Darwin', ['docker'], { CONSOLE_PORT: '9100' }).args).toContain(
      '-p 127.0.0.1:9100:9000',
    );
  });

  it("takes the oc context's token when none is preset", () => {
    const result = run('Linux', ['docker']);
    expect(result.env.BRIDGE_K8S_AUTH_BEARER_TOKEN).toBe('sha256~not-a-real-token-from-oc');
    expect(result.oc).toContain('whoami --show-token');
  });

  it('keeps a preset token and never asks oc for one', () => {
    const result = run('Linux', ['docker'], {
      BRIDGE_K8S_AUTH_BEARER_TOKEN: 'sha256~not-a-real-token-preset',
    });
    expect(result.env.BRIDGE_K8S_AUTH_BEARER_TOKEN).toBe('sha256~not-a-real-token-preset');
    expect(result.oc).not.toContain('--show-token');
  });

  it('passes the token through the env file, never on the command line', () => {
    const result = run('Linux', ['docker'], {
      BRIDGE_K8S_AUTH_BEARER_TOKEN: 'sha256~not-a-real-token-preset',
    });
    expect(result.args).toContain('--env-file');
    expect(result.args).not.toContain('not-a-real-token');
  });
});

describe('webpack dev server', () => {
  it('binds 127.0.0.1', () => {
    const config = fs.readFileSync(path.join(ROOT, 'webpack.config.ts'), 'utf-8');
    const devServer = /devServer:\s*\{([\s\S]*?)\n {2}\},/.exec(config);
    expect(devServer?.[1]).toContain("host: '127.0.0.1',");
  });
});
