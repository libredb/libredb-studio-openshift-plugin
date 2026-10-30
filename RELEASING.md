# Releasing

A release publishes the plugin as a multi-architecture image, `ghcr.io/libredb/libredb-studio-openshift-plugin:<version>`, from a GitHub release.
No catalog offers that image until a LibreDB Studio release pins it by digest in its chart and operator.

Versions follow semver with bare tags on `main` and no `v` prefix, and stay 0.x until the first LibreDB Studio release that ships OpenShift mode.
The tag, `version` in `package.json` and `consolePlugin.version` are always equal.

Steps:

1. Bump `version` and `consolePlugin.version` in `package.json` in a pull request.
2. After the pull request merges, publish a GitHub release with `gh release create <version> --generate-notes --target main`; never write release notes by hand.
3. The release workflow (`.github/workflows/release.yml`) refuses a tag on a commit that is not on `main` (`--target main` is ignored when the tag already exists), a tag that is not semver, and one that differs from `version` or `consolePlugin.version` in `package.json`, builds the `linux/amd64` image and runs the smoke test on it before it logs in, builds `linux/amd64` and `linux/arm64` without an emulator from the same builder cache, pushes only the version tag (never `latest`), and appends two lines to the release notes: `Image: ghcr.io/libredb/libredb-studio-openshift-plugin:<version>@<index digest>` and the LibreDB Studio tag whose Kubernetes discovery contract the release matches.
4. Check that the digest in the notes equals `crane digest ghcr.io/libredb/libredb-studio-openshift-plugin:<version>`, and that the image pulls anonymously; a new GHCR package may start private, and only its settings page makes it public.
5. Pin that digest in LibreDB Studio's chart and operator.

If the notes job fails after the image was pushed, re-run that job alone.
Re-running the whole workflow pushes the version tag again with a new digest, and the notes job then refuses, because the notes already name an image.

Only the publish job holds `packages: write` and only the notes job holds `contents: write`; nothing is signed, so no job requests an OIDC token.
The buildx builder of the publish job and of CI's image job runs privileged, so both pin its `moby/buildkit` image by digest; Dependabot does not track that pin, so it is bumped by hand in both workflows together.

## Image

The image builds `dist/` in a UBI Node.js 22 stage and serves it from a UBI nginx 1.20 stage, both pinned by digest, with the configuration baked in from `nginx.conf`.
nginx serves `dist/` from `/usr/share/nginx/plugin`, a document root holding only the build output, so the base image's welcome and error pages in `/usr/share/nginx/html` answer 404.
It runs as user 1001 with a read-only root and a writable `/tmp`, listens on 9443 with the serving certificate mounted at `/var/cert`, and its access log records only the client address, time, method, path, status and size of each request: never a header, a cookie or the query string, because the console sends each user's bearer token on every asset fetch.
The error log records nothing about a request the server answers normally; for a request nginx rejects with an error, such as a body over its 1 MiB limit, it names the request line, with its query string, and the `Host` and `Referer` headers, never the `Authorization` header or a cookie.
The console's asset proxy sends only a GET with the path and no body, so it never sends such a request.
`LICENSE` and `NOTICE` are in `/licenses`.

To build and smoke-test it locally:

```bash
docker buildx build --load --build-arg VERSION="$(jq -r .version package.json)" -t localhost/osplugin:dev .
scripts/nginx-smoke.sh localhost/osplugin:dev
```

The build refuses a missing `VERSION` or one that differs from `package.json`.
The smoke test runs the image read-only with a throwaway certificate, fetches the manifest and the entry script over TLS, fails unless the base image's `/index.html` and `/nginx-logo.png` answer 404, sends requests carrying a bearer token, a cookie, a Basic user and a query string, and fails unless the requests were logged and none of those values reached the log.
It then sends an oversized request with a bearer token and a cookie, and fails unless nginx logged the rejection without either of them, and last runs the image as an arbitrary uid in group 0, as OpenShift's `restricted-v2` does, and fetches the manifest and the entry script again.

## Development console images

The development lane, `scripts/e2e/run-dev-lane.sh`, ran on 2026-10-30 against CRC 4.22.14 with these console images, and each loaded the plugin and passed the `dev-lane` project:

| Image | Digest | Loads the plugin |
| --- | --- | --- |
| `quay.io/openshift/origin-console:4.19` (also tagged `4.19.0`) | `sha256:9f2000b429109f99dc506c8c10c1fd5c594e279f606e852be9aa74356d76d0f9` | Yes |
| `quay.io/openshift/origin-console:4.22` (also tagged `4.22.0`) | `sha256:13cc82d654ad8e7db7d723b978890e11dfc21302e84865e7d229a9ce7ba5f3f5` | Yes |

The 4.19 image checks the 4.19 console build only: the API server it talks to is the lab's 4.22 one.
The 4.22 image logs the older-console notice as `[WARNING] libredb-studio@<version> was built for an older version of Console`, where the OpenShift 4.22.14 console writes `[DEPRECATION WARNING]`; the suite allows both.

## Upstream

The repository started from [openshift/console-plugin-template](https://github.com/openshift/console-plugin-template) branch `release-4.19` at `efc5c137b5acfd7a2a9580079dc16af59ba06176`, and took its unit and end-to-end test tooling from branch `release-4.22` at `1fdacd51f6c8e792b4d5b86cb0929617c3f22bfb`, both under the Apache License, Version 2.0 (see [NOTICE](NOTICE)).
