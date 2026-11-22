#!/bin/bash
# Runs every mapped feature journey against one scaffold server.
# Usage: RUN_ID=<id> VERIFY_MAILSY_PORT=<port> ./scripts/run-all.sh
# Exit 0 only when every feature in features/ passes.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$HERE")"
export RUN_ID="${RUN_ID:-run-$(date +%s)}"
export VERIFY_MAILSY_PORT="${VERIFY_MAILSY_PORT:-4317}"
ART="$SKILL_DIR/artifacts/$RUN_ID"
mkdir -p "$ART"

"$HERE/serve.sh" start || exit 2
trap '"$HERE/serve.sh" stop >/dev/null' EXIT

failed=()
for file in "$SKILL_DIR"/features/*.md; do
  feature="$(basename "$file" .md)"
  [ "$feature" = "README" ] && continue
  flags=()
  [ "$feature" = "sign-in" ] && flags+=(--signed-out)
  if timeout 180 node "$HERE/drive.mjs" --feature "$feature" --run-id "$RUN_ID" \
    --port "$VERIFY_MAILSY_PORT" "${flags[@]}" >"$ART/$feature.stdout" 2>&1; then
    echo "pass $feature"
  else
    echo "FAIL $feature"
    tail -n 5 "$ART/$feature.stdout"
    failed+=("$feature")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "${#failed[@]} feature(s) failed: ${failed[*]}"
  exit 1
fi
echo "all features passed"
