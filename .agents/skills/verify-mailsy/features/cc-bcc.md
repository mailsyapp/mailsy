# cc-bcc

## Journey

`cc-bcc` — drives the Cc/Bcc composer surface end to end through the real
renderer:

1. **reply all never grows a Bcc.** Opens Standup notes, clicks `reply all`,
   asserts the Bcc field is not revealed and the Cc field is open (it was
   prefilled).
2. **Fresh compose reveal.** Composes new mail: only To and Subject inputs
   exist at first. Clicking `Cc` reveals the field and hides its link
   (idempotent reveal); typing keeps it open. Reveals `Bcc` the same way,
   fills Cc `cecil@example.com` and Bcc `secret@example.com`, fills To, sends.
   Boundry proof: the outbox record carries `cc` and `bcc` exactly as typed.
3. **Draft round trip.** Opens the seeded draft (`draft-1`, which carries a
   Cc header with grace@example.com): the Cc field restores from the Gmail
   draft headers and opens ready-filled. Reveals Bcc, types
   `secret@example.com`, waits for the autosave boundary to record a
   `draft-1` save containing that bcc (same payload as the rest of the
   composer state), navigates away, reopens the draft, asserts both Cc and
   Bcc restored, sends, and asserts the outbox record for `draft-1` carries
   both lists.

## Preconditions

- Fixture: `draft-1` seeds `cc: "Grace Hopper <grace@example.com>"`.
- The mock persists cc/bcc through `saveDraft` (update and create) and its
  send verbs enforce the same receipt rule as the real boundary (at least
  one of `to`/`cc`/`bcc` non-empty), mirroring main's `assertMessageFields`.

## Gotchas

- The To row now also holds the Cc/Bcc reveal links; journeys that count
  `.composerField input` must remember Cc/Bcc inputs only exist (and
  reindex To/Subject) once their link was clicked or the restored content
  carried a carbon list. The existing `drafts`, `compose-send`, and
  `compose-new` journeys keep their indexes valid because their composers
  never reveal carbon fields; the `cc-bcc` journey pins the reveal itself.
