import * as fs from 'fs';
import * as path from 'path';
import { kindForResource } from '../../src/contract/kinds';
import { databaseRows, type DatabaseRow } from '../../src/contract/rows';

interface GoldenCase {
  resource: { apiVersion: string; kind: string; metadata: { namespace: string; name: string } };
  user: string | null;
  connectionId: string;
}

const golden = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../unit/fixtures/kubernetes-discovery-golden.json'),
    'utf-8',
  ),
) as { cases: GoldenCase[] };

/** The row Studio's golden fixture lists under `id`, computed by the plugin's own contract code. */
export function goldenRow(id: string): DatabaseRow {
  const found = golden.cases.find((c) => c.connectionId === id);
  if (found === undefined) {
    throw new Error(`no golden case ${id}`);
  }
  const kind = kindForResource(found.resource.apiVersion, found.resource.kind);
  const row = kind && databaseRows(kind, found.resource).find((r) => r.connectionId === id);
  if (row === undefined) {
    throw new Error(`the golden case ${id} yields no row`);
  }
  return row;
}

/** The golden resource whose rows include `id`. */
export function goldenResource(id: string): GoldenCase['resource'] {
  const found = golden.cases.find((c) => c.connectionId === id);
  if (found === undefined) {
    throw new Error(`no golden case ${id}`);
  }
  return found.resource;
}

/** team-a/orders, a CloudNativePG Cluster. */
export const ORDERS_ID = 'k8s-cnpg-75c1a60b898072af828207cff435c7e5';
/** team-b/analytics, a Crunchy PGO PostgresCluster, user analyst. */
export const ANALYST_ID = 'k8s-pgo-08ddbec864884242a67b9c2ec28ca05a';
/** team-b/analytics, a Crunchy PGO PostgresCluster, user reporter. */
export const REPORTER_ID = 'k8s-pgo-d106fe4159e2b5c6f6ea56a502555372';
