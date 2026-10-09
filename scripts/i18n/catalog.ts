import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import config from '../../lingui.config';

/** A catalog as Lingui reads it: message ID to entry. */
export type Catalog = Awaited<ReturnType<NonNullable<typeof config.format>['parse']>>;

export interface Entry {
  id: string;
  /** The English source text, in ICU MessageFormat. */
  message: string;
  translation: string;
  /** Notes for translators, including what each numbered placeholder holds. */
  comments: string[];
  context?: string;
  /** Source files that use the message. */
  files: string[];
  /** Machine-translated or otherwise waiting for review. */
  fuzzy: boolean;
}

export const SOURCE_LOCALE = config.sourceLocale ?? 'en';

export const TARGET_LOCALES = (config.locales ?? []).filter(
  (locale) =>
    locale !== SOURCE_LOCALE &&
    ![config.pseudoLocale ?? []]
      .flat()
      .some((pseudo) => (typeof pseudo === 'string' ? pseudo : pseudo.locale) === locale),
);

function catalogPath(locale: string): string {
  return resolve(import.meta.dirname, `../../src/client/locales/${locale}.po`);
}

// Reading and writing through Lingui's own formatter keeps files exactly as `lingui extract` writes them.
export async function readCatalog(locale: string): Promise<Catalog> {
  const filename = catalogPath(locale);
  return config.format!.parse(await readFile(filename, 'utf8'), {
    locale,
    sourceLocale: SOURCE_LOCALE,
    filename,
  });
}

export async function writeCatalog(locale: string, catalog: Catalog): Promise<void> {
  const filename = catalogPath(locale);
  const existing = await readFile(filename, 'utf8');
  const content = await config.format!.serialize(catalog, {
    locale,
    sourceLocale: SOURCE_LOCALE,
    filename,
    existing,
  });
  await writeFile(filename, content);
}

function flags(entry: Catalog[string]): string[] {
  const value = entry.extra?.flags;
  return Array.isArray(value) ? value.map(String) : [];
}

/** The catalog's current messages, without obsolete ones. */
export function entries(catalog: Catalog): Entry[] {
  return Object.entries(catalog)
    .filter(([, entry]) => !entry.obsolete)
    .map(([id, entry]) => ({
      id,
      message: entry.message ?? id,
      translation: entry.translation ?? '',
      comments: entry.comments ?? [],
      context: entry.context,
      files: [...new Set((entry.origin ?? []).map(([file]) => file))],
      fuzzy: flags(entry).includes('fuzzy'),
    }));
}

/** Saves a translation marked fuzzy, which Weblate shows as needing review. */
export function setMachineTranslation(catalog: Catalog, id: string, translation: string): void {
  const entry = catalog[id];
  entry.translation = translation;
  entry.extra = { ...entry.extra, flags: [...new Set([...flags(entry), 'fuzzy'])] };
}
