# .agents

Shareable tooling for AI coding agents working on this repository.

## What's here

- `skills/` — agent skills. Each skill is a directory with a `SKILL.md` (name, description, and instructions an agent loads on demand) plus any fixtures, scripts, or scaffolding the skill drives.

## Installed skills

### `skills/verify-mailsy/`

Drives and proves the Mailsy Electron mail client. Scripted verification runs the real renderer code in headless Chromium against a fixture `window.api` mock — no Google account or network needed — with Playwright evidence (ARIA snapshots, screenshots, transcripts) per run. A documented manual tier covers the Electron shell and live Gmail.

Start with [`skills/verify-mailsy/SKILL.md`](skills/verify-mailsy/SKILL.md).

## Using the skills

Point your agent harness at this directory (e.g. OpenCode reads skill dirs that contain `SKILL.md`), or invoke the scripts directly from the repo:

```bash
export RUN_ID="run-$(date +%s)"
export VERIFY_MAILSY_PORT=4317   # pick a free port per concurrent run
cd .agents/skills/verify-mailsy
npm --prefix drive install       # Playwright + Chromium, once
mkdir -p "artifacts/$RUN_ID"     # evidence dir; helpers stay read-only
./scripts/doctor.sh              # preflight, read-only
./scripts/serve.sh start         # serves the renderer on the scaffold config
node scripts/drive.mjs --feature inbox --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"
./scripts/serve.sh stop
```

`REPO` resolution order for the helpers: `$VERIFY_MAILSY_REPO` (set it when running the skill from outside a checkout, or against a worktree), else `git rev-parse --show-toplevel`, else the path three levels up from the skill dir.

## Layout policy

- Run evidence lives in `artifacts/` (screenshots, ARIA snapshots, transcripts) and drive-run logs/screenshots. These are gitignored and never committed.
- `orchestrate/` and other coordination scratch is local-only and gitignored as well.
- A skill's `SKILL.md` must stay accurate; if you change how a helper is invoked, fix the skill file in the same change.
