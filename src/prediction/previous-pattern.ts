import { shiftWeek } from '../shared/calendar';
import type { PatternId, WeekRecord } from '../shared/week';
import { predictWeek } from './index';

/** Only a uniquely identified pattern from this player's preceding week is a default. */
export function inferPreviousPattern(
  previous: WeekRecord | undefined,
  owner: string,
  weekStart: string,
): PatternId | null {
  if (!previous || previous.playerId !== owner || previous.weekStart !== shiftWeek(weekStart, -1)) {
    return null;
  }
  const prediction = predictWeek(previous);
  return prediction.status === 'possible' && prediction.patterns.length === 1
    ? prediction.patterns[0].id
    : null;
}
