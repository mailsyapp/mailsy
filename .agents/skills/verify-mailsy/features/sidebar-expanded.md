# Expanded sidebar

The rail has two widths. Collapsed (the default) is the icon column with tooltips that the `sidebar` and `labels` journeys assert; expanded turns the same rail into named rows and re-exposes the Labels section the default view gates off. One control flips between them, and the state rides every folder switch until it is collapsed again.

## Sub-features

- `expand-control` is the single expand/collapse control at the top of the rail: `Expand sidebar` when collapsed, `Collapse sidebar` when expanded, exactly one at all times in the vertical layout.
- `named-rows` renders each of the thirteen folders as an icon + name row while expanded, each a unique button, with tooltips suppressed where the text already says it.
- `labels-section` shows the Labels section permanently while expanded: the seeded user label as a full-width chip row carrying its name and thread count, the `New label` affordance opening the same inline form the collapsed Tag toggle reveals, and the section gone again after collapsing.
- `state-rides-renders` keeps the expansion across a folder switch and collapses back to a default view identical to the one the `sidebar` journey asserts.

## How to get to it (user POV)

- Look at the left rail in the default view: icon buttons with hover tooltips, one control above them.
- Press `Expand sidebar`; the rail widens, folder names appear, and the labels section appears below the folders with the seeded `Receipts` chip and `New label`.
- Switch folders (the rail stays expanded), then press `Collapse sidebar` and see the default view again.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Seeded label `Receipts` present (same mailbox seed the `labels` journey uses).
- `scripts/doctor.sh` exits 0.

- **Expand.** Run `node scripts/drive.mjs --feature sidebar-expanded --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. The journey first asserts the default view still gates the labels surface off (`New label` absent), clicks `Expand sidebar`, and waits for the control to announce `Collapse sidebar`.
- **Named rows and the labels section.** Every folder button is unique by name while expanded, exactly one `Labels` heading exists, the `Receipts` chip is readable by name, and `New label` opens the inline `Label name` form (Escape dismisses it).
- **State and round trip.** The journey switches to Trash and back while expanded (expansion and the labels section survive the re-render), then collapses and asserts `New label` is gone and Inbox browsing still works.

## Proof

`artifacts/<run-id>/sidebar-expanded.aria.txt`, `sidebar-expanded.png` (the collapsed end state) and the transcript `sidebar-expanded.log`.

## Gotchas

- The end-of-journey screenshot is the collapsed view on purpose: the last step proves the default view is restored. For an expanded visual, the one-off probe `drive/expand-shot-probe.mjs` (scratch, per the SKILL.md scratch rules) clicks the control against a running server and screenshots it.
- The journey runs inside a `mailto:`-free viewport (1280x800 desktop); the mobile media query keeps the expanded state functional in a narrow window too, but no journey covers that reflow.
- Names change with the mode: expanded folder buttons drop `aria-label` so their accessible name is the visible text. Journeys may keep using `getByRole('button', { name })` either way.
