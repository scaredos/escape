// Boot + front-end: main menu (Host / Join / Settings / Controls / How to play / Credits), then a Session.
import { Stage, type Quality } from './render/stage';
import { bootWorld, Session, CONTROLS_HTML } from './app';
import { readSave, deleteSave } from './game/save';
import { PROTOCOL_V, BUILD_ID, shekels } from './game/protocol';
import { probe } from './core/probe';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
app.innerHTML = `<canvas id="gl"></canvas><div id="boot"><div class="t">Escape Israel</div><div class="bar"><i></i></div><div class="l">Loading Israel… 0%</div></div><div id="menu" style="display:none"></div>`;
const bootEl = app.querySelector('#boot') as HTMLElement, bootBar = bootEl.querySelector('i') as HTMLElement, bootLbl = bootEl.querySelector('.l') as HTMLElement;
const setBoot = (f: number) => { bootBar.style.width = (f * 100).toFixed(0) + '%'; bootLbl.textContent = `Loading Israel… ${Math.round(f * 100)}%`; };

interface Settings { quality: Quality | 'auto'; sens: number; fov: number; volume: number; fps: boolean }
function loadSettings(): Settings {
  const d: Settings = { quality: 'auto', sens: 0.1, fov: 80, volume: 80, fps: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem('esc.settings') || '{}') }; } catch { return d; }
}
function saveSettings(s: Settings) { try { localStorage.setItem('esc.settings', JSON.stringify(s)); } catch { /* */ } }
const settings = loadSettings();
function autoQuality(stage?: Stage): Quality {
  const qp = params.get('quality') as Quality | null; if (qp) return qp;
  if (settings.quality !== 'auto') return settings.quality;
  try {
    const gl = document.createElement('canvas').getContext('webgl2'); const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const r = dbg ? String(gl!.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (/SwiftShader|llvmpipe/i.test(r) || (navigator.hardwareConcurrency || 8) <= 4) return 'low';
  } catch { /* */ }
  void stage; return 'medium';
}
function getName(): string {
  let n = params.get('name') || ''; try { n ||= localStorage.getItem('esc.name') || ''; } catch { /* */ }
  return (n || `Player-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`).slice(0, 16);
}

const quality = autoQuality();
const stage = new Stage(app.querySelector('#gl') as HTMLCanvasElement, quality);
stage.camera.position.set(1100, 140, -1100); stage.camera.lookAt(1300, 0, -1300);
let session: Session | null = null;
const worldP = bootWorld(stage, quality, setBoot);
// idle menu backdrop: slowly orbit over Tel Aviv while the menu is up
let orbit = 0; const idle = (t: number) => { if (session) return; orbit = t / 1000; stage.camera.position.set(1200 + Math.cos(orbit * 0.03) * 500, 160, -1100 - Math.sin(orbit * 0.03) * 500); stage.camera.lookAt(1200, 0, -1200);
  worldP.then((w) => w.view.update(stage.camera.position.x, -stage.camera.position.z)); stage.frame(t / 1000); requestAnimationFrame(idle); };

async function start(mode: 'host' | 'join', room?: string, fresh = false) {
  const menu = app.querySelector('#menu') as HTMLElement;
  menu.style.display = 'none'; bootEl.style.display = 'flex';
  const world = await worldP;
  bootLbl.textContent = mode === 'join' ? 'Connecting…' : 'Starting…';
  session = new Session(world, { mode, name: getName(), room, params, fresh, onExit: (msg) => { location.href = location.pathname + (msg ? '?msg=' + encodeURIComponent(msg) : ''); } });
  try { await session.start(); } catch (e: any) { location.href = location.pathname + '?msg=' + encodeURIComponent(e.message || String(e)); return; }
  session.client.sens = settings.sens; session.client.fovFoot = settings.fov; session.audio.setVolume(params.has('mute') ? 0 : settings.volume / 100);
  bootEl.style.display = 'none';
  if (!params.has('script')) stage.canvas.requestPointerLock?.();
}

function showMenu(note = '') {
  const menu = app.querySelector('#menu') as HTMLElement;
  bootEl.style.display = 'none'; menu.style.display = 'flex';
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  menu.innerHTML = `<div class="panel main">
    <h1>Escape Israel</h1><div class="sub">Co-op · Tel Aviv-Jaffa</div><div class="desc">Get rich, get armed, get out. 1-4 friends.</div>
    ${note ? `<div class="note">${note}</div>` : ''}${coarse ? '<div class="note">Keyboard and mouse needed</div>' : ''}
    <label>Name <input id="nm" maxlength="16" value="${getName().replace(/"/g, '')}"></label>
    <button data-a="host">Host game</button>
    <div class="row"><input id="code" maxlength="5" placeholder="CODE" value="${(params.get('join') || '').toUpperCase()}"><button data-a="join">Join game</button></div>
    <div class="row small"><button data-a="settings">Settings</button><button data-a="controls">Controls</button><button data-a="howto">How to play</button><button data-a="credits">Credits</button></div>
    <div class="sub2"></div>
    <div class="foot">Map data © OpenStreetMap contributors · protocol v${PROTOCOL_V} · build ${BUILD_ID}</div></div>`;
  const sub = menu.querySelector('.sub2') as HTMLElement;
  menu.querySelector('#nm')!.addEventListener('change', (e) => { try { localStorage.setItem('esc.name', (e.target as HTMLInputElement).value.slice(0, 16)); } catch { /* */ } });
  menu.onclick = (e) => {
    const a = (e.target as HTMLElement).dataset.a; if (!a) return;
    try { localStorage.setItem('esc.name', (menu.querySelector('#nm') as HTMLInputElement).value.slice(0, 16) || getName()); } catch { /* */ }
    if (a === 'host') {
      const save = readSave();
      if (!save) return void start('host');
      sub.innerHTML = `<button data-a="continue">Continue (${shekels(save.money)}, saved ${new Date(save.savedAt).toLocaleString()})</button><button data-a="newrun">New run</button>`;
    }
    if (a === 'continue') start('host');
    if (a === 'newrun') sub.innerHTML = `<div>Start over? Your saved run will be deleted.</div><button data-a="confirmnew">Start over</button>`;
    if (a === 'confirmnew') { deleteSave(); start('host', undefined, true); }
    if (a === 'join') { const c = (menu.querySelector('#code') as HTMLInputElement).value.trim().toUpperCase(); if (c.length === 5) start('join', c); else sub.textContent = 'Enter the 5-character room code'; }
    if (a === 'controls') sub.innerHTML = CONTROLS_HTML;
    if (a === 'credits') sub.innerHTML = `<p>Map data (c) OpenStreetMap contributors, ODbL 1.0. Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.</p><p>This is a parody for a private group of friends; all businesses, units and people in it are fictional.</p><p>Built with Three.js, Rapier and PeerJS.</p>`;
    if (a === 'howto') sub.innerHTML = `<p>You start broke and unarmed in the Tel Aviv safehouse: grab the pistol from the Stash next to you. Make money from crates, holding up civilians (gun out, E), shifts at McShekel's, the Club Gagarin casino (only while nobody is hunting you), courier packages between cities, or rob a bank and carry the cash bag to any SHOP to fence it (bags slow you and drop when you die). Crimes raise your stars; break line of sight to lose them, or lay low at a shop. Buy guns, ammo and a plate carrier at a shop. Take a parked car or carjack one (F) to drive the highways; M shows the map. Three ways out: a boat from Jaffa or Haifa (₪15,000 each, hold the pier 60 s at five stars), a plane from Ben Gurion (₪25,000 each, a forged passport each from the forger in Jerusalem, zero stars, 30 s boarding), or the southern border at Eilat (₪10,000 for the crew, hold 90 s at five stars). Dead players are back at the nearest safehouse in 10 s; if the whole crew is down you lose a quarter of the money. Escape with more money for a better ending.</p><p>Friends use their own voice app; there is no in-game chat.</p>`;
    if (a === 'settings') {
      sub.innerHTML = `<div class="settings">
        <label>Quality <select id="q">${['auto', 'low', 'medium', 'high'].map((q) => `<option ${settings.quality === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
        <label>Mouse sensitivity <input id="s" type="range" min="0.02" max="0.3" step="0.01" value="${settings.sens}"></label>
        <label>FOV <input id="f" type="range" min="70" max="100" value="${settings.fov}"></label>
        <label>Volume <input id="v" type="range" min="0" max="100" value="${settings.volume}"></label>
        <label><input id="p" type="checkbox" ${settings.fps ? 'checked' : ''}> Show FPS</label><div class="small">Quality applies on reload.</div></div>`;
      sub.oninput = () => {
        settings.quality = (sub.querySelector('#q') as HTMLSelectElement).value as any; settings.sens = +(sub.querySelector('#s') as HTMLInputElement).value;
        settings.fov = +(sub.querySelector('#f') as HTMLInputElement).value; settings.volume = +(sub.querySelector('#v') as HTMLInputElement).value;
        settings.fps = (sub.querySelector('#p') as HTMLInputElement).checked; (window as any).__showFps = settings.fps; saveSettings(settings);
      };
    }
  };
}

(window as any).__showFps = settings.fps;
worldP.then(() => {
  if (params.get('join')) start('join', params.get('join')!.toUpperCase());
  else if (params.get('host') || params.get('script') || params.has('autohost')) start('host', params.get('room') || undefined);
  else { showMenu(params.get('msg') || ''); requestAnimationFrame(idle); }
}).catch((e) => { console.error(e); bootLbl.textContent = 'Error: ' + e.message; probe('boot_error', { message: String(e.message) }); });
