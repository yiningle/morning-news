import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const commentQuote = z.object({
  id: z.number().int().optional(),
  user: z.string().min(1),
  stance: z.string().min(1).optional(),
  zh: z.string().min(1),
  en: z.string().min(1).optional(),
  replies: z.number().int().nonnegative().optional(),
  hn: z.string().min(1),
});

const story = z.object({
  id: z.number().int().optional(),
  title: z.string().min(1),
  title_en: z.string().min(1).optional(),
  url: z.string().nullable(),
  hn: z.string().min(1),
  points: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  summary: z.array(z.string().min(1)).min(1),
  tag: z.string().min(1).nullable().optional(),
  kicker: z.string().min(1).optional(),
  comment_quotes: z.array(commentQuote).optional(),
});

const brief = z.object({
  id: z.number().int().optional(),
  title: z.string().min(1),
  title_en: z.string().min(1).optional(),
  url: z.string().nullable().optional(),
  hn: z.string().min(1),
  points: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative().optional(),
});

const statHit = z.object({
  id: z.number().int().optional(),
  title: z.string().min(1),
  value: z.number(),
  comments: z.number().int().nonnegative().optional(),
  hn: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
});

const sectionStats = z.object({
  items: z.number().int().nonnegative().optional(),
  points: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  top_points: statHit.optional(),
  top_comments: statHit.optional(),
  top_brief: statHit.optional(),
});

const section = z.object({
  name: z.string().min(1),
  page: z.number().int().positive().optional(),
  en: z.string().min(1).optional(),
  stories: z.array(story).min(1).max(6),
  briefs: z.array(brief).max(12),
  stats: sectionStats.optional(),
});

const quoteOfDay = z.object({
  user: z.string().min(1),
  id: z.number().int().optional(),
  hn: z.string().min(1),
  story_id: z.number().int().optional(),
  story: z.string().min(1).optional(),
  zh: z.string().min(1),
  en: z.string().min(1).optional(),
});

const issueStats = z.object({
  snapshot: z.string().optional(),
  front_page_count: z.number().int().nonnegative().optional(),
  with_numbers: z.number().int().nonnegative().optional(),
  flagged_or_dupe: z.number().int().nonnegative().optional(),
  top_points: statHit.optional(),
  top_comments: statHit.optional(),
  second_comments: statHit.optional(),
  over_500: z.number().int().nonnegative().optional(),
  over_300: z.number().int().nonnegative().optional(),
  over_100: z.number().int().nonnegative().optional(),
  show_hn: z.number().int().nonnegative().optional(),
  total_points: z.number().int().nonnegative().optional(),
  total_comments: z.number().int().nonnegative().optional(),
  hottest_ratio: statHit.optional(),
});

const issues = defineCollection({
  loader: glob({
    pattern: '*.json',
    base: './src/content/issues',
  }),
  schema: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    published_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/),
    source: z.string().min(1),
    dummy: z.boolean().optional(),
    schema_version: z.number().int().positive().optional(),
    lead: story,
    side: z.array(story).min(1),
    sections: z.array(section).min(1),
    quote_of_day: quoteOfDay.optional(),
    stats: issueStats.optional(),
  }),
});

export const collections = { issues };
