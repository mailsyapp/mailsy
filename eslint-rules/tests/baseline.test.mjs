import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ruleIds } from './lint.mjs'

const COMPONENT = 'src/renderer/src/components/Probe.tsx'

async function rejects(file, code, rule) {
  const ids = await ruleIds(file, code)
  assert.ok(ids.includes(rule), `expected ${rule}, got [${ids.join(', ')}]`)
}

async function accepts(file, code) {
  assert.deepEqual(await ruleIds(file, code), [])
}

test('renderer rejects a named useEffect import', () =>
  rejects(
    COMPONENT,
    "import { useEffect } from 'react'\nuseEffect(() => undefined)\n",
    'no-restricted-imports'
  ))

test('renderer rejects React.useLayoutEffect', () =>
  rejects(
    COMPONENT,
    "import React from 'react'\nReact.useLayoutEffect(() => undefined)\n",
    'no-restricted-syntax'
  ))

test('renderer rejects a bare setTimeout call', () =>
  rejects(COMPONENT, 'setTimeout(() => undefined, 10)\n', 'no-restricted-syntax'))

test('renderer rejects window.requestAnimationFrame', () =>
  rejects(COMPONENT, 'window.requestAnimationFrame(() => undefined)\n', 'no-restricted-syntax'))

test('renderer rejects electron', () =>
  rejects(
    COMPONENT,
    "import { ipcRenderer } from 'electron'\nipcRenderer.send('x')\n",
    'mailsy/process-boundary'
  ))

test('renderer rejects node built-ins', () =>
  rejects(
    COMPONENT,
    "import { readFileSync } from 'node:fs'\nreadFileSync('x')\n",
    'mailsy/process-boundary'
  ))

test('renderer rejects importing main', () =>
  rejects(COMPONENT, "import { x } from '../../../main/index'\nx()\n", 'mailsy/process-boundary'))

test('renderer rejects a runtime preload import', () =>
  rejects(
    COMPONENT,
    "import { x } from '../../../preload/index'\nx()\n",
    'mailsy/process-boundary'
  ))

test('renderer accepts a type-only preload import', () =>
  accepts(COMPONENT, "import type { X } from '../../../preload/index'\nexport type Y = X\n"))

test('shared rejects electron', () =>
  rejects(
    'src/shared/probe.ts',
    "import { app } from 'electron'\napp.quit()\n",
    'mailsy/process-boundary'
  ))

test('shared rejects importing main', () =>
  rejects(
    'src/shared/probe.ts',
    "import { x } from '../main/index'\nx()\n",
    'mailsy/process-boundary'
  ))

test('main rejects importing renderer', () =>
  rejects(
    'src/main/probe.ts',
    "import { x } from '../renderer/src/lib/format'\nx()\n",
    'mailsy/process-boundary'
  ))

test('src rejects comments', () =>
  rejects('src/shared/probe.ts', '// why\nexport const x = 1\n', 'mailsy/no-comments'))

test('src rejects inline eslint-disable', () =>
  rejects(
    'src/shared/probe.ts',
    '/* eslint-disable no-console */\nexport const x = 1\n',
    'mailsy/no-comments'
  ))

test('hooks may use raw effects and timers', () =>
  accepts(
    'src/renderer/src/hooks/useProbe.ts',
    "import { useEffect } from 'react'\nexport function useProbe(): void {\n  useEffect(() => {\n    const timer = window.setTimeout(() => undefined, 1)\n    return () => window.clearTimeout(timer)\n  }, [])\n}\n"
  ))

test('main may use timers and node built-ins', () =>
  accepts(
    'src/main/probe.ts',
    "import { readFileSync } from 'node:fs'\nexport function probe(): void {\n  setTimeout(() => readFileSync('x'), 1)\n}\n"
  ))

test('renderer accepts shared imports and approved hooks', () =>
  accepts(
    COMPONENT,
    "import type { MailFolder } from '../../../shared/types'\nimport { useOnMount } from '../hooks/useOnMount'\nexport function useProbe(folder: MailFolder): void {\n  useOnMount(() => console.log(folder))\n}\n"
  ))
