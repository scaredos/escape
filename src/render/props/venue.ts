// Gameplay set pieces, player/customer at +X (props.py crate .. parcel_stack).
import * as THREE from 'three';
import { Prop, V, box, cyl, bar, tube, sphere, lathe, torus, rot, T, mul, type Mesh } from './kit';

type R = [string, number];
const r = (hex: string, rough = 0.75): R => [hex, rough];

export function crate(P: Prop, lid = true) {
  const wood = r('B8894F', 0.85), frame = r('8C6239', 0.85), inside = r('4E3824', 0.95), H = 0.56;
  for (const s of [1, -1]) { P.add(box([s * 0.37, 0, H / 2], [0.03, 0.77, H]), ...inside); P.add(box([0, s * 0.37, H / 2], [0.71, 0.03, H]), ...inside); }
  P.add(box([0, 0, 0.03], [0.71, 0.71, 0.06]), ...inside);
  for (let k = 0; k < 3; k++) { const z = 0.1 + k * 0.18;
    for (const s of [1, -1]) { P.add(box([s * 0.395, 0, z], [0.02, 0.66, 0.165]), ...wood); P.add(box([0, s * 0.395, z], [0.66, 0.02, 0.165]), ...wood); } }
  for (const sx of [1, -1]) for (const sy of [1, -1]) P.add(box([sx * 0.365, sy * 0.365, H / 2], [0.1, 0.1, H]), ...frame);
  for (const s of [1, -1]) {
    for (const z of [0.035, H - 0.035]) { P.add(box([s * 0.405, 0, z], [0.025, 0.63, 0.07]), ...frame); P.add(box([0, s * 0.405, z], [0.63, 0.025, 0.07]), ...frame); }
    P.add(bar([-0.27, s * 0.405, 0.08], [0.27, s * 0.405, H - 0.08], 0.025, 0.07), ...frame);
    P.add(bar([s * 0.405, -0.27, 0.08], [s * 0.405, 0.27, H - 0.08], 0.025, 0.07), ...frame);
  }
  const m = lid ? T(0, 0, H + 0.0175) : mul(T(-0.4955, 0, 0.39), rot(-70, 'Y'));
  const rm = new THREE.Matrix4().extractRotation(m), at = (x: number, y: number, z: number) => V(x, y, z).applyMatrix4(m);
  for (let k = 0; k < 4; k++) P.add(box(at(0, -0.3075 + k * 0.205, 0), [0.83, 0.195, 0.035], rm), ...wood);
  for (const x of [-0.3, 0.3]) P.add(box(at(x, 0, 0.03), [0.08, 0.81, 0.025], rm), ...frame);
  const h = H + (lid ? 0.065 : 0);
  P.collide([0, 0, h / 2], [0.83, 0.83, h]);
}

export function cashBag(P: Prop) {
  const canvas = r('3E6B3A', 0.9), strap = r('22251F', 0.8), zip = r('C9A24A', 0.4), zc = 0.16, R = 0.19;
  const squash = (m: Mesh) => m.map((p) => { p.y *= 0.95; p.z = Math.max(p.z, 0); });
  const xs = [-0.35, -0.335, -0.29, -0.2, 0, 0.2, 0.29, 0.335, 0.35], rs = [0.06, 0.13, 0.175, R, R, R, 0.175, 0.13, 0.06];
  P.add(squash(tube(xs.map((x) => V(x, 0, zc)), rs, 12)), ...canvas);
  for (const x of [-0.14, 0.14])
    P.add(squash(lathe([[R - 0.002, -0.022], [R + 0.01, -0.022], [R + 0.01, 0.022], [R - 0.002, 0.022]], [x, 0, zc], 12, rot(90, 'Y'))), ...strap);
  for (const y of [-0.035, 0.035])
    P.add(tube([[-0.14, y, zc + R - 0.01], [-0.1, y, zc + R + 0.06], [0, y, zc + R + 0.085], [0.1, y, zc + R + 0.06], [0.14, y, zc + R - 0.01]], 0.014, 5), ...strap);
  P.add(cyl([0, 0, zc + R + 0.085], 0.026, 0.1, 8, undefined, rot(90, 'X')), ...strap);
  P.add(box([0, 0, zc + R - 0.002], [0.4, 0.018, 0.012]), ...zip);
  P.add(box([0.16, 0.012, zc + R + 0.004], [0.045, 0.02, 0.008]), ...zip);
}

export function shopCounter(P: Prop) {
  const slate = r('4C5560', 0.6), top = r('C9A66B', 0.6), red = r('B33A2E', 0.5), black = r('1E1E1E', 0.5), metal = r('8E9499', 0.45);
  const goods = [r('2D6DB3', 0.5), r('E8B923', 0.5), r('EDEBE4', 0.5), red];
  P.add(box([0.02, 0, 0.05], [0.7, 2.94, 0.1]), ...black);
  P.add(box([0, 0, 0.58], [0.76, 3.0, 0.96]), ...slate);
  P.add(box([0.385, 0, 0.84], [0.012, 3.0, 0.1]), ...red);
  for (const y of [-0.5, 0.5]) P.add(box([0.383, y, 0.45], [0.01, 0.015, 0.7]), ...black);
  P.add(box([0.02, 0, 1.08], [0.84, 3.06, 0.04]), ...top);
  P.add(box([-0.05, 0.9, 1.15], [0.36, 0.42, 0.1]), ...black);
  P.add(box([-0.12, 0.9, 1.36], [0.04, 0.36, 0.26], rot(-12, 'Y')), ...black);
  P.add(box([-0.145, 0.9, 1.36], [0.006, 0.32, 0.22], rot(-12, 'Y')), ...goods[0]);
  P.add(bar([0.1, 0.62, 1.2], [0.1, 0.62, 1.4], 0.025), ...metal);
  P.add(box([0.11, 0.62, 1.43], [0.04, 0.2, 0.07]), ...black);
  P.add(box([0.15, 0.4, 1.12], [0.08, 0.12, 0.04]), ...black);
  P.add(box([0.05, -0.6, 1.14], [0.3, 0.42, 0.08]), ...goods[2]);
  P.add(box([0.1, -1.15, 1.18], [0.25, 0.35, 0.16]), ...goods[1]);
  for (const y of [-1.485, -0.5, 0.5, 1.485]) P.add(box([-0.62, y, 1.0], [0.4, 0.03, 2.0]), ...metal);
  P.add(box([-0.81, 0, 1.0], [0.02, 3.0, 2.0]), ...metal);
  P.add(box([-0.62, 0, 0.04], [0.38, 3.0, 0.08]), ...black);
  for (const z of [0.08, 0.46, 0.84, 1.22, 1.6, 1.985]) P.add(box([-0.62, 0, z], [0.4, 3.0, 0.025]), ...metal);
  const rnd = P.rnd;
  for (const z0 of [0.0925, 0.4725, 0.8525, 1.2325, 1.6125])
    for (const [y0, y1] of [[-1.47, -0.515], [-0.485, 0.485], [0.515, 1.47]]) {
      let y = y0;
      while (y < y1 - 0.12) {
        const role = rnd.choice(goods), w = rnd.uniform(0.12, 0.22), h = rnd.uniform(0.12, 0.28), d = rnd.uniform(0.18, 0.3);
        const n = rnd.randint(1, 3);
        for (let i = 0; i < n; i++) { if (y + w > y1) break; P.add(box([-0.43 - d / 2, y + w / 2, z0 + h / 2], [d, w - 0.012, h]), ...role); y += w; }
      }
    }
  P.collide([0.02, 0, 0.55], [0.84, 3.06, 1.1]);
  P.collide([-0.62, 0, 1.0], [0.4, 3.0, 2.0]);
}

export function slotMachine(P: Prop) {
  const purple = r('5B1E7A', 0.4), gold = r('D4A637', 0.3), black = r('1E1E1E', 0.5), glow = r('F2C14E', 0.3);
  const reel = r('F4F1E8', 0.4), red = r('C8202A', 0.4), chrome = r('D0D4D8', 0.25);
  P.add(box([0, 0, 0.04], [0.6, 0.84, 0.08]), ...black);
  P.add(box([-0.02, 0, 0.44], [0.64, 0.9, 0.72]), ...purple);
  P.add(box([0.3, 0, 0.47], [0.01, 0.76, 0.38]), ...gold);
  P.add(box([0.304, 0, 0.47], [0.01, 0.7, 0.32]), ...glow);
  P.add(box([0.31, 0, 0.16], [0.05, 0.32, 0.08]), ...black);
  const deck = rot(12, 'Y'), up = V(0, 0, 0.045).applyMatrix4(deck);
  P.add(box([0.33, 0, 0.84], [0.2, 0.9, 0.08], deck), ...black);
  [-0.3, -0.1, 0.1, 0.3].forEach((y, k) => P.add(box(V(0.33, y, 0.84).add(up), [0.07, 0.09, 0.025], deck), ...(k % 2 ? red : glow)));
  P.add(box([-0.04, 0, 1.25], [0.6, 0.86, 0.9]), ...purple);
  for (const y of [-0.425, 0.425]) P.add(box([0.25, y, 1.25], [0.04, 0.03, 0.9]), ...gold);
  P.add(box([0.265, 0, 1.3], [0.012, 0.7, 0.56]), ...gold);
  P.add(box([0.272, 0, 1.3], [0.01, 0.64, 0.5]), ...black);
  [-0.2, 0, 0.2].forEach((y, i) => {
    P.add(box([0.279, y, 1.3], [0.006, 0.18, 0.38]), ...reel);
    [1.18, 1.3, 1.42].forEach((z, j) => P.add(box([0.283, y, z], [0.004, 0.08, 0.07]), ...[red, gold, purple][j === 1 ? 0 : (i + j) % 3]));
  });
  // arched topper: half elliptic cylinders (bisected at z 1.7 in the source -> flattened here)
  const arch = (c: [number, number, number], s: [number, number, number]) =>
    cyl(c, 1, 1, 16, undefined, mul(rot(90, 'Y'), new THREE.Matrix4().makeScale(...s))).map((p) => { p.z = Math.max(p.z, 1.7); });
  P.add(arch([-0.04, 0, 1.7], [0.3, 0.43, 0.58]), ...purple);
  P.add(arch([0.255, 0, 1.7], [0.25, 0.37, 0.02]), ...glow);
  P.add(box([-0.04, 0, 1.71], [0.6, 0.88, 0.02]), ...gold);
  P.add(cyl([0.08, 0.465, 1.1], 0.06, 0.07, 10, undefined, rot(90, 'X')), ...chrome);
  P.add(bar([0.08, 0.48, 1.1], [0.12, 0.48, 1.42], 0.03), ...chrome);
  P.add(sphere([0.12, 0.48, 1.47], [0.055, 0.055, 0.055], [10, 6]), ...red);
  P.collide([0.04, 0, 1.0], [0.78, 0.92, 2.0]);
}

export function burgerCounter(P: Prop) {
  const red = r('C8202A', 0.5), yellow = r('F2B705', 0.5), steel = r('9AA0A6', 0.4), black = r('1E1E1E', 0.5);
  const light = r('F5E6B8', 0.4), bun = r('D9963A', 0.7), patty = r('5A3420', 0.8), tray = r('8A3A1E', 0.5);
  P.add(box([0.02, 0, 0.05], [0.8, 2.94, 0.1]), ...black);
  P.add(box([0, 0, 0.57], [0.86, 3.0, 0.94]), ...red);
  for (const [z, h] of [[0.86, 0.12], [0.3, 0.05]]) P.add(box([0.433, 0, z], [0.012, 3.0, h]), ...yellow);
  P.add(box([0.02, 0, 1.07], [0.94, 3.06, 0.06]), ...steel);
  for (const y of [-0.9, 0.9]) {
    P.add(box([-0.15, y, 1.15], [0.34, 0.4, 0.1]), ...black);
    P.add(box([-0.2, y, 1.36], [0.04, 0.34, 0.26], rot(-12, 'Y')), ...black);
  }
  for (const y of [-0.3, 0.35]) {
    P.add(box([0.17, y, 1.11], [0.36, 0.46, 0.02]), ...tray);
    P.add(cyl([0.2, y - 0.08, 1.135], 0.055, 0.03, 10), ...bun);
    P.add(cyl([0.2, y - 0.08, 1.157], 0.059, 0.016, 10), ...patty);
    P.add(sphere([0.2, y - 0.08, 1.168], [0.056, 0.056, 0.04], [10, 5], undefined, 1.166), ...bun);
    P.add(box([0.08, y + 0.1, 1.17], [0.05, 0.08, 0.1]), ...red);
    P.add(box([0.08, y + 0.1, 1.235], [0.04, 0.07, 0.03]), ...yellow);
    P.add(cyl([0.24, y + 0.14, 1.195], 0.042, 0.15, 10, 0.05), ...light);
    P.add(cyl([0.24, y + 0.14, 1.275], 0.052, 0.012, 10), ...red);
    P.add(bar([0.24, y + 0.14, 1.27], [0.25, y + 0.15, 1.35], 0.008), ...yellow);
  }
  for (let k = 0; k < 4; k++) P.add(box([0.15, 1.3, 1.11 + k * 0.022], [0.36, 0.3, 0.02]), ...tray);
  P.add(box([-0.55, 0, 1.3], [0.1, 3.0, 2.6]), ...red);
  P.add(box([-0.55, 0, 2.56], [0.12, 3.02, 0.08]), ...yellow);
  P.add(box([-0.46, 0, 2.12], [0.08, 2.86, 0.8]), ...black);
  for (const py of [-0.93, 0, 0.93]) {
    P.add(box([-0.415, py, 2.12], [0.01, 0.88, 0.72]), ...light);
    [2.3, 1.98].forEach((z, row) => [-0.27, 0, 0.27].forEach((dy, col) => {
      const k = (((row * 3 + col + Math.trunc(py * 2)) % 4) + 4) % 4; // python % is non-negative
      P.add(box([-0.408, py + dy, z], [0.006, 0.22, 0.16]), ...[bun, red, patty, yellow][k]);
      P.add(box([-0.408, py + dy, z - 0.12], [0.006, 0.16, 0.025]), ...black);
    }));
  }
  P.collide([0.02, 0, 0.55], [0.94, 3.06, 1.1]);
  P.collide([-0.53, 0, 1.3], [0.15, 3.02, 2.6]);
}

export function vault(P: Prop, open = false) {
  const steel = r('8C9196', 0.4), dark = r('4E5459', 0.5), door = r('B4B9BE', 0.3), chrome = r('D0D4D8', 0.25), inside = r('6E747A', 0.6);
  const zc = 1.1, a = 0.62, hx = 1.11, ax = rot(90, 'Y');
  P.add(box([0, 0, 0.06], [2.04, 2.04, 0.12]), ...dark);
  const walls: [[number, number, number], [number, number, number]][] = [
    [[-0.9, 0, 1.06], [0.2, 2.0, 1.88]], [[0, 0.9, 1.06], [1.6, 0.2, 1.88]], [[0, -0.9, 1.06], [1.6, 0.2, 1.88]],
    [[0, 0, 2.1], [2.0, 2.0, 0.2]], [[0, 0, 0.22], [1.6, 1.6, 0.2]],
    [[0.9, (1 + a) / 2, 1.06], [0.2, 1 - a, 1.88]], [[0.9, -(1 + a) / 2, 1.06], [0.2, 1 - a, 1.88]],
    [[0.9, 0, (zc + a + 2.0) / 2], [0.2, 2 * a, 2.0 - zc - a]], [[0.9, 0, (zc - a + 0.12) / 2], [0.2, 2 * a, zc - a - 0.12]]];
  for (const [c, s] of walls) { P.add(box(c, s), ...steel); if (open) P.collide(c, s); }
  for (const s of [1, -1]) for (const x of [-0.5, 0, 0.5]) P.add(box([x, s * 1.005, 1.16], [0.03, 0.01, 1.96]), ...dark);
  P.add(lathe([[0.6, 0], [0.95, 0], [0.95, 0.08], [0.6, 0.08]], [1.0, 0, zc], 24, ax), ...steel);
  for (const z of [zc - 0.4, zc + 0.4]) {
    P.add(box([(1.0 + hx) / 2, 0.87, z], [hx - 1.0, 0.12, 0.2]), ...dark);
    P.add(cyl([hx, 0.87, z], 0.07, 0.3, 10), ...dark);
  }
  let m = T(-0.06, 0, 0);
  const yaw = 100;
  if (open) {
    m = mul(T(hx, 0.87, 0), rot(yaw, 'Z'), T(-hx, -0.87, 0), m);
    for (const y of [-0.795, 0.795]) P.add(box([0, y, 1.16], [1.56, 0.01, 1.66]), ...inside);
    P.add(box([0, 0, 0.325], [1.58, 1.58, 0.01]), ...inside);
    for (const y of [-0.54, -0.18, 0.18, 0.54]) for (let k = 0; k < 5; k++) P.add(box([-0.79, y, 0.5 + k * 0.28], [0.02, 0.33, 0.24]), ...chrome);
  }
  const mv = (x: Mesh) => x.apply(m);
  P.add(mv(cyl([1.05, 0, zc], 0.585, 0.3, 16, undefined, ax)), ...door);
  P.add(mv(cyl([1.17, 0, zc], 0.8, 0.06, 24, undefined, ax)), ...door);
  P.add(mv(cyl([1.21, 0, zc], 0.62, 0.02, 24, undefined, ax)), ...chrome);
  P.add(mv(cyl([1.26, 0, zc], 0.11, 0.08, 12, undefined, ax)), ...dark);
  P.add(mv(torus([1.33, 0, zc], 0.36, 0.025, 16, 5, ax)), ...chrome);
  for (let k = 0; k < 3; k++) { const t = (90 + 120 * k) * Math.PI / 180;
    P.add(mv(bar([1.28, 0, zc], [1.33, 0.36 * Math.cos(t), zc + 0.36 * Math.sin(t)], 0.035)), ...chrome); }
  for (let k = 0; k < 8; k++) { const t = (2 * Math.PI * (k + 0.5)) / 8;
    P.add(mv(box([1.205, 0.71 * Math.cos(t), zc + 0.71 * Math.sin(t)], [0.03, 0.05, 0.05])), ...dark); }
  if (open) { const c = V(1.1, 0, zc).applyMatrix4(m); P.collide([c.x, c.y, c.z], [0.46, 1.6, 1.6], yaw); }
  else P.collide([0.15, 0, 1.1], [2.3, 2.04, 2.2]);
}

export function forgerDesk(P: Prop) {
  const wood = r('5A3A22', 0.7), brass = r('C9A24A', 0.35), green = r('2F5A3A', 0.5), paper = r('F2F0E8', 0.8), pp = r('6E1E2A', 0.6), black = r('1E1E1E', 0.5);
  const Tt = 0.75, rnd = P.rnd;
  P.add(box([0, 0, Tt - 0.02], [1.0, 1.8, 0.04]), ...wood);
  P.add(box([0, -0.6, 0.355], [0.9, 0.5, 0.71]), ...wood);
  for (let k = 0; k < 3; k++) { const z = 0.125 + k * 0.22;
    P.add(box([-0.457, -0.6, z], [0.015, 0.44, 0.19]), ...wood); P.add(box([-0.47, -0.6, z + 0.05], [0.015, 0.12, 0.025]), ...brass); }
  for (const x of [-0.44, 0.44]) P.add(box([x, 0.84, 0.355], [0.05, 0.05, 0.71]), ...wood);
  P.add(box([0.46, 0.245, 0.445], [0.02, 1.19, 0.49]), ...wood);
  P.add(box([0.05, 0.05, Tt + 0.002], [0.5, 0.7, 0.004]), ...green);
  P.add(cyl([-0.3, 0.65, Tt + 0.015], 0.09, 0.03, 12), ...black);
  P.add(bar([-0.3, 0.65, Tt + 0.03], [-0.22, 0.6, Tt + 0.42], 0.025), ...brass);
  P.add(bar([-0.22, 0.6, Tt + 0.42], [-0.03, 0.48, Tt + 0.44], 0.022), ...brass);
  P.add(cyl([0, 0.46, Tt + 0.37], 0.13, 0.15, 12, 0.05, rot(20, 'Y')), ...green);
  for (let k = 0; k < 6; k++) { const x = rnd.uniform(-0.3, 0.3), y = rnd.uniform(-0.25, 0.55);
    P.add(box([x, y, Tt + 0.006 + k * 0.0025], [0.21, 0.297, 0.002], rot(rnd.uniform(-40, 40), 'Z')), ...paper); }
  P.add(box([-0.32, 0.15, Tt + 0.03], [0.21, 0.3, 0.06], rot(5, 'Z')), ...paper);
  for (const [x, y, z, a] of [[0.3, -0.15, 0, 10], [0.3, -0.13, 1, -5], [0.33, 0.05, 0, 30], [0.12, 0.38, 0, -20]])
    P.add(box([x, y, Tt + 0.01 + z * 0.01], [0.09, 0.125, 0.01], rot(a, 'Z')), ...pp);
  const rr = rot(-8, 'Z');
  P.add(box([0.05, -0.05, Tt + 0.006], [0.18, 0.125, 0.004], rr), ...pp);
  P.add(box([0.05, -0.05, Tt + 0.0095], [0.17, 0.115, 0.003], rr), ...paper);
  P.add(box([0.25, -0.45, Tt + 0.015], [0.08, 0.05, 0.03]), ...black);
  P.add(cyl([0.25, -0.45, Tt + 0.065], 0.018, 0.07, 8), ...wood);
  P.add(sphere([0.25, -0.45, Tt + 0.105], [0.03, 0.03, 0.025], [8, 5]), ...wood);
  P.add(box([0.1, -0.5, Tt + 0.008], [0.1, 0.07, 0.016]), ...black);
  P.collide([0, 0, Tt / 2], [1.0, 1.8, Tt]);
}

export function checkInDesk(P: Prop) {
  const white = r('E8E8E4', 0.4), blue = r('1F4FA0', 0.5), steel = r('9AA0A6', 0.4), black = r('1E1E1E', 0.5);
  const screen = r('3A7BD5', 0.2), sign = r('F2F2EE', 0.5), accent = r('E37222', 0.5);
  for (const y of [-1.9, 1.9]) {
    P.add(box([0.475, y, 0.55], [0.25, 2.2, 1.1]), ...white);
    P.add(box([0.2, y, 0.38], [0.3, 2.2, 0.76]), ...white);
    P.add(box([0.2, y, 0.775], [0.34, 2.2, 0.03]), ...steel);
    P.add(box([0.48, y, 1.1], [0.3, 2.24, 0.04]), ...steel);
    P.add(box([0.605, y, 0.95], [0.01, 2.2, 0.12]), ...blue);
    P.add(box([0.603, y, 0.04], [0.012, 2.2, 0.08]), ...black);
    P.add(box([0.27, y - 0.3, 1.07], [0.04, 0.5, 0.32]), ...black);
    P.add(box([0.248, y - 0.3, 1.07], [0.005, 0.46, 0.28]), ...screen);
    P.add(box([0.27, y - 0.3, 0.86], [0.04, 0.06, 0.16]), ...black);
    P.add(box([0.5, y + 0.6, 1.2], [0.03, 0.26, 0.16], rot(-10, 'Y')), ...black);
    P.add(box([0.518, y + 0.6, 1.2], [0.005, 0.22, 0.12], rot(-10, 'Y')), ...screen);
    P.add(box([0.15, y + 0.55, 0.87], [0.25, 0.3, 0.16]), ...steel);
    P.add(box([-0.46, y, 2.0], [0.12, 1.6, 0.42]), ...sign);
    P.add(box([-0.398, y, 1.9], [0.005, 1.5, 0.08]), ...accent);
    P.add(box([-0.5, y, 1.42], [0.04, 0.8, 0.45]), ...black);
    for (const z of [1.3, 1.4, 1.5]) P.add(box([-0.478, y, z], [0.005, 0.6, 0.03]), ...sign);
    P.collide([0.33, y, 0.55], [0.56, 2.24, 1.1]);
  }
  P.add(box([0.08, 0, 0.175], [1.05, 1.56, 0.35]), ...steel);
  P.add(box([0.08, 0, 0.36], [1.0, 1.4, 0.02]), ...black);
  for (const y of [-0.76, 0.76]) P.add(box([0.08, y, 0.38], [1.05, 0.04, 0.06]), ...steel);
  P.add(box([-0.51, 0, 0.6], [0.02, 1.3, 0.5]), ...black);
  P.add(box([0.55, 0.68, 0.5], [0.06, 0.06, 1.0]), ...steel);
  P.add(box([0.56, 0.68, 1.05], [0.05, 0.22, 0.13]), ...black);
  P.add(box([0.586, 0.68, 1.05], [0.005, 0.18, 0.09]), ...screen);
  P.add(box([-0.56, 0, 1.2], [0.08, 6.0, 2.4]), ...blue);
  P.collide([0.08, 0, 0.21], [1.05, 1.6, 0.42]);
  P.collide([-0.53, 0, 1.2], [0.14, 6.0, 2.4]);
}

export function parcelStack(P: Prop) {
  const card = [r('B8895A', 0.9), r('A27648', 0.9)], tape = r('D9C08E', 0.5), label = r('F2F0E8', 0.7), pallet = r('A08A68', 0.9);
  for (const y of [-0.44, 0, 0.44]) P.add(box([0, y, 0.05], [1.1, 0.1, 0.1]), ...pallet);
  for (let k = 0; k < 5; k++) P.add(box([-0.48 + k * 0.24, 0, 0.12], [0.14, 1.0, 0.04]), ...pallet);
  const parcels = [[-0.27, -0.25, 0.14, 0.52, 0.48, 0.4, 0], [0.27, -0.25, 0.14, 0.52, 0.48, 0.4, 0],
    [-0.27, 0.24, 0.14, 0.52, 0.5, 0.4, 0], [0.27, 0.24, 0.14, 0.52, 0.5, 0.4, 0],
    [-0.25, -0.22, 0.54, 0.56, 0.52, 0.36, 3], [0.28, -0.2, 0.54, 0.46, 0.5, 0.32, -4],
    [0, 0.27, 0.54, 0.9, 0.44, 0.34, 2], [0.05, 0.22, 0.88, 0.5, 0.4, 0.3, 12], [-0.22, -0.2, 0.9, 0.4, 0.36, 0.28, -8]];
  parcels.forEach(([x, y, z0, sx, sy, sz, yaw], i) => {
    const rr = rot(yaw, 'Z'), c = V(x, y, z0 + sz / 2), at = (dx: number, dy: number, dz: number) => V(dx, dy, dz).applyMatrix4(rr).add(c);
    P.add(box(c, [sx, sy, sz], rr), ...card[i % 2]);
    P.add(box(at(0, 0, sz / 2 + 0.002), [sx + 0.004, 0.06, 0.006], rr), ...tape);
    P.add(box(at(sx / 2 + 0.002, 0, sz / 2 - 0.05), [0.006, 0.06, 0.1], rr), ...tape);
    if (i % 3 !== 2) P.add(box(at(sx / 2 + 0.003, i % 2 ? 0.12 : -0.13, -0.04), [0.006, 0.12, 0.09], rr), ...label);
  });
  P.collide([0, 0, 0.6], [1.1, 1.0, 1.2]);
}
