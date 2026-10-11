import { useEffect, useSyncExternalStore } from 'react';
import { t } from '@lingui/core/macro';
import type { SessionResponse } from '../../shared/api';
import type {
  FriendResult,
  GroupSummary,
  GroupsResponse,
  SharedPlayerWeek,
} from '../../shared/groups';
import { ApiError, request } from './api';
import { database } from './database';
import { activeIdentity } from './runtime';
import type { IdentityState } from './session-controller';
import { SharedGroupsCache, withoutFriend, withoutGroup, withoutPlayer } from './shared-groups';
import { writeForProfile } from './profile-storage';

type GroupState = GroupsResponse & {
  status: 'loading' | 'ready' | 'offline' | 'error';
  error: string | null;
  /** The device copy has been read, whether or not one existed. */
  hydrated: boolean;
};
interface GroupStore {
  owner: string;
  weekStart: string;
  state: GroupState;
  loaded: boolean;
  generation: number;
  /** Bumped by every server response or removal, so a slower device read can't undo it. */
  version: number;
  hydrating: Promise<void> | null;
  /** Prices on screen came from this device's copy or a server response. */
  saved: boolean;
  pending: Promise<void> | null;
  listeners: Set<() => void>;
}
const stores = new Map<string, GroupStore>();
const cache = new SharedGroupsCache(database);
const nobody: GroupsResponse = {
  groups: [],
  players: [],
  friendIds: [],
  requests: { received: [], sent: [] },
};
const empty: GroupState = {
  ...nobody,
  status: 'loading',
  error: null,
  hydrated: false,
};
const cooldownKey = (owner: string) => `groups-refresh:${owner}`;
function storeFor(owner: string, weekStart: string): GroupStore {
  const key = `${owner}:${weekStart}`;
  let store = stores.get(key);
  if (!store) {
    store = {
      owner,
      weekStart,
      state: empty,
      loaded: false,
      generation: 0,
      version: 0,
      hydrating: null,
      saved: false,
      pending: null,
      listeners: new Set(),
    };
    stores.set(key, store);
  }
  return store;
}
function publish(store: GroupStore, patch: Partial<GroupState>) {
  store.state = { ...store.state, ...patch };
  for (const listener of store.listeners) listener();
}
function assertOwner(owner: string) {
  if (!activeIdentity.connected || activeIdentity.owner !== owner) {
    throw new Error(t`Connect to your player before updating friends.`);
  }
}

function hydrate(store: GroupStore): Promise<void> {
  store.hydrating ??= (async () => {
    const version = store.version;
    let saved: GroupsResponse | null = null;
    try {
      saved = await cache.read(store.owner, store.weekStart);
    } catch {
      /* Without browser storage, friends' prices load online only. */
    }
    if (version === store.version && saved) store.saved = true;
    publish(
      store,
      version === store.version && saved ? { ...saved, hydrated: true } : { hydrated: true },
    );
  })();
  return store.hydrating;
}

/** Returning to a shared view re-checks membership, but keeps showing what we have. */
function invalidate(store: GroupStore) {
  store.loaded = false;
  store.generation++;
}

/** Lost access must never leave another player's prices visible, even offline. */
async function forget(owner: string, failed?: GroupStore): Promise<void> {
  for (const store of stores.values()) {
    if (store.owner !== owner) continue;
    // The request that discovered the loss must not retry itself.
    if (store === failed) store.loaded = false;
    else invalidate(store);
    store.version++;
    store.saved = false;
    publish(store, { ...nobody, hydrated: true });
  }
  await cache.forget(owner);
}
export const forgetSharedGroups = (owner: string) => forget(owner);

/** A player who no longer shares prices through any group or friendship disappears straight away. */
export async function forgetSharedPlayer(owner: string, playerId: string): Promise<void> {
  for (const store of stores.values()) {
    if (store.owner !== owner) continue;
    invalidate(store);
    store.version++;
    publish(store, withoutPlayer(store.state, playerId, owner));
  }
  await cache.update(owner, (data) => withoutPlayer(data, playerId, owner));
}

/** This week's saved entry for one friend, for reading their week offline. */
export async function savedPlayerWeek(
  owner: string,
  weekStart: string,
  playerId: string,
): Promise<SharedPlayerWeek | null> {
  const store = storeFor(owner, weekStart);
  await hydrate(store);
  return store.state.players.find((entry) => entry.player.id === playerId) ?? null;
}

/**
 * Opening a shared view reads the server at most once a minute, silently, while
 * saved prices can be shown instead. Group changes and retries always read now.
 */
async function fetchGroups(store: GroupStore, quiet = false): Promise<void> {
  if (store.pending) return store.pending;
  const generation = store.generation;
  store.pending = (async () => {
    try {
      assertOwner(store.owner);
      let previous = 0;
      try {
        const record = await database.meta.get(cooldownKey(store.owner));
        previous = typeof record?.value === 'number' ? record.value : 0;
      } catch {
        /* Read-only sharing also works when browser storage is unavailable. */
      }
      // A limit further ahead than a minute means the clock moved back; ignore it.
      if (quiet && Date.now() < previous && previous <= Date.now() + 60_000) {
        await hydrate(store);
        if (store.saved) {
          publish(store, { status: 'ready', error: null });
          return;
        }
      }
      publish(store, { status: 'loading', error: null });
      assertOwner(store.owner);
      if (generation !== store.generation) return;
      const result = await request<GroupsResponse>(`/groups?weekStart=${store.weekStart}`);
      assertOwner(store.owner);
      if (generation !== store.generation) return;
      const available = Date.now() + 60_000;
      // A player shared through two groups appears once in the combined list.
      const players = [
        ...new Map(result.players.map((entry) => [entry.player.id, entry])).values(),
      ];
      const data: GroupsResponse = {
        groups: result.groups,
        players,
        // An API from before friend codes sends neither.
        friendIds: result.friendIds ?? [],
        requests: result.requests ?? nobody.requests,
      };
      store.loaded = true;
      store.saved = true;
      store.version++;
      publish(store, { ...data, status: 'ready', error: null, hydrated: true });
      try {
        await cache.write(store.owner, store.weekStart, data);
      } catch {
        /* Friends then stay available online only. */
      }
      try {
        await writeForProfile(database, store.owner, [], async () => {
          await database.meta.put({ key: cooldownKey(store.owner), value: available });
        });
      } catch {
        /* A failed cooldown cache must not hide a successful response. */
      }
    } catch (error) {
      if (generation !== store.generation) return;
      store.loaded = false;
      const message = error instanceof Error ? error.message : t`Could not load your friends.`;
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        await forget(store.owner, store).catch(() => undefined);
        publish(store, { status: 'error', error: message });
        return;
      }
      // Without a connection, the prices already on screen stay readable.
      publish(
        store,
        navigator.onLine ? { status: 'error', error: message } : { status: 'offline', error: null },
      );
    }
  })();
  try {
    await store.pending;
  } finally {
    store.pending = null;
    if (
      generation !== store.generation &&
      activeIdentity.connected &&
      activeIdentity.owner === store.owner &&
      store.listeners.size > 0
    ) {
      await fetchGroups(store);
    }
  }
}

export function useGroups(
  weekStart: string,
  session: SessionResponse | null,
  identity: IdentityState['status'],
) {
  const owner = session?.player.id ?? '';
  const connected = identity === 'ready';
  const store = storeFor(owner, weekStart);
  const state = useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    () => store.state,
  );
  useEffect(() => {
    if (!owner) return;
    void hydrate(store);
    if (connected && !store.loaded) void fetchGroups(store, true);
    if (!connected) invalidate(store);
    return () => invalidate(store);
  }, [connected, owner, store]);

  /** Sends a change, applies what it removes locally straight away, then reads the server. */
  async function change<T>(
    path: string,
    method: string,
    body?: unknown,
    removed?: (data: GroupsResponse) => GroupsResponse,
  ): Promise<T> {
    assertOwner(owner);
    const result = await request<T>(path, { method, body });
    assertOwner(owner);
    invalidate(store);
    if (removed) {
      store.version++;
      publish(store, removed(store.state));
      await cache.update(owner, removed).catch(() => undefined);
    }
    if (store.pending) await store.pending;
    if (!store.loaded) await fetchGroups(store);
    return result;
  }
  const changeGroup = async (path: string, body: unknown) =>
    (await change<{ group: GroupSummary }>(path, 'POST', body)).group;
  const changeFriend = async (path: string, method: string, body?: unknown) =>
    (await change<{ friend: FriendResult }>(path, method, body)).friend;
  const status: GroupState['status'] = connected
    ? state.status
    : identity === 'connecting' || (owner && !state.hydrated)
      ? 'loading'
      : 'offline';
  return {
    ...state,
    ...(connected ? {} : { status, error: null }),
    /** Reads the server now, past the once-a-minute limit, e.g. after an error. */
    retry: () => fetchGroups(store),
    create: (name: string) => changeGroup('/groups', { name }),
    join: (code: string) => changeGroup('/groups/join', { code }),
    leave: async (id: string) => {
      await change(`/groups/${id}/membership`, 'DELETE', undefined, (data) =>
        withoutGroup(data, id, owner),
      );
    },
    /** Sends a friend request, or accepts theirs if they already asked you. */
    addFriend: (code: string) => changeFriend('/friends', 'POST', { code }),
    acceptFriend: (playerId: string) => changeFriend(`/friends/${playerId}`, 'PUT'),
    /** Removes a friend, or declines or withdraws a request. */
    removeFriend: async (playerId: string) => {
      await change(`/friends/${playerId}`, 'DELETE', undefined, (data) =>
        withoutFriend(data, playerId, owner),
      );
    },
  };
}
