import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import type { OwnWeekRecord } from '../../shared/week';
import { database, type LocalWeek } from './database';
import { type HistoryPage, withLocalHistory, withOlderPage } from './history-cache';
import { historyCache, weekStore } from './runtime';

/**
 * Saves the list so it reads offline, and the weeks just read so each opens offline too.
 * Only a fresh page counts as a server read: a saved list may be older than this device.
 */
function keep(owner: string, list: HistoryPage, page: HistoryPage) {
  void historyCache.save(owner, list).catch(() => undefined);
  void weekStore.remember(owner, page.weeks).catch(() => undefined);
}

interface DeviceCopy {
  owner: string;
  saved: HistoryPage | null;
  rows: LocalWeek[];
}

export interface HistoryState {
  weeks: OwnWeekRecord[];
  nextCursor: string | null;
  /** This device's copy has been read, whether or not one existed. */
  hydrated: boolean;
  /** A list came from the server or this device's copy, so the weeks are known. */
  listed: boolean;
  loading: boolean;
  error: unknown;
  more: () => Promise<void>;
  retry: () => void;
}

/**
 * History's weeks: the server's list, or this device's copy of it offline, with this
 * device's newer edits in place and this week once a sale gives it a result.
 */
export function useHistory(
  owner: string | null,
  connected: boolean,
  currentWeek: string,
): HistoryState {
  const [device, setDevice] = useState<DeviceCopy | null>(null);
  const [fetched, setFetched] = useState<{ owner: string; list: HistoryPage } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  // Each first-page read supersedes older pages still loading.
  const generation = useRef(0);

  useEffect(() => {
    if (!owner) return;
    const subscription = liveQuery(async () => ({
      owner,
      saved: await historyCache.read(owner),
      rows: await database.weeks.where('owner').equals(owner).toArray(),
    })).subscribe({
      next: setDevice,
      // Without browser storage, History loads online only.
      error: () => setDevice({ owner, saved: null, rows: [] }),
    });
    return () => subscription.unsubscribe();
  }, [owner]);

  useEffect(() => {
    if (!owner || !connected) return;
    let current = true;
    generation.current++;
    setLoading(true);
    setError(null);
    void historyCache
      .first(owner, currentWeek)
      .then((list) => {
        if (!current || !list) return;
        setFetched({ owner, list });
        keep(owner, list, list);
      })
      .catch((error: unknown) => {
        if (current) setError(error);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [owner, connected, currentWeek, refreshCount]);

  const copy = device?.owner === owner ? device : null;
  const list = fetched?.owner === owner ? fetched.list : (copy?.saved ?? null);
  const weeks = useMemo(
    () => withLocalHistory(list, copy?.rows ?? [], currentWeek),
    [list, copy, currentWeek],
  );

  async function more() {
    if (!owner || !list?.nextCursor) return;
    const run = generation.current;
    setLoading(true);
    setError(null);
    try {
      const page = await historyCache.older(owner, list);
      if (!page || run !== generation.current) return;
      const next = withOlderPage(list, page);
      setFetched({ owner, list: next });
      keep(owner, next, page);
    } catch (error) {
      if (run === generation.current) setError(error);
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }

  return {
    weeks,
    nextCursor: list?.nextCursor ?? null,
    hydrated: copy !== null,
    listed: list !== null,
    // Offline, a read cut off or failed earlier gives way to the saved list.
    loading: connected && loading,
    error: connected ? error : null,
    more,
    retry: () => setRefreshCount((count) => count + 1),
  };
}
