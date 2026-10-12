import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { RATE_LIMIT_SECONDS, type RateLimiter } from '../../src/server/limits';
import { createTestDatabase } from '../helpers/database';
import { Browser, expectError } from './browser';

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

  function build(limits: { client?: number; creation?: number }) {
    const limiters = {
      client: limits.client === undefined ? undefined : new FakeLimiter(limits.client),
      creation: limits.creation === undefined ? undefined : new FakeLimiter(limits.creation),
    };
    return { app: createApp(database.url, { rateLimits: limiters }), limiters };
  }

  const start = (app: ReturnType<typeof createApp>, address: string) =>
    new Browser(app).request('POST', '/api/session', { deviceName: 'Phone' }, { address });

  async function players() {
    const result = await client.query('select count(*)::int as total from turnip_private.players');
    return result.rows[0].total as number;
  }

  it('refuses an address that keeps creating profiles, and says how long to wait', async () => {
    const { app } = build({ client: 2 });
    expect((await start(app, '203.0.113.1')).status).toBe(201);
    expect((await start(app, '203.0.113.1')).status).toBe(201);
    const refused = await start(app, '203.0.113.1');
    const error = await expectError(refused, 429);
    expect(error.error.code).toBe('RATE_LIMITED');
    expect(refused.headers.get('Retry-After')).toBe(String(RATE_LIMIT_SECONDS));
    expect(refused.headers.get('Cache-Control')).toBe('no-store');
    expect((await start(app, '203.0.113.2')).status).toBe(201);
    expect(await players()).toBe(3);
  });

  it('does not count a connected device asking for its session again', async () => {
    const { app, limiters } = build({ client: 1 });
    const browser = new Browser(app);
    const request = () =>
      browser.request('POST', '/api/session', { deviceName: 'Phone' }, { address: '203.0.113.1' });
    expect((await request()).status).toBe(201);
    for (let repeat = 0; repeat < 3; repeat += 1) expect((await request()).status).toBe(200);
    expect(limiters.client!.counts.get('players:203.0.113.1')).toBe(1);
  });

  it('caps new profiles across every address', async () => {
    const { app } = build({ creation: 1 });
    expect((await start(app, '203.0.113.1')).status).toBe(201);
    const refused = await expectError(await start(app, '203.0.113.2'), 429);
    expect(refused.error.code).toBe('RATE_LIMITED');
    expect(await players()).toBe(1);
  });

  it('throttles pairing and recovery attempts separately per address', async () => {
    const { app } = build({ client: 2 });
    const address = '203.0.113.1';
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
    expect((await start(app, address)).status).toBe(201);
  });

  it('applies no limit without bindings', async () => {
    const app = createApp(database.url);
    for (let repeat = 0; repeat < 3; repeat += 1)
      expect((await start(app, '203.0.113.1')).status).toBe(201);
  });
});
