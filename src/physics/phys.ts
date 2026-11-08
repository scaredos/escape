// Rapier physics in the MAP frame (x east, y north, z up). Static world colliders are built on every machine.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GenOutput } from '../world/types';
import { COL, PROP } from '../world/types';
import { buildProp, type PropName } from '../render/props/index';

export { RAPIER };
export const G_STATIC = 0x0001, G_CHAR = 0x0002, G_CAR = 0x0004, G_RAGDOLL = 0x0008, G_DEBRIS = 0x0010;
/** Rapier interaction groups: membership in the high 16 bits, filter in the low 16. */
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
const DEG = Math.PI / 180;

let ready: Promise<void> | null = null;
export function initRapier() { return (ready ??= RAPIER.init()); }

export class Phys {
  world: RAPIER.World;
  staticBody: RAPIER.RigidBody;
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0, z: -9.8 });
    this.world.timestep = 1 / 60;
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }
  /** Build every static collider of the generated world. Returns the collider count. */
  addStatics(gen: GenOutput): number {
    let n = 0;
    const W = this.world, sb = this.staticBody, sg = groups(G_STATIC, 0xffff);
    const c = gen.colliders;
    for (let o = 0; o < c.length; o += COL) {
      const d = RAPIER.ColliderDesc.cuboid(c[o + 3] / 2, c[o + 4] / 2, c[o + 5] / 2)
        .setTranslation(c[o], c[o + 1], c[o + 2]).setRotation(quatZ(c[o + 6] * DEG)).setCollisionGroups(sg);
      W.createCollider(d, sb); n++;
    }
    const q = new THREE.Quaternion(), v = new THREE.Vector3(), e = new THREE.Euler();
    for (const [name, data] of Object.entries(gen.props)) {
      const base = name.split(':')[0];
      if (base === 'vehicle') continue;
      if (base === 'Hill') { n += this.addHills(data); continue; }
      const def = buildProp(base as PropName);
      if (!def.colliders.length) continue;
      for (let o = 0; o < data.length; o += PROP) {
        if (!(data[o + 9] & 1)) continue;
        const yaw = data[o + 3] * DEG, sx = data[o + 6], sy = data[o + 7], sz = data[o + 8];
        e.set(data[o + 5] * DEG, data[o + 4] * DEG, yaw, 'ZYX'); q.setFromEuler(e);
        for (const b of def.colliders) {
          v.set(b.c[0] * sx, b.c[1] * sy, b.c[2] * sz).applyQuaternion(q);
          const bq = b.yaw ? q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), b.yaw * DEG)) : q;
          const d = RAPIER.ColliderDesc.cuboid(b.s[0] * sx / 2, b.s[1] * sy / 2, b.s[2] * sz / 2)
            .setTranslation(data[o] + v.x, data[o + 1] + v.y, data[o + 2] + v.z).setRotation({ x: bq.x, y: bq.y, z: bq.z, w: bq.w }).setCollisionGroups(sg);
          W.createCollider(d, sb); n++;
        }
      }
    }
    // dynamic spot props are static for collision: crates (closed size) and vaults (spec 06 §9)
    for (const sp of gen.spots) {
      const box = sp.mode === 'crate' ? { c: [0, 0, 0.3125], s: [0.83, 0.83, 0.625] } : sp.mode === 'bank' ? { c: [0.15, 0, 1.1], s: [2.3, 2.04, 2.2] } : null;
      if (!box) continue;
      const yaw = Math.atan2(sp.fy, sp.fx), cs = Math.cos(yaw), sn = Math.sin(yaw);
      W.createCollider(RAPIER.ColliderDesc.cuboid(box.s[0] / 2, box.s[1] / 2, box.s[2] / 2)
        .setTranslation(sp.rx + box.c[0] * cs, sp.ry + box.c[0] * sn, box.c[2]).setRotation(quatZ(yaw)).setCollisionGroups(sg), sb); n++;
    }
    return n;
  }
  private hillPts: Float32Array | null = null;
  private addHills(data: Float32Array): number {
    if (!this.hillPts) {
      // Hill mesh is authored in three axes by GeoBuilder: (x, y_up, z=-north) -> map (x, -z, y)
      const g = buildProp('Hill').geometry, p = g.attributes.position;
      const pts: number[] = [];
      for (let i = 0; i < p.count; i++) pts.push(p.getX(i), -p.getZ(i), p.getY(i));
      this.hillPts = Float32Array.from(pts);
    }
    let n = 0;
    for (let o = 0; o < data.length; o += PROP) {
      const yaw = data[o + 3] * DEG, cs = Math.cos(yaw), sn = Math.sin(yaw), sx = data[o + 6], sy = data[o + 7], sz = data[o + 8];
      const hp = this.hillPts, out = new Float32Array(hp.length);
      for (let i = 0; i < hp.length; i += 3) {
        const x = hp[i] * sx, y = hp[i + 1] * sy;
        out[i] = data[o] + x * cs - y * sn; out[i + 1] = data[o + 1] + x * sn + y * cs; out[i + 2] = data[o + 2] + hp[i + 2] * sz;
      }
      const d = RAPIER.ColliderDesc.convexHull(out);
      if (d) { this.world.createCollider(d.setCollisionGroups(groups(G_STATIC, 0xffff)), this.staticBody); n++; }
    }
    return n;
  }
  /** Static-only line of sight between two points (map frame). True = clear. */
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number, mask = G_STATIC): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (L < 1e-3) return true;
    const hit = this.world.castRay(new RAPIER.Ray({ x: ax, y: ay, z: az }, { x: dx / L, y: dy / L, z: dz / L }), L, true, undefined, groups(0xffff, mask));
    return !hit;
  }
  /** Ray against `mask` groups; returns distance or -1. */
  ray(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, maxD: number, mask = G_STATIC, exclude?: RAPIER.RigidBody): { toi: number; collider: RAPIER.Collider } | null {
    const hit = this.world.castRay(new RAPIER.Ray({ x: ax, y: ay, z: az }, { x: dx, y: dy, z: dz }), maxD, true, undefined, groups(0xffff, mask), undefined, exclude);
    return hit ? { toi: (hit as any).timeOfImpact ?? (hit as any).toi, collider: hit.collider } : null;
  }
  /** Ground height under (x,y) from `fromZ` downward (static only). */
  groundZ(x: number, y: number, fromZ = 60, maxD = 120): number {
    const h = this.ray(x, y, fromZ, 0, 0, -1, maxD);
    return h ? fromZ - h.toi : 0;
  }
  /** Does an axis box (map frame, yaw) overlap static or car geometry? */
  boxBlocked(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yawRad: number, mask = G_STATIC | G_CAR): boolean {
    let hit = false;
    this.world.intersectionsWithShape({ x: cx, y: cy, z: cz }, quatZ(yawRad), new RAPIER.Cuboid(hx, hy, hz), () => { hit = true; return false; }, undefined, groups(0xffff, mask));
    return hit;
  }
}
export function quatZ(a: number) { return { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) }; }
