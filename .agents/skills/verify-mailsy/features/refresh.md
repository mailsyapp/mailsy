# Refresh

Refresh is the live channel: new mail arrives from main's incremental sweep (pushed delta or reset) without any click, and the `Refresh mail` button acknowledges a click at once, dedupes in-flight clicks, and surfaces failures. Scripted tier covers all of it through the renderer; main's own clock, focus regain, and history parsing are manual tier.

## Sub-features

- `refresh-button` turns the button busy (`aria-busy` + `.syncing` spinner) for as long as the sweep runs, dedupes spam clicks to one sweep (the mock counts `button` reasons it was invoked with), and after an injected failure shows the shared `Gmail rate limit hit` error line.
- `refresh-push` adds a mailbox thread via `window.__deliverMail` and pushes its delta through `window.__pushSync` (the channel main's clock and focus results use); the new row appears in the Inbox with no click anywhere.
- `refresh-reset` pushes `{kind:'reset'}` after another delivery; the view takes a full quiet fold of the first page and the delivered mail appears.
- `refresh-pagination` fills the open inbox to exactly one page, then delivers one more thread and pushes a reset. `Load more` appears without reopening Inbox and reaches the overflow thread.

## How to get to it (user POV)

- Signed-in app, Inbox on screen: the `Refresh` button sits between `Compose` and `Sign out`.
- Everything else is the app doing its own background work — the user only observes.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock signed in with the standard seed; renderer subscribed to `onSyncResult` and the button wired to `syncMail('button')`.
- `scripts/doctor.sh` exits 0.

Run `node scripts/drive.mjs --feature refresh --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`:

- **Button alive + dedupe.** With `window.__setSyncDelay(500)`, one click turns the button busy during the sweep; two more clicks land mid-flight and are not queued — `window.__syncReasons` counts exactly one `'button'`.
- **Errors.** With `window.__setSyncError('mock: rate limit')`, the next click keeps the same dedupe and surfaces `Gmail rate limit hit` in `p.error`.
- **Push delta.** `window.__deliverMail` + `window.__pushSync(delta)` adds the row `Delivered between sweeps` to the Inbox without any click.
- **Push reset.** Delivering again and pushing `{kind:'reset'}` re-folds the first page; `Delivered at the fold` appears.
- **Pagination after reset.** After the open inbox grows from 30 to 31 threads, the reset exposes `Load more`. Activating it shows `Delivered onto page two` exactly once and removes the continuation. Another reset, with a new delivery on page one, retains the loaded tail without reopening pagination.
- **Switch views mid-sweep.** Hold the button's reset result while switching from Inbox to Drafts, then repeat from Inbox to Receipts. Releasing the reset lists the destination view without introducing any Inbox rows.
- **Proof.** `refresh-button`, `refresh-pagination`, `refresh`, `refresh-switch-drafts` and `refresh-switch-label` ARIA snapshots and screenshots under `artifacts/<run-id>/`.

## Gotchas

- The busy click's visible window is only as long as the mock's sweep delay — the driver raises it to 500 ms before asserting.
- The pushed delta replaces the row objects wholesale; a row push for a thread already on screen overwrites it weight-for-weight, so the journeys always deliver fresh threads.
- `__deliverMail` mutates the mock's in-memory mailbox; page reloads reset it to the seed.
- Live Gmail behavior (the increment sweeping real history, users.watch needing a hosted HTTPS relay) is manual tier only.
