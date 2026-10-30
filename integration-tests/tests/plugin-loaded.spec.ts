import { expect, test } from '@playwright/test';
import { homeDatabasesNav } from '../pages/console';
import { evidencePath, runLog, waitForPlugin, watchConsoleMessages } from '../support';

test('the console loads and enables the plugin', { tag: '@os-admin' }, async ({ page }) => {
  const check = watchConsoleMessages(page);
  await page.goto('/k8s/cluster/operator.openshift.io~v1~Console/cluster/console-plugins');
  await waitForPlugin(page);

  const table = page.locator('table').filter({ hasText: 'libredb-studio' });
  await expect(table).toHaveCount(1);
  const headers = await table.locator('tr').first().locator('th, td').allInnerTexts();
  const row = table.locator('tr').filter({ hasText: 'libredb-studio' });
  await expect(row).toHaveCount(1);
  const cells = await row.locator('td, th').allInnerTexts();
  const columns = Object.fromEntries(
    headers.map((header, index) => [header.trim(), cells[index]?.trim()]),
  );
  expect(columns).toMatchObject({ Name: 'libredb-studio', Status: 'Loaded', Enabled: 'Enabled' });
  runLog(`console plugins row: ${JSON.stringify(columns)}`);
  await page.screenshot({ path: evidencePath('plugin-loaded-console-plugins.png') });

  await expect(homeDatabasesNav(page)).toHaveCount(1);
  await expect(homeDatabasesNav(page)).toHaveText('Databases');
  check();
});
