import { expect, type Page, test } from '@playwright/test';
import {
  ALL_PROJECTS,
  databasesPage,
  openDatabases,
  openDetailsItem,
  reloadDatabases,
  selectProject,
  settled,
} from '../pages/console';
import {
  LAB_DATABASES,
  type LabDatabase,
  recordRequests,
  type RequestRecorder,
  secretReviews,
  studioBase,
  watchConsoleMessages,
  writeRequests,
} from '../support';

const DATABASES: LabDatabase[] = Object.values(LAB_DATABASES);

/** The lab databases whose rows the Databases page shows. */
async function visibleRows(page: Page): Promise<LabDatabase[]> {
  const ids = await databasesPage(page)
    .locator('[data-test^="libredb-row-"]')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-test')?.slice('libredb-row-'.length)),
    );
  return ids.map((id) => {
    const database = DATABASES.find((candidate) => candidate.id === id);
    if (database === undefined) {
      throw new Error(`the row ${id} is not a lab database the suite knows`);
    }
    return database;
  });
}

/**
 * The rules of the window just recorded: no request path names Secrets (or, on a details page, the row's Secret), every
 * access review that gets or names a Secret is a get of a shown row's Secret in its namespace, each shown row has
 * exactly one, and nothing went to Studio's host. Other reviews, the console's own, are recorded, not failed.
 */
function checkWindow(
  recorder: RequestRecorder,
  rows: LabDatabase[],
  name: string,
  details = false,
) {
  writeRequests(name, recorder.requests);
  const paths = recorder.requests.map((request) => request.path);
  if (details) {
    for (const row of rows) {
      expect(paths.filter((path) => path.includes(`/secrets/${row.secret}`))).toEqual([]);
    }
  } else {
    expect(paths.filter((path) => path.includes('/secrets'))).toEqual([]);
  }
  const reviews = secretReviews(recorder.requests);
  for (const review of reviews) {
    expect(review.verb).toBe('get');
    expect(review.group ?? '').toBe('');
    expect(
      rows.some((row) => row.secret === review.name && row.namespace === review.namespace),
    ).toBe(true);
  }
  for (const row of rows) {
    const own = reviews.filter(
      (review) => review.name === row.secret && review.namespace === row.namespace,
    );
    expect(own, `access reviews of ${row.namespace}/${row.secret}`).toHaveLength(1);
  }
  expect(recorder.countToHost(new URL(studioBase()).host)).toBe(0);
}

test('dev-a: the Databases page and orders read no Secret', { tag: '@dev-a' }, async ({ page }) => {
  const check = watchConsoleMessages(page);
  const recorder = recordRequests(page);
  await openDatabases(page, 'team-a');
  // The page showed the previous project's rows before team-a was chosen; the window starts at a reload in team-a.
  recorder.clear();
  await reloadDatabases(page, 'team-a');
  await settled(databasesPage(page));
  const teamA = await visibleRows(page);
  expect(teamA.map((row) => row.name)).toEqual(['orders']);
  checkWindow(recorder, teamA, 'requests-dev-a-team-a.json');

  recorder.clear();
  await selectProject(page, 'team-b');
  await settled(databasesPage(page));
  await expect(
    databasesPage(page).getByTestId(`libredb-row-${LAB_DATABASES.analytics.id}`),
  ).toBeVisible();
  const teamB = await visibleRows(page);
  checkWindow(recorder, teamB, 'requests-dev-a-team-b.json');

  recorder.clear();
  await openDetailsItem(page, LAB_DATABASES.orders.path);
  checkWindow(recorder, [LAB_DATABASES.orders], 'requests-dev-a-orders-details.json', true);
  check();
});

test(
  'dev-b: the Databases page and analytics read no Secret',
  { tag: '@dev-b' },
  async ({ page }) => {
    const check = watchConsoleMessages(page);
    const recorder = recordRequests(page);
    await openDatabases(page, 'team-b');
    await settled(databasesPage(page));
    const teamB = await visibleRows(page);
    expect(teamB.map((row) => row.name)).toEqual(['analytics']);
    checkWindow(recorder, teamB, 'requests-dev-b-team-b.json');

    recorder.clear();
    await openDetailsItem(page, LAB_DATABASES.analytics.path);
    checkWindow(recorder, [LAB_DATABASES.analytics], 'requests-dev-b-analytics-details.json', true);
    check();
  },
);

test(
  'os-admin: the Databases page and catalog read no Secret',
  { tag: '@os-admin' },
  async ({ page }) => {
    const check = watchConsoleMessages(page);
    const recorder = recordRequests(page);
    await openDatabases(page, ALL_PROJECTS);
    await settled(databasesPage(page));
    const all = await visibleRows(page);
    expect(all.map((row) => row.name).sort()).toEqual(['analytics', 'catalog', 'orders']);
    checkWindow(recorder, all, 'requests-os-admin-all-projects.json');

    recorder.clear();
    await openDetailsItem(page, LAB_DATABASES.catalog.path);
    checkWindow(recorder, [LAB_DATABASES.catalog], 'requests-os-admin-catalog-details.json', true);
    check();
  },
);
