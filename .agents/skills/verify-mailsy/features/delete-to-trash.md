# Delete to Trash

Delete moves a thread to the Trash folder: with a conversation open, the `delete` button sets `TRASH` and removes `INBOX` through the same label mutation archive uses, clears the thread from the current list, closes the detail pane, and the thread shows up under the Trash folder on refetch.

## Sub-features

- `delete-open` deletes the open conversation, removing every row of the thread from the list and closing the detail pane.
- `delete-folder-persistent` shows the thread under the Trash folder (and nowhere else) on folder round-trip refetches.

## How to get to it (user POV)

- Select a row to open the conversation, then choose the `delete` button next to `reply`/`forward`.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with the 1-message `Launch checklist` thread (`thread-launch`) in the Inbox and the other threads untouched.
- `scripts/doctor.sh` exits 0.

- **Open + delete.** Run `node scripts/drive.mjs --feature delete-to-trash --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. `Launch checklist` opens in the Email content region; choosing `delete` removes its row from the Inbox landmark, closes the detail pane (the `Nothing open yet :P` placeholder shows), and the recorded label modification is one thread-kind `modifyLabels` call on `thread-launch` adding `TRASH` and removing `INBOX`.
- **Folder persistence.** The driver round-trips through `Drafts` → `Trash`; the `Launch checklist` row is listed under Trash while `Q3 budget draft` is not, and an Inbox refetch no longer shows it.
- **Proof.** The driver writes `artifacts/<run-id>/delete-to-trash.aria.txt`, `delete-to-trash.png`, and the transcript `delete-to-trash.log` quoting the recorded label modification.

## Gotchas

- The `delete` button is hidden in Drafts (a trashed draft thread still returns from `drafts.list`, so the row would reappear on refetch) and in Trash (nothing to mutate). Deleting a draft followed up in the `delete-draft` feature: the Drafts row and the open editor delete through the irreversible `drafts.delete` verb instead of this label mutation.
- Thread-kind only. The recorded call must carry `kind: 'thread'` and the thread ID; a message-kind call would leave the other thread rows behind in the list.
- Nothing reaches Gmail here; the mock models `labels` mutation in memory. Real trash/restore of live mail is manual-tier only.
- Manual tier: restore a trashed live thread with `window.api.modifyLabels({ kind: 'thread', id, addLabelIds: ['INBOX'], removeLabelIds: ['TRASH'] })` through CDP, then verify with a fresh folder round trip.
