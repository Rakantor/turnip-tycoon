import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import type { GroupSummary } from '../../src/shared/groups';
import { EXPORT_SECTIONS, type ProfileExportPage } from '../../src/shared/profile-data';
import type { SessionCredentialsResponse } from '../../src/shared/api';
import { createTestDatabase } from '../helpers/database';
import { Browser, createPlayer, expectError, sessionCookie } from './browser';

describe('Profile download and deletion', () => {
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

  async function fixture() {
    const owner = new Browser(app);
    const friend = new Browser(app);
    const profile = await createPlayer(owner, 'Maple');
    const other = await createPlayer(friend, 'Cherry');
    const group = (
      (await (await owner.request('POST', '/api/groups', { name: 'Friends' })).json()) as {
        group: GroupSummary;
      }
    ).group;
    expect((await friend.request('POST', '/api/groups/join', { code: group.code })).status).toBe(
      200,
    );
    const solo = (
      (await (await owner.request('POST', '/api/groups', { name: 'Solo' })).json()) as {
        group: GroupSummary;
      }
    ).group;
    const mutation = {
      mutationId: randomUUID(),
      baseRevision: 0,
      purchasePrice: 100,
      firstBuy: false,
      previousPattern: null,
      prices: [150, ...Array(11).fill(null)],
      trades: [
        { id: randomUUID(), kind: 'buy', quantity: 100, price: 100 },
        { id: randomUUID(), kind: 'sell', quantity: 50, price: 150, slot: 0 },
      ],
    };
    expect((await owner.request('PUT', '/api/weeks/2026-10-04', mutation)).status).toBe(200);
    expect(
      (
        await friend.request('PUT', '/api/weeks/2026-10-04', {
          ...mutation,
          mutationId: randomUUID(),
        })
      ).status,
    ).toBe(200);
    const second = new Browser(app);
    const challenge = (await (
      await second.request('POST', '/api/pairing', { deviceName: 'Tablet' })
    ).json()) as { code: string };
    expect(
      (await owner.request('POST', '/api/pairing/approve', { code: challenge.code })).status,
    ).toBe(200);
    expect((await second.request('POST', '/api/pairing/complete', {})).status).toBe(200);
    const pending = new Browser(app);
    const pendingCode = (await (
      await pending.request('POST', '/api/pairing', { deviceName: 'Pending laptop' })
    ).json()) as { code: string };
    expect(
      (await owner.request('POST', '/api/pairing/approve', { code: pendingCode.code })).status,
    ).toBe(200);
    return { owner, friend, profile, other, group, solo, second, pending, mutation };
  }

  it('exports all owned data and private trades without credentials or other members’ data', async () => {
    const f = await fixture();
    const output: Record<string, unknown[]> = {};
    for (const section of EXPORT_SECTIONS) {
      const response = await f.owner.request('GET', `/api/profile/export?section=${section}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const page = (await response.json()) as ProfileExportPage;
      expect(page.profile).toEqual(f.profile.player);
      expect(page.hasRecoveryCode).toBe(true);
      expect(page.nextCursor).toBeNull();
      output[section] = page.records;
    }
    expect(output.devices).toHaveLength(2);
    expect(output.groups).toHaveLength(2);
    expect(output.pairing).toHaveLength(1);
    expect(output.syncRecords).toHaveLength(1);
    expect(output.weeks).toEqual([
      expect.objectContaining({
        weekStart: '2026-10-04',
        prices: [expect.objectContaining({ price: 150 })],
        trades: [
          expect.objectContaining({ kind: 'buy', quantity: 100 }),
          expect.objectContaining({ kind: 'sell', quantity: 50 }),
        ],
      }),
    ]);
    const text = JSON.stringify(output);
    for (const forbidden of [
      f.other.player.id,
      f.other.player.displayName,
      f.profile.recoveryCode,
      f.owner.cookies.get(sessionCookie)!,
      'tokenHash',
      'codeHash',
      'claimHash',
      f.group.code,
    ])
      expect(text).not.toContain(forbidden);
  });

  it('paginates through more than 100 records without dropping expired devices', async () => {
    const owner = new Browser(app);
    const profile = await createPlayer(owner);
    await client.query(
      `insert into turnip_private.devices (player_id, name, token_hash, created_at, expires_at)
      select $1, 'Old device ' || n, encode(sha256(n::text::bytea), 'hex'), now() - interval '2 days', now() - interval '1 day' from generate_series(1, 105) n`,
      [profile.player.id],
    );
    const first = (await (
      await owner.request('GET', '/api/profile/export?section=devices')
    ).json()) as ProfileExportPage;
    expect(first.records).toHaveLength(100);
    const second = (await (
      await owner.request('GET', `/api/profile/export?section=devices&after=${first.nextCursor}`)
    ).json()) as ProfileExportPage;
    expect(second.records).toHaveLength(6);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.records, ...second.records].map((row) => (row as { id: string }).id)).size,
    ).toBe(106);
  });

  it('atomically deletes owned rows, revokes every credential, and preserves friends and nonempty groups', async () => {
    const f = await fixture();
    const oldToken = f.owner.cookies.get(sessionCookie)!;
    const response = await f.owner.request('DELETE', '/api/profile', {
      playerId: f.profile.player.id,
      confirm: 'delete',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deletedPlayerId: f.profile.player.id });
    expect(f.owner.cookies.has(sessionCookie)).toBe(false);
    for (const table of [
      'devices',
      'recovery_credentials',
      'pairing_challenges',
      'memberships',
      'weeks',
      'price_entries',
      'trades',
      'mutations',
    ]) {
      expect(
        (
          await client.query(`select count(*) from turnip_private.${table} where player_id = $1`, [
            f.profile.player.id,
          ])
        ).rows[0].count,
      ).toBe('0');
    }
    expect((await client.query('select id from turnip_private.players')).rows).toEqual([
      { id: f.other.player.id },
    ]);
    expect((await client.query('select id from turnip_private.groups')).rows).toEqual([
      { id: f.group.id },
    ]);
    expect((await f.friend.request('GET', '/api/weeks/2026-10-04')).status).toBe(200);
    await expectError(
      await f.friend.request('GET', `/api/players/${f.profile.player.id}/weeks/2026-10-04`),
      404,
    );
    await expectError(await f.second.request('GET', '/api/session'), 401);
    await expectError(await f.pending.request('POST', '/api/pairing/complete', {}), 404);
    await expectError(
      await new Browser(app).request('POST', '/api/recovery', {
        code: f.profile.recoveryCode,
        deviceName: 'Recovered',
      }),
      401,
    );
    const stale = new Browser(app);
    stale.cookies.set(sessionCookie, oldToken);
    await expectError(
      await stale.request('PUT', '/api/weeks/2026-10-04', { ...f.mutation, baseRevision: 1 }),
      401,
    );
    await expectError(await stale.request('GET', '/api/profile/export?section=weeks'), 401);
  });

  it('requires ownership, the expected profile, confirmation, and a trusted origin', async () => {
    const f = await fixture();
    await expectError(
      await new Browser(app).request('GET', '/api/profile/export?section=weeks'),
      401,
    );
    await expectError(
      await new Browser(app).request('DELETE', '/api/profile', {
        playerId: f.profile.player.id,
        confirm: 'delete',
      }),
      401,
    );
    await expectError(
      await f.friend.request('DELETE', '/api/profile', {
        playerId: f.profile.player.id,
        confirm: 'delete',
      }),
      409,
    );
    await expectError(
      await f.owner.request('DELETE', '/api/profile', { playerId: f.profile.player.id }),
      400,
    );
    await expectError(
      await f.owner.request(
        'DELETE',
        '/api/profile',
        { playerId: f.profile.player.id, confirm: 'delete' },
        { origin: 'https://attacker.test' },
      ),
      403,
    );
    await expectError(
      await f.owner.request('GET', '/api/profile/export?section=weeks', undefined, {
        playerId: f.other.player.id,
      }),
      409,
    );
    await expectError(
      await f.owner.request('GET', '/api/profile/export?section=weeks&after=no'),
      400,
    );
    expect((await client.query('select id from turnip_private.players')).rows).toHaveLength(2);
  });

  it('rolls back deletion if a dependent delete fails', async () => {
    const f = await fixture();
    await client.query(`create function turnip_private.fail_profile_delete() returns trigger language plpgsql as $$ begin raise exception 'test rollback'; end $$;
      create trigger fail_profile_delete before delete on turnip_private.weeks for each row execute function turnip_private.fail_profile_delete()`);
    try {
      await expectError(
        await f.owner.request('DELETE', '/api/profile', {
          playerId: f.profile.player.id,
          confirm: 'delete',
        }),
        500,
      );
      expect((await f.owner.request('GET', '/api/session')).status).toBe(200);
      expect((await client.query('select id from turnip_private.groups')).rows).toHaveLength(2);
      expect((await f.owner.request('GET', '/api/weeks/2026-10-04')).status).toBe(200);
    } finally {
      await client.query(
        'drop trigger fail_profile_delete on turnip_private.weeks; drop function turnip_private.fail_profile_delete()',
      );
    }
  });

  it('supports bearer export/deletion and immediately rejects the old token', async () => {
    const frontendOrigin = 'https://frontend.test';
    const bearer = createApp(database.url, { credentialMode: 'bearer', frontendOrigin });
    const created = await bearer.request('https://api.test/api/session', {
      method: 'POST',
      headers: { Origin: frontendOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceName: 'Browser' }),
    });
    const session = (await created.json()) as SessionCredentialsResponse;
    const headers = {
      Origin: frontendOrigin,
      Authorization: `Bearer ${session.sessionToken}`,
      'X-Player-Id': session.player.id,
      'Content-Type': 'application/json',
    };
    expect(
      (await bearer.request('https://api.test/api/profile/export?section=devices', { headers }))
        .status,
    ).toBe(200);
    const deleted = await bearer.request('https://api.test/api/profile', {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ playerId: session.player.id, confirm: 'delete' }),
    });
    expect(deleted.status).toBe(200);
    expect(deleted.headers.get('Access-Control-Allow-Origin')).toBe(frontendOrigin);
    expect(deleted.headers.has('Set-Cookie')).toBe(false);
    expect((await bearer.request('https://api.test/api/session', { headers })).status).toBe(401);
  });
});
