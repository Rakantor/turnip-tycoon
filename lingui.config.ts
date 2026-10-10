import { defineConfig } from '@lingui/cli';
import { formatter } from '@lingui/format-po';
import { createSwcExtractor } from '@lingui/native-tools';

export default defineConfig({
  sourceLocale: 'en',
  // `pseudo` stretches and brackets every extracted message, so text that was missed stands out.
  // Development builds offer it in Settings; production builds never load it.
  locales: ['en', 'de', 'es', 'fr', 'it', 'nl', 'ru', 'pseudo'],
  pseudoLocale: { locale: 'pseudo', prepend: '⟦', append: '⟧', extend: 0.3 },
  fallbackLocales: { default: 'en' },
  catalogs: [{ path: '<rootDir>/src/client/locales/{locale}', include: ['<rootDir>/src/client'] }],
  extractors: [createSwcExtractor()],
  // Origins without line numbers keep catalog diffs to the messages that changed.
  format: formatter({ lineNumbers: false }),
});
