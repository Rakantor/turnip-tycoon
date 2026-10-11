import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { FRIEND_LIMIT } from '../../src/server/friends';
import type { SessionResponse } from '../../src/shared/api';
import type { FriendResult, GroupsResponse, GroupSummary } from '../../src/shared/groups';
import type { WeekMutation } from '../../src/shared/week';
import { createTestDatabase } from '../helpers/database';
import { Browser, expectError, sessionCookie } from './browser';

describe('Friends added by friend code', () => {
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

  async function player(name?: string) {
    const browser = new Browser(app);
    const response = await browser.request('POST', '/api/session', { deviceName: 'Phone' });
    expect(response.status).toBe(201);
    let session = (await response.json()) as SessionResponse;
    if (name) {
      const renamed = await browser.request('PATCH', '/api/profile', { displayName: name });
      session = { ...session, ...((await renamed.json()) as Pick<SessionResponse, 'player'>) };
    }
    return { browser, session, id: session.player.id, code: session.player.friendCode };
  }
  type Player = Awaited<ReturnType<typeof player>>;
  async function add(from: Player, code: string): Promise<FriendResult> {
    const response = await from.browser.request('POST', '/api/friends', { code });
    expect(response.status).toBe(200);
    return ((await response.json()) as { friend: FriendResult }).friend;
  }
  async function accept(from: Player, requester: Player): Promise<FriendResult> {
    const response = await from.browser.request('PUT', `/api/friends/${requester.id}`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { friend: FriendResult }).friend;
  }
  async function befriend(a: Player, b: Player) {
    await add(a, b.code);
    await accept(b, a);
  }
  async function remove(from: Player, other: Player) {
    const response = await from.browser.request('DELETE', `/api/friends/${other.id}`);
    expect(response.status).toBe(200);
  }
  async function overview(viewer: Player): Promise<GroupsResponse> {
    const response = await viewer.browser.request('GET', `/api/groups?weekStart=${weekStart}`);
    expect(response.status).toBe(200);
    return response.json() as Promise<GroupsResponse>;
  }
  async function save(owner: Player, date = weekStart) {
    const input: WeekMutation = {
      mutationId: randomUUID(),
      baseRevision: 0,
      purchasePrice: 100,
      firstBuy: false,
      previousPattern: null,
      prices: [91, 140, ...Array<number | null>(10).fill(null)],
      trades: [{ id: randomUUID(), kind: 'buy', quantity: 500, price: 100 }],
    };
    expect((await owner.browser.request('PUT', `/api/weeks/${date}`, input)).status).toBe(200);
  }
  const weekOf = (other: Player) => `/api/players/${other.id}/weeks/${weekStart}`;
  const historyOf = (other: Player) => `/api/players/${other.id}/weeks`;
  const shown = (data: GroupsResponse) => data.players.map((entry) => entry.player.id).sort();
  async function expectNoAccess(viewer: Player, other: Player) {
    for (const path of [weekOf(other), historyOf(other)]) {
      const result = await expectError(await viewer.browser.request('GET', path), 404);
      expect(result.error.code).toBe('PLAYER_UNAVAILABLE');
    }
  }

  it('sends a request that shares nothing until it is accepted', async () => {
    const rosa = await player('Rosa');
    const mika = await player('Mika');
    await save(mika);
    const sent = await add(rosa, `  ${mika.code.toLowerCase().replaceAll('-', ' ')} `);
    expect(sent).toEqual({ player: mika.session.player, status: 'requested' });
    // Sending again changes nothing.
    expect(await add(rosa, mika.code)).toEqual(sent);

    const asked = await overview(rosa);
    expect(asked).toMatchObject({ players: [], friendIds: [], requests: { received: [] } });
    expect(asked.requests.sent).toEqual([
      { player: mika.session.player, sentAt: expect.any(String) },
    ]);
    const waiting = await overview(mika);
    expect(waiting).toMatchObject({ players: [], friendIds: [], requests: { sent: [] } });
    expect(waiting.requests.received).toEqual([
      { player: rosa.session.player, sentAt: expect.any(String) },
    ]);
    await expectNoAccess(rosa, mika);
    await expectNoAccess(mika, rosa);
  });

  it('shares prices and history both ways once accepted, never trades', async () => {
    const rosa = await player('Rosa');
    const mika = await player('Mika');
    await save(mika);
    await save(mika, '2026-09-27');
    await add(rosa, mika.code);
    expect(await accept(mika, rosa)).toEqual({ player: rosa.session.player, status: 'friends' });

    for (const [viewer, other] of [
      [rosa, mika],
      [mika, rosa],
    ] as const) {
      const data = await overview(viewer);
      expect(data.friendIds).toEqual([other.id]);
      expect(data.requests).toEqual({ received: [], sent: [] });
      // Without a shared group, your own island still joins the comparison.
      expect(shown(data)).toEqual([rosa.id, mika.id].sort());
      expect(data.players.every((entry) => entry.groupIds.length === 0)).toBe(true);
    }
    const rosaView = await overview(rosa);
    expect(rosaView.players.find((entry) => entry.player.id === mika.id)!.week).toMatchObject({
      purchasePrice: 100,
      prices: [91, 140, ...Array<null>(10).fill(null)],
    });
    for (const path of [weekOf(mika), historyOf(mika), `/api/groups?weekStart=${weekStart}`]) {
      const response = await rosa.browser.request('GET', path);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('"purchasePrice":100');
      expect(text).not.toContain('trades');
    }
    expect((await mika.browser.request('GET', weekOf(rosa))).status).toBe(200);
  });

  it('makes two players friends straight away when both enter the other’s code', async () => {
    const rosa = await player();
    const mika = await player();
    expect((await add(rosa, mika.code)).status).toBe('requested');
    expect((await add(mika, rosa.code)).status).toBe('friends');
    expect((await overview(rosa)).friendIds).toEqual([mika.id]);
    expect((await add(rosa, mika.code)).status).toBe('friends');
  });

  it('lets either player end the link: declining, withdrawing and removing', async () => {
    const rosa = await player();
    const mika = await player();
    const jun = await player();

    await add(rosa, mika.code);
    await remove(mika, rosa);
    expect((await overview(rosa)).requests.sent).toEqual([]);
    expect((await overview(mika)).requests.received).toEqual([]);

    await add(rosa, jun.code);
    await remove(rosa, jun);
    expect((await overview(jun)).requests.received).toEqual([]);
    const late = await expectError(
      await jun.browser.request('PUT', `/api/friends/${rosa.id}`),
      404,
    );
    expect(late.error.code).toBe('REQUEST_UNAVAILABLE');

    await befriend(rosa, mika);
    await remove(mika, rosa);
    await expectNoAccess(rosa, mika);
    await expectNoAccess(mika, rosa);
    expect(await overview(rosa)).toMatchObject({ players: [], friendIds: [] });
    // Removing again, or someone you never knew, is safe.
    await remove(mika, rosa);
    await remove(mika, jun);
    expect((await client.query('select * from turnip_private.friend_links')).rows).toEqual([]);
  });

  it('keeps sharing through a group after unfriending, and through a friendship after leaving', async () => {
    const rosa = await player();
    const mika = await player();
    const created = await rosa.browser.request('POST', '/api/groups', { name: 'Crew' });
    const { group } = (await created.json()) as { group: GroupSummary };
    expect(
      (await mika.browser.request('POST', '/api/groups/join', { code: group.code })).status,
    ).toBe(200);
    await befriend(rosa, mika);
    const both = await overview(rosa);
    expect(both.friendIds).toEqual([mika.id]);
    expect(shown(both)).toEqual([rosa.id, mika.id].sort());
    expect(both.players.every((entry) => entry.groupIds[0] === group.id)).toBe(true);

    expect(
      (await mika.browser.request('DELETE', `/api/groups/${group.id}/membership`)).status,
    ).toBe(200);
    expect((await rosa.browser.request('GET', weekOf(mika))).status).toBe(200);
    const friendsOnly = await overview(rosa);
    expect(friendsOnly.players.find((entry) => entry.player.id === mika.id)!.groupIds).toEqual([]);

    expect(
      (await mika.browser.request('POST', '/api/groups/join', { code: group.code })).status,
    ).toBe(200);
    await remove(rosa, mika);
    expect((await rosa.browser.request('GET', weekOf(mika))).status).toBe(200);
    expect(await overview(rosa)).toMatchObject({ friendIds: [] });
  });

  it('validates codes and ids, and rejects your own code or one nobody has', async () => {
    const rosa = await player();
    for (const code of ['', 'ABCD-EFGH', 'x'.repeat(41), 'ABCD-EFGH-JKL!']) {
      await expectError(await rosa.browser.request('POST', '/api/friends', { code }), 400);
    }
    await expectError(
      await rosa.browser.request('POST', '/api/friends', { code: rosa.code, extra: true }),
      400,
    );
    const own = await expectError(
      await rosa.browser.request('POST', '/api/friends', { code: rosa.code }),
      400,
    );
    expect(own.error.code).toBe('OWN_FRIEND_CODE');
    const missing = await expectError(
      await rosa.browser.request('POST', '/api/friends', { code: 'ZZZZ-ZZZZ-ZZZZ' }),
      404,
    );
    expect(missing.error.code).toBe('FRIEND_CODE_UNAVAILABLE');
    for (const [method, path] of [
      ['PUT', '/api/friends/nope'],
      ['DELETE', '/api/friends/nope'],
    ] as const) {
      await expectError(await rosa.browser.request(method, path), 400);
    }
    await expectError(await rosa.browser.request('PUT', `/api/friends/${randomUUID()}`), 404);
    await expectError(await rosa.browser.request('PUT', `/api/friends/${rosa.id}`), 404);
    expect((await client.query('select * from turnip_private.friend_links')).rows).toEqual([]);
  });

  it('reads an O as 0 and an I as 1 in older codes, which have no letters past F', async () => {
    const rosa = await player();
    const elder = randomUUID();
    await client.query(
      "insert into turnip_private.players (id, display_name, friend_code) values ($1, 'Elder', 'A0B1-C10D-00EF')",
      [elder],
    );
    const result = await add(rosa, 'aobi-cioD-ooef');
    expect(result).toMatchObject({ player: { id: elder }, status: 'requested' });
  });

  it(`limits friends and waiting requests to ${FRIEND_LIMIT} together`, async () => {
    const rosa = await player();
    const asker = await player();
    const mika = await player();
    await add(asker, rosa.code);
    await client.query(
      `with others as (
        insert into turnip_private.players (display_name, friend_code)
        select 'Extra', 'FAKE-' || lpad(n::text, 4, '0') || '-AAAA' from generate_series(1, $2::int) n
        returning id
      )
      insert into turnip_private.friend_links (player_id, friend_id) select $1, id from others`,
      [rosa.id, FRIEND_LIMIT],
    );
    const full = await expectError(
      await rosa.browser.request('POST', '/api/friends', { code: mika.code }),
      409,
    );
    expect(full.error.code).toBe('FRIEND_LIMIT');
    await expectError(await rosa.browser.request('PUT', `/api/friends/${asker.id}`), 409);
    // Others can still ask, and what already exists still works.
    expect((await add(mika, rosa.code)).status).toBe('requested');
    expect((await add(rosa, 'FAKE-0001-AAAA')).status).toBe('requested');
    expect((await overview(rosa)).requests.received).toHaveLength(2);
  });

  it('settles simultaneous requests both ways without a deadlock', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const rosa = await player();
      const mika = await player();
      const responses = await Promise.all([
        rosa.browser.request('POST', '/api/friends', { code: mika.code }),
        mika.browser.request('POST', '/api/friends', { code: rosa.code }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect((await overview(rosa)).friendIds).toEqual([mika.id]);
      expect((await overview(mika)).friendIds).toEqual([rosa.id]);
    }
  });

  it('serializes removal against a friend’s shared reads', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const rosa = await player();
      const mika = await player();
      await save(mika);
      await befriend(rosa, mika);
      const [read, removed] = await Promise.all([
        rosa.browser.request('GET', weekOf(mika)),
        mika.browser.request('DELETE', `/api/friends/${rosa.id}`),
      ]);
      expect([200, 404]).toContain(read.status);
      expect(removed.status).toBe(200);
      await expectNoAccess(rosa, mika);
    }
  });

  it('removes links both ways when a profile is deleted', async () => {
    const rosa = await player();
    const mika = await player();
    const jun = await player();
    await befriend(rosa, mika);
    await add(jun, rosa.code);
    await add(rosa, (await player()).code);
    const deleted = await rosa.browser.request('DELETE', '/api/profile', {
      playerId: rosa.id,
      confirm: 'delete',
    });
    expect(deleted.status).toBe(200);
    expect(await overview(mika)).toMatchObject({ players: [], friendIds: [] });
    expect((await overview(jun)).requests.sent).toEqual([]);
    expect((await client.query('select * from turnip_private.friend_links')).rows).toEqual([]);
  });

  it('protects every friend route from other origins, other tabs’ players and removed devices', async () => {
    const rosa = await player();
    const mika = await player();
    const routes = [
      ['POST', '/api/friends', { code: mika.code }],
      ['PUT', `/api/friends/${mika.id}`, undefined],
      ['DELETE', `/api/friends/${mika.id}`, undefined],
    ] as const;
    for (const [method, path, body] of routes) {
      await expectError(
        await rosa.browser.request(method, path, body, { origin: 'https://elsewhere.test' }),
        403,
      );
      const changed = await expectError(
        await rosa.browser.request(method, path, body, { playerId: mika.id }),
        409,
      );
      expect(changed.error.code).toBe('PLAYER_CHANGED');
      await expectError(await new Browser(app).request(method, path, body), 401);
    }
    const oldTab = new Browser(app);
    oldTab.cookies.set(sessionCookie, rosa.browser.cookies.get(sessionCookie)!);
    expect(
      (await rosa.browser.request('DELETE', `/api/devices/${rosa.session.deviceId}`)).status,
    ).toBe(200);
    await expectError(await oldTab.request('POST', '/api/friends', { code: mika.code }), 401);
    expect((await client.query('select * from turnip_private.friend_links')).rows).toEqual([]);
  });
});
