# Read thread

Reading a conversation shows every message in the thread: a count line, the latest message expanded by default, and per-message toggles that expand or collapse headers and bodies.

## Sub-features

- `thread-count` shows how many messages the conversation holds.
- `thread-latest` expands the newest message without user action.
- `thread-toggle` expands and collapses any single message.

## How to get to it (user POV)

- Choose an email in the inbox that belongs to a multi-message thread.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with the 2-message `Deploy window` thread seeded.
- `scripts/doctor.sh` exits 0.

- **Open.** Choose `Deploy window`. Run `node scripts/drive.mjs --feature read-thread --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. The text `2 messages in conversation` appears.
- **Read.** Inspect the messages (same command). Both the Thursday question and the `Thursday works` reply are readable.
- **Proof.** Capture the open conversation. The driver writes `artifacts/<run-id>/read-thread.aria.txt` and `artifacts/<run-id>/read-thread.png`. Both identify the feature and show the two messages.

## Gotchas

- Thread loading replaces single-message detail asynchronously; the count line is the signal the thread arrived, not `Loading email...` disappearing.
- Message toggles expose `aria-expanded` on buttons whose names are sender/date headers, not subjects — assert body text, not toggle names.
- Single-message threads render the same component with one message and no count line; do not assert the count there.
