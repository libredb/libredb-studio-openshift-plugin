#!/usr/bin/env bash
# Runs the dev-lane project (R-51): the plugin's dev server (`yarn start`) and a development console
# (start-console.sh) on 127.0.0.1 only, the console acting with a one-hour token of a ServiceAccount that may only view
# one namespace, never a cluster administrator's token. By hand on a lab machine, never in CI. Arguments go to
# `yarn playwright test`.
#
# Requires:
#   CONSOLE_IMAGE  the console image to run, such as quay.io/openshift/origin-console:4.22
#   an oc context that may create a namespace and a RoleBinding (the lab's os-admin); start-console.sh also reads the
#   API server URL from it
# Optional: DEV_LANE_NAMESPACE (default os-lab-devlane), DEV_LANE_VIEW_NAMESPACE (default team-a),
#   E2E_EVIDENCE_DIR (an absolute path outside the checkout; gets dev-lane-ss.txt, the listening sockets of ports 9000
#   and 9001, beside the playwright/ folder that Playwright empties on each run).
#
# The ServiceAccount's namespace, which ends the token, then its RoleBinding are deleted on exit, whatever the result;
# a cleanup step that fails does not stop the others, and the script then exits 3 naming what is left. The token is
# passed to start-console.sh in its environment only and never printed.
set -euo pipefail

: "${CONSOLE_IMAGE:?set CONSOLE_IMAGE to the console image to run}"
NAMESPACE=${DEV_LANE_NAMESPACE:-os-lab-devlane}
VIEW_NAMESPACE=${DEV_LANE_VIEW_NAMESPACE:-team-a}
ACCOUNT=devlane
BINDING=devlane-view
CONSOLE_PORT=9000
PLUGIN_PORT=9001

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
    echo "run-dev-lane.sh: E2E_EVIDENCE_DIR must be an absolute path outside the checkout" >&2
    exit 2
  fi
fi
cd "$ROOT"
# start-console.sh hands every BRIDGE_ variable of its shell to the console, so the suite's console URL stays out.
unset BRIDGE_BASE_ADDRESS BRIDGE_K8S_AUTH_BEARER_TOKEN

if oc get namespace "$NAMESPACE" > /dev/null 2>&1; then
  echo "run-dev-lane.sh: namespace $NAMESPACE exists; delete it (a previous lane's leftover) before a new run" >&2
  exit 2
fi
if [ -n "$(docker ps -q --filter "ancestor=$CONSOLE_IMAGE")" ]; then
  echo "run-dev-lane.sh: a container of $CONSOLE_IMAGE is already running; stop it first" >&2
  exit 2
fi

LOGS=$(mktemp -d)
SERVER_PID=
CONSOLE_PID=
cleanup() {
  local rc=$?
  local left=()
  for pid in "$CONSOLE_PID" "$SERVER_PID"; do
    if [ -n "$pid" ]; then
      kill -- "-$pid" 2> /dev/null || true
    fi
  done
  # Deleting the namespace ends the token, so it goes first and nothing before it can stop it.
  if ! oc delete namespace "$NAMESPACE" --ignore-not-found --wait=true > /dev/null; then
    left+=("namespace $NAMESPACE")
    echo "run-dev-lane.sh: FAILED to delete namespace $NAMESPACE; its ServiceAccount token stays valid until it is deleted" >&2
  fi
  if ! oc delete rolebinding "$BINDING" -n "$VIEW_NAMESPACE" --ignore-not-found > /dev/null; then
    left+=("rolebinding $BINDING in $VIEW_NAMESPACE")
    echo "run-dev-lane.sh: FAILED to delete rolebinding $BINDING in $VIEW_NAMESPACE" >&2
  fi
  # The console runs with --rm and may have removed itself once its process group was killed, so a failed stop of a
  # container that is gone afterwards leaves nothing behind; only a container still listed counts.
  local containers
  if containers=$(docker ps -q --filter "ancestor=$CONSOLE_IMAGE"); then
    if [ -n "$containers" ]; then
      docker stop $containers > /dev/null 2>&1 || true
      if ! containers=$(docker ps -q --filter "ancestor=$CONSOLE_IMAGE") || [ -n "$containers" ]; then
        left+=("the console container of $CONSOLE_IMAGE")
        echo "run-dev-lane.sh: FAILED to stop the console container of $CONSOLE_IMAGE" >&2
      fi
    fi
  else
    left+=("possibly the console container of $CONSOLE_IMAGE")
    echo "run-dev-lane.sh: FAILED to list the containers of $CONSOLE_IMAGE" >&2
  fi
  rm -rf "$LOGS"
  if [ "${#left[@]}" -gt 0 ]; then
    local IFS=';'
    echo "run-dev-lane.sh: cleanup incomplete, delete by hand: ${left[*]}" >&2
    exit 3
  fi
  echo "run-dev-lane.sh: stopped the dev server and the console; deleted namespace $NAMESPACE and rolebinding $BINDING in $VIEW_NAMESPACE"
  exit "$rc"
}
trap cleanup EXIT

oc create namespace "$NAMESPACE" > /dev/null
oc create serviceaccount "$ACCOUNT" -n "$NAMESPACE" > /dev/null
oc create rolebinding "$BINDING" -n "$VIEW_NAMESPACE" --clusterrole=view \
  --serviceaccount="$NAMESPACE:$ACCOUNT" > /dev/null
if oc get consolelink libredb-studio > /dev/null 2>&1; then
  LOCATOR=present
else
  LOCATOR=absent
fi

wait_for() {
  local url=$1 name=$2
  for _ in $(seq 1 180); do
    if curl -fsS -o /dev/null "$url" 2> /dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "run-dev-lane.sh: $name did not answer at $url within 180 seconds" >&2
  return 1
}

setsid yarn start > "$LOGS/dev-server.log" 2>&1 &
SERVER_PID=$!
wait_for "http://127.0.0.1:$PLUGIN_PORT/plugin-manifest.json" "the dev server"

(
  BRIDGE_K8S_AUTH_BEARER_TOKEN=$(oc create token "$ACCOUNT" -n "$NAMESPACE" --duration=1h)
  export BRIDGE_K8S_AUTH_BEARER_TOKEN CONSOLE_IMAGE
  exec setsid ./start-console.sh > "$LOGS/console.log" 2>&1
) &
CONSOLE_PID=$!
if ! wait_for "http://127.0.0.1:$CONSOLE_PORT/" "the console"; then
  tail -n 20 "$LOGS/console.log" >&2
  exit 1
fi

SOCKETS=$(ss -ltnp | grep -E ":($CONSOLE_PORT|$PLUGIN_PORT)\b" || true)
if [ -n "${E2E_EVIDENCE_DIR:-}" ]; then
  mkdir -p "$E2E_EVIDENCE_DIR"
  printf '%s\n' "$SOCKETS" > "$E2E_EVIDENCE_DIR/dev-lane-ss.txt"
fi
printf '%s\n' "$SOCKETS"
LOCAL=$(printf '%s\n' "$SOCKETS" | awk 'NF {print $4}')
if ! printf '%s\n' "$LOCAL" | grep -qx "127.0.0.1:$CONSOLE_PORT" \
  || ! printf '%s\n' "$LOCAL" | grep -qx "127.0.0.1:$PLUGIN_PORT" \
  || printf '%s\n' "$LOCAL" | grep -qvE "^127\.0\.0\.1:($CONSOLE_PORT|$PLUGIN_PORT)$"; then
  echo "run-dev-lane.sh: ports $CONSOLE_PORT and $PLUGIN_PORT must listen on 127.0.0.1 only" >&2
  exit 1
fi

E2E_DEV_LANE=1 E2E_DEV_LANE_LOCATOR=$LOCATOR BRIDGE_BASE_ADDRESS="http://127.0.0.1:$CONSOLE_PORT" \
  yarn playwright test --project=dev-lane "$@"
