# mailsy

An Electron application with React and TypeScript

## Agent skills

The `.agents/skills/` directory contains shareable agent skills (see `.agents/README.md`). `verify-mailsy` scripts and proofs the app through a headless-Chromium harness against a fixture API mock — no Google account needed:

```bash
export RUN_ID="run-$(date +%s)"
export VERIFY_MAILSY_PORT=4317   # pick a free port per concurrent run
cd .agents/skills/verify-mailsy
npm --prefix drive install                        # Playwright + Chromium, once
mkdir -p "artifacts/$RUN_ID" && ./scripts/doctor.sh   # preflight, read-only
./scripts/serve.sh start
node scripts/drive.mjs --feature inbox --run-id "$RUN_ID" --port "$VERIFY_MAILSY_PORT"
./scripts/serve.sh stop
```

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
