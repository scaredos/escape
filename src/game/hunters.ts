// Helicopter, tank, roadblocks (spec 03 §4-§6). Filled in at milestone 6.
import type { Sim } from './sim';
import type { EntRec } from './protocol';
export class Hunters {
  roadblocks: { x: number; y: number; yaw: number; highway: string }[] = [];
  constructor(public sim: Sim) {}
  frame(_dt: number) {}
  tick() {}
  records(_out: EntRec[]) {}
  roadblockRecs(): number[][] { return this.roadblocks.map((r) => [r.x, r.y, r.yaw]); }
}
