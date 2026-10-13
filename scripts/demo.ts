import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { currentSlot, currentWeekStart, shiftWeek } from '../src/shared/calendar';
import type { PatternId } from '../src/shared/week';

/**
 * `pnpm dev` signs any browser without a session into this profile, so a private window opens
 * on a week with prices, trades, history and friends rather than on a new, empty profile.
 * The token only ever connects a device in the local database, and every launch resets the
 * demo players to the data below, dated from today.
 */
export const DEMO_SESSION_TOKEN = createHash('sha256')
  .update('turnip-tycoon-local-demo')
  .digest('hex');

const SESSION_DAYS = 30;
const SCHEMA = 'turnip_private';

/** A purchase price and twelve prices that the forecast matches to exactly one pattern. */
const WEEKS: Record<string, { pattern: PatternId; purchase: number; prices: number[] }> = {
  largeSpike: {
    pattern: 'large-spike',
    purchase: 95,
    prices: [84, 80, 76, 114, 171, 494, 152, 105, 67, 57, 48, 43],
  },
  decreasing: {
    pattern: 'decreasing',
    purchase: 102,
    prices: [90, 86, 82, 78, 74, 70, 66, 62, 58, 54, 49, 45],
  },
  fluctuating: {
    pattern: 'fluctuating',
    purchase: 91,
    prices: [101, 119, 64, 57, 110, 87, 123, 69, 62, 55, 91, 114],
  },
  smallSpike: {
    pattern: 'small-spike',
    purchase: 104,
    prices: [89, 85, 81, 104, 125, 166, 188, 176, 84, 80, 75, 71],
  },
  earlySpike: {
    pattern: 'large-spike',
    purchase: 93,
    prices: [82, 121, 159, 512, 168, 112, 75, 47, 66, 42, 56, 80],
  },
};
type WeekName = keyof typeof WEEKS;

/** A purchase, or a sale in a half-day from 0 (Monday AM) to 11 (Saturday PM). */
type DemoTrade = ['buy', number, number] | ['sell', number, number, number];

interface DemoWeek {
  /** Weeks before this one: 0 is this week. */
  ago: number;
  week: WeekName;
  trades?: DemoTrade[];
  /** How many half-days have prices; this week stops at the current one. */
  entered?: number;
}

const DEMO = {
  id: 'd0d0d0d0-0000-4000-8000-000000000001',
  name: 'Demo',
  code: 'DEMV-TYCN-2626',
};
const FRIENDS = {
  mabel: { id: 'd0d0d0d0-0000-4000-8000-000000000002', name: 'Mabel', code: 'MABL-TEST-2222' },
  pip: { id: 'd0d0d0d0-0000-4000-8000-000000000003', name: 'Pip', code: 'PPPP-TEST-3333' },
  quinn: { id: 'd0d0d0d0-0000-4000-8000-000000000004', name: 'Quinn', code: 'QWNN-TEST-4444' },
  lee: { id: 'd0d0d0d0-0000-4000-8000-000000000005', name: 'Lee', code: 'LEEE-TEST-5555' },
  tom: { id: 'd0d0d0d0-0000-4000-8000-000000000006', name: 'Tom', code: 'TMMM-TEST-6666' },
};
const GROUP = {
  id: 'd0d0d0d0-0000-4000-8000-0000000000a1',
  name: 'Turnip crew',
  code: 'TEST-GRPS-2345',
};

/** Ten weeks of trading: big wins, a loss with rotted turnips, and a week with no trades. */
const DEMO_WEEKS: DemoWeek[] = [
  {
    ago: 0,
    week: 'largeSpike',
    trades: [
      ['buy', 4000, 95],
      ['buy', 2000, 95],
      ['sell', 1000, 84, 0],
    ],
  },
  {
    ago: 1,
    week: 'largeSpike',
    trades: [
      ['buy', 6000, 95],
      ['sell', 6000, 494, 5],
    ],
  },
  {
    ago: 2,
    week: 'decreasing',
    trades: [
      ['buy', 3000, 102],
      ['sell', 1000, 90, 0],
    ],
  },
  {
    ago: 3,
    week: 'fluctuating',
    trades: [
      ['buy', 4000, 91],
      ['sell', 2000, 119, 1],
      ['sell', 2000, 123, 6],
    ],
  },
  {
    ago: 4,
    week: 'smallSpike',
    trades: [
      ['buy', 5000, 104],
      ['sell', 5000, 188, 6],
    ],
  },
  { ago: 5, week: 'decreasing', entered: 2 },
  {
    ago: 6,
    week: 'earlySpike',
    trades: [
      ['buy', 8000, 93],
      ['sell', 4000, 512, 3],
      ['sell', 4000, 168, 4],
    ],
  },
  { ago: 7, week: 'decreasing', trades: [['buy', 2000, 102]] },
  {
    ago: 8,
    week: 'fluctuating',
    trades: [
      ['buy', 4000, 91],
      ['sell', 4000, 110, 4],
    ],
  },
  {
    ago: 9,
    week: 'smallSpike',
    trades: [
      ['buy', 3000, 104],
      ['sell', 3000, 176, 7],
    ],
  },
];

export async function seedDemo(url: string, now = new Date()): Promise<void> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  const thisWeek = currentWeekStart(now);
  const slot = currentSlot(now);
  // On Sunday no selling half-day has started; otherwise this week runs up to the current one.
  const enteredNow = slot === null ? 0 : slot + 1;
  const ids = [DEMO, ...Object.values(FRIENDS)].map((player) => player.id);

  async function insertWeek(
    playerId: string,
    { ago, week, trades = [], entered = 12 }: DemoWeek,
    previous: PatternId | null,
  ) {
    const { purchase, prices } = WEEKS[week];
    const shown = Math.max(0, ago === 0 ? Math.min(entered, enteredNow) : entered);
    const {
      rows: [{ id }],
    } = await client.query<{ id: string }>(
      `insert into ${SCHEMA}.weeks (player_id, week_start, purchase_price, first_buy, previous_pattern, revision)
       values ($1, $2, $3, false, $4, 1) returning id`,
      [playerId, shiftWeek(thisWeek, -ago), purchase, previous],
    );
    for (const [index, price] of prices.slice(0, shown).entries())
      await client.query(
        `insert into ${SCHEMA}.price_entries (week_id, player_id, day, slot, price, revision)
         values ($1, $2, $3, $4, $5, 1)`,
        [id, playerId, Math.floor(index / 2) + 1, index % 2 ? 'PM' : 'AM', price],
      );
    // This week's sales can't come before the current half-day.
    const allowed = trades.filter(
      (trade) => trade[0] === 'buy' || ago > 0 || (slot !== null && trade[3] <= slot),
    );
    for (const [position, trade] of allowed.entries())
      await client.query(
        `insert into ${SCHEMA}.trades (week_id, player_id, id, position, kind, quantity, price, day, slot, revision)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)`,
        [
          id,
          playerId,
          randomUUID(),
          position,
          trade[0],
          trade[1],
          trade[2],
          trade[0] === 'sell' ? Math.floor(trade[3] / 2) + 1 : null,
          trade[0] === 'sell' ? (trade[3] % 2 ? 'PM' : 'AM') : null,
        ],
      );
  }

  /** Weeks run newest first; each one's previous pattern is the next older week's. */
  async function insertWeeks(playerId: string, weeks: DemoWeek[]) {
    for (const [index, week] of weeks.entries()) {
      const older = weeks[index + 1];
      await insertWeek(playerId, week, older ? WEEKS[older.week].pattern : null);
    }
  }

  await client.connect();
  try {
    await client.query('begin');
    // Deleting the players removes their device, weeks, trades, memberships and friend links.
    await client.query(`delete from ${SCHEMA}.players where id = any($1::uuid[])`, [ids]);
    await client.query(`delete from ${SCHEMA}.groups where id = $1`, [GROUP.id]);
    for (const player of [DEMO, ...Object.values(FRIENDS)])
      await client.query(
        `insert into ${SCHEMA}.players (id, display_name, friend_code) values ($1, $2, $3)`,
        [player.id, player.name, player.code],
      );
    await client.query(
      `insert into ${SCHEMA}.devices (player_id, name, token_hash, expires_at)
       values ($1, 'Demo browser', $2, clock_timestamp() + $3 * interval '1 day')`,
      [DEMO.id, createHash('sha256').update(DEMO_SESSION_TOKEN).digest('hex'), SESSION_DAYS],
    );

    // Friends both ways with Mabel, Pip and Quinn; Lee shares through the group only, and
    // Tom's friend request is still waiting for an answer.
    const { mabel, pip, quinn, lee, tom } = FRIENDS;
    for (const friend of [mabel, pip, quinn])
      await client.query(
        `insert into ${SCHEMA}.friend_links (player_id, friend_id) values ($1, $2), ($2, $1)`,
        [DEMO.id, friend.id],
      );
    await client.query(
      `insert into ${SCHEMA}.friend_links (player_id, friend_id) values ($1, $2)`,
      [tom.id, DEMO.id],
    );
    await client.query(`insert into ${SCHEMA}.groups (id, share_code, name) values ($1, $2, $3)`, [
      GROUP.id,
      GROUP.code,
      GROUP.name,
    ]);
    for (const member of [DEMO, mabel, lee])
      await client.query(
        `insert into ${SCHEMA}.memberships (group_id, player_id) values ($1, $2)`,
        [GROUP.id, member.id],
      );

    await insertWeeks(DEMO.id, DEMO_WEEKS);
    // Mabel has this week's best price; Quinn hasn't shared the current half-day yet.
    await insertWeeks(mabel.id, [
      { ago: 0, week: 'earlySpike' },
      { ago: 1, week: 'largeSpike' },
      { ago: 2, week: 'decreasing' },
    ]);
    await insertWeeks(pip.id, [
      { ago: 0, week: 'decreasing' },
      { ago: 1, week: 'fluctuating' },
      { ago: 2, week: 'smallSpike' },
    ]);
    await insertWeeks(quinn.id, [{ ago: 0, week: 'fluctuating', entered: enteredNow - 1 }]);
    await insertWeeks(lee.id, [{ ago: 0, week: 'smallSpike' }]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
