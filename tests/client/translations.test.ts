import { describe, expect, it } from 'vitest';
import { entries, readCatalog, TARGET_LOCALES } from '../../scripts/i18n/catalog';
import { glossary, translationProblems } from '../../scripts/i18n/checks';

describe.each(TARGET_LOCALES)('%s translations', (locale) => {
  it('keep placeholders, tags and plurals, and use the game’s terms', async () => {
    const problems = entries(await readCatalog(locale))
      .filter((entry) => entry.translation)
      .flatMap((entry) =>
        translationProblems(entry.message, entry.translation, locale).map(
          (problem) => `${JSON.stringify(entry.message)}: ${problem}`,
        ),
      );
    expect(problems).toEqual([]);
  });

  it('have a glossary entry for every enforced game term', () => {
    const missing = glossary.terms
      .filter((term) => term.kind === 'game' && !term.translations[locale])
      .map((term) => term.en);
    expect(missing).toEqual([]);
  });
});
