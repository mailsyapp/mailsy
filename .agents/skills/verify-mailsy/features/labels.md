# User labels

Labels are real in Mailsy: the open detail pane's `Labels` menu applies and removes labels through thread modify. The rail's label surface (colored chips with the thread total, slash-name create, confirm delete) is the expanded-sidebar surface and stays hidden in the default view until that feature ships.

## Sub-features

- `labels` the journey: the default view shows no rail labels surface, the detail pane's `Labels` menu removes the label on the open thread, the removal persists across a folder refetch, and re-applying records the add.

## How to get to it (user POV)

- Any open thread's `Labels` button lists checkboxes; checking and unchecking applies and removes the label.
- The rail's per-label chips and `New label` affordance do not render in the default view (expanded-sidebar surface, gated off).

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- The seed carries one user label (`label-receipts`, `Receipts`, Gmail purple) applied to the read inbox thread `Receipts for March travel`; no other message carries that id, and nothing seeds UNREAD on it, so the axis stays quiet in sibling journeys.
- `scripts/doctor.sh` exits 0.

- **Hidden default view.** Run `node scripts/drive.mjs --feature labels --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. Neither a `Receipts` chip nor a `New label` affordance renders in the rail.
- **Remove.** Open `Receipts for March travel` from the Inbox; the detail `Labels` menu shows `Receipts` checked; unchecking records a thread modify with `removeLabelIds: ['label-receipts']` in `window.__mods[0]`.
- **Persistence.** An Inbox round trip re-derives the menu from the boundary's label state: the box is unchecked, and re-checking records the add in `__mods[1]`.

## Gotchas

- The detail pane stays mounted across a same-thread folder refetch, so the Labels menu can stay expanded from the removal; the journey only clicks `Labels` when the `Apply labels` group is closed, and a blind toggle can turn the reopen into a close.
- Checkbox state flips asynchronously after the boundary write resolves, so the journey reads checks through `waitForChecked`, not an instant `isChecked`.
- The rail chip browse, slash-name create, and confirm delete are not scripted until the expanded sidebar exposes the rail labels surface; the driver must not weaken the default-view absence assertions to drive them.
- The map's earlier chip-driven steps moved out with the user's sidebar change that hid the labels section; the mock's `createUserLabel` parent-chain behavior is unaffected.
