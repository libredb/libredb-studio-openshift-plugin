import { defineConfig, type Project } from '@playwright/test';
import { authFile, type LabUserName } from './integration-tests/support/lab';

// Three lab users share one cluster and the locator ConsoleLink, so the suite runs one test at a time. The suite runs
// by hand on a lab machine through scripts/e2e/run-crc.sh (or scripts/e2e/run-dev-lane.sh), never in CI.
const USERS: LabUserName[] = ['dev-a', 'dev-b', 'os-admin'];

// The specs that run with a lab user's console session; the two optional projects run their own spec alone.
const SIGNED_IN_SPECS =
  /(plugin-loaded|databases-page|details-item|open-in-studio|no-secret-reads)\.spec\.ts/;

const setupProjects: Project[] = USERS.map((user) => ({
  name: `setup-${user}`,
  testMatch: /auth\.setup\.ts/,
  metadata: { user },
}));

const userProjects: Project[] = USERS.map((user) => ({
  name: `chromium-${user}`,
  testMatch: SIGNED_IN_SPECS,
  // Each spec tags its tests with the user they run as.
  grep: new RegExp(`@${user}\\b`),
  metadata: { user },
  use: { browserName: 'chromium', storageState: authFile(user) },
  dependencies: [`setup-${user}`],
}));

const optionalProjects: Project[] = [];
// Runs alone after the locator ConsoleLink is deleted, and only on the Helm path: the operator recreates the link.
if (process.env.E2E_LOCATOR_REMOVED === '1') {
  optionalProjects.push({
    name: 'locator-removed',
    testMatch: /locator-removed\.spec\.ts/,
    metadata: { user: 'os-admin' },
    use: { browserName: 'chromium', storageState: authFile('os-admin') },
    dependencies: ['setup-os-admin'],
  });
}
// The development console of scripts/e2e/run-dev-lane.sh: sign-in disabled, so no setup and no storage state.
if (process.env.E2E_DEV_LANE === '1') {
  optionalProjects.push({
    name: 'dev-lane',
    testMatch: /dev-lane\.spec\.ts/,
    use: { browserName: 'chromium' },
  });
}

// A failed test's page snapshot (error-context.md) may hold a form's values, such as the OAuth login page's.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

export default defineConfig({
  testDir: './integration-tests/tests',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: process.env.E2E_EVIDENCE_DIR || 'integration-tests/results/output',
  use: {
    baseURL: process.env.BRIDGE_BASE_ADDRESS ?? 'http://localhost:9000',
    viewport: { width: 1920, height: 1080 },
    // Traces and videos carry session cookies, so they are never written.
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
    video: 'off',
    trace: 'off',
    testIdAttribute: 'data-test',
  },
  projects: [...setupProjects, ...userProjects, ...optionalProjects],
  reporter: [
    ['list'],
    ['html', { outputFolder: 'integration-tests/results/html', open: 'never' }],
    ['junit', { outputFile: 'integration-tests/results/junit-results.xml' }],
  ],
});
