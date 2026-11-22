# Pagination

Inbox and Drafts keep earlier rows visible as more pages load. Refresh and removals must not hide rows on the next page or duplicate rows already reached.

## Sub-features

- `pagination-overlap` retains a new arrival and page two when refresh and pagination overlap.
- `pagination` reaches all surviving Inbox threads after archive and delete move the page boundary.
- `pagination-archive-during-load` recovers the page automatically when a remote archive moves its boundary during the request.
- `pagination-drafts` lists drafts from the same conversation on separate rows.
- `pagination-switch` starts pagination in a different view without waiting for Inbox.

## How to get to it (user POV)

- In Inbox or Drafts, activate **Load more** or scroll to the end of the loaded list.
- In Inbox, open a thread and choose **archive** or **delete** from its toolbar.

## Driving it with drive.mjs

Preconditions:

- A healthy scaffold server and the standard signed-in fixture; `scripts/doctor.sh` exits 0.

Run `node scripts/drive.mjs --feature pagination --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`:

- **Overlap.** Seed 64 additional Inbox threads, activate **Load more**, and hold the response. Deliver new mail and push two resets. Releasing the response shows both the delivery and page two.
- **Removals.** Archive and delete two threads from page two, then activate **Load more**. The remaining threads each appear once and there is no fourth page.
- **Remote archive during pagination.** Hold page two, archive a page-one thread in the mailbox, and push its delta. Releasing the stale page retries with a rebuilt cursor and shows both pages without a second click.
- **Shared conversation.** Load the first two of three Drafts pages, with three drafts from one conversation. Send one and use **Load more** during the send confirmation to reach every surviving draft before deleting another. Only the selected rows leave the list.
- **Switch views.** Hold Inbox's next page, switch to Drafts or Receipts, and start paging there. Releasing the old response neither changes the destination rows nor ends its loading state.
- **Proof.** `pagination-overlap`, `pagination`, `pagination-archive-during-load`, `pagination-drafts`, `pagination-draft-send`, `pagination-draft-discard`, `pagination-switch-drafts`, and `pagination-switch-receipts` snapshots and screenshots, plus `pagination.log`.

## Gotchas

- Scrolling to the button can trigger automatic pagination first. Focus the button without scrolling to keep the request timing deterministic.
- The fixture does not exercise Gmail's live cursors or throttling.
