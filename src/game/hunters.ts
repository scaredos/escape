// Helicopter (3+ stars), tank (5 stars), highway roadblocks (3+ stars) - spec 03 §4-§6. Host only.
import { probe } from '../core/probe';
import { gameRng } from '../core/rng';
import { RAPIER, G_CAR, G_STATIC, groups } from '../physics/phys';
import { CAPSULE_HALF, EYE } from '../physics/character';
import { rayCharacter } from './weapons';
import { A, T, type EntRec } from './protocol';
import type { Char, Human, Sim } from './sim';

interface Heli { id: number; x: number; y: number; z: number; cx: number; cy: number; orbit: number; aimX: number; aimY: number; yaw: number; leaving: number; vx: number; vy: number }
interface Tank { id: number; x: number; y: number; yaw: number; turret: number; nextShot: number; wp: [number, number] | null; blocked: [number, number][]; lastPos: [number, number]; lastMoveT: number; body: RAPIER.RigidBody }
interface Shell { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; born: number }
export interface Roadblock { x: number; y: number; yaw: number; highway: string; lastNear: number; colliders: RAPIER.Collider[]; cells: number[] }

/** Roadblock geometry in local metres (+X = travel direction, +Y = right): barriers, jeeps, boom. Shared with the renderer. */
export const RB_BARRIERS = [-8, -6, -4, -2, 0, 2, 4];
export const RB_JEEPS: [number, number, number][] = [[10, -6, 15], [16, -3.5, -12]];

export class Hunters {
  heli: Heli | null = null; leavingHelis: Heli[] = [];
  tank: Tank | null = null; shells: Shell[] = [];
  roadblocks: Roadblock[] = [];
  constructor(public sim: Sim) {}
  private stars() { return this.sim.dir.phase === 'Escaped' ? 0 : this.sim.dir.stars; }
  private randomLiving(): Human | null { const l = this.sim.living(); return l.length ? l[gameRng.helper(l.length)] : null; }
  private hiddenFromAll(x: number, y: number, z: number) {
    for (const h of this.sim.living()) if (this.sim.phys.los(h.x, h.y, h.z + CAPSULE_HALF + EYE, x, y, z)) return false;
    return true;
  }

  // ------------------------------------------------------------------ hunter tick (2 s)
  tick() {
    const sim = this.sim, stars = this.stars(), living = sim.living();
    // helicopter
    if (stars >= 3 && !this.heli && living.length) {
      const h = this.randomLiving()!;
      this.heli = { id: sim.newId(), x: h.x, y: h.y - 150, z: 50, cx: h.x, cy: h.y - 150, orbit: 0, aimX: h.x, aimY: h.y, yaw: Math.PI / 2, leaving: 0, vx: 0, vy: 0 };
      sim.broadcast('Helicopter overhead! Stay out of the spotlight.'); probe('hunter_heli', { authority: true });
    } else if (this.heli && stars < 2) { this.heli.leaving = sim.now; this.leavingHelis.push(this.heli); this.heli = null; }
    // tank
    if (stars >= 5 && !this.tank && living.length) this.spawnTank();
    else if (this.tank && stars < 4) { sim.phys.world.removeRigidBody(this.tank.body); this.tank = null; }
    // roadblocks
    for (const r of [...this.roadblocks]) {
      if (living.some((h) => Math.hypot(h.x - r.x, h.y - r.y) <= 800)) r.lastNear = sim.now;
      const reason = stars < 2 ? 'stars' : sim.now - r.lastNear >= 30 ? 'far' : '';
      if (reason) this.removeRoadblock(r, reason);
    }
    if (stars >= 3 && this.roadblocks.length < 2) this.trySpawnRoadblock();
  }

  // ------------------------------------------------------------------ per frame
  frame(dt: number) {
    const sim = this.sim;
    const hl = this.heli;
    if (hl) {
      let tgt: Human | null = null, bd = Infinity;
      for (const h of sim.living()) { const d = Math.hypot(h.x - hl.cx, h.y - hl.cy, h.z - 0); if (d < bd) { bd = d; tgt = h; } }
      if (tgt) {
        const dx = tgt.x - hl.cx, dy = tgt.y - hl.cy, d = Math.hypot(dx, dy), s = Math.min(d, 15 * dt);
        if (d > 0) { hl.cx += (dx / d) * s; hl.cy += (dy / d) * s; }
      }
      hl.orbit += 0.22 * dt;
      const px = hl.cx + Math.cos(hl.orbit) * 40, py = hl.cy + Math.sin(hl.orbit) * 40, pz = 50;
      const mx = px - hl.x, my = py - hl.y, mz = pz - hl.z, md = Math.hypot(mx, my, mz), ms = Math.min(md, 30 * dt);
      if (md > 0) { hl.x += (mx / md) * ms; hl.y += (my / md) * ms; hl.z += (mz / md) * ms; }
      hl.yaw = hl.orbit + Math.PI / 2;
      if (tgt) {
        const ax = tgt.x - hl.aimX, ay = tgt.y - hl.aimY, ad = Math.hypot(ax, ay), as = Math.min(ad, 4.5 * dt);
        if (ad > 0) { hl.aimX += (ax / ad) * as; hl.aimY += (ay / ad) * as; }
        const lx = hl.x + Math.cos(hl.yaw) * 4.3, ly = hl.y + Math.sin(hl.yaw) * 4.3, lz = hl.z + 0.5;
        if (Math.hypot(hl.aimX - tgt.x, hl.aimY - tgt.y) <= 6 && Math.hypot(hl.x - tgt.x, hl.y - tgt.y) <= 64
          && sim.phys.los(lx, ly, lz, tgt.x, tgt.y, tgt.z + CAPSULE_HALF + EYE, G_STATIC | G_CAR)) sim.dir.noteSeen();
      }
    }
    for (const h of [...this.leavingHelis]) {
      h.x += Math.cos(h.yaw) * 30 * dt; h.y += Math.sin(h.yaw) * 30 * dt; h.z += 8 * dt;
      if (sim.now - h.leaving > 12) this.leavingHelis.splice(this.leavingHelis.indexOf(h), 1);
    }
    if (this.tank) this.tankFrame(this.tank, dt);
    this.shellsFrame(dt);
  }

  // ------------------------------------------------------------------ tank (§5)
  private spawnTank() {
    const sim = this.sim, mark = this.randomLiving()!, W = sim.wq.walk;
    const ring = sim.wq.walkRing(mark.x, mark.y, 150, 300); if (!ring.length) return;
    let pick = ring[0];
    for (let t = 0; t < 60; t++) {
      const i = ring[gameRng.helper(ring.length)]; pick = i;
      if (t >= 40 || this.hiddenFromAll(W[i * 2], W[i * 2 + 1], 2)) break;
    }
    const x = W[pick * 2], y = W[pick * 2 + 1], yaw = Math.atan2(mark.y - y, mark.x - x);
    const body = sim.phys.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, 1.1));
    sim.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(3.3, 1.7, 1.1).setCollisionGroups(groups(G_CAR, 0xffff)), body);
    this.tank = { id: sim.newId(), x, y, yaw, turret: 0, nextShot: sim.now + 4, wp: null, blocked: [], lastPos: [x, y], lastMoveT: sim.now, body };
    sim.broadcast('A TANK is rolling in. Run.'); probe('hunter_tank', { authority: true });
  }
  private hullClear(t: Tank, ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 2));
    for (let i = 1; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
      if (this.sim.wq.inBuilding(x, y, 1.8)) return false;
      for (const c of this.sim.cars.cars.values()) if (Math.hypot(c.x - x, c.y - y) < 3.5) return false;
    }
    void t; return true;
  }
  private tankFrame(t: Tank, dt: number) {
    const sim = this.sim;
    let tgt: Human | null = null, bd = Infinity;
    for (const h of sim.living()) { const d = Math.hypot(h.x - t.x, h.y - t.y, h.z - 1); if (d < bd) { bd = d; tgt = h; } }
    if (!tgt) return;
    const sees = sim.phys.los(t.x, t.y, 1.2 + 1.1, tgt.x, tgt.y, tgt.z + CAPSULE_HALF + EYE, G_STATIC | G_CAR), dist = Math.hypot(tgt.x - t.x, tgt.y - t.y);
    const want = Math.atan2(tgt.y - t.y, tgt.x - t.x) - t.yaw;
    const err = Math.atan2(Math.sin(want - t.turret), Math.cos(want - t.turret));
    t.turret += Math.sign(err) * Math.min(Math.abs(err), 40 * Math.PI / 180 * dt);
    if (sees && dist < 150 && Math.abs(err) < 4 * Math.PI / 180 && sim.now > t.nextShot) {
      t.nextShot = sim.now + 6;
      const a = t.yaw + t.turret, mx = t.x + Math.cos(a) * 6.5, my = t.y + Math.sin(a) * 6.5, mz = 1.1 + 1.1;
      const dx = tgt.x - mx, dy = tgt.y - my, dz = tgt.z + CAPSULE_HALF - mz, l = Math.hypot(dx, dy, dz);
      this.shells.push({ id: sim.newId(), x: mx, y: my, z: mz, vx: (dx / l) * 70, vy: (dy / l) * 70, vz: (dz / l) * 70, born: sim.now });
      probe('tank_fire', { dist_m: Math.round(dist) }); sim.sendAll({ t: 'tankFire', pos: [mx, my, mz] });
    }
    if (sees && dist <= 35) return;
    if (!t.wp || Math.hypot(t.wp[0] - t.x, t.wp[1] - t.y) < 3) {
      const W = sim.wq.walk, cur = Math.hypot(tgt.x - t.x, tgt.y - t.y);
      let best: [number, number] | null = null, bdist = Infinity;
      for (const i of sim.wq.walkRing(t.x, t.y, 4, 45)) {
        const x = W[i * 2], y = W[i * 2 + 1], d = Math.hypot(tgt.x - x, tgt.y - y);
        if (d >= cur - 2 || d >= bdist || t.blocked.some(([bx, by]) => Math.hypot(bx - x, by - y) < 3)) continue;
        if (!this.hullClear(t, t.x, t.y, x, y)) continue;
        best = [x, y]; bdist = d;
      }
      t.wp = best;
    }
    if (!t.wp) return;
    const hw = Math.atan2(t.wp[1] - t.y, t.wp[0] - t.x), he = Math.atan2(Math.sin(hw - t.yaw), Math.cos(hw - t.yaw));
    t.yaw += Math.sign(he) * Math.min(Math.abs(he), 35 * Math.PI / 180 * dt);
    if (Math.abs(he) < 25 * Math.PI / 180) {
      const step = 4.5 * dt, nx = t.x + Math.cos(t.yaw) * step, ny = t.y + Math.sin(t.yaw) * step;
      // crush: anyone in the hull's path dies, any team (spec 03 §5)
      const fx = Math.cos(t.yaw), fy = Math.sin(t.yaw);
      const crush = (c: Char) => {
        if (c.dead) return; const dx = c.x - nx, dy = c.y - ny;
        if (Math.abs(dx * fx + dy * fy) < 3.3 + 0.4 && Math.abs(-dx * fy + dy * fx) < 1.7 + 0.4) { c.launched = true; sim.kill(c, null, '', [fx * 18, fy * 18, 9]); }
      };
      for (const h of sim.humans.values()) crush(h);
      for (const b of sim.bots.byId.values()) crush(b);
      t.x = nx; t.y = ny;
      t.body.setNextKinematicTranslation({ x: t.x, y: t.y, z: 1.1 }); t.body.setNextKinematicRotation({ x: 0, y: 0, z: Math.sin(t.yaw / 2), w: Math.cos(t.yaw / 2) });
    }
    if (Math.hypot(t.x - t.lastPos[0], t.y - t.lastPos[1]) > 1) { t.lastPos = [t.x, t.y]; t.lastMoveT = sim.now; }
    else if (sim.now - t.lastMoveT > 3) { t.blocked.push(t.wp); if (t.blocked.length > 16) t.blocked.shift(); t.wp = null; t.lastMoveT = sim.now; }
  }
  private shellsFrame(dt: number) {
    const sim = this.sim;
    for (const s of [...this.shells]) {
      const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt, nz = s.z + s.vz * dt, L = Math.hypot(nx - s.x, ny - s.y, nz - s.z);
      s.vz -= 9.8 * 0.1 * dt;
      let hitD = Infinity;
      const dir = [(nx - s.x) / L, (ny - s.y) / L, (nz - s.z) / L];
      const w = sim.phys.ray(s.x, s.y, s.z, dir[0], dir[1], dir[2], L, G_STATIC | G_CAR, this.tank?.body);
      if (w) hitD = w.toi;
      for (const c of [...sim.humans.values(), ...sim.bots.byId.values()] as Char[]) {
        if (c.dead || Math.hypot(c.x - s.x, c.y - s.y) > L + 2) continue;
        const h = rayCharacter([s.x, s.y, s.z], dir, c); if (h && h.dist < hitD) hitD = h.dist;
      }
      if (nz <= 0.05 && hitD === Infinity) hitD = Math.max(0, (s.z - 0.05) / Math.max(1e-3, -dir[2]));
      if (hitD <= L) { this.blast(s.x + dir[0] * hitD, s.y + dir[1] * hitD, s.z + dir[2] * hitD); this.shells.splice(this.shells.indexOf(s), 1); continue; }
      s.x = nx; s.y = ny; s.z = nz;
      if (sim.now - s.born > 8) this.shells.splice(this.shells.indexOf(s), 1);
    }
  }
  private blast(x: number, y: number, z: number) {
    const sim = this.sim; let killed = 0;
    for (const c of [...sim.humans.values(), ...sim.bots.byId.values()] as Char[]) {
      if (c.dead) continue;
      const cz = c.z + CAPSULE_HALF, d = Math.hypot(c.x - x, c.y - y, cz - z); if (d > 8) continue;
      let ax = c.x - x, ay = c.y - y; const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
      const az = 0.8, n = Math.hypot(ax, ay, az), ux = ax / n, uy = ay / n, uz = az / n, fall = 1 - (d / 8) * 0.5;
      if (d < 4 || c.armor < 0.5) {
        const k = 32 * fall * (1 - 0.6 * c.armor); c.launched = true; sim.kill(c, null, '', [ux * k, uy * k, uz * k]); killed++;
      } else {
        const k = 14 * (1 - c.armor);
        if (c.type === T.HUMAN) { (c as Human).ms.vx = ux * k; (c as Human).ms.vy = uy * k; (c as Human).ms.vz = uz * k; }
      }
    }
    sim.sendAll({ t: 'blast', pos: [x, y, z] });
    probe('tank_shell', { killed });
  }

  // ------------------------------------------------------------------ roadblocks (§6)
  private trySpawnRoadblock() {
    const sim = this.sim, wq = sim.wq;
    for (const h of sim.living()) {
      if (wq.insetAt(h.x, h.y)) continue;
      const ch = wq.closestHighway(h.x, h.y); if (ch.d > 600) continue;
      const hw = wq.highways[ch.h], pts = hw.pts;
      const car = h.player.priv.car >= 0 ? sim.cars.cars.get(h.player.priv.car) : null;
      let vx = car ? car.body.linvel().x : h.ms.vx, vy = car ? car.body.linvel().y : h.ms.vy;
      if (Math.hypot(vx, vy) < 1.5) {
        let best = Infinity, cx = 0, cy = 0;
        for (let i = 0; i < wq.land.ox.length; i++) { const d = Math.hypot(wq.land.ox[i] + 1000 - h.x, wq.land.oy[i] + 1000 - h.y); if (d < best) { best = d; cx = wq.land.ox[i] + 1000; cy = wq.land.oy[i] + 1000; } }
        vx = h.x - cx; vy = h.y - cy;
      }
      const sx = pts[ch.k][0] - pts[ch.k - 1][0], sy = pts[ch.k][1] - pts[ch.k - 1][1];
      const dir = sx * vx + sy * vy > 0 ? 1 : -1;
      // walk the polyline from the closest point in `dir`, candidates every 10 m from 250 to 450 m ahead
      const cands: { x: number; y: number; yaw: number }[] = [];
      let px = ch.px, py = ch.py, k = dir > 0 ? ch.k : ch.k - 1, walked = 0, nextC = 250;
      while (k >= 0 && k < pts.length && nextC <= 450) {
        const [qx, qy] = pts[k], seg = Math.hypot(qx - px, qy - py);
        if (walked + seg >= nextC) {
          const u = (nextC - walked) / seg, x = px + (qx - px) * u, y = py + (qy - py) * u;
          if (!wq.insetAt(x, y) && !this.roadblocks.some((r) => Math.hypot(r.x - x, r.y - y) < 600) && Math.hypot(x - h.x, y - h.y) < 800)
            cands.push({ x, y, yaw: Math.atan2(qy - py, qx - px) });
          nextC += 10; continue;
        }
        walked += seg; px = qx; py = qy; k += dir;
      }
      if (!cands.length) continue;
      let pick = cands[cands.length - 1], hidden = false;
      const order = cands.slice(); for (let i = order.length - 1; i > 0; i--) { const j = gameRng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
      for (const c of order) if (this.hiddenFromAll(c.x, c.y, 1.5)) { pick = c; hidden = true; break; }
      this.placeRoadblock(pick.x, pick.y, pick.yaw, hw.name || 'the highway', h, hidden, !!car);
      return;
    }
  }
  private placeRoadblock(x: number, y: number, yaw: number, name: string, near: Human, hidden: boolean, driving: boolean) {
    const sim = this.sim, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const L = (lx: number, ly: number): [number, number] => [x + lx * cs + ly * sn, y + lx * sn - ly * cs]; // +Y local = right
    const r: Roadblock = { x, y, yaw, highway: name, lastNear: sim.now, colliders: [], cells: [] };
    const sg = groups(G_STATIC, 0xffff), W = sim.phys.world;
    for (const by of RB_BARRIERS) { const [bx, byy] = L(0, by); r.colliders.push(W.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.95, 0.45).setTranslation(bx, byy, 0.45).setRotation({ x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) }).setCollisionGroups(sg), sim.phys.staticBody)); }
    for (const [jx, jy, jyaw] of RB_JEEPS) { const [cx, cy] = L(jx, jy), a = yaw - jyaw * Math.PI / 180; r.colliders.push(W.createCollider(RAPIER.ColliderDesc.cuboid(2.21, 1.02, 0.96).setTranslation(cx, cy, 0.96).setRotation({ x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) }).setCollisionGroups(sg), sim.phys.staticBody)); }
    for (let lx = -0.5; lx <= 0.5; lx += 1) for (let ly = -9; ly <= 5; ly += 1) { const [cx, cy] = L(lx, ly); const k = sim.bots.nav.ckey(cx, cy); r.cells.push(k); sim.bots.nav.extraBlocked.add(k); }
    this.roadblocks.push(r);
    let guards = 0;
    for (const gy of [-5.0, 2.5, 7.0]) { const [gx, gyy] = L(gameRng.range(3, 6), gy + gameRng.range(-0.5, 0.5)); if (sim.bots.spawnSoldierAt(gx, gyy, near.x, near.y)) guards++; }
    sim.sendAll({ t: 'roadblocks', r: this.roadblockRecs() });
    sim.broadcast(`Roadblock ahead on ${name}!`);
    probe('roadblock_spawn', { highway: name, x: Math.round(x), y: Math.round(y), dist_m: Math.round(Math.hypot(x - near.x, y - near.y)), hidden, driving, guards, roadblocks: this.roadblocks.length });
  }
  private removeRoadblock(r: Roadblock, reason: string) {
    const sim = this.sim;
    for (const c of r.colliders) sim.phys.world.removeCollider(c, false);
    for (const k of r.cells) sim.bots.nav.extraBlocked.delete(k);
    this.roadblocks.splice(this.roadblocks.indexOf(r), 1);
    sim.sendAll({ t: 'roadblocks', r: this.roadblockRecs() });
    probe('roadblock_remove', { reason, x: Math.round(r.x), y: Math.round(r.y), roadblocks: this.roadblocks.length });
  }
  roadblockRecs(): number[][] { return this.roadblocks.map((r) => [r.x, r.y, r.yaw]); }

  records(out: EntRec[]) {
    for (const h of [this.heli, ...this.leavingHelis]) if (h)
      out.push([h.id, T.HELI, r2(h.x), r2(h.y), r2(h.z), r3(h.yaw), 0, 0, 0, 0, 0, 0, 0, 0, r2(h.aimX), r2(h.aimY), h.leaving ? 1 : 0]);
    if (this.tank) out.push([this.tank.id, T.TANK, r2(this.tank.x), r2(this.tank.y), 0, r3(this.tank.yaw), 0, 0, 0, 0, 0, 0, 0, 0, r3(this.tank.turret)]);
    for (const s of this.shells) out.push([s.id, T.SHELL, r2(s.x), r2(s.y), r2(s.z), 0, s.vx, s.vy, s.vz, 0, 0, 0, 0, 0]);
  }
}
const r2 = (v: number) => Math.round(v * 100) / 100, r3 = (v: number) => Math.round(v * 1000) / 1000;
export { A };
