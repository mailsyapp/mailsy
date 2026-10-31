# Expanded sidebar

The rail has two widths. Collapsed (the default) is the icon column with tooltips that the `sidebar` and `labels` journeys assert; expanded turns the same rail into named rows and re-exposes the Labels section the default view gates off. The expanded rail is an overlay drawer over the mail: the mail column keeps its exact spot, and selecting any view folds the drawer back.

## Sub-features

- `expand-control` is the single expand/collapse control at the top of the rail: `Expand sidebar` when collapsed, `Collapse sidebar` when expanded, exactly one at all times in the vertical layout.
- `named-rows` renders each of the thirteen folders as an icon + name row while expanded, each a unique button, with tooltips suppressed where the text already says it.
- `labels-section` shows the Labels section permanently while expanded: the seeded user label as a full-width chip row carrying its name and thread count, a hover-revealed remove control at the row's right edge, and the `New label` affordance opening the same inline form the collapsed Tag toggle reveals. The collapsed-only Tag toggle is gone while expanded.
- `expands-over-inbox` overlays the drawer in the rail's 56px grid track: the mail column's own box is the same before and after expanding (the journey measures it), never pushed or reset. The mobile layout keeps the horizontal row look and the pinned chip badge (no hover to reveal a control with).
- `collapse-on-select` folds the drawer the moment a folder or label is chosen; the chips state the Tag toggle left is preserved across that collapse, and the default view is restored by hiding them as usual.

## How to get to it (user POV)

- Look at the left rail in the default view: icon buttons with hover tooltips, one control above them.
- Press `Expand sidebar`; the rail widens, folder names appear, and the labels section appears below the folders with the seeded `Receipts` chip and `New label`.
- Switch folders (the rail stays expanded), then press `Collapse sidebar` and see the default view again.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Seeded label `Receipts` present (same mailbox seed the `labels` journey uses).
- `scripts/doctor.sh` exits 0.

- **Expand over the mail, not into it.** Run `node scripts/drive.mjs --feature sidebar-expanded --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. The journey first asserts the default view still gates the labels surface off (`New label` absent), measures the mail column's own box, reveals the chips once through the collapsed Tag toggle, then clicks `Expand sidebar` and waits for the control to announce `Collapse sidebar`. While expanded, the Tag toggle itself is gone (the section is permanent there), and the measured mail column box is unchanged — the drawer covered the list's left edge, it did not move it.
- **Named rows and the labels section.** Every folder button is unique by name while expanded, exactly one `Labels` heading exists, the `Receipts` chip is readable by name, and `New label` opens the inline `Label name` form (Escape dismisses it).
- **Selection collapses.** The journey picks Trash from the open drawer; the rail folds back to the collapsed control and the chips the Tag toggle left are still on screen (`collapse-on-select`). Hiding them restores the default view the `sidebar` journey asserts.

## Proof

`artifacts/<run-id>/sidebar-expanded.aria.txt`, `sidebar-expanded.png` (the collapsed end state) and the transcript `sidebar-expanded.log`.

## Gotchas

- The end-of-journey screenshot is the collapsed view on purpose: the last step proves the default view is restored. For an expanded visual, the one-off probe `drive/expand-shot-probe.mjs` (scratch, per the SKILL.md scratch rules) clicks the control against a running server and screenshots it.
- The journey runs inside a `mailto:`-free viewport (1280x800 desktop); the mobile media query keeps the expanded state functional in a narrow window too, but no journey covers that reflow.
- Names change with the mode: expanded folder buttons drop `aria-label` so their accessible name is the visible text. Journeys may keep using `getByRole('button', { name })` either way.
