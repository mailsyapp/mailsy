# Snooze emulation

Mailsy's own snooze: because the Gmail API cannot write the SNOOZED pseudo-label, parking rides the `Snoozed by Mailsy` user label plus an INBOX removal, exactly the mover pattern real clients use. The write is one `threads.modify` and the restore is its reverse pair plus a schedule-record clear. The wake time is persisted in main (`userData/snooze-schedules.json`), and restore paths all funnel through one verb: a timeout at the recorded wake moment, the renderer's periodic `snoozeTick` sweep, and a startup catch-up after a closed window. Mailspring's caveat applies while stated in the UI: if the app is closed at wake time, the thread returns on the next launch. The Snoozed rail is the union of the native parked set (the `in:snoozed` query) and this emulated set (the user label), deduped by thread id, so one rail entry stays one concept. There is no custom datetime picker in v1 (follow-up).

## Sub-features

- `snooze-park` snoozes the open thread from the detail pane through the preset choices (`snooze` opens `Tomorrow` / `Later this week` / `Next week`); the row leaves the Inbox list, the pane closes, and the boundary records the label pair with `Snoozed by Mailsy` added and `INBOX` removed plus the future wake time in the schedule.
- `snooze-union` lists the emulated row beside the native parked rows in the Snoozed view, and All Mail keeps all parked mail (neither parking side removes from All Mail).
- `snooze-wake` restores the parked thread at its wake time: under fast-forwarded clock time the periodic sweeps restore the pair and the thread reappears in the Inbox with the schedule record cleared and the reverse mod recorded.
- `restore-row` unsnoozes an emulated row directly, clearing the schedule record before its wake and recording the reverse pair.
- `restore-detail` carries the same restore verb in the open detail pane for an emulated parked thread.

## How to get to it (user POV)

- Open a thread in Inbox (or All Mail / Starred), choose `snooze` in the detail pane, then one of the three presets.
- Find parked mail in the `Snoozed` rail entry, where Mailsy-parked rows sit beside Gmail-native parked ones.
- Return a row with `unsnooze` (row-level or in the open detail pane), or wait the wake time out with the app open.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run; `scripts/doctor.sh` exits 0.
- Mock reports signed in. The journey installs the page clock and fast-forwards it 48 hours, so no parked mail survives into other assertions, and mock state resets on reload anyway.

- **Park via presets.** Run `node scripts/drive.mjs --feature snooze-emulation --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. `Launch checklist` opens in the Email content region; `snooze` reveals the three presets; `Tomorrow` removes the row from the Inbox list and closes the pane.
- **Boundary proof.** The mock's `window.__mods` holds one thread-kind record for `thread-launch` adding `Snoozed by Mailsy` and removing `INBOX`, and `window.__snoozeSchedule` holds one future-time entry for the thread.
- **Union.** The `Snoozed` rail entry lists the emulated `Launch checklist` row beside the seeded native `Vendor pricing follow-up`; All Mail still lists the parked row.
- **Wake.** The clock fast-forwards 48 hours; the Inbox refetch lists `Launch checklist` again, the schedule is empty, and the second mod is the reverse pair.
- **Row restore overrides the wake.** `Q3 budget draft` is parked through `Next week`, then `unsnooze` on its Snoozed row removes it there, empties the schedule, and records the reverse pair without waiting for the wake.
- **Detail restore.** `Launch checklist` is parked once more through `Later this week`; opening it in the Snoozed view and choosing `unsnooze` records the same reverse pair and empties the schedule; the Inbox refetch lists it.
- **Proof.** The driver writes `artifacts/<run-id>/snooze-emulation.aria.txt`, `snooze-emulation.png`, and the transcript `snooze-emulation.log` quoting the recorded mods and schedule states.

## Gotchas

- The wake proof runs on `page.clock`, installed by the driver before the app loads for this feature only; without the install the 30-second sweeps tick in real time and a 24-hour preset would never fire inside a run.
- The schedule lives in the mock for the scripted tier — main's `snooze-schedules.json` persistence and its startup catch-up are not exercised here (no Electron main process). Verify the closed-window story in the manual tier.
- `labelIds` listing of `Snoozed by Mailsy` is modeled inside the mock's Snoozed union; main's labels.list/create resolution runs only where the live Gmail path exists (manual tier), so do not expect a labels-surface call record here.
- Auto-read interference: seeded threads arrive read, so opening one never injects an UNREAD-modify; keep new journey steps from touching unread seeds or the mod counts in this feature shift.
- The old `snooze` feature's former "no snooze action" pin is superseded: the affordance exists and its write rides the user label. SNOOZED pseudo-label writes remain forbidden in both mock and live API.
