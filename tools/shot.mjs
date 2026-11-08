// Screenshot harness (spec 05 H18, mirrors game_shot.ps1).
// node tools/shot.mjs --script "EscTp casino;wait 3;shot showui" --out tests/screenshots/x [--w 1280 --h 720] [--extra "&quality=low"]
// Writes <out>_<n>.png per `shot` probe and <out>_probes.json; prints GAME_SHOT OK shots=<n> base=<path> load_s=<s> log_errors=<n>
import { createServer, preview } from 'vite';
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const script = arg('script', 'wait 2;shot showui'), out = arg('out', 'tests/screenshots/game');
const w = +arg('w', 1280), h = +arg('h', 720), timeout = +arg('timeout', 1800) * 1000, extra = arg('extra', '');
const usePreview = process.argv.includes('--dist');

const server = usePreview ? await preview({ preview: { port: 0 }, logLevel: 'error' }) : await createServer({ server: { port: 0 }, logLevel: 'error' });
if (!usePreview) await server.listen();
const port = (usePreview ? server.httpServer : server.httpServer).address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
let errors = 0, shots = 0, done = false, ready = false; const probes = []; const t0 = Date.now(); let loadS = -1;
const pending = [];
page.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });
page.on('console', async (m) => {
  const t = m.text();
  if (m.type() === 'error') { errors++; console.log('[console.error]', t); return; }
  if (!t.startsWith('PROBE ')) { if (process.env.VERBOSE) console.log(t); return; }
  let o; try { o = JSON.parse(t.slice(6)); } catch { return; }
  probes.push(o);
  if (process.env.VERBOSE || ['city_built', 'world_ready', 'script_done', 'tp'].includes(o.event)) console.log(t.slice(0, 400));
  if (o.event === 'world_ready') { ready = true; loadS = (Date.now() - t0) / 1000; }
  if (o.event === 'shot') { const n = o.n; pending.push(page.screenshot({ path: `${out}_${n}.png` }).then(() => { shots++; })); }
  if (o.event === 'script_done') done = true;
});
const url = `http://localhost:${port}/?script=${encodeURIComponent(script)}&nosave&mute${extra}`;
await page.goto(url);
const deadline = Date.now() + timeout;
while (!done && Date.now() < deadline) await page.waitForTimeout(250);
await page.waitForTimeout(2000);
await Promise.all(pending);
fs.writeFileSync(`${out}_probes.json`, JSON.stringify(probes, null, 0));
const stats = await page.evaluate(() => window.__stats).catch(() => null);
console.log(`GAME_SHOT ${done ? 'OK' : 'INCOMPLETE'} shots=${shots} base=${out} load_s=${loadS.toFixed(1)} log_errors=${errors} ready=${ready} stats=${JSON.stringify(stats)}`);
await browser.close();
await (usePreview ? server.close() : server.close());
process.exit(done ? 0 : 1);
