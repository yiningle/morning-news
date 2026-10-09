# 早间新闻 JSON

每一期是 `src/content/issues/YYYY-MM-DD.json`。文件名和 `date` 相同。校验在 `src/content.config.ts`。缺了的可选字段不渲染，所以旧的短稿仍然有效。

数字在页面上写成「872 点赞 / 1481 评论」和「102 条回复」。不要用单独的「分」或「评」。

## 一期

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `date` | 是 | `YYYY-MM-DD`，Hacker News 那一天（UTC） |
| `published_at` | 是 | 出刊时间，带时区，如 `2026-10-09T08:10:00+08:00` |
| `source` | 是 | 当天 HN 首页归档 URL |
| `dummy` | 否 | `true` 时页面标成占位样本 |
| `schema_version` | 否 | 现在是 `2`。不写也行 |
| `lead` | 是 | 头版主稿，见「稿件」 |
| `side` | 是 | 头版其余要闻，至少 1 篇。有 5 篇时按版面排：右栏 2、主稿下方 2、底栏 1。超过 5 篇的翻到「头版续」 |
| `sections` | 是 | 内页，至少一版。见「版面」 |
| `stats` | 否 | 头版「今日数字」。没有就不画这个框 |
| `quote_of_day` | 否 | 头版「评论金句」。没有就不画这个框 |

## 稿件 `lead` / `side[]` / `sections[].stories[]`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 中文标题 |
| `title_en` | 否 | 英文原题，只入库，版面不单列 |
| `url` | 是 | 原文链接。没有原文时写 `null`，标题改链到 `hn` |
| `hn` | 是 | HN 讨论 URL |
| `points` | 是 | 点赞，非负整数 |
| `comments` | 是 | 评论数，非负整数。这是数字，不是评论数组 |
| `summary` | 是 | 正文段落，至少一段 |
| `tag` | 否 | 旧式小标题。可以是 `null` |
| `kicker` | 否 | 红色栏题，如 `要闻 · 移民政策`。有 `tag` 且栏题里没写过，会接在栏题后面 |
| `id` | 否 | HN item id，给「今日数字」回链用 |
| `comment_quotes` | 否 | 「评论区在吵什么」。空数组或不写就不画 |

一条评论：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `user` | 是 | HN 用户名 |
| `zh` | 是 | 中文转述 |
| `hn` | 是 | 这条评论的 URL |
| `stance` | 否 | 短标签，如 `支持`、`质疑`，红底白字 |
| `en` | 否 | 英文原句，斜体放在中文下面 |
| `replies` | 否 | 回复数，写成「102 条回复」。`0` 也写出来 |
| `id` | 否 | 评论的 HN id |

头版主稿如果有 3 条及以上评论，横排成三栏；版面主稿有 2 条时横排成两栏；其余稿件上下叠。

## 简讯 `sections[].briefs[]`

一版最多 10 条放在「本版简讯」，多出来的翻到「续」页。一行是：标题 · 点赞 · 评论 · HN。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 中文标题，链到 `url`，没有 `url` 就链到 `hn` |
| `hn` | 是 | HN 讨论 URL |
| `points` | 是 | 点赞 |
| `comments` | 否 | 评论数。旧简讯可以不写，这时只显示点赞 |
| `url` | 否 | 原文。可以是 `null` |
| `title_en` | 否 | 英文原题，版面不单列 |
| `id` | 否 | HN item id |

## 版面 `sections[]`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | `AI`、`开发`、`科学`、`文化`。页面会加上「版」 |
| `stories` | 是 | 1 到 6 篇。前 3 篇在本版，多的翻到续页 |
| `briefs` | 是 | 0 到 12 条。建议 8 到 10 条 |
| `en` | 否 | 英文版名，如 `Artificial Intelligence`，排在中文版名旁边 |
| `page` | 否 | 生成器自己记的版序号。翻页顺序以文件里的数组顺序为准 |
| `stats` | 否 | 「本版数字」。没有就不画 |

`stats`：

| 字段 | 说明 |
| --- | --- |
| `items` | 这一版有多少条上了当天首页 |
| `points` / `comments` | 点赞合计、评论合计 |
| `top_points` | `{ id, title, value, comments? }` 最高点赞 |
| `top_comments` | 最多评论。和 `top_points` 是同一篇时不重复画一行 |
| `top_brief` | 简讯里最高点赞 |

`value` 是数字。`id` 用来链回稿件或简讯；对不上就链到 `https://news.ycombinator.com/item?id=`。

## 今日数字 `stats`

全部可选。有哪个画哪个。

| 字段 | 页面上的说法 |
| --- | --- |
| `top_points` | 最高点赞，标题链回稿件 |
| `top_comments` | 最多评论。和最高点赞是同一篇时，第二行写「同一帖」加主稿 `tag` |
| `over_500` / `over_300` / `over_100` | 「条帖子破 500 点赞」，下面写破 300、破 100 的条数 |
| `hottest_ratio` | `{ value, id, title, note? }`。`value` 可以是小数，如 `1.86` |
| `show_hn` | 几个 Show HN 上了首页 |
| `total_comments` | 评论合计。旁边用 `with_numbers` 或 `front_page_count` 说明条数 |
| `total_points` | 点赞合计 |
| `front_page_count` | 报头右侧「首页 N 条」 |
| `snapshot` | 带时区的时间，页脚写成数字快照 |
| `second_comments` / `flagged_or_dupe` | 先入库，版面暂不单列 |

## 评论金句 `quote_of_day`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `zh` | 是 | 中文，页面加上「」 |
| `user` | 是 | 用户名，链到 `hn` |
| `hn` | 是 | 评论 URL |
| `en` | 否 | 英文原句 |
| `story` | 否 | 「评某篇」后面的稿名 |
| `story_id` / `id` | 否 | 对应稿件和评论的 HN id |

## 翻页

头版加每一版各是一页。某一版超过 3 篇稿或 10 条简讯，或者头版边栏超过 5 篇，多出来的放在下一张可翻的续页上，不裁掉。一页里面如果仍比窗口高，在这一页里滚动，不把下半截藏住。

## 最短例子

```json
{
  "date": "2026-10-08",
  "published_at": "2026-10-09T08:10:00+08:00",
  "source": "https://news.ycombinator.com/front?day=2026-10-08",
  "lead": {
    "title": "标题",
    "url": "https://example.com/story",
    "hn": "https://news.ycombinator.com/item?id=1",
    "points": 120,
    "comments": 45,
    "summary": ["第一段。"]
  },
  "side": [
    {
      "title": "边栏",
      "url": null,
      "hn": "https://news.ycombinator.com/item?id=2",
      "points": 80,
      "comments": 10,
      "summary": ["一段。"],
      "tag": "人物"
    }
  ],
  "sections": [
    {
      "name": "AI",
      "stories": [
        {
          "title": "内页稿",
          "url": "https://example.com/ai",
          "hn": "https://news.ycombinator.com/item?id=3",
          "points": 60,
          "comments": 12,
          "summary": ["一段。"]
        }
      ],
      "briefs": [
        {
          "title": "简讯",
          "hn": "https://news.ycombinator.com/item?id=4",
          "points": 40
        }
      ]
    }
  ]
}
```
