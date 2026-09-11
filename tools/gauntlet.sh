#!/usr/bin/env bash
set -euo pipefail

EXPECTED_LAYERS=12
COMPLETED_LAYERS=0

check_cli_contract() {
  local config_dir exit_code
  config_dir="$(mktemp -d)"
  set +e
  XDG_CONFIG_HOME="$config_dir" env -u KANBY_TOKEN \
    node packages/cli/bin/kanby.js auth status >/dev/null 2>&1
  exit_code=$?
  set -e
  rmdir "$config_dir"
  [[ "$exit_code" -eq 2 ]]
}

run_layer() {
  local name="$1"
  shift
  echo "[gauntlet] ${name}"
  "$@"
  COMPLETED_LAYERS=$((COMPLETED_LAYERS + 1))
}

rm -rf coverage
run_layer "unit, integration, property, concurrency" npm test
run_layer "changed-code coverage" npm run test:coverage
run_layer "TypeScript" npx tsc --noEmit
run_layer "lint" npm run lint
run_layer "format" npm run format:check
run_layer "mutation testing" npm run test:mutations
run_layer "production dependency audit" npm audit --omit=dev --audit-level=high
run_layer "secret scan with negative control" node tools/check-secrets.mjs
run_layer "CLI unauthenticated exit contract" check_cli_contract
run_layer "randomized suite order" npx vitest run --sequence.shuffle --sequence.seed=9082026
run_layer "Worker production build" npm run build
run_layer "Worker recovery schedule" node tools/check-worker-schedule.mjs

if [[ "$COMPLETED_LAYERS" -ne "$EXPECTED_LAYERS" ]]; then
  echo "Gauntlet manifest mismatch: ${COMPLETED_LAYERS}/${EXPECTED_LAYERS}" >&2
  exit 1
fi

echo "GAUNTLET PASS: ${COMPLETED_LAYERS}/${EXPECTED_LAYERS} layers"
