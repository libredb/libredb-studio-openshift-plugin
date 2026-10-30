import {
  useActiveNamespace,
  useFlag,
  useK8sWatchResources,
} from '@openshift-console/dynamic-plugin-sdk';
import { renderHook } from '../../tests/support/render-hook';
import { KIND_ROWS, type KindRow } from '../contract/kinds';
import { useDatabaseRows, watchNamespace } from './useDatabaseRows';

const flag = jest.mocked(useFlag);
const watch = jest.mocked(useK8sWatchResources);
const activeNamespace = jest.mocked(useActiveNamespace);

const kind = (slug: KindRow['slug']) => KIND_ROWS.find((row) => row.slug === slug) as KindRow;
const CNPG = kind('cnpg');
const PGO = kind('pgo');
const MONGO = kind('mongo');

const cluster = (namespace: string, name: string) => ({
  apiVersion: 'postgresql.cnpg.io/v1',
  kind: 'Cluster',
  metadata: { namespace, name },
  spec: {},
  status: { phase: 'Cluster in healthy state' },
});
const postgresCluster = (namespace: string, name: string, users: string[]) => ({
  apiVersion: 'postgres-operator.crunchydata.com/v1beta1',
  kind: 'PostgresCluster',
  metadata: { namespace, name },
  spec: { users: users.map((user) => ({ name: user, databases: [name] })) },
});

type Result = { data: unknown; loaded: boolean; loadError: unknown };
const ok = (data: unknown[]): Result => ({ data, loaded: true, loadError: undefined });

function setUp(
  flags: Partial<Record<KindRow['slug'], boolean | undefined>>,
  results: Partial<Record<KindRow['slug'], Result>>,
  active = 'team-a',
) {
  flag.mockImplementation((name: string) => {
    const slug = KIND_ROWS.find((row) => row.flag === name)?.slug as KindRow['slug'];
    return slug in flags ? flags[slug] : false;
  });
  watch.mockReturnValue(results as ReturnType<typeof useK8sWatchResources>);
  activeNamespace.mockReturnValue([active, jest.fn()]);
}

const watchOf = (row: KindRow, namespace?: string) => ({
  groupVersionKind: { group: row.group, version: row.version, kind: row.kind },
  isList: true,
  namespaced: true,
  ...(namespace === undefined ? {} : { namespace }),
});

beforeEach(() => {
  flag.mockReset();
  watch.mockReset();
  activeNamespace.mockReset();
});

describe('watchNamespace', () => {
  it('watches an active namespace that is an RFC 1123 label', () => {
    expect(watchNamespace('team-a')).toBe('team-a');
    expect(watchNamespace('a')).toBe('a');
    expect(watchNamespace('a'.repeat(63))).toBe('a'.repeat(63));
  });

  it.each([['#ALL_NS#'], [''], ['Team-A'], ['a'.repeat(64)], ['-team'], ['team-'], ['team.a']])(
    'watches all projects for %j',
    (active) => {
      expect(watchNamespace(active)).toBeUndefined();
    },
  );
});

describe('useDatabaseRows', () => {
  it('asks every flag in kind order and watches the installed kinds in the active project', () => {
    setUp({ cnpg: true, edbpg: false, pgo: true, mongo: false }, { cnpg: ok([]), pgo: ok([]) });
    const { result } = renderHook(() => useDatabaseRows(), undefined);
    expect(flag.mock.calls.slice(0, 4)).toEqual(KIND_ROWS.map((row) => [row.flag]));
    expect(watch).toHaveBeenLastCalledWith({
      cnpg: watchOf(CNPG, 'team-a'),
      pgo: watchOf(PGO, 'team-a'),
    });
    expect(result.current).toEqual({
      namespace: 'team-a',
      kinds: [
        { kind: CNPG, loaded: true },
        { kind: PGO, loaded: true },
      ],
      rows: [],
      anyKindInstalled: true,
      loaded: true,
    });
  });

  it('watches cluster-wide under all projects', () => {
    setUp({ cnpg: true, pgo: true }, { cnpg: ok([]), pgo: ok([]) }, '#ALL_NS#');
    const { result } = renderHook(() => useDatabaseRows(), undefined);
    expect(watch).toHaveBeenLastCalledWith({ cnpg: watchOf(CNPG), pgo: watchOf(PGO) });
    expect(result.current.namespace).toBeUndefined();
  });

  it("refuses a kind the user cannot list and keeps the other kinds' rows", () => {
    setUp(
      { cnpg: true, pgo: true },
      {
        cnpg: ok([cluster('team-a', 'orders')]),
        pgo: {
          data: [postgresCluster('team-a', 'analytics', ['analyst'])],
          loaded: false,
          loadError: { response: { status: 403 } },
        },
      },
      '#ALL_NS#',
    );
    const { result } = renderHook(() => useDatabaseRows(), undefined);
    expect(result.current.kinds).toEqual([
      { kind: CNPG, loaded: true },
      { kind: PGO, loaded: true, error: 'forbidden' },
    ]);
    expect(result.current.rows.map((row) => [row.kind.slug, row.name])).toEqual([
      ['cnpg', 'orders'],
    ]);
    expect(result.current.loaded).toBe(true);
  });

  it('marks a kind whose watch failed for another reason', () => {
    setUp({ mongo: true }, { mongo: { data: [], loaded: false, loadError: new Error('timeout') } });
    const { result } = renderHook(() => useDatabaseRows(), undefined);
    expect(result.current.kinds).toEqual([{ kind: MONGO, loaded: true, error: 'failed' }]);
  });

  it('sorts rows by namespace, name and user and marks shared ids', () => {
    const shared = {
      apiVersion: 'mongodbcommunity.mongodb.com/v1',
      kind: 'MongoDBCommunity',
      metadata: { namespace: 'team-a', name: 'catalog' },
      spec: {
        users: [
          { name: 'app', db: 'b' },
          { name: 'app', db: 'a' },
        ],
      },
    };
    setUp(
      { cnpg: true, pgo: true, mongo: true },
      {
        cnpg: ok([cluster('team-b', 'orders'), cluster('team-a', 'orders')]),
        pgo: ok([postgresCluster('team-a', 'analytics', ['reporter', 'analyst'])]),
        mongo: ok([shared]),
      },
    );
    const { result } = renderHook(() => useDatabaseRows(), undefined);
    expect(
      result.current.rows.map((row) => [
        row.namespace,
        row.name,
        row.user,
        row.secretName,
        row.precheck,
      ]),
    ).toEqual([
      ['team-a', 'analytics', 'analyst', 'analytics-pguser-analyst', undefined],
      ['team-a', 'analytics', 'reporter', 'analytics-pguser-reporter', undefined],
      ['team-a', 'catalog', 'app', 'catalog-a-app', 'duplicate_id'],
      ['team-a', 'catalog', 'app', 'catalog-b-app', 'duplicate_id'],
      ['team-a', 'orders', undefined, 'orders-app', undefined],
      ['team-b', 'orders', undefined, 'orders-app', undefined],
    ]);
  });

  it('orders rows of two kinds with one name by kind', () => {
    const edb = { ...cluster('team-a', 'orders'), apiVersion: 'postgresql.k8s.enterprisedb.io/v1' };
    setUp(
      { cnpg: true, edbpg: true },
      { edbpg: ok([edb]), cnpg: ok([cluster('team-a', 'orders')]) },
    );
    const { result } = renderHook(() => useDatabaseRows(), undefined);
    expect(result.current.rows.map((row) => row.kind.slug)).toEqual(['cnpg', 'edbpg']);
  });

  it('puts a row without a user before the rows of a per-user kind with the same name', () => {
    const mongo = {
      apiVersion: 'mongodbcommunity.mongodb.com/v1',
      kind: 'MongoDBCommunity',
      metadata: { namespace: 'team-a', name: 'orders' },
      spec: { users: [{ name: 'app', db: 'a' }] },
    };
    setUp(
      { cnpg: true, mongo: true },
      { mongo: ok([mongo]), cnpg: ok([cluster('team-a', 'orders')]) },
    );
    const { result } = renderHook(() => useDatabaseRows(), undefined);
    expect(result.current.rows.map((row) => [row.kind.slug, row.user])).toEqual([
      ['cnpg', undefined],
      ['mongo', 'app'],
    ]);
  });

  it('reads a watch result that holds no list as no rows', () => {
    setUp(
      { cnpg: true, pgo: true },
      { cnpg: { data: undefined, loaded: true, loadError: undefined } },
    );
    const { result } = renderHook(() => useDatabaseRows(), undefined);
    expect(result.current.rows).toEqual([]);
    expect(result.current.kinds).toEqual([
      { kind: CNPG, loaded: true },
      { kind: PGO, loaded: false },
    ]);
    expect(result.current.loaded).toBe(false);
  });

  it('is not loaded while a kind is still loading', () => {
    setUp({ cnpg: true }, { cnpg: { data: [], loaded: false, loadError: undefined } });
    const { result } = renderHook(() => useDatabaseRows(), undefined);
    expect(result.current.loaded).toBe(false);
    expect(result.current.anyKindInstalled).toBe(true);
  });

  it('is not loaded while a flag is still unknown', () => {
    setUp({ cnpg: false, edbpg: false, pgo: false, mongo: undefined }, {});
    const { result } = renderHook(() => useDatabaseRows(), undefined);
    expect(result.current.loaded).toBe(false);
    expect(result.current.anyKindInstalled).toBe(false);
  });

  it('watches nothing when no supported operator is installed', () => {
    setUp({ cnpg: false, edbpg: false, pgo: false, mongo: false }, {});
    const { result } = renderHook(() => useDatabaseRows(), undefined);
    expect(watch).toHaveBeenLastCalledWith({});
    expect(result.current).toEqual({
      namespace: 'team-a',
      kinds: [],
      rows: [],
      anyKindInstalled: false,
      loaded: true,
    });
  });
});
