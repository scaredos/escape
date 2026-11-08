// Two-player net test (spec 05 H18, mirrors net_test.ps1): local PeerJS server, host + client browser contexts.
// Prints NET_TEST OK|INCOMPLETE shots=<n> ...; asserts the client's last report.money === 3500 (shared wallet).
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const peer = spawn(process.execPath, ['node_modules/peer/dist/bin/peerjs.js', '--port', '9000', '--key', 'peerjs', '--path', '/'], { stdio: 'ignore' });
const server = await createServer({ server: { port: 0 }, logLevel: 'error' }); await server.listen();
const port = server.httpServer.address().port, base = `http://localhost:${port}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const room = 'NETT', common = `&peerhost=localhost&peerport=9000&nosave&mute&quality=low`;
const watch = (page, tag, sink) => page.on('console', (m) => {
  const t = m.text(); if (m.type() === 'error') console.log(`[${tag} error]`, t);
  if (t.startsWith('PROBE ')) { const o = JSON.parse(t.slice(6)); sink.push(o); if (['world_ready', 'room_open', 'script_done', 'report', 'feed'].includes(o.event)) console.log(tag, t.slice(6, 220)); }
});
const hostP = [], cliP = [];
const host = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage(); watch(host, 'HOST', hostP);
await host.goto(`${base}/?host=1&room=${room}${common}&name=Host&script=${encodeURIComponent('wait 10;EscMoney 3000;wait 40')}`);
const until = async (arr, ev, ms) => { const end = Date.now() + ms; while (!arr.some((o) => o.event === ev) && Date.now() < end) await host.waitForTimeout(250); return arr.some((o) => o.event === ev); };
await until(hostP, 'room_open', 300000);
const cli = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage(); watch(cli, 'CLIENT', cliP);
let shots = 0;
cli.on('console', async (m) => { if (m.text().startsWith('PROBE {"event":"shot"')) { shots++; await cli.screenshot({ path: `tests/screenshots/net_client_${shots}.png` }); } });
await cli.goto(`${base}/?join=${room}${common}&name=Friend&script=${encodeURIComponent('wait 8;shot showui;wait 1;EscReport;wait 6;EscReport;shot showui;wait 1')}`);
const done = await until(cliP, 'script_done', 900000);
const reps = cliP.filter((o) => o.event === 'report'), money = reps.at(-1)?.money;
const ok = done && money === 3500;
console.log(`NET_TEST ${ok ? 'OK' : 'INCOMPLETE'} shots=${shots} client_money=${money} humans=${reps.at(-1)?.humans} host_probes=${hostP.length} client_probes=${cliP.length}`);
await browser.close(); await server.close(); peer.kill();
process.exit(ok ? 0 : 1);
