# Safe draft attachments

Stored draft attachments must resolve before sending. Autosave continues while they load or fail: unresolved originals ride the save request as retained refs, which main fetches before building MIME. Failed originals stay protected until Retry succeeds or the user explicitly removes them, and concurrent additions cannot exceed the cumulative attachment limit.

## Sub-features

- `loading` blocks Send and picking until originals load; non-image file drops explain that the user must try again. Autosave retains unresolved originals.
- `dismissed-edits` flushes edits when leaving a failed-load draft; reopening keeps the edited subject and original attachment.
- `remove-failed` makes removal of an unavailable original explicit before saving and sending without it.
- `retry-failed` preserves protection through another failed attempt and restores bytes after a successful Retry.
- `save-failure` reports a retained-original fetch error without modifying the stored draft.
- `replacement-ids` retires old message/attachment ids on each save, then proves Retry and later retained saves adopt the saved message's refs without an identity-only save loop.
- `queued-replacement` removes one original and leaves during an in-flight save; the queued unmount save uses replacement ids without restoring the removed original.
- `concurrent-adds` rejects the addition that crosses 20 MiB on new compose, draft edit, reply and forward, preserving the accepted file.

## How to get to it (user POV)

- Open Drafts, then Draft: Q4 attachments. While its file is loading, Send and Attach files are disabled.
- If loading fails, choose Retry beside the named file, or Remove to deliberately omit it.
- After loading, pick another file and send both files, or drop several files into a compose.

## Driving it with drive.mjs

Preconditions:

- Scaffold server and doctor succeed with the standard signed-in fixture mailbox.
- The seeded draft `draft-q4` contains `q4.xlsx`; the canned picker returns `fixture-file.pdf`.

- **Protect originals.** Run `node scripts/drive.mjs --feature draft-attachments-safe --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. Delayed renderer reads leave Send and picking disabled while autosave carries retained refs and main preserves their stored bytes. Once released, picking and sending preserve both original and picked bytes.
- **Keep dismissed edits.** A failed renderer read does not prevent the subject edit from flushing on a folder switch. Reopening verifies both the edited subject and original attachment.
- **Recover failures.** The same command verifies Remove alone triggers a save and the removed original stays gone on reopen. A fresh draft retries unsuccessfully, remains send-blocked, then retries successfully and sends the original bytes. A failed main-process fetch reports a save error without changing the stored draft.
- **Follow saved identities.** `--attachment-case rotate` saves two failed originals, retries one using its new ids, saves again while retaining the other, then retries and sends both exact byte sets. `--attachment-case rotate-queued` holds the first save response while editing, removing and switching folders, then verifies the queued save.
- **Concurrent additions.** On each of new compose, draft edit, reply and forward, the same command drops two real 12 MiB files before either read finishes; one chip and the existing limit error remain. Sending carries only the accepted file.
- **Proof.** The driver captures loading, failure, retry, reopened edits, save failure, and limit states as screenshots and accessibility snapshots, plus the journey transcript. Use `--attachment-case loading`, `edit`, or `remove` to isolate the review regressions.

## Gotchas

- Renderer attachment-read delay and failures are injected at `window.api`; retained-byte resolution is independently modeled by the save boundary. All composer actions use the UI.
- A controlled browser clock advances beyond the 1200ms autosave debounce while reads are unresolved. No real sleep is needed to prove a retained save.
- Picking is deliberately unavailable during prefill; the journey verifies a disabled click cannot reach the picker, then picks after loading and checks both payloads.
- Inline images dropped into the body are not gated. They are body content, not attachment chips; composer-chrome image drops route into the body as well.
- Main's production retention, MIME bytes, validation, size limit and no-write-on-fetch-failure contract are also covered by `node --experimental-strip-types .agents/harness/draft-retained-attachments.ts`.
- That boundary harness also saves a zero-byte inline original through successive message replacements, preserving its named empty MIME part, and rejects malformed base64 payloads.
- Reload resets fixture state between scenarios. Large-file drops use real FileReader conversion rather than invented attachment sizes.
- Every fixture save replaces the message id and attachment ids and removes the old bytes. The save result maps retained originals onto refs read from the saved message; the renderer never invents replacement ids.
