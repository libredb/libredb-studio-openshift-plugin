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
  permissions?: unknown;
  jobs: Record<string, { name?: string; steps?: Step[] }>;
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
    ]);
    expect(jobNames('secret-scan.yml')).toEqual(['Secret Scan']);
  });

  it.each(files)('%s grants read-only contents at the top level', (file) => {
    expect(workflow(file).permissions).toEqual({ contents: 'read' });
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
