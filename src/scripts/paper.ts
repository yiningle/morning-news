import {
  backwardPath,
  createCurlLayers,
  forwardPath,
  paintCurl,
  poseCleared,
  resetCurlLayers,
  resetHalfPlane,
  type CurlMode,
  type CurlPose,
  type HalfPlane,
  type Pt,
} from './curl';

const COMPLETE_MS = 760;
const CANCEL_MS = 440;
const AUTO_MS = 980;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readHash(count: number): number {
  const match = location.hash.match(/^#p-(\d+)$/);
  if (!match) return 0;
  const page = Number(match[1]);
  if (!Number.isInteger(page) || page < 0 || page >= count) return 0;
  return page;
}

type IdleHandle = { cancel: () => void };

/** requestIdleCallback with a setTimeout fallback (Safari). */
function whenIdle(task: (deadline: { timeRemaining: () => number }) => void, timeout = 1500): IdleHandle {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task, { timeout });
    return { cancel: () => window.cancelIdleCallback(id) };
  }
  const id = window.setTimeout(() => {
    const started = performance.now();
    task({ timeRemaining: () => Math.max(0, 12 - (performance.now() - started)) });
  }, 32);
  return { cancel: () => window.clearTimeout(id) };
}

/**
 * Run a task in an idle period that has at least `minMs` left, so even a
 * restyle that is cheap but not tiny never pushes back the next frame. Gives up
 * waiting after `timeout` ms.
 */
function whenRoomy(minMs: number, task: () => void, timeout = 1500): IdleHandle {
  const until = performance.now() + timeout;
  let handle: IdleHandle;
  const attempt = (deadline: { timeRemaining: () => number }) => {
    if (deadline.timeRemaining() >= minMs || performance.now() >= until) task();
    else handle = whenIdle(attempt, Math.max(1, until - performance.now()));
  };
  handle = whenIdle(attempt, timeout);
  return { cancel: () => handle.cancel() };
}

function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

function parseUnicodeRange(range: string): Array<[number, number]> {
  return range
    .split(',')
    .map((part) => part.trim().replace(/^U\+/i, ''))
    .filter(Boolean)
    .map((part): [number, number] => {
      if (part.includes('?')) {
        return [parseInt(part.replace(/\?/g, '0'), 16), parseInt(part.replace(/\?/g, 'F'), 16)];
      }
      const [lo, hi] = part.split('-');
      return [parseInt(lo, 16), parseInt(hi ?? lo, 16)];
    });
}

/**
 * Font faces a piece of text needs that have not been fetched yet. Only
 * supplementary subsets (e.g. the rare-glyph file for 钍) are considered: the
 * main faces are preloaded in <head>, and the Latin subsets are shadowed by the
 * full simplified-Chinese files, so fetching them would only waste bytes.
 */
function missingFaces(text: string): FontFace[] {
  if (!document.fonts) return [];
  const codes = [...new Set(text)].map((ch) => ch.codePointAt(0) ?? 0);
  const faces: FontFace[] = [];
  document.fonts.forEach((face) => {
    if (face.status !== 'unloaded') return;
    const ranges = parseUnicodeRange(face.unicodeRange);
    const coversLatin = ranges.some(([lo, hi]) => lo <= 0x41 && hi >= 0x41);
    if (coversLatin) return;
    if (codes.some((code) => ranges.some(([lo, hi]) => code >= lo && code <= hi))) faces.push(face);
  });
  return faces;
}

/**
 * Whether the page is composited on a real GPU. A software compositor (no GPU,
 * blocklisted driver, SwiftShader) would have to blend every rotated clip box
 * on the CPU, which costs more than re-rastering clip-path polygons.
 * `?curl=gpu|flat` forces a mode for testing.
 */
function detectCurlMode(): CurlMode {
  const forced = new URLSearchParams(location.search).get('curl');
  if (forced === 'gpu' || forced === 'flat') return forced;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    if (!gl) return 'flat';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(renderer) ? 'flat' : 'gpu';
  } catch {
    return 'flat';
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function initPaper(rootArg: ParentNode | null = document.querySelector('[data-paper]')): void {
  if (!(rootArg instanceof HTMLElement) || rootArg.dataset.ready === 'true') return;
  const root: HTMLElement = rootArg;
  const sheets = [...root.querySelectorAll<HTMLElement>('[data-sheet]')];
  const slotQuery = root.querySelector<HTMLElement>('[data-slot]');
  if (sheets.length === 0 || !slotQuery) return;
  const slot: HTMLElement = slotQuery;
  root.dataset.ready = 'true';

  const pager = root.querySelector<HTMLElement>('[data-pager]');
  const live = root.querySelector<HTMLElement>('[data-live]');
  const pageLinks = [...root.querySelectorAll<HTMLElement>('[data-page]')];
  const turnButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-turn]')];
  const toggle = root.querySelector<HTMLButtonElement>('[data-toc-toggle]');
  const drawer = root.querySelector<HTMLElement>('#toc-drawer');
  const scrim = root.querySelector<HTMLElement>('[data-toc-scrim]');
  const layers = createCurlLayers(slot);

  let index = readHash(sheets.length);
  let busy = false;
  let drawerOpen = false;
  let frame = 0;
  let pose: CurlPose | null = null;
  let frontSheet: HTMLElement | null = null;
  let frontPlane: HalfPlane | null = null;
  let underSheet: HTMLElement | null = null;

  /* Background preloading: lay out hidden sheets and pre-render one curl print per sheet. */
  type Snapshot = { width: number; height: number; wrap: HTMLElement; clone: HTMLElement };
  const snapshots = new Map<number, Snapshot>();
  const warmed = new Set<number>();
  /* A sheet just turned away from: fully clipped, hidden for real a few frames later. */
  let retiring: HTMLElement | null = null;
  let retireJob: IdleHandle | null = null;
  let retireFrame = 0;
  /* Flat (clip-path) until the idle-time GPU check says the compositor path is safe. */
  let curlMode: CurlMode = 'flat';
  let curlWidth = 0;
  let curlHeight = 0;
  const shield = document.createElement('div');
  shield.className = 'curl-shield';
  shield.setAttribute('aria-hidden', 'true');
  slot.appendChild(shield);
  let preloadStarted = false;
  let preloadJob: IdleHandle | null = null;
  let resizeTimer = 0;

  document.documentElement.classList.add('js-epaper');
  document.body.classList.add('is-locked');
  show(index);

  root.addEventListener(
    'click',
    (event) => {
      if (root.dataset.suppressClick === 'true') {
        root.dataset.suppressClick = 'false';
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const pageLink = target.closest<HTMLElement>('[data-page]');
      if (pageLink && root.contains(pageLink)) {
        event.preventDefault();
        if (drawer?.contains(pageLink)) setDrawer(false);
        go(Number(pageLink.dataset.page), true);
        return;
      }
      const turn = target.closest<HTMLButtonElement>('[data-turn]');
      if (turn && root.contains(turn) && !turn.disabled) {
        go(index + Number(turn.dataset.turn), true);
      }
    },
    true,
  );

  window.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => {
    const next = readHash(sheets.length);
    if (next === index) return;
    if (busy) {
      cancelTo(next);
      return;
    }
    go(next, false);
  });
  window.addEventListener('resize', () => {
    if (busy) cancelTo(index);
    dropSnapshots();
    // Let hidden sheets drop back to skipped while the size changes, then re-prepare.
    if (warmed.size > 0) {
      sheets.forEach((sheet) => sheet.classList.remove('is-warm'));
      warmed.clear();
      keepWarm(index);
    }
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      schedulePreload();
    }, 250);
  });

  bindDrag(slot);
  bindDrawer();

  if (document.readyState === 'complete') startPreload();
  else window.addEventListener('load', startPreload, { once: true });

  function scroller(sheet: HTMLElement): HTMLElement {
    return sheet.querySelector<HTMLElement>('.sheet-scroll') ?? sheet;
  }

  /** The wrappers a turn cuts a sheet with (see .sheet-clip in paper.css). */
  function planeOf(sheet: HTMLElement): HalfPlane {
    const box = sheet.querySelector<HTMLElement>(':scope > .sheet-clip') ?? sheet;
    const content = box.querySelector<HTMLElement>(':scope > .sheet-unclip') ?? box;
    return { box, content };
  }

  function paint(): void {
    pageLinks.forEach((link) => {
      const current = Number(link.dataset.page) === index;
      if (current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    turnButtons.forEach((button) => {
      const direction = Number(button.dataset.turn);
      button.disabled = busy || (direction < 0 ? index <= 0 : index >= sheets.length - 1);
    });
    const label = sheets[index]?.dataset.label ?? '';
    const text = `${label} · ${index + 1} / ${sheets.length}`;
    if (pager) pager.textContent = text;
    if (live) live.textContent = `第 ${index + 1} 版，${label}`;
    slot.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function show(next: number): void {
    flushRetire();
    sheets.forEach((sheet, sheetIndex) => {
      sheet.classList.remove('is-front', 'is-under');
      resetHalfPlane(planeOf(sheet));
      sheet.hidden = sheetIndex !== next;
    });
    index = next;
    keepWarm(next);
    scroller(sheets[next]).scrollTop = 0;
    paint();
    schedulePreload();
  }

  /** A sheet that has been shown is laid out already: keep it rendered when it is hidden again. */
  function keepWarm(page: number): void {
    warmed.add(page);
    sheets[page]?.classList.add('is-warm');
  }

  /**
   * End of a turn: the last curl frame already shows the next page exactly
   * (the turned page is cut away completely and nothing it casts is left), so
   * this frame changes nothing on the pages: no layer, clip, z-index or
   * visibility change. The page turned away from is hidden for real (and its
   * layers dropped) a few frames later in idle time.
   */
  function settle(next: number): void {
    flushRetire();
    const old = sheets[index];
    const incoming = sheets[next];
    incoming.hidden = false;
    index = next;
    keepWarm(next);
    if (old && old !== incoming) {
      settleFrom(old);
      return;
    }
    incoming.classList.remove('is-front', 'is-under');
    resetHalfPlane(planeOf(incoming));
    paint();
    schedulePreload();
  }

  function flushRetire(): void {
    if (retireFrame) cancelAnimationFrame(retireFrame);
    retireFrame = 0;
    retireJob?.cancel();
    retireJob = null;
    if (!retiring) return;
    const sheet = retiring;
    retiring = null;
    const current = sheets[index];
    if (sheet !== current || busy) sheet.hidden = true;
    sheet.classList.remove('is-front', 'is-under');
    resetHalfPlane(planeOf(sheet));
    if (current && current !== sheet && !busy) current.classList.remove('is-front', 'is-under');
  }

  function startPreload(): void {
    if (preloadStarted) return;
    whenIdle(() => {
      // Fetch any rare-glyph font subsets the hidden sheets need first, and wait
      // for fonts to settle: a font arriving later would invalidate every
      // sheet's text layout and undo the warm-up.
      const pages = saveData() ? [index, ...preloadOrder()] : sheets.map((_, page) => page);
      const text = pages.map((page) => sheets[page]?.textContent ?? '').join('');
      const loads = missingFaces(text).map((face) => face.load().catch(() => undefined));
      const ready = document.fonts ? document.fonts.ready : Promise.resolve();
      Promise.all([...loads, ready]).finally(() => {
        if (!busy) setCurlMode(detectCurlMode());
        preloadStarted = true;
        schedulePreload();
        prefetchAdjacentIssues();
      });
    });
  }

  function setCurlMode(mode: CurlMode): void {
    curlMode = mode;
    // Pre-promotes the curl parts and the shown sheet's fold wrappers (paper.css).
    slot.classList.toggle('curl-gpu', mode === 'gpu');
    slot.dataset.curl = mode;
  }

  /** Sheets to prepare, nearest first and forward before backward. */
  function preloadOrder(): number[] {
    if (saveData()) {
      const adjacent = index + 1 < sheets.length ? index + 1 : index - 1;
      return adjacent >= 0 && adjacent !== index ? [adjacent] : [];
    }
    const order: number[] = [];
    for (let step = 1; step < sheets.length; step += 1) {
      if (index + step < sheets.length) order.push(index + step);
      if (index - step >= 0) order.push(index - step);
    }
    return order;
  }

  /** The next unit of background work, or null when everything is ready. */
  function nextPreloadTask(): (() => void) | null {
    const order = preloadOrder();
    const adjacent = order[0];
    if (adjacent !== undefined && !warmed.has(adjacent)) return () => warmSheet(adjacent);
    const curls = !prefersReducedMotion() && sheets.length > 1;
    if (curls && !snapshotReady(index)) return () => buildSnapshot(index);
    for (const page of order) {
      if (!warmed.has(page)) return () => warmSheet(page);
    }
    // The print on the back of the curl, for every sheet a turn can start from.
    if (curls) {
      for (const page of order) {
        if (!snapshotReady(page)) return () => buildSnapshot(page);
      }
    }
    return null;
  }

  function schedulePreload(): void {
    if (!preloadStarted || preloadJob) return;
    root.dataset.preloaded = 'false';
    preloadJob = whenIdle(() => {
      preloadJob = null;
      // Never compete with a page turn in progress or one that is settling.
      if (busy || retiring) {
        schedulePreload();
        return;
      }
      // One sheet-sized unit per idle period keeps every task short and lets
      // input and animation frames run in between.
      const task = nextPreloadTask();
      if (!task) {
        root.dataset.preloaded = 'true';
        return;
      }
      task();
      schedulePreload();
    });
  }

  /** Render a hidden sheet ahead of time (still invisible) so a flip only has to show it. */
  function warmSheet(page: number): void {
    warmed.add(page);
    const sheet = sheets[page];
    if (!sheet || !sheet.hidden) return;
    sheet.classList.add('is-warm');
    void scroller(sheet).scrollHeight;
  }

  function snapshotReady(page: number): boolean {
    const snap = snapshots.get(page);
    if (!snap) return false;
    const { width, height } = slotSize();
    if (width < 20 || height < 20) return true;
    return snap.width === width && snap.height === height;
  }

  function dropSnapshots(): void {
    if (busy) return;
    snapshots.clear();
    layers.printActive = null;
    layers.print.replaceChildren();
  }

  /** Clone a sheet into the curl layer: the mirrored print seen on the turning page's back. */
  function makeSnapshot(from: number, width: number, height: number): Snapshot {
    snapshots.get(from)?.wrap.remove();
    const source = scroller(sheets[from]);
    const slotRect = slot.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const clone = source.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    clone.setAttribute('inert', '');
    clone.setAttribute('aria-hidden', 'true');
    clone.style.position = 'absolute';
    clone.style.left = `${sourceRect.left - slotRect.left}px`;
    clone.style.top = `${sourceRect.top - slotRect.top}px`;
    clone.style.width = `${sourceRect.width}px`;
    clone.style.height = `${sourceRect.height}px`;
    clone.style.margin = '0';
    clone.style.overflow = 'hidden';
    const wrap = document.createElement('div');
    wrap.className = 'curl-print-sheet';
    wrap.append(clone);
    layers.print.append(wrap);
    const snap = { width, height, wrap, clone };
    snapshots.set(from, snap);
    return snap;
  }

  /** Build and lay out a sheet's curl print ahead of time; it then stays ready for every later turn. */
  function buildSnapshot(page: number): void {
    if (busy) return;
    const { width, height } = slotSize();
    if (width < 20 || height < 20) return;
    const snap = makeSnapshot(page, width, height);
    void snap.clone.scrollHeight;
  }

  function prefetchAdjacentIssues(): void {
    if (saveData()) return;
    const urls = [root.dataset.prevIssue, root.dataset.nextIssue].filter((url): url is string => Boolean(url));
    whenIdle(() => {
      for (const href of urls) {
        if (document.head.querySelector(`link[rel="prefetch"][href="${href}"]`)) continue;
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = href;
        link.as = 'document';
        document.head.append(link);
      }
    }, 4000);
  }

  function setHash(page: number): void {
    const hash = `#p-${page}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
  }

  function slotSize(): { width: number; height: number } {
    const rect = slot.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  /**
   * Tear the curl down. Only cheap, non-inherited changes happen here (opacity,
   * z-index, clip-path, a class on an empty shield), so the frame that ends a
   * turn does not restyle the pages.
   */
  function clearCurl(): void {
    window.cancelAnimationFrame(frame);
    pose = null;
    busy = false;
    slot.classList.remove('is-curling');
    layers.root.hidden = true;
    // The pages keep their is-front / is-under stacking until the turned-away
    // sheet is retired, so ending a turn changes no z-index on the pages.
    frontSheet = null;
    frontPlane = null;
    underSheet = null;
  }

  function cancelTo(next: number): void {
    const keep = sheets[next];
    const under = underSheet;
    clearCurl();
    if (keep && !keep.hidden && under && under !== keep && !prefersReducedMotion()) {
      // Cancelled turn: the page never left. Put it back whole (it stays
      // stacked above the one underneath) and retire the one underneath.
      resetHalfPlane(planeOf(keep));
      index = next;
      settleFrom(under);
      return;
    }
    show(next);
  }

  /**
   * Retire a sheet that is no longer shown. It is already invisible (cut away
   * by the turn, or covered by the page stacked above it) and is hidden for
   * real two frames later in idle time, never in the frames that finish the turn.
   */
  function settleFrom(sheet: HTMLElement): void {
    flushRetire();
    retiring = sheet;
    retireFrame = requestAnimationFrame(() => {
      retireFrame = requestAnimationFrame(() => {
        retireFrame = 0;
        retireJob = whenRoomy(12, () => {
          retireJob = null;
          flushRetire();
          // Do the restyle now, inside the idle period, not in the next frame.
          void slot.offsetWidth;
          // The edge cursor is inherited, so clearing it restyles every page: its own idle task.
          if (slot.dataset.edge) {
            retireJob = whenRoomy(14, () => {
              retireJob = null;
              if (busy) return;
              slot.dataset.edge = '';
              void slot.offsetWidth;
            }, 1000);
          }
        }, 1000);
      });
    });
    paint();
    schedulePreload();
  }

  function mountCurl(from: number, to: number): boolean {
    const { width, height } = slotSize();
    if (width < 20 || height < 20) return false;
    clearCurl();
    flushRetire();
    if (width !== curlWidth || height !== curlHeight) {
      // Bands just long enough to cross the page at any angle (set only when the size changes).
      layers.root.style.setProperty('--curl-band', `${Math.ceil(Math.hypot(width, height) * 2)}px`);
    }
    curlWidth = width;
    curlHeight = height;
    frontSheet = sheets[from];
    frontPlane = planeOf(frontSheet);
    underSheet = sheets[to];
    sheets.forEach((sheet) => {
      if (sheet !== frontSheet) sheet.classList.remove('is-front');
      if (sheet !== underSheet) sheet.classList.remove('is-under');
    });
    frontSheet.hidden = false;
    underSheet.hidden = false;
    resetHalfPlane(planeOf(underSheet));
    resetHalfPlane(frontPlane);
    resetCurlLayers(layers);
    frontSheet.classList.add('is-front');
    underSheet.classList.add('is-under');
    scroller(underSheet).scrollTop = 0;

    const source = scroller(frontSheet);
    let snap = snapshots.get(from);
    if (!snap || snap.width !== width || snap.height !== height) snap = makeSnapshot(from, width, height);
    if (layers.printActive !== snap.wrap) {
      layers.printActive?.classList.remove('is-active');
      snap.wrap.classList.add('is-active');
      layers.printActive = snap.wrap;
    }
    snap.clone.scrollTop = source.scrollTop;

    layers.root.hidden = false;
    slot.classList.add('is-curling');
    busy = true;
    paint();
    return true;
  }

  /** Paint one curl frame. Returns true once the turning page has completely left the slot. */
  function draw(nextPose: CurlPose): boolean {
    if (!frontPlane) return false;
    pose = nextPose;
    // Size cached at mount (a resize cancels the turn): no layout read per frame.
    return paintCurl(layers, frontPlane, curlWidth, curlHeight, nextPose, curlMode) === 'cleared';
  }

  function finishAt(next: number, push: boolean): void {
    const curled = frontPlane !== null;
    clearCurl();
    if (curled) settle(next);
    else show(next);
    // The history entry is not needed in the frame that ends the turn.
    if (push) whenIdle(() => setHash(next), 200);
  }

  function animatePose(
    from: CurlPose,
    to: CurlPose,
    ms: number,
    done: () => void,
    finishWhenCleared = false,
  ): void {
    window.cancelAnimationFrame(frame);
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      const e = easeOut(t);
      const cleared = draw({
        origin: {
          x: lerp(from.origin.x, to.origin.x, e),
          y: lerp(from.origin.y, to.origin.y, e),
        },
        point: {
          x: lerp(from.point.x, to.point.x, e),
          y: lerp(from.point.y, to.point.y, e),
        },
      });
      // Once the page is fully off the slot nothing on screen moves any more:
      // finish now instead of holding still frames until the clock runs out.
      if (t < 1 && !(finishWhenCleared && cleared)) frame = requestAnimationFrame(step);
      else done();
    };
    frame = requestAnimationFrame(step);
  }

  /**
   * Where a released drag heads: along the drag direction, a little past the
   * nearest point at which the page, its flap and its shadow have all left the
   * slot. The page leaves while the ease-out is still moving it (no long
   * near-still tail before the turn commits), and never in a jump.
   */
  function clearedPose(current: CurlPose, width: number, height: number): CurlPose {
    const dx = current.point.x - current.origin.x;
    const dy = current.point.y - current.origin.y;
    const len = Math.hypot(dx, dy) || 1;
    const at = (scale: number): CurlPose => ({
      origin: { ...current.origin },
      point: { x: current.origin.x + (dx / len) * scale, y: current.origin.y + (dy / len) * scale },
    });
    let low = len;
    let high = Math.max(len * 2, Math.hypot(width, height) * 2);
    for (let step = 0; step < 8 && !poseCleared(width, height, at(high)); step += 1) high *= 1.6;
    for (let step = 0; step < 24; step += 1) {
      const mid = (low + high) / 2;
      if (poseCleared(width, height, at(mid))) high = mid;
      else low = mid;
    }
    return at(high + Math.max(60, (high - len) * 0.3));
  }

  function playPath(forward: boolean, next: number, push: boolean): void {
    if (!mountCurl(index, next)) {
      finishAt(next, push);
      return;
    }
    const width = curlWidth;
    const height = curlHeight;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / AUTO_MS);
      const cleared = draw(
        forward ? forwardPath(easeInOut(t), width, height) : backwardPath(easeInOut(t), width, height),
      );
      // The sheet leaves the slot at about 85% of the path; the remaining frames
      // would show nothing moving and read as a stall before the turn commits.
      if (t < 1 && !cleared) frame = requestAnimationFrame(step);
      else finishAt(next, push);
    };
    frame = requestAnimationFrame(step);
  }

  function go(next: number, push: boolean): void {
    if (!Number.isInteger(next) || next < 0 || next >= sheets.length || next === index || busy) return;
    if (prefersReducedMotion()) {
      show(next);
      if (push) setHash(next);
      return;
    }
    playPath(next > index, next, push);
  }

  function releaseDrag(forward: boolean, next: number, current: CurlPose): void {
    const { width, height } = slotSize();
    const passed = forward ? current.point.x < width * 0.5 : current.point.x > width * 0.5;
    if (passed && next >= 0 && next < sheets.length) {
      const target = clearedPose(current, width, height);
      // Keep the hand's pace: a short remaining throw takes less time than a long one.
      const travel = Math.hypot(target.point.x - current.point.x, target.point.y - current.point.y);
      const ms = Math.min(COMPLETE_MS, Math.max(420, travel * 0.45));
      animatePose(current, target, ms, () => finishAt(next, true), true);
      return;
    }
    animatePose(current, { origin: current.origin, point: { ...current.origin } }, CANCEL_MS, () => cancelTo(index));
  }

  function bindDrag(target: HTMLElement): void {
    let tracking = false;
    let dragging = false;
    let pointerId = -1;
    let forward = true;
    let origin: Pt = { x: 0, y: 0 };
    let startX = 0;
    let startY = 0;

    const localPoint = (event: PointerEvent): Pt => {
      const rect = target.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const edgeAt = (point: Pt, width: number): 'left' | 'right' | '' => {
      const zone = Math.max(36, width * (width < 720 ? 0.18 : 0.12));
      if (point.x >= width - zone) return 'right';
      if (point.x <= zone) return 'left';
      return '';
    };

    target.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || busy || prefersReducedMotion() || !event.isPrimary) return;
      const { width, height } = slotSize();
      const point = localPoint(event);
      const edge = edgeAt(point, width);
      if (!edge) return;
      if (edge === 'right' && index >= sheets.length - 1) return;
      if (edge === 'left' && index <= 0) return;
      forward = edge === 'right';
      let gy = point.y;
      if (point.y < height * 0.22) gy = 0;
      else if (point.y > height * 0.78) gy = height;
      else gy = Math.min(height - 8, Math.max(8, point.y));
      origin = { x: forward ? width : 0, y: gy };
      tracking = true;
      dragging = false;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
    });

    target.addEventListener(
      'pointermove',
      (event) => {
        if (!tracking || event.pointerId !== pointerId) {
          if (tracking || busy) return;
          const { width } = slotSize();
          const edge = edgeAt(localPoint(event), width);
          const onControl = event.target instanceof Element && Boolean(event.target.closest('a, button'));
          const blocked =
            (edge === 'right' && index >= sheets.length - 1) || (edge === 'left' && index <= 0);
          target.dataset.edge = edge && !blocked && !onControl && !prefersReducedMotion() ? edge : '';
          return;
        }
        const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
        if (!dragging) {
          if (moved < 8) return;
          const inward = forward ? startX - event.clientX : event.clientX - startX;
          const vertical = Math.abs(event.clientY - startY);
          if (inward < 12) {
            if (vertical > 22) tracking = false;
            return;
          }
          const next = index + (forward ? 1 : -1);
          if (!mountCurl(index, next)) {
            tracking = false;
            return;
          }
          dragging = true;
          root.dataset.suppressClick = 'true';
          try {
            // Capture on the shield so the drag shows its grabbing cursor; events still bubble to the slot.
            shield.setPointerCapture(pointerId);
          } catch {
            /* The sheet still receives the move while the pointer stays over it. */
          }
        }
        event.preventDefault();
        const point = localPoint(event);
        const { width, height } = slotSize();
        const clamped: Pt = {
          x: forward
            ? Math.min(origin.x - 2, Math.max(-width * 0.2, point.x))
            : Math.max(origin.x + 2, Math.min(width * 1.2, point.x)),
          y: Math.min(height + 28, Math.max(-28, point.y)),
        };
        draw({ origin, point: clamped });
      },
      { passive: false },
    );

    const endDrag = (event: PointerEvent) => {
      if (!tracking || event.pointerId !== pointerId) return;
      tracking = false;
      if (!dragging || !pose) {
        dragging = false;
        return;
      }
      dragging = false;
      const next = index + (forward ? 1 : -1);
      releaseDrag(forward, next, pose);
    };

    // No text selection while a turn is being dragged (the slot used to get user-select: none).
    target.addEventListener('selectstart', (event) => {
      if (dragging || busy) event.preventDefault();
    });

    target.addEventListener('pointerleave', () => {
      if (!tracking) target.dataset.edge = '';
    });
    target.addEventListener('pointerup', endDrag);
    target.addEventListener('pointercancel', (event) => {
      if (!tracking || event.pointerId !== pointerId) return;
      tracking = false;
      dragging = false;
      if (busy) cancelTo(index);
    });
  }

  function drawerLinks(): HTMLElement[] {
    if (!drawer) return [];
    return [...drawer.querySelectorAll<HTMLElement>('a[href]')];
  }

  function setDrawer(next: boolean): void {
    if (!toggle || !drawer || !scrim || next === drawerOpen) return;
    drawerOpen = next;
    root.classList.toggle('is-toc-open', next);
    toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    drawer.toggleAttribute('inert', !next);
    drawer.setAttribute('aria-hidden', next ? 'false' : 'true');
    scrim.hidden = !next;
    if (next) {
      const first = drawerLinks()[0];
      if (first) first.focus();
      else drawer.focus();
    } else {
      toggle.focus();
    }
  }

  function bindDrawer(): void {
    if (!toggle || !drawer || !scrim) return;
    drawer.tabIndex = -1;
    toggle.addEventListener('click', () => setDrawer(!drawerOpen));
    scrim.addEventListener('click', () => setDrawer(false));
  }

  function onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    }
    if (drawerOpen && drawer) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDrawer(false);
        return;
      }
      if (event.key === 'Tab') {
        const items = drawerLinks();
        if (items.length === 0) {
          event.preventDefault();
          drawer.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !drawer.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !drawer.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(index + 1, true);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(index - 1, true);
    } else if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      scroller(sheets[index]).scrollBy({ top: event.key === 'PageDown' ? 320 : 88, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      scroller(sheets[index]).scrollBy({ top: event.key === 'PageUp' ? -320 : -88, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }
}
