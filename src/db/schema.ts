import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// This schema is deliberately outside Supabase's exposed public schema.
export const privateSchema = pgSchema('turnip_private');

export const players = privateSchema
  .table(
    'players',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      displayName: text('display_name').notNull(),
      islandName: text('island_name'),
      friendCode: text('friend_code').notNull().unique(),
    },
    (table) => [
      check('players_display_name_length', sql`char_length(${table.displayName}) between 1 and 40`),
      check(
        'players_island_name_length',
        sql`${table.islandName} is null or char_length(${table.islandName}) between 1 and 40`,
      ),
      check(
        'players_friend_code_format',
        sql`${table.friendCode} ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$'`,
      ),
    ],
  )
  .enableRLS();

export const devices = privateSchema
  .table(
    'devices',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      playerId: uuid('player_id')
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
      name: text('name').notNull(),
      tokenHash: text('token_hash').notNull().unique(),
      createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (table) => [
      index('devices_player_idx').on(table.playerId),
      unique('devices_id_player_unique').on(table.id, table.playerId),
      check('devices_name_length', sql`char_length(${table.name}) between 1 and 60`),
      check('devices_token_hash_format', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
      check('devices_expiry', sql`${table.expiresAt} > ${table.createdAt}`),
    ],
  )
  .enableRLS();

export const recoveryCredentials = privateSchema
  .table(
    'recovery_credentials',
    {
      playerId: uuid('player_id')
        .primaryKey()
        .references(() => players.id, { onDelete: 'cascade' }),
      codeHash: text('code_hash').notNull().unique(),
    },
    (table) => [check('recovery_hash_format', sql`${table.codeHash} ~ '^[0-9a-f]{64}$'`)],
  )
  .enableRLS();

export const pairingChallenges = privateSchema
  .table(
    'pairing_challenges',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      codeHash: text('code_hash').notNull().unique(),
      claimHash: text('claim_hash').notNull().unique(),
      deviceName: text('device_name').notNull(),
      playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }),
      approvedByDeviceId: uuid('approved_by_device_id'),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (table) => [
      index('pairing_expiry_idx').on(table.expiresAt),
      foreignKey({
        columns: [table.approvedByDeviceId, table.playerId],
        foreignColumns: [devices.id, devices.playerId],
      }).onDelete('cascade'),
      check(
        'pairing_approval_consistency',
        sql`(${table.playerId} is null) = (${table.approvedByDeviceId} is null)`,
      ),
      check('pairing_device_name_length', sql`char_length(${table.deviceName}) between 1 and 60`),
      check('pairing_code_hash_format', sql`${table.codeHash} ~ '^[0-9a-f]{64}$'`),
      check('pairing_claim_hash_format', sql`${table.claimHash} ~ '^[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();

// Group records remain separate from players' generated public friend codes.
export const groups = privateSchema
  .table('groups', {
    id: uuid('id').primaryKey().defaultRandom(),
    shareCode: text('share_code').notNull().unique(),
    name: text('name'),
  })
  .enableRLS();

export const memberships = privateSchema
  .table(
    'memberships',
    {
      groupId: uuid('group_id')
        .notNull()
        .references(() => groups.id, { onDelete: 'cascade' }),
      playerId: uuid('player_id')
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
    },
    (table) => [
      primaryKey({ columns: [table.groupId, table.playerId] }),
      index('memberships_player_group_idx').on(table.playerId, table.groupId),
    ],
  )
  .enableRLS();

export const weeks = privateSchema
  .table(
    'weeks',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      playerId: uuid('player_id')
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
      weekStart: date('week_start', { mode: 'string' }).notNull(),
      purchasePrice: integer('purchase_price'),
      firstBuy: boolean('first_buy'),
      previousPattern: text('previous_pattern'),
      revision: integer('revision').notNull().default(0),
    },
    (table) => [
      unique('weeks_player_start_unique').on(table.playerId, table.weekStart),
      unique('weeks_id_player_unique').on(table.id, table.playerId),
      check('weeks_start_sunday', sql`extract(dow from ${table.weekStart}) = 0`),
      check(
        'weeks_purchase_range',
        sql`${table.purchasePrice} is null or ${table.purchasePrice} between 90 and 110`,
      ),
      check(
        'weeks_previous_pattern',
        sql`${table.previousPattern} is null or ${table.previousPattern} in ('fluctuating', 'large-spike', 'decreasing', 'small-spike')`,
      ),
      check('weeks_revision_nonnegative', sql`${table.revision} >= 0`),
    ],
  )
  .enableRLS();

export const priceEntries = privateSchema
  .table(
    'price_entries',
    {
      weekId: uuid('week_id').notNull(),
      playerId: uuid('player_id').notNull(),
      day: integer('day').notNull(),
      slot: text('slot').notNull(),
      price: integer('price').notNull(),
      revision: integer('revision').notNull().default(0),
    },
    (table) => [
      primaryKey({ columns: [table.weekId, table.day, table.slot] }),
      foreignKey({
        columns: [table.weekId, table.playerId],
        foreignColumns: [weeks.id, weeks.playerId],
      }).onDelete('cascade'),
      check('prices_selling_day', sql`${table.day} between 1 and 6`),
      check('prices_slot', sql`${table.slot} in ('AM', 'PM')`),
      check('prices_range', sql`${table.price} between 1 and 660`),
      check('prices_revision_nonnegative', sql`${table.revision} >= 0`),
    ],
  )
  .enableRLS();

// A player's own purchases and sales. Shared reads never include them.
export const trades = privateSchema
  .table(
    'trades',
    {
      weekId: uuid('week_id').notNull(),
      playerId: uuid('player_id').notNull(),
      // Generated on the device, so an entry keeps its identity across edits and retries.
      id: uuid('id').notNull(),
      position: integer('position').notNull(),
      kind: text('kind').notNull(),
      quantity: integer('quantity').notNull(),
      price: integer('price').notNull(),
      // Sales only: Monday to Saturday and AM/PM, as in price entries.
      day: integer('day'),
      slot: text('slot'),
      revision: integer('revision').notNull().default(0),
    },
    (table) => [
      primaryKey({ columns: [table.weekId, table.id] }),
      unique('trades_week_position_unique').on(table.weekId, table.position),
      index('trades_player_idx').on(table.playerId),
      foreignKey({
        columns: [table.weekId, table.playerId],
        foreignColumns: [weeks.id, weeks.playerId],
      }).onDelete('cascade'),
      check('trades_kind', sql`${table.kind} in ('buy', 'sell')`),
      check('trades_position', sql`${table.position} between 0 and 39`),
      check(
        'trades_quantity',
        sql`${table.quantity} between 10 and 100000 and ${table.quantity} % 10 = 0`,
      ),
      check(
        'trades_price',
        sql`(${table.kind} = 'buy' and ${table.price} between 90 and 110) or (${table.kind} = 'sell' and ${table.price} between 9 and 660)`,
      ),
      // Spelled out with "is not null": a check that evaluates to null would pass.
      check(
        'trades_half_day',
        sql`(${table.kind} = 'buy' and ${table.day} is null and ${table.slot} is null) or (${table.kind} = 'sell' and ${table.day} is not null and ${table.slot} is not null and ${table.day} between 1 and 6 and ${table.slot} in ('AM', 'PM'))`,
      ),
      check('trades_revision_nonnegative', sql`${table.revision} >= 0`),
    ],
  )
  .enableRLS();

export const mutations = privateSchema
  .table(
    'mutations',
    {
      playerId: uuid('player_id')
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
      mutationId: uuid('mutation_id').notNull(),
      payloadHash: text('payload_hash').notNull(),
      resultingRevision: integer('resulting_revision').notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.playerId, table.mutationId] }),
      check('mutations_revision_nonnegative', sql`${table.resultingRevision} >= 0`),
    ],
  )
  .enableRLS();
