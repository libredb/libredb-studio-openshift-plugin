import { expect, test } from '@playwright/test';
import { ALL_PROJECTS, databasesPage, openDatabases, settled } from '../pages/console';
import { evidencePath, watchConsoleMessages } from '../support';

// Runs alone (project locator-removed) after the ConsoleLink libredb-studio is deleted, on the Helm path only.
test('the page says Studio is not set up when its console link is gone', async ({ page }) => {
  const check = watchConsoleMessages(page);
  await openDatabases(page, ALL_PROJECTS);
  const content = databasesPage(page);
  await expect(content.getByTestId('libredb-studio-header')).toContainText(
    'LibreDB Studio is not set up in this cluster',
  );
  await expect(content.locator('[data-test^="libredb-row-"]').first()).toBeVisible();
  // Each row checks access before an open control could show, so the absence counts only once every row settled.
  await settled(content);
  await expect(content.locator('[data-test^="libredb-open-"]')).toHaveCount(0);
  await page.screenshot({ path: evidencePath('locator-removed-os-admin.png') });
  check();
});
