// Port of the bmesh helpers in kit/reference/blender/props.py. Parts are polygon meshes in the SOURCE frame
// (x forward, y left, z up), fan-triangulated into GeoBuilder at the end. Winding: CCW seen from outside.
import * as THREE from 'three';
import { GeoBuilder, mergeVertices, DEG, type BoxCollider, type Vec3 } from '../geo';

export type V3 = THREE.Vector3;
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const Z = () => V(0, 0, 1);
const asV = (p: V3 | Vec3) => (p instanceof THREE.Vector3 ? p.clone() : V(p[0], p[1], p[2]));
type P3 = V3 | Vec3;

export function rot(deg: number, axis: 'X' | 'Y' | 'Z'): THREE.Matrix4 {
  const m = new THREE.Matrix4(), a = deg * DEG;
  return axis === 'X' ? m.makeRotationX(a) : axis === 'Y' ? m.makeRotationY(a) : m.makeRotationZ(a);
}
export const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
export const mul = (...ms: THREE.Matrix4[]) => ms.reduce((a, b) => a.clone().multiply(b));

/** Polygon mesh (like a bmesh): vertices + faces of vertex indices. */
export class Mesh {
  v: V3[] = []; f: number[][] = [];
  apply(m: THREE.Matrix4) { for (const p of this.v) p.applyMatrix4(m); return this; }
  map(fn: (p: V3) => void) { for (const p of this.v) fn(p); return this; }
  push(pts: V3[], face = true) { const i0 = this.v.length; this.v.push(...pts); if (face) this.f.push(pts.map((_, k) => i0 + k)); return i0; }
}

// ---------------------------------------------------------------- deterministic randomness + noise
export function rng(seed: string | number) {
  let a = typeof seed === 'number' ? seed : [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
  const next = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, uniform: (lo: number, hi: number) => lo + (hi - lo) * next(),
    randint: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    choice: <T>(xs: T[]) => xs[Math.floor(next() * xs.length)] };
}
export type Rng = ReturnType<typeof rng>;

const PERM = (() => { const r = rng(1337), p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return [...p, ...p]; })();
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h: number, x: number, y: number, z: number) => { const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
/** Improved Perlin noise, roughly [-1, 1] (stands in for Blender's mathutils.noise.noise). */
export function noise(p: V3): number {
  const X = Math.floor(p.x) & 255, Y = Math.floor(p.y) & 255, Zi = Math.floor(p.z) & 255;
  const x = p.x - Math.floor(p.x), y = p.y - Math.floor(p.y), z = p.z - Math.floor(p.z);
  const u = fade(x), v = fade(y), w = fade(z), P = PERM, L = THREE.MathUtils.lerp;
  const A = P[X] + Y, AA = P[A] + Zi, AB = P[A + 1] + Zi, B = P[X + 1] + Y, BA = P[B] + Zi, BB = P[B + 1] + Zi;
  return L(L(L(grad(P[AA] & 15, x, y, z), grad(P[BA] & 15, x - 1, y, z), u), L(grad(P[AB] & 15, x, y - 1, z), grad(P[BB] & 15, x - 1, y - 1, z), u), v),
    L(L(grad(P[AA + 1] & 15, x, y, z - 1), grad(P[BA + 1] & 15, x - 1, y, z - 1), u), L(grad(P[AB + 1] & 15, x, y - 1, z - 1), grad(P[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w);
}

// ---------------------------------------------------------------- primitives
export function box(c: P3, s: Vec3, r?: THREE.Matrix4): Mesh {
  const m = new Mesh(), [x, y, z] = s.map((k) => k / 2);
  m.v = [V(-x, -y, -z), V(x, -y, -z), V(x, y, -z), V(-x, y, -z), V(-x, -y, z), V(x, -y, z), V(x, y, z), V(-x, y, z)];
  m.f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  if (r) m.apply(r);
  const cc = asV(c); return m.map((p) => p.add(cc));
}

/** Cylinder / cone of height h centred on c, axis Z before the rotation m (Blender create_cone). */
export function cyl(c: P3, r: number, h: number, segs = 12, r2?: number, m?: THREE.Matrix4): Mesh {
  const out = new Mesh(), top = r2 ?? r;
  const ring = (rr: number, z: number) => [...Array(segs).keys()].map((k) => { const a = (2 * Math.PI * k) / segs; return V(rr * Math.cos(a), rr * Math.sin(a), z); });
  out.v = [...ring(r, -h / 2), ...ring(top, h / 2)];
  for (let k = 0; k < segs; k++) out.f.push([k, (k + 1) % segs, segs + ((k + 1) % segs), segs + k]);
  out.f.push([...Array(segs).keys()].map((k) => segs + k), [...Array(segs).keys()].reverse());
  const cc = asV(c);
  return out.apply(mul(T(cc.x, cc.y, cc.z), m ?? new THREE.Matrix4()));
}

/** UV sphere: centre, per-axis radii, rotation; `cutZ` flattens everything below that height (Blender bisect stand-in). */
export function sphere(c: P3, s: Vec3, segs: [number, number] = [18, 10], r?: THREE.Matrix4, cutZ?: number): Mesh {
  const [u, vN] = segs, m = new Mesh(), pole = (z: number) => V(0, 0, z);
  const rings: V3[][] = [];
  for (let j = 1; j < vN; j++) { const th = Math.PI * (j / vN - 1), rr = Math.cos(th);
    rings.push([...Array(u).keys()].map((k) => { const a = (2 * Math.PI * k) / u; return V(rr * Math.cos(a), rr * Math.sin(a), Math.sin(th)); })); }
  const S = m.push([pole(-1)], false);
  const idx = rings.map((rg) => m.push(rg, false));
  const N = m.push([pole(1)], false);
  for (let k = 0; k < u; k++) {
    const k1 = (k + 1) % u;
    m.f.push([S, idx[0] + k1, idx[0] + k]);
    for (let j = 0; j < rings.length - 1; j++) m.f.push([idx[j] + k, idx[j] + k1, idx[j + 1] + k1, idx[j + 1] + k]);
    const l = idx[rings.length - 1]; m.f.push([l + k, l + k1, N]);
  }
  const cc = asV(c);
  m.apply(mul(T(cc.x, cc.y, cc.z), r ?? new THREE.Matrix4(), new THREE.Matrix4().makeScale(...s)));
  if (cutZ !== undefined) m.map((p) => { p.z = Math.max(p.z, cutZ); });
  return m;
}

/** Icosphere with Blender's subdivision count (1 = 20 faces, 2 = 80, 3 = 320). */
export function icosphere(sub: number): Mesh {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, sub <= 1 ? 0 : sub === 2 ? 1 : 3).deleteAttribute('normal').deleteAttribute('uv'));
  const m = new Mesh(), pos = g.attributes.position, ix = g.index!;
  for (let i = 0; i < pos.count; i++) m.v.push(V(pos.getX(i), pos.getY(i), pos.getZ(i)));
  for (let i = 0; i < ix.count; i += 3) m.f.push([ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)]);
  return m;
}

/** Lumpy foliage ball: icosphere pushed in/out by Perlin noise. */
export function blob(c: P3, r: number, sub = 2, amp = 0.2, seed = 0, scale: Vec3 = [1, 1, 1]): Mesh {
  const m = icosphere(sub), cc = asV(c), off = V(seed * 7.31, seed * 3.17, seed * 5.71);
  return m.map((p) => { const n = p.clone().normalize(), k = r * (1 + amp * noise(n.clone().multiplyScalar(1.7).add(off)));
    p.set(cc.x + n.x * scale[0] * k, cc.y + n.y * scale[1] * k, cc.z + n.z * scale[2] * k); });
}

/** Box beam from a to b, cross-section w x h (h is the side closest to vertical). */
export function bar(a: P3, b: P3, w: number, h?: number): Mesh {
  const A = asV(a), B = asV(b), d = B.clone().sub(A), z = d.clone().normalize();
  let x: V3, y: V3;
  if (Math.abs(z.z) > 0.95) { x = V(1, 0, 0).addScaledVector(z, -z.x).normalize(); y = z.clone().cross(x); }
  else { y = V(0, 0, 1).addScaledVector(z, -z.z).normalize(); x = y.clone().cross(z); }
  const r = new THREE.Matrix4().makeBasis(x, y, z);
  return box(A.add(B).multiplyScalar(0.5), [w, h ?? w, d.length()], r);
}

/** Swept tube through pts (parallel-transport frames). twist rotates ring i by i*twist. */
export function tube(ptsIn: P3[], radii: number | number[], segs = 8, twist = 0, caps = true): Mesh {
  const pts = ptsIn.map(asV), n = pts.length, rad = Array.isArray(radii) ? radii : pts.map(() => radii);
  const tans = pts.map((_, i) => pts[Math.min(i + 1, n - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize());
  let nrm = tans[0].clone().cross(Math.abs(tans[0].x) < 0.9 ? V(1, 0, 0) : V(0, 1, 0)).normalize();
  const m = new Mesh(), starts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = tans[i];
    if (i) nrm.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(tans[i - 1], t));
    nrm = nrm.addScaledVector(t, -nrm.dot(t)).normalize();
    const bi = t.clone().cross(nrm);
    starts.push(m.push([...Array(segs).keys()].map((k) => { const a = (2 * Math.PI * k) / segs + twist * i;
      return pts[i].clone().addScaledVector(nrm, Math.cos(a) * rad[i]).addScaledVector(bi, Math.sin(a) * rad[i]); }), false));
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < segs; k++) {
    const a = starts[i], b = starts[i + 1], k1 = (k + 1) % segs; m.f.push([a + k, a + k1, b + k1, b + k]);
  }
  if (caps) { m.f.push([...Array(segs).keys()].reverse().map((k) => starts[0] + k)); m.f.push([...Array(segs).keys()].map((k) => starts[n - 1] + k)); }
  return m;
}

/** Double-sided thin surface: each polygon plus a reversed copy. */
export function sheet(polys: P3[][]): Mesh {
  const m = new Mesh();
  for (const p of polys) { const q = p.map(asV); m.push(q); m.push(q.map((v) => v.clone()).reverse()); }
  return m;
}

/** Quads between consecutive point rings over ring edges k -> k+1 for k in segs (default every edge, closed loops). */
export function skin(rings: P3[][], segs?: number[], wrap = false): Mesh {
  const m = new Mesh(), n = rings[0].length, st = rings.map((r) => m.push(r.map(asV), false));
  const pairs = st.map((s, i) => [s, st[i + 1]]).slice(0, wrap ? st.length : st.length - 1);
  if (wrap) pairs[pairs.length - 1][1] = st[0];
  for (const [a, b] of pairs) for (const k of segs ?? [...Array(n).keys()]) { const k1 = (k + 1) % n; m.f.push([a + k, a + k1, b + k1, b + k]); }
  return m;
}

/** Solid of revolution: (radius, z) profile swept round local Z, turned by m and centred on c. */
export function lathe(profile: [number, number][], c: P3, segs = 16, m?: THREE.Matrix4, wrap = true): Mesh {
  const cc = asV(c), M4 = mul(T(cc.x, cc.y, cc.z), m ?? new THREE.Matrix4());
  return skin(profile.map(([r, z]) => [...Array(segs).keys()].map((k) => { const a = (2 * Math.PI * k) / segs;
    return V(r * Math.cos(a), r * Math.sin(a), z).applyMatrix4(M4); })), undefined, wrap);
}
export const torus = (c: P3, R: number, r: number, segs = 16, rsegs = 6, m?: THREE.Matrix4) =>
  lathe([...Array(rsegs).keys()].map((k) => { const t = (2 * Math.PI * k) / rsegs; return [R + r * Math.cos(t), r * Math.sin(t)] as [number, number]; }), c, segs, m);

/** Flat (possibly concave) polygon through points, triangulated. */
export function cap(points: P3[], flip = false): Mesh {
  const q = points.map(asV); if (flip) q.reverse();
  const n = new THREE.Vector3(); // Newell normal
  q.forEach((a, i) => { const b = q[(i + 1) % q.length]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); });
  const ax = Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z) ? ['y', 'z'] : Math.abs(n.y) > Math.abs(n.z) ? ['z', 'x'] : ['x', 'y'];
  const tris = THREE.ShapeUtils.triangulateShape(q.map((p) => new THREE.Vector2(p[ax[0] as 'x'], p[ax[1] as 'x'])), []);
  const m = new Mesh(); m.v = q;
  for (const [a, b, c] of tris) {
    const tn = q[b].clone().sub(q[a]).cross(q[c].clone().sub(q[a]));
    m.f.push(tn.dot(n) >= 0 ? [a, b, c] : [a, c, b]);
  }
  return m;
}

// ---------------------------------------------------------------- prop assembly
export type Role = [string | number, number?];
export interface PropDef { geometry: THREE.BufferGeometry; colliders: BoxCollider[]; size: [number, number, number]; }

export class Prop {
  parts: { m: Mesh; color: string | number; rough: number }[] = [];
  colliders: BoxCollider[] = [];
  constructor(public rnd: Rng) {}
  add(m: Mesh, color: string | number, rough = 0.75) { this.parts.push({ m, color, rough }); return this; }
  collide(c: Vec3, s: Vec3, yaw?: number) { this.colliders.push(yaw ? { c, s, yaw } : { c, s }); return this; }
  /** Put the XY centre of the bounding box on the pivot. */
  recenter() {
    const b = this.bounds(), dx = -(b.min.x + b.max.x) / 2, dy = -(b.min.y + b.max.y) / 2;
    for (const p of this.parts) p.m.map((v) => { v.x += dx; v.y += dy; });
    for (const c of this.colliders) c.c = [c.c[0] + dx, c.c[1] + dy, c.c[2]];
  }
  bounds() { const b = new THREE.Box3(); for (const p of this.parts) for (const v of p.m.v) b.expandByPoint(v); return b; }
  finish(): PropDef {
    const gb = new GeoBuilder();
    for (const { m, color, rough } of this.parts) {
      const pos: number[] = [], e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
      for (const f of m.f) for (let i = 1; i < f.length - 1; i++) {
        const a = m.v[f[0]], b = m.v[f[i]], c = m.v[f[i + 1]];
        if (e1.subVectors(b, a).cross(e2.subVectors(c, a)).lengthSq() < 1e-14) continue; // welded / degenerate
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      gb.add(g, typeof color === 'string' ? parseInt(color, 16) : color, rough);
    }
    const b = this.bounds(), s = b.getSize(new THREE.Vector3());
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return { geometry: gb.build(), colliders: this.colliders, size: [r2(s.x), r2(s.y), r2(s.z)] };
  }
}
