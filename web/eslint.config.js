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
      // react-hooks v7 compiler rules at full severity: the burn-down
      // resolved every finding (real refactors or a justified inline
      // disable), so any new one is a genuine regression.
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/preserve-manual-memoization': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/globals': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
  // Test files: the compiler rules target production components; tests
  // legitimately reassign captured variables (MSW handlers, spies) and
  // define throwaway components.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/globals': 'off',
    },
  },

]
