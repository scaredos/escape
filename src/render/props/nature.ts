// Trees and desert pieces (props.py palm, ficus, shrub, rock, acacia, hill).
import { Prop, V, Z, tube, sheet, sphere, blob, bar, icosphere, skin, noise, type V3 } from './kit';

const DEG = Math.PI / 180;

export function palm(P: Prop) {
  const H = 7.3, n = 30, rnd = P.rnd, pts: V3[] = [], rad: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(V(0.6 * t * t, 0.15 * Math.sin(t * 2.2), H * t));
    rad.push((0.26 - 0.07 * t + 0.16 * Math.max(0, 1 - t / 0.07)) * (i % 2 ? 1.08 : 0.93));
  }
  P.add(tube(pts, rad, 8, Math.PI / 8), '7A6650', 0.95);
  // trunk capsule r .3 from 0 to 7.3 m (curving .6 m toward +X) as two boxes
  P.collide([0.04, 0, 1.8], [0.6, 0.6, 3.6]);
  P.collide([0.33, 0, 5.45], [0.55, 0.55, 3.7]);
  const top = pts[n];
  P.add(sphere(top.clone().add(V(0, 0, 0.1)), [0.36, 0.36, 0.5], [8, 6]), '5E5034', 0.9);
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + 0.4, c = top.clone().add(V(Math.cos(a) * 0.42, Math.sin(a) * 0.42, -0.5));
    P.add(bar(top.clone().add(V(Math.cos(a) * 0.15, Math.sin(a) * 0.15, -0.05)), c.clone().add(V(0, 0, 0.2)), 0.04), 'C98B2E');
    P.add(sphere(c, [0.17, 0.17, 0.3], [6, 5]), 'D9822B', 0.6);
  }
  const N = 14, golden = 137.5 * DEG;
  for (let k = 0; k < N; k++) {
    const f = k / (N - 1), dry = k >= N - 2;
    const a = k * golden + rnd.uniform(-0.15, 0.15);
    const e = dry ? -62 * DEG : (68 - 95 * f + rnd.uniform(-5, 5)) * DEG;
    const L = (dry ? 2.6 : 3.1 + 0.9 * Math.min(1, f * 2)) + rnd.uniform(-0.25, 0.25);
    frond(P, top.clone().add(V(0, 0, 0.3)), a, e, L, 0.25 + 0.45 * f, dry ? '9C7A48' : k % 2 ? '5F7F38' : '7C9447');
  }
}

function frond(P: Prop, base: V3, a: number, e: number, L: number, sag: number, color: string, segs = 14, leaflet = 1.0) {
  const vees = [40 * DEG, -6 * DEG], d = V(Math.cos(a), Math.sin(a), 0), up0 = Z();
  const pts = [...Array(segs + 1).keys()].map((i) => { const t = i / segs;
    return base.clone().addScaledVector(d, L * t * Math.cos(e)).addScaledVector(up0, L * t * Math.sin(e) - sag * L * t * t); });
  const spine = pts.filter((_, i) => i % 2 === 0);
  P.add(tube(spine, spine.map((_, i) => 0.05 * (1 - (0.75 * i) / (spine.length - 1))), 3), color);
  const tris: V3[][] = [];
  for (let j = 2; j < segs; j++) {
    const t = j / segs, p0 = pts[j], p1 = pts[j + 1];
    const tan = p1.clone().sub(p0).normalize(), side = tan.clone().cross(up0).normalize(), up = side.clone().cross(tan);
    const w = leaflet * Math.min(1, (t - 0.05) / 0.3) * (1 - t) ** 0.6 + 0.08;
    for (const s of [1, -1]) vees.forEach((vee, row) => {
      const out = side.clone().multiplyScalar(s * Math.cos(vee)).addScaledVector(up, Math.sin(vee)).addScaledVector(tan, 0.4).normalize();
      const a0 = 0.5 * row;
      tris.push([p0.clone().lerp(p1, a0), p0.clone().lerp(p1, a0 + 0.7), p0.clone().lerp(p1, a0 + 0.3).addScaledVector(out, w * (1 - 0.15 * row))]);
    });
  }
  P.add(sheet(tris), color);
}

export function ficus(P: Prop) {
  const rnd = P.rnd, bark: [string, number] = ['857F74', 0.9];
  const trunk = [V(0, 0, 0), V(0.06, 0.02, 0.7), V(-0.05, 0.07, 1.4), V(0.05, -0.02, 2.0)];
  P.add(tube(trunk, [0.3, 0.23, 0.22, 0.2], 8), ...bark);
  P.collide([0, 0, 1.0], [0.64, 0.64, 2.0]);
  for (let k = 0; k < 5; k++) {
    const a = k * 1.26 + 0.3, c = Math.cos(a), s = Math.sin(a);
    P.add(tube([V(c * 0.7, s * 0.7, -0.03), V(c * 0.32, s * 0.32, 0.12), V(c * 0.08, s * 0.08, 0.7)], [0.06, 0.11, 0.12], 5), ...bark);
  }
  const top = trunk[3];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + 0.5 + rnd.uniform(-0.3, 0.3), c = Math.cos(a), s = Math.sin(a), out = rnd.uniform(1.1, 1.6);
    P.add(tube([top.clone().add(V(0, 0, -0.25)), top.clone().add(V(c * 0.35, s * 0.35, 0.45)), top.clone().add(V(c * out * 0.7, s * out * 0.7, 1.2)),
      top.clone().add(V(c * out, s * out, 1.9))], [0.15, 0.12, 0.09, 0.06], 6), ...bark);
  }
  const leaves = ['3D6A2E', '4F7D36', '2F5A27'];
  P.add(blob([0, 0, 4.3], 1.9, 3, 0.18, 1, [1.4, 1.4, 0.95]), leaves[0]);
  for (let k = 0; k < 7; k++) {
    const a = (k * 2 * Math.PI) / 7 + rnd.uniform(-0.2, 0.2);
    P.add(blob([Math.cos(a) * 1.75, Math.sin(a) * 1.75, 3.65 + rnd.uniform(0, 0.6)], rnd.uniform(1.05, 1.3), 2, 0.25, k + 2, [1, 1, 0.85]), leaves[(k % 2) + 1]);
  }
  P.add(blob([0.2, -0.1, 5.25], 1.15, 2, 0.25, 11), leaves[1]);
}

export function shrub(P: Prop) {
  const rnd = P.rnd, sage = '7E8456', dry = 'A39A6A';
  const clumps: [[number, number, number], number, string][] = [[[0, 0, 0.42], 0.48, sage], [[0.42, 0.2, 0.2], 0.3, dry], [[-0.35, 0.3, 0.22], 0.32, sage],
    [[-0.2, -0.4, 0.18], 0.28, dry], [[0.3, -0.35, 0.2], 0.27, sage]];
  clumps.forEach(([c, rr, col], k) => P.add(blob(c, rr, 2, 0.35, k + 60, [1.15, 1.15, 0.8]).map((p) => { p.z = Math.max(p.z, 0); }), col, 0.95));
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9 + rnd.uniform(-0.2, 0.2), d = V(Math.cos(a), Math.sin(a), 0);
    P.add(bar(d.clone().multiplyScalar(0.1).add(V(0, 0, 0.05)), d.clone().multiplyScalar(rnd.uniform(0.45, 0.65)).add(V(0, 0, rnd.uniform(0.6, 0.9))), 0.015), '6B5A45', 0.95);
  }
}

function stone(c: [number, number, number], size: [number, number, number], seed: number, sub: number) {
  const off = V(seed, seed * 1.7, seed * 0.6);
  return icosphere(sub).map((p) => {
    const n = p.clone().normalize();
    let k = 1 + 0.25 * noise(n.clone().multiplyScalar(1.3).add(off)) + 0.1 * noise(n.clone().multiplyScalar(3.1).add(off));
    const z = Math.min(n.z * size[2] * k, size[2] * 0.8);
    k *= 1 - 0.07 * (Math.abs(Math.trunc((z + c[2]) / 0.3)) % 2); // alternate 30 cm beds
    p.set(c[0] + n.x * size[0] * k, c[1] + n.y * size[1] * k, Math.max(c[2] + z, 0));
  });
}

export function rock(P: Prop) {
  P.add(stone([0, 0, 0.75], [1.45, 1.2, 1.3], 2, 3), 'BFB298', 0.9);
  P.add(stone([1.45, 0.95, 0.12], [0.35, 0.3, 0.25], 5, 2), '9C8E72', 0.95);
  P.add(stone([-1.25, -1.1, 0.1], [0.28, 0.22, 0.2], 9, 2), '9C8E72', 0.95);
  // hull of the boulder approximated by a core box and a wider low box
  P.collide([0, 0, 0.9], [2.0, 1.6, 1.8]);
  P.collide([0, 0, 0.45], [2.6, 2.1, 0.9]);
}

export function acacia(P: Prop) {
  const rnd = P.rnd, bark: [string, number] = ['5E4C3A', 0.9], leaf: [string, number] = ['6B7A3A', 0.9], light: [string, number] = ['8A9450', 0.9];
  const trunk = [V(0, 0, 0), V(0.1, 0.05, 0.8), V(0.25, 0.1, 1.6), V(0.3, 0.12, 2.1)];
  P.add(tube(trunk, [0.3, 0.22, 0.19, 0.17], 7), ...bark);
  P.collide([0.15, 0.06, 1.05], [0.75, 0.64, 2.1]);
  const top = trunk[3];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + 0.4 + rnd.uniform(-0.25, 0.25), d = V(Math.cos(a), Math.sin(a), 0), out = rnd.uniform(1.9, 2.6);
    const at = (s: number, z: number) => top.clone().addScaledVector(d, s).add(V(0, 0, z));
    P.add(tube([at(0, -0.2), at(0.6, 0.7), at(out * 0.75, 1.9), at(out, 2.9)], [0.14, 0.11, 0.08, 0.05], 6), ...bark);
  }
  P.add(blob([0.3, 0.1, 5.35], 2.6, 3, 0.22, 3, [1.25, 1.2, 0.2]), ...leaf);
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5 + 0.3 + rnd.uniform(-0.2, 0.2);
    P.add(blob([0.3 + Math.cos(a) * 2.4, 0.1 + Math.sin(a) * 2.3, 5.2 + rnd.uniform(-0.1, 0.15)], 1.2, 2, 0.3, k + 70, [1, 1, 0.3]), ...(k % 2 ? light : leaf));
  }
}

/** Height of the hill at normalised radius r (spec 01 §21). */
export function hillHeight(r: number) {
  const H = 15, top = 0.45, s = H / (1 - top / 2);
  return r < top ? H - (s * r * r) / (2 * top) : s * (1 - r);
}

export function hill(P: Prop) {
  const R = 50, segs = 32, rings = 8, pts: V3[][] = [];
  for (let i = 0; i < rings + 2; i++) {
    const r = i <= rings ? i / rings : 1.04, ring: V3[] = [];
    for (let k = 0; k < segs; k++) {
      const a = (2 * Math.PI * k) / segs, x = R * r * Math.cos(a), y = R * r * Math.sin(a);
      ring.push(V(x, y, i <= rings ? hillHeight(r) + 0.6 * (1 - r) * noise(V(x * 0.035, y * 0.035, 3.3)) : -0.5));
    }
    pts.push(ring);
  }
  P.add(skin(pts.reverse()), 'C9A878', 0.95);
  // ponytail: convex hull as 5 stacked square terraces (inscribed in the cone); use a heightfield from the mesh if players walk on it
  for (const h of [0, 3, 6, 9, 12]) {
    const top = h + 3, r = top >= 15 ? 0 : (() => { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (hillHeight(m) > top) lo = m; else hi = m; } return lo; })();
    const half = Math.max(R * r * 0.7, 3);
    P.collide([0, 0, (h + Math.min(top, 15)) / 2 - 0.25], [2 * half, 2 * half, Math.min(top, 15) - h + 0.5]);
  }
}
