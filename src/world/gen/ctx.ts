// Generation context: output buffers, layer table, spatial grids and the shared placement tests (spec 01 §16, §26).
import { Rng } from '../../core/rng';
import { Land } from '../land';
import { BOX, COL, PROP, type GenOutput, type LayerDef, type Pack, type ShellInfo, type SignInfo, type LightInfo, type DriveRoad, type SpotOut } from '../types';
import { DEG, Grid, hexLin, obb, obbAabb, obbDist, obbInside, segDist, type OBB } from '../geom';

export const STYLE: Record<string, { w: number; paved: boolean; side: boolean; rank: number }> = {
  motorway: { w: 16, paved: false, side: false, rank: 0 }, motorway_link: { w: 8, paved: false, side: false, rank: 0 },
  trunk: { w: 14, paved: false, side: true, rank: 4 }, trunk_link: { w: 8, paved: false, side: true, rank: 0 },
  primary: { w: 13, paved: false, side: true, rank: 4 }, primary_link: { w: 8, paved: false, side: true, rank: 0 },
  secondary: { w: 13, paved: false, side: true, rank: 3 }, secondary_link: { w: 8, paved: false, side: true, rank: 0 },
  tertiary: { w: 10, paved: false, side: true, rank: 2 }, tertiary_link: { w: 7, paved: false, side: true, rank: 0 },
  residential: { w: 7.5, paved: false, side: true, rank: 1 }, unclassified: { w: 7, paved: false, side: true, rank: 0 },
  living_street: { w: 5.5, paved: false, side: true, rank: 0 }, service: { w: 4.5, paved: false, side: false, rank: 0 },
  track: { w: 3.5, paved: false, side: false, rank: 0 }, pedestrian: { w: 6, paved: true, side: false, rank: 0 },
  footway: { w: 2.5, paved: true, side: false, rank: 0 }, path: { w: 2, paved: true, side: false, rank: 0 },
  cycleway: { w: 2, paved: true, side: false, rank: 0 }, steps: { w: 2.5, paved: true, side: false, rank: 0 },
};

const L = (key: string, kind: LayerDef['kind'], collide: boolean, shadow: boolean, set?: string, tile?: number, tint?: [number, number, number], rough?: number): LayerDef =>
  ({ key, kind, collide, shadow, set, tile, tint, rough });
export const LAYERS: LayerDef[] = [
  L('facade', 'facade', true, true),
  L('facade_nc', 'facade', false, true),          // parapets, shell skins (colliders are separate hidden boxes)
  L('lot', 'textured', true, false, 'lot', 6), L('jstone', 'textured', true, false, 'stone', 3, [0.85, 0.83, 0.8]),
  L('sand', 'textured', true, false, 'sand', 4), L('seabed', 'textured', true, false, 'sand', 4, [0.7, 0.66, 0.58]),
  L('fields', 'textured', true, false, 'grass', 6), L('beige', 'textured', true, false, 'grass', 6, [1, 0.88, 0.68]),
  L('desert', 'textured', true, false, 'desert', 8), L('village', 'textured', true, false, 'desert', 5, [0.9, 0.8, 0.68]),
  L('mesa', 'textured', true, true, 'desert', 10, [0.62, 0.5, 0.42]),
  L('pier', 'textured', true, true, 'roof', 3),
  L('asphalt', 'textured', false, false, 'asphalt', 6), L('paving', 'textured', false, false, 'paving', 2),
  L('apron', 'textured', false, false, 'paving', 3),
  L('lawn', 'textured', false, false, 'grass', 4, [0.72, 1, 0.66]),
  L('in_plaster', 'textured', false, false, 'plaster', 3, [1, 0.9, 0.76]),
  L('fl_garage', 'textured', false, false, 'tiles', 3.6, [0.7, 0.62, 0.53]), L('fl_warm', 'textured', false, false, 'tiles', 2.4, [1, 0.86, 0.7]),
  L('fl_marble', 'textured', false, false, 'tiles', 2.4, [1, 1, 1], 0.12), L('fl_job', 'textured', false, false, 'tiles', 2.4, [1, 1, 1], 0.35),
  L('flat', 'flat', false, true), L('flat_c', 'flat', true, true), L('flat_ns', 'flat', false, false),
  L('cyl', 'flatcyl', false, true), L('cyl_c', 'flatcyl', true, true),
];
const LAYER_BY_KEY = new Map(LAYERS.map((l) => [l.key, l]));

export interface Fp {
  id: string; base: string; inset: number; cx: number; cy: number; L: number; W: number; yaw: number; lv: number; H: number;
  stone: boolean; tint: [number, number, number]; overhang: number; b: OBB; alive: boolean; shell: boolean; village?: boolean;
}
export interface Seg { ax: number; ay: number; bx: number; by: number; hw: number; style: string; rank: number; asphalt: boolean; paved: boolean; way: number; highway: boolean }
export interface Way { id: string; style: string; pts: number[]; inset: number }

export class Gen {
  land: Land;
  boxes = new Map<string, number[]>();
  props = new Map<string, number[]>();
  colliders: number[] = [];
  signs: SignInfo[] = []; lights: LightInfo[] = []; shells: ShellInfo[] = []; spots: SpotOut[] = [];
  fps: Fp[] = []; fpGrid = new Grid(50);
  segs: Seg[] = []; segGrid = new Grid(20);
  ways: Way[] = [];
  keepClear: OBB[] = []; keepGrid = new Grid(50);   // shells + aprons
  yards: OBB[] = []; yardGrid = new Grid(50);
  landforms: { b: OBB; ellipse: boolean }[] = []; lfGrid = new Grid(100);
  roadVerts: number[] = []; laneVerts: number[] = [];
  driveRoads: DriveRoad[] = [];
  walk: number[] = [];
  highwayEnds: number[] = [];
  mapRoads: number[] = [];
  parks: { id: string; x: number; y: number; area: number; side: number }[] = [];
  kiosks: [number, number][] = [];
  spotGrid = new Grid(50);
  claims = new Set<number>();
  stats: Record<string, any> = { insets: {} };
  escapePierSegs: number[] = [];
  piers: { inset: number; pts: number[] }[] = [];
  constructor(public pack: Pack) { this.land = new Land(pack); }

  layer(key: string) { const l = LAYER_BY_KEY.get(key); if (!l) throw new Error('layer ' + key); return l; }
  /** Push a box instance. color: hex string or linear rgb; extra = roughness (flat) or stone flag (facade). */
  box(key: string, cx: number, cy: number, cz: number, Lx: number, W: number, H: number, yawDeg = 0,
    o: { pitch?: number; roll?: number; color?: string | [number, number, number]; extra?: number; collide?: boolean } = {}) {
    if (Lx <= 0 || W <= 0 || H <= 0) return;
    const l = this.layer(key);
    let a = this.boxes.get(key); if (!a) this.boxes.set(key, (a = []));
    const c = typeof o.color === 'string' ? hexLin(o.color) : (o.color ?? [1, 1, 1]);
    a.push(cx, cy, cz, Lx, W, H, yawDeg, o.pitch ?? 0, o.roll ?? 0, c[0], c[1], c[2], o.extra ?? 0.75);
    if (o.collide ?? l.collide) this.collider(cx, cy, cz, Lx, W, H, yawDeg);
  }
  collider(cx: number, cy: number, cz: number, Lx: number, W: number, H: number, yawDeg: number) { this.colliders.push(cx, cy, cz, Lx, W, H, yawDeg); }
  prop(name: string, x: number, y: number, z: number, yawDeg: number, scale: number | [number, number, number] = 1, collide = true, pitch = 0, roll = 0) {
    let a = this.props.get(name); if (!a) this.props.set(name, (a = []));
    const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
    a.push(x, y, z, yawDeg, pitch, roll, s[0], s[1], s[2], collide ? 1 : 0);
  }

  addFootprint(f: Omit<Fp, 'b' | 'alive' | 'overhang' | 'shell'> & { shell?: boolean }): Fp {
    const fp: Fp = { ...f, b: obb(f.cx, f.cy, f.L, f.W, f.yaw * DEG), alive: true, overhang: 0, shell: !!f.shell };
    const id = this.fps.length; this.fps.push(fp);
    const [x0, y0, x1, y1] = obbAabb(fp.b); this.fpGrid.insert(id, x0 - 8, y0 - 8, x1 + 8, y1 + 8);
    return fp;
  }
  addSeg(s: Seg) {
    const id = this.segs.length; this.segs.push(s);
    const p = s.hw + 9;
    this.segGrid.insert(id, Math.min(s.ax, s.bx) - p, Math.min(s.ay, s.by) - p, Math.max(s.ax, s.bx) + p, Math.max(s.ay, s.by) + p);
  }
  addKeepClear(b: OBB) { const id = this.keepClear.length; this.keepClear.push(b); const a = obbAabb(b); this.keepGrid.insert(id, a[0], a[1], a[2], a[3]); }
  addYard(b: OBB) { const id = this.yards.length; this.yards.push(b); const a = obbAabb(b); this.yardGrid.insert(id, a[0], a[1], a[2], a[3]); }
  addLandform(b: OBB, ellipse: boolean) { const id = this.landforms.length; this.landforms.push({ b, ellipse }); const a = obbAabb(b); this.lfGrid.insert(id, a[0], a[1], a[2], a[3]); }

  /** Any live building box within m (+ its overhang if withOverhang) of the point? */
  nearBuilding(x: number, y: number, m: number, withOverhang = false, minLevels = 0): boolean {
    return this.fpGrid.query(x - m - 2, y - m - 2, x + m + 2, y + m + 2, (id) => {
      const f = this.fps[id]; if (!f.alive || f.lv < minLevels) return false;
      return obbDist(f.b, x, y) <= m + (withOverhang ? f.overhang : 0);
    });
  }
  inShell(x: number, y: number, m: number): boolean {
    return this.keepGrid.query(x - m, y - m, x + m, y + m, (id) => obbInside(this.keepClear[id], x, y, m));
  }
  inYard(x: number, y: number, m: number): boolean {
    return this.yardGrid.query(x - m, y - m, x + m, y + m, (id) => obbInside(this.yards[id], x, y, m));
  }
  /** Distance from the point to the nearest carriageway edge (asphalt) of a road (Infinity if none within r). */
  carriageEdgeDist(x: number, y: number, r = 12, filter?: (s: Seg) => boolean): number {
    let best = Infinity;
    this.segGrid.query(x - r, y - r, x + r, y + r, (id) => {
      const s = this.segs[id]; if (!s.asphalt || (filter && !filter(s))) return;
      best = Math.min(best, segDist(x, y, s.ax, s.ay, s.bx, s.by) - s.hw);
    });
    return best;
  }
  nearPathCentre(x: number, y: number, m: number): boolean {
    return this.segGrid.query(x - m - 4, y - m - 4, x + m + 4, y + m + 4, (id) => {
      const s = this.segs[id]; return s.paved && segDist(x, y, s.ax, s.ay, s.bx, s.by) < m;
    });
  }
  nearSpot(x: number, y: number, m: number): boolean {
    return this.spotGrid.query(x - m, y - m, x + m, y + m, (id) => Math.hypot(this.spots[id].rx - x, this.spots[id].ry - y) < m);
  }
  /** Clear-spot test (spec 01 §16). */
  clearSpot(x: number, y: number, m: number): boolean {
    if (!this.land.onLand(x, y)) return false;
    if (this.nearBuilding(x, y, m, true)) return false;
    if (this.carriageEdgeDist(x, y, m + 20) <= m) return false;
    if (this.nearPathCentre(x, y, 0.6)) return false;
    if (this.inShell(x, y, m) || this.inYard(x, y, m)) return false;
    if (this.nearSpot(x, y, 6)) return false;
    return true;
  }
  /** 1.5 m spacing claim: the cell and its 8 neighbours must be empty. */
  claim(x: number, y: number, test = false): boolean {
    const i = Math.floor(x / 1.5), j = Math.floor(y / 1.5);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (this.claims.has((i + a + 40000) * 100000 + (j + b + 40000))) return false;
    if (!test) this.claims.add((i + 40000) * 100000 + (j + 40000));
    return true;
  }
  /** Prop footprint (radius r around x,y) overlaps a building or shell? */
  boxHitsBuilding(b: OBB): boolean {
    const a = obbAabb(b);
    if (this.fpGrid.query(a[0] - 1, a[1] - 1, a[2] + 1, a[3] + 1, (id) => this.fps[id].alive && obbOverlap(this.fps[id].b, b))) return true;
    return this.keepGrid.query(a[0], a[1], a[2], a[3], (id) => obbOverlap(this.keepClear[id], b));
  }
  /** Is (x,y) on a landform (mesa box or hill ellipse)? */
  onLandform(x: number, y: number): boolean {
    return this.lfGrid.query(x, y, x, y, (id) => {
      const { b, ellipse } = this.landforms[id];
      if (!ellipse) return obbInside(b, x, y);
      const dx = x - b.cx, dy = y - b.cy, u = (dx * b.ux + dy * b.uy) / b.hl, v = (-dx * b.uy + dy * b.ux) / b.hw;
      return u * u + v * v <= 1;
    });
  }
  harbourCount(x: number, y: number, r: number): number {
    let n = 0;
    for (const p of this.piers) for (let k = 0; k + 3 < p.pts.length; k += 2) if (segDist(x, y, p.pts[k], p.pts[k + 1], p.pts[k + 2], p.pts[k + 3]) < r) n++;
    return n;
  }
  nearPier(x: number, y: number, r: number): boolean {
    for (const p of this.piers) for (let k = 0; k + 3 < p.pts.length; k += 2) if (segDist(x, y, p.pts[k], p.pts[k + 1], p.pts[k + 2], p.pts[k + 3]) < r) return true;
    return false;
  }
  highwayDist(x: number, y: number): number {
    let best = Infinity;
    for (const h of this.pack.world.highways) for (let k = 1; k < h.pts.length; k++)
      best = Math.min(best, segDist(x, y, h.pts[k - 1][0], h.pts[k - 1][1], h.pts[k][0], h.pts[k][1]));
    return best;
  }
  rng(seed: number) { return new Rng(seed); }

  output(): GenOutput {
    const f32 = (a: number[]) => Float32Array.from(a);
    const boxes: Record<string, Float32Array> = {}, props: Record<string, Float32Array> = {};
    for (const [k, v] of this.boxes) boxes[k] = f32(v);
    for (const [k, v] of this.props) props[k] = f32(v);
    const fpOut: number[] = [], mapB: number[] = [];
    for (const f of this.fps) if (f.alive) {
      fpOut.push(f.cx, f.cy, f.L, f.W, f.yaw, f.H, f.overhang, f.inset);
      const ax = f.b.ux * f.b.hl, ay = f.b.uy * f.b.hl, vx = -f.b.uy * f.b.hw, vy = f.b.ux * f.b.hw;
      mapB.push(f.cx - ax - vx, f.cy - ay - vy, f.cx + ax - vx, f.cy + ay - vy, f.cx + ax + vx, f.cy + ay + vy, f.cx - ax + vx, f.cy - ay + vy);
    }
    const segOut: number[] = [];
    for (const s of this.segs) segOut.push(s.ax, s.ay, s.bx, s.by, s.hw, STYLE_IDX[s.style] ?? -1, s.rank, s.asphalt ? 1 : 0);
    const yards: number[] = []; for (const y of this.yards) yards.push(y.cx, y.cy, y.hl * 2, y.hw * 2, Math.atan2(y.uy, y.ux) / DEG);
    const lfs: number[] = []; for (const l of this.landforms) lfs.push(l.b.cx, l.b.cy, l.b.hl * 2, l.b.hw * 2, Math.atan2(l.b.uy, l.b.ux) / DEG, l.ellipse ? 1 : 0);
    return {
      layers: LAYERS, boxes, props, colliders: f32(this.colliders), signs: this.signs, lights: this.lights, shells: this.shells,
      spots: this.spots, footprints: f32(fpOut), roadSegs: f32(segOut), driveRoads: this.driveRoads, walkPoints: f32(this.walk),
      highwayEnds: this.highwayEnds, mapRoads: f32(this.mapRoads), mapBuildings: f32(mapB), yards: f32(yards), landforms: f32(lfs),
      stats: this.stats,
    };
  }
}
export const STYLE_IDX: Record<string, number> = Object.fromEntries(Object.keys(STYLE).map((k, i) => [k, i]));

export function obbOverlap(a: OBB, b: OBB): boolean {
  const axes = [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]];
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  for (const [x, y] of axes) {
    const ra = a.hl * Math.abs(a.ux * x + a.uy * y) + a.hw * Math.abs(-a.uy * x + a.ux * y);
    const rb = b.hl * Math.abs(b.ux * x + b.uy * y) + b.hw * Math.abs(-b.uy * x + b.ux * y);
    if (Math.abs(dx * x + dy * y) >= ra + rb) return false;
  }
  return true;
}
export { BOX, COL, PROP };
