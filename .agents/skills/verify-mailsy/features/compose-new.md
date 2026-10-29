# Compose new

Compose new lets a user start a brand-new email from the toolbar: `Compose` opens a blank composer in the content pane, `Cancel` discards without sending, and `Send` delivers to a typed recipient with no threading fields.

## Sub-features

- `compose-open` opens a blank composer with empty To, Subject, and Message.
- `compose-validation` keeps Send disabled while To is blank.
- `compose-cancel` discards typed content without sending and returns to the idle pane; reopening starts blank.
- `compose-send` sends a fresh message with no thread id, reply headers, or draft id.

## How to get to it (user POV)

- Press the `Compose` button in the toolbar while signed in.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with an empty outbox.
- `scripts/doctor.sh` exits 0.

- **Open.** Run `node scripts/drive.mjs --feature compose-new --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. A `New email` heading appears with a blank To and Send disabled.
- **Cancel.** Type a recipient, then `Cancel` (same command). The pane returns to idle, and the outbox still holds nothing.
- **Send.** `Compose` again, fill To `ada@example.com`, a subject, and a body, then `Send` (same command). A `Message sent.` status appears and the recorded outbox holds exactly one entry addressed to `ada@example.com` with no threading fields.
- **Proof.** The driver writes `artifacts/<run-id>/compose-new.aria.txt` and `artifacts/<run-id>/compose-new.png`, and the transcript `artifacts/<run-id>/compose-new.log` quotes the recorded outbox entry.

## Gotchas

- The `Message sent.` status sits inside the Email content region; the composer stays on screen with the Send button retired, so wait for the status text, not for the pane to change.
- Reopening after cancel must show empty fields: leftover text means the page reused closed state instead of a fresh form.
- A fresh send carries no `threadId`, `inReplyTo`, or `draftId` in the recorded outbox entry; their presence means the compose-send or drafts journey was run in the same browser page load earlier.
