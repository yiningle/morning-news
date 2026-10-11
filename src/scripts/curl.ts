export type Pt = { x: number; y: number };

export type Fold = {
  mx: number;
  my: number;
  nx: number;
  ny: number;
};

const EPS = 0.4;

export function makeFold(origin: Pt, point: Pt): Fold | null {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) return null;
  return {
    mx: (origin.x + point.x) / 2,
    my: (origin.y + point.y) / 2,
    nx: dx / len,
    ny: dy / len,
  };
}

export function sideOf(p: Pt, fold: Fold): number {
  return (p.x - fold.mx) * fold.nx + (p.y - fold.my) * fold.ny;
}

export function reflectPoint(p: Pt, fold: Fold): Pt {
  const s = sideOf(p, fold);
  return { x: p.x - 2 * s * fold.nx, y: p.y - 2 * s * fold.ny };
}

export function pageRect(width: number, height: number): Pt[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

function crossing(a: Pt, b: Pt, fold: Fold): Pt | null {
  const sa = sideOf(a, fold);
  const sb = sideOf(b, fold);
  const den = sa - sb;
  if (Math.abs(den) < 1e-4) return null;
  const t = sa / den;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Keep the half-plane where side >= 0 when `keepPositive`, otherwise side <= 0. */
export function clipHalfPlane(poly: Pt[], fold: Fold, keepPositive: boolean): Pt[] {
  if (poly.length < 3) return [];
  const inside = (p: Pt) => (keepPositive ? sideOf(p, fold) >= -EPS : sideOf(p, fold) <= EPS);
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const current = poly[i];
    const next = poly[(i + 1) % poly.length];
    const currentIn = inside(current);
    const nextIn = inside(next);
    if (currentIn && nextIn) {
      out.push(next);
    } else if (currentIn && !nextIn) {
      const hit = crossing(current, next, fold);
      if (hit) out.push(hit);
    } else if (!currentIn && nextIn) {
      const hit = crossing(current, next, fold);
      if (hit) out.push(hit);
      out.push(next);
    }
  }
  return out;
}

export function reflectionCSS(fold: Fold): string {
  const { mx, my, nx, ny } = fold;
  const a = 1 - 2 * nx * nx;
  const b = -2 * nx * ny;
  const c = -2 * ny * nx;
  const d = 1 - 2 * ny * ny;
  const dot = mx * nx + my * ny;
  const tx = 2 * dot * nx;
  const ty = 2 * dot * ny;
  const n = (value: number) => value.toFixed(4);
  return `matrix(${n(a)}, ${n(b)}, ${n(c)}, ${n(d)}, ${n(tx)}, ${n(ty)})`;
}

/** CSS rotation whose x axis follows the fold (y-down screen space). */
export function foldCssAngle(fold: Fold): number {
  return (Math.atan2(fold.nx, -fold.ny) * 180) / Math.PI;
}

export type CurlPose = {
  origin: Pt;
  point: Pt;
};

/** The two wrappers inside a sheet that cut it along the fold: a rotated clip box and its counter-transformed content. */
export type HalfPlane = { box: HTMLElement; content: HTMLElement };

export type CurlLayers = {
  root: HTMLElement;
  /**
   * One unclipped band along the fold: its lifted side is the shadow the page
   * casts on the page underneath, its other side the shading on the turning
   * page. (Two bands each clipped to its side cost two offscreen passes.)
   */
  cast: HTMLElement;
  back: HTMLElement;
  /** The mirrored page box: reflected across the fold, inside the clip box that keeps the flap side. */
  backPage: HTMLElement;
  print: HTMLElement;
  /** The prepared print (one per sheet) shown on the back of the current turn. */
  printActive: HTMLElement | null;
  shadeBand: HTMLElement;
  fold: HTMLElement;
};

/*
 * Every moving part of the curl is a pre-promoted layer (will-change: transform)
 * of fixed size, and each frame only writes transforms. Cutting along the fold
 * is done with a large rotated overflow:hidden box whose edge lies on the fold
 * and whose content is counter-transformed back into page space; the compositor
 * clips that on the GPU, so nothing is laid out, painted or rasterised per frame.
 */
export function createCurlLayers(slot: HTMLElement): CurlLayers {
  const root = document.createElement('div');
  root.className = 'curl-layer';
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="curl-band curl-cast"></div>
    <div class="curl-hp curl-back">
      <div class="curl-back-page">
        <div class="curl-print"></div>
        <div class="curl-tint"></div>
        <div class="curl-band curl-shade-band"></div>
      </div>
    </div>
    <div class="curl-band curl-fold"></div>
  `;
  slot.appendChild(root);
  const q = (selector: string) => root.querySelector(selector) as HTMLElement;
  return {
    root,
    cast: q('.curl-cast'),
    back: q('.curl-back'),
    backPage: q('.curl-back-page'),
    print: q('.curl-print'),
    printActive: null,
    shadeBand: q('.curl-shade-band'),
    fold: q('.curl-fold'),
  };
}

const px = (value: number) => `${value.toFixed(3)}px`;

/** Height in CSS of every .curl-band; bands are stretched to their thickness with scaleY. */
const BAND_BASE = 100;

/**
 * Bands are centred where the fold line passes closest to the page centre, so
 * a band one page-diagonal long (see --curl-band) always spans the page: every
 * page point projects onto the fold within half a diagonal of that spot.
 * Bands hold only a gradient, so stretching them with scaleY costs no text raster.
 */
function placeBand(el: HTMLElement, at: Pt, angleDeg: number, thickness: number): void {
  setTransform(
    el,
    `translate(${px(at.x)}, ${px(at.y)}) rotate(${angleDeg.toFixed(4)}deg) ` +
      `scale(1, ${(thickness / BAND_BASE).toFixed(4)}) translate(-50%, -50%)`,
  );
}

/** The point of the fold line nearest the page centre. */
function bandCentre(fold: Fold, width: number, height: number): Pt {
  const side = sideOf({ x: width / 2, y: height / 2 }, fold);
  return { x: width / 2 - side * fold.nx, y: height / 2 - side * fold.ny };
}

/** Length of every band for a page of this size (one diagonal plus a margin). */
export function bandLength(width: number, height: number): number {
  return Math.ceil(Math.hypot(width, height)) + 8;
}

type HalfPlaneTransforms = { box: string; content: string };

/**
 * Transforms that turn a width x height box into a size x size square whose
 * edge lies on the fold, covering the side >= 0 (`positive`) or side <= 0, and
 * the inverse for its content so the content stays exactly where it was.
 */
function halfPlane(fold: Fold, width: number, height: number, size: number, positive: boolean): HalfPlaneTransforms {
  const angle = (Math.atan2(fold.ny, fold.nx) * 180) / Math.PI;
  const sx = (size / width).toFixed(6);
  const sy = (size / height).toFixed(6);
  const ix = (width / size).toFixed(8);
  const iy = (height / size).toFixed(8);
  const shift = positive ? 0 : -size;
  return {
    box: `translate(${px(fold.mx)}, ${px(fold.my)}) rotate(${angle.toFixed(5)}deg) translate(${shift}px, ${-size / 2}px) scale(${sx}, ${sy})`,
    content: `scale(${ix}, ${iy}) translate(${-shift}px, ${size / 2}px) rotate(${(-angle).toFixed(5)}deg) translate(${px(-fold.mx)}, ${px(-fold.my)})`,
  };
}

function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

function setTransform(el: HTMLElement, value: string): void {
  if (el.style.transform !== value) el.style.transform = value;
}

function hideParts(layers: CurlLayers): void {
  setHidden(layers.back, true);
  setHidden(layers.cast, true);
  setHidden(layers.fold, true);
}

function setClip(el: HTMLElement, value: string): void {
  if (el.style.clipPath !== value) el.style.clipPath = value;
}

function polygon(points: Pt[]): string {
  if (points.length < 3) return 'inset(100%)';
  return `polygon(${points.map((p) => `${px(p.x)} ${px(p.y)}`).join(', ')})`;
}

/** Put a sheet's fold wrappers back to identity (the whole page showing). */
export function resetHalfPlane(front: HalfPlane): void {
  setTransform(front.box, '');
  setTransform(front.content, '');
  setClip(front.box, '');
}

/** Clear whatever the other rendering mode left on the curl parts. */
export function resetCurlLayers(layers: CurlLayers): void {
  for (const el of [layers.back, layers.backPage]) {
    setTransform(el, '');
    setClip(el, '');
  }
}

/**
 * 'gpu': cut along the fold with rotated clip boxes, so a frame is transforms
 * only and the GPU compositor does the work. 'flat': for software compositing
 * (no usable GPU), where every rotated clip box costs a full-page software
 * blend per frame: clip-path polygons instead, re-rastered by the raster threads.
 */
export type CurlMode = 'gpu' | 'flat';

/* How far the shadow band reaches past the fold, as a share of its thickness: its gradient is under 4% black beyond this. */
const SHADOW_REACH = 0.4;

/* Widest the highlight band on the back of the page gets (CSS px). */
const SHADE_MAX = 440;

/** 'none': no fold yet; 'curl': page partly turned; 'cleared': the page and everything it casts have left the slot. */
export type CurlState = 'none' | 'curl' | 'cleared';

export function paintCurl(
  layers: CurlLayers,
  front: HalfPlane,
  width: number,
  height: number,
  pose: CurlPose,
  mode: CurlMode = 'gpu',
): CurlState {
  const fold = makeFold(pose.origin, pose.point);
  if (!fold) {
    resetHalfPlane(front);
    hideParts(layers);
    return 'none';
  }
  const gpu = mode === 'gpu';
  const rect = pageRect(width, height);
  const size = Math.ceil(Math.hypot(width, height) * 6);
  const plus = gpu ? halfPlane(fold, width, height, size, true) : null;
  const frontPoly = gpu ? [] : clipHalfPlane(rect, fold, true);
  // The turning page keeps only the side of the fold away from the lifted corner.
  if (plus) {
    setTransform(front.box, plus.box);
    setTransform(front.content, plus.content);
  } else {
    setClip(front.box, polygon(frontPoly));
  }

  const distance = Math.hypot(pose.point.x - pose.origin.x, pose.point.y - pose.origin.y);
  const depth = distance / 2;
  const shadowThickness = Math.min(240, Math.max(110, depth * 0.72));
  // How far the nearest page corner is past the fold, on the lifted side (negative).
  let nearest = -Infinity;
  for (const corner of rect) nearest = Math.max(nearest, sideOf(corner, fold));
  // Cleared only once the page, its flap and the visible part of the shadow it
  // casts are off the slot, so the last curl frame already looks like the next page.
  if (nearest <= -shadowThickness * SHADOW_REACH) {
    hideParts(layers);
    return 'cleared';
  }

  setHidden(layers.root, false);
  setHidden(layers.cast, false);
  setHidden(layers.back, false);
  setHidden(layers.fold, false);

  if (plus) {
    setTransform(layers.back, plus.box);
    // The back of the page: the page reflected across the fold, kept on the far side of it.
    setTransform(layers.backPage, `${plus.content} ${reflectionCSS(fold)}`);
  } else {
    const peeled = clipHalfPlane(rect, fold, false);
    setClip(layers.back, polygon(peeled.map((p) => reflectPoint(p, fold))));
    setTransform(layers.backPage, reflectionCSS(fold));
  }

  const angle = foldCssAngle(fold);
  const centre = bandCentre(fold, width, height);
  // The cast band's gradient puts the shading on the turning page at 0.8x the shadow's reach (see .curl-cast).
  placeBand(layers.cast, centre, angle, shadowThickness);
  // Narrow on purpose: a band as wide as the flap was one more flap-sized blend per frame.
  placeBand(layers.shadeBand, centre, angle, Math.min(SHADE_MAX, Math.max(120, depth * 2.3)));
  placeBand(layers.fold, centre, angle, 16);
  return 'curl';
}

/** Whether a pose has carried the page and everything it casts off the slot. */
export function poseCleared(width: number, height: number, pose: CurlPose): boolean {
  const fold = makeFold(pose.origin, pose.point);
  if (!fold) return false;
  const depth = Math.hypot(pose.point.x - pose.origin.x, pose.point.y - pose.origin.y) / 2;
  const shadowThickness = Math.min(240, Math.max(110, depth * 0.72));
  return pageRect(width, height).every((corner) => sideOf(corner, fold) <= -shadowThickness * SHADOW_REACH);
}

/* Easing on elapsed time (0..1 of the duration), never on frame counts, so 60 and 120 Hz screens show the same motion. */
export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

function sweep(t: number, origin: Pt, mid: Pt, end: Pt): Pt {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped <= 0.62) {
    const k = clamped / 0.62;
    return { x: origin.x + (mid.x - origin.x) * k, y: origin.y + (mid.y - origin.y) * k };
  }
  const k = (clamped - 0.62) / 0.38;
  return { x: mid.x + (end.x - mid.x) * k, y: mid.y + (end.y - mid.y) * k };
}

/**
 * Where an automatic turn's corner ends up: the classic end point, pushed
 * further out along the same line when needed so the page and its shadow have
 * left the slot before t = 1 at any page shape (squarer pages need more room).
 */
function clearedEnd(origin: Pt, mid: Pt, end: Pt, width: number, height: number): Pt {
  const key = `${origin.x},${origin.y},${mid.x},${end.x},${end.y},${width},${height}`;
  const cached = endCache.get(key);
  if (cached) return cached;
  const along = (k: number): Pt => ({ x: mid.x + (end.x - mid.x) * k, y: mid.y + (end.y - mid.y) * k });
  let k = 1;
  // Clear by 94% of the last leg, so it happens while the page is still moving.
  for (let step = 0; step < 16 && !poseCleared(width, height, { origin, point: along(k * 0.94) }); step += 1) k *= 1.12;
  const point = along(k);
  endCache.set(key, point);
  return point;
}

const endCache = new Map<string, Pt>();

export function forwardPath(t: number, width: number, height: number): CurlPose {
  const origin = { x: width, y: height };
  const mid = { x: 0, y: 0 };
  const end = clearedEnd(origin, mid, { x: -width * 1.4, y: -height * 0.22 }, width, height);
  return { origin, point: sweep(t, origin, mid, end) };
}

export function backwardPath(t: number, width: number, height: number): CurlPose {
  const origin = { x: 0, y: height };
  const mid = { x: width, y: 0 };
  const end = clearedEnd(origin, mid, { x: width * 2.4, y: -height * 0.22 }, width, height);
  return { origin, point: sweep(t, origin, mid, end) };
}
