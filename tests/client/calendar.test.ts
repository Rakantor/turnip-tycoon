import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  currentSlot,
  currentWeekStart,
  isEditableWeek,
  shiftWeek,
} from '../../src/shared/calendar';

describe('island calendar helpers', () => {
  it('rolls the local week at Sunday midnight', () => {
    expect(currentWeekStart(new Date(2026, 9, 3, 23, 59, 59))).toBe('2026-09-27');
    expect(currentWeekStart(new Date(2026, 9, 4, 0, 0, 0))).toBe('2026-10-04');
    expect(currentWeekStart(new Date(2026, 9, 5, 0, 0, 0))).toBe('2026-10-04');
  });

  it('switches the current selling slot at local noon and leaves Sunday empty', () => {
    expect(currentSlot(new Date(2026, 9, 4, 11, 59))).toBeNull();
    expect(currentSlot(new Date(2026, 9, 4, 12, 0))).toBeNull();
    expect(currentSlot(new Date(2026, 9, 5, 11, 59))).toBe(0);
    expect(currentSlot(new Date(2026, 9, 5, 12, 0))).toBe(1);
    expect(currentSlot(new Date(2026, 9, 10, 11, 59))).toBe(10);
    expect(currentSlot(new Date(2026, 9, 10, 12, 0))).toBe(11);
  });

  it('keeps this week and last week editable until the next local Sunday', () => {
    const saturday = new Date(2026, 9, 3, 23, 59, 59);
    expect(isEditableWeek('2026-09-27', saturday)).toBe(true);
    expect(isEditableWeek('2026-09-20', saturday)).toBe(true);
    expect(isEditableWeek('2026-09-13', saturday)).toBe(false);

    const sunday = new Date(2026, 9, 4, 0, 0, 0);
    expect(isEditableWeek('2026-10-04', sunday)).toBe(true);
    expect(isEditableWeek('2026-09-27', sunday)).toBe(true);
    expect(isEditableWeek('2026-09-20', sunday)).toBe(false);
    expect(isEditableWeek('2026-10-11', sunday)).toBe(false);

    // Last week stays editable across a year boundary.
    expect(isEditableWeek('2025-12-28', new Date(2026, 0, 4, 9))).toBe(true);
  });

  it('shifts calendar weeks through month and year boundaries', () => {
    expect(shiftWeek('2026-09-27', 1)).toBe('2026-10-04');
    expect(shiftWeek('2026-01-04', -1)).toBe('2025-12-28');
    expect(shiftWeek('2025-12-28', 2)).toBe('2026-01-11');
  });

  it.each(['Europe/Vienna', 'Pacific/Auckland', 'America/Los_Angeles'])(
    'uses local calendar dates across DST in %s',
    (timezone) => {
      // Set TZ at process startup: a worker thread's env change need not update
      // the process-wide timezone. Positive/negative offsets catch UTC slicing.
      const output = execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `
      import { currentWeekStart, shiftWeek, currentSlot } from './src/shared/calendar.ts';
      console.log(JSON.stringify({
        sunday: currentWeekStart(new Date(2026, 9, 4, 0, 1)),
        saturday: currentWeekStart(new Date(2026, 9, 3, 23, 59)),
        spring: shiftWeek('2026-03-22', 1),
        autumn: shiftWeek('2026-10-25', 1),
        morning: currentSlot(new Date(2026, 9, 5, 11, 59)),
        afternoon: currentSlot(new Date(2026, 9, 5, 12, 0)),
      }));
    `,
        ],
        { cwd: process.cwd(), env: { ...process.env, TZ: timezone }, encoding: 'utf8' },
      );
      expect(JSON.parse(output)).toEqual({
        sunday: '2026-10-04',
        saturday: '2026-09-27',
        spring: '2026-03-29',
        autumn: '2026-11-01',
        morning: 0,
        afternoon: 1,
      });
    },
  );
});
