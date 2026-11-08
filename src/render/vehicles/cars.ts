// Port of kit/reference/blender/veh_cars.py (sedan, taxi, van, pickup, hunter_jeep). Source frame, metres.
import { type Vec3 } from '../geo';
import { VB, extrudeBody, prism, slab, beam, tube, cyl, rotY, type RoleSpec } from './kit';

export const CAR_ROLES: Record<string, RoleSpec> = {
  Glass: ['2A3440', 0.15], Tyre: ['1C1C1C', 0.9], Rim: ['B8B8B8', 0.35], Trim: ['3A3A3A', 0.7],
  Headlight: ['F2E6B0', 0.3], Taillight: ['B3261E', 0.35],
};
const FAC = { uniform: '5B6B3A', vest: '4A5530', helmet: '56603C', patch: 'C9B46A' };
type XZ = [number, number];

export interface CarDef { vb: VB; r: number; tw: number; xf: number; xr: number; wy: number; rim: string }

function car(r: number, tw: number, xf: number, xr: number, wy: number, rim = CAR_ROLES.Rim[0]): CarDef {
  return { vb: new VB(CAR_ROLES, true), r, tw, xf, xr, wy, rim };
}

/** Lower body: sill at zb, round wheel arches of radius ra, `top` = profile from front-top to rear-top. */
function body(c: CarDef, top: XZ[], xf: number, xr: number, zb: number, half: number, ra: number, bevel = 0.05, n = 10) {
  const pts: XZ[] = [[xr + 0.1, zb]];
  const t0 = Math.asin(Math.max(-1, Math.min(1, (zb - c.r) / ra)));
  for (const ax of [c.xr, c.xf])
    for (let i = 0; i <= n; i++) { const a = Math.PI - t0 - (Math.PI - 2 * t0) * i / n; pts.push([ax + ra * Math.cos(a), c.r + ra * Math.sin(a)]); }
  pts.push([xf - 0.1, zb], [xf, zb + 0.1], ...top, [xr, zb + 0.1]);
  c.vb.add(extrudeBody(pts, half, bevel));
}

/** Dark-glass cabin + body-colour roof cap + A/(B)/C pillars. */
function greenhouse(c: CarDef, bf: XZ, tf: XZ, tr: XZ, br: XZ, wb: number, wt: number, xB?: number, apil = 0.07, cpil = 0.12) {
  const z0 = Math.min(bf[1], br[1]), zt = tf[1];
  c.vb.add(prism([bf, tf, tr, br], -wb, wb, [z0, zt, wb - wt]), 'Glass');
  c.vb.add(prism([[tf[0] + 0.03, zt - 0.03], [tf[0] - 0.03, zt + 0.05], [tr[0] + 0.03, zt + 0.05], [tr[0] - 0.04, zt - 0.03]],
    -(wt + 0.03), wt + 0.03));
  const y = (z: number) => wb - (wb - wt) * (z - z0) / (zt - z0);
  const tuck = (b: XZ, t: XZ): XZ => [b[0] + (t[0] - b[0]) * (t[1] - 0.045 - b[1]) / (t[1] - b[1]), t[1] - 0.045];
  const mid: XZ = [(bf[0] + br[0]) / 2, (z0 + zt) / 2];
  const sunk = (b: XZ, t: XZ, w: number): XZ[] => {
    const dx = t[0] - b[0], dz = t[1] - b[1], l = Math.hypot(dx, dz);
    let nx = -dz / l, nz = dx / l;
    if (nx * (mid[0] - b[0]) + nz * (mid[1] - b[1]) <= 0) { nx = -nx; nz = -nz; }
    const k = w / 2 - 0.012;
    return [b, tuck(b, t)].map((q) => [q[0] + nx * k, q[1] + nz * k] as XZ);
  };
  for (const sy of [1, -1]) {
    const p = (q: XZ, t: number): Vec3 => [q[0], sy * (y(q[1]) - t / 2 + 0.012), q[1]];
    for (const [b, t, w] of [[bf, tf, apil], [br, tr, cpil]] as [XZ, XZ, number][]) {
      const [lo, hi] = sunk(b, t, w);
      c.vb.add(beam(p(lo, w), p(hi, w), w));
    }
    if (xB !== undefined) {
      const zB = bf[1] + (br[1] - bf[1]) * (xB - bf[0]) / (br[0] - bf[0]);
      c.vb.add(beam(p([xB, zB], 0.09), p([xB, zt - 0.045], 0.09), 0.09));
    }
  }
}

function seams(c: CarDef, half: number, xs: number[], z0: number, z1: number, handles: number[] = [], hz = 0) {
  for (const x of xs) c.vb.pair([x, half, (z0 + z1) / 2], [0.014, 0.012, z1 - z0], 'Trim');
  for (const x of handles) c.vb.pair([x, half + 0.008, hz], [0.13, 0.02, 0.035], 'Trim');
}

export function sedan(taxi = false): CarDef {
  const W = 0.87, c = car(0.32, 0.22, 1.38, -1.32, 0.74), v = c.vb;
  body(c, [[2.25, 0.70], [2.12, 0.80], [0.98, 0.90], [-1.62, 0.95], [-2.18, 0.97], [-2.25, 0.88]], 2.25, -2.25, 0.24, W, 0.37);
  greenhouse(c, [0.98, 0.88], [0.15, 1.40], [-0.95, 1.40], [-1.62, 0.93], 0.81, 0.65, -0.3, 0.07, 0.12);
  v.box([2.22, 0, 0.36], [0.16, 1.78, 0.18], 'Trim', 0.04);
  v.box([-2.22, 0, 0.38], [0.16, 1.78, 0.20], 'Trim', 0.04);
  v.box([2.245, 0, 0.53], [0.03, 0.66, 0.13], 'Trim');
  v.pair([2.24, 0.6, 0.62], [0.04, 0.34, 0.10], 'Headlight');
  v.pair([-2.24, 0.6, 0.78], [0.04, 0.36, 0.12], 'Taillight');
  v.pair([0.86, 0.86, 0.94], [0.12, 0.10, 0.09], 'Paint', 0.02);
  seams(c, W, [0.99, -0.27, -0.93], 0.32, 0.88, [-0.12, -0.78], 0.8);
  // cockpit hint visible through the glass: dash + steering wheel on the driver (left) side
  v.box([0.78, 0, 0.92], [0.3, 1.6, 0.1], 'Trim');
  v.add(cyl([0, 0, 0], 0.17, 0.03, 'Z', 14).applyMatrix4(rotY(-60).setPosition(0.52, 0.38, 0.86)), 'Trim');
  if (taxi) {
    v.box([-0.4, 0, 1.465], [0.18, 0.5, 0.04], 'Trim');
    v.box([-0.4, 0, 1.55], [0.22, 0.62, 0.14], ['F2C318', 0.4], 0.03);
  }
  return c;
}

export function van(): CarDef {
  const W = 0.96, c = car(0.34, 0.24, 1.65, -1.55, 0.81), v = c.vb;
  v.seeThrough = false;
  body(c, [[2.45, 0.92], [2.36, 1.10], [1.95, 1.20], [1.22, 2.12], [1.12, 2.20], [-2.38, 2.20], [-2.45, 2.12]], 2.45, -2.45, 0.30, W, 0.39, 0.06);
  v.add(prism(slab([1.95, 1.20], [1.22, 2.12], [0, 1.2]), -0.84, 0.84), 'Glass');
  const win: XZ[] = [[1.75, 1.32], [1.21, 2.0], [0.72, 2.0], [0.72, 1.32]];
  v.add(prism(win, W - 0.01, W + 0.012), 'Glass');
  v.add(prism(win, -(W + 0.012), -(W - 0.01)), 'Glass');
  v.pair([-2.46, 0.42, 1.72], [0.03, 0.66, 0.5], 'Glass', 0.01);
  v.box([-2.455, 0, 1.25], [0.02, 0.02, 1.7], 'Trim');
  v.box([2.42, 0, 0.42], [0.16, 1.96, 0.20], 'Trim', 0.04);
  v.box([-2.42, 0, 0.42], [0.16, 1.96, 0.20], 'Trim', 0.04);
  v.box([2.45, 0, 0.62], [0.03, 0.9, 0.2], 'Trim');
  v.pair([2.44, 0.68, 0.80], [0.04, 0.34, 0.12], 'Headlight');
  v.pair([-2.46, 0.86, 0.9], [0.04, 0.12, 0.44], 'Taillight');
  v.pair([1.84, 0.98, 1.36], [0.04, 0.08, 0.03], 'Trim');
  v.pair([1.84, 1.0, 1.45], [0.07, 0.07, 0.24], 'Trim', 0.015);
  seams(c, W, [1.24], 0.36, 1.22);
  seams(c, W, [0.62], 0.36, 2.0, [0.78], 1.15);
  v.box([-0.78, -W, 1.18], [0.014, 0.012, 1.64], 'Trim');
  v.box([-0.08, -W, 2.0], [1.4, 0.012, 0.014], 'Trim');
  v.box([-1.55, -W - 0.005, 1.3], [1.5, 0.02, 0.03], 'Trim');
  v.box([-0.62, -W - 0.008, 1.15], [0.13, 0.02, 0.035], 'Trim');
  return c;
}

export function pickup(): CarDef {
  const W = 0.92, c = car(0.38, 0.26, 1.75, -1.45, 0.75), v = c.vb;
  body(c, [[2.6, 1.02], [2.5, 1.14], [1.2, 1.22], [-0.35, 1.22], [-0.35, 0.92], [-2.6, 0.92]], 2.6, -2.6, 0.36, W, 0.43, 0.04);
  greenhouse(c, [1.25, 1.17], [0.45, 1.77], [-0.2, 1.77], [-0.3, 1.17], 0.86, 0.72, undefined, 0.07, 0.12);
  v.box([-1.43, 0, 0.93], [2.14, 1.68, 0.03], 'Trim');
  v.pair([-1.43, 0.88, 1.05], [2.14, 0.08, 0.34], 'Paint', 0.02);
  v.pair([-1.43, 0.88, 1.225], [2.14, 0.10, 0.025], 'Trim');
  v.box([-2.555, 0, 1.06], [0.08, 1.84, 0.34], 'Paint', 0.02);
  v.box([-2.6, 0, 1.15], [0.02, 0.3, 0.05], 'Trim');
  v.box([2.57, 0, 0.5], [0.16, 1.86, 0.22], 'Trim', 0.04);
  v.box([-2.57, 0, 0.5], [0.16, 1.86, 0.20], 'Trim', 0.04);
  v.box([2.6, 0, 0.78], [0.03, 0.86, 0.26], 'Trim');
  v.pair([2.6, 0.64, 0.92], [0.04, 0.34, 0.12], 'Headlight');
  v.pair([-2.6, 0.86, 1.02], [0.03, 0.1, 0.28], 'Taillight');
  v.pair([1.12, 0.885, 1.25], [0.06, 0.07, 0.10], 'Trim');
  v.pair([1.12, 0.94, 1.31], [0.12, 0.08, 0.14], 'Trim', 0.02);
  seams(c, W, [1.27, -0.25], 0.37, 1.21, [-0.1], 1.1);
  v.box([1.1, 0, 1.24], [0.3, 1.6, 0.08], 'Trim');
  return c;
}

export function hunterJeep(): CarDef {
  const W = 0.95, c = car(0.40, 0.30, 1.4, -1.2, 0.78, FAC.helmet), v = c.vb;
  const canvas: RoleSpec = [FAC.vest, 0.9], patch: RoleSpec = [FAC.patch, 0.5];
  body(c, [[2.08, 1.12], [2.02, 1.2], [0.9, 1.22], [0.9, 0.98], [-1.72, 0.98], [-1.72, 1.22], [-1.88, 1.22]], 2.08, -1.88, 0.42, W, 0.46, 0.035);
  v.pair([-0.41, 0.91, 1.09], [2.62, 0.08, 0.30], 'Paint', 0.02);
  v.pair([0.35, 0.953, 1.09], [0.2, 0.012, 0.14], patch);
  seams(c, W, [0.86, -0.12, -0.7], 0.46, 1.22, [0.02, -0.56], 1.12);
  v.pair([-0.95, 0.42, 1.05], [0.46, 0.46, 0.14], 'Trim', 0.02);
  v.pair([-1.22, 0.42, 1.3], [0.1, 0.46, 0.5], 'Trim', 0.02);
  v.add(cyl([-1.8, 0, 1.31], 0.09, 1.72, 'Y', 10), canvas);
  v.add(prism(slab([0.9, 1.22], [0.8, 1.68], [0, 1.4]), -0.84, 0.84), 'Glass');
  for (const sy of [1, -1]) v.add(beam([0.9, sy * 0.89, 1.2], [0.8, sy * 0.89, 1.72], 0.07));
  v.add(beam([0.8, 0.92, 1.70], [0.8, -0.92, 1.70], 0.07));
  v.add(beam([0.9, 0, 1.22], [0.8, 0, 1.69], 0.05));
  for (const sy of [1, -1]) {
    for (const x of [-0.17, -1.55]) v.add(tube([x, sy * 0.86, 1.2], [x, sy * 0.86, 1.78], 0.035), 'Trim');
    v.add(tube([0.8, sy * 0.86, 1.70], [-0.17, sy * 0.86, 1.78], 0.03), 'Trim');
    v.add(tube([-0.17, sy * 0.86, 1.78], [-1.55, sy * 0.86, 1.78], 0.03), 'Trim');
  }
  for (const x of [-0.17, -1.55]) v.add(tube([x, 0.86, 1.78], [x, -0.86, 1.78], 0.035), 'Trim');
  v.add(cyl([-0.12, 0.55, 1.86], 0.06, 0.14, 'X', 10), 'Trim');
  v.add(cyl([-0.045, 0.55, 1.86], 0.05, 0.02, 'X', 10), 'Headlight');
  v.box([0.82, 0, 1.12], [0.16, 1.7, 0.2], 'Trim');
  v.add(beam([0.75, 0.42, 1.18], [0.6, 0.42, 1.3], 0.04), 'Trim');
  v.add(cyl([0, 0, 0], 0.17, 0.03, 'Z', 12).applyMatrix4(rotY(-60).setPosition(0.6, 0.42, 1.3)), 'Trim');
  v.pair([0.2, 0.42, 1.05], [0.46, 0.46, 0.14], 'Trim', 0.02);
  v.pair([-0.05, 0.42, 1.3], [0.1, 0.46, 0.5], 'Trim', 0.02);
  v.box([2.083, 0, 0.9], [0.02, 0.86, 0.3], 'Trim');
  for (const z of [0.81, 0.9, 0.99]) v.box([2.095, 0, z], [0.03, 0.86, 0.035]);
  for (const sy of [1, -1]) {
    v.box([2.085, sy * 0.68, 0.96], [0.03, 0.22, 0.18], 'Trim');
    v.box([2.1, sy * 0.68, 0.96], [0.02, 0.16, 0.12], 'Headlight');
    v.add(tube([2.17, sy * 0.45, 0.62], [2.17, sy * 0.45, 1.1], 0.03), 'Trim');
  }
  v.add(tube([2.17, 0.45, 1.1], [2.17, -0.45, 1.1], 0.03), 'Trim');
  v.box([2.1, 0, 0.56], [0.12, 1.92, 0.22], 'Trim', 0.03);
  v.box([-1.88, 0, 0.56], [0.12, 1.9, 0.2], 'Trim', 0.03);
  v.pair([-1.89, 0.8, 0.82], [0.03, 0.14, 0.12], 'Taillight');
  v.box([-1.91, 0, 1.08], [0.06, 0.24, 0.24], 'Trim');
  v.add(cyl([-2.06, 0, 1.08], 0.4, 0.28, 'X', 20), 'Tyre');
  v.add(cyl([-2.06, 0, 1.08], 0.24, 0.30, 'X', 12), [c.rim, 0.35]);
  v.add(cyl([-2.06, 0, 1.08], 0.08, 0.33, 'X', 8), 'Trim');
  v.pair([0.86, 0.94, 1.32], [0.05, 0.09, 0.025], 'Trim');
  v.pair([0.84, 0.99, 1.32], [0.05, 0.07, 0.12], 'Trim');
  return c;
}
