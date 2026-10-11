import type { GroupsResponse } from '../../shared/groups';
import type { TurnipDatabase } from './database';
import { blockedProfileKey, playersIn, writeForProfile } from './profile-storage';

interface SavedGroups extends GroupsResponse {
  weekStart: string;
}
const keyFor = (owner: string) => `shared-groups:${owner}`;
const list = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);

/** Copies saved before friend codes could be added have no friends or requests. */
function savedGroups(value: unknown): SavedGroups | null {
  const saved = value as Partial<SavedGroups> | undefined;
  if (
    typeof saved?.weekStart !== 'string' ||
    !Array.isArray(saved.groups) ||
    !Array.isArray(saved.players)
  )
    return null;
  return {
    weekStart: saved.weekStart,
    groups: saved.groups,
    players: saved.players,
    friendIds: list(saved.friendIds),
    requests: { received: list(saved.requests?.received), sent: list(saved.requests?.sent) },
  };
}

/**
 * The latest groups response per profile, so friends' prices stay readable offline.
 * Only one week is kept: a new week shows nothing until the next refresh.
 */
export class SharedGroupsCache {
  constructor(private db: TurnipDatabase) {}

  async read(owner: string, weekStart: string): Promise<GroupsResponse | null> {
    const value = savedGroups((await this.db.meta.get(keyFor(owner)))?.value);
    if (value?.weekStart !== weekStart) return null;
    return {
      groups: value.groups,
      players: value.players,
      friendIds: value.friendIds,
      requests: value.requests,
    };
  }

  async write(owner: string, weekStart: string, data: GroupsResponse): Promise<void> {
    const value: SavedGroups = {
      weekStart,
      groups: data.groups,
      players: data.players,
      friendIds: data.friendIds,
      requests: data.requests,
    };
    await writeForProfile(this.db, owner, [], async () => {
      // A different local profile may have deleted a member while this read was in flight.
      const removed = await this.db.meta.bulkGet(playersIn(data).map(blockedProfileKey));
      if (removed.some((row) => row?.value === 'deleted')) return;
      await this.db.meta.put({ key: keyFor(owner), value });
    });
  }

  /** Applies a local change, such as leaving a group, to whichever week is saved. */
  async update(owner: string, change: (data: GroupsResponse) => GroupsResponse): Promise<void> {
    await this.db.transaction('rw', this.db.meta, async () => {
      const value = savedGroups((await this.db.meta.get(keyFor(owner)))?.value);
      if (!value) return;
      await this.write(owner, value.weekStart, change(value));
    });
  }

  async forget(owner: string): Promise<void> {
    await this.db.meta.delete(keyFor(owner));
  }
}

/** Keeps players shared through a group or as a friend, and yourself while anyone is. */
function stillShared(data: GroupsResponse, owner: string): GroupsResponse {
  const friends = new Set(data.friendIds);
  return {
    ...data,
    players: data.players.filter(
      (entry) =>
        entry.groupIds.length > 0 ||
        friends.has(entry.player.id) ||
        (entry.player.id === owner && friends.size > 0),
    ),
  };
}

/** Leaving a group hides players who no longer share another group or a friendship. */
export function withoutGroup(data: GroupsResponse, groupId: string, owner: string): GroupsResponse {
  return stillShared(
    {
      ...data,
      groups: data.groups.filter((group) => group.id !== groupId),
      players: data.players.map((entry) => ({
        ...entry,
        groupIds: entry.groupIds.filter((id) => id !== groupId),
      })),
    },
    owner,
  );
}

/** Removing a friend, or declining or withdrawing a request, ends the link both ways. */
export function withoutFriend(
  data: GroupsResponse,
  playerId: string,
  owner: string,
): GroupsResponse {
  const other = (entry: { player: { id: string } }) => entry.player.id !== playerId;
  return stillShared(
    {
      ...data,
      friendIds: data.friendIds.filter((id) => id !== playerId),
      requests: {
        received: data.requests.received.filter(other),
        sent: data.requests.sent.filter(other),
      },
    },
    owner,
  );
}

/** A player whose prices are no longer shared with you by any route. */
export function withoutPlayer(
  data: GroupsResponse,
  playerId: string,
  owner: string,
): GroupsResponse {
  return stillShared(
    {
      ...data,
      friendIds: data.friendIds.filter((id) => id !== playerId),
      players: data.players.filter((entry) => entry.player.id !== playerId),
    },
    owner,
  );
}
