// Deterministic world generation entry (spec 01 §5). Pure: no DOM, no three, no Math.random.
import type { GenOutput, Pack } from '../types';
import { Gen } from './ctx';
import { buildCity } from './city';
import { buildDressing } from './dress';

export function generateWorld(pack: Pack, onProgress?: (f: number, label: string) => void): GenOutput {
  const t0 = performance.now();
  const g = new Gen(pack);
  onProgress?.(0.05, 'city');
  buildCity(g);
  onProgress?.(0.5, 'dressing');
  buildDressing(g);
  g.stats.ms = Math.round(performance.now() - t0);
  onProgress?.(1, 'done');
  return g.output();
}
