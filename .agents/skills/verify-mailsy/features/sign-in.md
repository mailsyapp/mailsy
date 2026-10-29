# Sign in

Sign in is the gateway into Mailsy: a signed-out user sees a `Sign in with Google` button, choosing it starts the Google OAuth loop in the system browser, and a signed-in user lands directly in the inbox.

## Sub-features

- `sign-in-offer` shows the sign-in button when no token is stored.
- `sign-in-start` invokes the auth bridge when the button is chosen.
- `sign-in-persist` returns directly to the inbox when a token is stored.

## How to get to it (user POV)

- Launch the app with no stored token and see the `Sign in with Google` button.
- Choose the `Sign in with Google` button.

## Driving it with drive.mjs

Preconditions:

- Scaffold server healthy for this run.
- Journey runs with `--signed-out` so the mock reports no stored token.
- `scripts/doctor.sh` exits 0.

- **Offer.** Load the app signed-out. Run `node scripts/drive.mjs --feature sign-in --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT" --signed-out`. A button named `Sign in with Google` is visible and no inbox list is shown.
- **Start.** Choose the button (same command). The driver asserts the sign-in bridge was invoked.
- **Proof.** Capture the signed-out state. The driver writes `artifacts/<run-id>/sign-in.aria.txt` and `artifacts/<run-id>/sign-in.png`. Both identify the feature and show the sign-in button.

## Gotchas

- The fixture mock auto-approves sign-in as a no-op. The real Google consent page, the loopback-code exchange, and token persistence are manual-tier only (`npm run dev` against a real account).
- `sign-in-persist` is covered implicitly: every other feature journey starts signed-in. Do not add a separate live-token fixture.
- If the button is missing, check whether the run passed `--signed-out`; without it the mock reports signed-in and the inbox renders instead.
