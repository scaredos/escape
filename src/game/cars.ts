// Vehicles (spec 04 §6-§11): Rapier ray-cast cars with the shared drivetrain, enter/exit/carjack, run-overs, parked cars.
import { probe } from '../core/probe';
import { Rng, gameRng } from '../core/rng';
import { RAPIER, G_CAR, G_STATIC, groups } from '../physics/phys';
import { CAPSULE_HALF } from '../physics/character';
import { VEHICLE_SPECS, type VehicleModel, type VehicleSpec } from '../render/vehicles/index';
import { A, T, type EntRec } from './protocol';
import { isHuman, type Char, type Player, type Sim } from './sim';
import { Traffic, type TrafficAI } from './traffic';

export const CAR_MODELS: VehicleModel[] = ['sedan', 'taxi', 'van', 'pickup', 'hunter_jeep'];
const RATIOS = [2.8, 1.9, 1.35, 1.0], TOP = 26.4, DES_TOP = 30.5;
const torqueCurve = (rpm: number) => rpm < 1500 ? 0.75 + 0.25 * rpm / 1500 : rpm < 5200 ? 1 : rpm < 6000 ? 1 - (rpm - 5200) / 800 : 0;
const mph = (v: number) => Math.abs(v) * 2.23694;
export function steerScale(v: number) {
  const m = mph(v);
  if (m < 20) return 1 - 0.2 * m / 20; if (m < 60) return 0.8 - 0.4 * (m - 20) / 40; if (m < 120) return 0.4 - 0.1 * (m - 60) / 60; return 0.3;
}

export interface Car {
  id: number; model: VehicleModel; spec: VehicleSpec; paint: number; body: RAPIER.RigidBody; vc: RAPIER.DynamicRayCastVehicleController;
  driver: Player | null; npc: number; ai: TrafficAI | null; gear: number; shiftUntil: number; reverse: boolean;
  thr: number; brk: number; hb: number; steer: number; steerIn: number; inThr: number; inSteer: number; inHb: boolean;
  speed: number; x: number; y: number; z: number; yaw: number; upZ: number; driveOverride: number[] | null; lastNpcDriver: number;
}
export class Cars {
  cars = new Map<number, Car>();
  traffic: Traffic;
  constructor(private sim: Sim) { this.traffic = new Traffic(sim, this); }

  spawn(model: VehicleModel, x: number, y: number, z: number, yawRad: number, paint = -1): Car {
    const spec = VEHICLE_SPECS[model] ?? VEHICLE_SPECS.sedan, W = this.sim.phys.world;
    const [L, Wd, H] = spec.size, r = spec.wheelRadius, zb = Math.min(r, H - 0.5);
    const body = W.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: 0, z: Math.sin(yawRad / 2), w: Math.cos(yawRad / 2) })
      .setLinearDamping(0.05).setAngularDamping(0.5).setCanSleep(true));
    W.createCollider(RAPIER.ColliderDesc.cuboid(L / 2, Wd / 2, (H - zb) / 2).setTranslation(0, 0, (H + zb) / 2).setDensity(0)
      .setCollisionGroups(groups(G_CAR, G_STATIC | G_CAR)).setFriction(0.3), body);
    body.setAdditionalMassProperties(spec.mass, { x: 0, y: 0, z: r },
      { x: spec.mass * (Wd * Wd + H * H) / 12, y: spec.mass * (L * L + H * H) / 12, z: spec.mass * (L * L + Wd * Wd) / 12 }, { x: 0, y: 0, z: 0, w: 1 }, true);
    const vc = W.createVehicleController(body);
    vc.indexUpAxis = 2; (vc as any).setIndexForwardAxis = 0;
    for (const [ax, sy] of [[spec.axleFront, 1], [spec.axleFront, -1], [spec.axleRear, 1], [spec.axleRear, -1]]) {
      vc.addWheel({ x: ax, y: sy * spec.wheelY, z: r + 0.2 }, { x: 0, y: 0, z: -1 }, { x: 0, y: -1, z: 0 }, 0.2, r);
    }
    for (let i = 0; i < 4; i++) {
      vc.setWheelMaxSuspensionTravel(i, 0.2); vc.setWheelSuspensionStiffness(i, 30); vc.setWheelSuspensionCompression(i, 3.5);
      vc.setWheelSuspensionRelaxation(i, 4); vc.setWheelFrictionSlip(i, 3.0); vc.setWheelSideFrictionStiffness(i, 1.0);
      vc.setWheelMaxSuspensionForce(i, spec.mass * 30);
    }
    const c: Car = { id: this.sim.newId(), model, spec, paint: paint >= 0 ? paint : 0, body, vc, driver: null, npc: 0, ai: null, gear: 0, shiftUntil: 0, reverse: false,
      thr: 0, brk: 0, hb: 1, steer: 0, steerIn: 0, inThr: 0, inSteer: 0, inHb: true, speed: 0, x, y, z, yaw: yawRad, upZ: 1, driveOverride: null, lastNpcDriver: 0 };
    this.cars.set(c.id, c);
    return c;
  }
  remove(c: Car) {
    if (c.driver) this.exit(c.driver, true);
    this.sim.phys.world.removeVehicleController(c.vc); this.sim.phys.world.removeRigidBody(c.body); this.cars.delete(c.id);
  }

  // ------------------------------------------------------------------ parked cars (§11)
  parkAll() {
    const wq = this.sim.wq, W = wq.walk, ends = this.sim.wq.gen.highwayEnds;
    let total = 0;
    for (let e = 0; e < ends.length; e += 2) {
      const cands: number[] = [];
      for (let i = 0; i < W.length / 2; i++) if (Math.hypot(W[i * 2] - ends[e], W[i * 2 + 1] - ends[e + 1]) <= 150) cands.push(i);
      total += this.parkBatch(cands, 3);
    }
    const all: number[] = []; for (let i = 0; i < W.length / 2; i++) all.push(i);
    total += this.parkBatch(all, 40);
  }
  private parkBatch(cands: number[], want: number): number {
    const W = this.sim.wq.walk, rng = new Rng(0xe5ca + cands.length);
    const a = cands.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); [a[i], a[j]] = [a[j], a[i]]; }
    const placed: [number, number][] = []; const models: Record<string, number> = {};
    for (const i of a) {
      if (placed.length >= want) break;
      const px = W[i * 2], py = W[i * 2 + 1];
      if (placed.some(([x, y]) => Math.hypot(x - px, y - py) < 40)) continue;
      const start = rng.int(0, 3);
      for (let k = 0; k < 4; k++) {
        const yaw = ((start + k) % 4) * Math.PI / 2, rx = Math.sin(yaw), ry = -Math.cos(yaw);
        const x = px + rx * 1.0, y = py + ry * 1.0;
        if (this.sim.phys.boxBlocked(x, y, 0.4 + 1.0, 2.6, 1.1, 0.6, yaw)) continue;
        const model = CAR_MODELS[rng.helper(5)];
        const spec = VEHICLE_SPECS[model];
        this.spawn(model, x, y, 0.4, yaw, rng.helper(spec.paints.length));
        placed.push([px, py]); models[model] = (models[model] ?? 0) + 1;
        break;
      }
    }
    probe('vehicles_parked', { count: placed.length, wanted: want, candidates: cands.length, models });
    return placed.length;
  }

  // ------------------------------------------------------------------ enter / exit (§8)
  /** Distance from a point to the car's box in car space (0 inside). */
  boxDist(c: Car, x: number, y: number): number {
    const dx = x - c.x, dy = y - c.y, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const u = Math.abs(dx * cs + dy * sn) - c.spec.size[0] / 2, v = Math.abs(-dx * sn + dy * cs) - c.spec.size[1] / 2;
    return Math.hypot(Math.max(u, 0), Math.max(v, 0));
  }
  inReach(x: number, y: number, reach: number): Car | null {
    let best: Car | null = null, bd = reach;
    for (const c of this.cars.values()) {
      if (c.driver) continue;
      if (c.npc && Math.abs(c.speed) > 4) continue;
      if (Math.hypot(c.x - x, c.y - y) > 12) continue;
      const d = this.boxDist(c, x, y); if (d <= bd) { bd = d; best = c; }
    }
    return best;
  }
  toggle(p: Player) {
    const h = p.pawn; if (!h || h.dead) return;
    probe('vehicle_key', { key: 'F', near: !!this.inReach(h.x, h.y, 4), driving: p.priv.car >= 0 });
    if (p.priv.car >= 0) { this.exit(p, false); return; }
    const c = this.inReach(h.x, h.y, 4.0);
    if (!c) { this.sim.tell(p, 'No car close enough - walk up to one until it says [F] Get in'); probe('vehicle_toggle', { result: 'none', car: -1 }); return; }
    this.enter(p, c);
  }
  enter(p: Player, c: Car) {
    const h = p.pawn!; if (c.driver) return;
    if (c.npc) {
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), rx = sn, ry = -cs; // car right
      const side = ((h.x - c.x) * rx + (h.y - c.y) * ry) > 0 ? -1 : 1;    // away from the player
      const off = c.spec.size[1] / 2 + 1.2;
      const civ = this.sim.bots.spawnCivilianAt(c.x + rx * side * off, c.y + ry * side * off, true, h.x, h.y);
      probe('carjack', { car: c.id, driver: p.id, civilian: civ?.id ?? -1, x: c.x, y: c.y });
      c.npc = 0; c.ai = null; this.traffic.release(c);
    }
    c.driver = p; p.priv.car = c.id; c.inHb = false; c.inThr = 0; c.inSteer = 0; c.driveOverride = null;
    h.body.setEnabled(false); h.ms.vx = h.ms.vy = h.ms.vz = 0;
    c.body.wakeUp();
    probe('vehicle_enter', { car: c.id, model: c.model, driver: p.id });
  }
  exit(p: Player, forced: boolean) {
    const c = this.cars.get(p.priv.car); p.priv.car = -1; p.carInput = null;
    const h = p.pawn;
    if (!c) return;
    c.driver = null; c.inThr = 0; c.inSteer = 0; c.inHb = true; c.driveOverride = null;
    if (h && !h.dead) {
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), lx = -sn, ly = cs; // car left
      const tryAt = (s: number) => {
        const x = c.x + lx * s * 2.5, y = c.y + ly * s * 2.5, z = c.z + 1.0;
        return this.sim.phys.boxBlocked(x, y, z, 0.35, 0.35, 0.85, 0) ? null : [x, y, z];
      };
      const spot = tryAt(1) ?? tryAt(-1) ?? [c.x, c.y, c.z + 3.5];
      h.ms.x = spot[0]; h.ms.y = spot[1]; h.ms.z = spot[2] + 0.0; h.ms.vx = h.ms.vy = h.ms.vz = 0;
      h.x = spot[0]; h.y = spot[1]; h.z = spot[2] - CAPSULE_HALF; h.yaw = c.yaw;
      h.body.teleport(h.ms.x, h.ms.y, h.ms.z); h.body.setEnabled(true);
    }
    probe('vehicle_exit', { car: c.id, driver: p.id, alive: !!h && !h.dead, forced });
  }

  // ------------------------------------------------------------------ per step
  step(dt: number) {
    for (const c of this.cars.values()) {
      if (c.body.isSleeping() && !c.driver && !c.ai) continue;
      let thr = 0, steer = 0, hb = c.inHb;
      if (c.driver) {
        const ci = c.driver.carInput;
        if (c.driveOverride) { thr = c.driveOverride[0]; steer = c.driveOverride[1]; hb = false; }
        else if (ci) { thr = ci.throttle; steer = ci.steer; hb = ci.handbrake; }
      } else if (c.ai) { thr = c.inThr; steer = c.inSteer; hb = c.inHb; }
      this.drive(c, thr, steer, hb, dt);
    }
  }
  /** Shared drivetrain (§7): throttle axis, auto gearbox, steering curve, brakes, handbrake. */
  drive(c: Car, axis: number, steerIn: number, hbIn: boolean, dt: number) {
    const vc = c.vc, spec = c.spec, mass = spec.mass, v = c.speed, now = this.sim.now;
    const tgtThr = Math.max(0, axis), tgtBrk = Math.max(0, -axis), tgtHb = hbIn ? 1 : 0;
    const app = (cur: number, tgt: number, up: number, down: number) => tgt > cur ? Math.min(tgt, cur + up * dt) : Math.max(tgt, cur - down * dt);
    c.thr = app(c.thr, tgtThr, 6, 10); c.brk = app(c.brk, tgtBrk, 6, 10); c.hb = app(c.hb, tgtHb, 12, 12);
    let drive = 0, brake = 0;
    if (c.reverse) {
      if (c.thr > 0.05) { c.reverse = false; c.gear = 0; }
      else if (c.brk > 0.05) drive = -c.brk;
    }
    if (!c.reverse) {
      if (c.brk > 0.05 && v > 1) brake = 1;
      else if (c.brk > 0.05 && v <= 1) { c.reverse = true; drive = -c.brk; }
      else drive = c.thr;
    }
    // gearbox
    const rpm = 6000 * RATIOS[c.gear] * Math.abs(v) / DES_TOP;
    if (!c.reverse && now >= c.shiftUntil) {
      if (rpm > 5200 && c.gear < 3) { c.gear++; c.shiftUntil = now + 0.15; }
      else if (rpm < 2500 && c.gear > 0) { c.gear--; c.shiftUntil = now + 0.15; }
    }
    let accel = 0;
    if (drive > 0 && now >= c.shiftUntil && v < TOP) accel = 0.15 * 20.6 * RATIOS[c.gear] * torqueCurve(6000 * RATIOS[c.gear] * Math.abs(v) / DES_TOP) * drive * 0.82;
    if (drive < 0 && v > -10) accel = -0.15 * 20.6 * RATIOS[0] * torqueCurve(6000 * RATIOS[0] * Math.abs(v) / DES_TOP) * -drive * 0.82;
    const driven = spec.driven === 'all' ? [0, 1, 2, 3] : [2, 3];
    for (let i = 0; i < 4; i++) vc.setWheelEngineForce(i, driven.includes(i) ? mass * accel / driven.length : 0);
    const brakeF = brake * mass * 8 / 4 * 0.05 + (accel === 0 && drive === 0 && c.thr < 0.05 && !c.driver && !c.ai ? 0 : 0);
    for (let i = 0; i < 4; i++) vc.setWheelBrake(i, brakeF + (i >= 2 ? c.hb * mass * 6 / 2 * 0.05 : 0));
    for (let i = 2; i < 4; i++) vc.setWheelSideFrictionStiffness(i, c.hb > 0.5 ? 0.3 : 1.0);
    // steering
    const sr = Math.abs(steerIn) > Math.abs(c.steerIn) && Math.sign(steerIn) === Math.sign(c.steerIn || steerIn) ? 2.5 : 5;
    c.steerIn = app(c.steerIn, steerIn, sr, sr);
    // input +1 = steer right; wheel angle in the map frame is positive to the left
    const a = -(35 * Math.PI / 180) * steerScale(v) * Math.sign(c.steerIn) * c.steerIn * c.steerIn;
    c.steer = a;
    // Ackermann: the inner wheel (turning side) turns more, the outer 0.7x
    vc.setWheelSteering(0, a > 0 ? a : a * 0.7); vc.setWheelSteering(1, a > 0 ? a * 0.7 : a);
    if (axis !== 0 || Math.abs(steerIn) > 0.01) c.body.wakeUp();
    vc.updateVehicle(dt, undefined, groups(G_CAR, G_STATIC | G_CAR));
    // drag
    const lv = c.body.linvel(), sp = Math.hypot(lv.x, lv.y);
    if (sp > 1) { const k = 0.5 * 1.2 * 0.3 * spec.size[1] * spec.size[2] * sp / mass * dt; c.body.setLinvel({ x: lv.x * (1 - k), y: lv.y * (1 - k), z: lv.z }, true); }
  }
  afterStep(_dt: number) {
    for (const c of this.cars.values()) {
      const t = c.body.translation(), q = c.body.rotation(), lv = c.body.linvel();
      c.x = t.x; c.y = t.y; c.z = t.z;
      c.yaw = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
      c.upZ = 1 - 2 * (q.x * q.x + q.y * q.y);
      c.speed = lv.x * Math.cos(c.yaw) + lv.y * Math.sin(c.yaw);
      if (c.driver) {
        const h = c.driver.pawn;
        if (h) {
          const [sx, sy, sz] = c.spec.seat, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
          h.x = c.x + sx * cs - sy * sn; h.y = c.y + sx * sn + sy * cs; h.z = c.z + sz - 0.45; h.yaw = c.yaw;
          h.ms.x = h.x; h.ms.y = h.y; h.ms.z = h.z + CAPSULE_HALF; h.ms.vx = lv.x; h.ms.vy = lv.y;
          h.body.teleport(h.ms.x, h.ms.y, h.ms.z + 3);
          if (Math.hypot(lv.x, lv.y) >= 8) this.runOver(c, lv);
        }
      }
      if (t.z < -30) { c.body.setTranslation({ x: t.x, y: t.y, z: 2 }, true); c.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
    }
    this.traffic.frame();
  }
  private runOver(c: Car, lv: { x: number; y: number; z: number }) {
    const sim = this.sim, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const hl = c.spec.size[0] / 2 + 0.4, hw = c.spec.size[1] / 2 + 0.2;
    const victims: Char[] = [];
    for (const b of sim.bots.byId.values()) {
      if (b.dead || b.seated || Math.hypot(b.x - c.x, b.y - c.y) > 6) continue;
      const dx = b.x - c.x, dy = b.y - c.y;
      if (Math.abs(dx * cs + dy * sn) <= hl && Math.abs(-dx * sn + dy * cs) <= hw) victims.push(b);
    }
    for (const v of victims) {
      if (isHuman(v)) continue;
      const k = 1 - v.armor, sp = Math.hypot(lv.x, lv.y);
      v.launched = true;
      sim.kill(v, null, '', [(lv.x * 1.2) * k, (lv.y * 1.2) * k, (lv.z * 1.2 + 6) * k]);
      let heat = 0;
      if (v.type === T.CIV) { const seen = sim.dir.soldierSees(v.x, v.y, v.z + 0.9 + 0.5); heat = seen ? 200 : 100; }
      else heat = 40;
      sim.dir.addHeat(heat, 'Hit and run');
      probe('run_over', { victim: v.id, civilian: v.type === T.CIV, speed: +sp.toFixed(1), heat });
    }
  }

  records(out: EntRec[]) {
    for (const c of this.cars.values()) {
      const q = c.body.rotation(), lv = c.body.linvel();
      out.push([c.id, T.CAR, r2(c.x), r2(c.y), r2(c.z), r3(c.yaw), r2(lv.x), r2(lv.y), r2(lv.z), c.driver ? A.SEATED : 0, 0, 0, 0,
        CAR_MODELS.indexOf(c.model as any), CAR_MODELS.indexOf(c.model as any), c.driver ? c.driver.id : -1, c.npc, r3(c.steer), c.paint,
        r3(q.x), r3(q.y), r3(q.z), r3(q.w), r2(c.speed), r2(c.thr)]);
    }
  }
}
const r2 = (v: number) => Math.round(v * 100) / 100, r3 = (v: number) => Math.round(v * 1000) / 1000;
export { gameRng };
