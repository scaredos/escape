// Build steps 1-7 + 9 of spec 01 §5: spots, insets (ground, sand, piers, roads, buildings, parks), filler, sea,
// highways, zones (airport, villages, mesas), shells, building blocks, kerbs.
import { hashStr } from '../../core/rng';
import { DEG, obb, obbAabb, obbGap, obbInside, segDist } from '../geom';
import { Gen, STYLE, type Fp } from './ctx';
import { buildShell } from './interiors';

const PLASTER = ['F2EFE6', 'E8DCC0', 'D9C7A3', 'EDE8DA', 'D6D6D2', 'EBD3C8', 'EFE3B0', 'F5F1EA'];
const LIMESTONE = ['CFC1A0', 'C9B48A', 'D8C9A6', 'BFAE8C'];
import { hexLin } from '../geom';
import { Rng } from '../../core/rng';
export const baseId = (id: string) => id.replace(/_\d+$/, '');
export function facadeTint(base: string, stone: boolean): [number, number, number] {
  const h = hashStr(base);
  return hexLin(stone ? LIMESTONE[h % 4] : PLASTER[h % 8]);
}

export function buildCity(g: Gen) {
  const W = g.pack.world;
  // ---- 1. spots, highway drive roads
  for (const s of W.spots) {
    const id = g.spots.length;
    g.spots.push({ ...s, rx: s.x, ry: s.y, fx: 0, fy: 1, boatOut: 6, shell: -1 });
    g.spotGrid.insert(id, s.x, s.y, s.x, s.y);
  }
  for (const h of W.highways) g.driveRoads.push({ pts: h.pts.flat(), halfWidth: 9, highway: true, inset: -1 });

  // ---- 2. insets
  const stoneOf = new Map<string, boolean>();
  for (let ii = 0; ii < g.pack.insets.length; ii++) {
    const ins = g.pack.insets[ii], [ox, oy] = ins.offset, name = ins.name;
    const st = { buildings: 0, road_segments: 0, land_boxes: 0, parks: 0, walk_points: 0 };
    // piers first (sand quay test needs them)
    for (const p of ins.piers) {
      const pts: number[] = []; for (let k = 0; k < p.length; k += 2) pts.push(ox + p[k] / 10, oy + p[k + 1] / 10);
      g.piers.push({ inset: ii, pts });
    }
    // ground + sand
    const groundKey = name === 'jerusalem' ? 'jstone' : 'lot';
    const rows = g.land.rows[ii];
    if (!rows) { g.box(groundKey, ox + 1000, oy + 1000, -0.5, 2000, 2000, 1); st.land_boxes++; }
    else {
      let prevKey = '', runStart = 0;
      const flushCol = (r: number) => {
        if (!prevKey) return;
        const a = rows[runStart], y0 = oy + runStart * 10, y1 = oy + r * 10;
        for (let k = 0; k < a.length; k += 2) g.collider(ox + (a[k] + a[k + 1]) / 2, (y0 + y1) / 2, -0.5, a[k + 1] - a[k], y1 - y0, 1, 0);
      };
      for (let r = 0; r < rows.length; r++) {
        const a = rows[r], key = Array.from(a).join(',');
        if (key !== prevKey) { flushCol(r); prevKey = key; runStart = r; }
        const cy = oy + r * 10 + 5;
        for (let k = 0; k < a.length; k += 2) {
          let x0 = a[k], x1 = a[k + 1]; st.land_boxes++;
          const quay = (lx: number) => { const wx = ox + lx; return g.nearPier(wx, cy, 25) && g.harbourCount(wx, cy, 150) >= 4; };
          let sw = 0, se = 0;
          if (x0 > 0.5 && !quay(x0)) sw = Math.min(30, x1 - x0);
          if (x1 < 1999.5 && !quay(x1)) se = Math.min(30, x1 - x0 - sw);
          if (sw > 0) g.box('sand', ox + x0 + sw / 2, cy, -0.5, sw, 10, 1, 0, { collide: false });
          if (se > 0) g.box('sand', ox + x1 - se / 2, cy, -0.5, se, 10, 1, 0, { collide: false });
          const m0 = x0 + sw, m1 = x1 - se;
          if (m1 - m0 > 0.01) g.box(groundKey, ox + (m0 + m1) / 2, cy, -0.5, m1 - m0, 10, 1, 0, { collide: false });
        }
      }
      flushCol(rows.length);
    }
    // piers (§7)
    for (const p of g.piers.filter((q) => q.inset === ii)) buildPier(g, p.pts);
    // roads (§8)
    let off = 0;
    for (let w = 0; w < ins.r_ids.length; w++) {
      const style = g.pack.styles[ins.r_type[w]], S = STYLE[style], n = ins.r_len[w];
      const pts: number[] = [];
      for (let k = 0; k < n; k++) pts.push(ox + ins.r_pts[off + k * 2] / 10, oy + ins.r_pts[off + k * 2 + 1] / 10);
      off += n * 2;
      if (!S) continue;
      const wayIdx = g.ways.length; g.ways.push({ id: ins.r_ids[w], style, pts, inset: ii });
      const asphalt = !S.paved, hw = S.w / 2;
      let drive: number[] | null = null;
      const endDrive = () => { if (drive && drive.length >= 4) g.driveRoads.push({ pts: drive, halfWidth: hw, highway: false, inset: ii }); drive = null; };
      for (let k = 0; k + 1 < n; k++) {
        const ax = pts[k * 2], ay = pts[k * 2 + 1], bx = pts[k * 2 + 2], by = pts[k * 2 + 3];
        const onA = g.land.onLand(ax, ay), onB = g.land.onLand(bx, by);
        if (asphalt && S.w >= 5.5) {
          if (onA || onB) { if (!drive) drive = [ax, ay]; drive.push(bx, by); } else endDrive();
        }
        if (!onA && !onB) continue;
        const len = Math.hypot(bx - ax, by - ay); if (len < 0.01) continue;
        const yaw = Math.atan2(by - ay, bx - ax) / DEG, cx = (ax + bx) / 2, cy = (ay + by) / 2;
        st.road_segments++;
        if (asphalt) g.box('asphalt', cx, cy, 0.01, len + hw, S.w, 0.06, yaw);
        else g.box('paving', cx, cy, 0, len + hw, S.w, 0.06, yaw);
        g.addSeg({ ax, ay, bx, by, hw, style, rank: S.rank, asphalt, paved: S.paved, way: wayIdx, highway: false });
        g.mapRoads.push(ax, ay, bx, by);
        if (S.side && len > 0.5) {
          const sw = S.w + 6;
          g.box('paving', cx, cy, -0.01, len + sw / 2, sw, 0.06, yaw);
          kerbRuns.push([ax, ay, bx, by, hw + 0.125]);
        }
        if (asphalt && S.w >= 7 && len > 6) {
          const ux = (bx - ax) / len, uy = (by - ay) / len;
          for (let t = 3; t + 3 < len; t += 9) g.box('flat_ns', ax + ux * (t + 1.5), ay + uy * (t + 1.5), 0.045, 3, 0.15, 0.01, yaw, { color: 'E8E2C8', extra: 0.7 });
        }
      }
      endDrive();
      // road vertices (§8)
      for (let k = 0; k < n; k++) {
        const x = pts[k * 2], y = pts[k * 2 + 1], lx = x - ox, ly = y - oy;
        if (lx > 30 && lx < 1970 && ly > 30 && ly < 1970 && g.land.landAt(x, y, 6)) g.roadVerts.push(x, y);
      }
    }
    // buildings (§12)
    for (let k = 0; k < ins.b_ids.length; k++) {
      const id = ins.b_ids[k], b = ins.b, o = k * 6, base = baseId(id);
      const cx = ox + b[o] / 100, cy = oy + b[o + 1] / 100, Wd = b[o + 2] / 100, Ln = b[o + 3] / 100, yaw = b[o + 4] / 100;
      const lv = Math.max(1, Math.min(40, b[o + 5]));
      let stone = stoneOf.get(base);
      if (stone === undefined) {
        const lx = cx - ox, ly = cy - oy;
        stone = name === 'jerusalem' || (name === 'telaviv' && lx < 1100 && ly < 1250) || new Rng(hashStr(base) ^ 0x57043).frand() < 0.15;
        stoneOf.set(base, stone);
      }
      g.addFootprint({ id, base, inset: ii, cx, cy, L: Ln, W: Wd, yaw, lv, H: lv * 3.2, stone, tint: facadeTint(base, stone) });
      st.buildings++;
    }
    for (const [id, x, y, area] of ins.parks) { g.parks.push({ id, x: ox + x / 10, y: oy + y / 10, area, side: 0 }); st.parks++; }
    for (const [x, y] of ins.kiosks) g.kiosks.push([ox + x / 10, oy + y / 10]);
    g.stats.insets[name] = st;
  }

  // ---- 3. filler ground (§9)
  buildFiller(g);
  // ---- 4. sea: seabed (render water plane is added by the renderer from bounds), edge walls
  const [bx0, by0, bx1, by1] = g.land.bounds;
  g.box('seabed', (bx0 + bx1) / 2, (by0 + by1) / 2, -1.2, bx1 - bx0 + 800, by1 - by0 + 800, 1);
  for (const [cx, cy, Lx, Wy] of [[bx0 - 5, (by0 + by1) / 2, 10, by1 - by0 + 20], [bx1 + 5, (by0 + by1) / 2, 10, by1 - by0 + 20],
    [(bx0 + bx1) / 2, by0 - 5, bx1 - bx0 + 20, 10], [(bx0 + bx1) / 2, by1 + 5, bx1 - bx0 + 20, 10]]) g.collider(cx, cy, 30, Lx, Wy, 60, 0);
  // ---- 5. highways (§10)
  buildHighways(g);
  // road vertices: highway lane points appended after the inset loop
  g.roadVerts.push(...g.laneVerts);
  // ---- 6. zones (§11)
  buildZones(g);
  // ---- 7. shells, keep-clear, blocks
  buildShells(g);
  let blocks = 0;
  for (const f of g.fps) if (f.alive && !f.shell) {
    g.box('facade', f.cx, f.cy, f.H / 2, f.L, f.W, f.H, f.yaw, { color: f.tint, extra: f.stone ? 1 : 0 });
    blocks++;
  }
  g.stats.buildings = g.fps.filter((f) => f.alive).length;
  g.stats.building_overlaps = countOverlaps(g);
  // ---- 9. kerbs
  buildKerbs(g);
  g.stats.road_boxes = (g.boxes.get('asphalt')?.length ?? 0) / 13 + (g.boxes.get('paving')?.length ?? 0) / 13;
  g.stats.ground_boxes = ['lot', 'jstone', 'sand', 'fields', 'beige', 'desert', 'village'].reduce((a, k) => a + (g.boxes.get(k)?.length ?? 0) / 13, 0);
}

const kerbRuns: [number, number, number, number, number][] = [];

function buildPier(g: Gen, pts: number[]) {
  const n = pts.length / 2;
  const closed = n > 3 && Math.hypot(pts[0] - pts[n * 2 - 2], pts[1] - pts[n * 2 - 1]) < 0.5;
  if (!closed) {
    for (let k = 0; k + 1 < n; k++) {
      const ax = pts[k * 2], ay = pts[k * 2 + 1], bx = pts[k * 2 + 2], by = pts[k * 2 + 3], len = Math.hypot(bx - ax, by - ay);
      if (len < 0.01) continue;
      g.box('pier', (ax + bx) / 2, (ay + by) / 2, -0.55, len + 6, 6, 1.9, Math.atan2(by - ay, bx - ax) / DEG);
    }
    return;
  }
  let y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < n; k++) { y0 = Math.min(y0, pts[k * 2 + 1]); y1 = Math.max(y1, pts[k * 2 + 1]); }
  for (let y = y0 + 2; y < y1; y += 4) {
    const xs: number[] = [];
    for (let k = 0; k + 1 < n; k++) {
      const ay = pts[k * 2 + 1], by = pts[k * 2 + 3];
      if ((ay > y) !== (by > y)) xs.push(pts[k * 2] + ((y - ay) / (by - ay)) * (pts[k * 2 + 2] - pts[k * 2]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = xs[k] - 3, b = xs[k + 1] + 3;
      g.box('pier', (a + b) / 2, y, -0.55, b - a, 4, 1.9, 0);
    }
  }
}

function fillerLayer(g: Gen, x: number, y: number): string {
  for (const z of g.pack.world.zones) {
    const [x0, y0, x1, y1] = z.rect;
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
      if (z.kind === 'desert') return 'desert'; if (z.kind === 'fields') return 'fields'; if (z.kind === 'village') return 'village';
    }
  }
  return y > 2000 ? 'fields' : y < -4000 ? 'desert' : 'beige';
}
export { fillerLayer };

function buildFiller(g: Gen) {
  const [xmin, ymin, xmax, ymax] = g.land.bounds;
  const cuts = new Set<number>();
  for (let y = ymin; y <= ymax; y += 50) cuts.add(y);
  for (let i = 0; i < g.land.oy.length; i++) { cuts.add(g.land.oy[i]); cuts.add(g.land.oy[i] + 2000); }
  for (const z of g.pack.world.zones) { cuts.add(z.rect[1]); cuts.add(z.rect[3]); }
  const ys = [...cuts].filter((y) => y >= ymin && y <= ymax).sort((a, b) => a - b);
  for (let k = 0; k + 1 < ys.length; k++) {
    const ya = ys[k], yb = ys[k + 1]; if (yb - ya < 0.5) continue;
    const y = (ya + yb) / 2;
    let spans = [Math.max(g.land.coastX(y), xmin), xmax];
    for (let i = 0; i < g.land.ox.length; i++) {
      const ox = g.land.ox[i], oy = g.land.oy[i]; if (y < oy || y >= oy + 2000) continue;
      const out: number[] = [];
      for (let s = 0; s < spans.length; s += 2) {
        const a = spans[s], b = spans[s + 1];
        if (b <= ox || a >= ox + 2000) { out.push(a, b); continue; }
        if (a < ox) out.push(a, ox); if (b > ox + 2000) out.push(ox + 2000, b);
      }
      spans = out;
    }
    const xs = new Set<number>();
    for (const z of g.pack.world.zones) if (y >= z.rect[1] && y <= z.rect[3]) { xs.add(z.rect[0]); xs.add(z.rect[2]); }
    for (let s = 0; s < spans.length; s += 2) {
      const pts = [spans[s], ...[...xs].filter((x) => x > spans[s] && x < spans[s + 1]).sort((a, b) => a - b), spans[s + 1]];
      for (let p = 0; p + 1 < pts.length; p++) {
        const a = pts[p], b = pts[p + 1]; if (b - a < 0.5) continue;
        g.box(fillerLayer(g, (a + b) / 2, y), (a + b) / 2, y, -0.5, b - a, yb - ya, 1);
      }
    }
  }
}

function buildHighways(g: Gen) {
  for (const h of g.pack.world.highways) {
    const p = h.pts;
    g.highwayEnds.push(p[0][0], p[0][1], p[p.length - 1][0], p[p.length - 1][1]);
    let cum = 0, nextLane = 0;
    for (let k = 1; k < p.length; k++) {
      const [ax, ay] = p[k - 1], [bx, by] = p[k], len = Math.hypot(bx - ax, by - ay);
      if (len < 0.1) continue;
      const fx = (bx - ax) / len, fy = (by - ay) / len, rx = fy, ry = -fx, yaw = Math.atan2(fy, fx) / DEG, cx = (ax + bx) / 2, cy = (ay + by) / 2;
      g.box('asphalt', cx, cy, 0.01, len + 9, 18, 0.06, yaw);
      g.box('flat_c', cx, cy, 0.4, len, 0.6, 0.8, yaw, { color: 'B5B0A6', extra: 0.9 });
      for (const s of [-8.3, 8.3]) g.box('flat_ns', cx + rx * s, cy + ry * s, 0.045, len, 0.2, 0.01, yaw, { color: 'E8E2C8', extra: 0.7 });
      for (let t = 2; t + 4 < len; t += 12) for (const s of [-4.5, 4.5])
        g.box('flat_ns', ax + fx * (t + 2) + rx * s, ay + fy * (t + 2) + ry * s, 0.045, 4, 0.15, 0.01, yaw, { color: 'E8E2C8', extra: 0.7 });
      while (nextLane <= cum + len) {
        const t = nextLane - cum; g.laneVerts.push(ax + fx * t + rx * 4.5, ay + fy * t + ry * 4.5); nextLane += 60;
      }
      cum += len;
      g.addSeg({ ax, ay, bx, by, hw: 9, style: 'highway', rank: 0, asphalt: true, paved: false, way: -1, highway: true });
      g.mapRoads.push(ax, ay, bx, by);
    }
  }
  g.stats.highways = g.pack.world.highways.length;
}

function buildZones(g: Gen) {
  for (const z of g.pack.world.zones) {
    const rng = new Rng(hashStr(z.name));
    const [x0, y0, x1, y1] = z.rect;
    if (z.kind === 'airport') buildAirport(g, z.name, z.rect);
    else if (z.kind === 'village') {
      const want = rng.int(5, 10); let n = 0;
      for (let t = 0; t < 80 && n < want; t++) {
        const x = rng.range(x0 + 8, x1 - 8), y = rng.range(y0 + 8, y1 - 8);
        const Lh = rng.range(9, 14), Wh = rng.range(7, 11), yaw = rng.range(0, 90), lv = rng.int(1, 2);
        if (g.highwayDist(x, y) < 20 || !g.land.landAt(x, y, 8)) continue;
        if (g.fpGrid.query(x - 20, y - 20, x + 20, y + 20, (id) => Math.hypot(g.fps[id].cx - x, g.fps[id].cy - y) < 18)) continue;
        n++;
        const id = `${z.name}_house${n}`;
        g.addFootprint({ id, base: id, inset: -1, cx: x, cy: y, L: Lh, W: Wh, yaw, lv, H: lv * 3.2, stone: true, tint: facadeTint(id, true), village: true });
      }
      const palms: number[] = [];
      for (let k = 0; k < 8; k++) palms.push(rng.range(x0, x1), rng.range(y0, y1));
      villagePalms.push(palms);
    } else if (z.kind === 'desert') {
      const ex = (x1 - x0) / 2, ey = (y1 - y0) / 2;
      const want = Math.max(3, Math.min(24, Math.round((ex * ey * 4) / 2e6)));
      let n = 0;
      for (let t = 0; t < want * 10 && n < want; t++) {
        const x = rng.range(x0, x1), y = rng.range(y0, y1);
        const H = rng.range(6, 25), Lm = rng.range(40, 160), Wm = rng.range(30, 110), yaw = rng.range(0, 180), capYaw = yaw + rng.range(-15, 15);
        if (g.highwayDist(x, y) < 250) continue;
        if (g.land.ox.some((ox, i) => x > ox - 150 && x < ox + 2150 && y > g.land.oy[i] - 150 && y < g.land.oy[i] + 2150)) continue;
        if (!g.land.landAt(x, y, 80)) continue;
        if (g.pack.world.zones.some((o) => o.kind !== 'desert' && x > o.rect[0] - 100 && x < o.rect[2] + 100 && y > o.rect[1] - 100 && y < o.rect[3] + 100)) continue;
        n++;
        g.box('mesa', x, y, (H - 1) / 2 - 0.5, Lm, Wm, H, yaw);
        g.box('mesa', x, y, 1.15 * H - 1, 0.6 * Lm, 0.55 * Wm, 0.3 * H, capYaw);
        g.addLandform(obb(x, y, Lm, Wm, yaw * DEG), false);
      }
    }
  }
}
export const villagePalms: number[][] = [];

function buildAirport(g: Gen, name: string, rect: number[]) {
  const spot = g.spots.find((s) => s.mode === 'airport');
  let Cx = spot ? spot.x : (rect[0] + rect[2]) / 2, Cy = spot ? spot.y : (rect[1] + rect[3]) / 2;
  const wide = rect[2] - rect[0] >= rect[3] - rect[1];
  const U = wide ? [1, 0] : [0, 1], V = wide ? [0, 1] : [-1, 0], yaw = wide ? 0 : 90;
  const side = g.highwayDist(Cx + V[0] * 150, Cy + V[1] * 150) > g.highwayDist(Cx - V[0] * 150, Cy - V[1] * 150) ? 1 : -1;
  for (let k = 0; k < 10 && g.highwayDist(Cx, Cy) < 40; k++) { Cx += side * 10 * V[0]; Cy += side * 10 * V[1]; }
  const id = 'airport_' + name;
  g.addFootprint({ id, base: id, inset: -1, cx: Cx, cy: Cy, L: 80, W: 30, yaw, lv: 2, H: 6.4, stone: false, tint: facadeTint(id, false) });
  if (spot) { spot.building = id; spot.rx = Cx; spot.ry = Cy; }
  const at = (a: number, v: number) => [Cx + U[0] * a + V[0] * v * side, Cy + U[1] * a + V[1] * v * side];
  let [px, py] = at(0, 80); g.box('apron', px, py, 0, 320, 110, 0.06, yaw);
  [px, py] = at(0, 165); g.box('asphalt', px, py, 0.01, 900, 45, 0.06, yaw);
  for (let a = -420; a <= 420; a += 50) { const [dx, dy] = at(a, 165); g.box('flat_ns', dx, dy, 0.045, 30, 0.9, 0.01, yaw, { color: 'F4F4F2', extra: 0.7 }); }
  { const [ax, ay] = at(-450, 165), [bx, by] = at(450, 165); g.mapRoads.push(ax, ay, bx, by); }
  const J = (a: number, v: number) => { const v2 = v + 85; return at(a, v2); };
  const part = (a: number, c: number, sa: number, sc: number, h: number, bottom: number, dark = false) => {
    const [x, y] = J(a, c); g.box('flat_c', x, y, bottom + h / 2, sa, sc, h, yaw, { color: dark ? '2A2A2A' : 'F4F4F2', extra: dark ? 0.6 : 0.4 });
  };
  part(0, 0, 40, 4.2, 4.2, 1.6); part(1, 0, 6.5, 36, 0.5, 2.4); part(-17.5, 0, 5, 0.4, 6.5, 5.8); part(-18, 0, 3, 12, 0.3, 5.2);
  part(15, 0, 0.6, 0.6, 1.6, 0, true); part(-1, 2.5, 0.6, 0.6, 2.4, 0, true); part(-1, -2.5, 0.6, 0.6, 2.4, 0, true);
}

function buildShells(g: Gen) {
  const byId = new Map<string, Fp[]>();
  for (const f of g.fps) { let a = byId.get(f.id); if (!a) byId.set(f.id, (a = [])); a.push(f); }
  const shellFps: { f: Fp; spotIdx: number }[] = [];
  g.spots.forEach((s, i) => {
    if (!s.building || s.building === '-' || s.mode === 'crate') return;
    const f = byId.get(s.building)?.[0]; if (!f) return;
    if (!f.shell) { f.shell = true; shellFps.push({ f, spotIdx: i }); }
  });
  let dropped = 0;
  const shellInfo: { f: Fp; spotIdx: number; D: [number, number] }[] = [];
  for (const { f, spotIdx } of shellFps) {
    const Ux = f.b.ux, Uy = f.b.uy, Vx = -Uy, Vy = Ux;
    // door facing: nearest road vertex not inside the box (1 m margin)
    let best = Infinity, tx = f.cx + Vx * 100, ty = f.cy + Vy * 100;
    for (let k = 0; k < g.roadVerts.length; k += 2) {
      const x = g.roadVerts[k], y = g.roadVerts[k + 1], d = Math.hypot(x - f.cx, y - f.cy);
      if (d < best && !obbInside(f.b, x, y, 1)) { best = d; tx = x; ty = y; }
    }
    const Tx = tx - f.cx, Ty = ty - f.cy;
    const du = (Tx * Ux + Ty * Uy) / f.b.hl, dv = (Tx * Vx + Ty * Vy) / f.b.hw;
    const D: [number, number] = Math.abs(du) > Math.abs(dv) ? [Math.sign(du) * Ux, Math.sign(du) * Uy] : [Math.sign(dv) * Vx, Math.sign(dv) * Vy];
    const half = Math.abs(du) > Math.abs(dv) ? f.b.hl : f.b.hw;
    g.addKeepClear(f.b);
    const ax = f.cx + D[0] * (half + 2.5), ay = f.cy + D[1] * (half + 2.5);
    g.addKeepClear(obb(ax, ay, 5, 6, Math.atan2(D[1], D[0])));
    shellInfo.push({ f, spotIdx, D });
  }
  for (const f of g.fps) {
    if (!f.alive || f.shell) continue;
    const a = obbAabb(f.b);
    if (g.keepGrid.query(a[0], a[1], a[2], a[3], (id) => obbGap(g.keepClear[id], f.b) < -0.3)) { f.alive = false; dropped++; }
  }
  g.stats.shells = shellInfo.length; g.stats.shell_overlaps_dropped = dropped;
  for (const s of shellInfo) {
    const spot = g.spots[s.spotIdx];
    for (const o of g.spots) if (o.building === spot.building) { o.rx = s.f.cx; o.ry = s.f.cy; }
    buildShell(g, s.f, s.spotIdx, s.D);
  }
  // Stash offset: +2.5 m north and east of its safehouse spot
  for (const o of g.spots) if (o.pistol) { o.rx += 2.5; o.ry += 2.5; }
  // re-grid spots after moves
  g.spotGrid = new (g.spotGrid.constructor as any)(50);
  g.spots.forEach((s, i) => g.spotGrid.insert(i, s.rx, s.ry, s.rx, s.ry));
}

function countOverlaps(g: Gen): number {
  let n = 0;
  g.fps.forEach((f, i) => {
    if (!f.alive) return;
    const a = obbAabb(f.b);
    g.fpGrid.query(a[0], a[1], a[2], a[3], (j) => {
      const o = g.fps[j];
      if (j > i && o.alive && o.base !== f.base && obbGap(f.b, o.b) < -0.3) n++;
    });
  });
  return n;
}

function buildKerbs(g: Gen) {
  let pieces = 0;
  for (const [ax, ay, bx, by, off] of kerbRuns) {
    const len = Math.hypot(bx - ax, by - ay); if (len < 0.5) continue;
    const fx = (bx - ax) / len, fy = (by - ay) / len, yaw = Math.atan2(fy, fx) / DEG;
    for (const side of [-1, 1]) {
      const ox = -fy * off * side, oy = fx * off * side;
      let start = -1;
      const n = Math.floor(len / 0.5);
      for (let k = 0; k <= n + 1; k++) {
        const t = k * 0.5, x = ax + fx * t + ox, y = ay + fy * t + oy;
        const free = k <= n && kerbFree(g, x, y);
        if (free && start < 0) start = t;
        if (!free && start >= 0) {
          const t1 = t - 0.5;
          if (t1 - start >= 0.5) {
            const m = (start + t1) / 2;
            g.box('flat_ns', ax + fx * m + ox, ay + fy * m + oy, 0.04, t1 - start, 0.25, 0.12, yaw, { color: 'BDBAB2', extra: 0.85 }); pieces++;
          }
          start = -1;
        }
      }
    }
  }
  kerbRuns.length = 0;
  g.stats.kerbs = pieces;
}
function kerbFree(g: Gen, x: number, y: number): boolean {
  if (g.segGrid.query(x - 1, y - 1, x + 1, y + 1, (id) => {
    const s = g.segs[id]; return s.asphalt && segDist(x, y, s.ax, s.ay, s.bx, s.by) < s.hw + 0.05;
  })) return false;
  return !g.inShell(x, y, 0.3);
}
