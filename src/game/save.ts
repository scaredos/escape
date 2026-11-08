// Host save (spec 02 §7, 05 H14): localStorage 'esc.save.v1'.
import { probe } from '../core/probe';
import { shekels } from './protocol';
import type { Sim } from './sim';

export const SAVE_KEY = 'esc.save.v1';
interface SaveData { version: 1; savedAt: string; money: number; spots: { key: string; available: boolean; cooldownLeft: number }[]; passportHolders: string[] }

export function readSave(): SaveData | null {
  try { const s = localStorage.getItem(SAVE_KEY); if (!s) return null; const d = JSON.parse(s); return d && d.version === 1 ? d : null; } catch { return null; }
}
export function deleteSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

export class SaveSys {
  loaded = false; lastSave = 0; cleared = false; holders = new Set<string>();
  enabled: boolean;
  constructor(private sim: Sim) {
    // scripted runs neither load nor save unless &save=1; &nosave disables saving
    this.enabled = !sim.opts.nosave;
  }
  load() {
    this.loaded = true; this.lastSave = this.sim.now;
    const d = this.enabled && !this.sim.opts.fresh ? readSave() : null;
    if (!d) return;
    const sim = this.sim;
    sim.dir.money = Math.max(0, d.money | 0);
    probe('money_set', { money: sim.dir.money });
    const byKey = new Map(sim.econ.spots.filter(Boolean).map((s) => [s.key, s]));
    for (const r of d.spots) {
      const s = byKey.get(r.key); if (!s) continue;
      s.heistRunning = false; s.timerEnd = 0; s.reopenAt = 0;
      if (r.available) s.available = true; else sim.econ.close(s, Math.max(r.cooldownLeft, 0.1));
      sim.econ.touch(s);
    }
    for (const n of d.passportHolders) this.holders.add(n);
    sim.broadcast(`Welcome back - progress loaded (${shekels(sim.dir.money)})`);
    probe('save_loaded', { money: sim.dir.money, spots: d.spots.length, holders: d.passportHolders.length });
  }
  write(reason: string) {
    if (!this.enabled || !this.loaded) return;
    const sim = this.sim, now = sim.now;
    const data: SaveData = { version: 1, savedAt: new Date().toISOString(), money: sim.dir.money,
      spots: sim.econ.spots.filter((s) => s && s.mode !== 'bag').map((s) => ({ key: s.key, available: s.available || s.heistRunning, cooldownLeft: s.available ? 0 : Math.max(0, s.timerEnd - now) })),
      passportHolders: [...this.holders] };
    try { localStorage.setItem('esc.save.v1', JSON.stringify(data)); } catch { return; }
    this.lastSave = now;
    probe('save_written', { reason, money: data.money });
  }
  tick() {
    const sim = this.sim;
    if (!this.loaded) { this.load(); return; }
    if (sim.dir.phase === 'Escaped') { if (!this.cleared && this.enabled) { deleteSave(); probe('save_cleared', {}); } this.cleared = true; return; }
    for (const p of sim.players.values()) {
      if (p.priv.passport) this.holders.add(p.name);
      else if (this.holders.has(p.name)) { p.priv.passport = true; probe('passport_restored', { name: p.name }); }
    }
    if (sim.dir.phase !== 'Playing') return;
    if (sim.now - this.lastSave >= 120) this.write('autosave');
    else if (sim.now - this.lastSave >= 20 && sim.living().some((h) => sim.wq.spots.some((s) => s.mode === 'safehouse' && Math.hypot(s.rx - h.x, s.ry - h.y) <= 8))) this.write('safehouse');
  }
  worldEnd() {
    const ph = this.sim.dir.phase;
    if (ph === 'Playing') this.write('world_end');
    else if (ph === 'Escaped' && this.enabled) { deleteSave(); probe('save_cleared', {}); }
  }
}
