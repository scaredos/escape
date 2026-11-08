// Zero-download characters (06 §7.3 option B): a code-built 26-bone hierarchy of Object3Ds with rigid vertex-coloured
// parts (one merged mesh per bone, ~16 draws), procedural locomotion and upper-body weapon holds (06 addendum
// "Animation state selection"). root origin at the feet, facing three.js +X, +Y up, character's right = +Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { vertexColorMaterial } from '../geo';
import { BONES, buildBody, HI, LO, weapon, type Held } from './build';
import type { Look } from './looks';

export { lookFromRoster, civilianVariant, LOOK_IDS, type Look, type LookId } from './looks';
export type { Held };
export type AnimState = 'idle' | 'walk' | 'run' | 'sprint' | 'seated' | 'handsup' | 'air' | 'crouch' | 'crouchwalk' | 'dead';
export interface AnimInput {
  state: AnimState; speed: number /* m/s planar */; moveAngle?: number /* rad, velocity vs facing, + = to the left */;
  held: Held; aimPitch?: number /* rad, + = up */; firing?: boolean; reloading?: boolean;
}
export interface CharacterVisual {
  root: THREE.Group;
  update(dt: number, s: AnimInput): void;
  setHeld(h: Held): void;
  muzzleWorld(out: THREE.Vector3): THREE.Vector3;
  pelvis: THREE.Object3D;
  /** All 26 bones by UE name (root, pelvis, spine_01..05, neck_01/02, head, clavicle_l, upperarm_l, ... ball_r). */
  bones: Record<string, THREE.Object3D>;
  dispose(): void;
}

// ---------------------------------------------------------------- shared geometry per look
interface Rig { local: Map<string, THREE.BufferGeometry>; J: Record<string, THREE.Vector3>; s: number }
const rigCache = new Map<string, Rig>();
function rigFor(look: Look): Rig {
  const key = JSON.stringify(look);
  let r = rigCache.get(key);
  if (!r) {
    const b = buildBody(look, HI);
    const local = new Map<string, THREE.BufferGeometry>();
    for (const [bone, g] of b.geos) { const j = b.J[bone]; g.translate(-j.x, -j.y, -j.z); g.computeBoundingSphere(); local.set(bone, g); }
    r = { local, J: b.J, s: b.s };
    rigCache.set(key, r);
  }
  return r;
}

/** Far LOD (06 §7.3: beyond ~40 m): the standing rest pose merged into one static mesh (one draw, low segment counts). */
export function buildCharacterLOD(look: Look): THREE.Mesh {
  const g = mergeGeometries([...buildBody(look, LO).geos.values()], false)!;
  const m = new THREE.Mesh(g, vertexColorMaterial());
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------- animation tables
interface Gait { speed: number; cycle: number; thigh: number; knee: number; kneeStance: number; arm: number; elbow: number; lean: number; thighBase: number; kneeBase: number }
const GAITS: Record<string, Gait> = {
  walk: { speed: 1.7, cycle: 1.45, thigh: 0.42, knee: 1.05, kneeStance: 0.08, arm: 0.38, elbow: 0.3, lean: 0.05, thighBase: 0, kneeBase: 0 },
  run: { speed: 6.0, cycle: 2.6, thigh: 0.8, knee: 1.9, kneeStance: 0.25, arm: 0.75, elbow: 1.4, lean: 0.2, thighBase: 0.05, kneeBase: 0 },
  sprint: { speed: 8.5, cycle: 3.4, thigh: 0.95, knee: 2.1, kneeStance: 0.3, arm: 0.95, elbow: 1.5, lean: 0.32, thighBase: 0.08, kneeBase: 0 },
  crouchwalk: { speed: 3.0, cycle: 1.3, thigh: 0.35, knee: 0.5, kneeStance: 0, arm: 0.2, elbow: 0.6, lean: 0.35, thighBase: 1.0, kneeBase: 1.7 },
};
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const GUN_STATES = new Set<AnimState>(['idle', 'walk', 'run', 'sprint', 'air', 'crouch', 'crouchwalk']);
const PINNED = new Set<AnimState>(['idle', 'walk', 'run', 'sprint', 'crouch', 'crouchwalk', 'handsup']);

// scratch
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Vector3(), _p = new THREE.Vector3(), _u = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();

/** Point bone's rest direction `rest` (local) at world point `target`. Parent world matrix must be current. */
function aim(bone: THREE.Object3D, rest: THREE.Vector3, target: THREE.Vector3) {
  bone.getWorldPosition(_v);
  _w.subVectors(target, _v).normalize();
  bone.parent!.getWorldQuaternion(_q);
  _w.applyQuaternion(_q.invert());
  bone.quaternion.setFromUnitVectors(rest, _w);
  bone.updateWorldMatrix(false, true);
}

export function buildCharacter(look: Look): CharacterVisual {
  const rig = rigFor(look), s = rig.s;
  const root = new THREE.Group();
  root.name = `char_${look.id}`;
  const B: Record<string, THREE.Object3D> = {};
  for (const [name, parent] of BONES) {
    const o = name === 'root' ? root : new THREE.Object3D();
    o.name = name;
    o.rotation.order = 'YZX'; // R = Ry(yaw) * Rz(swing/pitch) * Rx(abduct/roll)
    if (parent) { o.position.subVectors(rig.J[name], rig.J[parent]); B[parent].add(o); }
    B[name] = o;
    const g = rig.local.get(name);
    if (g) { const m = new THREE.Mesh(g, vertexColorMaterial()); m.castShadow = true; m.receiveShadow = true; o.add(m); }
  }
  const list = BONES.map(([n]) => B[n]).filter((o) => o !== root);
  const rest = new Map(list.map((o) => [o, o.position.clone()]));
  const prev = list.map(() => new THREE.Quaternion());
  const prevPelvis = new THREE.Vector3();
  const armRest = { l: [B.lowerarm_l.position.clone().normalize(), B.hand_l.position.clone().normalize()], r: [B.lowerarm_r.position.clone().normalize(), B.hand_r.position.clone().normalize()] };
  const upperLen = B.lowerarm_l.position.length(), lowerLen = B.hand_l.position.length();

  let held: Held = 'none', gun: THREE.Mesh | null = null, phase = 0, time = 0, recoil = 0, first = true;

  /** Two-bone IK: wrist of `side` to world `target`, elbow toward world direction `pole`. */
  const ik = (side: 'l' | 'r', target: THREE.Vector3, pole: THREE.Vector3) => {
    const up = B[`upperarm_${side}`], lo = B[`lowerarm_${side}`];
    up.getWorldPosition(_p);
    _u.subVectors(target, _p);
    const d = clamp(_u.length(), 0.05, upperLen + lowerLen - 1e-3);
    _u.normalize();
    const cosA = clamp((upperLen * upperLen + d * d - lowerLen * lowerLen) / (2 * upperLen * d), -1, 1);
    _e.copy(pole).addScaledVector(_u, -pole.dot(_u)).normalize();
    const E = _p.clone().addScaledVector(_u, upperLen * cosA).addScaledVector(_e, upperLen * Math.sqrt(1 - cosA * cosA));
    const T = _p.clone().addScaledVector(_u, d);
    aim(up, armRest[side][0], E);
    aim(lo, armRest[side][1], T);
  };
  const toWorld = (x: number, y: number, z: number) => root.localToWorld(new THREE.Vector3(x, y, z));
  const dirWorld = (o: THREE.Object3D, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));

  const setHeld = (h: Held) => {
    if (h === held) return;
    held = h;
    if (gun) { gun.removeFromParent(); gun = null; }
    if (h !== 'none') {
      gun = new THREE.Mesh(weapon(h).geo, vertexColorMaterial());
      gun.castShadow = true; gun.matrixAutoUpdate = false;
      B.hand_r.add(gun);
    }
  };

  const R = (n: string, x: number, y: number, z: number) => B[n].rotation.set(x, y, z);

  function update(dt: number, inp: AnimInput) {
    if (inp.state === 'dead' && !first) return; // hold the last pose; the ragdoll takes over (03 §9)
    setHeld(inp.held);
    time += dt;
    recoil = inp.firing ? 0.1 : Math.max(0, recoil - dt);
    for (let i = 0; i < list.length; i++) prev[i].copy(list[i].quaternion);
    prevPelvis.copy(B.pelvis.position);
    for (const o of list) { o.rotation.set(0, 0, 0); o.position.copy(rest.get(o)!); }

    const st = inp.state, G = GAITS[st], moving = !!G && inp.speed >= 0.15;
    const armed = held !== 'none' && GUN_STATES.has(st);
    const pitch = armed ? clamp(inp.aimPitch ?? 0, -Math.PI / 3, Math.PI / 3) : 0;
    const abd = 0.05 + (look.girth - 1) * 0.3;
    let lean = 0, lowerYaw = 0;

    if (moving) {
      let a = inp.moveAngle ?? 0, dir = 1;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) > Math.PI / 2 + 0.01) { a -= Math.PI * Math.sign(a); dir = -1; }
      lowerYaw = clamp(a, -Math.PI / 2, Math.PI / 2);
      const rate = clamp(inp.speed / G.speed, 0.6, 1.8);
      phase += dir * 2 * Math.PI * (G.speed / G.cycle) * rate * dt;
      for (const [side, ph] of [['l', phase], ['r', phase + Math.PI]] as [string, number][]) {
        const al = G.thighBase + G.thigh * Math.sin(ph);
        const be = G.kneeBase + G.kneeStance + G.knee * Math.pow(Math.max(0, Math.cos(ph + 0.35)), 1.5);
        R(`thigh_${side}`, 0, 0, al); R(`calf_${side}`, 0, 0, -be); R(`foot_${side}`, 0, 0, -(al - be));
        const sw = (side === 'l' ? -1 : 1) * G.arm * Math.sin(phase);
        R(`upperarm_${side}`, (side === 'l' ? 1 : -1) * abd, 0, sw);
        R(`lowerarm_${side}`, 0, 0, G.elbow + 0.25 * G.elbow * Math.max(0, sw));
      }
      lean = G.lean;
      const tw = 0.1 * G.arm * Math.sin(phase);
      B.pelvis.rotation.y = lowerYaw + tw;
      B.spine_03.rotation.y = -tw;
    } else if (st === 'seated') {
      B.pelvis.position.set(0, 0.45, 0);
      for (const side of ['l', 'r']) { R(`thigh_${side}`, 0, 0, 1.45); R(`calf_${side}`, 0, 0, -1.35); R(`foot_${side}`, 0, 0, -0.1); }
      lean = -0.12; // recline
    } else if (st === 'air') {
      R('thigh_l', 0, 0, 0.75); R('calf_l', 0, 0, -1.2); R('foot_l', 0, 0, 0.3);
      R('thigh_r', 0, 0, 0.2); R('calf_r', 0, 0, -0.7); R('foot_r', 0, 0, 0.3);
      for (const side of ['l', 'r']) { R(`upperarm_${side}`, (side === 'l' ? 1 : -1) * 0.55, 0, 0.2); R(`lowerarm_${side}`, 0, 0, 0.6); }
    } else if (st === 'crouch' || st === 'crouchwalk') {
      for (const side of ['l', 'r']) { R(`thigh_${side}`, 0, 0, 1.25); R(`calf_${side}`, 0, 0, -2.0); R(`foot_${side}`, 0, 0, 0.75);
        R(`upperarm_${side}`, (side === 'l' ? 1 : -1) * 0.1, 0, 0.35); R(`lowerarm_${side}`, 0, 0, 0.6); }
      lean = 0.35;
    } else { // idle, handsup (arms by IK below), or a gait state below 0.15 m/s
      const br = Math.sin(time * 2 * Math.PI * 0.25);
      B.spine_03.rotation.z = 0.015 * br;
      B.head.rotation.y = 0.08 * Math.sin(time * 0.37);
      for (const side of ['l', 'r']) { R(`upperarm_${side}`, (side === 'l' ? 1 : -1) * (abd + 0.01 * br), 0, 0.04); R(`lowerarm_${side}`, 0, 0, 0.12); }
      R('thigh_l', 0, 0, 0.04); R('calf_l', 0, 0, -0.06); R('foot_l', 0, 0, 0.02);
    }
    // spine: counter the lower-body yaw, lean over spine_01/02, aim pitch over spine_01..03 (06 addendum: ±60°)
    B.spine_01.rotation.y = -lowerYaw;
    B.spine_01.rotation.z = -lean / 2 + pitch / 3;
    B.spine_02.rotation.z = -lean / 2 + pitch / 3;
    B.spine_03.rotation.z += pitch / 3;
    B.neck_01.rotation.z = lean * 0.7 - pitch * 0.3;

    root.updateWorldMatrix(true, true);
    if (PINNED.has(st)) { // keep the lowest foot on the ground
      let low = Infinity;
      for (const side of ['l', 'r']) {
        low = Math.min(low, root.worldToLocal(B[`foot_${side}`].getWorldPosition(_v)).y - rig.J[`foot_${side}`].y);
        low = Math.min(low, root.worldToLocal(B[`ball_${side}`].getWorldPosition(_v)).y - rig.J[`ball_${side}`].y);
      }
      B.pelvis.position.y -= low;
      B.pelvis.updateWorldMatrix(false, true);
    }

    // arms by IK: steering wheel, hands up, weapon holds
    let gunM: THREE.Matrix4 | null = null;
    if (st === 'seated') {
      for (const [side, z] of [['l', -0.19], ['r', 0.19]] as ['l' | 'r', number][])
        ik(side, toWorld(0.44, 0.80, z), dirWorld(root, -0.2, -1, z * 4));
    } else if (st === 'handsup') {
      for (const [side, z] of [['l', -0.24], ['r', 0.24]] as ['l' | 'r', number][])
        ik(side, toWorld(0.06, (1.79 + 0.14) * s, z * s), dirWorld(root, -0.3, -0.2, z * 4));
    } else if (armed) {
      const W = weapon(held as Exclude<Held, 'none'>), pistol = held === 'pistol';
      const k = recoil / 0.1, rel = inp.reloading ? 1 : 0;
      gunM = new THREE.Matrix4().copy(B.spine_05.matrixWorld)
        .multiply(_m.makeTranslation(pistol ? 0.50 * s : 0.22 * s, (pistol ? 0.10 : 0.0) * s - 0.14 * rel, (pistol ? 0.05 : 0.12) * s - 0.04 * rel))
        .multiply(_m.makeRotationZ(lean + 0.15 * k - 0.65 * rel))
        .multiply(_m.makeTranslation(-0.05 * k, 0, 0));
      const chest = B.spine_05;
      ik('r', new THREE.Vector3(-0.035, -0.075, 0.01).applyMatrix4(gunM), dirWorld(chest, -0.3, -1, 0.9));
      _w.copy(W.support).add(pistol ? _v.set(-0.02, -0.07, -0.03) : _v.set(-0.13, -0.06, -0.02)).applyMatrix4(gunM);
      ik('l', _w.clone(), dirWorld(chest, pistol ? -0.3 : 0, -1, pistol ? -1 : -0.5));
    }

    // smooth state changes
    const kb = first ? 1 : 1 - Math.exp(-dt * 18);
    for (let i = 0; i < list.length; i++) { _q.copy(list[i].quaternion); list[i].quaternion.copy(prev[i]).slerp(_q, kb); }
    B.pelvis.position.lerpVectors(prevPelvis, B.pelvis.position, kb);
    root.updateWorldMatrix(true, true);

    if (gun) {
      gun.visible = st !== 'seated' && st !== 'handsup';
      if (gunM) gun.matrix.copy(_m2.copy(B.hand_r.matrixWorld).invert().multiply(gunM));
      else gun.matrix.makeRotationZ(-Math.PI / 2).setPosition(0, -0.06 * s, 0); // hanging from the hand, muzzle down
      gun.matrixWorldNeedsUpdate = true;
    }
    first = false;
  }

  return {
    root, pelvis: B.pelvis, bones: B, update, setHeld,
    muzzleWorld(out: THREE.Vector3) {
      if (!gun) return B.hand_r.getWorldPosition(out);
      gun.updateWorldMatrix(true, false);
      return out.copy(weapon(held as Exclude<Held, 'none'>).muzzle).applyMatrix4(gun.matrixWorld);
    },
    dispose() { root.removeFromParent(); if (gun) gun.removeFromParent(); }, // ponytail: geometry is shared per look and kept for the session
  };
}
