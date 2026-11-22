import { builtinModules } from 'node:module'
import path from 'node:path'

const ZONES = ['main', 'preload', 'renderer', 'shared']

const ALLOWED_TARGETS = {
  main: ['main', 'shared'],
  preload: ['preload', 'shared'],
  renderer: ['renderer', 'shared'],
  shared: ['shared']
}

const NODE_BUILTINS = new RegExp(`^(node:.+|${builtinModules.join('|')})$`)

const REACT = /^react(-dom)?(\/|$)/

const MAIN_PROCESS_ONLY = [
  /^electron(\/|$)/,
  /^@electron-toolkit\/(utils|preload)(\/|$)/,
  NODE_BUILTINS,
  /^googleapis(\/|$)/,
  /^google-auth-library(\/|$)/,
  /^nodemailer(\/|$)/
]

const BANNED_PACKAGES = {
  renderer: MAIN_PROCESS_ONLY,
  shared: [...MAIN_PROCESS_ONLY, REACT],
  main: [REACT],
  preload: [REACT]
}

function staticSpecifier(node) {
  if (!node) return null
  if (node.type === 'Literal') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked
  }
  return null
}

function zoneOf(file) {
  const parts = file.split(path.sep)
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === 'src' && ZONES.includes(parts[i + 1])) return parts[i + 1]
  }
  return null
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      crossZone:
        "src/{{from}} must not import from src/{{to}}: each Electron process is its own bundle. Put code both sides need in src/shared (types and pure functions only), and cross the process line through the IPC contract in src/preload/index.ts ('window.api').",
      typeOnlyPreload:
        "The renderer may only use 'import type' from src/preload. Call the bridge at runtime through 'window.api'.",
      bannedPackage: "'{{name}}' is not available to src/{{from}}. {{hint}}",
      unreadableSpecifier:
        'This module name is computed, so the process boundary cannot be checked. Import or require a literal module name.',
      noZone:
        'Every file in src/ must live in src/main, src/preload, src/renderer or src/shared so the process boundary applies to it.'
    }
  },
  create(context) {
    const from = zoneOf(context.filename)
    if (!from) {
      return {
        Program(node) {
          context.report({ node, messageId: 'noZone' })
        }
      }
    }

    const HINTS = {
      renderer:
        "The renderer is a sandboxed web page: add an IPC handler in src/main, expose it in src/preload/index.ts, and call it through 'window.api'.",
      shared:
        'src/shared is loaded by every process, so it can only hold types and pure functions.',
      main: 'UI code belongs in src/renderer.',
      preload: 'UI code belongs in src/renderer.'
    }

    function check(node, source, isTypeOnly) {
      if (typeof source !== 'string') return
      let target = null
      if (source.startsWith('.')) {
        target = zoneOf(path.resolve(path.dirname(context.filename), source))
      } else if (source.startsWith('@renderer/')) {
        target = 'renderer'
      } else if (source.startsWith('src/')) {
        target = zoneOf(path.join(path.sep, source))
      } else {
        const banned = BANNED_PACKAGES[from].some((pattern) => pattern.test(source))
        if (banned && !isTypeOnly) {
          context.report({
            node,
            messageId: 'bannedPackage',
            data: { name: source, from, hint: HINTS[from] }
          })
        }
        return
      }
      if (!target || ALLOWED_TARGETS[from].includes(target)) return
      if (from === 'renderer' && target === 'preload') {
        if (!isTypeOnly) context.report({ node, messageId: 'typeOnlyPreload' })
        return
      }
      context.report({ node, messageId: 'crossZone', data: { from, to: target } })
    }

    function checkComputed(node, specifier) {
      const source = staticSpecifier(specifier)
      if (typeof source === 'string') check(node, source, false)
      else context.report({ node, messageId: 'unreadableSpecifier' })
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source.value, node.importKind === 'type')
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value, node.exportKind === 'type')
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value, node.exportKind === 'type')
      },
      ImportExpression(node) {
        checkComputed(node, node.source)
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          checkComputed(node, node.arguments[0])
        }
      }
    }
  }
}
