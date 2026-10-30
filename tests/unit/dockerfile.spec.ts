import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'yaml';

const ROOT = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf-8');

// The shape of each pin, not its digest: Dependabot moves the digests, and each of its pull requests passes the image
// job's smoke test before it merges (R-27).
const BUILD_BASE =
  /^--platform=\$BUILDPLATFORM registry\.access\.redhat\.com\/ubi9\/nodejs-22:latest@sha256:[0-9a-f]{64} AS build$/;
const RUNTIME_BASE = /^registry\.access\.redhat\.com\/ubi9\/nginx-120:latest@sha256:[0-9a-f]{64}$/;

interface Instruction {
  keyword: string;
  args: string;
}

/** The Dockerfile as instructions: comments dropped, continuation lines joined. */
const instructions: Instruction[] = read('Dockerfile')
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')
  .replace(/\\\n/g, ' ')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [, keyword, args] = /^(\S+)\s*(.*)$/.exec(line) as RegExpExecArray;
    return { keyword: keyword.toUpperCase(), args: args.replace(/\s+/g, ' ') };
  });

const of = (keyword: string, from: Instruction[] = instructions) =>
  from.filter((instruction) => instruction.keyword === keyword).map(({ args }) => args);
const fromIndexes = instructions.flatMap((instruction, index) =>
  instruction.keyword === 'FROM' ? [index] : [],
);
const buildStage = instructions.slice(fromIndexes[0], fromIndexes[1]);
const runtimeStage = instructions.slice(fromIndexes[1]);
const yarnPath = (parse(read('.yarnrc.yml')) as { yarnPath: string }).yarnPath;
const version = (JSON.parse(read('package.json')) as { version: string }).version;

/** The label pairs of every LABEL instruction of the runtime stage. */
const labels = Object.fromEntries(
  of('LABEL', runtimeStage).flatMap((args) =>
    [...args.matchAll(/([\w.-]+)=("(?:[^"\\]|\\.)*"|\S+)/g)].map(([, key, value]) => [
      key,
      value.replace(/^"|"$/g, ''),
    ]),
  ),
);

describe('the Dockerfile', () => {
  it('builds from the two UBI bases pinned by digest, each FROM written out in full', () => {
    const froms = of('FROM');
    expect(froms).toHaveLength(2);
    expect(froms[0]).toMatch(BUILD_BASE);
    expect(froms[1]).toMatch(RUNTIME_BASE);
  });

  it('installs from the lockfile with the committed Yarn release, which runs no install script', () => {
    expect(yarnPath).toBe('.yarn/releases/yarn-4.13.0.cjs');
    expect(read('.yarnrc.yml')).toMatch(/^enableScripts: false$/m);
    const runs = of('RUN', buildStage);
    expect(runs).toContain(`node ${yarnPath} install --immutable`);
    expect(runs).toContain(`node ${yarnPath} build`);
  });

  it('downloads nothing but the locked dependencies', () => {
    expect(of('ADD')).toEqual([]);
    for (const run of of('RUN')) {
      expect(run).not.toMatch(/\b(curl|wget|npm|npx|corepack)\b/);
    }
  });

  it('has no RUN in the runtime stage, so the arm64 image builds without emulation', () => {
    expect(of('RUN', runtimeStage)).toEqual([]);
  });

  it('serves the bundle with the baked configuration and ships the licences', () => {
    expect(of('COPY', runtimeStage)).toEqual([
      '--from=build /opt/app-root/src/dist /usr/share/nginx/html',
      'nginx.conf /etc/nginx/nginx.conf',
      'LICENSE NOTICE /licenses/',
    ]);
  });

  it('labels the image with its name, vendor, version and maintainer', () => {
    expect(of('ARG', runtimeStage)).toEqual(['VERSION']);
    expect(labels).toMatchObject({
      name: 'libredb-studio-openshift-plugin',
      vendor: 'LibreDB',
      version: '${VERSION}',
      release: '${VERSION}',
      maintainer: 'LibreDB <info@sekoya.tech>',
    });
    expect(labels.summary).toMatch(/\S/);
    expect(labels.description).toMatch(/\S/);
  });

  // The nginx base sets these for its own build and for s2i. Left alone, the plugin image would name the base's
  // commit and date as its own and offer an s2i usage it does not support. A release sets the OCI created and
  // revision labels from its own build.
  it('clears the provenance and s2i labels the base image sets, and names its source', () => {
    for (const inherited of [
      'build-date',
      'vcs-ref',
      'vcs-type',
      'org.opencontainers.image.created',
      'org.opencontainers.image.revision',
      'usage',
      'help',
      'io.openshift.s2i.scripts-url',
      'io.s2i.scripts-url',
    ]) {
      expect(labels).toHaveProperty([inherited], '');
    }
    expect(labels['org.opencontainers.image.source']).toBe(
      'https://github.com/libredb/libredb-studio-openshift-plugin',
    );
  });

  it('runs nginx as user 1001 in the foreground with no log file', () => {
    const users = of('USER');
    expect(users[users.length - 1]).toBe('1001');
    expect(of('USER', runtimeStage)).toEqual(['1001']);
    expect(of('ENTRYPOINT')).toEqual(['["nginx", "-e", "/dev/stderr", "-g", "daemon off;"]']);
    expect(of('CMD')).toEqual([]);
  });

  describe('the VERSION check of the build stage', () => {
    const checks = of('RUN', buildStage).filter((run) => run.includes('VERSION'));
    const check = checks[0] ?? 'exit 99';

    it('is one RUN of the build stage, which takes VERSION as a build argument', () => {
      expect(of('ARG', buildStage)).toEqual(['VERSION']);
      expect(checks).toHaveLength(1);
    });

    /** Runs the check with sh in a directory holding this package.json, as the build stage does. */
    const runCheck = (value: string | undefined) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dockerfile-version-'));
      fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
      const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
      if (value !== undefined) {
        env.VERSION = value;
      }
      const result = spawnSync('sh', ['-c', check], { cwd: dir, env, encoding: 'utf-8' });
      fs.rmSync(dir, { recursive: true, force: true });
      return result;
    };

    it('passes when VERSION equals the package.json version', () => {
      expect(runCheck(version).status).toBe(0);
    });

    it.each([
      ['unset', undefined],
      ['empty', ''],
      ['another version', '9.9.9'],
    ])('refuses a VERSION that is %s, naming the build argument', (_label, value) => {
      const result = runCheck(value);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('--build-arg VERSION');
    });
  });
});

describe('the Docker build context', () => {
  const ignored = read('.dockerignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  it('leaves out installed modules, build output, history, coverage and end-to-end sessions', () => {
    for (const entry of [
      'node_modules',
      'dist',
      '.git',
      'coverage',
      'integration-tests/results',
      'integration-tests/.auth',
    ]) {
      expect(ignored).toContain(entry);
    }
  });
});
