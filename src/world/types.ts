// Shared world data types. Generator frame: metres, x east, y north, z up ("world inset-metres", spec 01 §1).

export interface PackInset {
  name: string; offset: [number, number]; attribution: string;
  land_rows: number[][]; piers: number[][];
  b_ids: string[]; b: number[]; r_ids: string[]; r_type: number[]; r_len: number[]; r_pts: number[];
  parks: [string, number, number, number][]; kiosks: [number, number][];
}
export interface Spot { mode: string; name: string; x: number; y: number; building: string; inset: string; pistol?: boolean }
export interface Zone { name: string; kind: 'airport' | 'village' | 'fields' | 'desert'; rect: [number, number, number, number] }
export interface Pack {
  v: number; styles: string[];
  world: { bounds: [number, number, number, number]; west_coast: [number, number][]; highways: { name: string; pts: [number, number][] }[]; zones: Zone[]; spots: Spot[] };
  insets: PackInset[];
}

/** Box instance record stride (all box layers). */
export const BOX = 13;
// [cx, cy, cz(centre height), L (along yaw), W, H, yawDeg (CCW from east), pitchDeg, rollDeg, r, g, b, extra]
// facade: rgb = linear tint, extra = stone 0/1 ; flat: rgb = linear colour, extra = roughness ; textured: rgb unused
/** Prop instance stride. [x, y, z, yawDeg, pitchDeg, rollDeg, sx, sy, sz, flags(1 = collide)] */
export const PROP = 10;

export type LayerKind = 'facade' | 'textured' | 'flat' | 'flatcyl';
export interface LayerDef { key: string; kind: LayerKind; set?: string; tile?: number; tint?: [number, number, number]; rough?: number; collide: boolean; shadow: boolean }

/** Static collider record: [cx, cy, cz, L, W, H, yawDeg]. */
export const COL = 7;

export interface ShellInfo {
  spotIdx: number; mode: string; building: string; cx: number; cy: number; L: number; W: number; yaw: number;
  /** door direction (unit, map frame) and door centre point on the outer wall */
  dx: number; dy: number; doorX: number; doorY: number; H: number;
}
export interface SignInfo { x: number; y: number; z: number; yaw: number; w: number; text: string; board: string; ink: string; edging: string | null }
export interface LightInfo { x: number; y: number; z: number; radius: number }
export interface DriveRoad { pts: number[]; halfWidth: number; highway: boolean; inset: number }
export interface SpotOut extends Spot { /** runtime position (moved to hall centre) */ rx: number; ry: number; fx: number; fy: number; boatOut: number; shell: number }

/** Everything the worker sends back. Arrays of numbers are Float32Array (transferable). */
export interface GenOutput {
  layers: LayerDef[];
  boxes: Record<string, Float32Array>;
  props: Record<string, Float32Array>;
  colliders: Float32Array;
  signs: SignInfo[];
  lights: LightInfo[];
  shells: ShellInfo[];
  spots: SpotOut[];
  // world queries
  footprints: Float32Array; // [cx, cy, L, W, yawDeg, H, overhang, insetIdx] stride 8
  roadSegs: Float32Array;   // [ax, ay, bx, by, halfWidth, style, rank, asphalt?1:0] stride 8 (city roads + highways style -1)
  driveRoads: DriveRoad[];
  walkPoints: Float32Array; // [x, y]
  highwayEnds: number[];    // [x, y] * 6
  mapRoads: Float32Array;   // [ax, ay, bx, by]
  mapBuildings: Float32Array; // 4 corners [x,y]*4 per footprint
  yards: Float32Array;      // [cx, cy, L, W, yawDeg] stride 5
  landforms: Float32Array;  // [cx, cy, L, W, yawDeg, kind 0 box 1 ellipse] stride 6
  stats: Record<string, any>;
}
