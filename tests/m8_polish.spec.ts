// Milestone 8: front-end, credits, download budget (spec 05 H12-H13, 06 §12).
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { BASE } from './util';

test.use({ viewport: { width: 1280, height: 720 } });

test('main menu, credits, settings and controls', async ({ page }) => {
  await page.goto(BASE + '/');
  await page.waitForSelector('#menu .panel.main', { timeout: 300_000 });
  for (const b of ['Host game', 'Join game', 'Settings', 'Controls', 'How to play', 'Credits']) await expect(page.getByRole('button', { name: b })).toBeVisible();
  await expect(page.locator('#menu')).toContainText('Get rich, get armed, get out. 1-4 friends.');
  await expect(page.locator('#menu .foot')).toContainText('Map data © OpenStreetMap contributors');
  await page.getByRole('button', { name: 'Credits' }).click();
  await expect(page.locator('#menu')).toContainText('Map data (c) OpenStreetMap contributors, ODbL 1.0. Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.');
  await expect(page.locator('#menu')).toContainText('This is a parody for a private group of friends; all businesses, units and people in it are fictional.');
  await expect(page.locator('#menu')).toContainText('Built with Three.js, Rapier and PeerJS.');
  await page.getByRole('button', { name: 'Controls' }).click();
  await expect(page.locator('#menu')).toContainText('sprint ×1.6');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.selectOption('#q', 'low');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('esc.settings') || '{}'));
  expect(saved.quality).toBe('low');
  await page.evaluate(() => localStorage.removeItem('esc.settings'));
  await page.screenshot({ path: 'tests/screenshots/m8_menu.png' });
});

test('production build fits the 6 MB first-load budget', async () => {
  execSync('npx vite build --outDir dist', { stdio: 'ignore' });
  let raw = 0, gz = 0;
  const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else { const b = fs.readFileSync(p); raw += b.length; gz += zlib.gzipSync(b, { level: 9 }).length; } } };
  walk('dist');
  console.log(`dist raw ${(raw / 1e6).toFixed(2)} MB, gzip ${(gz / 1e6).toFixed(2)} MB`);
  expect(gz).toBeLessThan(6e6);
  expect(fs.existsSync('dist/data/world.pack.json')).toBe(true);
  expect(fs.readdirSync('dist').some((f) => f.endsWith('.png'))).toBe(false);
});
