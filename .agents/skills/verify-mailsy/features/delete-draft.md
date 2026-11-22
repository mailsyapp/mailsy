# Draft deletion

A draft the user no longer wants can now be deleted for real: the boundary verb is the same `drafts.delete` the compose Cancel already rode (`window.api.discardDraft`), irreversible — not trash — so both surfaces confirm first with the label-delete idiom (`window.confirm` naming the permanent cost).

## Sub-features

- `delete-draft` the journey: the Drafts row's `delete draft` button confirms and refuses cleanly, a confirmed row delete prunes the row and the Drafts refetch shows it gone, a compose autosaved into a real draft is deleted from its open editor, which closes cleanly and records the right draft id at the boundary.

## How to get to it (user POV)

- Drafts folder rows carry a `delete draft` button next to the opener.
- An open draft's editor (the `Draft` composer) carries the same `delete draft` verb beside `Send`.
- Confirm says: `Delete draft “<subject>”? This permanently discards it; not even Trash keeps a copy.`

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- The seed carries one draft (`draft-1`, `Draft: Q4 planning notes`); the journey deletes it, then composes a fresh draft (`Deleted mid-edit`) through the real autosave path and deletes that one free of the seed.
- `scripts/doctor.sh` exits 0.

Run `node scripts/drive.mjs --feature delete-draft --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`.

- **Refuse.** Click the row's `delete draft`; the confirm dialog is read (message must name the permanent cost) and dismissed; the boundary records zero discards and the row stays listed.
- **Delete from the row.** Accept the confirm; the row leaves, `__draftDiscards[0]` is `draft-1`, and an Inbox→Drafts round trip proves the server-side exclusion survives a refetch.
- **Delete from the editor.** Compose until `__draftSaves` records a save, open Drafts, edit the new draft, and confirm `delete draft` before autosave. The editor and row disappear, the last discard id is the editor's draft id, and a refetch shows no recovery copy.

## Gotchas

- Opening the compose from the Drafts view itself and then clicking `Drafts` hits the same-folder guard (`folder === activeFolder`), which skips both the close and the refetch — the autosaved row never enters the list. The journey round-trips through Inbox, like the seeded `draft-autosave` flow closes over an Inbox row.
- Playwright auto-dismisses dialogs with no listener, so the journey always arms `page.waitForEvent('dialog')` before the click; the refused first pass depends on that processing order.
- Explicit deletes take precedence over recovery: an editor can flush pending edits during unmount, but it cannot turn that discard into a new draft. Remote deletion is exercised separately by the Drafts journey.
