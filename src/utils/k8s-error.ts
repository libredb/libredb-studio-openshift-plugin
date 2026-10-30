/** The field `key` of `value` when `value` is an object, else undefined. */
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** Where the console's Kubernetes errors carry the HTTP status, in the order they are read. */
const STATUS_PATHS: readonly (readonly [string, ...string[]])[] = [
  ['response', 'status'],
  ['json', 'code'],
  ['code'],
];

/**
 * The HTTP status of an error the console's Kubernetes hooks report: `error.response.status`, else `error.json.code`,
 * else `error.code`, the first of them that is a number; undefined when none is.
 */
export function httpStatus(error: unknown): number | undefined {
  for (const path of STATUS_PATHS) {
    const value = path.reduce<unknown>((current, key) => field(current, key), error);
    if (typeof value === 'number') {
      return value;
    }
  }
  return undefined;
}

/** Whether the error is the API server's 403, the answer to a request the user's RBAC does not allow. */
export function isForbidden(error: unknown): boolean {
  return httpStatus(error) === 403;
}
