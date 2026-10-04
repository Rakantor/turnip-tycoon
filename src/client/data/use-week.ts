import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import type { SessionResponse } from '../../shared/api';
import { emptyWeek, type WeeklyInputs, type WeekRecord } from '../../shared/week';
import { ApiError } from './api';
import { database, type LocalWeek } from './database';
import { activeIdentity, weekStore } from './runtime';
import { weekKey } from './sync';
import { pendingEdits, withPendingEdits } from './pending-edits';

export type SaveStatus =
  'loading' | 'local' | 'syncing' | 'saved' | 'offline' | 'error' | 'conflict';
export function useWeek(weekStart: string, session: SessionResponse | null, connected: boolean) {
  const owner = session?.player.id ?? 'unassigned';
  const key = weekKey(owner, weekStart);
  const [local, setLocal] = useState<{ key: string; row?: LocalWeek; lastRefreshedAt?: number }>({
    key,
  });
  const [failure, setFailure] = useState<{ key: string; message: string; network: boolean } | null>(
    null,
  );
  const [syncing, setSyncing] = useState<string | null>(null);
  const row = local.key === key ? local.row : undefined;
  const pending = useSyncExternalStore(pendingEdits.subscribe, () =>
    pendingEdits.snapshot(owner, weekStart),
  );
  const displayedWeek = withPendingEdits(
    row?.data ?? emptyWeek(owner, weekStart),
    row?.version ?? -1,
    pending,
  );

  const reportFailure = useCallback(
    (error: unknown) => {
      setFailure({
        key,
        message:
          error instanceof ApiError
            ? error.message
            : error instanceof TypeError
              ? 'Saved on this device. Waiting to sync.'
              : 'Could not access saved prices on this device. Keep this page open and retry after checking browser storage.',
        network: error instanceof TypeError,
      });
    },
    [key],
  );

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [row, refresh] = await Promise.all([
        database.weeks.get(key),
        database.meta.get(`refresh:${key}`),
      ]);
      return { key, row, lastRefreshedAt: typeof refresh?.value === 'number' ? refresh.value : 0 };
    }).subscribe({
      next: (value) => {
        setLocal(value);
      },
      error: () => {
        setFailure({
          key,
          message:
            'This browser could not save prices locally. Check its storage settings before closing this page.',
          network: false,
        });
      },
    });
    return () => subscription.unsubscribe();
  }, [key]);

  const retry = useCallback(async () => {
    setSyncing(key);
    try {
      await weekStore.initialize(owner, weekStart);
      // A server refresh must never hide an uncommitted local edit or its error.
      await pendingEdits.flush(owner, weekStart);
      if (!connected || owner === 'unassigned') {
        setFailure((current) => (current?.key === key ? null : current));
        return;
      }
      await weekStore.sync(owner, weekStart);
      await database.meta.put({ key: `refresh:${key}`, value: Date.now() });
      setFailure((current) => (current?.key === key ? null : current));
    } catch (error) {
      reportFailure(error);
    } finally {
      setSyncing((current) => (current === key ? null : current));
    }
  }, [connected, owner, key, weekStart, reportFailure]);

  // Reconnect and each committed edit resume the durable queue; no periodic polling.
  const version = row?.version;
  useEffect(() => {
    void retry();
  }, [retry, version, pending.sequence]);

  const lastRefreshedAt = local.key === key ? (local.lastRefreshedAt ?? 0) : 0;
  const refreshAvailableAt = lastRefreshedAt ? lastRefreshedAt + 60_000 : 0;
  const refresh = useCallback(async () => {
    try {
      if (!pendingEdits.snapshot(owner, weekStart).edits.length) {
        const latest = await database.meta.get(`refresh:${key}`);
        if (typeof latest?.value === 'number' && Date.now() < latest.value + 60_000) return;
      }
      await retry();
    } catch (error) {
      reportFailure(error);
    }
  }, [key, owner, weekStart, retry, reportFailure]);

  const update = useCallback(
    (patch: Partial<WeeklyInputs>, changedSlots?: number[]) => {
      const editOwner = owner === 'unassigned' ? (activeIdentity.owner ?? owner) : owner;
      // A second field can blur before React has received the first IndexedDB write.
      // Apply only slots changed against this rendered snapshot, preserving that write.
      const priceSlots =
        changedSlots ??
        patch.prices?.flatMap((price, index) =>
          price !== displayedWeek.prices[index] ? [index] : [],
        );
      void pendingEdits.enqueue(editOwner, weekStart, patch, priceSlots).catch(() => {
        // The queue retains both the patch and an honest persistence warning.
      });
    },
    [owner, weekStart, displayedWeek.prices],
  );

  const resolveConflict = useCallback(
    async (choice: 'local' | 'remote') => {
      try {
        await pendingEdits.flush(owner, weekStart);
        await weekStore.resolve(owner, weekStart, choice);
        await retry();
      } catch (error) {
        reportFailure(error);
      }
    },
    [owner, weekStart, retry, reportFailure],
  );

  const relevantFailure = failure?.key === key ? failure : null;
  const status: SaveStatus = pending.error
    ? 'error'
    : row?.conflict
      ? 'conflict'
      : relevantFailure
        ? relevantFailure.network
          ? 'offline'
          : 'error'
        : syncing === key
          ? 'syncing'
          : pending.edits.length || row?.dirty
            ? connected
              ? 'local'
              : 'offline'
            : row?.hydrated
              ? 'saved'
              : connected
                ? 'loading'
                : 'local';
  return {
    week: displayedWeek,
    status,
    error: pending.error ?? relevantFailure?.message ?? null,
    update,
    retry,
    refresh,
    refreshAvailableAt,
    lastRefreshedAt,
    conflict: row?.conflict ?? (null as WeekRecord | null),
    resolveConflict,
  };
}
