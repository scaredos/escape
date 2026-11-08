// Shared low-poly geometry kit (spec 06 §3). Author parts in the SOURCE frame (x forward, y left, z up, metres,
// pivot at the base centre) exactly like the Blender scripts; GeoBuilder.build() converts to three.js (x, z, -y),
// merges everything into one BufferGeometry with per-vertex `color` (linear) and `rough` attributes and creased normals.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Source (z-up) -> three (y-up): (x, y, z) -> (x, z, -y). A proper rotation (-90 deg about X). */
export const SRC_TO_THREE = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

export type Vec3 = [number, number, number];

/** Matrix in the source frame: translate * rotZ(yaw) * rotY(pitch) * rotX(roll) * scale. Angles in degrees. */
export function M(pos: Vec3 = [0, 0, 0], rotDeg: Vec3 = [0, 0, 0], scale: Vec3 | number = 1): THREE.Matrix4 {
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
  const e = new THREE.Euler(rotDeg[0] * DEG, rotDeg[1] * DEG, rotDeg[2] * DEG, 'ZYX');
  return new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(...s as Vec3));
}
export const DEG = Math.PI / 180;

/** Primitives, all in the source frame and centred on the origin unless noted. */
export const P = {
  box: (sx: number, sy: number, sz: number) => new THREE.BoxGeometry(sx, sy, sz),
  /** Cylinder along source Z, from z=0 to z=h (base on the origin). */
  cylZ(rBottom: number, rTop: number, h: number, seg = 12, open = false) {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
    g.rotateX(Math.PI / 2); g.translate(0, 0, h / 2); return g;
  },
  /** Cylinder along source X, centred (wheels use cylY). */
  cylX(r: number, len: number, seg = 12) { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(-Math.PI / 2); return g; },
  /** Cylinder along source Y (axles / wheels), centred. */
  cylY(r: number, len: number, seg = 12) { return new THREE.CylinderGeometry(r, r, len, seg); },
  sphere(rx: number, ry = rx, rz = rx, w = 12, h = 8) { const g = new THREE.SphereGeometry(1, w, h); g.scale(rx, ry, rz); return g; },
  ico(r: number, detail = 1) { return new THREE.IcosahedronGeometry(r, detail); },
  cone(r: number, h: number, seg = 12) { const g = new THREE.ConeGeometry(r, h, seg); g.rotateX(Math.PI / 2); g.translate(0, 0, h / 2); return g; },
  /** Extrude a 2D profile given in (x, z) across y in [-w, +w]. Profile must be counter-clockwise in (x, z). */
  extrudeXZ(profile: [number, number][], w: number, bevel = 0) {
    const shape = new THREE.Shape(profile.map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2 * w - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel,
      bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
    // Shape is in (x, y) extruded along +z: map shape y -> source z, extrusion z -> source y.
    g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, w - bevel, 0, 1, 0, 0, 0, 0, 0, 1));
    return g;
  },
  /** Tube through points (source frame) with per-point radius. */
  tube(points: Vec3[], radii: number[] | number, radial = 8) {
    const pts = points.map((p) => new THREE.Vector3(...p));
    const pos: number[] = [], idx: number[] = [];
    const n = pts.length;
    let prevN = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const t = (i < n - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
      if (i > 0 && i < n - 1) t.add(pts[i].clone().sub(pts[i - 1]).normalize()).normalize();
      let nn = i === 0 ? new THREE.Vector3(0, 0, 1).cross(t) : prevN.clone().sub(t.clone().multiplyScalar(prevN.dot(t)));
      if (nn.lengthSq() < 1e-6) nn = new THREE.Vector3(1, 0, 0).cross(t);
      nn.normalize(); prevN = nn;
      const b = t.clone().cross(nn);
      const r = Array.isArray(radii) ? radii[i] : radii;
      for (let k = 0; k < radial; k++) {
        const a = (k / radial) * Math.PI * 2;
        const v = pts[i].clone().addScaledVector(nn, Math.cos(a) * r).addScaledVector(b, Math.sin(a) * r);
        pos.push(v.x, v.y, v.z);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < radial; k++) {
      const a = i * radial + k, b2 = i * radial + ((k + 1) % radial), c = a + radial, d = b2 + radial;
      idx.push(a, b2, d, a, d, c);
    }
    // caps
    const capStart = pos.length / 3; pos.push(...pts[0].toArray());
    const capEnd = pos.length / 3; pos.push(...pts[n - 1].toArray());
    for (let k = 0; k < radial; k++) {
      idx.push(capStart, (k + 1) % radial, k);
      const base = (n - 1) * radial; idx.push(capEnd, base + k, base + ((k + 1) % radial));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    return g;
  },
};

export type ColorLike = number | string | THREE.Color;
export function lin(c: ColorLike): THREE.Color {
  if (c instanceof THREE.Color) return c;
  return new THREE.Color(typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : c); // ColorManagement converts sRGB hex -> linear
}

/** Collects parts with a flat colour + roughness each and merges them. */
export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];
  /** Add a geometry (source frame), transformed by m, painted one colour. Consumes `g`. */
  add(g: THREE.BufferGeometry, color: ColorLike, rough = 0.75, m?: THREE.Matrix4): this {
    let geo = g.index ? g.toNonIndexed() : g;
    if (m) geo.applyMatrix4(m);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position') geo.deleteAttribute(k);
    const n = geo.attributes.position.count, c = lin(color);
    const col = new Float32Array(n * 3), r = new Float32Array(n).fill(rough);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('rough', new THREE.BufferAttribute(r, 1));
    this.parts.push(geo);
    return this;
  }
  get empty() { return this.parts.length === 0; }
  /** Merge, convert to three.js axes and crease normals (default 40 deg). */
  build(creaseDeg = 40, toThree = true): THREE.BufferGeometry {
    let g = mergeGeometries(this.parts, false)!;
    if (toThree) g.applyMatrix4(SRC_TO_THREE);
    g = toCreasedNormals(g, creaseDeg * DEG);
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}
export { mergeVertices };

/** Box collider in the SOURCE frame of a prop/vehicle (centre + full size + optional yaw in degrees). */
export interface BoxCollider { c: Vec3; s: Vec3; yaw?: number }

let sharedMat: THREE.MeshStandardMaterial | null = null;
/** One shared material for all vertex-coloured props/vehicles/characters: colour from `color`, roughness from `rough`. */
export function vertexColorMaterial(): THREE.MeshStandardMaterial {
  if (sharedMat) return sharedMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rough;\nvarying float vRough;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = rough;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRough;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;');
  };
  m.customProgramCacheKey = () => 'vcolrough';
  sharedMat = m;
  return m;
}
