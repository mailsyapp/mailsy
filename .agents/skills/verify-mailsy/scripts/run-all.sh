#!/bin/bash
# Runs every mapped journey against the scaffold or a packaged executable.
# Usage: RUN_ID=<id> ./scripts/run-all.sh [--executable <packaged-binary>]
# Exit 0 only when every feature in features/ passes.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$HERE")"
EXECUTABLE=""
if [ "$#" -gt 0 ]; then
  if [ "$#" -ne 2 ] || [ "$1" != --executable ] || [ -z "$2" ]; then
    echo "usage: run-all.sh [--executable <packaged-binary>]" >&2
    exit 2
  fi
  EXECUTABLE="$2"
fi
export RUN_ID="${RUN_ID:-run-$(date +%s)}"
export VERIFY_MAILSY_PORT="${VERIFY_MAILSY_PORT:-4317}"
ART="$SKILL_DIR/artifacts/$RUN_ID"
mkdir -p "$ART"

if [ -n "$EXECUTABLE" ]; then
  "$HERE/doctor.sh" --executable "$EXECUTABLE" > "$ART/doctor.log" || exit 2
else
  "$HERE/serve.sh" start || exit 2
  trap '"$HERE/serve.sh" stop >/dev/null' EXIT
fi

failed=()
for file in "$SKILL_DIR"/features/*.md; do
  feature="$(basename "$file" .md)"
  [ "$feature" = "README" ] && continue
  flags=()
  [ "$feature" = "sign-in" ] && flags+=(--signed-out)
  feature_run_id="$RUN_ID"
  if [ -n "$EXECUTABLE" ]; then
    feature_run_id="$RUN_ID-$feature"
    flags+=(--executable "$EXECUTABLE")
  else
    flags+=(--port "$VERIFY_MAILSY_PORT")
  fi
  if timeout 180 node "$HERE/drive.mjs" --feature "$feature" --run-id "$feature_run_id" \
    "${flags[@]}" >"$ART/$feature.stdout" 2>&1; then
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
