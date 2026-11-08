// Land / inset queries straight from the pack (spec 01 §26). Shared by the generator, the host sim and the HUD map.
import type { Pack } from './types';

export const PLACE_NAMES: Record<string, string> = { '': 'Highway', telaviv: 'Tel Aviv-Jaffa', haifa: 'Haifa', jerusalem: 'Jerusalem', eilat: 'Eilat' };
export const placeName = (inset: string) => PLACE_NAMES[inset] ?? inset;

export class Land {
  readonly names: string[];
  readonly ox: number[]; readonly oy: number[];
  /** per inset: 200 rows of [x0,x1,...] in inset metres, or null = all land */
  readonly rows: (Float32Array[] | null)[];
  readonly coast: [number, number][];
  readonly bounds: [number, number, number, number];
  constructor(pack: Pack) {
    this.names = pack.insets.map((i) => i.name);
    this.ox = pack.insets.map((i) => i.offset[0]); this.oy = pack.insets.map((i) => i.offset[1]);
    this.rows = pack.insets.map((i) => (i.land_rows.length ? i.land_rows.map((r) => Float32Array.from(r, (v) => v / 10)) : null));
    this.coast = pack.world.west_coast;
    const b = pack.world.bounds;
    this.bounds = b ?? [Math.min(...this.ox) - 500, Math.min(...this.oy) - 500, Math.max(...this.ox) + 2500, Math.max(...this.oy) + 2500];
  }
  /** inset index or -1; insets are half-open squares */
  insetIdx(x: number, y: number): number {
    for (let i = 0; i < this.ox.length; i++) {
      const ox = this.ox[i], oy = this.oy[i];
      if (x >= ox && x < ox + 2000 && y >= oy && y < oy + 2000) return i;
    }
    return -1;
  }
  insetAt(x: number, y: number): string { const i = this.insetIdx(x, y); return i < 0 ? '' : this.names[i]; }
  /** West coast x at y (sea west of it). Outside the polyline's y-range everything is land. */
  coastX(y: number): number {
    const c = this.coast;
    if (!c.length || y < c[0][1] || y > c[c.length - 1][1]) return -1e9;
    for (let i = 1; i < c.length; i++) if (y <= c[i][1]) {
      const [x0, y0] = c[i - 1], [x1, y1] = c[i];
      return y1 === y0 ? x1 : x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
    }
    return -1e9;
  }
  onLand(x: number, y: number): boolean {
    const i = this.insetIdx(x, y);
    if (i >= 0) {
      const rows = this.rows[i]; if (!rows) return true;
      const r = Math.floor((y - this.oy[i]) / 10); if (r < 0 || r >= rows.length) return false;
      const a = rows[r], lx = x - this.ox[i];
      for (let k = 0; k < a.length; k += 2) if (lx >= a[k] && lx <= a[k + 1]) return true;
      return false;
    }
    const [x0, y0, x1, y1] = this.bounds;
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    return x >= this.coastX(y);
  }
  landAt(x: number, y: number, m = 0): boolean {
    if (!this.onLand(x, y)) return false;
    if (m <= 0) return true;
    return this.onLand(x + m, y) && this.onLand(x - m, y) && this.onLand(x, y + m) && this.onLand(x, y - m);
  }
  /** Land intervals on the row through y, world x, sorted (HUD map). */
  landSpans(y: number): number[] {
    const [xmin, , xmax] = this.bounds;
    let spans: number[] = [Math.max(this.coastX(y), xmin), xmax];
    for (let i = 0; i < this.ox.length; i++) {
      const oy = this.oy[i], ox = this.ox[i];
      if (y < oy || y >= oy + 2000) continue;
      const cut: number[] = [];
      for (let k = 0; k < spans.length; k += 2) {
        const a = spans[k], b = spans[k + 1];
        if (b <= ox || a >= ox + 2000) { cut.push(a, b); continue; }
        if (a < ox) cut.push(a, ox);
        if (b > ox + 2000) cut.push(ox + 2000, b);
      }
      const rows = this.rows[i];
      if (!rows) cut.push(ox, ox + 2000);
      else { const r = Math.floor((y - oy) / 10); const a = rows[r] ?? []; for (let k = 0; k < a.length; k += 2) cut.push(ox + a[k], ox + a[k + 1]); }
      spans = cut;
    }
    const pairs: [number, number][] = [];
    for (let k = 0; k < spans.length; k += 2) if (spans[k + 1] > spans[k]) pairs.push([spans[k], spans[k + 1]]);
    pairs.sort((a, b) => a[0] - b[0]);
    return pairs.flat();
  }
}
