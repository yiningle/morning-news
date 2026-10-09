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

function onFoldEdge(a: Pt, b: Pt, fold: Fold): boolean {
  return Math.abs(sideOf(a, fold)) < 1.5 && Math.abs(sideOf(b, fold)) < 1.5;
}

/** Clip path for a polygon. The fold edge is bowed so the sheet reads as a bend, not a crease. */
export function toClipPath(points: Pt[], fold: Fold | null, bow = 0): string {
  if (points.length < 3) return 'polygon(0px 0px, 0px 0px, 0px 0px)';
  if (!fold || bow === 0) {
    return `polygon(${points.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(', ')})`;
  }
  const cmds: string[] = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (onFoldEdge(a, b, fold) && Math.hypot(b.x - a.x, b.y - a.y) > 12) {
      const cx = (a.x + b.x) / 2 - fold.nx * bow;
      const cy = (a.y + b.y) / 2 - fold.ny * bow;
      cmds.push(`Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
    } else {
      cmds.push(`L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
    }
  }
  cmds.push('Z');
  return `path('${cmds.join(' ')}')`;
}

/** CSS rotation / gradient angle whose axis follows the fold (y-down screen space). */
export function foldCssAngle(fold: Fold): number {
  return (Math.atan2(fold.nx, -fold.ny) * 180) / Math.PI;
}

export type CurlPose = {
  origin: Pt;
  point: Pt;
};

export type CurlLayers = {
  root: HTMLElement;
  shadow: HTMLElement;
  shadowBand: HTMLElement;
  face: HTMLElement;
  faceBand: HTMLElement;
  back: HTMLElement;
  print: HTMLElement;
  shadeBand: HTMLElement;
  fold: HTMLElement;
};

export function createCurlLayers(slot: HTMLElement): CurlLayers {
  const root = document.createElement('div');
  root.className = 'curl-layer';
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="curl-shadow"><div class="curl-shadow-band"></div></div>
    <div class="curl-face"><div class="curl-face-band"></div></div>
    <div class="curl-back">
      <div class="curl-print"></div>
      <div class="curl-tint"></div>
      <div class="curl-shade-band"></div>
    </div>
    <div class="curl-fold"></div>
  `;
  slot.appendChild(root);
  return {
    root,
    shadow: root.querySelector('.curl-shadow') as HTMLElement,
    shadowBand: root.querySelector('.curl-shadow-band') as HTMLElement,
    face: root.querySelector('.curl-face') as HTMLElement,
    faceBand: root.querySelector('.curl-face-band') as HTMLElement,
    back: root.querySelector('.curl-back') as HTMLElement,
    print: root.querySelector('.curl-print') as HTMLElement,
    shadeBand: root.querySelector('.curl-shade-band') as HTMLElement,
    fold: root.querySelector('.curl-fold') as HTMLElement,
  };
}

function placeBand(el: HTMLElement, x: number, y: number, angleDeg: number, length: number, thickness: number): void {
  el.style.width = `${length}px`;
  el.style.height = `${thickness}px`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.transformOrigin = 'center center';
  el.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
}

let pathClipOk: boolean | null = null;

function canUsePathClip(): boolean {
  if (pathClipOk !== null) return pathClipOk;
  const probe = document.createElement('div');
  probe.style.clipPath = "path('M 0 0 L 1 0 L 1 1 Z')";
  pathClipOk = probe.style.clipPath.includes('path');
  return pathClipOk;
}

function hideCurl(layers: CurlLayers, front: HTMLElement, fullyPeeled: boolean): void {
  front.style.clipPath = fullyPeeled ? 'inset(100%)' : '';
  layers.back.hidden = true;
  layers.shadow.hidden = true;
  layers.face.hidden = true;
  layers.fold.hidden = true;
  layers.back.style.filter = '';
}

export function paintCurl(
  layers: CurlLayers,
  front: HTMLElement,
  width: number,
  height: number,
  pose: CurlPose,
): boolean {
  const fold = makeFold(pose.origin, pose.point);
  if (!fold) {
    hideCurl(layers, front, false);
    return false;
  }
  const rect = pageRect(width, height);
  const frontPoly = clipHalfPlane(rect, fold, true);
  const peeled = clipHalfPlane(rect, fold, false);
  const flap = peeled.map((p) => reflectPoint(p, fold));
  const frontGone = frontPoly.length < 3;
  const flapOnPage = flap.some((p) => p.x > -48 && p.x < width + 48 && p.y > -48 && p.y < height + 48);
  if (peeled.length < 3 || flap.length < 3 || (frontGone && !flapOnPage)) {
    hideCurl(layers, front, frontGone);
    return true;
  }

  const distance = Math.hypot(pose.point.x - pose.origin.x, pose.point.y - pose.origin.y);
  const bow = canUsePathClip() ? Math.min(64, distance * 0.05) : 0;
  const clip = (points: Pt[], curved: boolean) => toClipPath(points, curved ? fold : null, curved ? bow : 0);

  front.style.clipPath = frontGone ? 'inset(100%)' : clip(frontPoly, true);
  layers.root.hidden = false;
  layers.shadow.hidden = false;
  layers.face.hidden = frontGone;
  layers.back.hidden = false;
  layers.fold.hidden = false;
  layers.shadow.style.clipPath = clip(peeled, false);
  if (!frontGone) layers.face.style.clipPath = clip(frontPoly, true);
  layers.back.style.clipPath = clip(flap, true);

  const printInner = layers.print.firstElementChild as HTMLElement | null;
  if (printInner) {
    printInner.style.transformOrigin = '0 0';
    printInner.style.transform = reflectionCSS(fold);
  }

  const angle = foldCssAngle(fold);
  const length = Math.hypot(width, height) * 2;
  const depth = distance / 2;
  placeBand(layers.shadowBand, fold.mx, fold.my, angle, length, Math.min(240, Math.max(110, depth * 0.72)));
  placeBand(layers.faceBand, fold.mx, fold.my, angle, length, Math.min(200, Math.max(90, depth * 0.55)));
  placeBand(layers.shadeBand, fold.mx, fold.my, angle, length, Math.max(120, depth * 2.3));
  placeBand(layers.fold, fold.mx, fold.my, angle, length, 16);
  layers.back.style.filter = `drop-shadow(${(-fold.nx * 14).toFixed(1)}px ${(-fold.ny * 8).toFixed(1)}px 16px rgba(17,17,17,0.38))`;
  return true;
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

export function forwardPath(t: number, width: number, height: number): CurlPose {
  const origin = { x: width, y: height };
  return {
    origin,
    point: sweep(t, origin, { x: 0, y: 0 }, { x: -width * 1.4, y: -height * 0.22 }),
  };
}

export function backwardPath(t: number, width: number, height: number): CurlPose {
  const origin = { x: 0, y: height };
  return {
    origin,
    point: sweep(t, origin, { x: width, y: 0 }, { x: width * 2.4, y: -height * 0.22 }),
  };
}
