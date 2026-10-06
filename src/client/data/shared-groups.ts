import type { GroupsResponse } from '../../shared/groups';
import type { TurnipDatabase } from './database';
import { blockedProfileKey, writeForProfile } from './profile-storage';

interface SavedGroups extends GroupsResponse {
  weekStart: string;
}
const keyFor = (owner: string) => `shared-groups:${owner}`;

/**
 * The latest groups response per profile, so friends' prices stay readable offline.
 * Only one week is kept: a new week shows nothing until the next refresh.
 */
export class SharedGroupsCache {
  constructor(private db: TurnipDatabase) {}

  async read(owner: string, weekStart: string): Promise<GroupsResponse | null> {
    const value = (await this.db.meta.get(keyFor(owner)))?.value as
      Partial<SavedGroups> | undefined;
    if (
      !value ||
      value.weekStart !== weekStart ||
      !Array.isArray(value.groups) ||
      !Array.isArray(value.players)
    )
      return null;
    return { groups: value.groups, players: value.players };
  }

  async write(owner: string, weekStart: string, data: GroupsResponse): Promise<void> {
    const value: SavedGroups = { weekStart, groups: data.groups, players: data.players };
    await writeForProfile(this.db, owner, [], async () => {
      // A different local profile may have deleted a member while this read was in flight.
      const removed = await this.db.meta.bulkGet(
        data.players.map((entry) => blockedProfileKey(entry.player.id)),
      );
      if (removed.some((row) => row?.value === 'deleted')) return;
      await this.db.meta.put({ key: keyFor(owner), value });
    });
  }

  /** Applies a local change, such as leaving a group, to whichever week is saved. */
  async update(owner: string, change: (data: GroupsResponse) => GroupsResponse): Promise<void> {
    await this.db.transaction('rw', this.db.meta, async () => {
      const value = (await this.db.meta.get(keyFor(owner)))?.value as SavedGroups | undefined;
      if (!value?.weekStart) return;
      await this.write(owner, value.weekStart, change(value));
    });
  }

  async forget(owner: string): Promise<void> {
    await this.db.meta.delete(keyFor(owner));
  }
}

/** Leaving a group hides players who no longer share another group with you. */
export function withoutGroup(data: GroupsResponse, groupId: string): GroupsResponse {
  return {
    groups: data.groups.filter((group) => group.id !== groupId),
    players: data.players
      .map((entry) => ({ ...entry, groupIds: entry.groupIds.filter((id) => id !== groupId) }))
      .filter((entry) => entry.groupIds.length > 0),
  };
}

export function withoutPlayer(data: GroupsResponse, playerId: string): GroupsResponse {
  return {
    groups: data.groups,
    players: data.players.filter((entry) => entry.player.id !== playerId),
  };
}
