# Undo send

New emails, stored drafts, replies, and forwards can be recalled for five seconds before delivery.

## Sub-features

- `cancel` — Undo reopens the composer with the saved contents.
- `navigation` — Undo can reopen the saved draft after leaving the editor.
- `expiry` — Each message waits independently and delivery consumes only that message's draft.

## How to get to it (user POV)

Open **Compose**, a message in **Drafts**, or **reply** or **forward** in an open conversation. Click **Send**, then **Undo** on that message's notification.

## Driving it with drive.mjs

Preconditions: start the fixture server or supply a packaged executable.

- Run `node scripts/drive.mjs --feature undo-send --run-id undo-send --port 4317`.
- Verify the screenshots show the Undo notification, then the reopened composer with the same text.
- Check the journey reports that Undo works after navigation and in stored drafts, replies, and forwards, and only the un-cancelled pending message reached the outbox.

## Gotchas

- This journey advances the fixture clock. It never sends live mail.
