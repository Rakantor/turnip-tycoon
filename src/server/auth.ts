import { and, eq, gt, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { transaction, type Database, type Transaction } from '../db/connection';
import { devices, players, recoveryCredentials } from '../db/schema';
import type { AppEnvironment } from './app';
import { ApiError } from './errors';
import { readCredential, SESSION_SECONDS } from './http';
import { hashSecret, randomToken } from './secrets';

export async function sessionHash(c: Context<AppEnvironment>): Promise<string> {
  const token = readCredential(c, 'session');
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Connect a device to continue.');
  return hashSecret(token);
}

export async function findSession(db: Database | Transaction, tokenHash: string) {
  const [session] = await db
    .select({
      player: players,
      deviceId: devices.id,
      hasRecoveryCode: sql<boolean>`exists(select 1 from ${recoveryCredentials} where ${recoveryCredentials.playerId} = ${players.id})`,
    })
    .from(devices)
    .innerJoin(players, eq(players.id, devices.playerId))
    .where(and(eq(devices.tokenHash, tokenHash), gt(devices.expiresAt, sql`clock_timestamp()`)));
  if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'This device is no longer connected.');
  return session;
}

export async function lockPlayer(tx: Transaction, playerId: string): Promise<void> {
  const [player] = await tx
    .select({ id: players.id })
    .from(players)
    .where(eq(players.id, playerId))
    .for('update');
  if (!player) throw new ApiError(401, 'UNAUTHENTICATED', 'This player is no longer available.');
}

// All access-changing operations take this same lock before touching credentials.
// Rechecking after the lock prevents an in-flight revoked device from making edits.
export async function withSession<T>(
  db: Database,
  tokenHash: string,
  work: (tx: Transaction, session: Awaited<ReturnType<typeof findSession>>) => Promise<T>,
): Promise<T> {
  return transaction(db, async (tx) => {
    const candidate = await findSession(tx, tokenHash);
    await lockPlayer(tx, candidate.player.id);
    return work(tx, await findSession(tx, tokenHash));
  });
}

export async function newDevice(tx: Transaction, playerId: string, name: string) {
  const token = randomToken();
  const [device] = await tx
    .insert(devices)
    .values({
      playerId,
      name,
      tokenHash: await hashSecret(token),
      expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
    })
    .returning({ id: devices.id });
  return { token, deviceId: device.id };
}
