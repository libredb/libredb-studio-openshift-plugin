import { KIND_ROWS, type KindRow } from './kinds';
import { connectionId, idKey } from './connection-id';
import { databaseRows, markDuplicateIds } from './rows';

const kind = (slug: KindRow['slug']) => KIND_ROWS.find((row) => row.slug === slug) as KindRow;
const CNPG = kind('cnpg');
const EDB = kind('edbpg');
const PGO = kind('pgo');
const MONGO = kind('mongo');

const metadata = { namespace: 'team-a', name: 'orders' };

describe('databaseRows for the CloudNativePG family', () => {
  it("uses the operator's <name>-app Secret without an initdb Secret", () => {
    expect(databaseRows(CNPG, { metadata, spec: {} })).toEqual([
      {
        kind: CNPG,
        namespace: 'team-a',
        name: 'orders',
        key: 'team-a/orders',
        connectionId: connectionId('cnpg', 'team-a/orders'),
        secretName: 'orders-app',
      },
    ]);
  });

  it.each([
    [{ bootstrap: { initdb: { secret: { name: '' } } } }],
    [{ bootstrap: { initdb: { secret: { name: 42 } } } }],
    [{ bootstrap: { initdb: { secret: null } } }],
    [{ bootstrap: null }],
    ['not an object'],
    [undefined],
  ])('falls back to <name>-app for the spec %j', (spec) => {
    expect(databaseRows(CNPG, { metadata, spec })[0].secretName).toBe('orders-app');
  });

  it('uses the initdb Secret when one is named', () => {
    const spec = { bootstrap: { initdb: { secret: { name: 'orders-owner' } } } };
    expect(databaseRows(CNPG, { metadata, spec })[0].secretName).toBe('orders-owner');
  });

  it('builds EDB rows under the edbpg slug', () => {
    const [row] = databaseRows(EDB, { metadata });
    expect(row.kind).toBe(EDB);
    expect(row.connectionId).toBe(connectionId('edbpg', 'team-a/orders'));
    expect(row.connectionId.startsWith('k8s-edbpg-')).toBe(true);
    expect(row.secretName).toBe('orders-app');
  });
});

describe('databaseRows for Crunchy PGO', () => {
  const pgo = (spec: unknown) => databaseRows(PGO, { metadata, spec });

  it.each([[{}], [{ users: null }], [{ users: [] }], [undefined]])(
    'yields the default user named after the cluster for the spec %j',
    (spec) => {
      expect(pgo(spec)).toEqual([
        {
          kind: PGO,
          namespace: 'team-a',
          name: 'orders',
          user: 'orders',
          key: 'team-a/orders/orders',
          connectionId: connectionId('pgo', 'team-a/orders/orders'),
          secretName: 'orders-pguser-orders',
        },
      ]);
    },
  );

  it('yields one row per listed user', () => {
    const rows = pgo({
      users: [
        { name: 'app', databases: ['orders'] },
        { name: 'report', databases: ['orders', 'archive'] },
      ],
    });
    expect(rows.map((row) => [row.user, row.secretName, row.key, row.precheck])).toEqual([
      ['app', 'orders-pguser-app', 'team-a/orders/app', undefined],
      ['report', 'orders-pguser-report', 'team-a/orders/report', undefined],
    ]);
  });

  it.each([[{ name: 'app' }], [{ name: 'app', databases: [] }], [{ name: 'app', databases: 'x' }]])(
    'marks a listed user that lists no database no_database and keeps its Secret: %j',
    (user) => {
      const [row] = pgo({ users: [user] });
      expect(row.precheck).toBe('no_database');
      expect(row.secretName).toBe('orders-pguser-app');
      expect(row.user).toBe('app');
    },
  );

  it.each([[{ users: 'app' }], [{ users: { name: 'app' } }], [{ users: 7 }]])(
    'yields no row when spec.users is not a list: %j',
    (spec) => {
      expect(pgo(spec)).toEqual([]);
    },
  );

  it('skips a listed user without a name', () => {
    const rows = pgo({
      users: [null, 3, 'app', { name: 5 }, { name: '' }, { name: 'ok', databases: ['x'] }],
    });
    expect(rows.map((row) => row.user)).toEqual(['ok']);
  });
});

describe('databaseRows for MongoDB Community', () => {
  const mongo = (users: unknown) => databaseRows(MONGO, { metadata, spec: { users } });

  it.each([[undefined], [null], ['app'], [{ name: 'app' }]])(
    'yields no row without a list of users: %j',
    (users) => {
      expect(mongo(users)).toEqual([]);
    },
  );

  it('yields no row without a spec', () => {
    expect(databaseRows(MONGO, { metadata })).toEqual([]);
  });

  it('computes <name>-<db>-<user>, with admin for a user that names no database', () => {
    const rows = mongo([{ name: 'app', db: 'catalog' }, { name: 'ops' }]);
    expect(rows.map((row) => [row.user, row.secretName, row.key, row.precheck])).toEqual([
      ['app', 'orders-catalog-app', 'team-a/orders/app', undefined],
      ['ops', 'orders-admin-ops', 'team-a/orders/ops', undefined],
    ]);
  });

  it('prefers connectionStringSecretName', () => {
    const [row] = mongo([{ name: 'App_User', connectionStringSecretName: 'app-conn' }]);
    expect(row.secretName).toBe('app-conn');
    expect(row.precheck).toBeUndefined();
  });

  it('marks a computed name that needs normalization unsupported_name, with no Secret', () => {
    const [row] = mongo([{ name: 'App_User' }]);
    expect(row.precheck).toBe('unsupported_name');
    expect(row.secretName).toBeUndefined();
    expect(row.user).toBe('App_User');
  });

  it('marks a computed name longer than 253 characters unsupported_name', () => {
    // orders-admin-<user> is 13 characters plus the user: 241 make 254.
    const [long] = mongo([{ name: 'u'.repeat(241) }]);
    expect(long.precheck).toBe('unsupported_name');
    const [fits] = mongo([{ name: 'u'.repeat(240) }]);
    expect(fits.precheck).toBeUndefined();
    expect(fits.secretName).toHaveLength(253);
  });

  it('marks a Secret kept in another namespace other_namespace', () => {
    const [other] = mongo([{ name: 'app', connectionStringSecretNamespace: 'other' }]);
    expect(other.precheck).toBe('other_namespace');
    expect(other.secretName).toBe('orders-admin-app');
    const [own] = mongo([{ name: 'app', connectionStringSecretNamespace: 'team-a' }]);
    expect(own.precheck).toBeUndefined();
  });

  it('checks the name before the namespace, as the exporter does', () => {
    const [row] = mongo([{ name: 'App_User', connectionStringSecretNamespace: 'other' }]);
    expect(row.precheck).toBe('unsupported_name');
  });

  it('skips a user without a name', () => {
    expect(mongo([null, { db: 'x' }, { name: 1 }, { name: '' }]).map((row) => row.user)).toEqual(
      [],
    );
  });
});

describe('databaseRows on any input', () => {
  it.each([
    [null],
    [undefined],
    [42],
    ['orders'],
    [[]],
    [{}],
    [{ metadata: null }],
    [{ metadata: { name: 'orders' } }],
    [{ metadata: { namespace: 'team-a' } }],
    [{ metadata: { namespace: '', name: 'orders' } }],
    [{ metadata: { namespace: 'team-a', name: 7 } }],
    [{ metadata: [] }],
  ])('yields no row without a namespace and a name: %j', (resource) => {
    for (const row of KIND_ROWS) {
      expect(databaseRows(row, resource)).toEqual([]);
    }
  });

  it('reads the phase only when it is a string', () => {
    expect(
      databaseRows(CNPG, { metadata, status: { phase: 'Cluster in healthy state' } })[0].phase,
    ).toBe('Cluster in healthy state');
    expect(databaseRows(CNPG, { metadata, status: { phase: 3 } })[0].phase).toBeUndefined();
    expect(databaseRows(CNPG, { metadata, status: 'Ready' })[0].phase).toBeUndefined();
    expect('phase' in databaseRows(CNPG, { metadata })[0]).toBe(false);
  });

  it('reads own fields only', () => {
    const inherited = Object.create({ metadata }) as object;
    expect(databaseRows(CNPG, inherited)).toEqual([]);
  });
});

describe('markDuplicateIds', () => {
  const twoApps = databaseRows(MONGO, {
    metadata,
    spec: {
      users: [
        { name: 'app', db: 'a' },
        { name: 'app', db: 'b' },
      ],
    },
  });

  it('marks both rows of one MongoDB user name in two databases', () => {
    expect(twoApps.map((row) => row.key)).toEqual(['team-a/orders/app', 'team-a/orders/app']);
    expect(markDuplicateIds(twoApps).map((row) => row.precheck)).toEqual([
      'duplicate_id',
      'duplicate_id',
    ]);
  });

  it('leaves distinct ids alone', () => {
    const rows = databaseRows(PGO, {
      metadata,
      spec: {
        users: [
          { name: 'a', databases: ['x'] },
          { name: 'b', databases: ['x'] },
        ],
      },
    });
    expect(markDuplicateIds(rows)).toEqual(rows);
  });

  it('counts only rows Studio maps, so a prechecked row keeps its reason and frees the other', () => {
    const rows = databaseRows(MONGO, {
      metadata,
      spec: {
        users: [
          { name: 'app', db: 'admin' },
          { name: 'app', db: 'Reporting' },
        ],
      },
    });
    const marked = markDuplicateIds(rows);
    expect(marked.map((row) => row.precheck)).toEqual([undefined, 'unsupported_name']);
    expect(marked[0].secretName).toBe('orders-admin-app');
  });

  it('marks a shared id across resources and keeps the order', () => {
    const a = databaseRows(CNPG, { metadata });
    const b = databaseRows(CNPG, { metadata: { namespace: 'team-b', name: 'orders' } });
    const marked = markDuplicateIds([...a, ...b, ...a]);
    expect(marked.map((row) => [row.namespace, row.precheck])).toEqual([
      ['team-a', 'duplicate_id'],
      ['team-b', undefined],
      ['team-a', 'duplicate_id'],
    ]);
  });

  it('does not change its input', () => {
    markDuplicateIds(twoApps);
    expect(twoApps.map((row) => row.precheck)).toEqual([undefined, undefined]);
  });

  it('keys ids the way Studio does', () => {
    expect(twoApps[0].connectionId).toBe(connectionId('mongo', idKey('team-a', 'orders', 'app')));
  });
});
