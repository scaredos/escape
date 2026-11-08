// Read-only state the HUD draws from each frame (filled by the client; spec 05 H1-H12).
import type * as THREE from 'three';
import type { DirectorState, MenuLine, PrivateState, SpotState, PlayerInfo, WeaponType } from '../game/protocol';

export interface HudFocus { kind: 'spot' | 'civ'; id: number; label: string; lines: MenuLine[]; selected: number /* index into lines */ }
export interface HudPlayerDot { name: string; x: number; y: number; local: boolean; bearing: number /* compass deg, 0 = north, for the local arrow */ }
export interface HudMate { name: string; x: number; y: number; z: number /* feet, map frame */; hp: number; maxHp: number; dead: boolean }

export interface HudView {
  hostNow: number;                 // host clock (s) for every timer
  realTime: number;                // local seconds (pulse, fades)
  director: DirectorState | null;  // null until the first snapshot: draw nothing
  priv: PrivateState | null;
  spots: SpotState[];              // replicated spot table (incl. bags)
  staticSpots: { mode: string; name: string; x: number; y: number; inset: string }[]; // world.json spots at runtime positions (map, safehouse markers)
  myPos: { x: number; y: number; z: number } | null; // pawn feet (map frame) or null if no pawn
  myInset: string;                 // insetAt(myPawn)
  camera: THREE.PerspectiveCamera; // three.js camera (three axes: x east, y up, z = -north)
  focus: HudFocus | null;
  car: { seated: boolean; inReach: null | { npcDriver: boolean } };
  feed: { text: string; t: number /* realTime when received */ }[];
  mapOpen: boolean;
  players: HudPlayerDot[];
  mates: HudMate[];                // teammates for nameplates (not the local player)
  hp: number; maxHp: number; dead: boolean; respawnIn: number;
  weapon: { type: WeaponType; mag: number; spare: number; reloading: boolean } | null;
  slots: (WeaponType | null)[];    // 3 slots
  activeSlot: number;
  spread: number;                  // current half-angle deg (crosshair gap)
  showCrosshair: boolean;
  hurtFlash: number;               // 0..1 white vignette strength
  damageNumbers: { x: number; y: number; z: number; dmg: number; head: boolean; t: number }[];
  roomBanner: string | null;       // 'Room ABCDE - invite friends: <link>' (first 10 s)
  fps: number | null;
}
export interface MapData {
  bounds: [number, number, number, number];
  landSpans(y: number): number[];
  roads: Float32Array;             // [ax, ay, bx, by] map roads
  buildings: Float32Array;         // 4 corners per footprint [x,y]*4
  insetAt(x: number, y: number): string;
  insets: { name: string; ox: number; oy: number }[];
}
