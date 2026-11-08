// Milestone 6: hunters and finales (spec 03 §4-§6, §12). Each way out reachable by script, right end card.
import { test, expect } from '@playwright/test';
import { startGame, cmd, client } from './util';
test.use({ viewport: { width: 480, height: 270 } });

async function hold(page: any, probes: any[], ms = 1_500_000) {
  const end = Date.now() + ms;
  while (!probes.some((o) => o.event === 'hud_end_card') && Date.now() < end) await page.waitForTimeout(1000);
}
const feed = (probes: any[], t: string | RegExp) => probes.some((o) => o.event === 'feed' && (typeof t === 'string' ? o.text === t : t.test(o.text)));

test('boat from Jaffa: hold the pier 60 s at 5 stars', async ({ page }) => {
  const probes = await startGame(page);
  await cmd(page, 'God', 200); await cmd(page, 'EscMoney 24500', 300);
  await cmd(page, 'EscTp escape', 1500); await cmd(page, 'EscUse 0', 1500);
  expect(feed(probes, 'Tester bribed the captain (₪15,000). Hold the pier until the boat leaves!')).toBe(true);
  expect(feed(probes, 'Wanted level 5')).toBe(true);
  expect((await client(page)).director.phase).toBe('Finale');
  await page.waitForTimeout(12000);
  expect(feed(probes, 'Helicopter overhead! Stay out of the spotlight.')).toBe(true);
  await cmd(page, 'shot showui', 800); await page.screenshot({ path: 'tests/screenshots/m6_boat_hold.png' });
  await hold(page, probes);
  expect(feed(probes, 'Hold the pier: 50 s')).toBe(true);
  expect(feed(probes, 'ESCAPED by boat from Jaffa with ₪10,000: Comfortable')).toBe(true);
  const ec = probes.find((o) => o.event === 'hud_end_card');
  expect(ec).toMatchObject({ money: 10000, tier: 'Comfortable' });
  await page.waitForTimeout(1500); await page.screenshot({ path: 'tests/screenshots/m6_boat_end.png' });
});

test('plane from Ben Gurion: passport, 0 stars, a star cancels and refunds, then 30 s boarding', async ({ page }) => {
  const probes = await startGame(page);
  await cmd(page, 'God', 200); await cmd(page, 'EscMoney 29500', 300);
  await cmd(page, 'EscTp airport', 1500); await cmd(page, 'EscUse 0', 800);
  expect((await client(page)).director.phase).toBe('Playing');      // info line: passport missing
  await cmd(page, 'EscTp forger', 1500); await cmd(page, 'EscUse 0', 1000);
  await cmd(page, 'EscMoney 5000', 300);
  await cmd(page, 'EscTp airport', 1500); await cmd(page, 'EscUse 0', 1000);
  expect(feed(probes, "Tester bought the tickets (₪25,000). Boarding in 30 s: stay at the gate and don't get wanted!")).toBe(true);
  await cmd(page, 'EscHeat 50', 1500);
  expect(feed(probes, "Boarding cancelled: you're wanted! Tickets refunded (₪25,000). Lose the stars and try again")).toBe(true);
  expect((await client(page)).director.money).toBe(30000);
  await cmd(page, 'EscHeat 0', 800); await cmd(page, 'EscUse 0', 1000);
  expect((await client(page)).director.phase).toBe('Finale');
  await cmd(page, 'shot showui', 800); await page.screenshot({ path: 'tests/screenshots/m6_airport_boarding.png' });
  await hold(page, probes);
  expect(feed(probes, 'Boarding: 20 s')).toBe(true);
  expect(feed(probes, 'ESCAPED on a plane from Ben Gurion with ₪5,000: Broke')).toBe(true);
  expect(probes.find((o) => o.event === 'hud_end_card')).toMatchObject({ money: 5000, tier: 'Broke' });
});

test('southern border at Eilat: ₪10,000 for the crew, hold 90 s at 5 stars', async ({ page }) => {
  const probes = await startGame(page);
  await cmd(page, 'God', 200); await cmd(page, 'EscMoney 69500', 300);
  await cmd(page, 'EscTp crossing', 1500); await cmd(page, 'EscUse 0', 1500);
  expect(feed(probes, 'Tester paid the smugglers (₪10,000). Hold the border for 90 s until the truck comes!')).toBe(true);
  await page.waitForTimeout(15000);
  await cmd(page, 'shot showui', 800); await page.screenshot({ path: 'tests/screenshots/m6_border_hold.png' });
  await hold(page, probes, 900_000);
  expect(feed(probes, 'Hold the border: 80 s')).toBe(true);
  expect(feed(probes, 'ESCAPED over the southern border with ₪60,000: Kingpin')).toBe(true);
  expect(probes.find((o) => o.event === 'hud_end_card')).toMatchObject({ money: 60000, tier: 'Kingpin' });
  expect(probes.some((o) => o.event === 'roadblock_spawn' || o.event === 'hunter_tank' || o.event === 'hunter_heli')).toBe(true);
  await page.waitForTimeout(1500); await page.screenshot({ path: 'tests/screenshots/m6_border_end.png' });
});
