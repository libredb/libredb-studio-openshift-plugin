// The suite's rules that need no browser, kept apart from Playwright so the unit tests can hold them.

/** The lab users of the suite. Their passwords reach the test process through scripts/e2e/run-crc.sh only. */
export type LabUserName = 'dev-a' | 'dev-b' | 'os-admin';

type Env = Record<string, string | undefined>;

const PASSWORD_VARIABLES: Record<LabUserName, string> = {
  'dev-a': 'E2E_PASSWORD_DEV_A',
  'dev-b': 'E2E_PASSWORD_DEV_B',
  'os-admin': 'E2E_PASSWORD_OS_ADMIN',
};

export function isLabUser(name: unknown): name is LabUserName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(PASSWORD_VARIABLES, name);
}

/** A lab user's name and password; throws naming the variable when the password is not set. */
export function labUser(
  name: LabUserName,
  env: Env = process.env,
): { username: string; password: string } {
  const variable = PASSWORD_VARIABLES[name];
  const password = env[variable];
  if (password === undefined || password === '') {
    throw new Error(`${variable} is not set: run the suite through scripts/e2e/run-crc.sh`);
  }
  return { username: name, password };
}

/** LibreDB Studio's https base URL, from STUDIO_URL, with no trailing slash. */
export function studioBase(env: Env = process.env): string {
  const value = env.STUDIO_URL;
  if (value === undefined || value === '') {
    throw new Error('STUDIO_URL is not set: run the suite through scripts/e2e/run-crc.sh');
  }
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.search !== '' || url.hash !== '' || url.username !== '') {
    throw new Error('STUDIO_URL must be an https URL with no query, fragment or credentials');
  }
  return value.replace(/\/+$/, '');
}

/**
 * The one console error R-44 and R-45 allow: the plugin's first load after sign-in may fail with Unauthorized, and
 * waitForPlugin then reloads once. The warning beside it names the manifest fetch that failed the same way, and passes
 * only together with that error.
 */
const UNAUTHORIZED_LOAD =
  /\[loadAndEnablePlugin\] libredb-studio loadPlugin failed: .*Unauthorized/;
const UNAUTHORIZED_FETCH =
  /consoleFetch failed for url \S*\/api\/plugins\/libredb-studio\/plugin-manifest\.json e: Unauthorized/;

/**
 * The warnings R-45 allows: the console's shared-module versions (R-11) and its older-console notice, which the OCP
 * 4.22.14 console prefixes with [DEPRECATION WARNING] and the origin-console 4.22 image with [WARNING].
 */
const ALLOWED_WARNINGS = [
  /Unsatisfied version .* of shared singleton module (react|react-i18next|@openshift-console\/dynamic-plugin-sdk) /,
  /\[(DEPRECATION )?WARNING\] libredb-studio@.* was built for an older version of Console/,
];

const PLUGIN_NAME = 'libredb-studio';
const PLUGIN_ASSETS = '/api/plugins/libredb-studio/';

/** What R-45 makes of one browser console message; see judgeConsoleMessage. */
export type ConsoleVerdict =
  | 'ignored'
  | 'allowed'
  | 'unauthorized-load'
  | 'unauthorized-fetch'
  | 'forbidden';

/**
 * What R-45 makes of one browser console message: an error that names the plugin is forbidden except the Unauthorized
 * load error, which the caller allows once around waitForPlugin's reload, together with the failed manifest fetch
 * warning that comes with it; any other warning that names the plugin or comes from its assets is forbidden unless
 * R-45 lists it (allowed, and logged by the caller). Anything else is the console's or another plugin's (ignored).
 */
export function judgeConsoleMessage(
  type: string,
  text: string,
  locationUrl: string,
): ConsoleVerdict {
  if (type === 'error' && text.includes(PLUGIN_NAME)) {
    return UNAUTHORIZED_LOAD.test(text) ? 'unauthorized-load' : 'forbidden';
  }
  if (type === 'warning' && (text.includes(PLUGIN_NAME) || locationUrl.includes(PLUGIN_ASSETS))) {
    if (UNAUTHORIZED_FETCH.test(text)) {
      return 'unauthorized-fetch';
    }
    return ALLOWED_WARNINGS.some((allowed) => allowed.test(text)) ? 'allowed' : 'forbidden';
  }
  return 'ignored';
}

/** Values that must never reach a report or the run log, should a console message ever carry one. */
export function scrub(text: string): string {
  return text
    .replace(/sha256~[A-Za-z0-9_-]+/g, 'sha256~<scrubbed>')
    .replace(/(access_token|code|state|cacheBuster)=[^&\s"]+/g, '$1=<scrubbed>');
}

/** One request the console page sent, as the evidence keeps it: method, URL path and access review attributes. */
export interface RecordedRequest {
  method: string;
  path: string;
  resourceAttributes?: Record<string, unknown>;
}

/**
 * The console's own start-up review: may the user create Secrets at all (no name, no namespace), for its own menus.
 * It is the one review of Secrets that is recorded, not constrained.
 */
function isConsoleCreateReview(attributes: Record<string, unknown>): boolean {
  return (
    attributes.verb === 'create' &&
    (attributes.name ?? '') === '' &&
    (attributes.namespace ?? '') === ''
  );
}

/**
 * The access reviews among recorded requests that the plugin's rule constrains to a get of a shown row's Secret: every
 * review of Secrets except the console's own start-up create review.
 */
export function secretReviews(requests: readonly RecordedRequest[]): Record<string, unknown>[] {
  return requests
    .map((request) => request.resourceAttributes)
    .filter(
      (attributes): attributes is Record<string, unknown> =>
        attributes !== undefined &&
        attributes.resource === 'secrets' &&
        !isConsoleCreateReview(attributes),
    );
}

/**
 * Playwright's outputDir (failure screenshots): a subfolder of E2E_EVIDENCE_DIR, because Playwright empties its
 * outputDir at the start of every run and would delete the evidence beside it; the gitignored results folder when
 * E2E_EVIDENCE_DIR is unset. A relative E2E_EVIDENCE_DIR is refused: the run scripts change into the checkout.
 */
export function playwrightOutputDir(env: Env = process.env): string {
  const dir = env.E2E_EVIDENCE_DIR;
  if (dir === undefined || dir === '') {
    return 'integration-tests/results/output';
  }
  if (!dir.startsWith('/')) {
    throw new Error('E2E_EVIDENCE_DIR must be an absolute path outside the checkout');
  }
  return `${dir.replace(/\/+$/, '')}/playwright`;
}
