import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { KIND_ROWS } from '../../src/contract/kinds';

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const OPEN_IN_STUDIO = 'components/OpenInStudio.tsx';
const ROW_ACCESS = 'hooks/useRowAccess.ts';

/** Every non-spec source file under src/, relative to src/. */
function sourceFiles(dir: string = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.spec\.(ts|tsx)$/.test(entry.name)
      ? [path.relative(SRC, full)]
      : [];
  });
}

const files = sourceFiles();
const read = (file: string) => fs.readFileSync(path.join(SRC, file), 'utf-8');

/** Modules the plugin never imports (ESLint holds the same list). */
const RESTRICTED_MODULES = [
  'react-router',
  'react-router-dom',
  'react-router-dom-v5-compat',
  'react-redux',
  'redux',
  '@patternfly/react-topology',
  '@patternfly/patternfly',
];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const importOf = (module: string, subpaths: boolean) =>
  new RegExp(
    `(?:from\\s*|require\\(\\s*|import\\(\\s*|import\\s+)['"]${escape(module)}${subpaths ? '(?:/[^\'"]*)?' : ''}['"]`,
  );

/** Each forbidden construct, with a sample it must catch. */
const FORBIDDEN: readonly (readonly [string, RegExp, string])[] = [
  ...RESTRICTED_MODULES.map(
    (module) =>
      [`an import of ${module}`, importOf(module, true), `import x from '${module}';`] as const,
  ),
  [
    'a PatternFly CSS import',
    importOf('@patternfly/react-styles/css', true),
    "import '@patternfly/react-styles/css/components/Table/table';",
  ],
  [
    'a console method',
    /\bconsole\.(log|info|warn|error|debug|trace|dir|table)\b/,
    'console.log(row);',
  ],
  ['eval', /\beval\s*\(/, 'eval(code);'],
  ['new Function', /\bnew\s+Function\s*\(/, "new Function('return 1');"],
  ['fetch', /\bfetch\s*\(/, "fetch('https://example.com');"],
  ['consoleFetch', /\bconsoleFetch/, "consoleFetch('/api');"],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/, 'new XMLHttpRequest();'],
  ['WebSocket', /\bWebSocket\b/, "new WebSocket('wss://x');"],
  ['localStorage', /\blocalStorage\b/, "localStorage.getItem('x');"],
  ['sessionStorage', /\bsessionStorage\b/, "sessionStorage.setItem('x', 'y');"],
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/, '<div dangerouslySetInnerHTML={x} />'],
  ['innerHTML', /\binnerHTML\b/, 'node.innerHTML = x;'],
  ['outerHTML', /\bouterHTML\b/, 'node.outerHTML = x;'],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/, "node.insertAdjacentHTML('x', y);"],
  ['document.write', /\bdocument\.write/, 'document.write(x);'],
  [
    'Trans from react-i18next',
    /import\s*\{[^}]*\bTrans\b[^}]*\}\s*from\s*['"]react-i18next['"]/,
    "import { Trans, useTranslation } from 'react-i18next';",
  ],
  ['a JSX href attribute', /\shref=[{"']/, '<a href={link}>x</a>'],
  ['a JSX target attribute', /\starget=[{"']/, '<a target="_blank">x</a>'],
  ['window.location', /\bwindow\.location\b/, 'window.location.href = x;'],
  ['location.assign', /\blocation\.assign\b/, 'location.assign(x);'],
  ['location.replace', /\blocation\.replace\b/, 'location.replace(x);'],
  ['a Secret kind', /kind:\s*['"]Secret['"]/, "{ kind: 'Secret' }"],
  ['SecretModel', /\bSecretModel\b/, 'import { SecretModel } from x;'],
  ['a Secret path', /['"`]\/secrets['"`/]|\/api\/v1\/namespaces\/.*\/secrets/, "'/secrets'"],
];

describe('the plugin source rules', () => {
  it('finds the source files', () => {
    expect(files).toContain(path.join('contract', 'rows.ts'));
  });

  it.each(FORBIDDEN.map(([name, pattern, sample]) => [name, pattern, sample]))(
    'the %s rule catches its sample',
    (_name, pattern, sample) => {
      expect(pattern.test(sample as string)).toBe(true);
    },
  );

  it('does not take a console API group for a console method', () => {
    expect(
      /\bconsole\.(log|info|warn|error|debug|trace|dir|table)\b/.test("'console.openshift.io'"),
    ).toBe(false);
  });

  it.each(files)('%s uses no forbidden construct', (file) => {
    const source = read(file);
    const found = FORBIDDEN.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
    expect(found).toEqual([]);
  });

  it('opens a window only from OpenInStudio, exactly once', () => {
    for (const file of files) {
      const opens = read(file).match(/\bwindow\.open\s*\(/g)?.length ?? 0;
      expect([file, opens]).toEqual([file, file === path.join(OPEN_IN_STUDIO) ? 1 : 0]);
    }
  });

  it("names the 'secrets' resource only in the access review hook", () => {
    const naming = files.filter(
      (file) => file !== path.join(ROW_ACCESS) && /['"`]secrets['"`]/.test(read(file)),
    );
    expect(naming).toEqual([]);
  });

  it('translates only in the plugin namespace', () => {
    for (const file of files) {
      for (const call of read(file).matchAll(/\buseTranslation\s*\(([^)]*)\)/g)) {
        expect([file, call[1].trim()]).toEqual([file, "'plugin__libredb-studio'"]);
      }
    }
  });
});

describe('console-extensions.json', () => {
  const extensions = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'console-extensions.json'), 'utf-8'),
  ) as { type: string; properties: unknown }[];

  it('declares a feature flag per supported kind', () => {
    expect(extensions.filter((extension) => extension.type === 'console.flag/model')).toEqual(
      KIND_ROWS.map((row) => ({
        type: 'console.flag/model',
        properties: {
          flag: row.flag,
          model: { group: row.group, version: row.version, kind: row.kind },
        },
      })),
    );
  });

  it('declares a LibreDB Studio details item per supported kind', () => {
    expect(
      extensions.filter((extension) => extension.type === 'console.resource/details-item'),
    ).toEqual(
      KIND_ROWS.map((row) => ({
        type: 'console.resource/details-item',
        properties: {
          model: { group: row.group, version: row.version, kind: row.kind },
          id: `libredb-studio-details-${row.slug}`,
          column: 'right',
          title: '%plugin__libredb-studio~LibreDB Studio%',
          component: { $codeRef: 'DatabaseDetailsItem' },
        },
      })),
    );
  });

  it('exposes the module of every component it names', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
      consolePlugin: { exposedModules: Record<string, string> };
    };
    expect(pkg.consolePlugin.exposedModules).toEqual({
      DatabasesPage: './components/DatabasesPage',
      DatabaseDetailsItem: './components/DatabaseDetailsItem',
    });
  });
});

describe('the ESLint configuration for src/', () => {
  it('refuses console methods, dangerouslySetInnerHTML and the restricted modules', () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'node_modules/eslint/bin/eslint.js'),
        '--print-config',
        'src/contract/rows.ts',
      ],
      { cwd: ROOT, encoding: 'utf-8' },
    );
    expect(result.status).toBe(0);
    const rules = (JSON.parse(result.stdout) as { rules: Record<string, unknown> }).rules;
    const severity = (rule: unknown) => (Array.isArray(rule) ? rule[0] : rule);
    expect(severity(rules['react/no-danger'])).toBe(2);
    expect(severity(rules['no-console'])).toBe(2);
    const restricted = rules['no-restricted-imports'] as [number, { paths: { name: string }[] }];
    expect(restricted[0]).toBe(2);
    expect(restricted[1].paths.map((entry) => entry.name)).toEqual(RESTRICTED_MODULES);
  });
});
