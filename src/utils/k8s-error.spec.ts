import { httpStatus, isForbidden } from './k8s-error';

describe('httpStatus', () => {
  it.each([
    [{ response: { status: 403 } }, 403],
    [{ json: { code: 403 } }, 403],
    [{ code: 403 }, 403],
    [{ response: { status: 404 }, json: { code: 500 }, code: 401 }, 404],
    [{ response: { status: '404' }, json: { code: 500 } }, 500],
    [{ response: null, json: 'x', code: 401 }, 401],
  ])('reads %j as %d', (error, status) => {
    expect(httpStatus(error)).toBe(status);
  });

  it.each([[null], [undefined], ['403'], [403], [{ code: '403' }], [{}], [[403]]])(
    'gives no status for %j',
    (error) => {
      expect(httpStatus(error)).toBeUndefined();
    },
  );

  it('reads the status of an Error the console throws', () => {
    const error = Object.assign(new Error('Forbidden'), {
      response: { status: 403 },
      json: { code: 403 },
    });
    expect(httpStatus(error)).toBe(403);
  });
});

describe('isForbidden', () => {
  it('is true for a 403 only', () => {
    expect(isForbidden({ response: { status: 403 } })).toBe(true);
    expect(isForbidden({ json: { code: 403 } })).toBe(true);
    expect(isForbidden({ code: 403 })).toBe(true);
    expect(isForbidden({ code: 404 })).toBe(false);
    expect(isForbidden({ code: 500 })).toBe(false);
    expect(isForbidden({ code: '403' })).toBe(false);
    expect(isForbidden(null)).toBe(false);
  });
});
