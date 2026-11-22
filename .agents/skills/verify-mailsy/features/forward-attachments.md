# Forward attachments

Forwarding preloads the selected message's original attachment bytes as removable chips. Pending or failed originals block Send until loaded, retried successfully, or explicitly removed. Reply and reply-all do not repeat original attachments.

## Sub-features

- `originals` forwards all three files on Receipts for March travel, preserving their bytes and the quoted HTML.
- `remove` omits an explicitly removed original while sending the other two.
- `failure` blocks Send and form submission until Retry succeeds or Remove explicitly drops the unavailable file.
- `loading` keeps Send and picking disabled during Retry and initial prefill.
- `reply-isolation` excludes original attachments from reply/reply-all, including when switching away from an unresolved forward.

## How to get to it (user POV)

- Open Receipts for March travel, choose forward, and enter a recipient.
- Review its three attachment chips; remove one if desired, then Send.
- If a file cannot load, use its Retry or Remove action before sending.
- Choose reply or reply all instead to respond without repeating attachments.

## Driving it with drive.mjs

Preconditions: the standard signed-in fixture mailbox and a scaffold server passing doctor.

- Run `node scripts/drive.mjs --feature forward-attachments --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`.
- The journey sends all three originals, removes one and sends two, injects one failed original and recovers by Retry, and repeats failure with explicit Remove.
- During delayed loading and failure it proves Send is disabled; direct form submission cannot bypass the failure block.
- Switching an unresolved forward to reply cannot leak late attachment results. Fresh reply and reply-all also send no original attachments.
- Each ready/failure/loading state has a screenshot and accessibility snapshot; the transcript asserts filenames and exact boundary-provided bytes in the recorded send request.

## Gotchas

- Failures and held reads are injected only at `window.api.getAttachment`. File controls, composer changes, and sends use the UI.
- The image `cal-shot.png` is a regular attachment and remains a chip, not a newly inserted inline image.
- Forwarded quoted HTML retains main's existing sanitization and image handling. This journey does not change or simulate Gmail MIME generation.
