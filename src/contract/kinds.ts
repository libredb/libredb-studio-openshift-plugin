/**
 * The database kinds the plugin lists: LibreDB Studio's first-release Kubernetes discovery kinds, with Studio's slugs
 * and labels, so a row's connection id and engine name equal the ones Studio lists.
 */
export interface KindRow {
  /** The kind slug in Studio's connection id. */
  readonly slug: 'cnpg' | 'edbpg' | 'pgo' | 'mongo';
  /** The engine name the page shows. */
  readonly label: string;
  readonly group: string;
  readonly version: string;
  readonly kind: string;
  readonly plural: string;
  /** The console feature flag that is set while the kind's CRD is installed. */
  readonly flag: string;
  /** Whether the kind has one row per database user, whose name is part of the id key. */
  readonly perUser: boolean;
}

const row = (value: KindRow): KindRow => Object.freeze(value);

export const KIND_ROWS: readonly KindRow[] = Object.freeze([
  row({
    slug: 'cnpg',
    label: 'CloudNativePG',
    group: 'postgresql.cnpg.io',
    version: 'v1',
    kind: 'Cluster',
    plural: 'clusters',
    flag: 'LIBREDB_STUDIO_CNPG',
    perUser: false,
  }),
  row({
    slug: 'edbpg',
    label: 'EDB Postgres for Kubernetes',
    group: 'postgresql.k8s.enterprisedb.io',
    version: 'v1',
    kind: 'Cluster',
    plural: 'clusters',
    flag: 'LIBREDB_STUDIO_EDBPG',
    perUser: false,
  }),
  row({
    slug: 'pgo',
    label: 'Crunchy PGO',
    group: 'postgres-operator.crunchydata.com',
    version: 'v1beta1',
    kind: 'PostgresCluster',
    plural: 'postgresclusters',
    flag: 'LIBREDB_STUDIO_PGO',
    perUser: true,
  }),
  row({
    slug: 'mongo',
    label: 'MongoDB Community',
    group: 'mongodbcommunity.mongodb.com',
    version: 'v1',
    kind: 'MongoDBCommunity',
    plural: 'mongodbcommunity',
    flag: 'LIBREDB_STUDIO_MONGO',
    perUser: true,
  }),
]);

/** The row of a resource's `apiVersion` and `kind`, or undefined for any other resource. */
export function kindForResource(
  apiVersion: string | undefined,
  kind: string | undefined,
): KindRow | undefined {
  return KIND_ROWS.find(
    (candidate) =>
      `${candidate.group}/${candidate.version}` === apiVersion && candidate.kind === kind,
  );
}
