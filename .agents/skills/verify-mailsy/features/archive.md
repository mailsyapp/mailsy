# Archive

Archive takes an inbox thread out of the Inbox list for good (until Gmail restores it): with an inbox conversation open, the `archive` button removes the open thread from every inbox row and closes the detail pane, and the rows stay gone after the folder list is refetched.

## Sub-features

- `archive-open` archives the open conversation, removing every row of the thread from the Inbox list and closing the detail pane.
- `archive-list-persistent` keeps the archived rows out of the Inbox after a folder round-trip refetches the list.

## How to get to it (user POV)

- Select an inbox row to open the conversation, then choose the `archive` button next to `reply`/`forward`.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with the 2-message `Deploy window` thread (`thread-deploy`) in the Inbox and `Launch checklist` untouched.
- `scripts/doctor.sh` exits 0.

- **Open + archive.** Run `node scripts/drive.mjs --feature archive --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. `Deploy window` opens in the Email content region; choosing `archive` removes both thread rows from the Inbox landmark, closes the detail pane (the `Nothing open yet :P` placeholder shows), and the recorded label modification is one thread-kind `modifyLabels` call on `thread-deploy` removing `INBOX`.
- **Persistence.** A `Drafts` → `Inbox` folder round-trip refetches the list; the `Deploy window` rows are still absent while `Launch checklist` remains listed.
- **Proof.** The driver writes `artifacts/<run-id>/archive.aria.txt`, `archive.png`, and the transcript `archive.log` quoting the recorded label modification.

## Gotchas

- The `archive` button appears only when the Inbox folder is active; Trash, Sent, and Drafts details hide it.
- Archive proof is a thread write: the recorded call must carry `kind: 'thread'` and the thread ID, not a message ID.
- Nothing reaches Gmail here; the mock models `labels` mutation in memory. Real archive/restore of live mail is manual-tier only.
- Manual tier: restore an archived live thread with `window.api.modifyLabels({ kind: 'thread', id, addLabelIds: ['INBOX'] })` through CDP, then verify with a fresh folder round trip — the on-screen list does not refetch on its own.
- One live session observed a first archive click where the modify call appeared to hang for over 30 seconds with no error and no pruning (cause unconfirmed, not reproduced since; the next identical click completed in under a second). If a live archive seems stuck, close and reopen the app before concluding the feature is broken.
