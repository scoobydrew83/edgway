#!/usr/bin/env bash
# decK against the Kong-compatible admin mount. The same script runs in CI
# (.github/workflows/kong-compat.yml).
#
# Reads: seed a local D1 with examples/deck/demo.yaml's entities, run
# the admin Worker with `wrangler dev`; `deck gateway dump` must succeed and
# `deck gateway diff` of demo.yaml must report no changes.
#
# Writes: reset the admin, `deck gateway sync examples/deck/*.yaml`,
# then `deck gateway diff` must be empty; publish, and the gateway Worker
# (sharing the local KV) serves the synced routes. Then every file under
# examples/deck/kong-samples/ is synced into an empty admin: more than 90% of
# their entities must sync (no longer listed by `deck gateway diff`), not
# counting the ones Edgway refuses by design (raw certificate keys).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DECK_VERSION="1.49.2"
# From the release's checksums.txt (deck_1.49.2_linux_amd64.tar.gz).
DECK_SHA256="2d43ef9d57bdaf58ca2f2f08aa47c3cf9c6a4afe80d791643e1602b474694d0f"
DECK_DIR="$ROOT/apps/admin/.deck/deck-$DECK_VERSION"
DECK="$DECK_DIR/deck"
PORT="${PORT:-8787}"
GATEWAY_PORT="${GATEWAY_PORT:-8788}"
ADDR="http://127.0.0.1:$PORT"
GATEWAY="http://127.0.0.1:$GATEWAY_PORT"
MIN_RATIO="0.90"
# Entities Edgway refuses by design: certificates with a raw
# private key (keys must be vault references) and their SNIs. Reported, left
# out of the ratio, and capped so nothing new hides there.
MAX_EXCLUDED=8

if [ ! -x "$DECK" ]; then
  mkdir -p "$DECK_DIR"
  TARBALL="$DECK_DIR/deck.tar.gz"
  curl -fsSLo "$TARBALL" "https://github.com/Kong/deck/releases/download/v$DECK_VERSION/deck_${DECK_VERSION}_linux_amd64.tar.gz"
  # Refuse a download that isn't the pinned release.
  echo "$DECK_SHA256  $TARBALL" | sha256sum -c - || { rm -f "$TARBALL"; exit 1; }
  tar xzf "$TARBALL" -C "$DECK_DIR" deck
  rm -f "$TARBALL"
fi
"$DECK" version

STATE="$(mktemp -d)"
ADMIN="$ROOT/apps/admin"
cd "$ADMIN"
pnpm exec wrangler d1 migrations apply edgway-admin --local --persist-to "$STATE"
pnpm exec wrangler d1 execute edgway-admin --local --persist-to "$STATE" \
  --file test/fixtures/demo.sql

# Throwaway tokens (the Worker only ever sees their SHA-256) and a throwaway
# snapshot signing pair (the admin's secret, the gateway's public key).
token() { echo "kong-e2e-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"; }
sha() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
READER="$(token)"
WRITER="$(token)"
TOKENS="{\"$(sha "$READER")\":\"viewer\",\"$(sha "$WRITER")\":\"publisher\"}"
KEYS="$(node -e '
  const { subtle } = globalThis.crypto;
  subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]).then(async (k) =>
    console.log(JSON.stringify({
      private: await subtle.exportKey("jwk", k.privateKey),
      public: await subtle.exportKey("jwk", k.publicKey),
    })));')"
PRIVATE_JWK="$(node -e 'console.log(JSON.stringify(JSON.parse(process.argv[1]).private))' "$KEYS")"
PUBLIC_JWK="$(node -e 'console.log(JSON.stringify(JSON.parse(process.argv[1]).public))' "$KEYS")"

pnpm exec wrangler dev --port "$PORT" --inspector-port 0 --persist-to "$STATE" \
  --var "KONG_ADMIN_TOKENS:$TOKENS" --var "CONFIG_SIGNING_KEY:$PRIVATE_JWK" \
  > "$STATE/admin.log" 2>&1 &
PIDS=($!)
trap 'kill "${PIDS[@]}" 2>/dev/null || true' EXIT

wait_for() { # url, header
  for _ in $(seq 1 60); do
    if curl -fs -H "$2" "$1" > /dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
wait_for "$ADDR/status" "Kong-Admin-Token: $READER" || { cat "$STATE/admin.log"; exit 1; }

READ=(--kong-addr "$ADDR" --headers "Kong-Admin-Token:$READER")
WRITE=(--kong-addr "$ADDR" --headers "Kong-Admin-Token:$WRITER")

echo "== reads: dump and diff the seeded demo config"
"$DECK" gateway dump "${READ[@]}" -o "$STATE/dump.yaml" --yes
cat "$STATE/dump.yaml"
# Exits non-zero when the file and the admin's state differ.
"$DECK" gateway diff "$ROOT/examples/deck/demo.yaml" "${READ[@]}" --non-zero-exit-code

echo "== online validation: every entity checked by the admin's /schemas/*/validate"
# A viewer token: validating writes nothing.
"$DECK" gateway validate "$ROOT"/examples/deck/*.yaml "${READ[@]}"
# key-sets and keys feed Kong Enterprise plugins (jwt-signer, openid-connect
# JWKs), not the OSS jwt plugin: Edgway stores none. decK's validate
# skips them; a sync of one fails, naming it, instead of syncing to nothing.
# --select-tag keeps the sync to the tagged key-set: nothing else is touched.
printf '_format_version: "3.0"\nkey_sets:\n  - name: signing\n    tags: [edgway-e2e-key-sets]\n' > "$STATE/key-sets.yaml"
if KEY_SETS="$("$DECK" gateway sync "$STATE/key-sets.yaml" --select-tag edgway-e2e-key-sets "${WRITE[@]}" 2>&1)"; then
  echo "decK synced key_sets: $KEY_SETS"
  exit 1
fi
echo "$KEY_SETS" | grep -qi "key.set" || { echo "$KEY_SETS"; exit 1; }
echo "$KEY_SETS" | tail -3
echo "key_sets refused: ok"

echo "== writes: reset, sync examples/deck/*.yaml, diff, publish"
"$DECK" gateway reset "${WRITE[@]}" --force
"$DECK" gateway sync "$ROOT"/examples/deck/*.yaml "${WRITE[@]}"
"$DECK" gateway diff "$ROOT"/examples/deck/*.yaml "${READ[@]}" --non-zero-exit-code
curl -fsS -X POST -H "Kong-Admin-Token: $WRITER" "$ADDR/edgway/publish"
echo

cd "$ROOT/apps/gateway"
# --local: no remote bindings (Workers AI is remote-only and needs an API
# token; the decK routes don't use it).
pnpm exec wrangler dev --local --port "$GATEWAY_PORT" --inspector-port 0 --persist-to "$STATE" \
  --var "CONFIG_PUBLIC_KEY:$PUBLIC_JWK" > "$STATE/gateway.log" 2>&1 &
PIDS+=($!)
wait_for "$GATEWAY/__edgway/health" "Accept: application/json" || { cat "$STATE/gateway.log"; exit 1; }
# demo.yaml's key-auth guards /demo/httpbin: without a key the gateway answers 401.
STATUS=""
for _ in $(seq 1 30); do
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$GATEWAY/demo/httpbin")"
  [ "$STATUS" = "401" ] && break
  sleep 1
done
echo "gateway GET /demo/httpbin without a key: $STATUS"
[ "$STATUS" = "401" ] || { cat "$STATE/gateway.log"; exit 1; }

echo "== corpus: sync each examples/deck/kong-samples file"
# Entities in a file: every object in a list under an entity key, nested or not.
count() {
  node -e 'process.stdout.write(JSON.stringify(require("yaml").parse(require("fs").readFileSync(process.argv[1], "utf8"))))' "$1" \
    | jq '[.. | objects | to_entries[]
          | select(.key | IN("services", "routes", "plugins", "consumers",
              "consumer_groups", "groups", "upstreams", "targets", "certificates",
              "ca_certificates", "snis", "vaults", "keyauth_credentials",
              "basicauth_credentials", "jwt_secrets", "acls", "hmacauth_credentials",
              "mtls_auth_credentials", "oauth2_credentials"))
          | .value | arrays | map(objects) | length] | add // 0'
}
# Entities refused by design: a certificate whose key isn't a vault
# reference, and the SNIs nested in it.
excluded() {
  node -e 'process.stdout.write(JSON.stringify(require("yaml").parse(require("fs").readFileSync(process.argv[1], "utf8"))))' "$1" \
    | jq '[.. | objects | select(has("certificates")) | .certificates
          | arrays | .[] | objects
          | select((.key // "") | startswith("{vault://") | not)
          | 1 + ((.snis // []) | arrays | length)] | add // 0'
}
# Entities `deck gateway diff` would still create or update, plus the ones it
# reports as errors (rejected entities are left out of its summary).
pending() {
  "$DECK" gateway diff "$1" "${READ[@]}" --json-output --no-color 2>/dev/null \
    | jq '.summary.creating + .summary.updating + (.errors // [] | length)' || echo -1
}
renders() { "$DECK" file render "$1" > /dev/null 2>&1; }
# Reset, sync the given files in order, and print the last one's pending count.
attempt() {
  "$DECK" gateway reset "${WRITE[@]}" --force > /dev/null
  for f in "$@"; do
    "$DECK" gateway sync "$f" "${WRITE[@]}" > "$STATE/sync.log" 2>&1 || true
  done
  pending "${@: -1}"
}
TOTAL=0
SYNCED=0
EXCLUDED=0
while IFS= read -r file; do
  entities="$(count "$file")"
  if renders "$file"; then
    left="$(attempt "$file")"
  else
    # A file that looks up entities by tag syncs on top of a sibling from its
    # case (decK's own tests do the same); the best sibling counts.
    left=-1
    for base in "$(dirname "$file")"/*.yaml; do
      { [ "$base" != "$file" ] && renders "$base"; } || continue
      try="$(attempt "$base" "$file")"
      if [ "$try" -ge 0 ] && { [ "$left" -lt 0 ] || [ "$try" -lt "$left" ]; }; then
        left="$try"
      fi
    done
  fi
  if [ "$left" -lt 0 ] || [ "$left" -gt "$entities" ]; then left="$entities"; fi
  # By-design refusals are among the ones left: out of the count.
  excl="$(excluded "$file")"
  if [ "$excl" -gt "$left" ]; then excl="$left"; fi
  EXCLUDED=$((EXCLUDED + excl))
  entities=$((entities - excl))
  left=$((left - excl))
  TOTAL=$((TOTAL + entities))
  SYNCED=$((SYNCED + entities - left))
  echo "${file#"$ROOT"/}: $((entities - left))/$entities"
done < <(find "$ROOT/examples/deck/kong-samples" -name '*.yaml' | sort)
echo "excluded by design (raw certificate keys): $EXCLUDED"
if [ "$EXCLUDED" -gt "$MAX_EXCLUDED" ]; then
  echo "more than $MAX_EXCLUDED entities excluded by design" >&2
  exit 1
fi
echo "corpus: $SYNCED of $TOTAL entities synced"
awk -v s="$SYNCED" -v t="$TOTAL" -v m="$MIN_RATIO" \
  'BEGIN { r = t ? s / t : 0; printf "ratio: %.1f%%\n", r * 100; exit r > m ? 0 : 1 }'
