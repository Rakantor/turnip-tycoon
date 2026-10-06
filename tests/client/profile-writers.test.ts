import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => [initial, () => {}],
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
import { database } from '../../src/client/data/database';
import { activeIdentity } from '../../src/client/data/runtime';
import { SessionVault } from '../../src/client/data/session-vault';
import { useWeek } from '../../src/client/data/use-week';
import { useGroups } from '../../src/client/data/use-groups';
import { SharedGroupsCache } from '../../src/client/data/shared-groups';
import { emptyOwnWeek } from '../../src/shared/week';
const week = '2026-10-04';
const owner = 'one';
const session = {
  player: { id: owner, displayName: owner, islandName: null, friendCode: owner },
  deviceId: 'device',
  hasRecoveryCode: false,
};
const vault = new SessionVault(database, false);
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  await database.open();
  await vault.save(session, null, null, () => true);
  activeIdentity.owner = owner;
  activeIdentity.connected = true;
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await database.delete();
  activeIdentity.owner = null;
  activeIdentity.connected = false;
});

it('does not recreate refresh metadata after a late week response', async () => {
  const entered = defer<void>(),
    remote = defer<Response>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      entered.resolve();
      return remote.promise;
    }),
  );
  const hook = useWeek(week, session, true);
  const work = hook.retry();
  await entered.promise;
  await vault.finishRemoval(owner, 'deleted');
  expect(await database.meta.get(`refresh:${owner}|${week}`)).toBeUndefined();
  activeIdentity.connected = false;
  remote.resolve(Response.json({ week: emptyOwnWeek(owner, week) }));
  await work;
  expect(await database.weeks.toArray()).toEqual([]);
  expect(await database.meta.get(`refresh:${owner}|${week}`)).toBeUndefined();
});

it('does not recreate cooldown metadata when cleanup follows a group response', async () => {
  const entered = defer<void>(),
    release = defer<void>();
  const original = SharedGroupsCache.prototype.write;
  vi.spyOn(SharedGroupsCache.prototype, 'write').mockImplementation(async function (
    this: SharedGroupsCache,
    ...args
  ) {
    entered.resolve();
    await release.promise;
    return original.apply(this, args);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ groups: [], players: [] })),
  );
  const hook = useGroups(week, session, 'ready');
  const work = hook.retry();
  await entered.promise;
  await vault.finishRemoval(owner, 'deleted');
  activeIdentity.connected = false;
  release.resolve();
  await work;
  expect(await database.meta.get('shared-groups:one')).toBeUndefined();
  expect(await database.meta.get('groups-refresh:one')).toBeUndefined();
});
