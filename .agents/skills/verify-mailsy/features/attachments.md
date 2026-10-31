# Attachments

The composer attaches local files to a message: each of the three composer surfaces (the toolbar Compose, an opened draft, the reply/forward composer) offers `Attach files`, displays each picked file as a chip with its size and a remove control, and the send and the draft autosave carry the file bytes through the boundary. A stored draft's own attachments resolve back into the editor when it is reopened, so editing never strips them.

## Sub-features

- `compose-attach` picks a file in a fresh compose, shows one chip with the file's name and size, and the send records the attachment filename and bytes in the outbox.
- `chip-remove` strikes the chip off, and the next send carries no attachment.
- `draft-roundtrip` opens a stored draft that carries an attachment, shows its chip resolved (not ref-shaped), and the draft send records the resolved bytes.

## How to get to it (user POV)

- Press `Compose`, click `Attach files`, pick a file, remove it with the chip's ×, or send with it attached.
- Click `Attach files` inside the reply or forward composer and send.
- Open `Draft: Q4 attachments` in the Drafts folder and send it.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with an empty outbox and the seeded draft `Draft: Q4 attachments` (`draft-q4`, carrying ref `att-q4` whose content `UTQgcGxhbm5pbmcgZGF0YQ==` the mock's attachment store answers).
- `scripts/doctor.sh` exits 0.

- **Pick and send.** Run `node scripts/drive.mjs --feature attachments --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. The canned pick shows the chip `fixture-file.pdf` labeled `7 B`; after `Message sent.` the outbox record carries `attachments[0]` with that filename and `Zml4dHVyZQ==` as its data.
- **Remove and send.** Close the retired pane, Compose again, pick, click the chip's remove button; the chip row empties and the second send records no `attachments`.
- **Stored draft round trip.** Open the seeded draft from the Drafts rail; the `q4.xlsx` chip resolves from the store. Send records the draft send with `attachments[0]` filename `q4.xlsx` and data `UTQgcGxhbm5pbmcgZGF0YQ==`.
- **Proof.** The driver writes `artifacts/<run-id>/attachments.aria.txt`, `attachments.png`, and the transcript `attachments.log` quoting the outbox records.

## Gotchas

- The pick is the mock's canned file: headless runs have no native dialog, and the canned record is the same shape the real bridge builds from one.
- After a send the retired composer stays on screen until `Close`; a raw second Compose click does not remount it, so journeys close the retired pane before opening a fresh compose (this is the app's existing retire behavior, not an attachment gap).
- The outbox proof for the stripped send needs `attachments === undefined`, not `[].length === 0`: the composer omits the field for an empty set.
- Over-limit behavior (picking >20 MB) is enforced in the real main process and is not covered by a scripted journey; it is the manual tier.
