// Geometry helpers for vehicles (and characters) mirroring the bmesh prims in kit/reference/blender (veh_common.py,
// char_build.py). Everything is in the SOURCE frame (x forward, y left, z up); GeoBuilder.build() converts to three.js.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { GeoBuilder, vertexColorMaterial, type Vec3 } from '../geo';

const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const at = (c: Vec3, rot?: THREE.Matrix4) => { const m = new THREE.Matrix4().makeTranslation(c[0], c[1], c[2]); return rot ? m.multiply(rot) : m; };

export const rotX = (deg: number) => new THREE.Matrix4().makeRotationX(deg * Math.PI / 180);
export const rotY = (deg: number) => new THREE.Matrix4().makeRotationY(deg * Math.PI / 180);
export const rotZ = (deg: number) => new THREE.Matrix4().makeRotationZ(deg * Math.PI / 180);

/** Convex hull of points (non-indexed, outward winding). */
export function hull(pts: Vec3[]): THREE.BufferGeometry { return new ConvexGeometry(pts.map(v3)); }

/** prim('cube'): centre, full size, optional chamfer `bevel` (one flat bevel, ~44 tris) and rotation. */
export function cube(c: Vec3, s: Vec3, bevel = 0, rot?: THREE.Matrix4): THREE.BufferGeometry {
  const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
  let g: THREE.BufferGeometry;
  const b = Math.min(bevel, hx * 0.9, hy * 0.9, hz * 0.9);
  if (b >= 0.006) {
    const pts: Vec3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
      pts.push([sx * (hx - b), sy * (hy - b), sz * hz], [sx * (hx - b), sy * hy, sz * (hz - b)], [sx * hx, sy * (hy - b), sz * (hz - b)]);
    g = hull(pts);
  } else g = new THREE.BoxGeometry(s[0], s[1], s[2]);
  return g.applyMatrix4(at(c, rot));
}

/** prim('cyl'): centred cylinder of length `len` along axis. */
export function cyl(c: Vec3, r: number, len: number, axis: 'X' | 'Y' | 'Z' = 'Z', segs = 16, r2 = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r2, r, len, segs); // three: along Y, top radius r2 (+axis end)
  const m = axis === 'X' ? rotZ(-90) : axis === 'Z' ? rotX(90) : new THREE.Matrix4();
  return g.applyMatrix4(at(c, m));
}

/** Ellipsoid prim('sphere'). */
export function ellip(c: Vec3, r: Vec3, rot?: THREE.Matrix4, w = 16, h = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.rotateX(Math.PI / 2); // poles on source z
  g.scale(r[0], r[1], r[2]);
  return g.applyMatrix4(at(c, rot));
}

/** Cylinder from a to b (veh_cars.tube). */
export function tube(a: Vec3, b: Vec3, r: number, segs = 8): THREE.BufferGeometry {
  const A = v3(a), B = v3(b), d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, d.length(), segs);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

/** Box from a to b with a t x t cross-section (veh_cars.beam). */
export function beam(a: Vec3, b: Vec3, t: number): THREE.BufferGeometry {
  const A = v3(a), B = v3(b), d = B.clone().sub(A);
  const g = new THREE.BoxGeometry(d.length(), t, t);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

/** Triangles from a list of [a,b,c] with each flipped so its normal points away from `inside` (convex parts). */
function trisToGeo(tris: THREE.Vector3[][], inside: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [];
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), c = new THREE.Vector3();
  for (const [a, b, d] of tris) {
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(d, a));
    c.copy(a).add(b).add(d).divideScalar(3).sub(inside);
    const flip = n.dot(c) < 0;
    for (const p of flip ? [a, d, b] : [a, b, d]) pos.push(p.x, p.y, p.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Convex (x, z) profile extruded from y0 to y1; taper = [z0, z1, d] pulls |y| in by up to d at z1 (veh_cars.prism). */
export function prism(pts: [number, number][], y0: number, y1: number, taper?: [number, number, number]): THREE.BufferGeometry {
  const yy = (y: number, z: number) => {
    if (!taper) return y;
    const k = Math.min(Math.max((z - taper[0]) / (taper[1] - taper[0]), 0), 1);
    return y - Math.sign(y) * taper[2] * k;
  };
  const A = pts.map(([x, z]) => new THREE.Vector3(x, yy(y0, z), z)), B = pts.map(([x, z]) => new THREE.Vector3(x, yy(y1, z), z));
  const tris: THREE.Vector3[][] = [];
  const idx = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [i, j, k] of idx) { tris.push([A[i], A[j], A[k]], [B[i], B[j], B[k]]); }
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; tris.push([A[i], A[j], B[j]], [A[i], B[j], B[i]]); }
  const inside = new THREE.Vector3();
  for (const p of [...A, ...B]) inside.add(p);
  return trisToGeo(tris, inside.divideScalar(A.length * 2));
}

/** Car body: concave (x, z) profile (counter-clockwise) extruded across +-half with an inward bevel. */
export function extrudeBody(pts: [number, number][], half: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 2 * half - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel,
    bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: 1 });
  g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, half - bevel, 0, 1, 0, 0, 0, 0, 0, 1));
  return g;
}

/** 8-corner box symmetric in y: back/front = [x at bottom, x at top, half width, z bottom, z top] (veh_heli.loft). */
export function loft(back: number[], front: number[]): THREE.BufferGeometry {
  const pts: Vec3[] = [];
  for (const [xb, xt, hy, z0, z1] of [back, front]) for (const s of [-1, 1]) pts.push([xb, s * hy, z0], [xt, s * hy, z1]);
  return hull(pts);
}

/** Keep the part of `g` on the side `normal` points to, through `point` (bmesh.bisect_plane clear_inner). Open cut. */
export function clip(g: THREE.BufferGeometry, point: Vec3, normal: Vec3): THREE.BufferGeometry {
  const src = (g.index ? g.toNonIndexed() : g).attributes.position;
  const n = v3(normal).normalize(), d0 = n.dot(v3(point));
  const out: number[] = [];
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const lerp = (a: THREE.Vector3, b: THREE.Vector3, da: number, db: number) => a.clone().lerp(b, da / (da - db));
  for (let i = 0; i < src.count; i += 3) {
    for (let k = 0; k < 3; k++) P[k].fromBufferAttribute(src, i + k);
    const d = P.map((p) => n.dot(p) - d0);
    const poly: THREE.Vector3[] = [];
    for (let k = 0; k < 3; k++) {
      const a = P[k], b = P[(k + 1) % 3], da = d[k], db = d[(k + 1) % 3];
      if (da >= 0) poly.push(a.clone());
      if ((da >= 0) !== (db >= 0)) poly.push(lerp(a, b, da, db));
    }
    for (let k = 1; k + 1 < poly.length; k++) for (const p of [poly[0], poly[k], poly[k + 1]]) out.push(p.x, p.y, p.z);
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return r;
}

/** Thin quad lying on the (x, z) profile edge a-b, proud by t away from `inside` (veh_cars.slab). */
export function slab(a0: [number, number], b0: [number, number], inside: [number, number], t = 0.022, trim = 0.06): [number, number][] {
  const a = new THREE.Vector2(...a0), b = new THREE.Vector2(...b0);
  const A = a.clone().lerp(b, trim), B = b.clone().lerp(a, trim);
  const d = B.clone().sub(A).normalize();
  let n = new THREE.Vector2(d.y, -d.x);
  if (n.dot(new THREE.Vector2(...inside).sub(A)) > 0) n = n.negate();
  const p = (q: THREE.Vector2, k: number) => [q.x + n.x * k, q.y + n.y * k] as [number, number];
  return [p(A, -0.01), p(B, -0.01), p(B, t), p(A, t)];
}

// ---------------------------------------------------------------- materials
const paintCache = new Map<string, THREE.MeshStandardMaterial>();
/** Shared vertex-colour material tinted by `hex` (paint parts are white in the geometry). Cached per colour. */
export function tintMaterial(hex: string): THREE.MeshStandardMaterial {
  const key = hex.replace('#', '').toUpperCase();
  let m = paintCache.get(key);
  if (!m) {
    const base = vertexColorMaterial();
    m = base.clone();
    m.onBeforeCompile = base.onBeforeCompile;
    m.customProgramCacheKey = base.customProgramCacheKey;
    m.color.set(parseInt(key, 16));
    paintCache.set(key, m);
  }
  return m;
}

let glassMat: THREE.MeshStandardMaterial | null = null;
/** 06 §5.5 see-through cabin glass: colour linear (.02,.03,.042), opacity mix(.35,.85,fresnel^5), no depth write. */
export function cabinGlassMaterial(): THREE.MeshStandardMaterial {
  if (glassMat) return glassMat;
  const m = new THREE.MeshStandardMaterial({ roughness: 0.05, metalness: 0, transparent: true, depthWrite: false });
  m.color.setRGB(0.02, 0.03, 0.042, THREE.LinearSRGBColorSpace);
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      '#include <opaque_fragment>\n{ float fr = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 5.0);\n  gl_FragColor.a = mix(0.35, 0.85, fr); }');
  };
  m.customProgramCacheKey = () => 'cabinglass';
  glassMat = m;
  return m;
}

export function triCount(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && m.visible) { const g = m.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  return n;
}

// ---------------------------------------------------------------- multi-part vehicle builder
export type RoleSpec = [string, number];
/** One rigid part (a bone in the source rig): opaque vertex-coloured parts, white paint parts, see-through glass. */
export class PartB {
  stat = new GeoBuilder(); paint = new GeoBuilder(); glass = new GeoBuilder();
  constructor(public name: string, public pivot: Vec3, public parent: string | null) {}
}
export class VB {
  parts = new Map<string, PartB>();
  constructor(public roles: Record<string, RoleSpec>, public seeThrough: boolean, public paintRough = 0.45) {
    this.part('chassis', [0, 0, 0], null);
  }
  part(name: string, pivot: Vec3, parent: string | null) { const p = new PartB(name, pivot, parent); this.parts.set(name, p); return this; }
  /** role: 'Paint', 'Glass', a role name from `roles`, or an explicit [hex, rough]. */
  add(g: THREE.BufferGeometry, role: string | RoleSpec = 'Paint', part = 'chassis'): this {
    const P = this.parts.get(part)!;
    if (role === 'Paint') P.paint.add(g, 0xffffff, this.paintRough);
    else if (role === 'Glass' && this.seeThrough) P.glass.add(g, 0xffffff, 0.05);
    else { const [hex, r] = typeof role === 'string' ? this.roles[role] : role; P.stat.add(g, hex, r); }
    return this;
  }
  box(c: Vec3, s: Vec3, role: string | RoleSpec = 'Paint', bevel = 0, part = 'chassis') { return this.add(cube(c, s, bevel), role, part); }
  pair(c: Vec3, s: Vec3, role: string | RoleSpec = 'Paint', bevel = 0, part = 'chassis') {
    for (const sy of [1, -1]) this.box([c[0], sy * c[1], c[2]], s, role, bevel, part);
    return this;
  }
}
