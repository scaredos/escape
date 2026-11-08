// Build steps 10-20 of spec 01 §5: ports, building dressing, street props, parks, beaches, highway lamps, trees,
// hills, desert scatter, city scatter, walk points; plus spot facings and set pieces (01 Addendum).
import { hashInts, hashStr, Rng } from '../../core/rng';
import { perlin2 } from '../../core/perlin';
import { DEG, Grid, obb, obbAabb, obbDist, obbGap, obbInside, segDist, type OBB } from '../geom';
import { Gen, obbOverlap, type Fp } from './ctx';
import { fillerLayer, villagePalms } from './city';

/** Source-frame prop bounds (06 §9), used for crown and mesh-box tests. */
const SIZE: Record<string, [number, number, number]> = {
  Palm: [7.56, 7.61, 9.83], Ficus: [5.92, 5.5, 6.46], StreetLamp: [2.98, 0.38, 7.94], Bench: [0.61, 1.8, 0.91], Bin: [0.59, 0.51, 1.2],
  BusStop: [1.82, 4.22, 2.91], Kiosk: [4.2, 3.88, 3.42], Acacia: [7.19, 6.71, 5.89], LifeguardTower: [4.24, 3.65, 7.31],
};

export function buildDressing(g: Gen) {
  buildPorts(g);
  dressBuildings(g);
  streetProps(g);
  parks(g);
  beaches(g);
  highwayLamps(g);
  villageTrees(g);
  hills(g);
  desertScatter(g);
  cityScatter(g);
  walkPoints(g);
  spotSetPieces(g);
  let trees = 0; for (const k of ['Palm', 'Ficus', 'Acacia']) trees += (g.props.get(k)?.length ?? 0) / 10;
  g.stats.trees = trees;
  g.stats.cranes = (g.props.get('PortCrane')?.length ?? 0) / 10;
  g.stats.port_yards = g.yards.length;
  let hillN = 0; for (const [k, v] of g.props) if (k.startsWith('Hill')) hillN += v.length / 10;
  g.stats.hills = hillN;
  let scatter = 0; for (const k of ['Shrub', 'Rock', 'Rock:small', 'Acacia']) scatter += (g.props.get(k)?.length ?? 0) / 10;
  g.stats.scatter = scatter;
}

// ------------------------------------------------------------------------------------------------ helpers
function crownClear(g: Gen, name: string, x: number, y: number, yawDeg: number, scale: number): boolean {
  const s = SIZE[name]; const r = (Math.max(s[0], s[1]) / 2) * scale;
  let cx = x, cy = y;
  if (name === 'Palm') { cx += Math.cos(yawDeg * DEG) * 0.6 * scale; cy += Math.sin(yawDeg * DEG) * 0.6 * scale; }
  if (g.nearBuilding(cx, cy, r, true, name === 'Palm' ? 2 : 0)) return false;
  return !g.inShell(cx, cy, r);
}
function plantTree(g: Gen, name: string, x: number, y: number, yawDeg: number, scale: number, margin = 0.8): boolean {
  if (!crownClear(g, name, x, y, yawDeg, scale)) return false;
  if (!g.clearSpot(x, y, margin) || !g.claim(x, y, true)) return false;
  g.claim(x, y); g.prop(name, x, y, 0.02, yawDeg, scale, true); return true;
}
function meshBox(name: string, x: number, y: number, yawDeg: number, scale = 1): OBB {
  const s = SIZE[name]; // pivot at base centre; StreetLamp arm reaches +X: shift the box centre forward by half the arm
  const off = name === 'StreetLamp' ? 1.2 : 0;
  return obb(x + Math.cos(yawDeg * DEG) * off, y + Math.sin(yawDeg * DEG) * off, s[0] * scale, s[1] * scale, yawDeg * DEG);
}
function placeStreet(g: Gen, name: string, x: number, y: number, yawDeg: number, margin: number, collide = true, scale = 1): boolean {
  if (!g.clearSpot(x, y, margin) || !g.claim(x, y, true)) return false;
  g.claim(x, y); g.prop(name, x, y, 0.02, yawDeg, scale, collide); return true;
}
/** Walk a polyline, calling fn at each distance in `ts` with position, unit direction. */
function along(pts: number[], ts: number[], fn: (x: number, y: number, fx: number, fy: number, t: number) => void) {
  let cum = 0, k = 0, ti = 0;
  const n = pts.length / 2;
  while (ti < ts.length && k + 1 < n) {
    const ax = pts[k * 2], ay = pts[k * 2 + 1], bx = pts[k * 2 + 2], by = pts[k * 2 + 3], len = Math.hypot(bx - ax, by - ay);
    if (ts[ti] <= cum + len && len > 1e-6) {
      const u = (ts[ti] - cum) / len; fn(ax + (bx - ax) * u, ay + (by - ay) * u, (bx - ax) / len, (by - ay) / len, ts[ti]); ti++;
    } else { cum += len; k++; }
  }
}
function polyLen(pts: number[]) { let s = 0; for (let k = 2; k < pts.length; k += 2) s += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]); return s; }

// ------------------------------------------------------------------------------------------------ §15 ports
function yardClear(g: Gen, b: OBB, reach: number, escapeSegs: number[][]): boolean {
  const R = Math.max(b.hl, b.hw);
  for (const s of g.spots) {
    const d = Math.hypot(s.rx - b.cx, s.ry - b.cy);
    if (s.mode === 'escape' ? d < reach + 120 : d < reach + 15) return false;
  }
  for (const p of g.parks) if (Math.hypot(p.x - b.cx, p.y - b.cy) < reach + 20 + Math.max(14, Math.min(60, Math.sqrt(p.area))) / 2) return false;
  const a = obbAabb(b);
  if (g.yardGrid.query(a[0] - 6, a[1] - 6, a[2] + 6, a[3] + 6, (id) => obbGap(g.yards[id], b) < 6)) return false;
  const nu = Math.max(1, Math.ceil((b.hl * 2) / 4)), nv = Math.max(1, Math.ceil((b.hw * 2) / 4));
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = -b.hl + (2 * b.hl * i) / nu, v = -b.hw + (2 * b.hw * j) / nv;
    const x = b.cx + b.ux * u - b.uy * v, y = b.cy + b.uy * u + b.ux * v;
    if (!g.land.onLand(x, y)) return false;
    if (g.nearBuilding(x, y, 2.5) || g.inShell(x, y, 2)) return false;
    if (g.segGrid.query(x - 15, y - 15, x + 15, y + 15, (id) => { const s = g.segs[id]; return segDist(x, y, s.ax, s.ay, s.bx, s.by) < s.hw + 3.5; })) return false;
    for (const e of escapeSegs) if (segDist(x, y, e[0], e[1], e[2], e[3]) < 30) return false;
  }
  void R;
  return true;
}
function buildPorts(g: Gen) {
  const escapes = g.spots.filter((s) => s.mode === 'escape');
  const escapeSegs: number[][] = [];
  for (const p of g.piers) {
    let isEsc = false; const segs: number[][] = [];
    for (let k = 0; k + 3 < p.pts.length; k += 2) {
      const s = [p.pts[k], p.pts[k + 1], p.pts[k + 2], p.pts[k + 3]]; segs.push(s);
      if (escapes.some((e) => segDist(e.x, e.y, s[0], s[1], s[2], s[3]) < 40)) isEsc = true;
    }
    if (isEsc) escapeSegs.push(...segs);
  }
  const plans: Record<string, [number, number]> = { haifa: [120, 6], telaviv: [8, 0], eilat: [6, 0] };
  const COLORS = ['ContainerRed', 'ContainerBlue', 'ContainerGreen', 'ContainerGrey'];
  for (let ii = 0; ii < g.pack.insets.length; ii++) {
    const name = g.pack.insets[ii].name, plan = plans[name]; if (!plan) continue;
    const [maxBlocks, maxCranes] = plan, rng = new Rng(hashStr(name) ^ 0xc0a7a);
    let blocks = 0;
    const cranes: [number, number][] = [];
    const quays: { ax: number; ay: number; fx: number; fy: number; ix: number; iy: number; len: number }[] = [];
    for (const p of g.piers.filter((q) => q.inset === ii)) for (let k = 0; k + 3 < p.pts.length; k += 2) {
      const ax = p.pts[k], ay = p.pts[k + 1], bx = p.pts[k + 2], by = p.pts[k + 3], len = Math.hypot(bx - ax, by - ay);
      if (len < 30) continue;
      const fx = (bx - ax) / len, fy = (by - ay) / len, mx = (ax + bx) / 2, my = (ay + by) / 2, nx = -fy, ny = fx;
      const l1 = g.land.onLand(mx + nx * 25, my + ny * 25), l2 = g.land.onLand(mx - nx * 25, my - ny * 25);
      if (l1 === l2) continue;
      quays.push({ ax, ay, fx, fy, ix: l1 ? nx : -nx, iy: l1 ? ny : -ny, len });
    }
    const placeBlock = (cx: number, cy: number, yawRad: number): boolean => {
      const b = obb(cx, cy, 24.8, 13, yawRad);
      if (!yardClear(g, b, 0, escapeSegs)) return false;
      g.addYard(b); blocks++;
      const flip = rng.bool() ? 180 : 0, ux = Math.cos(yawRad), uy = Math.sin(yawRad);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 5; j++) {
        if (rng.frand() < 0.12) continue;
        const tiers = rng.int(1, 3), a = (i - 0.5) * 12.6, c = (j - 2) * 2.64;
        const x = cx + ux * a - uy * c, y = cy + uy * a + ux * c;
        for (let t = 0; t < tiers; t++) g.prop(COLORS[rng.helper(4)], x, y, t * 2.59, yawRad / DEG + flip, 1, true);
      }
      return true;
    };
    for (const q of quays) {
      if (cranes.length >= maxCranes) break;
      for (let a = 25; a + 25 <= q.len && cranes.length < maxCranes; a += 50) {
        const px = q.ax + q.fx * a, py = q.ay + q.fy * a, cx = px + q.ix * 9, cy = py + q.iy * 9;
        if (g.land.onLand(px - q.ix * 20, py - q.iy * 20) || g.land.onLand(px - q.ix * 35, py - q.iy * 35)) continue;
        if (cranes.some(([x, y]) => Math.hypot(x - cx, y - cy) < 45)) continue;
        const legs = obb(px + q.ix * 11, py + q.iy * 11, 20, 14, Math.atan2(q.fy, q.fx));
        if (!yardClear(g, legs, 0, escapeSegs)) continue;
        cranes.push([cx, cy]);
        g.prop('PortCrane', cx, cy, 0, Math.atan2(-q.iy, -q.ix) / DEG, 1, true);
        g.addYard(obb(cx, cy, 20, 18, Math.atan2(q.fy, q.fx)));
      }
    }
    for (let row = 0; row <= 5 && blocks < maxBlocks; row++) for (const q of quays) {
      const fit = Math.floor((q.len + 7) / 31.8);
      for (let k = 0; k < fit && blocks < maxBlocks; k++) {
        const t = (q.len - fit * 31.8 + 7) / 2 + 12.4 + k * 31.8, inl = 22 + 6.5 + row * 23;
        placeBlock(q.ax + q.fx * t + q.ix * inl, q.ay + q.fy * t + q.iy * inl, Math.atan2(q.fy, q.fx));
      }
    }
    for (const p of g.piers.filter((q) => q.inset === ii)) for (let k = 0; k + 3 < p.pts.length && blocks < maxBlocks; k += 2) {
      const ax = p.pts[k], ay = p.pts[k + 1], bx = p.pts[k + 2], by = p.pts[k + 3], len = Math.hypot(bx - ax, by - ay);
      if (len < 5) continue;
      const fx = (bx - ax) / len, fy = (by - ay) / len;
      for (let i = -5; i <= 5 && blocks < maxBlocks; i++) for (let j = -5; j <= 5 && blocks < maxBlocks; j++) {
        const x = ax + fx * i * 31.8 - fy * j * 23, y = ay + fy * i * 31.8 + fx * j * 23;
        if (!g.land.onLand(x, y) || g.harbourCount(x, y, 150) < 4) continue;
        placeBlock(x, y, Math.atan2(fy, fx));
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ §14 dressing
function dressBuildings(g: Gen) {
  const parts = new Map<string, Fp[]>();
  for (const f of g.fps) if (f.alive) { let a = parts.get(f.base); if (!a) parts.set(f.base, (a = [])); a.push(f); }
  const AWN = ['B8322A', '2E7D4F', '2C5F9E', 'D9822B'];
  let n = 0;
  for (const f of g.fps) {
    if (!f.alive || f.shell) continue;
    const sib = parts.get(f.base)!, split = sib.length > 1, small = f.L < 4 || f.W < 4;
    if (small && !split) continue;
    const rng = new Rng(hashStr(f.base) ^ 0xd3e55);
    // parapet
    const ux = f.b.ux, uy = f.b.uy, vx = -uy, vy = ux, H = f.H;
    const wallsDef = [
      { cu: 0, cv: f.b.hw, len: f.L, along: [ux, uy], out: [vx, vy], long: true }, { cu: 0, cv: -f.b.hw, len: f.L, along: [ux, uy], out: [-vx, -vy], long: true },
      { cu: f.b.hl, cv: 0, len: f.W, along: [vx, vy], out: [ux, uy], long: false }, { cu: -f.b.hl, cv: 0, len: f.W, along: [vx, vy], out: [-ux, -uy], long: false },
    ];
    for (const w of wallsDef) {
      const mx = f.cx + ux * w.cu + vx * w.cv, my = f.cy + uy * w.cu + vy * w.cv;
      const shrink = w.long ? 0 : 0.25, half = w.len / 2 - shrink;
      let start: number | null = null;
      const covered = (t: number) => {
        const x = mx + w.along[0] * t + w.out[0] * 0.1, y = my + w.along[1] * t + w.out[1] * 0.1;
        return sib.some((o) => o !== f && o.H >= H && obbInside(o.b, x, y));
      };
      const emit = (a: number, b: number) => {
        if (b - a < 0.3) return;
        const c = (a + b) / 2, x = mx + w.along[0] * c - w.out[0] * 0.125, y = my + w.along[1] * c - w.out[1] * 0.125;
        g.box('facade_nc', x, y, H + 0.2, b - a, 0.25, 0.4, Math.atan2(w.along[1], w.along[0]) / DEG, { color: f.tint, extra: f.stone ? 1 : 0 }); n++;
      };
      const step = 0.5;
      for (let t = -half; t <= half + 1e-6; t += step) {
        const cov = split && covered(t);
        if (!cov && start === null) start = t;
        if (cov && start !== null) { emit(start, Math.min(half, t + 0.25)); start = null; }
      }
      if (start !== null) emit(start, half);
    }
    if (small) continue;
    // roof items
    if (f.L >= 5 && f.W >= 5 && rng.frand() < 0.8) {
      const heaters = rng.int(1, Math.max(1, Math.min(4, Math.floor((f.L * f.W) / 70)))), tanks = f.L * f.W > 60 ? rng.int(0, 2) : 0;
      const placed: [number, number][] = [];
      for (let it = 0; it < heaters + tanks; it++) {
        for (let t = 0; t < 8; t++) {
          const u = rng.range(-f.b.hl + 1.5, f.b.hl - 1.5), v = rng.range(-f.b.hw + 1.5, f.b.hw - 1.5);
          const x = f.cx + ux * u + vx * v, y = f.cy + uy * u + vy * v;
          if (placed.some(([a, b]) => Math.hypot(a - x, b - y) < 2.4)) continue;
          placed.push([x, y]);
          if (it < heaters) g.prop('SolarHeater', x, y, H, -90 + rng.range(-4, 4), 1, false);
          else g.prop('WaterTank', x, y, H, rng.range(0, 360), 1, false);
          n++; break;
        }
      }
    }
    // AC units
    if (f.lv >= 2 && rng.frand() < 0.4) {
      for (const w of wallsDef) {
        if (w.len < 6) continue;
        const cnt = rng.int(0, 2);
        for (let k = 0; k < cnt; k++) {
          const storey = rng.int(1, f.lv - 1), t = rng.range(-w.len / 2 + 1, w.len / 2 - 1);
          const mx = f.cx + ux * w.cu + vx * w.cv, my = f.cy + uy * w.cu + vy * w.cv;
          const x = mx + w.along[0] * t + w.out[0] * 0.23, y = my + w.along[1] * t + w.out[1] * 0.23;
          let ok = true;
          for (let s = -0.45; s <= 0.45 && ok; s += 0.45) {
            const px = x + w.along[0] * s, py = y + w.along[1] * s;
            if (g.fpGrid.query(px - 1, py - 1, px + 1, py + 1, (id) => { const o = g.fps[id]; return o.alive && o !== f && obbDist(o.b, px, py) < 0.22; })) ok = false;
          }
          if (ok) { g.prop('ACUnit', x, y, storey * 3.2 + 0.4, Math.atan2(w.out[1], w.out[0]) / DEG, 1, false); n++; }
        }
      }
    }
    const city = f.inset >= 0 && !f.village;
    // Bauhaus balconies
    const insName = f.inset >= 0 ? g.pack.insets[f.inset].name : '';
    if ((insName === 'telaviv' || insName === 'haifa') && f.lv >= 2 && f.lv <= 6 && Math.max(f.L, f.W) >= 8 && rng.frand() < 0.35) {
      const w = [wallsDef[0], wallsDef[1]].map((w) => {
        const mx = f.cx + vx * w.cv + w.out[0] * 5, my = f.cy + vy * w.cv + w.out[1] * 5;
        return { w, d: g.carriageEdgeDist(mx, my, 60) };
      }).sort((a, b) => a.d - b.d)[0].w;
      const slab = w.len - 1.2;
      const mx = f.cx + vx * w.cv, my = f.cy + vy * w.cv;
      let ok = slab > 1;
      for (let t = -slab / 2; t <= slab / 2 && ok; t += 0.5) {
        const px = mx + w.along[0] * t + w.out[0] * 0.7, py = my + w.along[1] * t + w.out[1] * 0.7;
        if (g.nearBuilding(px, py, 0.6) || g.inShell(px, py, 0.6)) ok = false;
      }
      if (ok) {
        const yaw = Math.atan2(w.along[1], w.along[0]) / DEG;
        for (let s = 1; s < f.lv; s++) {
          const z = s * 3.2;
          g.box('flat', mx + w.out[0] * 0.6, my + w.out[1] * 0.6, z - 0.075, slab, 1.2, 0.15, yaw, { color: 'EFEBE3', extra: 0.85 });
          g.box('flat', mx + w.out[0] * 1.175, my + w.out[1] * 1.175, z + 0.45, slab, 0.05, 0.9, yaw, { color: 'D3CDC1', extra: 0.8 });
          for (const e of [-1, 1]) g.box('flat', mx + w.along[0] * e * slab / 2 + w.out[0] * 0.6, my + w.along[1] * e * slab / 2 + w.out[1] * 0.6, z + 0.45, 0.05, 1.15, 0.9, yaw, { color: 'D3CDC1', extra: 0.8 });
          n += 4;
        }
        f.overhang = 1.3;
      }
    }
    // shop awnings
    if (city && rng.frand() < 0.6) {
      let best: typeof wallsDef[0] | null = null, bd = 8;
      for (const w of wallsDef) {
        if (w.len < 4) continue;
        const mx = f.cx + ux * w.cu + vx * w.cv, my = f.cy + uy * w.cu + vy * w.cv;
        const d = g.carriageEdgeDist(mx, my, 20, (s) => s.rank >= 2 && !s.highway) ;
        if (d < bd) { bd = d; best = w; }
      }
      if (best) {
        const w = best, col = AWN[rng.helper(4)], bays = Math.min(Math.floor((w.len - 0.8) / 3.2), 5);
        const mx = f.cx + ux * w.cu + vx * w.cv, my = f.cy + uy * w.cu + vy * w.cv, yaw = Math.atan2(w.along[1], w.along[0]) / DEG;
        let any = false;
        for (let b = 0; b < bays; b++) {
          const t = (b - (bays - 1) / 2) * 3.2;
          if (rng.frand() >= 0.8) continue;
          let clear = true;
          for (let s = -1; s <= 1 && clear; s += 1) {
            const px = mx + w.along[0] * (t + s) + w.out[0] * 0.61, py = my + w.along[1] * (t + s) + w.out[1] * 0.61;
            if (g.fpGrid.query(px - 1, py - 1, px + 1, py + 1, (id) => { const o = g.fps[id]; return o.alive && o !== f && obbDist(o.b, px, py) < 0.55; })) clear = false;
          }
          if (!clear) continue;
          const cx = mx + w.along[0] * t + w.out[0] * 0.61, cy = my + w.along[1] * t + w.out[1] * 0.61;
          // canvas pitched 20 deg down away from the wall: roll about the along axis
          const outSign = 1;
          g.box('flat', cx, cy, 2.78, 2.6, 1.3, 0.06, yaw, { color: col, extra: 0.85, roll: 20 * outSign * sideSign(w) });
          for (const s of [-0.52, 0.52]) g.box('flat_ns', cx + w.along[0] * s, cy + w.along[1] * s, 2.795, 0.52, 1.3, 0.06, yaw, { color: 'F1EEE6', extra: 0.85, roll: 20 * sideSign(w) });
          any = true; n += 3;
        }
        if (any) f.overhang = 1.3;
      }
    }
  }
  g.stats.dressing_instances = n;
}
/** Roll sign so a box yawed along the wall tilts down toward the outside. Local +y = left of `along`. */
function sideSign(w: { along: number[]; out: number[] }) { const leftx = -w.along[1], lefty = w.along[0]; return leftx * w.out[0] + lefty * w.out[1] > 0 ? -1 : 1; }

// ------------------------------------------------------------------------------------------------ §16 street props
function streetProps(g: Gen) {
  for (const way of g.ways) {
    const S = g.segs.find(() => false); void S;
    const st = way.style; const rank = rankOf(st); if (rank < 1) continue;
    const hw = widthOf(st) / 2, pts = way.pts, len = polyLen(pts); if (len < 1) continue;
    const rng = new Rng(hashStr(way.id));
    if (rank >= 3) {
      const want = len / 400, stops = Math.floor(want) + (rng.frand() < want - Math.floor(want) ? 1 : 0);
      if (stops > 0) {
        const ts: number[] = []; for (let k = 0; k < stops; k++) ts.push((len / stops) * (k + 0.5));
        along(pts, ts, (x, y, fx, fy) => {
          const rx = fy, ry = -fx, px = x + rx * (hw + 1.8), py = y + ry * (hw + 1.8), yaw = Math.atan2(-ry, -rx) / DEG;
          if (g.boxHitsBuilding(meshBox('BusStop', px, py, yaw))) return;
          if (!g.clearSpot(px + fx * 2.2, py + fy * 2.2, 0.3) || !g.clearSpot(px - fx * 2.2, py - fy * 2.2, 0.3)) return;
          placeStreet(g, 'BusStop', px, py, yaw, 1.2);
        });
      }
    }
    {
      const ts: number[] = []; for (let t = rng.range(5, 35); t < len; t += 35) ts.push(t);
      let step = 0;
      along(pts, ts, (x, y, fx, fy) => {
        const side = step++ % 2 === 0 ? 1 : -1, rx = fy * side, ry = -fx * side;
        const px = x + rx * (hw + 0.75), py = y + ry * (hw + 0.75), yaw = Math.atan2(-ry, -rx) / DEG;
        if (g.boxHitsBuilding(meshBox('StreetLamp', px, py, yaw))) return;
        placeStreet(g, 'StreetLamp', px, py, yaw, 0.6);
      });
    }
    if (rank >= 3) {
      const ts: number[] = []; for (let t = 7.5; t < len; t += 15) ts.push(t);
      along(pts, ts, (x, y, fx, fy) => {
        for (const side of [1, -1]) {
          const rx = fy * side, ry = -fx * side, yaw = Math.atan2(-ry, -rx) / DEG + rng.range(-35, 35), sc = rng.range(0.9, 1.1);
          if (!plantTree(g, 'Palm', x + rx * (hw + 1.2), y + ry * (hw + 1.2), yaw, sc)) plantTree(g, 'Palm', x + rx * (hw + 1.0), y + ry * (hw + 1.0), yaw, 0.85);
        }
      });
    }
    if (rank === 1) {
      const side = rng.bool() ? 1 : -1, ts: number[] = []; for (let t = rng.range(3, 20); t < len; t += 20) ts.push(t);
      along(pts, ts, (x, y, fx, fy) => {
        const rx = fy * side, ry = -fx * side, yaw = rng.range(0, 360), sc = rng.range(0.85, 1.15);
        if (!plantTree(g, 'Ficus', x + rx * (hw + 1.4), y + ry * (hw + 1.4), yaw, sc)) plantTree(g, 'Ficus', x + rx * (hw + 1.0), y + ry * (hw + 1.0), yaw, 0.85);
      });
    }
  }
  for (const [x, y] of g.kiosks) {
    let best = Infinity, yaw = 0;
    g.segGrid.query(x - 40, y - 40, x + 40, y + 40, (id) => {
      const s = g.segs[id]; if (!s.asphalt) return;
      const d = segDist(x, y, s.ax, s.ay, s.bx, s.by); if (d < best) {
        best = d; const L2 = (s.bx - s.ax) ** 2 + (s.by - s.ay) ** 2, t = L2 ? Math.max(0, Math.min(1, ((x - s.ax) * (s.bx - s.ax) + (y - s.ay) * (s.by - s.ay)) / L2)) : 0;
        yaw = Math.atan2(s.ay + (s.by - s.ay) * t - y, s.ax + (s.bx - s.ax) * t - x) / DEG;
      }
    });
    placeStreet(g, 'Kiosk', x, y, yaw, 2.3);
  }
}
import { STYLE } from './ctx';
const rankOf = (s: string) => STYLE[s]?.rank ?? 0;
const widthOf = (s: string) => STYLE[s]?.w ?? 7;

// ------------------------------------------------------------------------------------------------ §17 parks + §23 park shrubs
function parks(g: Gen) {
  for (const p of g.parks) {
    let side = Math.max(14, Math.min(60, Math.sqrt(p.area)));
    while (side > 14 && ![[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, b]) => g.land.onLand(p.x + a * side / 2, p.y + b * side / 2))) side = Math.max(14, side - 12);
    p.side = side;
    g.box('lawn', p.x, p.y, -0.02, side, side, 0.06, 0);
    const rng = new Rng(hashStr(p.id) ^ 0xbe4c4);
    for (let k = 0; k < 3; k++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(5, 12), x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      const yaw = Math.atan2(p.y - y, p.x - x) / DEG;
      placeStreet(g, k < 2 ? 'Bench' : 'Bin', x, y, yaw, k < 2 ? 1.0 : 0.5, false);
    }
    const tr = new Rng(hashStr(p.id));
    for (let k = 0; k < 7; k++) {
      const x = p.x + tr.range(-18, 18), y = p.y + tr.range(-18, 18), palm = tr.frand() < 0.35, yaw = tr.range(0, 360), sc = tr.range(0.85, 1.15);
      if (!g.land.landAt(x, y, 4) || g.nearBuilding(x, y, 2) || g.highwayDist(x, y) < 12) continue;
      plantTree(g, palm ? 'Palm' : 'Ficus', x, y, yaw, sc, 1);
    }
    const sr = new Rng(hashStr(p.id) ^ 0x5c2b7);
    for (let k = 0; k < 3; k++) {
      const a = sr.range(0, Math.PI * 2), r = side / 2 + sr.range(1, 4), yaw = sr.range(0, 360), sc = sr.range(0.6, 1.0);
      placeStreet(g, 'Shrub', p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, yaw, 3.5, false, sc);
    }
  }
}

// ------------------------------------------------------------------------------------------------ §18 beaches
function beaches(g: Gen) {
  for (let ii = 0; ii < g.pack.insets.length; ii++) {
    const ins = g.pack.insets[ii]; if (ins.name !== 'telaviv' && ins.name !== 'eilat') continue;
    const rows = g.land.rows[ii]; if (!rows) continue;
    const [ox, oy] = ins.offset, rng = new Rng(hashStr(ins.name));
    for (let r = 0; r < rows.length; r++) {
      const a = rows[r], cy = oy + r * 10 + 5;
      for (let k = 0; k < a.length; k += 2) {
        const x0 = a[k], x1 = a[k + 1];
        const sw = x0 > 0.5 ? Math.min(30, x1 - x0) : 0, se = x1 < 1999.5 ? Math.min(30, x1 - x0 - sw) : 0;
        for (const [width, water, face, back] of [[sw, ox + x0, 180, ox + x0 + sw], [se, ox + x1, 0, ox + x1 - se]] as const) {
          if (width < 20) continue;
          const dir = face === 180 ? 1 : -1; // inland direction from the water edge
          if (r % 25 === 12) {
            const x = water + dir * 0.45 * width;
            if (!g.nearPier(x, cy, 60)) placeStreet(g, 'LifeguardTower', x, cy, face, 2.8);
          } else {
            for (let d = 7; d <= width - 5; d += 7) {
              if (rng.frand() < 0.3) continue;
              const x = water + dir * d, y = cy + rng.range(-2, 2), yaw = rng.range(0, 360);
              if (g.nearPier(x, y, 60)) continue;
              if (!placeStreet(g, 'Umbrella', x, y, yaw, 1.3, false)) continue;
              for (const s of [-0.9, 0.9]) g.prop('Lounger', x, y + s, 0.02, face, 1, false);
            }
          }
          if (ins.name === 'telaviv' && face === 180 && k === 0) {
            const mark = Math.ceil((r * 10) / 15), y = oy + mark * 15;
            if (y >= oy + r * 10 && y < oy + r * 10 + 10 && !g.nearPier(back, y, 60)) {
              plantTree(g, 'Palm', back + 5, y, rng.range(0, 360), 1);
              if (mark % 2 === 0) placeStreet(g, 'Bench', back + 1, y, face, 1.0, false);
              if (mark % 4 === 1) placeStreet(g, 'Bin', back + 1, y + 7.5, face, 0.5, false);
              if (mark % 20 === 10) placeStreet(g, 'Kiosk', back + 10, y, face, 2.3);
            }
          }
        }
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ §19 highway lamps, §20 village trees
function highwayLamps(g: Gen) {
  for (const h of g.pack.world.highways) {
    const pts = h.pts.flat(), len = polyLen(pts), ts: number[] = [];
    for (let t = 30; t < len; t += 60) if (t < 1000 || t > len - 1000) ts.push(t);
    along(pts, ts, (x, y, fx, fy) => {
      for (const side of [1, -1]) {
        const rx = fy * side, ry = -fx * side, px = x + rx * 10.5, py = y + ry * 10.5, yaw = Math.atan2(-ry, -rx) / DEG;
        if (!g.land.onLand(px, py) || g.nearBuilding(px, py, 1) || g.boxHitsBuilding(meshBox('StreetLamp', px, py, yaw))) continue;
        if (g.carriageEdgeDist(px, py, 15, (s) => !s.highway) <= 0.5 || !g.claim(px, py, true)) continue;
        g.claim(px, py); g.prop('StreetLamp', px, py, 0, yaw, 1, true);
      }
    });
  }
}
function villageTrees(g: Gen) {
  const rng = new Rng(0xe5ca1);
  for (const pts of villagePalms) for (let k = 0; k < pts.length; k += 2) {
    const x = pts[k], y = pts[k + 1], yaw = rng.range(0, 360), sc = rng.range(0.85, 1.15);
    if (!g.land.landAt(x, y, 4) || g.nearBuilding(x, y, 2) || g.highwayDist(x, y) < 12) continue;
    plantTree(g, 'Palm', x, y, yaw, sc, 1);
  }
}

// ------------------------------------------------------------------------------------------------ §21 hills
function hills(g: Gen) {
  const zones = g.pack.world.zones;
  const hillClear = (cx: number, cy: number, Lh: number, Wh: number, yawRad: number): boolean => {
    const ux = Math.cos(yawRad), uy = Math.sin(yawRad);
    const feet: [number, number][] = [[cx, cy]];
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, u = Math.cos(a) * Lh / 2, v = Math.sin(a) * Wh / 2; feet.push([cx + ux * u - uy * v, cy + uy * u + ux * v]); }
    for (const [x, y] of feet) {
      if (!g.land.onLand(x, y)) return false;
      for (let i = 0; i < g.land.ox.length; i++) if (x > g.land.ox[i] - 150 && x < g.land.ox[i] + 2150 && y > g.land.oy[i] - 150 && y < g.land.oy[i] + 2150) return false;
    }
    if (!(g.highwayDist(cx, cy) >= 150 + Math.max(Lh, Wh) / 2 || feet.every(([x, y]) => g.highwayDist(x, y) >= 150))) return false;
    const inGrown = (px: number, py: number, m: number) => {
      const dx = px - cx, dy = py - cy, u = (dx * ux + dy * uy) / (Lh / 2 + m), v = (-dx * uy + dy * ux) / (Wh / 2 + m);
      return u * u + v * v <= 1;
    };
    for (const s of g.spots) if (inGrown(s.rx, s.ry, 150)) return false;
    for (const z of zones) {
      const m = z.kind === 'airport' ? 150 : z.kind === 'village' ? 60 : -1; if (m < 0) continue;
      const [x0, y0, x1, y1] = z.rect;
      if (inGrown((x0 + x1) / 2, (y0 + y1) / 2, m)) return false;
      if (feet.some(([x, y]) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m)) return false;
    }
    const b = obb(cx, cy, Lh, Wh, yawRad), a = obbAabb(b);
    if (g.lfGrid.query(a[0], a[1], a[2], a[3], (id) => {
      const o = g.landforms[id].b, slack = 0.15 * (Math.min(Lh, Wh) + 2 * Math.min(o.hl, o.hw));
      return obbGap(b, o) < -slack;
    })) return false;
    return true;
  };
  const mound = (cx: number, cy: number, Lh: number, Wh: number, yawDeg: number, rise: number) => {
    const ground = fillerLayer(g, cx, cy), key = ground === 'fields' ? 'Hill:fields' : ground === 'beige' ? 'Hill:beige' : 'Hill:desert';
    g.prop(key, cx, cy, -0.5, yawDeg, [Lh / 100, Wh / 100, rise / 15], true);
  };
  const place = (rng: Rng, cx: number, cy: number, Lh: number, Wh: number, yawDeg: number, rise: number) => {
    if (!hillClear(cx, cy, Lh, Wh, yawDeg * DEG)) return false;
    g.addLandform(obb(cx, cy, Lh, Wh, yawDeg * DEG), true);
    if (Lh < 300) { mound(cx, cy, Lh, Wh, yawDeg, rise); return true; }
    const ux = Math.cos(yawDeg * DEG), uy = Math.sin(yawDeg * DEG);
    mound(cx, cy, Lh * rng.range(0.55, 0.7), Wh, yawDeg, rise);
    for (const s of [-1, 1]) {
      const Ls = Lh * rng.range(0.35, 0.5), Ws = Wh * Math.sqrt(Ls / Lh) * rng.range(0.85, 1), r2 = Math.min(rise * rng.range(0.35, 0.7), 0.27 * Ws);
      mound(cx + ux * s * (Lh - Ls) / 2, cy + uy * s * (Lh - Ls) / 2, Ls, Ws, yawDeg, r2);
    }
    return true;
  };
  const rr = new Rng(0x41d6e);
  for (const h of g.pack.world.highways) {
    const pts = h.pts.flat(), len = polyLen(pts), ts: number[] = []; for (let t = 100; t < len; t += 150) ts.push(t);
    along(pts, ts, (x, y, fx, fy) => {
      for (const side of [1, -1]) {
        const Lh = 300 + 1200 * rr.frand() ** 2, Wh = Lh * rr.range(0.3, 0.5), off = rr.range(150, 600) + Wh / 2, fwd = rr.range(-100, 100);
        const yaw = Math.atan2(fy, fx) / DEG + rr.range(-8, 8), rise = Math.min(rr.range(20, 60), 0.27 * Wh), p = rr.frand();
        const lx = -fy * side, ly = fx * side;
        if (p < 0.9) place(rr, x + lx * off + fx * fwd, y + ly * off + fy * fwd, Lh, Wh, yaw, rise);
      }
    });
  }
  const fr = new Rng(0x4177), [xmin, ymin, xmax, ymax] = g.land.bounds;
  let placed = 0;
  for (let t = 0; t < 9000 && placed < 420; t++) {
    const band = fr.frand(), inward = fr.range(40, 900), turn = fr.range(-25, 25);
    let x = fr.range(xmin, xmax), y = fr.range(ymin, ymax), axis = fr.range(0, 180);
    if (band < 0.5) { x = xmax - inward; axis = 90 + turn; } else if (band < 0.65) { y = ymin + inward; axis = turn; } else if (band < 0.75) { y = ymax - inward; axis = turn; }
    const big = fr.frand() < 0.25;
    const Lh = big ? fr.range(300, 1200) : fr.range(60, 300), Wh = Lh * fr.range(0.35, 0.6);
    const rise = big ? Math.min(fr.range(20, 60), 0.27 * Wh) : Math.min(Math.max(5, Math.min(25, Lh * fr.range(0.06, 0.12))), 0.35 * Wh);
    if (place(fr, x, y, Lh, Wh, axis, rise)) placed++;
  }
}

// ------------------------------------------------------------------------------------------------ §22 desert scatter
function desertScatter(g: Gen) {
  const [xmin, ymin, xmax, ymax] = g.land.bounds;
  const ring = new Map<number, number>(), key = (i: number, j: number) => (i + 1000) * 10000 + (j + 1000);
  for (const h of g.pack.world.highways) {
    const pts = h.pts.flat(), len = polyLen(pts), ts: number[] = []; for (let t = 0; t <= len; t += 25) ts.push(t);
    along(pts, ts, (x, y) => {
      const ci = Math.floor(x / 100), cj = Math.floor(y / 100);
      for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) {
        const d = Math.max(Math.abs(a), Math.abs(b)), k = key(ci + a, cj + b), o = ring.get(k);
        if (o === undefined || d < o) ring.set(k, d);
      }
    });
  }
  const airport = g.pack.world.zones.filter((z) => z.kind === 'airport'), villages = g.pack.world.zones.filter((z) => z.kind === 'village');
  const wadi = (x: number, y: number) => Math.max(0, 1 - Math.abs(perlin2(x / 1300 + 5.3, y / 1300 + 9.1) + 0.5 * perlin2(x / 560 + 17.2, y / 560 + 3.4)) / 0.045);
  const spotOk = (x: number, y: number, r: number, nearRoad: boolean) => {
    if (g.land.insetIdx(x, y) >= 0) return false;
    if (nearRoad && g.highwayDist(x, y) < 25 + r) return false;
    if (g.onLandform(x, y)) return false;
    for (const z of airport) if (x > z.rect[0] - 30 && x < z.rect[2] + 30 && y > z.rect[1] - 30 && y < z.rect[3] + 30) return false;
    if (r > 2 && g.nearSpot(x, y, 6 + r)) return false;
    if (!g.clearSpot(x, y, r) || !g.claim(x, y, true)) return false;
    g.claim(x, y); return true;
  };
  for (let ci = Math.floor(xmin / 100); ci < Math.ceil(xmax / 100); ci++) for (let cj = Math.floor(ymin / 100); cj < Math.ceil(ymax / 100); cj++) {
    const cx = ci * 100 + 50, cy = cj * 100 + 50;
    if (!g.land.onLand(cx, cy) || g.land.insetIdx(cx, cy) >= 0) continue;
    const rng = new Rng(hashInts(ci, cj) ^ 0x5c3b1);
    const rd = ring.get(key(ci, cj)), near = rd === undefined ? 0 : (5 - rd) / 5, nearRoad = rd !== undefined && rd <= 1;
    const biome = fillerLayer(g, cx, cy), dry = biome === 'desert' || biome === 'beige';
    const patch = Math.max(0.15, Math.min(2, 1 + 1.6 * perlin2(cx / 650 + 31.7, cy / 650 + 12.3)));
    const rocky = Math.max(0, Math.min(1, (perlin2(cx / 900 - 7.9, cy / 900 + 44.1) - 0.1) / 0.25));
    const bushes = biome === 'village' ? 2 : biome === 'desert' ? (1 + 90 * near * near) * patch : biome === 'beige' ? (0.8 + 72 * near * near) * patch : (0.2 + 14 * near * near) * patch;
    for (let s = 0; s < 16; s++) {
      const sx = ci * 100 + rng.frand() * 100, sy = cj * 100 + rng.frand() * 100, w = dry ? wadi(sx, sy) : 0;
      if (rng.frand() * 72 >= bushes + 45 * w * (0.5 + 0.5 * near)) continue;
      const clump = rng.int(2, 7) + (w > 0 ? 2 : 0), spread = rng.range(4, 11), cs = rng.range(0.7, 1.2);
      for (let b = 0; b < clump; b++) {
        const a = rng.frand() * Math.PI * 2, rr = spread * Math.sqrt(rng.frand()), sc = cs * rng.range(0.65, 1.3), yaw = rng.range(0, 360);
        const x = sx + Math.cos(a) * rr, y = sy + Math.sin(a) * rr;
        if (spotOk(x, y, 0.7 * sc, nearRoad)) g.prop('Shrub', x, y, 0, yaw, sc, false);
      }
    }
    const rockAt = (x: number, y: number, sc: number, sink: number, tilt: number) => {
      if (villages.some((z) => x > z.rect[0] - 20 && x < z.rect[2] + 20 && y > z.rect[1] - 20 && y < z.rect[3] + 20)) return;
      const sq: [number, number, number] = [rng.range(0.8, 1.25) * sc, rng.range(0.8, 1.25) * sc, rng.range(0.7, 1.15) * sc];
      const pitch = rng.range(-tilt, tilt), roll = rng.range(-tilt, tilt), yaw = rng.range(0, 360);
      if (!spotOk(x, y, 1.7 * sc, nearRoad)) return;
      g.prop(sc < 0.8 ? 'Rock:small' : 'Rock', x, y, -1.8 * sink * sq[2], yaw, sq, sc >= 0.8, pitch, roll);
    };
    if (biome !== 'village') {
      const v = biome === 'desert' ? 0.25 + 1.2 * near + 2.2 * rocky : biome === 'beige' ? 0.15 + 0.8 * near + 1.5 * rocky : 0.03;
      const clusters = Math.floor(v) + (rng.frand() < v - Math.floor(v) ? 1 : 0);
      for (let c = 0; c < clusters; c++) {
        const x0 = ci * 100 + rng.frand() * 100, y0 = cj * 100 + rng.frand() * 100, n = rng.int(1, 4);
        for (let k = 0; k < n; k++) { const a = rng.frand() * 6.283, r = rng.frand() * 6; rockAt(x0 + Math.cos(a) * r, y0 + Math.sin(a) * r, 0.5 + 0.8 * rng.frand() ** 2, rng.range(0.1, 0.35), 8); }
      }
      const po = biome === 'desert' ? 0.03 + 0.12 * near + 0.08 * rocky : biome === 'beige' ? 0.02 + 0.08 * near + 0.05 * rocky : 0;
      if (rng.frand() < po) {
        const ox = cx + rng.range(-40, 40), oy = cy + rng.range(-40, 40), nb = rng.int(3, 6), nr = rng.int(4, 8);
        for (let k = 0; k < nb; k++) { const sc = rng.range(1.2, 3), a = rng.frand() * 6.283, r = rng.frand() * 1.6 * sc; rockAt(ox + Math.cos(a) * r, oy + Math.sin(a) * r, sc, rng.range(0.2, 0.5), 15); }
        for (let k = 0; k < nr; k++) { const a = rng.frand() * 6.283, r = rng.range(6, 16); rockAt(ox + Math.cos(a) * r, oy + Math.sin(a) * r, rng.range(0.5, 0.9), rng.range(0.1, 0.3), 10); }
      }
    }
    if (biome === 'desert' && cy < -9000) {
      for (let s = 0; s < 3; s++) {
        const x = ci * 100 + rng.frand() * 100, y = cj * 100 + rng.frand() * 100, yaw = rng.range(0, 360), sc = rng.range(0.75, 1.2);
        if (rng.frand() * 3 >= 0.1 + 0.5 * near + 2.4 * wadi(x, y)) continue;
        if (!crownClear(g, 'Acacia', x, y, yaw, sc)) continue;
        if (spotOk(x, y, 3.5, nearRoad)) g.prop('Acacia', x, y, 0, yaw, sc, true);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ §23 city lot scatter
function cityScatter(g: Gen) {
  for (let ii = 0; ii < g.pack.insets.length; ii++) {
    const ins = g.pack.insets[ii], [ox, oy] = ins.offset, rng = new Rng(hashStr(ins.name) ^ 0x10751);
    const want = ins.name === 'eilat' ? 240 : 100; let n = 0;
    for (let t = 0; t < want * 6 && n < want; t++) {
      const x = ox + rng.frand() * 2000, y = oy + rng.frand() * 2000, rock = rng.frand() < 0.15, yaw = rng.range(0, 360);
      const sc = rock ? rng.range(0.25, 0.5) : rng.range(0.5, 1.1);
      if (!g.land.landAt(x, y, 35) || g.nearBuilding(x, y, 8) || !g.clearSpot(x, y, 4)) continue;
      if (g.segGrid.query(x - 12, y - 12, x + 12, y + 12, (id) => { const s = g.segs[id]; return segDist(x, y, s.ax, s.ay, s.bx, s.by) < s.hw + 1.5; })) continue;
      if (!g.claim(x, y, true)) continue;
      g.claim(x, y); n++;
      if (rock) g.prop('Rock:small', x, y, -0.1, yaw, sc, false); else g.prop('Shrub', x, y, 0, yaw, sc, false);
    }
  }
}

// ------------------------------------------------------------------------------------------------ §24 walk points
function walkPoints(g: Gen) {
  const grid = new Grid(12);
  for (let k = 0; k < g.roadVerts.length; k += 2) {
    const x = g.roadVerts[k], y = g.roadVerts[k + 1];
    if (grid.query(x - 12, y - 12, x + 12, y + 12, (id) => Math.hypot(g.walk[id * 2] - x, g.walk[id * 2 + 1] - y) < 12)) continue;
    if (g.nearBuilding(x, y, 1)) continue;
    const id = g.walk.length / 2; g.walk.push(x, y); grid.insert(id, x, y, x, y);
  }
  for (const [name, st] of Object.entries(g.stats.insets as Record<string, any>)) {
    const i = g.land.names.indexOf(name); let n = 0;
    for (let k = 0; k < g.walk.length; k += 2) if (g.land.insetIdx(g.walk[k], g.walk[k + 1]) === i) n++;
    st.walk_points = n;
  }
  g.stats.walk_points = g.walk.length / 2;
  g.stats.drive_roads = g.driveRoads.length;
}

// ------------------------------------------------------------------------------------------------ spot facings + set pieces
function spotSetPieces(g: Gen) {
  const safes = g.spots.filter((s) => s.mode === 'safehouse');
  const town = (x: number, y: number): [number, number] => {
    let best = Infinity, d: [number, number] = [0, 1];
    for (const s of safes) { const dd = Math.hypot(s.rx - x, s.ry - y); if (dd < best && dd > 0.01) { best = dd; d = [(s.rx - x) / dd, (s.ry - y) / dd]; } }
    return d;
  };
  for (const s of g.spots) {
    let F: [number, number] = [0, 1];
    if (s.shell >= 0) { const sh = g.shells[s.shell]; F = [sh.dx, sh.dy]; }
    else if (s.mode === 'delivery') { const t = town(s.rx, s.ry); F = [t[1], -t[0]]; } // rotated so +R faces town
    else if (s.mode === 'escape') {
      const t = town(s.rx, s.ry), sea = Math.atan2(-t[1], -t[0]);
      let bestD = Infinity, bestYaw = Math.PI / 2;
      for (let i = 0; i < 17; i++) {
        const off = (i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1)) * 15 * DEG, yaw = sea + off;
        const fx = Math.cos(yaw), fy = Math.sin(yaw), rx = fy, ry = -fx;
        for (let D = 2.5; D <= 10 && D < bestD; D += 0.25) {
          let clear = true;
          for (const dd of [D - 1.6, D, D + 1.6]) for (let a = -4.3; a <= 4.31 && clear; a += 0.72) {
            const x = s.rx + fx * dd + rx * a, y = s.ry + fy * dd + ry * a;
            if (g.land.onLand(x, y) || g.nearPier(x, y, 3.2)) clear = false;
          }
          if (clear) { bestD = D; bestYaw = yaw; break; }
        }
      }
      if (bestD === Infinity) { bestD = 6; bestYaw = Math.PI / 2; }
      F = [Math.cos(bestYaw), Math.sin(bestYaw)]; s.boatOut = bestD;
    }
    s.fx = F[0]; s.fy = F[1];
    const yaw = Math.atan2(F[1], F[0]) / DEG, R: [number, number] = [F[1], -F[0]];
    const at = (f: number, r: number): [number, number] => [s.rx + F[0] * f + R[0] * r, s.ry + F[1] * f + R[1] * r];
    switch (s.mode) {
      case 'shop': g.prop('ShopCounter', s.rx, s.ry, 0, yaw); break;
      case 'casino': g.prop('SlotMachine', s.rx, s.ry, 0, yaw); break;
      case 'job': g.prop('BurgerCounter', s.rx, s.ry, 0, yaw); break;
      case 'forger': g.prop('ForgerDesk', s.rx, s.ry, 0, yaw); break;
      case 'airport': g.prop('CheckInDesk', s.rx, s.ry, 0, yaw); break;
      case 'delivery': {
        const [vx, vy] = at(0, -0.4); g.prop('vehicle:van', vx, vy, 0, yaw, 1, false);
        g.collider(vx, vy, 1.1, 5.0, 2.07, 2.2, yaw);
        const [px, py] = at(-0.3, 1.4); g.prop('ParcelStack', px, py, 0, yaw); break;
      }
      case 'crossing': {
        const [bx, by] = at(0, -4.5); g.prop('GuardBooth', bx, by, 0, yaw);
        const [gx, gy] = at(0, -3.0); g.prop('BoomGate', gx, gy, 0, yaw); break;
      }
      case 'escape': { const [bx, by] = at(s.boatOut, 0); g.prop('Boat', bx, by, -0.15, yaw - 90); break; }
    }
  }
}
