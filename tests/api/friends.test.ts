import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { GROUP_CAPACITY } from '../../src/server/groups';
import { FRIEND_INVITE_DAYS, FRIEND_INVITE_LIMIT, FRIEND_LIMIT } from '../../src/server/friends';
import type { SessionResponse } from '../../src/shared/api';
import type {
  FriendInvitePreview,
  FriendResult,
  GroupsResponse,
  GroupSummary,
} from '../../src/shared/groups';
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
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const inviteCode = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => ALPHABET[byte & 31]).join('');
  async function share(from: Player): Promise<string> {
    const code = inviteCode();
    const response = await from.browser.request('POST', '/api/friends/invites', { code });
    expect(response.status).toBe(201);
    return code;
  }
  const acceptLink = (to: Player, code: string) =>
    to.browser.request('POST', '/api/friends/invites/accept', { code });
  const preview = (code: string) =>
    new Browser(app).request('GET', `/api/friends/invites/preview?code=${code}`);
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

  describe('shared friend links', () => {
    it('makes friends both ways in one tap, then stops working', async () => {
      const rosa = await player('Rosa');
      const mika = await player('Mika');
      const jun = await player();
      const code = inviteCode();
      const created = await rosa.browser.request('POST', '/api/friends/invites', { code });
      expect(created.status).toBe(201);
      const { expiresAt } = (await created.json()) as { expiresAt: string };
      const days = (Date.parse(expiresAt) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(FRIEND_INVITE_DAYS - 0.01);
      expect(days).toBeLessThan(FRIEND_INVITE_DAYS + 0.01);

      // A visitor without a profile sees whose link it is, and nothing more.
      const shown = await preview(code.toLowerCase());
      expect(shown.status).toBe(200);
      expect(await shown.json()).toEqual({
        player: { id: rosa.id, displayName: 'Rosa' },
        expiresAt,
      } satisfies FriendInvitePreview);

      const accepted = await acceptLink(mika, code);
      expect(accepted.status).toBe(200);
      expect(((await accepted.json()) as { friend: FriendResult }).friend).toEqual({
        player: rosa.session.player,
        status: 'friends',
      });
      expect((await overview(rosa)).friendIds).toEqual([mika.id]);
      expect((await overview(mika)).friendIds).toEqual([rosa.id]);
      expect((await mika.browser.request('GET', weekOf(rosa))).status).toBe(200);

      const used = await expectError(await acceptLink(jun, code), 404);
      expect(used.error.code).toBe('FRIEND_LINK_UNAVAILABLE');
      await expectError(await preview(code), 404);
      expect((await overview(jun)).friendIds).toEqual([]);
    });

    it('keeps only the code’s hash', async () => {
      const rosa = await player();
      const code = await share(rosa);
      const rows = await client.query('select * from turnip_private.friend_invites');
      expect(rows.rows).toEqual([
        expect.objectContaining({
          player_id: rosa.id,
          code_hash: createHash('sha256').update(code).digest('hex'),
        }),
      ]);
      expect(JSON.stringify(rows.rows)).not.toContain(code);
    });

    it('turns down your own link and leaves it for a friend', async () => {
      const rosa = await player();
      const mika = await player();
      const code = await share(rosa);
      const own = await expectError(await acceptLink(rosa, code), 400);
      expect(own.error.code).toBe('OWN_FRIEND_LINK');
      expect((await acceptLink(mika, code)).status).toBe(200);
    });

    it('leaves the link unused for someone who is already a friend', async () => {
      const rosa = await player();
      const mika = await player();
      const jun = await player();
      await befriend(rosa, mika);
      const code = await share(rosa);
      expect((await acceptLink(mika, code)).status).toBe(200);
      expect((await acceptLink(jun, code)).status).toBe(200);
      expect((await overview(rosa)).friendIds.sort()).toEqual([mika.id, jun.id].sort());
    });

    it('settles a waiting request in either direction', async () => {
      const rosa = await player();
      const mika = await player();
      const jun = await player();
      await add(mika, rosa.code);
      await add(rosa, jun.code);
      expect((await acceptLink(mika, await share(rosa))).status).toBe(200);
      expect((await acceptLink(jun, await share(rosa))).status).toBe(200);
      const data = await overview(rosa);
      expect(data.friendIds.sort()).toEqual([mika.id, jun.id].sort());
      expect(data.requests).toEqual({ received: [], sent: [] });
    });

    it('stops working after its days are up', async () => {
      const rosa = await player();
      const mika = await player();
      const code = await share(rosa);
      await client.query(
        "update turnip_private.friend_invites set created_at = now() - interval '9 days', expires_at = now() - interval '1 second'",
      );
      await expectError(await preview(code), 404);
      await expectError(await acceptLink(mika, code), 404);
      // Sharing again clears links that have run out.
      await share(rosa);
      expect((await client.query('select * from turnip_private.friend_invites')).rows).toHaveLength(
        1,
      );
    });

    it(`keeps the newest ${FRIEND_INVITE_LIMIT} links usable`, async () => {
      const rosa = await player();
      const mika = await player();
      const codes: string[] = [];
      for (let index = 0; index <= FRIEND_INVITE_LIMIT; index += 1) codes.push(await share(rosa));
      await expectError(await preview(codes[0]!), 404);
      expect((await preview(codes[1]!)).status).toBe(200);
      expect((await acceptLink(mika, codes.at(-1)!)).status).toBe(200);
    });

    it('lets only one of two players use a link at the same time', async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const rosa = await player();
        const mika = await player();
        const jun = await player();
        const code = await share(rosa);
        const responses = await Promise.all([acceptLink(mika, code), acceptLink(jun, code)]);
        expect(responses.map((response) => response.status).sort()).toEqual([200, 404]);
        expect((await overview(rosa)).friendIds).toHaveLength(1);
      }
    });

    it('respects the sharer’s friend limit', async () => {
      const rosa = await player();
      const mika = await player();
      const code = await share(rosa);
      await client.query(
        `with others as (
          insert into turnip_private.players (display_name, friend_code)
          select 'Extra', 'FAKE-' || lpad(n::text, 4, '0') || '-BBBB' from generate_series(1, $2::int) n
          returning id
        )
        insert into turnip_private.friend_links (player_id, friend_id) select $1, id from others`,
        [rosa.id, FRIEND_LIMIT],
      );
      const full = await expectError(await acceptLink(mika, code), 409);
      expect(full.error.code).toBe('FRIEND_LIMIT');
      expect((await client.query('select * from turnip_private.friend_invites')).rows).toHaveLength(
        1,
      );
    });

    it('validates codes, and forgets links when their player is deleted', async () => {
      const rosa = await player();
      const mika = await player();
      for (const code of ['', 'ABCD', 'ABCD-EFGH-JKLM-NPQ1', 'x'.repeat(41)]) {
        await expectError(
          await rosa.browser.request('POST', '/api/friends/invites', { code }),
          400,
        );
        await expectError(await acceptLink(mika, code), 400);
      }
      await expectError(await preview('nope'), 404);
      const code = await share(rosa);
      const deleted = await rosa.browser.request('DELETE', '/api/profile', {
        playerId: rosa.id,
        confirm: 'delete',
      });
      expect(deleted.status).toBe(200);
      await expectError(await acceptLink(mika, code), 404);
      expect((await client.query('select * from turnip_private.friend_invites')).rows).toEqual([]);
    });

    it('protects creating and accepting links like every friend route', async () => {
      const rosa = await player();
      const mika = await player();
      const code = await share(mika);
      for (const [path, body] of [
        ['/api/friends/invites', { code: inviteCode() }],
        ['/api/friends/invites/accept', { code }],
      ] as const) {
        await expectError(
          await rosa.browser.request('POST', path, body, { origin: 'https://elsewhere.test' }),
          403,
        );
        await expectError(
          await rosa.browser.request('POST', path, body, { playerId: mika.id }),
          409,
        );
        await expectError(await new Browser(app).request('POST', path, body), 401);
      }
      expect((await overview(rosa)).friendIds).toEqual([]);
    });
  });

  describe('one code field for groups and friends', () => {
    const redeem = (from: Player, code: string) =>
      from.browser.request('POST', '/api/codes', { code });
    async function group(owner: Player) {
      const response = await owner.browser.request('POST', '/api/groups', { name: 'Crew' });
      return ((await response.json()) as { group: GroupSummary }).group;
    }

    it('joins a group from its invite code, typed loosely', async () => {
      const rosa = await player();
      const mika = await player();
      const crew = await group(rosa);
      const response = await redeem(mika, ` ${crew.code.toLowerCase().replaceAll('-', ' ')} `);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ group: { ...crew, memberCount: 2 } });
      expect((await overview(mika)).groups.map((entry) => entry.id)).toEqual([crew.id]);
    });

    it('asks a player to be friends from their friend code', async () => {
      const rosa = await player('Rosa');
      const mika = await player();
      const asked = await redeem(mika, rosa.code);
      expect(asked.status).toBe(200);
      expect(await asked.json()).toEqual({
        friend: { player: rosa.session.player, status: 'requested' },
      });
      const back = await redeem(rosa, mika.code.toLowerCase());
      expect(((await back.json()) as { friend: FriendResult }).friend.status).toBe('friends');
    });

    it('explains a code that is nobody’s, your own, malformed, or a full group', async () => {
      const rosa = await player();
      const missing = await expectError(await redeem(rosa, 'ZZZZ-ZZZZ-ZZZZ'), 404);
      expect(missing.error).toEqual({
        code: 'CODE_UNAVAILABLE',
        message: 'No group or player has this code. Check it and try again.',
      });
      const own = await expectError(await redeem(rosa, rosa.code), 400);
      expect(own.error.code).toBe('OWN_FRIEND_CODE');
      for (const code of ['', 'ABCD-EFGH', 'ABCD-EFGH-JKL!']) {
        const invalid = await expectError(await redeem(rosa, code), 400);
        expect(invalid.error.message).toBe('Enter a 12-character friend or group code.');
      }
      const crew = await group(rosa);
      await client.query(
        `with others as (
          insert into turnip_private.players (display_name, friend_code)
          select 'Extra', 'FAKE-' || lpad(n::text, 4, '0') || '-CCCC' from generate_series(1, $2::int) n
          returning id
        )
        insert into turnip_private.memberships (group_id, player_id) select $1, id from others`,
        [crew.id, GROUP_CAPACITY - 1],
      );
      const full = await expectError(await redeem(await player(), crew.code), 409);
      expect(full.error.code).toBe('GROUP_FULL');
    });

    it('protects the route like every other change', async () => {
      const rosa = await player();
      const mika = await player();
      await expectError(
        await rosa.browser.request(
          'POST',
          '/api/codes',
          { code: mika.code },
          { origin: 'https://elsewhere.test' },
        ),
        403,
      );
      await expectError(
        await rosa.browser.request(
          'POST',
          '/api/codes',
          { code: mika.code },
          { playerId: mika.id },
        ),
        409,
      );
      await expectError(
        await new Browser(app).request('POST', '/api/codes', { code: mika.code }),
        401,
      );
      expect((await client.query('select * from turnip_private.friend_links')).rows).toEqual([]);
    });
  });
});
