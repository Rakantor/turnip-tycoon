import { and, asc, count, eq, inArray, or, type SQL } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { Transaction } from '../db/connection';
import { friendLinks, players } from '../db/schema';
import type { Player } from '../shared/api';
import type { FriendRequest, FriendRequests, FriendResult } from '../shared/groups';
import type { AppEnvironment } from './app';
import { sessionHash, withSession } from './auth';
import { ApiError } from './errors';
import { readJson } from './http';
import { formatCode } from './secrets';
import { friendCodeInput, parseId } from './validation';

// Friends and the requests you're waiting on count together, so the island board stays readable.
export const FRIEND_LIMIT = 50;

const sentBy = (playerId: string, friendId: string) =>
  and(eq(friendLinks.playerId, playerId), eq(friendLinks.friendId, friendId));
const between = (a: string, b: string) => or(sentBy(a, b), sentBy(b, a));
const involving = (playerId: string) =>
  or(eq(friendLinks.playerId, playerId), eq(friendLinks.friendId, playerId));

// Shared reads hold friend links as they hold groups, and always after them, in key order.
// Removing a friend or deleting a profile takes the matching update lock, so access is
// checked again after any concurrent change and cannot outlive that transaction.
function lockLinks(tx: Transaction, where: SQL | undefined, strength: 'share' | 'update') {
  return tx
    .select()
    .from(friendLinks)
    .where(where)
    .orderBy(asc(friendLinks.playerId), asc(friendLinks.friendId))
    .for(strength);
}

/** A player's friends and waiting requests, held until the transaction ends. */
export async function friendsOf(
  tx: Transaction,
  playerId: string,
): Promise<{ friendIds: string[]; requests: FriendRequests }> {
  const sent = new Map<string, Date>();
  const received = new Map<string, Date>();
  for (const link of await lockLinks(tx, involving(playerId), 'share')) {
    if (link.playerId === playerId) sent.set(link.friendId, link.createdAt);
    else received.set(link.playerId, link.createdAt);
  }
  const friendIds = [...sent.keys()].filter((id) => received.has(id));
  for (const id of friendIds) {
    sent.delete(id);
    received.delete(id);
  }
  const waiting = [...sent.keys(), ...received.keys()];
  const people = waiting.length
    ? await tx.select().from(players).where(inArray(players.id, waiting))
    : [];
  const byId = new Map(people.map((player) => [player.id, player]));
  const newestFirst = (links: Map<string, Date>): FriendRequest[] =>
    [...links]
      .sort(([, left], [, right]) => right.getTime() - left.getTime())
      .flatMap(([id, sentAt]) => {
        const player = byId.get(id);
        return player ? [{ player, sentAt: sentAt.toISOString() }] : [];
      });
  return { friendIds, requests: { received: newestFirst(received), sent: newestFirst(sent) } };
}

/** Whether two players are friends, holding both links through the shared read. */
export async function areFriends(tx: Transaction, a: string, b: string): Promise<boolean> {
  return (await lockLinks(tx, between(a, b), 'share')).length === 2;
}

/** Profile deletion takes these after its group locks, matching shared reads. */
export async function lockFriendLinks(tx: Transaction, playerId: string): Promise<void> {
  await lockLinks(tx, involving(playerId), 'update');
}

/** Asks to share with a player, or accepts their request when they already asked. */
async function addLink(tx: Transaction, playerId: string, friend: Player): Promise<FriendResult> {
  const [existing] = await tx
    .select({ playerId: friendLinks.playerId })
    .from(friendLinks)
    .where(sentBy(playerId, friend.id));
  if (!existing) {
    const [row] = await tx
      .select({ total: count() })
      .from(friendLinks)
      .where(eq(friendLinks.playerId, playerId));
    if (row.total >= FRIEND_LIMIT)
      throw new ApiError(
        409,
        'FRIEND_LIMIT',
        `You can have up to ${FRIEND_LIMIT} friends and requests. Remove one to add another.`,
      );
    await tx.insert(friendLinks).values({ playerId, friendId: friend.id }).onConflictDoNothing();
  }
  const [reverse] = await tx
    .select({ playerId: friendLinks.playerId })
    .from(friendLinks)
    .where(sentBy(friend.id, playerId));
  return { player: friend, status: reverse ? 'friends' : 'requested' };
}

export function registerFriendRoutes(app: Hono<AppEnvironment>): void {
  // A friend code only sends a request: nothing is shared until the other player accepts.
  app.post('/api/friends', async (c) => {
    const input = await readJson(c, friendCodeInput);
    const friend = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      // Holding the row keeps a profile deletion from slipping in before the request.
      const [player] = await tx
        .select()
        .from(players)
        .where(eq(players.friendCode, formatCode(input.code)))
        .for('key share');
      if (!player)
        throw new ApiError(
          404,
          'FRIEND_CODE_UNAVAILABLE',
          'No player has this friend code. Check the code and try again.',
        );
      if (player.id === session.player.id)
        throw new ApiError(
          400,
          'OWN_FRIEND_CODE',
          'This is your own friend code. Enter a friend’s code instead.',
        );
      return addLink(tx, session.player.id, player);
    });
    return c.json({ friend });
  });

  app.put('/api/friends/:playerId', async (c) => {
    const id = parseId(c.req.param('playerId'));
    const friend = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      // Their request stays held, so it can't be withdrawn halfway through accepting it.
      const [request] = await lockLinks(tx, sentBy(id, session.player.id), 'share');
      if (!request)
        throw new ApiError(
          404,
          'REQUEST_UNAVAILABLE',
          'This friend request is no longer available.',
        );
      const [player] = await tx.select().from(players).where(eq(players.id, id));
      return addLink(tx, session.player.id, player);
    });
    return c.json({ friend });
  });

  // Declining, withdrawing a request and removing a friend all end the link both ways.
  app.delete('/api/friends/:playerId', async (c) => {
    const id = parseId(c.req.param('playerId'));
    await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      await lockLinks(tx, between(session.player.id, id), 'update');
      await tx.delete(friendLinks).where(between(session.player.id, id));
    });
    return c.json({ ok: true });
  });
}
