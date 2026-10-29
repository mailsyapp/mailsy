# Search

Search lets a signed-in user filter mail from the inbox sidebar: typing commits after a debounce (Enter commits immediately, Escape clears), matching messages stay while the rest filter out, and clearing restores the full inbox.

## Sub-features

- `search-commit` commits typed queries after the debounce without a per-keystroke API storm.
- `search-match` keeps title/body/snippet matches and removes non-matches.
- `search-clear` restores the full inbox and empties the box.
- `search-fallback` fuzzy-matches cached inbox mail when the server returns nothing.

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
- **Proof.** Capture the restored inbox. The driver writes `artifacts/<run-id>/search.aria.txt` and `artifacts/<run-id>/search.png`. Both identify the feature, the query, and the visible result.

## Gotchas

- Single characters never hit the API and `Searching…` appears only for committed queries. Wait for the result text, not a fixed sleep.
- Typing a `key:value` token (e.g. `from:ada`) switches to Gmail-operator mode and skips local fuzzy re-ranking.
- The empty-state fallback (`No results for ...` plus cached-mail fuzzy matches) needs a query with zero server hits; the scripted query `budget` always hits, so the dead-end state is not asserted here.
- Clearing via Escape versus the `Clear search` button takes the same code path; the journey proves the button.
