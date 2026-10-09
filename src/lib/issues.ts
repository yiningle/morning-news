import { getCollection, type CollectionEntry } from 'astro:content';
import { storyHref } from './format';

export type IssueEntry = CollectionEntry<'issues'>;
export type IssueData = IssueEntry['data'];
export type Story = IssueData['lead'];
export type Section = IssueData['sections'][number];
export type Brief = Section['briefs'][number];

export interface IssueNav {
  entry: IssueEntry;
  /** 1-based count from the earliest issue. */
  number: number;
  prevDate: string | null;
  nextDate: string | null;
  total: number;
}

/** Resolve a story or brief id to its public URL. Falls back to the HN item. */
export function findHref(data: IssueData, id: number | undefined | null): string | null {
  if (id == null) return null;
  const stories = [data.lead, ...data.side, ...data.sections.flatMap((section) => section.stories)];
  const story = stories.find((item) => item.id === id);
  if (story) return storyHref(story);
  for (const section of data.sections) {
    const brief = section.briefs.find((item) => item.id === id);
    if (brief) return brief.url ?? brief.hn;
  }
  return `https://news.ycombinator.com/item?id=${id}`;
}

export async function getIssueNav(): Promise<IssueNav[]> {
  const all = await getCollection('issues');
  const issues = all.sort((a, b) => a.data.date.localeCompare(b.data.date));
  return issues.map((entry, index) => ({
    entry,
    number: index + 1,
    prevDate: index > 0 ? issues[index - 1].data.date : null,
    nextDate: index < issues.length - 1 ? issues[index + 1].data.date : null,
    total: issues.length,
  }));
}
