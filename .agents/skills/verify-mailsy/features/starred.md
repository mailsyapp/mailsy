# Starred

Starring flags a conversation for later: a star control on each list row and in the open email flips the thread's STARRED label, and a Starred rail view lists every starred message. Unstarring from the Starred view removes the row from that view the way archive leaves the Inbox list.

## Sub-features

- `row-star` — star/unstar a conversation from its list row; the row's star button toggles between Star and Unstar with a pressed state.
- `starred-view` — the Starred rail entry opens a view listing mail that carries the STARRED label.
- `starred-unstar` — unstarring from the Starred view removes the row and records the label removal.
- `detail-star` — the open email offers a star/not-starred toggle that mutates the same thread label.

## How to get to it (user POV)

- Click the star button (aria-label `Star`) on a list row after signing in on the Inbox.
- Click the `Starred` button in the folder rail.
- Click `Unstar` on a row inside the Starred view.
- Open any email; click the `not starred` button in the email header.

## Driving it with drive.mjs

Preconditions:

- Baseline from `README.md` (scaffold server, seeded mailbox, doctor passes). Seed mail is unstarred.

- Star a list row and prove the boundary gets the thread label add, then open the Starred view and see the mail:

  `node scripts/drive.mjs --feature starred --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`

  Observable result: driver log shows `RESULT pass feature=starred`; artifacts `starred.aria.txt`, `starred.png`, `starred.log` record the Inbox row flip, the Starred view listing, the unstar row removal, and the detail-view toggle.

## Gotchas

- The row star control is an icon button whose accessible name flips between `Star` and `Unstar`; assert on the exact name or `aria-pressed`.
- The detail-view control is a text button named `not starred` / `starred`, deliberately distinct from the row buttons' names.
- Starring is thread-level: every message in the conversation carries the label, and all rows sharing a threadId restyle together.
- The seed mailbox contains no starred mail, so the Starred view is empty at baseline; every Starred-view proof must first star something in the run.
