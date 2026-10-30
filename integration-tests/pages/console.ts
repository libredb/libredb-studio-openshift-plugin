import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { DATABASES_NAV, runLog, studioBase, waitForPlugin } from '../support/lab';
import { skipTour, submitOpenShiftLogin } from './login';

/** The console's project selector value for every project. */
export const ALL_PROJECTS = 'All Projects';

const NAMESPACE_BAR = '[data-test-id="namespace-bar-dropdown"]';

/** The Databases page's content: the Studio header, the refusals and the table. */
export function databasesPage(page: Page): Locator {
  return page.getByTestId('libredb-databases-page');
}

/**
 * Waits until the page or item stopped loading (no spinner, which shows while the locator or the lists load) and no
 * open control is still checking access.
 */
export async function settled(scope: Locator) {
  await expect(scope.getByRole('progressbar')).toHaveCount(0);
  await expect(scope.getByText('Checking access', { exact: true })).toHaveCount(0);
}

/** Chooses a project in the console's project selector, the way a user does. */
export async function selectProject(page: Page, project: string) {
  await page.locator(`${NAMESPACE_BAR} button`).first().click();
  await page.getByTestId('dropdown-text-filter').fill(project);
  await page
    .getByTestId('namespace-dropdown-menu')
    .getByRole('menuitem', { name: project, exact: true })
    .click();
  await expect(page.locator(NAMESPACE_BAR)).toHaveText(`Project: ${project}`);
}

/** The administrator perspective's name: Administrator up to 4.21, Core platform from 4.22. */
const ADMIN_PERSPECTIVE = /^(Administrator|Core platform)$/;

/**
 * Switches the console to the administrator perspective, whose Home section holds the Databases nav item. A user the
 * console takes for a developer, such as the development lane's view-only ServiceAccount, starts in Developer.
 */
export async function useAdministratorPerspective(page: Page) {
  await page.goto('/');
  const toggle = page.locator('[data-test-id="perspective-switcher-toggle"]');
  await toggle.waitFor({ state: 'visible', timeout: 60_000 });
  await skipTour(page);
  if (!ADMIN_PERSPECTIVE.test((await toggle.innerText()).trim())) {
    await toggle.click();
    await page
      .getByRole('menuitem')
      .or(page.getByRole('option'))
      .filter({ hasText: ADMIN_PERSPECTIVE })
      .click();
  }
  await expect(toggle).toHaveText(ADMIN_PERSPECTIVE);
  // Each perspective has its own welcome tour.
  await skipTour(page);
}

/**
 * Opens the Databases page for a project, or for all projects: the console's project selector offers All Projects
 * only to a user who may list projects, so all projects is reached through an all-namespaces page and the Databases
 * nav item, as a user who follows a link there does. Waits for the plugin on the first load (R-44) and records a
 * reload in the run log.
 */
export async function openDatabases(page: Page, project: string): Promise<{ reloaded: boolean }> {
  let loaded: { reloaded: boolean };
  if (project === ALL_PROJECTS) {
    await page.goto('/k8s/all-namespaces/core~v1~Pod');
    loaded = await waitForPlugin(page);
    // The nav item sits in the Home section, which may be collapsed; a click event navigates either way.
    await page.locator(DATABASES_NAV).first().dispatchEvent('click');
    await expect(page.locator(NAMESPACE_BAR)).toHaveText(`Project: ${ALL_PROJECTS}`);
  } else {
    await page.goto('/libredb-studio/databases');
    loaded = await waitForPlugin(page);
    await selectProject(page, project);
  }
  await expect(page).toHaveURL(/\/libredb-studio\/databases$/);
  await expect(databasesPage(page)).toBeVisible();
  await expect(databasesPage(page).getByTestId('libredb-studio-header')).toBeVisible();
  return loaded;
}

/**
 * Reloads the Databases page in the project it shows, so the page's access reviews start again: the SDK keeps their
 * answers until a reload.
 */
export async function reloadDatabases(page: Page, project: string) {
  await page.reload();
  await waitForPlugin(page);
  await expect(page.locator(NAMESPACE_BAR)).toHaveText(`Project: ${project}`);
  await expect(databasesPage(page).getByTestId('libredb-studio-header')).toBeVisible();
}

/** The Databases nav item inside the Home section of the administrator perspective's navigation. */
export function homeDatabasesNav(page: Page): Locator {
  return page
    .locator('[data-test-id="admin-perspective-nav"] li[data-test="nav"]', {
      has: page.getByRole('button', { name: 'Home', exact: true }),
    })
    .locator(DATABASES_NAV);
}

/** Opens a resource's generic details page and returns the LibreDB Studio item once its lines settled. */
export async function openDetailsItem(page: Page, path: string): Promise<Locator> {
  await page.goto(path);
  await waitForPlugin(page);
  const item = page.getByTestId('libredb-details-item');
  await expect(item).toBeVisible({ timeout: 60_000 });
  await settled(item);
  await expect(
    item.locator('[data-test^="libredb-open-"], [data-test^="libredb-reason-"]').first(),
  ).toBeVisible();
  return item;
}

/**
 * Signs in to LibreDB Studio through the cluster's OAuth login page the browser was sent to, allows the Authorize
 * Access page when the user meets it for the first time, and waits for Studio to know the user.
 */
export async function signInToStudio(page: Page, username: string, password: string) {
  await page.waitForURL((url) => url.pathname === '/login' && url.host.startsWith('oauth-'), {
    timeout: 60_000,
  });
  await submitOpenShiftLogin(page, username, password);
  const studio = new URL(studioBase());
  const approve = page.locator('input[name="approve"]');
  await page.waitForURL((url) => url.host === studio.host || url.pathname.endsWith('/authorize'), {
    timeout: 60_000,
  });
  if (await approve.isVisible()) {
    runLog(`${username} allowed the Authorize Access page for LibreDB Studio`);
    await approve.click();
  }
  await page.waitForURL((url) => url.host === studio.host, { timeout: 60_000 });
  await expect
    .poll(() => page.evaluate(async () => (await fetch('/api/auth/me')).status))
    .toBe(200);
}

/** Ends the LibreDB Studio session of the page (Studio's sign-out; the OAuth token is deleted by run-crc.sh). */
export async function signOutOfStudio(page: Page) {
  const status = await page.evaluate(
    async () => (await fetch('/api/auth/logout', { method: 'POST' })).status,
  );
  expect(status).toBeLessThan(400);
}
