import { FONT_FILE_TIMEOUT_MS as FILE_TIMEOUT_MS } from '../font-sources';

/*
 * Font gate. The inline loader in Layout.astro picks a source (a CDN, or the
 * page's self-hosted subset) and fetches its CSS; this module reads the
 * @font-face rules from it, downloads only the files the page's text needs
 * (per weight, nearest page first) and adds them to document.fonts itself, in
 * batches, at moments the page allows.
 *
 * Why not just insert the CSS: every font that arrives re-lays out all text
 * using it in the very next frame. With a CJK font cut into dozens of
 * unicode-range slices arriving one by one, a page turn made while they stream
 * in had a 40-120 ms layout in the middle of the animation for each arrival.
 * Here a guard (set by the page-turn code) holds new fonts back while a turn
 * runs; they are applied together afterwards, in idle time.
 */

export type FaceSpec = {
  family: string;
  weight: number;
  style: string;
  unicodeRange: string;
  ranges: Array<[number, number]>;
  url: string;
};

type LoaderState = {
  source: string | null;
  css?: Array<{ text: string; base: string }>;
  ready: Promise<string | null>;
  tried: string[];
  subset: string | null;
};

export type GateStats = {
  source: string;
  files: number;
  fetched: number;
  failed: number;
  bytes: number;
  batches: number;
  firstAppliedAt: number | null;
  lastAppliedAt: number | null;
  held: number;
};

const ALL: Array<[number, number]> = [[0, 0x10ffff]];

function idle(task: () => void): void {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(task, { timeout: 500 });
  else window.setTimeout(task, 50);
}
/* Apply what has arrived at least this often while files are still coming. */
const BATCH_MS = 600;
/* A source whose files fail this often is dropped for the self-hosted subset. */
const MAX_FAILURES = 3;
/* One file that hangs this long counts as failed (so "fonts pending" always ends). */
const FETCH_TIMEOUT_MS = 20000;

export function parseRanges(value: string): Array<[number, number]> {
  if (!value.trim()) return ALL;
  return value.split(',').flatMap((part): Array<[number, number]> => {
    const token = part.trim().replace(/^U\+/i, '');
    if (!token) return [];
    if (token.includes('?')) return [[parseInt(token.replace(/\?/g, '0'), 16), parseInt(token.replace(/\?/g, 'F'), 16)]];
    const [lo, hi] = token.split('-');
    return [[parseInt(lo, 16), parseInt(hi ?? lo, 16)]];
  });
}

/** @font-face rules (woff2 URL resolved against the stylesheet's URL). */
export function parseFaces(text: string, base: string): FaceSpec[] {
  const faces: FaceSpec[] = [];
  for (const [, body] of text.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const prop = (name: string) => body.match(new RegExp(`${name}\\s*:\\s*([^;]+)`, 'i'))?.[1].trim() ?? '';
    const family = prop('font-family').replace(/["']/g, '');
    const src = prop('src');
    const url = (src.match(/url\(\s*["']?([^"')]+)["']?\s*\)\s*format\(\s*["']?woff2/i) ?? src.match(/url\(\s*["']?([^"')]+)["']?\s*\)/i))?.[1];
    if (!family || !url) continue;
    const range = prop('unicode-range');
    faces.push({
      family,
      weight: parseInt(prop('font-weight') || '400', 10) || 400,
      style: prop('font-style') || 'normal',
      unicodeRange: range,
      ranges: parseRanges(range),
      url: new URL(url, base).href,
    });
  }
  return faces;
}

/** CSS font matching, reduced to what this site uses: the nearest available weight. */
export function matchWeight(wanted: number, available: number[]): number {
  if (available.includes(wanted)) return wanted;
  const sorted = [...available].sort((a, b) => a - b);
  if (wanted <= 500) {
    const lighter = sorted.filter((w) => w <= wanted).pop();
    return lighter ?? sorted[0];
  }
  return sorted.find((w) => w >= wanted) ?? sorted[sorted.length - 1];
}

/** Characters each family/weight renders, nearest text first (the shown page, then the rest). */
function textNeeds(root: Node, families: Map<string, number[]>, skip?: string): Map<string, Set<number>> {
  const needs = new Map<string, Set<number>>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      skip && node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(skip) ? NodeFilter.FILTER_REJECT
        : node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  const styleCache = new Map<Element, string | null>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    const text = (node as Text).data;
    if (!el || !text.trim()) continue;
    let key = styleCache.get(el);
    if (key === undefined) {
      const style = getComputedStyle(el);
      const first = style.fontFamily.split(',')[0].trim().replace(/["']/g, '');
      const family = families.has(first) ? first : [...families.keys()].find((f) => style.fontFamily.includes(f)) ?? null;
      key = family ? `${family}|${matchWeight(Number(style.fontWeight) || 400, families.get(family) ?? [400])}` : null;
      styleCache.set(el, key);
    }
    if (!key) continue;
    let set = needs.get(key);
    if (!set) needs.set(key, (set = new Set()));
    for (const ch of text) set.add(ch.codePointAt(0) ?? 0);
  }
  return needs;
}

function covers(face: FaceSpec, codes: Uint32Array): boolean {
  // codes is sorted: binary-search each range for any code inside it.
  for (const [lo, hi] of face.ranges) {
    let left = 0;
    let right = codes.length;
    while (left < right) {
      const mid = (left + right) >> 1;
      if (codes[mid] < lo) left = mid + 1;
      else right = mid;
    }
    if (left < codes.length && codes[left] <= hi) return true;
  }
  return false;
}

/** The faces a set of needs requires, in CSS order (later rules win, so all overlapping ones are kept). */
export function facesFor(faces: FaceSpec[], needs: Map<string, Set<number>>): FaceSpec[] {
  const sorted = new Map<string, Uint32Array>();
  for (const [key, chars] of needs) sorted.set(key, Uint32Array.from(chars).sort());
  return faces.filter((face) => {
    const codes = sorted.get(`${face.family}|${face.weight}`);
    return codes ? covers(face, codes) : false;
  });
}

class FontGate {
  guard: () => boolean = () => false;
  /** Called just before a batch is applied (the page takes off-screen text out of layout). */
  beforeFlush: () => void = () => undefined;
  stats: GateStats = { source: 'pending', files: 0, fetched: 0, failed: 0, bytes: 0, batches: 0, firstAppliedAt: null, lastAppliedAt: null, held: 0 };
  private waiting: FontFace[] = [];
  private outstanding = 0;
  private flushTimer = 0;
  private lastFlush = 0;
  private wanted = new Set<string>();
  private switched = false;
  private started = 0;
  private gotAny = false;
  private generation = 0;
  private buffers = new Map<string, Promise<ArrayBuffer>>();

  /** True while files are downloading or waiting to be applied. */
  get pending(): boolean {
    return this.outstanding > 0 || this.waiting.length > 0;
  }

  async start(): Promise<void> {
    const loader = (window as Window & { __fonts?: LoaderState }).__fonts;
    if (!loader) return;
    await loader.ready;
    if (!loader.css?.length) {
      this.stats.source = loader.source ?? 'system';
      this.emit();
      return;
    }
    this.use(loader.source ?? '?', loader.css, loader);
  }

  private use(source: string, css: Array<{ text: string; base: string }>, loader: LoaderState): void {
    this.stats.source = source;
    this.started = performance.now();
    const faces = css.flatMap(({ text, base }) => parseFaces(text, base));
    const families = new Map<string, number[]>();
    for (const face of faces) {
      const list = families.get(face.family) ?? [];
      if (!list.includes(face.weight)) list.push(face.weight);
      families.set(face.family, list);
    }
    const generation = ++this.generation;
    // Files still in flight from a source that was given up no longer count as pending.
    this.outstanding = 0;
    this.stats.files = 0;
    this.stats.fetched = 0;
    const onFailure = () => this.fail(loader);
    // Nearest first: what is on screen now (the shown page and the page chrome),
    // then the hidden pages one per idle period, nearest page first.
    const HIDDEN = '[data-sheet][hidden], .curl-layer, .debug-overlay';
    this.fetchAll(facesFor(faces, textNeeds(document.body, families, HIDDEN)), generation, onFailure);
    const sheets = [...document.querySelectorAll<HTMLElement>('[data-sheet]')];
    const shownAt = Math.max(0, sheets.findIndex((sheet) => !sheet.hidden));
    const rest = sheets
      .map((sheet, i) => ({ sheet, distance: Math.abs(i - shownAt) + (i < shownAt ? 0.5 : 0) }))
      .filter(({ sheet }) => sheet.hidden)
      .sort((a, b) => a.distance - b.distance)
      .map(({ sheet }) => sheet);
    const step = () => {
      const sheet = rest.shift();
      if (!sheet || generation !== this.generation) return;
      this.fetchAll(facesFor(faces, textNeeds(sheet, families)), generation, onFailure);
      idle(step);
    };
    idle(step);
    window.setTimeout(() => {
      if (!this.gotAny && !this.switched) this.fail(loader, true);
    }, FILE_TIMEOUT_MS);
    this.emit();
  }

  /** The source's font files do not load: switch once to the self-hosted subset. */
  private fail(loader: LoaderState, timedOut = false): void {
    if (this.switched || !loader.subset || this.stats.source === 'self') return;
    if (!timedOut && this.stats.failed < MAX_FAILURES) return;
    this.switched = true;
    loader.tried.push(`${this.stats.source} font files ${timedOut ? 'timed out' : 'failed'}`);
    try {
      localStorage.removeItem('morning-news:font-source');
    } catch {
      /* storage unavailable */
    }
    const subset = loader.subset;
    fetch(subset)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((text) => {
        loader.source = 'self';
        document.documentElement.dataset.fonts = 'self';
        this.use('self', [{ text, base: new URL(subset, location.href).href }], loader);
      })
      .catch(() => undefined);
  }

  private fetchAll(faces: FaceSpec[], generation: number, onFailure: () => void): void {
    // Several at a time, in order, so the nearest text gets its fonts first.
    const queue = faces.filter((face) => !this.wanted.has(`${face.url}|${face.weight}|${face.family}`));
    queue.forEach((face) => this.wanted.add(`${face.url}|${face.weight}|${face.family}`));
    this.stats.files += queue.length;
    let next = 0;
    let active = 0;
    const pump = () => {
      while (next < queue.length && active < 6) {
        const face = queue[next++];
        active += 1;
        this.outstanding += 1;
        // Google serves one file for all weights of a slice: fetch it once.
        let data = this.buffers.get(face.url);
        if (!data) {
          const controller = typeof AbortController === 'function' ? new AbortController() : null;
          const timer = window.setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
          data = fetch(face.url, { mode: 'cors', credentials: 'omit', signal: controller?.signal })
            .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
            .finally(() => window.clearTimeout(timer));
          this.buffers.set(face.url, data);
          data.then((buffer) => {
            this.stats.bytes += buffer.byteLength;
          }, () => undefined);
        }
        data
          .then(() => {
            // Built from the URL (now in the HTTP cache), not the buffer: a buffer is
            // decoded on the main thread, a URL off it.
            const font = new FontFace(face.family, `url("${face.url}") format("woff2")`, { weight: String(face.weight), style: face.style, unicodeRange: face.unicodeRange || undefined, display: 'swap' });
            return font.load();
          })
          .then(
            (font) => {
              // Late files from a source that was given up are dropped.
              if (generation !== this.generation) return;
              this.gotAny = true;
              this.stats.fetched += 1;
              this.waiting.push(font);
            },
            () => {
              if (generation !== this.generation) return;
              this.stats.failed += 1;
              onFailure();
            },
          )
          .finally(() => {
            active -= 1;
            if (generation !== this.generation) return;
            this.outstanding -= 1;
            pump();
            this.scheduleFlush();
            if (!this.pending) this.emit();
          });
      }
    };
    pump();
  }

  /** Apply arrived fonts now if allowed, else soon. Batched: one relayout per batch, never during a turn. */
  scheduleFlush(): void {
    if (!this.waiting.length || this.flushTimer) return;
    const due = this.outstanding === 0 ? 0 : Math.max(0, this.lastFlush + BATCH_MS - performance.now());
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = 0;
      if (this.guard()) {
        this.stats.held += 1;
        this.flushTimer = window.setTimeout(() => {
          this.flushTimer = 0;
          this.scheduleFlush();
        }, 150);
        return;
      }
      this.flush();
    }, due);
  }

  private flush(): void {
    const batch = this.waiting.splice(0);
    if (!batch.length) return;
    this.beforeFlush();
    for (const font of batch) document.fonts.add(font);
    const at = Math.round(performance.now());
    this.lastFlush = performance.now();
    this.stats.batches += 1;
    this.stats.firstAppliedAt ??= at;
    this.stats.lastAppliedAt = at;
    this.emit();
  }

  private emit(): void {
    window.dispatchEvent(new CustomEvent('morning-news:fonts', { detail: this.stats }));
  }
}

type GateWindow = Window & { __fontGate?: FontGate };

/** The page's single font gate (shared by every script on the page). */
export function fontGate(): FontGate {
  const w = window as GateWindow;
  if (!w.__fontGate) {
    w.__fontGate = new FontGate();
    void w.__fontGate.start();
  }
  return w.__fontGate;
}
