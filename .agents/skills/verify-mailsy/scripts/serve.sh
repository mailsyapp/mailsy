#!/bin/bash
# Server lifecycle for verification runs. Kills only what it started.
# Usage: RUN_ID=<id> VERIFY_MAILSY_PORT=<port> ./scripts/serve.sh start|stop
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
PID_FILE="$RUN_DIR/server.pid"
LOG_FILE="$RUN_DIR/server.log"

cmd="${1:-}"
case "$cmd" in
  start)
    mkdir -p "$RUN_DIR"
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "server already running for RUN_ID=${RUN_ID:-default} (pid $(cat "$PID_FILE"))" >&2
      exit 1
    fi
    if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then
      echo "port $PORT already answers and is not ours — pick another VERIFY_MAILSY_PORT" >&2
      exit 1
    fi
    (cd "$REPO" && VERIFY_MAILSY_PORT="$PORT" nohup node_modules/.bin/vite \
      -c "$SKILL_DIR/scaffold/vite.verify.config.mjs" >"$LOG_FILE" 2>&1 &
      echo $! >"$PID_FILE")
    for _ in $(seq 1 100); do
      if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then
        echo "READY http://127.0.0.1:${PORT}/"
        exit 0
      fi
      sleep 0.3
    done
    echo "server did not become ready in 30s; see $LOG_FILE" >&2
    "$0" stop >/dev/null 2>&1 || true
    exit 1
    ;;
  stop)
    if [ ! -f "$PID_FILE" ]; then
      echo "no server recorded for RUN_ID=${RUN_ID:-default}; nothing to stop"
      exit 0
    fi
    PID="$(cat "$PID_FILE")"
    # The recorded pid can be a launcher shim wrapping the vite node process;
    # kill direct children (ours, via the recorded pid) first, or the child
    # outlives the shutdown and keeps serving the port.
    for CHILD in $(pgrep -P "$PID" 2>/dev/null); do
      kill "$CHILD" 2>/dev/null || true
    done
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
      for _ in $(seq 1 50); do
        kill -0 "$PID" 2>/dev/null || break
        sleep 0.2
      done
      kill -9 "$PID" 2>/dev/null || true
      echo "stopped pid $PID"
    else
      echo "pid $PID already dead"
    fi
    rm -rf "$RUN_DIR"
    ;;
  *)
    echo "usage: RUN_ID=<id> VERIFY_MAILSY_PORT=<port> serve.sh start|stop" >&2
    exit 2
    ;;
esac
