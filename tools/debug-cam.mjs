import { createServer } from 'vite';
import { chromium } from '@playwright/test';
const server = await createServer({ server: { port: 0 }, logLevel: 'error' }); await server.listen();
const port = server.httpServer.address().port;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 480, height: 270 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://localhost:${port}/?script=${encodeURIComponent(process.argv[2])}&nosave&mute&offline&quality=low`);
await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
for (let i = 0; i < +(process.argv[3] || 10); i++) {
  await page.waitForTimeout(1000);
  console.log(JSON.stringify(await page.evaluate(() => {
    const s = window.__session, c = s.client, cam = s.world.stage.camera, me = c.myRecNow(), f = (v) => Math.round(v * 100) / 100;
    return { cam: [f(cam.position.x), f(-cam.position.z), f(cam.position.y)], fov: cam.fov, near: cam.near, me: me && [f(me[2]), f(me[3]), f(me[4]), me[9]], car: c.priv?.car, yaw: f(c.yaw), pitch: f(c.pitch), ms: c.ms && [f(c.ms.x), f(c.ms.y), f(c.ms.z)], camDist: f(c.camDist) };
  })));
}
await b.close(); await server.close();
