// Spot menus (spec 02 §2-§4). Pure function of replicated state: host and owning client build identical lists.
import { ACT, clock, shekels, starsOf, type DirectorState, type MenuLine, type PrivateState, type SpotState } from './protocol';

export const USE_RADIUS: Record<string, number> = { crate: 3, bag: 3, shop: 4.5, job: 4.5, casino: 4.5, forger: 4.5, bank: 5, airport: 6, delivery: 6, escape: 9, crossing: 9 };
export const CITY: Record<string, string> = { telaviv: 'Tel Aviv-Jaffa', haifa: 'Haifa', jerusalem: 'Jerusalem', eilat: 'Eilat' };
export const PRICES = { pistol: 1500, shotgun: 6000, rifle: 10000, ammo: 200, armor: 8000, laylow: 2000, passport: 5000 };

export function deliveryTerms(m: number) {
  return { reward: Math.min(5000, Math.round((2000 + 0.25 * m) / 100) * 100), seconds: Math.ceil(m / 18 + 60) };
}
export function escapeCost(mode: string, living: number) {
  const l = Math.max(1, living);
  return mode === 'escape' ? 15000 * l : mode === 'airport' ? 25000 * l : 10000;
}
const line = (text: string, action: number): MenuLine => ({ text, actionable: action !== 0, action });
const info = (text: string): MenuLine => ({ text, actionable: false, action: 0 });

/** Delivery destinations from spot `s`: other delivery spots sorted nearest first. */
export function deliveryDests(s: SpotState, all: SpotState[]) {
  return all.filter((o) => o.mode === 'delivery' && o.id !== s.id)
    .map((o) => ({ o, m: Math.hypot(o.x - s.x, o.y - s.y) })).sort((a, b) => a.m - b.m);
}

export function spotOptions(s: SpotState, d: DirectorState, p: PrivateState, now: number, allSpots: SpotState[]): MenuLine[] {
  const stars = starsOf(d.heat);
  switch (s.mode) {
    case 'crate': return s.available ? [line('Open the crate', ACT.OpenCrate)] : [info('Empty (respawns soon)')];
    case 'bag': return p.bag > 0 ? [info('You already carry a bag')] : [line(`Pick up the cash bag (${shekels(s.value)})`, ACT.PickUpBag)];
    case 'shop': {
      const o = [line(`Pistol  ${shekels(PRICES.pistol)}`, ACT.BuyPistol), line(`Shotgun  ${shekels(PRICES.shotgun)}`, ACT.BuyShotgun),
        line(`Rifle  ${shekels(PRICES.rifle)}`, ACT.BuyRifle), line(`Ammo refill  ${shekels(PRICES.ammo)}`, ACT.BuyAmmo),
        p.armor >= 0.5 ? info('Plate carrier (wearing one)') : line(`Plate carrier  ${shekels(PRICES.armor)}`, ACT.BuyArmor)];
      if (stars > 0) o.push(line(`Lay low (-1 star)  ${shekels(PRICES.laylow)}`, ACT.LayLow));
      if (p.bag > 0) o.push(line(`Fence the bag (+${shekels(p.bag)})`, ACT.Fence));
      return o;
    }
    case 'casino':
      if (stars > 0) return [info("Closed while you're wanted")];
      return [line(`Slots  ${shekels(200)}`, ACT.Slots), line(`Roulette: red  ${shekels(1000)}`, ACT.Roulette), line(`High-roller slots  ${shekels(5000)}`, ACT.HighRoller)];
    case 'job':
      if (stars > 0) return [info("No shifts while you're wanted")];
      if (p.jobOrdersLeft > 0) return [line('Add Burger', ACT.JobAdd), line('Add Fries', ACT.JobAdd + 1), line('Add Cola', ACT.JobAdd + 2),
        line('Add Falafel', ACT.JobAdd + 3), line('Serve order', ACT.JobServe), line('Clear tray', ACT.JobClear)];
      if (now < p.jobCooldownEnd) return [info(`Next shift in ${Math.ceil(p.jobCooldownEnd - now)}s`)];
      return [line("Start a shift at McShekel's (5 orders, 90 s)", ACT.JobStart)];
    case 'bank':
      if (!s.available) return [info('Vault empty')];
      if (s.timerEnd > 0) return [info(`Cracking the vault... ${Math.max(0, Math.ceil(s.timerEnd - now))}s`)];
      return [line('Rob the vault (alarm!)', ACT.HeistStart)];
    case 'forger': return p.passport ? [info('You already have a passport')] : [line(`Forged passport  ${shekels(PRICES.passport)}`, ACT.BuyPassport)];
    case 'delivery': {
      if (p.deliveryLabel) {
        if (Math.hypot(p.deliveryX - s.x, p.deliveryY - s.y) <= 1) return [line(`Deliver the package (+${shekels(p.deliveryReward)})`, ACT.Deliver)];
        return [info(`Deliver it to ${p.deliveryLabel} first`)];
      }
      const dests = deliveryDests(s, allSpots);
      if (!dests.length) return [info('No packages right now')];
      return dests.map(({ o, m }, i) => { const t = deliveryTerms(m); return line(`Take a package to ${CITY[o.inset] ?? o.inset}  +${shekels(t.reward)} in ${clock(t.seconds)}`, ACT.TakePackage + i); });
    }
    case 'escape': case 'airport': case 'crossing': {
      if (d.phase === 'Escaped') return [info('You made it out')];
      if (d.phase === 'Finale') {
        if (Math.hypot(d.escapeX - s.x, d.escapeY - s.y) <= 1) {
          const n = Math.ceil(d.finaleLeft);
          return [info(d.finaleKind === 'Airport' ? `Boarding... ${n}s` : d.finaleKind === 'Crossing' ? `Hold the border! ${n}s` : `Hold the pier! ${n}s`)];
        }
        return [info('Your ride out is waiting somewhere else')];
      }
      const price = escapeCost(s.mode, d.living);
      if (s.mode === 'escape') return [line(`Bribe the captain: ${shekels(price)}`, ACT.PayBoat)];
      if (s.mode === 'crossing') return [line(`Pay the smugglers: ${shekels(price)}`, ACT.PaySmugglers)];
      if (stars > 0) return [info("Security won't let you in while you're wanted")];
      if (d.passportsMissing > 0) return [info('Everyone needs a passport (forger in Jerusalem)')];
      return [line(`Buy tickets: ${shekels(price)}`, ACT.BuyTickets)];
    }
  }
  return [];
}

export const MARKER: Record<string, [string, string]> = {
  shop: ['SHOP', 'gold'], casino: ['CASINO', 'gold'], job: ["McSHEKEL'S", 'gold'], bank: ['BANK', 'gold'], forger: ['FORGER', 'gold'],
  escape: ['BOAT', 'boat'], airport: ['AIRPORT', 'boat'], crossing: ['BORDER', 'boat'], bag: ['CASH', 'bag'], delivery: ['DELIVERY', 'parcel'],
};
