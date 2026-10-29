#!/bin/bash
# Doctor: read-only check that answers "is this instance worth driving?"
# Usage: RUN_ID=<id> VERIFY_MAILSY_PORT=<port> ./scripts/doctor.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$HERE")"
if [ -n "${VERIFY_MAILSY_REPO:-}" ]; then
  REPO="$VERIFY_MAILSY_REPO"
elif REPO="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null)"; then
  :
else
  REPO="$(cd "$SKILL_DIR/../../../.." && pwd)"
fi
PORT="${VERIFY_MAILSY_PORT:-4317}"
RUN_DIR="/tmp/verify-mailsy-${RUN_ID:-default}"
FAIL=0

fail() { echo "FAIL: $1"; FAIL=1; }
ok() { echo "OK: $1"; }

command -v node >/dev/null || fail "node not on PATH"
command -v npm >/dev/null || fail "npm not on PATH"
[ -d "$REPO/node_modules" ] || fail "$REPO/node_modules missing (run npm install at repo root)"
[ -f "$SKILL_DIR/scaffold/vite.verify.config.mjs" ] || fail "scaffold vite config missing"
[ -f "$SKILL_DIR/fixtures/api-mock.js" ] || fail "fixture api mock missing"
[ -d "$SKILL_DIR/drive/node_modules/playwright" ] || fail "playwright lib missing (run npm --prefix $SKILL_DIR/drive install)"
[ -d "${HOME}/Library/Caches/ms-playwright" ] || [ -d "${HOME}/.cache/ms-playwright" ] || fail "playwright browser binary missing (run npx --prefix $SKILL_DIR/drive playwright install chromium)"
command -v node >/dev/null && ok "node $(node --version)" || true
[ -f "$REPO/.env" ] || echo "WARN: $REPO/.env missing — scripted mock runs unaffected; manual live tier needs MAIN_VITE_GOOGLE_CLIENT_ID"

if [ -f "$RUN_DIR/server.pid" ]; then
  PID="$(cat "$RUN_DIR/server.pid")"
  if kill -0 "$PID" 2>/dev/null; then
    ok "server for RUN_ID=${RUN_ID:-default} running as pid $PID"
    if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/"; then
      ok "server answers HTTP 200 at http://127.0.0.1:${PORT}/"
    else
      fail "pid $PID alive but not answering at http://127.0.0.1:${PORT}/"
    fi
  else
    fail "stale pid file $RUN_DIR/server.pid (pid $PID dead) — run serve.sh stop, then start"
  fi
else
  if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then
    fail "port $PORT answers but was not started by this run (refusing to drive a foreign instance)"
  else
    ok "port $PORT free"
  fi
fi

exit $FAIL
