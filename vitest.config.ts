import { defineConfig } from 'vitest/config';
import { lingui } from '@lingui/vite-plugin';

export default defineConfig({
  plugins: [lingui({ macroTransform: true })],
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/helpers/i18n.ts'],
    testTimeout: 15000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
