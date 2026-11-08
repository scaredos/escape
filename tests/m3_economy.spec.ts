// Milestone 3: interaction and economy (spec 02). Every spot mode gives the exact messages and wallet changes.
import { test, expect } from '@playwright/test';
import { startGame, cmd, client, type Probe } from './util';

test.use({ viewport: { width: 640, height: 360 } });

test('every spot mode: exact messages and wallet changes', async ({ page }) => {
  const probes = await startGame(page);
  const feed = () => probes.filter((o) => o.event === 'feed').map((o) => o.text as string);
  const money = async () => (await client(page)).director.money as number;
  const expectFeed = async (re: RegExp | string, ms = 4000) => {
    const end = Date.now() + ms;
    for (;;) {
      const f = feed(); const hit = f.find((t) => (typeof re === 'string' ? t === re : re.test(t)));
      if (hit) return hit;
      if (Date.now() > end) throw new Error(`feed never showed ${re}; last: ${JSON.stringify(f.slice(-5))}`);
      await page.waitForTimeout(200);
    }
  };
  expect(await money()).toBe(500);

  // Stash: pistol when unarmed, then it closes for 60 s
  await cmd(page, 'EscTp stash', 1200); await cmd(page, 'EscUse 0', 1000);
  await expectFeed('You found a pistol in the stash');
  expect((await client(page)).priv.weapons.map((w: any) => w.type)).toEqual(['pistol']);
  expect(await money()).toBe(500);

  // Crate: ₪50-300
  await cmd(page, 'EscTp crate', 1200); const m0 = await money(); await cmd(page, 'EscUse 0', 1000);
  const crate = await expectFeed(/^You found ₪[\d,]+ in the crate$/);
  const found = +crate.match(/₪([\d,]+)/)![1].replace(/,/g, '');
  expect(found).toBeGreaterThanOrEqual(50); expect(found).toBeLessThanOrEqual(300);
  expect(await money()).toBe(m0 + found);
  expect((await client(page)).spots.find((s: any) => s.label === 'Crate' && !s.available)).toBeTruthy();

  // Shop: not enough money, then buys, ammo, armour, lay low
  await cmd(page, 'EscTp shop', 1200); await cmd(page, 'EscUse 2', 800);
  await expectFeed('Not enough money (₪10,000)');
  await cmd(page, 'EscMoney 40000', 800); let m = await money();
  await cmd(page, 'EscUse 1', 800); await expectFeed('Bought: Shotgun'); expect(await money()).toBe(m - 6000); m -= 6000;
  await cmd(page, 'EscUse 3', 800); await expectFeed('Ammo refilled'); expect(await money()).toBe(m - 200); m -= 200;
  let pv = (await client(page)).priv;
  expect(pv.weapons.map((w: any) => w.type)).toEqual(['pistol', 'shotgun']);
  expect(pv.weapons[0].spare).toBe(36 + 60);
  await cmd(page, 'EscUse 4', 800); await expectFeed('Plate carrier on (lost if you die)'); expect(await money()).toBe(m - 8000); m -= 8000;
  expect((await client(page)).priv.armor).toBe(0.5);
  await cmd(page, 'EscHeat 150', 800); await expectFeed('Wanted level 2');
  await cmd(page, 'EscUse 5', 800); await expectFeed('Tester paid to lay low: -1 star');
  expect(await money()).toBe(m - 2000); m -= 2000;
  expect((await client(page)).director.heat).toBeCloseTo(50, 0);
  await cmd(page, 'EscHeat 0', 300);

  // Casino
  await cmd(page, 'EscTp casino', 1200); m = await money();
  await cmd(page, 'EscUse 0', 800); const slot = await expectFeed(/^Slots: \[(7 \| 7 \| 7|BAR \| BAR \| BAR|CHERRY \| CHERRY \| CHERRY|LEMON \| BELL \| 7|CHERRY \| LEMON \| BAR|BELL \| BAR \| LEMON)\] - (you win ₪[\d,]+!|no luck)$/);
  const win = slot.includes('win') ? +slot.match(/win ₪([\d,]+)/)![1].replace(/,/g, '') : 0;
  expect(await money()).toBe(m - 200 + win); m = m - 200 + win;
  await cmd(page, 'EscUse 1', 800); const rou = await expectFeed(/^Roulette: (red! You win ₪2,000|black\. The house wins)$/);
  expect(await money()).toBe(m - 1000 + (rou.startsWith('Roulette: red') ? 2000 : 0));
  await cmd(page, 'EscHeat 50', 500); await cmd(page, 'EscUse 0', 600);
  expect(feed().filter((t) => t.startsWith('Slots')).length).toBe(1);   // closed while wanted: no second play
  await cmd(page, 'EscHeat 0', 300);

  // McShekel's: start, a correct order (+₪80), a wrong one
  await cmd(page, 'EscTp job', 1200); await cmd(page, 'EscUse 0', 800); await expectFeed('Shift started: 5 orders in 90 s');
  pv = (await client(page)).priv; expect(pv.jobOrdersLeft).toBe(5); expect(pv.jobOrder.length).toBe(3);
  for (const f of pv.jobOrder) await cmd(page, `EscUse ${f}`, 500);
  m = await money(); await cmd(page, 'EscUse 4', 800); await expectFeed('Order up! +₪80'); expect(await money()).toBe(m + 80);
  await cmd(page, 'EscUse 4', 800); await expectFeed('Wrong order: no pay');
  expect((await client(page)).priv.jobOrdersLeft).toBe(3);

  // Delivery to the nearest other city (Haifa), then deliver it there
  await cmd(page, 'EscTp delivery', 1200); await cmd(page, 'EscUse 0', 800);
  await expectFeed('Package for Haifa - Carmel Cargo & Courier: get it there within 5:57 for ₪3,300');
  await cmd(page, 'EscTp delivery:haifa', 1500); m = await money(); await cmd(page, 'EscUse 0', 1000);
  await expectFeed('Tester delivered a package to Carmel Cargo & Courier: +₪3,300'); expect(await money()).toBe(m + 3300);

  // Forger
  await cmd(page, 'EscTp forger', 1500); m = await money(); await cmd(page, 'EscUse 0', 1000);
  await expectFeed('Tester bought a forged passport'); expect(await money()).toBe(m - 5000);
  expect((await client(page)).priv.passport).toBe(true);

  // Bank heist -> bag -> fence
  await cmd(page, 'EscTp bank', 1500); await cmd(page, 'EscUse 0', 1000);
  await expectFeed('Tester is robbing Jaffa Savings Bank! Stay within 25 m of the vault for 40 s');
  expect((await client(page)).director.heat).toBeGreaterThanOrEqual(300);
  await cmd(page, 'God', 200);
  const open = await expectFeed(/^The vault at Jaffa Savings Bank is open: grab the cash bag \(₪[\d,]+\)!$/, 60000);
  const cash = +open.match(/₪([\d,]+)/)![1].replace(/,/g, '');
  expect(cash).toBeGreaterThanOrEqual(20000); expect(cash).toBeLessThanOrEqual(50000);
  await cmd(page, 'EscUse 0', 1000);
  await expectFeed(`Tester grabbed the cash bag (₪${cash.toLocaleString('en-US')}): fence it at the shop`);
  expect((await client(page)).priv.bag).toBe(cash);
  await cmd(page, 'EscHeat 0', 300);
  await cmd(page, 'EscTp shop', 1500); m = await money();
  // lines: pistol, shotgun, rifle, ammo, plate carrier (info: wearing one), fence  (no lay-low line at 0 stars)
  await cmd(page, 'EscUse 5', 1000);
  await expectFeed(`Tester fenced the cash bag: +₪${cash.toLocaleString('en-US')}`); expect(await money()).toBe(m + cash);
  await page.screenshot({ path: 'tests/screenshots/m3_end.png' });
  const p: Probe[] = probes;
  expect(p.some((o) => o.event === 'heist_done' && o.ok)).toBe(true);
});
