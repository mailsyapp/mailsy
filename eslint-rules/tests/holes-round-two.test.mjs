import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lintMessages, ruleIds } from './lint.mjs'

const COMPONENT = 'src/renderer/src/components/Probe.tsx'

async function rejects(file, code, ruleId, messageId) {
  const messages = await lintMessages(file, code)
  assert.ok(
    messages.some((message) => message.ruleId === ruleId && message.messageId === messageId),
    `expected ${ruleId}/${messageId}, got ${JSON.stringify(messages)}`
  )
}

async function accepts(file, code) {
  const ids = await ruleIds(file, code)
  assert.deepEqual(ids, [])
}

test('renderer importing an electron subpath', () =>
  rejects(
    COMPONENT,
    "import { ipcRenderer } from 'electron/renderer'\nipcRenderer.send('x')\n",
    'mailsy/process-boundary',
    'bannedPackage'
  ))

test('renderer importing the main-process toolkit', () =>
  rejects(
    COMPONENT,
    "import { is } from '@electron-toolkit/utils'\nexport const dev = is.dev\n",
    'mailsy/process-boundary',
    'bannedPackage'
  ))

test('renderer importing the preload toolkit', () =>
  rejects(
    COMPONENT,
    "import { electronAPI } from '@electron-toolkit/preload'\nexport const api = electronAPI\n",
    'mailsy/process-boundary',
    'bannedPackage'
  ))

test('renderer importing a Gmail library subpath', () =>
  rejects(
    COMPONENT,
    "import { gmail } from 'googleapis/build/src/apis/gmail'\nexport const g = gmail\n",
    'mailsy/process-boundary',
    'bannedPackage'
  ))

test('shared importing a main-process library', () =>
  rejects(
    'src/shared/probe.ts',
    "import { google } from 'googleapis'\nexport const g = google\n",
    'mailsy/process-boundary',
    'bannedPackage'
  ))

test('shared importing the main-process toolkit', () =>
  rejects(
    'src/shared/probe.ts',
    "import { is } from '@electron-toolkit/utils'\nexport const dev = is.dev\n",
    'mailsy/process-boundary',
    'bannedPackage'
  ))

test('renderer reaching ipcRenderer through window.electron', () =>
  rejects(
    COMPONENT,
    "export const probe = (): void => window.electron.ipcRenderer.send('x')\n",
    'no-restricted-syntax',
    'restrictedSyntax'
  ))

test('renderer reaching the raw bridge through a computed member', () =>
  rejects(
    COMPONENT,
    "export const probe = (): unknown => window['electron']\n",
    'no-restricted-syntax',
    'restrictedSyntax'
  ))

test('renderer import with a specifier lint cannot read', () =>
  rejects(
    COMPONENT,
    'export const load = (name: string): Promise<unknown> => import(name)\n',
    'mailsy/process-boundary',
    'unreadableSpecifier'
  ))

test('main require with a specifier lint cannot read', () =>
  rejects(
    'src/main/probe.ts',
    'export const load = (name: string): unknown => require(name)\n',
    'mailsy/process-boundary',
    'unreadableSpecifier'
  ))

test('effect name in a template-literal member', () =>
  rejects(
    COMPONENT,
    "import * as React from 'react'\nexport const effect = React[`useEffect`]\n",
    'no-restricted-syntax',
    'restrictedSyntax'
  ))

test('timer name in a template-literal member', () =>
  rejects(
    COMPONENT,
    'export const later = window[`setTimeout`]\n',
    'no-restricted-syntax',
    'restrictedSyntax'
  ))

test('timer name held in a string', () =>
  rejects(
    COMPONENT,
    "const name = 'setTimeout'\nexport const later = (window as never)[name]\n",
    'no-restricted-syntax',
    'restrictedSyntax'
  ))

test('effect name held in a string', () =>
  rejects(
    COMPONENT,
    "import * as React from 'react'\nconst name = 'useEffect'\nexport const effect = (React as never)[name]\n",
    'no-restricted-syntax',
    'restrictedSyntax'
  ))

test('macrotask through a MessageChannel', () =>
  rejects(
    COMPONENT,
    'export function later(run: () => void): void {\n  const channel = new MessageChannel()\n  channel.port1.onmessage = run\n  channel.port2.postMessage(null)\n}\n',
    'no-restricted-syntax',
    'restrictedSyntax'
  ))

test('timer through the scheduler API', () =>
  rejects(
    COMPONENT,
    'export const later = (run: () => void): unknown =>\n  (window as never as { scheduler: { postTask: (r: () => void) => unknown } }).scheduler.postTask(run)\n',
    'no-restricted-syntax',
    'restrictedSyntax'
  ))

test('timer through a code string', () =>
  rejects(
    COMPONENT,
    "export const later = new Function('return 1')\n",
    'no-new-func',
    'noFunctionConstructor'
  ))

test('class lifecycle in place of an effect', () =>
  rejects(
    COMPONENT,
    "import { Component } from 'react'\nexport class Probe extends Component {\n  componentDidMount(): void {\n    document.title = 'x'\n  }\n  render(): null {\n    return null\n  }\n}\n",
    'no-restricted-syntax',
    'restrictedSyntax'
  ))

test('a new hook file that is not on the approved list', () =>
  rejects(
    'src/renderer/src/hooks/useAnything.ts',
    "import { useEffect } from 'react'\nexport function useAnything(run: () => void): void {\n  useEffect(run)\n}\n",
    'no-restricted-syntax',
    'restrictedSyntax'
  ))

test('a string statement standing in for a comment', () =>
  rejects(
    'src/shared/probe.ts',
    "'this explains the next line'\nexport const x = 1\n",
    'mailsy/no-comments',
    'stringStatement'
  ))

test('a string statement inside a function standing in for a comment', () =>
  rejects(
    'src/shared/probe.ts',
    "export function probe(): number {\n  'explains the return'\n  return 1\n}\n",
    'mailsy/no-comments',
    'stringStatement'
  ))

test('use strict is still a directive, not a comment', () =>
  accepts('src/shared/probe.js', "'use strict'\nexport const x = 1\n"))

test('a file in src outside every process zone', () =>
  rejects('src/probe.ts', 'export const x = 1\n', 'mailsy/process-boundary', 'noZone'))

test('an approved hook may still use a raw effect', () =>
  accepts(
    'src/renderer/src/hooks/useOnMount.ts',
    "import { useEffect } from 'react'\nexport function useOnMount(run: () => void): void {\n  useEffect(run, [run])\n}\n"
  ))

test('preload may use its toolkit', () =>
  accepts(
    'src/preload/probe.ts',
    "import { electronAPI } from '@electron-toolkit/preload'\nexport const api = electronAPI\n"
  ))

test('main may load a module by a static name', () =>
  accepts('src/main/probe.ts', "export const load = (): Promise<unknown> => import('node:fs')\n"))

test('renderer type query against the main process', () =>
  rejects(
    COMPONENT,
    "export type Probe = import('../../../main/index').Probe\n",
    'mailsy/process-boundary',
    'crossZone'
  ))

test('renderer globbing main-process modules', () =>
  rejects(
    COMPONENT,
    "export const modules = import.meta.glob('../../../main/*.ts')\n",
    'mailsy/process-boundary',
    'glob'
  ))

test('renderer globbing a list that reaches the main process', () =>
  rejects(
    COMPONENT,
    "export const modules = import.meta.glob(['./*.tsx', '../../../main/*.ts'])\n",
    'mailsy/process-boundary',
    'glob'
  ))

test('renderer globbing with a base that points at the main process', () =>
  rejects(
    COMPONENT,
    "export const modules = import.meta.glob('./*.ts', { base: '../../../main' })\n",
    'mailsy/process-boundary',
    'glob'
  ))

test('renderer globbing with braces that reach the main process', () =>
  rejects(
    COMPONENT,
    "export const modules = import.meta.glob('../../../{shared,main}/*.ts')\n",
    'mailsy/process-boundary',
    'glob'
  ))

test('renderer loading a main-process file by URL', () =>
  rejects(
    COMPONENT,
    "export const worker = new Worker(new URL('../../../main/index.ts', import.meta.url))\n",
    'mailsy/process-boundary',
    'crossZone'
  ))

test('subscription through useSyncExternalStore', () =>
  rejects(
    COMPONENT,
    "import * as React from 'react'\nexport const store = React.useSyncExternalStore\n",
    'no-restricted-syntax',
    'restrictedSyntax'
  ))

test('observer created outside a hook', () =>
  rejects(
    COMPONENT,
    'export const observer = new MutationObserver(() => undefined)\n',
    'no-restricted-syntax',
    'restrictedSyntax'
  ))

test('a void string standing in for a comment', () =>
  rejects(
    'src/shared/probe.ts',
    "void 'this explains the next line'\nexport const x = 1\n",
    'mailsy/no-comments',
    'stringStatement'
  ))

test('renderer may take types from shared by type query', () =>
  accepts(COMPONENT, "export type Probe = import('../../../shared/types').EmailSummary\n"))

test('renderer may load its own asset by URL', () =>
  accepts(COMPONENT, "export const icon = new URL('../assets/icon.png', import.meta.url)\n"))

test('an approved hook may create an observer', () =>
  accepts(
    'src/renderer/src/hooks/useIntersection.ts',
    'export const observe = (): IntersectionObserver => new IntersectionObserver(() => undefined)\n'
  ))

test('renderer may resolve its own asset', () =>
  accepts(COMPONENT, "export const icon = import.meta.resolve('./x.png')\n"))

test('renderer may resolve its own asset through a static computed member', () =>
  accepts(COMPONENT, "export const icon = import.meta['resolve']('./x.png')\n"))

test('renderer may resolve its own asset through a static template member', () =>
  accepts(COMPONENT, "export const icon = import.meta[`resolve`]('./x.png')\n"))

test('renderer cannot disguise glob as a computed resolve member', () =>
  rejects(
    COMPONENT,
    "const resolve = 'glob'\nexport const files = import.meta[resolve]('./*.ts')\n",
    'mailsy/process-boundary',
    'unsupportedImportMeta'
  ))

test('renderer cannot call an unknown import.meta member', () =>
  rejects(
    COMPONENT,
    "export const load = (name: string): unknown => import.meta[name]('./x.png')\n",
    'mailsy/process-boundary',
    'unsupportedImportMeta'
  ))

test('renderer cannot call an empty import.meta member', () =>
  rejects(
    COMPONENT,
    "export const load = import.meta['']('./x.png')\n",
    'mailsy/process-boundary',
    'unsupportedImportMeta'
  ))

test('renderer cannot call a static computed glob member', () =>
  rejects(
    COMPONENT,
    "export const files = import.meta['glob']('./*.ts')\n",
    'mailsy/process-boundary',
    'glob'
  ))

test('renderer cannot call a dynamic template import.meta member', () =>
  rejects(
    COMPONENT,
    "export const load = (name: string): unknown => import.meta[`${name}`]('./x.png')\n",
    'mailsy/process-boundary',
    'unsupportedImportMeta'
  ))

test('renderer cannot call an unsupported static import.meta member', () =>
  rejects(
    COMPONENT,
    "export const load = import.meta['load']('./x.png')\n",
    'mailsy/process-boundary',
    'unsupportedImportMeta'
  ))
