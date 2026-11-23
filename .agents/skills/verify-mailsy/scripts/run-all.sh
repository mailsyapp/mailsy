#!/bin/bash
# Runs every mapped journey against the scaffold or a packaged executable.
# Usage: RUN_ID=<id> ./scripts/run-all.sh [--executable <packaged-binary>] [--features <id,id,...>]
# Exit 0 only when every feature in features/ passes.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$HERE")"
EXECUTABLE=""
FEATURES=""
while [ "$#" -gt 0 ]; do
  if [ "$#" -lt 2 ] || [ -z "$2" ]; then
    echo "usage: run-all.sh [--executable <packaged-binary>] [--features <id,id,...>]" >&2
    exit 2
  fi
  case "$1" in
    --executable) EXECUTABLE="$2" ;;
    --features) FEATURES="$2" ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift 2
done
features=()
if [ -n "$FEATURES" ]; then
  while IFS= read -r feature; do
    [ -n "$feature" ] || continue
    if [[ ! "$feature" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] ||
      [ ! -f "$SKILL_DIR/features/$feature.md" ]; then
      echo "unknown feature: $feature" >&2
      exit 2
    fi
    for selected in ${features[@]+"${features[@]}"}; do
      if [ "$feature" = "$selected" ]; then
        echo "duplicate feature: $feature" >&2
        exit 2
      fi
    done
    features+=("$feature")
  done < <(printf '%s\n' "$FEATURES" | tr ',[:space:]' '\n')
  if [ "${#features[@]}" -eq 0 ]; then
    echo "empty feature list" >&2
    exit 2
  fi
else
  for file in "$SKILL_DIR"/features/*.md; do
    feature="$(basename "$file" .md)"
    [ "$feature" = "README" ] || features+=("$feature")
  done
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
passed=0
for feature in ${features[@]+"${features[@]}"}; do
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
    ${flags[@]+"${flags[@]}"} >"$ART/$feature.stdout" 2>&1; then
    echo "pass $feature"
    passed=$((passed + 1))
  else
    echo "FAIL $feature"
    tail -n 5 "$ART/$feature.stdout"
    failed+=("$feature")
  fi
done

echo "SUMMARY passed=$passed failed=${#failed[@]}"
if [ "${#failed[@]}" -gt 0 ]; then
  echo "${#failed[@]} feature(s) failed: ${failed[*]}"
  exit 1
fi
echo "all features passed"
