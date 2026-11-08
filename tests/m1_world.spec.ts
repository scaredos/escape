// Milestone 1: data and world (spec 01). Counts in line with the Unreal build, build time, look screenshots.
import { test, expect } from '@playwright/test';
import { runScript, last } from './util';

test('world builds with the spec counts and looks right from the air', async ({ page }) => {
  const script = [
    'wait 1', 'cam 900 1100 150 30 -28', 'wait 2', 'shot showui', 'wait 1',
    'cam 5600 -1900 130 40 -30', 'wait 3', 'shot', 'wait 1',
    'cam 2950 6450 110 20 -24', 'wait 3', 'shot', 'wait 1',
    'cam 4300 -12900 170 70 -26', 'wait 3', 'shot', 'wait 1',
    'cam 1520 1180 1.7 0 3', 'wait 3', 'shot', 'wait 1', 'cam off',
  ].join(';');
  const p = await runScript(page, script, { shots: 'm1' });
  const cb = last(p, 'city_built')!;
  expect(cb).toBeTruthy();
  expect(cb.buildings).toBeGreaterThan(10300); expect(cb.buildings).toBeLessThan(10500);   // ref 10436
  expect(cb.shells).toBe(19);
  expect(cb.building_overlaps).toBe(0);
  expect(cb.highways).toBe(3);
  expect(cb.ground_boxes).toBeGreaterThan(2900); expect(cb.ground_boxes).toBeLessThan(3200); // ref 3034
  expect(cb.drive_roads).toBeGreaterThan(2500);                                              // ref 2686
  expect(cb.walk_points).toBeGreaterThan(9500); expect(cb.walk_points).toBeLessThan(10400);  // ref 9931
  expect(cb.cranes).toBe(6);
  expect(cb.port_yards).toBeGreaterThan(100);
  expect(cb.hills).toBeGreaterThan(500);
  expect(cb.scatter).toBeGreaterThan(50000);
  expect(cb.insets.telaviv.buildings).toBe(2763); expect(cb.insets.jerusalem.buildings).toBe(4180);
  expect(cb.ms).toBeLessThan(5000);   // generation in the worker < 5 s
  const ready = last(p, 'world_ready')!;
  expect(ready.host).toBe(true);
  console.log('city_built ms', cb.ms, 'total', cb.ms_total, 'draw_calls', ready.draw_calls);
});
