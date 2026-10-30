import * as fs from 'fs';
import * as path from 'path';

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

  it('carries exactly the extension types console-extensions.json declares', () => {
    const types = (extensions: Extension[]) => [...new Set(extensions.map((e) => e.type))].sort();
    expect(types(manifest.extensions)).toEqual(types(declared));
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
