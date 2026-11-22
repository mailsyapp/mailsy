# Safe draft attachments

Stored draft attachments must load before saving or sending can replace them. Failed originals stay protected until Retry succeeds or the user explicitly removes them, and concurrent additions cannot exceed the cumulative attachment limit.

## Sub-features

- `loading` blocks Send, autosave and picking until originals load; drops explain that the user must try again.
- `remove-failed` makes removal of an unavailable original explicit before saving and sending without it.
- `retry-failed` preserves protection through another failed attempt and restores bytes after a successful Retry.
- `concurrent-adds` rejects the addition that crosses 20 MiB, preserving the accepted file.

## How to get to it (user POV)

- Open Drafts, then Draft: Q4 attachments. While its file is loading, Send and Attach files are disabled.
- If loading fails, choose Retry beside the named file, or Remove to deliberately omit it.
- After loading, pick another file and send both files, or drop several files into a compose.

## Driving it with drive.mjs

Preconditions:

- Scaffold server and doctor succeed with the standard signed-in fixture mailbox.
- The seeded draft `draft-q4` contains `q4.xlsx`; the canned picker returns `fixture-file.pdf`.

- **Protect originals.** Run `node scripts/drive.mjs --feature draft-attachments-safe --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. Delayed attachment reads leave Send and picking disabled, and edited fields do not autosave. Once released, picking and sending preserve both original and picked bytes.
- **Recover failures.** The same command injects a rejected attachment read, proves the save/send block, then verifies explicit Remove allows an empty attachment save and send. A fresh draft retries unsuccessfully, remains protected, then retries successfully and sends the original bytes.
- **Concurrent additions.** The same command drops two real 12 MiB files before either read finishes; one chip and the existing limit error remain. Sending carries only the accepted file.
- **Proof.** The driver captures `draft-attachments-loading`, `draft-attachments-failed`, `draft-attachments-retried`, and `draft-attachments-limit` screenshots and accessibility snapshots, plus the journey transcript.

## Gotchas

- Attachment-read delay and failures are injected only at `window.api`; all composer actions use the UI.
- A controlled browser clock advances beyond the 1200ms autosave debounce while reads are unresolved. No real sleep is needed to prove a blocked save.
- Picking is deliberately unavailable during prefill; the journey verifies a disabled click cannot reach the picker, then picks after loading and checks both payloads.
- Reload resets fixture state between scenarios. Large-file drops use real FileReader conversion rather than invented attachment sizes.
