// Far-distance LODs (seen from 100-900 m): same pivot, frame, bounds and part colours as the full props,
// about 10-15 % of the triangles. Built with the same Prop/kit pipeline, so `color` + `rough` attributes match.
import * as THREE from 'three';
import { Prop, Mesh, V, box, cyl, bar, tube, sheet, blob, skin, cap, drop, rot, T, mul, noise, icosphere, type V3 } from './kit';

type R = [string, number];
const r = (hex: string, rough = 0.75): R => [hex, rough];

/** Single-sided quad a-b-c-d, wound so it faces `n`. */
function quad(pts: V3[], n: V3): Mesh {
  const m = cap(pts), f = m.f[0], a = m.v[f[0]], b = m.v[f[1]], c = m.v[f[2]];
  if (b.clone().sub(a).cross(c.clone().sub(a)).dot(n) < 0) m.f = m.f.map((x) => [...x].reverse());
  return m;
}
const noEnds = (m: Mesh) => drop(m, [0, 1]);
/** Open n-sided prism (no caps) from a to b: thin posts. */
const post = (a: [number, number, number], b: [number, number, number], rad: number, n = 3) => tube([a, b], rad, n, 0, false);
/** Cylinder without caps / with only the top cap. */
const side = (c: [number, number, number], rr: number, h: number, segs: number, r2?: number, m?: THREE.Matrix4) => drop(cyl(c, rr, h, segs, r2, m), [segs, segs + 1]);
const noBottom = (c: [number, number, number], rr: number, h: number, segs: number, r2?: number, m?: THREE.Matrix4) => drop(cyl(c, rr, h, segs, r2, m), [segs + 1]);

// ---------------------------------------------------------------- trees and nature
function palm(P: Prop) {
  const H = 7.3, pts: V3[] = [];
  for (let i = 0; i <= 3; i++) { const t = i / 3; pts.push(V(0.6 * t * t, 0.15 * Math.sin(t * 2.2), H * t)); }
  P.add(tube(pts, [0.34, 0.24, 0.22, 0.2], 5, 0, false), '7A6650', 0.95); // 30
  const top = pts[3];
  P.add(blob(top.clone().add(V(0, 0, 0.1)), 0.42, 1, 0, 0, [0.9, 0.9, 1.2]), '5E5034', 0.9); // 20
  const N = 10, golden = 137.5 * Math.PI / 180, base = top.clone().add(V(0, 0, 0.3)), rnd = P.rnd;
  for (let k = 0; k < N; k++) { // each frond: two V-folded leaf tris, double sided = 4 tris
    const f = k / (N - 1), dry = k >= N - 2, a = k * golden + rnd.uniform(-0.15, 0.15);
    const e = dry ? -62 * Math.PI / 180 : (68 - 95 * f) * Math.PI / 180, L = dry ? 2.6 : 3.1 + 0.9 * Math.min(1, f * 2), sag = 0.25 + 0.45 * f;
    const d = V(Math.cos(a), Math.sin(a), 0), at = (t: number) => base.clone().addScaledVector(d, L * t * Math.cos(e)).add(V(0, 0, L * t * Math.sin(e) - sag * L * t * t));
    const mid = at(0.5), tip = at(1), tan = tip.clone().sub(base).normalize(), sd = tan.clone().cross(V(0, 0, 1)).normalize(), up = sd.clone().cross(tan);
    const w = 0.75, l = mid.clone().addScaledVector(sd, w).addScaledVector(up, 0.25), rr = mid.clone().addScaledVector(sd, -w).addScaledVector(up, 0.25);
    P.add(sheet([[base, l, tip], [base, tip, rr]]), dry ? '9C7A48' : k % 2 ? '5F7F38' : '7C9447');
  }
}

function ficus(P: Prop) {
  P.add(tube([V(0, 0, 0), V(0.05, -0.02, 3.2)], [0.3, 0.2], 5, 0, false), '857F74', 0.9); // 10
  P.add(blob([0, 0, 4.3], 1.9, 1, 0.18, 1, [1.45, 1.45, 1.0]), '3D6A2E'); // 20 each
  P.add(blob([1.3, 1.0, 3.9], 1.25, 1, 0.25, 2, [1, 1, 0.85]), '4F7D36');
  P.add(blob([-1.2, 1.1, 3.9], 1.2, 1, 0.25, 3, [1, 1, 0.85]), '2F5A27');
  P.add(blob([-0.3, -1.6, 3.9], 1.2, 1, 0.25, 4, [1, 1, 0.85]), '4F7D36');
  P.add(blob([0.2, -0.1, 5.25], 1.15, 1, 0.25, 11), '4F7D36');
}

function acacia(P: Prop) {
  const bark: R = ['5E4C3A', 0.9], top = V(0.3, 0.12, 2.1), rnd = P.rnd;
  P.add(tube([V(0, 0, 0), top], [0.3, 0.17], 5, 0, false), ...bark); // 10
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + 0.4 + rnd.uniform(-0.25, 0.25), d = V(Math.cos(a), Math.sin(a), 0), out = rnd.uniform(1.9, 2.6);
    P.add(tube([top.clone().add(V(0, 0, -0.2)), top.clone().addScaledVector(d, out).add(V(0, 0, 2.9))], [0.12, 0.05], 3, 0, false), ...bark); // 6
  }
  P.add(blob([0.3, 0.1, 5.35], 2.6, 1, 0.22, 3, [1.25, 1.2, 0.2]), '6B7A3A', 0.9);
  P.add(blob([0.3 + 2.0, 0.1 + 1.2, 5.2], 1.3, 1, 0.3, 70, [1, 1, 0.3]), '8A9450', 0.9);
  P.add(blob([0.3 - 1.9, 0.1 - 1.3, 5.25], 1.3, 1, 0.3, 71, [1, 1, 0.3]), '8A9450', 0.9);
}

function shrub(P: Prop) {
  P.add(blob([0, 0, 0.36], 0.66, 1, 0.3, 60, [1.15, 1.05, 0.75]).map((p) => { p.z = Math.max(p.z, 0); }), '7E8456', 0.95); // 20
}

function rock(P: Prop) {
  const off = V(2, 3.4, 1.2);
  P.add(icosphere(1).map((p) => { const n = p.clone().normalize(), k = 1 + 0.2 * noise(n.clone().multiplyScalar(1.3).add(off));
    p.set(n.x * 1.45 * k, n.y * 1.2 * k, Math.max(0.75 + Math.min(n.z * 1.3 * k, 1.04), 0)); }), 'BFB298', 0.9); // 20
}

// ---------------------------------------------------------------- street / roof / beach
function streetLamp(P: Prop) {
  P.add(tube([[0, 0, 0], [0, 0, 7.0], [0.6, 0, 7.75], [2.15, 0, 7.88]], [0.13, 0.075, 0.065, 0.05], 4, Math.PI / 4, false), '8E9499', 0.45); // 24
  P.add(box([2.4, 0, 7.84], [0.8, 0.34, 0.15], rot(4, 'Y')), '4A4F55', 0.5); // 12
}

function busStop(P: Prop) {
  P.add(box([-0.05, 0, 2.55], [1.75, 3.85, 0.1], rot(-3, 'Y')), 'D8D8D2', 0.6);
  P.add(box([-0.7, 0, 1.2], [0.06, 3.5, 2.0]), '9EC4D0', 0.08);
  P.add(box([-0.05, 1.75, 1.2], [1.2, 0.12, 1.9]), 'F2B33D', 0.4);
}

function solarHeater(P: Prop) {
  const tilt = 40, c = V(0.1, 0, 0.25 + 0.5 * Math.sin(tilt * Math.PI / 180));
  P.add(box(c, [1, 2, 0.06], rot(tilt, 'Y')), '1D2F4D', 0.15);
  P.add(box([-0.6, 0, 1.12], [0.5, 1.6, 0.5]), 'F1F0EB', 0.45);
  P.recenter();
}

function waterTank(P: Prop) {
  P.add(box([0, 0, 0.075], [1.25, 1.25, 0.15]), 'B5B0A6', 0.9); // 12
  P.add(noBottom([0, 0, 0.83], 0.56, 1.36, 6, 0.42), '3A3E42', 0.6); // 12 + 4
  P.recenter();
}

function acUnit(P: Prop) {
  P.add(drop(box([0, 0, 0.36], [0.3, 0.82, 0.56]), [0]), 'ECEBE5', 0.5); // 10
  P.add(quad([V(0.152, -0.32, 0.16), V(0.152, 0.08, 0.16), V(0.152, 0.08, 0.56), V(0.152, -0.32, 0.56)], V(1, 0, 0)), '2E3134', 0.6); // 2
}

function umbrella(P: Prop) {
  const apex = V(0, 0, 2.42), ring = (a: number) => V(1.2 * Math.cos(a), 1.2 * Math.sin(a), 2.08);
  for (let i = 0; i < 6; i++) { const a0 = (i * Math.PI) / 3, a1 = ((i + 1) * Math.PI) / 3;
    P.add(sheet([[apex, ring(a0), ring(a1)]]), i % 2 ? 'F2F0E8' : '2D6DB3', 0.85); } // 12
  P.add(post([0, 0, 0], [0, 0, 2.42], 0.03), 'E8E6E0', 0.5); // 6
}

function lounger(P: Prop) {
  P.add(sheet([[V(1, -0.3, 0.38), V(-0.3, -0.3, 0.38), V(-0.3, 0.3, 0.38), V(1, 0.3, 0.38)],
    [V(-0.3, -0.3, 0.38), V(-0.82, -0.3, 0.82), V(-0.82, 0.3, 0.82), V(-0.3, 0.3, 0.38)]]), '2D7FB8', 0.85); // 8
  for (const s of [1, -1]) P.add(quad([V(0.9, s * 0.32, 0), V(-0.2, s * 0.32, 0), V(-0.2, s * 0.32, 0.36), V(0.9, s * 0.32, 0.36)], V(0, s, 0)), 'F0F0EC', 0.5); // 4
  P.recenter();
}

function bench(P: Prop) {
  P.add(box([0, 0, 0.45], [0.43, 1.8, 0.04]), 'B07A45', 0.8);
  P.add(box([-0.3, 0, 0.7], [0.04, 1.8, 0.32], rot(-16.6, 'Y')), 'B07A45', 0.8);
  P.recenter();
}

function bin(P: Prop) {
  P.add(noBottom([0, 0, 0.69], 0.25, 0.64, 5), '2F6A47', 0.55); // 13
  P.add(post([-0.31, 0, 0], [-0.31, 0, 1.2], 0.035), '8E9499', 0.45); // 6
}

function planter(P: Prop) {
  P.add(drop(box([0, 0, 0.28], [1.2, 1.2, 0.56]), [0]), 'B9B2A4', 0.9); // 10
  P.add(blob([0, 0, 0.82], 0.55, 1, 0.25, 20, [1, 1, 0.75]), '3D6A2E'); // 20
}

function kiosk(P: Prop) {
  const oct = rot(22.5, 'Z');
  P.add(side([0, 0, 0.58], 1.5, 1.16, 8, undefined, oct), 'E6D9BC', 0.8); // 16
  P.add(side([0, 0, 1.75], 1.47, 1.18, 8, undefined, oct), '3C5560', 0.1); // 16
  P.add(drop(cyl([0, 0, 2.95], 2.1, 0.55, 8, 0.3, oct), [8]), '2E7466', 0.6); // 16 + 6
}

function lifeguardTower(P: Prop) {
  for (const x of [-1.2, 1.2]) for (const y of [-1.2, 1.2]) P.add(post([x, y, 0], [x, y, 2.9], 0.1), 'D9D4C8', 0.8); // 24
  P.add(box([0, 0, 2.95], [3.2, 3.2, 0.18]), '8A7A66', 0.85);
  P.add(box([-0.25, 0, 4.1], [2.3, 2.5, 2.1]), 'F2EFE6', 0.8);
  P.add(box([-0.2, 0, 5.3], [3.0, 3.1, 0.16], rot(-6, 'Y')), '2A6DB5', 0.5);
}

function guardBooth(P: Prop) {
  P.add(drop(box([0, 0, 0.55], [1.9, 1.9, 1.1]), [0]), 'F2EFE6', 0.8);
  P.add(side([0, 0, 1.7], 1.31, 1.16, 4, undefined, rot(45, 'Z')), '33505E', 0.1); // square band, 8
  P.add(box([0, 0, 2.62], [2.5, 2.5, 0.25]), '2A6DB5', 0.5);
  P.add(box([0, 0, 0.075], [2.2, 2.2, 0.15]), 'B5B0A6', 0.9);
}

function boomGate(P: Prop) {
  P.add(drop(box([0, 0, 0.55], [0.5, 0.5, 1.1]), [0]), 'E8B923', 0.5);
  for (let i = 0; i < 10; i++) P.add(drop(box([0.3, -0.4 - i * 0.8, 0.95], [0.08, 0.8, 0.12]), [0, 2, 4]), i % 2 ? 'F4F4F0' : 'D2302A', 0.5); // 6 each
}

function jerseyBarrier(P: Prop) {
  const prof: [number, number][] = [[0.3, 0], [0.125, 0.33], [0.075, 0.8]];
  const ring = [...prof.map(([x, z]) => V(x, 0, z)), ...[...prof].reverse().map(([x, z]) => V(-x, 0, z))];
  const rings = [ring.map((p) => p.clone().add(V(0, 1, 0))), ring.map((p) => p.clone().add(V(0, -1, 0)))];
  P.add(skin(rings, [0, 1, 2, 3, 4]), 'B5B0A6', 0.9);
  P.add(cap(rings[0], true), 'B5B0A6', 0.9);
  P.add(cap(rings[1]), 'B5B0A6', 0.9);
}

function bollard(P: Prop) { P.add(noBottom([0, 0, 0.46], 0.09, 0.92, 6), '3B3F44', 0.45); }

// ---------------------------------------------------------------- venue set pieces
function crate(P: Prop, lid: boolean) {
  if (lid) { P.add(drop(box([0, 0, 0.31], [0.83, 0.83, 0.62]), [0]), 'B8894F', 0.85); return; }
  P.add(drop(box([0, 0, 0.28], [0.83, 0.83, 0.56]), [0, 1]), 'B8894F', 0.85); // 8 outer walls
  const inner = drop(box([0, 0, 0.28], [0.74, 0.74, 0.56]), [0, 1]); inner.f = inner.f.map((f) => [...f].reverse());
  P.add(inner, '4E3824', 0.95); // 8 inner walls
  P.add(quad([V(-0.37, -0.37, 0.06), V(0.37, -0.37, 0.06), V(0.37, 0.37, 0.06), V(-0.37, 0.37, 0.06)], V(0, 0, 1)), '4E3824', 0.95);
  P.add(box(V(0, 0, 0).applyMatrix4(mul(T(-0.4955, 0, 0.39), rot(-70, 'Y'))), [0.83, 0.81, 0.035], rot(-70, 'Y')), 'B8894F', 0.85);
}

function cashBag(P: Prop) {
  P.add(tube([[-0.35, 0, 0.16], [-0.3, 0, 0.16], [0.3, 0, 0.16], [0.35, 0, 0.16]], [0.1, 0.18, 0.18, 0.1], 6).map((p) => { p.y *= 0.95; p.z = Math.max(p.z, 0); }), '3E6B3A', 0.9);
  P.add(side([0, 0, 0.16], 0.2, 0.04, 6, undefined, rot(90, 'Y')), '22251F', 0.8);
}

function shopCounter(P: Prop) {
  P.add(drop(box([0, 0, 0.53], [0.76, 3.0, 1.06]), [0]), '4C5560', 0.6);
  P.add(box([0.02, 0, 1.08], [0.84, 3.06, 0.04]), 'C9A66B', 0.6);
  P.add(drop(box([-0.62, 0, 1.0], [0.4, 3.0, 2.0]), [0]), '8E9499', 0.45);
  const goods = ['2D6DB3', 'E8B923', 'B33A2E', 'EDEBE4'];
  goods.forEach((c, k) => P.add(quad([V(-0.415, -1.47, 0.1 + k * 0.47), V(-0.415, 1.47, 0.1 + k * 0.47), V(-0.415, 1.47, 0.45 + k * 0.47), V(-0.415, -1.47, 0.45 + k * 0.47)], V(1, 0, 0)), c, 0.5));
}

function slotMachine(P: Prop) {
  P.add(drop(box([-0.02, 0, 0.4], [0.64, 0.9, 0.8]), [0]), '5B1E7A', 0.4);
  P.add(box([-0.04, 0, 1.25], [0.6, 0.86, 0.9]), '5B1E7A', 0.4);
  P.add(cyl([-0.04, 0, 1.7], 1, 1, 6, undefined, mul(rot(90, 'Y'), new THREE.Matrix4().makeScale(0.3, 0.43, 0.58))).map((p) => { p.z = Math.max(p.z, 1.7); }), '5B1E7A', 0.4);
  P.add(quad([V(0.275, -0.35, 1.02), V(0.275, 0.35, 1.02), V(0.275, 0.35, 1.58), V(0.275, -0.35, 1.58)], V(1, 0, 0)), 'D4A637', 0.3);
}

function burgerCounter(P: Prop) {
  P.add(drop(box([0, 0, 0.52], [0.86, 3.0, 1.04]), [0]), 'C8202A', 0.5);
  P.add(box([0.02, 0, 1.07], [0.94, 3.06, 0.06]), '9AA0A6', 0.4);
  P.add(drop(box([-0.55, 0, 1.3], [0.1, 3.0, 2.6]), [0]), 'C8202A', 0.5);
  P.add(quad([V(0.44, -1.5, 0.8), V(0.44, 1.5, 0.8), V(0.44, 1.5, 0.92), V(0.44, -1.5, 0.92)], V(1, 0, 0)), 'F2B705', 0.5);
  P.add(quad([V(-0.495, -1.4, 1.76), V(-0.495, 1.4, 1.76), V(-0.495, 1.4, 2.48), V(-0.495, -1.4, 2.48)], V(1, 0, 0)), 'F5E6B8', 0.4);
}

function vault(P: Prop, open: boolean) {
  P.add(drop(box([0, 0, 1.06], [2.0, 2.0, 2.12]), [0]), '8C9196', 0.4);
  const ax = rot(90, 'Y');
  let m = T(-0.06, 0, 0);
  if (open) {
    m = mul(T(1.11, 0.87, 0), rot(100, 'Z'), T(-1.11, -0.87, 0), m);
    P.add(quad([V(1.005, -0.62, 0.48), V(1.005, 0.62, 0.48), V(1.005, 0.62, 1.72), V(1.005, -0.62, 1.72)], V(1, 0, 0)), '6E747A', 0.6);
  }
  P.add(cyl([1.12, 0, 1.1], 0.8, 0.2, 8, undefined, ax).apply(m), 'B4B9BE', 0.3); // 28
}

function forgerDesk(P: Prop) {
  P.add(box([0, 0, 0.73], [1.0, 1.8, 0.04]), '5A3A22', 0.7);
  P.add(drop(box([0, -0.6, 0.355], [0.9, 0.5, 0.71]), [0, 1]), '5A3A22', 0.7);
  P.add(drop(box([0.46, 0.245, 0.445], [0.02, 1.19, 0.49]), [0, 1]), '5A3A22', 0.7);
  P.add(quad([V(-0.2, -0.3, 0.755), V(0.3, -0.3, 0.755), V(0.3, 0.4, 0.755), V(-0.2, 0.4, 0.755)], V(0, 0, 1)), 'F2F0E8', 0.8);
}

function checkInDesk(P: Prop) {
  for (const y of [-1.9, 1.9]) {
    P.add(drop(box([0.33, y, 0.56], [0.56, 2.24, 1.12]), [0]), 'E8E8E4', 0.4);
    P.add(quad([V(-0.515, y - 0.8, 1.8), V(-0.515, y + 0.8, 1.8), V(-0.515, y + 0.8, 2.2), V(-0.515, y - 0.8, 2.2)], V(1, 0, 0)), 'F2F2EE', 0.5);
  }
  P.add(drop(box([0.08, 0, 0.21], [1.05, 1.56, 0.42]), [0]), '9AA0A6', 0.4);
  P.add(drop(box([-0.56, 0, 1.2], [0.08, 6.0, 2.4]), [0]), '1F4FA0', 0.5);
}

function parcelStack(P: Prop) {
  P.add(drop(box([0, 0, 0.07], [1.1, 1.0, 0.14]), [0]), 'A08A68', 0.9);
  P.add(drop(box([0, 0, 0.34], [1.04, 0.98, 0.4]), [0, 1]), 'B8895A', 0.9);
  P.add(drop(box([0, 0.02, 0.72], [1.0, 0.98, 0.36]), [0]), 'A27648', 0.9);
  P.add(drop(box([-0.08, 0, 1.04], [0.86, 0.72, 0.3]), [0]), 'B8895A', 0.9);
}

// ---------------------------------------------------------------- port
function boat(P: Prop) {
  const pos = (x: number) => Math.max(0, x), D = 0.72;
  const width = (x: number) => Math.max(0.03, 1.4 * Math.cos(Math.min(1, pos((x - 0.6) / 3.4)) * Math.PI / 2) ** 0.75 * (1 - 0.14 * pos((-x - 2) / 2) ** 2));
  const keel = (x: number) => -0.6 + 0.85 * pos((x - 1.8) / 2.2) ** 1.6 + 0.1 * pos(-x - 3);
  const sheer = (x: number) => 1.15 + 0.4 * pos((x - 0.5) / 3.5) ** 2 + 0.06 * pos((-x - 2) / 2);
  const rings = [-4, -1.8, 1.6, 3.0, 4.0].map((x) => {
    const w = width(x), k = keel(x), s = sheer(x), zw = Math.max(0.02, k + 0.1 * (s - k));
    return [V(x, 0, k), V(x, 0.9 * w, zw), V(x, w, s - 0.3), V(x, w, s), V(x, 0, D), V(x, -w, s), V(x, -w, s - 0.3), V(x, -0.9 * w, zw)];
  });
  P.add(skin(rings, [0, 7]), '7A2A22', 0.7);
  P.add(skin(rings, [1, 6]), 'F2F1EC', 0.5);
  P.add(skin(rings, [2, 5]), '1F5FA8', 0.5);
  P.add(skin(rings, [3, 4]), 'A8957A', 0.85); // 64
  P.add(cap(rings[0], true), 'F2F1EC', 0.5);
  P.add(cap(rings[4]), 'F2F1EC', 0.5);
  P.add(drop(box([-0.6, 0, 0.72 + 1.1], [1.8, 1.7, 2.2]), [0]), 'F2F1EC', 0.5);
  P.add(box([-0.6, 0, D + 2.26], [2.1, 1.95, 0.12]), '1F5FA8', 0.5);
  P.add(post([-0.9, 0, D + 2.3], [-0.9, 0, 6.2], 0.06), 'F2F1EC', 0.5);
  P.add(noEnds(bar([-0.9, -0.75, 5.4], [-0.9, 0.75, 5.4], 0.05)), 'F2F1EC', 0.5);
}

function container(P: Prop, body: string, frame: string) {
  const L = 12.19, W = 2.44, H = 2.59, hx = L / 2, hy = W / 2;
  P.add(drop(box([0, 0, H / 2], [L, W, H]), [0]), body, 0.6); // 10
  P.add(quad([V(hx + 0.01, -hy, 0), V(hx + 0.01, hy, 0), V(hx + 0.01, hy, H), V(hx + 0.01, -hy, H)], V(1, 0, 0)), frame, 0.6);
  P.add(quad([V(-hx - 0.01, -hy, 0), V(-hx - 0.01, hy, 0), V(-hx - 0.01, hy, H), V(-hx - 0.01, -hy, H)], V(-1, 0, 0)), frame, 0.6);
  for (const s of [1, -1]) for (const [z0, z1] of [[0, 0.16], [H - 0.14, H]]) {
    const y = s * (hy + 0.01);
    P.add(quad([V(-hx, y, z0), V(hx, y, z0), V(hx, y, z1), V(-hx, y, z1)], V(0, s, 0)), frame, 0.6);
  }
}

function portCrane(P: Prop) {
  const red: R = ['C23B2E', 0.6], white: R = ['EDEDE8', 0.6], dark: R = ['4E5459', 0.5], LX = 8, LY = 9, G = 2.6;
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) P.add(drop(box([sx * LX, sy * LY, 15.0], [1.3, 1.3, 30.0]), [0, 1]), ...red); // 8 each
    P.add(box([sx * LX, 0, 29], [1.5, 2 * LY + 1.3, 2.6]), ...white);
    P.add(drop(box([0, sx * LY, 13], [2 * LX - 1.3, 1.0, 1.4]), [3, 5]), ...red);
  }
  for (const gy of [-G, G]) {
    P.add(box([9.1, gy, 31.55], [58.2, 1.15, 2.2]), ...white);
    P.add(noEnds(bar([LX, gy, 32.7], [5, gy, 44.6], 1.0)), ...red);
    P.add(noEnds(bar([-LX, gy, 32.7], [5, gy, 44.6], 1.0)), ...red);
    P.add(noEnds(bar([5, gy, 44.6], [37, gy, 32.6], 0.3)), ...dark);
  }
  P.add(box([5, 0, 44.8], [1.2, 2 * G + 1.2, 1.2]), ...red);
  P.add(drop(box([-15.5, 0, 34.9], [7.0, 7.4, 4.4]), [0]), ...white);
  P.add(box([22, 0, 33.4], [4.0, 6.4, 1.4]), ...dark);
  P.add(drop(box([20.5, -1.4, 28.9], [2.6, 2.4, 2.4]), [1]), ...white);
  P.add(box([22, 0, 17.5], [2.3, 12.0, 0.6]), 'E8B923', 0.5);
}

export const LOD_BUILDERS: Record<string, (P: Prop) => void> = {
  Palm: palm, Ficus: ficus, Acacia: acacia, Shrub: shrub, Rock: rock, StreetLamp: streetLamp, BusStop: busStop,
  SolarHeater: solarHeater, WaterTank: waterTank, ACUnit: acUnit, Umbrella: umbrella, Lounger: lounger, Bench: bench,
  Bin: bin, Planter: planter, Kiosk: kiosk, LifeguardTower: lifeguardTower, GuardBooth: guardBooth, BoomGate: boomGate,
  JerseyBarrier: jerseyBarrier, Bollard: bollard, Crate: (P) => crate(P, true), CrateOpen: (P) => crate(P, false),
  CashBag: cashBag, ShopCounter: shopCounter, SlotMachine: slotMachine, BurgerCounter: burgerCounter,
  Vault: (P) => vault(P, false), VaultOpen: (P) => vault(P, true), ForgerDesk: forgerDesk, CheckInDesk: checkInDesk,
  ParcelStack: parcelStack, Boat: boat, PortCrane: portCrane,
  ContainerRed: (P) => container(P, '9E3B2E', '7E2E24'), ContainerBlue: (P) => container(P, '2B5D8F', '22496F'),
  ContainerGreen: (P) => container(P, '3F6E47', '2F5436'), ContainerGrey: (P) => container(P, '8C9196', '6E7378'),
};
