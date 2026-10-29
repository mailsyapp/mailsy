# Spam

Spam is a rail folder for the mail Gmail's filter set aside: selecting `Spam` lists the account's `SPAM` threads like any other folder, `report spam` on eligible mail adds `SPAM` and drops `INBOX` (the mail leaves the Inbox and appears in Spam), and `not spam` on spam rows removes `SPAM` and restores `INBOX`. All Mail keeps excluding spam.

## Sub-features

- `spam-folder` lists the account's SPAM threads from the `Spam` rail entry, seeded spam mail included.
- `report-spam` adds `SPAM` and removes `INBOX` on the open thread, clears its row from the current list, and closes the detail pane.
- `not-spam` removes `SPAM` and adds `INBOX` from the detail pane or the row-level button, clearing the row from the Spam list.
- `spam-folders-partition` shows the restored mail back in the Inbox, the still-spam mail absent from the Inbox, and All Mail still hiding spam.

## How to get to it (user POV)

- Choose the `Spam` button in the folder rail to open the Spam view.
- With an eligible thread open (`inbox`, `starred`, or All Mail), choose `report spam` next to `delete`.
- On a Spam row, choose `not spam`, or open the thread and choose `not spam` in the detail pane.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with the seeded spacer SPAM mail (`You won a free cruise`, `thread-spam-1`, carrying only the `SPAM` label) and the standard seed threads untouched.
- `scripts/doctor.sh` exits 0.

- **Report from the detail.** Run `node scripts/drive.mjs --feature spam --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. `Q3 budget draft` opens in the Email content region; choosing `report spam` removes its row from the Inbox landmark, closes the detail pane (`Nothing open yet :P` shows), and the recorded modification is one thread-kind `modifyLabels` call on `thread-budget` adding `SPAM` and removing `INBOX`.
- **Spam view.** The driver opens the `Spam` rail entry; both the reported `Q3 budget draft` and the seeded `You won a free cruise` are listed.
- **All Mail partition.** All Mail lists the untouched `Launch checklist` thread while the still-spam `You won a free cruise` is not listed.
- **Not spam restores.** Opening the reported thread from Spam and choosing `not spam` clears it from the Spam list, records the reverse pair (`addLabelIds` contains `INBOX`, `removeLabelIds` contains `SPAM`), and an Inbox refetch lists it again.
- **Row-level restore.** Choosing `not spam` on the seeded spam row (thread `thread-spam-1`) clears the row, records the same pair, and the seeded mail reappears in the Inbox.
- **Proof.** The driver writes `artifacts/<run-id>/spam.aria.txt`, `spam.png`, and the transcript `spam.log` quoting the recorded label modifications.

## Gotchas

- Seeded spam mail carries only `SPAM`, never `UNREAD`: opening a spam thread auto-marks read, which would add a modify call and break recorded-modification counts.
- `report spam` is hidden in Drafts, Sent, Trash, and Spam itself; `not spam` only exists in Spam. Trash is not a spam source: adding `SPAM` to trashed mail would paginate the thread from both folders.
- `delete` is hidden in Spam: adding `TRASH` while keeping `SPAM` would leave the mail listed in Spam, a nonsense outcome there.
- All Mail's exclusion is the Gmail API default, not a client filter; the fixture models it, so an undone label state round-trips like the live API.
- Nothing reaches Gmail here; the mock models `labels` mutation in memory. Reporting/unreporting live spam is manual-tier only.
