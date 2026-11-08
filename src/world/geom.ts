// 2D geometry helpers + uniform spatial hash grid (used by the generator and the runtime queries).

export const DEG = Math.PI / 180;

/** Oriented box in the map plane. yaw = radians CCW from east, L along the yaw axis. */
export interface OBB { cx: number; cy: number; hl: number; hw: number; ux: number; uy: number }
export function obb(cx: number, cy: number, L: number, W: number, yawRad: number): OBB {
  return { cx, cy, hl: L / 2, hw: W / 2, ux: Math.cos(yawRad), uy: Math.sin(yawRad) };
}
export function obbGrow(b: OBB, m: number): OBB { return { ...b, hl: b.hl + m, hw: b.hw + m }; }
/** Distance from a point to the box (0 inside). */
export function obbDist(b: OBB, x: number, y: number): number {
  const dx = x - b.cx, dy = y - b.cy;
  const u = Math.abs(dx * b.ux + dy * b.uy) - b.hl, v = Math.abs(-dx * b.uy + dy * b.ux) - b.hw;
  return Math.hypot(Math.max(u, 0), Math.max(v, 0));
}
export function obbInside(b: OBB, x: number, y: number, m = 0): boolean {
  const dx = x - b.cx, dy = y - b.cy;
  return Math.abs(dx * b.ux + dy * b.uy) <= b.hl + m && Math.abs(-dx * b.uy + dy * b.ux) <= b.hw + m;
}
export function obbCorners(b: OBB): number[] {
  const ax = b.ux * b.hl, ay = b.uy * b.hl, vx = -b.uy * b.hw, vy = b.ux * b.hw;
  return [b.cx - ax - vx, b.cy - ay - vy, b.cx + ax - vx, b.cy + ay - vy, b.cx + ax + vx, b.cy + ay + vy, b.cx - ax + vx, b.cy - ay + vy];
}
export function obbAabb(b: OBB): [number, number, number, number] {
  const ex = Math.abs(b.ux) * b.hl + Math.abs(b.uy) * b.hw, ey = Math.abs(b.uy) * b.hl + Math.abs(b.ux) * b.hw;
  return [b.cx - ex, b.cy - ey, b.cx + ex, b.cy + ey];
}
/** Separating-axis gap between two OBBs (negative = overlap depth). */
export function obbGap(a: OBB, b: OBB): number {
  let gap = -Infinity;
  const axes = [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]];
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  for (const [x, y] of axes) {
    const ra = a.hl * Math.abs(a.ux * x + a.uy * y) + a.hw * Math.abs(-a.uy * x + a.ux * y);
    const rb = b.hl * Math.abs(b.ux * x + b.uy * y) + b.hw * Math.abs(-b.uy * x + b.ux * y);
    gap = Math.max(gap, Math.abs(dx * x + dy * y) - ra - rb);
  }
  return gap;
}
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
/** Closest point param t on segment. */
export function segT(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  return L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
}

/** Uniform grid of item indices keyed by AABB. */
export class Grid {
  private cells = new Map<number, number[]>();
  private stamp: Int32Array = new Int32Array(1024);
  private q = 1;
  constructor(public cell: number) {}
  private key(i: number, j: number) { return (i + 32768) * 65536 + (j + 32768); }
  insert(id: number, x0: number, y0: number, x1: number, y1: number) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) {
      const k = this.key(i, j); let a = this.cells.get(k); if (!a) this.cells.set(k, (a = [])); a.push(id);
    }
    if (id >= this.stamp.length) { const s = new Int32Array(Math.max(id + 1, this.stamp.length * 2)); s.set(this.stamp); this.stamp = s; }
  }
  /** Calls fn for each unique id whose cells touch the query box. Return true from fn to stop early. */
  query(x0: number, y0: number, x1: number, y1: number, fn: (id: number) => boolean | void): boolean {
    const c = this.cell, q = ++this.q;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) {
      const a = this.cells.get(this.key(i, j)); if (!a) continue;
      for (const id of a) { if (this.stamp[id] === q) continue; this.stamp[id] = q; if (fn(id)) return true; }
    }
    return false;
  }
}

export function srgbToLinear(c: number) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
export function hexLin(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}
