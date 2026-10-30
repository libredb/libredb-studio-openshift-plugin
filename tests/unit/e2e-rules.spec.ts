import {
  judgeConsoleMessage,
  labUser,
  playwrightOutputDir,
  secretReviews,
  studioBase,
} from '../../integration-tests/support/rules';

const ENTRY = 'https://console.example/api/plugins/libredb-studio/plugin-entry.js';
const CONSOLE = 'https://console.example/static/main-bundle.min.js';

describe('labUser', () => {
  it('reads each lab user password from its own variable', () => {
    const env = {
      E2E_PASSWORD_DEV_A: 'a-secret',
      E2E_PASSWORD_DEV_B: 'b-secret',
      E2E_PASSWORD_OS_ADMIN: 'admin-secret',
    };
    expect(labUser('dev-a', env)).toEqual({ username: 'dev-a', password: 'a-secret' });
    expect(labUser('dev-b', env)).toEqual({ username: 'dev-b', password: 'b-secret' });
    expect(labUser('os-admin', env)).toEqual({ username: 'os-admin', password: 'admin-secret' });
  });

  it('throws naming the variable, never a value, when the password is unset or empty', () => {
    expect(() => labUser('dev-b', { E2E_PASSWORD_DEV_A: 'a-secret' })).toThrow(
      'E2E_PASSWORD_DEV_B is not set',
    );
    expect(() => labUser('os-admin', { E2E_PASSWORD_OS_ADMIN: '' })).toThrow(
      'E2E_PASSWORD_OS_ADMIN is not set',
    );
  });
});

describe('studioBase', () => {
  it('returns the https URL without a trailing slash', () => {
    expect(studioBase({ STUDIO_URL: 'https://studio.apps.example/' })).toBe(
      'https://studio.apps.example',
    );
    expect(studioBase({ STUDIO_URL: 'https://studio.apps.example/base' })).toBe(
      'https://studio.apps.example/base',
    );
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('throws when STUDIO_URL is %s', (_case, value) => {
    expect(() => studioBase({ STUDIO_URL: value })).toThrow('STUDIO_URL is not set');
  });

  it.each([
    'http://studio.apps.example',
    'https://studio.apps.example/?a=1',
    'https://studio.apps.example/#x',
    'https://user:pass@studio.apps.example',
  ])('refuses %s', (value) => {
    expect(() => studioBase({ STUDIO_URL: value })).toThrow(
      'STUDIO_URL must be an https URL with no query, fragment or credentials',
    );
  });
});

describe('judgeConsoleMessage (R-45)', () => {
  it('flags the one load error R-44 may allow', () => {
    expect(
      judgeConsoleMessage(
        'error',
        '[loadAndEnablePlugin] libredb-studio loadPlugin failed: Failed to load plugin manifest e: Unauthorized',
        CONSOLE,
      ),
    ).toBe('unauthorized-load');
  });

  it('forbids any other error that names libredb-studio', () => {
    expect(
      judgeConsoleMessage(
        'error',
        '[loadAndEnablePlugin] libredb-studio loadPlugin failed: Not Found',
        CONSOLE,
      ),
    ).toBe('forbidden');
    expect(judgeConsoleMessage('error', 'TypeError in libredb-studio', ENTRY)).toBe('forbidden');
  });

  it('leaves errors that do not name the plugin to the console', () => {
    expect(
      judgeConsoleMessage(
        'error',
        'Failed to load resource: the server responded with a status of 502 (Bad Gateway)',
        CONSOLE,
      ),
    ).toBe('ignored');
  });

  it.each([
    'Unsatisfied version 18.3.1 from openshift-console of shared singleton module react (required ^17.0.1)',
    'Unsatisfied version 16.5.8 from openshift-console of shared singleton module react-i18next (required ^11.12.0)',
    'Unsatisfied version 0.0.0-fixed from openshift-console of shared singleton module @openshift-console/dynamic-plugin-sdk (required =4.19.1)',
  ])('allows the shared-module warning from the plugin entry: %s', (text) => {
    expect(judgeConsoleMessage('warning', text, ENTRY)).toBe('allowed');
  });

  it.each(['[DEPRECATION WARNING]', '[WARNING]'])(
    'allows the older-console notice with the %s prefix',
    (prefix) => {
      expect(
        judgeConsoleMessage(
          'warning',
          `${prefix} libredb-studio@0.1.0 was built for an older version of Console and may not work correctly in this version.`,
          CONSOLE,
        ),
      ).toBe('allowed');
    },
  );

  it('forbids the notice for another prefix', () => {
    expect(
      judgeConsoleMessage(
        'warning',
        '[ERROR] libredb-studio@0.1.0 was built for an older version of Console and may not work correctly in this version.',
        CONSOLE,
      ),
    ).toBe('forbidden');
  });

  it('flags the failed manifest fetch, which only the allowed load error may bring', () => {
    expect(
      judgeConsoleMessage(
        'warning',
        'consoleFetch failed for url https://console.example/api/plugins/libredb-studio/plugin-manifest.json e: Unauthorized',
        CONSOLE,
      ),
    ).toBe('unauthorized-fetch');
  });

  it('forbids any other warning that names the plugin or comes from its assets', () => {
    expect(
      judgeConsoleMessage(
        'warning',
        'Unsatisfied version 5.0.1 from openshift-console of shared singleton module redux (required ^4.0.4)',
        ENTRY,
      ),
    ).toBe('forbidden');
    expect(judgeConsoleMessage('warning', 'libredb-studio: something odd', CONSOLE)).toBe(
      'forbidden',
    );
  });

  it("leaves another plugin's warnings to the console", () => {
    expect(
      judgeConsoleMessage(
        'warning',
        'Unsatisfied version 5.0.1 from openshift-console of shared singleton module redux (required ^4.0.4)',
        'https://console.example/api/plugins/networking-console-plugin/plugin-entry.js',
      ),
    ).toBe('ignored');
  });

  it('ignores messages below warning level', () => {
    expect(judgeConsoleMessage('log', 'LIBREDB_STUDIO_CNPG was detected.', CONSOLE)).toBe(
      'ignored',
    );
    expect(judgeConsoleMessage('info', 'libredb-studio loaded', ENTRY)).toBe('ignored');
  });
});

describe('secretReviews', () => {
  const review = (attributes: Record<string, unknown>) => ({
    method: 'POST',
    path: '/api/kubernetes/apis/authorization.k8s.io/v1/selfsubjectaccessreviews',
    resourceAttributes: attributes,
  });

  it('keeps every get of a Secret and every review that names one', () => {
    const get = { resource: 'secrets', verb: 'get', name: 'orders-app', namespace: 'team-a' };
    const getAll = { resource: 'secrets', verb: 'get', name: '', namespace: 'team-a' };
    const namedList = { resource: 'secrets', verb: 'list', name: 'orders-app', namespace: '' };
    expect(secretReviews([review(get), review(getAll), review(namedList)])).toEqual([
      get,
      getAll,
      namedList,
    ]);
  });

  it('keeps every other review of Secrets, such as an unnamed list, watch or delete', () => {
    const list = { resource: 'secrets', verb: 'list', name: '', namespace: 'team-a' };
    const watch = { resource: 'secrets', verb: 'watch' };
    const deleteAll = { resource: 'secrets', verb: 'delete', namespace: 'team-b' };
    const createInNamespace = { resource: 'secrets', verb: 'create', namespace: 'team-a' };
    expect(
      secretReviews([review(list), review(watch), review(deleteAll), review(createInNamespace)]),
    ).toEqual([list, watch, deleteAll, createInNamespace]);
  });

  it("records, not constrains, the console's own unnamed create review and other resources", () => {
    expect(
      secretReviews([
        review({ resource: 'secrets', verb: 'create', name: '', namespace: '' }),
        review({ resource: 'secrets', verb: 'create' }),
        review({ resource: 'services', verb: 'get', name: 'x', namespace: 'team-a' }),
        { method: 'GET', path: '/api/kubernetes/api/v1/namespaces/team-a/pods' },
      ]),
    ).toEqual([]);
  });
});

describe('playwrightOutputDir', () => {
  it("keeps Playwright's own output in a subfolder of E2E_EVIDENCE_DIR, which Playwright empties", () => {
    expect(playwrightOutputDir({ E2E_EVIDENCE_DIR: '/evidence/e2e/helm' })).toBe(
      '/evidence/e2e/helm/playwright',
    );
    expect(playwrightOutputDir({ E2E_EVIDENCE_DIR: '/evidence/e2e/helm/' })).toBe(
      '/evidence/e2e/helm/playwright',
    );
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('uses the gitignored results folder when E2E_EVIDENCE_DIR is %s', (_case, value) => {
    expect(playwrightOutputDir({ E2E_EVIDENCE_DIR: value })).toBe(
      'integration-tests/results/output',
    );
  });

  it('refuses a relative E2E_EVIDENCE_DIR, which would resolve inside the checkout', () => {
    expect(() => playwrightOutputDir({ E2E_EVIDENCE_DIR: '.' })).toThrow(
      'E2E_EVIDENCE_DIR must be an absolute path',
    );
    expect(() => playwrightOutputDir({ E2E_EVIDENCE_DIR: 'e2e/helm' })).toThrow(
      'E2E_EVIDENCE_DIR must be an absolute path',
    );
  });
});
