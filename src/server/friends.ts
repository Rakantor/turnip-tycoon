import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Hono } from 'hono';
import type { Transaction } from '../db/connection';
import { friendInvites, friendLinks, players } from '../db/schema';
import type { Player } from '../shared/api';
import type {
  FriendInvitePreview,
  FriendRequest,
  FriendRequests,
  FriendResult,
} from '../shared/groups';
import type { AppEnvironment } from './app';
import { sessionHash, withSession } from './auth';
import { ApiError } from './errors';
import { readJson } from './http';
import { formatCode, hashSecret } from './secrets';
import { friendCodeInput, friendInviteInput, parseId } from './validation';

// Friends and the requests you're waiting on count together, so the island board stays readable.
export const FRIEND_LIMIT = 50;
/** A shared friend link works once, for this many days. */
export const FRIEND_INVITE_DAYS = 7;
/** Only a player's newest links stay usable. */
export const FRIEND_INVITE_LIMIT = 20;

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

/**
 * Profile deletion takes these after its group locks, matching shared reads, and then its
 * friend links, so a link being accepted finishes before the player is gone.
 */
export async function lockFriends(tx: Transaction, playerId: string): Promise<void> {
  await lockLinks(tx, involving(playerId), 'update');
  await tx
    .select({ id: friendInvites.id })
    .from(friendInvites)
    .where(eq(friendInvites.playerId, playerId))
    .orderBy(asc(friendInvites.id))
    .for('update');
}

const ownLimit = () =>
  new ApiError(
    409,
    'FRIEND_LIMIT',
    `You can have up to ${FRIEND_LIMIT} friends and requests. Remove one to add another.`,
  );
const linkUnavailable = () =>
  new ApiError(
    404,
    'FRIEND_LINK_UNAVAILABLE',
    'This friend link expired or was already used. Ask for a new one.',
  );
const usable = (codeHash: string) =>
  and(eq(friendInvites.codeHash, codeHash), gt(friendInvites.expiresAt, sql`clock_timestamp()`));

/** Adds one direction of a link, within the limit of the player it belongs to. */
async function link(
  tx: Transaction,
  playerId: string,
  friendId: string,
  full: () => ApiError,
): Promise<boolean> {
  const [existing] = await tx
    .select({ playerId: friendLinks.playerId })
    .from(friendLinks)
    .where(sentBy(playerId, friendId));
  if (existing) return false;
  const [row] = await tx
    .select({ total: count() })
    .from(friendLinks)
    .where(eq(friendLinks.playerId, playerId));
  if (row.total >= FRIEND_LIMIT) throw full();
  await tx.insert(friendLinks).values({ playerId, friendId }).onConflictDoNothing();
  return true;
}

/** Asks to share with a player, or accepts their request when they already asked. */
async function addLink(tx: Transaction, playerId: string, friend: Player): Promise<FriendResult> {
  await link(tx, playerId, friend.id, ownLimit);
  const [reverse] = await tx
    .select({ playerId: friendLinks.playerId })
    .from(friendLinks)
    .where(sentBy(friend.id, playerId));
  return { player: friend, status: reverse ? 'friends' : 'requested' };
}

/** Asks the player with this friend code to be friends; null when nobody has it. */
export async function requestFriend(
  tx: Transaction,
  playerId: string,
  friendCode: string,
): Promise<FriendResult | null> {
  // Holding the row keeps a profile deletion from slipping in before the request.
  const [player] = await tx
    .select()
    .from(players)
    .where(eq(players.friendCode, friendCode))
    .for('key share');
  if (!player) return null;
  if (player.id === playerId)
    throw new ApiError(
      400,
      'OWN_FRIEND_CODE',
      'This is your own friend code. Enter a friend’s code instead.',
    );
  return addLink(tx, playerId, player);
}

export function registerFriendRoutes(app: Hono<AppEnvironment>): void {
  // A friend code only sends a request: nothing is shared until the other player accepts.
  app.post('/api/friends', async (c) => {
    const input = await readJson(c, friendCodeInput);
    const friend = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const result = await requestFriend(tx, session.player.id, formatCode(input.code));
      if (!result)
        throw new ApiError(
          404,
          'FRIEND_CODE_UNAVAILABLE',
          'No player has this friend code. Check the code and try again.',
        );
      return result;
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

  // The app makes up each link's code, so the share sheet can open in the same tap.
  // Only the code's hash is kept, like every other secret.
  app.post('/api/friends/invites', async (c) => {
    const input = await readJson(c, friendInviteInput);
    const codeHash = await hashSecret(input.code);
    const invite = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const newest = tx
        .select({ id: friendInvites.id })
        .from(friendInvites)
        .where(eq(friendInvites.playerId, session.player.id))
        .orderBy(desc(friendInvites.createdAt), desc(friendInvites.id))
        .limit(FRIEND_INVITE_LIMIT - 1);
      await tx
        .delete(friendInvites)
        .where(
          and(
            eq(friendInvites.playerId, session.player.id),
            or(
              lte(friendInvites.expiresAt, sql`clock_timestamp()`),
              notInArray(friendInvites.id, newest),
            ),
          ),
        );
      const [created] = await tx
        .insert(friendInvites)
        .values({
          codeHash,
          playerId: session.player.id,
          expiresAt: sql`clock_timestamp() + ${FRIEND_INVITE_DAYS} * interval '1 day'`,
        })
        .onConflictDoNothing()
        .returning({ expiresAt: friendInvites.expiresAt });
      if (!created) throw new ApiError(409, 'TRY_AGAIN', 'Please share your friend link again.');
      return created;
    });
    return c.json({ expiresAt: invite.expiresAt }, 201);
  });

  // Like a group invite, a friend link shows whose it is before the visitor has a profile.
  app.get('/api/friends/invites/preview', async (c) => {
    const code = friendInviteInput.shape.code.safeParse(c.req.query('code') ?? '');
    if (!code.success) throw linkUnavailable();
    const [row] = await c
      .get('db')
      .select({
        id: players.id,
        displayName: players.displayName,
        expiresAt: friendInvites.expiresAt,
      })
      .from(friendInvites)
      .innerJoin(players, eq(players.id, friendInvites.playerId))
      .where(usable(await hashSecret(code.data)));
    if (!row) throw linkUnavailable();
    const preview: FriendInvitePreview = {
      player: { id: row.id, displayName: row.displayName },
      expiresAt: row.expiresAt.toISOString(),
    };
    return c.json(preview);
  });

  // Sharing the link was the other player's request, so accepting it adds both sides at once.
  app.post('/api/friends/invites/accept', async (c) => {
    const input = await readJson(c, friendInviteInput);
    const codeHash = await hashSecret(input.code);
    const friend = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      // Holding the link keeps two people from both using it.
      const [invite] = await tx.select().from(friendInvites).where(usable(codeHash)).for('update');
      if (!invite) throw linkUnavailable();
      if (invite.playerId === session.player.id)
        throw new ApiError(
          400,
          'OWN_FRIEND_LINK',
          'This is your own friend link. Share it with a friend instead.',
        );
      const [player] = await tx.select().from(players).where(eq(players.id, invite.playerId));
      const theirs = await link(
        tx,
        invite.playerId,
        session.player.id,
        () => new ApiError(409, 'FRIEND_LIMIT', 'This player can’t add more friends right now.'),
      );
      const yours = await link(tx, session.player.id, invite.playerId, ownLimit);
      // Already friends: the link stays for whoever it was meant for.
      if (theirs || yours) await tx.delete(friendInvites).where(eq(friendInvites.id, invite.id));
      return { player, status: 'friends' } satisfies FriendResult;
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
