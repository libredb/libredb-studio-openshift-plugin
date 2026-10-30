import { connectionId, idKey } from './connection-id';
import type { KindRow } from './kinds';

/**
 * Why Studio does not list a row, known before any Secret is read: the exporter's prechecks, plus a connection id that
 * two rows share, which Studio's loader refuses for both.
 */
export type Precheck = 'no_database' | 'unsupported_name' | 'other_namespace' | 'duplicate_id';

/** One database Studio may list: a resource, or one database user of it for the per-user kinds. */
export interface DatabaseRow {
  readonly kind: KindRow;
  readonly namespace: string;
  readonly name: string;
  readonly user?: string;
  readonly key: string;
  readonly connectionId: string;
  readonly secretName?: string;
  readonly precheck?: Precheck;
  readonly phase?: string;
}

/** A Secret name MongoDB Community uses as it computes it, with nothing to normalize. */
const PLAIN_SECRET_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
/** The longest Kubernetes object name (a DNS subdomain). */
const MAX_SUBDOMAIN = 253;
/** The database MongoDB Community authenticates a user against when the user names none. */
const MONGO_ADMIN_DATABASE = 'admin';

/** The own field `key` of `value`, or undefined when `value` is not a plain object or has no such own field. */
function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return Object.prototype.hasOwnProperty.call(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** The value at `path` under `value`, reading own fields of plain objects only. */
function at(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((current, key) => field(current, key), value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

interface Base {
  readonly kind: KindRow;
  readonly namespace: string;
  readonly name: string;
  readonly phase?: string;
}

interface Candidate {
  readonly user?: string;
  readonly secretName?: string;
  readonly precheck?: Precheck;
}

function toRow(base: Base, candidate: Candidate): DatabaseRow {
  const key = idKey(base.namespace, base.name, candidate.user);
  return {
    kind: base.kind,
    namespace: base.namespace,
    name: base.name,
    ...(candidate.user === undefined ? {} : { user: candidate.user }),
    key,
    connectionId: connectionId(base.kind.slug, key),
    ...(candidate.secretName === undefined ? {} : { secretName: candidate.secretName }),
    ...(candidate.precheck === undefined ? {} : { precheck: candidate.precheck }),
    ...(base.phase === undefined ? {} : { phase: base.phase }),
  };
}

/** CloudNativePG and EDB: the initdb Secret when one is named, else the operator's `<name>-app`. */
function cnpgFamily(base: Base, spec: unknown): Candidate[] {
  return [
    { secretName: text(at(spec, 'bootstrap', 'initdb', 'secret', 'name')) ?? `${base.name}-app` },
  ];
}

/**
 * Crunchy PGO: one row per `spec.users` entry, or the default user named after the cluster when that list is absent,
 * null or empty; the Secret is `<name>-pguser-<user>`, and a user that lists no database is marked no_database.
 */
function pgo(base: Base, spec: unknown): Candidate[] {
  const users = field(spec, 'users');
  if (users === undefined || users === null || (Array.isArray(users) && users.length === 0)) {
    return [{ user: base.name, secretName: `${base.name}-pguser-${base.name}` }];
  }
  if (!Array.isArray(users)) {
    return [];
  }
  return users.flatMap((entry: unknown): Candidate[] => {
    const user = text(field(entry, 'name'));
    if (user === undefined) {
      return [];
    }
    const databases = field(entry, 'databases');
    const listsDatabase = Array.isArray(databases) && databases.length > 0;
    return [
      {
        user,
        secretName: `${base.name}-pguser-${user}`,
        ...(listsDatabase ? {} : { precheck: 'no_database' as const }),
      },
    ];
  });
}

/**
 * MongoDB Community: one row per `spec.users` entry, none without users. The Secret is the user's
 * connectionStringSecretName, else `<name>-<db or admin>-<user>` when that needs no normalization, else the row is
 * marked unsupported_name; otherwise a Secret kept in another namespace is marked other_namespace.
 */
function mongo(base: Base, spec: unknown): Candidate[] {
  const users = field(spec, 'users');
  if (!Array.isArray(users)) {
    return [];
  }
  return users.flatMap((entry: unknown): Candidate[] => {
    const user = text(field(entry, 'name'));
    if (user === undefined) {
      return [];
    }
    const db = field(entry, 'db');
    const computed = `${base.name}-${typeof db === 'string' ? db : MONGO_ADMIN_DATABASE}-${user}`;
    const named = text(field(entry, 'connectionStringSecretName'));
    if (
      named === undefined &&
      !(computed.length <= MAX_SUBDOMAIN && PLAIN_SECRET_NAME.test(computed))
    ) {
      return [{ user, precheck: 'unsupported_name' }];
    }
    const secretNamespace = field(entry, 'connectionStringSecretNamespace');
    const otherNamespace = secretNamespace !== undefined && secretNamespace !== base.namespace;
    return [
      {
        user,
        secretName: named ?? computed,
        ...(otherNamespace ? { precheck: 'other_namespace' as const } : {}),
      },
    ];
  });
}

const EXPAND: Readonly<Record<KindRow['slug'], typeof pgo>> = {
  cnpg: cnpgFamily,
  edbpg: cnpgFamily,
  pgo,
  mongo,
};

/**
 * The rows of one resource of `kind`, with each row's id key, connection id, credential Secret name and precheck as
 * Studio's exporter computes them; no row when the resource has no namespace or name. The resource is read as
 * untrusted input: any shape yields rows or none, never an exception.
 */
export function databaseRows(kind: KindRow, resource: unknown): DatabaseRow[] {
  const namespace = text(at(resource, 'metadata', 'namespace'));
  const name = text(at(resource, 'metadata', 'name'));
  if (namespace === undefined || name === undefined) {
    return [];
  }
  const phase = at(resource, 'status', 'phase');
  const base: Base = {
    kind,
    namespace,
    name,
    ...(typeof phase === 'string' ? { phase } : {}),
  };
  return EXPAND[kind.slug](base, field(resource, 'spec')).map((candidate) =>
    toRow(base, candidate),
  );
}

/**
 * Marks `duplicate_id` on every row whose connection id another row shares, counting only rows with no precheck, as
 * Studio's loader counts only the rows it mapped: a row that already has a precheck keeps its own reason and is not
 * counted. Returns new rows in the same order.
 */
export function markDuplicateIds(rows: readonly DatabaseRow[]): DatabaseRow[] {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const row of rows) {
    if (row.precheck === undefined) {
      (seen.has(row.connectionId) ? shared : seen).add(row.connectionId);
    }
  }
  return rows.map((row) =>
    row.precheck === undefined && shared.has(row.connectionId)
      ? { ...row, precheck: 'duplicate_id' }
      : row,
  );
}
