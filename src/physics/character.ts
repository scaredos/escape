// On-foot movement shared by the host simulation and client prediction (spec 04 §2). Map frame, z up.
import { RAPIER, G_CAR, G_STATIC, G_CHAR, groups, type Phys } from './phys';

export const CAPSULE_R = 0.4, CAPSULE_HALF = 0.9, EYE = 0.8;
export const BASE_WALK = 6.0, SPRINT_MUL = 1.6, BAG_MUL = 0.7, CROUCH_SPEED = 3.0, ADS_MUL = 0.6;
export const JUMP_V = 5.0, GRAVITY = 9.8, ACCEL = 24, BRAKE = 14, AIR_CONTROL = 0.35;

export interface MoveInput { mx: number; my: number; yaw: number; sprint: boolean; jump: boolean; crouch: boolean; aim: boolean }
export interface MoveState { x: number; y: number; z: number; vx: number; vy: number; vz: number; grounded: boolean; airTime: number }

export function maxWalk(inp: MoveInput, bag: boolean): number {
  if (inp.crouch) return CROUCH_SPEED;
  let s = BASE_WALK * (bag ? BAG_MUL : 1) * (inp.sprint ? SPRINT_MUL : 1);
  if (inp.aim) s *= ADS_MUL;
  return s;
}

export class CharBody {
  collider: RAPIER.Collider;
  body: RAPIER.RigidBody;
  kcc: RAPIER.KinematicCharacterController;
  constructor(private phys: Phys, x: number, y: number, z: number) {
    const W = phys.world;
    this.body = W.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
    // capsule axis is local Y in Rapier: rotate it to Z
    this.collider = W.createCollider(RAPIER.ColliderDesc.capsule(CAPSULE_HALF - CAPSULE_R, CAPSULE_R)
      .setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setCollisionGroups(groups(G_CHAR, G_STATIC | G_CAR)), this.body);
    this.kcc = W.createCharacterController(0.02);
    this.kcc.setUp({ x: 0, y: 0, z: 1 });
    this.kcc.enableAutostep(0.45, 0.2, false);
    this.kcc.setMaxSlopeClimbAngle(44.8 * Math.PI / 180);
    this.kcc.enableSnapToGround(0.3);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
  }
  setEnabled(on: boolean) { this.collider.setEnabled(on); }
  teleport(x: number, y: number, z: number) { this.body.setTranslation({ x, y, z }, true); this.body.setNextKinematicTranslation({ x, y, z }); }
  /** Advance one step; mutates `s` (position = capsule centre). */
  step(s: MoveState, inp: MoveInput, dt: number, bag: boolean) {
    const fx = Math.cos(inp.yaw), fy = Math.sin(inp.yaw), rx = fy, ry = -fx;
    let dx = rx * inp.mx + fx * inp.my, dy = ry * inp.mx + fy * inp.my;
    const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    const sp = maxWalk(inp, bag), tx = dx * sp, ty = dy * sp;
    const rate = (l > 0.01 ? ACCEL : BRAKE) * (s.grounded ? 1 : AIR_CONTROL) * dt;
    const ex = tx - s.vx, ey = ty - s.vy, el = Math.hypot(ex, ey);
    if (el <= rate) { s.vx = tx; s.vy = ty; } else { s.vx += (ex / el) * rate; s.vy += (ey / el) * rate; }
    if (s.grounded && inp.jump) { s.vz = JUMP_V; s.grounded = false; }
    s.vz -= GRAVITY * dt;
    this.body.setTranslation({ x: s.x, y: s.y, z: s.z }, false);
    this.kcc.computeColliderMovement(this.collider, { x: s.vx * dt, y: s.vy * dt, z: s.vz * dt }, undefined, groups(G_CHAR, G_STATIC | G_CAR));
    const m = this.kcc.computedMovement();
    const grounded = this.kcc.computedGrounded();
    // velocity follows what actually happened horizontally (walls stop you)
    if (Math.abs(m.x) < Math.abs(s.vx * dt) * 0.5) s.vx = m.x / dt;
    if (Math.abs(m.y) < Math.abs(s.vy * dt) * 0.5) s.vy = m.y / dt;
    s.x += m.x; s.y += m.y; s.z += m.z;
    if (grounded && s.vz < 0) s.vz = 0;
    s.grounded = grounded; s.airTime = grounded ? 0 : s.airTime + dt;
    if (s.z < -20) { s.z = 2; s.vz = 0; } // fell through: pop up (no fall damage)
    this.body.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
  }
  dispose() { this.phys.world.removeCharacterController(this.kcc); this.phys.world.removeRigidBody(this.body); }
}
