import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import config from '../lingui.config';

/**
 * Japanese, Korean and Chinese fonts run to several megabytes per weight, so the app ships them
 * cut down to the characters its own text uses. `pnpm fonts:subset` downloads the pinned originals
 * and writes the subsets here; tests/client/fonts.test.ts fails when a catalog needs a character
 * they lack.
 */
export const SUBSET_DIR = resolve(import.meta.dirname, '../src/client/fonts/cjk');
/** Per locale, the characters its subsets hold. */
export const CHARACTERS_FILE = resolve(SUBSET_DIR, 'characters.json');

export interface Source {
  url: string;
  sha256: string;
  /** The font's file inside the download, when the download is a 7z archive. */
  member?: string;
}

export interface Subset {
  locale: string;
  /** Starts with `cjk-`, which the service worker leaves out of the offline precache. */
  file: string;
  source: Source;
  /** Headings only: characters it lacks fall through to the locale's text font. */
  headings?: boolean;
}

const GOOGLE_FONTS =
  'https://raw.githubusercontent.com/google/fonts/0b58fb370093f9a9f4ff785d94405710b79de67c/ofl';
const RESOURCE_HAN_ROUNDED =
  'https://github.com/CyanoHao/Resource-Han-Rounded/releases/download/v0.990';

const resourceHanRounded = (region: 'CN' | 'KR', style: string): Source => ({
  url: `${RESOURCE_HAN_ROUNDED}/RHR-${region}-0.990.7z`,
  sha256:
    region === 'CN'
      ? 'e7005f7b4a7a0b8352d32c4a1358ff47564eb73be7fdb2db00d9f792755e9dc7'
      : 'e609a97c76c7529484667d70199c6db74460ebe66fcc9bb3a09e65032d62b8ec',
  member: `ResourceHanRounded${region}-${style}.ttf`,
});

// Two weights each: CSS matches the app's 500 to Regular and its 600 to 800 to Bold.
export const SUBSETS: Subset[] = [
  {
    locale: 'ja',
    file: 'cjk-ja-m-plus-rounded-1c-400.woff2',
    source: {
      url: `${GOOGLE_FONTS}/mplusrounded1c/MPLUSRounded1c-Regular.ttf`,
      sha256: 'b75708b53e45b06d17d470aeeca5b766e3d1b3999f03f13ec4eb863ca846c14c',
    },
  },
  {
    locale: 'ja',
    file: 'cjk-ja-m-plus-rounded-1c-700.woff2',
    source: {
      url: `${GOOGLE_FONTS}/mplusrounded1c/MPLUSRounded1c-Bold.ttf`,
      sha256: 'c358630584e8e2d8fbd6121d0f4693255ffef6d1e6d4f3441fd6e5a963a11f9e',
    },
  },
  {
    locale: 'ko',
    file: 'cjk-ko-jua-400.woff2',
    source: {
      url: `${GOOGLE_FONTS}/jua/Jua-Regular.ttf`,
      sha256: '769677aef240bfc3b9965f2b50748075bff885e6c6992fc591a3fb268279f898',
    },
    headings: true,
  },
  {
    locale: 'ko',
    file: 'cjk-ko-resource-han-rounded-400.woff2',
    source: resourceHanRounded('KR', 'Regular'),
  },
  {
    locale: 'ko',
    file: 'cjk-ko-resource-han-rounded-700.woff2',
    source: resourceHanRounded('KR', 'Bold'),
  },
  {
    locale: 'zh-Hans',
    file: 'cjk-zh-hans-resource-han-rounded-400.woff2',
    source: resourceHanRounded('CN', 'Regular'),
  },
  {
    locale: 'zh-Hans',
    file: 'cjk-zh-hans-resource-han-rounded-700.woff2',
    source: resourceHanRounded('CN', 'Bold'),
  },
  {
    locale: 'zh-Hant',
    file: 'cjk-zh-hant-huninn-400.woff2',
    source: {
      url: `${GOOGLE_FONTS}/huninn/Huninn-Regular.ttf`,
      sha256: '1bd770a5ffc0c06723b567686f8b5db5abf9ab54227f3bbc4e6fd648f4698805',
    },
  },
];

export const SUBSET_LOCALES = [...new Set(SUBSETS.map((subset) => subset.locale))];

// Punctuation a translation may come to use, so a new catalog line rarely needs new subsets.
const PUNCTUATION = '、。「」『』【】〈〉《》〜～・ー！？（），．：；［］';

/** Text the app formats itself in this locale: dates, times, lists and numbers. */
function formatted(locale: string): string[] {
  const text: string[] = [];
  const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour, 5);
  const weekRange = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  for (let month = 0; month < 12; month++) {
    for (const day of [1, 4, 10, 28]) {
      const date = at(month, day);
      text.push(
        new Intl.DateTimeFormat(locale).format(date),
        new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date),
        new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date),
        new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
        weekRange.formatRange(date, at(month, day + 6)),
      );
    }
  }
  text.push(weekRange.formatRange(at(11, 28), at(12, 3)));
  for (let hour = 0; hour < 24; hour++)
    text.push(
      new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
        at(0, 1, hour),
      ),
    );
  const list = new Intl.ListFormat(locale, { type: 'conjunction' });
  text.push(list.format(['a', 'b']), list.format(['a', 'b', 'c']));
  text.push(
    new Intl.NumberFormat(locale, { style: 'percent' }).format(0.42),
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(12345.6),
  );
  return text;
}

async function translations(locale: string): Promise<string[]> {
  const filename = resolve(import.meta.dirname, `../src/client/locales/${locale}.po`);
  const catalog = await config.format!.parse(await readFile(filename, 'utf8'), {
    locale,
    sourceLocale: config.sourceLocale ?? 'en',
    filename,
  });
  return Object.values(catalog)
    .filter((entry) => !entry.obsolete)
    .map((entry) => entry.translation ?? '');
}

async function languageName(locale: string): Promise<string> {
  const source = await readFile(resolve(import.meta.dirname, '../src/client/i18n.ts'), 'utf8');
  return source.match(new RegExp(`locale: '${locale}', name: '([^']+)'`))?.[1] ?? '';
}

/**
 * Every character beyond ASCII that the app can show in this locale, sorted. Fredoka and Nunito
 * draw ASCII before a CJK font is consulted.
 */
export async function charactersFor(locale: string): Promise<string[]> {
  const text = [
    ...(await translations(locale)),
    ...formatted(locale),
    await languageName(locale),
    PUNCTUATION,
  ].join('');
  return [...new Set(text)]
    .filter((character) => character.codePointAt(0)! > 0x7f)
    .sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
}
