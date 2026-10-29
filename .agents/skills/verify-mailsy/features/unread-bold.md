# Unread-bold rows

Read state reads at a glance: a thread with `unreadCount > 0` renders subject and sender bold through the row's `li.unread` class, and read rows render their subject at normal weight. Bold is owned by the class, never by row markup, so every folder view including All Mail, Snoozed, and the categories gets the treatment for free from the same `ThreadSummary.unreadCount`. Drafts and Sent have no unread audience and no row toggle.

## Sub-features

- `unread-bold` renders the unread row's subject and sender bold and the read row's subject normal, proven by computed font-weight on the rendered row.
- `bold-fold-in` keeps the bold state through the refresh/coalesced fold-in path (`mergeIncoming`), which both the manual refresh and the background poll share.
- `bold-across-views` shows the same bold affordance in All Mail, Snoozed, and a category view without per-view markup.
- `bold-clears` clears the weight the moment the thread is read (the auto-read-on-open mutation path and its identical sibling, the row toggle's read flip).

## How to get to it (user POV)

- In any folder view, press `mark unread` on a row; unread mail that arrives from the server bolds the same way.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Seed mail arrives read, so the journey produces its own unread rows through the real row toggle in each view.
- `scripts/doctor.sh` exits 0.

- **Read weight.** Run `node scripts/drive.mjs --feature unread-bold --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. The `Launch checklist` row's subject and sender compute to weight `400`, and no row carries `li.unread`.
- **Toggle bold.** The row's `mark unread` toggle records the thread `UNREAD` add in `window.__mods[0]` and the subject and sender compute to `700` with `li.unread` present.
- **Fold-in.** `Refresh mail` folds a fresh page in through `mergeIncoming`; the row still carries `li.unread` and weight `700`.
- **View coverage.** All Mail bolds the same thread next to a normal read row; a Snoozed row toggled unread is bold next to a normal parked row; a Promotions row toggled unread is bold.
- **Clear.** Opening the unread thread sends the `UNREAD` removal in `__mods[3]` and the row's weight returns to `400`.

## Gotchas

- The proof is computed font-weight (or `li.unread`), not a screenshot: the subject must never regain a markup-level bold (`<strong>`), or read rows go bold too and `unread-bold` fails at its first assert.
- Seeded fixtures must not carry `UNREAD` outside the Inbox: the mark-read journey counts `li.unread` exactly, and the Snoozed feature pins seeded parked mail as never `UNREAD`. This journey toggles its own rows instead.
- The journey records four mods total (Inbox toggle, Snoozed toggle, Promotions toggle, auto-read); reordering the views means reordering the index asserts.
