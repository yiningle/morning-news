/*
 * Opt-in diagnostics overlay (?debug=1): curl mode, devicePixelRatio, measured
 * refresh rate and per-turn frame stats, so a reader can report real numbers
 * from their machine. Updated only after a turn has finished, never during one.
 */
import type { CurlMode, LongFrame, TurnStats } from './perf';

export function debugEnabled(): boolean {
  try {
    return new URLSearchParams(location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

export type DebugInfo = {
  mode: CurlMode;
  modeWhy: string;
  renderer: string;
  refreshMs: number;
  prewarm: boolean;
  loaf: boolean;
  /** Warm-up progress, e.g. "warm 5/5 · prints 5/5 · done". */
  preload: string;
  /** Font source and timings (see the loader in Layout.astro). */
  fonts: string;
  notes: string[];
};

const MAX_TURNS = 6;

/**
 * Device pixels the compositor fills: the viewport times DPR, and the whole
 * screen's backing store (screen size in CSS px times DPR). On macOS in a
 * "looks like 2560×1440" scaled mode that backing store is 5120×2880 (14.7 MP),
 * drawn at DPR 2 and then downsampled by the window server.
 */
function devicePixels(): { viewport: string; screen: string; viewportMP: number; screenMP: number } {
  const dpr = window.devicePixelRatio || 1;
  const vw = Math.round(window.innerWidth * dpr);
  const vh = Math.round(window.innerHeight * dpr);
  const sw = Math.round(screen.width * dpr);
  const sh = Math.round(screen.height * dpr);
  return {
    viewport: `${vw}x${vh}`,
    screen: `${sw}x${sh}`,
    viewportMP: (vw * vh) / 1e6,
    screenMP: (sw * sh) / 1e6,
  };
}

function pixelLine(): string {
  const px = devicePixels();
  return (
    `window ${window.innerWidth}×${window.innerHeight} css → ${px.viewport.replace('x', '×')} device px (${px.viewportMP.toFixed(1)} MP) · ` +
    `screen ${screen.width}×${screen.height} css → backing ${px.screen.replace('x', '×')} (${px.screenMP.toFixed(1)} MP)`
  );
}

/** Short browser and engine name, from UA client hints where available. */
export function browserLabel(): string {
  const ua = navigator.userAgent;
  const hints = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string; version: string }>; platform?: string } }).userAgentData;
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'other OS';
  const brand = hints?.brands?.find((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand)) ?? hints?.brands?.find((b) => /Chromium/i.test(b.brand));
  if (brand) return `${brand.brand} ${brand.version} · Blink · ${os}`;
  const pick = (re: RegExp) => ua.match(re)?.[1];
  if (/Firefox\//.test(ua)) return `Firefox ${pick(/Firefox\/(\d+)/)} · Gecko · ${os}`;
  if (/Edg\//.test(ua)) return `Edge ${pick(/Edg\/(\d+)/)} · Blink · ${os}`;
  if (/Chrome\//.test(ua)) return `Chrome ${pick(/Chrome\/(\d+)/)} · Blink · ${os}`;
  if (/Safari\//.test(ua)) return `Safari ${pick(/Version\/([\d.]+)/) ?? ''} · WebKit · ${os}`;
  return `${ua.slice(0, 60)} · ${os}`;
}

export class DebugOverlay {
  private bootLog: string[] = [];
  private el: HTMLElement;
  private body: HTMLElement;
  private turns: TurnStats[] = [];
  private info: DebugInfo = {
    mode: 'flat',
    modeWhy: 'not detected yet (flat until then)',
    renderer: '',
    refreshMs: 0,
    prewarm: true,
    loaf: false,
    preload: 'not started',
    fonts: 'no loader',
    notes: [],
  };

  constructor() {
    const el = document.createElement('section');
    el.className = 'debug-overlay';
    el.setAttribute('aria-label', '调试信息');
    el.innerHTML = `
      <div class="debug-head">
        <strong>翻页调试 debug</strong>
        <button type="button" data-debug-copy>复制 copy</button>
        <button type="button" data-debug-clear>清空 clear</button>
        <button type="button" data-debug-hide>收起 hide</button>
      </div>
      <pre class="debug-body"></pre>`;
    document.body.append(el);
    this.el = el;
    this.body = el.querySelector('.debug-body') as HTMLElement;
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => this.render(), 200);
    });
    el.querySelector('[data-debug-copy]')?.addEventListener('click', () => {
      const text = JSON.stringify(this.snapshot(), null, 1);
      navigator.clipboard?.writeText(text).then(
        () => this.flash('copied'),
        () => this.flash('copy failed: select the text instead'),
      );
    });
    el.querySelector('[data-debug-clear]')?.addEventListener('click', () => {
      this.turns = [];
      this.render();
    });
    el.querySelector('[data-debug-hide]')?.addEventListener('click', () => {
      el.classList.toggle('is-collapsed');
    });
    this.render();
  }

  set(partial: Partial<DebugInfo>): void {
    Object.assign(this.info, partial);
    this.render();
  }

  note(text: string): void {
    this.info.notes = [...this.info.notes.slice(-3), text];
    this.render();
  }

  addTurn(stats: TurnStats): void {
    this.turns = [...this.turns.slice(-(MAX_TURNS - 1)), stats];
    this.render();
  }

  private snapshot() {
    const px = devicePixels();
    return {
      ...this.info,
      dpr: window.devicePixelRatio,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      screen: `${screen.width}x${screen.height}`,
      viewportDevicePx: px.viewport,
      screenBackingPx: px.screen,
      browser: browserLabel(),
      userAgent: navigator.userAgent,
      boot: this.bootLog,
      turns: this.turns,
    };
  }

  private flash(text: string): void {
    this.note(text);
  }

  /** Record a start-up milestone (ms since navigation start). */
  boot(label: string, ms: number): void {
    this.bootLog.push(`${label} ${ms}ms`);
    this.render();
  }

  private render(): void {
    const info = this.info;
    const hz = info.refreshMs ? Math.round(1000 / info.refreshMs) : 0;
    const lines = [
      browserLabel(),
      `mode ${info.mode} (${info.modeWhy})`,
      info.renderer ? `gpu  ${info.renderer}` : '',
      `dpr ${window.devicePixelRatio} · refresh ${hz ? `${hz} Hz (${info.refreshMs.toFixed(1)} ms)` : 'measuring…'} · ` +
        `prewarm ${info.prewarm ? 'on' : 'off'} · LoAF ${info.loaf ? 'yes' : 'no'}`,
      pixelLine(),
      `boot ${this.bootLog.join(' · ') || '…'} · preload ${info.preload}`,
      `fonts ${info.fonts}`,
      ...info.notes.map((note) => `note ${note}`),
      '',
      this.turns.length ? 'turn  kind  mode  time   frames  median  p95   worst   slow(>1.5×)  start/mid/end/after  dropped' : 'turn a page to see stats',
    ];
    this.turns.forEach((turn, i) => {
      const n = this.turns.length - i;
      const phase = turn.slowByPhase;
      lines.push(
        [
          `#${n}`.padEnd(5),
          turn.kind.padEnd(5),
          turn.mode.padEnd(5),
          `${turn.durationMs}ms`.padEnd(6),
          String(turn.frames).padEnd(7),
          `${turn.medianMs}`.padEnd(7),
          `${turn.p95Ms}`.padEnd(5),
          `${turn.worstMs}ms`.padEnd(7),
          String(turn.slow).padEnd(12),
          `${phase.start}/${phase.middle}/${phase.end}/${phase.after}`.padEnd(20),
          String(turn.dropped) + (turn.committed ? '' : ' (cancelled)'),
        ].join(' '),
      );
      for (const task of turn.longFrames.length ? turn.longFrames : turn.longTasks) lines.push(`      ${describe(task)}`);
    });
    this.body.textContent = lines.filter((line, i) => line !== '' || i > 0).join('\n');
  }
}

function describe(frame: LongFrame): string {
  const parts = [`long ${frame.duration}ms at +${frame.at}ms`];
  if (frame.blocking) parts.push(`blocking ${frame.blocking}`);
  if (frame.styleLayout !== undefined) parts.push(`style+layout ${frame.styleLayout}`);
  if (frame.render !== undefined) parts.push(`render ${frame.render}`);
  if (frame.scripts?.length) parts.push(`scripts: ${frame.scripts.join('; ')}`);
  return parts.join(' · ');
}
