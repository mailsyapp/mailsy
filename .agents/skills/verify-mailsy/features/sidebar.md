# Folder rail (sidebar)

The rail is the leftmost affordance strip: one button per mail folder, each opening that folder's view as the screen. The category stack sits Important first with the four inbox tabs after it. The rail's user-label section (chips, New label) is the expanded-sidebar surface and stays hidden in the default view.

## Sub-features

- `sidebar` the journey: every rail affordance is unique, the labels surface is hidden in the default view, and folder clicks open their views (All Mail, Trash sampled) with an Inbox round trip.
- `dwell-tips` shows an affordance's tooltip pill only after ~0.5s of pointer rest, and once one tip is out the rest of the rail's tips show immediately (`.tips-active`), until the pointer leaves the rail and the wait recharges.

## How to get to it (user POV)

- The rail buttons are the folder entry points: Inbox, Starred, Snoozed, Important, Social, Promotions, Updates, Forums, Drafts, Sent, Spam, Trash, All Mail. Each is an `aria-label` that names its folder; resting the pointer on one ~0.5s shows its tooltip pill.
- No label chips or `New label` button render in the default view; they belong to the future expanded sidebar.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run, starting in the Inbox.
- `scripts/doctor.sh` exits 0.

- **Every affordance renders once.** Run `node scripts/drive.mjs --feature sidebar --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. Each of the thirteen folder names matches exactly one rail button; a missing or duplicated mapping fails.
- **Labels hidden.** The `New label` affordance does not render in the default view.
- **Clicks open views.** `All Mail`, then `Trash`, each names its complementary landmark; returning to `Inbox` re-opens the Inbox.

## Gotchas

- The thirteen names are exact accessible names, not substrings: `All Mail` is one entry, and `Important` is not matched by `Starred` or vice versa.
- The rail's tooltips are not `title` attributes: they are `data-tip` pills the FolderRail dwell logic reveals (`handleTipHover`, TOOLTIP_DWELL_MS ~= 500ms). Drive journeys never hover, so no scripted step asserts a tip; read the tooltip state out of `data-tip` + `.tips-active` if a manual check ever needs to, never out of a `title`.
- The labels absence is asserted here and again in the `labels` journey; both fail if the labels surface ever renders by default, which is intended until the expanded-sidebar feature re-enables it behind its gate.
