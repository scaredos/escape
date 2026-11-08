// Weapon table (spec 04 §5.3), spread model, falloff and the shared hitscan tracer.
import { Rng, hashInts } from '../core/rng';
import type { WeaponType } from './protocol';

export interface WeaponDef {
  name: string; interval: number; dmg: number; pellets: number; mag: number; spare: number; reload: number; auto: boolean;
  base: number; inc: number; max: number; recover: number; delay: number; fixed: boolean;
  ads: number; still: number; air: number; falloff: [number, number][]; range: number; kb: number; price: number;
}
export const WEAPONS: Record<WeaponType, WeaponDef> = {
  pistol: { name: 'Pistol', interval: 0.2, dmg: 18, pellets: 1, mag: 12, spare: 36, reload: 1.4, auto: false, base: 1.2, inc: 0.6, max: 3.0, recover: 6, delay: 0, fixed: false,
    ads: 0.5, still: 0.8, air: 2, falloff: [[20, 1], [50, 0.5], [250, 0.5]], range: 250, kb: 7, price: 1500 },
  shotgun: { name: 'Shotgun', interval: 0.86, dmg: 9, pellets: 10, mag: 6, spare: 18, reload: 2.6, auto: false, base: 5, inc: 0, max: 5, recover: 0, delay: 0, fixed: true,
    ads: 0.8, still: 1, air: 1.5, falloff: [[6, 1], [25, 0.2], [40, 0.2]], range: 40, kb: 26, price: 6000 },
  rifle: { name: 'Rifle', interval: 0.1, dmg: 12, pellets: 1, mag: 30, spare: 90, reload: 2.1, auto: true, base: 0.6, inc: 0.25, max: 3.5, recover: 5, delay: 0.15, fixed: false,
    ads: 0.4, still: 0.8, air: 2, falloff: [[35, 1], [100, 0.6], [250, 0.6]], range: 250, kb: 13, price: 10000 },
};
export const KNOCKBACK_NONE = 9;

export function falloff(w: WeaponDef, d: number): number {
  if (d > w.range) return 0;
  const f = w.falloff;
  if (d <= f[0][0]) return f[0][1];
  for (let i = 1; i < f.length; i++) if (d <= f[i][0]) { const [d0, v0] = f[i - 1], [d1, v1] = f[i]; return v0 + ((d - d0) / (d1 - d0)) * (v1 - v0); }
  return f[f.length - 1][1];
}

/** Per-shooter spread state (half-angle in degrees). */
export class Spread {
  heat = 0; lastShot = -10;
  current(w: WeaponDef, now: number, o: { ads: boolean; speed: number; air: boolean }): number {
    let s = w.fixed ? w.base : Math.min(w.max, w.base + this.decayed(w, now));
    if (o.ads) s *= w.ads;
    if (o.air) s *= w.air; else if (o.speed < 0.8) s *= w.still;
    return s;
  }
  private decayed(w: WeaponDef, now: number) { const t = now - this.lastShot - w.delay; return t > 0 ? Math.max(0, this.heat - w.recover * t) : this.heat; }
  fired(w: WeaponDef, now: number) { if (!w.fixed) { this.heat = Math.min(w.max - w.base, this.decayed(w, now) + w.inc); } this.lastShot = now; }
}

/** Deterministic spread rays seeded from (playerId, seq): the host can rebuild them. dir is a unit vector (map frame). */
export function spreadRays(playerId: number, seq: number, dir: number[], halfDeg: number, pellets: number): number[][] {
  const rng = new Rng(hashInts(playerId, seq));
  const [dx, dy, dz] = dir;
  // basis
  let ux = -dy, uy = dx, uz = 0; let ul = Math.hypot(ux, uy); if (ul < 1e-4) { ux = 1; uy = 0; ul = 1; } ux /= ul; uy /= ul;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  const out: number[][] = [];
  for (let p = 0; p < pellets; p++) {
    const a = rng.frand() * Math.PI * 2, r = Math.tan((halfDeg * Math.PI) / 180) * Math.sqrt(rng.frand());
    const x = dx + (ux * Math.cos(a) + vx * Math.sin(a)) * r, y = dy + (uy * Math.cos(a) + vy * Math.sin(a)) * r, z = dz + (uz * Math.cos(a) + vz * Math.sin(a)) * r;
    const l = Math.hypot(x, y, z); out.push([x / l, y / l, z / l]);
  }
  return out;
}

export interface Target { id: number; x: number; y: number; z: number /* feet */; seated?: boolean }
/** Ray vs character capsule (r 0.4, feet..1.8) and head sphere (r 0.14 at 1.62). Returns distance or -1 and head flag. */
export function rayCharacter(o: number[], d: number[], t: Target): { dist: number; head: boolean } | null {
  // head first
  const hz = t.z + 1.62, hx = t.x - o[0], hy = t.y - o[1], hzz = hz - o[2];
  const b = hx * d[0] + hy * d[1] + hzz * d[2], c = hx * hx + hy * hy + hzz * hzz - 0.14 * 0.14, disc = b * b - c;
  let best: { dist: number; head: boolean } | null = null;
  if (disc >= 0 && b - Math.sqrt(disc) > 0) best = { dist: b - Math.sqrt(disc), head: true };
  // body: infinite vertical cylinder r .38 clipped to z..z+1.5
  const ox = o[0] - t.x, oy = o[1] - t.y, A = d[0] * d[0] + d[1] * d[1];
  if (A > 1e-8) {
    const B = 2 * (ox * d[0] + oy * d[1]), C = ox * ox + oy * oy - 0.38 * 0.38, D = B * B - 4 * A * C;
    if (D >= 0) {
      const s = (-B - Math.sqrt(D)) / (2 * A);
      if (s > 0) { const z = o[2] + d[2] * s; if (z >= t.z && z <= t.z + 1.5 && (!best || s < best.dist)) best = { dist: s, head: false }; }
    }
  }
  return best;
}
