import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import type { SessionResponse } from '../../shared/api';
import { emptyOwnWeek, type OwnWeeklyInputs, type OwnWeekRecord } from '../../shared/week';
import { ApiError } from './api';
import { database, type LocalWeek, ownWeek } from './database';
import { activeIdentity, weekStore } from './runtime';
import { weekKey } from './sync';
import { mergeWeek } from './merge';
import { pendingEdits, withPendingEdits } from './pending-edits';

export type SaveStatus =
  'loading' | 'local' | 'syncing' | 'saved' | 'offline' | 'error' | 'conflict';
export function useWeek(weekStart: string, session: SessionResponse | null, connected: boolean) {
  const owner = session?.player.id ?? 'unassigned';
  const key = weekKey(owner, weekStart);
  const [local, setLocal] = useState<{ key: string; row?: LocalWeek }>({ key });
  const [failure, setFailure] = useState<{ key: string; message: string; network: boolean } | null>(
    null,
  );
  const [syncing, setSyncing] = useState<string | null>(null);
  const row = local.key === key ? local.row : undefined;
  const pending = useSyncExternalStore(pendingEdits.subscribe, () =>
    pendingEdits.snapshot(owner, weekStart),
  );
  const displayedWeek = withPendingEdits(
    row?.data ?? emptyOwnWeek(owner, weekStart),
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
    const subscription = liveQuery(async () => ({
      key,
      row: await database.weeks.get(key),
    })).subscribe({
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

  // Returning to the app reads the week again, within the same once-a-minute limit, so
  // another device's saves appear before anything is typed here.
  const [shownAt, setShownAt] = useState(0);
  useEffect(() => {
    const shown = () => {
      if (document.visibilityState === 'visible') setShownAt(Date.now());
    };
    document.addEventListener('visibilitychange', shown);
    window.addEventListener('focus', shown);
    return () => {
      document.removeEventListener('visibilitychange', shown);
      window.removeEventListener('focus', shown);
    };
  }, []);

  // Reconnect and each committed edit resume the durable queue; no periodic polling.
  // Opening or reloading the page reads the server at most once a minute, silently;
  // anything still waiting to upload always syncs straight away.
  const version = row?.version;
  useEffect(() => {
    void (async () => {
      try {
        if (!pendingEdits.snapshot(owner, weekStart).edits.length) {
          const [current, latest] = await Promise.all([
            database.weeks.get(key),
            database.meta.get(`refresh:${key}`),
          ]);
          const settled =
            current?.hydrated && !current.dirty && !current.pending && !current.conflict;
          // A read stamped in the future means the clock moved back; read again.
          const recent =
            typeof latest?.value === 'number' &&
            latest.value <= Date.now() &&
            Date.now() < latest.value + 60_000;
          if (settled && recent) return;
        }
      } catch {
        // An unreadable cache is a reason to sync, not to skip it.
      }
      await retry();
    })();
  }, [retry, key, owner, weekStart, version, pending.sequence, shownAt]);

  const update = useCallback(
    (patch: Partial<OwnWeeklyInputs>, changedSlots?: number[]) => {
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

  const storedConflict = row?.conflict;
  const storedBase = row?.base;
  const storedData = row?.data;
  const conflict = useMemo(
    () => (storedConflict ? ownWeek(storedConflict) : null),
    [storedConflict],
  );
  // Only the entries both devices changed; null for edits saved before this device kept a base.
  const conflictEntries = useMemo(
    () =>
      storedConflict && storedBase && storedData
        ? mergeWeek(ownWeek(storedBase), ownWeek(storedData), ownWeek(storedConflict), 'local')
            .conflicts
        : null,
    [storedConflict, storedBase, storedData],
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
    /** This device holds the week or edits to it, rather than an empty placeholder. */
    stored: Boolean(row) || pending.edits.length > 0,
    status,
    error: pending.error ?? relevantFailure?.message ?? null,
    update,
    retry,
    conflict: conflict as OwnWeekRecord | null,
    conflictEntries,
    resolveConflict,
  };
}
