import * as fs from 'fs';
import * as path from 'path';
import { act } from '@testing-library/react';
import { checkAccess } from '@openshift-console/dynamic-plugin-sdk';
import { renderHook } from '../../tests/support/render-hook';
import { ANALYST_ID, goldenRow, ORDERS_ID } from '../../tests/support/golden';
import type { DatabaseRow } from '../contract/rows';
import { useRowAccess } from './useRowAccess';

const access = jest.mocked(checkAccess);
type Review = Awaited<ReturnType<typeof checkAccess>>;

/** A promise the test settles by hand. */
function deferred() {
  let resolve = (value: unknown): unknown => value;
  let reject = (reason: unknown): unknown => reason;
  const promise = new Promise<Review>((res, rej) => {
    resolve = (value) => {
      res(value as Review);
      return value;
    };
    reject = (reason) => {
      rej(reason);
      return reason;
    };
  });
  return {
    promise,
    resolve: (value: unknown) => resolve(value),
    reject: (reason: unknown) => reject(reason),
  };
}

type Outcome = { resolve: unknown } | { reject: unknown };

const orders = goldenRow(ORDERS_ID);

beforeEach(() => {
  access.mockReset();
});

async function settle(row: DatabaseRow, outcome: Outcome) {
  const pending = deferred();
  access.mockReturnValue(pending.promise);
  const { result } = renderHook(useRowAccess, row);
  expect(result.current).toBe('checking');
  await act(async () => {
    if ('reject' in outcome) {
      pending.reject(outcome.reject);
    } else {
      pending.resolve(outcome.resolve);
    }
    await pending.promise.catch(() => undefined);
  });
  return result.current;
}

describe('useRowAccess', () => {
  it("reviews get on the row's credential Secret once", async () => {
    expect(await settle(orders, { resolve: { status: { allowed: true } } })).toBe('allowed');
    expect(access).toHaveBeenCalledTimes(1);
    expect(access).toHaveBeenCalledWith({
      group: '',
      resource: 'secrets',
      verb: 'get',
      name: 'orders-app',
      namespace: 'team-a',
    });
  });

  it('denies when the review does not allow', async () => {
    expect(await settle(orders, { resolve: { status: { allowed: false } } })).toBe('denied');
  });

  it.each([
    ['a rejection', { reject: new Error('Forbidden') }],
    ['a review with no status', { resolve: {} }],
    ['no review', { resolve: undefined }],
    ['an allowed that is not a boolean', { resolve: { status: { allowed: 'true' } } }],
  ])('cannot tell after %s', async (_case, outcome: Outcome) => {
    expect(await settle(orders, outcome)).toBe('unknown');
  });

  it('cannot tell when the review throws before it is sent', async () => {
    access.mockImplementation(() => {
      throw new Error('no model');
    });
    const { result } = renderHook(useRowAccess, orders);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe('unknown');
  });

  it('keeps checking while the review is pending', () => {
    access.mockReturnValue(deferred().promise);
    const { result } = renderHook(useRowAccess, orders);
    expect(result.current).toBe('checking');
  });

  it.each([
    ['no_database' as const],
    ['unsupported_name' as const],
    ['other_namespace' as const],
    ['duplicate_id' as const],
  ])('skips a row with the precheck %s', (precheck) => {
    const { result } = renderHook(useRowAccess, { ...orders, precheck });
    expect(result.current).toBe('skipped');
    expect(access).not.toHaveBeenCalled();
  });

  it('skips a row without a credential Secret', () => {
    const { result } = renderHook(useRowAccess, { ...orders, secretName: undefined });
    expect(result.current).toBe('skipped');
    expect(access).not.toHaveBeenCalled();
  });

  it('sets no state when the review settles after unmount', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const pending = deferred();
      access.mockReturnValue(pending.promise);
      const { unmount } = renderHook(useRowAccess, orders);
      unmount();
      await act(async () => {
        pending.resolve({ status: { allowed: true } });
        await pending.promise;
      });
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("never shows one row's answer for another row", async () => {
    const first = deferred();
    const second = deferred();
    access.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const analyst = goldenRow(ANALYST_ID);
    const { result, rerender } = renderHook(useRowAccess, orders);
    await act(async () => {
      first.resolve({ status: { allowed: true } });
      await first.promise;
    });
    expect(result.current).toBe('allowed');
    rerender(analyst);
    expect(result.current).toBe('checking');
    expect(access).toHaveBeenLastCalledWith({
      group: '',
      resource: 'secrets',
      verb: 'get',
      name: 'analytics-pguser-analyst',
      namespace: 'team-b',
    });
    await act(async () => {
      second.resolve({ status: { allowed: false } });
      await second.promise;
    });
    expect(result.current).toBe('denied');
  });
});

describe('the access review source', () => {
  it('catches an import and a call of useAccessReview', () => {
    const imports = /import\s*\{[^}]*\buseAccessReview(Allowed)?\b[^}]*\}\s*from/;
    expect(imports.test("import { checkAccess, useAccessReview } from 'x';")).toBe(true);
    expect(/\buseAccessReview(Allowed)?\s*\(/.test('useAccessReviewAllowed({})')).toBe(true);
  });

  it('never uses useAccessReview, which allows when the review fails', () => {
    const src = path.resolve(__dirname, '..');
    const files = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return files(full);
        }
        return /\.(ts|tsx)$/.test(entry.name) && !/\.spec\.(ts|tsx)$/.test(entry.name)
          ? [full]
          : [];
      });
    const users = files(src).filter((file) => {
      const source = fs.readFileSync(file, 'utf-8');
      return (
        /import\s*\{[^}]*\buseAccessReview(Allowed)?\b[^}]*\}\s*from/.test(source) ||
        /\buseAccessReview(Allowed)?\s*\(/.test(source)
      );
    });
    expect(users).toEqual([]);
  });
});
