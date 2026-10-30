# Security Policy

## Supported Versions

Security fixes are released against the latest published release only.
There is no long-term support branch and no backport policy: if you run an older version, the upgrade path to a fix is the current release.
The releases page is the authority on what that currently is: <https://github.com/libredb/libredb-studio-openshift-plugin/releases>

## Known Risks

These follow from how OpenShift console plugins work and are not vulnerabilities to report.

| Risk | Where | What limits it |
| --- | --- | --- |
| The plugin's code runs unsandboxed in every console session of a cluster that enables it, with the signed-in user's rights | Every page of the OpenShift web console | Only a cluster administrator can enable a console plugin. The bundle is built from this repository with every dependency pinned by the lockfile and no dependency install script run. The plugin reads no Secret, sends no request of its own to any host but the console's API, asks the cluster only to list database resources, to read the console link named `libredb-studio` and to review the user's own access, and renders names from resources only as text. LibreDB Studio's chart and operator, from their first release that installs the plugin, run its image pinned by digest. |
| The console forwards each user's bearer token to the plugin's server with every asset request | The server that serves the plugin's files | The server in the released image is a static nginx that serves files only and logs the method, the path and the status, never a header or a query string. LibreDB Studio's chart and operator, from their first release that installs the plugin, run it with a read-only root, without a service account token, in a namespace only cluster administrators write, behind a NetworkPolicy that admits the console's namespace only and allows no outgoing connection. |

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.
Report them by email to info@sekoya.tech, or through a private vulnerability report on this repository.
Reports are handled by SEKOYA GRUP BİLİŞİM VE TEKNOLOJİ LİMİTED ŞİRKETİ, the maintainer of LibreDB Studio and of this plugin.

Please include the type of issue, the affected version or commit, the OpenShift version, step-by-step instructions to reproduce it, and its impact.

## What to Expect

- Acknowledgment within 48 hours.
- An initial assessment within 7 days.
- A fix for a critical vulnerability released within 14 days from the assessment.
- Progress updates every 7 to 10 days until the issue is resolved.
- Serious defects are named in the release notes of the release that fixes them.

## Disclosure Policy

We coordinate with the reporter to fix a vulnerability before public disclosure, and credit the reporter unless they prefer to remain anonymous.
We will not take legal action against security researchers who act in good faith, do not access more data than necessary, do not modify or delete data, and do not disrupt our services.

A vulnerability in LibreDB Studio itself is reported the same way and handled under the policy of <https://github.com/libredb/libredb-studio/blob/main/SECURITY.md>.
