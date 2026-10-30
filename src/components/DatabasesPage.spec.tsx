import { fireEvent, render, screen } from '@testing-library/react';
import { checkAccess } from '@openshift-console/dynamic-plugin-sdk';
import { ANALYST_ID, goldenResource, goldenRow, ORDERS_ID } from '../../tests/support/golden';
import { kindOf, manyUserRows } from '../../tests/support/rows';
import { databaseRows, type DatabaseRow } from '../contract/rows';
import { useDatabaseRows, type DatabaseRowsState } from '../hooks/useDatabaseRows';
import { useStudioLocator, type StudioLocator } from '../hooks/useStudioLocator';
import DatabasesPage from './DatabasesPage';

jest.mock('../hooks/useStudioLocator', () => ({ useStudioLocator: jest.fn() }));
jest.mock('../hooks/useDatabaseRows', () => ({ useDatabaseRows: jest.fn() }));

const locatorHook = jest.mocked(useStudioLocator);
const rowsHook = jest.mocked(useDatabaseRows);
const access = jest.mocked(checkAccess);

const READY: StudioLocator = {
  state: 'ready',
  base: 'https://studio.example.com',
  host: 'studio.example.com',
};
const CNPG = kindOf('cnpg');
const PGO = kindOf('pgo');
const orders = goldenRow(ORDERS_ID);

function state(overrides: Partial<DatabaseRowsState> = {}): DatabaseRowsState {
  return {
    namespace: 'team-a',
    kinds: [
      { kind: CNPG, loaded: true },
      { kind: PGO, loaded: true },
    ],
    rows: [],
    anyKindInstalled: true,
    loaded: true,
    ...overrides,
  };
}

function show(locator: StudioLocator, rows: DatabaseRowsState) {
  locatorHook.mockReturnValue(locator);
  rowsHook.mockReturnValue(rows);
  return render(<DatabasesPage />);
}

beforeEach(() => {
  locatorHook.mockReset();
  rowsHook.mockReset();
  access.mockReset();
  access.mockReturnValue(new Promise(() => undefined));
});

describe('DatabasesPage, the Studio header', () => {
  it("names Studio's host and the discovery rule when Studio is found", () => {
    show(READY, state({ rows: [orders] }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Databases');
    expect(screen.getByTestId('namespace-bar')).toBeInTheDocument();
    expect(screen.getByTestId('libredb-databases-page')).toBeInTheDocument();
    const header = screen.getByTestId('libredb-studio-header');
    expect(header).toHaveTextContent('Opens in LibreDB Studio at studio.example.com.');
    expect(header).toHaveTextContent(
      'Only databases in the namespaces your administrator chose for discovery open; any other one opens as not found.',
    );
  });

  it('says Studio is not set up when the console link is missing', () => {
    show({ state: 'missing' }, state({ rows: [orders] }));
    const header = screen.getByTestId('libredb-studio-header');
    expect(header).toHaveTextContent('LibreDB Studio is not set up in this cluster');
    expect(header).toHaveTextContent(
      'A cluster administrator installs LibreDB Studio with Kubernetes discovery and its console link; this page finds Studio through the console link named libredb-studio.',
    );
    expect(screen.getByTestId(`libredb-reason-${ORDERS_ID}`)).toHaveTextContent(
      'LibreDB Studio is not set up in this cluster',
    );
  });

  it.each([[{ state: 'forbidden' } as const], [{ state: 'error' } as const]])(
    'says the console link cannot be read for %j',
    (locator) => {
      show(locator, state());
      expect(screen.getByTestId('libredb-studio-header')).toHaveTextContent(
        'This page cannot read the console link that locates LibreDB Studio.',
      );
    },
  );

  it('refuses to open anything when more than one console link is listed', () => {
    show({ state: 'ambiguous' }, state({ rows: [orders] }));
    expect(screen.getByTestId('libredb-studio-header')).toHaveTextContent(
      'More than one console link named libredb-studio is listed, so this page opens nothing in LibreDB Studio.',
    );
    expect(screen.getByTestId(`libredb-reason-${ORDERS_ID}`)).toHaveTextContent(
      'LibreDB Studio is not set up in this cluster',
    );
    expect(screen.queryByTestId(`libredb-open-${ORDERS_ID}`)).toBeNull();
  });

  it('waits for the console link before it shows rows', () => {
    show({ state: 'loading' }, state({ rows: [orders] }));
    expect(screen.queryByTestId('libredb-studio-header')).toBeNull();
    expect(screen.queryByTestId(`libredb-row-${ORDERS_ID}`)).toBeNull();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});

describe('DatabasesPage, the list', () => {
  it('refuses a kind the user cannot list in all projects and keeps the other rows', () => {
    show(
      READY,
      state({
        namespace: undefined,
        kinds: [
          { kind: CNPG, loaded: true },
          { kind: PGO, loaded: true, error: 'forbidden' },
        ],
        rows: [orders],
      }),
    );
    expect(screen.getByTestId('libredb-not-available-pgo')).toHaveTextContent(
      'You cannot list Crunchy PGO resources (postgresclusters.postgres-operator.crunchydata.com) in all projects. Choose a project above.',
    );
    expect(screen.queryByTestId('libredb-not-available-cnpg')).toBeNull();
    expect(screen.getByTestId(`libredb-row-${ORDERS_ID}`)).toBeInTheDocument();
  });

  it('names the project a kind cannot be listed in', () => {
    show(
      READY,
      state({ namespace: 'team-b', kinds: [{ kind: PGO, loaded: true, error: 'forbidden' }] }),
    );
    expect(screen.getByTestId('libredb-not-available-pgo')).toHaveTextContent(
      'You cannot list Crunchy PGO resources (postgresclusters.postgres-operator.crunchydata.com) in the project team-b.',
    );
    expect(screen.queryByText(/No databases in/)).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('says a kind could not be listed', () => {
    show(READY, state({ kinds: [{ kind: CNPG, loaded: true, error: 'failed' }] }));
    expect(screen.getByTestId('libredb-not-available-cnpg')).toHaveTextContent(
      'LibreDB Studio could not list CloudNativePG resources.',
    );
  });

  it('names the supported operators when none is installed', () => {
    show(READY, state({ kinds: [], anyKindInstalled: false }));
    expect(
      screen.getByText(
        'No supported database operator is installed in this cluster: CloudNativePG, EDB Postgres for Kubernetes, Crunchy PGO or MongoDB Community.',
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ['team-a', 'No databases in team-a.'],
    [undefined, 'No databases in all projects.'],
  ])('says the scope %s has no databases', (namespace, text) => {
    show(READY, state({ namespace }));
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows progress while the list loads', () => {
    show(READY, state({ loaded: false, kinds: [{ kind: CNPG, loaded: false }] }));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText(/No databases in/)).toBeNull();
  });

  it('shows a row per database with its users', () => {
    const analytics = databaseRows(PGO, goldenResource(ANALYST_ID));
    show(READY, state({ rows: [orders, ...analytics] }));
    for (const row of [orders, ...analytics]) {
      expect(screen.getByTestId(`libredb-row-${row.connectionId}`)).toBeInTheDocument();
    }
    expect(analytics.map((row) => row.user)).toEqual(['analyst', 'reporter']);
    expect(screen.getByText('analyst')).toBeInTheDocument();
    expect(screen.getByText('reporter')).toBeInTheDocument();
  });

  it('returns to page 1 when the project changes', () => {
    const rows: DatabaseRow[] = manyUserRows('team-a', 'pg', 120);
    const view = show(READY, state({ rows }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Go to next page' })[0]);
    expect(screen.getByTestId(`libredb-row-${rows[50].connectionId}`)).toBeInTheDocument();

    const others = manyUserRows('team-b', 'pg', 120);
    rowsHook.mockReturnValue(state({ namespace: 'team-b', rows: others }));
    access.mockClear();
    view.rerender(<DatabasesPage />);
    expect(screen.getByTestId(`libredb-row-${others[0].connectionId}`)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^libredb-row-/)).toHaveLength(50);
    expect(access).toHaveBeenCalledTimes(50);
  });
});
