// Wire protocol + replicated state shapes (spec 05 H15-H16). JSON over PeerJS; positions in map metres.
export const PROTOCOL_V = 1;
export const BUILD_ID = '2026.11.08';

export const enum T { HUMAN = 1, SOLDIER = 2, CIV = 3, CAR = 4, HELI = 5, TANK = 6, SHELL = 7 }
/** Animation / state flags carried in entity records. */
export const enum A { DEAD = 1, SEATED = 2, HANDSUP = 4, AIR = 8, CROUCH = 16, WALK = 32, AIM = 64, FIRING = 128, RELOAD = 256, BAG = 512, PANIC = 1024 }
export type WeaponType = 'pistol' | 'shotgun' | 'rifle';
export const WEAPON_IDS: WeaponType[] = ['pistol', 'shotgun', 'rifle'];

/** Entity record: [id, type, x, y, z, yaw, vx, vy, vz, flags, hp, maxHp, held(0 none,1..3), look, extra...] */
export type EntRec = number[];
export const E = { id: 0, t: 1, x: 2, y: 3, z: 4, yaw: 5, vx: 6, vy: 7, vz: 8, f: 9, hp: 10, mh: 11, w: 12, look: 13, x0: 14 } as const;
// HUMAN extra: [seatCar, playerIdx]; CAR extra: [model, driver(-1/playerId), npcDriver, steer, paint, pitch, roll, speed, throttle]
// HELI extra: [aimX, aimY, leaving]; TANK extra: [turretYaw]; SHELL: none

export type Phase = 'Playing' | 'Finale' | 'Escaped';
export type FinaleKind = 'Escape' | 'Airport' | 'Crossing';
export interface DirectorState {
  money: number; heat: number; stars: number; searchAlpha: number; phase: Phase; finaleLeft: number;
  escapeX: number; escapeY: number; finaleKind: FinaleKind | ''; finalMoney: number; passportsMissing: number; living: number;
  roadblocks: number;
}
export interface SpotState { id: number; mode: string; label: string; available: boolean; value: number; timerEnd: number; boatOut: number; x: number; y: number; fx: number; fy: number; inset: string; heist?: boolean }
export interface WeaponSlot { type: WeaponType; mag: number; spare: number }
export interface PrivateState {
  bag: number; armor: number; passport: boolean;
  jobOrder: number[]; jobTray: number[]; jobOrdersLeft: number; jobEnd: number; jobCooldownEnd: number;
  deliveryLabel: string; deliveryX: number; deliveryY: number; deliveryReward: number; deliveryDeadline: number;
  weapons: WeaponSlot[]; active: number; reloadEnd: number; equipEnd: number;
  dead: boolean; respawnAt: number; pawn: number; car: number;
}
export interface PlayerInfo { id: number; name: string; pawn: number }

export interface InputMsg { seq: number; dt: number; mx: number; my: number; yaw: number; pitch: number; sprint: boolean; jump: boolean; crouch: boolean; fire: boolean; aim: boolean }

export type C2H =
  | { t: 'hello'; name: string; v: number; build: string }
  | { t: 'input'; inputs: InputMsg[] }
  | { t: 'use'; id: number; kind: 'spot' | 'civ'; action: number }
  | { t: 'toggleVehicle' }
  | { t: 'carInput'; throttle: number; steer: number; handbrake: boolean }
  | { t: 'equip'; slot: number }
  | { t: 'reload' }
  | { t: 'shot'; seq: number; weapon: WeaponType; origin: number[]; dirs: number[][]; hits: { id: number; point: number[]; head: boolean; d: number }[] }
  | { t: 'cheat'; cmd: string }
  | { t: 'ping'; t0: number }
  | { t: 'bye' };

export type H2C =
  | { t: 'welcome'; playerId: number; hostTime: number; players: PlayerInfo[]; spots: SpotState[]; director: DirectorState; roadblocks: number[][]; name: string; v: number }
  | { t: 'snap'; ht: number; ack: number; d: DirectorState; e: EntRec[]; players: PlayerInfo[] }
  | { t: 'priv'; s: PrivateState }
  | { t: 'spots'; s: SpotState[] }
  | { t: 'msg'; text: string; private?: boolean }
  | { t: 'roadblocks'; r: number[][] }
  | { t: 'launch'; id: number; v: number[] }
  | { t: 'shotFx'; shooter: number; weapon: WeaponType; origin: number[]; ends: number[][] }
  | { t: 'hitConfirm'; seq: number; hits: { point: number[]; dmg: number; head: boolean }[]; kills: number }
  | { t: 'hurt'; amount: number; fromYaw: number }
  | { t: 'blast'; pos: number[] }
  | { t: 'tankFire'; pos: number[] }
  | { t: 'probe'; event: string; fields: Record<string, unknown> }
  | { t: 'kick'; reason: string }
  | { t: 'pong'; t0: number; ht: number };

/** Action ids (spec 02 §2). */
export const ACT = {
  Info: 0, OpenCrate: 1, BuyPistol: 2, BuyShotgun: 3, BuyRifle: 4, BuyAmmo: 5, BuyArmor: 6, LayLow: 7, Fence: 8,
  Slots: 9, Roulette: 10, HighRoller: 11, JobStart: 12, JobServe: 13, JobClear: 14, HeistStart: 15, PayBoat: 16,
  PickUpBag: 17, BuyPassport: 18, BuyTickets: 19, PaySmugglers: 20, Deliver: 21, JobAdd: 22, TakePackage: 38,
} as const;
export interface MenuLine { text: string; actionable: boolean; action: number }

export const shekels = (n: number) => (n < 0 ? '-' : '') + '₪' + Math.abs(Math.round(n)).toLocaleString('en-US');
export const clock = (s: number) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
export const FOODS = ['Burger', 'Fries', 'Cola', 'Falafel'];
export const foods = (a: number[]) => (a.length ? a.map((i) => FOODS[i] ?? '?').join(', ') : 'empty');
export const starsOf = (heat: number) => Math.max(0, Math.min(5, Math.ceil(heat / 100 - 1e-9)));
