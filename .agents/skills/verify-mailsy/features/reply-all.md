# Reply all

Reply all answers mail to the whole participant set from the detail pane, split the way Gmail splits it: the To field keeps the author plus every other To recipient and the Cc field keeps the previous Cc, with the signed-in account's own address dropped from every field, so Cc recipients no longer ride a To line. Reply (single) stays one address with no Cc field.

## Sub-features

- `reply-all-prefill` opens the composer with author + previous To in To and the previous Cc in its own Cc field, own address excluded from both.
- `reply-all-send` sends and records both address lists plus `Re:` subject and thread/in-reply linkage in the outbox.
- `reply-single-unchanged` confirms `reply` still prefills exactly one address.
- `reply-all-no-bcc` confirms the reply payload never auto-adds a Bcc field (pinned by the `cc-bcc` journey).

## How to get to it (user POV)

- Open an email and choose the `reply all` button next to `reply`.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock mailbox includes `Standup notes` (To `me@example.com, Ben Franklin <ben@example.com>`, Cc `Nia Chambers <nia@example.com>`) and the mock reports the account email `me@example.com`.
- `scripts/doctor.sh` exits 0.

- **Prefill.** Open `Standup notes` and choose `reply all`. Run `node scripts/drive.mjs --feature reply-all --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. A `Compose email` heading appears with To containing `ada@example.com` and `ben@example.com` (no `me@example.com`, no `nia@example.com`) and the Cc input holding `Nia Chambers <nia@example.com>`.
- **Reply unchanged.** Cancel, choose `reply`, and the To input holds `ada@example.com` alone (the display-name From string), with none of the other participants.
- **Send.** Cancel, choose `reply all` again, type a body, choose `Send` (same command). A `Message sent.` status appears and the outbox holds one entry addressed to `ada` + `ben` in `to` and `Nia Chambers <nia@example.com>` in `cc`, without the own address, subject `Re: Standup notes`, thread id `thread-standup`, and in-reply-to `<standup@example.com>`.
- **Proof.** The driver writes `artifacts/<run-id>/reply-all.aria.txt`, `artifacts/<run-id>/reply-all.png`, and the transcript `artifacts/<run-id>/reply-all.log` quoting the outbox entry.

## Gotchas

- The own-address exclusion depends on the account email the thread fetch carries; the mock returns `me@example.com`, so a recipient spelt differently (display-name variant) still counts as another participant, not the own address.
- The Cc split follows the mail's own headers: a Cc address that also appears in To moves nowhere — the To copy survives and the Cc copy dedupes.
- Reveal/collapse of the carbon fields belongs to the `cc-bcc` journey; this one only asserts the prefilled Cc contents.
- Outbox proof requires reading `window.__sent` back after `Message sent.` appears; the status alone is insufficient.
- After send the thread reloads silently; the composer body keeps the quote, so assertions read state, not composer visibility.
