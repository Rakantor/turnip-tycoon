import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../helpers/database';

describe('PostgreSQL ownership and history constraints', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;

  beforeAll(async () => {
    database = await createTestDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    if (client) await client.end();
    if (database) await database.stop();
  });

  async function player() {
    const id = randomUUID();
    await client.query(
      'insert into turnip_private.players (id, display_name, friend_code) values ($1, $2, $3)',
      [id, 'Maple', id.replaceAll('-', '').slice(0, 12).toUpperCase().match(/.{4}/g)!.join('-')],
    );
    return id;
  }

  async function week(playerId: string, weekStart = '2026-10-04') {
    const id = randomUUID();
    await client.query(
      'insert into turnip_private.weeks (id, player_id, week_start) values ($1, $2, $3)',
      [id, playerId, weekStart],
    );
    return id;
  }

  it('keeps one week per player and one selling price per slot, while allowing unknown prices', async () => {
    const owner = await player();
    const weekId = await week(owner);
    await expect(week(owner)).rejects.toMatchObject({ code: '23505' });
    const otherPlayer = await player();
    await week(otherPlayer);
    await client.query(
      'insert into turnip_private.price_entries (week_id, player_id, day, slot, price) values ($1, $2, 1, $3, 104)',
      [weekId, owner, 'AM'],
    );
    await expect(
      client.query(
        'insert into turnip_private.price_entries (week_id, player_id, day, slot, price) values ($1, $2, 1, $3, 150)',
        [weekId, owner, 'AM'],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    const saved = await client.query(
      'select week_start::text, purchase_price from turnip_private.weeks where id = $1',
      [weekId],
    );
    expect(saved.rows).toEqual([{ week_start: '2026-10-04', purchase_price: null }]);
    const prices = await client.query(
      'select day, slot, price from turnip_private.price_entries where week_id = $1',
      [weekId],
    );
    expect(prices.rows).toEqual([{ day: 1, slot: 'AM', price: 104 }]);
  });

  it("prevents attaching a price to another player's weekly record", async () => {
    const owner = await player();
    const outsider = await player();
    const weekId = await week(owner);
    await expect(
      client.query(
        'insert into turnip_private.price_entries (week_id, player_id, day, slot, price) values ($1, $2, 1, $3, 200)',
        [weekId, outsider, 'PM'],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it("preserves a player's historical prices when a group is deleted", async () => {
    const owner = await player();
    const weekId = await week(owner, '2026-09-27');
    const groupId = randomUUID();
    await client.query('insert into turnip_private.groups (id, share_code) values ($1, $2)', [
      groupId,
      randomUUID(),
    ]);
    await client.query(
      'insert into turnip_private.memberships (group_id, player_id) values ($1, $2)',
      [groupId, owner],
    );
    await expect(
      client.query('insert into turnip_private.memberships (group_id, player_id) values ($1, $2)', [
        groupId,
        owner,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    await client.query(
      'insert into turnip_private.price_entries (week_id, player_id, day, slot, price) values ($1, $2, 6, $3, 181)',
      [weekId, owner, 'PM'],
    );
    await client.query('delete from turnip_private.groups where id = $1', [groupId]);
    const memberships = await client.query(
      'select * from turnip_private.memberships where group_id = $1',
      [groupId],
    );
    expect(memberships.rows).toHaveLength(0);
    const prices = await client.query(
      'select p.price from turnip_private.price_entries p join turnip_private.weeks w on w.id = p.week_id where w.player_id = $1 and w.week_start = $2',
      [owner, '2026-09-27'],
    );
    expect(prices.rows).toEqual([{ price: 181 }]);
  });

  it('rejects non-Sunday weeks, invalid slots, zero prices, and orphan ownership', async () => {
    const owner = await player();
    await expect(week(owner, '2026-10-05')).rejects.toMatchObject({ code: '23514' });
    await expect(week(randomUUID())).rejects.toMatchObject({ code: '23503' });
    const weekId = await week(owner);
    for (const [day, slot, price] of [
      [0, 'AM', 100],
      [7, 'PM', 100],
      [1, 'evening', 100],
      [1, 'AM', 0],
      [1, 'AM', 661],
    ]) {
      await expect(
        client.query(
          'insert into turnip_private.price_entries (week_id, player_id, day, slot, price) values ($1, $2, $3, $4, $5)',
          [weekId, owner, day, slot, price],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('migrates legacy friend codes while preserving profiles and weekly history', async () => {
    await client.query('begin');
    try {
      // Recreate the relevant legacy constraints within a rollback-only test.
      await client.query(`
        truncate turnip_private.players cascade;
        alter table turnip_private.players drop constraint players_friend_code_unique;
        alter table turnip_private.players drop constraint players_friend_code_format;
        alter table turnip_private.players alter column friend_code drop not null;
        alter table turnip_private.players add constraint players_friend_code_format
          check (friend_code is null or friend_code ~ '^SW-[0-9]{4}-[0-9]{4}-[0-9]{4}$');
      `);
      const owner = randomUUID();
      const unnamed = randomUUID();
      await client.query(
        `insert into turnip_private.players (id, display_name, island_name, friend_code)
        values ($1, 'Custom Maple', 'Sunrise', 'SW-1234-5678-9012'), ($2, 'Cherry', null, null)`,
        [owner, unnamed],
      );
      const weekId = await week(owner);
      await client.query(
        'insert into turnip_private.price_entries (week_id, player_id, day, slot, price) values ($1, $2, 1, $3, 147)',
        [weekId, owner, 'AM'],
      );
      const migration = await readFile(
        new URL('../../drizzle/0001_generated_friend_codes.sql', import.meta.url),
        'utf8',
      );
      await client.query(migration);
      const records = await client.query(
        'select id, display_name, island_name, friend_code from turnip_private.players order by display_name',
      );
      expect(records.rows).toEqual([
        {
          id: unnamed,
          display_name: 'Cherry',
          island_name: null,
          friend_code: expect.stringMatching(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
        },
        {
          id: owner,
          display_name: 'Custom Maple',
          island_name: 'Sunrise',
          friend_code: expect.stringMatching(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
        },
      ]);
      expect(
        new Set(records.rows.map((row: { friend_code: string }) => row.friend_code)).size,
      ).toBe(2);
      expect(
        (
          await client.query('select price from turnip_private.price_entries where week_id = $1', [
            weekId,
          ])
        ).rows,
      ).toEqual([{ price: 147 }]);
    } finally {
      await client.query('rollback');
    }
  });
});
