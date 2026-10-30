import { execFileSync, spawnSync } from 'child_process';
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
const RUN_START = '2026-10-30T12:00:00Z';
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

/** The cluster's OAuth access tokens as `oc get oauthaccesstokens -o json` lists them. */
const TOKENS = {
  items: [
    token('sha256~dev-a-console-old', 'dev-a', 'console', '2026-01-01T00:00:00Z'),
    token('sha256~dev-b-studio-run', 'dev-b', STUDIO_CLIENT, '2026-10-30T12:00:05Z'),
    token('sha256~os-admin-console-run', 'os-admin', 'console', '2026-10-30T12:01:00Z'),
    token('sha256~os-admin-studio-old', 'os-admin', STUDIO_CLIENT, '2026-10-29T08:00:00Z'),
    token('sha256~kubeadmin-console-run', 'kube:admin', 'console', '2026-10-30T12:02:00Z'),
    token('sha256~dev-c-console-run', 'dev-c', 'console', '2026-10-30T12:03:00Z'),
  ],
};
const DELETED = [
  'sha256~dev-a-console-old',
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
}

/**
 * Runs a copy of run-crc.sh in a scratch tree with stub `oc`, `yarn` and `date` on a PATH that holds nothing else but
 * the tools the script needs, so the test sees what reaches the test process and which tokens are deleted.
 */
function run(env: Record<string, string> = {}, omit: string[] = []): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-crc-'));
  const tree = path.join(dir, 'tree');
  fs.mkdirSync(path.join(tree, 'scripts/e2e'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(tree, 'scripts/e2e/run-crc.sh'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const stub = (name: string, body: string) => {
    fs.writeFileSync(path.join(bin, name), `#!${BASH}\n${body}\n`, { mode: 0o755 });
  };
  for (const tool of ['jq', 'grep', 'xargs', 'rm', 'mkdir', 'cat', 'dirname', 'env']) {
    fs.symlinkSync(which(tool), path.join(bin, tool));
  }
  fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify(TOKENS));
  stub('date', `echo ${RUN_START}`);
  stub(
    'oc',
    [
      'case "$*" in',
      '  "get oauthaccesstokens -o name") [ -z "$OC_LIST_FAILS" ] ;;',
      `  "get oauthaccesstokens -o json") [ -z "$OC_LIST_FAILS" ] && cat "${dir}/tokens.json" ;;`,
      '  "delete oauthaccesstoken "*)',
      '    [ -z "$OC_DELETE_FAILS" ] || exit 1',
      '    shift 2',
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
  const result = spawnSync(BASH, [path.join(tree, 'scripts/e2e/run-crc.sh'), '--project=x'], {
    cwd: dir,
    env: fullEnv,
    encoding: 'utf-8',
  });
  const readOr = (file: string) =>
    fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf-8') : '';
  const yarnEnv: Record<string, string> = {};
  for (const line of readOr('yarn-env').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) {
      yarnEnv[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  const outcome: Run = {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    yarn: readOr('yarn').trim(),
    yarnEnv,
    deleted: readOr('deleted').split('\n').filter(Boolean),
    authLeft: fs.existsSync(path.join(tree, 'integration-tests/.auth')),
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return outcome;
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

  it("deletes the users' console tokens and their tokens of the run, and prints only the count", () => {
    const result = run();
    expect(result.deleted.sort()).toEqual(DELETED);
    expect(result.stdout).toContain('deleted 3 OAuth access tokens of dev-a, dev-b and os-admin');
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

  it('fails loudly when the tokens cannot be deleted', () => {
    const result = run({ OC_DELETE_FAILS: '1' });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('FAILED to delete the OAuth access tokens');
    expect(result.authLeft).toBe(false);
  });
});
