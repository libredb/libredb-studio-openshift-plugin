import type { Locator, Page } from '@playwright/test';

declare global {
  interface Window {
    SERVER_FLAGS?: {
      authDisabled?: boolean;
    };
  }
}

// Fill a field via CDP to avoid exposing the value in Playwright traces
// https://github.com/microsoft/playwright/issues/19992#issuecomment-4078945450
async function fillSensitive(page: Page, locator: Locator, text: string) {
  await locator.focus();
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    commands: ['selectAll'],
  });
  await cdpSession.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a' });
  await cdpSession.send('Input.insertText', { text });
  await cdpSession.detach();
}

/**
 * Signs in on the cluster's OAuth login page the browser is on: picks the identity provider E2E_IDENTITY_PROVIDER
 * names when the page offers a choice, types the user name and, by CDP, the password, and submits.
 */
export async function submitOpenShiftLogin(page: Page, username: string, password: string) {
  const usernameField = page.locator('#inputUsername');
  const provider = process.env.E2E_IDENTITY_PROVIDER;
  if (provider !== undefined && provider !== '') {
    const chooser = page.getByRole('link', { name: provider, exact: true });
    await usernameField.or(chooser).first().waitFor({ state: 'visible', timeout: 60_000 });
    if (await chooser.isVisible()) {
      await chooser.click();
    }
  }
  await usernameField.waitFor({ state: 'visible', timeout: 60_000 });
  await usernameField.fill(username);
  await fillSensitive(page, page.locator('#inputPassword'), password);
  await page.locator('button[type=submit]').click();
}

/** Dismisses the console's welcome tour when it shows; it shows until a user dismisses it once. */
export async function skipTour(page: Page) {
  const skip = page.getByTestId('tour-step-footer-secondary').filter({ hasText: 'Skip tour' });
  try {
    await skip.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    return;
  }
  await skip.click();
}

export class LoginPage {
  constructor(private readonly page: Page) {}

  private async isAuthDisabled() {
    return this.page.evaluate(() => window.SERVER_FLAGS?.authDisabled);
  }

  /** Signs in to the console as a lab user and dismisses the welcome tour when it is shown. */
  async login(username: string, password: string) {
    await this.page.context().clearCookies();
    await this.page.goto('/');

    if (await this.isAuthDisabled()) {
      return;
    }

    await submitOpenShiftLogin(this.page, username, password);
    await this.page.getByTestId('username').waitFor({ state: 'attached', timeout: 120_000 });
    await skipTour(this.page);
  }

  async logout() {
    if (await this.isAuthDisabled()) {
      return;
    }
    await this.page.getByTestId('username').click();
    await this.page.getByTestId('log-out').waitFor({ state: 'visible' });
    // eslint-disable-next-line playwright/no-force-option -- dropdown may be covered by overlay
    await this.page.getByTestId('log-out').click({ force: true });
  }
}
