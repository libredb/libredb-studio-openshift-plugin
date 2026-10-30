import * as fs from 'fs';
import * as path from 'path';
import type { Page, Request, TestInfo } from '@playwright/test';
import { test } from '@playwright/test';
import {
  isLabUser,
  judgeConsoleMessage,
  type LabUserName,
  type RecordedRequest,
  scrub,
} from './rules';

export {
  isLabUser,
  judgeConsoleMessage,
  labUser,
  type LabUserName,
  playwrightOutputDir,
  type RecordedRequest,
  secretReviews,
  studioBase,
} from './rules';

/** Where the sign-in setup of a lab user keeps its storage state (gitignored, deleted by run-crc.sh on exit). */
export function authFile(name: LabUserName): string {
  return `integration-tests/.auth/${name}.json`;
}

/** The lab user a project runs as, from its metadata in playwright.config.ts. */
export function projectUser(testInfo: TestInfo): LabUserName {
  const user: unknown = testInfo.project.metadata.user;
  if (!isLabUser(user)) {
    throw new Error(`project ${testInfo.project.name} names no lab user in its metadata`);
  }
  return user;
}

/** The run log: one line per event the rulings say to record, kept beside the evidence when E2E_EVIDENCE_DIR is set. */
export function runLog(line: string): void {
  const stamped = `${new Date().toISOString()} ${test.info().project.name} ${test.info().title}: ${line}`;
  test.info().annotations.push({ type: 'run-log', description: line });
  const dir = process.env.E2E_EVIDENCE_DIR;
  if (dir !== undefined && dir !== '') {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'run-log.txt'), `${stamped}\n`);
  }
  console.log(stamped);
}

/** Writes one evidence file into E2E_EVIDENCE_DIR (the test's output folder when it is unset) and returns its path. */
export function evidencePath(name: string): string {
  const dir = process.env.E2E_EVIDENCE_DIR;
  if (dir === undefined || dir === '') {
    return test.info().outputPath(name);
  }
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

interface ConsoleWatch {
  forbidden: string[];
  unauthorizedLoads: number;
  unauthorizedFetches: number;
  /** How many Unauthorized load errors a waitForPlugin reload already answered. */
  handledLoads: number;
  reloadedAndLoaded: boolean;
  /** The run-log lines of allowed messages, written by the check: a listener may fire after the test ended. */
  logLines: string[];
  onUnauthorized?: () => void;
}

const watches = new WeakMap<Page, ConsoleWatch>();

/**
 * Watches a page's browser console (R-45) and returns the check to call at the end of the test: it fails on any page
 * error, on any error that names libredb-studio, and on any warning that names libredb-studio or comes from the
 * plugin's own assets unless R-45 allows it. The check writes each distinct allowed message to the run log. The Unauthorized
 * load error of R-44, and the failed manifest fetch warning that comes with it, pass once, and only when waitForPlugin
 * then reloaded and found the plugin loaded.
 */
export function watchConsoleMessages(page: Page): () => void {
  const watch: ConsoleWatch = {
    forbidden: [],
    unauthorizedLoads: 0,
    unauthorizedFetches: 0,
    handledLoads: 0,
    reloadedAndLoaded: false,
    logLines: [],
  };
  watches.set(page, watch);
  page.on('pageerror', (error) => {
    watch.forbidden.push(`pageerror: ${scrub(String(error))}`);
  });
  page.on('console', (message) => {
    const text = message.text();
    const verdict = judgeConsoleMessage(message.type(), text, message.location().url);
    if (verdict === 'unauthorized-load') {
      watch.unauthorizedLoads += 1;
      watch.logLines.push(
        `the console logged the Unauthorized plugin load error (R-44): ${scrub(text)}`,
      );
      watch.onUnauthorized?.();
    } else if (verdict === 'unauthorized-fetch') {
      watch.unauthorizedFetches += 1;
      watch.logLines.push(
        `the console logged the Unauthorized manifest fetch warning: ${scrub(text)}`,
      );
    } else if (verdict === 'allowed') {
      watch.logLines.push(`allowed console ${message.type()} (R-45): ${scrub(text)}`);
    } else if (verdict === 'forbidden') {
      watch.forbidden.push(`${message.type()}: ${scrub(text)}`);
    }
  });
  return () => {
    for (const line of new Set(watch.logLines)) {
      runLog(line);
    }
    const failures = [...watch.forbidden];
    if (watch.unauthorizedLoads > 1) {
      failures.push(`the Unauthorized plugin load error appeared ${watch.unauthorizedLoads} times`);
    } else if (watch.unauthorizedLoads === 1 && !watch.reloadedAndLoaded) {
      failures.push(
        'the Unauthorized plugin load error appeared without a reload that loaded the plugin',
      );
    }
    if (watch.unauthorizedFetches > 0 && watch.unauthorizedLoads === 0) {
      failures.push(
        'the Unauthorized manifest fetch warning appeared without the allowed plugin load error',
      );
    }
    if (failures.length > 0) {
      throw new Error(`Forbidden browser console messages:\n${failures.join('\n')}`);
    }
  };
}

/** The plugin's Databases nav item: it exists once the console has loaded and enabled the plugin. */
export const DATABASES_NAV = 'a[href="/libredb-studio/databases"]';

const PLUGIN_WAIT_MS = 60_000;

/**
 * Waits up to 60 seconds for the Databases nav item (R-44). When the console logged an Unauthorized plugin load error
 * that no earlier reload answered, it reloads once, records that in the run log and waits again; a second failure fails
 * the test. Nothing else retries.
 */
export async function waitForPlugin(page: Page): Promise<{ reloaded: boolean }> {
  const watch = watches.get(page);
  const nav = page.locator(DATABASES_NAV).first();
  let unauthorized: () => void = () => undefined;
  const failedLoad = new Promise<'unauthorized'>((resolve) => {
    unauthorized = () => resolve('unauthorized');
  });
  if (watch !== undefined) {
    watch.onUnauthorized = unauthorized;
    // An error logged before this call (page.goto may return after it) still counts; one a reload answered does not.
    if (watch.unauthorizedLoads > watch.handledLoads) {
      unauthorized();
    }
  }
  const first = await Promise.race([
    nav.waitFor({ state: 'attached', timeout: PLUGIN_WAIT_MS }).then(() => 'loaded' as const),
    failedLoad,
  ]);
  if (watch !== undefined) {
    watch.onUnauthorized = undefined;
  }
  if (first === 'loaded') {
    runLog('the plugin loaded, reloaded: false');
    return { reloaded: false };
  }
  runLog('the console logged "loadPlugin failed ... Unauthorized"; reloading once (R-44)');
  if (watch !== undefined) {
    watch.handledLoads = watch.unauthorizedLoads;
  }
  await page.reload();
  await nav.waitFor({ state: 'attached', timeout: PLUGIN_WAIT_MS });
  if (watch !== undefined) {
    watch.reloadedAndLoaded = true;
  }
  runLog('the plugin loaded after the reload, reloaded: true (R-44)');
  return { reloaded: true };
}

export interface RequestRecorder {
  /** Every request and websocket of the page since recording started, in the order sent. */
  readonly requests: readonly RecordedRequest[];
  /** How many of them went to the given host; the host itself is never kept. */
  countToHost(host: string): number;
  /** Starts a new window: drops what was recorded so far. */
  clear(): void;
}

const ACCESS_REVIEWS = '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews';

function reviewAttributes(request: Request): Record<string, unknown> | undefined {
  try {
    const body = request.postDataJSON() as {
      spec?: { resourceAttributes?: Record<string, unknown> };
    } | null;
    return body?.spec?.resourceAttributes;
  } catch {
    return { unreadable: true };
  }
}

/**
 * Records the requests and websockets of one page, keeping the method, the URL path and, for access reviews,
 * spec.resourceAttributes only (R-43): never a header, a cookie, a query string or another body.
 */
export function recordRequests(page: Page): RequestRecorder {
  let requests: RecordedRequest[] = [];
  let hosts: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') {
      return;
    }
    const entry: RecordedRequest = { method: request.method(), path: url.pathname };
    if (request.method() === 'POST' && url.pathname.endsWith(ACCESS_REVIEWS)) {
      entry.resourceAttributes = reviewAttributes(request);
    }
    requests.push(entry);
    hosts.push(url.host);
  });
  page.on('websocket', (socket) => {
    const url = new URL(socket.url());
    requests.push({ method: 'WEBSOCKET', path: url.pathname });
    hosts.push(url.host);
  });
  return {
    get requests() {
      return requests;
    },
    countToHost(host: string) {
      return hosts.filter((candidate) => candidate === host).length;
    },
    clear() {
      requests = [];
      hosts = [];
    },
  };
}

/** Writes recorded requests as evidence: method, path and review attributes only. */
export function writeRequests(name: string, requests: readonly RecordedRequest[]): void {
  fs.writeFileSync(evidencePath(name), `${JSON.stringify(requests, null, 2)}\n`);
}

/** A database of the lab cluster, with its connection id under Studio's Kubernetes discovery contract. */
export interface LabDatabase {
  id: string;
  namespace: string;
  name: string;
  user?: string;
  /** The credential Secret the plugin's access review names. */
  secret: string;
  /** The resource's generic details page. */
  path: string;
}

/** The lab's databases (CRC, Phase 2 and 3 state); the lab's analytics lists one user, analyst. */
export const LAB_DATABASES = {
  orders: {
    id: 'k8s-cnpg-75c1a60b898072af828207cff435c7e5',
    namespace: 'team-a',
    name: 'orders',
    secret: 'orders-app',
    path: '/k8s/ns/team-a/postgresql.cnpg.io~v1~Cluster/orders',
  },
  analytics: {
    id: 'k8s-pgo-08ddbec864884242a67b9c2ec28ca05a',
    namespace: 'team-b',
    name: 'analytics',
    user: 'analyst',
    secret: 'analytics-pguser-analyst',
    path: '/k8s/ns/team-b/postgres-operator.crunchydata.com~v1beta1~PostgresCluster/analytics',
  },
  catalog: {
    id: 'k8s-mongo-298f87d830642523c9d1ace3afe70694',
    namespace: 'team-m',
    name: 'catalog',
    user: 'appuser',
    secret: 'catalog-admin-appuser',
    path: '/k8s/ns/team-m/mongodbcommunity.mongodb.com~v1~MongoDBCommunity/catalog',
  },
} satisfies Record<string, LabDatabase>;
