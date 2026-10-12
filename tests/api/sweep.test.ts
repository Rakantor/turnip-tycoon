import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/connection';
import { createApp } from '../../src/server/app';
import { sweepExpired } from '../../src/server/sweep';
import type { PairingResponse } from '../../src/shared/api';
import { createTestDatabase } from '../helpers/database';
import { Browser, createPlayer } from './browser';

function hash(code: string) {
  return createHash('sha256').update(code.replace(/-/g, '')).digest('hex');
}

describe('Scheduled sweep', () => {
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
    await client.query(
      'truncate turnip_private.players, turnip_private.groups, turnip_private.pairing_challenges cascade',
    );
  });
  afterAll(async () => {
    if (client) await client.end();
    if (database) await database.stop();
  });

  async function sweep() {
    const connection = await connectDatabase(database.url);
    try {
      return await sweepExpired(connection.db);
    } finally {
      await connection.client.end();
    }
  }

  async function startPairing(deviceName: string) {
    const response = await new Browser(app).request('POST', '/api/pairing', { deviceName });
    expect(response.status).toBe(201);
    return response.json() as Promise<PairingResponse>;
  }

  async function count(table: string) {
    const result = await client.query(`select count(*)::int as total from turnip_private.${table}`);
    return result.rows[0].total as number;
  }

  it('deletes expired pairing codes and friend links, and keeps live ones working', async () => {
    const owner = new Browser(app);
    await createPlayer(owner, 'Maple');
    const live = await startPairing('Laptop');
    const stale = await startPairing('Tablet');
    const liveLink = 'LJVELJNKABCDEFGH';
    const staleLink = 'STALELJNKABCDEFG';
    for (const code of [liveLink, staleLink])
      expect((await owner.request('POST', '/api/friends/invites', { code })).status).toBe(201);
    await client.query(
      "update turnip_private.pairing_challenges set expires_at = now() - interval '1 second' where code_hash = $1",
      [hash(stale.code)],
    );
    await client.query(
      "update turnip_private.friend_invites set created_at = now() - interval '8 days', expires_at = now() - interval '1 second' where code_hash = $1",
      [hash(staleLink)],
    );

    expect(await sweep()).toEqual({ pairingChallenges: 1, friendInvites: 1 });
    expect(await count('pairing_challenges')).toBe(1);
    expect(await count('friend_invites')).toBe(1);
    expect((await owner.request('POST', '/api/pairing/approve', { code: live.code })).status).toBe(
      200,
    );
    const preview = await new Browser(app).request(
      'GET',
      `/api/friends/invites/preview?code=${liveLink}`,
    );
    expect(preview.status).toBe(200);
    expect(await sweep()).toEqual({ pairingChallenges: 0, friendInvites: 0 });
  });

  it('works through a backlog larger than one batch', async () => {
    await client.query(
      `insert into turnip_private.pairing_challenges (code_hash, claim_hash, device_name, expires_at)
       select md5('code' || n) || md5('code' || n), md5('claim' || n) || md5('claim' || n), 'Tablet',
         now() - interval '1 second'
       from generate_series(1, 2500) n`,
    );
    const live = await startPairing('Laptop');
    expect(await sweep()).toEqual({ pairingChallenges: 2500, friendInvites: 0 });
    expect(await count('pairing_challenges')).toBe(1);
    expect(live.code).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
  });
});
