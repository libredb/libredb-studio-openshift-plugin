# Releasing

A release publishes the plugin as a multi-architecture image, `ghcr.io/libredb/libredb-studio-openshift-plugin:<version>`, from a GitHub release.
No catalog offers that image until a LibreDB Studio release pins it by digest in its chart and operator.

Versions follow semver with bare tags on `main` and no `v` prefix, and stay 0.x until the first LibreDB Studio release that ships OpenShift mode.
The tag, `version` in `package.json` and `consolePlugin.version` are always equal.

Steps:

1. Bump `version` and `consolePlugin.version` in `package.json` in a pull request.
2. After the pull request merges, publish a GitHub release with `gh release create <version> --generate-notes --target main`; never write release notes by hand.
3. The release workflow refuses a tag that is not semver or differs from `package.json`, builds `linux/amd64` and `linux/arm64`, pushes only the version tag, and appends the image index digest and the LibreDB Studio tag whose Kubernetes discovery contract the release matches to the release notes.
4. Check that the image pulls anonymously, then pin its digest in LibreDB Studio's chart and operator.

## Upstream

The repository started from [openshift/console-plugin-template](https://github.com/openshift/console-plugin-template) branch `release-4.19` at `efc5c137b5acfd7a2a9580079dc16af59ba06176`, and took its unit and end-to-end test tooling from branch `release-4.22` at `1fdacd51f6c8e792b4d5b86cb0929617c3f22bfb`, both under the Apache License, Version 2.0 (see [NOTICE](NOTICE)).
