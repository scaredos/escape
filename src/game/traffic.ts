// NPC traffic (spec 04 §12). Filled in at milestone 5.
import type { Sim } from './sim';
import type { Car, Cars } from './cars';
export interface TrafficAI { path: number[] }
export class Traffic {
  frozen = false;
  constructor(public sim: Sim, public cars: Cars) {}
  frame() {}
  count() { return 0; }
  release(_c: Car) {}
}
