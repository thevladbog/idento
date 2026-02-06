import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { globalIgnores } from 'eslint/config'
import tsPlugin from '@typescript-eslint/eslint-plugin/use-at-your-own-risk/raw-plugin'

const tsRecommended = tsPlugin.flatConfigs['flat/recommended']

export default [
  globalIgnores(['dist']),
  js.configs.recommended,
  ...tsRecommended,
  reactHooks.configs['recommended-latest'],
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
