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

## The rich-body UI pass (probe)

`drive/ui-pass-probe.mjs` runs the regression set for the composed body itself — borders/outline parity with the other fields, the backspace family, Enter shape, caret edits around an image, select-all delete, the one-image-per-drop + chip handoff, fill-mode scroll containment, and the reply-quote wipe. Usage: `node drive/ui-pass-probe.mjs <port>` (Playwright resolves from `drive/node_modules`; snapshot lands in `artifacts/ui-pass-probe.png`). It must end `PROBE: all pass` before any body-editor change ships.

Two isolation probes pin the engine facts the fix relies on:

- `drive/edit-engine-probe.mjs` — vanilla contenteditable: Chromium deletes text and `<br>`s fine, and based on it, a synchronous `innerText` read during the input event aborts a pending `deleteContentBackward` (the reason `reportLater` defers the React report out of the keystroke's task).
- `drive/block-delete-probe.mjs` — vanilla contenteditable at block boundaries: Backspace genuinely no-ops there (caret at the box start with a block ahead; blanks between markers and a block). Engine behavior, not our editor's.

## Gotchas from the UI pass

- Chromium's Backspace stalls at block boundaries and right behind marker `<br>`s (measured on vanilla contenteditable too). `BodyEditor`'s keydown handler claims Backspace only in those stall states and performs the engine's own missing delete: eat the marker, merge across the block seam, unwrap beside text, or — at the box's very start with only a block ahead (a reply quote's opening `<br><br><div class=gmail_quote…>`) — eat the marker then the block, one visible unit per press.
- The "eat ahead" scan at the box's start MUST stop at the editor element. Climbing past it sights the composer chrome (`.attachmentBar`, actions) as "content ahead" — the body's keystrokes deleted React's own attachment bar in testing. This is the sharpest edge in `eatAheadUnit`; the probe's drop/chip scenario catches it.
- The engine eats one unit per press but in its own order: after `a<br>b` the presses give `b`, `a`, then the break — the break survives until the line above it is empty. Probe assertions check progress, not a particular order.
- Manual (claimed) deletions do not feed the engine's undo stack: Ctrl+Z may step over them. Acceptable — the stall states are exactly where the engine had nothing to undo anyway — do not restructure the handler casually.
- `data-empty` (placeholder) is imperative, React never writes it: every DOM-changing path outside `input` (drop, paste, `insertImages`) must run `reportNow`, or the placeholder lingers over content.
- Do not give `.body-editor img` `display: block` — inline images must sit among words; the read-view previews (`readAttachment-preview`) are the only block-shaped ones.
- Fill mode keeps the box scroll-contained (`overflow-y: auto`): long bodies with images never spill under the Send row.
