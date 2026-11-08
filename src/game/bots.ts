// Soldiers and civilians: populations (spec 03 §2, §7.1), soldier AI (§3), civilian behaviour (§7.2-§7.6). Host only.
import { probe } from '../core/probe';
import { gameRng } from '../core/rng';
import { CAPSULE_HALF, EYE } from '../physics/character';
import { A, T, type EntRec } from './protocol';
import { WEAPONS, falloff, rayCharacter } from './weapons';
import { Nav } from './nav';
import { isHuman, type Char, type Human, type Sim } from './sim';

export interface Bot {
  id: number; type: T.SOLDIER | T.CIV; x: number; y: number; z: number; yaw: number; vx: number; vy: number;
  hp: number; maxHp: number; armor: number; dead: boolean; deadAt: number; look: number; launched: boolean;
  lastHitBy: Char | null; lastHitWeapon: string;
  // movement
  path: number[]; goalX: number; goalY: number; speed: number; tol: number; lastProgX: number; lastProgY: number; lastProgT: number; sideUntil: number; sideX: number; sideY: number;
  // civilian
  robbed?: boolean; panicUntil: number; frozenUntil: number; threatX: number; threatY: number; nextThink: number; nextDecision: number; idleUntil: number;
  nextLook: number; walkUntil: number; leader: Bot | null; side: number; pendingFollowers: number; firstDecision: boolean; seated: boolean; stuckSince: number;
  // soldier
  target: Human | null; perceived: boolean; seenSince: number; lostAt: number; nextRepath: number; nextStrafe: number; nextRetarget: number; nextLos: number; losOk: boolean;
  burstLeft: number; nextShot: number; mag: number; reloadEnd: number; lastNear: number; firstSight: number; moving: boolean;
}
const SOLDIERS_PER_STAR = [0, 2, 6, 10, 16, 24];
const ARMOR = [0.3, 0, 0.8, 0.2];

export class Bots {
  byId = new Map<number, Bot>();
  nav: Nav;
  private soldierRR = 0; private civRR = 0;
  private lastSoldierSpawn = -10; private nextCivSpawn = 0; private spawnedThisTick = false;
  private leader: Bot | null = null;
  constructor(private sim: Sim) { this.nav = new Nav(sim.phys, sim.wq); }
  soldiers() { const o: Bot[] = []; for (const b of this.byId.values()) if (b.type === T.SOLDIER) o.push(b); return o; }
  civs() { const o: Bot[] = []; for (const b of this.byId.values()) if (b.type === T.CIV) o.push(b); return o; }
  anyLiving(t: T, x: number, y: number, r: number) { for (const b of this.byId.values()) if (b.type === t && !b.dead && Math.hypot(b.x - x, b.y - y) <= r) return true; return false; }

  private make(type: T.SOLDIER | T.CIV, x: number, y: number, yaw: number): Bot {
    const b: Bot = { id: this.sim.newId(), type, x, y, z: 0, yaw, vx: 0, vy: 0, hp: 60, maxHp: 60, armor: 0, dead: false, deadAt: 0, look: 0, launched: false,
      lastHitBy: null, lastHitWeapon: '', path: [], goalX: x, goalY: y, speed: 0, tol: 0.5, lastProgX: x, lastProgY: y, lastProgT: this.sim.now, sideUntil: 0, sideX: 0, sideY: 0,
      panicUntil: 0, frozenUntil: 0, threatX: x, threatY: y, nextThink: 0, nextDecision: 0, idleUntil: 0, nextLook: 0, walkUntil: 0, leader: null, side: 0,
      pendingFollowers: 0, firstDecision: true, seated: false, stuckSince: 0, target: null, perceived: false, seenSince: 0, lostAt: -10, nextRepath: 0, nextStrafe: 0,
      nextRetarget: 0, nextLos: 0, losOk: false, burstLeft: 0, nextShot: 0, mag: 30, reloadEnd: 0, lastNear: this.sim.now, firstSight: 0, moving: false };
    if (type === T.SOLDIER) {
      const v = this.soldierRR++ % 4; b.look = 4 + v; b.armor = ARMOR[v]; b.maxHp = 100 / (1 - b.armor / 2); b.hp = b.maxHp;
      probe('character_part', { role: 2, part: v, armor: b.armor });
    } else { b.look = 1000 + (this.civRR++ * 7919) % 100000; }
    this.byId.set(b.id, b);
    probe('pawn_setup', { pawn: b.id, role: type === T.SOLDIER ? 'soldier' : 'civilian', armor: b.armor, max_health: Math.round(b.maxHp * 10) / 10 });
    return b;
  }
  spawnSoldierAt(x: number, y: number, faceX: number, faceY: number): Bot | null {
    if (this.soldiers().length >= 24) return null;
    const b = this.make(T.SOLDIER, x, y, Math.atan2(faceY - y, faceX - x));
    probe('spawn', { role: 'soldier', at: 'roadblock', x: +x.toFixed(1), y: +y.toFixed(1) });
    return b;
  }
  spawnCivilianAt(x: number, y: number, flee: boolean, fx: number, fy: number): Bot | null {
    if (this.civs().length >= 68) { probe('civilian_spawn_at', { ok: false, flee, x, y, civilians: this.civs().length }); return null; }
    const near = this.nearestHuman(x, y);
    const b = this.make(T.CIV, x, y, near ? Math.atan2(near.y - y, near.x - x) : 0);
    b.firstDecision = false;
    if (flee) this.panic(b, fx, fy, 12);
    probe('civilian_spawn_at', { ok: true, flee, x, y, civilians: this.civs().length });
    return b;
  }
  nearestHuman(x: number, y: number, maxD = Infinity): Human | null {
    let best: Human | null = null, bd = maxD;
    for (const h of this.sim.living()) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } }
    return best;
  }

  // ------------------------------------------------------------------ director hooks
  prune() {
    const now = this.sim.now;
    for (const b of this.byId.values()) if (b.dead && now - b.deadAt >= (b.type === T.SOLDIER ? 6 : 20)) this.byId.delete(b.id);
  }
  removeAllSoldiers() { for (const b of this.soldiers()) this.byId.delete(b.id); }
  private hiddenFromAll(x: number, y: number, up: number) {
    for (const h of this.sim.living()) if (this.sim.phys.los(h.x, h.y, h.z + CAPSULE_HALF + EYE, x, y, up)) return false;
    return true;
  }
  /** Ring spawn: walk points at r0..r1 from the anchor, up to `tries` picks hidden from all humans, else the farthest pick. */
  private ringPoint(ax: number, ay: number, r0: number, r1: number, tries: number, up: number): { x: number; y: number; hidden: boolean; d: number } | null {
    const ring = this.sim.wq.walkRing(ax, ay, r0, r1), W = this.sim.wq.walk;
    if (!ring.length) { const i = this.sim.wq.nearestWalkBeyond(ax, ay, r0); if (i < 0) return null; ring.push(i); }
    let far = -1, fd = -1;
    for (let t = 0; t < tries; t++) {
      const i = ring[gameRng.helper(ring.length)], x = W[i * 2], y = W[i * 2 + 1], d = Math.hypot(x - ax, y - ay);
      if (this.hiddenFromAll(x, y, up)) return { x, y, hidden: true, d };
      if (d > fd) { fd = d; far = i; }
    }
    return { x: W[far * 2], y: W[far * 2 + 1], hidden: false, d: fd };
  }
  /** One population pass per director tick (spec 03 §2 soldiers, §7.1 civilians). */
  populate(escaped: boolean) {
    const sim = this.sim, now = sim.now, living = sim.living();
    this.spawnedThisTick = false;
    for (const h of living) this.nav.want(h.x, h.y, 250);
    if (!living.length) return;
    const areaOf = (h: Human) => sim.wq.insetAt(h.x, h.y) || 'highway';
    if (!escaped) {
      const areas = new Map<string, Human[]>(); for (const h of living) { const a = areaOf(h); if (!areas.has(a)) areas.set(a, []); areas.get(a)!.push(h); }
      const per = sim.dir.phase === 'Finale' && sim.dir.finaleKind !== 'Airport' ? 24 : SOLDIERS_PER_STAR[sim.dir.stars];
      const wanted = Math.min(per * areas.size, 24);
      const sol = this.soldiers().filter((b) => !b.dead);
      const counts = new Map<string, number>();
      for (const b of sol) {
        const n = this.nearestHuman(b.x, b.y, 350);
        if (n) { b.lastNear = now; const a = areaOf(n); counts.set(a, (counts.get(a) ?? 0) + 1); }
        else if (now - b.lastNear >= 30) { this.byId.delete(b.id); probe('soldier_despawn', { soldiers: sol.length - 1, target: wanted, dist_m: -1 }); }
      }
      const live = this.soldiers().filter((b) => !b.dead);
      const keep = Math.min(wanted + (sim.hunters.roadblocks.length ? 6 : 0), 24);
      if (live.length > keep) {
        let worst: Bot | null = null, wd = -1;
        for (const b of live) { const n = this.nearestHuman(b.x, b.y); const d = n ? Math.hypot(n.x - b.x, n.y - b.y) : 1e9; if (d > wd) { wd = d; worst = b; } }
        if (worst) { this.byId.delete(worst.id); probe('soldier_despawn', { soldiers: live.length - 1, target: keep, dist_m: Math.round(wd) }); }
      } else if (live.length < wanted && now - this.lastSoldierSpawn >= 0.5) {
        let needy: string | null = null, nb = Infinity;
        for (const a of areas.keys()) { const c = counts.get(a) ?? 0; if (c < per && c < nb) { nb = c; needy = a; } }
        if (needy) {
          const hs = areas.get(needy)!, anchor = hs[gameRng.helper(hs.length)];
          const pt = this.ringPoint(anchor.x, anchor.y, 100, 180, 40, 1.5);
          if (pt) {
            this.make(T.SOLDIER, pt.x, pt.y, gameRng.frand() * Math.PI * 2);
            this.lastSoldierSpawn = now; this.spawnedThisTick = true;
            probe('spawn', { role: 'soldier', dist_m: Math.round(pt.d), hidden: pt.hidden });
          }
        }
      }
    }
    // civilians
    for (const b of this.civs()) if (!b.dead && !b.seated && !this.nearestHuman(b.x, b.y, 150)) this.byId.delete(b.id);
    const cities = new Map<string, Human[]>();
    for (const h of living) { const a = sim.wq.insetAt(h.x, h.y); if (!a) continue; if (!cities.has(a)) cities.set(a, []); cities.get(a)!.push(h); }
    const wanted = Math.min(30 * cities.size, 60);
    const kept = this.civs().filter((b) => !b.dead && !b.seated);
    if (kept.length >= wanted) { this.leader = null; return; }
    if (this.spawnedThisTick) return;
    const L = this.leader;
    if (L && L.pendingFollowers > 0) {
      if (!L.dead && this.byId.has(L.id) && now >= L.panicUntil) {
        const left = L.pendingFollowers % 2 === 0; L.pendingFollowers--;
        const rx = Math.sin(L.yaw), ry = -Math.cos(L.yaw), s = left ? -1.2 : 1.2;
        const f = this.make(T.CIV, L.x + rx * s, L.y + ry * s, L.yaw);
        f.leader = L; f.side = (left ? -1 : 1) * gameRng.range(0.7, 1.1); f.firstDecision = false;
        return;
      }
      L.pendingFollowers = 0; this.leader = null;
    }
    if (now < this.nextCivSpawn) return;
    const counts = new Map<string, number>();
    for (const b of kept) { const n = this.nearestHuman(b.x, b.y, 150); if (n) { const a = sim.wq.insetAt(n.x, n.y); counts.set(a, (counts.get(a) ?? 0) + 1); } }
    let needy: string | null = null, nb = Infinity;
    for (const a of cities.keys()) { const c = counts.get(a) ?? 0; if (c < 30 && c < nb) { nb = c; needy = a; } }
    if (!needy) return;
    const hs = cities.get(needy)!, anchor = hs[gameRng.helper(hs.length)];
    const pt = this.ringPoint(anchor.x, anchor.y, 25, 90, 12, 1.5);
    if (!pt) return;
    const c = this.make(T.CIV, pt.x, pt.y, gameRng.frand() * Math.PI * 2);
    probe('spawn', { role: 'civilian', dist_m: Math.round(pt.d), hidden: pt.hidden });
    if (!this.nearestHuman(c.x, c.y, 150)) { this.byId.delete(c.id); this.nextCivSpawn = now + 5; probe('civilian_spawn_far', { dist_m: Math.round(pt.d) }); return; }
    if (gameRng.frand() < 0.3) { c.pendingFollowers = gameRng.frand() < 0.33 ? 2 : 1; this.leader = c; }
  }

  // ------------------------------------------------------------------ events
  onShot(x: number, y: number, _by: Char) {
    for (const b of this.byId.values()) if (b.type === T.CIV && !b.dead && Math.hypot(b.x - x, b.y - y) <= 40) this.panic(b, x, y, 12);
  }
  onDamaged(b: Bot, by: Char | null) {
    if (b.type === T.CIV && !b.dead && b.hp > 0) this.panic(b, by ? by.x : b.x, by ? by.y : b.y, 12);
    if (b.type === T.SOLDIER && by && isHuman(by)) { b.target = by; b.perceived = true; b.lostAt = this.sim.now; if (!b.seenSince) b.seenSince = this.sim.now; }
  }
  panic(b: Bot, tx: number, ty: number, seconds: number) {
    if (b.dead) return;
    b.panicUntil = Math.max(b.panicUntil, this.sim.now + seconds); b.threatX = tx; b.threatY = ty;
    probe('civilian_panic', { civilian: b.id, seconds });
    if (this.sim.now >= b.frozenUntil) this.flee(b);
  }
  robbed(c: Bot, h: Human) {
    const now = this.sim.now;
    c.frozenUntil = now + 1.5; c.yaw = Math.atan2(h.y - c.y, h.x - c.x); c.path = []; c.speed = 0;
    c.panicUntil = Math.max(c.panicUntil, c.frozenUntil + 15); c.threatX = h.x; c.threatY = h.y;
    probe('civilian_panic', { civilian: c.id, seconds: 16.5 });
  }
  private flee(b: Bot) {
    let dx = b.x - b.threatX, dy = b.y - b.threatY, l = Math.hypot(dx, dy);
    if (l < 1e-3) { const a = gameRng.frand() * 6.283; dx = Math.cos(a); dy = Math.sin(a); l = 1; }
    const rot = (gameRng.frand() * 60 - 30) * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
    const fx = (dx * c - dy * s) / l, fy = (dx * s + dy * c) / l;
    let gx = b.x + fx * 40, gy = b.y + fy * 40;
    const snap = this.nav.project(gx, gy, 15) ?? this.nav.randomReachable(b.x, b.y, 40, () => gameRng.frand());
    if (snap) { gx = snap[0]; gy = snap[1]; }
    this.goTo(b, gx, gy, 5.5, 1);
    b.nextDecision = this.sim.now + 2;
  }
  private goTo(b: Bot, x: number, y: number, speed: number, tol: number) {
    b.goalX = x; b.goalY = y; b.speed = speed; b.tol = tol;
    b.path = this.nav.built(b.x, b.y) ? this.nav.findPath(b.x, b.y, x, y) : [x, y];
    b.lastProgX = b.x; b.lastProgY = b.y; b.lastProgT = this.sim.now;
  }

  // ------------------------------------------------------------------ per frame
  frame(dt: number) {
    this.nav.pump(2);
    const now = this.sim.now;
    for (const b of this.byId.values()) {
      if (b.dead || b.seated) { b.vx = b.vy = 0; continue; }
      if (b.type === T.CIV) { if (now >= b.nextThink) { b.nextThink = now + 0.2; this.thinkCiv(b); } }
      else this.thinkSoldier(b, dt);
      this.move(b, dt);
    }
  }
  private move(b: Bot, dt: number) {
    const now = this.sim.now;
    if (now < b.frozenUntil || !b.path.length || b.speed <= 0) { b.vx = b.vy = 0; b.moving = false; return; }
    if (now < b.sideUntil) { this.stepTo(b, b.x + b.sideX, b.y + b.sideY, b.speed, dt); return; }
    if (b.sideUntil > 0) { b.sideUntil = 0; b.path = this.nav.built(b.x, b.y) ? this.nav.findPath(b.x, b.y, b.goalX, b.goalY) : [b.goalX, b.goalY]; if (!b.path.length) return; }
    const tx = b.path[0], ty = b.path[1], d = Math.hypot(tx - b.x, ty - b.y);
    const tol = b.path.length <= 2 ? b.tol : 0.6;
    if (d <= tol) { b.path.splice(0, 2); if (!b.path.length) { b.vx = b.vy = 0; b.moving = false; } return; }
    this.stepTo(b, tx, ty, b.speed, dt);
    // stuck rule: < 0.2 m in 1 s -> sidestep 0.5 s then re-path
    if (now - b.lastProgT >= 1) {
      if (Math.hypot(b.x - b.lastProgX, b.y - b.lastProgY) < 0.2) {
        const a = Math.atan2(ty - b.y, tx - b.x) + (gameRng.bool() ? 1 : -1) * Math.PI / 2;
        b.sideX = Math.cos(a) * 2; b.sideY = Math.sin(a) * 2; b.sideUntil = now + 0.5;
        if (!b.stuckSince) b.stuckSince = now;
      } else b.stuckSince = 0;
      b.lastProgX = b.x; b.lastProgY = b.y; b.lastProgT = now;
    }
  }
  private stepTo(b: Bot, tx: number, ty: number, speed: number, dt: number) {
    const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy); if (d < 1e-4) return;
    const s = Math.min(speed * dt, d), nx = b.x + (dx / d) * s, ny = b.y + (dy / d) * s;
    let mx = nx, my = ny;
    if (!this.nav.free(nx, ny)) { if (this.nav.free(nx, b.y)) my = b.y; else if (this.nav.free(b.x, ny)) mx = b.x; else { mx = b.x; my = b.y; } }
    b.vx = (mx - b.x) / dt; b.vy = (my - b.y) / dt; b.x = mx; b.y = my; b.moving = true;
    if (b.type === T.CIV || !b.perceived) b.yaw = turn(b.yaw, Math.atan2(dy, dx), 8 * dt);
    b.z = this.sim.wq.onLand(b.x, b.y) ? 0 : -0.55;
  }

  // ------------------------------------------------------------------ civilians (5 Hz think)
  private thinkCiv(b: Bot) {
    const now = this.sim.now;
    if (now < b.frozenUntil) { b.path = []; return; }
    if (now < b.panicUntil) {
      b.speed = 5.5;
      if (!b.path.length || now >= b.nextDecision) this.flee(b);
      return;
    }
    if (b.leader) {
      const L = b.leader;
      if (L.dead || !this.byId.has(L.id) || Math.hypot(L.x - b.x, L.y - b.y) > 25) b.leader = null;
      else if (now < L.panicUntil) { this.panic(b, L.threatX, L.threatY, 12); return; }
      else {
        const rx = Math.sin(L.yaw), ry = -Math.cos(L.yaw);
        const sx = L.x + rx * b.side + L.vx * 0.5, sy = L.y + ry * b.side + L.vy * 0.5, d = Math.hypot(sx - b.x, sy - b.y);
        const lsp = Math.hypot(L.vx, L.vy);
        if ((lsp > 0.3 || Math.hypot(L.x - b.x, L.y - b.y) > 3) && d > 0.3) { b.path = [sx, sy]; b.speed = d > 2 ? 2.3 : 1.7; b.tol = 0.3; }
        else { b.path = []; b.yaw = Math.atan2(L.y - b.y, L.x - b.x); }
        return;
      }
    }
    b.speed = 1.7;
    if (b.path.length) {                       // moving: keep going (stuck 4 s -> new wander goal)
      if (b.stuckSince && now - b.stuckSince > 4) { b.stuckSince = 0; b.path = []; } else return;
    }
    if (now < b.idleUntil || now < b.nextDecision) {
      if (now >= b.nextLook) { b.nextLook = now + gameRng.range(2, 5); b.yaw += (gameRng.frand() * 200 - 100) * Math.PI / 180; }
      return;
    }
    if (!b.firstDecision && gameRng.frand() < 0.35) { b.idleUntil = now + gameRng.range(4, 12); b.nextLook = now + gameRng.range(1, 3); b.path = []; return; }
    b.firstDecision = false;
    b.nextDecision = now + 1;
    const g = this.nav.built(b.x, b.y) ? this.nav.randomReachable(b.x, b.y, 40, () => gameRng.frand()) : null;
    if (g) this.goTo(b, g[0], g[1], 1.7, 0.5);
    else {
      const ring = this.sim.wq.walkRing(b.x, b.y, 5, 40);
      if (ring.length) { const i = ring[gameRng.helper(ring.length)]; b.path = [this.sim.wq.walk[i * 2], this.sim.wq.walk[i * 2 + 1]]; b.goalX = b.path[0]; b.goalY = b.path[1]; }
    }
  }

  // ------------------------------------------------------------------ soldiers
  private thinkSoldier(b: Bot, dt: number) {
    const sim = this.sim, now = sim.now;
    if (now >= b.nextRetarget || (b.target && b.target.dead)) {
      b.nextRetarget = now + 1;
      let best: Human | null = null, bd = Infinity;
      for (const h of sim.living()) {
        let d = Math.hypot(h.x - b.x, h.y - b.y);
        if (b.perceived && h === b.target) d *= 0.5;
        if (d < bd) { bd = d; best = h; }
      }
      if (best !== b.target) { b.target = best; b.perceived = false; b.seenSince = 0; }
    }
    const t = b.target;
    if (!t || t.dead) { b.path = []; b.perceived = false; return; }
    const tz = t.z + CAPSULE_HALF + EYE, ez = b.z + CAPSULE_HALF + EYE, dist = Math.hypot(t.x - b.x, t.y - b.y, tz - ez);
    if (now >= b.nextLos) {
      b.nextLos = now + 0.2;
      const range = b.perceived ? 60 : 50;
      const ang = Math.abs(wrap(Math.atan2(t.y - b.y, t.x - b.x) - b.yaw));
      b.losOk = dist <= range && (b.perceived || ang <= Math.PI / 2) && sim.phys.los(b.x, b.y, ez, t.x, t.y, tz);
      if (b.losOk) { if (!b.perceived) { b.perceived = true; b.firstSight = now; b.seenSince = now; } b.lostAt = now; }
      else if (b.perceived && now - b.lostAt > 1) { b.perceived = false; b.seenSince = 0; }
    }
    if (!b.perceived) {
      // hunt: path toward the target (or its car), re-path every 1 s
      if (now >= b.nextRepath) {
        b.nextRepath = now + 1;
        if (this.nav.built(b.x, b.y)) this.goTo(b, t.x, t.y, 6, 0.5); else { b.path = [t.x, t.y]; b.speed = 6; b.tol = 0.5; }
      }
      return;
    }
    // engage
    b.yaw = turn(b.yaw, Math.atan2(t.y - b.y, t.x - b.x), 10 * dt);
    if (now >= b.nextStrafe) {
      b.nextStrafe = now + gameRng.range(0.7, 1.3);
      const cands: { x: number; y: number; d: number }[] = [];
      for (let i = -4; i <= 4; i += 1.5) for (let j = -4; j <= 4; j += 1.5) {
        const x = b.x + i, y = b.y + j; if (!this.nav.free(x, y)) continue;
        const d = Math.hypot(t.x - x, t.y - y); if (d > 50) continue;
        if (!this.nav.lineFree(b.x, b.y, x, y)) continue;
        if (!sim.phys.los(x, y, ez, t.x, t.y, tz)) continue;
        cands.push({ x, y, d });
      }
      cands.sort((a, c) => a.d - c.d);
      const top = cands.slice(0, Math.max(1, Math.ceil(cands.length * 0.25)));
      if (top.length) { const c = top[gameRng.helper(top.length)]; b.path = [c.x, c.y]; b.speed = 6; b.tol = 0.25; }
    }
    // fire
    if (b.reloadEnd > 0) { if (now >= b.reloadEnd) { b.reloadEnd = 0; b.mag = 30; } return; }
    if (!b.losOk || now - b.firstSight < 0.5 || now < b.nextShot) return;
    if (b.burstLeft <= 0) b.burstLeft = gameRng.int(3, 6);
    this.soldierFire(b, t);
    b.burstLeft--; b.mag--;
    if (b.mag <= 0) { b.reloadEnd = now + WEAPONS.rifle.reload; b.burstLeft = 0; }
    b.nextShot = now + (b.burstLeft > 0 ? 0.1 : gameRng.range(0.4, 0.8));
  }
  private soldierFire(b: Bot, t: Human) {
    const sim = this.sim, now = sim.now;
    const ox = b.x, oy = b.y, oz = b.z + CAPSULE_HALF + EYE;
    const tx = t.x, ty = t.y, tz = t.z + CAPSULE_HALF;
    let dx = tx - ox, dy = ty - oy, dz = tz - oz; const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
    const sight = now - b.seenSince, cone = Math.max(1.5, 6 - (4.5 * Math.min(sight, 2)) / 2) + (b.moving ? 1 : 0);
    const a = gameRng.frand() * Math.PI * 2, r = Math.tan(cone * Math.PI / 180) * Math.sqrt(gameRng.frand());
    let ux = -dy, uy = dx; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const vx = dy * 0 - dz * uy, vy = dz * ux, vz = dx * uy - dy * ux;
    let rx = dx + (ux * Math.cos(a) + vx * Math.sin(a)) * r, ry = dy + (uy * Math.cos(a) + vy * Math.sin(a)) * r, rz = dz + vz * Math.sin(a) * r;
    const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
    const maxD = 250;
    const wall = sim.phys.ray(ox, oy, oz, rx, ry, rz, maxD, 0x0001 | 0x0004);
    let end = wall ? wall.toi : maxD;
    let victim: Char | null = null;
    const cands: Char[] = [...sim.humans.values(), ...this.byId.values()];
    for (const c of cands) {
      if (c === b || c.dead || Math.hypot(c.x - ox, c.y - oy) > end + 2) continue;
      const hit = rayCharacter([ox, oy, oz], [rx, ry, rz], c);
      if (hit && hit.dist < end) { end = hit.dist; victim = c; }
    }
    if (victim && isHuman(victim)) sim.damage(victim, WEAPONS.rifle.dmg * falloff(WEAPONS.rifle, end), b, 'rifle');
    this.onShot(ox, oy, b);
    const origin = [ox, oy, oz], ends = [[ox + rx * end, oy + ry * end, oz + rz * end]];
    for (const p of sim.players.values()) {
      const pp = p.pawn; if (pp && Math.hypot(pp.x - ox, pp.y - oy) > 300) continue;
      sim.net.send(p.id, { t: 'shotFx', shooter: b.id, weapon: 'rifle', origin, ends }, false);
    }
  }

  records(out: EntRec[]) {
    const now = this.sim.now;
    for (const b of this.byId.values()) {
      let f = 0;
      if (b.dead) f |= A.DEAD;
      if (b.seated) f |= A.SEATED;
      if (now < b.frozenUntil) f |= A.HANDSUP;
      if (b.type === T.CIV) { if (now < b.panicUntil) f |= A.PANIC; else if (b.moving || now - b.walkUntil < 1) { f |= A.WALK; if (b.moving) b.walkUntil = now; } }
      if (b.type === T.SOLDIER && b.perceived) f |= A.AIM;
      if (b.type === T.SOLDIER && now - b.nextShot > -0.12 && b.burstLeft > 0) f |= A.FIRING;
      if (b.reloadEnd > 0) f |= A.RELOAD;
      out.push([b.id, b.type, r2(b.x), r2(b.y), r2(b.z), r3(b.yaw), r2(b.vx), r2(b.vy), 0, f, Math.round(b.hp), Math.round(b.maxHp), b.type === T.SOLDIER ? 3 : 0, b.look]);
    }
  }
}
const r2 = (v: number) => Math.round(v * 100) / 100, r3 = (v: number) => Math.round(v * 1000) / 1000;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const turn = (a: number, b: number, max: number) => { const d = wrap(b - a); return a + Math.max(-max, Math.min(max, d)); };
