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

/** Live session helpers: start a game, run console commands, read client state. */
export async function startGame(page: Page, extra = '') {
  const probes: Probe[] = [];
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('PROBE ')) probes.push(JSON.parse(t.slice(6))); });
  await page.goto(`${BASE}/?autohost${extra.includes("save=1") ? "" : "&nosave"}&mute&offline&quality=low&seed=7&name=Tester${extra}`);
  await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 300_000 });
  return probes;
}
export async function cmd(page: Page, line: string, waitMs = 600) {
  await page.evaluate((l) => (window as any).__session.con.run(l), line);
  if (waitMs) await page.waitForTimeout(waitMs);
}
export async function client(page: Page) {
  return page.evaluate(() => { const c = (window as any).__session.client; return { director: c.director, priv: c.priv, feed: c.feed.map((f: any) => f.text), spots: [...c.spots.values()] }; });
}
export async function feedSince(page: Page, n: number) { return (await client(page)).feed.slice(n); }
