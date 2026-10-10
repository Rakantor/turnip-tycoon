import { parse, type Token } from '@messageformat/parser';
import { z } from 'zod';
import glossaryData from '../../src/client/locales/glossary.json';

const glossarySchema = z.object({
  terms: z.array(
    z.object({
      en: z.string(),
      kind: z.enum(['game', 'community', 'app']),
      note: z.string().optional(),
      match: z.array(z.string()),
      translations: z.record(
        z.string(),
        z.object({
          term: z.string(),
          forms: z.array(z.string()),
          avoid: z.array(z.string()),
          source: z.string(),
        }),
      ),
    }),
  ),
});

export type Glossary = z.infer<typeof glossarySchema>;
export const glossary: Glossary = glossarySchema.parse(glossaryData);

// Names that contain game words but stay in English.
const PROPER_NAMES = /Turnip (?:Tycoon|Prophet)/g;

function words(text: string, list: string[]): boolean {
  const plain = text.replace(PROPER_NAMES, '');
  return list.some((word) =>
    new RegExp(
      `(?<![\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`,
      'iu',
    ).test(plain),
  );
}

interface Shape {
  args: string[];
  tags: string[];
  problems: string[];
}

function shape(message: string, locale: string): Shape {
  const args = new Set<string>();
  const tags: string[] = [];
  const problems: string[] = [];
  const visit = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === 'content') tags.push(...(token.value.match(/<\/?\d+\/?>/g) ?? []));
      else if (token.type !== 'octothorpe') {
        args.add(token.arg);
        if (token.type === 'plural' || token.type === 'select' || token.type === 'selectordinal') {
          if (!token.cases.some((entry) => entry.key === 'other'))
            problems.push(`{${token.arg}} needs an “other” case`);
          for (const entry of token.cases) visit(entry.tokens);
        }
      }
    }
  };
  try {
    const cardinal = new Intl.PluralRules(locale).resolvedOptions()
      .pluralCategories as Intl.LDMLPluralRule[];
    visit(parse(message, { cardinal }));
  } catch (error) {
    problems.push(`not valid ICU MessageFormat: ${error instanceof Error ? error.message : error}`);
  }
  return { args: [...args].sort(), tags: tags.sort(), problems };
}

/** What's wrong with a translation of `source` into `locale`; empty when nothing is. */
export function translationProblems(source: string, translation: string, locale: string): string[] {
  if (!translation.trim()) return ['the translation is empty'];
  const expected = shape(source, 'en');
  const actual = shape(translation, locale);
  const problems = [...actual.problems];
  if (expected.args.join() !== actual.args.join())
    problems.push(
      `placeholders differ: expected ${expected.args.map((arg) => `{${arg}}`).join(' ') || 'none'}, got ${actual.args.map((arg) => `{${arg}}`).join(' ') || 'none'}`,
    );
  if (expected.tags.join() !== actual.tags.join())
    problems.push(
      `tags differ: expected ${expected.tags.join(' ') || 'none'}, got ${actual.tags.join(' ') || 'none'}`,
    );
  for (const term of glossary.terms) {
    const target = term.translations[locale];
    if (term.kind !== 'game' || !target) continue;
    if (
      words(source, term.match) &&
      !target.forms.some((form) => translation.toLowerCase().includes(form.toLowerCase()))
    )
      problems.push(`use the game’s term for “${term.en}”: ${target.term}`);
    if (target.avoid.length && words(translation, target.avoid))
      problems.push(
        `don’t use ${target.avoid.map((word) => `“${word}”`).join(' or ')} for “${term.en}”: use ${target.term}`,
      );
  }
  return problems;
}
