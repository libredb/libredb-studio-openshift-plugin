import { KIND_ROWS, type KindRow } from '../../src/contract/kinds';
import { databaseRows, type DatabaseRow } from '../../src/contract/rows';

export const kindOf = (slug: KindRow['slug']) =>
  KIND_ROWS.find((row) => row.slug === slug) as KindRow;

/** The rows of one PostgresCluster `namespace/name` with `count` users named user-000 and on, each with a database. */
export function manyUserRows(namespace: string, name: string, count: number): DatabaseRow[] {
  const users = Array.from({ length: count }, (_value, index) => ({
    name: `user-${String(index).padStart(3, '0')}`,
    databases: ['app'],
  }));
  return databaseRows(kindOf('pgo'), { metadata: { namespace, name }, spec: { users } });
}
