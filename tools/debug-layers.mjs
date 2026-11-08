import { createServer } from 'vite';
import { chromium } from '@playwright/test';
const server = await createServer({ server: { port: 0 }, logLevel: 'error' }); await server.listen();
const port = server.httpServer.address().port;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 480, height: 270 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://localhost:${port}/?script=${encodeURIComponent(process.argv[2])}&nosave&mute&offline&quality=low`);
await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
await page.waitForTimeout(+(process.argv[3] || 8000));
console.log(JSON.stringify(await page.evaluate(() => {
  const s = window.__session, v = s.world.view, cam = s.world.stage.camera, c = s.client, me = c.myRecNow(); const ent = me && c.entities.ents.get(me[0]);
  const sn = c.snaps; const ir = c.interpolate(c.hostNow() - 0.1).get(me[0]);
  const f0 = s.frameMs.length; const st = window.__stats;
  const dbg = { frames: f0, stats: st, ended: s.ended, snapN: sn.length, firstHt: sn[0].ht, lastHt: sn.at(-1).ht, hostNow: c.hostNow(), offset: c.offset, ir: ir && ir.slice(0, 6), me, root: ent && [ent.root.position.toArray(), ent.root.quaternion.toArray(), ent.rag ? 1 : 0], ms: c.ms, camq: cam.quaternion.toArray(), fog: s.world.stage.scene.fog.density };
  const out = {};
  for (const c of v.chunks) { const n = c.obj.name; if (!['lot', 'asphalt', 'beige', 'fields', 'desert', 'paving', 'facade'].includes(n)) continue;
    const d = Math.round(Math.hypot(c.cx - cam.position.x, c.cy + cam.position.z));
    (out[n] ??= []).push([d, c.obj.visible ? 1 : 0, c.obj.count, c.obj.material.uuid.slice(0, 4), c.obj.frustumCulled]); }
  for (const k in out) out[k] = out[k].sort((a, b) => a[0] - b[0]).slice(0, 2);
  const info = s.world.stage.renderer.info;
  return { dbg, programs: info.programs.length, cam: [cam.position.x, cam.position.y, cam.position.z].map(Math.round) };
})));
await page.screenshot({ path: 'tests/screenshots/dbgl.png' });
await b.close(); await server.close();
