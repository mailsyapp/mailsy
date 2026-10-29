# Drafts

Drafts lets the user work from an unsent message: the Drafts folder lists seeded drafts, opening one shows a direct editable form, sending it records the send (including the draft's stored threading headers) and removes the draft from the folder inside a short delay.

## Sub-features

- `drafts-list` lists the seeded draft in the Drafts folder.
- `draft-open` opens a direct editor prefilling To/Subject/Message from the draft.
- `draft-send` sends and records the outbox entry with the draft's stored `inReplyTo`/`references` headers (not the draft's own Message-ID).
- `draft-prune` removes the sent row from the list after the `Message sent.` delay, even if the row was re-opened inside the window.

## How to get to it (user POV)

- Choose the `Drafts` button in the folder rail, then choose the draft row.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with the seeded draft `Draft: Q4 planning notes` (`draft-1`, To `team@example.com`, stored `inReplyTo` `<q4-plan-parent@example.com>`) and an empty outbox.
- `scripts/doctor.sh` exits 0.

- **List + open.** Run `node scripts/drive.mjs --feature drafts --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. The `Drafts` landmark lists `Draft: Q4 planning notes`, a `Draft` heading appears, and To contains `team@example.com`.
- **Send.** Choose `Send` (same command). `Message sent.` appears and the recorded outbox holds a `draft-1` entry whose `inReplyTo` is `<q4-plan-parent@example.com>`.
- **Prune.** The row disappears even after re-opening it inside the delay, and a folder round-trip refetch shows the Drafts folder without the draft.
- **Proof.** The driver writes `artifacts/<run-id>/drafts.aria.txt`, `drafts.png`, and the transcript `drafts.log` quoting the outbox record.

## Gotchas

- Threading proof lives in the outbox record: `inReplyTo` must equal the *stored* reply header, never the draft's own `<draft-1@example.com>` Message-ID.
- The row prune is delayed ~2s on purpose ("Message sent." proof); waiting for `state: detached` is required, not the empty folder immediately.
- Nothing reaches Gmail here; the mock models drafts.send by recording the send and dropping the draft in one step. Real delivery/consumption is manual-tier only.
