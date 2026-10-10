import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/** What each `src` directory must never import: client and Worker meet in shared and prediction. */
const forbidden = {
  shared: ['client', 'server', 'db', 'prediction'],
  prediction: ['client', 'server', 'db'],
  db: ['client', 'server'],
  server: ['client'],
  client: ['server', 'db'],
};

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.wrangler/**',
      '.local/**',
      'worker-configuration.d.ts',
      'drizzle/**',
      'output/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.worker.json', './tsconfig.node.json'],
      },
    },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  ...Object.entries(forbidden).map(([from, targets]) => ({
    files: [`src/${from}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: targets.map((target) => ({
            regex: `^\\.\\.?/(?:\\.\\./)*${target}(?:/|$)`,
            message: `src/${from} must not import from src/${target}.`,
          })),
        },
      ],
    },
  })),
);
