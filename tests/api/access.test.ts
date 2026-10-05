import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import {
  defaultDisplayName,
  type AccessResponse,
  type Device,
  type PairingResponse,
  type SessionResponse,
} from '../../src/shared/api';
import { createTestDatabase } from '../helpers/database';
import { Browser, createPlayer, expectError, pairingCookie, sessionCookie } from './browser';

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function normalized(code: string) {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

describe('Account-free player access over the API', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let app: ReturnType<typeof createApp>;

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

  async function startPairing(browser: Browser, deviceName = 'Living room laptop') {
    const response = await browser.request('POST', '/api/pairing', { deviceName });
    expect(response.status).toBe(201);
    return response.json() as Promise<PairingResponse>;
  }

  async function pair(owner: Browser, browser: Browser, deviceName = 'Living room laptop') {
    const challenge = await startPairing(browser, deviceName);
    expect(
      (await owner.request('POST', '/api/pairing/approve', { code: challenge.code })).status,
    ).toBe(200);
    const response = await browser.request('POST', '/api/pairing/complete', {});
    expect(response.status).toBe(200);
    return response.json() as Promise<SessionResponse>;
  }

  async function devices(browser: Browser) {
    const response = await browser.request('GET', '/api/devices');
    expect(response.status).toBe(200);
    return ((await response.json()) as { devices: Device[] }).devices;
  }

  it('checks the database through the health endpoint', async () => {
    const response = await new Browser(app).request('GET', '/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('silently creates a generated identity without a recovery code and reuses its secure cookie', async () => {
    const browser = new Browser(app);
    const response = await browser.request('POST', '/api/session', {
      deviceName: '  My phone  ',
    });
    expect(response.status).toBe(201);
    const access = (await response.json()) as SessionResponse;
    expect(access.player).toEqual({
      id: expect.any(String),
      displayName: defaultDisplayName(access.player.friendCode),
      islandName: null,
      friendCode: expect.stringMatching(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
    });
    expect(access.hasRecoveryCode).toBe(false);
    expect(access).not.toHaveProperty('recoveryCode');
    expect((await client.query('select * from turnip_private.recovery_credentials')).rows).toEqual(
      [],
    );
    expect(browser.cookies.get(sessionCookie)).toBeTruthy();
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${sessionCookie}=`));
    expect(cookie).toMatch(/; HttpOnly(?:;|$)/i);
    expect(cookie).toMatch(/; Secure(?:;|$)/i);
    expect(cookie).toMatch(/; SameSite=Strict(?:;|$)/i);
    expect(cookie).toMatch(/; Path=\/(?:;|$)/i);
    expect(cookie).not.toMatch(/; Domain=/i);
    const session = await browser.request('GET', '/api/session');
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual(access);
    for (const path of ['/api/session', '/api/players']) {
      const repeated = await browser.request('POST', path, { deviceName: 'Same browser' });
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toEqual(access);
    }
    expect((await client.query('select * from turnip_private.players')).rows).toHaveLength(1);
    expect(session.headers.get('Cache-Control')).toContain('no-store');
    expect(await devices(browser)).toEqual([
      {
        id: access.deviceId,
        name: 'My phone',
        current: true,
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      },
    ]);
  });

  it('requires an authenticated device for private routes', async () => {
    const browser = new Browser(app);
    for (const [method, path, body] of [
      ['GET', '/api/session', undefined],
      ['GET', '/api/devices', undefined],
      ['PATCH', '/api/profile', { displayName: 'Intruder' }],
      ['DELETE', `/api/devices/${randomUUID()}`, undefined],
      ['POST', '/api/pairing/approve', { code: 'AAAA-AAAA-AAAA-AAAA' }],
      ['POST', '/api/recovery/rotate', {}],
    ] as const) {
      await expectError(await browser.request(method, path, body), 401);
    }
    browser.cookies.set(sessionCookie, 'f'.repeat(64));
    await expectError(await browser.request('GET', '/api/session'), 401);
  });

  it('starts a profile with the name chosen in the welcome dialog', async () => {
    const browser = new Browser(app);
    const named = await browser.request('POST', '/api/session', {
      deviceName: 'Phone',
      displayName: '  Rosalind  ',
    });
    expect(named.status).toBe(201);
    expect(((await named.json()) as SessionResponse).player.displayName).toBe('Rosalind');
    for (const displayName of [' ', 'x'.repeat(11)])
      await expectError(
        await new Browser(app).request('POST', '/api/session', {
          deviceName: 'Phone',
          displayName,
        }),
        400,
      );
  });

  it('creates recovery only on request and keeps the public friend code immutable', async () => {
    const browser = new Browser(app);
    const started = await browser.request('POST', '/api/session', { deviceName: 'Phone' });
    const session = (await started.json()) as SessionResponse;
    const renamed = await browser.request('PATCH', '/api/profile', { displayName: '  Maple  ' });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual({ player: { ...session.player, displayName: 'Maple' } });
    await expectError(
      await browser.request('PATCH', '/api/profile', {
        displayName: 'Maple',
        friendCode: 'ABCD-EFGH-JKLM',
      }),
      400,
    );
    await expectError(
      await browser.request('PATCH', '/api/profile', { displayName: 'x'.repeat(11) }),
      400,
    );
    const reset = await browser.request('PATCH', '/api/profile', { displayName: ' ' });
    expect(await reset.json()).toEqual({ player: session.player });
    expect(session.player.displayName).toBe(session.player.friendCode.slice(0, 4));
    const generated = await browser.request('POST', '/api/recovery/rotate', {});
    expect(generated.status).toBe(200);
    const recovery = (await generated.json()) as { recoveryCode: string };
    expect(normalized(recovery.recoveryCode)).toMatch(/^[A-HJ-NP-Z2-9]{32}$/);
    expect(await (await browser.request('GET', '/api/session')).json()).toEqual({
      ...session,
      hasRecoveryCode: true,
    });
    expect(
      (await client.query('select * from turnip_private.recovery_credentials')).rows,
    ).toHaveLength(1);
    const outsider = new Browser(app);
    await expectError(
      await outsider.request('POST', '/api/recovery', {
        code: session.player.friendCode,
        deviceName: 'Attempt',
      }),
      400,
    );
  });

  it('replaces an invalid browser session without deleting the previous player', async () => {
    const browser = new Browser(app);
    const original = await createPlayer(browser);
    expect((await browser.request('DELETE', `/api/devices/${original.deviceId}`)).status).toBe(200);
    browser.cookies.set(sessionCookie, 'f'.repeat(64));
    const response = await browser.request('POST', '/api/session', { deviceName: 'Fresh browser' });
    expect(response.status).toBe(201);
    const fresh = (await response.json()) as SessionResponse;
    expect(fresh.player.id).not.toBe(original.player.id);
    expect(fresh.player.friendCode).not.toBe(original.player.friendCode);
    expect(fresh.hasRecoveryCode).toBe(false);
    expect((await client.query('select * from turnip_private.players')).rows).toHaveLength(2);
  });

  it('lets a newly initialized browser switch via pairing or recovery without merging identities', async () => {
    for (const method of ['pairing', 'recovery']) {
      const owner = new Browser(app);
      const newcomer = new Browser(app);
      const existing = await createPlayer(owner, 'Existing');
      const initial = await newcomer.request('POST', '/api/session', { deviceName: 'New phone' });
      const temporary = (await initial.json()) as SessionResponse;
      const linked =
        method === 'pairing'
          ? await pair(owner, newcomer)
          : ((await (
              await newcomer.request('POST', '/api/recovery', {
                code: existing.recoveryCode,
                deviceName: 'Recovered phone',
              })
            ).json()) as SessionResponse);
      expect(linked.player).toEqual(existing.player);
      expect(linked.hasRecoveryCode).toBe(true);
      const retained = await client.query(
        'select display_name from turnip_private.players where id = $1',
        [temporary.player.id],
      );
      expect(retained.rows).toEqual([
        { display_name: defaultDisplayName(temporary.player.friendCode) },
      ]);
      expect(
        ((await (await newcomer.request('GET', '/api/session')).json()) as SessionResponse).player
          .id,
      ).toBe(existing.player.id);
    }
  });

  it('rejects cross-origin and missing-origin mutations without changing the profile', async () => {
    const browser = new Browser(app);
    const access = await createPlayer(browser);
    for (const origin of [
      'https://attacker.test',
      'https://turnip.test.attacker.test',
      'null',
      null,
    ]) {
      await expectError(
        await browser.request('PATCH', '/api/profile', { displayName: 'Changed' }, { origin }),
        403,
      );
      await expectError(
        await browser.request(
          'POST',
          '/api/players',
          { displayName: 'New', deviceName: 'Phone' },
          { origin },
        ),
        403,
      );
    }
    const session = await browser.request('GET', '/api/session');
    expect(((await session.json()) as SessionResponse).player).toEqual(access.player);
    const players = await client.query('select count(*)::int as count from turnip_private.players');
    expect(players.rows[0].count).toBe(1);
  });

  it('rejects malformed, oversized, non-JSON, and unexpected input', async () => {
    const browser = new Browser(app);
    const valid = { deviceName: 'Phone' };
    for (const input of [
      {},
      { ...valid, displayName: ' ' },
      { ...valid, displayName: 'x'.repeat(41) },
      { ...valid, deviceName: '' },
      { ...valid, deviceName: 'x'.repeat(61) },
      { ...valid, islandName: 'x'.repeat(41) },
      { ...valid, friendCode: '123' },
      { ...valid, playerId: randomUUID() },
      { ...valid, displayName: 42 },
      null,
      [],
    ]) {
      await expectError(await browser.request('POST', '/api/players', input), 400);
    }
    await expectError(
      await browser.request('POST', '/api/players', undefined, { rawBody: '{' }),
      400,
    );
    await expectError(
      await browser.request('POST', '/api/players', valid, { contentType: 'text/plain' }),
      415,
    );
    await expectError(
      await browser.request('POST', '/api/players', valid, { contentType: null }),
      415,
    );
    await expectError(
      await browser.request('POST', '/api/players', { ...valid, displayName: 'x'.repeat(20_000) }),
      413,
    );
    const players = await client.query('select count(*)::int as count from turnip_private.players');
    expect(players.rows[0].count).toBe(0);
  });

  it('keeps another player isolated when editing profiles and revoking devices', async () => {
    const maple = new Browser(app);
    const cherry = new Browser(app);
    const mapleAccess = await createPlayer(maple, 'Maple');
    const cherryAccess = await createPlayer(cherry, 'Cherry');
    expect(mapleAccess.player.id).not.toBe(cherryAccess.player.id);
    await expectError(
      await maple.request('PATCH', '/api/profile', {
        playerId: cherryAccess.player.id,
        displayName: 'Stolen',
      }),
      400,
    );
    await expectError(await maple.request('DELETE', `/api/devices/${cherryAccess.deviceId}`), 404);
    await expectError(await maple.request('DELETE', '/api/devices/not-a-uuid'), 400);
    const edit = await maple.request('PATCH', '/api/profile', {
      displayName: 'Maple Leaf',
    });
    expect(edit.status).toBe(200);
    expect(await edit.json()).toEqual({
      player: {
        id: mapleAccess.player.id,
        displayName: 'Maple Leaf',
        islandName: null,
        friendCode: mapleAccess.player.friendCode,
      },
    });
    const cherrySession = await cherry.request('GET', '/api/session');
    expect(cherrySession.status).toBe(200);
    expect(((await cherrySession.json()) as SessionResponse).player).toEqual(cherryAccess.player);
    expect((await devices(maple)).map((device) => device.id)).toEqual([mapleAccess.deviceId]);
    expect((await devices(cherry)).map((device) => device.id)).toEqual([cherryAccess.deviceId]);
  });

  it('links two browsers to the same identity only after explicit approval', async () => {
    const phone = new Browser(app);
    const laptop = new Browser(app);
    const access = await createPlayer(phone);
    const challenge = await startPairing(laptop);
    expect(normalized(challenge.code)).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
    expect(Date.parse(challenge.expiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(challenge.expiresAt)).toBeLessThanOrEqual(Date.now() + 11 * 60_000);
    expect(laptop.cookies.has(pairingCookie)).toBe(true);
    expect(laptop.cookies.has(sessionCookie)).toBe(false);
    await expectError(await laptop.request('GET', '/api/session'), 401);
    await expectError(await laptop.request('POST', '/api/pairing/complete', {}), 409);
    await expectError(
      await laptop.request('POST', '/api/pairing/approve', { code: challenge.code }),
      401,
    );
    expect(
      (await phone.request('POST', '/api/pairing/approve', { code: challenge.code.toLowerCase() }))
        .status,
    ).toBe(200);
    const completed = await laptop.request('POST', '/api/pairing/complete', {});
    expect(completed.status).toBe(200);
    const linked = (await completed.json()) as SessionResponse;
    expect(linked.player).toEqual(access.player);
    expect(linked.deviceId).not.toBe(access.deviceId);
    expect(laptop.cookies.has(pairingCookie)).toBe(false);
    const listed = await devices(phone);
    expect(listed).toHaveLength(2);
    expect(listed.find((device) => device.id === linked.deviceId)).toMatchObject({
      name: 'Living room laptop',
      current: false,
    });
    expect(listed.find((device) => device.id === access.deviceId)?.current).toBe(true);
    expect(
      (await laptop.request('PATCH', '/api/profile', { displayName: 'Maple Twin' })).status,
    ).toBe(200);
    const phoneSession = await phone.request('GET', '/api/session');
    expect(((await phoneSession.json()) as SessionResponse).player.displayName).toBe('Maple Twin');
  });

  it('requires the originating browser claim and prevents code-only completion', async () => {
    const phone = new Browser(app);
    const laptop = new Browser(app);
    const outsider = new Browser(app);
    await createPlayer(phone);
    const challenge = await startPairing(laptop);
    expect(
      (await phone.request('POST', '/api/pairing/approve', { code: challenge.code })).status,
    ).toBe(200);
    await expectError(await outsider.request('POST', '/api/pairing/complete', {}), 404);
    await expectError(
      await outsider.request('POST', '/api/pairing/complete', { code: challenge.code }),
      400,
    );
    outsider.cookies.set(pairingCookie, 'a'.repeat(64));
    await expectError(await outsider.request('POST', '/api/pairing/complete', {}), 404);
    expect((await laptop.request('POST', '/api/pairing/complete', {})).status).toBe(200);
  });

  it('does not let another player take over an already approved challenge', async () => {
    const maple = new Browser(app);
    const cherry = new Browser(app);
    const laptop = new Browser(app);
    const access = await createPlayer(maple, 'Maple');
    await createPlayer(cherry, 'Cherry');
    const challenge = await startPairing(laptop);
    expect(
      (await maple.request('POST', '/api/pairing/approve', { code: challenge.code })).status,
    ).toBe(200);
    await expectError(
      await cherry.request('POST', '/api/pairing/approve', { code: challenge.code }),
    );
    const complete = await laptop.request('POST', '/api/pairing/complete', {});
    expect(complete.status).toBe(200);
    expect(((await complete.json()) as SessionResponse).player.id).toBe(access.player.id);
  });

  it('expires pairing challenges and rejects subsequent approval and completion', async () => {
    const phone = new Browser(app);
    const laptop = new Browser(app);
    await createPlayer(phone);
    const challenge = await startPairing(laptop);
    await client.query(
      "update turnip_private.pairing_challenges set expires_at = now() - interval '1 second' where code_hash = $1",
      [hash(normalized(challenge.code))],
    );
    await expectError(
      await phone.request('POST', '/api/pairing/approve', { code: challenge.code }),
      404,
    );
    await expectError(await laptop.request('POST', '/api/pairing/complete', {}), 404);
    expect(await devices(phone)).toHaveLength(1);
  });

  it('consumes an approved pairing once even when completions race', async () => {
    const phone = new Browser(app);
    const first = new Browser(app);
    const second = new Browser(app);
    await createPlayer(phone);
    const challenge = await startPairing(first);
    const claim = first.cookies.get(pairingCookie)!;
    second.cookies.set(pairingCookie, claim);
    expect(
      (await phone.request('POST', '/api/pairing/approve', { code: challenge.code })).status,
    ).toBe(200);
    const responses = await Promise.all([
      first.request('POST', '/api/pairing/complete', {}),
      second.request('POST', '/api/pairing/complete', {}),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 404]);
    expect(await devices(phone)).toHaveLength(2);
    const replay = new Browser(app);
    replay.cookies.set(pairingCookie, claim);
    await expectError(await replay.request('POST', '/api/pairing/complete', {}), 404);
    await expectError(
      await phone.request('POST', '/api/pairing/approve', { code: challenge.code }),
      404,
    );
  });

  it('invalidates a pending approval when its approving device is revoked', async () => {
    const phone = new Browser(app);
    const trusted = new Browser(app);
    const waiting = new Browser(app);
    const access = await createPlayer(phone);
    await pair(phone, trusted, 'Trusted tablet');
    const challenge = await startPairing(waiting);
    expect(
      (await phone.request('POST', '/api/pairing/approve', { code: challenge.code })).status,
    ).toBe(200);
    expect((await trusted.request('DELETE', `/api/devices/${access.deviceId}`)).status).toBe(200);
    await expectError(await waiting.request('POST', '/api/pairing/complete', {}), 404);
    await expectError(await phone.request('GET', '/api/session'), 401);
    expect(await devices(trusted)).toHaveLength(1);
  });

  it('rejects completion if the approving device has expired', async () => {
    const phone = new Browser(app);
    const laptop = new Browser(app);
    const access = await createPlayer(phone);
    const challenge = await startPairing(laptop);
    expect(
      (await phone.request('POST', '/api/pairing/approve', { code: challenge.code })).status,
    ).toBe(200);
    await client.query(
      "update turnip_private.devices set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = $1",
      [access.deviceId],
    );
    await expectError(await laptop.request('POST', '/api/pairing/complete', {}), 404);
    await expectError(await phone.request('GET', '/api/session'), 401);
  });

  it('revokes only the selected device and prevents reuse of its former cookie', async () => {
    const phone = new Browser(app);
    const laptop = new Browser(app);
    const access = await createPlayer(phone);
    const linked = await pair(phone, laptop);
    const oldToken = laptop.cookies.get(sessionCookie)!;
    const response = await phone.request('DELETE', `/api/devices/${linked.deviceId}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    await expectError(await laptop.request('GET', '/api/session'), 401);
    laptop.cookies.set(sessionCookie, oldToken);
    await expectError(
      await laptop.request('PATCH', '/api/profile', { displayName: 'Revoked' }),
      401,
    );
    const active = await phone.request('GET', '/api/session');
    expect(((await active.json()) as SessionResponse).deviceId).toBe(access.deviceId);
    expect(await devices(phone)).toHaveLength(1);
  });

  it('rejects an in-flight profile edit queued behind revocation of its device', async () => {
    const phone = new Browser(app);
    const laptop = new Browser(app);
    const access = await createPlayer(phone);
    const linked = await pair(phone, laptop);
    const observer = new Client({ connectionString: database.url });
    await observer.connect();
    let transactionOpen = false;
    const pending: Promise<Response>[] = [];

    async function waitForBlockedRequests(count: number) {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const result = await observer.query(`
          select count(*)::int as count from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
        `);
        if (result.rows[0].count >= count) return;
        await delay(10);
      }
      throw new Error(`Expected ${count} requests to reach the database lock barrier.`);
    }

    try {
      await client.query('begin');
      transactionOpen = true;
      await client.query('select id from turnip_private.players where id = $1 for update', [
        access.player.id,
      ]);
      // Queue revocation first, then let the other request authenticate while
      // its device still exists. Both must wait on the same player-row barrier.
      pending.push(phone.request('DELETE', `/api/devices/${linked.deviceId}`));
      await waitForBlockedRequests(1);
      pending.push(laptop.request('PATCH', '/api/profile', { displayName: 'Too late' }));
      await waitForBlockedRequests(2);
      await client.query('commit');
      transactionOpen = false;

      const [revocation, edit] = await Promise.all(pending);
      expect(revocation!.status).toBe(200);
      await expectError(edit!, 401);
      const session = await phone.request('GET', '/api/session');
      expect(((await session.json()) as SessionResponse).player).toEqual(access.player);
      await expectError(await laptop.request('GET', '/api/session'), 401);
    } finally {
      if (transactionOpen) await client.query('rollback');
      await Promise.allSettled(pending);
      await observer.end();
    }
  });

  it('clears the browser cookie and removes server access on self-revocation and logout', async () => {
    for (const mode of ['self-revoke', 'logout']) {
      const browser = new Browser(app);
      const access = await createPlayer(browser);
      const savedToken = browser.cookies.get(sessionCookie)!;
      const response =
        mode === 'self-revoke'
          ? await browser.request('DELETE', `/api/devices/${access.deviceId}`)
          : await browser.request('POST', '/api/logout', {});
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(browser.cookies.has(sessionCookie)).toBe(false);
      browser.cookies.set(sessionCookie, savedToken);
      await expectError(await browser.request('GET', '/api/session'), 401);
      const record = await client.query('select id from turnip_private.devices where id = $1', [
        access.deviceId,
      ]);
      expect(record.rows).toHaveLength(0);
    }
  });

  it('restores the same player and rotates a recovery code so it cannot be reused', async () => {
    const original = new Browser(app);
    const recovered = new Browser(app);
    const access = await createPlayer(original);
    const response = await recovered.request('POST', '/api/recovery', {
      code: access.recoveryCode.toLowerCase().replaceAll('-', ' '),
      deviceName: 'Replacement phone',
    });
    expect(response.status).toBe(200);
    const recovery = (await response.json()) as AccessResponse;
    expect(recovery.player).toEqual(access.player);
    expect(recovery.deviceId).not.toBe(access.deviceId);
    expect(recovery.recoveryCode).not.toBe(access.recoveryCode);
    expect(normalized(recovery.recoveryCode)).toMatch(/^[A-HJ-NP-Z2-9]{32}$/);
    expect((await recovered.request('GET', '/api/session')).status).toBe(200);
    const replay = new Browser(app);
    await expectError(
      await replay.request('POST', '/api/recovery', {
        code: access.recoveryCode,
        deviceName: 'Replay',
      }),
      401,
    );
    const next = await replay.request('POST', '/api/recovery', {
      code: recovery.recoveryCode,
      deviceName: 'Another replacement',
    });
    expect(next.status).toBe(200);
    expect(((await next.json()) as AccessResponse).player.id).toBe(access.player.id);
  });

  it('lets exactly one browser redeem a recovery code under concurrent requests', async () => {
    const owner = new Browser(app);
    const access = await createPlayer(owner);
    const browsers = [new Browser(app), new Browser(app)];
    const responses = await Promise.all(
      browsers.map((browser, index) =>
        browser.request('POST', '/api/recovery', {
          code: access.recoveryCode,
          deviceName: `Recovery ${index}`,
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const winner = responses.findIndex((response) => response.status === 200);
    const recovered = (await responses[winner]!.json()) as AccessResponse;
    expect(recovered.player.id).toBe(access.player.id);
    expect((await browsers[winner]!.request('GET', '/api/session')).status).toBe(200);
    await expectError(await browsers[1 - winner]!.request('GET', '/api/session'), 401);
    const records = await client.query(
      'select id from turnip_private.devices where player_id = $1',
      [access.player.id],
    );
    expect(records.rows).toHaveLength(2);
  });

  it('allows an authenticated player to replace their recovery code', async () => {
    const owner = new Browser(app);
    const access = await createPlayer(owner);
    const response = await owner.request('POST', '/api/recovery/rotate', {});
    expect(response.status).toBe(200);
    const result = (await response.json()) as { recoveryCode: string };
    expect(Object.keys(result)).toEqual(['recoveryCode']);
    expect(result.recoveryCode).not.toBe(access.recoveryCode);
    const recovery = new Browser(app);
    await expectError(
      await recovery.request('POST', '/api/recovery', {
        code: access.recoveryCode,
        deviceName: 'Old code',
      }),
      401,
    );
    const restored = await recovery.request('POST', '/api/recovery', {
      code: result.recoveryCode,
      deviceName: 'New code',
    });
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as AccessResponse).player.id).toBe(access.player.id);
  });

  it('stores session, pairing, claim, and recovery credentials as hashes only', async () => {
    const owner = new Browser(app);
    const laptop = new Browser(app);
    const access = await createPlayer(owner);
    const challenge = await startPairing(laptop);
    const token = owner.cookies.get(sessionCookie)!;
    const claim = laptop.cookies.get(pairingCookie)!;
    const deviceRows = await client.query(
      'select * from turnip_private.devices where player_id = $1',
      [access.player.id],
    );
    const recoveryRows = await client.query(
      'select * from turnip_private.recovery_credentials where player_id = $1',
      [access.player.id],
    );
    const pairingRows = await client.query('select * from turnip_private.pairing_challenges');
    expect(deviceRows.rows[0].token_hash).toBe(hash(token));
    expect(recoveryRows.rows[0].code_hash).toBe(hash(normalized(access.recoveryCode)));
    expect(pairingRows.rows[0].code_hash).toBe(hash(normalized(challenge.code)));
    expect(pairingRows.rows[0].claim_hash).toBe(hash(claim));
    const stored = JSON.stringify([deviceRows.rows, recoveryRows.rows, pairingRows.rows]);
    for (const plaintext of [
      token,
      claim,
      access.recoveryCode,
      normalized(access.recoveryCode),
      challenge.code,
      normalized(challenge.code),
    ]) {
      expect(stored).not.toContain(plaintext);
    }
    const listed = JSON.stringify(await devices(owner));
    expect(listed).not.toContain(token);
    expect(listed).not.toContain(hash(token));
    expect(listed).not.toContain(access.recoveryCode);
  });
});
