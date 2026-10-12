import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { RATE_LIMIT_SECONDS, type RateLimiter } from '../../src/server/limits';
import { createTestDatabase } from '../helpers/database';
import { Browser, expectError, sessionCookie } from './browser';

/** Counts like Cloudflare's binding, without its clock: a limit of n lets n calls through. */
class FakeLimiter implements RateLimiter {
  readonly counts = new Map<string, number>();
  constructor(private readonly allowed: number) {}
  async limit({ key }: { key: string }) {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { success: count <= this.allowed };
  }
}

type Limits = { profiles?: number; client?: number; creation?: number };

function limiters(limits: Limits) {
  return {
    profiles: limits.profiles === undefined ? undefined : new FakeLimiter(limits.profiles),
    client: limits.client === undefined ? undefined : new FakeLimiter(limits.client),
    creation: limits.creation === undefined ? undefined : new FakeLimiter(limits.creation),
  };
}

describe('Rate limits on unauthenticated writes', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  beforeAll(async () => {
    database = await createTestDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
  }, 60_000);
  beforeEach(async () => {
    await client.query(
      'truncate turnip_private.players, turnip_private.pairing_challenges cascade',
    );
  });
  afterAll(async () => {
    if (client) await client.end();
    if (database) await database.stop();
  });

  function build(limits: Limits) {
    const rateLimits = limiters(limits);
    return { app: createApp(database.url, { rateLimits }), limiters: rateLimits };
  }

  const address = '203.0.113.1';
  const start = (app: ReturnType<typeof createApp>, from = address) =>
    new Browser(app).request('POST', '/api/session', { deviceName: 'Phone' }, { address: from });

  async function players() {
    const result = await client.query('select count(*)::int as total from turnip_private.players');
    return result.rows[0].total as number;
  }

  it('refuses an address that keeps creating profiles, and says how long to wait', async () => {
    const { app } = build({ profiles: 2 });
    expect((await start(app)).status).toBe(201);
    expect((await start(app)).status).toBe(201);
    const refused = await start(app);
    const error = await expectError(refused, 429);
    expect(error.error.code).toBe('RATE_LIMITED');
    expect(refused.headers.get('Retry-After')).toBe(String(RATE_LIMIT_SECONDS));
    expect(refused.headers.get('Cache-Control')).toBe('no-store');
    expect((await start(app, '203.0.113.2')).status).toBe(201);
    expect(await players()).toBe(3);
  });

  it('counts a connected device asking for its session again as an attempt, not a profile', async () => {
    const { app, limiters } = build({ profiles: 1, client: 3 });
    const browser = new Browser(app);
    const request = () =>
      browser.request('POST', '/api/session', { deviceName: 'Phone' }, { address });
    expect((await request()).status).toBe(201);
    for (let repeat = 0; repeat < 3; repeat += 1) expect((await request()).status).toBe(200);
    expect(limiters.profiles!.counts.get(`players:${address}`)).toBe(1);
    expect(limiters.client!.counts.get(`session:${address}`)).toBe(3);
    await expectError(await request(), 429);
  });

  it('counts a device whose credential no longer connects as a new profile', async () => {
    const { app, limiters } = build({ profiles: 2 });
    const browser = new Browser(app);
    const request = () =>
      browser.request('POST', '/api/session', { deviceName: 'Phone' }, { address });
    expect((await request()).status).toBe(201);
    await client.query('delete from turnip_private.devices');
    // The stale credential starts a new profile, which counts like a request without one.
    expect((await request()).status).toBe(201);
    expect(limiters.profiles!.counts.get(`players:${address}`)).toBe(2);
    await client.query('delete from turnip_private.devices');
    await expectError(await request(), 429);
    expect(await players()).toBe(2);
  });

  it('caps new profiles across every address', async () => {
    const { app } = build({ creation: 1 });
    expect((await start(app)).status).toBe(201);
    const refused = await expectError(await start(app, '203.0.113.2'), 429);
    expect(refused.error.code).toBe('RATE_LIMITED');
    expect(await players()).toBe(1);
  });

  it('throttles pairing and recovery attempts separately per address', async () => {
    const { app } = build({ client: 2 });
    const pairing = () =>
      new Browser(app).request('POST', '/api/pairing', { deviceName: 'Laptop' }, { address });
    const recovery = () =>
      new Browser(app).request(
        'POST',
        '/api/recovery',
        { code: 'A'.repeat(32), deviceName: 'Laptop' },
        { address },
      );
    expect((await pairing()).status).toBe(201);
    expect((await pairing()).status).toBe(201);
    await expectError(await pairing(), 429);
    // A wrong code is still an attempt, and pairing's attempts don't count against recovery.
    await expectError(await recovery(), 401);
    await expectError(await recovery(), 401);
    await expectError(await recovery(), 429);
    // Neither counts against new profiles.
    expect((await start(app)).status).toBe(201);
  });

  it('refuses before opening a database connection', async () => {
    // Nothing listens on this port: any request that reaches the database fails with a 500.
    const app = createApp('postgresql://turnip:turnip@127.0.0.1:1/turnip', {
      rateLimits: limiters({ profiles: 0, client: 0 }),
    });
    const browser = new Browser(app);
    await expectError(
      await browser.request('POST', '/api/session', { deviceName: 'Phone' }, { address }),
      429,
    );
    // A made-up credential is an attempt too, not a connected device the database must check.
    const pretender = new Browser(app);
    pretender.cookies.set(sessionCookie, 'a'.repeat(64));
    await expectError(
      await pretender.request('POST', '/api/session', { deviceName: 'Phone' }, { address }),
      429,
    );
    await expectError(
      await browser.request('POST', '/api/pairing', { deviceName: 'Laptop' }, { address }),
      429,
    );
    await expectError(
      await browser.request(
        'POST',
        '/api/recovery',
        { code: 'A'.repeat(32), deviceName: 'Laptop' },
        { address },
      ),
      429,
    );
  });

  it('applies no limit without bindings', async () => {
    const app = createApp(database.url);
    for (let repeat = 0; repeat < 3; repeat += 1) expect((await start(app)).status).toBe(201);
  });
});
