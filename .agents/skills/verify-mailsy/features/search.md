# Search

Search lets a signed-in user filter mail from the inbox sidebar: typing commits after a debounce (Enter commits immediately, Escape clears), matching messages stay while the rest filter out, and clearing restores the full inbox.

## Sub-features

- `search-commit` commits typed queries after the debounce without a per-keystroke API storm.
- `search-match` keeps title/body/snippet matches and removes non-matches.
- `search-clear` restores the full inbox and empties the box.
- `search-fallback` fuzzy-matches cached inbox mail when the server returns nothing.
- `search-pagination` reaches every match across four result pages.

## How to get to it (user POV)

- Type in the `Search emails` box in the inbox sidebar.
- Press Enter to commit immediately, or Escape to clear.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with `Q3 budget draft` and `Launch checklist` seeded.
- `scripts/doctor.sh` exits 0.

- **Match.** Type `budget` in the searchbox. Run `node scripts/drive.mjs --feature search --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. `Q3 budget draft` remains visible and `Launch checklist` is filtered out.
- **Clear.** Choose `Clear search` (same command). The box empties and `Launch checklist` returns.
- **Pagination and refresh.** Load two pages of a 34-match search, then restore two older matches into page two via a delta and a reset. Keep paging to verify that all 36 matches appear exactly once.
- **Open reply.** Open an unread result and start a reply. Sync can remove the auto-read row and later update its star without losing the reply. Switching to a matching cached query keeps the reply; switching to an excluding query closes the old pane.
- **Proof.** The driver writes `search`, `search-pagination`, and `search-open-reply` ARIA snapshots and screenshots under `artifacts/<run-id>/`.

## Gotchas

- Single characters never hit the API and `Searching…` appears only for committed queries. Wait for the result text, not a fixed sleep.
- Typing a `key:value` token (e.g. `from:ada`) switches to Gmail-operator mode and skips local fuzzy re-ranking.
- The empty-state fallback (`No results for ...` plus cached-mail fuzzy matches) needs a query with zero server hits; the scripted query `budget` always hits, so the dead-end state is not asserted here.
- Clearing via Escape versus the `Clear search` button takes the same code path; the journey proves the button.
