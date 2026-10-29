# Compose send

Compose send lets a user answer mail from the detail pane: reply prefills To/Subject with a quote, forward prefills Subject with the original content for a new recipient, cancel discards without sending, and send shows a status and refreshes the conversation.

## Sub-features

- `send-reply` prefills recipient and `Re:` subject, sends, and confirms.
- `send-forward` prefills `Fwd:` subject with an empty To for a new recipient.
- `send-cancel` discards the draft without sending anything.
- `send-validation` blocks send while To is blank.

## How to get to it (user POV)

- Open an email and choose the `reply` button.
- Open an email and choose the `forward` button.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with `Launch checklist` seeded and an empty outbox.
- `scripts/doctor.sh` exits 0.

- **Reply.** Open `Launch checklist` and choose `reply`. Run `node scripts/drive.mjs --feature compose-send --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. A `Compose email` heading appears with To containing `ada@example.com`.
- **Send.** Type a body and choose `Send` (same command). A `Message sent.` status appears and the recorded outbox holds one entry addressed to `ada@example.com` with the reply subject.
- **Forward cancel.** Choose `forward`, see `Fwd: Launch checklist`, then `Cancel` (same command). The outbox still holds exactly the one reply.
- **Proof.** Capture the sent state. The driver writes `artifacts/<run-id>/compose-send.aria.txt` and `artifacts/<run-id>/compose-send.png`, and the transcript `artifacts/<run-id>/compose-send.log` quotes the recorded outbox entry.

## Gotchas

- The Send button stays disabled while To is blank — that is `send-validation` working, not a stuck composer. The forward draft starts with empty To on purpose.
- Outbox proof requires reading `window.__sent` back after the status appears; the status alone is insufficient.
- Nothing reaches Gmail here: the mock records sends in memory. Real delivery is manual-tier only and must never target a real address from a scripted run.
- After send the thread reloads silently; wait for `Message sent.`, not for the composer to vanish.
