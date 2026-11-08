// HUD preview: a fake but plausible HudView over a gradient. ?map=1 | ?end=1 | ?finale=1
import * as THREE from 'three';
import { Hud } from '../src/ui/hud';
import type { HudView, MapData } from '../src/ui/hud-types';
import { Land } from '../src/world/land';
import { spotOptions } from '../src/game/options';
import type { DirectorState, PrivateState, SpotState } from '../src/game/protocol';
import type { Pack } from '../src/world/types';

const q = new URLSearchParams(location.search);
const pack: Pack = await (await fetch('/data/world.pack.json')).json();
const land = new Land(pack);

const roads: number[] = [], bld: number[] = [];
for (const ins of pack.insets) {
  const [ox, oy] = ins.offset;
  let off = 0;
  for (const n of ins.r_len) {
    for (let k = 1; k < n; k++) {
      const a = off + (k - 1) * 2, b = off + k * 2;
      roads.push(ox + ins.r_pts[a] / 10, oy + ins.r_pts[a + 1] / 10, ox + ins.r_pts[b] / 10, oy + ins.r_pts[b + 1] / 10);
    }
    off += n * 2;
  }
  for (let o = 0; o < ins.b.length; o += 6) {
    const b = ins.b, cx = ox + b[o] / 100, cy = oy + b[o + 1] / 100, W = b[o + 2] / 200, L = b[o + 3] / 200, yaw = b[o + 4] / 100 * Math.PI / 180;
    const ux = Math.cos(yaw), uy = Math.sin(yaw), vx = -uy, vy = ux;
    bld.push(cx + ux * L + vx * W, cy + uy * L + vy * W, cx - ux * L + vx * W, cy - uy * L + vy * W,
      cx - ux * L - vx * W, cy - uy * L - vy * W, cx + ux * L - vx * W, cy + uy * L - vy * W);
  }
}
for (const h of pack.world.highways) for (let k = 1; k < h.pts.length; k++) roads.push(...h.pts[k - 1], ...h.pts[k]);

const map: MapData = {
  bounds: land.bounds, landSpans: (y) => land.landSpans(y), roads: Float32Array.from(roads), buildings: Float32Array.from(bld),
  insetAt: (x, y) => land.insetAt(x, y), insets: pack.insets.map((i) => ({ name: i.name, ox: i.offset[0], oy: i.offset[1] })),
};

const now = 1000, rt = performance.now() / 1000;
const staticSpots = pack.world.spots.map((s) => ({ mode: s.mode, name: s.name, x: s.x, y: s.y, inset: s.inset }));
const spots: SpotState[] = pack.world.spots.filter((s) => s.mode !== 'crate' && s.mode !== 'safehouse').map((s, id) => ({
  id, mode: s.mode, label: s.name, available: !(s.mode === 'bank' && id % 2), value: 0, timerEnd: 0, boatOut: 0,
  x: s.x, y: s.y, fx: 0, fy: 0, inset: s.inset,
}));
spots.push({ id: 99, mode: 'bag', label: 'Cash bag', available: true, value: 6000, timerEnd: 0, boatOut: 0, x: 1210, y: 1262, fx: 0, fy: 0, inset: 'telaviv' });
const haifaBoat = pack.world.spots.find((s) => s.name.includes('Haifa port'))!;
const haifaDel = pack.world.spots.find((s) => s.name.startsWith('Carmel Cargo'))!;

const director: DirectorState = {
  money: 12345, heat: 300, stars: 3, searchAlpha: 0.45, phase: 'Playing', finaleLeft: 0, escapeX: 0, escapeY: 0, finaleKind: '',
  finalMoney: 0, passportsMissing: 1, living: 2, roadblocks: 0,
};
if (q.has('finale')) Object.assign(director, { phase: 'Finale', finaleKind: 'Escape', finaleLeft: 42, money: 0, heat: 500, stars: 5, searchAlpha: 0 });
if (q.has('end')) Object.assign(director, { phase: 'Escaped', finaleKind: 'Escape', escapeX: haifaBoat.x, escapeY: haifaBoat.y, finalMoney: 64200 });
const priv: PrivateState = {
  bag: 4000, armor: 0, passport: false, jobOrder: [0, 1, 2], jobTray: [0], jobOrdersLeft: 3, jobEnd: now + 64, jobCooldownEnd: 0,
  deliveryLabel: 'Haifa - Carmel Cargo & Courier', deliveryX: haifaDel.x, deliveryY: haifaDel.y, deliveryReward: 3300, deliveryDeadline: now + 133,
  weapons: [{ type: 'pistol', mag: 9, spare: 36 }], active: 0, reloadEnd: 0, equipEnd: 0, dead: false, respawnAt: 0, pawn: 1, car: -1,
};
const shop = spots.find((s) => s.mode === 'shop' && s.inset === 'telaviv')!;
const lines = spotOptions(shop, director, priv, now, spots);

// street-level camera at the Postel safehouse, looking ESE (bearing 110)
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 5000);
const me = { x: 1182, y: 1272, z: 0 }, bearing = 110, br = bearing * Math.PI / 180;
camera.position.set(me.x, 1.7, -me.y);
camera.lookAt(me.x + Math.sin(br) * 100, 1.7, -(me.y + Math.cos(br) * 100));
camera.updateMatrixWorld(); camera.updateProjectionMatrix();
const ab = (bearing - 25) * Math.PI / 180, ax = me.x + Math.sin(ab) * 10, ay = me.y + Math.cos(ab) * 10;

const view: HudView = {
  hostNow: now, realTime: rt, director, priv, spots, staticSpots, myPos: me, myInset: land.insetAt(me.x, me.y), camera,
  focus: { kind: 'spot', id: shop.id, label: shop.label, lines, selected: 2 },
  car: { seated: false, inReach: { npcDriver: true } },
  feed: [{ text: 'Wanted level 3', t: rt - 1 }, { text: 'Order up! +₪80', t: rt - 6.8 }],
  mapOpen: q.has('map'),
  players: [{ name: 'Steven', x: me.x, y: me.y, local: true, bearing }, { name: 'Dana', x: haifaDel.x - 200, y: haifaDel.y + 300, local: false, bearing: 0 }],
  mates: [{ name: 'Dana', x: ax, y: ay, z: 0, hp: 25, maxHp: 100, dead: false }],
  hp: 72, maxHp: 100, dead: false, respawnIn: 0,
  weapon: { type: 'pistol', mag: 9, spare: 36, reloading: false }, slots: ['pistol', 'rifle', null], activeSlot: 0,
  spread: 1.5, showCrosshair: true, hurtFlash: 0.35,
  damageNumbers: [{ x: ax + 1, y: ay - 3, z: 1.0, dmg: 34, head: true, t: rt - 0.15 }],
  roomBanner: 'Room K7QXP - invite friends: http://localhost:5173/?join=K7QXP', fps: 60,
};

await Promise.all([document.fonts.load('400 20px Roboto'), document.fonts.load('700 20px Roboto')]).catch(() => {});
const hud = new Hud(document.getElementById('hud') as HTMLCanvasElement, map);
hud.draw(view);
if (q.has('end')) { view.realTime += 6; hud.draw(view); } // show the 5 s "back to menu" hint
(window as any).__ready = true;
