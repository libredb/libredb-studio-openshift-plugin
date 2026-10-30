import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Workflow {
  on: Record<string, { branches?: string[] } | null>;
  permissions?: unknown;
  jobs: Record<string, { name?: string; permissions?: unknown; steps?: Step[] }>;
}

const files = fs.readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));
const source = (file: string) => fs.readFileSync(path.join(WORKFLOWS, file), 'utf-8');
const workflow = (file: string) => parse(source(file)) as Workflow;
const jobNames = (file: string) => Object.values(workflow(file).jobs).map((job) => job.name);
const steps = (file: string) =>
  Object.values(workflow(file).jobs).flatMap((job) => job.steps ?? []);
const allSteps = files.flatMap(steps);

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

  it.each(files)('%s widens no permission in a job', (file) => {
    for (const job of Object.values(workflow(file).jobs)) {
      expect(job).not.toHaveProperty('permissions');
    }
  });

  // pull_request_target and workflow_run run with a write token and secrets on code a fork controls.
  it.each(files)('%s runs only on a pull request, a push to main or a manual dispatch', (file) => {
    const triggers = workflow(file).on;
    for (const event of Object.keys(triggers)) {
      expect(['pull_request', 'push', 'workflow_dispatch']).toContain(event);
    }
    expect(triggers.push?.branches).toEqual(['main']);
  });

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

  describe('the image job', () => {
    const job = workflow('ci.yml').jobs.image;
    const runs = (job?.steps ?? []).map((step) => step.run ?? '');
    const builds = runs.filter((run) => run.includes('docker buildx build'));

    it('sets up buildx with the pinned action', () => {
      expect((job?.steps ?? []).map((step) => step.uses).filter(Boolean)).toContain(
        'docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069',
      );
      expect(source('ci.yml')).toContain(
        'uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1',
      );
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
