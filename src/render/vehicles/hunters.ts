// Port of kit/reference/blender/veh_hunter_tank.py and veh_heli.py. Source frame, metres. Generic, no insignia.
import * as THREE from 'three';
import { type Vec3 } from '../geo';
import { VB, cube, cyl, hull, loft, ellip, clip, tube, rotX, rotY, rotZ, type RoleSpec } from './kit';

// ---------------------------------------------------------------- tank
export const TANK = {
  XT: -0.1, ROOF: 1.70, TOP: 2.42, PIV: [1.2, 0, 2.08] as Vec3, FACE: 1.475, GUN: 5.0,
  WR: 0.40, WV: 0.31, TT: 0.09, WY: 1.42, TW: 0.60, WX: [0, 1, 2, 3, 4, 5].map((i) => 2.15 - i * 0.86),
  IDLER: [3.05, 0.62, 0.27], SPROCKET: [-3.10, 0.66, 0.31],
};
const TR: Record<string, RoleSpec> = {
  Dark: ['4A5530', 0.7], Detail: ['56603C', 0.7], Trim: ['3A3A3A', 0.6], Track: ['2E2E2E', 0.9], Tyre: ['1C1C1C', 0.9],
  Glass: ['2A3440', 0.2], Patch: ['C9B46A', 0.7], Headlight: ['F2E6B0', 0.3], Taillight: ['B3261E', 0.3],
};

/** Mirrored convex block (veh_hunter_tank.solid, no bevel). */
const solid = (pts: Vec3[]) => hull(pts.flatMap(([x, y, z]) => [[x, y, z], [x, -y, z]] as Vec3[]));

function hull2d(pts: [number, number][]): [number, number][] {
  const s = [...new Map(pts.map((p) => [p.join(','), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (seq: [number, number][]) => {
    const h: [number, number][] = [];
    for (const p of seq) {
      while (h.length >= 2 && (h[h.length - 1][0] - h[h.length - 2][0]) * (p[1] - h[h.length - 2][1])
        - (h[h.length - 1][1] - h[h.length - 2][1]) * (p[0] - h[h.length - 2][0]) <= 0) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  return [...half(s), ...half([...s].reverse())];
}

/** Closed track band around road wheels + idler + sprocket on side s (+1 left). */
function track(s: number): THREE.BufferGeometry {
  const { WX, WR, WV, IDLER, SPROCKET, TT, WY, TW } = TANK;
  const centre = new Map<string, [number, number]>();
  for (const [cx, cz, r] of [...WX.map((x) => [x, WR, WV]), IDLER, SPROCKET])
    for (let k = 0; k < 32; k++) {
      const a = 2 * Math.PI * k / 32, p: [number, number] = [+(cx + r * Math.cos(a)).toFixed(5), +(cz + r * Math.sin(a)).toFixed(5)];
      centre.set(p.join(','), [cx, cz]);
    }
  const inner = hull2d([...centre.keys()].map((k) => k.split(',').map(Number) as [number, number]));
  const outer = inner.map((p) => {
    const c = centre.get(p.join(','))!, dx = p[0] - c[0], dz = p[1] - c[1], l = Math.hypot(dx, dz);
    return [p[0] + dx / l * TT, p[1] + dz / l * TT] as [number, number];
  });
  const ys = [s * (WY - TW / 2), s * (WY + TW / 2)];
  const pos: number[] = [];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, hint: Vec3) => {
    const A = new THREE.Vector3(...a), n = new THREE.Vector3().subVectors(new THREE.Vector3(...b), A).cross(new THREE.Vector3(...c).sub(A));
    const ok = n.dot(new THREE.Vector3(...hint)) >= 0;
    for (const p of ok ? [a, b, c, a, c, d] : [a, c, b, a, d, c]) pos.push(...p);
  };
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, [ix, iz] = inner[i], [jx, jz] = inner[j], [ox, oz] = outer[i], [px, pz] = outer[j];
    const ex = jx - ix, ez = jz - iz, out: Vec3 = [ez, 0, -ex]; // CCW outline: outward = right of the direction
    quad([ox, ys[0], oz], [px, ys[0], pz], [px, ys[1], pz], [ox, ys[1], oz], out);
    quad([ix, ys[0], iz], [jx, ys[0], jz], [jx, ys[1], jz], [ix, ys[1], iz], [-out[0], 0, -out[2]]);
    quad([ix, ys[0], iz], [jx, ys[0], jz], [px, ys[0], pz], [ox, ys[0], oz], [0, -s, 0]);
    quad([ix, ys[1], iz], [jx, ys[1], jz], [px, ys[1], pz], [ox, ys[1], oz], [0, s, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export function tank(): VB {
  const { XT, ROOF, TOP, PIV, FACE, GUN, WX, WY, IDLER, SPROCKET } = TANK;
  const v = new VB(TR, false, 0.7);
  v.part('turret', [XT, 0, ROOF], 'chassis').part('barrel', PIV, 'turret');
  // hull
  v.add(solid([[-3.55, 1.1, 0.45], [-3.62, 1.1, 1.12], [3.2, 1.1, 0.45], [3.78, 1.1, 1.12]]));
  v.add(solid([[-3.7, 1.75, 1.08], [-3.62, 1.75, ROOF], [2.45, 1.75, ROOF], [3.75, 1.75, 1.2], [3.75, 1.75, 1.08]]));
  v.add(cyl([XT, 0, ROOF + 0.02], 1.15, 0.08, 'Z', 24), 'Dark');
  for (const y of [0.62, -0.62]) v.box([-2.75, y, ROOF + 0.02], [1.3, 1.0, 0.06], 'Trim');
  v.add(cyl([2.1, 0.4, ROOF + 0.03], 0.28, 0.07, 'Z', 12), 'Detail');
  v.box([2.42, 0.4, ROOF + 0.04], [0.1, 0.45, 0.08], 'Glass');
  v.box([-3.66, 0, 1.38], [0.06, 1.8, 0.24], 'Trim');
  v.box([3.72, 0, 0.98], [0.14, 1.7, 0.14], 'Trim', 0.02);
  for (const s of [1, -1]) {
    v.box([3.2, s * 1.45, 1.43], [0.16, 0.28, 0.16], 'Trim', 0.02);
    v.box([3.285, s * 1.45, 1.44], [0.03, 0.2, 0.1], 'Headlight');
    v.box([-3.68, s * 1.5, 1.55], [0.05, 0.2, 0.1], 'Taillight');
    for (let k = 0; k < 5; k++) v.box([-3.2 + k * 1.3 + 0.635, s * 1.77, 0.86], [1.27, 0.06, 0.6], 'Paint', 0.02);
    const y = s * WY;
    v.add(cyl([IDLER[0], y, IDLER[1]], IDLER[2], 0.42, 'Y', 18), 'Tyre');
    v.add(cyl([IDLER[0], y, IDLER[1]], 0.21, 0.48, 'Y', 12), 'Dark');
    v.add(cyl([SPROCKET[0], y, SPROCKET[1]], SPROCKET[2], 0.36, 'Y', 10), 'Trim');
    v.add(cyl([SPROCKET[0], y, SPROCKET[1]], 0.22, 0.46, 'Y', 10), 'Dark');
    v.add(cyl([SPROCKET[0], y, SPROCKET[1]], 0.10, 0.52, 'Y', 8), 'Trim');
    v.add(track(s), 'Track');
  }
  // turret
  const T = 'turret';
  v.add(solid([[XT + 1.55, 0.55, 1.72], [XT + 1.1, 1.6, 1.72], [XT - 2.1, 1.45, 1.72], [XT - 2.2, 1.15, 1.72],
    [XT + 1.05, 0.6, TOP], [XT + 0.7, 1.5, TOP], [XT - 2.0, 1.35, TOP], [XT - 2.15, 1.1, TOP]]), 'Paint', T);
  v.box([XT - 2.38, 0, 2.05], [0.4, 2.3, 0.42], 'Dark', 0.03, T);
  for (const s of [1, -1]) {
    v.box([XT - 1.3, s * 1.5, 2.05], [1.2, 0.22, 0.5], 'Detail', 0.03, T);
    v.add(cube([XT + 0.25, s * 1.525, 2.07], [0.3, 0.04, 0.2], 0, rotX(7 * s)), 'Patch', T);
    v.box([XT + 0.5, s * 1.3, TOP + 0.06], [0.3, 0.26, 0.12], 'Dark', 0.02, T);
    for (let k = 0; k < 3; k++) v.add(cyl([XT + 0.7, s * (1.2 + 0.1 * k), TOP + 0.07], 0.04, 0.16, 'X', 8), 'Trim', T);
  }
  v.add(cyl([XT - 0.55, -0.7, TOP + 0.05], 0.36, 0.1, 'Z', 14), 'Detail', T);
  v.add(cyl([XT - 0.55, -0.7, TOP + 0.12], 0.29, 0.05, 'Z', 14), 'Dark', T);
  v.add(cyl([XT - 0.55, 0.7, TOP + 0.03], 0.3, 0.06, 'Z', 12), 'Detail', T);
  v.box([XT + 0.55, -0.85, TOP + 0.1], [0.4, 0.32, 0.2], 'Detail', 0.02, T);
  v.box([XT + 0.76, -0.85, TOP + 0.12], [0.02, 0.24, 0.1], 'Glass', 0, T);
  v.add(cyl([XT + 0.1, -0.35, TOP + 0.05], 0.12, 0.1, 'Z', 10), 'Detail', T);
  v.box([XT + 0.1, -0.35, TOP + 0.15], [0.26, 0.24, 0.12], 'Detail', 0.02, T);
  v.box([XT + 0.24, -0.35, TOP + 0.15], [0.02, 0.18, 0.07], 'Glass', 0, T);
  const MG: Vec3 = [XT + 0.5, 0.7, TOP + 0.19];
  v.add(cyl([XT - 0.4, 0.7, TOP + 0.1], 0.03, 0.1, 'Z', 6), 'Trim', T);
  v.box([XT - 0.3, 0.7, MG[2] - 0.01], [0.42, 0.1, 0.1], 'Trim', 0, T);
  v.add(cyl([MG[0] - 0.3, 0.7, MG[2]], 0.025, 0.6, 'X', 8), 'Trim', T);
  v.box([XT - 0.3, 0.78, MG[2] - 0.04], [0.16, 0.08, 0.12], 'Dark', 0, T);
  // gun
  const B = 'barrel', z = PIV[2];
  v.box([PIV[0] + 0.05, 0, z], [0.45, 0.8, 0.56], 'Dark', 0.05, B);
  v.add(cyl([FACE + 0.6, 0, z], 0.15, 1.2, 'X'), 'Paint', B);
  v.add(cyl([FACE + 3.1, 0, z], 0.11, 3.8, 'X'), 'Paint', B);
  v.add(cyl([FACE + 2.4, 0, z], 0.16, 0.55, 'X'), 'Paint', B);
  v.add(cyl([FACE + GUN - 0.1, 0, z], 0.13, 0.2, 'X'), 'Dark', B);
  v.add(cyl([FACE + GUN, 0, z], 0.07, 0.01, 'X', 12), 'Tyre', B);
  return v;
}

/** One tank road wheel (centred, axle along source y). */
export function tankWheel() {
  const g = new VB(TR, false);
  g.add(cyl([0, 0, 0], TANK.WV, 0.46, 'Y', 20), 'Tyre').add(cyl([0, 0, 0], 0.26, 0.50, 'Y', 16), 'Dark').add(cyl([0, 0, 0], 0.10, 0.54, 'Y', 8), 'Trim');
  return g.parts.get('chassis')!.stat;
}

// ---------------------------------------------------------------- helicopter
export const HELI = { HUB: [0, 0, 4.2] as Vec3, R_MAIN: 7.0, TR_HUB: [-9.4, 0.44, 3.4] as Vec3, R_TAIL: 1.4 };
const HR: Record<string, RoleSpec> = {
  Accent: ['4A5530', 0.6], Glass: ['2A3440', 0.15], Trim: ['3A3A3A', 0.5], Patch: ['C9B46A', 0.7], Headlight: ['F2E6B0', 0.3],
};
const finX = (z: number) => { const t = (z - 2.15) / 1.95; return [-9.5 - 0.45 * t, -8.6 - 0.7 * t]; };

export function heli(): VB {
  const { HUB, TR_HUB } = HELI, GUN_X = 0.95, BENCH_X = -1.45;
  const v = new VB(HR, false, 0.6);
  v.part('main_rotor', HUB, 'chassis').part('tail_rotor', TR_HUB, 'chassis');
  v.box([0.375, 0, 0.86], [5.25, 2.4, 0.28], 'Paint', 0.08);
  v.box([2.175, 0, 1.71], [1.75, 2.4, 1.98], 'Paint', 0.1);
  v.box([-0.425, 0, 2.56], [3.65, 2.4, 0.28], 'Paint', 0.08);
  v.box([-2.175, 0, 1.71], [0.15, 2.4, 1.52], 'Paint', 0.03);
  v.box([-0.4, 0, 1.01], [3.4, 2.2, 0.04], 'Trim');
  for (const s of [1, -1]) {
    v.box([-2.0, s * 1.14, 1.71], [0.5, 0.12, 1.52], 'Paint', 0.03);
    v.box([-0.475, s * 1.225, 2.44], [3.55, 0.06, 0.07], 'Trim', 0.015);
    v.box([0.4, s * 1.215, 0.865], [5.2, 0.04, 0.17], 'Accent', 0.01);
    v.box([2.175, s * 1.21, 2.025], [1.35, 0.04, 0.85], 'Glass', 0.015);
    v.box([GUN_X, s * 0.7, 1.22], [0.45, 0.45, 0.4], 'Trim', 0.04);
    v.box([GUN_X, s * 0.47, 1.65], [0.45, 0.08, 0.5], 'Trim', 0.02);
    v.add(cyl([GUN_X, s * 1.05, 1.33], 0.045, 0.62, 'Z', 10), 'Trim');
    v.box([GUN_X, s * 1.16, 1.64], [0.1, 0.24, 0.07], 'Trim', 0.015);
  }
  v.box([BENCH_X, 0, 1.22], [0.55, 2.1, 0.4], 'Trim', 0.04);
  v.box([BENCH_X - 0.24, 0, 1.8], [0.1, 2.1, 0.75], 'Trim', 0.02);
  // nose + canopy (half ellipsoids, x >= 3)
  v.add(clip(ellip([3.0, 0, 1.35], [2.3, 1.18, 0.63], undefined, 24, 12), [3, 0, 0], [1, 0, 0]));
  v.add(clip(ellip([3.0, 0, 1.95], [1.85, 1.13, 0.75], undefined, 24, 12), [3, 0, 0], [1, 0, 0]), 'Glass');
  v.add(loft([-2.5, -2.5, 0.85, 2.62, 3.35], [2.1, 1.5, 0.8, 2.62, 3.3]));
  v.add(cyl([0, 0, 3.5], 0.34, 0.4, 'Z', 16));
  for (const s of [1, -1]) {
    v.box([1.75, s * 0.45, 3.0], [0.2, 0.55, 0.32], 'Trim', 0.03);
    v.add(tube([-1.6, s * 0.7, 3.05], [-2.2, s * 1.05, 3.2], 0.16, 12), 'Trim');
  }
  v.add(loft([-4.3, -4.3, 0.42, 1.95, 2.6], [-2.2, -2.2, 1.15, 0.8, 2.6]));
  v.add(loft([-5.2, -5.2, 0.3, 2.3, 2.62], [-2.4, -2.4, 0.8, 2.55, 3.3]));
  v.add(cyl([-6.65, 0, 2.25], 0.22, 5.3, 'X', 20, 0.38)); // boom x -4.0..-9.3, r .38 -> .22
  for (const [z0, z1, role] of [[2.15, 3.8, 'Paint'], [3.8, 4.1, 'Accent']] as [number, number, string][]) {
    const [b0, f0] = finX(z0), [b1, f1] = finX(z1);
    v.add(loft([b0, b1, 0.09, z0, z1], [f0, f1, 0.09, z0, z1]), role);
  }
  v.add(loft([-9.65, -9.5, 0.06, 1.75, 2.25], [-9.25, -8.9, 0.06, 1.75, 2.25]));
  v.box([-7.9, 0, 2.3], [0.6, 2.6, 0.08], 'Paint', 0.025);
  v.add(cyl([TR_HUB[0], 0.22, TR_HUB[2]], 0.14, 0.3, 'Y', 12), 'Trim');
  for (const s of [1, -1]) v.box([-6.2, s * 0.31, 2.27], [0.5, 0.05, 0.28], 'Patch');
  for (const s of [1, -1]) {
    v.box([0.3, s * 1.35, 0.06], [5.4, 0.14, 0.12], 'Trim', 0.035);
    const a = 35;
    v.add(cube([3.0 + 0.3 * Math.cos(a * Math.PI / 180), s * 1.35, 0.06 + 0.3 * Math.sin(a * Math.PI / 180)], [0.6, 0.14, 0.12], 0.035, rotY(-a)), 'Trim');
    for (const x of [2.0, -1.4]) v.add(tube([x, s * 1.35, 0.09], [x, s * 0.95, 0.76], 0.06), 'Trim');
  }
  v.box([4.1, 0, 0.72], [0.12, 0.12, 0.22], 'Trim', 0.02);
  v.add(cyl([4.1, 0, 0.5], 0.16, 0.32, 'X', 14), 'Trim');
  v.add(cyl([4.27, 0, 0.5], 0.13, 0.03, 'X', 14), 'Headlight');
  // main rotor (4 blades at 45 deg), tail rotor (blades in the XZ plane)
  const M = 'main_rotor';
  v.add(cyl([0, 0, 3.9], 0.12, 0.6, 'Z', 12), 'Trim', M);
  v.add(cyl([0, 0, 4.25], 0.38, 0.22, 'Z', 16), 'Trim', M);
  v.add(cyl([0, 0, 4.42], 0.18, 0.14, 'Z', 12), 'Trim', M);
  for (let k = 0; k < 4; k++) {
    const t = 45 + 90 * k, r = t * Math.PI / 180;
    v.add(cube([HUB[0] + Math.cos(r) * 3.62, HUB[1] + Math.sin(r) * 3.62, HUB[2] + 0.08], [6.76, 0.5, 0.07], 0.02, rotZ(t)), 'Trim', M);
  }
  const TRt = 'tail_rotor';
  v.add(cyl(TR_HUB, 0.1, 0.12, 'Y', 12), 'Trim', TRt);
  for (let k = 0; k < 4; k++) {
    const t = 45 + 90 * k, r = t * Math.PI / 180; // Blender Rotation(t, 'Y'): x -> (cos, 0, -sin)
    v.add(cube([TR_HUB[0] + 0.74 * Math.cos(r), TR_HUB[1], TR_HUB[2] - 0.74 * Math.sin(r)], [1.32, 0.03, 0.17], 0.01, rotY(t)), 'Trim', TRt);
  }
  return v;
}
