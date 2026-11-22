# Pagination

Run `node scripts/drive.mjs --feature pagination --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"` against the standard signed-in fixture.

- Seed 64 additional Inbox threads and hold the response to `Load more`. Deliver a new first-page thread and push two resets before releasing page two. Verify one quiet fold runs afterward and both the delivery and all loaded rows are visible.
- Archive and delete two threads from page two, then load the third page. Check that every remaining fixture thread appears exactly once and that there is no continuation.
- Evidence: `pagination-overlap` and `pagination` ARIA snapshots and screenshots, plus the `pagination.log` driver transcript.
