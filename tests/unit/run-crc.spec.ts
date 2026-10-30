import { execFileSync, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/e2e/run-crc.sh');
const which = (command: string) =>
  execFileSync('sh', ['-c', `command -v ${command}`])
    .toString()
    .trim();
const BASH = which('bash');
const PASSWORDS = {
  dev_a_PASSWORD: 'pw-dev-a-7f3c',
  dev_b_PASSWORD: 'pw-dev-b-91ad',
  os_admin_PASSWORD: 'pw-os-admin-5e20',
};
const STUDIO_CLIENT = 'system:serviceaccount:os-lab-v1:v1os';

const token = (name: string, userName: string, clientName: string, created: string) => ({
  metadata: { name, creationTimestamp: created },
  userName,
  clientName,
});

/** The cluster's OAuth access tokens before the run, as `oc get oauthaccesstokens -o json` lists them. */
const BEFORE = [
  token('sha256~dev-a-console-old', 'dev-a', 'console', '2026-01-01T00:00:00Z'),
  token('sha256~os-admin-studio-old', 'os-admin', STUDIO_CLIENT, '2026-10-29T08:00:00Z'),
  token('sha256~kubeadmin-console-old', 'kube:admin', 'console', '2026-10-29T08:00:00Z'),
];
/**
 * The tokens after the run: the run's own, one of them stamped before the run by an API server clock behind the host's,
 * plus the run's tokens of users who are not lab users.
 */
const AFTER = [
  ...BEFORE,
  token('sha256~dev-b-studio-run', 'dev-b', STUDIO_CLIENT, '2026-10-30T12:00:05Z'),
  token('sha256~dev-a-studio-skewed', 'dev-a', STUDIO_CLIENT, '2026-10-30T11:58:00Z'),
  token('sha256~os-admin-console-run', 'os-admin', 'console', '2026-10-30T12:01:00Z'),
  token('sha256~kubeadmin-console-run', 'kube:admin', 'console', '2026-10-30T12:02:00Z'),
  token('sha256~dev-c-console-run', 'dev-c', 'console', '2026-10-30T12:03:00Z'),
];
const DELETED = [
  'sha256~dev-a-console-old',
  'sha256~dev-a-studio-skewed',
  'sha256~dev-b-studio-run',
  'sha256~os-admin-console-run',
];

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  yarn: string;
  yarnEnv: Record<string, string>;
  deleted: string[];
  authLeft: boolean;
  testProcessAlive: boolean;
}

interface Prepared {
  dir: string;
  script: string;
  env: Record<string, string>;
  collect(result: { status: number | null; stdout: string; stderr: string }): Run;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prepares a copy of run-crc.sh in a scratch tree with stub `oc` and `yarn` on a PATH that holds nothing else but the
 * tools the script needs, so the test sees what reaches the test process and which tokens are deleted.
 */
function prepare(env: Record<string, string>, omit: string[]): Prepared {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-crc-'));
  const tree = path.join(dir, 'tree');
  fs.mkdirSync(path.join(tree, 'scripts/e2e'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(tree, 'scripts/e2e/run-crc.sh'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const stub = (name: string, body: string) => {
    fs.writeFileSync(path.join(bin, name), `#!${BASH}\n${body}\n`, { mode: 0o755 });
  };
  for (const tool of [
    'jq',
    'grep',
    'xargs',
    'rm',
    'mkdir',
    'cat',
    'cp',
    'dirname',
    'env',
    'sed',
    'seq',
    'sleep',
    'setsid',
    'realpath',
  ]) {
    fs.symlinkSync(which(tool), path.join(bin, tool));
  }
  fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ items: BEFORE }));
  fs.writeFileSync(path.join(dir, 'tokens-after.json'), JSON.stringify({ items: AFTER }));
  stub(
    'oc',
    [
      'case "$*" in',
      '  "get oauthaccesstokens -o name") [ -z "$OC_LIST_FAILS" ] ;;',
      `  "get oauthaccesstokens -o json") [ -z "$OC_LIST_FAILS" ] && cat "${dir}/tokens.json" ;;`,
      '  "delete oauthaccesstoken --ignore-not-found "*)',
      '    shift 3',
      // oc names a token in its error, as it would one that vanished between the list and the delete.
      '    if [ -n "$OC_DELETE_FAILS" ]; then echo "Error from server: \\"$1\\" is forbidden" >&2; exit 1; fi',
      `    for name in "$@"; do echo "$name" >> "${dir}/deleted"; echo "deleted $name"; done ;;`,
      '  *) exit 1 ;;',
      'esac',
    ].join('\n'),
  );
  stub(
    'yarn',
    [
      `echo "$*" > "${dir}/yarn"`,
      `env > "${dir}/yarn-env"`,
      'mkdir -p integration-tests/.auth',
      'echo "{}" > integration-tests/.auth/dev-a.json',
      `cp "${dir}/tokens-after.json" "${dir}/tokens.json"`,
      'if [ -n "$YARN_LEAK" ]; then mkdir -p "$(dirname "$YARN_LEAK_FILE")"; echo "$YARN_LEAK" > "$YARN_LEAK_FILE"; fi',
      `if [ -n "$YARN_SLEEP" ]; then echo $$ > "${dir}/yarn-pid"; exec sleep 30; fi`,
      'exit "${YARN_RC:-0}"',
    ].join('\n'),
  );
  // An env file may export its variables; they must still not reach the test process under their own names.
  const usersEnv = path.join(dir, 'lab-users.env');
  fs.writeFileSync(
    usersEnv,
    Object.entries(PASSWORDS)
      .map(([name, value]) => `export ${name}='${value}'`)
      .join('\n'),
  );
  const fullEnv: Record<string, string> = {
    PATH: bin,
    HOME: dir,
    LAB_USERS_ENV: usersEnv,
    BRIDGE_BASE_ADDRESS: 'https://console.apps.example',
    STUDIO_URL: 'https://studio.apps.example',
    ...env,
  };
  for (const name of omit) {
    delete fullEnv[name];
  }
  for (const [name, value] of Object.entries(fullEnv)) {
    fullEnv[name] = value.replace('<dir>', dir).replace('<tree>', tree);
  }
  const readOr = (file: string) =>
    fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf-8') : '';
  return {
    dir,
    script: path.join(tree, 'scripts/e2e/run-crc.sh'),
    env: fullEnv,
    collect(result) {
      const yarnEnv: Record<string, string> = {};
      for (const line of readOr('yarn-env').split('\n')) {
        const at = line.indexOf('=');
        if (at > 0) {
          yarnEnv[line.slice(0, at)] = line.slice(at + 1);
        }
      }
      const pid = Number(readOr('yarn-pid').trim());
      const outcome: Run = {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        yarn: readOr('yarn').trim(),
        yarnEnv,
        deleted: readOr('deleted').split('\n').filter(Boolean),
        authLeft: fs.existsSync(path.join(tree, 'integration-tests/.auth')),
        testProcessAlive: pid > 0 && isAlive(pid),
      };
      fs.rmSync(dir, { recursive: true, force: true });
      return outcome;
    },
  };
}

function run(env: Record<string, string> = {}, omit: string[] = []): Run {
  const prepared = prepare(env, omit);
  const result = spawnSync(BASH, [prepared.script, '--project=x'], {
    cwd: prepared.dir,
    env: prepared.env,
    encoding: 'utf-8',
  });
  return prepared.collect(result);
}

/** Starts run-crc.sh with a test process that keeps running, sends the script alone a TERM, and waits for its exit. */
async function runTerminated(): Promise<Run> {
  const prepared = prepare({ YARN_SLEEP: '1' }, []);
  const child = spawn(BASH, [prepared.script, '--project=x'], {
    cwd: prepared.dir,
    env: prepared.env,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code, signal) => resolve(code ?? (signal === null ? null : -1)));
  });
  const pidFile = path.join(prepared.dir, 'yarn-pid');
  for (let i = 0; i < 100 && !fs.existsSync(pidFile); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill('SIGTERM');
  const status = await exited;
  await new Promise((resolve) => setTimeout(resolve, 200));
  return prepared.collect({ status, stdout, stderr });
}

describe('scripts/e2e/run-crc.sh', () => {
  it('hands the passwords to the test process only, under the E2E names', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.yarn).toBe('playwright test --project=x');
    expect(result.yarnEnv.E2E_PASSWORD_DEV_A).toBe(PASSWORDS.dev_a_PASSWORD);
    expect(result.yarnEnv.E2E_PASSWORD_DEV_B).toBe(PASSWORDS.dev_b_PASSWORD);
    expect(result.yarnEnv.E2E_PASSWORD_OS_ADMIN).toBe(PASSWORDS.os_admin_PASSWORD);
    expect(result.yarnEnv.BRIDGE_BASE_ADDRESS).toBe('https://console.apps.example');
    expect(result.yarnEnv.STUDIO_URL).toBe('https://studio.apps.example');
    for (const name of Object.keys(PASSWORDS)) {
      expect(result.yarnEnv[name]).toBeUndefined();
    }
    for (const value of Object.values(PASSWORDS)) {
      expect(result.stdout + result.stderr).not.toContain(value);
    }
  });

  it("deletes the users' console tokens and, by name, their tokens of the run, and prints only the count", () => {
    const result = run();
    expect(result.deleted.sort()).toEqual(DELETED);
    expect(result.stdout).toContain('deleted 4 OAuth access tokens of dev-a, dev-b and os-admin');
    expect(result.stdout + result.stderr).not.toContain('sha256~');
    expect(result.authLeft).toBe(false);
  });

  it('cleans up after a failed run and keeps its exit code', () => {
    const result = run({ YARN_RC: '7' });
    expect(result.status).toBe(7);
    expect(result.deleted.sort()).toEqual(DELETED);
    expect(result.authLeft).toBe(false);
  });

  it.each(['LAB_USERS_ENV', 'BRIDGE_BASE_ADDRESS', 'STUDIO_URL'])(
    'refuses to start without %s',
    (variable) => {
      const result = run({}, [variable]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(variable);
      expect(result.yarn).toBe('');
    },
  );

  it('refuses to start when the oc context cannot list OAuth access tokens', () => {
    const result = run({ OC_LIST_FAILS: '1' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('cannot list OAuth access tokens');
    expect(result.yarn).toBe('');
  });

  it('fails loudly when the tokens cannot be deleted, and never prints a token name', () => {
    const result = run({ OC_DELETE_FAILS: '1' });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('FAILED to delete the OAuth access tokens');
    expect(result.stderr).toContain('Error from server: "<token>" is forbidden');
    expect(result.stdout + result.stderr).not.toContain('sha256~');
    expect(result.authLeft).toBe(false);
  });

  it.each([
    ['the evidence folder', 'sha256~AbCdEf0123456789', '<dir>/evidence/run-log.txt'],
    [
      'the results folder',
      'Authorization: Bearer eyJhbGciOiJSUzI1NiJ9',
      '<tree>/integration-tests/results/html/index.html',
    ],
  ])(
    'fails naming the file, never the value, when a token value reached %s',
    (_case, leak, file) => {
      const result = run({
        E2E_EVIDENCE_DIR: '<dir>/evidence',
        YARN_LEAK: leak,
        YARN_LEAK_FILE: file,
      });
      expect(result.status).toBe(4);
      expect(result.stderr).toContain('FAILED: a token value is in');
      expect(result.stderr).toContain(path.basename(file));
      expect(result.stdout + result.stderr).not.toContain(leak);
      expect(result.deleted.sort()).toEqual(DELETED);
    },
  );

  it('passes a clean evidence folder', () => {
    const result = run({
      E2E_EVIDENCE_DIR: '<dir>/evidence',
      YARN_LEAK: 'run-crc.sh deleted sha256~<token> and nothing else',
      YARN_LEAK_FILE: '<dir>/evidence/run-log.txt',
    });
    expect(result.status).toBe(0);
  });

  it.each([
    ['a relative path', 'evidence'],
    ['a path inside the checkout', '<tree>/evidence'],
  ])('refuses E2E_EVIDENCE_DIR as %s before anything signs in', (_case, value) => {
    const result = run({ E2E_EVIDENCE_DIR: value });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      'E2E_EVIDENCE_DIR must be an absolute path outside the checkout',
    );
    expect(result.yarn).toBe('');
    expect(result.deleted).toEqual([]);
  });

  it('stops the test process group first when it is terminated, then deletes the tokens', async () => {
    const result = await runTerminated();
    expect(result.status).toBe(143);
    expect(result.testProcessAlive).toBe(false);
    expect(result.deleted.sort()).toEqual(DELETED);
    expect(result.authLeft).toBe(false);
  });
});
