import * as fs from 'fs';
import * as path from 'path';

const FIXTURES = path.resolve(__dirname, 'fixtures');
const read = (file: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf-8'));

interface Golden {
  provenance: string;
  cases: Record<string, unknown>[];
}

describe('the golden fixture', () => {
  it('names the released Studio tag it was copied from', () => {
    expect(read('kubernetes-discovery-golden.source.json')).toEqual({
      repository: 'libredb/libredb-studio',
      tag: 'libredb-studio-0.1.116',
      path: 'tests/fixtures/kubernetes-discovery-golden.json',
    });
  });

  it("is Studio's file with its eight cases", () => {
    const golden = read('kubernetes-discovery-golden.json') as Golden;
    expect(golden.provenance).toBe('libredb-studio');
    expect(golden.cases).toHaveLength(8);
    for (const c of golden.cases) {
      expect(c).toEqual(
        expect.objectContaining({
          resource: expect.any(Object),
          secretName: expect.any(String),
          connectionId: expect.stringMatching(/^k8s-(cnpg|edbpg|pgo|mongo)-[0-9a-f]{32}$/),
          toURL: expect.any(String),
          link: expect.any(String),
        }),
      );
    }
  });
});
