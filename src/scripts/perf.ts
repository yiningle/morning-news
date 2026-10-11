/*
 * Frame timing for page turns: refresh-rate measurement, per-turn frame stats
 * and long-task / long-animation-frame capture. Everything is time based (no
 * assumed 60 Hz), so the same numbers mean the same thing on a 120 Hz screen.
 */

export type CurlMode = 'gpu' | 'flat';

/** Renderer strings of software rasterisers / compositors, where rotated clip boxes are blended on the CPU. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i;

/**
 * Pick the curl mode from WebGL's renderer string. `null` means no context could
 * be made with failIfMajorPerformanceCaveat (Chrome's own "this would be slow").
 * Apple Silicon reports e.g. "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
 * Intel Macs "ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics OpenGL Engine, ...)": both are gpu.
 */
export function classifyRenderer(renderer: string | null): CurlMode {
  if (renderer === null) return 'flat';
  return SOFTWARE_RENDERER.test(renderer) ? 'flat' : 'gpu';
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

/** The display's frame interval from a run of rAF timestamps: the median delta, which ignores the odd late frame. */
export function refreshFromTimestamps(stamps: number[]): number {
  const deltas: number[] = [];
  for (let i = 1; i < stamps.length; i += 1) {
    const delta = stamps[i] - stamps[i - 1];
    if (delta > 2 && delta < 100) deltas.push(delta);
  }
  return deltas.length ? median(deltas) : 1000 / 60;
}

export type LongFrame = {
  /** ms from the start of the turn */
  at: number;
  duration: number;
  blocking?: number;
  /** time spent in style + layout, and in the whole render step, of that frame */
  styleLayout?: number;
  render?: number;
  scripts?: string[];
};

export type PhaseCounts = { start: number; middle: number; end: number; after: number };

export type TurnStats = {
  kind: string;
  mode: CurlMode;
  committed: boolean;
  /** ms from the first curl frame to the commit */
  durationMs: number;
  frames: number;
  refreshMs: number;
  medianMs: number;
  p95Ms: number;
  worstMs: number;
  /** frames slower than 1.5x the refresh interval */
  slow: number;
  /** where the slow frames were: first 150 ms, middle, last 150 ms, 300 ms after the commit */
  slowByPhase: PhaseCounts;
  /** frames that would be lost at the display rate, summed over the turn */
  dropped: number;
  longTasks: LongFrame[];
  longFrames: LongFrame[];
};

const EDGE_MS = 150;
export const TAIL_MS = 300;

/**
 * Summarise rAF timestamps of one turn. `start` and `commit` are performance.now()
 * times; timestamps after the commit (up to TAIL_MS) only count towards the
 * `after` phase, so a hitch right after the turn shows up too.
 */
export function summarizeFrames(
  stamps: number[],
  refreshMs: number,
  start: number,
  commit: number,
): Omit<TurnStats, 'kind' | 'mode' | 'committed' | 'longTasks' | 'longFrames'> {
  const limit = refreshMs * 1.5;
  const turn: number[] = [];
  const slowByPhase: PhaseCounts = { start: 0, middle: 0, end: 0, after: 0 };
  let worst = 0;
  let dropped = 0;
  for (let i = 1; i < stamps.length; i += 1) {
    const at = stamps[i];
    const delta = at - stamps[i - 1];
    const afterCommit = at > commit;
    if (!afterCommit) turn.push(delta);
    worst = Math.max(worst, delta);
    dropped += Math.max(0, Math.round(delta / refreshMs) - 1);
    if (delta <= limit) continue;
    if (afterCommit) slowByPhase.after += 1;
    else if (at - start <= EDGE_MS) slowByPhase.start += 1;
    else if (commit - at <= EDGE_MS) slowByPhase.end += 1;
    else slowByPhase.middle += 1;
  }
  return {
    durationMs: Math.round(commit - start),
    frames: turn.length,
    refreshMs: round1(refreshMs),
    medianMs: round1(median(turn)),
    p95Ms: round1(percentile(turn, 95)),
    worstMs: round1(worst),
    slow: slowByPhase.start + slowByPhase.middle + slowByPhase.end + slowByPhase.after,
    slowByPhase,
    dropped,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/* PerformanceEntry shapes we read (long-animation-frame is Chrome 123+). */
type ScriptTiming = {
  invoker?: string;
  sourceURL?: string;
  sourceFunctionName?: string;
  duration: number;
  forcedStyleAndLayoutDuration?: number;
};
type LoafEntry = PerformanceEntry & {
  blockingDuration?: number;
  renderStart?: number;
  styleAndLayoutStart?: number;
  scripts?: ScriptTiming[];
};

function describeScript(script: ScriptTiming): string {
  const file = (script.sourceURL ?? '').split('/').pop() || '?';
  const name = script.sourceFunctionName || script.invoker || 'anonymous';
  const forced = script.forcedStyleAndLayoutDuration ? ` forced-layout ${Math.round(script.forcedStyleAndLayoutDuration)}ms` : '';
  return `${name} @${file} ${Math.round(script.duration)}ms${forced}`;
}

/** Measure the display refresh interval with a short rAF run (call when idle). */
export function measureRefresh(frames = 45): Promise<number> {
  return new Promise((resolve) => {
    const stamps: number[] = [];
    const step = (now: number) => {
      stamps.push(now);
      if (stamps.length < frames) requestAnimationFrame(step);
      else resolve(refreshFromTimestamps(stamps));
    };
    requestAnimationFrame(step);
  });
}

type Session = { kind: string; mode: CurlMode; start: number; stamps: number[]; running: boolean; frame: number };

/**
 * Records page turns: rAF timestamps, long tasks and long animation frames.
 * Only runs while a turn is being measured (plus a short tail); costs one tiny
 * rAF callback per frame.
 */
export class TurnRecorder {
  private current: Session | null = null;
  private tasks: PerformanceEntry[] = [];
  private loafs: LoafEntry[] = [];

  constructor() {
    const supported = (globalThis.PerformanceObserver?.supportedEntryTypes ?? []) as readonly string[];
    for (const type of ['longtask', 'long-animation-frame']) {
      if (!supported.includes(type)) continue;
      try {
        const observer = new PerformanceObserver((list) => {
          const target = type === 'longtask' ? this.tasks : this.loafs;
          for (const entry of list.getEntries()) target.push(entry as LoafEntry);
          if (target.length > 200) target.splice(0, target.length - 200);
        });
        observer.observe({ type, buffered: false });
      } catch {
        /* entry type not available */
      }
    }
  }

  /** Whether long-animation-frame attribution is available in this browser. */
  static get hasLoaf(): boolean {
    return ((globalThis.PerformanceObserver?.supportedEntryTypes ?? []) as readonly string[]).includes('long-animation-frame');
  }

  begin(kind: string, mode: CurlMode): void {
    if (this.current) this.current.running = false;
    const session: Session = { kind, mode, start: performance.now(), stamps: [], running: true, frame: 0 };
    const step = (now: number) => {
      session.stamps.push(now);
      if (session.running) session.frame = requestAnimationFrame(step);
    };
    session.frame = requestAnimationFrame(step);
    this.current = session;
  }

  /** Stop at the commit; resolves after a short tail so frames right after the turn are included. */
  end(committed: boolean, refreshMs: number): Promise<TurnStats | null> {
    const session = this.current;
    if (!session) return Promise.resolve(null);
    this.current = null;
    const commit = performance.now();
    const { start } = session;
    return new Promise((resolve) => {
      window.setTimeout(() => {
        session.running = false;
        cancelAnimationFrame(session.frame);
        const stamps = session.stamps.filter((at) => at <= commit + TAIL_MS);
        const frames = summarizeFrames([start, ...stamps], refreshMs, start, commit);
        const inTurn = (entry: PerformanceEntry) =>
          entry.startTime + entry.duration >= start && entry.startTime <= commit + TAIL_MS;
        const longTasks = this.tasks.filter(inTurn).map((entry) => ({
          at: Math.round(entry.startTime - start),
          duration: Math.round(entry.duration),
        }));
        const longFrames = this.loafs.filter(inTurn).map((entry) => {
          const endAt = entry.startTime + entry.duration;
          return {
            at: Math.round(entry.startTime - start),
            duration: Math.round(entry.duration),
            blocking: Math.round(entry.blockingDuration ?? 0),
            render: entry.renderStart ? Math.round(endAt - entry.renderStart) : undefined,
            styleLayout: entry.styleAndLayoutStart ? Math.round(endAt - entry.styleAndLayoutStart) : undefined,
            scripts: (entry.scripts ?? [])
              .slice()
              .sort((a, b) => b.duration - a.duration)
              .slice(0, 3)
              .map(describeScript),
          };
        });
        resolve({ kind: session.kind, mode: session.mode, committed, ...frames, longTasks, longFrames });
      }, TAIL_MS + 40);
    });
  }
}
