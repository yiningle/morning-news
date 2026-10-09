import type { IssueNav } from './issues';

export interface MonthGroup {
  year: number;
  month: number;
  byDay: Map<number, IssueNav>;
}

export interface CalendarCell {
  day: number | null;
  issue: IssueNav | null;
}

export function groupByMonth(issues: IssueNav[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const issue of issues) {
    const [year, month, day] = issue.entry.data.date.split('-').map(Number);
    const key = `${year}-${month}`;
    let group = groups.get(key);
    if (!group) {
      group = { year, month, byDay: new Map() };
      groups.set(key, group);
    }
    group.byDay.set(day, issue);
  }
  return [...groups.values()].sort((a, b) => b.year - a.year || b.month - a.month);
}

/** Monday-first month grid. `month` is 1–12. */
export function buildMonth(year: number, month: number, byDay: Map<number, IssueNav>): CalendarCell[] {
  const weekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < offset; i += 1) cells.push({ day: null, issue: null });
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ day, issue: byDay.get(day) ?? null });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, issue: null });
  return cells;
}
