// Screenshot any page of this project in headless Chromium (WebGL via SwiftShader).
// Usage: node tools/page-shot.mjs --url /preview/props.html --out tests/screenshots/props.png [--wait 3000] [--w 1280 --h 720]
// Starts its own Vite dev server on a free port, waits for window.__ready === true (or --wait ms), prints console errors.
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
// Git Bash rewrites "/preview/x.html" into a Windows path: pass "preview/x.html" (no leading slash) or undo the rewrite.
const rawUrl = arg('url', '').replace(/\\/g, '/');
const url = '/' + (rawUrl.includes('/preview/') ? rawUrl.slice(rawUrl.indexOf('/preview/') + 1) : rawUrl.replace(/^\/+/, '')), out = arg('out', 'tests/screenshots/page.png');
const wait = +arg('wait', 60000), w = +arg('w', 1280), h = +arg('h', 720);

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: w, height: h } });
let errors = 0;
page.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text()); } else if (process.env.VERBOSE) console.log('[console]', m.text()); });
page.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });
await page.goto(`http://localhost:${port}${url}`);
try { await page.waitForFunction(() => window.__ready === true, null, { timeout: wait }); } catch { console.log('(no __ready, shooting anyway)'); }
await page.waitForTimeout(500);
await page.screenshot({ path: out });
console.log(`PAGE_SHOT ${out} errors=${errors}`);
await browser.close();
await server.close();
