import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ruleIds } from './lint.mjs'

const COMPONENT = 'src/renderer/src/components/Probe.tsx'

async function rejects(file, code) {
  const ids = await ruleIds(file, code)
  assert.notEqual(ids.length, 0, 'expected a lint error, got none')
}

async function accepts(file, code) {
  const ids = await ruleIds(file, code)
  assert.deepEqual(ids, [])
}

test('renderer importing an electron subpath', () =>
  rejects(COMPONENT, "import { ipcRenderer } from 'electron/renderer'\nipcRenderer.send('x')\n"))

test('renderer importing the main-process toolkit', () =>
  rejects(COMPONENT, "import { is } from '@electron-toolkit/utils'\nexport const dev = is.dev\n"))

test('renderer importing the preload toolkit', () =>
  rejects(
    COMPONENT,
    "import { electronAPI } from '@electron-toolkit/preload'\nexport const api = electronAPI\n"
  ))

test('renderer importing a Gmail library subpath', () =>
  rejects(
    COMPONENT,
    "import { gmail } from 'googleapis/build/src/apis/gmail'\nexport const g = gmail\n"
  ))

test('shared importing a main-process library', () =>
  rejects('src/shared/probe.ts', "import { google } from 'googleapis'\nexport const g = google\n"))

test('shared importing the main-process toolkit', () =>
  rejects(
    'src/shared/probe.ts',
    "import { is } from '@electron-toolkit/utils'\nexport const dev = is.dev\n"
  ))

test('renderer reaching ipcRenderer through window.electron', () =>
  rejects(COMPONENT, "export const probe = (): void => window.electron.ipcRenderer.send('x')\n"))

test('renderer reaching the raw bridge through a computed member', () =>
  rejects(COMPONENT, "export const probe = (): unknown => window['electron']\n"))

test('renderer import with a specifier lint cannot read', () =>
  rejects(COMPONENT, 'export const load = (name: string): Promise<unknown> => import(name)\n'))

test('main require with a specifier lint cannot read', () =>
  rejects('src/main/probe.ts', 'export const load = (name: string): unknown => require(name)\n'))

test('effect name in a template-literal member', () =>
  rejects(COMPONENT, "import * as React from 'react'\nexport const effect = React[`useEffect`]\n"))

test('timer name in a template-literal member', () =>
  rejects(COMPONENT, 'export const later = window[`setTimeout`]\n'))

test('timer name held in a string', () =>
  rejects(COMPONENT, "const name = 'setTimeout'\nexport const later = (window as never)[name]\n"))

test('effect name held in a string', () =>
  rejects(
    COMPONENT,
    "import * as React from 'react'\nconst name = 'useEffect'\nexport const effect = (React as never)[name]\n"
  ))

test('macrotask through a MessageChannel', () =>
  rejects(
    COMPONENT,
    'export function later(run: () => void): void {\n  const channel = new MessageChannel()\n  channel.port1.onmessage = run\n  channel.port2.postMessage(null)\n}\n'
  ))

test('timer through the scheduler API', () =>
  rejects(
    COMPONENT,
    'export const later = (run: () => void): unknown =>\n  (window as never as { scheduler: { postTask: (r: () => void) => unknown } }).scheduler.postTask(run)\n'
  ))

test('timer through a code string', () =>
  rejects(COMPONENT, "export const later = new Function('return 1')\n"))

test('class lifecycle in place of an effect', () =>
  rejects(
    COMPONENT,
    "import { Component } from 'react'\nexport class Probe extends Component {\n  componentDidMount(): void {\n    document.title = 'x'\n  }\n  render(): null {\n    return null\n  }\n}\n"
  ))

test('a new hook file that is not on the approved list', () =>
  rejects(
    'src/renderer/src/hooks/useAnything.ts',
    "import { useEffect } from 'react'\nexport function useAnything(run: () => void): void {\n  useEffect(run)\n}\n"
  ))

test('a string statement standing in for a comment', () =>
  rejects('src/shared/probe.ts', "'this explains the next line'\nexport const x = 1\n"))

test('a string statement inside a function standing in for a comment', () =>
  rejects(
    'src/shared/probe.ts',
    "export function probe(): number {\n  'explains the return'\n  return 1\n}\n"
  ))

test('use strict is still a directive, not a comment', () =>
  accepts('src/shared/probe.js', "'use strict'\nexport const x = 1\n"))

test('a file in src outside every process zone', () =>
  rejects('src/probe.ts', 'export const x = 1\n'))

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
