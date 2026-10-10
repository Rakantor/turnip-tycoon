import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHARACTERS_FILE,
  charactersFor,
  SUBSET_DIR,
  SUBSET_LOCALES,
  SUBSETS,
} from '../../scripts/font-subsets';

const subsetCharacters: Record<string, string> = JSON.parse(readFileSync(CHARACTERS_FILE, 'utf8'));

describe.each(SUBSET_LOCALES)('%s font subsets', (locale) => {
  it('hold every character the app shows; run pnpm fonts:subset after changing the catalog', async () => {
    const held = new Set(subsetCharacters[locale]);
    const missing = (await charactersFor(locale)).filter((character) => !held.has(character));
    expect(missing).toEqual([]);
  });

  it('are all present', () => {
    const files = SUBSETS.filter((subset) => subset.locale === locale).map((subset) => subset.file);
    expect(files.filter((file) => !existsSync(resolve(SUBSET_DIR, file)))).toEqual([]);
  });
});
