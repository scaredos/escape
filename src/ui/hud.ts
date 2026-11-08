// 2D canvas HUD (spec 05 H1-H11 + addendum "HUD extras"). Immediate mode, redrawn every frame over the 3D view.
// All layout is in CSS px with S = viewH / 1080; the canvas backing store is dpr-scaled.
import * as THREE from 'three';
import type { HudView, MapData } from './hud-types';
import { shekels, clock, foods, starsOf } from '../game/protocol';
import { MARKER, escapeCost } from '../game/options';
import { placeName } from '../world/land';
import { probe } from '../core/probe';

const GOLD = '#FFE789', WANTED = '#F97C7C', GREY = '#CECECE', BAG = '#95F3AA', BOAT = '#95E7FF', FRIEND = '#C4E1FF',
  PARCEL = '#FFC46C', WHITE = '#FFFFFF', OUTLINE = 'rgba(0,0,0,0.85)', PANEL = 'rgba(0,0,0,0.55)';
const KEY_COL: Record<string, string> = { gold: GOLD, boat: BOAT, bag: BAG, parcel: PARCEL };
const WAYS_OUT = new Set(['escape', 'airport', 'crossing']);
const MAP_TAGGED = new Set(['escape', 'airport', 'crossing', 'forger', 'delivery']);
const DIM_WANTED = new Set(['casino', 'job', 'airport']);
const WEAPON_NAME: Record<string, string> = { pistol: 'Pistol', shotgun: 'Shotgun', rifle: 'Rifle' };
const FINALE: Record<string, [string, string, string]> = {
  Airport: ['BOARDING', BOAT, 'Stay at the gate and keep it quiet: one star cancels boarding'],
  Crossing: ['HOLD THE BORDER', WANTED, "Keep someone at the crossing until the smugglers' truck rolls in"],
  Escape: ['HOLD THE PIER', WANTED, 'Keep someone on the pier until the boat casts off'],
};
const ROW2 = 'Boat from Jaffa/Haifa ₪15,000 each - airport ₪25,000 each + passports, no stars - southern border ₪10,000';
const LEGEND = 'Ways out: BOAT (Jaffa, Haifa) - AIRPORT (passports, no stars) - BORDER (Eilat)    DELIVERY: courier jobs    M to close';
const MAX_MARKER_M = 1500;

const distText = (m: number) => (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m');

interface Row { text: string; color: string; scale: number; back?: string }
interface Marker {
  x: number; y: number; tag: string; color: string; alpha: number; dist: string; d: number; prio: boolean;
  minX: number; minY: number; maxX: number; maxY: number; merged: number; tagH: number;
}

export class Hud {
  hidden = false;
  private ctx: CanvasRenderingContext2D;
  private W = 0; private H = 0; private S = 1; private dpr = 1;
  private fonts = new Map<number, string>();
  private widths = new Map<string, Map<string, number>>();
  private readyLogged = false; private endLogged = false; private endT0 = -1;
  // markers (pooled)
  private pool: Marker[] = []; private nm = 0; private list: Marker[] = []; private placed: Marker[] = [];
  private v3 = new THREE.Vector3(); private cp = new THREE.Vector3(); private fwd = new THREE.Vector3();
  private sx = 0; private sy = 0; private d3 = 0;
  // map
  private mapBase: HTMLCanvasElement | null = null; private mapKey = '';
  private mL = 0; private mT = 0; private mS = 1; private mW = 0; private mH = 0;
  private cityNames: { text: string; x: number; y: number }[] = []; private cityFor: unknown = null;

  constructor(private canvas: HTMLCanvasElement, private map: MapData) {
    this.ctx = canvas.getContext('2d')!;
    // Widths measured before Roboto arrived are wrong: drop them when fonts finish loading.
    document.fonts?.addEventListener?.('loadingdone', () => this.widths.clear());
  }

  // ---------- primitives (H1) ----------
  private font(scale: number) {
    let f = this.fonts.get(scale);
    if (!f) {
      const px = Math.max(8, 21.33 * scale * this.S);
      f = (scale >= 1.2 ? '700 ' : '400 ') + px.toFixed(2) + 'px Roboto, Arial, sans-serif';
      this.fonts.set(scale, f);
    }
    return f;
  }
  private lineH(scale: number) { return Math.max(8, 21.33 * scale * this.S) * 1.2; }
  private measure(text: string, scale: number) {
    const f = this.font(scale);
    let m = this.widths.get(f);
    if (!m) { m = new Map(); this.widths.set(f, m); }
    let w = m.get(text);
    if (w === undefined) {
      if (m.size > 2000) m.clear();
      this.ctx.font = f; w = this.ctx.measureText(text).width; m.set(text, w);
    }
    return w;
  }
  /** Text with its top edge at y; alignX 0 left, 0.5 centre, 1 right. Returns the width. */
  private text(t: string, x: number, y: number, color: string, scale: number, alignX = 0, alpha = 1) {
    const c = this.ctx, w = this.measure(t, scale), left = x - w * alignX, cy = y + this.lineH(scale) / 2;
    const o = Math.max(1, Math.round(2 * this.S));
    c.font = this.font(scale); c.globalAlpha = alpha;
    c.fillStyle = '#000'; c.fillText(t, left + o, cy + o);
    c.fillStyle = color; c.fillText(t, left, cy);
    c.globalAlpha = 1;
    return w;
  }
  /** Panel(x, y, rows, alignX); returns its bottom edge. */
  private panel(x: number, y: number, rows: Row[], alignX: number) {
    if (!rows.length) return y;
    const S = this.S, pad = 12 * S, gap = 3 * S, c = this.ctx;
    let maxW = 0, H = 2 * pad - gap;
    for (const r of rows) { maxW = Math.max(maxW, this.measure(r.text, r.scale)); H += this.lineH(r.scale) + gap; }
    const W = maxW + 2 * pad, left = x - W * alignX;
    c.fillStyle = PANEL; c.fillRect(left, y, W, H);
    let ry = y + pad;
    for (const r of rows) {
      const rh = this.lineH(r.scale), rw = this.measure(r.text, r.scale);
      if (r.back) { c.fillStyle = r.back; c.fillRect(left + 4 * S, ry - gap / 2, W - 8 * S, rh + gap); }
      this.text(r.text, left + pad + (W - 2 * pad - rw) * alignX, ry, r.color, r.scale);
      ry += rh + gap;
    }
    return y + H;
  }
  private star(cx: number, cy: number, r: number) {
    const c = this.ctx; c.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = (-90 + 36 * k) * Math.PI / 180, rr = k & 1 ? r * 0.45 : r;
      if (k) c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else c.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    c.closePath(); c.fill();
  }
  private diamond(cx: number, cy: number, r: number) {
    const c = this.ctx; c.beginPath();
    c.moveTo(cx, cy - r); c.lineTo(cx + r, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r, cy); c.closePath(); c.fill();
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1, w = window.innerWidth, h = window.innerHeight;
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh || this.W !== w || this.H !== h) {
      this.canvas.width = bw; this.canvas.height = bh;
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.W = w; this.H = h; this.dpr = dpr; this.S = h / 1080;
      this.fonts.clear(); this.mapBase = null;
    }
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    c.textBaseline = 'middle'; c.textAlign = 'left';
  }

  // ---------- frame (H2) ----------
  draw(v: HudView): void {
    this.resize();
    const d = v.director;
    if (this.hidden || !d) return;
    if (!this.readyLogged) { this.readyLogged = true; probe('hud_ready', { w: this.W, h: this.H }); }
    if (d.phase === 'Escaped') { this.endCard(v); return; }
    if (v.mapOpen) { this.drawMap(v); this.wallet(v); return; }
    this.markers(v);
    this.nameplates(v);
    this.damageNumbers(v);
    this.wallet(v);
    const objBottom = this.objective(v);
    this.jobPanel(v);
    this.feed(v);
    this.prompt(v);
    if (v.roomBanner) this.panel(this.W / 2, objBottom + 8 * this.S, [{ text: v.roomBanner, color: WHITE, scale: 1 }], 0.5);
    this.lyra(v);
    if (v.fps != null) this.text(Math.round(v.fps) + ' fps', this.W - 8 * this.S, this.H - 8 * this.S - this.lineH(0.7) - 120 * this.S, GREY, 0.7, 1);
  }

  // ---------- H3 wallet ----------
  private wallet(v: HudView) {
    const S = this.S, c = this.ctx, d = v.director!;
    const pad = 14 * S, step = 34 * S, barH = 22 * S, stars = Math.max(0, Math.min(5, starsOf(d.heat)));
    const money = shekels(d.money), ww = this.measure(money, 2.4), wh = this.lineH(2.4);
    const W = Math.max(ww, 5 * step) + 2 * pad, H = 2 * pad + wh + step + (stars > 0 ? 8 * S + barH : 0);
    const X = this.W - 24 * S - W, Y = 24 * S;
    c.fillStyle = PANEL; c.fillRect(X, Y, W, H);
    this.text(money, X + W - pad - ww, Y + pad, GOLD, 2.4);
    const sy = Y + pad + wh + step / 2;
    for (let i = 0; i < 5; i++) {
      const sx = X + W - pad - step * (4.5 - i);
      c.fillStyle = OUTLINE; this.star(sx, sy, 15 * S);
      c.fillStyle = i < stars ? WANTED : 'rgba(153,153,153,0.9)'; this.star(sx, sy, 12 * S);
    }
    if (stars > 0) {
      const bx = X + pad, by = sy + step / 2 + 8 * S, bw = W - 2 * pad;
      c.fillStyle = 'rgba(31,31,31,0.85)'; c.fillRect(bx, by, bw, barH);
      let label: string;
      if (d.searchAlpha > 0) {
        c.fillStyle = 'rgba(255,231,137,0.75)'; c.fillRect(bx, by, bw * Math.min(1, d.searchAlpha), barH); label = 'SEARCHING';
      } else {
        const p = 0.5 + 0.5 * Math.sin(6 * v.realTime);
        c.fillStyle = `rgba(249,124,124,${(0.35 + 0.35 * p).toFixed(3)})`; c.fillRect(bx, by, bw, barH); label = 'WANTED';
      }
      this.text(label, bx + bw / 2, by + (barH - this.lineH(0.8)) / 2, WHITE, 0.8, 0.5);
    }
    if (v.myPos) this.text(placeName(v.myInset), X + W, Y + H + 6 * S, GREY, 0.9, 1);
  }

  // ---------- H4 objective ----------
  private rows: Row[] = [];
  private objective(v: HudView) {
    const d = v.director!, p = v.priv, rows = this.rows; rows.length = 0;
    if (d.phase === 'Finale') {
      const [title, col, hint] = FINALE[d.finaleKind || 'Escape'];
      rows.push({ text: `${title}  ${clock(d.finaleLeft)}`, color: col, scale: 2.2 }, { text: hint, color: WHITE, scale: 1 });
    } else {
      const living = Math.max(1, d.living), stars = starsOf(d.heat), missing = d.passportsMissing;
      const border = escapeCost('crossing', living), boat = escapeCost('escape', living), plane = escapeCost('airport', living);
      // already in ascending cost order for any living >= 1
      const ok: string[] = [];
      if (border <= d.money) ok.push(`the southern border at Eilat (${shekels(border)})`);
      if (boat <= d.money) ok.push(`a boat from Jaffa or Haifa (${shekels(boat)})`);
      if (missing === 0 && stars === 0 && plane <= d.money) ok.push(`a plane from Ben Gurion (${shekels(plane)})`);
      rows.push(ok.length
        ? { text: 'Get out: ' + ok.join(' or '), color: GOLD, scale: 1.1 }
        : { text: `Make ${shekels(border)} to get out  (${shekels(d.money)} so far)`, color: WHITE, scale: 1.1 });
      rows.push({ text: ROW2, color: GREY, scale: 0.85 });
      if (missing > 0 && (missing < living || d.money >= plane))
        rows.push({ text: `Passports: ${living - missing} of ${living} - the forger in Jerusalem sells them (₪5,000)`, color: GREY, scale: 0.85 });
    }
    if (p && p.bag > 0) rows.push({ text: `Carrying ${shekels(p.bag)} - fence it at a SHOP (30% slower)`, color: BAG, scale: 1 });
    if (p && p.deliveryDeadline > 0) {
      const left = p.deliveryDeadline - v.hostNow;
      rows.push({ text: `Deliver to ${p.deliveryLabel}  ${clock(left)}  (+${shekels(p.deliveryReward)})`, color: left < 30 ? WANTED : PARCEL, scale: 1 });
    }
    return this.panel(24 * this.S, 24 * this.S, rows, 0);
  }

  // ---------- H6 job ----------
  private jobPanel(v: HudView) {
    const p = v.priv; if (!p || p.jobOrdersLeft <= 0) return;
    const rows = this.rows; rows.length = 0;
    rows.push(
      { text: `McShekel's - order: ${foods(p.jobOrder)}`, color: GOLD, scale: 1.1 },
      { text: `Tray: ${foods(p.jobTray)}`, color: WHITE, scale: 1 },
      { text: `Orders left ${p.jobOrdersLeft}  Time ${clock(p.jobEnd - v.hostNow)}`, color: GREY, scale: 0.9 });
    this.panel(this.W - 24 * this.S, this.H * 0.3, rows, 1);
  }

  // ---------- H7 feed ----------
  private feed(v: HudView) {
    const S = this.S, c = this.ctx, f = v.feed;
    let y = this.H * 0.3;
    for (let i = Math.max(0, f.length - 6); i < f.length; i++) {
      const age = v.realTime - f[i].t; if (age > 8) continue;
      const a = age <= 6 ? 1 : Math.max(0, 1 - (age - 6) / 2), tw = this.measure(f[i].text, 1), th = this.lineH(1);
      c.fillStyle = `rgba(0,0,0,${(0.45 * a).toFixed(3)})`; c.fillRect(24 * S, y, tw + 20 * S, th + 8 * S);
      this.text(f[i].text, 34 * S, y + 4 * S, WHITE, 1, 0, a);
      y += th + 12 * S;
    }
  }

  // ---------- H5 prompt / menu ----------
  private prompt(v: HudView) {
    const rows = this.rows; rows.length = 0;
    const f = v.focus;
    if (f && f.kind === 'spot') {
      rows.push({ text: f.label, color: GOLD, scale: 1.15 });
      if (f.lines.length === 1) {
        const l = f.lines[0];
        rows.push(l.actionable ? { text: '[E] ' + l.text, color: WHITE, scale: 1 } : { text: l.text, color: GREY, scale: 1 });
      } else if (f.lines.length > 1) {
        f.lines.forEach((l, i) => {
          const sel = i === f.selected;
          rows.push({ text: (sel ? '> ' : '   ') + l.text, color: !l.actionable ? GREY : sel ? GOLD : WHITE, scale: 1, back: sel ? 'rgba(255,231,137,0.22)' : undefined });
        });
        rows.push({ text: 'Up/Down choose - E select', color: GREY, scale: 0.8 });
      }
    } else if (f && f.kind === 'civ') rows.push({ text: '[E] Hold them up', color: WHITE, scale: 1.15 });
    if (v.car.seated) rows.push({ text: '[F] Get out', color: GREY, scale: 0.9 });
    else if (v.car.inReach) rows.push({ text: v.car.inReach.npcDriver ? '[F] Get in (drag the driver out)' : '[F] Get in', color: WHITE, scale: 1.15 });
    this.panel(this.W * 0.5, this.H * 0.64, rows, 0.5);
  }

  // ---------- H8 world markers ----------
  private project(v: HudView, x: number, y: number, z: number) {
    const p = this.v3.set(x, z, -y), cp = this.cp, f = this.fwd;
    const dx = p.x - cp.x, dy = p.y - cp.y, dz = p.z - cp.z;
    if (dx * f.x + dy * f.y + dz * f.z <= 0) return false;
    this.d3 = Math.hypot(dx, dy, dz);
    p.project(v.camera);
    this.sx = (p.x + 1) / 2 * this.W; this.sy = (1 - p.y) / 2 * this.H;
    return true;
  }
  private addMarker(v: HudView, x: number, y: number, tag: string, color: string, alpha: number, prio: boolean) {
    if (!this.project(v, x, y, 0 + 3)) return;
    const S = this.S, m0 = 48 * S;
    let m = this.pool[this.nm];
    if (!m) m = this.pool[this.nm] = { x: 0, y: 0, tag: '', color: '', alpha: 1, dist: '', d: 0, prio: false, minX: 0, minY: 0, maxX: 0, maxY: 0, merged: 0, tagH: 0 };
    this.nm++;
    m.x = Math.min(this.W - m0, Math.max(m0, this.sx)); m.y = Math.min(this.H - m0, Math.max(m0, this.sy));
    m.tag = tag; m.color = color; m.alpha = alpha; m.prio = prio; m.d = this.d3; m.dist = distText(this.d3); m.merged = 0;
    m.tagH = this.lineH(0.75);
    const half = Math.max(this.measure(tag, 0.75), this.measure(m.dist, 0.7), 18 * S) / 2;
    m.minX = m.x - half; m.maxX = m.x + half; m.minY = m.y - 12 * S - m.tagH; m.maxY = m.y + 10 * S + this.lineH(0.7);
    this.list.push(m);
  }
  private static order = (a: Marker, b: Marker) => (a.prio === b.prio ? a.d - b.d : a.prio ? -1 : 1);
  private hit(a: Marker, dy: number) {
    for (const b of this.placed) if (a.minX <= b.maxX && a.maxX >= b.minX && a.minY + dy <= b.maxY && a.maxY + dy >= b.minY) return b;
    return null;
  }
  private markers(v: HudView) {
    const S = this.S, c = this.ctx, d = v.director!, p = v.priv, stars = starsOf(d.heat);
    v.camera.getWorldPosition(this.cp); v.camera.getWorldDirection(this.fwd);
    const cx = this.cp.x, cy = -this.cp.z;
    this.nm = 0; this.list.length = 0; this.placed.length = 0;
    const carrying = !!p && p.deliveryDeadline > 0;
    if (carrying) this.addMarker(v, p!.deliveryX, p!.deliveryY, 'DROP-OFF', PARCEL, 1, true);
    for (const s of v.spots) {
      if (s.mode === 'gone') continue;
      const mk = MARKER[s.mode]; if (!mk) continue;
      const prio = WAYS_OUT.has(s.mode);
      if (!prio && Math.hypot(s.x - cx, s.y - cy) > MAX_MARKER_M) continue;
      if (carrying && Math.hypot(s.x - p!.deliveryX, s.y - p!.deliveryY) <= 1) continue;
      const dim = !s.available || (stars > 0 && DIM_WANTED.has(s.mode));
      this.addMarker(v, s.x, s.y, mk[0], KEY_COL[mk[1]] ?? GOLD, dim ? 0.4 : 1, prio);
    }
    for (const s of v.staticSpots) {
      if (s.mode !== 'safehouse' || Math.hypot(s.x - cx, s.y - cy) > MAX_MARKER_M) continue;
      this.addMarker(v, s.x, s.y, 'SAFEHOUSE', FRIEND, 1, false);
    }
    // declutter
    const L = this.list; L.sort(Hud.order);
    const vis = this.placed;
    for (const m of L) {
      const first = this.hit(m, 0);
      if (!first) { vis.push(m); continue; }
      const step = m.maxY - m.minY + 2 * S, dir = m.maxY + 2 * step > this.H ? -1 : 1;
      let ok = false;
      for (let k = 1; k <= 2 && !ok; k++) {
        const dy = dir * step * k;
        if (!this.hit(m, dy)) { m.y += dy; m.minY += dy; m.maxY += dy; vis.push(m); ok = true; }
      }
      if (!ok) first.merged++;
    }
    for (const m of vis) {
      c.globalAlpha = 1; c.fillStyle = `rgba(0,0,0,${0.6 * m.alpha})`; this.diamond(m.x, m.y, 9 * S);
      c.globalAlpha = m.alpha; c.fillStyle = m.color; this.diamond(m.x, m.y, 6.5 * S);
    }
    c.globalAlpha = 1;
    for (const m of vis) {
      this.text(m.merged ? `${m.tag} +${m.merged}` : m.tag, m.x, m.minY, m.color, 0.75, 0.5, m.alpha);
      this.text(m.dist, m.x, m.y + 10 * S, WHITE, 0.7, 0.5, 0.85 * m.alpha);
    }
  }

  // ---------- addendum: nameplates, damage numbers ----------
  private nameplates(v: HudView) {
    const S = this.S, c = this.ctx, cx = this.cp.x, cy = -this.cp.z;
    for (const m of v.mates) {
      if (m.dead || Math.hypot(m.x - cx, m.y - cy) > MAX_MARKER_M || !this.project(v, m.x, m.y, m.z + 2.2)) continue;
      const x = this.sx, y = this.sy, th = this.lineH(0.75);
      this.text(m.name, x, y - th - 2 * S, FRIEND, 0.75, 0.5);
      const bw = 60 * S, bh = 5 * S, f = Math.max(0, Math.min(1, m.hp / (m.maxHp || 1)));
      c.fillStyle = PANEL; c.fillRect(x - bw / 2, y, bw, bh);
      c.fillStyle = f < 0.3 ? WANTED : WHITE; c.fillRect(x - bw / 2, y, bw * f, bh);
    }
  }
  private damageNumbers(v: HudView) {
    for (const n of v.damageNumbers) {
      const age = v.realTime - n.t;
      if (age < 0 || age > 0.7 || !this.project(v, n.x, n.y, n.z + 0.8 * age / 0.7)) continue;
      this.text(String(Math.round(n.dmg)), this.sx, this.sy - this.lineH(0.8) / 2, n.head ? GOLD : WHITE, 0.8, 0.5, 1 - age / 0.7);
    }
  }

  // ---------- H11 health / ammo / crosshair / respawn / hurt ----------
  private lyra(v: HudView) {
    const S = this.S, c = this.ctx, W = this.W, H = this.H;
    if (v.hurtFlash > 0) {
      const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,255,255,${(0.55 * Math.min(1, v.hurtFlash)).toFixed(3)})`);
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
    // health
    const bx = 24 * S, bh = 18 * S, by = H - 24 * S - bh, bw = 300 * S, f = Math.max(0, Math.min(1, v.hp / (v.maxHp || 1)));
    c.fillStyle = PANEL; c.fillRect(bx, by, bw, bh);
    c.fillStyle = f < 0.3 ? WANTED : WHITE; c.fillRect(bx, by, bw * f, bh);
    this.text(String(Math.ceil(Math.max(0, v.hp))), bx + bw + 10 * S, by + (bh - this.lineH(1)) / 2, f < 0.3 ? WANTED : WHITE, 1);
    // slots + ammo (bottom right)
    const sw = 78 * S, sh = 26 * S, sg = 6 * S, sy = H - 24 * S - sh, right = W - 24 * S;
    for (let i = 0; i < 3; i++) {
      const x = right - (3 - i) * sw - (2 - i) * sg, t = v.slots[i], act = i === v.activeSlot && !!t;
      c.fillStyle = PANEL; c.fillRect(x, sy, sw, sh);
      if (act) { c.strokeStyle = GOLD; c.lineWidth = Math.max(1, 2 * S); c.strokeRect(x + 1, sy + 1, sw - 2, sh - 2); }
      this.text(`${i + 1}  ${t ? WEAPON_NAME[t] : '-'}`, x + sw / 2, sy + (sh - this.lineH(0.7)) / 2, act ? GOLD : t ? WHITE : GREY, 0.7, 0.5);
    }
    if (v.weapon) {
      const ay = sy - 8 * S - this.lineH(1.2);
      const aw = this.text(`${v.weapon.mag} / ${v.weapon.spare}`, right, ay, WHITE, 1.2, 1);
      const name = v.weapon.reloading ? 'Reloading...' : WEAPON_NAME[v.weapon.type];
      this.text(name, right - aw - 12 * S, ay + this.lineH(1.2) - this.lineH(0.9) - 2 * S, GREY, 0.9, 1);
    }
    // crosshair
    if (v.showCrosshair && v.weapon && !v.car.seated && !v.dead) {
      const cam = v.camera, gap = Math.max(3 * S, (H / 2) * Math.tan(v.spread * Math.PI / 180) / Math.tan(cam.fov * Math.PI / 360));
      const len = 8 * S, t = Math.max(1, Math.round(2 * S)), x = W / 2, y = H / 2;
      for (let pass = 0; pass < 2; pass++) {
        const e = pass ? 0 : 1; c.fillStyle = pass ? WHITE : 'rgba(0,0,0,0.6)';
        c.fillRect(x - t / 2 - e, y - gap - len - e, t + 2 * e, len + 2 * e);
        c.fillRect(x - t / 2 - e, y + gap - e, t + 2 * e, len + 2 * e);
        c.fillRect(x - gap - len - e, y - t / 2 - e, len + 2 * e, t + 2 * e);
        c.fillRect(x + gap - e, y - t / 2 - e, len + 2 * e, t + 2 * e);
      }
    }
    if (v.dead) this.text(`Back at the safehouse in ${Math.max(0, Math.ceil(v.respawnIn))} s`, W / 2, H * 0.42, WHITE, 1.5, 0.5);
  }

  // ---------- H10 end card ----------
  private endCard(v: HudView) {
    const d = v.director!, c = this.ctx, money = d.finalMoney;
    const tier = money < 10000 ? 'Broke' : money < 60000 ? 'Comfortable' : 'Kingpin';
    if (!this.endLogged) { this.endLogged = true; this.endT0 = v.realTime; probe('hud_end_card', { money, tier }); }
    const how = d.finaleKind === 'Airport' ? 'on a plane from Ben Gurion' : d.finaleKind === 'Crossing' ? 'over the southern border'
      : this.map.insetAt(d.escapeX, d.escapeY) === 'haifa' ? 'by boat from Haifa' : 'by boat from Jaffa';
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, this.W, this.H);
    const rows = this.rows; rows.length = 0;
    rows.push(
      { text: 'ESCAPED', color: GOLD, scale: 4 },
      { text: `You got out ${how} with ${shekels(money)}`, color: WHITE, scale: 1.5 },
      { text: tier, color: tier === 'Broke' ? GREY : GOLD, scale: 2.2 },
      { text: 'Thanks for playing Escape Israel', color: GREY, scale: 1 });
    const bottom = this.panel(this.W * 0.5, this.H * 0.3, rows, 0.5);
    if (v.realTime - this.endT0 >= 5) this.text('Esc - back to menu', this.W / 2, bottom + 24 * this.S, WHITE, 1.1, 0.5);
  }

  // ---------- H9 full-screen map ----------
  private toMx(x: number) { return this.mL + (x - this.map.bounds[0]) * this.mS; }
  private toMy(y: number) { return this.mT + (this.map.bounds[3] - y) * this.mS; }
  private buildMapBase() {
    const S = this.S, W = this.W, H = this.H, m = this.map, [x0, y0, x1, y1] = m.bounds;
    const top0 = 70 * S, bot0 = 160 * S;
    this.mS = Math.min((W - 80 * S) / (x1 - x0), (H - top0 - bot0) / (y1 - y0));
    this.mW = (x1 - x0) * this.mS; this.mH = (y1 - y0) * this.mS;
    this.mL = (W - this.mW) / 2; this.mT = top0 + (H - top0 - bot0 - this.mH) / 2;
    const cv = this.mapBase ?? document.createElement('canvas');
    cv.width = Math.round(W * this.dpr); cv.height = Math.round(H * this.dpr);
    const c = cv.getContext('2d')!; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = 'rgba(39,48,63,0.92)'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#457999'; c.fillRect(this.mL, this.mT, this.mW, this.mH);
    // land bands, south to north
    const bands = Math.max(60, Math.min(400, Math.round(this.mH / (3 * S)))), bh = (y1 - y0) / bands;
    c.fillStyle = '#848179'; c.beginPath();
    for (let b = 0; b < bands; b++) {
      const ya = y0 + b * bh, sp = m.landSpans(ya + bh / 2), pyTop = this.toMy(ya + bh), pyH = bh * this.mS;
      for (let k = 0; k < sp.length; k += 2) {
        const a = Math.max(x0, sp[k]), e = Math.min(x1, sp[k + 1]);
        if (e > a) c.rect(this.toMx(a), pyTop - 0.25, (e - a) * this.mS, pyH + 0.5);
      }
    }
    c.fill();
    // streets / highways split by midpoint inset
    const r = m.roads, streets = new Path2D(), highways = new Path2D();
    for (let i = 0; i + 3 < r.length; i += 4) {
      const p = m.insetAt((r[i] + r[i + 2]) / 2, (r[i + 1] + r[i + 3]) / 2) ? streets : highways;
      p.moveTo(this.toMx(r[i]), this.toMy(r[i + 1])); p.lineTo(this.toMx(r[i + 2]), this.toMy(r[i + 3]));
    }
    c.lineCap = 'round';
    c.strokeStyle = '#BFBFBC'; c.lineWidth = Math.max(1, 0.8 * S); c.stroke(streets);
    const bq = m.buildings; c.fillStyle = '#ECE2CB'; c.beginPath();
    for (let i = 0; i + 7 < bq.length; i += 8) {
      c.moveTo(this.toMx(bq[i]), this.toMy(bq[i + 1]));
      for (let k = 2; k < 8; k += 2) c.lineTo(this.toMx(bq[i + k]), this.toMy(bq[i + k + 1]));
      c.closePath();
    }
    c.fill();
    c.strokeStyle = '#F9DD95'; c.lineWidth = Math.max(2, 3 * S); c.stroke(highways);
    this.mapBase = cv;
  }
  private drawMap(v: HudView) {
    const S = this.S, c = this.ctx, key = `${this.W}x${this.H}@${this.dpr}`;
    if (!this.mapBase || this.mapKey !== key) { this.buildMapBase(); this.mapKey = key; }
    c.drawImage(this.mapBase!, 0, 0, this.W, this.H);
    // 6. city names (mean of each inset's spots + 1.2 km north), cached per spot list
    if (this.cityFor !== v.staticSpots) {
      this.cityFor = v.staticSpots;
      const acc = new Map<string, [number, number, number]>();
      for (const s of v.staticSpots) {
        if (!s.inset) continue;
        const a = acc.get(s.inset) ?? [0, 0, 0]; a[0] += s.x; a[1] += s.y; a[2]++; acc.set(s.inset, a);
      }
      this.cityNames = [...acc].map(([n, a]) => ({ text: placeName(n).toUpperCase(), x: a[0] / a[2], y: a[1] / a[2] + 1200 }));
    }
    for (const n of this.cityNames) this.text(n.text, this.toMx(n.x), this.toMy(n.y) - this.lineH(1.1), WHITE, 1.1, 0.5);
    // 7. spots
    const p = v.priv, drop = !!p && p.deliveryDeadline > 0;
    for (const s of v.staticSpots) {
      const mk = MARKER[s.mode], col = s.mode === 'safehouse' ? FRIEND : mk ? KEY_COL[mk[1]] : null;
      if (!col) continue;
      const tagged = MAP_TAGGED.has(s.mode), r = (tagged ? 6.5 : 4) * S, x = this.toMx(s.x), y = this.toMy(s.y);
      c.fillStyle = OUTLINE; this.diamond(x, y, r + 2.5 * S);
      c.fillStyle = col; this.diamond(x, y, r);
      const isDrop = drop && s.mode === 'delivery' && Math.hypot(s.x - p!.deliveryX, s.y - p!.deliveryY) < 30;
      if (tagged && !isDrop) this.text(mk![0], x + 12 * S, y - this.lineH(0.8) / 2, col, 0.8);
    }
    if (drop) {
      const x = this.toMx(p!.deliveryX), y = this.toMy(p!.deliveryY);
      c.fillStyle = OUTLINE; this.diamond(x, y, 9 * S); c.fillStyle = PARCEL; this.diamond(x, y, 6.5 * S);
      this.text('DROP-OFF', x + 12 * S, y - this.lineH(0.8) / 2, PARCEL, 0.8);
    }
    // 8. players: others first, local arrow on top
    for (let pass = 0; pass < 2; pass++) for (const pl of v.players) {
      if (pl.local !== (pass === 1)) continue;
      const x = this.toMx(pl.x), y = this.toMy(pl.y);
      if (pl.local) {
        const b = pl.bearing * Math.PI / 180, ax = Math.sin(b), ay = -Math.cos(b), qx = -ay, qy = ax;
        for (const [L, col] of [[11 * S, OUTLINE], [8 * S, GOLD]] as const) {
          c.fillStyle = col; c.beginPath();
          c.moveTo(x + ax * 1.4 * L, y + ay * 1.4 * L);
          c.lineTo(x - ax * 0.8 * L + qx * L, y - ay * 0.8 * L + qy * L);
          c.lineTo(x - ax * 0.8 * L - qx * L, y - ay * 0.8 * L - qy * L);
          c.closePath(); c.fill();
        }
      } else { c.fillStyle = OUTLINE; this.diamond(x, y, 7 * S); c.fillStyle = FRIEND; this.diamond(x, y, 5 * S); }
      this.text(pl.name, x + 12 * S, y + 4 * S, pl.local ? GOLD : FRIEND, 0.7);
    }
    // 9-10. title, legend, attribution
    this.text('ISRAEL (COMPRESSED)', this.W / 2, this.mT - 52 * S, GOLD, 2, 0.5);
    this.text(LEGEND, this.W / 2, this.mT + this.mH + 10 * S, GREY, 0.9, 0.5);
    this.text('© OpenStreetMap contributors', this.W - 12 * S, this.H - 12 * S - this.lineH(0.7), GREY, 0.7, 1);
  }
}
