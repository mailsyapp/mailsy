# Draft autosave

Draft autosave keeps composing work alive past an accidental close: a toolbar compose and an opened draft both persist their fields to a real draft through the boundary, so closing the pane without `Cancel` or `Send` (selecting a row, switching folders, an app reset) leaves the text in the Drafts folder instead of losing it. `Cancel` stays a discard action and `Send` still consumes the draft in one atomic step.

## Sub-features

- `compose-autosave` saves a fresh compose's fields (the write creates the draft), and closing the pane without sending keeps the outbox empty.
- `compose-restore` surfaces the autosaved compose as a Drafts row and reopens it prefilled; sending it consumes that draft.
- `cancel-discards` deletes the draft the compose created, so a second Cancel cannot leave content behind.
- `draft-edit-autosave` autosaves edits to an existing draft on that draft's own id, and the edits survive close/reopen with the stored threading headers intact.

## How to get to it (user POV)

- Press the `Compose` button in the toolbar, type, and click any mail row or switch folders without pressing `Send` or `Cancel`.
- Open a seeded draft in the Drafts folder, edit the Message field, and close it the same accidental way.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with the seeded draft `Draft: Q4 planning notes` (`draft-1`), an empty outbox, and an empty autosave record.
- `scripts/doctor.sh` exits 0.

- **Autosave the compose.** Run `node scripts/drive.mjs --feature draft-autosave --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. Fill To/Subject/Message, wait for `window.__draftSaves` to hold one entry (the debounce is ~1.2s), then select `Launch checklist` without pressing `Send` or `Cancel`. The outbox still holds nothing.
- **Restore.** The Drafts rail lists a row subject `Autosaved while typing`; opening it prefills To `brook@example.com` and the typed body. `Send` shows `Message sent.` and the outbox record carries the same `draftId` the boundary answered for the first save.
- **Cancel discards.** Compose again, wait for a second save, then `Cancel`. The recorded `window.__draftDiscards` holds that save's draft id, and the Drafts folder round-trip keeps only the seeded draft plus the sent-consumed rows.
- **Draft edit round trip.** Open `Draft: Q4 planning notes`, append to the Message, wait for a save recorded against `draft-1`, close by selecting an inbox row, then reopen the draft from the Drafts rail. The appended text is in the editor, and `Send` records a `draft-1` send whose `inReplyTo` is still `<q4-plan-parent@example.com>` and whose body carries the appended line.
- **Proof.** The driver writes `artifacts/<run-id>/draft-autosave.aria.txt`, `draft-autosave.png`, and the transcript `draft-autosave.log` quoting the recorded saves, discards, and outbox entries.

## Gotchas

- The save is debounced (~1.2s after the last keystroke) and the write is async: wait on `window.__draftSaves.length`, never a fixed sleep.
- The restore surface is the Drafts folder, not the composer: pressing `Compose` again opens a blank form on purpose (Gmail parity — the autosaved draft lives in the folder).
- A failed autosave surface appears inside the composer as `Draft not saved: ...` while the fields keep their text; if the pane is already closed the boundary state is the only witness.
- The seeded `compose-new` journey shares the same recorder: `window.__draftSaves` starts empty per page load, so run one feature per page load or account for earlier saves.
