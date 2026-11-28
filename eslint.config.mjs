import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'
import mailsy from './eslint-rules/index.mjs'

const EFFECT_MESSAGE =
  'Raw effects are banned outside src/renderer/src/hooks. Work caused by a user action belongs in that event handler; values computed from props or state belong in render or useMemo. For what is left, use the hook that names the intent: useOnMount, useOnUnmount, useReaction (state changed), useSubscription, useInterval, useSettledValue (debounce), useIntersection. If none fits, add a new named hook in src/renderer/src/hooks and list it in APPROVED_HOOKS in eslint.config.mjs.'

const EFFECT_NAMES =
  'useEffect|useLayoutEffect|useInsertionEffect|useSyncExternalStore|componentDidMount|componentDidUpdate|componentWillUnmount|getSnapshotBeforeUpdate|componentDidCatch'

const OBSERVER_MESSAGE =
  'Observers, workers and open channels are subscriptions that need a teardown on unmount, so they are banned outside src/renderer/src/hooks. Use useIntersection, or add a named hook and list it in APPROVED_HOOKS in eslint.config.mjs.'

const RAW_BRIDGE_MESSAGE =
  "window.electron is the raw Electron bridge and bypasses the IPC contract. Add the call to src/preload/index.ts and use it through 'window.api'."

const APPROVED_HOOKS = [
  'useAfterCurrentTask',
  'useIntersection',
  'useInterval',
  'useLatest',
  'useLeftSends',
  'useOnMount',
  'useOnUnmount',
  'useReaction',
  'useSettledValue',
  'useSubscription',
  'useTimers'
].map((name) => `src/renderer/src/hooks/${name}.ts`)

const TIMER_NAMES =
  'setTimeout|setInterval|setImmediate|requestAnimationFrame|requestIdleCallback|requestVideoFrameCallback|queueMicrotask|MessageChannel|postTask'

const SHARED_MESSAGE =
  'src/shared is loaded by every process, so it can only hold types and pure functions. Take this value as a parameter from the process that owns it.'

const IMPURE_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'process',
  'require',
  'module',
  '__dirname',
  '__filename',
  'Buffer',
  'globalThis',
  'self',
  'global',
  'fetch',
  ...TIMER_NAMES.split('|')
]

const COMPUTED_GLOBAL_MESSAGE =
  'A computed property on window hides which global is used, so the effect, timer and bridge bans cannot check it. Name the property.'

const TIMER_MESSAGE =
  'Imperative timers are banned outside src/renderer/src/hooks. A timer that waits for React to render or the DOM to settle is hiding a state problem: move the work to the event handler or derive it from state. For real delays use useTimers, useInterval, useSettledValue (debounce), or useAfterCurrentTask (macrotask boundary); they cancel on unmount.'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out', '.agents/**'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    files: ['src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    plugins: { mailsy },
    linterOptions: { noInlineConfig: true },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'mailsy/no-comments': 'error',
      'mailsy/process-boundary': 'error'
    }
  },
  {
    files: ['src/shared/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...IMPURE_GLOBALS.map((name) => ({ name, message: SHARED_MESSAGE }))
      ]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    ignores: APPROVED_HOOKS,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              importNames: [
                'useEffect',
                'useLayoutEffect',
                'useInsertionEffect',
                'useSyncExternalStore'
              ],
              message: EFFECT_MESSAGE
            }
          ]
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `Identifier[name=/^(${EFFECT_NAMES})$/]`,
          message: EFFECT_MESSAGE
        },
        {
          selector: `Literal[value=/^(${EFFECT_NAMES})$/]`,
          message: EFFECT_MESSAGE
        },
        {
          selector: `TemplateElement[value.cooked=/^(${EFFECT_NAMES})$/]`,
          message: EFFECT_MESSAGE
        },
        {
          selector: `Identifier[name=/^(${TIMER_NAMES})$/]`,
          message: TIMER_MESSAGE
        },
        {
          selector: `Literal[value=/^(${TIMER_NAMES})$/]`,
          message: TIMER_MESSAGE
        },
        {
          selector: `TemplateElement[value.cooked=/^(${TIMER_NAMES})$/]`,
          message: TIMER_MESSAGE
        },
        {
          selector:
            'MemberExpression[computed=true][object.name=/^(window|globalThis|self)$/]:not([property.type="Literal"]):not([property.type="TemplateLiteral"][property.expressions.length=0])',
          message: COMPUTED_GLOBAL_MESSAGE
        },
        {
          selector:
            'MemberExpression[object.name=/^(window|globalThis|self)$/] > :matches(Identifier.property[name=/^(Function|eval)$/], Literal.property[value=/^(Function|eval)$/])',
          message: TIMER_MESSAGE
        },
        {
          selector:
            'Identifier[name=/^((Intersection|Mutation|Resize|Performance)Observer|Worker|SharedWorker|BroadcastChannel|EventSource|WebSocket)$/]',
          message: OBSERVER_MESSAGE
        },
        {
          selector:
            "MemberExpression[object.name=/^(window|globalThis|self)$/] > :matches(Identifier.property[name='electron'], Literal.property[value='electron'])",
          message: RAW_BRIDGE_MESSAGE
        }
      ]
    }
  },
  {
    files: ['eslint-rules/**/*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
