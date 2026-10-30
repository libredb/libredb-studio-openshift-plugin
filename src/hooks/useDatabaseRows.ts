import {
  useActiveNamespace,
  useFlag,
  useK8sWatchResources,
  type K8sResourceCommon,
  type WatchK8sResource,
} from '@openshift-console/dynamic-plugin-sdk';
import { KIND_ROWS, type KindRow } from '../contract/kinds';
import { databaseRows, markDuplicateIds, type DatabaseRow } from '../contract/rows';
import { isForbidden } from '../utils/k8s-error';

/** A Kubernetes namespace name: an RFC 1123 label. */
const NAMESPACE_NAME = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

/**
 * The namespace to watch for the console's active namespace: the namespace itself when it is a namespace name,
 * else undefined, which watches all projects (the console's all-projects key is not a namespace name).
 */
export function watchNamespace(active: string): string | undefined {
  return NAMESPACE_NAME.test(active) ? active : undefined;
}

/** What the watch of one installed kind gave: loaded, or refused with the reason the page names. */
export interface KindListState {
  readonly kind: KindRow;
  readonly loaded: boolean;
  readonly error?: 'forbidden' | 'failed';
}

export interface DatabaseRowsState {
  /** The watched namespace, or undefined for all projects. */
  readonly namespace?: string;
  /** One entry per installed kind, in kind order. */
  readonly kinds: readonly KindListState[];
  /** The rows of every kind the user could list, sorted and with shared ids marked. */
  readonly rows: readonly DatabaseRow[];
  readonly anyKindInstalled: boolean;
  /** Whether every flag is known and every installed kind's watch has loaded or failed. */
  readonly loaded: boolean;
}

const KIND_ORDER = new Map(KIND_ROWS.map((row, index) => [row.slug, index]));

const compareText = (a: string | undefined, b: string | undefined): number => {
  if (a === b) {
    return 0;
  }
  if (a === undefined || b === undefined) {
    return a === undefined ? -1 : 1;
  }
  return a < b ? -1 : 1;
};

/** Namespace, name and user, then kind, credential Secret and id, so equal-looking rows keep one order. */
const compareRows = (a: DatabaseRow, b: DatabaseRow): number =>
  compareText(a.namespace, b.namespace) ||
  compareText(a.name, b.name) ||
  compareText(a.user, b.user) ||
  (KIND_ORDER.get(a.kind.slug) as number) - (KIND_ORDER.get(b.kind.slug) as number) ||
  compareText(a.secretName, b.secretName) ||
  compareText(a.connectionId, b.connectionId);

function watchOf(kind: KindRow, namespace: string | undefined): WatchK8sResource {
  return {
    groupVersionKind: { group: kind.group, version: kind.version, kind: kind.kind },
    isList: true,
    namespaced: true,
    ...(namespace === undefined ? {} : { namespace }),
  };
}

/**
 * The supported database resources the user can list in the console's active project, or in all projects, as rows.
 * Only kinds whose CRD is installed are watched; a kind the user may not list is reported as forbidden, never as an
 * empty list.
 */
export function useDatabaseRows(): DatabaseRowsState {
  const [active] = useActiveNamespace();
  const namespace = watchNamespace(active);
  // One useFlag call per kind, in a fixed order: hooks may not be called in a loop.
  const flags = [
    useFlag(KIND_ROWS[0].flag),
    useFlag(KIND_ROWS[1].flag),
    useFlag(KIND_ROWS[2].flag),
    useFlag(KIND_ROWS[3].flag),
  ];
  const installed = KIND_ROWS.filter((_kind, index) => flags[index] === true);
  const results = useK8sWatchResources<Record<string, K8sResourceCommon[]>>(
    Object.fromEntries(installed.map((kind) => [kind.slug, watchOf(kind, namespace)])),
  );

  const kinds: KindListState[] = [];
  const rows: DatabaseRow[] = [];
  for (const kind of installed) {
    const result = results[kind.slug];
    if (result?.loadError) {
      kinds.push({
        kind,
        loaded: true,
        error: isForbidden(result.loadError) ? 'forbidden' : 'failed',
      });
      continue;
    }
    kinds.push({ kind, loaded: result?.loaded === true });
    const resources: unknown = result?.data;
    if (Array.isArray(resources)) {
      rows.push(...resources.flatMap((resource: unknown) => databaseRows(kind, resource)));
    }
  }

  return {
    ...(namespace === undefined ? {} : { namespace }),
    kinds,
    rows: markDuplicateIds(rows.sort(compareRows)),
    anyKindInstalled: installed.length > 0,
    loaded: flags.every((value) => value !== undefined) && kinds.every((state) => state.loaded),
  };
}
