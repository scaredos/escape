// Port pieces: fishing boat, 40 ft containers, ship-to-shore crane (props.py boat, container, port_crane).
import { Prop, V, box, cyl, bar, tube, sphere, blob, skin, cap, lathe, torus, rot, type V3 } from './kit';

type R = [string, number];
const r = (hex: string, rough = 0.75): R => [hex, rough];
const pos = (x: number) => Math.max(0, x);

export function boat(P: Prop) {
  const anti = r('7A2A22', 0.7), white = r('F2F1EC', 0.5), blue = r('1F5FA8', 0.5), deck = r('A8957A', 0.85);
  const glass = r('33505E', 0.1), rubber = r('1E1E1E', 0.8), buoy = r('E8452C', 0.6), D = 0.72;
  const width = (x: number) => Math.max(0.03, 1.4 * Math.cos(Math.min(1, pos((x - 0.6) / 3.4)) * Math.PI / 2) ** 0.75 * (1 - 0.14 * pos((-x - 2) / 2) ** 2));
  const keel = (x: number) => -0.6 + 0.85 * pos((x - 1.8) / 2.2) ** 1.6 + 0.1 * pos(-x - 3);
  const sheer = (x: number) => 1.15 + 0.4 * pos((x - 0.5) / 3.5) ** 2 + 0.06 * pos((-x - 2) / 2);
  const rings: V3[][] = [];
  for (const x of [-4, -3.6, -2.8, -1.8, -0.6, 0.6, 1.6, 2.4, 3.0, 3.45, 3.8, 4.0]) {
    const w = width(x), k = keel(x), s = sheer(x), zw = Math.max(0.02, k + 0.1 * (s - k)), t = Math.min(0.08, w * 0.4);
    const half: [number, number][] = [[0.3 * w, k + 0.2 * (zw - k)], [0.78 * w, k + 0.65 * (zw - k)], [0.96 * w, zw], [w, s - 0.3], [w, s], [w - t, s], [w - t, D]];
    rings.push([V(x, 0, k), ...half.map(([y, z]) => V(x, y, z)), V(x, 0, D), ...[...half].reverse().map(([y, z]) => V(x, -y, z))]);
  }
  for (const [segs, role] of [[[0, 1, 2, 13, 14, 15], anti], [[3, 5, 6, 9, 10, 12], white], [[4, 11], blue], [[7, 8], deck]] as [number[], R][])
    P.add(skin(rings, segs), ...role);
  P.add(cap(rings[0], true), ...white);
  P.add(cap(rings[rings.length - 1]), ...white);
  // hull hull approximated: midship box, tapered bow box
  P.collide([-0.6, 0, 0.35], [6.8, 2.8, 1.9]);
  P.collide([3.2, 0, 0.75], [1.6, 1.4, 1.6]);
  for (const x of [-2.6, -0.9, 0.9]) for (const sy of [1, -1]) {
    const y = sy * (width(x) + 0.075);
    P.add(lathe([[0.12, -0.07], [0.24, -0.07], [0.24, 0.07], [0.12, 0.07]], [x, y, 0.62], 8, rot(90, 'X')), ...rubber);
    P.add(bar([x, y, 0.86], [x, sy * width(x), sheer(x)], 0.025), ...rubber);
  }
  const wx = -0.6, wl = 1.8;
  P.add(box([wx, 0, D + 1.1], [wl, 1.7, 2.2]), ...white);
  P.add(box([wx, 0, D + 0.08], [wl + 0.02, 1.72, 0.16]), ...blue);
  P.add(box([wx + wl / 2 + 0.01, 0, 2.35], [0.04, 1.5, 0.6]), ...glass);
  P.add(box([wx - 0.1, 0.86, 2.38], [1.3, 0.04, 0.5]), ...glass);
  P.add(box([wx + 0.45, -0.86, 2.38], [0.6, 0.04, 0.5]), ...glass);
  P.add(box([wx - 0.4, -0.865, D + 0.82], [0.62, 0.04, 1.6]), ...blue);
  P.add(box([wx, 0, D + 2.26], [2.1, 1.95, 0.12]), ...blue);
  P.add(box([wx + 0.3, 0, D + 2.4], [0.3, 0.5, 0.16]), ...white);
  P.add(torus([wx - wl / 2 - 0.05, 0.35, 2.0], 0.26, 0.05, 12, 6, rot(90, 'Y')), ...buoy);
  P.collide([wx, 0, D + 1.17], [wl + 0.1, 1.75, 2.34]);
  P.add(tube([[-0.9, 0, D + 2.3], [-0.9, 0, 6.2]], [0.07, 0.045], 8), ...white);
  P.add(bar([-0.9, -0.75, 5.4], [-0.9, 0.75, 5.4], 0.05), ...white);
  P.add(cyl([-0.9, 0, 6.25], 0.06, 0.1, 8), ...white);
  P.add(bar([-0.9, 0, 3.6], [-3.3, 0, 2.3], 0.06), ...white);
  P.add(bar([-3.3, 0, 2.3], [-3.3, 0, 1.25], 0.015), ...rubber);
  P.add(blob([-3.0, 0.35, D + 0.12], 0.55, 2, 0.3, 80, [1.1, 1.0, 0.45]).map((p) => { p.z = Math.max(p.z, D); }), '3E7A5A', 0.9);
  [[-2.7, 0.7], [-3.2, 0.05], [-3.5, 0.65]].forEach(([x, y], k) => P.add(sphere([x, y, D + 0.3 - 0.04 * k], [0.12, 0.12, 0.12], [8, 5]), ...buoy));
  P.add(box([-2.55, -0.6, D + 0.12], [0.55, 0.38, 0.24]), ...blue);
  P.add(box([-2.55, -0.6, D + 0.36], [0.55, 0.38, 0.24], rot(8, 'Z')), ...blue);
}

export function container(P: Prop, body: string, frame: string) {
  const c = r(body, 0.6), f = r(frame, 0.6), bars = r('7A8085', 0.45);
  const L = 12.19, W = 2.44, H = 2.59, hx = L / 2, hy = W / 2;
  P.add(box([0, 0, 1.3], [L - 0.2, W - 0.14, 2.4]), ...c);
  for (const s of [1, -1]) {
    P.add(box([0, s * (hy - 0.035), 0.08], [L - 0.2, 0.07, 0.16]), ...f);
    P.add(box([0, s * (hy - 0.035), H - 0.07], [L - 0.2, 0.07, 0.14]), ...f);
    P.add(box([s * (hx - 0.06), 0, 0.08], [0.12, W - 0.2, 0.16]), ...f);
    P.add(box([s * (hx - 0.06), 0, H - 0.07], [0.12, W - 0.2, 0.14]), ...f);
    for (const sy of [1, -1]) {
      P.add(box([s * (hx - 0.08), sy * (hy - 0.08), H / 2], [0.16, 0.16, H]), ...f);
      for (const z of [0.06, H - 0.06]) P.add(box([s * (hx - 0.09), sy * (hy - 0.09), z], [0.19, 0.19, 0.12]), ...f);
    }
  }
  const n = 36, x0 = hx - 0.16, p = (2 * x0) / n, prof: [number, number][] = [];
  for (let i = 0; i < n; i++) for (const [d, o] of [[0, 1], [0.3, 1], [0.5, 0], [0.8, 0]]) prof.push([-x0 + i * p + d * p, o]);
  prof.push([x0, 1]);
  const segs = [...Array(prof.length - 1).keys()];
  for (const s of [1, -1]) {
    const line = (z: number) => prof.map(([x, o]) => V(x, s * (hy - 0.07 + 0.04 * o), z));
    P.add(skin(s > 0 ? [line(2.45), line(0.16)] : [line(0.16), line(2.45)], segs), ...c);
  }
  for (const y of [-0.9, -0.45, 0, 0.45, 0.9]) P.add(box([-hx + 0.065, y, 1.3], [0.06, 0.18, 2.29]), ...c);
  for (const s of [1, -1]) {
    P.add(box([hx - 0.08, s * 0.565, 1.3], [0.04, 1.12, 2.29]), ...c);
    for (const z of [0.65, 1.3, 1.95]) P.add(box([hx - 0.05, s * 0.565, z], [0.02, 1.0, 0.1]), ...c);
    for (const y of [0.25, 0.85]) {
      P.add(cyl([hx - 0.025, s * y, 1.31], 0.025, 2.2, 6), ...bars);
      P.add(box([hx - 0.01, s * (y - 0.1), 1.1], [0.03, 0.22, 0.04]), ...bars);
    }
  }
  P.collide([0, 0, H / 2], [L, W, H]);
}

export function portCrane(P: Prop) {
  const red = r('C23B2E', 0.6), white = r('EDEDE8', 0.6), dark = r('4E5459', 0.5), glass = r('33505E', 0.1), yellow = r('E8B923', 0.5);
  const LX = 8, LY = 9, G = 2.6;
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      const x = sx * LX, y = sy * LY;
      P.add(box([x, y, 0.6], [1.6, 3.4, 0.7]), ...dark);
      for (const wy of [-1.1, 1.1]) P.add(cyl([x, y + wy, 0.32], 0.32, 1.8, 8, undefined, rot(90, 'Y')), ...dark);
      P.add(box([x, y, 15.4], [1.3, 1.3, 29.0]), ...red);
      P.add(bar([x, y, 22], [x, sy * (LY - 5.5), 27.7], 0.8), ...red);
      P.collide([x, y, 15], [1.6, 3.4, 30]);
    }
    P.add(box([sx * LX, 0, 29], [1.5, 2 * LY + 1.3, 2.6]), ...white);
    P.add(box([0, sx * LY, 13], [2 * LX - 1.3, 1.0, 1.4]), ...red);
    P.add(bar([-LX, sx * LY, 13.7], [LX, sx * LY, 27.7], 0.8), ...red);
  }
  for (const gy of [-G, G]) {
    P.add(box([-6, gy, 31.5], [28, 1.2, 2.4]), ...white);
    P.add(box([23.2, gy, 31.6], [30, 1.1, 2.0]), ...white);
    P.add(box([37.7, gy, 31.6], [1.0, 1.14, 2.04]), ...red);
    P.add(cyl([8.2, gy, 31.6], 0.5, 1.4, 8, undefined, rot(90, 'X')), ...dark);
    P.add(bar([LX, gy, 32.7], [5, gy, 44.6], 1.0), ...red);
    P.add(bar([-LX, gy, 32.7], [5, gy, 44.6], 1.0), ...red);
    for (const tx of [22, 37]) P.add(bar([5, gy, 44.6], [tx, gy, 32.6], 0.3), ...dark);
    P.add(bar([5, gy, 44.6], [-19, gy, 32.7], 0.35), ...dark);
  }
  P.add(box([5, 0, 44.8], [1.2, 2 * G + 1.2, 1.2]), ...red);
  for (let x = -18; x < 38; x += 6) {
    P.add(box([x, 0, 30.6], [0.4, 2 * G, 0.4]), ...white);
    if (x < 32) { const sg = Math.floor(x / 6) % 2 === 0 ? 1 : -1; // (-1) ** (x // 6)
      P.add(bar([x, -G * sg, 32.75], [x + 6, G * sg, 32.75], 0.25), ...white); }
  }
  P.add(box([-15.5, 0, 34.9], [7.0, 7.4, 4.4]), ...white);
  P.add(box([-15.5, 0, 35.8], [7.04, 7.44, 0.5]), ...glass);
  P.add(box([22, 0, 33.4], [4.0, 6.4, 1.4]), ...dark);
  P.add(box([20.5, -1.4, 30.2], [1.0, 1.0, 0.3]), ...dark);
  P.add(box([20.5, -1.4, 28.9], [2.6, 2.4, 2.4]), ...white);
  P.add(box([20.5, -1.4, 29.0], [2.64, 2.44, 1.0]), ...glass);
  for (const dx of [-1.2, 1.2]) for (const dy of [-1, 1]) P.add(bar([22 + dx, dy, 30.3], [22 + dx * 0.6, dy, 18.6], 0.08), ...dark);
  P.add(box([22, 0, 18.2], [2.0, 3.0, 0.8]), ...dark);
  P.add(box([22, 0, 17.5], [2.3, 12.0, 0.6]), ...yellow);
}
