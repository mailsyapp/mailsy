# Attachments

The composer attaches local files to a message, by whatever entrance the OS offers: each of the three composer surfaces (the toolbar Compose, an opened draft, the reply/forward composer) offers `Attach files` and accepts **file drops anywhere over its whole box**; each file shown as a chip with its size and a remove control; the send and the draft autosave carry the bytes through the boundary. A stored draft's own attachments resolve back into the editor when it is reopened, so editing never strips them. And the files do not stop at sending: a message's own attachments render as chips in the conversation read view, each chip doubling as its save affordance through the native save dialog.

## Sub-features

- `compose-attach` picks a file in a fresh compose, shows one chip with the file's name and size, and the send records the attachment filename and bytes in the outbox.
- `drag-drop` drops file(s) onto the composer box — a real `DragEvent` carrying a constructed `File` through `DataTransfer`, so the same drop handlers a Finder drag lands in run — the box draws the dashed hover outline while the drag hovers, the chip appears without a dialog, and the dropped bytes ride the next send alongside anything picked.
- `chip-remove` strikes the chip off, and the next send carries no attachment.
- `draft-roundtrip` opens a stored draft that carries an attachment, shows its chip resolved (not ref-shaped), and the draft send records the resolved bytes.
- `read-view` opens a received thread that carries stored files: the conversation view lists them as chips under the message body, and clicking one drives the save verb with the ref's message id, attachment id, and name.

## How to get to it (user POV)

- Press `Compose`, click `Attach files`, pick a file; or drag a file from Finder and let go anywhere over the composer box.
- Remove a chip with its ×, or send with the files attached.
- Open `Draft: Q4 attachments` in the Drafts folder and send it.
- Open `Receipts for March travel` in the Inbox; click `receipt-a.pdf` under the body to save it.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with an empty outbox; the seeded draft `Draft: Q4 attachments` (`draft-q4`) carries ref `att-q4` whose content `UTQgcGxhbm5pbmcgZGF0YQ==` the mock's attachment store answers; the seeded thread `Receipts for March travel` (`msg-receipts-1`) carries two stored files (`receipt-a.pdf` `att-receipts-1`, `receipt-b.pdf` `att-receipts-2`) with their bytes answered from the same store; a cancelled save is not recorded.
- `scripts/doctor.sh` exits 0.

- **Drop and pick, then send.** Run `node scripts/drive.mjs --feature attachments --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. The synthetic drag shows the dashed hover outline on `form.composer-dragging`, the dropped `meeting-notes.txt` chip labels `12 B`, and the send outbox record carries both files in set order — the drop's `ZHJvcHBlZCBub3Rl` and the canned pick's `Zml4dHVyZQ==`.
- **Remove and send.** Close the retired pane, Compose again, pick, click the chip's remove button; the chip row empties and the second send records no `attachments`.
- **Stored draft round trip.** Open the seeded draft from the Drafts rail; the `q4.xlsx` chip resolves from the store. Send records the draft send with `attachments[0]` filename `q4.xlsx` and data `UTQgcGxhbm5pbmcgZGF0YQ==`.
- **Read view.** Open `Receipts for March travel` in the Inbox; two `attachmentChip-save` chips render under the body. Click `receipt-a.pdf`; the mock's `saveAttachment` verb records `{messageId: 'msg-receipts-1', attachmentId: 'att-receipts-1', filename: 'receipt-a.pdf'}`.
- **Proof.** The driver writes `artifacts/<run-id>/attachments.aria.txt`, `attachments.png`, and the transcript `attachments.log` quoting the outbox saves and records.

## Gotchas

- The drop step dispatches a synthetic `DragEvent` with a real `DataTransfer` holding a constructed `File` — browser-level, no OS drag involved — so it exercises the renderer's real drop handlers. A Finder drag onto the Electron window is the manual tier; it adds nothing the handler path does not already cover unless you distrust the window-level drag plumbing Electron does.
- The pick is the mock's canned file: headless runs have no native dialog, and the canned record is the same shape the real bridge builds from one. Same for the save: the mock collapses the save dialog to "yes"; the record only proves the id/name contract, not the file write.
- After a send the retired composer stays on screen until `Close`; a raw second Compose click does not remount it, so journeys close the retired pane before opening a fresh compose (this is the app's existing retire behavior, not an attachment gap).
- The outbox proof for the stripped send needs `attachments === undefined`, not `[].length === 0`: the composer omits the field for an empty set.
- Over-limit behavior (picking or dropping >20 MB) is enforced in the real main process and by the renderer's cumulative check, and is not covered by a scripted journey; it is the manual tier.
