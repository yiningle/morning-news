/**
 * Display fonts, applied between page turns.
 *
 * Body text uses system fonts; only display text (headlines, masthead, section
 * heads) uses the small per-page web font subsets that Layout.astro's inline
 * loader starts loading in the <head> (window.__displayFonts). Adding a font
 * re-lays out all the text that uses it, in the next frame. Usually the
 * subsets are in before the page script runs and are added at once. If they
 * arrive later, the page-turn code takes over through this gate: they are
 * added in idle time, never while a turn runs (the guard), after the page has
 * taken off-screen pages out of layout (beforeFlush).
 */

export type DisplayFontState = {
  faces: FontFace[];
  bytes: number;
  readyAt: number | null;
  appliedAt: number | null;
  held: number;
  status: 'none' | 'loading' | 'ready' | 'applied' | 'failed';
  gated: boolean;
  apply?: () => void;
  ready?: Promise<void>;
};

const RETRY_MS = 150;

export function displayFonts(): DisplayFontState {
  const w = window as Window & { __displayFonts?: DisplayFontState };
  return (w.__displayFonts ??= { faces: [], bytes: 0, readyAt: null, appliedAt: null, held: 0, status: 'none', gated: false });
}

/** Still to arrive or to be applied. */
export function displayFontsPending(state = displayFonts()): boolean {
  return state.status === 'loading' || state.status === 'ready';
}

function idle(task: () => void): void {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(task, { timeout: 300 });
  else window.setTimeout(task, 30);
}

/**
 * Take over applying the display fonts: `guard` returns true while they must
 * wait (a turn in progress), `beforeFlush` runs just before they are added.
 */
export function gateDisplayFonts(guard: () => boolean, beforeFlush: () => void): void {
  const state = displayFonts();
  if (!displayFontsPending(state) || state.gated) return;
  state.gated = true;
  const attempt = () => {
    if (state.appliedAt !== null) return;
    if (guard()) {
      state.held += 1;
      window.setTimeout(() => idle(attempt), RETRY_MS);
      return;
    }
    beforeFlush();
    state.apply?.();
  };
  if (state.status === 'ready') idle(attempt);
  else state.ready?.then(() => idle(attempt), () => undefined);
}
