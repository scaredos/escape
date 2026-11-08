// Visuals for replicated entities: characters (with LOD), cars (+NPC drivers), ragdolls, heli, tank, shells.
import * as THREE from 'three';
import { RAPIER, G_RAGDOLL, G_STATIC, groups, type Phys } from '../physics/phys';
import { A, E, T, type EntRec } from '../game/protocol';
import { buildCharacter, buildCharacterLOD, civilianVariant, lookFromRoster, LOOK_IDS, type AnimState, type CharacterVisual, type Held } from './characters/index';
import { buildVehicle, VEHICLE_SPECS, type VehicleModel, type VehicleVisual } from './vehicles/index';
import { CAR_MODELS } from '../game/cars';

const HELD: Held[] = ['none', 'pistol', 'shotgun', 'rifle'];
export const lookOf = (n: number) => (n >= 1000 ? civilianVariant(n - 1000) : lookFromRoster(LOOK_IDS[Math.max(0, Math.min(9, n))]));
export const toThree = (x: number, y: number, z: number, out = new THREE.Vector3()) => out.set(x, z, -y);

interface CharEnt { kind: 'char'; vis: CharacterVisual; lod: THREE.Mesh | null; root: THREE.Group; rag: RAPIER.RigidBody | null; lastPos: THREE.Vector3; type: number; look: number }
interface CarEnt { kind: 'car'; vis: VehicleVisual; driver: CharacterVisual | null; npc: number; spin: number; model: VehicleModel }
interface OtherEnt { kind: 'other'; obj: THREE.Object3D; vis?: VehicleVisual }
type Ent = CharEnt | CarEnt | OtherEnt;

export class EntityView {
  ents = new Map<number, Ent>();
  group = new THREE.Group();
  private q = new THREE.Quaternion();
  hiddenId = -1; // nothing hidden by default
  constructor(scene: THREE.Scene, private phys: Phys) { scene.add(this.group); }

  /** recs: interpolated records this frame. camPos in three frame. */
  sync(recs: EntRec[], dt: number, camPos: THREE.Vector3) {
    const seen = new Set<number>();
    for (const r of recs) {
      const id = r[E.id]; seen.add(id);
      let e = this.ents.get(id);
      if (!e) { e = this.create(r); this.ents.set(id, e); }
      if (e.kind === 'char') this.updChar(e, r, dt, camPos);
      else if (e.kind === 'car') this.updCar(e, r, dt);
      else this.updOther(e, r, dt);
    }
    for (const [id, e] of this.ents) if (!seen.has(id)) { this.dispose(e); this.ents.delete(id); }
  }
  private create(r: EntRec): Ent {
    const t = r[E.t];
    if (t === T.HUMAN || t === T.SOLDIER || t === T.CIV) {
      const vis = buildCharacter(lookOf(r[E.look]));
      const root = new THREE.Group(); root.add(vis.root); this.group.add(root);
      vis.root.traverse((o) => { o.castShadow = true; });
      return { kind: 'char', vis, lod: null, root, rag: null, lastPos: new THREE.Vector3(), type: t, look: r[E.look] };
    }
    if (t === T.CAR) {
      const model = CAR_MODELS[r[E.look]] ?? 'sedan', spec = VEHICLE_SPECS[model];
      const vis = buildVehicle(model, spec.paints[r[E.x0 + 4] % spec.paints.length]);
      vis.root.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      this.group.add(vis.root);
      return { kind: 'car', vis, driver: null, npc: 0, spin: 0, model };
    }
    const obj = new THREE.Group(); this.group.add(obj);
    return { kind: 'other', obj };
  }
  private updChar(e: CharEnt, r: EntRec, dt: number, cam: THREE.Vector3) {
    const f = r[E.f];
    if (e.rag) {
      const t = e.rag.translation(), q = e.rag.rotation();
      e.root.position.set(t.x, t.z, -t.y); e.root.quaternion.set(q.x, q.z, -q.y, q.w);
      e.vis.root.position.set(0, -0.9, 0); e.vis.root.rotation.set(0, 0, 0);
      e.vis.update(dt, { state: 'dead', speed: 0, held: 'none' });
      return;
    }
    toThree(r[E.x], r[E.y], r[E.z], e.root.position);
    e.root.quaternion.identity(); e.vis.root.position.set(0, 0, 0);
    e.root.rotation.y = r[E.yaw];
    e.root.visible = r[E.id] !== this.hiddenId;
    const vx = r[E.vx], vy = r[E.vy], sp = Math.hypot(vx, vy);
    const moveAngle = sp > 0.15 ? Math.atan2(Math.sin(Math.atan2(vy, vx) - r[E.yaw]), Math.cos(Math.atan2(vy, vx) - r[E.yaw])) : 0;
    let state: AnimState = 'idle';
    if (f & A.DEAD) state = 'dead';
    else if (f & A.SEATED) state = 'seated';
    else if (f & A.HANDSUP) state = 'handsup';
    else if (f & A.AIR) state = 'air';
    else if (f & A.CROUCH) state = sp > 0.15 ? 'crouchwalk' : 'crouch';
    else if (sp >= 0.15) state = (f & A.WALK) || ((f & A.AIM) && e.type === T.HUMAN) ? 'walk' : sp > 7.5 ? 'sprint' : 'run';
    const dist = e.root.position.distanceTo(cam);
    // far LOD: one static mesh
    if (dist > 70 && state !== 'seated') {
      if (!e.lod) { e.lod = buildCharacterLOD(lookOf(e.look)); e.lod.castShadow = true; }
      if (e.lod.parent !== e.root) { e.root.add(e.lod); }
      e.lod.visible = true; e.vis.root.visible = false; return;
    }
    if (e.lod) e.lod.visible = false;
    e.vis.root.visible = true;
    if (dist > 150) return;
    e.vis.update(dt, { state, speed: sp, moveAngle, held: HELD[r[E.w]] ?? 'none', aimPitch: r[E.t] === T.HUMAN ? (r[E.x0 + 2] ?? 0) : 0,
      firing: !!(f & A.FIRING), reloading: !!(f & A.RELOAD) });
  }
  private updCar(e: CarEnt, r: EntRec, dt: number) {
    const v = e.vis, x0 = E.x0;
    toThree(r[E.x], r[E.y], r[E.z], v.root.position);
    v.root.quaternion.set(r[x0 + 5], r[x0 + 7], -r[x0 + 6], r[x0 + 8]);
    const speed = r[x0 + 9] ?? 0, steer = r[x0 + 3] ?? 0, spec = VEHICLE_SPECS[e.model];
    e.spin -= (speed * dt) / Math.max(0.2, spec.wheelRadius);
    v.wheels.forEach((w, i) => { w.rotation.z = e.spin; if (i < 2) w.rotation.y = steer * (i === 0 ? (steer > 0 ? 1 : 0.7) : (steer > 0 ? 0.7 : 1)); });
    const npc = r[x0 + 2] ?? 0;
    if (npc !== e.npc) {
      e.npc = npc;
      if (e.driver) { e.driver.root.parent?.remove(e.driver.root); e.driver = null; }
      if (npc > 0) {
        const d = buildCharacter(civilianVariant(npc - 1)), [sx, sy, sz] = spec.seat;
        d.root.position.set(sx, sz - 0.45, -sy); v.root.add(d.root); e.driver = d;
        d.update(0.016, { state: 'seated', speed: 0, held: 'none' });
      }
    }
  }
  private updOther(e: OtherEnt, r: EntRec, _dt: number) { toThree(r[E.x], r[E.y], r[E.z], e.obj.position); e.obj.rotation.y = r[E.yaw]; }

  /** Ragdoll launch (spec 03 §9): cosmetic, simulated locally from the broadcast velocity. */
  launch(id: number, v: number[]) {
    const e = this.ents.get(id); if (!e || e.kind !== 'char' || e.rag) return;
    const p = e.root.position, W = this.phys.world;
    const body = W.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, -p.z, p.y + 0.9)
      .setRotation({ x: 0, y: 0, z: Math.sin(e.root.rotation.y / 2), w: Math.cos(e.root.rotation.y / 2) })
      .setLinvel(v[0], v[1], v[2]).setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6 + v[0] * 0.2, z: (Math.random() - 0.5) * 2 }).setAngularDamping(0.8));
    W.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.4).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setFriction(0.9).setRestitution(0.2)
      .setDensity(80).setCollisionGroups(groups(G_RAGDOLL, G_STATIC)), body);
    e.rag = body;
  }
  private dispose(e: Ent) {
    if (e.kind === 'char') { if (e.rag) this.phys.world.removeRigidBody(e.rag); e.root.removeFromParent(); e.vis.dispose(); }
    else if (e.kind === 'car') e.vis.root.removeFromParent();
    else e.obj.removeFromParent();
  }
  charVisual(id: number): CharacterVisual | null { const e = this.ents.get(id); return e && e.kind === 'char' ? e.vis : null; }
  ragdollPos(id: number): THREE.Vector3 | null { const e = this.ents.get(id); return e && e.kind === 'char' && e.rag ? e.root.position : null; }
}
