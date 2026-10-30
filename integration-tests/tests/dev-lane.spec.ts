import { expect, test } from '@playwright/test';
import {
  databasesPage,
  homeDatabasesNav,
  openDatabases,
  settled,
  useAdministratorPerspective,
} from '../pages/console';
import { evidencePath, LAB_DATABASES, watchConsoleMessages } from '../support';

const { orders } = LAB_DATABASES;

// The development console of scripts/e2e/run-dev-lane.sh: sign-in disabled, acting as a ServiceAccount that holds
// view in team-a only, so it may read the orders Cluster but never its Secret. E2E_DEV_LANE_LOCATOR says whether the
// cluster holds the locator ConsoleLink, which run-dev-lane.sh reads before the run.
const EXPECTED = {
  absent: {
    header: 'LibreDB Studio is not set up in this cluster',
    reason: 'LibreDB Studio is not set up in this cluster',
  },
  present: {
    header: 'Opens in LibreDB Studio at',
    reason: `You cannot read the credential Secret ${orders.secret}`,
  },
};

test('the development console renders the plugin', async ({ page }) => {
  const locator = process.env.E2E_DEV_LANE_LOCATOR;
  expect(['present', 'absent']).toContain(locator);
  const check = watchConsoleMessages(page);
  await useAdministratorPerspective(page);
  await openDatabases(page, orders.namespace);
  await expect(homeDatabasesNav(page)).toHaveCount(1);

  const content = databasesPage(page);
  const header = content.getByTestId('libredb-studio-header');
  const reason = content.getByTestId(`libredb-reason-${orders.id}`);
  await settled(content);
  const expected = EXPECTED[locator as keyof typeof EXPECTED];
  await expect(header).toContainText(expected.header);
  await expect(reason).toContainText(expected.reason);
  await expect(content.locator('[data-test^="libredb-open-"]')).toHaveCount(0);
  await page.screenshot({ path: evidencePath('dev-lane-team-a.png') });
  check();
});
