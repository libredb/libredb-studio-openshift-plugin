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
 * waitForPlugin then reloads once. The warning beside it names the manifest fetch that failed the same way.
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
  UNAUTHORIZED_FETCH,
];

const PLUGIN_NAME = 'libredb-studio';
const PLUGIN_ASSETS = '/api/plugins/libredb-studio/';

/**
 * What R-45 makes of one browser console message: an error that names the plugin is forbidden except the Unauthorized
 * load error, which the caller allows once around waitForPlugin's reload; a warning that names the plugin or comes from
 * its assets is forbidden unless R-45 lists it. Anything else is the console's or another plugin's.
 */
export function judgeConsoleMessage(
  type: string,
  text: string,
  locationUrl: string,
): 'allowed' | 'unauthorized-load' | 'forbidden' {
  if (type === 'error' && text.includes(PLUGIN_NAME)) {
    return UNAUTHORIZED_LOAD.test(text) ? 'unauthorized-load' : 'forbidden';
  }
  if (type === 'warning' && (text.includes(PLUGIN_NAME) || locationUrl.includes(PLUGIN_ASSETS))) {
    return ALLOWED_WARNINGS.some((allowed) => allowed.test(text)) ? 'allowed' : 'forbidden';
  }
  return 'allowed';
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
 * The access reviews among recorded requests that the plugin's rule constrains: a get of a Secret, or any review that
 * names one Secret. The console itself asks at start-up whether the user may create Secrets at all (no name, no
 * namespace) for its own menus; such a review is recorded, not constrained.
 */
export function secretReviews(requests: readonly RecordedRequest[]): Record<string, unknown>[] {
  return requests
    .map((request) => request.resourceAttributes)
    .filter(
      (attributes): attributes is Record<string, unknown> =>
        attributes !== undefined &&
        attributes.resource === 'secrets' &&
        (attributes.verb === 'get' || (attributes.name ?? '') !== ''),
    );
}
