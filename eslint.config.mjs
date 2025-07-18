// @ts-check
// Force this file to be treated as an ESM module
import imp from 'eslint-plugin-import';
import prettier from 'eslint-plugin-prettier';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    // Ignore the dist directory
    ignores: ['dist/**'],
  },
  {
    files: ['src/**/*.{js,ts}'],
    plugins: {
      import: imp,
      prettier: prettier,
      '@typescript-eslint': tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    rules: {
      // Example of custom rules, you can add more or modify as needed
      'import/prefer-default-export': 'off',
      'no-console': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'prettier/prettier': 'error', // Ensures that Prettier issues are flagged as errors
    },
  },
];
