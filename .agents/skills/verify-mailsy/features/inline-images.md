# Inline images

The compose body is a rich field, not a plain text box: an image dropped or pasted into a composer lands inside the text the way Gmail's inline images do, with editable text above and below it, and it rides the send inside the message html (the raw MIME carries it as a `cid` part grouped with the html). The image-before/after text behavior works on all three composer surfaces — a fresh compose, an opened draft, and the reply/forward composer — because one shared editor is the body everywhere. In the read view, a message's own image attachments preview themselves inline under the body (the bytes render, no save dialog), while non-image files keep their save chips.

## Sub-features

- `editor-inline` drops an image file onto the rich body (or pastes a clipboard screenshot): the image appears in the text where the drop happened, the text stays editable above and below it, and a non-image file in the same drop keeps its chip routing.
- `send-html` sends a message whose body carries the inline image as html with a `data:` URL plus the plain-text fallback around it.
- `draft-roundtrip` autosaves a compose with an inline image; reopening the stored draft shows the image again (the saved html carries it).
- `read-preview` opens a received thread with an image attachment: the image renders itself under the body instead of a save chip; non-image chips keep their save affordance.

## How to get to it (user POV)

- Press `Compose`, type a line, drag an image file from Finder into the body; keep typing after it and send.
- Close the pane by a row click (autosave path), open the draft from the Drafts rail: the image is back.
- Open `Receipts for March travel` in the Inbox: `cal-shot.png` previews inline under the body.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with an empty outbox; the seeded thread `Receipts for March travel` (`msg-receipts-1`) carries two store-answered pdf refs (`att-receipts-1`, `att-receipts-2`) and one image ref `cal-shot.png` (`att-receipts-img`) whose bytes are a real 1x1 PNG.
- `scripts/doctor.sh` exits 0.

- **Drop, type, send.** Run `node scripts/drive.mjs --feature inline-images --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. The synthetic drop carries an image `shot.png` and a text file `keep-as-chip.txt` at once: the image lands in `.body-editor` with a `data:image/png;base64,` src, the text file stays an `attachmentChip`, and text typed after the drop is editable below the image. The outbox record carries `bodyHtml` with the data URL, the plain text around it, and the chip file's bytes as `attachments[0]`.
- **Draft round trip.** The compose autosaved into a real draft; the driver reopens `Inline shot draft` from the Drafts rail and the `.body-editor img` prefills with its data URL again.
- **Read preview.** The driver opens the receipts thread; `.readAttachment-preview img` renders with a `data:image/png;base64,` src beside the two `attachmentChip-save` chips.
- **Proof.** The driver writes `artifacts/<run-id>/inline-images.aria.txt`, `inline-images.png`, and the transcript `inline-images.log` quoting the outbox record.

## Gotchas

- The body editor is uncontrolled contenteditable: Playwright `fill` replaces its whole rich content, and a typed prefix/append needs the caret placed first (`typeAtStart`/`typeAtEnd` in the driver). Reading its content means `innerText`, not `inputValue`.
- The drop is synthetic at the editor element: a real Finder drag is the manual tier, adding nothing the handler path does not already cover.
- The outbox record shows the renderer's html (data URLs); the data-URL-into-MIME-cid rewriting happens in the real main process when the message is built and is covered by the MIME harness, not by this journey.
- After a send the retired composer stays until `Close`, as everywhere else; the journey uses `Close` before switching folders.
