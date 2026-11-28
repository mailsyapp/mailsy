# Implicit submit

Every composer is a `<form>` whose `Send` button submits it, but pressing Enter inside a single-line input must never send the message: the browser's implicit form submission would fire `onSubmit` straight out of the To, Cc, Bcc, or Subject field. A shared keydown guard (`blockImplicitSubmit` in `src/renderer/src/lib/composerForm.ts`) swallows Enter targeted at inputs on all three composer surfaces, while clicking `Send` still submits and sends exactly once.

## Sub-features

- `enter-blocked` Enter pressed in the To or Subject input sends nothing and leaves the composer open with its field contents intact, on every surface.
- `send-untouched` clicking `Send` afterwards still submits the form and records exactly one send.

## How to get to it (user POV)

- `Compose` (new email) — type in To or Subject, press Enter.
- Drafts folder → a draft row — same fields, same Enter behavior.
- A conversation → `reply` / `forward` — same fields in the inline composer.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with an empty outbox; the `Draft: Q4 planning notes` draft (`draft-1`) and the `Launch checklist` thread are seeded.
- `scripts/doctor.sh` exits 0.

Run `node scripts/drive.mjs --feature implicit-submit --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. On each surface the journey types into To and Subject, presses Enter in each input, asserts the recorded outbox gained nothing and the composer is still open with both values intact, then clicks `Send` and asserts exactly one outbox record with the typed subject.

- **New compose.** To `ada@example.com`, subject `Enter-safe compose`; the send records that subject. `implicit-submit-compose` snapshot.
- **Draft editing.** The seeded draft's To `team@example.com` and subject `Draft: Q4 planning notes` each grow a typed phrase at the caret; the send records the resulting subject. `implicit-submit-draft` snapshot.
- **Reply.** To and `Re: Launch checklist` each grow a typed phrase at the caret; the send records the resulting subject. `implicit-submit-reply` snapshot.
- **Forward.** To `ada@example.com`, `Fwd: Launch checklist` grows the same phrase; the send records the resulting subject. `implicit-submit-forward` snapshot.
- **Proof.** Four snapshots' `.aria.txt`/`.png`, the transcript `implicit-submit.log`, and a final assertion that the outbox holds exactly four sends, one per surface.

## Gotchas

- The guard fires on keydown, not on the submit event, so the proof is that `window.__sent` stays put after Enter — a journey that only checks the Send button's enabled state would miss a real implicit submission.
- The `Edit link` group's inputs live inside the same form: their Enter handler runs first and applies the link; the form-level guard only prevents the submission, so Enter-applies-link keeps working and stays covered by the `rich-text` journey.
- Enter on the Send button is a real click path, not an input-targeted keydown — it still sends; the guard only sees `HTMLInputElement` targets.
