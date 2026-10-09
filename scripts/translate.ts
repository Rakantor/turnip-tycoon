/**
 * Translates a catalog's untranslated messages with Claude, checks every translation,
 * and saves them marked fuzzy, so players review them before they count as done.
 *
 *   pnpm i18n:translate de             untranslated messages
 *   pnpm i18n:translate de --redo      every message, replacing existing translations
 *   pnpm i18n:translate de --dry-run   list what would be sent, without calling the API
 *
 * Needs an Anthropic API key in ANTHROPIC_API_KEY. Run `pnpm i18n:extract` first.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import {
  entries,
  readCatalog,
  setMachineTranslation,
  TARGET_LOCALES,
  writeCatalog,
  type Entry,
} from './i18n/catalog';
import { glossaryFor, translationProblems } from './i18n/checks';

const MODEL = 'claude-opus-5-5';
const BATCH_SIZE = 30;
/** Rounds per batch: the first try, then retries for translations that failed a check. */
const ATTEMPTS = 3;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { redo: { type: 'boolean' }, 'dry-run': { type: 'boolean' } },
});
const locale = positionals[0];
if (!locale || !TARGET_LOCALES.includes(locale)) {
  console.error(`Usage: pnpm i18n:translate <${TARGET_LOCALES.join('|')}> [--redo] [--dry-run]`);
  process.exit(1);
}

const language = new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale;
const styleDirectory = resolve(import.meta.dirname, '../src/client/locales/style');
const styleGuide = [
  await readFile(resolve(styleDirectory, 'general.md'), 'utf8'),
  await readFile(resolve(styleDirectory, `${locale}.md`), 'utf8').catch(() => ''),
].join('\n\n');

const catalog = await readCatalog(locale);
const all = entries(catalog);
const pending = all.filter((entry) => values.redo || !entry.translation);
// Reviewed translations, not machine ones, show the wording players settled on.
const reviewed = all.filter((entry) => entry.translation && !entry.fuzzy);

console.log(`${pending.length} of ${all.length} ${language} messages to translate.`);
if (values['dry-run'] || pending.length === 0) {
  for (const entry of pending) console.log(`- ${entry.message}`);
  process.exit(0);
}

// The system prompt stays the same for every batch in a run, so it is cached once.
const system = `You translate the user interface of Turnip Tycoon, a web app for Animal Crossing: New Horizons players, from English into ${language} (${locale}).

${styleGuide}

## Glossary for ${language}

${glossaryFor(locale)}
${
  reviewed.length
    ? `
## Reviewed translations

Players have checked these. Match their wording and terms.

${reviewed.map((entry) => `- ${JSON.stringify(entry.message)} → ${JSON.stringify(entry.translation)}`).join('\n')}
`
    : ''
}
## Your task

Each request lists messages as JSON: an \`id\`, the English \`message\`, translator \`comments\` (where it appears, what numbered placeholders hold), an optional \`context\`, and the source \`files\` that use it. The file names hint at the screen: calculator is the week's price entry, odds-card the hold-or-sell card, groups the friends board, settings and profile-data the settings pages, turnips the trade log, advice the mascot's forecast bubble.

Translate every message. Return each translation with its id, keeping placeholders, tags and plural structure as the style guide describes. A message may say why an earlier translation was rejected; fix that problem.`;

const client = new Anthropic();
const Translations = z.object({
  translations: z.array(z.object({ id: z.string(), translation: z.string() })),
});

async function translate(batch: Entry[], rejected: Map<string, string[]>) {
  const messages = batch.map((entry) => ({
    id: entry.id,
    message: entry.message,
    ...(entry.comments.length ? { comments: entry.comments } : {}),
    ...(entry.context ? { context: entry.context } : {}),
    files: entry.files,
    ...(rejected.has(entry.id)
      ? { previous_attempt_rejected_because: rejected.get(entry.id) }
      : {}),
  }));
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    // A request a safety classifier declines is retried on Anthropic's recommended model.
    fallbacks: 'default',
    output_config: { effort: 'high', format: betaZodOutputFormat(Translations) },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(messages, null, 2) }],
  });
  if (response.stop_reason === 'refusal')
    throw new Error(
      `The request was declined (${response.stop_details?.category ?? 'no category'}).`,
    );
  if (response.stop_reason === 'max_tokens')
    throw new Error('The response was cut off. Lower BATCH_SIZE and run again.');
  if (!response.parsed_output) throw new Error('The response did not match the expected format.');
  const {
    cache_read_input_tokens: cached,
    input_tokens: input,
    output_tokens: output,
  } = response.usage;
  console.log(`  tokens: ${input} in, ${cached ?? 0} cached, ${output} out`);
  return response.parsed_output.translations;
}

let saved = 0;
const failed: { entry: Entry; problems: string[] }[] = [];
for (let start = 0; start < pending.length; start += BATCH_SIZE) {
  let batch = pending.slice(start, start + BATCH_SIZE);
  console.log(`Batch ${start / BATCH_SIZE + 1} of ${Math.ceil(pending.length / BATCH_SIZE)}`);
  const rejected = new Map<string, string[]>();
  for (let attempt = 1; attempt <= ATTEMPTS && batch.length; attempt++) {
    let results: { id: string; translation: string }[];
    try {
      results = await translate(batch, rejected);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        console.error('Set ANTHROPIC_API_KEY to an Anthropic API key.');
        process.exit(1);
      }
      // The SDK has already retried rate limits, server errors and dropped connections.
      if (error instanceof Anthropic.APIError || error instanceof Error)
        console.error(`  ${error.message}`);
      break;
    }
    const byId = new Map(results.map((result) => [result.id, result.translation]));
    const retry: Entry[] = [];
    for (const entry of batch) {
      const translation = byId.get(entry.id) ?? '';
      const problems = byId.has(entry.id)
        ? translationProblems(entry.message, translation, locale)
        : ['no translation was returned'];
      if (problems.length === 0) {
        setMachineTranslation(catalog, entry.id, translation);
        saved++;
      } else {
        rejected.set(entry.id, problems);
        retry.push(entry);
      }
    }
    batch = retry;
  }
  for (const entry of batch) failed.push({ entry, problems: rejected.get(entry.id) ?? [] });
  // Saving after every batch keeps finished work if a later batch fails.
  await writeCatalog(locale, catalog);
}

console.log(`Saved ${saved} translations to src/client/locales/${locale}.po, marked fuzzy.`);
if (failed.length) {
  console.error(`${failed.length} messages still need a translation:`);
  for (const { entry, problems } of failed)
    console.error(`- ${entry.message}\n  ${problems.join('\n  ') || 'the request failed'}`);
  process.exitCode = 1;
}
