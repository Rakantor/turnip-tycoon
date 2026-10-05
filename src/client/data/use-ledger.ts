import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import type { LedgerWeek } from '../../shared/ledger';
import { database } from './database';
import { withLocalWeeks } from './ledger-cache';
import { ledgerCache } from './runtime';

/**
 * Every traded week's totals for overall profit: the saved ledger, with this device's
 * newer trades in place of its rows. Null until read; works offline once fetched.
 */
export function useLedger(owner: string | null, connected: boolean): LedgerWeek[] | null {
  const [state, setState] = useState<{ owner: string; weeks: LedgerWeek[] } | null>(null);
  useEffect(() => {
    if (!owner) return;
    const subscription = liveQuery(async () => ({
      saved: await ledgerCache.read(owner),
      rows: await database.weeks.where('owner').equals(owner).toArray(),
    })).subscribe({
      next: ({ saved, rows }) => setState({ owner, weeks: withLocalWeeks(saved, rows) }),
      // Unreadable browser storage leaves the summary out rather than showing wrong totals.
      error: () => setState(null),
    });
    return () => subscription.unsubscribe();
  }, [owner]);
  useEffect(() => {
    if (owner && connected) void ledgerCache.refresh(owner).catch(() => undefined);
  }, [owner, connected]);
  return state?.owner === owner ? state.weeks : null;
}
