import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const ROOT = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf-8');

interface PackageJson {
  name: string;
  version: string;
  license: string;
  private: boolean;
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  dependencies?: Record<string, string>;
  resolutions: Record<string, string>;
  dependenciesMeta?: Record<string, { built?: boolean }>;
  consolePlugin: { dependencies: Record<string, string> };
}

const pkg = JSON.parse(read('package.json')) as PackageJson;

/** Packages allowed to run their install scripts through dependenciesMeta.<name>.built, each with its reason. */
const BUILT_ALLOW_LIST: readonly string[] = [];

/** The resolved versions of every yarn.lock entry whose descriptor names `name`. */
function lockedVersions(name: string): string[] {
  const versions: string[] = [];
  for (const block of read('yarn.lock').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const header = lines[0];
    const descriptors = header.replace(/:$/, '').replace(/"/g, '').split(', ');
    if (!descriptors.some((descriptor) => descriptor.startsWith(`${name}@`))) {
      continue;
    }
    const version = lines.find((line) => line.trim().startsWith('version:'));
    if (version !== undefined) {
      versions.push(version.trim().replace(/^version:\s*/, ''));
    }
  }
  return versions;
}

describe('dependency pins', () => {
  it('pins the console SDK to the 4.19 line and the plugin API range to 4.19 and later', () => {
    expect(pkg.devDependencies['@openshift-console/dynamic-plugin-sdk']).toBe('4.19.1');
    expect(pkg.devDependencies['@openshift-console/dynamic-plugin-sdk-webpack']).toBe('4.19.0');
    expect(pkg.consolePlugin.dependencies).toEqual({ '@console/pluginAPI': '>=4.19.0-0' });
  });

  it('pins PatternFly 6.2 in devDependencies', () => {
    expect(pkg.devDependencies['@patternfly/react-core']).toBe('6.2.3');
    expect(pkg.devDependencies['@patternfly/react-table']).toBe('6.2.3');
    expect(pkg.devDependencies['@patternfly/react-icons']).toBe('6.2.2');
    expect(pkg.devDependencies['@patternfly/react-styles']).toBe('6.2.2');
    expect(pkg.devDependencies['@patternfly/react-tokens']).toBe('6.2.2');
  });

  it('holds PatternFly on 6.2 through resolutions', () => {
    expect(pkg.resolutions).toEqual({
      '@patternfly/react-core': '6.2.3',
      '@patternfly/react-table': '6.2.3',
      '@patternfly/react-icons': '6.2.2',
      '@patternfly/react-styles': '6.2.2',
      '@patternfly/react-tokens': '6.2.2',
    });
  });

  it('pins React 17, react-i18next 11 and Testing Library on the React 17 line', () => {
    expect([pkg.devDependencies.react, pkg.devDependencies['react-dom']]).toEqual([
      '17.0.2',
      '17.0.2',
    ]);
    expect([pkg.devDependencies['react-i18next'], pkg.devDependencies.i18next]).toEqual([
      '11.18.6',
      '23.16.8',
    ]);
    expect(pkg.devDependencies['@testing-library/react']).toBe('12.1.5');
    expect(pkg.devDependencies['@testing-library/dom']).toBe('8.20.1');
  });

  it('names the package after the plugin and keeps it private under Apache-2.0', () => {
    expect(pkg.name).toBe('libredb-studio');
    expect(pkg.license).toBe('Apache-2.0');
    expect(pkg.private).toBe(true);
  });

  it.each([
    ['@patternfly/react-core', /^6\.2\./],
    ['@patternfly/react-table', /^6\.2\./],
    ['@patternfly/react-icons', /^6\.2\./],
    ['@patternfly/react-styles', /^6\.2\./],
    ['@patternfly/react-tokens', /^6\.2\./],
    ['@openshift-console/dynamic-plugin-sdk', /^4\.19\.1$/],
    ['@openshift-console/dynamic-plugin-sdk-webpack', /^4\.19\.0$/],
  ])('resolves every yarn.lock entry of %s to the pinned line', (name, expected) => {
    const versions = lockedVersions(name);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      expect(version).toMatch(expected);
    }
  });

  it('keeps no Cypress, mocha or mochawesome dependency', () => {
    const names = Object.keys({ ...pkg.devDependencies, ...pkg.dependencies });
    expect(names.filter((name) => /cypress|mocha/.test(name))).toEqual([]);
  });

  it('fails lint on any ESLint or stylelint warning', () => {
    const linters = pkg.scripts.lint.split('&&').map((command) => command.trim());
    expect(linters.map((command) => command.split(' ')[0])).toEqual(['eslint', 'stylelint']);
    for (const command of linters) {
      expect(command).toContain('--max-warnings 0');
    }
  });

  it('runs Node 22', () => {
    expect(read('.nvmrc').trim()).toBe('22');
  });

  it('runs no dependency install script', () => {
    const lines = read('.yarnrc.yml')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    expect(lines).toEqual([
      'enableScripts: false',
      'enableTelemetry: false',
      'nodeLinker: node-modules',
      'yarnPath: .yarn/releases/yarn-4.13.0.cjs',
    ]);
    const built = Object.entries(pkg.dependenciesMeta ?? {})
      .filter(([, meta]) => meta.built === true)
      .map(([name]) => name);
    expect(built.filter((name) => !BUILT_ALLOW_LIST.includes(name))).toEqual([]);
  });

  it('parses TypeScript and TSX with the automatic JSX runtime in swc', () => {
    const swc = JSON.parse(read('.swcrc')) as {
      jsc: { parser: { syntax: string; tsx: boolean }; transform: { react: { runtime: string } } };
    };
    expect(swc.jsc.parser.syntax).toBe('typescript');
    expect(swc.jsc.parser.tsx).toBe(true);
    expect(swc.jsc.transform.react.runtime).toBe('automatic');
  });

  it('type-checks specs with the Jest, jest-dom and Node types', () => {
    const tsconfig = JSON.parse(read('tsconfig.json')) as { compilerOptions: { types: string[] } };
    expect(tsconfig.compilerOptions.types).toEqual(['jest', '@testing-library/jest-dom', 'node']);
  });

  it('keeps the build-output spec and the end-to-end tree out of the main Jest run', () => {
    const source = read('jest.config.ts');
    expect(source).toContain("'<rootDir>/tests/build/'");
    expect(source).toContain("'<rootDir>/integration-tests/'");
  });

  it('extracts strings into the plugin namespace', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require(path.join(ROOT, 'i18next-parser.config.js')) as {
      defaultNamespace: string;
    };
    expect(config.defaultNamespace).toBe('plugin__libredb-studio');
  });

  it('delays npm version updates by seven days', () => {
    const dependabot = parse(read('.github/dependabot.yml')) as {
      updates: { 'package-ecosystem': string; cooldown?: { 'default-days'?: number } }[];
    };
    const npm = dependabot.updates.find((update) => update['package-ecosystem'] === 'npm');
    expect(npm?.cooldown?.['default-days']).toBe(7);
  });
});
