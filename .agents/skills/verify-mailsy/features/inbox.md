# Inbox

The inbox is the signed-in landing view: a sidebar landmark lists conversation rows with subject, participant summary, and snippet, choosing one opens its full thread in the content pane, and pagination controls appear only while more pages exist.

## Sub-features

- `inbox-list` renders one row per conversation with subject, participant summary, and latest-message snippet.
- `inbox-thread-group` groups a multi-message thread into a single row.
- `inbox-select` opens the chosen conversation's detail in the content pane.
- `inbox-pagination` shows `Load more` / `Loading more...` / `You're all caught up` correctly.

## How to get to it (user POV)

- Launch the app while signed in.
- Clear an active search to return to the inbox.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with the 3 seeded subjects.
- `scripts/doctor.sh` exits 0.

- **List.** Load the app. Run `node scripts/drive.mjs --feature inbox --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. The `Inbox` complementary landmark contains `Launch checklist`, `Q3 budget draft`, and `Deploy window`.
- **Select.** Choose `Launch checklist` (same command). A heading `Launch checklist` appears in the `Email content` section.
- **Proof.** Capture the open email. The driver writes `artifacts/<run-id>/inbox.aria.txt` and `artifacts/<run-id>/inbox.png`. Both identify the feature and show the selected subject.

## Gotchas

- The seed mailbox is smaller than one page, so `Load more` does not appear; pagination wording needs a larger fixture or a live account and is not asserted here.
- Detail loading is async (`Loading email...` first). Wait for the heading, not a fixed sleep.
- Email rows are buttons without accessible names — locate them by their subject text inside the `Inbox` landmark, never by index.
- Rows are conversations: the row shows the thread's first subject, so the Deploy window thread owned by `Re: Deploy window` still matches `Deploy window` exact text once, not twice.
- Thread actions (star, read toggle, archive, delete) land on the whole conversation through one row click.
