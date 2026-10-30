import * as fs from 'fs';
import { expect, type Page, test } from '@playwright/test';
import {
  databasesPage,
  openDatabases,
  settled,
  signInToStudio,
  signOutOfStudio,
} from '../pages/console';
import { evidencePath, LAB_DATABASES, labUser, studioBase, watchConsoleMessages } from '../support';

const { orders } = LAB_DATABASES;
const ORDERS_SEED = `seed:${orders.id}`;
const UNKNOWN_SEED = 'seed:k8s-cnpg-00000000000000000000000000000000';

/** The ids of LibreDB Studio's managed connections, as the signed-in user of the page gets them. */
async function managedConnections(page: Page): Promise<{ status: number; ids: string[] }> {
  return page.evaluate(async () => {
    const response = await fetch('/api/connections/managed');
    const body = (await response.json()) as { connections?: { id: string }[] };
    return { status: response.status, ids: (body.connections ?? []).map((c) => c.id) };
  });
}

test(
  'dev-a opens orders in LibreDB Studio in a new tab',
  { tag: '@dev-a' },
  async ({ page, context }) => {
    const check = watchConsoleMessages(page);
    await openDatabases(page, orders.namespace);
    const content = databasesPage(page);
    await settled(content);
    const control = content.getByTestId(`libredb-open-${orders.id}`);
    await expect(control).toBeVisible();

    const studioHost = new URL(studioBase()).host;
    const documents: string[] = [];
    // A context listener sees the new tab's first navigation, which a listener on the new page attaches too late for.
    context.on('request', (request) => {
      if (request.resourceType() === 'document' && new URL(request.url()).host === studioHost) {
        documents.push(request.url());
      }
    });
    const consoleUrl = page.url();
    const newPage = context.waitForEvent('page');
    await control.click();
    const studio = await newPage;
    await expect.poll(() => documents.length).toBeGreaterThan(0);
    expect(documents[0]).toBe(`${studioBase()}/?connection=seed%3A${orders.id}`);
    expect(page.url()).toBe(consoleUrl);

    const user = labUser('dev-a');
    await signInToStudio(studio, user.username, user.password);
    // Checked once the tab stopped redirecting: noopener leaves the opener null across its navigations.
    expect(await studio.evaluate(() => window.opener)).toBeNull();
    const managed = await managedConnections(studio);
    expect(managed.status).toBe(200);
    expect(managed.ids).toContain(ORDERS_SEED);
    await studio.screenshot({ path: evidencePath('open-dev-a-studio.png') });
    fs.writeFileSync(
      evidencePath('open-dev-a.json'),
      `${JSON.stringify(
        {
          firstDocumentRequest: documents[0],
          openerIsNull: true,
          consoleUrlUnchanged: true,
          managedStatus: managed.status,
          managedIds: managed.ids,
        },
        null,
        2,
      )}\n`,
    );
    await signOutOfStudio(studio);
    check();
  },
);

test(
  'dev-b gets the not-found answer for orders by its link',
  { tag: '@dev-b' },
  async ({ page, browser }) => {
    // The orders id exists in this run: dev-a, who holds the connection, gets it listed. Without that, an empty
    // discovery would answer both ids with the same 404 and the comparison below would prove nothing.
    const granted = await browser.newContext({ ignoreHTTPSErrors: true });
    const grantedPage = await granted.newPage();
    await grantedPage.goto(studioBase());
    const devA = labUser('dev-a');
    await signInToStudio(grantedPage, devA.username, devA.password);
    const grantedManaged = await managedConnections(grantedPage);
    expect(grantedManaged.status).toBe(200);
    expect(grantedManaged.ids).toContain(ORDERS_SEED);
    await signOutOfStudio(grantedPage);
    await granted.close();

    await page.goto(`${studioBase()}/?connection=seed%3A${orders.id}`);
    const user = labUser('dev-b');
    await signInToStudio(page, user.username, user.password);
    const answers = await page.evaluate(
      async (ids) =>
        Promise.all(
          ids.map(async (connectionId) => {
            const response = await fetch('/api/db/query', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ connectionId, sql: 'SELECT 1' }),
            });
            return { status: response.status, body: await response.text() };
          }),
        ),
      [ORDERS_SEED, UNKNOWN_SEED],
    );
    const [ordersAnswer, unknownAnswer] = answers;
    expect(ordersAnswer.status).toBe(404);
    expect((JSON.parse(ordersAnswer.body) as { code?: string }).code).toBe('CONNECTION_NOT_FOUND');
    expect(unknownAnswer.status).toBe(404);
    expect(ordersAnswer.body).toBe(unknownAnswer.body);
    fs.writeFileSync(
      evidencePath('open-dev-b.json'),
      `${JSON.stringify(
        {
          grantedUser: {
            user: 'dev-a',
            managedStatus: grantedManaged.status,
            listsOrders: grantedManaged.ids.includes(ORDERS_SEED),
          },
          [ORDERS_SEED]: ordersAnswer,
          [UNKNOWN_SEED]: unknownAnswer,
        },
        null,
        2,
      )}\n`,
    );
    await signOutOfStudio(page);
  },
);
