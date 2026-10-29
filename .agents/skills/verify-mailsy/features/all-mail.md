# All Mail

All Mail is the rail entry that lists every thread the account holds regardless of label, so mail with no folder label anywhere (archived mail) stays visible and browsable: same thread grouping, pagination, search, and row actions as Inbox.

## Sub-features

- `all-mail-entry` shows an `All Mail` rail button that switches the list to the All Mail view.
- `all-mail-list` lists every thread, archived mail included, grouped like Inbox.
- `all-mail-select` opens the chosen conversation's detail from the All Mail list.
- `all-mail-inbox-exclusion` keeps an archived thread listed in All Mail while the Inbox stays free of it.

## How to get to it (user POV)

- Choose the `All Mail` button in the folder rail while signed in.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with the seed mailbox untouched.
- `scripts/doctor.sh` exits 0.

- **Archive + list.** Run `node scripts/drive.mjs --feature all-mail --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. The journey opens `Deploy window` from the Inbox, archives it (boundary recorded as one thread `modifyLabels` on `thread-deploy` removing `INBOX`), then chooses the `All Mail` rail button. The `All Mail` complementary landmark lists the archived `Deploy window` row, and `Launch checklist` and `Q3 budget draft` stay listed. Selecting `Launch checklist` inside All Mail opens its heading in the `Email content` region.
- **Inbox exclusion.** The journey round-trips to the Inbox refetch; the archived `Deploy window` row is still absent there.
- **Proof.** The driver writes `artifacts/<run-id>/all-mail.aria.txt`, `all-mail.png`, and the transcript `all-mail.log` quoting the recorded archive mod.

## Gotchas

- The archive button only exists in Inbox details, so the journey archives from there and asserts the All Mail listing after; driving All Mail alone cannot archive.
- All Mail is a real refetch through `listFolder` with `folder: 'all'`; the mock drops only `TRASH`-labeled mail from it, matching Gmail's All Mail. Deleted mail moves to the Trash folder, not into All Mail.
- The seed mailbox is smaller than one page, so `Load more` never appears; pagination looks identical to Inbox and needs live mail to assert.
- Row subjects are thread subjects; locate rows by subject text inside the `All Mail` landmark, never by index.
