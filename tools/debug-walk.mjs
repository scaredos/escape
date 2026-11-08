import { createServer } from 'vite';
import { chromium } from '@playwright/test';
const server = await createServer({ server: { port: 0 }, logLevel: 'error' }); await server.listen();
const port = server.httpServer.address().port;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://localhost:${port}/?script=${encodeURIComponent('wait 1;EscTp door:shop;wait 1;EscKey W 3;wait 4')}&nosave&mute&offline&quality=low`);
await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(700);
  console.log(JSON.stringify(await page.evaluate(() => {
    const s = window.__session, sim = s.sim, p = [...sim.players.values()][0], h = p.pawn, c = s.client;
    return { simNow: +sim.now.toFixed(2), lastSeq: p.lastSeq, q: p.inputs.length, last: p.lastInput && { mx: p.lastInput.mx, my: p.lastInput.my, dt: +p.lastInput.dt.toFixed(3) }, host: [+h.ms.x.toFixed(2), +h.ms.y.toFixed(2), +h.ms.z.toFixed(2), +h.ms.vx.toFixed(2), +h.ms.vy.toFixed(2), h.ms.grounded],
      pred: c.ms && [+c.ms.x.toFixed(2), +c.ms.y.toFixed(2), +c.ms.z.toFixed(2)], seq: c.seq, pending: c.pending.length };
  })));
}
await b.close(); await server.close();
