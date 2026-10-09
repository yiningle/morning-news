/** Stories kept on the first sheet of a section. The rest flip onto a continuation. */
export const SECTION_STORY_CAP = 3;
/** Briefs kept beside the section highlights. The rest flip onto a continuation. */
export const SECTION_BRIEF_CAP = 10;
/** Side stories placed in the front-page mockup slots. The rest flip onto 头版续. */
export const FRONT_SIDE_CAP = 5;

export interface PaperPage {
  index: number;
  id: string;
  /** 头版, AI版, AI版续 */
  label: string;
  /** Short drawer label. */
  short: string;
  kind: 'front' | 'front-more' | 'section' | 'section-more';
  sectionIndex?: number;
}

export interface PagePlanInput {
  sections: { name: string; stories: unknown[]; briefs: unknown[] }[];
  sideCount: number;
}

function sectionNames(name: string): { short: string; label: string } {
  const short = name.endsWith('版') ? name.slice(0, -1) : name;
  const label = name.endsWith('版') ? name : `${name}版`;
  return { short, label };
}

/**
 * One flip-sheet per edition, plus a continuation sheet when a front or section
 * has more stories or briefs than fit the designed page. Nothing is dropped.
 */
export function planPages(input: PagePlanInput): PaperPage[] {
  const drafts: Omit<PaperPage, 'index' | 'id'>[] = [{ label: '头版', short: '头版', kind: 'front' }];
  if (input.sideCount > FRONT_SIDE_CAP) {
    drafts.push({ label: '头版续', short: '头版续', kind: 'front-more' });
  }
  input.sections.forEach((section, sectionIndex) => {
    const names = sectionNames(section.name);
    drafts.push({ ...names, kind: 'section', sectionIndex });
    const overflowStories = section.stories.length > SECTION_STORY_CAP;
    const overflowBriefs = section.briefs.length > SECTION_BRIEF_CAP;
    if (overflowStories || overflowBriefs) {
      drafts.push({
        label: `${names.label}续`,
        short: `${names.short}续`,
        kind: 'section-more',
        sectionIndex,
      });
    }
  });
  return drafts.map((page, index) => ({ ...page, index, id: `p-${index}` }));
}

export function paperPages(sectionNamesList: string[]): PaperPage[] {
  return planPages({
    sections: sectionNamesList.map((name) => ({ name, stories: [1, 2, 3], briefs: [] })),
    sideCount: 1,
  });
}
