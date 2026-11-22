import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixed, ruleIds } from './lint.mjs'

const COMPONENT = 'src/renderer/src/components/Probe.tsx'

async function rejects(file, code) {
  const ids = await ruleIds(file, code)
  assert.notEqual(ids.length, 0, 'expected a lint error, got none')
}

test('effect through a namespace import', () =>
  rejects(COMPONENT, "import * as R from 'react'\nR.useEffect(() => undefined)\n"))

test('effect destructured from the default import', () =>
  rejects(
    COMPONENT,
    "import React from 'react'\nconst { useEffect } = React\nuseEffect(() => undefined)\n"
  ))

test('effect through a computed member', () =>
  rejects(COMPONENT, "import React from 'react'\nReact['useEffect'](() => undefined)\n"))

test('effect imported under an alias from react default re-export', () =>
  rejects(COMPONENT, "import { default as R } from 'react'\nR.useLayoutEffect(() => undefined)\n"))

test('timer through a computed member', () =>
  rejects(COMPONENT, "window['setTimeout'](() => undefined, 5)\n"))

test('timer destructured from window', () =>
  rejects(COMPONENT, 'const { setTimeout: later } = window\nlater(() => undefined, 5)\n'))

test('timer passed around as a value', () =>
  rejects(COMPONENT, 'const later = setTimeout\nlater(() => undefined, 5)\n'))

test('timer member taken as a value', () =>
  rejects(COMPONENT, 'const frame = window.requestAnimationFrame\nframe(() => undefined)\n'))

test('timer through optional call on globalThis', () =>
  rejects(COMPONENT, 'globalThis.setInterval?.(() => undefined, 5)\n'))

test('a component file inside hooks/ is not exempt', () =>
  rejects(
    'src/renderer/src/hooks/Panel.tsx',
    "import { useEffect } from 'react'\nexport function Panel(): null {\n  useEffect(() => undefined)\n  return null\n}\n"
  ))

test('a non-hook module inside hooks/ is not exempt', () =>
  rejects(
    'src/renderer/src/hooks/helpers.ts',
    'export function later(run: () => void): void {\n  setTimeout(run, 5)\n}\n'
  ))

test('plain JavaScript in the renderer is still checked for effects', () =>
  rejects(
    'src/renderer/src/components/probe.jsx',
    "import { useEffect } from 'react'\nuseEffect(() => undefined)\n"
  ))

test('plain JavaScript in src is still checked for comments', () =>
  rejects('src/shared/probe.js', '// why\nexport const x = 1\n'))

test('plain JavaScript in src is still checked for process boundaries', () =>
  rejects('src/shared/probe.mjs', "import { app } from 'electron'\napp.quit()\n"))

test('typescript import-equals crosses the boundary', () =>
  rejects(COMPONENT, "import fs = require('fs')\nfs.readFileSync('x')\n"))

test('dynamic import with a template literal crosses the boundary', () =>
  rejects(COMPONENT, 'void import(`electron`)\n'))

test('require with a template literal crosses the boundary', () =>
  rejects('src/shared/probe.ts', 'export const e = require(`electron`)\n'))

test('renderer reaches main through the @main style absolute path', () =>
  rejects(COMPONENT, "import { x } from 'src/main/index'\nx()\n"))

test('shared file reaching the renderer alias', () =>
  rejects('src/shared/probe.ts', "import { x } from '@renderer/lib/format'\nx()\n"))

test('a file-wide eslint-disable does not silence the comment ban', async () => {
  const ids = await ruleIds('src/shared/probe.ts', '/* eslint-disable */\nexport const x = 1\n')
  assert.ok(ids.includes('mailsy/no-comments'))
})

test('an inline disable does not silence the timer ban', () =>
  rejects(
    COMPONENT,
    '/* eslint-disable no-restricted-syntax, mailsy/no-comments */\nsetTimeout(() => undefined, 0)\n'
  ).then(async () => {
    const ids = await ruleIds(
      COMPONENT,
      '/* eslint-disable no-restricted-syntax, mailsy/no-comments */\nsetTimeout(() => undefined, 0)\n'
    )
    assert.ok(ids.includes('no-restricted-syntax'))
  }))

test('the comment autofix does not join the words around a comment', async () => {
  const output = await fixed(
    'src/shared/probe.ts',
    'export function probe(value: number): number {\n  return/* note */value\n}\n'
  )
  assert.match(output, /return value/)
})

test('the comment autofix does not join the operators around a comment', async () => {
  const output = await fixed(
    'src/shared/probe.ts',
    'export function probe(a: number, b: number): number {\n  return a +/* note */+b\n}\n'
  )
  assert.match(output, /a \+ \+b/)
})

test('the comment autofix keeps the line break a multi-line comment provided', async () => {
  const output = await fixed('src/shared/probe.js', 'let a = 1 /* one\ntwo */ a++\nexport { a }\n')
  assert.match(output, /^let a = 1\n\s*a\+\+\n/)
})

test('the comment autofix leaves the JSX text around a comment untouched', async () => {
  const output = await fixed(
    'src/renderer/src/components/probe.jsx',
    'export const probe = (\n  <p>\n    hello {/* note */}world{/* note */}again\n  </p>\n)\n'
  )
  assert.match(output, /hello worldagain/)
})
