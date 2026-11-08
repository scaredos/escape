// Street, rooftop and beach props (props.py street_lamp .. planter, guard_booth .. jersey_barrier).
import { Prop, V, Z, box, cyl, bar, tube, sheet, sphere, blob, skin, cap, rot, type V3 } from './kit';

type R = [string, number];
const r = (hex: string, rough = 0.75): R => [hex, rough];

export function streetLamp(P: Prop) {
  const metal = r('8E9499', 0.45), dark = r('4A4F55', 0.5);
  const z0 = 7.0, Rb = 0.8;
  const pts: V3[] = [V(0, 0, 0), V(0, 0, 3), V(0, 0, z0)];
  for (let a = 15; a <= 90; a += 15) pts.push(V(Rb - Rb * Math.cos(a * Math.PI / 180), 0, z0 + Rb * Math.sin(a * Math.PI / 180)));
  pts.push(V(1.6, 0, z0 + Rb + 0.06), V(2.15, 0, z0 + Rb + 0.08));
  P.add(tube(pts, [0.13, 0.1, 0.075, 0.065, 0.065, 0.065, 0.065, 0.065, 0.065, 0.055, 0.05], 10), ...metal);
  P.add(cyl([0, 0, 0.3], 0.19, 0.6, 10), ...dark);
  P.add(box([0.185, 0, 0.35], [0.03, 0.14, 0.3]), ...dark);
  P.add(cyl([0, 0, 3], 0.115, 0.08, 10), ...dark);
  const hz = z0 + Rb + 0.04;
  P.add(box([2.4, 0, hz], [0.8, 0.34, 0.15], rot(4, 'Y')), ...dark);
  P.add(box([2.42, 0, hz - 0.085], [0.6, 0.25, 0.03], rot(4, 'Y')), 'FFF1C4', 0.2);
  P.collide([0, 0, 3.8], [0.34, 0.34, 7.6]);
}

export function bench(P: Prop) {
  const wood = r('B07A45', 0.8), iron = r('2E3A33', 0.5), Lb = 1.8;
  for (const x of [-0.15, 0, 0.15]) P.add(box([x, 0, 0.45], [0.13, Lb, 0.04]), ...wood);
  const back = (z: number) => -0.22 - (0.14 * (z - 0.43)) / 0.47, ang = Math.atan2(0.14, 0.47) * 180 / Math.PI;
  for (const z of [0.62, 0.8]) P.add(box([back(z) + 0.035, 0, z], [0.035, Lb, 0.12], rot(-ang, 'Y')), ...wood);
  for (const y of [-0.78, 0, 0.78]) {
    P.add(bar([0.2, y, 0], [0.17, y, 0.43], 0.05), ...iron);
    P.add(bar([-0.2, y, 0], [-0.22, y, 0.43], 0.05), ...iron);
    P.add(bar([-0.22, y, 0.43], [-0.36, y, 0.9], 0.05), ...iron);
    P.add(bar([-0.25, y, 0.41], [0.22, y, 0.41], 0.05, 0.03), ...iron);
  }
  for (const y of [-0.86, 0.86]) {
    P.add(bar([0.2, y, 0.43], [0.18, y, 0.64], 0.04), ...iron);
    P.add(bar([-0.27, y, 0.65], [0.22, y, 0.65], 0.05, 0.035), ...iron);
  }
  P.collide([-0.05, 0, 0.45], [0.55, 1.85, 0.9]);
  P.recenter();
}

export function bin(P: Prop) {
  const green = r('2F6A47', 0.55);
  P.add(cyl([0, 0, 0.67], 0.24, 0.6, 14), ...green);
  P.add(cyl([0, 0, 0.985], 0.255, 0.04, 14), '24533A', 0.55);
  P.add(cyl([0, 0, 1.007], 0.215, 0.006, 14), '1B1B1B', 0.9);
  P.add(cyl([0, 0, 0.8], 0.243, 0.07, 14), 'E8E4D6', 0.6);
  P.add(cyl([0, 0, 0.37], 0.2, 0.02, 14), ...green);
  P.add(cyl([-0.31, 0, 0.6], 0.035, 1.2, 8), '8E9499', 0.45);
  P.add(box([-0.27, 0, 0.88], [0.1, 0.06, 0.1]), '8E9499', 0.45);
  P.collide([-0.03, 0, 0.6], [0.6, 0.52, 1.2]);
}

export function busStop(P: Prop) {
  const frame = r('3A3F44', 0.45), glass = r('9EC4D0', 0.08), steel = r('9AA0A6', 0.4), white = r('F2F2EE', 0.5);
  for (const [x, y] of [[-0.7, -1.75], [-0.7, 1.75], [0.6, -1.75], [0.6, 1.75]]) P.add(box([x, y, 1.25], [0.08, 0.08, 2.5]), ...frame);
  P.add(box([-0.05, 0, 2.55], [1.75, 3.85, 0.1], rot(-3, 'Y')), 'D8D8D2', 0.6);
  P.add(box([0.79, 0, 2.53], [0.06, 3.85, 0.22]), '1F5FA8', 0.5);
  P.add(box([-0.7, 0, 1.2], [0.02, 3.42, 1.9]), ...glass);
  for (const z of [0.25, 2.15]) P.add(box([-0.7, 0, z], [0.05, 3.5, 0.05]), ...frame);
  P.add(box([-0.05, 1.75, 1.2], [1.2, 0.12, 1.9]), ...frame);
  for (const y of [1.68, 1.82]) P.add(box([-0.05, y, 1.2], [1.05, 0.02, 1.7]), 'F2B33D', 0.4);
  P.add(box([-0.05, 1.83, 1.45], [0.8, 0.02, 0.5]), 'C8352B', 0.4);
  P.add(box([-0.45, -0.2, 0.46], [0.38, 2.4, 0.05]), ...steel);
  for (const y of [-1.2, 0.8]) P.add(box([-0.45, y, 0.22], [0.05, 0.05, 0.44]), ...frame);
  P.add(cyl([0.85, -2.05, 1.45], 0.04, 2.9, 8), ...steel);
  P.add(box([0.85, -2.05, 2.6], [0.03, 0.5, 0.62]), ...white);
  P.add(box([0.87, -2.05, 2.66], [0.02, 0.36, 0.36]), '1F5FA8', 0.5);
  P.add(box([0.885, -2.05, 2.66], [0.01, 0.2, 0.14]), ...white);
  P.collide([-0.7, 0, 1.25], [0.12, 3.6, 2.5]);
  P.collide([-0.05, 1.75, 1.2], [1.25, 0.15, 1.95]);
  P.collide([-0.05, 0, 2.55], [1.8, 3.9, 0.2]);
  P.collide([-0.45, -0.2, 0.25], [0.4, 2.4, 0.5]);
}

export function solarHeater(P: Prop) {
  const steel = r('A0A5AA', 0.45), frame = r('B8BCC0', 0.4), tilt = 40;
  const c = V(0.1, 0, 0.25 + 0.5 * Math.sin(tilt * Math.PI / 180)), m = rot(tilt, 'Y');
  const nrm = Z().applyMatrix4(m);
  P.add(box(c, [1, 2, 0.06], m), ...frame);
  P.add(box(c.clone().addScaledVector(nrm, 0.032), [0.92, 1.92, 0.012], m), '1D2F4D', 0.15);
  for (let k = 0; k < 9; k++) P.add(box(c.clone().addScaledVector(nrm, 0.04).add(V(0, -0.8 + k * 0.2, 0)), [0.9, 0.02, 0.006], m), ...frame);
  P.add(cyl([-0.6, 0, 1.12], 0.28, 1.55, 16, undefined, rot(90, 'X')), 'F1F0EB', 0.45);
  for (const y of [-0.79, 0.79]) P.add(cyl([-0.6, y, 1.12], 0.29, 0.04, 16, undefined, rot(90, 'X')), 'C9CACB', 0.45);
  for (const y of [-0.75, 0.75]) {
    P.add(bar([0.5, y, 0], [0.48, y, 0.25], 0.04), ...steel);
    P.add(bar([-0.8, y, 0], [-0.62, y, 0.86], 0.04), ...steel);
    P.add(bar([-0.3, y, 0], [-0.3, y, 0.86], 0.04), ...steel);
    P.add(bar([0.48, y, 0.22], [-0.3, y, 0.86], 0.04), ...steel);
    P.add(bar([0.5, y, 0.02], [-0.8, y, 0.02], 0.04), ...steel);
    P.add(box([-0.6, y, 0.86], [0.4, 0.06, 0.05]), ...steel);
  }
  for (const y of [-0.6, 0.6]) P.add(tube([[-0.27, y, 0.92], [-0.36, y, 0.98], [-0.45, y, 0.98]], 0.018, 6), 'B87333', 0.4);
  P.recenter();
}

export function waterTank(P: Prop) {
  const plastic = r('3A3E42', 0.6);
  P.add(box([0, 0, 0.075], [1.25, 1.25, 0.15]), 'B5B0A6', 0.9);
  P.add(cyl([0, 0, 0.75], 0.55, 1.2, 16), ...plastic);
  for (const z of [0.35, 0.75, 1.15]) P.add(cyl([0, 0, z], 0.57, 0.06, 16), '4A4F54', 0.6);
  P.add(cyl([0, 0, 1.41], 0.55, 0.12, 16, 0.25), ...plastic);
  P.add(cyl([0, 0, 1.49], 0.24, 0.06, 16), '5A6066', 0.6);
  P.add(tube([[0.5, 0, 0.3], [0.7, 0, 0.3], [0.72, 0, 0]], 0.03, 6), 'E3E1DA', 0.5);
  P.recenter();
}

export function acUnit(P: Prop) {
  const ring = r('9A9EA2', 0.5), metal = r('8E9499', 0.45), face = rot(90, 'Y');
  P.add(box([0, 0, 0.36], [0.3, 0.82, 0.56]), 'ECEBE5', 0.5);
  P.add(box([0, 0.3, 0.36], [0.31, 0.16, 0.5]), 'C9C8C2', 0.5);
  P.add(cyl([0.152, -0.12, 0.36], 0.215, 0.01, 20, undefined, face), ...ring);
  P.add(cyl([0.156, -0.12, 0.36], 0.2, 0.01, 20, undefined, face), '2E3134', 0.6);
  P.add(cyl([0.163, -0.12, 0.36], 0.05, 0.012, 12, undefined, face), ...ring);
  P.add(box([0.164, -0.12, 0.36], [0.006, 0.4, 0.015]), ...ring);
  P.add(box([0.164, -0.12, 0.36], [0.006, 0.015, 0.4]), ...ring);
  for (const y of [-0.3, 0.3]) {
    P.add(bar([-0.21, y, 0], [-0.21, y, 0.38], 0.03), ...metal);
    P.add(bar([-0.21, y, 0.065], [0.13, y, 0.065], 0.03), ...metal);
    P.add(bar([-0.21, y, 0.3], [0.06, y, 0.075], 0.025), ...metal);
  }
  for (const z of [0.14, 0.2]) P.add(tube([[0, 0.41, z], [-0.05, 0.46, z], [-0.21, 0.46, z]], 0.014, 6), 'E3E1DA', 0.5);
}

export function umbrella(P: Prop) {
  const N = 12, R = 1.2, apex = V(0, 0, 2.42), ribZ = 2.08, cols = ['2D6DB3', 'F2F0E8'];
  const ring = (a: number, rr: number, z: number) => V(rr * Math.cos(a), rr * Math.sin(a), z);
  for (let i = 0; i < N; i++) {
    const a0 = (2 * Math.PI * i) / N, a1 = (2 * Math.PI * (i + 1)) / N;
    const m0 = ring(a0, 0.6 * R, 2.3), m1 = ring(a1, 0.6 * R, 2.3), r0 = ring(a0, R, ribZ), r1 = ring(a1, R, ribZ);
    const low = r0.clone().add(r1).multiplyScalar(0.5).add(V(0, 0, -0.17));
    P.add(sheet([[apex, m0, m1], [m0, r0, r1, m1], [r1, r0, low]]), cols[i % 2], 0.85);
    P.add(bar(apex.clone().add(V(0, 0, -0.05)), ring(a0, R * 0.98, ribZ - 0.01), 0.012), '8E9499', 0.45);
  }
  P.add(tube([[0, 0, 0], [0, 0, 2.47]], 0.022, 8), 'E8E6E0', 0.5);
  P.add(cyl([0, 0, 1.85], 0.04, 0.12, 8), 'E8E6E0', 0.5);
  P.add(sphere(apex.clone().add(V(0, 0, 0.06)), [0.05, 0.05, 0.05], [8, 5]), 'E8E6E0', 0.5);
}

export function lounger(P: Prop) {
  const white = r('F0F0EC', 0.5), prof: [number, number][] = [[1, 0.36], [0.3, 0.36], [-0.3, 0.36], [-0.82, 0.8]];
  for (const y of [-0.32, 0.32]) {
    for (let i = 0; i < 3; i++) P.add(bar([prof[i][0], y, prof[i][1]], [prof[i + 1][0], y, prof[i + 1][1]], 0.045, 0.05), ...white);
    for (const x of [0.9, -0.2]) P.add(bar([x, y, 0], [x, y, 0.36], 0.045), ...white);
  }
  P.add(bar([0.9, -0.32, 0.12], [0.9, 0.32, 0.12], 0.03), ...white);
  P.add(bar([-0.2, -0.32, 0.12], [-0.2, 0.32, 0.12], 0.03), ...white);
  const strip = [];
  for (let i = 0; i < 3; i++) {
    const [x0, z0] = prof[i], [x1, z1] = prof[i + 1];
    strip.push([V(x0, -0.3, z0 + 0.02), V(x1, -0.3, z1 + 0.02), V(x1, 0.3, z1 + 0.02), V(x0, 0.3, z0 + 0.02)]);
  }
  P.add(sheet(strip), '2D7FB8', 0.85);
  P.add(box([-0.7, 0, 0.75], [0.24, 0.5, 0.08], rot(-40, 'Y')), 'F2F0E8', 0.85);
  P.recenter();
}

export function lifeguardTower(P: Prop) {
  const post = r('D9D4C8', 0.8), steel = r('7A8085', 0.45), blue = r('2A6DB5', 0.5), wall = r('F2EFE6', 0.8), glass = r('33505E', 0.1), rail = r('F2F2EE', 0.5);
  for (const x of [-1.2, 1.2]) for (const y of [-1.2, 1.2]) { P.add(box([x, y, 1.45], [0.18, 0.18, 2.9]), ...post); P.collide([x, y, 1.45], [0.2, 0.2, 2.9]); }
  for (const y of [-1.2, 1.2]) { P.add(bar([-1.2, y, 0.3], [1.2, y, 2.6], 0.07), ...steel); P.add(bar([1.2, y, 0.3], [-1.2, y, 2.6], 0.07), ...steel); }
  P.add(bar([1.2, -1.2, 0.3], [1.2, 1.2, 2.6], 0.07), ...steel);
  P.add(bar([1.2, 1.2, 0.3], [1.2, -1.2, 2.6], 0.07), ...steel);
  P.add(box([0, 0, 2.95], [3.2, 3.2, 0.18]), '8A7A66', 0.85);
  P.add(box([-0.25, 0, 4.1], [2.3, 2.5, 2.1]), ...wall);
  P.add(box([-0.25, 0, 3.2], [2.34, 2.54, 0.24]), ...blue);
  P.add(box([0.91, 0, 4.45], [0.04, 2.2, 0.85]), ...glass);
  for (const y of [-1.26, 1.26]) P.add(box([-0.25, y, 4.45], [1.8, 0.04, 0.85]), ...glass);
  for (const y of [-0.55, 0, 0.55]) P.add(box([0.935, y, 4.45], [0.02, 0.05, 0.85]), ...wall);
  P.add(box([-1.41, 0.5, 3.95], [0.04, 0.8, 1.75]), ...blue);
  P.add(box([-0.2, 0, 5.3], [3.0, 3.1, 0.16], rot(-6, 'Y')), ...blue);
  P.collide([-0.1, 0, 4.15], [3.2, 3.2, 2.5]);
  for (const y of [-1.5, -0.75, 0, 0.75, 1.5]) P.add(bar([1.5, y, 3.04], [1.5, y, 4.0], 0.05), ...rail);
  for (const z of [3.5, 4.0]) {
    P.add(bar([1.5, -1.53, z], [1.5, 1.53, z], 0.05), ...rail);
    for (const y of [-1.53, 1.53]) P.add(bar([1.5, y, z], [0.9, y, z], 0.05), ...rail);
  }
  const ring = [...Array(17).keys()].map((k) => { const a = (Math.PI * k) / 8; return V(1.56, 0.9 + 0.3 * Math.cos(a), 3.6 + 0.3 * Math.sin(a)); });
  for (let q = 0; q < 4; q++) P.add(tube(ring.slice(q * 4, q * 4 + 5), 0.06, 6), q % 2 ? 'E8452C' : 'F4F4F0', 0.6);
  for (const y of [-0.38, 0.38]) {
    P.add(bar([-2.6, y, 0], [-1.6, y, 2.95], 0.07, 0.05), ...steel);
    P.add(bar([-1.6, y, 2.95], [-1.55, y, 3.9], 0.05), ...steel);
  }
  for (let k = 1; k < 10; k++) { const t = k / 10, x = -2.6 + t, z = 2.95 * t; P.add(bar([x, -0.38, z], [x, 0.38, z], 0.06, 0.03), ...steel); }
  P.add(tube([[0.6, 1.3, 5.3], [0.6, 1.3, 7.3]], 0.03, 6), ...steel);
  P.add(sheet([[V(0.6, 1.3, 7.25), V(0.6, 2.05, 7.18), V(0.6, 2.05, 6.72), V(0.6, 1.3, 6.8)]]), 'D2302A', 0.85);
}

export function kiosk(P: Prop) {
  const oct = rot(22.5, 'Z'), green = r('2E4F48', 0.5), sign = r('F3EFE3', 0.6), roof = r('2E7466', 0.6), wood = r('A9773F', 0.7);
  P.add(cyl([0, 0, 0.08], 1.75, 0.16, 8, undefined, oct), 'B8B2A6', 0.9);
  P.add(cyl([0, 0, 0.66], 1.5, 1.0, 8, undefined, oct), 'E6D9BC', 0.8);
  P.add(cyl([0, 0, 1.75], 1.45, 1.18, 8, undefined, oct), '3C5560', 0.1);
  for (let k = 0; k < 8; k++) { const a = (22.5 + 45 * k) * Math.PI / 180;
    P.add(box([1.5 * Math.cos(a), 1.5 * Math.sin(a), 1.75], [0.07, 0.07, 1.18], rot(22.5 + 45 * k, 'Z')), ...green); }
  P.add(cyl([0, 0, 2.5], 1.55, 0.32, 8, undefined, oct), ...sign);
  P.add(box([1.445, 0, 2.5], [0.04, 0.9, 0.22]), 'C8352B', 0.5);
  P.add(cyl([0, 0, 2.72], 2.1, 0.12, 8, undefined, oct), ...roof);
  P.add(cyl([0, 0, 3.0], 2.0, 0.45, 8, 0.3, oct), ...roof);
  P.add(sphere([0, 0, 3.3], [0.12, 0.12, 0.12], [8, 5]), ...sign);
  P.add(box([1.6, 0, 1.12], [0.45, 1.3, 0.07]), ...wood);
  for (const y of [-0.6, 0.6]) P.add(bar([1.45, y, 0.16], [1.75, y, 1.09], 0.04), ...green);
  for (let k = 0; k < 7; k++) {
    const y0 = -0.75 + (k * 1.5) / 7, y1 = -0.75 + ((k + 1) * 1.5) / 7;
    P.add(sheet([[V(1.42, y0, 2.32), V(1.42, y1, 2.32), V(2.1, y1, 2.02), V(2.1, y0, 2.02)], [V(2.1, y0, 2.02), V(2.1, y1, 2.02), V(2.1, (y0 + y1) / 2, 1.88)]]),
      k % 2 === 0 ? 'C8352B' : 'F3EFE3', 0.85);
  }
  for (const y of [-0.45, 0.45]) { P.add(cyl([2.1, y, 0.38], 0.025, 0.76, 6), '8E9499', 0.45); P.add(cyl([2.1, y, 0.77], 0.17, 0.05, 10), ...wood); }
  // ponytail: octagonal prism r 1.56 approximated by its 2.88 m inscribed-face box (corners overreach ~0.5 m)
  P.collide([0, 0, 1.5], [2.88, 2.88, 3.0]);
}

export function bollard(P: Prop) {
  const dark = r('3B3F44', 0.45);
  P.add(cyl([0, 0, 0.02], 0.12, 0.04, 12), ...dark);
  P.add(cyl([0, 0, 0.45], 0.085, 0.86, 12), ...dark);
  P.add(sphere([0, 0, 0.88], [0.085, 0.085, 0.045], [12, 4]), ...dark);
  for (const z of [0.6, 0.72]) P.add(cyl([0, 0, z], 0.088, 0.05, 12), 'EDEDE8', 0.3);
  P.collide([0, 0, 0.46], [0.24, 0.24, 0.92]);
}

export function planter(P: Prop) {
  P.add(box([0, 0, 0.28], [1.2, 1.2, 0.56]), 'B9B2A4', 0.9);
  P.add(box([0, 0, 0.55], [1.08, 1.08, 0.04]), '4A3829', 1.0);
  const leaves = ['3D6A2E', '4F7D36'];
  const shrub: [[number, number, number], number][] = [[[0.18, 0.1, 0.85], 0.42], [[-0.25, -0.15, 0.8], 0.36], [[-0.12, 0.3, 0.9], 0.33], [[0.25, -0.3, 0.78], 0.3]];
  shrub.forEach(([c, rr], k) => P.add(blob(c, rr, 2, 0.25, k + 20), leaves[k % 2]));
  for (let k = 0; k < 7; k++) { const a = k * 2.4;
    P.add(blob([0.38 * Math.cos(a), 0.38 * Math.sin(a), 0.95 + 0.12 * Math.sin(k * 1.7)], 0.13, 1, 0.2, k + 40), 'C8337E', 0.7); }
  P.collide([0, 0, 0.28], [1.2, 1.2, 0.56]);
}

export function guardBooth(P: Prop) {
  const wall = r('F2EFE6', 0.8), glass = r('33505E', 0.1), frame = r('3A3F44', 0.45), trim = r('2A6DB5', 0.5);
  P.add(box([0, 0, 0.075], [2.2, 2.2, 0.15]), 'B5B0A6', 0.9);
  P.add(box([0, 0, 0.6], [1.9, 1.9, 0.9]), ...wall);
  P.add(box([0, 0, 1.075], [1.94, 1.94, 0.09]), ...trim);
  P.add(box([0, 0, 1.7], [1.86, 1.86, 1.16]), ...glass);
  P.add(box([0, 0, 2.29], [1.92, 1.92, 0.03]), ...frame);
  P.add(box([0, 0, 2.43], [1.9, 1.9, 0.3]), ...wall);
  P.add(box([0, 0, 2.66], [2.5, 2.5, 0.16]), ...trim);
  P.add(box([0, 0, 2.765], [2.44, 2.44, 0.05]), ...wall);
  for (const sx of [1, -1]) for (const sy of [1, -1]) P.add(box([sx * 0.92, sy * 0.92, 1.7], [0.08, 0.08, 1.16]), ...frame);
  for (const s of [1, -1]) P.add(box([0, s * 0.935, 1.7], [0.05, 0.03, 1.16]), ...frame);
  P.add(box([-0.935, 0, 1.7], [0.03, 0.05, 1.16]), ...frame);
  P.add(box([0.935, -0.2, 1.7], [0.03, 0.05, 1.16]), ...frame);
  P.add(box([0.955, 0.25, 1.1], [0.04, 0.8, 1.9]), '8A9096', 0.5);
  P.add(box([0.977, 0.25, 1.55], [0.01, 0.6, 0.75]), ...glass);
  P.add(box([0.985, -0.08, 1.05], [0.03, 0.12, 0.03]), ...frame);
  P.add(cyl([0.75, -0.75, 2.85], 0.07, 0.12, 10), ...trim);
  P.collide([0, 0, 1.4], [2.2, 2.2, 2.8]);
}

export function boomGate(P: Prop) {
  const dark = r('3A3F44', 0.45), red = r('D2302A', 0.5);
  P.add(box([0, 0, 0.025], [0.6, 0.6, 0.05]), ...dark);
  P.add(box([0, 0, 0.55], [0.5, 0.5, 1.0]), 'E8B923', 0.5);
  P.add(box([0, 0, 1.07], [0.54, 0.54, 0.04]), ...dark);
  P.add(cyl([0, 0, 1.13], 0.05, 0.08, 10), ...red);
  P.add(box([0.252, 0, 0.45], [0.006, 0.34, 0.6]), ...dark);
  P.add(cyl([0.3, 0, 0.95], 0.09, 0.1, 12, undefined, rot(90, 'Y')), ...dark);
  for (let i = 0; i < 10; i++) P.add(box([0.3, -0.4 - i * 0.8, 0.95], [0.08, 0.8, 0.12]), ...(i % 2 === 0 ? red : r('F4F4F0', 0.5)));
  P.add(box([0.3, 0.3, 0.95], [0.08, 0.6, 0.1]), ...dark);
  P.add(box([0.3, 0.5, 0.95], [0.16, 0.22, 0.26]), ...dark);
  P.collide([0, 0, 0.55], [0.5, 0.5, 1.1]);
}

export function jerseyBarrier(P: Prop) {
  const conc = r('B5B0A6', 0.9), dark = r('3A3F44', 0.45);
  const prof: [number, number][] = [[0.3, 0], [0.3, 0.075], [0.125, 0.33], [0.075, 0.8]];
  const ring = [...prof.map(([x, z]) => V(x, 0, z)), ...[...prof].reverse().map(([x, z]) => V(-x, 0, z))];
  const rings = [ring.map((p) => p.clone().add(V(0, 1, 0))), ring.map((p) => p.clone().add(V(0, -1, 0)))];
  P.add(skin(rings, [1, 2, 3, 4, 5]), ...conc);
  P.add(skin(rings, [0, 6, 7]), '8F887B', 0.95);
  P.add(cap(rings[0], true), ...conc);
  P.add(cap(rings[1]), ...conc);
  for (const s of [1, -1]) {
    P.add(box([s * 0.3, 0.5 * s, 0.04], [0.012, 0.3, 0.05]), ...dark);
    const y = 0.6 * s;
    P.add(tube([[0, y - 0.08, 0.79], [0, y - 0.06, 0.85], [0, y, 0.87], [0, y + 0.06, 0.85], [0, y + 0.08, 0.79]], 0.012, 5), ...dark);
  }
  // hull approximated by a foot box and a top box
  P.collide([0, 0, 0.165], [0.6, 2, 0.33]);
  P.collide([0, 0, 0.565], [0.25, 2, 0.47]);
}
