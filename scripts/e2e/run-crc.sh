#!/usr/bin/env bash
# Runs the end-to-end suite against a cluster's console as the lab users dev-a, dev-b and os-admin, by hand on a lab
# machine (never in CI). Arguments go to `yarn playwright test`, such as --project=locator-removed.
#
# Requires:
#   LAB_USERS_ENV        file defining dev_a_PASSWORD, dev_b_PASSWORD and os_admin_PASSWORD
#   BRIDGE_BASE_ADDRESS  the console URL, such as https://console-openshift-console.apps-crc.testing
#   STUDIO_URL           LibreDB Studio's https URL, the href of its console link
#   an oc context that may list and delete OAuth access tokens (a cluster administrator's)
# Optional: E2E_EVIDENCE_DIR (screenshots, request records and the run log), E2E_IDENTITY_PROVIDER.
#
# The passwords are read inside this process and passed to the test process only, never printed or put on a command
# line. On exit, whatever the result, it deletes integration-tests/.auth/ (the users' console sessions) and the
# console OAuth access tokens of the three users, plus every other OAuth access token of theirs created during the
# run, such as LibreDB Studio's sign-in, and prints only how many it deleted.
set -euo pipefail

: "${LAB_USERS_ENV:?set LAB_USERS_ENV to the file holding the lab users passwords}"
: "${BRIDGE_BASE_ADDRESS:?set BRIDGE_BASE_ADDRESS to the console URL}"
: "${STUDIO_URL:?set STUDIO_URL to LibreDB Studio https URL}"

cd "$(dirname "$0")/../.."
AUTH_DIR=integration-tests/.auth
LAB_USERS='"dev-a","dev-b","os-admin"'

# The token cleanup must be possible before anything signs in.
if ! oc get oauthaccesstokens -o name > /dev/null; then
  echo "run-crc.sh: the current oc context cannot list OAuth access tokens, so the run's tokens could not be deleted" >&2
  exit 2
fi
RUN_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cleanup() {
  local rc=$?
  rm -rf "$AUTH_DIR"
  local names count
  if ! names=$(oc get oauthaccesstokens -o json | jq -r --arg since "$RUN_START" \
    ".items[] | select(.userName as \$u | [$LAB_USERS] | index(\$u))
      | select(.clientName == \"console\" or .metadata.creationTimestamp >= \$since) | .metadata.name"); then
    echo "run-crc.sh: FAILED to list the OAuth access tokens of the lab users; delete them by hand" >&2
    exit 3
  fi
  count=$(printf '%s' "$names" | grep -c . || true)
  if [ "$count" -gt 0 ] && ! printf '%s\n' "$names" | xargs -r oc delete oauthaccesstoken > /dev/null; then
    echo "run-crc.sh: FAILED to delete the OAuth access tokens of the lab users; delete them by hand" >&2
    exit 3
  fi
  echo "run-crc.sh: removed $AUTH_DIR; deleted $count OAuth access tokens of dev-a, dev-b and os-admin"
  exit "$rc"
}
trap cleanup EXIT

(
  set +x
  # shellcheck disable=SC1090
  . "$LAB_USERS_ENV"
  export E2E_PASSWORD_DEV_A="${dev_a_PASSWORD:?dev_a_PASSWORD is not set in LAB_USERS_ENV}"
  export E2E_PASSWORD_DEV_B="${dev_b_PASSWORD:?dev_b_PASSWORD is not set in LAB_USERS_ENV}"
  export E2E_PASSWORD_OS_ADMIN="${os_admin_PASSWORD:?os_admin_PASSWORD is not set in LAB_USERS_ENV}"
  unset dev_a_PASSWORD dev_b_PASSWORD os_admin_PASSWORD
  export BRIDGE_BASE_ADDRESS STUDIO_URL
  yarn playwright test "$@"
)
