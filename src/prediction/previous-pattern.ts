import { shiftWeek } from '../shared/calendar';
import type { PatternId, WeekRecord } from '../shared/week';
import { predictWeek, type PredictionResult } from './index';

/** The pattern a week's prices identify, or null while more than one remains possible. */
export function uniquePattern(prediction: PredictionResult): PatternId | null {
  return prediction.status === 'possible' && prediction.patterns.length === 1
    ? prediction.patterns[0].id
    : null;
}

/** Only a uniquely identified pattern from this player's preceding week is a default. */
export function inferPreviousPattern(
  previous: WeekRecord | undefined,
  owner: string,
  weekStart: string,
): PatternId | null {
  if (!previous || previous.playerId !== owner || previous.weekStart !== shiftWeek(weekStart, -1)) {
    return null;
  }
  return uniquePattern(predictWeek(previous));
}
