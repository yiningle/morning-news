import {
  backwardPath,
  clipHalfPlane,
  createCurlLayers,
  forwardPath,
  makeFold,
  pageRect,
  paintCurl,
  type CurlPose,
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
  let underSheet: HTMLElement | null = null;

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
  });

  bindDrag(slot);
  bindDrawer();

  function scroller(sheet: HTMLElement): HTMLElement {
    return sheet.querySelector<HTMLElement>('.sheet-scroll') ?? sheet;
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
    sheets.forEach((sheet, sheetIndex) => {
      sheet.classList.remove('is-front', 'is-under');
      sheet.style.clipPath = '';
      sheet.style.pointerEvents = '';
      sheet.hidden = sheetIndex !== next;
    });
    index = next;
    scroller(sheets[next]).scrollTop = 0;
    paint();
  }

  function setHash(page: number): void {
    const hash = `#p-${page}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
  }

  function slotSize(): { width: number; height: number } {
    const rect = slot.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function clearCurl(): void {
    window.cancelAnimationFrame(frame);
    pose = null;
    busy = false;
    slot.classList.remove('is-curling');
    slot.dataset.edge = '';
    layers.root.hidden = true;
    layers.print.replaceChildren();
    layers.back.style.filter = '';
    if (frontSheet) {
      frontSheet.style.clipPath = '';
      frontSheet.classList.remove('is-front');
      frontSheet = null;
    }
    if (underSheet) {
      underSheet.classList.remove('is-under');
      underSheet.style.pointerEvents = '';
      underSheet = null;
    }
  }

  function cancelTo(next: number): void {
    clearCurl();
    show(next);
  }

  function mountCurl(from: number, to: number): boolean {
    const { width, height } = slotSize();
    if (width < 20 || height < 20) return false;
    clearCurl();
    frontSheet = sheets[from];
    underSheet = sheets[to];
    frontSheet.hidden = false;
    underSheet.hidden = false;
    frontSheet.classList.add('is-front');
    underSheet.classList.add('is-under');
    underSheet.style.pointerEvents = 'none';
    scroller(underSheet).scrollTop = 0;

    const source = scroller(frontSheet);
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
    layers.print.replaceChildren(wrap);
    clone.scrollTop = source.scrollTop;

    layers.root.hidden = false;
    slot.classList.add('is-curling');
    busy = true;
    paint();
    return true;
  }

  function draw(nextPose: CurlPose): void {
    if (!frontSheet) return;
    const { width, height } = slotSize();
    pose = nextPose;
    paintCurl(layers, frontSheet, width, height, nextPose);
  }

  function finishAt(next: number, push: boolean): void {
    clearCurl();
    show(next);
    if (push) setHash(next);
  }

  function animatePose(from: CurlPose, to: CurlPose, ms: number, done: () => void): void {
    window.cancelAnimationFrame(frame);
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      const e = easeOut(t);
      draw({
        origin: {
          x: lerp(from.origin.x, to.origin.x, e),
          y: lerp(from.origin.y, to.origin.y, e),
        },
        point: {
          x: lerp(from.point.x, to.point.x, e),
          y: lerp(from.point.y, to.point.y, e),
        },
      });
      if (t < 1) frame = requestAnimationFrame(step);
      else done();
    };
    frame = requestAnimationFrame(step);
  }

  function clearedPose(current: CurlPose, width: number, height: number): CurlPose {
    const dx = current.point.x - current.origin.x;
    const dy = current.point.y - current.origin.y;
    const len = Math.hypot(dx, dy) || 1;
    let scale = Math.max(len * 1.15, Math.hypot(width, height));
    let point = {
      x: current.origin.x + (dx / len) * scale,
      y: current.origin.y + (dy / len) * scale,
    };
    for (let step = 0; step < 6; step += 1) {
      const fold = makeFold(current.origin, point);
      if (!fold || clipHalfPlane(pageRect(width, height), fold, false).length < 3) break;
      scale *= 1.4;
      point = {
        x: current.origin.x + (dx / len) * scale,
        y: current.origin.y + (dy / len) * scale,
      };
    }
    return { origin: { ...current.origin }, point };
  }

  function playPath(forward: boolean, next: number, push: boolean): void {
    if (!mountCurl(index, next)) {
      finishAt(next, push);
      return;
    }
    const { width, height } = slotSize();
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / AUTO_MS);
      draw(forward ? forwardPath(easeInOut(t), width, height) : backwardPath(easeInOut(t), width, height));
      if (t < 1) frame = requestAnimationFrame(step);
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
      animatePose(current, clearedPose(current, width, height), COMPLETE_MS, () => finishAt(next, true));
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
          target.style.touchAction = 'none';
          try {
            target.setPointerCapture(pointerId);
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
      target.style.touchAction = '';
      if (!dragging || !pose) {
        dragging = false;
        return;
      }
      dragging = false;
      const next = index + (forward ? 1 : -1);
      releaseDrag(forward, next, pose);
    };

    target.addEventListener('pointerleave', () => {
      if (!tracking) target.dataset.edge = '';
    });
    target.addEventListener('pointerup', endDrag);
    target.addEventListener('pointercancel', (event) => {
      if (!tracking || event.pointerId !== pointerId) return;
      tracking = false;
      dragging = false;
      target.style.touchAction = '';
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
