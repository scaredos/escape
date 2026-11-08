// Host-authoritative simulation (listen server). Runs every rule; clients send inputs/requests (spec 05 H15-H16).
import { probe } from '../core/probe';
import { gameRng } from '../core/rng';
import { CharBody, CAPSULE_HALF, EYE, type MoveState, maxWalk } from '../physics/character';
import { G_CAR, G_STATIC, type Phys } from '../physics/phys';
import type { WorldQ } from '../world/query';
import { A, E, PROTOCOL_V, BUILD_ID, T, WEAPON_IDS, starsOf, shekels, type C2H, type EntRec, type H2C, type InputMsg, type PlayerInfo, type PrivateState, type WeaponType } from './protocol';
import { WEAPONS, KNOCKBACK_NONE, Spread, falloff, spreadRays, rayCharacter } from './weapons';
import { Economy } from './economy';
import { Director } from './director';
import { Bots, type Bot } from './bots';
import { Cars, type Car } from './cars';
import { Hunters } from './hunters';
import { SaveSys } from './save';
import { runCheat } from '../dev/cheats';

export interface HostNet { send(pid: number, m: H2C, reliable?: boolean): void; drop(pid: number): void }

export interface Human {
  id: number; type: T.HUMAN; player: Player; ms: MoveState; body: CharBody; yaw: number; pitch: number;
  x: number; y: number; z: number; hp: number; maxHp: number; armor: number; dead: boolean; deadAt: number;
  flags: number; launched: boolean; lastHitBy: Char | null; lastHitWeapon: WeaponType | '';
}
export type Char = Human | Bot;
export const isHuman = (c: Char): c is Human => c.type === T.HUMAN;
export const teamOf = (c: Char) => (c.type === T.HUMAN ? 1 : 2);

export interface Player {
  id: number; name: string; look: number; local: boolean; priv: PrivateState; pawn: Human | null;
  inputs: InputMsg[]; lastSeq: number; lastInput: InputMsg; lastAliveX: number; lastAliveY: number;
  keptWeapons: WeaponType[]; keptActive: number; spread: Spread; lastShotAt: number; firedSinceTick: boolean;
  robbed: Set<number>; burgerEarned: number; carInput: { throttle: number; steer: number; handbrake: boolean } | null;
  lastPriv: string; lastHeard: number;
}
const freshPriv = (): PrivateState => ({ bag: 0, armor: 0, passport: false, jobOrder: [], jobTray: [], jobOrdersLeft: 0, jobEnd: 0, jobCooldownEnd: 0,
  deliveryLabel: '', deliveryX: 0, deliveryY: 0, deliveryReward: 0, deliveryDeadline: 0, weapons: [], active: -1, reloadEnd: 0, equipEnd: 0,
  dead: true, respawnAt: 0, pawn: -1, car: -1 });

export class Sim {
  now = 0;
  nextId = 1;
  players = new Map<number, Player>();
  humans = new Map<number, Human>();
  econ: Economy; dir: Director; bots: Bots; cars: Cars; hunters: Hunters; save: SaveSys;
  private acc = { dir: 0, hunt: 0, save: 0, snap: 0 };
  private nextPlayerId = 1;
  private lookRR = 0;
  constructor(public phys: Phys, public wq: WorldQ, public net: HostNet, public opts: { nosave: boolean; scripted: boolean; fresh?: boolean }) {
    this.econ = new Economy(this);
    this.dir = new Director(this);
    this.bots = new Bots(this);
    this.cars = new Cars(this);
    this.hunters = new Hunters(this);
    this.save = new SaveSys(this);
    probe('director_ready', { money: this.dir.money });
    this.cars.parkAll();
  }
  newId() { return this.nextId++; }

  // ------------------------------------------------------------------ messaging
  broadcast(text: string) { for (const p of this.players.values()) this.net.send(p.id, { t: 'msg', text }); }
  tell(p: Player | null | undefined, text: string) { if (p) this.net.send(p.id, { t: 'msg', text, private: true }); }
  nameOf(p: Player | null | undefined) { return p?.name || 'Someone'; }
  sendAll(m: H2C, reliable = true) { for (const p of this.players.values()) this.net.send(p.id, m, reliable); }

  // ------------------------------------------------------------------ players
  addPlayer(name: string, local: boolean): Player {
    const id = this.nextPlayerId++;
    let nm = name.slice(0, 16) || `Player-${id}`, n = 2;
    while ([...this.players.values()].some((p) => p.name === nm)) nm = `${name.slice(0, 13)} ${n++}`;
    const p: Player = { id, name: nm, look: this.lookRR++ % 4, local, priv: freshPriv(), pawn: null, inputs: [], lastSeq: -1,
      lastInput: { seq: -1, dt: 0, mx: 0, my: 0, yaw: 0, pitch: 0, sprint: false, jump: false, crouch: false, fire: false, aim: false },
      lastAliveX: 0, lastAliveY: 0, keptWeapons: [], keptActive: 0, spread: new Spread(), lastShotAt: -10, firedSinceTick: false,
      robbed: new Set(), burgerEarned: 0, carInput: null, lastPriv: '', lastHeard: this.now };
    this.players.set(id, p);
    this.spawnHuman(p);
    if (this.players.size > 1) this.broadcast(`${p.name} joined`);
    return p;
  }
  welcome(p: Player): H2C {
    return { t: 'welcome', playerId: p.id, hostTime: this.now, players: this.playerInfos(), spots: this.econ.spotStates(), director: this.dir.state(),
      roadblocks: this.hunters.roadblockRecs(), name: p.name, v: PROTOCOL_V };
  }
  playerInfos(): PlayerInfo[] { return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, pawn: p.pawn?.id ?? -1 })); }
  removePlayer(pid: number) {
    const p = this.players.get(pid); if (!p) return;
    const h = p.pawn;
    if (h) {
      if (p.priv.car >= 0) this.cars.exit(p, true);
      if (p.priv.bag > 0) { this.econ.dropBag(p.lastAliveX, p.lastAliveY, p.priv.bag); probe('bag_drop', { value: p.priv.bag, x: p.lastAliveX, y: p.lastAliveY }); this.broadcast('A bag was dropped!'); }
      h.body.dispose(); this.humans.delete(h.id);
    }
    this.players.delete(pid);
    this.broadcast(`${p.name} left`);
  }
  /** Living humans (pawn alive). */
  living(): Human[] { return [...this.humans.values()].filter((h) => !h.dead); }

  spawnHuman(p: Player) {
    const sh = this.respawnSafehouse(p);
    const a = gameRng.frand() * Math.PI * 2, r = 2.5 * Math.sqrt(gameRng.frand());
    const x = sh.rx + Math.cos(a) * r, y = sh.ry + Math.sin(a) * r, z = 1 + CAPSULE_HALF;
    if (p.pawn) { p.pawn.body.dispose(); this.humans.delete(p.pawn.id); }
    const h: Human = { id: this.newId(), type: T.HUMAN, player: p, ms: { x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, airTime: 0 },
      body: new CharBody(this.phys, x, y, z), yaw: gameRng.frand() * Math.PI * 2, pitch: 0, x, y, z: z - CAPSULE_HALF,
      hp: 100, maxHp: 100, armor: 0, dead: false, deadAt: 0, flags: 0, launched: false, lastHitBy: null, lastHitWeapon: '' };
    this.humans.set(h.id, h);
    p.pawn = h; p.priv.dead = false; p.priv.pawn = h.id; p.priv.armor = 0; p.priv.car = -1;
    p.lastAliveX = x; p.lastAliveY = y;
    // weapons come back fresh in the same slot order
    p.priv.weapons = p.keptWeapons.map((t) => ({ type: t, mag: WEAPONS[t].mag, spare: WEAPONS[t].spare }));
    p.priv.active = p.priv.weapons.length ? (p.priv.weapons[p.keptActive] ? p.keptActive : 0) : -1;
    p.priv.equipEnd = this.now + 0.4; p.priv.reloadEnd = 0;
    if (p.keptWeapons.length) probe('weapons_kept', { count: p.keptWeapons.length, slot: p.priv.active });
    probe('spawn', { role: 'human', safehouse: sh.name, x: +x.toFixed(1), y: +y.toFixed(1) });
    probe('pawn_setup', { pawn: h.id, role: 'human', armor: 0, max_health: 100 });
  }
  respawnSafehouse(p: Player) {
    const safes = this.wq.spots.filter((s) => s.mode === 'safehouse');
    let best = safes.find((s) => s.name === 'Safehouse (The Postel)') ?? safes[0], bd = Infinity;
    for (const h of this.living()) {
      if (h.player === p) continue;
      for (const s of safes) { const d = Math.hypot(s.rx - h.x, s.ry - h.y); if (d < bd) { bd = d; best = s; } }
    }
    return best;
  }

  // ------------------------------------------------------------------ requests
  onMessage(pid: number, m: C2H) {
    const p = this.players.get(pid); if (!p) return;
    p.lastHeard = this.now;
    switch (m.t) {
      case 'input': for (const i of m.inputs) if (i.seq > p.lastSeq && !p.inputs.some((q) => q.seq === i.seq)) p.inputs.push(i); p.inputs.sort((a, b) => a.seq - b.seq); break;
      case 'use': this.econ.use(p, m.kind, m.id, m.action); break;
      case 'toggleVehicle': this.cars.toggle(p); break;
      case 'carInput': if (p.priv.car >= 0) p.carInput = { throttle: clamp(m.throttle, -1, 1), steer: clamp(m.steer, -1, 1), handbrake: !!m.handbrake }; break;
      case 'equip': this.equip(p, m.slot); break;
      case 'reload': this.startReload(p); break;
      case 'shot': this.onShot(p, m); break;
      case 'cheat': runCheat(this, p, m.cmd); break;
      case 'ping': this.net.send(pid, { t: 'pong', t0: m.t0, ht: this.now }, false); break;
      case 'bye': this.removePlayer(pid); this.net.drop(pid); break;
    }
  }

  // ------------------------------------------------------------------ weapons (host side)
  giveWeapon(p: Player, type: WeaponType): boolean {
    const w = p.priv.weapons;
    if (w.some((s) => s.type === type)) { for (const s of w) s.spare += 60; probe('give_weapon', { item: type, slot: w.findIndex((s) => s.type === type), refill: true }); return true; }
    const slot = { type, mag: WEAPONS[type].mag, spare: WEAPONS[type].spare };
    if (w.length < 3) { w.push(slot); p.priv.active = w.length - 1; } else w[Math.max(0, p.priv.active)] = slot;
    p.priv.equipEnd = this.now + 0.4; p.priv.reloadEnd = 0;
    p.keptWeapons = w.map((s) => s.type); p.keptActive = p.priv.active;
    probe('give_weapon', { item: type, slot: p.priv.active, refill: false });
    return true;
  }
  hasGun(p: Player) { return p.priv.weapons.length > 0; }
  held(p: Player): WeaponType | '' { const s = p.priv.weapons[p.priv.active]; return s ? s.type : ''; }
  equip(p: Player, slot: number) {
    if (!p.pawn || p.pawn.dead || p.priv.car >= 0 || !p.priv.weapons[slot] || slot === p.priv.active) return;
    p.priv.active = slot; p.priv.equipEnd = this.now + 0.4; p.priv.reloadEnd = 0; p.keptActive = slot;
  }
  startReload(p: Player) {
    const s = p.priv.weapons[p.priv.active]; if (!s || !p.pawn || p.pawn.dead || p.priv.car >= 0) return;
    if (s.mag >= WEAPONS[s.type].mag || s.spare <= 0 || p.priv.reloadEnd > 0) return;
    p.priv.reloadEnd = this.now + WEAPONS[s.type].reload;
  }
  private tickWeapons(p: Player) {
    const s = p.priv.weapons[p.priv.active];
    if (p.priv.reloadEnd > 0 && this.now >= p.priv.reloadEnd) {
      p.priv.reloadEnd = 0;
      if (s) { const n = Math.min(WEAPONS[s.type].mag - s.mag, s.spare); s.mag += n; s.spare -= n; }
    }
    if (s && s.mag === 0 && s.spare > 0 && p.priv.reloadEnd === 0 && this.now - p.lastShotAt > 0.2) this.startReload(p);
  }
  private onShot(p: Player, m: Extract<C2H, { t: 'shot' }>) {
    const h = p.pawn; if (!h || h.dead || p.priv.car >= 0) return;
    const s = p.priv.weapons[p.priv.active]; if (!s || s.type !== m.weapon) return;
    const w = WEAPONS[s.type];
    if (s.mag <= 0 || this.now < p.priv.equipEnd - 0.05 || p.priv.reloadEnd > 0) return;
    if (this.now - p.lastShotAt < 0.9 * w.interval) return;
    const eye = [h.x, h.y, h.z + CAPSULE_HALF + EYE];
    if (Math.hypot(m.origin[0] - eye[0], m.origin[1] - eye[1], m.origin[2] - eye[2]) > 3) return;
    s.mag--; p.lastShotAt = this.now; p.firedSinceTick = true; p.spread.fired(w, this.now);
    const hits: { point: number[]; dmg: number; head: boolean }[] = []; let kills = 0;
    for (const hit of m.hits.slice(0, w.pellets)) {
      const t = this.charById(hit.id); if (!t || t.dead || teamOf(t) === 1) continue;
      const sp = Math.hypot((t as any).vx ?? 0, (t as any).vy ?? 0);
      if (Math.hypot(hit.point[0] - t.x, hit.point[1] - t.y) > 2.5 + sp * 0.25 || hit.d > w.range) continue;
      const d = Math.hypot(hit.point[0] - m.origin[0], hit.point[1] - m.origin[1], hit.point[2] - m.origin[2]);
      const dmg = w.dmg * falloff(w, d) * (hit.head ? 1.5 : 1);
      if (dmg <= 0) continue;
      if (this.damage(t, dmg, h, s.type)) kills++;
      hits.push({ point: hit.point, dmg, head: hit.head });
    }
    this.bots.onShot(eye[0], eye[1], h);
    const ends = m.dirs.map((d) => [m.origin[0] + d[0] * 60, m.origin[1] + d[1] * 60, m.origin[2] + d[2] * 60]);
    for (const q of this.players.values()) {
      if (q === p) continue;
      const qp = q.pawn; if (qp && Math.hypot(qp.x - eye[0], qp.y - eye[1]) > 300) continue;
      this.net.send(q.id, { t: 'shotFx', shooter: h.id, weapon: s.type, origin: m.origin, ends }, false);
    }
    if (hits.length) this.net.send(p.id, { t: 'hitConfirm', seq: m.seq, hits, kills });
  }

  // ------------------------------------------------------------------ damage / death
  charById(id: number): Char | undefined { return this.humans.get(id) ?? this.bots.byId.get(id); }
  /** Apply damage; returns true if it killed. Armour is applied through maxHp (spec 03 §8). */
  damage(t: Char, amount: number, by: Char | null, weapon: WeaponType | '' = ''): boolean {
    if (t.dead) return false;
    if (isHuman(t) && this.dir.god.has(t.player.id)) return false;
    if (by && by !== t && teamOf(by) === teamOf(t)) return false;
    t.hp -= amount;
    if (by && by !== t) { t.lastHitBy = by; t.lastHitWeapon = weapon; }
    if (isHuman(t)) this.net.send(t.player.id, { t: 'hurt', amount, fromYaw: by ? Math.atan2(by.y - t.y, by.x - t.x) : 0 });
    else this.bots.onDamaged(t, by);
    if (t.hp <= 0) { t.hp = 0; this.kill(t, by && by !== t ? by : null, weapon); return true; }
    return false;
  }
  /** Kill outright (self-destruct style: no kill heat when `by` is null). */
  kill(t: Char, by: Char | null, weapon: WeaponType | '' = '', launch?: number[]) {
    if (t.dead) return;
    if (isHuman(t) && this.dir.god.has(t.player.id) && (launch || by)) return; // God: immune to tank blasts and crushes
    t.dead = true; t.hp = 0; t.deadAt = this.now;
    if (launch) { t.launched = true; this.launch(t, launch); }
    else if (!t.launched) {
      const killer = by;
      const tier = killer && isHuman(killer) ? (weapon ? WEAPONS[weapon].kb : KNOCKBACK_NONE) : killer ? WEAPONS.rifle.kb : KNOCKBACK_NONE;
      const M = tier * (1 - t.armor);
      let dx = killer ? t.x - killer.x : gameRng.frand() - 0.5, dy = killer ? t.y - killer.y : gameRng.frand() - 0.5; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      probe('ragdoll', { victim: t.id, killer: killer?.id ?? -1, weapon: weapon || 'none', armor: t.armor, magnitude: +M.toFixed(2) });
      this.launch(t, [dx * M, dy * M, 0.5 * M]);
    }
    const byHuman = !!by && isHuman(by);
    probe('kill', { victim: isHuman(t) ? 'human' : t.type === T.CIV ? 'civilian' : 'soldier', by_human: byHuman });
    if (isHuman(t)) this.onHumanDown(t);
    else this.dir.onBotKilled(t, byHuman ? by as Human : null);
  }
  launch(t: Char, v: number[]) { this.sendAll({ t: 'launch', id: t.id, v }); }
  private onHumanDown(h: Human) {
    const p = h.player;
    if (p.priv.car >= 0) this.cars.exit(p, true);
    h.body.setEnabled(false);
    p.priv.dead = true; p.priv.respawnAt = this.now + 10;
    p.keptWeapons = p.priv.weapons.map((s) => s.type); p.keptActive = Math.max(0, p.priv.active);
    p.priv.armor = 0; h.armor = 0; p.priv.reloadEnd = 0;
    this.broadcast(`${p.name} is down: back at the safehouse in 10 s`);
    if (p.priv.bag > 0) { this.econ.dropBag(h.x, h.y, p.priv.bag); probe('bag_drop', { value: p.priv.bag, x: h.x, y: h.y }); p.priv.bag = 0; this.broadcast('A bag was dropped!'); }
    if (p.priv.deliveryLabel) { this.tell(p, 'The package was lost when you went down'); probe('delivery_failed', { reason: 'death', to: p.priv.deliveryLabel, reward: p.priv.deliveryReward }); this.econ.clearDelivery(p); }
    if (!this.living().length && this.dir.phase !== 'Escaped') this.dir.teamWipe();
  }
  setArmor(h: Human, armor: number) {
    const frac = h.hp / h.maxHp; h.armor = armor; h.maxHp = 100 / (1 - armor / 2); h.hp = h.maxHp * frac; h.player.priv.armor = armor;
  }

  // ------------------------------------------------------------------ step
  step(dt: number) {
    this.now += dt;
    for (const p of this.players.values()) {
      const h = p.pawn;
      if (h && !h.dead) {
        if (p.priv.car < 0) {
          const q = p.inputs.length ? p.inputs : [];
          for (const inp of q) { this.moveHuman(h, inp); p.lastSeq = inp.seq; p.lastInput = inp; }
          p.inputs = [];
        } else { for (const inp of p.inputs) { p.lastSeq = inp.seq; p.lastInput = inp; h.yaw = inp.yaw; } p.inputs = []; }
        p.lastAliveX = h.x; p.lastAliveY = h.y;
        this.tickWeapons(p);
      } else { if (p.inputs.length) { p.lastSeq = p.inputs[p.inputs.length - 1].seq; p.inputs = []; } }
      if (p.priv.dead && p.priv.respawnAt > 0 && this.now >= p.priv.respawnAt) { p.priv.respawnAt = 0; this.spawnHuman(p); probe('respawn', { controller: p.id }); }
    }
    this.cars.step(dt);
    this.phys.world.step();
    this.cars.afterStep(dt);
    this.bots.frame(dt);
    this.hunters.frame(dt);
    this.econ.frame();
    if ((this.acc.dir += dt) >= 0.25) { this.acc.dir -= 0.25; this.dir.tick(0.25); }
    if ((this.acc.hunt += dt) >= 2) { this.acc.hunt -= 2; this.hunters.tick(); }
    const sp = this.save.loaded ? 1 : 0.5;
    if ((this.acc.save += dt) >= sp) { this.acc.save -= sp; this.save.tick(); }
    if ((this.acc.snap += dt) >= 0.05) { this.acc.snap -= 0.05; this.sendSnapshots(); }
  }
  moveHuman(h: Human, inp: InputMsg) {
    const p = h.player;
    h.yaw = inp.yaw; h.pitch = inp.pitch;
    h.body.step(h.ms, inp, Math.min(inp.dt, 0.1), p.priv.bag > 0);
    h.x = h.ms.x; h.y = h.ms.y; h.z = h.ms.z - CAPSULE_HALF;
    let f = 0; if (!h.ms.grounded && h.ms.airTime > 0.15) f |= A.AIR; if (inp.crouch) f |= A.CROUCH; if (inp.aim) f |= A.AIM;
    if (this.now - p.lastShotAt < 0.12) f |= A.FIRING; if (p.priv.reloadEnd > 0) f |= A.RELOAD; if (p.priv.bag > 0) f |= A.BAG;
    h.flags = f;
    const sprinting = inp.sprint && !inp.crouch;
    if (sprinting !== ((p as any)._sprint ?? false)) { (p as any)._sprint = sprinting; probe('sprint', { on: sprinting, max_walk: +maxWalk(inp, p.priv.bag > 0).toFixed(2), authority: true, local: p.local }); }
  }

  // ------------------------------------------------------------------ snapshots
  entityRecs(): EntRec[] {
    const out: EntRec[] = [];
    for (const h of this.humans.values()) {
      const p = h.player, held = this.held(p);
      out.push([h.id, T.HUMAN, r2(h.x), r2(h.y), r2(h.z), r3(h.yaw), r2(h.ms.vx), r2(h.ms.vy), r2(h.ms.vz),
        h.flags | (h.dead ? A.DEAD : 0) | (p.priv.car >= 0 ? A.SEATED : 0), Math.round(h.hp * 10) / 10, Math.round(h.maxHp * 10) / 10,
        held ? WEAPON_IDS.indexOf(held) + 1 : 0, p.look, p.priv.car, p.id, r3(h.pitch)]);
    }
    this.bots.records(out); this.cars.records(out); this.hunters.records(out);
    return out;
  }
  private sendSnapshots() {
    const all = this.entityRecs(), d = this.dir.state(), players = this.playerInfos();
    for (const p of this.players.values()) {
      const ref = p.pawn;
      const e = ref ? all.filter((r) => (r[E.t] !== T.SOLDIER && r[E.t] !== T.CIV) || Math.hypot(r[E.x] - ref.x, r[E.y] - ref.y) < 300) : all;
      this.net.send(p.id, { t: 'snap', ht: this.now, ack: p.lastSeq, d, e, players }, false);
      const ps = JSON.stringify(p.priv);
      if (ps !== p.lastPriv) { p.lastPriv = ps; this.net.send(p.id, { t: 'priv', s: JSON.parse(ps) }); }
    }
    this.econ.flushSpots();
  }
}
const r2 = (v: number) => Math.round(v * 100) / 100, r3 = (v: number) => Math.round(v * 1000) / 1000;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, +v || 0));
export { G_CAR, G_STATIC, BUILD_ID, starsOf, shekels, spreadRays, rayCharacter };
