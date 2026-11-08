// NPC traffic (spec 04 §12): 14 cars around the players, lane-following on the drive-road graph. Host only.
import { probe } from '../core/probe';
import { gameRng } from '../core/rng';
import { Grid } from '../world/geom';
import { CAPSULE_HALF, EYE } from '../physics/character';
import { G_STATIC } from '../physics/phys';
import type { Sim } from './sim';
import { steerScale, type Car, type Cars } from './cars';

const WHEELBASE = 2.7, TRAFFIC_MODELS = ['sedan', 'taxi', 'van', 'pickup'] as const;
interface PathPt { x: number; y: number; road: number; v: number; dir: number }
export interface TrafficAI {
  path: PathPt[]; cityCruise: number; hwCruise: number; lastMoved: number; stucks: number; reverseUntil: number; doomed: boolean;
  blocked: boolean; wall: boolean; people: boolean; nextCtl: number; want: number;
}

export class Traffic {
  frozen = false;
  private built = false;
  // graph
  private rx: Float32Array = new Float32Array(0); private ry: Float32Array = new Float32Array(0);
  private vRoad: Int32Array = new Int32Array(0); private roadStart: number[] = []; private roadLen: number[] = []; private roadHw: number[] = []; private roadHwy: boolean[] = [];
  private links: number[][] = []; private grid = new Grid(50);
  private nextPop = 2; private lastCount = 0;
  constructor(public sim: Sim, public cars: Cars) {}
  list(): Car[] { return [...this.cars.cars.values()].filter((c) => c.ai); }
  count() { return this.list().length; }
  release(c: Car) { c.ai = null; }

  // ------------------------------------------------------------------ graph (§12.1)
  private build() {
    const t0 = performance.now(), roads = this.sim.wq.gen.driveRoads;
    const xs: number[] = [], ys: number[] = [], vr: number[] = [];
    roads.forEach((r, i) => {
      this.roadStart.push(xs.length); this.roadLen.push(r.pts.length / 2); this.roadHw.push(r.halfWidth); this.roadHwy.push(r.highway);
      for (let k = 0; k < r.pts.length; k += 2) { xs.push(r.pts[k]); ys.push(r.pts[k + 1]); vr.push(i); }
    });
    this.rx = Float32Array.from(xs); this.ry = Float32Array.from(ys); this.vRoad = Int32Array.from(vr);
    for (let v = 0; v < xs.length; v++) { this.grid.insert(v, xs[v], ys[v], xs[v], ys[v]); this.links.push([]); }
    let nLinks = 0;
    for (let v = 0; v < xs.length; v++) this.grid.query(xs[v] - 3, ys[v] - 3, xs[v] + 3, ys[v] + 3, (u) => {
      if (vr[u] !== vr[v] && Math.hypot(xs[u] - xs[v], ys[u] - ys[v]) <= 3) { this.links[v].push(u); nLinks++; }
    });
    let snapped = 0;
    for (let r = 0; r < roads.length; r++) for (const v of [this.roadStart[r], this.roadStart[r] + this.roadLen[r] - 1]) {
      if (this.links[v].length) continue;
      let best = -1, bd = 25;
      this.grid.query(xs[v] - 25, ys[v] - 25, xs[v] + 25, ys[v] + 25, (u) => {
        if (vr[u] === r || !(this.roadHwy[r] || this.roadHwy[vr[u]])) return;
        const d = Math.hypot(xs[u] - xs[v], ys[u] - ys[v]); if (d < bd) { bd = d; best = u; }
      });
      if (best >= 0) { this.links[v].push(best); this.links[best].push(v); snapped++; }
    }
    this.built = true;
    probe('traffic_graph', { roads: roads.length, verts: xs.length, links: nLinks, snapped_ends: snapped, ms: Math.round(performance.now() - t0) });
  }
  private next(v: number, dir: number): number {
    const r = this.vRoad[v], k = v - this.roadStart[r] + dir;
    return k >= 0 && k < this.roadLen[r] ? v + dir : -1;
  }
  private deadEnd(v: number, dir: number): boolean {
    const r = this.vRoad[v], end = dir > 0 ? this.roadStart[r] + this.roadLen[r] - 1 : this.roadStart[r];
    return this.links[end].length === 0;
  }
  private lane(v: number) { return Math.max(1.5, Math.min(4.5, this.roadHw[this.vRoad[v]] * 0.5)); }
  /** Lane point (A->B) = B + right(A->B) x lane(B). */
  private lanePt(a: number, b: number, laneOn = true): PathPt {
    const dx = this.rx[b] - this.rx[a], dy = this.ry[b] - this.ry[a], l = Math.hypot(dx, dy) || 1, ln = laneOn ? this.lane(b) : 0;
    return { x: this.rx[b] + (dy / l) * ln, y: this.ry[b] - (dx / l) * ln, road: this.vRoad[b], v: b, dir: 0 };
  }
  /** Leg clear: segment vs building footprints inflated 1.1 m (§12.3 web rule). */
  private legClear(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 2));
    for (let i = 0; i <= n; i++) { const t = i / n; if (this.sim.wq.inBuilding(ax + (bx - ax) * t, ay + (by - ay) * t, 1.1)) return false; }
    return true;
  }
  private planStart(v: number, dir: number): PathPt[] | null {
    let d = dir;
    const n1 = this.next(v, d), n2 = this.next(v, -d);
    if (n1 < 0 || (n2 >= 0 && this.deadEnd(v, d) && !this.deadEnd(v, -d))) d = -d;
    const n = this.next(v, d); if (n < 0) return null;
    const dx = this.rx[n] - this.rx[v], dy = this.ry[n] - this.ry[v], l = Math.hypot(dx, dy) || 1, ln = this.lane(v);
    const p0: PathPt = { x: this.rx[v] + (dy / l) * ln, y: this.ry[v] - (dx / l) * ln, road: this.vRoad[v], v, dir: d };
    const p1 = { ...this.lanePt(v, n), dir: d };
    if (!this.legClear(p0.x, p0.y, p1.x, p1.y)) return null;
    return [p0, p1];
  }
  private extend(ai: TrafficAI) {
    const P = ai.path;
    const planLen = () => { let s = 0; for (let i = 2; i < P.length; i++) s += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); return s; };
    let guard = 0;
    while (P.length < 32 && planLen() < 60 && guard++ < 40) {
      const end = P[P.length - 1], prev = P[P.length - 2];
      const ix = end.x - prev.x, iy = end.y - prev.y, il = Math.hypot(ix, iy) || 1;
      const v = end.v, opts: { from: number; dir: number; dead: boolean }[] = [];
      const add = (from: number, dir: number) => {
        const n = this.next(from, dir); if (n < 0) return;
        const fx = this.rx[n] - this.rx[from], fy = this.ry[n] - this.ry[from], fl = Math.hypot(fx, fy) || 1;
        if ((fx * ix + fy * iy) / (fl * il) < -0.5) return;
        opts.push({ from, dir, dead: this.deadEnd(from, dir) });
      };
      add(v, end.dir);
      for (const u of this.links[v]) { add(u, 1); add(u, -1); }
      for (let i = opts.length - 1; i > 0; i--) { const j = gameRng.int(0, i); [opts[i], opts[j]] = [opts[j], opts[i]]; }
      opts.sort((a, b) => Number(a.dead) - Number(b.dead));
      if (this.next(v, -end.dir) >= 0) opts.push({ from: v, dir: -end.dir, dead: false }); // U-turn last
      let ok = false;
      for (const o of opts) {
        const n = this.next(o.from, o.dir);
        for (const laneOn of [true, false]) {
          const pt = { ...this.lanePt(o.from, n, laneOn), dir: o.dir };
          if (this.legClear(end.x, end.y, pt.x, pt.y)) { P.push(pt); ok = true; break; }
        }
        if (ok) break;
      }
      if (!ok) break;
    }
  }

  // ------------------------------------------------------------------ population (§12.2)
  private seenBy(x: number, y: number, z: number): boolean {
    for (const h of this.sim.humans.values()) {
      const ez = h.z + CAPSULE_HALF + EYE;
      if (Math.hypot(h.x - x, h.y - y, ez - z) > 600) continue;
      if (this.sim.phys.los(h.x, h.y, ez, x, y, z, G_STATIC)) return true;
    }
    return false;
  }
  private populate() {
    const sim = this.sim, humans = [...sim.humans.values()], living = humans.filter((h) => !h.dead);
    for (const c of this.list()) {
      let nd = Infinity; for (const h of humans) nd = Math.min(nd, Math.hypot(h.x - c.x, h.y - c.y));
      const far = nd > 500;
      if ((far || c.ai!.doomed) && !this.seenBy(c.x, c.y, c.z + 1.5)) {
        probe('traffic_despawn', { car: c.id, reason: far ? 'far' : 'stuck', dist_m: Math.round(nd), stucks: c.ai!.stucks, cars: this.count() - 1 });
        this.cars.remove(c);
      }
    }
    if (!living.length || this.frozen) return;
    for (let attempt = 0; attempt < 2 && this.count() < 14; attempt++) this.trySpawn(living);
    if (sim.now - this.lastCount >= 30) {
      this.lastCount = sim.now;
      const l = this.list();
      probe('traffic_count', { cars: l.length, target: 14, moving: l.filter((c) => Math.abs(c.speed) > 3).length, doomed: l.filter((c) => c.ai!.doomed).length, humans: humans.length, frozen: this.frozen });
    }
  }
  private trySpawn(living: { x: number; y: number }[]) {
    const anchor = living[gameRng.helper(living.length)];
    const ring: number[] = [];
    this.grid.query(anchor.x - 400, anchor.y - 400, anchor.x + 400, anchor.y + 400, (v) => {
      const d = Math.hypot(this.rx[v] - anchor.x, this.ry[v] - anchor.y);
      if (d >= 120 && d <= 400 && living.every((h) => Math.hypot(this.rx[v] - h.x, this.ry[v] - h.y) >= 120)) ring.push(v);
    });
    if (!ring.length) return;
    let seenPlan: PathPt[] | null = null;
    for (let t = 0; t < 12; t++) {
      const v = ring[gameRng.helper(ring.length)], plan = this.planStart(v, gameRng.bool() ? 1 : -1);
      if (!plan) continue;
      const [p0, p1] = plan;
      if (this.list().some((c) => Math.hypot(c.x - p0.x, c.y - p0.y) < 30)) continue;
      const yaw = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      if (this.sim.phys.boxBlocked(p0.x, p0.y, 1.4, 2.6, 1.1, 0.6, yaw)) continue;
      if (!this.seenBy(p0.x, p0.y, 1.5)) { this.spawnOn(plan, false, anchor); return; }
      if (!seenPlan) seenPlan = plan;
    }
    if (seenPlan) this.spawnOn(seenPlan, true, anchor);
  }
  spawnOn(plan: PathPt[], seen: boolean, anchor: { x: number; y: number }): Car {
    const [p0, p1] = plan, yaw = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const model = TRAFFIC_MODELS[gameRng.helper(4)];
    const c = this.cars.spawn(model, p0.x, p0.y, 0.4, yaw, -1);
    c.paint = gameRng.helper(6); c.npc = gameRng.int(1, 255); c.inHb = false;
    c.ai = { path: plan, cityCruise: gameRng.range(35, 50) / 3.6, hwCruise: gameRng.range(80, 90) / 3.6, lastMoved: this.sim.now, stucks: 0, reverseUntil: 0,
      doomed: false, blocked: false, wall: false, people: false, nextCtl: 0, want: 0 };
    this.extend(c.ai);
    const hw = this.roadHwy[p0.road];
    probe('traffic_spawn', { car: c.id, x: Math.round(p0.x), y: Math.round(p0.y), dist_m: Math.round(Math.hypot(p0.x - anchor.x, p0.y - anchor.y)), hidden: !seen, highway: hw, cars: this.count() });
    return c;
  }
  cheatSpawn(h: { x: number; y: number; yaw: number }) {
    if (!this.built) this.build();
    const tx = h.x + Math.cos(h.yaw) * 40, ty = h.y + Math.sin(h.yaw) * 40;
    let best = -1, bd = Infinity;
    this.grid.query(tx - 100, ty - 100, tx + 100, ty + 100, (v) => { const d = Math.hypot(this.rx[v] - tx, this.ry[v] - ty); if (d < bd) { bd = d; best = v; } });
    if (best < 0) return;
    const plan = this.planStart(best, 1) ?? this.planStart(best, -1); if (!plan) return;
    const c = this.spawnOn(plan, true, h);
    probe('cheat_traffic_spawn', { car: c.id });
  }
  logState() {
    const l = this.list();
    probe('traffic_state', { cars: l.length, target: 14, frozen: this.frozen, roads: this.roadLen.length, verts: this.rx.length, links: this.links.reduce((a, b) => a + b.length, 0),
      list: l.map((c) => ({ id: c.id, kmh: Math.round(Math.abs(c.speed) * 3.6), want: Math.round(c.ai!.want * 3.6), plan: c.ai!.path.length, stucks: c.ai!.stucks })) });
  }

  // ------------------------------------------------------------------ per frame
  frame() {
    const sim = this.sim;
    if (!this.built) { if (sim.now >= 2) this.build(); else return; }
    if (sim.now >= this.nextPop) { this.nextPop = sim.now + 1; this.populate(); }
    for (const c of this.list()) {
      const ai = c.ai!;
      if (this.frozen) { c.inThr = 0; c.inSteer = 0; c.inHb = true; continue; }
      if (sim.now >= ai.nextCtl) { ai.nextCtl = sim.now + 0.1; this.control(c, ai); }
    }
  }
  /** Driving controller (§12.4) at 10 Hz. */
  private control(c: Car, ai: TrafficAI) {
    const sim = this.sim, now = sim.now, P = ai.path, v = c.speed;
    const fx = Math.cos(c.yaw), fy = Math.sin(c.yaw), rx = fy, ry = -fx;
    // 1. prune
    while (P.length > 2) {
      const [p0, p1, p2] = P;
      const before = (c.x - p1.x) * (p1.x - p0.x) + (c.y - p1.y) * (p1.y - p0.y) < 0 && Math.hypot(c.x - p1.x, c.y - p1.y) > 3;
      const closerNext = segD(c.x, c.y, p1, p2) < segD(c.x, c.y, p0, p1);
      if (before && !closerNext) break;
      P.shift();
    }
    this.extend(ai);
    // 2. broken
    if (c.upZ < 0.3) ai.doomed = true;
    if (P.length >= 2 && segD(c.x, c.y, P[0], P[1]) > 15) {
      let best = -1, bd = 30;
      this.grid.query(c.x - 30, c.y - 30, c.x + 30, c.y + 30, (u) => { const d = Math.hypot(this.rx[u] - c.x, this.ry[u] - c.y); if (d < bd) { bd = d; best = u; } });
      let plan: PathPt[] | null = null;
      if (best >= 0) { const n = this.next(best, 1), dir = n >= 0 && ((this.rx[n] - this.rx[best]) * fx + (this.ry[n] - this.ry[best]) * fy) > 0 ? 1 : -1; plan = this.planStart(best, dir); }
      if (plan) { ai.path = plan; this.extend(ai); } else ai.doomed = true;
    }
    if (ai.path.length < 2) { c.inThr = 0; c.inHb = true; return; }
    const Q = ai.path;
    // 3. look-ahead pursuit
    const look = Math.max(5, Math.min(25, Math.abs(v) * 0.6 + 3));
    let { tx, ty, remaining } = walkAlong(Q, c.x, c.y, look);
    const ahead = (tx - c.x) * fx + (ty - c.y) * fy, side = (tx - c.x) * rx + (ty - c.y) * ry, dist = Math.hypot(tx - c.x, ty - c.y);
    let steerDeg: number, turnDeg: number;
    if (ahead < 0) { steerDeg = side >= 0 ? 35 : -35; turnDeg = 35; }
    else { steerDeg = Math.atan((2 * WHEELBASE * Math.sin(Math.atan2(side, ahead))) / Math.max(dist, 1)) * 180 / Math.PI; turnDeg = Math.abs(steerDeg); }
    let steer = ahead < 0 ? Math.sign(steerDeg) : (() => { const r = Math.max(-1, Math.min(1, steerDeg / (35 * steerScale(v) * 0.85))); return Math.sign(r) * Math.sqrt(Math.abs(r)); })();
    // 4. target speed
    const roadCruise = (p: PathPt) => (this.roadHwy[p.road] ? ai.hwCruise : ai.cityCruise);
    let want = roadCruise(Q[1]);
    want = Math.min(want, Math.sqrt((3.0 * WHEELBASE) / Math.max(Math.tan(turnDeg * Math.PI / 180), 0.01)));
    if (ahead < 0.7 * dist) want = Math.min(want, 5);
    let acc = Math.hypot(Q[1].x - c.x, Q[1].y - c.y);
    for (let i = 1; i + 1 < Q.length && acc < 80; i++) {
      const lx = Q[i + 1].x - Q[i].x, ly = Q[i + 1].y - Q[i].y, ll = Math.hypot(lx, ly) || 1;
      const ang = Math.acos(Math.max(-1, Math.min(1, (lx * fx + ly * fy) / ll))) * 180 / Math.PI;
      const corner = roadCruise(Q[i + 1]) * Math.max(0.3, Math.min(1, 1 - ang / 100));
      want = Math.min(want, Math.sqrt(corner * corner + 2 * 4 * Math.max(acc - 5, 0)));
      acc += ll;
    }
    let planLeft = Math.hypot(Q[1].x - c.x, Q[1].y - c.y); for (let i = 2; i < Q.length; i++) planLeft += Math.hypot(Q[i].x - Q[i - 1].x, Q[i].y - Q[i - 1].y);
    want = Math.min(want, Math.sqrt(2 * 4 * Math.max(planLeft - 3, 0)));
    void remaining;
    // 5. obstacle sweep (characters, other cars)
    let dx = fx + (tx - c.x) / (dist || 1), dy = fy + (ty - c.y) / (dist || 1); const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const reach = Math.max(10, Math.min(60, (v * v) / 8 + 8)), hw = c.spec.size[1] / 2, nx = c.x + fx * (c.spec.size[0] / 2 - 0.6), ny = c.y + fy * (c.spec.size[0] / 2 - 0.6);
    let hit = Infinity; ai.people = false;
    const test = (ox: number, oy: number, r: number, person: boolean) => {
      const ax = (ox - nx) * dx + (oy - ny) * dy, lat = Math.abs(-(ox - nx) * dy + (oy - ny) * dx);
      if (ax > 0 && ax < reach && lat < hw + r && ax < hit) { hit = ax; ai.people = person; }
    };
    for (const h of sim.humans.values()) if (!h.dead && h.player.priv.car < 0 && Math.hypot(h.x - nx, h.y - ny) < reach + 3) test(h.x, h.y, 0.5, true);
    for (const b of sim.bots.byId.values()) if (!b.dead && !b.seated && Math.hypot(b.x - nx, b.y - ny) < reach + 3) test(b.x, b.y, 0.5, true);
    for (const o of this.cars.cars.values()) if (o !== c && Math.hypot(o.x - nx, o.y - ny) < reach + 6) test(o.x, o.y, o.spec.size[1] / 2 + 0.3, false);
    for (const s of sim.econ.spots) if (s && (s.mode === 'crate' || s.mode === 'bag') && Math.hypot(s.x - nx, s.y - ny) < reach + 2) test(s.x, s.y, 0.5, false);
    for (const r of sim.hunters.roadblocks) if (Math.hypot(r.x - nx, r.y - ny) < reach + 12) test(r.x, r.y, 9, false);
    ai.blocked = hit < Infinity;
    if (ai.blocked) want = Math.min(want, Math.sqrt(2 * 4 * Math.max(hit - 2.5, 0)));
    // 6. wall sweep (city walls only)
    const wreach = (v * v) / 8 + 3, wa = Math.sign(steer) * Math.min((0.5 * wreach * Math.tan(turnDeg * Math.PI / 180)) / WHEELBASE, Math.PI / 3);
    const wx = Math.cos(c.yaw - wa), wy = Math.sin(c.yaw - wa);
    let wall = Infinity;
    for (let s = 1; s <= wreach; s += 1) if (sim.wq.inBuilding(nx + wx * s, ny + wy * s, hw * 0.6)) { wall = s; break; }
    ai.wall = wall < Infinity && wall <= hit;
    if (wall < Infinity) want = Math.min(want, Math.sqrt(2 * 4 * Math.max(wall - 1, 0)));
    ai.want = want;
    // 7. pedals (+ stuck recovery §12.5)
    if (Math.abs(v) > 1.5 || ai.people) ai.lastMoved = now;
    if (Math.abs(v) > 5) ai.stucks = 0;
    if (now < ai.reverseUntil) { c.inThr = v > -2.5 ? -0.8 : 0; c.inSteer = -steer; c.inHb = false; return; }
    const limit = ai.wall ? 1.5 : ai.blocked ? 18 : 6;
    if (now - ai.lastMoved > limit) {
      ai.reverseUntil = now + 2; ai.lastMoved = now + 2; ai.stucks++;
      if (ai.stucks >= 3) ai.doomed = true;
      probe('traffic_stuck', { car: c.id, stucks: ai.stucks, blocked: ai.blocked, wall: ai.wall, touch: false, kmh: Math.round(v * 3.6), want_kmh: Math.round(want * 3.6),
        target_deg: Math.round(steerDeg), off_m: +segD(c.x, c.y, Q[0], Q[1]).toFixed(1), plan_m: Math.round(planLeft), x: Math.round(c.x), y: Math.round(c.y) });
      return;
    }
    c.inSteer = steer; c.inHb = false;
    if (want < 1 && v < 2) { c.inThr = 0; c.inHb = true; }
    else if (want > v) c.inThr = Math.max(0, Math.min(1, 0.3 + (want - v) / 8));
    else if (v - want > 0.5 && v > 2) c.inThr = -Math.max(0.2, Math.min(1, (v - want) / 3));
    else c.inThr = 0;
  }
}
function segD(x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L)) : 0;
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}
/** Target point `look` metres along the path from the car's closest point on P0-P1. */
function walkAlong(P: { x: number; y: number }[], x: number, y: number, look: number) {
  const a = P[0], b = P[1], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L)) : 0;
  let px = a.x + dx * t, py = a.y + dy * t, left = look, i = 1;
  while (i < P.length) {
    const seg = Math.hypot(P[i].x - px, P[i].y - py);
    if (seg >= left) { const k = left / (seg || 1); return { tx: px + (P[i].x - px) * k, ty: py + (P[i].y - py) * k, remaining: 0 }; }
    left -= seg; px = P[i].x; py = P[i].y; i++;
  }
  return { tx: px, ty: py, remaining: left };
}
