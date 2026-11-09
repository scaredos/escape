// Host-side cheat commands (spec 05 H17). Run for the issuing player; clients forward them via {t:'cheat'}.
import { probe } from '../core/probe';
import { CAPSULE_HALF } from '../physics/character';
import { spotOptions, USE_RADIUS } from '../game/options';
import type { Player, Sim } from '../game/sim';
import type { WeaponType } from '../game/protocol';
import { CAR_MODELS } from '../game/cars';

export const HOST_CMDS = new Set(['escmoney', 'escheat', 'esctp', 'escgive', 'escsave', 'esccar', 'esctraffic', 'escuse', 'god', 'damageself', 'healself', 'damageselfdestruct', 'unlimitedhealth', 'esckillnear', 'escspawn', 'escbagfor']);

export function teleport(sim: Sim, p: Player, x: number, y: number, z: number, yaw: number) {
  const h = p.pawn; if (!h) return;
  if (p.priv.car >= 0) sim.cars.exit(p, true);
  h.ms.x = x; h.ms.y = y; h.ms.z = z + CAPSULE_HALF; h.ms.vx = h.ms.vy = h.ms.vz = 0;
  h.x = x; h.y = y; h.z = z; h.yaw = yaw;
  h.body.teleport(h.ms.x, h.ms.y, h.ms.z);
  sim.net.send(p.id, { t: 'probe', event: '__teleport', fields: { x, y, z: h.ms.z, yaw } });
}

export function runCheat(sim: Sim, p: Player, line: string) {
  const parts = line.trim().replace(/^cheat\s+/i, '').split(/\s+/), cmd = parts[0].toLowerCase(), args = parts.slice(1);
  const h = p.pawn, d = sim.dir;
  switch (cmd) {
    case 'escmoney': { const a = parseInt(args[0]) || 0; sim.econ.addMoney(a, 'cheat'); probe('cheat_money', { amount: a, money: d.money }); break; }
    case 'escheat': {
      const v = Math.max(0, Math.min(500, parseFloat(args[0]) || 0));
      if (v >= d.heat) d.addHeat(v - d.heat, 'cheat'); else d.lowerHeat(d.heat - v);
      probe('cheat_heat', { heat: d.heat, stars: d.stars }); break;
    }
    case 'esctp': {
      const arg = (args[0] || 'safehouse').toLowerCase();
      const spots = sim.wq.spots;
      let s;
      if (arg.startsWith('xy:')) { const [x, y] = arg.slice(3).split(',').map(Number); teleport(sim, p, x, y, sim.phys.groundZ(x, y, 10, 20) + 0.05, h ? h.yaw : 0); probe('tp', { mode: 'xy', name: '', x, y, ok: true }); break; }
      if (arg.startsWith('door:')) {
        const sp = spots.find((o) => o.mode === arg.slice(5) && o.shell >= 0); const sh = sp ? sim.wq.gen.shells[sp.shell] : null;
        if (sp && sh && h) { const x = sh.doorX + sh.dx * 8, y = sh.doorY + sh.dy * 8; teleport(sim, p, x, y, 0.05, Math.atan2(-sh.dy, -sh.dx)); probe('tp', { mode: 'door', name: sp.name, x, y, ok: true }); }
        else probe('tp', { mode: 'door', name: '', x: 0, y: 0, ok: false });
        break;
      }
      if (arg.startsWith('city:')) s = spots.find((o) => o.mode === 'safehouse' && o.inset === arg.slice(5));
      else if (arg === 'crate') s = spots.find((o) => o.mode === 'crate' && (!o.building || o.building === '-'));
      else if (arg === 'stash') s = spots.find((o) => o.mode === 'crate' && o.building && o.building !== '-');
      else if (arg === 'dropoff') s = spots.find((o) => o.mode === 'delivery' && Math.hypot(o.rx - p.priv.deliveryX, o.ry - p.priv.deliveryY) < 30);
      else if (arg.includes(':')) { const [m, i] = arg.split(':'); s = spots.find((o) => o.mode === m && o.inset === i); }
      else s = spots.find((o) => o.mode === arg);
      if (!s || !h) { probe('tp', { mode: arg, name: '', x: 0, y: 0, ok: false }); break; }
      let x: number, y: number;
      if (s.shell >= 0 && s.mode !== 'safehouse') { x = s.rx + s.fx * 2; y = s.ry + s.fy * 2; }
      else {
        const safe = sim.wq.nearestSpot('safehouse', s.rx, s.ry);
        let dx = (safe?.rx ?? s.rx) - s.rx, dy = (safe?.ry ?? s.ry + 1) - s.ry; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const dist = s.mode === 'safehouse' ? 0 : s.shell >= 0 ? 2 : 3;
        if (s.mode === 'safehouse') { x = s.rx; y = s.ry - 3; } else { x = s.rx + dx * dist; y = s.ry + dy * dist; }
      }
      const z = sim.phys.groundZ(x, y, 3, 10) + 1;
      teleport(sim, p, x, y, z - 1 + 0.05, Math.atan2(s.ry - y, s.rx - x));
      probe('tp', { mode: s.mode, name: s.name, x: +x.toFixed(1), y: +y.toFixed(1), ok: true }); break;
    }
    case 'escgive': {
      const w = (args[0] || '').toLowerCase() as WeaponType; const ok = ['pistol', 'shotgun', 'rifle'].includes(w) && !!h && !h.dead;
      if (ok) sim.giveWeapon(p, w); probe('cheat_give', { weapon: w, ok }); break;
    }
    case 'escsave': sim.save.write('cheat'); break;
    case 'esccar': {
      if (!h) break;
      const mode = (args[0] || '').toLowerCase();
      if (mode === 'spawn') { // test helper: EscCar spawn <mapYawDeg> [model] -> a new car under you, entered
        const yaw = (parseFloat(args[1]) || 0) * Math.PI / 180, c = sim.cars.spawn((args[2] as any) || 'sedan', h.x, h.y, 0.5, yaw);
        sim.cars.enter(p, c); probe('cheat_car', { mode, car: c.id, in: true }); break;
      }
      if (mode === 'traffic') { // freeze traffic dead so the car stays where we stand
        sim.cars.traffic.frozen = true;
        for (const c of sim.cars.traffic.list()) { c.body.setLinvel({ x: 0, y: 0, z: 0 }, true); c.body.setAngvel({ x: 0, y: 0, z: 0 }, true); c.speed = 0; }
      }
      let best = null as any, bd = Infinity;
      for (const c of sim.cars.cars.values()) {
        if (c.driver || (mode === 'traffic' ? !c.npc : c.npc)) continue;
        const dd = Math.hypot(c.x - h.x, c.y - h.y); if (dd < bd) { bd = dd; best = c; }
      }
      if (!best) { probe('cheat_car', { mode, car: -1, in: false }); break; }
      const cs = Math.cos(best.yaw), sn = Math.sin(best.yaw);
      const off = best.spec.size[1] / 2 + 1.5, x = best.x - sn * off, y = best.y + cs * off;
      teleport(sim, p, x, y, best.z + 0.1, Math.atan2(best.y - y, best.x - x));
      if (!mode) sim.cars.enter(p, best);
      probe('cheat_car', { mode, car: best.id, in: !mode }); break;
    }
    case 'esctraffic': {
      const t = sim.cars.traffic, m = (args[0] || '').toLowerCase();
      if (m === 'stop') t.frozen = true; else if (m === 'go') t.frozen = false; else if (m === 'spawn' && h) (t as any).cheatSpawn?.(h);
      if (m === 'stop' || m === 'go') probe('traffic_frozen', { frozen: t.frozen, cars: (t as any).count?.() ?? 0 });
      (t as any).logState?.(); break;
    }
    case 'escuse': {
      if (!h) break;
      const idx = parseInt(args[0]) || 0;
      let best = null as any, bd = Infinity;
      for (const s of sim.econ.spots) { if (!s) continue; const dd = Math.hypot(s.x - h.x, s.y - h.y); if (dd <= (USE_RADIUS[s.mode] ?? 3) + 1.5 && dd < bd) { bd = dd; best = s; } }
      if (!best) { probe('cheat_use', { target: -1, index: idx, dist: -1 }); break; }
      const lines = spotOptions(best, d.state(), p.priv, sim.now, sim.econ.spotStates());
      probe('cheat_use', { target: best.id, index: idx, dist: +bd.toFixed(1) });
      const l = lines[idx]; if (l && l.actionable) sim.econ.use(p, 'spot', best.id, l.action);
      break;
    }
    case 'god': if (d.god.has(p.id)) d.god.delete(p.id); else d.god.add(p.id); break;
    case 'unlimitedhealth': if (args[0] === '0') d.god.delete(p.id); else d.god.add(p.id); break;
    case 'damageself': if (h) sim.damage(h, parseFloat(args[0]) || 10, null); break;
    case 'healself': if (h) h.hp = Math.min(h.maxHp, h.hp + (parseFloat(args[0]) || 100)); break;
    case 'damageselfdestruct': if (h && !h.dead) { d.god.delete(p.id); sim.kill(h, null); } break;
    case 'escbagfor': { // test helper: EscBagFor <name> <value>
      const q = [...sim.players.values()].find((o) => o.name === args[0]); if (q) q.priv.bag = parseInt(args[1]) || 0; break;
    }
    case 'escspawn': { // test helper: EscSpawn civ|soldier [dist]
      if (!h) break; const dist = parseFloat(args[1]) || 6, fx = Math.cos(h.yaw), fy = Math.sin(h.yaw);
      if ((args[0] || '').startsWith('sol')) sim.bots.spawnSoldierAt(h.x + fx * dist, h.y + fy * dist, h.x, h.y);
      else { const c = sim.bots.spawnCivilianAt(h.x + fx * dist, h.y + fy * dist, false, 0, 0); if (c) { c.yaw = Math.atan2(h.y - c.y, h.x - c.x); c.idleUntil = sim.now + 30; } }
      break;
    }
    case 'esckillnear': { // test helper: kill the nearest civilian as this player (gun death path)
      if (!h) break; let best = null as any, bd = Infinity;
      for (const b of sim.bots.byId.values()) if (!b.dead && b.type === 3) { const dd = Math.hypot(b.x - h.x, b.y - h.y); if (dd < bd) { bd = dd; best = b; } }
      if (best) sim.damage(best, 1000, h, (sim.held(p) || 'pistol') as WeaponType); break;
    }
  }
  void CAR_MODELS;
}
