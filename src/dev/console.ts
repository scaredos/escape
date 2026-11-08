// Dev console (backquote) + URL script runner (spec 05 H17-H18).
import { probe } from '../core/probe';
import { E, A, T, starsOf } from '../game/protocol';
import { HOST_CMDS } from './cheats';
import type { Client } from '../client/client';

export interface ConsoleHost {
  client: Client;
  isHost: boolean;
  shot(ui: boolean): void;
  hostRoom(): string | null;
  reportExtra(): Record<string, unknown>;
}

export class DevConsole {
  el: HTMLDivElement; input: HTMLInputElement; log: HTMLDivElement; open = false;
  constructor(private h: ConsoleHost) {
    this.el = document.createElement('div'); this.el.id = 'console';
    this.el.innerHTML = '<div class="log"></div><input spellcheck="false" placeholder="EscTp casino, EscMoney 5000, EscReport ..." />';
    document.body.appendChild(this.el);
    this.log = this.el.querySelector('.log')!; this.input = this.el.querySelector('input')!;
    this.el.style.display = 'none';
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = this.input.value.trim(); this.input.value = ''; if (v) { this.print('> ' + v); this.run(v); } }
      if (e.code === 'Backquote' || e.key === 'Escape') { e.preventDefault(); this.toggle(); }
    });
  }
  toggle() {
    this.open = !this.open; this.el.style.display = this.open ? 'block' : 'none';
    if (this.open) { document.exitPointerLock?.(); setTimeout(() => this.input.focus(), 0); }
  }
  print(s: string) { const d = document.createElement('div'); d.textContent = s; this.log.appendChild(d); while (this.log.childNodes.length > 200) this.log.firstChild!.remove(); this.log.scrollTop = 1e9; }
  run(line: string) {
    const c = this.h.client, parts = line.trim().replace(/^cheat\s+/i, '').split(/\s+/), cmd = parts[0].toLowerCase();
    if (HOST_CMDS.has(cmd)) { c.send({ t: 'cheat', cmd: line.replace(/^cheat\s+/i, '') }); return; }
    switch (cmd) {
      case 'escreport': {
        const d = c.director, p = c.priv, recs = c.myRecNow();
        const counts = { humans: 0, soldiers: 0, civilians: 0, cars: 0 };
        const snap = (c as any).snaps.at(-1)?.recs as Map<number, number[]> | undefined;
        let nearestSoldier = -1, moving = 0;
        if (snap) for (const r of snap.values()) {
          if (r[E.t] === T.HUMAN) counts.humans++; if (r[E.t] === T.SOLDIER && !(r[E.f] & A.DEAD)) { counts.soldiers++; if (recs) { const dd = Math.hypot(r[E.x] - recs[E.x], r[E.y] - recs[E.y]); if (nearestSoldier < 0 || dd < nearestSoldier) nearestSoldier = dd; } }
          if (r[E.t] === T.CIV && !(r[E.f] & A.DEAD)) counts.civilians++; if (r[E.t] === T.CAR) counts.cars++;
          if ((r[E.t] === T.SOLDIER || r[E.t] === T.CIV) && Math.hypot(r[E.vx], r[E.vy]) > 0.5) moving++;
        }
        const rep = { money: d?.money ?? 0, heat: d?.heat ?? 0, stars: starsOf(d?.heat ?? 0), phase: d?.phase ?? '', finale: d?.phase === 'Playing' ? 'none' : d?.finaleKind,
          humans: counts.humans, soldiers: counts.soldiers, civilians: counts.civilians, bag: p?.bag ?? 0, armor: p?.armor ?? 0, passport: !!p?.passport, passports_missing: d?.passportsMissing ?? 0, x: recs ? +recs[E.x].toFixed(2) : 0, y: recs ? +recs[E.y].toFixed(2) : 0, inset: recs ? (c.wq.insetAt(recs[E.x], recs[E.y]) || '') : '' };
        probe('report', rep); this.print(JSON.stringify(rep));
        const rep2 = { roadblocks: d?.roadblocks ?? 0, delivery_to: p?.deliveryLabel ?? '', delivery_reward: p?.deliveryReward ?? 0,
          delivery_left: p?.deliveryDeadline ? Math.round(p.deliveryDeadline - c.hostNow()) : 0, driving: (p?.car ?? -1) >= 0, near_car: !!c.carInReach,
          sprint: c.input.isDown('ShiftLeft'), max_walk: recs ? +Math.hypot(recs[E.vx], recs[E.vy]).toFixed(2) : 0, traffic_cars: counts.cars, ...this.h.reportExtra() };
        probe('report2', rep2); this.print(JSON.stringify(rep2));
        probe('nav_report', { bots_moving: moving, nearest_soldier_m: Math.round(nearestSoldier), health: recs ? recs[E.hp] : 0 });
        break;
      }
      case 'eschost': { const room = this.h.hostRoom(); probe('cheat_host', { room }); this.print('room ' + room); break; }
      case 'escmap': c.mapOpen = !c.mapOpen; break;
      case 'esckey': {
        const name = parts[1] || 'E', hold = parseFloat(parts[2]) || 0.15, code = c.key(name, hold);
        probe('cheat_key', { key: name, hold, handled: true });
        setTimeout(() => probe('cheat_key_up', { key: name }), hold * 1000);
        void code; break;
      }
      case 'escdrive': {
        const thr = parseFloat(parts[1]) || 0, st = parseFloat(parts[2]) || 0;
        c.drive = parts.length > 1 ? [thr, st] : null;
        const r = c.myRecNow(), p = c.priv, snap = (c as any).snaps.at(-1)?.recs as Map<number, number[]>;
        const car = p && snap ? snap.get(p.car) : undefined;
        probe('cheat_drive', { car: p?.car ?? -1, speed_kmh: car ? +(Math.abs(car[E.x0 + 9]) * 3.6).toFixed(1) : 0, x: car?.[E.x] ?? r?.[E.x], y: car?.[E.y] ?? r?.[E.y], z: car?.[E.z],
          car_yaw: car ? +(car[E.yaw] * 180 / Math.PI).toFixed(1) : 0, vel_yaw: car ? +(Math.atan2(car[E.vy], car[E.vx]) * 180 / Math.PI).toFixed(1) : 0 });
        break;
      }
      case 'shot': this.h.shot(parts[1] === 'showui'); break;
      case 'cam': c.freeCam = parts[1] === 'off' || parts.length < 4 ? null : parts.slice(1, 6).map(Number); break;
      case 'fov': c.fovOverride = parseFloat(parts[1]) || 0; break;
      case 'look': c.yaw = (parseFloat(parts[1]) || 0) * Math.PI / 180; c.pitch = (parseFloat(parts[2]) || 0) * Math.PI / 180; break;
      default: this.print('unknown command ' + cmd);
    }
  }
}

/** ?script= runner: steps every 0.25 s once the local pawn exists. */
export class ScriptRunner {
  private steps: string[]; private resume = 0; private done = false;
  constructor(script: string, private con: DevConsole, private hasPawn: () => boolean, private now: () => number) {
    this.steps = script.split(';').map((s) => s.trim()).filter(Boolean);
    setInterval(() => this.tick(), 250);
  }
  tick() {
    const now = this.now();
    if (!this.hasPawn()) { this.resume = Math.max(this.resume, now + 3); return; }
    while (now >= this.resume && this.steps.length) {
      const s = this.steps.shift()!;
      if (/^wait\s/i.test(s)) { this.resume = now + (parseFloat(s.slice(5)) || 0); break; }
      probe('script_step', { cmd: s });
      this.con.run(s);
      if (/^shot/i.test(s)) { this.resume = now + 0.5; break; }
    }
    if (!this.steps.length && now >= this.resume && !this.done) { this.done = true; probe('script_done', {}); }
  }
}
