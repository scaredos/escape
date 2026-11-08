// Interactables and the whole economy (spec 02). Host only.
import { probe } from '../core/probe';
import { gameRng } from '../core/rng';
import { ACT, clock, shekels, starsOf, T, type SpotState } from './protocol';
import { CITY, PRICES, USE_RADIUS, deliveryDests, deliveryTerms, escapeCost, spotOptions } from './options';
import type { Player, Sim } from './sim';

export interface SpotRT extends SpotState { hasPistol: boolean; heistRunning: boolean; dirty: boolean; key: string; reopenAt: number }

export class Economy {
  spots: SpotRT[] = [];
  private changed = false;
  constructor(private sim: Sim) {
    const modes = new Set(['crate', 'shop', 'casino', 'job', 'bank', 'escape', 'airport', 'crossing', 'forger', 'delivery']);
    for (const s of sim.wq.spots) {
      if (!modes.has(s.mode)) continue;
      const id = this.spots.length;
      this.spots.push({ id, mode: s.mode, label: s.name, available: true, value: 0, timerEnd: 0, boatOut: s.boatOut, x: s.rx, y: s.ry, fx: s.fx, fy: s.fy,
        inset: s.inset || '', hasPistol: !!s.pistol, heistRunning: false, dirty: false, reopenAt: 0,
        key: `${s.mode[0].toUpperCase() + s.mode.slice(1)}_${Math.round(s.ry)}_${Math.round(s.rx)}` });
    }
  }
  spotStates(): SpotState[] { return this.spots.filter(Boolean).map(pub); }
  touch(s: SpotRT) { s.dirty = true; this.changed = true; }
  flushSpots() {
    if (!this.changed) return;
    this.changed = false;
    const ch = this.spots.filter((s) => s && s.dirty); ch.forEach((s) => (s.dirty = false));
    this.sim.sendAll({ t: 'spots', s: ch.map(pub) });
  }
  // ---------------------------------------------------------------- wallet
  addMoney(delta: number, reason: string) {
    const d = this.sim.dir; d.money = Math.max(0, d.money + Math.round(delta));
    probe('money', { reason, delta: Math.round(delta), money: d.money });
  }
  trySpend(p: Player, amount: number): boolean {
    const d = this.sim.dir;
    if (amount < 0 || amount > d.money) { this.sim.tell(p, `Not enough money (${shekels(amount)})`); return false; }
    d.money -= amount; probe('spend', { amount, money: d.money }); return true;
  }
  // ---------------------------------------------------------------- frame / timers
  frame() {
    const now = this.sim.now;
    for (const s of this.spots) {
      if (!s) continue;
      if (s.mode === 'bank' && s.heistRunning && now >= s.timerEnd) this.endHeist(s);
      else if (!s.available && s.reopenAt > 0 && now >= s.reopenAt) { s.available = true; s.timerEnd = 0; s.reopenAt = 0; this.touch(s); }
    }
    for (const p of this.sim.players.values()) {
      const v = p.priv;
      if (v.jobOrdersLeft > 0 && now > v.jobEnd) {
        v.jobOrdersLeft = 0; v.jobOrder = []; v.jobTray = []; v.jobCooldownEnd = now + 120;
        this.sim.tell(p, 'Shift over: out of time'); probe('job_timeout', {});
      }
      if (v.deliveryLabel && now > v.deliveryDeadline) {
        this.sim.tell(p, 'The client cancelled - too slow');
        probe('delivery_failed', { reason: 'timeout', to: v.deliveryLabel, reward: v.deliveryReward });
        this.clearDelivery(p);
      }
    }
  }
  close(s: SpotRT, seconds: number) { s.available = false; s.timerEnd = this.sim.now + seconds; s.reopenAt = this.sim.now + Math.max(seconds, 0.1); this.touch(s); }
  clearDelivery(p: Player) { Object.assign(p.priv, { deliveryLabel: '', deliveryX: 0, deliveryY: 0, deliveryReward: 0, deliveryDeadline: 0 }); }
  dropBag(x: number, y: number, value: number) {
    const id = this.spots.length;
    this.spots.push({ id, mode: 'bag', label: 'Cash bag', available: true, value, timerEnd: 0, boatOut: 0, x, y, fx: 0, fy: 1, inset: this.sim.wq.insetAt(x, y),
      hasPistol: false, heistRunning: false, dirty: true, key: '', reopenAt: 0 });
    this.changed = true;
  }
  private removeSpot(s: SpotRT) { (this.spots as any)[s.id] = undefined; this.sim.sendAll({ t: 'spots', s: [{ ...pub(s), mode: 'gone' }] }); }

  // ---------------------------------------------------------------- use
  use(p: Player, kind: 'spot' | 'civ', id: number, action: number) {
    const h = p.pawn; if (!h || h.dead) return;
    if (kind === 'civ') return this.holdUp(p, id);
    const s = this.spots[id]; if (!s) return;
    if (Math.hypot(s.x - h.x, s.y - h.y) > (USE_RADIUS[s.mode] ?? 3) + 1.5) return;
    const opts = spotOptions(s, this.sim.dir.state(), p.priv, this.sim.now, this.spotStates());
    if (!action || !opts.some((o) => o.actionable && o.action === action)) return;
    this.run(p, s, action);
    this.touch(s); this.flushSpots();
  }
  run(p: Player, s: SpotRT, action: number) {
    const sim = this.sim, d = sim.dir, v = p.priv, now = sim.now;
    switch (action) {
      case ACT.OpenCrate: {
        if (s.hasPistol && !sim.hasGun(p)) { sim.giveWeapon(p, 'pistol'); sim.tell(p, 'You found a pistol in the stash'); probe('crate_open', { label: s.label, pistol: true, money: 0 }); }
        else { const found = gameRng.int(50, 300); this.addMoney(found, 'crate'); sim.tell(p, `You found ${shekels(found)} in the crate`); probe('crate_open', { label: s.label, pistol: false, money: found }); }
        this.close(s, s.hasPistol ? 60 : 300); break;
      }
      case ACT.BuyPistol: case ACT.BuyShotgun: case ACT.BuyRifle: {
        const type = action === ACT.BuyPistol ? 'pistol' : action === ACT.BuyShotgun ? 'shotgun' : 'rifle';
        if (!this.trySpend(p, PRICES[type])) return;
        if (!sim.giveWeapon(p, type)) { this.addMoney(PRICES[type], 'refund'); sim.tell(p, "Couldn't hand over the weapon: refunded"); return; }
        sim.tell(p, `Bought: ${type[0].toUpperCase() + type.slice(1)}`); probe('buy', { item: type, price: PRICES[type] }); break;
      }
      case ACT.BuyAmmo:
        if (!sim.hasGun(p)) { sim.tell(p, 'You have no gun to load'); return; }
        if (!this.trySpend(p, PRICES.ammo)) return;
        for (const w of v.weapons) w.spare += 60;
        sim.tell(p, 'Ammo refilled'); probe('buy', { item: 'ammo', price: PRICES.ammo }); break;
      case ACT.BuyArmor:
        if (!this.trySpend(p, PRICES.armor)) return;
        sim.setArmor(p.pawn!, 0.5); sim.tell(p, 'Plate carrier on (lost if you die)'); probe('buy', { item: 'armor', price: PRICES.armor }); break;
      case ACT.LayLow:
        if (!this.trySpend(p, PRICES.laylow)) return;
        d.lowerHeat(100); sim.broadcast(`${sim.nameOf(p)} paid to lay low: -1 star`); probe('buy', { item: 'laylow', price: PRICES.laylow }); break;
      case ACT.Fence: {
        const val = v.bag; this.addMoney(val, 'fence'); v.bag = 0;
        sim.broadcast(`${sim.nameOf(p)} fenced the cash bag: +${shekels(val)}`); probe('fence', { value: val }); break;
      }
      case ACT.Slots: case ACT.HighRoller: {
        const bet = action === ACT.Slots ? 200 : 5000;
        if (!this.trySpend(p, bet)) return;
        const r = gameRng.frand();
        let mult = 0, reels = '';
        if (r < 0.005) { mult = 50; reels = '7 | 7 | 7'; } else if (r < 0.045) { mult = 5; reels = 'BAR | BAR | BAR'; }
        else if (r < 0.28) { mult = 2; reels = 'CHERRY | CHERRY | CHERRY'; }
        else reels = gameRng.pick(['LEMON | BELL | 7', 'CHERRY | LEMON | BAR', 'BELL | BAR | LEMON']);
        const win = bet * mult; if (win) this.addMoney(win, 'casino');
        sim.tell(p, win ? `Slots: [${reels}] - you win ${shekels(win)}!` : `Slots: [${reels}] - no luck`);
        probe('casino', { game: action === ACT.Slots ? 'slots' : 'highroller', bet, win }); break;
      }
      case ACT.Roulette: {
        if (!this.trySpend(p, 1000)) return;
        const win = gameRng.frand() < 18 / 37;
        if (win) this.addMoney(2000, 'casino');
        sim.tell(p, win ? 'Roulette: red! You win ₪2,000' : 'Roulette: black. The house wins');
        probe('casino', { game: 'roulette', bet: 1000, win: win ? 2000 : 0 }); break;
      }
      case ACT.JobStart:
        Object.assign(v, { jobOrdersLeft: 5, jobEnd: now + 90, jobTray: [], jobOrder: newOrder() }); p.burgerEarned = 0;
        sim.tell(p, 'Shift started: 5 orders in 90 s'); probe('job_order', { action: 'start', orders: 5 }); break;
      case ACT.JobClear: v.jobTray = []; break;
      case ACT.JobServe: {
        const ok = [...v.jobTray].sort().join() === [...v.jobOrder].sort().join();
        if (ok) { this.addMoney(80, 'job'); p.burgerEarned += 80; sim.tell(p, 'Order up! +₪80'); } else sim.tell(p, 'Wrong order: no pay');
        v.jobTray = []; v.jobOrdersLeft -= 1;
        probe('job_order', { action: 'serve', correct: ok, left: v.jobOrdersLeft, earned: p.burgerEarned });
        if (v.jobOrdersLeft > 0) v.jobOrder = newOrder();
        else { v.jobOrder = []; v.jobCooldownEnd = now + 120; sim.tell(p, `Shift over: you earned ${shekels(p.burgerEarned)}`); }
        break;
      }
      case ACT.HeistStart:
        d.setHeatAtLeast(300, 'heist');
        s.heistRunning = true; s.timerEnd = now + 40;
        sim.broadcast(`${sim.nameOf(p)} is robbing ${s.label}! Stay within 25 m of the vault for 40 s`); probe('heist_start', { label: s.label }); break;
      case ACT.PickUpBag:
        v.bag = s.value; sim.broadcast(`${sim.nameOf(p)} grabbed the cash bag (${shekels(s.value)}): fence it at the shop`);
        probe('bag_pickup', { value: s.value }); this.removeSpot(s); break;
      case ACT.BuyPassport:
        if (!this.trySpend(p, PRICES.passport)) return;
        v.passport = true; sim.broadcast(`${sim.nameOf(p)} bought a forged passport`); probe('buy', { item: 'passport', price: PRICES.passport }); break;
      case ACT.PayBoat: case ACT.BuyTickets: case ACT.PaySmugglers: {
        if (d.phase !== 'Playing') return;
        const price = escapeCost(s.mode, sim.living().length);
        if (!this.trySpend(p, price)) return;
        probe('escape_paid', { kind: s.mode === 'escape' ? 'Escape' : s.mode === 'airport' ? 'Airport' : 'Crossing', cost: price });
        d.startFinale(s, price, p); break;
      }
      case ACT.Deliver: {
        const rew = v.deliveryReward, label = v.deliveryLabel, left = v.deliveryDeadline - now;
        this.addMoney(rew, 'delivery'); this.clearDelivery(p);
        sim.broadcast(`${sim.nameOf(p)} delivered a package to ${s.label}: +${shekels(rew)}`);
        probe('delivery_done', { to: label, reward: rew, secs_left: Math.round(left) }); break;
      }
      default:
        if (action >= ACT.JobAdd && action < ACT.JobAdd + 4) {
          if (v.jobTray.length >= 4) sim.tell(p, 'The tray is full'); else v.jobTray.push(action - ACT.JobAdd);
        } else if (action >= ACT.TakePackage) {
          const dests = deliveryDests(s, this.spotStates()), dd = dests[action - ACT.TakePackage]; if (!dd) return;
          const t = deliveryTerms(dd.m), city = CITY[dd.o.inset] ?? dd.o.inset;
          Object.assign(v, { deliveryLabel: `${city} - ${dd.o.label}`, deliveryX: dd.o.x, deliveryY: dd.o.y, deliveryReward: t.reward, deliveryDeadline: now + t.seconds });
          sim.tell(p, `Package for ${v.deliveryLabel}: get it there within ${clock(t.seconds)} for ${shekels(t.reward)}`);
          probe('delivery_start', { from: s.label, to: v.deliveryLabel, reward: t.reward, seconds: t.seconds, dist_m: Math.round(dd.m) });
        }
    }
  }
  private endHeist(s: SpotRT) {
    const sim = this.sim;
    s.heistRunning = false;
    const ok = sim.living().some((h) => Math.hypot(h.x - s.x, h.y - s.y, h.z - 0) <= 25);
    if (ok) {
      const cash = gameRng.int(20000, 50000);
      this.dropBag(s.x + s.fx * 2, s.y + s.fy * 2, cash);
      sim.broadcast(`The vault at ${s.label} is open: grab the cash bag (${shekels(cash)})!`);
      probe('heist_done', { label: s.label, ok: true, value: cash });
    } else { sim.broadcast(`The heist at ${s.label} failed: nobody stayed at the vault`); probe('heist_done', { label: s.label, ok: false, value: 0 }); }
    this.close(s, 600);
  }
  private holdUp(p: Player, civId: number) {
    const sim = this.sim, h = p.pawn!;
    const c = sim.bots.byId.get(civId);
    if (!sim.held(p) || p.priv.car >= 0) return;
    if (!c || c.type !== T.CIV) { sim.tell(p, 'Nothing to take'); return; }
    if (Math.hypot(c.x - h.x, c.y - h.y) > 6.5) return;
    if (c.dead || c.robbed) { sim.tell(p, 'Nothing to take'); return; }
    c.robbed = true;
    sim.bots.robbed(c, h);
    const amount = gameRng.int(20, 300);
    this.addMoney(amount, 'holdup');
    const seen = sim.dir.soldierSees(h.x, h.y, h.z + 0.9 + 0.5);
    sim.dir.addHeat(seen ? 100 : 40, 'holdup');
    sim.tell(p, `They hand over ${shekels(amount)}`);
    probe('civilian_robbed', { civilian: c.id, robber: p.id });
    probe('holdup', { amount, seen, heat: sim.dir.heat });
  }
}
function newOrder() { return [gameRng.helper(4), gameRng.helper(4), gameRng.helper(4)]; }
function pub(s: SpotRT): SpotState {
  return { id: s.id, mode: s.mode, label: s.label, available: s.available, value: s.value, timerEnd: s.timerEnd, boatOut: s.boatOut, x: s.x, y: s.y, fx: s.fx, fy: s.fy, inset: s.inset, heist: s.heistRunning };
}
export { starsOf };
