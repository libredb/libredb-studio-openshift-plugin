import * as fs from 'fs';
import * as path from 'path';
import { KIND_ROWS } from '../../src/contract/kinds';

const ROOT = path.resolve(__dirname, '../..');
const read = <T>(file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf-8')) as T;

interface Extension {
  type: string;
  properties?: unknown;
}

const pkg = read<{ version: string; consolePlugin: { exposedModules: Record<string, string> } }>(
  'package.json',
);
const declared = read<Extension[]>('console-extensions.json');
const manifest = read<{
  name: string;
  version: string;
  dependencies: Record<string, string>;
  extensions: Extension[];
  baseURL: string;
  loadScripts: string[];
}>('dist/plugin-manifest.json');

/** Every `$codeRef` value under `value`. */
function codeRefs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(codeRefs);
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) =>
      key === '$codeRef' && typeof inner === 'string' ? [inner] : codeRefs(inner),
    );
  }
  return [];
}

describe('the built plugin manifest', () => {
  it('names the plugin, its version and the plugin API range', () => {
    expect(manifest.name).toBe('libredb-studio');
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.dependencies['@console/pluginAPI']).toBe('>=4.19.0-0');
  });

  it('carries exactly the extensions console-extensions.json declares', () => {
    expect(manifest.extensions).toEqual(declared);
  });

  it('is served under the plugin name and loads scripts the build wrote', () => {
    expect(manifest.baseURL).toBe('/api/plugins/libredb-studio/');
    expect(manifest.loadScripts.length).toBeGreaterThan(0);
    for (const script of manifest.loadScripts) {
      expect(fs.existsSync(path.join(ROOT, 'dist', script))).toBe(true);
    }
  });

  it('routes the Databases page, adds its navigation item and declares the four kind flags', () => {
    expect(pkg.consolePlugin.exposedModules).toEqual({
      DatabasesPage: './components/DatabasesPage',
      DatabaseDetailsItem: './components/DatabaseDetailsItem',
    });
    expect(manifest.extensions.filter((e) => e.type === 'console.page/route')).toEqual([
      {
        type: 'console.page/route',
        properties: {
          path: '/libredb-studio/databases',
          exact: true,
          component: { $codeRef: 'DatabasesPage' },
        },
      },
    ]);
    expect(manifest.extensions.filter((e) => e.type === 'console.navigation/href')).toEqual([
      {
        type: 'console.navigation/href',
        properties: {
          id: 'libredb-studio-databases',
          name: '%plugin__libredb-studio~Databases%',
          href: '/libredb-studio/databases',
          section: 'home',
        },
      },
    ]);
    expect(manifest.extensions.filter((e) => e.type === 'console.flag/model')).toHaveLength(4);
    expect(new Set(manifest.extensions.map((e) => e.type))).toEqual(
      new Set([
        'console.flag/model',
        'console.page/route',
        'console.navigation/href',
        'console.resource/details-item',
      ]),
    );
  });

  it('adds the LibreDB Studio details item to the details page of each supported kind', () => {
    expect(manifest.extensions.filter((e) => e.type === 'console.resource/details-item')).toEqual(
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

  it('uses no extension type the 4.22 console removed', () => {
    for (const extension of manifest.extensions) {
      expect(extension.type).not.toBe('console.page/resource/tab');
      expect(extension.type).not.toBe('console.dashboards/overview/detail/item');
    }
  });

  it('refers only to exposed modules', () => {
    const modules = Object.keys(pkg.consolePlugin.exposedModules);
    for (const ref of codeRefs(manifest.extensions)) {
      expect(modules).toContain(ref.split('.')[0]);
    }
  });
});
