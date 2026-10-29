# Mark read / unread

Read state comes from Gmail's `UNREAD` label as `EmailSummary.unread`, derived where the summary is built in the main process. Rows show the state through bold text plus a per-row toggle; opening an unread conversation marks the thread read automatically; the detail view carries a manual toggle.

## Sub-features

- `row-toggle` flips one thread's read state from the list.
- `unread-bold` renders unread rows with bold text (`li.unread`).
- `auto-read-on-open` marks a thread read after it is opened.
- `detail-toggle` drives the same state from the detail view.

## How to get to it (user POV)

- In the inbox, press `mark unread` on a row, or open an unread email.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Seed mail arrives read, so rows start at `mark unread`.
- `scripts/doctor.sh` exits 0.

- **Flip.** Run `node scripts/drive.mjs --feature mark-read --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. One `Launch checklist` row flip must set `window.__mods[0]` to a thread `UNREAD` add.
- **Persist.** The folder round-trip refetch must still show the row unread, proving state sits in the mock's label data, not the client filter.
- **Auto-read.** Opening the unread email must record an `UNREAD` removal in `__mods[1]` and flip the row back to read.
- **Detail toggle.** `mark as unread` in the detail view must flip the list row again.

## Gotchas

- The row toggle hides in Drafts by design; the drafts journey never sees it.
- `li.unread` is the only affordance for the bold rendering the detail toggle produces batch-wise for every message sharing a threadId.
- The drive journeys reset mock state per page load, so `__mods` indexes restart every run; the two mod assertions above are order-dependent by construction.
