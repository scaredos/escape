// Runtime world queries (spec 01 §26) built from GenOutput on the main thread.
import { Land } from './land';
import { Grid, obb, obbDist, obbInside, segDist, type OBB, DEG } from './geom';
import type { GenOutput, Pack, SpotOut } from './types';

export class WorldQ {
  land: Land;
  spots: SpotOut[];
  walk: Float32Array; walkGrid = new Grid(50);
  fps: OBB[] = []; fpH: number[] = []; fpGrid = new Grid(50);
  highways: { name: string; pts: [number, number][] }[];
  constructor(public pack: Pack, public gen: GenOutput) {
    this.land = new Land(pack);
    this.spots = gen.spots;
    this.walk = gen.walkPoints;
    for (let i = 0; i < this.walk.length / 2; i++) this.walkGrid.insert(i, this.walk[i * 2], this.walk[i * 2 + 1], this.walk[i * 2], this.walk[i * 2 + 1]);
    const f = gen.footprints;
    for (let o = 0; o < f.length; o += 8) {
      const b = obb(f[o], f[o + 1], f[o + 2], f[o + 3], f[o + 4] * DEG), id = this.fps.length;
      this.fps.push(b); this.fpH.push(f[o + 5]);
      const e = Math.max(b.hl, b.hw); this.fpGrid.insert(id, b.cx - e, b.cy - e, b.cx + e, b.cy + e);
    }
    this.highways = pack.world.highways;
  }
  insetAt(x: number, y: number) { return this.land.insetAt(x, y); }
  onLand(x: number, y: number) { return this.land.onLand(x, y); }
  findSpot(mode: string) { return this.spots.find((s) => s.mode === mode); }
  nearestSpot(mode: string, x: number, y: number): SpotOut | undefined {
    let best: SpotOut | undefined, bd = Infinity;
    for (const s of this.spots) if (s.mode === mode) { const d = Math.hypot(s.rx - x, s.ry - y); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  /** Walk points within [r0, r1] of (x,y). */
  walkRing(x: number, y: number, r0: number, r1: number): number[] {
    const out: number[] = [];
    this.walkGrid.query(x - r1, y - r1, x + r1, y + r1, (i) => { const d = Math.hypot(this.walk[i * 2] - x, this.walk[i * 2 + 1] - y); if (d >= r0 && d <= r1) out.push(i); });
    return out;
  }
  nearestWalkBeyond(x: number, y: number, r0: number): number {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.walk.length / 2; i++) { const d = Math.hypot(this.walk[i * 2] - x, this.walk[i * 2 + 1] - y); if (d > r0 && d < bd) { bd = d; best = i; } }
    return best;
  }
  /** Is the point inside a building footprint (grown by m)? */
  inBuilding(x: number, y: number, m = 0): boolean {
    return this.fpGrid.query(x - m - 1, y - m - 1, x + m + 1, y + m + 1, (id) => obbInside(this.fps[id], x, y, m));
  }
  buildingDist(x: number, y: number, r: number): number {
    let best = Infinity;
    this.fpGrid.query(x - r, y - r, x + r, y + r, (id) => { best = Math.min(best, obbDist(this.fps[id], x, y)); });
    return best;
  }
  /** Closest point on any highway polyline. */
  closestHighway(x: number, y: number) {
    let best = { d: Infinity, h: 0, k: 0, t: 0, px: 0, py: 0 };
    this.highways.forEach((h, hi) => {
      for (let k = 1; k < h.pts.length; k++) {
        const [ax, ay] = h.pts[k - 1], [bx, by] = h.pts[k];
        const d = segDist(x, y, ax, ay, bx, by);
        if (d < best.d) {
          const L2 = (bx - ax) ** 2 + (by - ay) ** 2, t = L2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2)) : 0;
          best = { d, h: hi, k, t, px: ax + (bx - ax) * t, py: ay + (by - ay) * t };
        }
      }
    });
    return best;
  }
}
