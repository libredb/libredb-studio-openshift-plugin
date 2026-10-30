import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { checkAccess } from '@openshift-console/dynamic-plugin-sdk';
import {
  ANALYST_ID,
  goldenResource,
  goldenRow,
  ORDERS_ID,
  REPORTER_ID,
} from '../../tests/support/golden';
import { kindOf, manyUserRows } from '../../tests/support/rows';
import { databaseRows, markDuplicateIds } from '../contract/rows';
import type { StudioLocator } from '../hooks/useStudioLocator';
import { DatabaseTable } from './DatabaseTable';

const access = jest.mocked(checkAccess);
const READY: StudioLocator = {
  state: 'ready',
  base: 'https://studio.example.com',
  host: 'studio.example.com',
};

beforeEach(() => {
  access.mockReset();
  access.mockReturnValue(new Promise(() => undefined));
});

/** The Secret names the access reviews asked about, in call order. */
const reviewed = () => access.mock.calls.map(([attributes]) => attributes.name);

describe('DatabaseTable', () => {
  it('shows the six columns of each row', async () => {
    const orders = { ...goldenRow(ORDERS_ID), phase: 'Cluster in healthy state' };
    const analytics = databaseRows(kindOf('pgo'), goldenResource(ANALYST_ID));
    access.mockResolvedValue({ status: { allowed: true } } as never);
    render(<DatabaseTable rows={[orders, ...analytics]} locator={READY} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Name',
      'Namespace',
      'Engine',
      'Database user',
      'Status',
      'LibreDB Studio',
    ]);
    const cells = (id: string) =>
      within(screen.getByTestId(`libredb-row-${id}`))
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells(ORDERS_ID)).toEqual([
      'orders',
      'team-a',
      'CloudNativePG',
      '',
      'Cluster in healthy state',
      'Open in LibreDB Studio',
    ]);
    expect(cells(ANALYST_ID)).toEqual([
      'analytics',
      'team-b',
      'Crunchy PGO',
      'analyst',
      '',
      'Open as analyst in LibreDB Studio',
    ]);
    expect(cells(REPORTER_ID)[3]).toBe('reporter');
    const link = within(screen.getByTestId(`libredb-row-${ORDERS_ID}`)).getByTestId(
      'resource-link',
    );
    expect(link).toHaveAttribute('data-kind', 'postgresql.cnpg.io~Cluster');
    expect(link).toHaveAttribute('data-namespace', 'team-a');
  });

  it('pages 50 rows at a time and reviews only the rows on the page', () => {
    const rows = manyUserRows('team-a', 'pg', 120);
    render(<DatabaseTable rows={rows} locator={READY} />);
    expect(screen.getAllByTestId(/^libredb-row-/)).toHaveLength(50);
    expect(reviewed()).toEqual(rows.slice(0, 50).map((row) => row.secretName));

    access.mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: 'Go to next page' })[0]);
    expect(screen.getAllByTestId(/^libredb-row-/)).toHaveLength(50);
    expect(screen.getByTestId(`libredb-row-${rows[50].connectionId}`)).toBeInTheDocument();
    expect(reviewed()).toEqual(rows.slice(50, 100).map((row) => row.secretName));

    access.mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: 'Go to next page' })[0]);
    expect(screen.getAllByTestId(/^libredb-row-/)).toHaveLength(20);
    expect(reviewed()).toEqual(rows.slice(100).map((row) => row.secretName));
  });

  it('offers 20 and 50 rows per page, never more, and returns to page 1 on a change', () => {
    const rows = manyUserRows('team-a', 'pg', 120);
    render(<DatabaseTable rows={rows} locator={READY} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Go to next page' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /1 - 50|51 - 100/ })[0]);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      '20 per page',
      '50 per page',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: '20 per page' }));
    expect(screen.getAllByTestId(/^libredb-row-/)).toHaveLength(20);
    expect(screen.getByTestId(`libredb-row-${rows[0].connectionId}`)).toBeInTheDocument();
  });

  it('stays on the last page that exists when rows go away', () => {
    const rows = manyUserRows('team-a', 'pg', 120);
    const view = render(<DatabaseTable rows={rows} locator={READY} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Go to next page' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Go to next page' })[0]);
    view.rerender(<DatabaseTable rows={rows.slice(0, 60)} locator={READY} />);
    expect(screen.getAllByTestId(/^libredb-row-/)).toHaveLength(10);
    expect(screen.getByTestId(`libredb-row-${rows[59].connectionId}`)).toBeInTheDocument();
  });

  it('refuses both rows of a shared id, renders each once and warns of no duplicate key', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const shared = markDuplicateIds(
        databaseRows(kindOf('mongo'), {
          metadata: { namespace: 'team-m', name: 'catalog' },
          spec: {
            users: [
              { name: 'app', db: 'a' },
              { name: 'app', db: 'b' },
            ],
          },
        }),
      );
      render(<DatabaseTable rows={shared} locator={READY} />);
      const id = shared[0].connectionId;
      expect(screen.getAllByTestId(`libredb-row-${id}`)).toHaveLength(2);
      expect(screen.getAllByTestId(`libredb-reason-${id}`).map((cell) => cell.textContent)).toEqual(
        [
          'Two database users share this connection id, so LibreDB Studio lists neither.',
          'Two database users share this connection id, so LibreDB Studio lists neither.',
        ],
      );
      expect(screen.queryByRole('button', { name: /in LibreDB Studio/ })).toBeNull();
      expect(access).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
