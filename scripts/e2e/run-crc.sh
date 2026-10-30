#!/usr/bin/env bash
# Runs the end-to-end suite against a cluster's console as the lab users dev-a, dev-b and os-admin, by hand on a lab
# machine (never in CI). Arguments go to `yarn playwright test`, such as --project=locator-removed.
#
# Requires:
#   LAB_USERS_ENV        file defining dev_a_PASSWORD, dev_b_PASSWORD and os_admin_PASSWORD
#   BRIDGE_BASE_ADDRESS  the console URL, such as https://console-openshift-console.apps-crc.testing
#   STUDIO_URL           LibreDB Studio's https URL, the href of its console link
#   an oc context that may list and delete OAuth access tokens (a cluster administrator's)
# Optional: E2E_EVIDENCE_DIR (an absolute path outside the checkout: screenshots, request records and the run log,
#   beside the playwright/ folder that Playwright empties on each run), E2E_IDENTITY_PROVIDER.
#
# The passwords are read inside this process and passed to the test process only, never printed or put on a command
# line. The test process runs in a session of its own. On exit, whatever the result and also when this script is
# interrupted or terminated, it stops that process group first, deletes integration-tests/.auth/ (the users' console
# sessions) and the console OAuth access tokens of the three users, plus every other OAuth access token of theirs that
# did not exist before the run (by name, so no clock is compared), such as LibreDB Studio's sign-in, and prints only
# how many it deleted. It then fails if a token value reached E2E_EVIDENCE_DIR or integration-tests/results.
set -euo pipefail

: "${LAB_USERS_ENV:?set LAB_USERS_ENV to the file holding the lab users passwords}"
: "${BRIDGE_BASE_ADDRESS:?set BRIDGE_BASE_ADDRESS to the console URL}"
: "${STUDIO_URL:?set STUDIO_URL to LibreDB Studio https URL}"

ROOT=$(cd "$(dirname "$0")/../.." && pwd -P)
if [ -n "${E2E_EVIDENCE_DIR:-}" ]; then
  case "$E2E_EVIDENCE_DIR" in
    /*) ;;
    *) E2E_EVIDENCE_DIR_BAD=1 ;;
  esac
  case "$(realpath -m "$E2E_EVIDENCE_DIR")/" in
    "$ROOT"/*) E2E_EVIDENCE_DIR_BAD=1 ;;
  esac
  if [ -n "${E2E_EVIDENCE_DIR_BAD:-}" ]; then
    echo "run-crc.sh: E2E_EVIDENCE_DIR must be an absolute path outside the checkout" >&2
    exit 2
  fi
fi
cd "$ROOT"
AUTH_DIR=integration-tests/.auth
LAB_TOKENS='.items[] | select(.userName as $u | ["dev-a","dev-b","os-admin"] | index($u))'
# A token value as it could reach a file: an OAuth access token name or a bearer credential.
LEAK='sha256~[A-Za-z0-9_-]{8,}|Bearer [A-Za-z0-9._~+/=-]{8,}'

# Keeps token names out of anything this script prints.
scrub() {
  sed -E 's/sha256~[A-Za-z0-9_-]+/<token>/g'
}

# The token cleanup must be possible before anything signs in. The names of the users' tokens before the run stay in
# this process's memory only.
if ! BEFORE=$(oc get oauthaccesstokens -o json | jq -c "[$LAB_TOKENS | .metadata.name]"); then
  echo "run-crc.sh: the current oc context cannot list OAuth access tokens, so the run's tokens could not be deleted" >&2
  exit 2
fi

TEST_PID=
stop_tests() {
  if [ -z "$TEST_PID" ]; then
    return 0
  fi
  kill -TERM -- "-$TEST_PID" 2> /dev/null || return 0
  for _ in $(seq 1 30); do
    kill -0 -- "-$TEST_PID" 2> /dev/null || return 0
    sleep 1
  done
  kill -KILL -- "-$TEST_PID" 2> /dev/null || true
}

cleanup() {
  local rc=$?
  trap - HUP INT TERM
  local failed=0
  stop_tests
  rm -rf "$AUTH_DIR"
  local names count=0 err
  if ! names=$(oc get oauthaccesstokens -o json | jq -r --argjson before "$BEFORE" \
    "$LAB_TOKENS | select(.clientName == \"console\" or (.metadata.name as \$n | \$before | index(\$n) | not))
      | .metadata.name"); then
    echo "run-crc.sh: FAILED to list the OAuth access tokens of the lab users; delete them by hand" >&2
    failed=3
  else
    count=$(printf '%s' "$names" | grep -c . || true)
    if [ "$count" -gt 0 ]; then
      if ! err=$(printf '%s\n' "$names" | xargs -r oc delete oauthaccesstoken --ignore-not-found 2>&1 > /dev/null); then
        printf '%s\n' "$err" | scrub >&2
        echo "run-crc.sh: FAILED to delete the OAuth access tokens of the lab users; delete them by hand" >&2
        failed=3
      elif [ -n "$err" ]; then
        printf '%s\n' "$err" | scrub >&2
      fi
    fi
  fi
  if [ "$failed" -eq 0 ]; then
    echo "run-crc.sh: removed $AUTH_DIR; deleted $count OAuth access tokens of dev-a, dev-b and os-admin"
  fi
  local scanned=() dir leaks scan=0
  for dir in integration-tests/results "${E2E_EVIDENCE_DIR:-}"; do
    if [ -n "$dir" ] && [ -d "$dir" ]; then
      scanned+=("$dir")
    fi
  done
  if [ "${#scanned[@]}" -gt 0 ]; then
    leaks=$(grep -rlE "$LEAK" "${scanned[@]}") || scan=$?
    if [ "$scan" -eq 0 ]; then
      echo "run-crc.sh: FAILED: a token value is in these files; delete them before sharing anything:" >&2
      printf '  %s\n' "$leaks" >&2
      [ "$failed" -ne 0 ] || failed=4
    elif [ "$scan" -ne 1 ]; then
      echo "run-crc.sh: FAILED to scan ${scanned[*]} for token values" >&2
      [ "$failed" -ne 0 ] || failed=4
    fi
  fi
  if [ "$failed" -ne 0 ]; then
    exit "$failed"
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

(
  set +x
  # shellcheck disable=SC1090
  . "$LAB_USERS_ENV"
  export E2E_PASSWORD_DEV_A="${dev_a_PASSWORD:?dev_a_PASSWORD is not set in LAB_USERS_ENV}"
  export E2E_PASSWORD_DEV_B="${dev_b_PASSWORD:?dev_b_PASSWORD is not set in LAB_USERS_ENV}"
  export E2E_PASSWORD_OS_ADMIN="${os_admin_PASSWORD:?os_admin_PASSWORD is not set in LAB_USERS_ENV}"
  unset dev_a_PASSWORD dev_b_PASSWORD os_admin_PASSWORD
  export BRIDGE_BASE_ADDRESS STUDIO_URL
  exec setsid yarn playwright test "$@"
) &
TEST_PID=$!
wait "$TEST_PID"
