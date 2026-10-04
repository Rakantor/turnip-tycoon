import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import type { SessionResponse } from '../../src/shared/api';
import { emptyWeek, inputsOf, type WeekMutation, type WeekRecord } from '../../src/shared/week';
import { createTestDatabase } from '../helpers/database';
import { Browser, expectError, sessionCookie } from './browser';

describe('Owned weekly prices and revisioned saves', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let app: ReturnType<typeof createApp>;
  const weekStart = '2026-10-04';

  beforeAll(async () => {
    database = await createTestDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    app = createApp(database.url);
  }, 60_000);

  beforeEach(async () => {
    await client.query('truncate table turnip_private.players cascade');
  });
  afterAll(async () => {
    if (client) await client.end();
    if (database) await database.stop();
  });

  async function player() {
    const browser = new Browser(app);
    const response = await browser.request('POST', '/api/session', { deviceName: 'Phone' });
    expect(response.status).toBe(201);
    return { browser, session: (await response.json()) as SessionResponse };
  }
  function mutation(overrides: Partial<WeekMutation> = {}): WeekMutation {
    return {
      mutationId: randomUUID(),
      baseRevision: 0,
      purchasePrice: 100,
      firstBuy: false,
      previousPattern: 'decreasing',
      prices: [91, null, 84, null, null, 165, null, null, 550, null, 90, 80],
      ...overrides,
    };
  }
  async function read(browser: Browser, date = weekStart) {
    const response = await browser.request('GET', `/api/weeks/${date}`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { week: WeekRecord }).week;
  }

  it('returns an empty owned week without inserting a historical record', async () => {
    const { browser, session } = await player();
    expect(await read(browser)).toEqual(emptyWeek(session.player.id, weekStart));
    expect((await client.query('select * from turnip_private.weeks')).rows).toEqual([]);
    const history = await browser.request('GET', '/api/weeks');
    expect(await history.json()).toEqual({ weeks: [], nextCursor: null });
  });

  it('defaults a new week to the uniquely identified preceding pattern without creating history', async () => {
    const maple = await player();
    const cherry = await player();
    const preceding = mutation({
      previousPattern: 'decreasing',
      prices: [90, 86, 82, 110, 180, 450, 180, 110, 60, 55, 50, 45],
    });
    expect((await maple.browser.request('PUT', '/api/weeks/2026-09-27', preceding)).status).toBe(
      200,
    );

    // The preceding record's previousPattern describes the week before it;
    // infer the preceding week's actual pattern from its observations instead.
    expect(await read(maple.browser)).toEqual({
      ...emptyWeek(maple.session.player.id, weekStart),
      previousPattern: 'large-spike',
    });
    expect(await read(cherry.browser)).toEqual(emptyWeek(cherry.session.player.id, weekStart));
    const history = await maple.browser.request('GET', '/api/weeks');
    expect(await history.json()).toEqual({
      weeks: [await read(maple.browser, '2026-09-27')],
      nextCursor: null,
    });
    expect((await client.query('select * from turnip_private.weeks')).rows).toHaveLength(1);
  });

  it.each([
    {
      condition: 'ambiguous',
      purchasePrice: 100,
      prices: [90, 85, ...Array<number | null>(10).fill(null)],
    },
    {
      condition: 'inconsistent',
      purchasePrice: 100,
      prices: [660, ...Array<number | null>(11).fill(null)],
    },
    {
      condition: 'empty',
      purchasePrice: null,
      prices: Array<number | null>(12).fill(null),
    },
  ])(
    'defaults to Unknown after an $condition preceding week',
    async ({ purchasePrice, prices }) => {
      const { browser, session } = await player();
      expect(
        (
          await browser.request(
            'PUT',
            '/api/weeks/2026-09-27',
            mutation({ purchasePrice, prices, previousPattern: 'large-spike' }),
          )
        ).status,
      ).toBe(200);
      expect(await read(browser)).toEqual(emptyWeek(session.player.id, weekStart));
    },
  );

  it('does not infer across a missing week or from a future week', async () => {
    const { browser, session } = await player();
    for (const date of ['2026-09-20', '2026-10-11']) {
      expect(
        (
          await browser.request(
            'PUT',
            `/api/weeks/${date}`,
            mutation({ prices: [90, 86, 82, 110, 180, 450, 180, 110, 60, 55, 50, 45] }),
          )
        ).status,
      ).toBe(200);
    }
    expect(await read(browser)).toEqual(emptyWeek(session.player.id, weekStart));
  });

  it.each([null, 'fluctuating'] as const)(
    'preserves a saved previous-pattern choice of %s',
    async (previousPattern) => {
      const { browser } = await player();
      expect(
        (await browser.request('PUT', `/api/weeks/${weekStart}`, mutation({ previousPattern })))
          .status,
      ).toBe(200);
      expect(
        (
          await browser.request(
            'PUT',
            '/api/weeks/2026-09-27',
            mutation({ prices: [90, 86, 82, 110, 180, 450, 180, 110, 60, 55, 50, 45] }),
          )
        ).status,
      ).toBe(200);
      expect(await read(browser)).toMatchObject({ revision: 1, previousPattern });
    },
  );

  it('saves every weekly field, removes cleared slots, and isolates players', async () => {
    const maple = await player();
    const cherry = await player();
    const edit = mutation();
    const saved = await maple.browser.request('PUT', `/api/weeks/${weekStart}`, edit);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ revision: 1 });
    expect(await read(maple.browser)).toEqual({
      ...inputsOf(edit),
      playerId: maple.session.player.id,
      weekStart,
      revision: 1,
    });
    expect(await read(cherry.browser)).toEqual(emptyWeek(cherry.session.player.id, weekStart));
    const cleared = mutation({
      baseRevision: 1,
      purchasePrice: null,
      firstBuy: null,
      previousPattern: null,
      prices: Array(12).fill(null),
    });
    expect((await maple.browser.request('PUT', `/api/weeks/${weekStart}`, cleared)).status).toBe(
      200,
    );
    expect(await read(maple.browser)).toEqual({
      ...emptyWeek(maple.session.player.id, weekStart),
      revision: 2,
    });
    expect((await client.query('select * from turnip_private.price_entries')).rows).toHaveLength(0);
    const outsider = await cherry.browser.request('GET', '/api/weeks');
    expect(await outsider.json()).toEqual({ weeks: [], nextCursor: null });
  });

  it('replays the original revision without overwriting newer edits and rejects changed reuse', async () => {
    const { browser } = await player();
    const first = mutation();
    expect((await browser.request('PUT', `/api/weeks/${weekStart}`, first)).status).toBe(200);
    const next = mutation({ baseRevision: 1, purchasePrice: 105 });
    expect((await browser.request('PUT', `/api/weeks/${weekStart}`, next)).status).toBe(200);
    const replay = await browser.request('PUT', `/api/weeks/${weekStart}`, first);
    expect(await replay.json()).toEqual({ revision: 1 });
    expect(await read(browser)).toMatchObject({ revision: 2, purchasePrice: 105 });
    expect(
      (
        await expectError(
          await browser.request('PUT', `/api/weeks/${weekStart}`, { ...first, purchasePrice: 101 }),
          409,
        )
      ).error.code,
    ).toBe('MUTATION_REUSED');
    expect(
      (await expectError(await browser.request('PUT', '/api/weeks/2026-09-27', first), 409)).error
        .code,
    ).toBe('MUTATION_REUSED');
    expect((await client.query('select * from turnip_private.mutations')).rows).toHaveLength(2);
  });

  it('allows one concurrent edit and returns the complete server snapshot for the conflict', async () => {
    const { browser } = await player();
    const otherTab = new Browser(app);
    otherTab.cookies.set(sessionCookie, browser.cookies.get(sessionCookie)!);
    const edits = [mutation({ purchasePrice: 90 }), mutation({ purchasePrice: 110 })];
    const responses = await Promise.all([
      browser.request('PUT', `/api/weeks/${weekStart}`, edits[0]),
      otherTab.request('PUT', `/api/weeks/${weekStart}`, edits[1]),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const conflict = await responses.find((response) => response.status === 409)!.json();
    expect(conflict).toEqual({
      error: { code: 'REVISION_CONFLICT', message: expect.any(String) },
      week: await read(browser),
    });
    const loser = responses.findIndex((response) => response.status === 409);
    expect(
      (
        await browser.request('PUT', `/api/weeks/${weekStart}`, {
          ...edits[loser],
          baseRevision: 1,
        })
      ).status,
    ).toBe(200);
    expect(await read(browser)).toMatchObject({
      revision: 2,
      purchasePrice: edits[loser]!.purchasePrice,
    });
  });

  it('deduplicates concurrent delivery of the same mutation', async () => {
    const { browser } = await player();
    const input = mutation();
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => browser.request('PUT', `/api/weeks/${weekStart}`, input)),
    );
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ revision: 1 });
    }
    expect((await client.query('select * from turnip_private.mutations')).rows).toHaveLength(1);
    expect(await read(browser)).toMatchObject({ revision: 1 });
  });

  it('accepts historical edits and paginates only saved own weeks without duplicates', async () => {
    const { browser } = await player();
    const dates = ['2020-03-22', '2020-03-29', '2020-04-05'];
    for (const date of dates)
      expect((await browser.request('PUT', `/api/weeks/${date}`, mutation())).status).toBe(200);
    await read(browser, '2020-03-15');
    const first = await browser.request('GET', '/api/weeks?limit=2');
    const page = (await first.json()) as { weeks: WeekRecord[]; nextCursor: string | null };
    expect(page.weeks.map((week) => week.weekStart)).toEqual(['2020-04-05', '2020-03-29']);
    expect(page.nextCursor).toBe('2020-03-29');
    const second = await browser.request('GET', `/api/weeks?limit=2&before=${page.nextCursor}`);
    expect(await second.json()).toEqual({
      weeks: [await read(browser, '2020-03-22')],
      nextCursor: null,
    });
    expect(
      (
        await browser.request(
          'PUT',
          '/api/weeks/2020-03-22',
          mutation({ baseRevision: 1, purchasePrice: 110 }),
        )
      ).status,
    ).toBe(200);
    expect(await read(browser, '2020-03-22')).toMatchObject({ revision: 2, purchasePrice: 110 });
  });

  it('rejects invalid dates, prices, revisions, field injection, and malformed history cursors', async () => {
    const { browser } = await player();
    for (const date of ['2026-10-05', '2026-02-30', '2026-2-1', '0000-01-01', 'not-a-date']) {
      await expectError(await browser.request('GET', `/api/weeks/${date}`), 400);
      await expectError(await browser.request('PUT', `/api/weeks/${date}`, mutation()), 400);
    }
    for (const input of [
      mutation({ purchasePrice: 89 }),
      mutation({ purchasePrice: 111 }),
      mutation({ purchasePrice: 100.5 }),
      mutation({ prices: [] }),
      mutation({ prices: Array(12).fill(0) }),
      mutation({ prices: Array(12).fill(661) }),
      mutation({ prices: Array(12).fill(1.5) }),
      mutation({ baseRevision: -1 }),
      mutation({ mutationId: 'not-a-uuid' }),
      { ...mutation(), playerId: randomUUID() },
      { ...mutation(), weekStart },
      { ...mutation(), previousPattern: 'random' },
      { ...mutation(), firstBuy: 'yes' },
    ])
      await expectError(await browser.request('PUT', `/api/weeks/${weekStart}`, input), 400);
    for (const query of [
      'before=2026-02-30',
      'limit=0',
      'limit=101',
      'limit=no',
      `playerId=${randomUUID()}`,
    ]) {
      await expectError(await browser.request('GET', `/api/weeks?${query}`), 400);
    }
    expect((await client.query('select * from turnip_private.weeks')).rows).toHaveLength(0);
  });

  it('requires authentication and rejects stale tabs after a browser switches players', async () => {
    const unauthenticated = new Browser(app);
    await expectError(await unauthenticated.request('GET', `/api/weeks/${weekStart}`), 401);
    await expectError(await unauthenticated.request('GET', '/api/weeks'), 401);
    await expectError(
      await unauthenticated.request('PUT', `/api/weeks/${weekStart}`, mutation()),
      401,
    );
    const oldPlayer = await player();
    const newPlayer = await player();
    oldPlayer.browser.cookies.set(sessionCookie, newPlayer.browser.cookies.get(sessionCookie)!);
    for (const [method, path, body] of [
      ['GET', `/api/weeks/${weekStart}`, undefined],
      ['GET', '/api/weeks', undefined],
      ['PUT', `/api/weeks/${weekStart}`, mutation()],
      ['PATCH', '/api/profile', { displayName: 'Stale name' }],
    ] as const) {
      const error = await expectError(
        await oldPlayer.browser.request(method, path, body, {
          playerId: oldPlayer.session.player.id,
        }),
        409,
      );
      expect(error.error.code).toBe('PLAYER_CHANGED');
    }
    expect(
      (
        await oldPlayer.browser.request('PUT', `/api/weeks/${weekStart}`, mutation(), {
          playerId: newPlayer.session.player.id,
        })
      ).status,
    ).toBe(200);
    expect(await read(newPlayer.browser)).toMatchObject({ revision: 1 });
  });
});
