# Category views

The Important view and the four Gmail category views (Social, Promotions, Updates, Forums) are rail entries that list the mail carrying the matching system label (`IMPORTANT`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS`): same thread grouping, pagination, search, and row actions as Inbox. A category label is not an All Mail removal — all five views' mail stays listed in All Mail — and no view lists mail whose label belongs to a different view.

## Sub-features

- `important-view` lists the account's IMPORTANT-labeled mail from the `Important` rail entry.
- `category-views` list the seeded CATEGORY_-labeled threads from their own rail entries.
- `label-partition` keeps each view to mail carrying only its own label.
- `all-mail-partition` shows category and important mail still listed in All Mail.
- `category-select` opens a conversation's detail from a category view.

## How to get to it (user POV)

- Choose the `Important` button in the folder rail to open the Important view.
- Choose `Social`, `Promotions`, `Updates`, or `Forums` in the folder rail to open that category's view.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with the seed mailbox untouched, including the five label-seeded threads (`Budget approval needed by Friday` with `IMPORTANT`; `Weekend meetup photos`, `Trail shoes flash sale`, `Your storage usage report`, `New reply in your thread` with one `CATEGORY_*` label each).
- `scripts/doctor.sh` exits 0.

- **Important view.** Run `node scripts/drive.mjs --feature category-views --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. The `Important` complementary landmark lists `Budget approval needed by Friday`, and the Social thread stays out of it.
- **Category views.** Each of `Social`, `Promotions`, `Updates`, `Forums` lists its own seeded thread, and the Important thread stays out of the Social view.
- **Detail parity.** Selecting `Weekend meetup photos` from the Social view opens its heading in the `Email content` region.
- **All Mail partition.** The All Mail landmark still lists the Social and Important threads — a category label is not an All Mail event.
- **Proof.** The driver writes `artifacts/<run-id>/category-views.aria.txt`, `category-views.png`, and the transcript `category-views.log`.

## Gotchas

- The views ride the direct `labelIds` system-label filter, unlike the Snoozed view's `in:snoozed` query: re-running the live tier must go through the real `labelIds` path, so keep `manual-category-views` evidence separate from `manual-snooze`.
- Rows are located by exact subject text inside the view's complementary landmark, never by index; subjects collide nowhere with the standard seeds.
- `report spam` is not offered on these views's details (the same set that excludes Drafts/Sent) — do not read its absence as a listing failure.
- Nothing reaches Gmail here; the mock holds labels in memory. The live tier verifies the same paths with the real API.
