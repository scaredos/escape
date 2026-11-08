// On-foot AI navigation grid (spec 03, Addendum: Web navigation). 1 m cells in lazily built 64x64 tiles.
// A cell is blocked when a character-sized box at it overlaps static geometry (buildings, hall walls with their door gaps,
// props, furniture), so it matches the physics world exactly. Sea cells are walkable at 4x cost.
import { RAPIER, G_STATIC, groups, type Phys } from '../physics/phys';
import type { WorldQ } from '../world/query';

const TS = 64;
export class Nav {
  private tiles = new Map<number, Uint8Array>(); // 0 free, 1 blocked, 2 sea
  private queue: number[] = [];
  private shape = new RAPIER.Cuboid(0.4, 0.4, 0.65);
  extraBlocked = new Set<number>(); // roadblock cells (cell keys)
  constructor(private phys: Phys, private wq: WorldQ) {}
  private tkey(tx: number, ty: number) { return (tx + 2000) * 4096 + (ty + 2000); }
  ckey(x: number, y: number) { return (Math.floor(x) + 20000) * 65536 + (Math.floor(y) + 20000); }
  private buildTile(tx: number, ty: number): Uint8Array {
    const a = new Uint8Array(TS * TS), W = this.phys.world, g = groups(0xffff, G_STATIC);
    let blocked = false;
    for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) {
      const x = tx * TS + i + 0.5, y = ty * TS + j + 0.5;
      if (!this.wq.onLand(x, y)) { a[j * TS + i] = 2; continue; }
      blocked = false;
      W.intersectionsWithShape({ x, y, z: 1.05 }, { x: 0, y: 0, z: 0, w: 1 }, this.shape, () => { blocked = true; return false; }, undefined, g);
      a[j * TS + i] = blocked ? 1 : 0;
    }
    this.tiles.set(this.tkey(tx, ty), a);
    return a;
  }
  /** Request tiles around a point; built a few per frame by pump(). */
  want(x: number, y: number, r: number) {
    for (let tx = Math.floor((x - r) / TS); tx <= Math.floor((x + r) / TS); tx++) for (let ty = Math.floor((y - r) / TS); ty <= Math.floor((y + r) / TS); ty++) {
      const k = this.tkey(tx, ty); if (!this.tiles.has(k) && !this.queue.includes(k)) this.queue.push(k);
    }
  }
  pump(maxTiles = 2) {
    for (let n = 0; n < maxTiles && this.queue.length; n++) {
      const k = this.queue.shift()!; if (this.tiles.has(k)) continue;
      this.buildTile(Math.floor(k / 4096) - 2000, (k % 4096) - 2000);
    }
  }
  built(x: number, y: number) { return this.tiles.has(this.tkey(Math.floor(x / TS), Math.floor(y / TS))); }
  /** 0 free, 1 blocked, 2 sea; unbuilt tiles count as free (fallback: straight walking). */
  cell(cx: number, cy: number): number {
    const tx = Math.floor(cx / TS), ty = Math.floor(cy / TS), t = this.tiles.get(this.tkey(tx, ty));
    if (this.extraBlocked.size && this.extraBlocked.has((cx + 20000) * 65536 + (cy + 20000))) return 1;
    return t ? t[(cy - ty * TS) * TS + (cx - tx * TS)] : 0;
  }
  free(x: number, y: number) { return this.cell(Math.floor(x), Math.floor(y)) !== 1; }
  /** Grid line of sight (supercover walk). */
  lineFree(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d * 2);
    for (let i = 1; i <= n; i++) { const t = i / n; if (!this.free(ax + (bx - ax) * t, ay + (by - ay) * t)) return false; }
    return true;
  }
  /** 8-connected A*, octile heuristic, no corner cutting, cap 20k expansions, partial path to the closest node. */
  findPath(ax: number, ay: number, bx: number, by: number): number[] {
    const sx = Math.floor(ax), sy = Math.floor(ay), gx = Math.floor(bx), gy = Math.floor(by);
    if (this.lineFree(ax, ay, bx, by)) return [bx, by];
    const key = (x: number, y: number) => (x + 20000) * 65536 + (y + 20000);
    const g = new Map<number, number>(), from = new Map<number, number>(), open = new Heap();
    const h = (x: number, y: number) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    const k0 = key(sx, sy); g.set(k0, 0); open.push(k0, h(sx, sy));
    let best = k0, bestH = h(sx, sy), exp = 0;
    const closed = new Set<number>();
    while (open.size && exp < 20000) {
      const k = open.pop(); if (closed.has(k)) continue; closed.add(k); exp++;
      const x = Math.floor(k / 65536) - 20000, y = (k % 65536) - 20000;
      const hh = h(x, y); if (hh < bestH) { bestH = hh; best = k; }
      if (x === gx && y === gy) { best = k; break; }
      const gk = g.get(k)!;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy, c = this.cell(nx, ny); if (c === 1) continue;
        if (dx && dy && (this.cell(x + dx, y) === 1 || this.cell(x, y + dy) === 1)) continue;
        const nk = key(nx, ny), ng = gk + (dx && dy ? 1.414 : 1) * (c === 2 ? 4 : 1);
        if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); from.set(nk, k); open.push(nk, ng + h(nx, ny)); }
      }
    }
    const cells: number[] = [];
    for (let k: number | undefined = best; k !== undefined && k !== k0; k = from.get(k)) cells.push(k);
    cells.reverse();
    const pts: number[] = [];
    for (const k of cells) pts.push(Math.floor(k / 65536) - 20000 + 0.5, (k % 65536) - 20000 + 0.5);
    if (best === key(gx, gy) && pts.length) { pts[pts.length - 2] = bx; pts[pts.length - 1] = by; }
    // string pull
    const out: number[] = []; let cx = ax, cy = ay, i = 0;
    while (i < pts.length) {
      let j = pts.length - 2;
      while (j > i && !this.lineFree(cx, cy, pts[j], pts[j + 1])) j -= 2;
      out.push(pts[j], pts[j + 1]); cx = pts[j]; cy = pts[j + 1]; i = j + 2;
    }
    return out;
  }
  /** BFS random reachable cell within r (never sea). */
  randomReachable(x: number, y: number, r: number, rnd: () => number): [number, number] | null {
    const sx = Math.floor(x), sy = Math.floor(y), seen = new Set<number>(), q: number[] = [sx, sy], cells: number[] = [];
    const cap = (2 * r + 1) ** 2;
    seen.add((sx + 20000) * 65536 + sy + 20000);
    for (let h = 0; h < q.length && cells.length < cap; h += 2) {
      const cx = q[h], cy = q[h + 1];
      if (this.cell(cx, cy) === 0) cells.push(cx, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = (nx + 20000) * 65536 + ny + 20000;
        if (seen.has(k) || Math.hypot(nx - sx, ny - sy) > r || this.cell(nx, ny) === 1) continue;
        seen.add(k); q.push(nx, ny);
      }
    }
    if (!cells.length) return null;
    const i = Math.floor(rnd() * (cells.length / 2)) * 2;
    return [cells[i] + 0.5, cells[i + 1] + 0.5];
  }
  project(x: number, y: number, r = 15): [number, number] | null {
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let d = 0; d <= r; d++) for (let i = -d; i <= d; i++) for (const [a, b] of [[i, -d], [i, d], [-d, i], [d, i]]) if (this.cell(cx + a, cy + b) === 0) return [cx + a + 0.5, cy + b + 0.5];
    return null;
  }
}
class Heap {
  private k: number[] = []; private p: number[] = [];
  get size() { return this.k.length; }
  push(key: number, pri: number) {
    const k = this.k, p = this.p; k.push(key); p.push(pri); let i = k.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (p[j] <= p[i]) break; [k[i], k[j]] = [k[j], k[i]]; [p[i], p[j]] = [p[j], p[i]]; i = j; }
  }
  pop(): number {
    const k = this.k, p = this.p, top = k[0], lk = k.pop()!, lp = p.pop()!;
    if (k.length) {
      k[0] = lk; p[0] = lp; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < k.length && p[l] < p[m]) m = l; if (r < k.length && p[r] < p[m]) m = r; if (m === i) break; [k[i], k[m]] = [k[m], k[i]]; [p[i], p[m]] = [p[m], p[i]]; i = m; }
    }
    return top;
  }
}
