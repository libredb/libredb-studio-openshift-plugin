import { fireEvent, render, screen } from '@testing-library/react';
import { checkAccess, type K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';
import { ANALYST_ID, goldenResource, ORDERS_ID, REPORTER_ID } from '../../tests/support/golden';
import { kindOf } from '../../tests/support/rows';
import { databaseRows } from '../contract/rows';
import { useStudioLocator, type StudioLocator } from '../hooks/useStudioLocator';
import DatabaseDetailsItem from './DatabaseDetailsItem';

jest.mock('../hooks/useStudioLocator', () => ({ useStudioLocator: jest.fn() }));

const locatorHook = jest.mocked(useStudioLocator);
const access = jest.mocked(checkAccess);

const READY: StudioLocator = {
  state: 'ready',
  base: 'https://studio.example.com',
  host: 'studio.example.com',
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const ITEM = 'libredb-details-item';
const MORE = (total: number) =>
  `This resource has ${total} database users; the first 20 are shown here and the Databases page lists all of them.`;

const mongo = (users: Record<string, unknown>[]): K8sResourceCommon =>
  ({
    apiVersion: 'mongodbcommunity.mongodb.com/v1',
    kind: 'MongoDBCommunity',
    metadata: { namespace: 'team-m', name: 'catalog' },
    spec: { users },
  }) as K8sResourceCommon;

const postgresCluster = (count: number): K8sResourceCommon =>
  ({
    apiVersion: 'postgres-operator.crunchydata.com/v1beta1',
    kind: 'PostgresCluster',
    metadata: { namespace: 'team-a', name: 'pg' },
    spec: {
      users: Array.from({ length: count }, (_value, index) => ({
        name: `user-${String(index).padStart(3, '0')}`,
        databases: ['app'],
      })),
    },
  }) as K8sResourceCommon;

function show(obj: unknown, locator: StudioLocator = READY) {
  locatorHook.mockReturnValue(locator);
  return render(<DatabaseDetailsItem obj={obj as K8sResourceCommon} />);
}

let open: jest.SpyInstance;

beforeEach(() => {
  locatorHook.mockReset();
  access.mockReset();
  access.mockResolvedValue({ status: { allowed: true } } as never);
  open = jest.spyOn(window, 'open').mockReturnValue(null);
});

afterEach(() => {
  open.mockRestore();
});

describe('DatabaseDetailsItem on a supported resource', () => {
  it('shows one open control for the golden orders Cluster', async () => {
    show(goldenResource(ORDERS_ID));
    const button = await screen.findByTestId(`libredb-open-${ORDERS_ID}`);
    expect(screen.getByTestId(ITEM)).toContainElement(button);
    expect(screen.getAllByRole('button')).toEqual([button]);
    expect(button).toHaveTextContent('Open in LibreDB Studio');
    expect(button).toHaveAttribute('aria-label', 'Open team-a/orders in LibreDB Studio');
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith(
      `https://studio.example.com/?connection=seed%3A${ORDERS_ID}`,
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('shows one line per database user of the golden analytics PostgresCluster', async () => {
    show(goldenResource(ANALYST_ID));
    const buttons = await screen.findAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Open as analyst in LibreDB Studio',
      'Open as reporter in LibreDB Studio',
    ]);
    expect(buttons.map((button) => button.getAttribute('data-test'))).toEqual([
      `libredb-open-${ANALYST_ID}`,
      `libredb-open-${REPORTER_ID}`,
    ]);
    expect(screen.queryByText(/database users; the first 20/)).toBeNull();
  });

  it('gives the reason a MongoDB user with its Secret in another namespace does not open', () => {
    show(mongo([{ name: 'app', db: 'admin', connectionStringSecretNamespace: 'other' }]));
    expect(screen.getByTestId(ITEM)).toHaveTextContent(
      'The user app keeps its connection string Secret in another namespace, which LibreDB Studio does not read.',
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(access).not.toHaveBeenCalled();
  });

  it('refuses both users of one resource that share a connection id', () => {
    const obj = mongo([
      { name: 'app', db: 'a' },
      { name: 'app', db: 'b' },
    ]);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      show(obj);
      expect(
        screen.getAllByText(
          'Two database users share this connection id, so LibreDB Studio lists neither.',
        ),
      ).toHaveLength(2);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('shows a hostile user name as text only', async () => {
    show(mongo([{ name: HOSTILE, connectionStringSecretName: 'catalog-app' }]));
    const button = await screen.findByRole('button');
    expect(button.textContent).toBe(`Open as ${HOSTILE} in LibreDB Studio`);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('DatabaseDetailsItem with many database users', () => {
  it('shows the first 20 users in user order, reviews 20 Secrets and says how many there are', async () => {
    const obj = postgresCluster(25);
    const rows = databaseRows(kindOf('pgo'), obj);
    show(obj);
    const buttons = await screen.findAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('data-test'))).toEqual(
      rows.slice(0, 20).map((row) => `libredb-open-${row.connectionId}`),
    );
    expect(buttons[0]).toHaveTextContent('Open as user-000 in LibreDB Studio');
    expect(buttons[19]).toHaveTextContent('Open as user-019 in LibreDB Studio');
    expect(access).toHaveBeenCalledTimes(20);
    const sentence = screen.getByText(MORE(25));
    expect(screen.getByTestId(ITEM)).toContainElement(sentence);
    expect(
      buttons[19].compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('marks a duplicate among all users before it keeps the first 20 lines', async () => {
    const users = [
      { name: 'app', db: 'a' },
      ...Array.from({ length: 19 }, (_value, index) => ({ name: `user-${index}` })),
      { name: 'app', db: 'b' },
    ];
    show(mongo(users));
    const buttons = await screen.findAllByRole('button');
    expect(buttons).toHaveLength(19);
    expect(access).toHaveBeenCalledTimes(19);
    const reason = screen.getByText(
      'Two database users share this connection id, so LibreDB Studio lists neither.',
    );
    expect(
      reason.compareDocumentPosition(buttons[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const sentence = screen.getByText(MORE(21));
    expect(
      buttons[18].compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('adds no sentence while LibreDB Studio is not set up, whatever the number of users', () => {
    show(postgresCluster(25), { state: 'missing' });
    expect(screen.getByTestId(ITEM)).toHaveTextContent(
      'LibreDB Studio is not set up in this cluster',
    );
    expect(screen.queryByText(/database users; the first 20/)).toBeNull();
    expect(access).not.toHaveBeenCalled();
  });

  it('adds no sentence for exactly 20 users', async () => {
    show(postgresCluster(20));
    expect(await screen.findAllByRole('button')).toHaveLength(20);
    expect(access).toHaveBeenCalledTimes(20);
    expect(screen.queryByText(/database users; the first 20/)).toBeNull();
  });
});

describe('DatabaseDetailsItem without a line to show', () => {
  it('renders nothing for a resource of an unsupported kind', () => {
    const { container } = show({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { namespace: 'team-a', name: 'orders' },
    });
    expect(container).toBeEmptyDOMElement();
    expect(locatorHook).toHaveBeenCalled();
  });

  it('renders nothing for a supported resource that lists no database', () => {
    const { container } = show(mongo([]));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('DatabaseDetailsItem before LibreDB Studio is found', () => {
  it('says Studio is not set up and offers no control when the console link is missing', () => {
    show(goldenResource(ANALYST_ID), { state: 'missing' });
    expect(screen.getByTestId(ITEM)).toHaveTextContent(
      'LibreDB Studio is not set up in this cluster',
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(access).not.toHaveBeenCalled();
  });

  it('opens nothing when more than one console link is listed', () => {
    show(goldenResource(ORDERS_ID), { state: 'ambiguous' });
    expect(screen.getByTestId(ITEM)).toHaveTextContent(
      'More than one console link named libredb-studio is listed, so this page opens nothing in LibreDB Studio.',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([[{ state: 'forbidden' } as const], [{ state: 'error' } as const]])(
    'says the console link cannot be read for %j',
    (locator) => {
      show(goldenResource(ORDERS_ID), locator);
      expect(screen.getByTestId(ITEM)).toHaveTextContent(
        'This page cannot read the console link that locates LibreDB Studio.',
      );
      expect(screen.queryByRole('button')).toBeNull();
      expect(access).not.toHaveBeenCalled();
    },
  );

  it('waits for the console link without reviewing any Secret', () => {
    show(goldenResource(ORDERS_ID), { state: 'loading' });
    expect(screen.getByTestId(ITEM)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(access).not.toHaveBeenCalled();
  });
});
