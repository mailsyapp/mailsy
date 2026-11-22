import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lintMessages, ruleIds } from './lint.mjs'

const COMPONENT = 'src/renderer/src/components/Probe.tsx'
const BOUNDARY = 'mailsy/process-boundary'
const SYNTAX = 'no-restricted-syntax'

async function rejects(file, code, ruleId, messageId) {
  const messages = await lintMessages(file, code)
  assert.ok(
    messages.some(
      (message) => message.ruleId === ruleId && (!messageId || message.messageId === messageId)
    ),
    `expected ${ruleId}/${messageId}, got ${JSON.stringify(messages)}`
  )
}

async function accepts(file, code) {
  assert.deepEqual(await ruleIds(file, code), [])
}

test('renderer alias that climbs out to the main process', () =>
  rejects(
    COMPONENT,
    "import x from '@renderer/../../main/index'\nexport const y = x\n",
    BOUNDARY,
    'crossZone'
  ))

test('renderer alias that climbs out to a runtime preload import', () =>
  rejects(
    COMPONENT,
    "import x from '@renderer/../../preload/index'\nexport const y = x\n",
    BOUNDARY,
    'typeOnlyPreload'
  ))

test('renderer alias still reaches renderer files', () =>
  accepts(COMPONENT, "import { cx } from '@renderer/lib/cx'\nexport const y = cx\n"))

test('renderer reaching main through a root-absolute path', () =>
  rejects(
    COMPONENT,
    "import x from '/src/main/index'\nexport const y = x\n",
    BOUNDARY,
    'crossZone'
  ))

test('renderer importing the built main bundle', () =>
  rejects(
    COMPONENT,
    "import x from '../../../../out/main/index.js'\nexport const y = x\n",
    BOUNDARY,
    'outsideSrc'
  ))

test('renderer importing electron by its node_modules path', () =>
  rejects(
    COMPONENT,
    "import x from '../../../../node_modules/electron/index.js'\nexport const y = x\n",
    BOUNDARY,
    'outsideSrc'
  ))

test('main reaching the renderer through createRequire', () =>
  rejects(
    'src/main/probe.ts',
    "import { createRequire } from 'node:module'\nexport const r = createRequire(import.meta.url)('../renderer/src/App')\n",
    BOUNDARY,
    'hiddenLoader'
  ))

test('main reaching the renderer through require.resolve', () =>
  rejects(
    'src/main/probe.ts',
    "export const r = require.resolve('../renderer/src/App')\n",
    BOUNDARY,
    'crossZone'
  ))

test('main reaching the renderer through module.require', () =>
  rejects(
    'src/main/probe.ts',
    "export const r = module.require('../renderer/src/App')\n",
    BOUNDARY,
    'crossZone'
  ))

test('main may still resolve its own files', () =>
  accepts('src/main/probe.ts', "export const r = require.resolve('./index')\n"))

test('renderer loading a node built-in through process.getBuiltinModule', () =>
  rejects(
    COMPONENT,
    "export const m = process.getBuiltinModule('fs')\n",
    BOUNDARY,
    'bannedPackage'
  ))

test('renderer loading a node built-in through globalThis.require', () =>
  rejects(COMPONENT, "export const m = globalThis.require('fs')\n", BOUNDARY, 'bannedPackage'))

test('renderer loading a node built-in through a cast window.require', () =>
  rejects(
    COMPONENT,
    "export const m = (window as never as { require: (n: string) => unknown }).require('fs')\n",
    BOUNDARY,
    'bannedPackage'
  ))

test('timer name assembled by string concatenation', () =>
  rejects(COMPONENT, "export const t = window['set' + 'Timeout']\n", SYNTAX))

test('timer name assembled by an interpolated template', () =>
  rejects(COMPONENT, "const a = 'set'\nexport const t = globalThis[`${a}Timeout`]\n", SYNTAX))

test('a literal window key is still allowed', () =>
  accepts(COMPONENT, "export const t = window['api']\n"))

test('code string through window.Function', () =>
  rejects(COMPONENT, "export const f = new window.Function('return 1')\n", SYNTAX))

test('code string through a bracketed window eval', () =>
  rejects(COMPONENT, "export const f = window['eval']('1')\n", SYNTAX))

test('background thread outside a hook', () =>
  rejects(COMPONENT, "export const w = new Worker('data:text/javascript,1')\n", SYNTAX))

test('cross-tab channel outside a hook', () =>
  rejects(COMPONENT, "export const c = new BroadcastChannel('x')\n", SYNTAX))

test('shared code using a timer', () =>
  rejects(
    'src/shared/probe.ts',
    'export const f = (): unknown => setTimeout(() => undefined, 1)\n',
    'no-restricted-globals'
  ))

test('shared code reaching the bridge through window', () =>
  rejects(
    'src/shared/probe.ts',
    'export const f = (): unknown => window.api\n',
    'no-restricted-globals'
  ))

test('shared code reading the DOM', () =>
  rejects(
    'src/shared/probe.ts',
    'export const f = (): unknown => document.title\n',
    'no-restricted-globals'
  ))

test('shared code reading the node process', () =>
  rejects(
    'src/shared/probe.ts',
    'export const f = (): unknown => process.env.HOME\n',
    'no-restricted-globals'
  ))

test('shared code may shadow a restricted name with a parameter', () =>
  accepts(
    'src/shared/probe.ts',
    'export const f = (document: { title: string }): string => document.title\n'
  ))

test('reference comment pulling node types into a renderer module', () =>
  rejects(COMPONENT, '/// <reference types="node" />\nexport const x = 1\n', 'mailsy/no-comments'))

test('reference comment pulling a main-process file by path', () =>
  rejects(
    'src/renderer/src/env.d.ts',
    '/// <reference path="../../main/index.ts" />\ndeclare const x: number\n',
    'mailsy/no-comments'
  ))

test('a declaration file may reference a types package', () =>
  accepts(
    'src/renderer/src/env.d.ts',
    '/// <reference types="vite/client" />\ndeclare const x: number\n'
  ))
