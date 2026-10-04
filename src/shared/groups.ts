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

export interface GroupsResponse {
  groups: GroupSummary[];
  players: SharedPlayerWeek[];
}
