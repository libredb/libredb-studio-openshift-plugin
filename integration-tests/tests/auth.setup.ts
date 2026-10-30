import { test as setup } from '@playwright/test';
import { LoginPage } from '../pages/login';
import { authFile, labUser, projectUser } from '../support';

// eslint-disable-next-line playwright/expect-expect -- setup test saves storageState, no assertions needed
setup('sign in', async ({ page }, testInfo) => {
  const name = projectUser(testInfo);
  const user = labUser(name);
  await new LoginPage(page).login(user.username, user.password);
  await page.context().storageState({ path: authFile(name) });
});
