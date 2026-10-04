import { useEffect, useSyncExternalStore } from 'react';
import type { SessionResponse } from '../../shared/api';
import type { GroupSummary, GroupsResponse } from '../../shared/groups';
import { request } from './api';
import { database } from './database';
import { activeIdentity } from './runtime';

type GroupState = GroupsResponse & {
  status: 'loading' | 'ready' | 'offline' | 'error';
  error: string | null;
  lastRefreshedAt: number | null;
  refreshAvailableAt: number;
};
interface GroupStore {
  owner: string;
  weekStart: string;
  state: GroupState;
  loaded: boolean;
  generation: number;
  pending: Promise<void> | null;
  listeners: Set<() => void>;
}
const stores = new Map<string, GroupStore>();
const empty: GroupState = {
  groups: [],
  players: [],
  status: 'loading',
  error: null,
  lastRefreshedAt: null,
  refreshAvailableAt: 0,
};
const offline: GroupState = { ...empty, status: 'offline' };
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
    throw new Error('Connect to your player before updating friends.');
  }
}

/** Shared prices are never stored offline as proof of continuing group access. */
export function clearSharedGroups(owner: string) {
  for (const store of stores.values()) {
    if (store.owner !== owner) continue;
    store.loaded = false;
    store.generation++;
    publish(store, { groups: [], players: [], status: 'loading', error: null });
  }
}

async function fetchGroups(store: GroupStore, manual = false): Promise<void> {
  if (store.pending) return store.pending;
  if (manual && store.loaded && Date.now() < store.state.refreshAvailableAt) return;
  const generation = store.generation;
  store.pending = (async () => {
    try {
      assertOwner(store.owner);
      publish(store, { status: 'loading', error: null });
      let previous = 0;
      try {
        const record = await database.meta.get(cooldownKey(store.owner));
        previous = typeof record?.value === 'number' ? record.value : 0;
      } catch {
        /* Read-only sharing also works when browser storage is unavailable. */
      }
      if (manual && store.loaded && Date.now() < previous) {
        publish(store, { status: 'ready', refreshAvailableAt: previous });
        return;
      }
      assertOwner(store.owner);
      if (generation !== store.generation) return;
      const result = await request<GroupsResponse>(`/groups?weekStart=${store.weekStart}`);
      assertOwner(store.owner);
      if (generation !== store.generation) return;
      const now = Date.now();
      const available = Math.max(previous, now + 60_000);
      // A player shared through two groups appears once in the combined list.
      const players = [
        ...new Map(result.players.map((entry) => [entry.player.id, entry])).values(),
      ];
      store.loaded = true;
      publish(store, {
        groups: result.groups,
        players,
        status: 'ready',
        error: null,
        lastRefreshedAt: now,
        refreshAvailableAt: available,
      });
      try {
        await database.meta.put({ key: cooldownKey(store.owner), value: available });
      } catch {
        /* A failed cooldown cache must not hide a successful response. */
      }
    } catch (error) {
      if (generation !== store.generation) return;
      store.loaded = false;
      // A failed authorization check must never leave another player's prices visible.
      publish(store, {
        groups: [],
        players: [],
        status: navigator.onLine ? 'error' : 'offline',
        error: error instanceof Error ? error.message : 'Could not load your groups.',
      });
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

export function useGroups(weekStart: string, session: SessionResponse | null, connected: boolean) {
  const owner = session?.player.id ?? '';
  const store = storeFor(owner, weekStart);
  const state = useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    () => (connected ? store.state : session ? offline : empty),
  );
  useEffect(() => {
    if (connected && owner && !store.loaded) void fetchGroups(store);
    if (!connected && owner) clearSharedGroups(owner);
    return () => {
      // Returning to a shared view must re-establish membership, including after
      // a profile switch performed while the Settings route was open.
      if (owner) clearSharedGroups(owner);
    };
  }, [connected, owner, store]);

  async function change(path: string, method: string, body?: unknown) {
    assertOwner(owner);
    const result = await request<{ group: GroupSummary }>(path, { method, body });
    assertOwner(owner);
    clearSharedGroups(owner);
    if (store.pending) await store.pending;
    if (!store.loaded) await fetchGroups(store);
    return result.group;
  }
  return {
    ...state,
    refresh: () => fetchGroups(store, true),
    create: (name: string) => change('/groups', 'POST', { name }),
    join: (code: string) => change('/groups/join', 'POST', { code }),
    leave: async (id: string) => {
      await change(`/groups/${id}/membership`, 'DELETE');
    },
  };
}
