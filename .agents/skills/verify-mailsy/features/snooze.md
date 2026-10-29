# Snooze

Snooze state is Gmail's, but the SNOOZED pseudo-label itself is read-only from the API: the parking write rides Mailsy's own `Snoozed by Mailsy` user label plus an INBOX removal (see [snooze-emulation](./snooze-emulation.md)), while the native parked set is listable through the `in:snoozed` query and returning native mail is a plain INBOX add. The `Snoozed` view unions both sets, deduped by thread id — never `labelIds:['SNOOZED']` on the native leg, which the live API rejects with 400 "Invalid label: SNOOZED" on both `threads.list` and `threads.modify` (writes of the user label are fine). All Mail keeps listing parked mail: the no-label default excludes only SPAM and TRASH. Unsnooze on a native row (`unsnooze` on a row or in the detail pane) adds `INBOX`, which is Gmail's own "move to Inbox" and ends the parking state; there is no reverse SNOOZED pair to send. Emulated rows restore through the reverse pair instead.

## Sub-features

- `snooze-folder` lists the account's parked threads from the `Snoozed` rail entry via the `in:snoozed` query, seeded parked mail included.
- `no-snooze-write` pins that ordinary mail carries the snooze affordance whose write rides the `Snoozed by Mailsy` user label; the SNOOZED pseudo-label write stays forbidden everywhere.
- `unsnooze` adds `INBOX` from the detail pane or the row-level button, clearing the row from the Snoozed list.
- `all-mail-partition` shows parked mail still listed in All Mail (unlike spam, which All Mail hides) and returned mail back in the Inbox.
- `snooze-surface` (feat/snooze-button) pins the affordance's placement: a first-class action-row button in the detail pane carrying the alarm glyph the rail's Snoozed entry does, offered on every mail-ownership view — Inbox, All Mail, Starred, the category tabs, and label views — and withheld on sent/drafts/spam/trash/Snoozed. Covered by `drive/snooze-surface-probe.mjs` (env `PROBE_PORT`, `PROBE_RUN_ID`; artifacts under `artifacts/<probe-run-id>/`).

## How to get to it (user POV)

- Choose the `Snoozed` button in the folder rail to open the Snoozed view; threads snoozed in Gmail's own apps appear there.
- Open any mail you own (Inbox, a category tab, a label view) and choose `snooze` in the detail pane's action row, then a preset (Tomorrow / Later this week / Next week); parked mail appears in the Snoozed view.
- On a Snoozed row, choose `unsnooze`, or open the thread and choose `unsnooze` in the detail pane.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Mock reports signed-in with two seeded parked threads (`Vendor pricing follow-up`, `thread-snoozed-1`; `Newsletter backlog cleanup`, `thread-snoozed-2`, each carrying only the `SNOOZED` marker) and the standard seed threads untouched.
- `scripts/doctor.sh` exits 0.

- **Snooze affordance.** Run `node scripts/drive.mjs --feature snooze --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. `Launch checklist` opens in the Email content region and the journey asserts the detail pane offers the `snooze` affordance whose write rides the user label (SNOOZED pseudo-label writes stay forbidden).
- **Snoozed view via the query.** The driver opens the `Snoozed` rail entry; both seeded parked threads are listed.
- **All Mail partition.** All Mail still lists the seeded parked mail — parking is not an All Mail event.
- **Unsnooze returns the mail.** Opening a parked thread and choosing `unsnooze` clears it from the Snoozed list, records exactly one thread-kind `modifyLabels` call with `addLabelIds` `['INBOX']` and no `removeLabelIds`, and an Inbox refetch lists it again.
- **Row-level return.** Choosing `unsnooze` on the second parked row clears the row and records the same INBOX-add shape, and the Inbox refetch lists it.
- **Proof.** The driver writes `artifacts/<run-id>/snooze.aria.txt`, `snooze.png`, and the transcript `snooze.log` quoting the recorded modifications.

## Gotchas

- Do not rename the journey's expectation of an INBOX add back into a SNOOZED pair: the authoring agent verified live that `threads.modify` with SNOOZED is rejected, and the mock's `modifyLabels` now throws `Invalid label: SNOOZED` on any SNOOZED touch, matching production.
- Seeded parked mail carries never `UNREAD`: opening it auto-marks read, which would add a modify call and break recorded-modification counts.
- `delete` is hidden in Snoozed: adding TRASH without a parking-state write would leave the local marker inconsistent with the live Snoozed query.
- `archives-vs-snooze`: Mailsy cannot distinguish archived mail from mail snoozed by the API itself; the Snoozed view is the account's true parked set only.
- Nothing reaches Gmail here; the mock models the parking marker in memory. The live tier verifies the same paths with the real API; see `drive/manual-snooze.mjs`.
