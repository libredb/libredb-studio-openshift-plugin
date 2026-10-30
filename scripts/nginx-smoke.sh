#!/usr/bin/env bash
# Smoke test of the plugin image: it serves the plugin manifest and entry script over TLS with a JavaScript content
# type while running with a read-only root, and its log holds no bearer token, cookie, Basic user or query string.
# The console forwards each user's bearer token on every asset fetch to this server, so the log check is the point.
# Usage: scripts/nginx-smoke.sh <image>
set -euo pipefail

image=${1:?usage: scripts/nginx-smoke.sh <image>}
workdir=$(mktemp -d -t nginx-smoke.XXXXXXXX)
container=""

cleanup() {
  if [ -n "$container" ]; then
    docker rm -f "$container" > /dev/null 2>&1 || true
  fi
  rm -rf "$workdir"
}
trap cleanup EXIT

fail() {
  echo "FAIL $*" >&2
  if [ -n "$container" ]; then
    echo "--- container log" >&2
    docker logs "$container" >&2 2>&1 || true
  fi
  exit 1
}
pass() { echo "PASS $*"; }

user=$(docker image inspect --format '{{.Config.User}}' "$image")
[ "$user" = 1001 ] || fail "image user is '$user', not 1001"
pass "image user 1001"

# A throwaway certificate for localhost. OpenSSL 3 writes the key 0600 for the invoking user, while the image runs as
# 1001, so the key and its directory are made readable before they are mounted.
cert="$workdir/cert"
mkdir "$cert"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost \
  -keyout "$cert/tls.key" -out "$cert/tls.crt" 2> /dev/null
chmod 0755 "$cert"
chmod 0644 "$cert/tls.key" "$cert/tls.crt"

# A pod's network namespace has IPv6, which the [::] listen needs; Docker turns it off unless asked.
container=$(docker run --detach --read-only --tmpfs /tmp --sysctl net.ipv6.conf.all.disable_ipv6=0 \
  --cap-drop ALL --security-opt no-new-privileges \
  -v "$cert:/var/cert:ro" -p 127.0.0.1::9443 "$image")
port=$(docker port "$container" 9443/tcp | head -n 1)
port=${port##*:}
base="https://localhost:$port"
tls=(--silent --show-error --max-time 10 --cacert "$cert/tls.crt" --resolve "localhost:$port:127.0.0.1")

# fetch <path> [curl options]: writes the body to $workdir/body and prints "<status> <content type>".
fetch() {
  local target=$1
  shift
  curl "${tls[@]}" -o "$workdir/body" -w '%{http_code} %{content_type}' "$@" "$base/$target"
}

manifest_requests=0
ready=""
for _ in $(seq 1 30); do
  if result=$(fetch plugin-manifest.json 2> /dev/null); then
    manifest_requests=$((manifest_requests + 1))
    ready=yes
    break
  fi
  sleep 1
done
[ -n "$ready" ] || fail "manifest: the server did not answer on $base within 30 seconds"

[ "$result" = "200 application/json" ] || fail "manifest answered '$result', not '200 application/json'"
pass "manifest $result"

entry=$(jq -r '.loadScripts[0] // empty' "$workdir/body")
[[ "$entry" =~ ^plugin-entry\.[A-Za-z0-9.]+\.js$ ]] || fail "entry: the manifest names no plugin-entry script ('$entry')"
result=$(fetch "$entry")
case "$result" in
  "200 application/javascript" | "200 text/javascript") pass "entry $entry $result" ;;
  *) fail "entry $entry answered '$result', not 200 with a JavaScript content type" ;;
esac

result=$(fetch plugin-manifest.json --tlsv1.3)
[ "${result%% *}" = 200 ] || fail "TLS 1.3: the manifest answered '$result'"
manifest_requests=$((manifest_requests + 1))
pass "TLS 1.3"

# Requests that carry a token in each place a client can put one: an Authorization header, a cookie, a query string
# and a Basic user. None of the random values may reach the log.
bearer=$(openssl rand -hex 16)
cookie=$(openssl rand -hex 16)
query=$(openssl rand -hex 16)
basic=$(openssl rand -hex 16)
result=$(fetch "plugin-manifest.json?token=$query" \
  -H "Authorization: Bearer sha256~not-a-real-token-$bearer" -H "Cookie: openshift-session-token=$cookie")
[ "${result%% *}" = 200 ] || fail "manifest with a token answered '$result'"
result=$(fetch plugin-manifest.json -u "user-$basic:not-a-real-password")
[ "${result%% *}" = 200 ] || fail "manifest with a Basic user answered '$result'"
manifest_requests=$((manifest_requests + 2))

# A count of zero token matches proves nothing unless the requests were logged, so wait for every manifest request
# this script sent to appear first. A line counts whatever follows the path, so a server that logs the query string or
# the full request line fails the token check below rather than this count.
log="$workdir/log"
logged=0
for _ in $(seq 1 10); do
  docker logs "$container" > "$log" 2>&1
  logged=$(grep -c -E '"GET /plugin-manifest\.json[?" ]' "$log" || true)
  [ "$logged" -ge "$manifest_requests" ] && break
  sleep 1
done
[ "$logged" -ge "$manifest_requests" ] ||
  fail "requests logged: $logged \"GET /plugin-manifest.json\" lines for $manifest_requests requests"
pass "requests logged ($logged manifest requests)"

for value in "$bearer" "$cookie" "$query" "$basic" 'sha256~' 'Bearer' 'token='; do
  if grep -q -i -F -- "$value" "$log"; then
    fail "token in the log: the log holds a value a request carried"
  fi
done
pass "no token in the log"

if grep -q -E '\[(emerg|alert)\]' "$log"; then
  fail "emerg or alert in the log"
fi
pass "no emerg or alert in the log"
