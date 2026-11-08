// Milestone 4: combat, heat, AI (spec 03, 04 §5). Shots near civilians raise heat, soldiers spawn per star out of
// sight, killing a civilian adds heat and pays nothing, hold-ups, death/respawn and the team wipe.
import { test, expect } from '@playwright/test';
import { startGame, cmd, client } from './util';

test.use({ viewport: { width: 640, height: 360 } });

test('combat, heat, soldiers, civilians, death', async ({ page }) => {
  const probes = await startGame(page);
  const has = (ev: string, f: (o: any) => boolean = () => true) => probes.some((o) => o.event === ev && f(o));
  const waitFor = async (ev: string, f: (o: any) => boolean = () => true, ms = 30000) => {
    const end = Date.now() + ms; while (!has(ev, f)) { if (Date.now() > end) throw new Error('no ' + ev); await page.waitForTimeout(250); }
    return probes.filter((o) => o.event === ev && f(o)).at(-1);
  };
  const feed = (t: string | RegExp) => probes.some((o) => o.event === 'feed' && (typeof t === 'string' ? o.text === t : t.test(o.text)));

  // armed, a civilian close by in front; firing raises heat (+12 per 0.25 s window)
  await cmd(page, 'EscTp door:shop', 1200); await cmd(page, 'EscGive pistol', 1000);
  await cmd(page, 'EscSpawn civ 4', 1500);
  for (let i = 0; i < 3; i++) { await cmd(page, 'look 0 60', 100); await cmd(page, 'EscKey LMB 0.05', 500); }
  const shot = await waitFor('heat', (o) => o.reason === 'shot', 8000);
  expect(shot.amount).toBe(12);
  expect(feed('Wanted level 1')).toBe(true);
  expect(has('civilian_panic')).toBe(true);

  // hold-up a fresh civilian (gun in hand, in focus, E)
  await cmd(page, 'EscHeat 0', 300);
  await cmd(page, 'look 0 0', 200); await cmd(page, 'EscSpawn civ 3', 1500);
  await cmd(page, 'EscKey E', 1500);
  const hu = await waitFor('holdup', () => true, 6000);
  expect(hu.amount).toBeGreaterThanOrEqual(20); expect(hu.amount).toBeLessThanOrEqual(300);
  expect(feed(`They hand over ₪${hu.amount}`)).toBe(true);

  // killing a civilian: +100 (or +200 witnessed), never pays, no bag
  await cmd(page, 'EscHeat 0', 300);
  const m0 = (await client(page)).director.money;
  await cmd(page, 'EscSpawn civ 6', 1200); await cmd(page, 'EscKillNear', 1500);
  const kh = await waitFor('heat', (o) => o.reason === 'civilian', 5000);
  expect([100, 200]).toContain(kh.amount);
  expect(feed('A civilian was killed. That never pays.') || feed('A soldier saw you kill a civilian!')).toBe(true);
  expect((await client(page)).director.money).toBe(m0);
  expect((await client(page)).spots.some((s: any) => s.mode === 'bag')).toBe(false);
  expect(has('ragdoll', (o) => o.weapon === 'pistol' && o.magnitude === 7)).toBe(true);

  // soldiers spawn per star, 100-180 m out (hidden when possible)
  await cmd(page, 'God', 200); await cmd(page, 'EscHeat 250', 500);
  await waitFor('spawn', (o) => o.role === 'soldier', 20000);
  await page.waitForTimeout(8000);
  const sp = probes.filter((o) => o.event === 'spawn' && o.role === 'soldier');
  expect(sp.length).toBeGreaterThanOrEqual(3);
  for (const s of sp) { expect(s.dist_m).toBeGreaterThanOrEqual(99); expect(s.dist_m).toBeLessThanOrEqual(181); }
  expect(sp.filter((s) => s.hidden).length).toBeGreaterThan(sp.length / 2);
  await cmd(page, 'shot showui', 800);
  await page.screenshot({ path: 'tests/screenshots/m4_soldiers.png' });

  // break line of sight: clear the hunters, then 1 star inside a venue -> the search bar fills (stars decay)
  await cmd(page, 'EscHeat 0', 4000);
  await cmd(page, 'EscTp shop', 500); await cmd(page, 'EscHeat 100', 300);
  let alpha = 0; const tEnd = Date.now() + 40000;
  while (Date.now() < tEnd && alpha < 0.3) { alpha = (await client(page)).director.searchAlpha; await page.waitForTimeout(500); }
  console.log('searchAlpha reached', alpha, 'decayed', has('heat_decay'));
  expect(alpha).toBeGreaterThanOrEqual(0.3);

  // death -> down message, team wipe (solo), respawn 10 s later at the safehouse
  await cmd(page, 'God', 200); await cmd(page, 'EscMoney 1000', 300);
  const before = (await client(page)).director.money;
  const tDeath = Date.now(); await cmd(page, 'DamageSelfDestruct', 1500);
  expect(feed(/^Tester is down: back at the safehouse in 10 s$/)).toBe(true);
  const lost = Math.floor(before / 4);
  expect(feed(`Everyone is down! Lost ₪${lost.toLocaleString('en-US')}, the heat is off`)).toBe(true);
  expect((await client(page)).director.money).toBe(before - lost);
  await cmd(page, 'shot showui', 600);
  await page.screenshot({ path: 'tests/screenshots/m4_dead.png' });
  await waitFor('respawn', () => true, 20000);
  expect(Date.now() - tDeath).toBeGreaterThan(9000);
  const sp2 = probes.filter((o) => o.event === 'spawn' && o.role === 'human').at(-1);
  expect(sp2.safehouse).toBe('Safehouse (The Postel)');
  expect((await client(page)).priv.weapons.map((w: any) => w.type)).toEqual(['pistol']);   // weapons kept
});
