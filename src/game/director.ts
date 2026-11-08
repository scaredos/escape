// Heat, stars, search/decay, finales, team wipe and kill bookkeeping (spec 03 §1, §10-§12). Host only.
import { probe } from '../core/probe';
import { CAPSULE_HALF, EYE } from '../physics/character';
import { T, shekels, starsOf, type DirectorState, type FinaleKind, type Phase } from './protocol';
import type { SpotRT } from './economy';
import type { Human, Player, Sim } from './sim';
import type { Bot } from './bots';

export class Director {
  money = 500; heat = 0; searchAlpha = 0; lastHeatGain = -1000; lastSeen = -1000; unseenTime = 0;
  phase: Phase = 'Playing'; finaleLeft = 0; escapeX = 0; escapeY = 0; finaleKind: FinaleKind | '' = ''; finalMoney = 0; finalePaid = 0;
  passportsMissing = 0;
  god = new Set<number>();
  constructor(private sim: Sim) {}
  get stars() { return starsOf(this.heat); }
  state(): DirectorState {
    return { money: this.money, heat: Math.round(this.heat * 100) / 100, stars: this.stars, searchAlpha: Math.round(this.searchAlpha * 1000) / 1000, phase: this.phase,
      finaleLeft: this.finaleLeft, escapeX: this.escapeX, escapeY: this.escapeY, finaleKind: this.finaleKind, finalMoney: this.finalMoney,
      passportsMissing: this.passportsMissing, living: Math.max(1, this.sim.living().length), roadblocks: this.sim.hunters.roadblocks.length };
  }
  addHeat(amount: number, reason: string) {
    if (this.phase === 'Escaped') return;
    const before = this.stars;
    this.heat = Math.max(0, Math.min(500, this.heat + Math.max(amount, 0)));
    this.lastHeatGain = this.sim.now; this.unseenTime = 0; this.searchAlpha = 0;
    probe('heat', { reason, amount, heat: this.heat, stars: this.stars });
    if (this.stars > before) this.sim.broadcast(`Wanted level ${this.stars}`);
  }
  setHeatAtLeast(x: number, reason: string) { this.addHeat(Math.max(0, x - this.heat), reason); }
  lowerHeat(x: number) {
    this.heat = Math.max(0, this.heat - x); this.unseenTime = 0; this.searchAlpha = 0;
    probe('heat_lower', { amount: x, heat: this.heat, stars: this.stars });
  }
  /** witness test: a living soldier within range (3D) with LOS from its eye to the point. */
  soldierSees(x: number, y: number, z: number, range = 100): boolean {
    for (const b of this.sim.bots.soldiers()) {
      if (b.dead) continue;
      const ez = b.z + CAPSULE_HALF + EYE;
      if (Math.hypot(b.x - x, b.y - y, ez - z) > range) continue;
      if (this.sim.phys.los(b.x, b.y, ez, x, y, z)) return true;
    }
    return false;
  }
  tick(dt: number) {
    const sim = this.sim;
    this.sim.bots.prune();
    let missing = 0; for (const h of sim.living()) if (!h.player.priv.passport) missing++;
    this.passportsMissing = missing;
    if (this.phase === 'Escaped') { sim.bots.removeAllSoldiers(); sim.bots.populate(true); return; }
    // shot detection
    for (const p of sim.players.values()) {
      if (!p.firedSinceTick) continue; p.firedSinceTick = false;
      const h = p.pawn; if (!h || h.dead) continue;
      if (sim.bots.anyLiving(T.CIV, h.x, h.y, 50) || sim.bots.anyLiving(T.SOLDIER, h.x, h.y, 80)) this.addHeat(12, 'shot');
    }
    // seen
    for (const b of sim.bots.soldiers()) {
      if (b.dead) continue;
      const ez = b.z + CAPSULE_HALF + EYE;
      if (sim.living().some((h) => Math.hypot(h.x - b.x, h.y - b.y, h.z - b.z) <= 100 && sim.phys.los(b.x, b.y, ez, h.x, h.y, h.z + CAPSULE_HALF + EYE))) { this.lastSeen = sim.now; break; }
    }
    // search / decay
    const searching = this.heat > 0 && this.phase === 'Playing' && sim.now - this.lastHeatGain >= 8 && sim.now - this.lastSeen >= 8;
    if (!searching) { this.unseenTime = 0; this.searchAlpha = 0; }
    else {
      this.unseenTime += dt;
      if (this.unseenTime >= 15) {
        this.unseenTime = 0; this.heat = Math.max(0, this.heat - 100);
        probe('heat_decay', { heat: this.heat, stars: this.stars });
        sim.broadcast(this.heat > 0 ? `They lost your trail: wanted level ${this.stars}` : 'The heat is off');
      }
      this.searchAlpha = Math.max(0, Math.min(1, this.unseenTime / 15));
    }
    if (this.phase === 'Finale') this.finaleTick(dt);
    sim.bots.populate(false);
  }
  noteSeen() { this.lastSeen = this.sim.now; }

  // -------------------------------------------------------------- finales
  startFinale(s: SpotRT, price: number, p: Player) {
    const kind: FinaleKind = s.mode === 'escape' ? 'Escape' : s.mode === 'airport' ? 'Airport' : 'Crossing';
    this.phase = 'Finale'; this.escapeX = s.x; this.escapeY = s.y; this.finaleKind = kind; this.finalePaid = price;
    this.finaleLeft = kind === 'Escape' ? 60 : kind === 'Airport' ? 30 : 90;
    if (kind !== 'Airport') this.addHeat(500 - this.heat, 'finale');
    const n = this.sim.nameOf(p);
    this.sim.broadcast(kind === 'Airport' ? `${n} bought the tickets (${shekels(price)}). Boarding in 30 s: stay at the gate and don't get wanted!`
      : kind === 'Crossing' ? `${n} paid the smugglers (${shekels(price)}). Hold the border for 90 s until the truck comes!`
      : `${n} bribed the captain (${shekels(price)}). Hold the pier until the boat leaves!`);
    probe('finale_start', { kind, seconds: this.finaleLeft, x: s.x, y: s.y });
  }
  private finaleTick(dt: number) {
    const sim = this.sim;
    if (this.finaleKind === 'Airport' && this.stars > 0) {
      this.phase = 'Playing'; this.finaleLeft = 0;
      sim.econ.addMoney(this.finalePaid, 'refund');
      sim.broadcast(`Boarding cancelled: you're wanted! Tickets refunded (${shekels(this.finalePaid)}). Lose the stars and try again`);
      probe('finale_cancel', { kind: 'Airport', refund: this.finalePaid }); this.finaleKind = ''; return;
    }
    const holders = sim.living().filter((h) => Math.hypot(h.x - this.escapeX, h.y - this.escapeY) <= 30);
    if (!holders.length) return;
    const before = Math.ceil(this.finaleLeft / 10);
    this.finaleLeft = Math.max(0, this.finaleLeft - dt);
    const after = Math.ceil(this.finaleLeft / 10);
    if (after < before && this.finaleLeft > 0) {
      const hold = this.finaleKind === 'Airport' ? 'Boarding' : this.finaleKind === 'Crossing' ? 'Hold the border' : 'Hold the pier';
      sim.broadcast(`${hold}: ${after * 10} s`);
    }
    if (this.finaleLeft <= 0) {
      this.phase = 'Escaped'; this.finalMoney = this.money; this.heat = 0; this.unseenTime = 0; this.searchAlpha = 0;
      const tier = tierOf(this.finalMoney), how = this.describe();
      sim.broadcast(`ESCAPED ${how} with ${shekels(this.finalMoney)}: ${tier}`);
      probe('run_end', { kind: this.finaleKind, escaped: holders.length, humans: sim.humans.size, money: this.finalMoney, tier });
    }
  }
  describe() {
    if (this.finaleKind === 'Airport') return 'on a plane from Ben Gurion';
    if (this.finaleKind === 'Crossing') return 'over the southern border';
    return this.sim.wq.insetAt(this.escapeX, this.escapeY) === 'haifa' ? 'by boat from Haifa' : 'by boat from Jaffa';
  }
  teamWipe() {
    const lost = Math.floor(this.money / 4);
    this.money -= lost; this.heat = 0; this.unseenTime = 0; this.searchAlpha = 0;
    this.sim.broadcast(`Everyone is down! Lost ${shekels(lost)}, the heat is off`);
    probe('team_wipe', { lost, money: this.money });
  }
  onBotKilled(b: Bot, byHuman: Human | null) {
    if (!byHuman) return;
    if (b.type === T.CIV) {
      const seen = this.soldierSees(b.x, b.y, b.z + 0.9 + 0.5);
      this.addHeat(seen ? 200 : 100, 'civilian');
      this.sim.broadcast(seen ? 'A soldier saw you kill a civilian!' : 'A civilian was killed. That never pays.');
    } else this.addHeat(40, 'soldier');
  }
}
export const tierOf = (m: number) => (m < 10000 ? 'Broke' : m < 60000 ? 'Comfortable' : 'Kingpin');
