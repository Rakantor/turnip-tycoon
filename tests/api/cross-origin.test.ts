import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import {
  defaultDisplayName,
  type AccessResponse,
  type PairingResponse,
  type SessionCredentialsResponse,
  type SessionResponse,
} from '../../src/shared/api';
import type { GroupSummary, SharedPlayerWeek } from '../../src/shared/groups';
import type { WeekMutation, WeekRecord } from '../../src/shared/week';
import { createTestDatabase } from '../helpers/database';
import { Browser, expectError, pairingCookie, sessionCookie } from './browser';

const frontendOrigin = 'https://rakantor.github.io';
const apiOrigin = 'https://turnip-api.workers.dev';
const options = { credentialMode: 'bearer' as const, frontendOrigin };

interface RequestOptions {
  token?: string;
  body?: unknown;
  headers?: HeadersInit;
}

function request(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  { token, body, headers }: RequestOptions = {},
) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('Origin')) requestHeaders.set('Origin', frontendOrigin);
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
  return app.request(`${apiOrigin}${path}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('Cross-origin request policy before database access', () => {
  const app = createApp('not-a-database-connection', options);

  it('answers approved preflights without a database or cookies', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await request(app, 'OPTIONS', '/api/session', {
        headers: {
          'Access-Control-Request-Method': method,
          'Access-Control-Request-Headers':
            'Authorization, Content-Type, X-Player-Id, X-Pairing-Token',
        },
      });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(frontendOrigin);
      expect(response.headers.get('Access-Control-Allow-Methods')?.split(', ')).toContain(method);
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
        'authorization, content-type, x-player-id, x-pairing-token',
      );
      expect(response.headers.get('Vary')?.split(', ')).toContain('Origin');
      expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false);
      expect(response.headers.has('Set-Cookie')).toBe(false);
    }
  });

  it('rejects untrusted origins on reads, writes, and preflights before opening the database', async () => {
    for (const origin of [
      'https://attacker.test',
      'https://rakantor.github.io.attacker.test',
      'https://rakantor.github.io/',
      `${frontendOrigin}, https://attacker.test`,
      'null',
      '',
    ]) {
      for (const method of ['GET', 'POST', 'OPTIONS']) {
        const response = await request(app, method, '/api/session', {
          headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
        });
        expect((await expectError(response, 403)).error.code).toBe('INVALID_ORIGIN');
        expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
        expect(response.headers.get('Vary')).toContain('Origin');
      }
    }
    for (const method of ['POST', 'DELETE', 'OPTIONS']) {
      const response = await app.request(`${apiOrigin}/api/session`, { method });
      expect((await expectError(response, 403)).error.code).toBe('INVALID_ORIGIN');
    }
  });

  it('rejects unsupported preflight methods and extra or malformed headers', async () => {
    const rejected: HeadersInit[] = [
      {},
      { 'Access-Control-Request-Method': 'TRACE' },
      { 'Access-Control-Request-Method': 'post' },
      { 'Access-Control-Request-Method': 'POST, DELETE' },
      { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'cookie' },
      {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, x-forwarded-host',
      },
      {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,',
      },
    ];
    for (const headers of rejected) {
      const response = await request(app, 'OPTIONS', '/api/session', { headers });
      expect((await expectError(response, 403)).error.code).toBe('INVALID_PREFLIGHT');
      expect(response.headers.has('Access-Control-Allow-Methods')).toBe(false);
    }
  });

  it('fails closed for missing or non-origin frontend configuration', () => {
    for (const origin of [
      undefined,
      '',
      '*',
      'null',
      'https://rakantor.github.io/turnip-tycoon/',
      'http://rakantor.github.io',
    ]) {
      expect(() =>
        createApp('unused', { credentialMode: 'bearer', frontendOrigin: origin }),
      ).toThrow('FRONTEND_ORIGIN');
    }
    expect(() =>
      createApp('unused', { credentialMode: 'bearer', frontendOrigin: 'http://127.0.0.1:4173' }),
    ).not.toThrow();
  });
});

describe('Bearer access from GitHub Pages', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    database = await createTestDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    app = createApp(database.url, options);
  }, 60_000);

  beforeEach(async () => {
    await client.query(
      'truncate table turnip_private.players, turnip_private.groups, turnip_private.pairing_challenges cascade',
    );
  });

  afterAll(async () => {
    if (client) await client.end();
    if (database) await database.stop();
  });

  async function send(method: string, path: string, input: RequestOptions = {}) {
    const response = await request(app, method, path, input);
    expect(response.headers.has('Set-Cookie')).toBe(false);
    if (response.status !== 403)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(frontendOrigin);
    return response;
  }

  async function start() {
    const response = await send('POST', '/api/session', { body: { deviceName: 'Phone' } });
    expect(response.status).toBe(201);
    const session = (await response.json()) as SessionCredentialsResponse;
    expect(session.sessionToken).toMatch(/^[a-f0-9]{64}$/);
    return session;
  }

  it('creates and reuses the same identity, returning the credential only when starting a session', async () => {
    const session = await start();
    const { sessionToken, ...metadata } = session;
    expect(metadata.player.displayName).toBe(defaultDisplayName(metadata.player.friendCode));
    expect(metadata.hasRecoveryCode).toBe(false);
    const stored = await client.query(
      'select token_hash from turnip_private.devices where id = $1',
      [session.deviceId],
    );
    expect(stored.rows).toEqual([
      { token_hash: createHash('sha256').update(sessionToken!).digest('hex') },
    ]);
    for (const path of ['/api/session', '/api/players']) {
      const reused = await send('POST', path, {
        token: sessionToken,
        body: { deviceName: 'Same phone' },
      });
      expect(reused.status).toBe(200);
      expect(await reused.json()).toEqual(session);
    }
    const current = await send('GET', '/api/session', { token: sessionToken });
    expect(await current.json()).toEqual(metadata);
    expect(current.headers.get('Cache-Control')).toBe('no-store');
    expect(current.headers.get('Vary')).toContain('Origin');
    expect((await client.query('select * from turnip_private.players')).rows).toHaveLength(1);
    expect((await client.query('select * from turnip_private.devices')).rows).toHaveLength(1);
  });

  it('ignores cookies and rejects malformed, duplicated, or unknown authorization tokens', async () => {
    const session = await start();
    const token = session.sessionToken!;
    for (const authorization of [
      '',
      `Basic ${token}`,
      `Bearer ${token}, Bearer ${token}`,
      `Bearer ${token} extra`,
      `Bearer\t${token}`,
      `Bearer ${token.slice(1)}`,
      `Bearer ${'f'.repeat(64)}`,
    ]) {
      await expectError(
        await send('GET', '/api/session', {
          headers: { Cookie: `${sessionCookie}=${token}`, Authorization: authorization },
        }),
        401,
      );
    }
    const other = await send('POST', '/api/session', {
      body: { deviceName: 'Cookie-only browser' },
      headers: { Cookie: `${sessionCookie}=${token}` },
    });
    expect(other.status).toBe(201);
    expect(((await other.json()) as SessionCredentialsResponse).player.id).not.toBe(
      session.player.id,
    );
    const valid = await send('GET', '/api/session', {
      headers: { Authorization: `bearer ${token}` },
    });
    expect(valid.status).toBe(200);
  });

  it('keeps cookie mode independent of bearer headers and never exposes its tokens in JSON', async () => {
    const browser = new Browser(createApp(database.url));
    const created = await browser.request('POST', '/api/session', { deviceName: 'Local browser' });
    expect(created.status).toBe(201);
    expect(await created.json()).not.toHaveProperty('sessionToken');
    const cookieToken = browser.cookies.get(sessionCookie)!;
    const ignored = await browser.app.request('https://turnip.test/api/session', {
      headers: { Authorization: `Bearer ${cookieToken}` },
    });
    await expectError(ignored, 401);
    const resumed = await browser.request('POST', '/api/session', { deviceName: 'Local browser' });
    expect(await resumed.json()).not.toHaveProperty('sessionToken');
    const pairing = await browser.request('POST', '/api/pairing', {
      deviceName: 'Another browser',
    });
    expect(await pairing.json()).not.toHaveProperty('pairingToken');
  });

  it('revokes tokens on logout or self-revocation and can create a fresh identity afterwards', async () => {
    for (const action of ['logout', 'revoke']) {
      const session = await start();
      const response =
        action === 'logout'
          ? await send('POST', '/api/logout', { token: session.sessionToken, body: {} })
          : await send('DELETE', `/api/devices/${session.deviceId}`, {
              token: session.sessionToken,
            });
      expect(response.status).toBe(200);
      await expectError(await send('GET', '/api/session', { token: session.sessionToken }), 401);
      const fresh = await send('POST', '/api/session', {
        token: session.sessionToken,
        body: { deviceName: 'Fresh browser' },
      });
      expect(fresh.status).toBe(201);
      expect(((await fresh.json()) as SessionCredentialsResponse).player.id).not.toBe(
        session.player.id,
      );
    }
  });

  it('rejects an expired session token', async () => {
    const session = await start();
    await client.query(
      "update turnip_private.devices set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = $1",
      [session.deviceId],
    );
    await expectError(await send('GET', '/api/session', { token: session.sessionToken }), 401);
  });

  it('restores the original player with a new bearer device and consumes the recovery code', async () => {
    const session = await start();
    const rotated = await send('POST', '/api/recovery/rotate', {
      token: session.sessionToken,
      body: {},
    });
    const { recoveryCode } = (await rotated.json()) as { recoveryCode: string };
    const recovered = await send('POST', '/api/recovery', {
      body: { code: recoveryCode, deviceName: 'Recovered phone' },
    });
    expect(recovered.status).toBe(200);
    const result = (await recovered.json()) as AccessResponse;
    expect(result.player).toEqual(session.player);
    expect(result.sessionToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sessionToken).not.toBe(session.sessionToken);
    expect(result.recoveryCode).not.toBe(recoveryCode);
    expect(result.hasRecoveryCode).toBe(true);
    const current = await send('GET', '/api/session', { token: result.sessionToken });
    expect(((await current.json()) as SessionResponse).deviceId).toBe(result.deviceId);
    await expectError(
      await send('POST', '/api/recovery', { body: { code: recoveryCode, deviceName: 'Replay' } }),
      401,
    );
    await expectError(
      await send('DELETE', `/api/devices/${session.deviceId}`, { token: 'f'.repeat(64) }),
      401,
    );
    expect(
      (await send('DELETE', `/api/devices/${session.deviceId}`, { token: result.sessionToken }))
        .status,
    ).toBe(200);
    await expectError(await send('GET', '/api/session', { token: session.sessionToken }), 401);
  });

  it('requires the pairing header claim, approval, and an unconsumed challenge', async () => {
    const owner = await start();
    const response = await send('POST', '/api/pairing', { body: { deviceName: 'Tablet' } });
    expect(response.status).toBe(201);
    const pairing = (await response.json()) as PairingResponse;
    expect(pairing.pairingToken).toMatch(/^[a-f0-9]{64}$/);
    const headers = { 'X-Pairing-Token': pairing.pairingToken! };
    await expectError(await send('POST', '/api/pairing/complete', { body: {}, headers }), 409);
    expect(
      (
        await send('POST', '/api/pairing/approve', {
          token: owner.sessionToken,
          body: { code: pairing.code },
        })
      ).status,
    ).toBe(200);
    const rejected: HeadersInit[] = [
      { Cookie: `${pairingCookie}=${pairing.pairingToken}` },
      { 'X-Pairing-Token': pairing.code },
      { 'X-Pairing-Token': `${pairing.pairingToken}, ${pairing.pairingToken}` },
    ];
    for (const invalidHeaders of rejected) {
      await expectError(
        await send('POST', '/api/pairing/complete', { body: {}, headers: invalidHeaders }),
        404,
      );
    }
    const completed = await send('POST', '/api/pairing/complete', { body: {}, headers });
    expect(completed.status).toBe(200);
    const paired = (await completed.json()) as SessionCredentialsResponse;
    expect(paired.player).toEqual(owner.player);
    expect(paired.sessionToken).toMatch(/^[a-f0-9]{64}$/);
    expect(paired.sessionToken).not.toBe(owner.sessionToken);
    expect((await send('GET', '/api/session', { token: paired.sessionToken })).status).toBe(200);
    await expectError(await send('POST', '/api/pairing/complete', { body: {}, headers }), 404);
  });

  it('saves owned prices, shares them with members, and preserves player assertions', async () => {
    const owner = await start();
    const friend = await start();
    const weekStart = '2026-10-04';
    const mutation: WeekMutation = {
      mutationId: randomUUID(),
      baseRevision: 0,
      purchasePrice: 100,
      firstBuy: false,
      previousPattern: null,
      prices: [90, 85, ...Array<number | null>(10).fill(null)],
    };
    expect(
      (
        await send('PUT', `/api/weeks/${weekStart}`, {
          token: owner.sessionToken,
          body: mutation,
          headers: { 'X-Player-Id': owner.player.id },
        })
      ).status,
    ).toBe(200);
    await expectError(
      await send('GET', `/api/weeks/${weekStart}`, {
        token: owner.sessionToken,
        headers: { 'X-Player-Id': friend.player.id },
      }),
      409,
    );
    const created = await send('POST', '/api/groups', {
      token: owner.sessionToken,
      body: { name: 'Friends' },
    });
    const { group } = (await created.json()) as { group: GroupSummary };
    await expectError(
      await send('GET', `/api/groups/${group.id}?weekStart=${weekStart}`, {
        token: friend.sessionToken,
      }),
      404,
    );
    expect(
      (
        await send('POST', '/api/groups/join', {
          token: friend.sessionToken,
          body: { code: group.code },
        })
      ).status,
    ).toBe(200);
    const shared = await send('GET', `/api/groups/${group.id}?weekStart=${weekStart}`, {
      token: friend.sessionToken,
    });
    const { members } = (await shared.json()) as { members: SharedPlayerWeek[] };
    const own = await send('GET', `/api/weeks/${weekStart}`, { token: owner.sessionToken });
    const { week } = (await own.json()) as { week: WeekRecord };
    expect(members.find((member) => member.player.id === owner.player.id)?.week).toEqual(week);
    expect(JSON.stringify(members)).not.toMatch(/sessionToken|tokenHash|recoveryCode/);
  });
});
