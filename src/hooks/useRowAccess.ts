import { useEffect, useState } from 'react';
import { checkAccess } from '@openshift-console/dynamic-plugin-sdk';
import type { DatabaseRow } from '../contract/rows';

/**
 * Whether the user may read a row's credential Secret, as a hint only: `checking` while the review runs, `allowed` or
 * `denied` from its answer, `unknown` when it failed, and `skipped` for a row Studio does not list anyway. Studio
 * reviews again with the user's own token when the database opens, so this never decides access.
 */
export type RowAccess = 'checking' | 'allowed' | 'denied' | 'unknown' | 'skipped';

/** The review's answer: only a boolean `status.allowed` counts, anything else cannot tell. */
function accessOf(review: unknown): RowAccess {
  const status: unknown =
    review !== null && typeof review === 'object'
      ? (review as { status?: unknown }).status
      : undefined;
  const allowed: unknown =
    status !== null && typeof status === 'object'
      ? (status as { allowed?: unknown }).allowed
      : undefined;
  if (typeof allowed !== 'boolean') {
    return 'unknown';
  }
  return allowed ? 'allowed' : 'denied';
}

/**
 * Asks the console's SelfSubjectAccessReview for `get` on the row's credential Secret. It uses the SDK's memoized
 * `checkAccess`, not `useAccessReview`, which treats a failed review as allowed: here a failure gives `unknown`, which
 * shows no open control. The console keeps each answer until the page reloads.
 */
export function useRowAccess(row: DatabaseRow): RowAccess {
  const { namespace, secretName, precheck } = row;
  const skip = precheck !== undefined || secretName === undefined;
  const key = skip ? '' : `${namespace}/${secretName}`;
  const [answer, setAnswer] = useState<{ key: string; access: RowAccess }>();

  useEffect(() => {
    if (key === '') {
      return undefined;
    }
    let active = true;
    // The executor turns a synchronous throw of checkAccess into a rejection.
    new Promise<unknown>((resolve) =>
      resolve(
        checkAccess({ group: '', resource: 'secrets', verb: 'get', name: secretName, namespace }),
      ),
    ).then(
      (review) => active && setAnswer({ key, access: accessOf(review) }),
      () => active && setAnswer({ key, access: 'unknown' }),
    );
    return () => {
      active = false;
    };
  }, [key, namespace, secretName]);

  if (skip) {
    return 'skipped';
  }
  return answer?.key === key ? answer.access : 'checking';
}
