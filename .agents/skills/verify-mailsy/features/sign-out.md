# Sign out

Sign out ends the current session from inside the app: while signed in, the top actions bar offers a `Sign out` button, choosing it calls the sign-out bridge, and the screen flips back to the exact signed-out view seen after a dead grant — the `Sign in with Google` button over the empty layout, with no mail rows or search text left on screen.

## Sub-features

- `sign-out-offer` shows the `Sign out` button in the top actions bar only while signed in.
- `sign-out-flip` flips the screen to the `Sign in with Google` signed-out state when the button is chosen.
- `sign-out-clear` leaves no mail rows or search text on screen after the flip.

## How to get to it (user POV)

- Launch the app signed in and see the `Sign out` button in the top actions bar.
- Choose the `Sign out` button.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Journey runs signed-in with a fresh page load: do NOT pass `--signed-out`; the mock reports signed-in by default so the inbox renders.
- `scripts/doctor.sh` exits 0.

- **Offer.** Run `node scripts/drive.mjs --feature sign-out --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"`. The Inbox lists seeded mail and the `Sign out` button is visible in the top actions bar.
- **Flip.** Choose the button. The `Sign in with Google` button becomes visible and the Inbox list shows no mail rows.
- **Bridge proof.** A second assertion reads back the recorded call: `window.__signOutClicked === true`.
- **Proof.** The driver writes `artifacts/<run-id>/sign-out.aria.txt` and `sign-out.png`; both identify the feature and show the signed-out screen.

## Gotchas

- Token persistence across a relaunch is the `--signed-out` baseline already covered by the sign-in recipe; it is not re-driven here.
- The mock's `signOut` clears its in-memory token state so `isSignedIn()` reports `false` afterward, the way the real bridge deletes the stored token file; the Google-side revoke of the grant and the `safeStorage` file deletion under it are manual-tier only.
- The mock refuses mail reads and sends while signed out with the real bridge's `Not signed in yet` sentence, so a stray fetch after the flip lands in `recordError` on the sign-in screen instead of painting rows.
- The `Sign out` button exists only when signed in; a missing button means the run passed `--signed-out` or the page never reached a signed-in state.
