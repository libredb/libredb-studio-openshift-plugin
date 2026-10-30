import { sha256Hex } from './sha256';

/** Studio's seed connection id rule. */
export const STUDIO_ID_RULE = /^[a-z0-9-]{1,64}$/;

/**
 * The key a database's id is computed from, as Studio builds it: `<namespace>/<name>`, or `<namespace>/<name>/<user>`
 * for a row per database user.
 */
export function idKey(namespace: string, name: string, user?: string): string {
  return user === undefined ? `${namespace}/${name}` : `${namespace}/${name}/${user}`;
}

/** The id Studio lists a discovered database under: `k8s-<slug>-` and the first 32 hex characters of SHA-256(key). */
export function connectionId(slug: string, key: string): string {
  return `k8s-${slug}-${sha256Hex(key).slice(0, 32)}`;
}
