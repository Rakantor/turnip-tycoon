import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectDatabase } from '../../src/db/connection';
import { createApp } from '../../src/server/app';
import { findSession, renewSession, sessionHash } from '../../src/server/auth';
import { SESSION_SECONDS } from '../../src/server/http';
import type { SessionCredentialsResponse } from '../../src/shared/api';
import { createTestDatabase } from '../helpers/database';
import { Browser, createPlayer, expectError, sessionCookie } from './browser';

const frontendOrigin = 'https://frontend.test';
const lifetime = 30 * 24 * 60 * 60 * 1000;

describe.each(['cookie', 'bearer'] as const)('Device inactivity in %s mode', (mode) => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    database = await createTestDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    app = createApp(database.url, {
      credentialMode: mode,
      ...(mode === 'bearer' ? { frontendOrigin } : {}),
    });
  }, 60_000);
  beforeEach(async () => {
    await client.query('truncate table turnip_private.players cascade');
  });
  afterAll(async () => {
    if (client) await client.end();
    if (database) await database.stop();
  });

  async function connect() {
    const browser = new Browser(app);
    let token: string | undefined;
    const request = (method: string, path: string, body?: unknown, playerId?: string) => {
      if (mode === 'cookie')
        return browser.request(method, path, body, { playerId, sessionRenewal: true });
      return app.request(`https://api.test${path}`, {
        method,
        headers: {
          Origin: frontendOrigin,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(playerId ? { 'X-Player-Id': playerId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    };
    const created = await request('POST', '/api/session', { deviceName: 'Phone' });
    expect(created.status).toBe(201);
    const session = (await created.json()) as SessionCredentialsResponse;
    token = session.sessionToken ?? browser.cookies.get(sessionCookie);
    return {
      session,
      created,
      request,
      token: token!,
      credential: (value?: string) => {
        token = value;
        if (value) browser.cookies.set(sessionCookie, value);
        else browser.cookies.delete(sessionCookie);
      },
    };
  }

  async function stored(id: string) {
    const result = await client.query<{ expires_at: Date; token_hash: string }>(
      'select expires_at, token_hash from turnip_private.devices where id = $1',
      [id],
    );
    return result.rows[0];
  }

  function expectCookie(response: Response, token: string) {
    if (mode === 'cookie') {
      const cookies = response.headers.getSetCookie();
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toContain(`${sessionCookie}=${token};`);
      expect(cookies[0]).toContain(`Max-Age=${SESSION_SECONDS}`);
      expect(cookies[0]).toMatch(/; HttpOnly(?:;|$)/i);
      expect(cookies[0]).toMatch(/; Secure(?:;|$)/i);
      expect(cookies[0]).toMatch(/; SameSite=Strict(?:;|$)/i);
    } else expect(response.headers.has('Set-Cookie')).toBe(false);
  }

  it('issues 30 days of access and renews authenticated reads, writes, and session reuse', async () => {
    const h = await connect();
    expectCookie(h.created, h.token);
    expect(
      Math.abs((await stored(h.session.deviceId)).expires_at.getTime() - Date.now() - lifetime),
    ).toBeLessThan(5000);
    for (const [method, path, body] of [
      ['GET', '/api/session', undefined],
      ['GET', '/api/ledger', undefined],
      ['PATCH', '/api/profile', { displayName: 'Maple' }],
      ['POST', '/api/session', { deviceName: 'Same phone' }],
    ] as const) {
      await client.query(
        "update turnip_private.devices set expires_at = now() + interval '10 minutes' where id = $1",
        [h.session.deviceId],
      );
      const response = await h.request(method, path, body);
      expect(response.status).toBe(200);
      expectCookie(response, h.token);
      const row = await stored(h.session.deviceId);
      expect(Math.abs(row.expires_at.getTime() - Date.now() - lifetime)).toBeLessThan(5000);
      expect(row.token_hash).toBe(createHash('sha256').update(h.token).digest('hex'));
    }
  });

  it('skips fresh credentials and renews only once for a concurrent request burst', async () => {
    const h = await connect();
    const fresh = await stored(h.session.deviceId);
    for (const path of [
      '/api/session',
      '/api/ledger',
      '/api/devices',
      '/api/profile/export?section=weeks',
    ]) {
      const response = await h.request('GET', path);
      expect(response.status).toBe(200);
      expect(response.headers.has('Set-Cookie')).toBe(false);
    }
    expect(await stored(h.session.deviceId)).toEqual(fresh);
    await client.query(
      "update turnip_private.devices set expires_at = now() + interval '28 days 23 hours' where id = $1",
      [h.session.deviceId],
    );
    const connections = await Promise.all(
      Array.from({ length: 4 }, () => connectDatabase(database.url)),
    );
    try {
      const tokenHash = createHash('sha256').update(h.token).digest('hex');
      const results = await Promise.all(connections.map(({ db }) => renewSession(db, tokenHash)));
      expect(results.filter(Boolean)).toHaveLength(1);
    } finally {
      await Promise.all(connections.map(({ client }) => client.end()));
    }
    const renewed = await stored(h.session.deviceId);
    const burst = await Promise.all(
      Array.from({ length: 4 }, () => h.request('GET', '/api/session')),
    );
    expect(burst.every((response) => response.ok && !response.headers.has('Set-Cookie'))).toBe(
      true,
    );
    expect(await stored(h.session.deviceId)).toEqual(renewed);
  });

  if (mode === 'cookie') {
    it.each(['recovery', 'pairing'])(
      'does not let an uncoordinated delayed response undo %s',
      async (operation) => {
        const delayedApp = createApp(database.url);
        const authenticated = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        delayedApp.get('/api/test-delayed', async (c) => {
          const session = await findSession(c.get('db'), await sessionHash(c));
          authenticated.resolve();
          await release.promise;
          return c.json(session);
        });
        const browser = new Browser(delayedApp);
        const old = await createPlayer(browser, 'Old');
        const targetBrowser = new Browser(delayedApp);
        const target = await createPlayer(targetBrowser, 'New');
        await client.query(
          "update turnip_private.devices set expires_at = now() + interval '10 minutes' where id = $1",
          [old.deviceId],
        );
        const before = await stored(old.deviceId);
        const delayed = browser.request('GET', '/api/test-delayed');
        await authenticated.promise;
        try {
          if (operation === 'recovery') {
            expect(
              (
                await browser.request('POST', '/api/recovery', {
                  code: target.recoveryCode,
                  deviceName: 'Recovered',
                })
              ).status,
            ).toBe(200);
          } else {
            const challenge = await browser.request('POST', '/api/pairing', {
              deviceName: 'Paired',
            });
            const { code } = (await challenge.json()) as { code: string };
            expect(
              (await targetBrowser.request('POST', '/api/pairing/approve', { code })).status,
            ).toBe(200);
            expect((await browser.request('POST', '/api/pairing/complete', {})).status).toBe(200);
          }
        } finally {
          release.resolve();
        }
        const response = await delayed;
        expect(response.headers.has('Set-Cookie')).toBe(false);
        expect(await stored(old.deviceId)).toEqual(before);
        expect(await (await browser.request('GET', '/api/session')).json()).toMatchObject({
          player: { id: target.player.id },
        });
      },
    );
  }

  it('does not renew public requests, failed mutations, or requests for a different player', async () => {
    const h = await connect();
    const other = await connect();
    await client.query(
      "update turnip_private.devices set expires_at = now() + interval '10 minutes' where id = $1",
      [h.session.deviceId],
    );
    const before = await stored(h.session.deviceId);
    expect((await h.request('GET', '/api/health')).headers.has('Set-Cookie')).toBe(false);
    await expectError(
      await h.request('PATCH', '/api/profile', { displayName: 'x'.repeat(30) }),
      400,
    );
    await expectError(
      await h.request('GET', '/api/devices', undefined, other.session.player.id),
      409,
    );
    expect(await stored(h.session.deviceId)).toEqual(before);
  });

  it('distinguishes expired access from a missing credential without renewing either', async () => {
    const h = await connect();
    await client.query(
      "update turnip_private.devices set created_at = now() - interval '31 days', expires_at = now() - interval '1 second' where id = $1",
      [h.session.deviceId],
    );
    const before = await stored(h.session.deviceId);
    for (const path of ['/api/session', '/api/ledger']) {
      const response = await h.request('GET', path);
      expect((await expectError(response, 401)).error.code).toBe('DEVICE_EXPIRED');
      expect(response.headers.has('Set-Cookie')).toBe(false);
    }
    expect(await stored(h.session.deviceId)).toEqual(before);
    for (const credential of [undefined, 'malformed']) {
      h.credential(credential);
      expect((await expectError(await h.request('GET', '/api/session'), 401)).error.code).toBe(
        'UNAUTHENTICATED',
      );
    }
  });

  it.each(['logout', 'remove-device', 'delete-profile'])(
    'does not undo %s with renewal',
    async (operation) => {
      const h = await connect();
      const response =
        operation === 'logout'
          ? await h.request('POST', '/api/logout', {})
          : operation === 'remove-device'
            ? await h.request('DELETE', `/api/devices/${h.session.deviceId}`)
            : await h.request('DELETE', '/api/profile', {
                playerId: h.session.player.id,
                confirm: 'delete',
              });
      expect(response.status).toBe(200);
      expect(await stored(h.session.deviceId)).toBeUndefined();
      if (mode === 'cookie') {
        const cookie = response.headers
          .getSetCookie()
          .find((value) => value.startsWith(`${sessionCookie}=`));
        expect(cookie).toContain('Max-Age=0');
      } else expect(response.headers.has('Set-Cookie')).toBe(false);
      h.credential(h.token);
      expect((await expectError(await h.request('GET', '/api/session'), 401)).error.code).toBe(
        'DEVICE_REMOVED',
      );
    },
  );

  it('acknowledges logout for expired, removed, and missing credentials', async () => {
    const h = await connect();
    await client.query(
      "update turnip_private.devices set created_at = now() - interval '31 days', expires_at = now() - interval '1 second' where id = $1",
      [h.session.deviceId],
    );
    for (const credential of [h.token, h.token, undefined]) {
      h.credential(credential);
      const response = await h.request('POST', '/api/logout', {}, h.session.player.id);
      expect(response.status).toBe(200);
      expect(await stored(h.session.deviceId)).toBeUndefined();
      if (mode === 'cookie') {
        expect(response.headers.getSetCookie().join(';')).toContain('Max-Age=0');
      } else expect(response.headers.has('Set-Cookie')).toBe(false);
    }
  });

  it('does not log out a different profile after the credential changes', async () => {
    const first = await connect();
    const other = await connect();
    first.credential(other.token);
    const before = await stored(other.session.deviceId);
    const response = await first.request('POST', '/api/logout', {}, first.session.player.id);
    expect((await expectError(response, 409)).error.code).toBe('PLAYER_CHANGED');
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(await stored(other.session.deviceId)).toEqual(before);
  });

  it('keeps a committed response when its best-effort renewal fails', async () => {
    const failing = createApp(database.url, {
      credentialMode: mode,
      ...(mode === 'bearer' ? { frontendOrigin } : {}),
    });
    failing.get('/api/test-renewal-failure', async (c) => {
      const session = await findSession(c.get('db'), await sessionHash(c));
      // The renewal UPDATE after this handler then fails on the same connection.
      await c.get('db').execute(sql`set default_transaction_read_only = on`);
      return c.json(session);
    });
    const h = await connect();
    await client.query(
      "update turnip_private.devices set expires_at = now() + interval '10 minutes' where id = $1",
      [h.session.deviceId],
    );
    const before = await stored(h.session.deviceId);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let response: Response;
    if (mode === 'cookie') {
      const browser = new Browser(failing);
      browser.cookies.set(sessionCookie, h.token);
      response = await browser.request('GET', '/api/test-renewal-failure', undefined, {
        sessionRenewal: true,
      });
    } else {
      response = await failing.request('https://api.test/api/test-renewal-failure', {
        headers: { Origin: frontendOrigin, Authorization: `Bearer ${h.token}` },
      });
    }
    expect(response.status).toBe(200);
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(await stored(h.session.deviceId)).toEqual(before);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('session_renewal_failed'));
    logged.mockRestore();
  });

  it('cannot renew a credential that expired or was removed after the request authenticated', async () => {
    const h = await connect();
    const db = await connectDatabase(database.url);
    try {
      const tokenHash = createHash('sha256').update(h.token).digest('hex');
      await client.query(
        "update turnip_private.devices set created_at = now() - interval '31 days', expires_at = now() - interval '1 second' where id = $1",
        [h.session.deviceId],
      );
      expect(await renewSession(db.db, tokenHash)).toBe(false);
      expect((await stored(h.session.deviceId)).expires_at.getTime()).toBeLessThan(Date.now());
      await client.query('delete from turnip_private.devices where id = $1', [h.session.deviceId]);
      expect(await renewSession(db.db, tokenHash)).toBe(false);
      expect(await stored(h.session.deviceId)).toBeUndefined();
    } finally {
      await db.client.end();
    }
  });
});
