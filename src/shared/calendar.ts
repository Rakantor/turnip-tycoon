/** A local calendar date, deliberately not a UTC timestamp. */
function calendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function currentWeekStart(date = new Date()): string {
  const sunday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  sunday.setDate(sunday.getDate() - sunday.getDay());
  return calendarDate(sunday);
}

export function shiftWeek(weekStart: string, offset: number): string {
  const [year, month, day] = weekStart.split('-').map(Number);
  const date = new Date(year, month - 1, day + offset * 7);
  return calendarDate(date);
}

/** The interface edits this week and last week, so a forgotten entry can still be fixed. */
export function isEditableWeek(weekStart: string, date = new Date()): boolean {
  const current = currentWeekStart(date);
  return weekStart <= current && weekStart >= shiftWeek(current, -1);
}

export function currentSlot(date = new Date()): number | null {
  return date.getDay() === 0 ? null : (date.getDay() - 1) * 2 + (date.getHours() < 12 ? 0 : 1);
}
