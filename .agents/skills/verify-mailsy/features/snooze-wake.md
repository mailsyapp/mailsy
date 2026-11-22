# Snooze wake selection

A selected thread that wakes leaves the Snoozed list and its conversation closes. Waking a different thread does not close a still-parked selection.

Run `node scripts/drive.mjs --feature snooze-wake --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"` after doctor and server startup. The journey parks Launch checklist with Tomorrow, opens it in Snoozed, advances the browser clock, and checks the recorded restore and provider refetch before asserting list removal and pane closure. A second scenario selects an unrelated native parked thread. Both verify the returned thread in Inbox and preserve screenshots and accessibility snapshots.

The journey also checks an empty list, transient and not-found lookup failures, and an Inbox thread whose older messages remain parked. A failed lookup never discards the refreshed page: not-found drops the selected row; other errors preserve it. Missing first-page rows snoozed by Mailsy are removed only after the local schedule entry disappears or its wake time passes. The existing thread response carries that timestamp without another Gmail call or IPC channel; native or unknown schedule state is preserved conservatively.

The fixture supplies the Gmail boundary and schedule; the real renderer runs its existing heartbeat and first-page fold. No live Gmail or packaged Electron coverage is claimed.
