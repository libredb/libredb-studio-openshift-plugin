import {
  useK8sWatchResource,
  type K8sResourceCommon,
  type WatchK8sResource,
} from '@openshift-console/dynamic-plugin-sdk';
import { parseStudioHref } from '../contract/studio-link';
import { httpStatus } from '../utils/k8s-error';

/** The name of the cluster-scoped ConsoleLink through which LibreDB Studio's chart and operator publish its address. */
export const LOCATOR_NAME = 'libredb-studio';
/** The label Studio's chart puts on the locator, with LOCATOR_NAME as its value. */
const LOCATOR_LABEL = 'app.kubernetes.io/name';
/** Where Studio's chart places the locator in the console. */
const LOCATOR_LOCATION = 'ApplicationMenu';

/**
 * A list watch narrowed to the locator's name rather than a single-object watch: the console's single-object watch
 * keeps a deleted object until its next poll, while a list watch drops it on the DELETED event, so the open control
 * stops at once (ruling L39).
 */
const LOCATOR_WATCH: WatchK8sResource = {
  groupVersionKind: { group: 'console.openshift.io', version: 'v1', kind: 'ConsoleLink' },
  fieldSelector: `metadata.name=${LOCATOR_NAME}`,
  isList: true,
};

export type StudioLocator =
  | { state: 'loading' }
  | { state: 'ready'; base: string; host: string }
  | { state: 'missing' }
  | { state: 'ambiguous' }
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

/** Studio's base address from one link, or null unless the link is named, labelled and placed as Studio's chart writes it. */
function linkBase(link: unknown): string | null {
  const metadata = field(link, 'metadata');
  const spec = field(link, 'spec');
  return field(metadata, 'name') === LOCATOR_NAME &&
    field(field(metadata, 'labels'), LOCATOR_LABEL) === LOCATOR_NAME &&
    field(spec, 'location') === LOCATOR_LOCATION
    ? parseStudioHref(field(spec, 'href'))
    : null;
}

/**
 * Studio's address from the locator list watch. It is ready only when the list holds exactly one link and that link
 * is named and labelled as Studio's chart writes it, sits in the application menu, and its `href` is an `https:` URL
 * with no credentials, query or fragment. No link, or one that fails a check, reads as not set up; more than one is
 * refused as ambiguous, never resolved by picking one. A 404 is not set up, a 403 is forbidden and any other error is
 * an error.
 */
export function locatorFromWatch(links: unknown, loaded: boolean, error: unknown): StudioLocator {
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
  if (!Array.isArray(links)) {
    return { state: 'missing' };
  }
  if (links.length > 1) {
    return { state: 'ambiguous' };
  }
  const base = links.length === 1 ? linkBase(links[0]) : null;
  return base === null ? { state: 'missing' } : { state: 'ready', base, host: new URL(base).host };
}

/** Where LibreDB Studio runs, learned only from its locator ConsoleLink, which every signed-in user may read. */
export function useStudioLocator(): StudioLocator {
  const [links, loaded, error] = useK8sWatchResource<K8sResourceCommon[]>(LOCATOR_WATCH);
  return locatorFromWatch(links, loaded, error);
}
