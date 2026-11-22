# Pagination

Inbox and Drafts keep earlier rows visible as more pages load. Refresh and removals must not hide rows on the next page or duplicate rows already reached.

## Sub-features

- `pagination-overlap` retains a new arrival and page two when refresh and pagination overlap.
- `pagination` reaches all surviving Inbox threads after archive and delete move the page boundary.
- `pagination-drafts` lists drafts from the same conversation on separate rows.

## How to get to it (user POV)

- In Inbox or Drafts, activate **Load more** or scroll to the end of the loaded list.
- In Inbox, open a thread and choose **archive** or **delete** from its toolbar.

## Driving it with drive.mjs

Preconditions:

- A healthy scaffold server and the standard signed-in fixture; `scripts/doctor.sh` exits 0.

Run `node scripts/drive.mjs --feature pagination --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`:

- **Overlap.** Seed 64 additional Inbox threads, activate **Load more**, and hold the response. Deliver new mail and push two resets. Releasing the response shows both the delivery and page two.
- **Removals.** Archive and delete two threads from page two, then activate **Load more**. The remaining threads each appear once and there is no fourth page.
- **Shared conversation.** Fill Drafts across two pages, with three drafts from one conversation. **Load more** shows each draft separately.
- **Proof.** `pagination-overlap`, `pagination` and `pagination-drafts` ARIA snapshots and screenshots, plus `pagination.log`.

## Gotchas

- Scrolling to the button can trigger automatic pagination first. Focus the button without scrolling to keep the request timing deterministic.
- The fixture does not exercise Gmail's live cursors or throttling.
