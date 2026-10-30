#!/usr/bin/env bash

# Runs the OpenShift console in a container against the cluster of the current oc context, with sign-in disabled, and
# loads this plugin from the dev server `yarn start` runs on port 9001. For development only: the console acts with the
# bearer token it is given, so it listens on 127.0.0.1 only. Preset BRIDGE_K8S_AUTH_BEARER_TOKEN to a short-lived token
# of a view-only account; without it the script takes the oc context's own token, never use a cluster-admin one.

set -euo pipefail

CONSOLE_IMAGE=${CONSOLE_IMAGE:="quay.io/openshift/origin-console:latest"}
CONSOLE_PORT=${CONSOLE_PORT:=9000}
CONSOLE_IMAGE_PLATFORM=${CONSOLE_IMAGE_PLATFORM:="linux/amd64"}

# The consolePlugin name in package.json.
PLUGIN_NAME="libredb-studio"

echo "Starting local OpenShift console..."

BRIDGE_USER_AUTH="disabled"
BRIDGE_K8S_MODE="off-cluster"
BRIDGE_K8S_AUTH="bearer-token"
BRIDGE_K8S_MODE_OFF_CLUSTER_SKIP_VERIFY_TLS=true
BRIDGE_K8S_MODE_OFF_CLUSTER_ENDPOINT=$(oc whoami --show-server)
# The monitoring operator is not always installed (e.g. for local OpenShift). Tolerate missing config maps.
set +e
BRIDGE_K8S_MODE_OFF_CLUSTER_THANOS=$(oc -n openshift-config-managed get configmap monitoring-shared-config -o jsonpath='{.data.thanosPublicURL}' 2>/dev/null)
BRIDGE_K8S_MODE_OFF_CLUSTER_ALERTMANAGER=$(oc -n openshift-config-managed get configmap monitoring-shared-config -o jsonpath='{.data.alertmanagerPublicURL}' 2>/dev/null)
set -e
if [ -z "${BRIDGE_K8S_AUTH_BEARER_TOKEN:-}" ]; then
    BRIDGE_K8S_AUTH_BEARER_TOKEN=$(oc whoami --show-token 2>/dev/null)
fi
BRIDGE_USER_SETTINGS_LOCATION="localstorage"
BRIDGE_I18N_NAMESPACES="plugin__${PLUGIN_NAME}"

# Don't fail if the cluster doesn't have gitops.
set +e
GITOPS_HOSTNAME=$(oc -n openshift-gitops get route cluster -o jsonpath='{.spec.host}' 2>/dev/null)
set -e
if [ -n "$GITOPS_HOSTNAME" ]; then
    BRIDGE_K8S_MODE_OFF_CLUSTER_GITOPS="https://$GITOPS_HOSTNAME"
fi

echo "API Server: $BRIDGE_K8S_MODE_OFF_CLUSTER_ENDPOINT"
echo "Console Image: $CONSOLE_IMAGE"
echo "Console URL: http://127.0.0.1:${CONSOLE_PORT}"
echo "Console Platform: $CONSOLE_IMAGE_PLATFORM"

# Prefer podman if installed. Otherwise, fall back to docker.
if [ -x "$(command -v podman)" ]; then
    RUNTIME=podman
    HOST_ALIAS=host.containers.internal
else
    RUNTIME=docker
    HOST_ALIAS=host.docker.internal
fi

# The variables reach the container through the env file, never on the command line.
if [ "$(uname -s)" = "Linux" ]; then
    # Host networking on Linux: the container reads the host's /etc/hosts and reaches a cluster API on the host's
    # loopback, and a published port would bypass the host firewall on every interface, so the console binds 127.0.0.1.
    BRIDGE_LISTEN="http://127.0.0.1:${CONSOLE_PORT}"
    BRIDGE_PLUGINS="${PLUGIN_NAME}=http://localhost:9001"
    "$RUNTIME" run --pull always --platform "$CONSOLE_IMAGE_PLATFORM" --rm --network=host --env-file <(set | grep BRIDGE) "$CONSOLE_IMAGE"
else
    BRIDGE_PLUGINS="${PLUGIN_NAME}=http://${HOST_ALIAS}:9001"
    "$RUNTIME" run --pull always --platform "$CONSOLE_IMAGE_PLATFORM" --rm -p "127.0.0.1:${CONSOLE_PORT}:9000" --env-file <(set | grep BRIDGE) "$CONSOLE_IMAGE"
fi
