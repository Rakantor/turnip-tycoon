import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/connection';
import { createApp } from '../../src/server/app';
import {
  ABANDONED_AFTER_DAYS,
  RECOVERABLE_RETENTION_DAYS,
  sweep,
  sweepAbandoned,
  sweepExpired,
  UNUSED_AFTER_DAYS,
} from '../../src/server/sweep';
import type { PairingResponse, SessionResponse } from '../../src/shared/api';
import type { GroupSummary } from '../../src/shared/groups';
import { createTestDatabase } from '../helpers/database';
import { Browser, createPlayer, expectError } from './browser';

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

  async function connected<T>(
    work: (db: Awaited<ReturnType<typeof connectDatabase>>['db']) => Promise<T>,
  ) {
    const connection = await connectDatabase(database.url);
    try {
      return await work(connection.db);
    } finally {
      await connection.client.end();
    }
  }

  async function count(table: string) {
    const result = await client.query(`select count(*)::int as total from turnip_private.${table}`);
    return result.rows[0].total as number;
  }

  describe('expired rows', () => {
    async function startPairing(deviceName: string) {
      const response = await new Browser(app).request('POST', '/api/pairing', { deviceName });
      expect(response.status).toBe(201);
      return response.json() as Promise<PairingResponse>;
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

      expect(await connected(sweepExpired)).toEqual({ pairingChallenges: 1, friendInvites: 1 });
      expect(await count('pairing_challenges')).toBe(1);
      expect(await count('friend_invites')).toBe(1);
      expect(
        (await owner.request('POST', '/api/pairing/approve', { code: live.code })).status,
      ).toBe(200);
      const preview = await new Browser(app).request(
        'GET',
        `/api/friends/invites/preview?code=${liveLink}`,
      );
      expect(preview.status).toBe(200);
      expect(await sweep(database.url)).toEqual({
        pairingChallenges: 0,
        friendInvites: 0,
        players: 0,
      });
    });

    it('works through a backlog larger than one batch', async () => {
      await client.query(
        `insert into turnip_private.pairing_challenges (code_hash, claim_hash, device_name, expires_at)
         select md5('code' || n) || md5('code' || n), md5('claim' || n) || md5('claim' || n), 'Tablet',
           now() - interval '1 second'
         from generate_series(1, 2500) n`,
      );
      const live = await startPairing('Laptop');
      expect(await connected(sweepExpired)).toEqual({ pairingChallenges: 2500, friendInvites: 0 });
      expect(await count('pairing_challenges')).toBe(1);
      expect(live.code).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
    });
  });

  describe('abandoned profiles', () => {
    /** A profile as the welcome dialog starts one: a device, no recovery code, nothing saved. */
    async function startProfile() {
      const browser = new Browser(app);
      const response = await browser.request('POST', '/api/session', { deviceName: 'Phone' });
      expect(response.status).toBe(201);
      const session = (await response.json()) as SessionResponse;
      return { browser, id: session.player.id };
    }

    /** Moves every device of a player back in time: how long ago it was added and expired. */
    async function age(playerId: string, created: string, expired: string) {
      await client.query(
        'update turnip_private.devices set created_at = now() - $2::interval, expires_at = now() - $3::interval where player_id = $1',
        [playerId, created, expired],
      );
    }

    async function saveWeek(playerId: string) {
      await client.query(
        "insert into turnip_private.weeks (player_id, week_start, revision) values ($1, '2026-10-04', 1)",
        [playerId],
      );
    }

    async function exists(playerId: string) {
      const result = await client.query('select 1 from turnip_private.players where id = $1', [
        playerId,
      ]);
      return result.rowCount === 1;
    }

    const run = () => connected(sweepAbandoned);

    it('deletes a profile without a recovery code 30 days after its last access expired', async () => {
      const gone = await startProfile();
      const kept = await startProfile();
      await saveWeek(gone.id);
      await saveWeek(kept.id);
      await age(gone.id, '70 days', `${ABANDONED_AFTER_DAYS + 1} days`);
      await age(kept.id, '70 days', `${ABANDONED_AFTER_DAYS - 1} days`);

      expect(await run()).toBe(1);
      expect(await exists(gone.id)).toBe(false);
      expect(await exists(kept.id)).toBe(true);
      // The device learns of the deletion as it would of any other, and clears its copy.
      const removed = await expectError(await gone.browser.request('GET', '/api/session'), 401);
      expect(removed.error.code).toBe('DEVICE_REMOVED');
      const expired = await expectError(await kept.browser.request('GET', '/api/session'), 401);
      expect(expired.error.code).toBe('DEVICE_EXPIRED');
    });

    it('keeps a profile with a recovery code for a year after its access expired', async () => {
      const profile = await createPlayer(new Browser(app), 'Maple');
      await age(profile.player.id, '400 days', '200 days');
      expect(await run()).toBe(0);
      await age(profile.player.id, '400 days', `${RECOVERABLE_RETENTION_DAYS + 1} days`);
      expect(await run()).toBe(1);
      expect(await exists(profile.player.id)).toBe(false);
    });

    it('deletes a profile that was started but never used again, after a week', async () => {
      const unused = await startProfile();
      const young = await startProfile();
      const renewed = await startProfile();
      const saved = await startProfile();
      await saveWeek(saved.id);
      // A device keeps its first 30-day expiry unless use renews it, a day or more later.
      const stale = `${UNUSED_AFTER_DAYS + 1} days`;
      await age(unused.id, stale, `${UNUSED_AFTER_DAYS + 1 - 30} days`);
      await age(young.id, `${UNUSED_AFTER_DAYS - 1} days`, `${UNUSED_AFTER_DAYS - 1 - 30} days`);
      await age(renewed.id, stale, '-30 days');
      await age(saved.id, stale, `${UNUSED_AFTER_DAYS + 1 - 30} days`);

      expect(await run()).toBe(1);
      expect(await exists(unused.id)).toBe(false);
      for (const { id } of [young, renewed, saved]) expect(await exists(id)).toBe(true);
    });

    it('removes a group left empty and leaves groups with other members', async () => {
      const gone = await startProfile();
      const friend = new Browser(app);
      const other = await createPlayer(friend, 'Cherry');
      const create = async (browser: Browser, name: string) =>
        (
          (await (await browser.request('POST', '/api/groups', { name })).json()) as {
            group: GroupSummary;
          }
        ).group;
      const alone = await create(gone.browser, 'Alone');
      const shared = await create(friend, 'Shared');
      expect(
        (await gone.browser.request('POST', '/api/groups/join', { code: shared.code })).status,
      ).toBe(200);
      await age(gone.id, '70 days', `${ABANDONED_AFTER_DAYS + 1} days`);

      expect(await run()).toBe(1);
      const groups = await client.query('select id from turnip_private.groups');
      expect(groups.rows.map((row) => row.id)).toEqual([shared.id]);
      expect(alone.id).not.toBe(shared.id);
      const members = await client.query(
        'select player_id from turnip_private.memberships where group_id = $1',
        [shared.id],
      );
      expect(members.rows.map((row) => row.player_id)).toEqual([other.player.id]);
    });

    it('leaves a profile alone while a request holds it', async () => {
      const gone = await startProfile();
      await saveWeek(gone.id);
      await age(gone.id, '70 days', `${ABANDONED_AFTER_DAYS + 1} days`);
      await client.query('begin');
      await client.query('select id from turnip_private.players where id = $1 for no key update', [
        gone.id,
      ]);
      try {
        expect(await run()).toBe(0);
      } finally {
        await client.query('rollback');
      }
      expect(await run()).toBe(1);
      expect(await exists(gone.id)).toBe(false);
    });
  });
});
