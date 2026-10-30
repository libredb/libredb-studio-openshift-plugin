# LibreDB Studio plugin for the OpenShift web console

This repository holds the OpenShift web console dynamic plugin `libredb-studio` for [LibreDB Studio](https://github.com/libredb/libredb-studio), the web-based SQL IDE.
It lists the database resources of the cluster that the signed-in user can list, and opens each one in LibreDB Studio in a new tab.
Status: in development, not yet released, and not ready for production use.

The plugin holds no credential and reads no Secret.
It finds LibreDB Studio through the console link named `libredb-studio` that Studio's chart renders, and opens a database by Studio's connection id; Studio checks the user's access again before it connects.
Clusters install the plugin through LibreDB Studio's Helm chart or operator.
The chart under `charts/` in this repository is for development and the lab only.

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

## Image

Each release publishes `ghcr.io/libredb/libredb-studio-openshift-plugin:<version>` for `linux/amd64` and `linux/arm64`, and its release notes name the image by digest.
The image serves the plugin with nginx on TLS port 9443, runs as a non-root user with a read-only root, and logs no request header, cookie or query string.
LibreDB Studio's chart and operator pin it by digest; [RELEASING.md](RELEASING.md) describes the release, the image and its smoke test.

## Licence

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
