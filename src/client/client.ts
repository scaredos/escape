// Client: mirrors host state, predicts its own character, drives the camera, focus/menus, shooting, HUD view.
import * as THREE from 'three';
import { probe } from '../core/probe';
import { RAPIER, G_CAR, G_STATIC, groups, type Phys } from '../physics/phys';
import { CharBody, CAPSULE_HALF, EYE, type MoveInput, type MoveState } from '../physics/character';
import { A, ACT, E, T, WEAPON_IDS, PROTOCOL_V, BUILD_ID, type C2H, type DirectorState, type EntRec, type H2C, type InputMsg, type PlayerInfo, type PrivateState, type SpotState } from '../game/protocol';
import { spotOptions, USE_RADIUS } from '../game/options';
import { WEAPONS, Spread, spreadRays, rayCharacter } from '../game/weapons';
import { VEHICLE_SPECS } from '../render/vehicles/index';
import { CAR_MODELS, steerScale } from '../game/cars';
import type { ClientLink } from '../net/link';
import type { WorldQ } from '../world/query';
import type { Stage } from '../render/stage';
import { EntityView, toThree } from '../render/entities';
import { Fx } from '../render/fx';
import type { HudView, HudFocus } from '../ui/hud-types';
import { Input, KEY_NAMES } from './input';
import { RoadblockView } from '../render/roadblocks';

interface Snap { ht: number; recs: Map<number, EntRec> }
const DEG = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAng = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class Client {
  // replicated
  director: DirectorState | null = null; priv: PrivateState | null = null; spots = new Map<number, SpotState>(); players: PlayerInfo[] = [];
  playerId = -1; myName = ''; welcomed = false;
  private snaps: Snap[] = [];
  private offset = 0; private bestRtt = Infinity; private lastPing = 0;
  // prediction
  private body: CharBody | null = null; private ms: MoveState | null = null; private pawnId = -1;
  private seq = 0; private pending: InputMsg[] = []; private hist = new Map<number, [number, number, number]>();
  private corr = new THREE.Vector3(); private lastAck = -1;
  // camera
  yaw = 0; pitch = 0; carYaw = 0; private camDist = 3; private adsBlend = 0; private carBlend = 0; fovOverride = 0;
  // ui state
  feed: { text: string; t: number }[] = [];
  mapOpen = false; selAction = -1; focusKey = ''; focus: HudFocus | null = null; carInReach: { npc: boolean; id: number } | null = null;
  hurtFlash = 0; damageNumbers: HudView['damageNumbers'] = [];
  spread = new Spread(); private lastShot = -10; private shotSeq = 0; private localMag: number[] = [];
  drive: [number, number] | null = null;   // EscDrive override
  entities: EntityView; fx: Fx; roadblocks: RoadblockView;
  input: Input;
  sens = 0.1; fovFoot = 80; private respawnSeenAt = 0;
  onEndCard: () => void = () => {};
  private launched = new Set<number>();
  constructor(public link: ClientLink, public phys: Phys, public wq: WorldQ, public stage: Stage, public isHost: boolean) {
    this.entities = new EntityView(stage.scene, phys);
    this.fx = new Fx(stage.scene);
    this.roadblocks = new RoadblockView(stage.scene);
    this.input = new Input(stage.canvas);
    link.onMessage = (m) => this.onMessage(m);
  }
  realNow() { return performance.now() / 1000; }
  hostNow() { return this.realNow() + this.offset; }
  send(m: C2H, reliable = true) { this.link.send(m, reliable); }
  hello(name: string) { this.send({ t: 'hello', name, v: PROTOCOL_V, build: BUILD_ID }); }
  freeCam: number[] | null = null;
  addFeed(text: string) { probe('feed', { text }); this.feed.push({ text, t: this.realNow() }); if (this.feed.length > 12) this.feed.shift(); }

  // ---------------------------------------------------------------- messages
  onMessage(m: H2C) {
    switch (m.t) {
      case 'welcome':
        this.playerId = m.playerId; this.myName = m.name; this.welcomed = true; this.offset = m.hostTime - this.realNow();
        this.players = m.players; this.director = m.director;
        for (const s of m.spots) this.spots.set(s.id, s);
        this.roadblocks.set(m.roadblocks, this.isHost);
        break;
      case 'snap': {
        this.director = m.d; this.players = m.players;
        const recs = new Map<number, EntRec>(); for (const r of m.e) recs.set(r[E.id], r);
        this.snaps.push({ ht: m.ht, recs }); while (this.snaps.length > 30) this.snaps.shift();
        if (this.isHost) this.offset = m.ht - this.realNow();
        this.reconcile(recs, m.ack);
        break;
      }
      case 'priv': {
        const prev = this.priv; this.priv = m.s;
        this.localMag = m.s.weapons.map((w) => w.mag);
        if (prev && prev.pawn !== m.s.pawn) { this.pawnId = -1; }
        break;
      }
      case 'spots': for (const s of m.s) { if (s.mode === 'gone') this.spots.delete(s.id); else this.spots.set(s.id, s); } break;
      case 'msg': this.addFeed(m.text); break;
      case 'roadblocks': this.roadblocks.set(m.r, this.isHost); break;
      case 'tankFire': this.fx.shot(toThree(m.pos[0], m.pos[1], m.pos[2]), [], this.realNow()); break;
      case 'launch': this.launched.add(m.id); this.entities.launch(m.id, m.v); break;
      case 'shotFx': this.fx.shot(toThree(m.origin[0], m.origin[1], m.origin[2]), m.ends.map((e) => toThree(e[0], e[1], e[2])), this.realNow()); break;
      case 'hitConfirm': for (const h of m.hits) this.damageNumbers.push({ x: h.point[0], y: h.point[1], z: h.point[2], dmg: h.dmg, head: h.head, t: this.realNow() }); break;
      case 'hurt': this.hurtFlash = Math.min(1, this.hurtFlash + 0.25 + m.amount / 60); break;
      case 'blast': this.fx.blast(toThree(m.pos[0], m.pos[1], m.pos[2]), this.realNow()); break;
      case 'probe':
        if (m.event === '__teleport') {
          const f = m.fields as any; if (this.ms && this.body) { Object.assign(this.ms, { x: f.x, y: f.y, z: f.z, vx: 0, vy: 0, vz: 0 }); this.body.teleport(f.x, f.y, f.z); this.pending = []; }
          this.yaw = f.yaw; this.pitch = 0;
        } else probe(m.event, m.fields);
        break;
      case 'pong': {
        const now = this.realNow(), rtt = now - m.t0;
        if (rtt < this.bestRtt * 1.2 || now - this.lastPing > 20) { this.bestRtt = Math.min(this.bestRtt, rtt); if (!this.isHost) this.offset = m.ht - (m.t0 + rtt / 2); }
        break;
      }
      case 'kick': this.link.onClose(m.reason); break;
    }
  }

  // ---------------------------------------------------------------- prediction
  private myRec(recs: Map<number, EntRec>) { const id = this.priv?.pawn ?? -1; return id >= 0 ? recs.get(id) : undefined; }
  private reconcile(recs: Map<number, EntRec>, ack: number) {
    const r = this.myRec(recs); if (!r || !this.priv) return;
    const id = r[E.id];
    const dead = !!(r[E.f] & A.DEAD), seated = !!(r[E.f] & A.SEATED);
    if (id !== this.pawnId) {
      this.pawnId = id;
      const z = r[E.z] + CAPSULE_HALF;
      this.ms = { x: r[E.x], y: r[E.y], z, vx: 0, vy: 0, vz: 0, grounded: true, airTime: 0 };
      if (!this.body) this.body = new CharBody(this.phys, r[E.x], r[E.y], z); else this.body.teleport(r[E.x], r[E.y], z);
      this.pending = []; this.hist.clear(); this.yaw = r[E.yaw]; this.pitch = 0; this.corr.set(0, 0, 0);
      return;
    }
    if (!this.ms || !this.body) return;
    if (dead || seated) { Object.assign(this.ms, { x: r[E.x], y: r[E.y], z: r[E.z] + CAPSULE_HALF, vx: 0, vy: 0, vz: 0 }); this.pending = []; this.body.teleport(this.ms.x, this.ms.y, this.ms.z); return; }
    if (ack <= this.lastAck) return; this.lastAck = ack;
    const pred = this.hist.get(ack);
    this.pending = this.pending.filter((p) => p.seq > ack);
    for (const k of this.hist.keys()) if (k <= ack) this.hist.delete(k);
    if (!pred) return;
    const ax = r[E.x], ay = r[E.y], az = r[E.z] + CAPSULE_HALF;
    const err = Math.hypot(pred[0] - ax, pred[1] - ay, pred[2] - az);
    if (err > 0.5) {
      // rewind to the host position and replay the unacked inputs
      Object.assign(this.ms, { x: ax, y: ay, z: az, vx: r[E.vx], vy: r[E.vy], vz: r[E.vz] });
      for (const inp of this.pending) { this.body.step(this.ms, inp, Math.min(inp.dt, 0.1), (this.priv?.bag ?? 0) > 0); this.hist.set(inp.seq, [this.ms.x, this.ms.y, this.ms.z]); }
    } else if (err > 0.01) {
      this.corr.set(ax - pred[0], ay - pred[1], az - pred[2]);
    }
  }

  // ---------------------------------------------------------------- per frame
  frame(dt: number, inputEnabled: boolean) {
    const now = this.realNow(), hn = this.hostNow();
    if (now - this.lastPing > 2) { this.lastPing = now; this.send({ t: 'ping', t0: now }, false); }
    const priv = this.priv, d = this.director;
    const rt = hn - 0.1;
    const recs = this.interpolate(rt);
    const me = priv ? recs.get(priv.pawn) : undefined;
    const alive = !!me && !(me[E.f] & A.DEAD) && !!priv && !priv.dead;
    const seated = !!priv && priv.car >= 0 && alive;
    // ---- input
    const pressed = inputEnabled ? this.input.take() : (this.input.take(), []);
    const [mdx, mdy] = inputEnabled ? this.input.takeMouse() : (this.input.takeMouse(), [0, 0]);
    const I = this.input, down = (c: string) => inputEnabled && I.isDown(c);
    if (!seated) { this.yaw -= mdx * this.sens * DEG; this.pitch = Math.max(-70 * DEG, Math.min(70 * DEG, this.pitch - mdy * this.sens * DEG)); }
    for (const k of pressed) this.onKey(k, alive, seated);
    if (inputEnabled && I.wheel && alive && !seated && priv && priv.weapons.length > 1) {
      const n = priv.weapons.length, s = ((priv.active + Math.sign(I.wheel)) % n + n) % n; this.send({ t: 'equip', slot: s });
    }
    I.wheel = 0;
    // ---- movement (prediction)
    const aim = down('Mouse2') || (inputEnabled && I.rmb);
    if (alive && !seated && this.ms && this.body) {
      const mx = (down('KeyD') ? 1 : 0) - (down('KeyA') ? 1 : 0), my = (down('KeyW') ? 1 : 0) - (down('KeyS') ? 1 : 0);
      const crouch = !!(this as any)._crouch;
      // long frames (slow machines, headless tests) are split into <= 1/30 s input steps so no time is lost
      const nSub = Math.max(1, Math.min(8, Math.ceil(dt / (1 / 30))));
      for (let k = 0; k < nSub; k++) {
        const inp: InputMsg = { seq: ++this.seq, dt: Math.min(dt, 0.25) / nSub, mx, my, yaw: this.yaw, pitch: this.pitch, sprint: down('ShiftLeft') || down('ShiftRight'),
          jump: down('Space') && k === 0, crouch, fire: inputEnabled && I.lmb, aim };
        this.body.step(this.ms, inp as MoveInput, inp.dt, (priv?.bag ?? 0) > 0);
        this.hist.set(inp.seq, [this.ms.x, this.ms.y, this.ms.z]);
        this.pending.push(inp);
      }
      this.send({ t: 'input', inputs: this.pending.slice(-(nSub + 3)) }, false);
      const k = Math.min(1, dt / 0.1); this.ms.x += this.corr.x * k; this.ms.y += this.corr.y * k; this.ms.z += this.corr.z * k; this.corr.multiplyScalar(1 - k);
      // own record = prediction
      if (me) { me[E.x] = this.ms.x; me[E.y] = this.ms.y; me[E.z] = this.ms.z - CAPSULE_HALF; me[E.yaw] = this.yaw; me[E.vx] = this.ms.vx; me[E.vy] = this.ms.vy; me[E.x0 + 2] = this.pitch;
        if (aim) me[E.f] |= A.AIM; }
      this.tryFire(me!, aim, inputEnabled);
    } else if (seated) {
      let thr = (down('KeyW') ? 1 : 0) - (down('KeyS') ? 1 : 0), st = (down('KeyD') ? 1 : 0) - (down('KeyA') ? 1 : 0);
      if (this.drive) { thr = this.drive[0]; st = this.drive[1]; }
      this.send({ t: 'carInput', throttle: thr, steer: st, handbrake: down('Space') }, false);
      this.send({ t: 'input', inputs: [{ seq: ++this.seq, dt, mx: 0, my: 0, yaw: this.yaw, pitch: this.pitch, sprint: false, jump: false, crouch: false, fire: false, aim: false }] }, false);
    }
    // ---- focus + car in reach
    this.computeFocus(me, alive, seated);
    // ---- view
    this.entities.sync([...recs.values()], dt, this.stage.camera.position);
    this.camera(dt, me, recs, alive, seated, aim);
    this.fx.update(now);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    this.damageNumbers = this.damageNumbers.filter((n) => now - n.t < 0.7);
    if (d?.phase === 'Escaped') this.onEndCard();
  }
  private interpolate(rt: number): Map<number, EntRec> {
    const s = this.snaps, out = new Map<number, EntRec>();
    if (!s.length) return out;
    let i = s.length - 1; while (i > 0 && s[i - 1].ht > rt) i--;
    const b = s[i], a = s[Math.max(0, i - 1)];
    const t = b.ht > a.ht ? Math.max(0, Math.min(1, (rt - a.ht) / (b.ht - a.ht))) : 1;
    const extra = rt > b.ht ? Math.min(0.25, rt - b.ht) : 0;
    for (const [id, rb] of b.recs) {
      const ra = a.recs.get(id), r = rb.slice();
      if (ra && Math.hypot(ra[E.x] - rb[E.x], ra[E.y] - rb[E.y]) < 5) {
        r[E.x] = lerp(ra[E.x], rb[E.x], t); r[E.y] = lerp(ra[E.y], rb[E.y], t); r[E.z] = lerp(ra[E.z], rb[E.z], t); r[E.yaw] = lerpAng(ra[E.yaw], rb[E.yaw], t);
        if (rb[E.t] === T.CAR) { // quaternion nlerp
          const o = E.x0 + 5; let dot = 0; for (let k = 0; k < 4; k++) dot += ra[o + k] * rb[o + k];
          const sg = dot < 0 ? -1 : 1; let L = 0; for (let k = 0; k < 4; k++) { r[o + k] = lerp(ra[o + k] * sg, rb[o + k], t); L += r[o + k] ** 2; } L = Math.sqrt(L) || 1; for (let k = 0; k < 4; k++) r[o + k] /= L;
        }
      }
      if (extra) { r[E.x] += r[E.vx] * extra; r[E.y] += r[E.vy] * extra; }
      out.set(id, r);
    }
    return out;
  }

  private onKey(code: string, alive: boolean, seated: boolean) {
    const priv = this.priv;
    switch (code) {
      case 'KeyM': this.mapOpen = !this.mapOpen; break;
      case 'ArrowUp': case 'ArrowDown': this.stepSel(code === 'ArrowUp' ? -1 : 1); break;
      case 'KeyE':
        if (!alive) break;
        if (this.focus) {
          const line = this.focus.lines[this.focus.selected];
          if (this.focus.kind === 'civ') this.send({ t: 'use', kind: 'civ', id: this.focus.id, action: 1 });
          else if (line && line.actionable) this.send({ t: 'use', kind: 'spot', id: this.focus.id, action: line.action });
        } else if (this.carInReach && !seated) { probe('vehicle_key', { key: 'E', near: true, driving: false }); this.send({ t: 'toggleVehicle' }); }
        break;
      case 'KeyF': if (alive) { probe('vehicle_key', { key: 'F', near: !!this.carInReach, driving: seated }); this.send({ t: 'toggleVehicle' }); } break;
      case 'KeyR': if (alive && !seated) this.send({ t: 'reload' }); break;
      case 'KeyC': (this as any)._crouch = !(this as any)._crouch; break;
      case 'Digit1': case 'Digit2': case 'Digit3': { const s = +code.slice(5) - 1; if (alive && !seated && priv?.weapons[s]) this.send({ t: 'equip', slot: s }); break; }
    }
  }
  private stepSel(dir: number) {
    const f = this.focus; if (!f) return;
    const idx = f.lines.map((l, i) => (l.actionable ? i : -1)).filter((i) => i >= 0); if (!idx.length) return;
    const cur = idx.indexOf(f.selected), next = idx[((cur < 0 ? 0 : cur + dir) % idx.length + idx.length) % idx.length];
    this.selAction = f.lines[next].action; f.selected = next;
  }
  private computeFocus(me: EntRec | undefined, alive: boolean, seated: boolean) {
    this.focus = null; this.carInReach = null;
    if (!me || !alive || !this.priv || !this.director) { this.selAction = -1; this.focusKey = ''; return; }
    const cam = this.stage.camera, fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const px = me[E.x], py = me[E.y];
    let best: { kind: 'spot' | 'civ'; id: number; score: number; label: string } | null = null;
    const all = [...this.spots.values()];
    for (const s of all) {
      const r = USE_RADIUS[s.mode]; if (!r) continue;
      const dist = Math.hypot(s.x - px, s.y - py); if (dist > r) continue;
      const to = toThree(s.x, s.y, 1).sub(cam.position).normalize(), dot = fwd.dot(to);
      if (dot < 0.3) continue;
      const sc = dot - dist / r; if (!best || sc > best.score) best = { kind: 'spot', id: s.id, score: sc, label: s.label };
    }
    const held = this.priv.weapons[this.priv.active];
    if (held && !seated) for (const [, r] of this.interpolate(this.hostNow() - 0.1)) {
      if (r[E.t] !== T.CIV || (r[E.f] & A.DEAD)) continue;
      const dist = Math.hypot(r[E.x] - px, r[E.y] - py); if (dist > 5) continue;
      const to = toThree(r[E.x], r[E.y], r[E.z] + 1).sub(cam.position).normalize(), dot = fwd.dot(to); if (dot < 0.9) continue;
      const sc = dot - dist / 5; if (!best || sc > best.score) best = { kind: 'civ', id: r[E.id], score: sc, label: '' };
    }
    if (best) {
      const key = best.kind + best.id; if (key !== this.focusKey) { this.focusKey = key; this.selAction = -1; }
      if (best.kind === 'civ') this.focus = { kind: 'civ', id: best.id, label: '', lines: [{ text: 'Hold them up', actionable: true, action: 1 }], selected: 0 };
      else {
        const s = this.spots.get(best.id)!;
        const lines = spotOptions(s, this.director, this.priv, this.hostNow(), all);
        if (lines.length) {
          let sel = lines.findIndex((l) => l.actionable && l.action === this.selAction);
          if (sel < 0) { sel = lines.findIndex((l) => l.actionable); this.selAction = sel >= 0 ? lines[sel].action : -1; if (sel < 0) sel = 0; }
          this.focus = { kind: 'spot', id: s.id, label: s.label, lines, selected: sel };
        }
      }
    } else { this.focusKey = ''; this.selAction = -1; }
    if (!seated) {
      let bd = 2.5;
      for (const [, r] of this.snaps.length ? this.snaps[this.snaps.length - 1].recs : []) {
        if (r[E.t] !== T.CAR || r[E.x0 + 1] >= 0) continue;
        const npc = r[E.x0 + 2] > 0; if (npc && Math.abs(r[E.x0 + 9]) > 4) continue;
        const spec = VEHICLE_SPECS[CAR_MODELS[r[E.look]] ?? 'sedan'], cs = Math.cos(r[E.yaw]), sn = Math.sin(r[E.yaw]);
        const dx = px - r[E.x], dy = py - r[E.y];
        const u = Math.abs(dx * cs + dy * sn) - spec.size[0] / 2, v = Math.abs(-dx * sn + dy * cs) - spec.size[1] / 2;
        const dd = Math.hypot(Math.max(u, 0), Math.max(v, 0)); if (dd <= bd) { bd = dd; this.carInReach = { npc, id: r[E.id] }; }
      }
    }
  }

  // ---------------------------------------------------------------- shooting (client-traced, host-validated)
  private tryFire(me: EntRec, aim: boolean, inputEnabled: boolean) {
    const p = this.priv; if (!p || !inputEnabled) { this.input.lmbPressed = false; return; }
    const slot = p.weapons[p.active]; if (!slot) { this.input.lmbPressed = false; return; }
    const w = WEAPONS[slot.type], now = this.hostNow();
    const want = w.auto ? (this.input.lmb || this.input.isDown('Mouse0')) : this.input.lmbPressed; this.input.lmbPressed = false;
    if (!want || now - this.lastShot < w.interval || p.reloadEnd > 0 || now < p.equipEnd) return;
    const mag = this.localMag[p.active] ?? slot.mag;
    if (mag <= 0) { if (slot.spare > 0) this.send({ t: 'reload' }); return; }
    this.localMag[p.active] = mag - 1; this.lastShot = now;
    const cam = this.stage.camera, dir3 = new THREE.Vector3(); cam.getWorldDirection(dir3);
    const dir = [dir3.x, -dir3.z, dir3.y];
    const cp = [cam.position.x, -cam.position.z, cam.position.y];
    const eye = [me[E.x], me[E.y], me[E.z] + CAPSULE_HALF + EYE];
    const t0 = Math.max(0, (eye[0] - cp[0]) * dir[0] + (eye[1] - cp[1]) * dir[1] + (eye[2] - cp[2]) * dir[2]);
    const origin = [cp[0] + dir[0] * t0, cp[1] + dir[1] * t0, cp[2] + dir[2] * t0];
    const half = this.spread.current(w, now, { ads: aim, speed: Math.hypot(me[E.vx], me[E.vy]), air: !!(me[E.f] & A.AIR) });
    this.spread.fired(w, now);
    const seq = ++this.shotSeq, dirs = spreadRays(this.playerId, seq, dir, half, w.pellets);
    const recs = this.interpolate(this.hostNow() - 0.1);
    const hits: { id: number; point: number[]; head: boolean; d: number }[] = [], ends: THREE.Vector3[] = [];
    for (const d of dirs) {
      const st = this.phys.ray(origin[0], origin[1], origin[2], d[0], d[1], d[2], w.range, G_STATIC | G_CAR);
      let end = st ? st.toi : w.range, hit: { id: number; head: boolean } | null = null;
      for (const [, r] of recs) {
        const t = r[E.t];
        if (t === T.CAR) { const dd = rayCar(origin, d, r); if (dd >= 0 && dd < end) { end = dd; hit = null; } continue; }
        if ((t !== T.SOLDIER && t !== T.CIV) || (r[E.f] & A.DEAD)) continue;
        if (Math.hypot(r[E.x] - origin[0], r[E.y] - origin[1]) > end + 2) continue;
        const h = rayCharacter(origin, d, { id: r[E.id], x: r[E.x], y: r[E.y], z: r[E.z] });
        if (h && h.dist < end) { end = h.dist; hit = { id: r[E.id], head: h.head }; }
      }
      const pt = [origin[0] + d[0] * end, origin[1] + d[1] * end, origin[2] + d[2] * end];
      if (hit) hits.push({ id: hit.id, point: pt, head: hit.head, d: end });
      ends.push(toThree(pt[0], pt[1], pt[2]));
    }
    this.send({ t: 'shot', seq, weapon: slot.type, origin, dirs, hits });
    const mz = new THREE.Vector3(); const cv = this.entities.charVisual(me[E.id]);
    if (cv) cv.muzzleWorld(mz); else toThree(origin[0], origin[1], origin[2], mz);
    this.fx.shot(mz, ends, this.realNow());
  }
  currentSpread(me: EntRec | undefined, aim: boolean) {
    const p = this.priv, s = p?.weapons[p.active]; if (!s || !me) return 0;
    return this.spread.current(WEAPONS[s.type], this.hostNow(), { ads: aim, speed: Math.hypot(me[E.vx], me[E.vy]), air: !!(me[E.f] & A.AIR) });
  }

  // ---------------------------------------------------------------- camera
  private camera(dt: number, me: EntRec | undefined, recs: Map<number, EntRec>, alive: boolean, seated: boolean, aim: boolean) {
    const cam = this.stage.camera;
    if (this.freeCam) {
      const [x, y, h, b, pt] = this.freeCam, yaw = (90 - b) * DEG, pi = pt * DEG;
      cam.position.set(x, h, -y); cam.lookAt(x + Math.cos(yaw) * Math.cos(pi), h + Math.sin(pi), -(y + Math.sin(yaw) * Math.cos(pi)));
      if (cam.fov !== (this.fovOverride || 70)) { cam.fov = this.fovOverride || 70; cam.updateProjectionMatrix(); }
      return;
    }
    this.carBlend = Math.max(0, Math.min(1, this.carBlend + (seated ? dt : -dt) / 0.3));
    this.adsBlend = Math.max(0, Math.min(1, this.adsBlend + ((aim && alive && !seated) ? dt : -dt) / 0.2));
    if (!me) return;
    // on-foot rig
    let piv: THREE.Vector3;
    const rag = this.entities.ragdollPos(me[E.id]);
    if (!alive && rag) piv = rag.clone().add(new THREE.Vector3(0, 0.6, 0));
    else piv = toThree(me[E.x], me[E.y], me[E.z] + CAPSULE_HALF + EYE + ((me[E.f] & A.CROUCH) ? -0.3 : 0));
    const p = this.pitch / DEG, k = Math.min(1, Math.abs(p) / 60);
    let off = p >= 0 ? [lerp(-3, -2, k), 0.5, lerp(0.2, -0.4, k)] : [lerp(-3, -2.5, k), 0.5, lerp(0.2, 0.6, k)];
    off = [lerp(off[0], -1.6, this.adsBlend), lerp(off[1], 0.55, this.adsBlend), lerp(off[2], 0.15, this.adsBlend)];
    const fwd = new THREE.Vector3(Math.cos(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.sin(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const up = new THREE.Vector3().crossVectors(right, fwd);
    let footPos = piv.clone().addScaledVector(fwd, off[0]).addScaledVector(right, off[1]).addScaledVector(up, off[2]);
    footPos = this.collide(piv, footPos, 0.14, dt);
    let pos = footPos, look = footPos.clone().add(fwd), fov = lerp(this.fovFoot, 55, this.adsBlend);
    if (this.carBlend > 0) {
      const car = recs.get(this.priv?.car ?? -1);
      if (car) {
        const cy = car[E.yaw];
        if (seated) this.carYaw += Math.atan2(Math.sin(cy - this.carYaw), Math.cos(cy - this.carYaw)) * Math.min(1, 6 * dt);
        const pv = toThree(car[E.x], car[E.y], car[E.z] + 2.2);
        const cp = Math.cos(14 * DEG), sp = Math.sin(14 * DEG);
        const bf = new THREE.Vector3(Math.cos(this.carYaw) * cp, -sp, -Math.sin(this.carYaw) * cp);
        let cpos = pv.clone().addScaledVector(bf, -7).add(new THREE.Vector3(0, 0.6 * cp, 0));
        cpos = this.collide(pv, cpos, 0.12, dt);
        const s = this.carBlend * this.carBlend * (3 - 2 * this.carBlend);
        pos = footPos.clone().lerp(cpos, s); look = look.clone().lerp(cpos.clone().add(bf), s); fov = lerp(fov, 90, s);
        if (seated) this.yaw = this.carYaw;
      }
    } else this.carYaw = this.yaw;
    if (this.fovOverride) fov = this.fovOverride;
    cam.position.copy(pos); cam.lookAt(look);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.entities.hiddenId = -1;
  }
  private collide(from: THREE.Vector3, to: THREE.Vector3, r: number, dt: number): THREE.Vector3 {
    const d = to.clone().sub(from), L = d.length(); if (L < 1e-3) return to;
    d.divideScalar(L);
    const hit = this.phys.world.castShape({ x: from.x, y: -from.z, z: from.y }, { x: 0, y: 0, z: 0, w: 1 }, { x: d.x, y: -d.z, z: d.y }, new RAPIER.Ball(r), 0, L, true, undefined, groups(0xffff, G_STATIC));
    const want = hit ? Math.max(0.3, (hit as any).time_of_impact ?? (hit as any).toi ?? L) - 0.02 : L;
    this.camDist = want < this.camDist ? Math.max(want, this.camDist - (L / 0.1) * dt) : Math.min(want, this.camDist + (L / 0.15) * dt);
    return from.clone().addScaledVector(d, Math.min(this.camDist, L));
  }

  // ---------------------------------------------------------------- HUD view
  hudView(me: EntRec | undefined): HudView {
    const p = this.priv, d = this.director, recs = this.snaps.length ? this.snaps[this.snaps.length - 1].recs : new Map();
    const mine = me ?? (p ? recs.get(p.pawn) : undefined);
    const slot = p?.weapons[p.active];
    const aim = this.input.rmb;
    return {
      hostNow: this.hostNow(), realTime: this.realNow(), director: d, priv: p, spots: [...this.spots.values()],
      staticSpots: this.wq.spots.map((s) => ({ mode: s.mode, name: s.name, x: s.rx, y: s.ry, inset: s.inset })),
      myPos: mine ? { x: mine[E.x], y: mine[E.y], z: mine[E.z] } : null, myInset: mine ? this.wq.insetAt(mine[E.x], mine[E.y]) : '',
      camera: this.stage.camera, focus: this.focus,
      car: { seated: !!p && p.car >= 0, inReach: this.carInReach ? { npcDriver: this.carInReach.npc } : null },
      feed: this.feed, mapOpen: this.mapOpen,
      players: this.players.map((pl) => { const r = recs.get(pl.pawn); return r ? { name: pl.name, x: r[E.x], y: r[E.y], local: pl.id === this.playerId, bearing: 90 - this.yaw / DEG } : null; }).filter(Boolean) as any,
      mates: this.players.filter((pl) => pl.id !== this.playerId).map((pl) => { const r = recs.get(pl.pawn); return r ? { name: pl.name, x: r[E.x], y: r[E.y], z: r[E.z], hp: r[E.hp], maxHp: r[E.mh], dead: !!(r[E.f] & A.DEAD) } : null; }).filter(Boolean) as any,
      hp: mine ? mine[E.hp] : 0, maxHp: mine ? mine[E.mh] : 100, dead: !!p?.dead, respawnIn: p && p.dead ? Math.max(0, p.respawnAt - this.hostNow()) : 0,
      weapon: slot ? { type: slot.type, mag: this.localMag[p!.active] ?? slot.mag, spare: slot.spare, reloading: p!.reloadEnd > 0 } : null,
      slots: [0, 1, 2].map((i) => p?.weapons[i]?.type ?? null), activeSlot: p?.active ?? -1,
      spread: this.currentSpread(mine, aim), showCrosshair: !!slot && !(p && p.car >= 0) && !this.mapOpen && !p?.dead,
      hurtFlash: this.hurtFlash, damageNumbers: this.damageNumbers, roomBanner: null, fps: null,
    };
  }
  myRecNow(): EntRec | undefined { const p = this.priv; if (!p || !this.snaps.length) return undefined; return this.snaps[this.snaps.length - 1].recs.get(p.pawn); }
  /** EscKey */
  key(name: string, sec?: number) { const code = KEY_NAMES[name.toUpperCase()] ?? name; this.input.key(code, sec); return code; }
}
function rayCar(o: number[], d: number[], r: EntRec): number {
  const spec = VEHICLE_SPECS[CAR_MODELS[r[E.look]] ?? 'sedan'], cs = Math.cos(r[E.yaw]), sn = Math.sin(r[E.yaw]);
  // slab test in car space (yaw only)
  const ox = o[0] - r[E.x], oy = o[1] - r[E.y], oz = o[2] - r[E.z];
  const lo = [ox * cs + oy * sn, -ox * sn + oy * cs, oz], ld = [d[0] * cs + d[1] * sn, -d[0] * sn + d[1] * cs, d[2]];
  const h = [spec.size[0] / 2, spec.size[1] / 2], zr = [spec.wheelRadius, spec.size[2]];
  let t0 = 0, t1 = 1e9;
  for (let k = 0; k < 3; k++) {
    const mn = k < 2 ? -h[k] : zr[0], mx = k < 2 ? h[k] : zr[1];
    if (Math.abs(ld[k]) < 1e-9) { if (lo[k] < mn || lo[k] > mx) return -1; continue; }
    let a = (mn - lo[k]) / ld[k], b = (mx - lo[k]) / ld[k]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return -1;
  }
  return t0;
}
export { WEAPON_IDS };
