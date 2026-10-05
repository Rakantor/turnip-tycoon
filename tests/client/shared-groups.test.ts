import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { GroupsResponse, SharedPlayerWeek } from '../../src/shared/groups';
import { emptyWeek } from '../../src/shared/week';
import { TurnipDatabase } from '../../src/client/data/database';
import {
  SharedGroupsCache,
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
};

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
    await cache.write('me', '2026-10-11', { groups: groups.groups, players: [] });
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
    await cache.update('me', (data) => withoutGroup(data, 'club'));
    const left = await cache.read('me', week);
    expect(left?.groups.map(({ id }) => id)).toEqual(['crew']);
    expect(left?.players.map(({ player }) => player.id)).toEqual(['me', 'rosa']);
    expect(left?.players[0].groupIds).toEqual(['crew']);
    expect(withoutGroup(left!, 'crew')).toEqual({ groups: [], players: [] });
  });

  it('drops one friend who is no longer reachable', () => {
    expect(withoutPlayer(groups, 'rosa').players.map(({ player }) => player.id)).toEqual([
      'me',
      'jun',
    ]);
  });
});
