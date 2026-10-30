import * as fs from 'fs';
import * as path from 'path';
import { kindForResource } from '../../src/contract/kinds';
import { databaseRows } from '../../src/contract/rows';

interface GoldenCase {
  resource: { apiVersion: string; kind: string; metadata: { namespace: string; name: string } };
  user: string | null;
  secretName: string;
  connectionId: string;
}

const golden = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures/kubernetes-discovery-golden.json'), 'utf-8'),
) as { cases: GoldenCase[] };

const rowsOf = (c: GoldenCase) => {
  const kind = kindForResource(c.resource.apiVersion, c.resource.kind);
  if (kind === undefined) {
    throw new Error(`no kind row for ${c.resource.apiVersion} ${c.resource.kind}`);
  }
  return databaseRows(kind, c.resource);
};

describe("Studio's golden cases", () => {
  it.each(golden.cases.map((c) => [c.connectionId, c]))(
    'yields %s with its credential Secret',
    (_id, c) => {
      const row = rowsOf(c).find((candidate) => candidate.user === (c.user ?? undefined));
      expect(row).toBeDefined();
      expect(row?.secretName).toBe(c.secretName);
      expect(row?.connectionId).toBe(c.connectionId);
      expect(row?.precheck).toBeUndefined();
    },
  );

  it('yields exactly the listed users of the analytics PostgresCluster', () => {
    const analytics = golden.cases.find(
      (c) => c.resource.kind === 'PostgresCluster' && c.resource.metadata.name === 'analytics',
    ) as GoldenCase;
    expect(rowsOf(analytics).map((row) => row.user)).toEqual(['analyst', 'reporter']);
  });
});
