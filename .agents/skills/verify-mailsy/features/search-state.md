# Search state

Reopening a cached search preserves current star and unread flags. Unstarring in a plain `is:starred` search removes the nonmatching row. Star changes invalidate plain starred-query caches so reopening refetches membership. Opening an `is:unread` result marks it read without removing its row or closing the conversation.

## Sub-features

- `cached-flags` keeps mutations made in search or another view when reopening a cached query without a refetch.
- `starred-membership` removes explicitly unstarred rows and refetches on reopen after either starring or unstarring, including previously empty results.
- `selection` keeps auto-read conversations open; explicitly unstarring the selected result closes it deliberately, matching the Starred folder, without resurrecting the selection on re-star.
- `narrow-matching` leaves compound query membership to Gmail rather than interpreting it locally.
- `failed-write` leaves flags unchanged when the boundary rejects a mutation.

## How to get to it (user POV)

- Search for `budget`, star or mark the result unread, clear with Escape and search again.
- Make the same changes in Inbox after caching the search, then reopen it.
- Search for `is:starred`, unstar a result, clear search, re-star it and reopen the query.
- Open an `is:unread` result; the read conversation stays open.

## Driving it with drive.mjs

Preconditions:

- Doctor and the signed-in fixture scaffold succeed; Inbox contains the read, unstarred `Q3 budget draft`.
- The fixture supports the two starred/unread operators and AND combinations at the Gmail boundary.

- **Flags.** Run `node scripts/drive.mjs --feature search-state --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. Reopened `budget` results keep changed flags; recorded query calls prove cache reuse.
- **Membership.** The same command unstars a plain starred result, reopens with and without re-starring, and verifies a refetch. Starring after caching empty results also restores the matching row.
- **Selection.** Opening an unread result keeps its conversation visible after auto-read. Explicitly unstarring the selected starred result closes it like the Starred folder; re-starring and reopening does not reopen the old selection.
- **Bounds and failure.** A compound query keeps the updated row; an injected rejected write leaves both live and cached flags unchanged.
- **Proof.** Each scenario captures screenshots and accessibility snapshots. `--search-case` accepts `cached-star`, `cached-read`, `cached-outside`, `starred-query`, `starred-restar`, `starred-empty-add`, `selected-starred-query`, `selected-starred-folder`, `unread-query`, `complex-query` or `failed-write`.

## Gotchas

- Each scenario reloads the fixture; all writes occur through rendered row actions, never direct boundary mutation.
- The fixture models only the two operators needed here, not Gmail's full query language.
- These checks cover Chromium fixtures, not live Gmail or the packaged app.
