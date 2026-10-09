const taipei = 'Asia/Taipei';

const zhDigit = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function zhNumber(value: number): string {
  if (value <= 10) return value === 10 ? '十' : zhDigit[value];
  if (value < 20) return `十${zhDigit[value - 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${zhDigit[tens]}十${ones ? zhDigit[ones] : ''}`;
}

export function formatIssueDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

/** 二〇二六年十月八日 */
export function formatChineseDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const yearText = String(year)
    .split('')
    .map((digit) => zhDigit[Number(digit)])
    .join('');
  return `${yearText}年${zhNumber(month)}月${zhNumber(day)}日`;
}

export function formatWeekday(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat('zh-CN', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(date);
}

function taipeiParts(iso: string): { year: number; month: number; day: number; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: taipei,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: read('hour'),
    minute: read('minute'),
  };
}

/** Dateline: 台北时间 10 月 9 日出刊 */
export function formatPublishedLine(iso: string): string {
  const parts = taipeiParts(iso);
  return `台北时间 ${parts.month} 月 ${parts.day} 日出刊`;
}

export function formatPublishedFull(iso: string): string {
  const parts = taipeiParts(iso);
  return `台北时间 ${parts.year} 年 ${parts.month} 月 ${parts.day} 日 ${parts.hour}:${parts.minute} 出刊`;
}

export function stats(points: number, comments: number): string {
  return `${points} 点赞 / ${comments} 评论`;
}

export function pointsLabel(points: number): string {
  return `${points} 点赞`;
}

export function repliesLabel(count: number): string {
  return `${count} 条回复`;
}

/** 174 点赞 · 70 评论 — comments omitted when the older brief shape has no count. */
export function briefStats(points: number, comments?: number): string {
  if (comments == null) return pointsLabel(points);
  return `${points} 点赞 · ${comments} 评论`;
}

export function formatGrouped(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** 10/8 from YYYY-MM-DD */
export function shortMonthDay(isoDate: string): string {
  const [, month, day] = isoDate.split('-').map(Number);
  return `${month}/${day}`;
}

export function storyHref(story: { url: string | null; hn: string }): string {
  return story.url ?? story.hn;
}

export function sectionLabel(name: string): string {
  return name.endsWith('版') ? name : `${name}版`;
}

export function sectionMain(name: string): string {
  return name.endsWith('版') ? name.slice(0, -1) : name;
}
