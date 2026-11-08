// Milestone 2: on foot (spec 04 §2-§3). Walk down a street into a venue, sprint x1.6, animated characters.
import { test, expect } from '@playwright/test';
import { runScript, find, last } from './util';

test.use({ viewport: { width: 640, height: 360 } });
test('walk from the street into the shop, sprint is x1.6, characters animate', async ({ page }) => {
  const script = [
    'wait 1', 'EscTp door:shop', 'wait 1', 'EscReport',
    'EscKey W 3', 'wait 2', 'EscReport', 'shot showui', 'wait 1.5',             // walk (speed sampled while held)
    'EscKey LeftShift 3', 'EscKey W 3', 'wait 2', 'EscReport', 'wait 1.5',      // sprint
    'EscKey W 4', 'wait 4.5', 'EscReport', 'look 180 -10', 'wait 1', 'shot showui', 'wait 1',
  ].join(';');
  const p = await runScript(page, script, { shots: 'm2' });
  const reps = find(p, 'report'), r2 = find(p, 'report2');
  expect(last(p, 'tp')!.ok).toBe(true);
  const start = reps[0], walked = reps[1], fin = reps[3];
  const shop = { x: 1531.3, y: 1260 };
  const d0 = Math.hypot(start.x - shop.x, start.y - shop.y), d3 = Math.hypot(fin.x - shop.x, fin.y - shop.y);
  console.log('dist to shop', d0.toFixed(1), '->', d3.toFixed(1), 'walk speed', r2[1].max_walk, 'sprint speed', r2[2].max_walk);
  expect(Math.hypot(walked.x - start.x, walked.y - start.y)).toBeGreaterThan(4);   // walked down the street
  expect(d0).toBeGreaterThan(30);                                                   // started outside (door wall ~28.5 m from the centre)
  expect(d3).toBeLessThan(27);                                                      // ended inside the hall, through the door gap
  const sp = find(p, 'sprint').filter((o) => o.on);
  expect(sp.length).toBeGreaterThan(0);
  expect(sp[0].max_walk).toBeCloseTo(9.6, 1);
  expect(r2[2].max_walk).toBeGreaterThan(9.0);                                      // measured sprint speed
  expect(r2[1].max_walk).toBeGreaterThan(5.5); expect(r2[1].max_walk).toBeLessThan(6.5);
});
