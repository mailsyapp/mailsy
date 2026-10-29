# Mailsy verification map

This directory is the maintained source for verifying the user-facing behavior of Mailsy. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Scaffold server started by this run: `RUN_ID=... VERIFY_MAILSY_PORT=... ./scripts/serve.sh start` prints `READY <url>`.
- Fixture mailbox seeded with `Launch checklist` (ada@example.com), `Q3 budget draft` (grace@example.com), a 2-message `Deploy window` thread, the draft `Draft: Q4 planning notes` (`draft-1`, To `team@example.com`), and the spam `You won a free cruise` (`no-reply@lottery-wins.example`, `thread-spam-1`, carrying only the `SPAM` label).
- Fixture mock reports signed-in unless the journey passes `--signed-out`.
- `scripts/doctor.sh` exits 0 for this `RUN_ID` and port.
- Never drive an instance that was not started by this verification run.

## Driving conventions

- Start every recipe from the baseline state (fresh page load) unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names over CSS selectors or DOM position.
- Treat every command as literal. Keep feature IDs, flags, and quoted names unchanged.
- Run journeys only through `node scripts/drive.mjs --feature <id> --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`.
- Restore nothing after a mutation: mock state is in-memory and resets on reload. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with app content visible.
- Send proof includes a read-back of the recorded outbox (`window.__sent`) after the visible status.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.
- Live Gmail and the Electron OAuth loop are manual-tier only; label such evidence `manual-*` and never claim a mock run covered them.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with drive.mjs` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Sign in](./sign-in.md) covers the signed-out entry point and the sign-in bridge call.
- [Sign out](./sign-out.md) covers the signed-in sign-out button, the flip to the signed-out screen, and the clearing of mail and search state.
- [Inbox](./inbox.md) covers conversation list rendering, thread grouping, selecting a thread, and pagination state.
- [Search](./search.md) covers debounced server search, filtering, empty states, and clear.
- [Read thread](./read-thread.md) covers conversation view, message count, and expand/collapse.
- [Compose send](./compose-send.md) covers reply, forward, cancel, and send with outbox proof.
- [Reply all](./reply-all.md) covers the whole-participant reply from the detail pane: author plus To/Cc recipients with the own address excluded, and the unchanged single reply.
- [Compose new](./compose-new.md) covers the toolbar Compose entry point: blank composer, blank-To send blocking, cancel-discard, and fresh send with no threading fields.
- [All Mail](./all-mail.md) covers the All Mail rail entry listing every thread (archived included) and browsing/selecting from it.
- [Drafts](./drafts.md) covers the Drafts folder, the direct draft editor, draft send with threading headers, and row pruning.
- [Draft autosave](./draft-autosave.md) covers compose/draft-edit autosave through the boundary, restore via the Drafts folder, cancel-discard, and the atomic send consuming the autosaved draft.
- [Archive](./archive.md) covers archiving the open inbox thread, list removal, and persistence across a folder refetch.
- [Starred](./starred.md) covers row and detail star toggles plus the Starred view and unstar removal.
- [Category views](./category-views.md) covers the Important view and the Social, Promotions, Updates, Forums category views, each listing its own system-label mail and sharing Inbox's list behavior.
- [Spam](./spam.md) covers the Spam rail view, report spam, not spam, and the All Mail exclusion.
- [Snooze emulation](./snooze-emulation.md) covers Mailsy's own snooze: park via presets, the wake schedule, fast-forwarded wakes, and the restore pair on row and detail.
- [Folder rail](./sidebar.md) covers the rail's thirteen folder affordances: one each, the labels surface hidden in the default view, and folder clicks opening their views.
- [Expanded sidebar](./sidebar-expanded.md) covers the rail's collapse/expand control: named rows and the re-exposed Labels section while expanded, state that survives folder switches, and a clean collapse round trip.
- [User labels](./labels.md) covers the open thread's `Labels` menu apply/remove with a refetch round trip, and the rail labels surface hidden in the default view.
- [Refresh](./refresh.md) covers the live refresh channel: the button's instant busy state and in-flight dedupe, surfaced sweep failures, and arrival of new mail through pushed delta and reset folds without a click.
