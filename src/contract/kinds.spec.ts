import * as fs from 'fs';
import * as path from 'path';
import { KIND_ROWS, kindForResource } from './kinds';

const golden = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../tests/unit/fixtures/kubernetes-discovery-golden.json'),
    'utf-8',
  ),
) as { cases: { resource: { apiVersion: string; kind: string } }[] };

describe('KIND_ROWS', () => {
  it("holds Studio's four first-release kinds in order", () => {
    expect(KIND_ROWS).toEqual([
      {
        slug: 'cnpg',
        label: 'CloudNativePG',
        group: 'postgresql.cnpg.io',
        version: 'v1',
        kind: 'Cluster',
        plural: 'clusters',
        flag: 'LIBREDB_STUDIO_CNPG',
        perUser: false,
      },
      {
        slug: 'edbpg',
        label: 'EDB Postgres for Kubernetes',
        group: 'postgresql.k8s.enterprisedb.io',
        version: 'v1',
        kind: 'Cluster',
        plural: 'clusters',
        flag: 'LIBREDB_STUDIO_EDBPG',
        perUser: false,
      },
      {
        slug: 'pgo',
        label: 'Crunchy PGO',
        group: 'postgres-operator.crunchydata.com',
        version: 'v1beta1',
        kind: 'PostgresCluster',
        plural: 'postgresclusters',
        flag: 'LIBREDB_STUDIO_PGO',
        perUser: true,
      },
      {
        slug: 'mongo',
        label: 'MongoDB Community',
        group: 'mongodbcommunity.mongodb.com',
        version: 'v1',
        kind: 'MongoDBCommunity',
        plural: 'mongodbcommunity',
        flag: 'LIBREDB_STUDIO_MONGO',
        perUser: true,
      },
    ]);
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(KIND_ROWS)).toBe(true);
    for (const row of KIND_ROWS) {
      expect(Object.isFrozen(row)).toBe(true);
    }
  });
});

describe('kindForResource', () => {
  it.each(golden.cases.map((c) => [c.resource.apiVersion, c.resource.kind]))(
    'maps the golden %s %s to a row',
    (apiVersion, kind) => {
      const row = kindForResource(apiVersion, kind);
      expect(row).toBeDefined();
      expect(`${row?.group}/${row?.version}`).toBe(apiVersion);
      expect(row?.kind).toBe(kind);
    },
  );

  it('tells the two Cluster kinds apart by their group', () => {
    expect(kindForResource('postgresql.cnpg.io/v1', 'Cluster')?.slug).toBe('cnpg');
    expect(kindForResource('postgresql.k8s.enterprisedb.io/v1', 'Cluster')?.slug).toBe('edbpg');
  });

  it.each([
    ['postgresql.cnpg.io/v2', 'Cluster'],
    [undefined, 'Cluster'],
    ['postgresql.cnpg.io/v1', undefined],
    ['postgresql.cnpg.io/v1', 'PostgresCluster'],
    ['v1', 'Secret'],
    ['', ''],
  ])('maps %s %s to no row', (apiVersion, kind) => {
    expect(kindForResource(apiVersion, kind)).toBeUndefined();
  });
});
