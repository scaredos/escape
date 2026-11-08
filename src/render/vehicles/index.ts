// Procedural vehicle models (spec 06 §8, 04 §6). Geometry is built once per model and shared; buildVehicle() returns a
// new Group each call. root origin = ground under the car centre, forward = three +X, source +y (left) = three -Z.
import * as THREE from 'three';
import { GeoBuilder, vertexColorMaterial, type Vec3 } from '../geo';
import { VB, cyl, tintMaterial, cabinGlassMaterial } from './kit';
import { sedan, van, pickup, hunterJeep, CAR_ROLES, type CarDef } from './cars';
import { tank, tankWheel, heli, TANK, HELI } from './hunters';

export type VehicleModel = 'sedan' | 'taxi' | 'van' | 'pickup' | 'hunter_jeep' | 'hunter_tank' | 'hunter_heli';
export interface VehicleSpec {
  model: VehicleModel; size: [number, number, number] /* L, W, H */; mass: number; wheelRadius: number; wheelWidth: number;
  axleFront: number; axleRear: number; wheelY: number; driven: 'rear' | 'all' | 'none'; seat: [number, number, number] /* car space, +y left */;
  paints: string[] /* hex, [0] = base */;
}
const S = (model: VehicleModel, size: [number, number, number], mass: number, wheelRadius: number, wheelWidth: number, axleFront: number,
  axleRear: number, wheelY: number, driven: VehicleSpec['driven'], seat: [number, number, number], paints: string): VehicleSpec =>
  ({ model, size, mass, wheelRadius, wheelWidth, axleFront, axleRear, wheelY, driven, seat, paints: paints.split(' ') });
/** Numbers from spec 04 §6. Tank: wheel numbers are the physics road wheels (6 per side, x = 2.15 - 0.86 i); heli has none. */
export const VEHICLE_SPECS: Record<VehicleModel, VehicleSpec> = {
  sedan: S('sedan', [4.60, 1.82, 1.45], 1400, 0.32, 0.22, 1.38, -1.32, 0.74, 'rear', [0, 0.38, 0.48], '3B6FB6 F2F2F2 1C1C1C 9AA0A6 6E6E6E 8C2F2A 2F4A3A D9CBA8'),
  taxi: S('taxi', [4.60, 1.82, 1.62], 1400, 0.32, 0.22, 1.38, -1.32, 0.74, 'rear', [0, 0.38, 0.48], 'F2F2F2 E6E6E6'),
  van: S('van', [5.00, 2.07, 2.20], 2000, 0.34, 0.24, 1.65, -1.55, 0.81, 'rear', [1.0, 0.45, 0.95], 'E8E6DF F2F2F2 9AA0A6 3A4A5C B8C7D6 C9B88F'),
  pickup: S('pickup', [5.30, 1.96, 1.82], 1900, 0.38, 0.26, 1.75, -1.45, 0.75, 'rear', [0.05, 0.40, 0.85], '8C2F2A F2F2F2 1C1C1C 9AA0A6 C9B88F 2F4A6D'),
  hunter_jeep: S('hunter_jeep', [4.42, 2.05, 1.92], 2400, 0.40, 0.30, 1.40, -1.20, 0.78, 'all', [0.20, 0.42, 1.12], '5B6B3A 4A5530 56603C'),
  hunter_tank: S('hunter_tank', [10.19, 3.60, 2.65], 55000, 0.40, 0.60, 2.15, -2.15, 1.42, 'all', [2.1, 0.4, 1.05], '5B6B3A A8946A 6B6E66'),
  hunter_heli: S('hunter_heli', [15.75, 10.24, 4.49], 5000, 0, 0, 0, 0, 0, 'none', [2.55, -0.55, 1.42], '5B6B3A EDEBE4 B3261E 4A5530 2E3B4E'),
};

export interface VehicleVisual {
  root: THREE.Group;
  /** Cars: FL, FR, RL, RR. Tank: 12 road wheels L1..L6, R1..R6 (front first). Spin = rotation.z (negative rolls forward), steer = rotation.y. */
  wheels: THREE.Object3D[];
  glass?: THREE.Mesh;
  /** main spins about its local Y, tail about its local Z. */
  rotors?: { main: THREE.Object3D; tail: THREE.Object3D };
  /** turret yaws (rotation.y), barrel pitches (rotation.z, + = up). */
  turret?: THREE.Object3D;
  barrel?: THREE.Object3D;
  setPaint(hex: string): void;
  /** Heli only: fade in the translucent rotor blur discs, k in 0..1 (06 §8.3: above ~3 rev/s). */
  setRotorBlur?(k: number): void;
}

const toThree = (p: Vec3) => new THREE.Vector3(p[0], p[2], -p[1]);
interface PartT { name: string; parent: string | null; pos: THREE.Vector3; stat?: THREE.BufferGeometry; paint?: THREE.BufferGeometry; glass?: THREE.BufferGeometry }
interface Template { parts: PartT[]; wheelGeo?: THREE.BufferGeometry; wheels: { pos: THREE.Vector3; parent: string }[] }

function bake(b: GeoBuilder, pivot: THREE.Vector3) {
  if (b.empty) return undefined;
  const g = b.build(35);
  g.translate(-pivot.x, -pivot.y, -pivot.z);
  g.computeBoundingSphere();
  return g;
}
function partsOf(vb: VB): PartT[] {
  return [...vb.parts.values()].map((p) => {
    const pos = toThree(p.pivot);
    return { name: p.name, parent: p.parent, pos, stat: bake(p.stat, pos), paint: bake(p.paint, pos), glass: bake(p.glass, pos) };
  });
}

/** Tyre (20 segments, bevelled shoulders), rim r*.6, hub r*.2, centred, axle along source y. */
function carWheel(r: number, tw: number, rim: string) {
  const b = Math.min(r, tw) * 0.22, h = tw / 2;
  const prof = [[r * 0.6, -h], [r - b, -h], [r, -h + b], [r, h - b], [r - b, h], [r * 0.6, h]].map(([x, y]) => new THREE.Vector2(x, y));
  return new GeoBuilder()
    .add(new THREE.LatheGeometry(prof, 20), CAR_ROLES.Tyre[0], 0.9)
    .add(cyl([0, 0, 0], r * 0.6, tw + 0.02, 'Y', 12), rim, 0.35)
    .add(cyl([0, 0, 0], r * 0.2, tw + 0.05, 'Y', 8), CAR_ROLES.Trim[0], 0.7)
    .build(35);
}

const templates = new Map<VehicleModel, Template>();
function template(model: VehicleModel): Template {
  let t = templates.get(model);
  if (t) return t;
  if (model === 'hunter_tank') {
    t = { parts: partsOf(tank()), wheelGeo: tankWheel().build(35), wheels: [] };
    for (const s of [1, -1]) for (const x of TANK.WX) t.wheels.push({ pos: toThree([x, s * TANK.WY, TANK.WR]), parent: 'chassis' });
  } else if (model === 'hunter_heli') {
    t = { parts: partsOf(heli()), wheels: [] };
  } else {
    const c: CarDef = model === 'van' ? van() : model === 'pickup' ? pickup() : model === 'hunter_jeep' ? hunterJeep() : sedan(model === 'taxi');
    t = { parts: partsOf(c.vb), wheelGeo: carWheel(c.r, c.tw, c.rim), wheels: [] };
    for (const [x, sy] of [[c.xf, 1], [c.xf, -1], [c.xr, 1], [c.xr, -1]]) t.wheels.push({ pos: toThree([x, sy * c.wy, c.r]), parent: 'chassis' });
  }
  templates.set(model, t);
  return t;
}

const discGeo = new Map<number, THREE.BufferGeometry>();
function blurDisc(r: number, axis: 'y' | 'z'): THREE.Mesh {
  let g = discGeo.get(r);
  if (!g) { g = new THREE.CircleGeometry(r, 32); discGeo.set(r, g); }
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  if (axis === 'y') m.rotation.x = -Math.PI / 2;
  m.visible = false; m.castShadow = false; m.renderOrder = 2;
  return m;
}

export function buildVehicle(model: VehicleModel, paintHex?: string): VehicleVisual {
  const t = template(model);
  const root = new THREE.Group();
  root.name = model;
  const objs = new Map<string, THREE.Object3D>(), pos = new Map<string, THREE.Vector3>();
  const paintMeshes: THREE.Mesh[] = [];
  let glass: THREE.Mesh | undefined;
  const paint = tintMaterial(paintHex ?? VEHICLE_SPECS[model].paints[0]);
  const opaque = (g: THREE.BufferGeometry, m: THREE.Material) => { const x = new THREE.Mesh(g, m); x.castShadow = x.receiveShadow = true; return x; };
  for (const p of t.parts) {
    const o = new THREE.Group();
    o.name = p.name;
    o.position.copy(p.pos).sub(p.parent ? pos.get(p.parent)! : new THREE.Vector3());
    (p.parent ? objs.get(p.parent)! : root).add(o);
    objs.set(p.name, o); pos.set(p.name, p.pos);
    if (p.stat) o.add(opaque(p.stat, vertexColorMaterial()));
    if (p.paint) { const m = opaque(p.paint, paint); paintMeshes.push(m); o.add(m); }
    if (p.glass) {
      glass = new THREE.Mesh(p.glass, cabinGlassMaterial());
      glass.renderOrder = 1; glass.castShadow = false; glass.name = 'glass';
      o.add(glass);
    }
  }
  const wheels = t.wheels.map((w, i) => {
    const o = new THREE.Group();
    o.name = `wheel${i}`;
    o.rotation.order = 'YXZ'; // spin (z) first, then steer (y)
    o.position.copy(w.pos).sub(pos.get(w.parent)!);
    o.add(opaque(t.wheelGeo!, vertexColorMaterial()));
    objs.get(w.parent)!.add(o);
    return o;
  });
  const v: VehicleVisual = {
    root, wheels, glass,
    setPaint(hex: string) { const m = tintMaterial(hex); for (const x of paintMeshes) x.material = m; },
  };
  if (model === 'hunter_tank') { v.turret = objs.get('turret'); v.barrel = objs.get('barrel'); }
  if (model === 'hunter_heli') {
    const main = objs.get('main_rotor')!, tail = objs.get('tail_rotor')!;
    const dm = blurDisc(HELI.R_MAIN, 'y'), dt = blurDisc(HELI.R_TAIL, 'z');
    dm.position.y = 0.08;
    main.add(dm); tail.add(dt);
    v.rotors = { main, tail };
    v.setRotorBlur = (k: number) => {
      for (const d of [dm, dt]) { (d.material as THREE.MeshBasicMaterial).opacity = 0.35 * k; d.visible = k > 0.01; }
    };
  }
  return v;
}
