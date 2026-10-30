import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'yaml';

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  needs?: string | string[];
  permissions?: unknown;
  outputs?: Record<string, string>;
  steps?: Step[];
}
interface Workflow {
  on: Record<string, { branches?: string[]; types?: string[] } | null>;
  permissions?: unknown;
  jobs: Record<string, Job>;
}

const files = fs.readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));
/** The release workflow publishes, so it alone runs on a release and widens a permission in a job. */
const RELEASE = 'release.yml';
const checkFiles = files.filter((file) => file !== RELEASE);
const source = (file: string) => fs.readFileSync(path.join(WORKFLOWS, file), 'utf-8');
const workflow = (file: string) => parse(source(file)) as Workflow;
const jobNames = (file: string) => Object.values(workflow(file).jobs).map((job) => job.name);
const steps = (file: string) =>
  Object.values(workflow(file).jobs).flatMap((job) => job.steps ?? []);
const allSteps = files.flatMap(steps);

/**
 * The line that pins `action` to a commit with its version in a comment. The commit itself is not asserted: Dependabot
 * moves it, and a spec that names it would fail every such pull request.
 */
const pinLine = (action: string) =>
  new RegExp(
    `^\\s*(-\\s+)?uses: ${action.replace(/[/.-]/g, '\\$&')}@[0-9a-f]{40} # v\\d+\\.\\d+\\.\\d+$`,
    'm',
  );
/** The action a step uses, without its commit, once that commit has the shape of a full SHA. */
const actionOf = (uses: string | undefined) => {
  const [action, ref] = (uses ?? '').split('@');
  return /^[0-9a-f]{40}$/.test(ref ?? '') ? action : uses;
};

describe('GitHub workflows', () => {
  it('names the jobs the branch protection requires', () => {
    expect(jobNames('ci.yml')).toEqual([
      'Lint, Typecheck and Unit Tests',
      'Golden Fixture Matches Studio',
      'Build and Plugin Manifest',
      'Image and nginx Smoke',
    ]);
    expect(jobNames('secret-scan.yml')).toEqual(['Secret Scan']);
  });

  it.each(files)('%s grants read-only contents at the top level', (file) => {
    expect(workflow(file).permissions).toEqual({ contents: 'read' });
  });

  it.each(checkFiles)('%s widens no permission in a job', (file) => {
    for (const job of Object.values(workflow(file).jobs)) {
      expect(job).not.toHaveProperty('permissions');
    }
  });

  // pull_request_target and workflow_run run with a write token and secrets on code a fork controls.
  it.each(checkFiles)(
    '%s runs only on a pull request, a push to main or a manual dispatch',
    (file) => {
      const triggers = workflow(file).on;
      for (const event of Object.keys(triggers)) {
        expect(['pull_request', 'push', 'workflow_dispatch']).toContain(event);
      }
      expect(triggers.push?.branches).toEqual(['main']);
    },
  );

  it.each(files)('%s pins every action to a commit with its version in a comment', (file) => {
    const uses = source(file)
      .split('\n')
      .filter((line) => /^\s*(-\s+)?uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(/uses:\s+[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s+v\d\S*\s*$/);
    }
  });

  it('checks out without persisting credentials', () => {
    const checkouts = allSteps.filter((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) {
      expect(step.with?.['persist-credentials']).toBe(false);
    }
  });

  it('never rewrites files in a check', () => {
    for (const step of allSteps) {
      expect(step.run ?? '').not.toContain('--fix');
      expect(step.run ?? '').not.toMatch(/\byarn lint:fix\b/);
    }
  });

  it('fails the i18n check on a changed or untracked locale file', () => {
    const i18n = steps('ci.yml').filter((step) => step.run?.includes('yarn i18n'));
    expect(i18n).toHaveLength(1);
    expect(i18n[0].run).toContain('git status --porcelain --untracked-files=all -- locales');
    expect(i18n[0].run).not.toContain('git diff');
  });

  it('runs the gates the README names', () => {
    const runs = steps('ci.yml').map((step) => step.run ?? '');
    for (const command of [
      'yarn install --immutable',
      'yarn lint',
      'yarn typecheck',
      'yarn test:coverage',
      'yarn build',
      'yarn test:manifest',
    ]) {
      expect(runs.some((run) => run.split('\n').some((line) => line.trim() === command))).toBe(
        true,
      );
    }
  });

  it('compares the golden fixture with the file at the Studio tag', () => {
    const run = steps('ci.yml')
      .map((step) => step.run ?? '')
      .find((text) => text.includes('kubernetes-discovery-golden.source.json'));
    expect(run).toContain('curl -fsSL --retry 3');
    expect(run).toContain('cmp ');
  });

  describe('the check job', () => {
    const checkSteps = workflow('ci.yml').jobs.check?.steps ?? [];
    const index = (predicate: (candidate: Step) => boolean) => checkSteps.findIndex(predicate);

    // dev-chart.spec.ts renders the development chart with helm and fails under CI when helm is missing.
    it('sets up helm 4.1.3 before the unit tests', () => {
      const helm = index((candidate) => actionOf(candidate.uses) === 'azure/setup-helm');
      expect(helm).toBeGreaterThan(-1);
      expect(checkSteps[helm].with).toEqual({ version: 'v4.1.3' });
      expect(source('ci.yml')).toMatch(pinLine('azure/setup-helm'));
      expect(helm).toBeLessThan(index((candidate) => candidate.run === 'yarn test:coverage'));
    });

    it('lints the development chart strictly', () => {
      expect(
        checkSteps.some(
          (candidate) => candidate.run === 'helm lint charts/openshift-console-plugin --strict',
        ),
      ).toBe(true);
    });
  });

  describe('the image job', () => {
    const job = workflow('ci.yml').jobs.image;
    const runs = (job?.steps ?? []).map((step) => step.run ?? '');
    const builds = runs.filter((run) => run.includes('docker buildx build'));

    it('sets up buildx with the pinned action', () => {
      expect((job?.steps ?? []).map((step) => actionOf(step.uses))).toContain(
        'docker/setup-buildx-action',
      );
      expect(source('ci.yml')).toMatch(pinLine('docker/setup-buildx-action'));
    });

    it('builds both platforms without pushing, then loads the amd64 image', () => {
      expect(builds).toHaveLength(2);
      expect(builds[0]).toContain('--platform linux/amd64,linux/arm64');
      expect(builds[1]).toContain('--platform linux/amd64');
      expect(builds[1]).toContain('--load');
      for (const build of builds) {
        expect(build).not.toMatch(/--push|type=registry|push=true/);
        expect(build).toContain('--build-arg VERSION=');
      }
    });

    it('runs the smoke test on the loaded image', () => {
      const tag = /--tag (\S+)/.exec(builds[1] ?? '')?.[1];
      expect(tag).toBeDefined();
      expect(runs.some((run) => run.includes(`scripts/nginx-smoke.sh ${tag}`))).toBe(true);
    });
  });

  describe('scripts/nginx-smoke.sh', () => {
    const script = fs.readFileSync(path.join(ROOT, 'scripts/nginx-smoke.sh'), 'utf-8');

    it('stops on the first error', () => {
      expect(script).toMatch(/^set -euo pipefail$/m);
    });

    it('draws its random values with openssl', () => {
      expect(script).toContain('openssl rand -hex 16');
    });

    // OpenSSL 3 writes the key 0600 for the invoking user, while the image runs as 1001.
    it('makes the throwaway key readable before it mounts it', () => {
      const chmod = script.search(/chmod 0644 \S*tls\.key/);
      expect(chmod).toBeGreaterThan(-1);
      expect(chmod).toBeLessThan(script.indexOf('docker run'));
    });

    // A count of zero token matches proves nothing unless requests were logged.
    it('requires a logged manifest request before it counts token matches', () => {
      const logged = script.indexOf('"GET /plugin-manifest\\.json[?" ]');
      expect(logged).toBeGreaterThan(-1);
      expect(logged).toBeLessThan(script.indexOf('no token in the log'));
    });

    it('removes its container and certificate on exit', () => {
      expect(script).toMatch(/^trap cleanup EXIT$/m);
    });
  });

  // setup-buildx starts a privileged BuildKit container that builds and, in the release, pushes with the package
  // credential; its default image is the moving tag buildx-stable-1. Dependabot does not track it: bump it by hand.
  it('runs every buildx builder on one BuildKit image pinned by digest', () => {
    const buildx = allSteps.filter(
      (candidate) => actionOf(candidate.uses) === 'docker/setup-buildx-action',
    );
    expect(buildx.length).toBeGreaterThanOrEqual(2);
    const images = new Set(buildx.map((candidate) => candidate.with?.['driver-opts']));
    expect(images.size).toBe(1);
    expect([...images][0]).toMatch(/^image=moby\/buildkit:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
    for (const candidate of buildx) {
      expect(Object.keys(candidate.with ?? {})).toEqual(['driver-opts']);
    }
  });

  it('sets up no emulator', () => {
    for (const step of allSteps) {
      expect(step.uses ?? '').not.toMatch(/^docker\/setup-qemu-action@/);
    }
  });

  it('has no CodeQL workflow: the organisation runs code scanning default setup', () => {
    for (const file of files) {
      expect(file.toLowerCase()).not.toContain('codeql');
      expect(source(file)).not.toContain('github/codeql-action');
    }
  });
});

describe('the release workflow', () => {
  const release = workflow(RELEASE);
  const releaseSource = source(RELEASE);
  const jobs = release.jobs;
  const IMAGE = 'ghcr.io/libredb/libredb-studio-openshift-plugin';
  const BASH = execFileSync('sh', ['-c', 'command -v bash']).toString().trim();
  const step = (job: string, name: string): Step => {
    const found = (jobs[job]?.steps ?? []).find((candidate) => candidate.name === name);
    if (!found) {
      throw new Error(`no step "${name}" in job ${job}`);
    }
    return found;
  };

  /** Runs a step's shell with bash in `cwd`, the given environment and stub commands first on PATH. */
  function runStep(
    script: string,
    env: Record<string, string>,
    stubs: Record<string, string> = {},
    cwd = ROOT,
  ) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-step-'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    for (const [name, body] of Object.entries(stubs)) {
      fs.writeFileSync(path.join(bin, name), `#!${BASH}\n${body}\n`, { mode: 0o755 });
    }
    const output = path.join(dir, 'github-output');
    fs.writeFileSync(output, '');
    const result = spawnSync(BASH, ['-e', '-c', script], {
      cwd,
      encoding: 'utf-8',
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        GITHUB_OUTPUT: output,
        RUNNER_TEMP: dir,
        STATE: dir,
        ...env,
      },
    });
    const read = (file: string) =>
      fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf-8') : '';
    const run = {
      status: result.status,
      stderr: result.stderr,
      output: read('github-output'),
      read,
    };
    return { ...run, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  it('runs on a published release only', () => {
    expect(release.on).toEqual({ release: { types: ['published'] } });
  });

  it('never runs on pull_request_target or workflow_run in any workflow', () => {
    for (const file of files) {
      expect(Object.keys(workflow(file).on)).not.toContain('pull_request_target');
      expect(Object.keys(workflow(file).on)).not.toContain('workflow_run');
    }
  });

  it('checks the tag, publishes the image and records it in three jobs, in that order', () => {
    expect(Object.keys(jobs)).toEqual(['verify', 'publish', 'notes']);
    expect(jobs.publish.needs).toBe('verify');
    expect(jobs.notes.needs).toEqual(['verify', 'publish']);
  });

  // Only the job that pushes may write packages, and only the job that edits the notes may write contents; the
  // tag check keeps the top-level read-only token. Nothing is signed, so no job may mint an OIDC token.
  it('grants each job only the permission it needs', () => {
    expect(jobs.verify).not.toHaveProperty('permissions');
    expect(jobs.publish.permissions).toEqual({ contents: 'read', packages: 'write' });
    expect(jobs.notes.permissions).toEqual({ contents: 'write' });
    expect(releaseSource).not.toContain('id-token');
  });

  it('passes every expression to a shell through env, never inline in run', () => {
    for (const job of Object.values(jobs)) {
      for (const candidate of job.steps ?? []) {
        expect(candidate.run ?? '').not.toContain('${{');
      }
    }
  });

  describe('the tag check', () => {
    const check = step('verify', 'Check the tag against package.json');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
      version: string;
    };
    const studioTag = (
      JSON.parse(
        fs.readFileSync(
          path.join(ROOT, 'tests/unit/fixtures/kubernetes-discovery-golden.source.json'),
          'utf-8',
        ),
      ) as { tag: string }
    ).tag;

    it('takes the tag from the event through env', () => {
      expect(check.env?.TAG).toBe('${{ github.event.release.tag_name }}');
      expect(jobs.verify.outputs).toEqual({
        version: '${{ steps.tag.outputs.version }}',
        'studio-tag': '${{ steps.tag.outputs.studio-tag }}',
      });
      expect(check.id).toBe('tag');
    });

    it('accepts the package.json version and outputs it with the Studio contract tag', () => {
      const run = runStep(check.run ?? '', { TAG: pkg.version });
      expect(run.stderr).toBe('');
      expect(run.status).toBe(0);
      expect(run.output).toBe(`version=${pkg.version}\nstudio-tag=${studioTag}\n`);
      run.cleanup();
    });

    it.each([
      ['a v prefix', `v${pkg.version}`],
      ['a pre-release', `${pkg.version}-rc.1`],
      ['another version', '9.9.9'],
      ['no version', ''],
      ['a command', '0.1.0\n::set-output name=version::evil'],
    ])('refuses a tag with %s', (_label, tag) => {
      const run = runStep(check.run ?? '', { TAG: tag });
      expect(run.status).not.toBe(0);
      expect(run.output).toBe('');
      run.cleanup();
    });

    it('refuses a tag when consolePlugin.version differs from version', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-pkg-'));
      fs.mkdirSync(path.join(dir, 'tests/unit/fixtures'), { recursive: true });
      fs.copyFileSync(
        path.join(ROOT, 'tests/unit/fixtures/kubernetes-discovery-golden.source.json'),
        path.join(dir, 'tests/unit/fixtures/kubernetes-discovery-golden.source.json'),
      );
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ version: '0.2.0', consolePlugin: { version: '0.1.0' } }),
      );
      const run = runStep(check.run ?? '', { TAG: '0.2.0' }, {}, dir);
      expect(run.status).not.toBe(0);
      expect(run.output).toBe('');
      run.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('the publish job', () => {
    const publish = jobs.publish.steps ?? [];
    const uses = publish.map((candidate) => actionOf(candidate.uses)).filter(Boolean);
    const build = publish.find((candidate) =>
      candidate.uses?.startsWith('docker/build-push-action@'),
    );
    const meta = publish.find((candidate) => candidate.uses?.startsWith('docker/metadata-action@'));

    it('uses the pinned buildx, login, metadata and build actions and no emulator', () => {
      expect(uses).toEqual([
        'actions/checkout',
        'docker/setup-buildx-action',
        'docker/login-action',
        'docker/metadata-action',
        'docker/build-push-action',
      ]);
      for (const action of uses) {
        expect(releaseSource).toMatch(pinLine(action as string));
      }
    });

    it('logs in to GHCR with the job token', () => {
      const login = publish.find((candidate) => candidate.uses?.startsWith('docker/login-action@'));
      expect(login?.with).toEqual({
        registry: 'ghcr.io',
        username: '${{ github.actor }}',
        password: '${{ secrets.GITHUB_TOKEN }}',
      });
    });

    it('tags exactly the version, never latest', () => {
      expect(meta?.with?.images).toBe(IMAGE);
      expect(String(meta?.with?.tags).trim()).toBe(
        'type=raw,value=${{ needs.verify.outputs.version }}',
      );
      expect(String(meta?.with?.flavor).trim()).toBe('latest=false');
    });

    it('builds both platforms from the checkout, with VERSION, and pushes', () => {
      expect(build?.id).toBe('build');
      expect(build?.with).toMatchObject({
        context: '.',
        platforms: 'linux/amd64,linux/arm64',
        push: true,
        tags: '${{ steps.meta.outputs.tags }}',
        labels: '${{ steps.meta.outputs.labels }}',
        'build-args': 'VERSION=${{ needs.verify.outputs.version }}',
      });
      expect(jobs.publish.outputs).toEqual({ digest: '${{ steps.build.outputs.digest }}' });
    });
  });

  describe('the release notes', () => {
    const notes = step(
      'notes',
      'Append the image digest and the Studio contract to the release notes',
    );
    const DIGEST = `sha256:${'a'.repeat(64)}`;
    const env = {
      TAG: '0.1.0',
      VERSION: '0.1.0',
      DIGEST,
      STUDIO_TAG: 'libredb-studio-0.1.116',
      GH_TOKEN: 'not-a-real-token',
      GH_REPO: 'libredb/libredb-studio-openshift-plugin',
    };
    const gh = (body: string) => `
case "$1 $2" in
  "release view") echo "$*" >> "$STATE/gh-args"; printf '%s\\n' '${body}' ;;
  "release edit") echo "$*" >> "$STATE/gh-args"; shift 2; while [ $# -gt 0 ]; do [ "$1" = --notes-file ] && cp "$2" "$STATE/edited"; shift; done ;;
  *) echo "unexpected gh $*" >&2; exit 64 ;;
esac`;

    it('takes the digest, version and Studio tag from the earlier jobs through env', () => {
      expect(notes.env).toEqual({
        GH_TOKEN: '${{ github.token }}',
        GH_REPO: '${{ github.repository }}',
        TAG: '${{ github.event.release.tag_name }}',
        VERSION: '${{ needs.verify.outputs.version }}',
        DIGEST: '${{ needs.publish.outputs.digest }}',
        STUDIO_TAG: '${{ needs.verify.outputs.studio-tag }}',
      });
    });

    it('appends the image by digest and the Studio contract to the generated notes', () => {
      const run = runStep(notes.run ?? '', env, { gh: gh('## What changed') });
      expect(run.stderr).toBe('');
      expect(run.status).toBe(0);
      expect(run.read('edited')).toBe(
        [
          '## What changed',
          '',
          `Image: ${IMAGE}:0.1.0@${DIGEST}`,
          '',
          'Matches the Kubernetes discovery contract of LibreDB Studio tag libredb-studio-0.1.116, Studio releases after 1.1.0.',
          '',
        ].join('\n'),
      );
      expect(run.read('gh-args')).toMatch(
        /^release view 0\.1\.0 .*\nrelease edit 0\.1\.0 --notes-file /,
      );
      run.cleanup();
    });

    it.each([
      ['no digest', { DIGEST: '' }],
      ['a digest of another form', { DIGEST: 'sha256:abc' }],
    ])('refuses %s', (_label, override) => {
      const run = runStep(notes.run ?? '', { ...env, ...override }, { gh: gh('notes') });
      expect(run.status).not.toBe(0);
      expect(run.read('edited')).toBe('');
      run.cleanup();
    });

    it('refuses notes that already name an image', () => {
      const run = runStep(notes.run ?? '', env, {
        gh: gh(`Image: ${IMAGE}:0.1.0@sha256:${'b'.repeat(64)}`),
      });
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('already name');
      expect(run.read('edited')).toBe('');
      run.cleanup();
    });
  });
});
