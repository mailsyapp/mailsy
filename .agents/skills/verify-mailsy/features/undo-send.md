# Undo send

Send holds the message for five seconds. Undo restores the editable composer without sending. Leaving the composer or closing the app during the hold keeps the message in Drafts instead of sending it automatically.

## Sub-features

- `undo-pending-send` restores the recipient, subject, and body without sending.
- `send-after-delay` delivers the message exactly once when the window expires.
- `keep-draft-on-leave` lets the user reopen the unsent message from Drafts.

## How to get to it (user POV)

- Create a message with **Compose** or open a message in **Drafts**.
- Open an existing conversation and choose **reply**, **reply all**, or **forward**.
- Select **Send**, then select **Undo** in the banner before it disappears.

## Driving it with drive.mjs

Preconditions:

- The fixture mailbox is signed in, includes `Launch checklist`, and has an empty outbox.
- `scripts/doctor.sh` exits 0.

- **Undo.** Run `node scripts/drive.mjs --feature undo-send --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. It checks that Undo returns an editable message and sends nothing for new compose, reopened drafts, replies, and forwards.
- **Leave and reopen.** The same run navigates to Drafts during a hold and checks that the message can be reopened without having been sent.
- **Expire.** The run lets the final message send, reads back one matching outbox record, and saves screenshots of the banner, restored draft, and sent confirmation.

## Gotchas

- The Undo window starts after saving the draft; the composer may briefly show **Preparing...** first.
- The fixture only records delivery attempts; it never sends to Gmail.
