# Signature

The signature is one stored text every composer can add to a message. The text persists across composes (renderer-local storage); whether a given message carries it is per-compose state that lives in the body itself — the block is ordinary rich content riding every send and autosave, so drafts, replies, and sends need no extra payload field. Scripted tier covers all three surfaces through the renderer.

## Sub-features

- `signature-toggle` adds or removes the marked signature block at the body's end; the button reads the body (pressed state), so hand-deleting the block is as legitimate as the remove click and the state follows either.
- `signature-edit` opens an inline editor for the stored text on the row: empty storage turns the first toggle into the editor (the text is born there), saving persists it, and saving while a block is present re-applies the new text in place of the old one.
- `signature-auto` inserts the stored signature into every fresh compose automatically; a draft or a reply — which already carry their own content — never receive an unasked block.
- `signature-roundtrip` carries the block through the autosave and the Drafts-folder restore (the reopened editor re-derives the pressed state from the stored html), and the send records it in both body forms.

## How to get to it (user POV)

- `Compose` (new email) — the bar sits under the body field with the attachment row: `Signature` toggle and `Edit signature`.
- Drafts folder → a draft row — the same bar in the draft editor.
- A conversation → `reply` / `reply all` / `forward` — the same bar in the inline composer.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run; `scripts/doctor.sh` exits 0.
- Mock signed in with the standard seed; storage starts empty (each run is a fresh context), so the first compose proves the empty-storage path.

Run `node scripts/drive.mjs --feature signature --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`:

- **Empty storage.** A fresh compose shows the toggle unpressed and an empty body; clicking `Signature` opens the inline editor instead of inserting emptiness.
- **Birth + persistence.** Save `Ada Lovelace\nAnalytical Engine Dept.`; the panel closes and `mailsy.signature` holds exactly that text.
- **Toggle + typing.** The toggle inserts the block (pressed, body shows it); typing at the body start keeps the block at the end.
- **Send proof.** The outbox record carries the signature in both forms — `body` (plain text) and `bodyHtml` with the `mailsy-signature` block.
- **Auto-insert.** A second fresh compose opens with the block already present, no toggle click.
- **Draft round trip.** The signed compose autosaves (`__draftSaves` grows); the Drafts row reopens with the block and its pressed state restored; toggling off clears this message only (storage keeps the text); the send carries no signature.
- **Reply surface.** The reply composer starts unpressed, the toggle appends after the quote, and the send keeps `gmail_quote_container` beside the `mailsy-signature` block.
- **Proof.** `artifacts/<run-id>/signature-compose.aria.txt`/`.png` at the composed-with-signature moment and `signature.aria.txt`/`.png` after the reply send.

## Gotchas

- Every `Signature` name lookup needs `exact: true` — `Edit signature` and `Save signature` substring-match it otherwise.
- The pressed state is derived from the editor's DOM on every content report, not tracked by the toggle: a stale state self-corrects on the next report, and the mount report re-derives it on draft reopen.
- Storage is per-context: a drive run never sees a previous run's signature, which is what keeps the empty-storage step deterministic.
- Manual tier only: the Electron shell persists localStorage per profile, so a real restart keeping the text is manual evidence (`manual-signature.png`).
