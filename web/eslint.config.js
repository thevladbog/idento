import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { globalIgnores } from 'eslint/config'
import tsPlugin from '@typescript-eslint/eslint-plugin/use-at-your-own-risk/raw-plugin'

const tsRecommended = tsPlugin.flatConfigs['flat/recommended']

export default [
  // public/ is served as-is by Vite (and, at container start, has its
  // committed env.js overwritten by nginx's envsubst templating) — it's
  // static assets, not application source to lint, same reasoning as dist.
  globalIgnores(['dist', 'public']),
  js.configs.recommended,
  ...tsRecommended,
  reactHooks.configs.flat['recommended-latest'],
  reactRefresh.configs.vite,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2020,
      },
    },
    rules: {
      // Same rationale as panel/eslint.config.js: react-hooks v7's
      // compiler-powered rules stay visible as warnings pending a
      // dedicated burn-down.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/globals': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
]
