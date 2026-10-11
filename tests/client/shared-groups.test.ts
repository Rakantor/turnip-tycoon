import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { GroupsResponse, SharedPlayerWeek } from '../../src/shared/groups';
import { emptyWeek } from '../../src/shared/week';
import { TurnipDatabase } from '../../src/client/data/database';
import {
  SharedGroupsCache,
  withoutFriend,
  withoutGroup,
  withoutPlayer,
} from '../../src/client/data/shared-groups';

const databases: TurnipDatabase[] = [];
function makeCache() {
  const db = new TurnipDatabase(`shared-groups-test-${crypto.randomUUID()}`);
  databases.push(db);
  return { db, cache: new SharedGroupsCache(db) };
}
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

const week = '2026-10-04';
const group = (id: string) => ({ id, name: id, code: `CODE-${id}`, memberCount: 2, capacity: 8 });
const member = (id: string, groupIds: string[]): SharedPlayerWeek => ({
  player: { id, displayName: id, friendCode: id, islandName: null },
  week: { ...emptyWeek(id, week), prices: [98, ...Array.from({ length: 11 }, () => null)] },
  groupIds,
});
const groups: GroupsResponse = {
  groups: [group('crew'), group('club')],
  players: [member('me', ['crew', 'club']), member('rosa', ['crew']), member('jun', ['club'])],
  friendIds: [],
  requests: { received: [], sent: [] },
};
const request = (id: string) => ({ player: member(id, []).player, sentAt: '2026-10-05T10:00:00Z' });
/** Mika is a friend by code only; Jun is a friend and in the club too. */
const friends: GroupsResponse = {
  ...groups,
  players: [...groups.players, member('mika', [])],
  friendIds: ['mika', 'jun'],
  requests: { received: [request('kai')], sent: [request('lee')] },
};
const ids = (data: GroupsResponse | null) => data?.players.map(({ player }) => player.id);

describe('friends’ saved prices', () => {
  it('reads back this week’s groups, including codes, for the same profile only', async () => {
    const { cache } = makeCache();
    await cache.write('me', week, groups);
    expect(await cache.read('me', week)).toEqual(groups);
    expect((await cache.read('me', week))?.groups[0].code).toBe('CODE-crew');
    expect(await cache.read('someone-else', week)).toBeNull();
  });

  it('keeps one week per profile and shows nothing for a new week', async () => {
    const { db, cache } = makeCache();
    await cache.write('me', week, groups);
    expect(await cache.read('me', '2026-10-11')).toBeNull();
    await cache.write('me', '2026-10-11', { ...groups, players: [] });
    expect(await cache.read('me', week)).toBeNull();
    expect(await db.meta.where('key').startsWith('shared-groups:').count()).toBe(1);
  });

  it('forgets a profile’s friends without touching another profile', async () => {
    const { cache } = makeCache();
    await cache.write('me', week, groups);
    await cache.write('other', week, groups);
    await cache.forget('me');
    expect(await cache.read('me', week)).toBeNull();
    expect(await cache.read('other', week)).toEqual(groups);
  });

  it('ignores damaged saved values', async () => {
    const { db, cache } = makeCache();
    await db.meta.put({ key: 'shared-groups:me', value: { weekStart: week, groups: 'nope' } });
    expect(await cache.read('me', week)).toBeNull();
  });

  it('removes players who share no other group when leaving one', async () => {
    const { cache } = makeCache();
    await cache.write('me', week, groups);
    await cache.update('me', (data) => withoutGroup(data, 'club', 'me'));
    const left = await cache.read('me', week);
    expect(left?.groups.map(({ id }) => id)).toEqual(['crew']);
    expect(left?.players.map(({ player }) => player.id)).toEqual(['me', 'rosa']);
    expect(left?.players[0].groupIds).toEqual(['crew']);
    expect(withoutGroup(left!, 'crew', 'me')).toMatchObject({ groups: [], players: [] });
  });

  it('drops one friend who is no longer reachable', () => {
    expect(withoutPlayer(groups, 'rosa', 'me').players.map(({ player }) => player.id)).toEqual([
      'me',
      'jun',
    ]);
  });

  it('reads a copy saved before friend codes as having no friends or requests', async () => {
    const { db, cache } = makeCache();
    await db.meta.put({
      key: 'shared-groups:me',
      value: { weekStart: week, groups: groups.groups, players: groups.players },
    });
    expect(await cache.read('me', week)).toEqual(groups);
    await cache.update('me', (data) => withoutGroup(data, 'club', 'me'));
    expect(await cache.read('me', week)).toMatchObject({
      friendIds: [],
      requests: { received: [], sent: [] },
    });
  });

  it('saves friends and requests with the week', async () => {
    const { cache } = makeCache();
    await cache.write('me', week, friends);
    expect(await cache.read('me', week)).toEqual(friends);
  });

  it('keeps friends, and yourself beside them, after leaving every group', () => {
    const left = withoutGroup(withoutGroup(friends, 'club', 'me'), 'crew', 'me');
    expect(left.groups).toEqual([]);
    expect(ids(left)).toEqual(['me', 'jun', 'mika']);
    expect(left.friendIds).toEqual(['mika', 'jun']);
  });

  it('ends a friendship or request without dropping a shared group', () => {
    const unfriended = withoutFriend(friends, 'jun', 'me');
    expect(unfriended.friendIds).toEqual(['mika']);
    expect(ids(unfriended)).toEqual(['me', 'rosa', 'jun', 'mika']);
    const alone = withoutFriend(
      withoutGroup(withoutGroup(unfriended, 'club', 'me'), 'crew', 'me'),
      'mika',
      'me',
    );
    expect(alone).toMatchObject({ players: [], friendIds: [] });
    const answered = withoutFriend(withoutFriend(friends, 'kai', 'me'), 'lee', 'me');
    expect(answered.requests).toEqual({ received: [], sent: [] });
    expect(answered.players).toEqual(friends.players);
  });

  it('forgets a friend who stopped sharing', () => {
    const lost = withoutPlayer(friends, 'mika', 'me');
    expect(lost.friendIds).toEqual(['jun']);
    expect(ids(lost)).toEqual(['me', 'rosa', 'jun']);
  });
});
