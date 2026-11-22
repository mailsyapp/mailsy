# Search state

Reopening a cached search preserves current star and unread flags. Unstarring in a plain `is:starred` search, or marking read in a plain `is:unread` search, removes the nonmatching row from both active and cached results.

## Sub-features

- `cached-flags` keeps mutations made in search or another view when reopening a cached query without a refetch.
- `operator-membership` removes nonmatching rows from plain starred/unread searches, including cached empty results.
- `narrow-matching` leaves compound query membership to Gmail rather than interpreting it locally.
- `failed-write` leaves flags unchanged when the boundary rejects a mutation.

## How to get to it (user POV)

- Search for `budget`, star or mark the result unread, clear with Escape and search again.
- Make the same changes in Inbox after caching the search, then reopen it.
- Search for `is:starred` or `is:unread` after setting the corresponding flag, then clear that flag.

## Driving it with drive.mjs

Preconditions:

- Doctor and the signed-in fixture scaffold succeed; Inbox contains the read, unstarred `Q3 budget draft`.
- The fixture supports the two starred/unread operators and AND combinations at the Gmail boundary.

- **Flags.** Run `node scripts/drive.mjs --feature search-state --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. Reopened `budget` results keep changed flags; recorded query calls prove cache reuse.
- **Membership.** The same command clears flags inside plain operator results, verifies row removal, then reopens the cached empty results without refetching.
- **Bounds and failure.** A compound query keeps the updated row; an injected rejected write leaves both live and cached flags unchanged.
- **Proof.** Each scenario captures screenshots and accessibility snapshots. `--search-case cached-star`, `cached-read`, `cached-outside`, `starred-query`, `unread-query`, `complex-query` or `failed-write` isolates a scenario.

## Gotchas

- Each scenario reloads the fixture; all writes occur through rendered row actions, never direct boundary mutation.
- The fixture models only the two operators needed here, not Gmail's full query language.
- These checks cover Chromium fixtures, not live Gmail or the packaged app.
