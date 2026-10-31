# LibreDB Studio plugin for the OpenShift web console

This repository holds the OpenShift web console dynamic plugin `libredb-studio` for [LibreDB Studio](https://github.com/libredb/libredb-studio), the web-based SQL IDE.
It lists the database resources of the cluster that the signed-in user can list, and opens each one in LibreDB Studio in a new tab.
Status: early 0.x release, shipped with LibreDB Studio 1.2.0, which installs and pins it.

The plugin holds no credential and reads no Secret.
It finds LibreDB Studio through the console link named `libredb-studio` that Studio's chart renders, and opens a database by Studio's connection id; Studio checks the user's access again before it connects.
Clusters install the plugin through LibreDB Studio's Helm chart or operator.
The chart under `charts/` in this repository is for development and the lab only.

## Demo

A walkthrough on OpenShift 4.22 with LibreDB Studio 1.2.0: the operator installed with the plugin enabled, the Databases page as a project member, a query as the signed-in user, and the query refused once the user's RoleBinding is removed.
[Full walkthrough, 3.5 min](https://github.com/libredb/libredb-studio-openshift-plugin/releases/download/0.1.0/demo-libredb-studio-openshift.mp4) and [short version, 1 min](https://github.com/libredb/libredb-studio-openshift-plugin/releases/download/0.1.0/demo-libredb-studio-openshift-short.mp4).

| A database the user may open | A database the user may not open, and why |
| --- | --- |
| ![Databases page, team-a](https://github.com/libredb/libredb-studio-openshift-plugin/releases/download/0.1.0/08-databases-team-a-dev-a.png) | ![Databases page, team-b](https://github.com/libredb/libredb-studio-openshift-plugin/releases/download/0.1.0/09-databases-team-b-reason-dev-a.png) |

## Supported databases

| Operator | Resource |
| --- | --- |
| CloudNativePG | `clusters.postgresql.cnpg.io` |
| EDB Postgres for Kubernetes | `clusters.postgresql.k8s.enterprisedb.io` |
| Crunchy PGO | `postgresclusters.postgres-operator.crunchydata.com` |
| MongoDB Community | `mongodbcommunity.mongodbcommunity.mongodb.com` |

The plugin adds a LibreDB Studio item to the details page of each supported resource, the page that Search and the resource's own list open (`/k8s/ns/<namespace>/<group>~<version>~<kind>/<name>`).
The console does not render plugin details items on the operand details page that Installed Operators opens, so the item is not shown there; the Databases page and the generic details page list the same database.

## Compatibility

| OpenShift | Loads the plugin | Tested |
| --- | --- | --- |
| 4.22 | Yes | Yes, on 4.22.14 |
| 4.19 to 4.21 | Yes, declared by the plugin API range | No, not yet run on a cluster of these versions |
| 4.14 to 4.18 | No; LibreDB Studio's console link still works | Not applicable |
| 5.0 | Yes, the range has no upper bound | No |

The plugin is built once against the console dynamic plugin SDK 4.19 and declares `@console/pluginAPI` `>=4.19.0-0`.
It shares React 17 and react-i18next 11 with the console, the versions the 4.19 to 4.21 consoles provide.
The 4.22 console provides React 18 and react-i18next 16, logs a warning about the shared React, react-i18next and SDK versions, and uses its own copies.
PatternFly React 6.2 is bundled into the plugin, not shared, and matches the PatternFly CSS 6.2 of the 4.19 to 4.21 consoles; the 4.22 console loads PatternFly CSS 6.4.

The connection ids follow LibreDB Studio's Kubernetes discovery contract, which `tests/unit/fixtures/kubernetes-discovery-golden.source.json` names by its Studio tag.
The plugin matches LibreDB Studio releases after 1.1.0.

## Development

Requirements: Node.js 22 (see `.nvmrc`) and Yarn 4 through Corepack (`corepack enable`).
Dependency install scripts never run (`enableScripts: false` in `.yarnrc.yml`).

```bash
yarn install --immutable
yarn lint             # ESLint and stylelint, warnings fail; yarn lint:fix rewrites
yarn typecheck        # tsc over src, tests and integration-tests
yarn test:coverage    # Jest, fails below 100% line coverage of src
yarn i18n             # regenerates locales/en/plugin__libredb-studio.json
yarn build            # production bundle in dist
yarn test:manifest    # checks dist/plugin-manifest.json after yarn build
```

To try the plugin against a cluster, run `yarn start` for the dev server on 127.0.0.1:9001 and `yarn start-console` for a console in a container on 127.0.0.1:9000.
That console runs with sign-in disabled and acts with the bearer token it is given, so it listens on the loopback interface only.
Preset `BRIDGE_K8S_AUTH_BEARER_TOKEN` to a short-lived token of a view-only account; without it the script takes the token of the current `oc` context, which must never be a cluster administrator's.

## End-to-end tests

The Playwright suite in `integration-tests/` runs by hand against a lab cluster, never in CI, one test at a time.
It signs in to the console as three lab users, `dev-a`, `dev-b` and `os-admin`, and expects the lab's databases `team-a/orders`, `team-b/analytics` and `team-m/catalog` and a LibreDB Studio whose console link the plugin finds.

```bash
yarn playwright install chromium
LAB_USERS_ENV=<file defining dev_a_PASSWORD, dev_b_PASSWORD and os_admin_PASSWORD> \
BRIDGE_BASE_ADDRESS=https://console-openshift-console.apps-crc.testing \
STUDIO_URL=https://<LibreDB Studio host> \
E2E_EVIDENCE_DIR=<an absolute path outside the checkout> \
yarn test:e2e
```

`scripts/e2e/run-crc.sh` reads the passwords inside its own process and hands them to the test process only.
It needs an `oc` context that may list and delete OAuth access tokens and refuses to start without one.
On exit, whatever the result and also when it is interrupted or terminated, it stops the test process first, then deletes `integration-tests/.auth/`, which holds the users' console sessions, and the users' console OAuth access tokens, plus every other OAuth access token of theirs that did not exist before the run, such as LibreDB Studio's sign-in, because signing out of the console leaves its token valid.
It then fails if a token value is in `E2E_EVIDENCE_DIR` or `integration-tests/results`, naming the files.
Both scripts refuse an `E2E_EVIDENCE_DIR` that is relative or inside the checkout.
The evidence goes into that folder and Playwright's own output, such as a failed test's screenshot, into its `playwright/` subfolder, which Playwright empties at the start of every run.
Traces, videos and the page snapshot of a failed test are off, and the request records keep the method, the URL path and the access review attributes only.
With `E2E_LOCATOR_REMOVED=1`, the `locator-removed` project checks the Databases page after Studio's console link was deleted; run it alone with `--project=locator-removed`, and never where an operator recreates the link.

`scripts/e2e/run-dev-lane.sh` runs the `dev-lane` project against the development console instead, with `CONSOLE_IMAGE` naming the console image.
It creates a ServiceAccount that may only view `team-a`, runs `yarn start` and `yarn start-console` with a one-hour token of it, checks that ports 9000 and 9001 listen on 127.0.0.1 only, and on exit deletes the ServiceAccount's namespace, which ends the token, and its RoleBinding; if a cleanup step fails, the others still run and the script exits non-zero naming what is left.
A 4.19 console image run against a newer cluster checks the 4.19 console build only, not a 4.19 cluster; [RELEASING.md](RELEASING.md) lists the images the lane was run with.

## Image

Each release publishes `ghcr.io/libredb/libredb-studio-openshift-plugin:<version>` for `linux/amd64` and `linux/arm64`, and its release notes name the image by digest.
The image serves the plugin with nginx on TLS port 9443, runs as a non-root user with a read-only root, and never logs the `Authorization` header or a cookie; its access log also leaves out every other header and the query string.
LibreDB Studio's chart and operator pin it by digest; [RELEASING.md](RELEASING.md) describes the release, the image and its smoke test.

## Licence

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
