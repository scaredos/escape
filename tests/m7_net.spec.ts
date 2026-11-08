// Milestone 7: multiplayer over PeerJS (spec 05 H15-H16) with a local PeerJS server.
import { test, expect, type Page, type Browser } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { BASE } from './util';

let peer: ChildProcess;
test.beforeAll(async () => {
  peer = spawn(process.execPath, ['node_modules/peer/dist/bin/peerjs.js', '--port', '9000', '--key', 'peerjs', '--path', '/'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
});
test.afterAll(() => { peer?.kill(); });

const COMMON = '&peerhost=localhost&peerport=9000&nosave&mute&quality=low';
async function open(browser: Browser, url: string, size = { width: 480, height: 270 }) {
  const page = await (await browser.newContext({ viewport: size })).newPage();
  const probes: any[] = [];
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('PROBE ')) probes.push(JSON.parse(t.slice(6))); });
  await page.goto(url);
  return { page, probes };
}
const waitProbe = async (page: Page, probes: any[], ev: string, f: (o: any) => boolean = () => true, ms = 300_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const o = probes.find((p) => p.event === ev && f(p)); if (o) return o; await page.waitForTimeout(250); }
  throw new Error('timeout waiting for ' + ev);
};
const state = (page: Page) => page.evaluate(() => {
  const s = (window as any).__session, c = s.client, snap = c.snaps.at(-1)?.recs as Map<number, number[]>;
  const ids = (t: number) => snap ? [...snap.values()].filter((r) => r[1] === t).map((r) => r[0]).sort((a, b) => a - b) : [];
  return { money: c.director?.money, stars: c.director?.stars, cars: ids(4), civs: ids(3), humans: ids(1), priv: c.priv, spots: [...c.spots.values()].filter((x: any) => x.mode === 'bag').length, playerId: c.playerId };
});
const run = (page: Page, line: string) => page.evaluate((l) => (window as any).__session.con.run(l), line);

test('host + clients: shared wallet, stars, NPCs, cars; client drives; disconnect drops the bag; 4-player cap', async ({ browser }) => {
  const host = await open(browser, `${BASE}/?host=1&room=NETT${COMMON}&name=Host`);
  await waitProbe(host.page, host.probes, 'room_open');
  await waitProbe(host.page, host.probes, 'world_ready');
  const cli = await open(browser, `${BASE}/?join=NETT${COMMON}&name=Friend`);
  await waitProbe(cli.page, cli.probes, 'world_ready');
  expect(host.probes.some((p) => p.event === 'feed' && p.text === 'Friend joined')).toBe(true);
  await cli.page.waitForTimeout(3000);

  // shared wallet and stars
  await run(host.page, 'EscMoney 3000'); await run(host.page, 'EscHeat 150');
  await cli.page.waitForTimeout(2500);
  const [h1, c1] = [await state(host.page), await state(cli.page)];
  expect(c1.money).toBe(3500); expect(h1.money).toBe(3500);
  expect(c1.stars).toBe(2); expect(h1.stars).toBe(2);
  // same cars (always relevant) and the same civilians around (both start at the Postel)
  expect(c1.cars).toEqual(h1.cars);
  expect(c1.humans.length).toBe(2);
  const common = c1.civs.filter((id: number) => h1.civs.includes(id));
  expect(common.length).toBeGreaterThanOrEqual(Math.min(3, h1.civs.length));
  await cli.page.screenshot({ path: 'tests/screenshots/m7_client.png' });
  await run(host.page, 'EscHeat 0');

  // the client drives a car (host simulates it from the client's carInput)
  await run(cli.page, 'EscCar'); await cli.page.waitForTimeout(2500);
  const carId = (await state(cli.page)).priv.car;
  expect(carId).toBeGreaterThan(0);
  const pos0 = await host.page.evaluate((id) => { const c = (window as any).__session.sim.cars.cars.get(id); return [c.x, c.y, c.driver?.name]; }, carId);
  expect(pos0[2]).toBe('Friend');
  await run(cli.page, 'EscDrive -1 0'); await cli.page.waitForTimeout(4000); await run(cli.page, 'EscDrive');
  const pos1 = await host.page.evaluate((id) => { const c = (window as any).__session.sim.cars.cars.get(id); return [c.x, c.y]; }, carId);
  expect(Math.hypot(pos1[0] - pos0[0], pos1[1] - pos0[1])).toBeGreaterThan(2);
  await run(cli.page, 'EscKey F'); await cli.page.waitForTimeout(1500);

  // more players up to the cap of 4, the 5th is refused
  const c2 = await open(browser, `${BASE}/?join=NETT${COMMON}&name=Third&norender`);
  const c3 = await open(browser, `${BASE}/?join=NETT${COMMON}&name=Fourth&norender`);
  await waitProbe(c2.page, c2.probes, 'world_ready'); await waitProbe(c3.page, c3.probes, 'world_ready');
  expect((await state(host.page)).humans.length).toBe(4);
  const c4 = await open(browser, `${BASE}/?join=NETT${COMMON}&name=Fifth&norender`);
  await c4.page.waitForURL(/msg=Room%20full/, { timeout: 300_000 });
  await c2.page.close(); await c3.page.close();

  // a carried bag drops when the client disconnects
  await run(host.page, `EscBagFor Friend 25000`); await cli.page.waitForTimeout(1500);
  expect((await state(cli.page)).priv.bag).toBe(25000);
  await cli.page.close();
  await waitProbe(host.page, host.probes, 'feed', (p) => p.text === 'Friend left', 30_000);
  await waitProbe(host.page, host.probes, 'bag_drop', (p) => p.value === 25000, 30_000);
  expect(host.probes.some((p) => p.event === 'feed' && p.text === 'A bag was dropped!')).toBe(true);
  expect((await state(host.page)).spots).toBe(1);
});
