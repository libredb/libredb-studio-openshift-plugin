import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import prettier from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import playwright from 'eslint-plugin-playwright';
import jest from 'eslint-plugin-jest';
import testingLibrary from 'eslint-plugin-testing-library';
import globals from 'globals';

// Modules the console shares at runtime in versions the plugin cannot pin, or that reach console internals, so a
// plugin import of them can break when the console moves on.
const RESTRICTED_MODULES = [
  'react-router',
  'react-router-dom',
  'react-router-dom-v5-compat',
  'react-redux',
  'redux',
  '@patternfly/react-topology',
  '@patternfly/patternfly',
];
const RESTRICTED_MESSAGE =
  'The plugin does not import this module: use the console SDK and PatternFly React components instead.';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'integration-tests/results/'],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      react,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      'no-console': 'error',
      'react/no-danger': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: RESTRICTED_MODULES.map((name) => ({ name, message: RESTRICTED_MESSAGE })),
          patterns: [
            {
              group: [
                ...RESTRICTED_MODULES.map((name) => `${name}/*`),
                '@patternfly/react-styles/css/*',
              ],
              message: RESTRICTED_MESSAGE,
            },
          ],
        },
      ],
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      }
    },
    settings: {
      react: {
        version: 'detect',
      },
    }
  },
  {
    files: ['src/**/*.spec.{ts,tsx}', 'tests/**/*.spec.ts'],
    plugins: {
      ...jest.configs['flat/recommended'].plugins,
      ...jest.configs['flat/style'].plugins,
      ...testingLibrary.configs['flat/react'].plugins,
    },
    languageOptions: {
      ...jest.configs['flat/recommended'].languageOptions,
      ...jest.configs['flat/style'].languageOptions,
      globals: {
        ...jest.configs['flat/recommended'].languageOptions?.globals,
        ...globals.node,
      },
    },
    rules: {
      ...jest.configs['flat/recommended'].rules,
      ...jest.configs['flat/style'].rules,
      ...testingLibrary.configs['flat/react'].rules,
    },
  },
  {
    ...playwright.configs['flat/recommended'],
    files: ['integration-tests/**/*.ts'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'no-console': 'off',
    },
  },
  prettier,
);
