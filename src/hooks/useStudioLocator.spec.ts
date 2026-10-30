import { renderHook } from '../../tests/support/render-hook';
import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { LOCATOR_NAME, locatorFromWatch, useStudioLocator } from './useStudioLocator';

const watch = jest.mocked(useK8sWatchResource);

const link = (overrides: { metadata?: unknown; spec?: unknown } = {}) => ({
  apiVersion: 'console.openshift.io/v1',
  kind: 'ConsoleLink',
  metadata: {
    name: 'libredb-studio',
    labels: { 'app.kubernetes.io/name': 'libredb-studio' },
  },
  spec: {
    location: 'ApplicationMenu',
    href: 'https://studio.apps.example.test/studio',
    text: 'LibreDB Studio',
  },
  ...overrides,
});

const withSpec = (spec: Record<string, unknown>) => link({ spec: { ...link().spec, ...spec } });

beforeEach(() => {
  watch.mockReset();
});

describe('locatorFromWatch', () => {
  it('gives the base and host of a valid locator', () => {
    expect(locatorFromWatch(link(), true, undefined)).toEqual({
      state: 'ready',
      base: 'https://studio.apps.example.test/studio',
      host: 'studio.apps.example.test',
    });
  });

  it('removes trailing slashes and keeps a port in the host', () => {
    expect(
      locatorFromWatch(withSpec({ href: 'https://studio.example.test:8443//' }), true, null),
    ).toEqual({
      state: 'ready',
      base: 'https://studio.example.test:8443',
      host: 'studio.example.test:8443',
    });
  });

  it('is loading while the watch has neither data nor an error', () => {
    expect(locatorFromWatch(undefined, false, undefined)).toEqual({ state: 'loading' });
    expect(locatorFromWatch(link(), false, null)).toEqual({ state: 'loading' });
  });

  it('maps the watch error by its status', () => {
    expect(locatorFromWatch(undefined, false, { response: { status: 404 } })).toEqual({
      state: 'missing',
    });
    expect(locatorFromWatch(undefined, false, { json: { code: 403 } })).toEqual({
      state: 'forbidden',
    });
    expect(locatorFromWatch(undefined, false, { code: 500 })).toEqual({ state: 'error' });
    expect(locatorFromWatch(undefined, false, new Error('network'))).toEqual({ state: 'error' });
  });

  it('trusts the error over data the watch still holds', () => {
    expect(locatorFromWatch(link(), true, { code: 403 })).toEqual({ state: 'forbidden' });
  });

  it.each([
    ['no label', link({ metadata: { name: 'libredb-studio' } })],
    ['labels that are not an object', link({ metadata: { name: 'libredb-studio', labels: 'x' } })],
    [
      'the label of another application',
      link({ metadata: { name: 'libredb-studio', labels: { 'app.kubernetes.io/name': 'other' } } }),
    ],
    [
      'another name',
      link({
        metadata: { name: 'other', labels: { 'app.kubernetes.io/name': 'libredb-studio' } },
      }),
    ],
    ['no metadata', link({ metadata: undefined })],
    ['another location', withSpec({ location: 'NamespaceDashboard' })],
    ['an http href', withSpec({ href: 'http://studio.apps.example.test' })],
    ['a javascript href', withSpec({ href: 'javascript:alert(1)' })],
    ['credentials', withSpec({ href: 'https://user:pw@studio.apps.example.test' })],
    ['a user name only', withSpec({ href: 'https://user@studio.apps.example.test' })],
    ['a query', withSpec({ href: 'https://studio.apps.example.test/?a=1' })],
    ['a fragment', withSpec({ href: 'https://studio.apps.example.test/#x' })],
    ['an href that is not a URL', withSpec({ href: 'not a url' })],
    ['an href that is not a string', withSpec({ href: 42 })],
    ['no spec', link({ spec: undefined })],
    ['a spec that is not an object', link({ spec: 'x' })],
  ])('reads a link with %s as not set up', (_case, value) => {
    expect(locatorFromWatch(value, true, undefined)).toEqual({ state: 'missing' });
  });

  it.each([[undefined], [null], [[]], ['libredb-studio'], [{}]])(
    'reads a loaded watch holding %j as not set up',
    (value) => {
      expect(locatorFromWatch(value, true, undefined)).toEqual({ state: 'missing' });
    },
  );
});

describe('useStudioLocator', () => {
  it('watches only the console link named libredb-studio', () => {
    watch.mockReturnValue([link(), true, undefined]);
    const { result } = renderHook(() => useStudioLocator(), undefined);
    expect(LOCATOR_NAME).toBe('libredb-studio');
    expect(watch).toHaveBeenCalledWith({
      groupVersionKind: { group: 'console.openshift.io', version: 'v1', kind: 'ConsoleLink' },
      name: 'libredb-studio',
      isList: false,
    });
    for (const [argument] of watch.mock.calls) {
      expect(argument).toEqual(watch.mock.calls[0][0]);
    }
    expect(result.current).toEqual({
      state: 'ready',
      base: 'https://studio.apps.example.test/studio',
      host: 'studio.apps.example.test',
    });
  });

  it('reports the watch error', () => {
    watch.mockReturnValue([undefined, false, { response: { status: 404 } }]);
    const { result } = renderHook(() => useStudioLocator(), undefined);
    expect(result.current).toEqual({ state: 'missing' });
  });
});
