// Test helpers: run a ?script= in the game and collect PROBE events (spec 05 H18).
import type { Page } from '@playwright/test';
export const BASE = 'http://localhost:5179';
export type Probe = { event: string; [k: string]: any };
export async function runScript(page: Page, script: string, opts: { extra?: string; shots?: string; timeout?: number } = {}): Promise<Probe[]> {
  const probes: Probe[] = []; let done = false, n = 0; const shots: Promise<unknown>[] = [];
  page.on('console', (m) => {
    const t = m.text(); if (!t.startsWith('PROBE ')) return;
    const o = JSON.parse(t.slice(6)); probes.push(o);
    if (o.event === 'shot' && opts.shots) shots.push(page.screenshot({ path: `tests/screenshots/${opts.shots}_${++n}.png` }));
    if (o.event === 'script_done') done = true;
  });
  await page.goto(`${BASE}/?script=${encodeURIComponent(script)}&nosave&mute&offline&quality=low&seed=7${opts.extra ?? ''}`);
  const end = Date.now() + (opts.timeout ?? 600_000);
  while (!done && Date.now() < end) await page.waitForTimeout(250);
  await Promise.all(shots);
  if (!done) throw new Error('script did not finish; last probes: ' + JSON.stringify(probes.slice(-5)));
  return probes;
}
export const find = (p: Probe[], ev: string) => p.filter((o) => o.event === ev);
export const last = (p: Probe[], ev: string) => find(p, ev).at(-1);
