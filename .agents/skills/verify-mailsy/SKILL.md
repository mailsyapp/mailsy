---
name: verify-mailsy
description: Drive and prove the Mailsy Electron mail client (React renderer + Gmail IPC). Reach for it when verifying inbox, search, thread reading, or reply/forward/send behavior, or before claiming any renderer/main change works.
---

# Verify Mailsy

Mailsy is an Electron desktop app (`npm run dev`): a React renderer (`src/renderer/src/`) talks through a preload bridge (`window.api`) to main-process IPC handlers (`src/main/`) that call the Gmail API with OAuth tokens. There is no repo test suite (no Playwright/Cypress/Vitest specs); this skill's harness *is* the test tooling.

Scripted verification therefore runs the **real renderer code** in headless Chromium against a **fixture `window.api` mock** — no Google account, no network, no quota cost. The Electron shell and the live Gmail path are covered as a documented manual tier only.

## Paths

All paths below are relative to the skill directory `.agents/skills/verify-mailsy/`. `REPO` is the checkout root: `git rev-parse --show-toplevel` from inside the checkout, or `VERIFY_MAILSY_REPO` when the skill lives outside the checkout (e.g. a global skills dir).

- Scaffold Vite config: `scaffold/vite.verify.config.mjs` (serves the real `src/renderer/`, clearly marked verification scaffolding)
- Fixture API mock: `fixtures/api-mock.js` (injected before page scripts run; implements `signIn/isSignedIn/listFolder/getMessage/getThread/sendEmail/sendDraft` over in-memory mail)
- Doctor: `scripts/doctor.sh` (read-only)
- Server: `scripts/serve.sh start|stop` (disposable port, PID file in `/tmp`)
- Driver: `scripts/drive.mjs` (Playwright; needs `drive/node_modules`, installed once)
- Feature map: `features/` (the maintained verification source — read it before driving)
- Evidence: `artifacts/<run-id>/` (survives cleanup; never delete; gitignored — evidence lives on the machine, not in git)

## Launch

Each run gets an ID and an isolated server. Do not reuse another run's port or PID file, and never drive an instance you did not start.

```bash
export RUN_ID="run-$(date +%s)"
export VERIFY_MAILSY_PORT=4317   # pick a free port per concurrent run
./scripts/serve.sh start         # prints URL, waits until HTTP 200
```

Ready means: `serve.sh start` exits 0 and prints `READY <url>`. It serves the unmodified renderer sources; the only scaffold is the Vite config wrapper and the injected `window.api` mock. Teardown:

```bash
./scripts/serve.sh stop
```

`stop` kills only the PID recorded in `/tmp/verify-mailsy-$RUN_ID/server.pid`. Never kill by process name. `stop` never touches `artifacts/`.

Google OAuth (`.env` `MAIN_VITE_GOOGLE_CLIENT_ID/SECRET`) is **not** required for scripted runs — the mock bypasses auth with `isSignedIn() === true`. It is required only for the manual live tier (below).

## Doctor

Run first whenever anything looks off, and before every drive. Read-only; it changes nothing.

```bash
mkdir -p "artifacts/$RUN_ID"    # evidence dir first: the script itself writes nothing
./scripts/doctor.sh > "artifacts/$RUN_ID/doctor.log"
```

It changes nothing; the redirect is how the run's evidence gets the doctor output — the script itself writes no files.
It checks: node/npm present, `REPO/node_modules` installed, scaffold + fixture files exist, Playwright browser binary cached, chosen port free or owned by `$RUN_ID`, and (if a server is running) the server URL answers HTTP 200. Non-zero exit names the unmet precondition — fix that, do not work around it.

## Drive

The driver runs one mapped feature against the running scaffold server and writes evidence. `RUN_ID` and `VERIFY_MAILSY_PORT` must match the `serve.sh start` invocation.

```bash
node scripts/drive.mjs --feature inbox --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"
node scripts/drive.mjs --feature search --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"
```

Available `--feature` values mirror the map: `sign-in`, `sign-out`, `inbox`, `search`, `read-thread`, `compose-send`, `compose-new`, `drafts`, `draft-autosave`, `delete-draft`, `delete-to-trash`, `archive`, `mark-read`, `starred`, `all-mail`, `reply-all`, `cc-bcc`, `spam`, `snooze`, `snooze-emulation`, `category-views`, `unread-bold`, `sidebar`, `labels`, `refresh`. Each journey uses stable handles only — ARIA roles and accessible names (`Search emails` searchbox, `Inbox`/`Drafts` complementary landmarks, `Clear search` button, `reply`/`forward` buttons, `Send` button, `Compose email`/`Draft` headings, `Email content` region). No coordinates, no tab order.

Proof standards (every run):

- Exercise the real user path through the rendered UI. Never call the mock or IPC directly to fake a pass.
- Capture the action and the resulting state: ARIA snapshot + screenshot per journey step that matters, named by feature and step.
- Verify side effects, not just pixels: for send, read back the mock's recorded outbox (`window.__sent`) from a second assertion after the `Message sent.` status appears.
- The mock only stands in for the production boundary (Gmail API + OAuth). It must never contain app logic.
- If a journey's precondition is missing from the fixtures, the driver fails loudly with the reason and the failure goes in that feature's `Gotchas`. Never weaken the journey to make it pass.

## Evidence

After each drive, confirm the artifacts exist — cleanup must never eat the proof:

```
artifacts/<run-id>/<feature>.aria.txt    # accessibility snapshot at the proving step
artifacts/<run-id>/<feature>.png         # screenshot with app content visible
artifacts/<run-id>/<feature>.log         # driver transcript: actions, assertions, exit code
artifacts/<run-id>/doctor.log            # doctor output for this run
```

Each artifact records the feature ID and entry point used (the driver logs its exact command line first).

## Cleanup

```bash
./scripts/serve.sh stop
ls artifacts/<run-id>/   # proof still here — a cleanup that eats the proof fails the run
```

Remove `/tmp/verify-mailsy-$RUN_ID/` only via `serve.sh stop`. Fixture mutations reset automatically: the mock holds all state in memory, so every server restart starts from the seed mailbox.

## Manual tier: live Electron + real Gmail

Scripted runs do not cover the Electron shell (`src/main/`, preload, OAuth loopback server, `safeStorage` token store) or real Gmail quota behavior. When a change touches those, verify by hand and note it as manual-tier evidence:

1. `npm run dev` from the repo root, wait for the app window.
2. `Sign in with Google` opens the system browser; approve; the window loads the real inbox.
3. Exercise the changed path once against the live mailbox, screenshot the result into `artifacts/<run-id>/manual-<feature>.png`.
4. Never run two live instances against the same Gmail account concurrently (per-user rate limits); scripted mock runs are unaffected and may run in parallel.

## Helpers

Every helper is executable and invoked exactly as shown above: `scripts/doctor.sh`, `scripts/serve.sh start|stop`, `node scripts/drive.mjs --feature <id> --run-id <id> --port <n>`. The driver needs its dependency once: `npm --prefix drive install` (Playwright + Chromium download, cached in `~/.cache/ms-playwright`). A helper you have to reverse-engineer is not a helper — if the invocation differs, fix this file.

## Scratch probes (reference only)

Everything outside the helpers above is one-off scratch kept for reference, not the maintained surface. Known assumptions:

- `drive/*.mjs` probes mix two transports: scaffold-server runs (default or argv port) and `chromium.connectOverCDP('http://127.0.0.1:9222')` against a live dev-mode Electron window (`--remote-debugging-port=9222`). Expect to edit ports before reuse.
- `scripts/ccbcc-probe.mjs` drives the scaffold server at `$VERIFY_MAILSY_PORT` (default 4317, or its argv); `scripts/live-probe.mjs` drives the live app over CDP (argv: `<run-dir> [cdp-port]`, watchdog at 150s).
- Both `scripts/*.mjs` probes resolve Playwright from `drive/node_modules` — the one `npm --prefix drive install` above must exist. Nothing else in `scripts/` ships a dependency.
