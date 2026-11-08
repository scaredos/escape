// All 39 props of spec 06 §9, built in code from the recipes in kit/reference/blender/props.py.
// Geometry is authored in the source frame (x forward, y left, z up) and converted to three.js axes by GeoBuilder;
// colliders and `size` stay in the source frame.
import type * as THREE from 'three';
import { Prop, rng, type PropDef } from './kit';
import { LOD_BUILDERS } from './lod';
import * as S from './street';
import * as Vn from './venue';
import * as N from './nature';
import * as Pt from './port';

export type { PropDef };
export type PropName = 'Palm'|'Ficus'|'StreetLamp'|'Bench'|'Bin'|'BusStop'|'SolarHeater'|'WaterTank'|'ACUnit'|'Umbrella'|'Lounger'|'LifeguardTower'|'Kiosk'|'Bollard'|'Planter'|'Crate'|'CrateOpen'|'CashBag'|'ShopCounter'|'SlotMachine'|'BurgerCounter'|'Vault'|'VaultOpen'|'ForgerDesk'|'CheckInDesk'|'ParcelStack'|'GuardBooth'|'BoomGate'|'JerseyBarrier'|'Boat'|'ContainerRed'|'ContainerBlue'|'ContainerGreen'|'ContainerGrey'|'PortCrane'|'Shrub'|'Rock'|'Acacia'|'Hill';

const BUILDERS: Record<PropName, (P: Prop) => void> = {
  Palm: N.palm, Ficus: N.ficus, StreetLamp: S.streetLamp, Bench: S.bench, Bin: S.bin, BusStop: S.busStop,
  SolarHeater: S.solarHeater, WaterTank: S.waterTank, ACUnit: S.acUnit, Umbrella: S.umbrella, Lounger: S.lounger,
  LifeguardTower: S.lifeguardTower, Kiosk: S.kiosk, Bollard: S.bollard, Planter: S.planter,
  Crate: (P) => Vn.crate(P, true), CrateOpen: (P) => Vn.crate(P, false), CashBag: Vn.cashBag, ShopCounter: Vn.shopCounter,
  SlotMachine: Vn.slotMachine, BurgerCounter: Vn.burgerCounter, Vault: (P) => Vn.vault(P, false), VaultOpen: (P) => Vn.vault(P, true),
  ForgerDesk: Vn.forgerDesk, CheckInDesk: Vn.checkInDesk, ParcelStack: Vn.parcelStack,
  GuardBooth: S.guardBooth, BoomGate: S.boomGate, JerseyBarrier: S.jerseyBarrier, Boat: Pt.boat,
  ContainerRed: (P) => Pt.container(P, '9E3B2E', '7E2E24'), ContainerBlue: (P) => Pt.container(P, '2B5D8F', '22496F'),
  ContainerGreen: (P) => Pt.container(P, '3F6E47', '2F5436'), ContainerGrey: (P) => Pt.container(P, '8C9196', '6E7378'),
  PortCrane: Pt.portCrane, Shrub: N.shrub, Rock: N.rock, Acacia: N.acacia, Hill: N.hill,
};

export const PROP_NAMES = Object.keys(BUILDERS) as PropName[];

const cache = new Map<PropName, PropDef>();
/** Build (once) and return the prop's merged geometry, source-frame box colliders and source-frame size. */
export function buildProp(name: PropName): PropDef {
  let d = cache.get(name);
  if (!d) {
    const P = new Prop(rng(name)); // fixed seed per prop: deterministic jitter
    BUILDERS[name](P);
    d = P.finish();
    cache.set(name, d);
  }
  return d;
}

const lodCache = new Map<PropName, THREE.BufferGeometry>();
/** Far-distance version: same pivot, frame, silhouette, size and part colours/roughness (`color` + `rough` attributes),
 *  about 10-15 % of the full triangle count. Hill returns its full geometry (already cheap). Cached. */
export function buildPropLOD(name: PropName): THREE.BufferGeometry {
  let g = lodCache.get(name);
  if (!g) {
    const lod = LOD_BUILDERS[name];
    if (lod) { const P = new Prop(rng(name)); lod(P); g = P.finish().geometry; } else g = buildProp(name).geometry;
    lodCache.set(name, g);
  }
  return g;
}
