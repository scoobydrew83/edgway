#!/usr/bin/env bash
# The CPU-limit check that local tooling can't make: Cloudflare
# enforces Dynamic Worker limits only when deployed. Run once against a
# deployed admin and gateway (with the Worker Loader binding):
#
#   ADMIN_URL=https://admin.example.com GATEWAY_URL=https://gw.example.com \
#   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... tools/sandbox-smoke.sh
#
# It uploads a plugin that loops forever, attaches it to a new route, and
# publishes. The gateway must stop the plugin (500, fail-closed) within a few
# seconds, and a route without it must still answer. Everything it creates is
# deleted at the end, and the cleanup is published.
set -euo pipefail

: "${ADMIN_URL:?}" "${GATEWAY_URL:?}" "${CF_ACCESS_CLIENT_ID:?}" "${CF_ACCESS_CLIENT_SECRET:?}"
API="$ADMIN_URL/api/v1"
NAME="smoke-loop-$(date +%s)"

admin() {
  local method=$1 path=$2 body=${3:-}
  curl -fsS -X "$method" "$API$path" \
    -H "cf-access-client-id: $CF_ACCESS_CLIENT_ID" \
    -H "cf-access-client-secret: $CF_ACCESS_CLIENT_SECRET" \
    -H "content-type: application/json" \
    ${body:+--data "$body"}
}
id_of() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))'; }

CODE='export async function access() { for (;;) {} }'
PLUGIN=$(admin POST /sandbox_plugins "$(node -e 'console.log(JSON.stringify({name:process.argv[1],code:process.argv[2],cpu_ms:10}))' "$NAME" "$CODE")" | id_of)
SERVICE=$(admin POST /services "{\"name\":\"$NAME\",\"host\":\"example.com\",\"protocol\":\"https\"}" | id_of)
LOOP_ROUTE=$(admin POST /routes "{\"name\":\"$NAME-loop\",\"service_id\":\"$SERVICE\",\"paths\":[\"/$NAME/loop\"]}" | id_of)
PLAIN_ROUTE=$(admin POST /routes "{\"name\":\"$NAME-plain\",\"service_id\":\"$SERVICE\",\"paths\":[\"/$NAME/plain\"]}" | id_of)
INSTANCE=$(admin POST /plugins "{\"name\":\"$NAME\",\"route_id\":\"$LOOP_ROUTE\",\"config\":{}}" | id_of)
admin POST /config/publish >/dev/null

cleanup() {
  admin DELETE "/plugins/$INSTANCE" >/dev/null || true
  admin DELETE "/routes/$LOOP_ROUTE" >/dev/null || true
  admin DELETE "/routes/$PLAIN_ROUTE" >/dev/null || true
  admin DELETE "/services/$SERVICE" >/dev/null || true
  admin DELETE "/sandbox_plugins/$PLUGIN" >/dev/null || true
  admin POST /config/publish >/dev/null || true
}
trap cleanup EXIT

# The gateway picks up the new version within about a second.
sleep 5
start=$(date +%s)
loop=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$GATEWAY_URL/$NAME/loop")
took=$(($(date +%s) - start))
plain=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$GATEWAY_URL/$NAME/plain")
echo "loop route: $loop in ${took}s; plain route: $plain"
[ "$loop" = "500" ] && [ "$took" -le 10 ] && [ "$plain" != "500" ] && [ "$plain" != "000" ]
