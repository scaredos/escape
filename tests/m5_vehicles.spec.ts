// Milestone 5: vehicles and traffic (spec 04 §6-§12).
import { test, expect } from '@playwright/test';
import { startGame, cmd, client } from './util';
test.use({ viewport: { width: 640, height: 360 } });

test('enter/exit with F, top speed ~95 km/h, traffic keeps moving, carjack spawns a fleeing civilian', async ({ page }) => {
  const probes = await startGame(page);
  const all = (ev: string) => probes.filter((o) => o.event === ev);
  expect(all('vehicles_parked').reduce((a, o) => a + o.count, 0)).toBeGreaterThanOrEqual(52);   // 40 + 6 ends x 3 (some ends crowded)

  // get in and out through the real key path
  await cmd(page, 'EscCar walk', 1500);
  await cmd(page, 'EscReport', 300);
  expect(all('report2').at(-1)!.near_car).toBe(true);
  await cmd(page, 'EscKey F', 1500);
  expect(all('vehicle_enter').length).toBe(1);
  await cmd(page, 'shot showui', 800); await page.screenshot({ path: 'tests/screenshots/m5_seated.png' });
  await cmd(page, 'EscKey F', 1500);
  expect(all('vehicle_exit').at(-1)!.alive).toBe(true);
  expect((await client(page)).priv.car).toBe(-1);

  // top speed on a straight of Highway 90 (heading south)
  await cmd(page, 'EscTp xy:5575,-2620', 1200); await cmd(page, 'EscCar spawn -91 sedan', 800);
  let top = 0;
  for (let i = 0; i < 9; i++) { await cmd(page, 'EscDrive 1 0', 2000); top = Math.max(top, all('cheat_drive').at(-1)!.speed_kmh); }
  console.log('top speed', top);
  await page.screenshot({ path: 'tests/screenshots/m5_highway.png' });
  expect(top).toBeGreaterThan(80); expect(top).toBeLessThan(97);
  await cmd(page, 'EscDrive -1 0', 3000); await cmd(page, 'EscDrive', 300); await cmd(page, 'EscKey F', 1000);

  // traffic around the player keeps moving for 3 minutes
  await cmd(page, 'EscTp door:job', 1000);
  await page.waitForTimeout(185000);
  const counts = all('traffic_count');
  console.log('traffic', JSON.stringify(counts.map((c) => [c.cars, c.moving])));
  expect(counts.length).toBeGreaterThanOrEqual(5);
  const late = counts.slice(-5);
  for (const c of late) expect(c.cars).toBeGreaterThanOrEqual(10);
  expect(late.reduce((a, c) => a + c.moving, 0) / late.reduce((a, c) => a + c.cars, 0)).toBeGreaterThan(0.6);

  // carjack
  await cmd(page, 'EscCar traffic', 2500);
  await cmd(page, 'shot showui', 800); await page.screenshot({ path: 'tests/screenshots/m5_carjack_before.png' });
  await cmd(page, 'EscKey F', 2000);
  const cj = all('carjack').at(-1);
  expect(cj).toBeTruthy();
  expect(all('civilian_spawn_at').some((o) => o.ok && o.flee)).toBe(true);
  expect((await client(page)).priv.car).toBe(cj!.car);
  await cmd(page, 'EscTraffic go', 300);
});
