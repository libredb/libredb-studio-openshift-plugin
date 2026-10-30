import { expect, test } from '@playwright/test';
import { ALL_PROJECTS, databasesPage, openDatabases, settled } from '../pages/console';
import { evidencePath, LAB_DATABASES, type LabDatabase, watchConsoleMessages } from '../support';

const { orders, analytics, catalog } = LAB_DATABASES;
const ROWS = '[data-test^="libredb-row-"]';

test('dev-a sees orders in team-a with an open control', { tag: '@dev-a' }, async ({ page }) => {
  const check = watchConsoleMessages(page);
  await openDatabases(page, 'team-a');
  const content = databasesPage(page);
  await settled(content);
  const row = content.getByTestId(`libredb-row-${orders.id}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId(`libredb-open-${orders.id}`)).toHaveText('Open in LibreDB Studio');
  await page.screenshot({ path: evidencePath('databases-dev-a-team-a.png') });
  check();
});

test('dev-a sees analytics in team-b without the Secret', { tag: '@dev-a' }, async ({ page }) => {
  const check = watchConsoleMessages(page);
  await openDatabases(page, 'team-b');
  const content = databasesPage(page);
  await settled(content);
  const row = content.getByTestId(`libredb-row-${analytics.id}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(analytics.user);
  await expect(row.getByTestId(`libredb-reason-${analytics.id}`)).toContainText(analytics.secret);
  await expect(row.getByTestId(`libredb-open-${analytics.id}`)).toHaveCount(0);
  await page.screenshot({ path: evidencePath('databases-dev-a-team-b.png') });
  check();
});

test(
  'dev-a on all projects sees the list refusal and no rows',
  { tag: '@dev-a' },
  async ({ page }) => {
    const check = watchConsoleMessages(page);
    await openDatabases(page, ALL_PROJECTS);
    const content = databasesPage(page);
    const refusal = content.getByTestId('libredb-not-available-cnpg');
    await expect(refusal).toContainText('in all projects');
    await expect(refusal).toContainText('clusters.postgresql.cnpg.io');
    await settled(content);
    await expect(content.locator(ROWS)).toHaveCount(0);
    await page.screenshot({ path: evidencePath('databases-dev-a-all-projects.png') });
    check();
  },
);

test('dev-b opens analytics as analyst in team-b', { tag: '@dev-b' }, async ({ page }) => {
  const check = watchConsoleMessages(page);
  await openDatabases(page, 'team-b');
  const content = databasesPage(page);
  await settled(content);
  const open = content.getByTestId(`libredb-open-${analytics.id}`);
  await expect(open).toHaveText(`Open as ${analytics.user} in LibreDB Studio`);
  await page.screenshot({ path: evidencePath('databases-dev-b-team-b.png') });
  check();
});

test(
  'os-admin on all projects sees every lab database with an open control',
  { tag: '@os-admin' },
  async ({ page }) => {
    const check = watchConsoleMessages(page);
    await openDatabases(page, ALL_PROJECTS);
    const content = databasesPage(page);
    await settled(content);
    const databases: LabDatabase[] = [orders, analytics, catalog];
    for (const database of databases) {
      const row = content.getByTestId(`libredb-row-${database.id}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(database.namespace);
      await expect(row).toContainText(database.user ?? database.name);
      await expect(row.getByTestId(`libredb-open-${database.id}`)).toBeVisible();
    }
    await expect(content.locator('[data-test^="libredb-not-available-"]')).toHaveCount(0);
    await page.screenshot({ path: evidencePath('databases-os-admin-all-projects.png') });
    check();
  },
);
