import { fireEvent, render, screen } from '@testing-library/react';
import { goldenRow, ANALYST_ID, ORDERS_ID } from '../../tests/support/golden';
import { KIND_ROWS, type KindRow } from '../contract/kinds';
import { databaseRows, type DatabaseRow } from '../contract/rows';
import { useRowAccess, type RowAccess } from '../hooks/useRowAccess';
import type { StudioLocator } from '../hooks/useStudioLocator';
import { OpenInStudio } from './OpenInStudio';

jest.mock('../hooks/useRowAccess', () => ({ useRowAccess: jest.fn() }));
const rowAccess = jest.mocked(useRowAccess);

const READY: StudioLocator = {
  state: 'ready',
  base: 'https://studio.example.com',
  host: 'studio.example.com',
};
const kind = (slug: KindRow['slug']) => KIND_ROWS.find((row) => row.slug === slug) as KindRow;
const orders = goldenRow(ORDERS_ID);
const analyst = goldenRow(ANALYST_ID);
const HOSTILE = '<img src=x onerror=alert(1)>';

const mongoRow = (user: Record<string, unknown>): DatabaseRow =>
  databaseRows(kind('mongo'), {
    metadata: { namespace: 'team-m', name: 'catalog' },
    spec: { users: [user] },
  })[0];

function show(row: DatabaseRow, access: RowAccess, locator: StudioLocator = READY) {
  rowAccess.mockReturnValue(access);
  return render(<OpenInStudio row={row} locator={locator} />);
}

let open: jest.SpyInstance;

beforeEach(() => {
  rowAccess.mockReset();
  open = jest.spyOn(window, 'open').mockReturnValue(null);
});

afterEach(() => {
  open.mockRestore();
});

describe('OpenInStudio when the user may read the Secret', () => {
  it('opens the golden link in a new tab with no opener and no referrer', () => {
    show(orders, 'allowed');
    expect(rowAccess).toHaveBeenCalledWith(orders);
    const button = screen.getByRole('button', { name: 'Open team-a/orders in LibreDB Studio' });
    expect(button).toHaveTextContent('Open in LibreDB Studio');
    expect(button).toHaveAttribute('data-test', `libredb-open-${ORDERS_ID}`);
    expect(button).not.toHaveAttribute('href');
    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]).toEqual([
      'https://studio.example.com/?connection=seed%3Ak8s-cnpg-75c1a60b898072af828207cff435c7e5',
      '_blank',
      'noopener,noreferrer',
    ]);
  });

  it('names the database user of a per-user row', () => {
    show(analyst, 'allowed');
    const button = screen.getByTestId(`libredb-open-${ANALYST_ID}`);
    expect(button).toHaveTextContent('Open as analyst in LibreDB Studio');
    expect(button).toHaveAttribute(
      'aria-label',
      'Open team-b/analytics in LibreDB Studio as analyst',
    );
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith(
      `https://studio.example.com/?connection=seed%3A${ANALYST_ID}`,
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('opens under the base path Studio is served at', () => {
    show(orders, 'allowed', {
      state: 'ready',
      base: 'https://tools.example.com/studio',
      host: 'tools.example.com',
    });
    fireEvent.click(screen.getByRole('button'));
    expect(open).toHaveBeenCalledWith(
      `https://tools.example.com/studio/?connection=seed%3A${ORDERS_ID}`,
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('shows a hostile user name as text only', () => {
    const row = mongoRow({ name: HOSTILE, connectionStringSecretName: 'catalog-app' });
    show(row, 'allowed');
    const button = screen.getByTestId(`libredb-open-${row.connectionId}`);
    expect(button.textContent).toBe(`Open as ${HOSTILE} in LibreDB Studio`);
    expect(button).toHaveAttribute(
      'aria-label',
      `Open team-m/catalog in LibreDB Studio as ${HOSTILE}`,
    );
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('OpenInStudio when it does not open', () => {
  const reason = (row: DatabaseRow) => screen.getByTestId(`libredb-reason-${row.connectionId}`);

  it.each([
    ['checking' as const, 'Checking access'],
    [
      'denied' as const,
      'You cannot read the credential Secret orders-app, so LibreDB Studio does not open this database for you.',
    ],
    ['unknown' as const, 'Your access could not be checked. Reload the page to try again.'],
    ['skipped' as const, 'Your access could not be checked. Reload the page to try again.'],
  ])('shows the %s reason and no button', (access, text) => {
    show(orders, access);
    expect(reason(orders).textContent).toBe(text);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    [
      'no_database',
      databaseRows(kind('pgo'), {
        metadata: { namespace: 'team-b', name: 'metrics' },
        spec: { users: [{ name: 'metrics' }] },
      })[0],
      'The user metrics lists no database, so LibreDB Studio does not list it.',
    ],
    [
      'other_namespace',
      mongoRow({ name: 'app', connectionStringSecretNamespace: 'vault' }),
      'The user app keeps its connection string Secret in another namespace, which LibreDB Studio does not read.',
    ],
    [
      'unsupported_name',
      mongoRow({ name: 'App_User' }),
      "Set connectionStringSecretName on the user App_User: its Secret name needs MongoDB's name normalization, which LibreDB Studio does not compute.",
    ],
    [
      'duplicate_id',
      { ...orders, precheck: 'duplicate_id' as const },
      'Two database users share this connection id, so LibreDB Studio lists neither.',
    ],
  ])('shows the %s reason whatever the review says', (precheck, row, text) => {
    expect(row.precheck).toBe(precheck);
    show(row, 'allowed');
    expect(reason(row).textContent).toBe(text);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a hostile user name in a reason as text only', () => {
    const row = mongoRow({ name: HOSTILE });
    expect(row.precheck).toBe('unsupported_name');
    show(row, 'skipped');
    expect(reason(row).textContent).toContain(`on the user ${HOSTILE}:`);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it.each([
    [{ state: 'loading' } as const],
    [{ state: 'missing' } as const],
    [{ state: 'forbidden' } as const],
    [{ state: 'error' } as const],
  ])('says Studio is not set up for the locator %j', (locator) => {
    show(orders, 'allowed', locator);
    expect(reason(orders).textContent).toBe('LibreDB Studio is not set up in this cluster');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
