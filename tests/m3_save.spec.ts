// Host save (spec 02 §7): money and spot cooldowns survive a reload; "Welcome back" broadcast.
import { test, expect } from '@playwright/test';
import { startGame, cmd, client } from './util';
test.use({ viewport: { width: 480, height: 270 } });
test('save and load', async ({ page }) => {
  await page.goto('http://localhost:5179/'); await page.evaluate(() => localStorage.removeItem('esc.save.v1'));
  let probes = await startGame(page, '&save=1');
  await page.waitForTimeout(1500);
  await cmd(page, 'EscMoney 1000'); await cmd(page, 'EscTp crate', 1200); await cmd(page, 'EscUse 0', 1000);
  const money = (await client(page)).director.money;
  await cmd(page, 'EscSave', 800);
  expect(probes.some((o) => o.event === 'save_written' && o.reason === 'cheat')).toBe(true);
  probes = await startGame(page, '&save=1');
  await page.waitForTimeout(2500);
  const loaded = probes.find((o) => o.event === 'save_loaded');
  expect(loaded?.money).toBe(money);
  expect((await client(page)).director.money).toBe(money);
  expect(probes.some((o) => o.event === 'feed' && o.text === `Welcome back - progress loaded (₪${money.toLocaleString('en-US')})`)).toBe(true);
  expect((await client(page)).spots.filter((s: any) => s.mode === 'crate' && !s.available).length).toBe(1);
  await page.evaluate(() => localStorage.removeItem('esc.save.v1'));
});
