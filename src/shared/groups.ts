import type { Player } from './api';
import type { WeekRecord } from './week';

export interface GroupSummary {
  id: string;
  name: string;
  code: string;
  memberCount: number;
  capacity: number;
}

export interface SharedPlayerWeek {
  player: Player;
  week: WeekRecord;
  groupIds: string[];
}

/** What an invite code shows before joining: the group and its players' names. */
export interface GroupPreview {
  group: { name: string; memberCount: number; capacity: number };
  members: string[];
}

/** A friend request either player can still withdraw: no prices are shared yet. */
export interface FriendRequest {
  player: Player;
  sentAt: string;
}

export interface FriendRequests {
  /** Waiting for you to accept, newest first. */
  received: FriendRequest[];
  /** Waiting for the other player, newest first. */
  sent: FriendRequest[];
}

/** Everyone sharing prices with you: your groups' members and the friends you added by code. */
export interface GroupsResponse {
  groups: GroupSummary[];
  players: SharedPlayerWeek[];
  /** Friends added by friend code. Each also appears in players, in a shared group or not. */
  friendIds: string[];
  requests: FriendRequests;
}

/** Whose friend link it is, shown before accepting it, even without a profile. */
export interface FriendInvitePreview {
  player: Pick<Player, 'id' | 'displayName'>;
  expiresAt: string;
}

/** One code field joins a group or asks a player to be friends, whichever the code belongs to. */
export type CodeResult = { group: GroupSummary } | { friend: FriendResult };

/** A friend code request's outcome: friends straight away when they had already asked you. */
export interface FriendResult {
  player: Player;
  status: 'friends' | 'requested';
}
