import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serverMessage, serverMessages } from '../../src/client/data/server-messages';
import { GROUP_CAPACITY } from '../../src/server/groups';

const SERVER = join(import.meta.dirname, '../../src/server');

/** Every message the API can send in an ApiError, as the client receives it. */
function apiErrorMessages(): string[] {
  const messages = new Set<string>();
  for (const file of readdirSync(SERVER).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(SERVER, file), 'utf8');
    const calls = source.matchAll(
      /new ApiError\(\s*\d+,\s*'[A-Z_]+',\s*(['`])((?:(?!\1)[^\\]|\\.)*)\1/g,
    );
    for (const [, , text] of calls)
      messages.add(text.replaceAll('${GROUP_CAPACITY}', String(GROUP_CAPACITY)));
  }
  // Validation reports its first issue, falling back to this.
  messages.add('Check the supplied fields.');
  return [...messages];
}

describe('server messages', () => {
  it('can translate every message the API sends', () => {
    const known = serverMessages();
    const sent = apiErrorMessages();
    expect(sent.length).toBeGreaterThan(20);
    expect(sent.filter((message) => !(message in known))).toEqual([]);
  });

  it('keeps English as sent and passes unknown messages through', () => {
    expect(serverMessage('This group is no longer available to you.')).toBe(
      'This group is no longer available to you.',
    );
    expect(serverMessage('Too big: expected string to have <=60 characters')).toBe(
      'Too big: expected string to have <=60 characters',
    );
  });
});
