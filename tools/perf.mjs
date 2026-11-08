// Frame-time measurement on the real GPU (headless Chromium with D3D11/ANGLE). Prints avg/p95 frame ms, draw calls, tris.
// node tools/perf.mjs [--quality medium] [--dist]
import { createServer, preview } from 'vite';
import { chromium } from '@playwright/test';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const quality = arg('quality', 'medium'), useDist = process.argv.includes('--dist');
const server = useDist ? await preview({ preview: { port: 0 }, logLevel: 'error' }) : await createServer({ server: { port: 0 }, logLevel: 'error' });
if (!useDist) await server.listen();
const port = server.httpServer.address().port;
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', ...(process.argv.includes('--uncapped') ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const script = 'wait 2;EscTp door:job;wait 6;look 120 -5;wait 6;cam 900 1100 150 30 -28;wait 6;cam off;EscTp door:shop;wait 6';
await page.goto(`http://localhost:${port}/?script=${encodeURIComponent(script)}&nosave&mute&offline&quality=${quality}`);
await page.waitForFunction(() => window.__ready, null, { timeout: 300000 });
const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
const samples = [];
for (const label of ['street', 'street2', 'aerial', 'shop']) {
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => new Promise((res) => { const t = []; let last = performance.now(); const f = (n) => { t.push(n - last); last = n; if (t.length < 180) requestAnimationFrame(f); else res({ t, stats: window.__stats }); }; requestAnimationFrame(f); }));
  const s = r.t.slice(10).sort((a, b) => a - b), avg = s.reduce((a, b) => a + b, 0) / s.length, p95 = s[Math.floor(s.length * 0.95)];
  samples.push({ label, avg_ms: +avg.toFixed(2), p95_ms: +p95.toFixed(2), fps: +(1000 / avg).toFixed(1), calls: r.stats.calls, tris: r.stats.tris });
  await page.waitForTimeout(3000);
}
console.log('GPU', gpu); console.table(samples);
await b.close(); await server.close();
