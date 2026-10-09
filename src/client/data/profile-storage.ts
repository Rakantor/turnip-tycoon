import type { GroupsResponse } from '../../shared/groups';
import { t } from '@lingui/core/macro';
import type { TurnipDatabase } from './database';
import type { Table } from 'dexie';

export const blockedProfileKey = (owner: string) => `blocked-profile:${owner}`;

export class ProfileWriteBlockedError extends Error {
  constructor() {
    super(t`Profile cleanup is in progress. Keep this page open to retry your unsaved edits.`);
    this.name = 'ProfileWriteBlockedError';
  }
}

/** Check inside the same IndexedDB transaction as each write. Other tabs share this guard. */
export async function profileBlocked(db: TurnipDatabase, owner: string): Promise<boolean> {
  return Boolean(await db.meta.get(blockedProfileKey(owner)));
}

/** Serialize the removal guard and a profile's writes in one transaction, in every tab. */
export function writeForProfile<T>(
  db: TurnipDatabase,
  owner: string,
  tables: Table[],
  write: () => Promise<T>,
): Promise<T | undefined> {
  return db.transaction('rw', [db.meta, ...tables], async () => {
    if (await profileBlocked(db, owner)) return;
    return write();
  });
}

/** Called in a transaction covering meta and weeks, after blocking future writes. */
export async function eraseProfileCopies(
  db: TurnipDatabase,
  owner: string,
  phase: 'deleted' | 'disconnected',
): Promise<void> {
  await db.weeks.where('owner').anyOf(owner, 'unassigned').delete();
  const metadata = await db.meta.toArray();
  for (const row of metadata) {
    if (
      row.key === `ledger:${owner}` ||
      row.key === `groups-refresh:${owner}` ||
      row.key === `shared-groups:${owner}` ||
      row.key.startsWith(`refresh:${owner}|`) ||
      row.key.startsWith('refresh:unassigned|')
    ) {
      await db.meta.delete(row.key);
    } else if (phase === 'deleted' && row.key.startsWith('shared-groups:')) {
      const value = row.value as Partial<GroupsResponse> | undefined;
      // Another profile on this browser may have cached the deleted player as a friend.
      if (value?.players?.some((entry) => entry.player.id === owner)) await db.meta.delete(row.key);
    }
  }
}
