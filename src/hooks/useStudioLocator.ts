import { useK8sWatchResource, type WatchK8sResource } from '@openshift-console/dynamic-plugin-sdk';
import { parseStudioHref } from '../contract/studio-link';
import { httpStatus } from '../utils/k8s-error';

/** The name of the cluster-scoped ConsoleLink through which LibreDB Studio's chart and operator publish its address. */
export const LOCATOR_NAME = 'libredb-studio';
/** The label Studio's chart puts on the locator, with LOCATOR_NAME as its value. */
const LOCATOR_LABEL = 'app.kubernetes.io/name';
/** Where Studio's chart places the locator in the console. */
const LOCATOR_LOCATION = 'ApplicationMenu';

const LOCATOR_WATCH: WatchK8sResource = {
  groupVersionKind: { group: 'console.openshift.io', version: 'v1', kind: 'ConsoleLink' },
  name: LOCATOR_NAME,
  isList: false,
};

export type StudioLocator =
  | { state: 'loading' }
  | { state: 'ready'; base: string; host: string }
  | { state: 'missing' }
  | { state: 'forbidden' }
  | { state: 'error' };

/** The own field `key` of `value`, or undefined when `value` is not a plain object or has no such own field. */
function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return Object.prototype.hasOwnProperty.call(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Studio's address from the locator watch. The link counts only when it is named and labelled as Studio's chart
 * writes it, sits in the application menu, and its `href` is an `https:` URL with no credentials, query or fragment;
 * anything else reads as not set up, never as Studio's address. A 404 is not set up, a 403 is forbidden and any other
 * error is an error.
 */
export function locatorFromWatch(link: unknown, loaded: boolean, error: unknown): StudioLocator {
  if (error) {
    const status = httpStatus(error);
    if (status === 404) {
      return { state: 'missing' };
    }
    return status === 403 ? { state: 'forbidden' } : { state: 'error' };
  }
  if (!loaded) {
    return { state: 'loading' };
  }
  const metadata = field(link, 'metadata');
  const spec = field(link, 'spec');
  const base =
    field(metadata, 'name') === LOCATOR_NAME &&
    field(field(metadata, 'labels'), LOCATOR_LABEL) === LOCATOR_NAME &&
    field(spec, 'location') === LOCATOR_LOCATION
      ? parseStudioHref(field(spec, 'href'))
      : null;
  return base === null ? { state: 'missing' } : { state: 'ready', base, host: new URL(base).host };
}

/** Where LibreDB Studio runs, learned only from its locator ConsoleLink, which every signed-in user may read. */
export function useStudioLocator(): StudioLocator {
  const [link, loaded, error] = useK8sWatchResource<Record<string, unknown>>(LOCATOR_WATCH);
  return locatorFromWatch(link, loaded, error);
}
