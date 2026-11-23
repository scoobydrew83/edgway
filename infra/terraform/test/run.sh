#!/usr/bin/env bash
# The check, run by .github/workflows/terraform.yml and locally:
# start a local admin, then `terraform init`, `plan` and `apply` the Kong
# example (Kong's provider plus the Edgway module), and require a second
# `plan` to show no changes. Needs `terraform` on PATH (or TERRAFORM=...).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tf="${TERRAFORM:-terraform}"
work="$(mktemp -d)"
# wrangler bundles the admin under apps/admin/.wrangler/tmp; what this run
# adds there is removed when it ends (the i18n gate lints the repo).
bundles="$here/../../../apps/admin/.wrangler/tmp"
mkdir -p "$bundles"
before="$(ls "$bundles")"
cleanup() {
  kill "${admin_pid:-}" 2>/dev/null || true
  wait "${admin_pid:-}" 2>/dev/null || true
  for entry in $(ls "$bundles"); do
    grep -qxF "$entry" <<<"$before" || rm -rf "${bundles:?}/$entry"
  done
  rm -rf "$work"
}
trap cleanup EXIT

# A copy of the configuration: Terraform's state and plugin cache stay out of the repo.
cp -r "$here/../modules" "$here/../examples" "$work/"
vars="$work/admin.tfvars.json"

node "$here/local-admin.mjs" "$vars" "$work/admin-state" &
admin_pid=$!
for _ in $(seq 1 120); do
  [ -s "$vars" ] && break
  kill -0 "$admin_pid" 2>/dev/null || { echo "the local admin exited" >&2; exit 1; }
  sleep 1
done
[ -s "$vars" ] || { echo "the local admin did not start" >&2; exit 1; }

cd "$work/examples/kong"
"$tf" init -input=false -no-color
"$tf" plan -input=false -no-color -var-file="$vars" -out=plan.out
"$tf" apply -input=false -no-color plan.out

# A second plan must be empty: exit code 0 (2 means changes, 1 an error).
set +e
"$tf" plan -input=false -no-color -var-file="$vars" -detailed-exitcode
status=$?
set -e
if [ "$status" -ne 0 ]; then
  echo "second plan was not empty (exit $status)" >&2
  exit 1
fi
echo "terraform: applied, and a second plan shows no changes"
