import { STUDIO_ID_RULE } from './connection-id';

/**
 * Studio's base address from a console link's `href`, or null unless it is an `https:` URL with no user name,
 * password, query or fragment. The base is the origin and path with trailing slashes removed, as Studio's chart writes
 * `https://<host><basePath>`.
 */
export function parseStudioHref(href: unknown): string | null {
  if (typeof href !== 'string') {
    return null;
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null;
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/** The link that opens the connection `id` in Studio at `base`: `<base>/?connection=seed%3A<id>`, and nothing else. */
export function studioLink(base: string, id: string): string {
  if (!STUDIO_ID_RULE.test(id)) {
    throw new Error(`${JSON.stringify(id)} is not a LibreDB Studio connection id`);
  }
  return `${base.replace(/\/+$/, '')}/?connection=${encodeURIComponent(`seed:${id}`)}`;
}
