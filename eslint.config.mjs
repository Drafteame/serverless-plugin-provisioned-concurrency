import { configs, plugins } from 'eslint-config-airbnb-extended';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.mjs', 'jest.config.js'],
  },
  plugins.stylistic,
  plugins.importX,
  plugins.typescriptEslint,
  ...configs.base.all,
  {
    files: ['src/**/*.ts'],
    rules: {
      // Private methods use _ prefix by convention
      'no-underscore-dangle': 'off',
      // Plugin modifies config objects by design
      'no-param-reassign': ['error', { props: false }],
      // Static-like helper methods that don't use `this`
      'class-methods-use-this': 'off',
      // Allow ++ in loops and counters
      'no-plusplus': 'off',
      // Batch processing intentionally awaits in loops for rate limiting
      'no-await-in-loop': 'off',
      // Allow closures in loops when used with Promise.all batching
      '@typescript-eslint/no-loop-func': 'off',
      // Allow empty interfaces used as placeholder types
      '@typescript-eslint/no-empty-object-type': 'off',
      // For..of loops are idiomatic TypeScript
      'no-restricted-syntax': 'off',
      // Continue in loops used intentionally
      'no-continue': 'off',
      // Allow Function type in test utilities
      '@typescript-eslint/no-unsafe-function-type': 'off',
      // Exception constructors call super() with args - not useless
      '@typescript-eslint/no-useless-constructor': 'off',
      // Variable shadowing in closures is intentional in Promise.all patterns
      '@typescript-eslint/no-shadow': 'off',
      // parseInt without explicit radix - defaults to 10
      radix: 'off',
      // Promise executor returns are used intentionally
      'no-promise-executor-return': 'off',
    },
  },
  {
    files: ['src/__mocks__/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'readonly',
        exports: 'readonly',
      },
    },
  },
  prettierConfig,
];
