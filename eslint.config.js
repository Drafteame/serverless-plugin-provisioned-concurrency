import * as imp from 'eslint-plugin-import';
import prettier from 'eslint-plugin-prettier';

export default [
  {
    files: ['**/*.js'],
    plugins: {
      import: imp,
      prettier: prettier,
    },
    rules: {
      // Example of custom rules, you can add more or modify as needed
      'import/prefer-default-export': 'off',
      'no-console': 'warn',
      'no-unused-vars': 'warn',
      'prettier/prettier': 'error', // Ensures that Prettier issues are flagged as errors
    },
  },
];
