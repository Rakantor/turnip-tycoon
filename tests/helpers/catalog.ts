import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import config from '../../lingui.config';

/** A catalog as Lingui reads it: message ID to entry. */
export type Catalog = Awaited<ReturnType<NonNullable<typeof config.format>['parse']>>;

export interface Entry {
  /** The English source text, in ICU MessageFormat. */
  message: string;
  translation: string;
}

export const SOURCE_LOCALE = config.sourceLocale ?? 'en';

export const TARGET_LOCALES = (config.locales ?? []).filter(
  (locale) =>
    locale !== SOURCE_LOCALE &&
    ![config.pseudoLocale ?? []]
      .flat()
      .some((pseudo) => (typeof pseudo === 'string' ? pseudo : pseudo.locale) === locale),
);

// Parsed with the same formatter `lingui extract` writes with.
export async function readCatalog(locale: string): Promise<Catalog> {
  const filename = resolve(import.meta.dirname, `../../src/client/locales/${locale}.po`);
  return config.format!.parse(await readFile(filename, 'utf8'), {
    locale,
    sourceLocale: SOURCE_LOCALE,
    filename,
  });
}

/** The catalog's current messages, without obsolete ones. */
export function entries(catalog: Catalog): Entry[] {
  return Object.entries(catalog)
    .filter(([, entry]) => !entry.obsolete)
    .map(([id, entry]) => ({
      message: entry.message ?? id,
      translation: entry.translation ?? '',
    }));
}
