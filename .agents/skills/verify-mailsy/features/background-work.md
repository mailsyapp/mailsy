# Background work

Background work is everything the renderer does on its own schedule rather than in a click handler: the search debounce, loading the next page when the list end scrolls into view, the folder-rail tooltip dwell, and saving a compose that is closed before its autosave delay ends. These run through the named hooks in `src/renderer/src/hooks/` (`useSettledValue`, `useIntersection`, `useTimers`, `useOnUnmount`).

## Sub-features

- `background-debounce` sends one boundary query for a typed word and none for a single character.
- `background-pagination` loads the remaining pages when the end of the list scrolls into view, with no click.
- `background-tooltip` shows a rail tooltip only after the pointer dwells, cancels it when the pointer leaves early, and hides it on leave.
- `background-unmount-save` saves an edited compose exactly once when it is closed inside the autosave delay.

## How to get to it (user POV)

- Type in `Search emails` without pressing Enter.
- Scroll the inbox list to its end in a mailbox with more than 30 threads.
- Rest the pointer on a button in the collapsed `Mail folders` rail.
- Open `Compose`, type, and select a thread straight away.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock signed in with the standard seed.
- `scripts/doctor.sh` exits 0.

Run `node scripts/drive.mjs --feature background-work --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`:

- **Debounce.** The driver wraps `window.api.listFolder` to record every `q`. Typing `b` and waiting records none; typing `udget` at 120ms per key records exactly `["budget"]`.
- **Pagination.** 45 `window.__deliverMail` threads, then `Starred` and back to `Inbox`, give a 30-row first page. Scrolling the last row into view grows the list to every thread and `Load more` is gone.
- **Tooltip.** Hovering `Starred` for 200ms leaves `.folder-rail` without `tips-active`; leaving and waiting 700ms still does; a full dwell adds it; leaving removes it.
- **Unmount save.** The browser clock is installed before app load and paused before composing. After typing, one millisecond settles the editor's deferred input transaction without reaching the autosave debounce. `window.__draftSaves` is still empty; selecting a thread closes the compose and records one save without advancing time. Advancing the clock past the autosave delay then records no second save or send.
- **Proof.** `artifacts/<run-id>/background-work-search`, `-pagination`, `-tooltip` and `background-work` (`.aria.txt` + `.png`), plus `background-work.log`.

## Gotchas

- The tooltip is a CSS `::after` on `[data-tip]`, so it has no accessible handle; the journey reads the `tips-active` class that gates it.
- The debounce is 800ms and the autosave delay 1200ms. Search and tooltip checks run on the ticking clock; only the final compose section pauses it. The fixed waits only prove that nothing happens; every positive assertion waits on state.
- A pushed `{kind:'reset'}` keeps the page token the view already had, so a mailbox that outgrows one page while open shows no next page until the folder is reopened. The journey reopens the folder for that reason.
- Wrapping `listFolder` observes the boundary, it does not replace it: the wrapper forwards every call to the mock unchanged.
