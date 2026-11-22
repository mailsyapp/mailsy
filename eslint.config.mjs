import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'
import mailsy from './eslint-rules/index.mjs'

const EFFECT_MESSAGE =
  'Raw effects are banned outside src/renderer/src/hooks. Work caused by a user action belongs in that event handler; values computed from props or state belong in render or useMemo. For what is left, use the hook that names the intent: useOnMount, useOnUnmount, useReaction (state changed), useSubscription, useInterval, useSettledValue (debounce), useIntersection. If none fits, add a new named hook in src/renderer/src/hooks.'

const EFFECT_NAMES = 'useEffect|useLayoutEffect|useInsertionEffect'

const TIMER_NAMES =
  'setTimeout|setInterval|setImmediate|requestAnimationFrame|requestIdleCallback|queueMicrotask'

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
    files: ['src/**/*.{ts,tsx}'],
    plugins: { mailsy },
    rules: {
      'mailsy/no-comments': 'error',
      'mailsy/process-boundary': 'error'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: ['src/renderer/src/hooks/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              importNames: ['useEffect', 'useLayoutEffect', 'useInsertionEffect'],
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
          selector: `MemberExpression[computed=true] > Literal.property[value=/^(${EFFECT_NAMES})$/]`,
          message: EFFECT_MESSAGE
        },
        {
          selector: `Identifier[name=/^(${TIMER_NAMES})$/]`,
          message: TIMER_MESSAGE
        },
        {
          selector: `MemberExpression[computed=true] > Literal.property[value=/^(${TIMER_NAMES})$/]`,
          message: TIMER_MESSAGE
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
