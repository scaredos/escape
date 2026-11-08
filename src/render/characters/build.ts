// Rigid code-built body parts for the 26-bone character (06 §7.2, port of kit/reference/blender/char_build.py).
// Authored in the geo SOURCE frame with the character facing +x (char_build's -y front -> +x, its +x left -> +y).
// Every mesh bone gets one merged geometry in three.js axes at its rest (world) position; index.ts re-centres them.
import * as THREE from 'three';
import { GeoBuilder, P, type Vec3 } from '../geo';
import { cube, cyl, ellip, clip, rotX, rotY } from '../vehicles/kit';
import { FACTION, type Look } from './looks';

export const BONES: [string, string | null][] = [
  ['root', null], ['pelvis', 'root'], ['spine_01', 'pelvis'], ['spine_02', 'spine_01'], ['spine_03', 'spine_02'], ['spine_04', 'spine_03'],
  ['spine_05', 'spine_04'], ['neck_01', 'spine_05'], ['neck_02', 'neck_01'], ['head', 'neck_02'],
];
for (const s of ['l', 'r'])
  BONES.push([`clavicle_${s}`, 'spine_05'], [`upperarm_${s}`, `clavicle_${s}`], [`lowerarm_${s}`, `upperarm_${s}`], [`hand_${s}`, `lowerarm_${s}`],
    [`thigh_${s}`, 'pelvis'], [`calf_${s}`, `thigh_${s}`], [`foot_${s}`, `calf_${s}`], [`ball_${s}`, `foot_${s}`]);

/** Rest arm angle from vertical (source used a 45° A-pose; a near-hanging rest keeps procedural swing axes clean). */
export const ARM0 = 8 * Math.PI / 180;
const K = 0.8; // code-built tubes ≈ 0.8 × the Skin-modifier radii (06 §7.2)

export interface Detail { radial: number; sw: number; sh: number; small: [number, number] }
export const HI: Detail = { radial: 12, sw: 14, sh: 10, small: [8, 6] };
export const LO: Detail = { radial: 7, sw: 9, sh: 6, small: [5, 4] };

const toThree = (p: Vec3) => new THREE.Vector3(p[0], p[2], -p[1]);
const add3 = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Joint positions in the source frame (×s), plus arm direction per side. */
export function joints(L: Look) {
  const s = L.height / 1.75, sw = L.shoulders, hw = L.hips;
  const v = (x: number, y: number, z: number): Vec3 => [x * s, y * s, z * s];
  const J: Record<string, Vec3> = {
    root: [0, 0, 0], pelvis: v(0, 0, 0.97), spine_01: v(0, 0, 1.05), spine_02: v(0, 0, 1.12), spine_03: v(0, 0, 1.20),
    spine_04: v(0, 0, 1.28), spine_05: v(0, 0, 1.36), neck_01: v(0, 0, 1.46), neck_02: v(0, 0, 1.52), head: v(0, 0, 1.58),
  };
  const dir: Record<string, Vec3> = {};
  for (const [side, sy] of [['l', 1], ['r', -1]] as [string, number][]) {
    const d: Vec3 = [0, sy * Math.sin(ARM0), -Math.cos(ARM0)], sh = v(0, sy * 0.17 * sw, 1.415);
    dir[side] = d;
    J[`clavicle_${side}`] = v(0, sy * 0.03, 1.43);
    J[`upperarm_${side}`] = sh;
    J[`lowerarm_${side}`] = add3(sh, d, 0.29 * s);
    J[`hand_${side}`] = add3(sh, d, 0.55 * s);
    J[`thigh_${side}`] = v(0, sy * 0.095 * hw, 0.92);
    J[`calf_${side}`] = v(0.005, sy * 0.10 * hw, 0.52);
    J[`foot_${side}`] = v(-0.015, sy * 0.10 * hw, 0.10);
    J[`ball_${side}`] = v(0.10, sy * 0.10 * hw, 0.025);
  }
  return { J, dir, s };
}

/** Elliptic tube along z through rings [z, rLat, rDepth], sampled between za and zb, open ends. */
function loftZ(rings: [number, number, number][], za: number, zb: number, radial: number): THREE.BufferGeometry {
  const at = (z: number): [number, number, number] => {
    for (let i = 0; i < rings.length - 1; i++) {
      const [z0, a0, b0] = rings[i], [z1, a1, b1] = rings[i + 1];
      if (z >= z0 && z <= z1) { const t = (z - z0) / (z1 - z0); return [z, a0 + (a1 - a0) * t, b0 + (b1 - b0) * t]; }
    }
    return z < rings[0][0] ? rings[0] : rings[rings.length - 1];
  };
  const rs = [at(za), ...rings.filter((r) => r[0] > za && r[0] < zb), at(zb)];
  const pos: number[] = [];
  const p = (r: [number, number, number], k: number) => { const a = 2 * Math.PI * k / radial; return [r[2] * Math.cos(a), r[1] * Math.sin(a), r[0]]; };
  for (let i = 0; i < rs.length - 1; i++) for (let k = 0; k < radial; k++) {
    const a = p(rs[i], k), b = p(rs[i], k + 1), c = p(rs[i + 1], k + 1), d = p(rs[i + 1], k);
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export interface BodyParts { geos: Map<string, THREE.BufferGeometry>; J: Record<string, THREE.Vector3>; s: number }

export function buildBody(L: Look, D: Detail): BodyParts {
  const { J, dir, s } = joints(L);
  const g = L.girth, sw = L.shoulders, hw = L.hips;
  const B = new Map<string, GeoBuilder>();
  const add = (bone: string, geo: THREE.BufferGeometry, hex: string, rough = 0.75) => {
    if (!B.has(bone)) B.set(bone, new GeoBuilder());
    B.get(bone)!.add(geo, hex, rough);
  };
  const SKIN = 0.6, skin = L.skin;
  const torsoCol = (z: number) => (z > 1.49 ? skin : z > 0.99 ? L.top : L.bottom); // z in reference units
  const kg = K * g * s;

  // ---- torso: elliptic loft split per bone and per hem line
  const R: [number, number, number][] = ([
    [0.78, 0.02, 0.02], [0.82, 0.10 * hw, 0.08], [0.88, 0.16 * hw, 0.115], [0.95, 0.175 * hw, 0.125], [1.07, 0.16, 0.115],
    [1.19, 0.17, 0.12], [1.31, 0.185 * sw, 0.125], [1.40, 0.175 * sw, 0.115], [1.45, 0.12 * sw, 0.09], [1.48, 0.06, 0.06], [1.64, 0.055, 0.055],
  ] as [number, number, number][]).map(([z, a, b]) => [z * s, a * kg, b * kg]);
  const bands: [string, number, number][] = [['pelvis', 0.78, 1.05], ['spine_01', 1.05, 1.20], ['spine_03', 1.20, 1.64]];
  for (const [bone, z0, z1] of bands) {
    const cuts = [z0, ...[0.99, 1.49].filter((h) => h > z0 && h < z1), z1];
    for (let i = 0; i < cuts.length - 1; i++)
      add(bone, loftZ(R, cuts[i] * s, cuts[i + 1] * s, D.radial), torsoCol((cuts[i] + cuts[i + 1]) / 2), torsoCol((cuts[i] + cuts[i + 1]) / 2) === skin ? SKIN : 0.75);
  }
  // joint fillers: hidden at rest, they close the gap when the spine bends
  for (const [bone, z, rl, rd] of [['pelvis', 1.05, 0.165, 0.118], ['spine_01', 1.20, 0.17, 0.12]] as [string, number, number, number][])
    add(bone, ellip([0, 0, z * s], [rd * kg * 0.97, rl * kg * 0.97, 0.06 * s], undefined, D.sw, D.sh), L.top);

  // ---- arms
  for (const side of ['l', 'r']) {
    const S = J[`upperarm_${side}`], d = dir[side];
    const P_ = (t: number) => add3(S, d, t * s);
    const r = (t: number) => (t <= 0.29 ? 0.068 + (0.054 - 0.068) * t / 0.29 : 0.054 + (0.04 - 0.054) * (t - 0.29) / 0.27) * kg;
    const seg = (bone: string, t0: number, t1: number) => {
      const cuts = [t0, ...(L.sleeve > t0 && L.sleeve < t1 ? [L.sleeve] : []), t1];
      for (let i = 0; i < cuts.length - 1; i++) {
        const top = (cuts[i] + cuts[i + 1]) / 2 < L.sleeve;
        add(bone, P.tube([P_(cuts[i]), P_(cuts[i + 1])], [r(cuts[i]), r(cuts[i + 1])], D.radial), top ? L.top : skin, top ? 0.75 : SKIN);
      }
    };
    add(`upperarm_${side}`, ellip(S, [r(0) * 1.02, r(0) * 1.02, r(0) * 1.02], undefined, D.sw, D.sh), L.sleeve >= 0.1 ? L.top : skin, L.sleeve >= 0.1 ? 0.75 : SKIN);
    seg(`upperarm_${side}`, 0, 0.29);
    add(`lowerarm_${side}`, ellip(P_(0.29), [r(0.29), r(0.29), r(0.29)], undefined, D.sw, D.sh), L.sleeve > 0.29 ? L.top : skin, L.sleeve > 0.29 ? 0.75 : SKIN);
    seg(`lowerarm_${side}`, 0.29, 0.56);
    // hand: ellipsoid (.032 lat, .05 depth, .085 along the arm) at hand + .055 d
    add(`hand_${side}`, ellip(add3(J[`hand_${side}`], d, 0.055 * s), [0.05 * s, 0.032 * s, 0.085 * s], rotX((side === 'l' ? 1 : -1) * ARM0 * 180 / Math.PI), D.sw, D.sh), skin, SKIN);
  }

  // ---- legs
  for (const [side, sy] of [['l', 1], ['r', -1]] as [string, number][]) {
    const H: Vec3 = [0, sy * 0.095 * hw * s, 0.90 * s], Kn = J[`calf_${side}`], A: Vec3 = [-0.015 * s, sy * 0.10 * hw * s, 0.075 * s];
    const rH = 0.105 * hw * kg, rK = 0.07 * kg, rA = 0.05 * kg;
    const legCol = (z: number) => (L.shorts && z < 0.55 ? skin : L.bottom);
    add(`thigh_${side}`, ellip(H, [rH, rH, rH], undefined, D.sw, D.sh), L.bottom);
    if (L.shorts) {
      const t = (0.90 - 0.55) / (0.90 - 0.52), C = add3(H, [Kn[0] - H[0], Kn[1] - H[1], Kn[2] - H[2]], t), rC = rH + (rK - rH) * t;
      add(`thigh_${side}`, P.tube([H, C], [rH, rC], D.radial), L.bottom);
      add(`thigh_${side}`, P.tube([C, Kn], [rC * 0.97, rK], D.radial), skin, SKIN);
    } else add(`thigh_${side}`, P.tube([H, Kn], [rH, rK], D.radial), L.bottom);
    add(`calf_${side}`, ellip(Kn, [rK, rK, rK], undefined, D.sw, D.sh), legCol(0.5), L.shorts ? SKIN : 0.75);
    add(`calf_${side}`, P.tube([Kn, A], [rK, rA], D.radial), legCol(0.3), L.shorts ? SKIN : 0.75);
    add(`foot_${side}`, ellip(A, [rA, rA, rA], undefined, D.sw, D.sh), legCol(0.07), L.shorts ? SKIN : 0.75);
    const h = L.bootH;
    add(`foot_${side}`, cube([0.055 * s, sy * 0.10 * hw * s, h / 2 * s], [0.255 * s, 0.105 * s, h * s], 0.018 * s), L.shoes, 0.6);
    if (L.kneepads) add(`calf_${side}`, cube([0.06 * g * s, sy * 0.10 * hw * s, 0.50 * s], [0.035 * s, 0.075 * s, 0.085 * s], 0.01 * s), FACTION.vest, 0.9);
  }

  // ---- head (offsets × s·hk, char_build's "front y" = +x here)
  const hk = L.head, u = s * hk;
  const hc: Vec3 = [0, 0, (1.58 + 0.085 * hk) * s];
  const hp = (lat: number, front: number, z: number): Vec3 => add3(hc, [front, lat, z], u);
  const hs: Vec3 = [0.098 * u, 0.088 * u, 0.112 * u];
  const sc = (k: number): Vec3 => [hs[0] * k, hs[1] * k, hs[2] * k];
  const DARK = '1A1A1A';
  add('head', ellip(hc, hs, undefined, D.sw + 2, D.sh), skin, SKIN);
  const [ws, hsm] = D.small;
  for (const sy of [1, -1]) {
    add('head', ellip(hp(sy * 0.034, 0.088, 0.016), [0.01 * u, 0.012 * u, 0.013 * u], undefined, ws, hsm), DARK, 0.4);
    add('head', ellip(hp(sy * 0.092, -0.004, 0), [0.024 * u, 0.012 * u, 0.03 * u], undefined, ws, hsm), skin, SKIN);
    add('head', cube(hp(sy * 0.034, 0.083, 0.044), [0.01 * u, 0.03 * u, 0.007 * u]), L.hair);
  }
  add('head', ellip(hp(0, 0.099, -0.006), [0.02 * u, 0.014 * u, 0.022 * u], undefined, ws, hsm), skin, SKIN);
  add('head', cube(hp(0, 0.088, -0.047), [0.01 * u, 0.03 * u, 0.006 * u]), '7A3B30', 0.5);
  // hair: keep above a plane through hc+.018 tilted so the hairline rises toward the face
  const hairOn = L.hairStyle !== 'none' && L.hat !== 'helmet' && L.hat !== 'boonie';
  if (hairOn) {
    const k = L.hairStyle === 'buzz' ? 1.025 : 1.07;
    add('head', clip(ellip(hp(0, -0.008, 0.012), sc(k), undefined, D.sw + 2, D.sh), hp(0, 0, 0.018), [-0.45, 0, 1]), L.hair);
    if (L.hairStyle === 'long') add('head', ellip(hp(0, -0.058, -0.075), [0.05 * u, 0.092 * u, 0.14 * u], undefined, D.sw, D.sh), L.hair);
  }
  if (L.beard) add('head', clip(ellip(hp(0, 0.03, -0.055), [0.072 * u, 0.082 * u, 0.075 * u], undefined, D.sw, D.sh), hp(0, 0, -0.038), [-0.35, 0, -1]), L.beardColor ?? L.hair);
  const hat = L.hatColor ?? FACTION.helmet;
  if (L.hat === 'helmet') add('head', clip(ellip(hp(0, -0.008, 0.02), sc(1.24), undefined, D.sw + 2, D.sh), hp(0, 0, 0.028), [-0.55, 0, 1]), FACTION.helmet, 0.85);
  else if (L.hat === 'cap' || L.hat === 'cap_back') {
    add('head', clip(ellip(hp(0, 0, 0.02), sc(1.1), undefined, D.sw + 2, D.sh), hp(0, 0, 0.035), [0, 0, 1]), hat);
    const f = L.hat === 'cap' ? 0.11 : -0.11;
    add('head', cyl([0, 0, 0], 1, 0.012 * u, 'Z', 16).applyMatrix4(new THREE.Matrix4().makeScale(0.075 * u, 0.078 * u, 1))
      .applyMatrix4(rotY(f > 0 ? 14 : -14).setPosition(...hp(0, f, 0.03))), hat);
  } else if (L.hat === 'beret') add('head', ellip(hp(0.018, -0.005, 0.098), [0.112 * u, 0.112 * u, 0.036 * u], rotX(14), D.sw, D.sh), hat);
  else if (L.hat === 'boonie') {
    add('head', clip(ellip(hp(0, 0, 0.03), sc(1.12), undefined, D.sw + 2, D.sh), hp(0, 0, 0.03), [0, 0, 1]), hat);
    add('head', cyl(hp(0, 0, 0.035), 0.16 * u, 0.008 * u, 'Z', 24), hat);
  }
  if (L.glasses) {
    for (const sy of [1, -1]) add('head', cyl(hp(sy * 0.034, 0.095, 0.016), 0.022 * u, 0.006 * u, 'X', 14), DARK, 0.4);
    add('head', cube(hp(0, 0.097, 0.018), [0.006 * u, 0.03 * u, 0.005 * u]), DARK, 0.4);
  }

  // ---- gear
  if (L.vest) {
    add('spine_03', cube([0, 0, 1.235 * s], [0.255 * g * s, 0.37 * sw * g * s, 0.31 * s], 0.03 * s), FACTION.vest, 0.9);
    for (const py of [-0.09, 0, 0.09]) add('spine_03', cube([0.135 * g * s, py * sw * s, 1.15 * s], [0.04 * s, 0.07 * s, 0.085 * s], 0.008 * s), FACTION.vest, 0.9);
  }
  if (L.belt) add('pelvis', cyl([0, 0, 0.985 * s], 1, 0.045 * s, 'Z', 20).applyMatrix4(new THREE.Matrix4().makeScale(0.118 * g * s, 0.165 * hw * g * s, 1)), '2A2620', 0.6);
  if (L.backpack) add('spine_03', cube([-(0.15 * g + 0.03) * s, 0, 1.25 * s], [0.13 * s, 0.27 * s, 0.34 * s], 0.025 * s), L.backpack, 0.85);
  if (L.patch) {
    const S = J.upperarm_l, E = J.lowerarm_l, n: Vec3 = [0, Math.cos(ARM0), Math.sin(ARM0)];
    const c = add3(add3(S, [E[0] - S[0], E[1] - S[1], E[2] - S[2]], 0.32), n, 0.05 * s * g * K + 0.012 * s);
    add('upperarm_l', cube(c, [0.05 * s, 0.006 * s, 0.055 * s], 0, rotX(ARM0 * 180 / Math.PI)), FACTION.patch, 0.5);
  }

  const geos = new Map<string, THREE.BufferGeometry>();
  for (const [bone, b] of B) geos.set(bone, b.build(40));
  const J3: Record<string, THREE.Vector3> = {};
  for (const k in J) J3[k] = toThree(J[k]);
  return { geos, J: J3, s };
}

// ---------------------------------------------------------------- weapons (06 §10), gun frame: grip at origin, barrel +x
export type Held = 'none' | 'pistol' | 'shotgun' | 'rifle';
export interface Weapon { geo: THREE.BufferGeometry; muzzle: THREE.Vector3; support: THREE.Vector3 }
const weapons = new Map<Held, Weapon>();
export function weapon(h: Exclude<Held, 'none'>): Weapon {
  let w = weapons.get(h);
  if (w) return w;
  const b = new GeoBuilder();
  let muzzle: Vec3, support: Vec3;
  if (h === 'pistol') {
    const C = '2B2B2B';
    b.add(cube([0.055, 0, 0.03], [0.20, 0.035, 0.045]), C, 0.5).add(cube([-0.005, 0, -0.04], [0.04, 0.03, 0.10], 0, rotY(15)), C, 0.5)
      .add(cube([0.03, 0, -0.012], [0.05, 0.008, 0.02]), C, 0.5);
    muzzle = [0.155, 0, 0.03]; support = [-0.005, 0.03, -0.05];
  } else if (h === 'rifle') {
    const C = '2E2E2E';
    b.add(cube([0.04, 0, 0.035], [0.36, 0.05, 0.09]), C, 0.5).add(cyl([0.38, 0, 0.05], 0.012, 0.32, 'X', 8), C, 0.5)
      .add(cube([0.30, 0, 0.045], [0.22, 0.055, 0.06]), C, 0.5).add(cube([-0.25, 0, 0.02], [0.24, 0.04, 0.09]), C, 0.5)
      .add(cube([0.10, 0, -0.05], [0.05, 0.03, 0.12], 0, rotY(-10)), C, 0.5).add(cube([0, 0, -0.035], [0.035, 0.03, 0.08], 0, rotY(15)), C, 0.5)
      .add(cube([0.05, 0, 0.095], [0.08, 0.02, 0.03]), C, 0.5);
    muzzle = [0.54, 0, 0.05]; support = [0.25, 0, 0.0];
  } else {
    const C = '2B2B2B', W = '6B4A2E';
    b.add(cube([0.03, 0, 0.03], [0.2, 0.045, 0.07]), C, 0.5).add(cyl([0.405, 0, 0.05], 0.015, 0.55, 'X', 8), C, 0.5)
      .add(cyl([0.36, 0, 0.022], 0.012, 0.45, 'X', 6), C, 0.5).add(cube([0.38, 0, 0.02], [0.17, 0.045, 0.045]), W, 0.7)
      .add(cube([-0.22, 0, 0.01], [0.30, 0.04, 0.10], 0, rotY(-5)), W, 0.7).add(cube([-0.03, 0, -0.03], [0.04, 0.03, 0.08], 0, rotY(15)), W, 0.7);
    muzzle = [0.68, 0, 0.05]; support = [0.33, 0, 0.0];
  }
  w = { geo: b.build(40), muzzle: toThree(muzzle), support: toThree(support) };
  weapons.set(h, w);
  return w;
}
