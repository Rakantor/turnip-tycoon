import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { GROUP_CAPACITY } from '../../src/server/groups';
import type { Player, SessionResponse } from '../../src/shared/api';
import type { GroupsResponse, GroupSummary, SharedPlayerWeek } from '../../src/shared/groups';
import { emptyWeek, type WeekMutation, type WeekRecord } from '../../src/shared/week';
import { createTestDatabase } from '../helpers/database';
import { Browser, expectError, sessionCookie } from './browser';

describe('Groups and shared player prices', () => {
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
    await client.query('truncate table turnip_private.players, turnip_private.groups cascade');
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
  async function create(browser: Browser, name = 'Our islands'): Promise<GroupSummary> {
    const response = await browser.request('POST', '/api/groups', { name });
    expect(response.status).toBe(201);
    return ((await response.json()) as { group: GroupSummary }).group;
  }
  async function join(browser: Browser, group: GroupSummary) {
    const response = await browser.request('POST', '/api/groups/join', { code: group.code });
    expect(response.status).toBe(200);
    return ((await response.json()) as { group: GroupSummary }).group;
  }
  async function overview(browser: Browser): Promise<GroupsResponse> {
    const response = await browser.request('GET', `/api/groups?weekStart=${weekStart}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    return response.json() as Promise<GroupsResponse>;
  }
  async function detail(browser: Browser, group: GroupSummary) {
    const response = await browser.request('GET', `/api/groups/${group.id}?weekStart=${weekStart}`);
    expect(response.status).toBe(200);
    return response.json() as Promise<{ group: GroupSummary; members: SharedPlayerWeek[] }>;
  }
  async function save(browser: Browser, date = weekStart, price = 153) {
    const input: WeekMutation = {
      mutationId: randomUUID(),
      baseRevision: 0,
      purchasePrice: 100,
      firstBuy: false,
      previousPattern: 'fluctuating',
      prices: [91, null, 87, price, null, null, null, null, null, null, null, null],
    };
    expect((await browser.request('PUT', `/api/weeks/${date}`, input)).status).toBe(200);
    return input;
  }
  const memberWeek = (id: string) => `/api/players/${id}/weeks/${weekStart}`;
  const memberHistory = (id: string) => `/api/players/${id}/weeks`;

  it('creates an equal first member, trims the name, and exposes no access credentials', async () => {
    const owner = await player();
    expect(await overview(owner.browser)).toEqual({ groups: [], players: [] });
    const group = await create(owner.browser, '  Weekend turnips  ');
    expect(group).toEqual({
      id: expect.any(String),
      name: 'Weekend turnips',
      code: expect.stringMatching(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/),
      memberCount: 1,
      capacity: GROUP_CAPACITY,
    });
    const data = await overview(owner.browser);
    expect(data).toEqual({
      groups: [group],
      players: [
        {
          player: owner.session.player,
          week: emptyWeek(owner.session.player.id, weekStart),
          groupIds: [group.id],
        },
      ],
    });
    expect(JSON.stringify(data)).not.toMatch(
      /tokenHash|recoveryCode|deviceId|codeHash|ownerId|role/,
    );
    expect((await detail(owner.browser, group)).members).toEqual(data.players);
    expect((await client.query('select * from turnip_private.weeks')).rows).toHaveLength(0);
    expect((await owner.browser.request('DELETE', `/api/groups/${group.id}`)).status).toBe(404);
  });

  it('accepts pasted lowercase codes and treats duplicate joins as a no-op', async () => {
    const owner = await player();
    const friend = await player();
    const group = await create(owner.browser);
    const response = await friend.browser.request('POST', '/api/groups/join', {
      code: `  ${group.code.toLowerCase().replaceAll('-', ' ')}  `,
    });
    expect(response.status).toBe(200);
    expect(await join(friend.browser, group)).toEqual({ ...group, memberCount: 2 });
    expect(await join(owner.browser, group)).toEqual({ ...group, memberCount: 2 });
    expect((await client.query('select * from turnip_private.memberships')).rows).toHaveLength(2);
    expect((await detail(friend.browser, group)).group.code).toBe(group.code);
  });

  it('previews an invite’s group and names for a visitor without a profile', async () => {
    const owner = await player();
    const friend = await player();
    const group = await create(owner.browser, 'Odds crew');
    await join(friend.browser, group);
    await owner.browser.request('PATCH', '/api/profile', { displayName: 'Rosa' });
    await friend.browser.request('PATCH', '/api/profile', { displayName: 'Mika' });
    const visitor = new Browser(app);
    const code = encodeURIComponent(group.code.toLowerCase());
    const response = await visitor.request('GET', `/api/groups/preview?code=${code}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      group: { name: 'Odds crew', memberCount: 2, capacity: 8 },
      members: ['Mika', 'Rosa'],
    });
    await expectError(await visitor.request('GET', '/api/groups/preview?code=ABCD-EFGH-JKMN'), 404);
    await expectError(await visitor.request('GET', '/api/groups/preview?code=nope'), 404);
    expect(
      (await client.query('select count(*)::int as count from turnip_private.players')).rows[0]
        .count,
    ).toBe(2);
  });

  it('deduplicates shared players across groups and stores each week only once', async () => {
    const owner = await player();
    const friend = await player();
    const other = await player();
    const first = await create(owner.browser, 'Family');
    const second = await create(owner.browser, 'Friends');
    await join(friend.browser, first);
    await join(friend.browser, second);
    await join(other.browser, second);
    const values = await save(friend.browser);
    const data = await overview(owner.browser);
    expect(data.groups.map((group) => group.memberCount).sort()).toEqual([2, 3]);
    expect(data.players).toHaveLength(3);
    const shared = data.players.find((entry) => entry.player.id === friend.session.player.id)!;
    expect(shared.groupIds.sort()).toEqual([first.id, second.id].sort());
    expect(shared.week).toMatchObject({
      purchasePrice: values.purchasePrice,
      prices: values.prices,
      revision: 1,
    });
    const single = await detail(owner.browser, first);
    expect(single.members.map((entry) => entry.player.id).sort()).toEqual(
      [owner.session.player.id, friend.session.player.id].sort(),
    );
    expect(single.members.every((entry) => entry.groupIds.length === 1)).toBe(true);
    expect((await client.query('select * from turnip_private.weeks')).rows).toHaveLength(1);
  });

  it('checks active shared membership for detail, member prices, and paginated history', async () => {
    const owner = await player();
    const friend = await player();
    const outsider = await player();
    const group = await create(owner.browser);
    await join(friend.browser, group);
    await save(friend.browser);
    await save(friend.browser, '2026-09-27', 165);
    await save(friend.browser, '2026-09-20', 195);
    const prices = await owner.browser.request('GET', memberWeek(friend.session.player.id));
    expect(prices.status).toBe(200);
    expect(await prices.json()).toMatchObject({
      player: friend.session.player,
      week: { prices: [91, null, 87, 153, null, null, null, null, null, null, null, null] },
    });
    const history = await owner.browser.request(
      'GET',
      `${memberHistory(friend.session.player.id)}?limit=1&before=${weekStart}`,
    );
    expect(history.status).toBe(200);
    const page = (await history.json()) as {
      player: Player;
      weeks: WeekRecord[];
      nextCursor: string | null;
    };
    expect(page.player).toEqual(friend.session.player);
    expect(page.weeks.map((week) => week.weekStart)).toEqual(['2026-09-27']);
    expect(page.nextCursor).toBe('2026-09-27');
    const next = await owner.browser.request(
      'GET',
      `${memberHistory(friend.session.player.id)}?limit=1&before=${page.nextCursor!}`,
    );
    expect(await next.json()).toMatchObject({
      weeks: [{ weekStart: '2026-09-20' }],
      nextCursor: null,
    });
    for (const path of [
      `/api/groups/${group.id}?weekStart=${weekStart}`,
      memberWeek(friend.session.player.id),
      memberHistory(friend.session.player.id),
    ]) {
      await expectError(await outsider.browser.request('GET', path), 404);
    }
    expect(await overview(outsider.browser)).toEqual({ groups: [], players: [] });
    expect(
      (await owner.browser.request('PUT', memberWeek(friend.session.player.id), {})).status,
    ).toBe(404);
    expect((await friend.browser.request('GET', memberWeek(friend.session.player.id))).status).toBe(
      200,
    );
  });

  it('keeps access through another shared group and revokes it after the final shared membership ends', async () => {
    const owner = await player();
    const friend = await player();
    const first = await create(owner.browser);
    const second = await create(owner.browser);
    await join(friend.browser, first);
    await join(friend.browser, second);
    await save(friend.browser);
    expect(
      (await friend.browser.request('DELETE', `/api/groups/${first.id}/membership`)).status,
    ).toBe(200);
    expect((await detail(owner.browser, first)).members).toHaveLength(1);
    expect((await owner.browser.request('GET', memberWeek(friend.session.player.id))).status).toBe(
      200,
    );
    expect(
      (await friend.browser.request('DELETE', `/api/groups/${second.id}/membership`)).status,
    ).toBe(200);
    for (const path of [
      memberWeek(friend.session.player.id),
      memberHistory(friend.session.player.id),
    ]) {
      await expectError(await owner.browser.request('GET', path), 404);
    }
    expect((await overview(owner.browser)).players).toHaveLength(1);
    expect((await friend.browser.request('GET', `/api/weeks/${weekStart}`)).status).toBe(200);
    expect((await client.query('select * from turnip_private.weeks')).rows).toHaveLength(1);
  });

  it('deletes an empty group, makes repeated leaves safe, and invalidates its code without deleting player data', async () => {
    const owner = await player();
    const friend = await player();
    const group = await create(owner.browser);
    await join(friend.browser, group);
    await save(owner.browser);
    expect(
      (await owner.browser.request('DELETE', `/api/groups/${group.id}/membership`)).status,
    ).toBe(200);
    expect((await detail(friend.browser, group)).group.memberCount).toBe(1);
    expect(
      (await friend.browser.request('DELETE', `/api/groups/${group.id}/membership`)).status,
    ).toBe(200);
    expect(
      (await friend.browser.request('DELETE', `/api/groups/${group.id}/membership`)).status,
    ).toBe(200);
    expect((await client.query('select * from turnip_private.groups')).rows).toHaveLength(0);
    expect((await client.query('select * from turnip_private.memberships')).rows).toHaveLength(0);
    await expectError(
      await owner.browser.request('POST', '/api/groups/join', { code: group.code }),
      404,
    );
    expect((await client.query('select * from turnip_private.players')).rows).toHaveLength(2);
    expect((await client.query('select * from turnip_private.weeks')).rows).toHaveLength(1);
  });

  it('serializes concurrent admission so only one player can take the last place', async () => {
    const participants = await Promise.all(
      Array.from({ length: GROUP_CAPACITY + 1 }, () => player()),
    );
    const group = await create(participants[0]!.browser);
    for (const participant of participants.slice(1, GROUP_CAPACITY - 1))
      await join(participant.browser, group);
    const responses = await Promise.all(
      participants
        .slice(GROUP_CAPACITY - 1)
        .map(({ browser }) => browser.request('POST', '/api/groups/join', { code: group.code })),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      (
        await expectError(
          responses.find((response) => response.status === 409)!,
          409,
        )
      ).error.code,
    ).toBe('GROUP_FULL');
    expect((await detail(participants[0]!.browser, group)).members).toHaveLength(GROUP_CAPACITY);
    expect((await join(participants[0]!.browser, group)).memberCount).toBe(GROUP_CAPACITY);
  });

  it('serializes the final departure against admission without producing an orphan group', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const owner = await player();
      const friend = await player();
      const group = await create(owner.browser);
      const [left, joined] = await Promise.all([
        owner.browser.request('DELETE', `/api/groups/${group.id}/membership`),
        friend.browser.request('POST', '/api/groups/join', { code: group.code }),
      ]);
      expect(left.status).toBe(200);
      expect([200, 404]).toContain(joined.status);
      if (joined.status === 200) {
        const result = await detail(friend.browser, group);
        expect(result.members.map((entry) => entry.player.id)).toEqual([friend.session.player.id]);
      } else {
        expect(
          (await client.query('select * from turnip_private.groups where id = $1', [group.id]))
            .rows,
        ).toHaveLength(0);
      }
    }
    expect(
      (
        await client.query(
          'select g.id from turnip_private.groups g where not exists (select 1 from turnip_private.memberships m where m.group_id = g.id)',
        )
      ).rows,
    ).toHaveLength(0);
  });

  it('has no product limit on group count and allows every member to share and leave', async () => {
    const owner = await player();
    const friend = await player();
    for (let index = 0; index < GROUP_CAPACITY + 2; index += 1) {
      const group = await create(owner.browser, `Group ${index + 1}`);
      expect((await join(friend.browser, group)).code).toBe(group.code);
    }
    const data = await overview(friend.browser);
    expect(data.groups).toHaveLength(GROUP_CAPACITY + 2);
    expect(data.players).toHaveLength(2);
  });

  it('protects mutations from other origins and prevents cross-tab identity confusion on every group route', async () => {
    const owner = await player();
    const other = await player();
    const group = await create(owner.browser);
    for (const [method, path, body] of [
      ['POST', '/api/groups', { name: 'Bad' }],
      ['POST', '/api/groups/join', { code: group.code }],
      ['DELETE', `/api/groups/${group.id}/membership`, undefined],
    ] as const) {
      await expectError(
        await owner.browser.request(method, path, body, { origin: 'https://elsewhere.test' }),
        403,
      );
    }
    for (const [method, path, body] of [
      ['GET', `/api/groups?weekStart=${weekStart}`, undefined],
      ['GET', `/api/groups/${group.id}?weekStart=${weekStart}`, undefined],
      ['GET', memberWeek(owner.session.player.id), undefined],
      ['GET', memberHistory(owner.session.player.id), undefined],
      ['POST', '/api/groups', { name: 'Bad' }],
      ['POST', '/api/groups/join', { code: group.code }],
      ['DELETE', `/api/groups/${group.id}/membership`, undefined],
    ] as const) {
      const result = await expectError(
        await owner.browser.request(method, path, body, { playerId: other.session.player.id }),
        409,
      );
      expect(result.error.code).toBe('PLAYER_CHANGED');
      await expectError(await new Browser(app).request(method, path, body), 401);
    }
    expect((await detail(owner.browser, group)).group.memberCount).toBe(1);
  });

  it('validates names, codes, ids, dates and limits before changing memberships', async () => {
    const owner = await player();
    for (const body of [
      { name: '' },
      { name: ' ' },
      { name: 'x'.repeat(61) },
      { name: 'Okay', owner: true },
    ]) {
      await expectError(await owner.browser.request('POST', '/api/groups', body), 400);
    }
    for (const code of ['', 'SW-1234-5678-9012', 'x'.repeat(41)]) {
      await expectError(await owner.browser.request('POST', '/api/groups/join', { code }), 400);
    }
    await expectError(
      await owner.browser.request('POST', '/api/groups/join', {
        code: owner.session.player.friendCode,
      }),
      404,
    );
    for (const path of [
      '/api/groups',
      '/api/groups?weekStart=2026-10-05',
      '/api/groups/nope?weekStart=2026-10-04',
      `${memberHistory(owner.session.player.id)}?limit=0`,
      `${memberHistory(owner.session.player.id)}?before=2026-02-31`,
      '/api/players/nope/weeks',
    ]) {
      await expectError(await owner.browser.request('GET', path), 400);
    }
    expect((await client.query('select * from turnip_private.groups')).rows).toHaveLength(0);
  });

  it('rejects revoked devices even when they retain a valid public group code', async () => {
    const owner = await player();
    const group = await create(owner.browser);
    const oldTab = new Browser(app);
    oldTab.cookies.set(sessionCookie, owner.browser.cookies.get(sessionCookie)!);
    expect(
      (await owner.browser.request('DELETE', `/api/devices/${owner.session.deviceId}`)).status,
    ).toBe(200);
    await expectError(await oldTab.request('POST', '/api/groups/join', { code: group.code }), 401);
    await expectError(
      await oldTab.request('GET', `/api/groups/${group.id}?weekStart=${weekStart}`),
      401,
    );
  });

  it("never shares a player's trades on any shared read", async () => {
    const owner = await player();
    const friend = await player();
    const group = await create(owner.browser);
    await join(friend.browser, group);
    const tradeIds: string[] = [];
    for (const date of [weekStart, '2026-09-27']) {
      const id = randomUUID();
      tradeIds.push(id);
      const input: WeekMutation = {
        mutationId: randomUUID(),
        baseRevision: 0,
        purchasePrice: 100,
        firstBuy: false,
        previousPattern: null,
        prices: [91, ...Array<number | null>(11).fill(null)],
        trades: [{ id, kind: 'buy', quantity: 1000, price: 100 }],
      };
      expect((await friend.browser.request('PUT', `/api/weeks/${date}`, input)).status).toBe(200);
    }
    const own = await friend.browser.request('GET', `/api/weeks/${weekStart}`);
    expect(await own.json()).toMatchObject({ week: { trades: [{ id: tradeIds[0] }] } });

    for (const [viewer, path] of [
      [owner, `/api/groups?weekStart=${weekStart}`],
      [owner, `/api/groups/${group.id}?weekStart=${weekStart}`],
      [owner, memberWeek(friend.session.player.id)],
      [owner, memberHistory(friend.session.player.id)],
      // Viewing yourself as friends do is a shared read too.
      [friend, memberWeek(friend.session.player.id)],
    ] as const) {
      const response = await viewer.browser.request('GET', path);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('"purchasePrice":100');
      expect(text).not.toContain('trades');
      for (const id of tradeIds) expect(text).not.toContain(id);
    }
  });
});
