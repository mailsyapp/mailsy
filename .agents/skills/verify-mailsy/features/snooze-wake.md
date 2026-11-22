# Snooze wake selection

A selected thread that wakes leaves the Snoozed list and its conversation closes. Waking a different thread does not close a still-parked selection.

Run `node scripts/drive.mjs --feature snooze-wake --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"` after doctor and server startup. The journey parks Launch checklist with Tomorrow, opens it in Snoozed, advances the browser clock, and checks the recorded restore and provider refetch before asserting list removal and pane closure. A second scenario selects an unrelated native parked thread. Both verify the returned thread in Inbox and preserve screenshots and accessibility snapshots.

The journey also checks an empty Snoozed list after its only parked thread wakes, and an injected membership-read failure that preserves the selection until a successful pushed-sync retry. When a selected thread is missing from the first page, the renderer confirms that it returned to Inbox before removing it, rather than treating pagination alone as a wake.

The fixture supplies the Gmail boundary and schedule; the real renderer runs its existing heartbeat and first-page fold. No live Gmail or packaged Electron coverage is claimed.
