import { expect, test } from '@playwright/test';
import { openDetailsItem } from '../pages/console';
import { evidencePath, LAB_DATABASES, watchConsoleMessages } from '../support';

const { orders, analytics, catalog } = LAB_DATABASES;

test('dev-a sees the open control on orders', { tag: '@dev-a' }, async ({ page }) => {
  const check = watchConsoleMessages(page);
  const item = await openDetailsItem(page, orders.path);
  await expect(item.getByTestId(`libredb-open-${orders.id}`)).toHaveText('Open in LibreDB Studio');
  await expect(item.getByTestId(`libredb-open-${orders.id}`)).toHaveAttribute(
    'aria-label',
    'Open team-a/orders in LibreDB Studio',
  );
  await page.screenshot({ path: evidencePath('details-dev-a-orders.png') });
  check();
});

test('dev-b sees one line per user of analytics', { tag: '@dev-b' }, async ({ page }) => {
  const check = watchConsoleMessages(page);
  const item = await openDetailsItem(page, analytics.path);
  // The resource as the console reads it, through the console's own API proxy with dev-b's session.
  const users = await page.evaluate(async (path) => {
    const response = await fetch(path);
    const resource = (await response.json()) as { spec?: { users?: { name: string }[] } };
    return (resource.spec?.users ?? []).map((user) => user.name);
  }, `/api/kubernetes/apis/postgres-operator.crunchydata.com/v1beta1/namespaces/${analytics.namespace}/postgresclusters/${analytics.name}`);
  expect(users).toContain(analytics.user);
  await expect(item.locator(':scope > div')).toHaveCount(users.length);
  for (const user of users) {
    await expect(item).toContainText(`Open as ${user} in LibreDB Studio`);
  }
  await page.screenshot({ path: evidencePath('details-dev-b-analytics.png') });
  check();
});

test(
  'os-admin sees the open control as appuser on catalog',
  { tag: '@os-admin' },
  async ({ page }) => {
    const check = watchConsoleMessages(page);
    const item = await openDetailsItem(page, catalog.path);
    await expect(item.getByTestId(`libredb-open-${catalog.id}`)).toHaveText(
      'Open as appuser in LibreDB Studio',
    );
    await page.screenshot({ path: evidencePath('details-os-admin-catalog.png') });
    check();
  },
);
