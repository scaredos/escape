// Enterable venues ("shells", spec 01 §13): hollow hall, skins, door awning, sign, lights and the furniture per venue.
import { DEG } from '../geom';
import type { Fp, Gen } from './ctx';

type Claim = [number, number, number, number]; // x0 y0 x1 y1 (local)

export function buildShell(g: Gen, f: Fp, spotIdx: number, D: [number, number]) {
  const spot = g.spots[spotIdx], mode = spot.mode;
  const Xv: [number, number] = [D[1], -D[0]];                          // local +x (right when facing the door)
  const alongU = Math.abs(D[0] * f.b.ux + D[1] * f.b.uy) > 0.5;
  const hD = alongU ? f.b.hl : f.b.hw, hX = alongU ? f.b.hw : f.b.hl;
  const Rx = hX - 0.4, Ry = hD - 0.4;
  const H = (Math.min(f.lv, 3) * 320 + 100) / 100;
  const yawX = Math.atan2(Xv[1], Xv[0]) / DEG;
  const W = (x: number, y: number): [number, number] => [f.cx + Xv[0] * x + D[0] * y, f.cy + Xv[1] * x + D[1] * y];
  /** local box: centre (x,y), bottom z (m), sizes along local x / y / z (m) */
  const lb = (key: string, x: number, y: number, z0: number, sx: number, sy: number, sz: number, color: string | [number, number, number], extra = 0.75, o: { pitch?: number; roll?: number; collide?: boolean } = {}) => {
    const [wx, wy] = W(x, y); g.box(key, wx, wy, z0 + sz / 2, sx, sy, sz, yawX, { color, extra, ...o });
  };
  const cm = (v: number) => v / 100;

  // ---- hall walls, skins, collision
  const tint = f.tint, stone = f.stone ? 1 : 0;
  const wallPiece = (x0: number, x1: number, y: number, z0: number, z1: number, alongX: boolean) => {
    // a 40 cm wall piece centred on line y (alongX) or x (=y param) ; outer skin facade, inner skin plaster, hidden collider
    const len = x1 - x0, mid = (x0 + x1) / 2; if (len <= 0.01) return;
    const out = Math.sign(y) || 1;
    if (alongX) {
      const [cx, cy] = W(mid, y); g.collider(cx, cy, (z0 + z1) / 2, len, 0.4, z1 - z0, yawX);
      lb('facade_nc', mid, y + out * 0.1, z0, len, 0.2, (z1 === H ? H + 0.3 : z1) - z0, tint, stone);
      lb('in_plaster', mid, y - out * 0.1, z0, len, 0.2, z1 - z0, [1, 1, 1]);
    } else {
      const [cx, cy] = W(y, mid); g.collider(cx, cy, (z0 + z1) / 2, 0.4, len, z1 - z0, yawX);
      lb('facade_nc', y + out * 0.1, mid, z0, 0.2, len, (z1 === H ? H + 0.3 : z1) - z0, tint, stone);
      lb('in_plaster', y - out * 0.1, mid, z0, 0.2, len, z1 - z0, [1, 1, 1]);
    }
  };
  wallPiece(-hX, hX, -(hD - 0.2), 0, H, true);                         // back
  wallPiece(-hD + 0.4, hD - 0.4, -(hX - 0.2), 0, H, false);             // left
  wallPiece(-hD + 0.4, hD - 0.4, hX - 0.2, 0, H, false);                // right
  wallPiece(-hX, -1.9, hD - 0.2, 0, H, true); wallPiece(1.9, hX, hD - 0.2, 0, H, true);
  wallPiece(-1.9, 1.9, hD - 0.2, 3.2, H, true);                          // lintel
  { const [cx, cy] = W(0, 0); g.collider(cx, cy, H + 0.15, 2 * hX, 2 * hD, 0.3, yawX); }
  lb('in_plaster', 0, 0, H, 2 * hX - 0.4, 2 * hD - 0.4, 0.15, [1, 1, 1]);
  lb('facade_nc', 0, 0, H + 0.15, 2 * hX, 2 * hD, 0.15, tint, stone);
  lb('flat', 0, hD + 1.2, 3.5 - 0.1, 5.4, 2.4, 0.2, 'C0392B', 0.6);       // door awning

  // ---- floor, wainscot, baseboard
  const floorKey: Record<string, string> = { casino: 'flat', shop: 'fl_garage', safehouse: 'fl_warm', forger: 'fl_warm', bank: 'fl_marble', airport: 'fl_marble', job: 'fl_job' };
  lb(floorKey[mode] ?? 'fl_warm', 0, 0, 0, 2 * Rx, 2 * Ry, 0.03, mode === 'casino' ? '6E1A28' : [1, 1, 1], 0.95);
  const trim = (out: number, h: number, color: string, z0: number) => {
    lb('flat', 0, -Ry + out / 2, z0, 2 * Rx, out, h, color, 0.6);
    lb('flat', -Rx + out / 2, 0, z0, out, 2 * Ry, h, color, 0.6);
    lb('flat', Rx - out / 2, 0, z0, out, 2 * Ry, h, color, 0.6);
    const seg = Rx - 1.9; if (seg > 0) for (const s of [-1, 1]) lb('flat', s * (1.9 + seg / 2), Ry - out / 2, z0, seg, out, h, color, 0.6);
  };
  trim(0.04, 1.1, '5E4632', 0); trim(0.06, 0.14, '2B2119', 0);

  // ---- claims
  const claims: Claim[] = [];
  const claim = (cx: number, cy: number, hx: number, hy: number): boolean => {
    const r: Claim = [cx - hx, cy - hy, cx + hx, cy + hy];
    if (Math.hypot(Math.max(Math.abs(cx) - hx, 0), Math.max(Math.abs(cy) - hy, 0)) < 5) return false;
    if (Math.abs(cx) < 3 + hx && cy + hy > 0) return false;
    if (Math.abs(cx) + hx > Rx + 1e-6 || Math.abs(cy) + hy > Ry + 1e-6) return false;
    for (const c of claims) if (r[0] < c[2] - 1e-6 && r[2] > c[0] + 1e-6 && r[1] < c[3] - 1e-6 && r[3] > c[1] + 1e-6) return false;
    claims.push(r); return true;
  };
  // wall frames: base, inward normal n, along t, length
  const walls = [
    { b: [0, -Ry], n: [0, 1], t: [1, 0], len: 2 * Rx }, { b: [-Rx, 0], n: [1, 0], t: [0, 1], len: 2 * Ry },
    { b: [Rx, 0], n: [-1, 0], t: [0, -1], len: 2 * Ry }, { b: [0, Ry], n: [0, -1], t: [-1, 0], len: 2 * Rx },
  ];
  const wp = (w: number, T: number, Dm: number): [number, number] => { const k = walls[w]; return [k.b[0] + k.t[0] * T + k.n[0] * Dm, k.b[1] + k.t[1] * T + k.n[1] * Dm]; };
  /** wall-relative box: along × out × height (cm), bottom z (cm) */
  const wb = (key: string, w: number, T: number, Dm: number, zcm: number, along: number, out: number, hcm: number, color: string, rough = 0.75) => {
    const [x, y] = wp(w, T, Dm), tx = walls[w].t[0] !== 0;
    lb(key, x, y, cm(zcm), cm(tx ? along : out), cm(tx ? out : along), cm(hcm), color, rough);
  };
  const wclaim = (w: number, T: number, Dm: number, along: number, out: number) => {
    const [x, y] = wp(w, T, Dm), tx = walls[w].t[0] !== 0;
    return claim(x, y, (tx ? along : out) / 2, (tx ? out : along) / 2);
  };
  const cyl = (key: string, x: number, y: number, zcm: number, dcm: number, hcm: number, color: string, rough = 0.4, roll = 0) =>
    lb(key, x, y, cm(zcm), cm(dcm), cm(dcm), cm(hcm), color, rough, { roll });
  const WOOD = '7A5230', STEEL = 'A7ACB2', CHAIR = '3B302A', BLACK = '161616', WHITE = 'E4E2DC';

  if (mode === 'casino') {
    const barWall = Ry <= Rx ? 1 : 0, wl = walls[barWall].len, BarLen = Math.min(wl - 4, 12);
    if (BarLen > 3 && wclaim(barWall, 0, 2, BarLen + 1, 4)) {
      wb('flat_c', barWall, 0, 0.25, 0, BarLen * 100, 40, 100, WOOD, 0.7);
      for (const z of [136, 181, 226]) {
        wb('flat', barWall, 0, 0.2, z, BarLen * 100, 30, 4, WOOD, 0.7);
        let i = 0; for (let T = -BarLen / 2 + 0.15; T < BarLen / 2; T += 0.3) wb('flat', barWall, T, 0.2, z + 4, 9, 9, 30, i++ % 2 ? 'A35A1A' : '2E6B3A', 0.1);
      }
      wb('flat_c', barWall, 0, 3, 0, BarLen * 100, 70, 110, WOOD, 0.7);
      wb('flat', barWall, 0, 3, 110, BarLen * 100 + 10, 80, 5, 'D4A017', 0.25);
      for (let T = -BarLen / 2 + 0.6; T <= BarLen / 2 - 0.6; T += 1.2) {
        const [x, y] = wp(barWall, T, 3.7); cyl('cyl_c', x, y, 0, 8, 72, STEEL); lb('flat', x, y, 0.72, 0.4, 0.4, 0.08, 'B03024', 0.5);
      }
    }
    for (const w of [0, 1, 2]) {
      if (w === barWall) continue;
      for (let T = -walls[w].len / 2 + 0.8; T <= walls[w].len / 2 - 0.8; T += 1.3) {
        if (!wclaim(w, T, 0.45, 0.9, 0.7)) continue;
        wb('flat_c', w, T, 0.45, 0, 90, 70, 190, '4A1070', 0.35); wb('flat', w, T, 0.45, 190, 96, 76, 22, 'D4A017', 0.25);
        wb('flat', w, T, 0.81, 105, 60, 2, 45, BLACK, 0.4);
      }
    }
    for (let x = -Rx + 6; x <= Rx - 6; x += 12) for (let y = -Ry + 6; y <= Ry - 4; y += 9) {
      if (!claim(x, y, 1.9, 1.3)) continue;
      lb('flat_c', x, y, 0, 2, 1, 0.72, WOOD, 0.7); lb('flat_c', x, y, 0.72, 2.4, 1.4, 0.06, '1F6B3A', 1);
      for (const [a, b] of [[0.6, 1], [-0.6, 1], [0.6, -1], [-0.6, -1]]) lb('flat', x + a, y + b, 0, 0.45, 0.45, 0.46, CHAIR, 0.8);
    }
  } else if (mode === 'job') {
    for (let x = -Rx + 1; x < Rx; x += 2) for (let y = -Ry + 1; y < Ry; y += 2) {
      const i = Math.round((x + Rx) / 2), j = Math.round((y + Ry) / 2);
      if ((i + j) % 2 === 0) lb('flat_ns', x, y, 0.03, Math.min(2, Rx - x + 1), Math.min(2, Ry - y + 1), 0.006, 'C41E24', 0.35);
    }
    const KL = Math.min(2 * Rx - 2, 16);
    if (wclaim(0, 0, 0.6, KL, 1.2)) {
      wb('flat_c', 0, 0, 0.45, 0, KL * 100, 80, 90, STEEL, 0.3); wb('flat', 0, 0, 0.5, 205, KL * 100, 90, 45, STEEL, 0.3);
      let i = 0; for (let T = -KL / 2 + 0.9; T <= KL / 2 - 0.6; T += 1.5) {
        if (i++ % 2 === 0) wb('flat', 0, T, 0.45, 90, 120, 65, 8, BLACK, 0.4);
        else { wb('flat', 0, T, 0.45, 90, 70, 65, 35, STEEL, 0.3); wb('flat', 0, T, 0.45, 125, 56, 50, 2, '0A0A0A', 0.1); }
      }
      const ML = Math.min(KL, 10);
      wb('flat', 0, 0, 0.05, 270, ML * 100, 10, 130, 'FFC72C', 0.5);
      for (const z of [295, 327, 359]) wb('flat', 0, 0, 0.11, z, ML * 100 - 80, 2, 12, 'C41E24', 0.5);
    }
    for (let w = 0; w < 4; w++) for (let T = -walls[w].len / 2 + 1.3; T <= walls[w].len / 2 - 1.3; T += 2.8) {
      if (!wclaim(w, T, 0.7, 2.4, 1.3)) continue;
      // table 80 x 120 (out x along), benches either side along the wall
      wb('flat_c', w, T, 0.7, 0, 120, 80, 75, WOOD, 0.7);
      for (const s of [-1, 1]) { wb('flat_c', w, T + s * 0.7, 0.7, 0, 50, 120, 45, 'B03024', 0.5); wb('flat_c', w, T + s * 1.08, 0.7, 0, 16, 120, 110, 'B03024', 0.5); }
    }
    for (let x = -Rx + 3; x <= Rx - 3; x += 4.5) for (let y = -Ry + 3.2; y <= Ry - 2.5; y += 3.5) {
      if (!claim(x, y, 1.05, 0.5)) continue;
      lb('flat_c', x, y, 0, 0.8, 0.8, 0.75, WOOD, 0.7);
      for (const s of [-0.75, 0.75]) lb('flat', x + s, y, 0, 0.45, 0.45, 0.46, CHAIR, 0.8);
    }
  } else if (mode === 'bank') {
    for (const x of [0, Rx / 2, -Rx / 2]) if (claim(x, -Ry + 0.35, 1.3, 0.35)) {
      cyl('cyl_c', x, -Ry + 0.2, 150 - 120, 240, 40, STEEL, 0.4, 90);
      cyl('cyl', x, -Ry + 0.45, 150 - 35, 70, 20, 'B4B9BE', 0.3, 90);
      lb('flat', x, -Ry + 0.6, 1.46, 1.5, 0.08, 0.08, 'D0D4D8', 0.25); lb('flat', x, -Ry + 0.6, 0.75, 0.08, 0.08, 1.5, 'D0D4D8', 0.25);
      break;
    }
    const cyCounter = -Ry + 2.2;
    for (let x = -Rx + 1.5; x <= Rx - 2.7; x += 3) {
      if (!claim(x, cyCounter, 1.5, 0.35)) continue;
      lb('flat_c', x, cyCounter, 0, 3, 0.7, 1.1, WOOD, 0.7);
      lb('flat_c', x, cyCounter - 0.2, 1.1, 2.9, 0.04, 1, '1E3560', 0.05);
      lb('flat', x - 1.47, cyCounter, 0, 0.06, 0.08, 1.04, STEEL, 0.3);
      if (Math.abs(x) < 6) lb('flat', x, cyCounter - 0.9, 0, 0.5, 0.5, 0.5, CHAIR, 0.8);
    }
    for (const dy of [1.7, 2.9]) {
      const y = cyCounter + dy, placed: number[] = [];
      for (let i = 0; i < 4; i++) { const x = -2.25 + 1.5 * i; if (!claim(x, y, 0.16, 0.16)) continue; cyl('cyl', x, y, 0, 6, 95, STEEL, 0.3); cyl('cyl', x, y, 3, 32, 3, STEEL, 0.3); placed.push(x); }
      for (let i = 1; i < placed.length; i++) if (placed[i] - placed[i - 1] < 1.6) lb('flat', (placed[i] + placed[i - 1]) / 2, y, 0.84, 1.44, 0.03, 0.06, '1E3560', 0.5);
    }
  } else if (mode === 'shop') {
    for (let x = -Rx + 3.5; x <= Rx - 3.5; x += 6.5) {
      const y = -Ry + 4; if (!claim(x, y, 1.9, 2.4)) continue;
      for (const s of [-1.7, 1.7]) lb('flat_c', x + s, y, 0, 0.3, 0.4, 3, 'B03024', 0.5);
      lb('flat', x, y, 2, 3.1, 4.6, 0.12, STEEL, 0.3);
    }
    for (let T = -walls[0].len / 2 + 1.5; T <= walls[0].len / 2 - 1.5; T += 3) {
      if (!wclaim(0, T, 0.4, 2, 0.7)) continue;
      wb('flat_c', 0, T, 0.4, 0, 200, 70, 90, WOOD, 0.7); wb('flat', 0, T - 0.5, 0.4, 90, 60, 35, 30, 'B03024', 0.5);
      wb('flat', 0, T, 0.03, 120, 200, 3, 100, CHAIR, 0.8);
    }
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
      const x = sx * (Rx - 0.45 - (i % 2) * 0.75), y = Ry - 0.45 - Math.floor(i / 2) * 0.75;
      if (!claim(x, y, 0.35, 0.35)) continue;
      for (let k = 0; k < 4; k++) cyl('cyl_c', x, y, k * 23, 66, 21, '1A1A1A', 0.9);
    }
    for (const w of [1, 2, 3]) for (let T = -walls[w].len / 2 + 1.5; T <= walls[w].len / 2 - 1.5; T += 3) {
      if (wclaim(w, T, 0.35, 2.6, 0.6)) wb('flat_c', w, T, 0.35, 0, 260, 60, 210, WOOD, 0.7);
    }
  } else if (mode === 'safehouse') {
    lb('flat_ns', 0, 0, 0.03, 5.2, 3.6, 0.012, '8E3B2A', 1);
    for (const y of [0, -Ry / 2, Ry / 2]) {
      if (!claim(Rx - 2.4, y, 2.4, 1.3)) continue;
      lb('flat_ns', Rx - 2.5, y, 0.03, 3, 2.4, 0.012, '8E3B2A', 1);
      lb('flat_c', Rx - 0.3, y, 0, 0.45, 1.6, 0.55, WOOD, 0.7); lb('flat', Rx - 0.3, y, 0.55, 0.08, 1.3, 0.75, BLACK, 0.4);
      lb('flat_c', Rx - 2.3, y, 0, 0.6, 1.1, 0.4, WOOD, 0.7);
      lb('flat_c', Rx - 3.8, y, 0, 0.9, 2.2, 0.45, '2F5D8A', 1); lb('flat_c', Rx - 4.35, y, 0, 0.2, 2.2, 0.85, '2F5D8A', 1);
      for (const s of [-1.2, 1.2]) lb('flat_c', Rx - 3.85, y + s, 0, 1, 0.2, 0.62, '2F5D8A', 1);
      break;
    }
    if (claim(-Rx + 1, Ry - 1, 0.95, 0.95)) {
      for (const [a, b] of [[0.5, 0.5], [1.45, 0.55], [0.55, 1.45]]) lb('flat_c', -Rx + a, Ry - b, 0, 0.85, 0.85, 0.75, '9A7448', 0.85);
      lb('flat_c', -Rx + 0.75, Ry - 0.75, 0.75, 0.75, 0.75, 0.65, '9A7448', 0.85);
    }
    for (const w of [0, 1]) for (let T = -walls[w].len / 2 + 1.3; T <= walls[w].len / 2 - 1.3; T += 2.4) {
      if (!wclaim(w, T, 0.55, 2.1, 1.0)) continue;
      // bed: 205 long along the wall-normal? source: frame 205 x 95 (along x out) -> beds stand out from the wall
      wb('flat_c', w, T, 0.55, 0, 95, 205, 30, WOOD, 0.7); wb('flat', w, T, 0.55, 30, 90, 200, 20, WHITE, 0.9);
      wb('flat', w, T, 0.55 - 0.78 + 0.78, 50, 70, 35, 10, 'E4E2DC', 0.9);
    }
  } else if (mode === 'airport') {
    for (const sx of [-0.5, 0.5]) for (const sy of [-0.4, 0.4]) lb('flat_c', sx * Rx, sy * Ry, 0, 0.9, 0.9, H, 'F2F2EE', 0.6);
    const RowHalf = Rx - 3;
    if (wclaim(0, 0, 0.75, 2 * RowHalf, 0.9)) wb('flat_c', 0, 0, 0.75, 0, 2 * RowHalf * 100, 60, 45, BLACK, 0.4);
    for (let T = -RowHalf + 1.3; T <= RowHalf - 1.3; T += 3.4) {
      if (!wclaim(0, T, 2.2, 2.6, 0.7)) continue;
      wb('flat_c', 0, T, 2.2, 0, 260, 70, 110, 'E8E8E4', 0.4); wb('flat', 0, T, 0.03, 230, 200, 4, 45, '1F4FA0', 0.5);
    }
    const BL = Math.min(2 * Rx - 4, 9);
    wb('flat', 3, 0, 0.1, 320, BL * 100, 20, 260, BLACK, 0.4);
    wb('flat', 3, 0, 0.21, 545, BL * 100 - 60, 2, 22, 'FFC72C', 0.5);
    for (let i = 0; i < 5; i++) wb('flat', 3, i % 2 ? 0.6 : 0, 0.21, 350 + 38 * i, BL * 100 - 60 - (i % 2 ? 120 : 0), 2, 12, 'FFC72C', 0.5);
    for (const [x, y] of [[-(Rx - 7), 0], [Rx - 7, 0], [0, -Ry + 6.5]]) if (claim(x, y, 4.8, 1.4)) {
      lb('flat_c', x, y, 0, 6.5, 1.6, 0.45, BLACK, 0.4); for (const s of [-3.25, 3.25]) cyl('cyl', x + s, y, 0, 160, 45, BLACK);
      lb('flat', x, y, 0, 7, 0.4, 0.7, STEEL, 0.3); break;
    }
    for (let y = -Ry + 6; y <= Ry - 2.5; y += 4) for (let x = -Rx + 3.5; x <= Rx - 3.5; x += 6) {
      if (!claim(x, y, 2.5, 0.45)) continue;
      lb('flat_c', x, y, 0, 5, 0.6, 0.45, '3A4A5C', 0.6); lb('flat', x, y - 0.35, 0, 5, 0.12, 0.85, '3A4A5C', 0.6);
    }
  } else if (mode === 'forger') {
    if (wclaim(0, 0, 2.6, 3.4, 5.2)) {
      wb('flat', 0, 0, 0.5, 0, 280, 4, 280, 'F4F4F0', 0.8); wb('flat', 0, 0, 0.5, 285, 310, 8, 8, STEEL, 0.3);
      for (const s of [-1.55, 1.55]) wb('flat', 0, s, 0.5, 0, 6, 6, 293, STEEL, 0.3);
      wb('flat', 0, 0, 1.5, 0, 40, 40, 50, CHAIR, 0.8);
      wb('flat', 0, 0, 4.4, 135, 22, 16, 16, BLACK, 0.4); wb('flat', 0, 0, 4.25, 138, 10, 14, 10, BLACK, 0.4);
      wb('flat', 0, 0, 4.4, 0, 6, 6, 135, BLACK, 0.4);
    }
    for (const w of [2, 1]) {
      const T = -Ry / 2;
      if (!wclaim(w, T, 0.9, 1.8, 1.8)) continue;
      wb('flat_c', w, T, 0.45, 0, 160, 80, 75, WOOD, 0.7);
      wb('flat', w, T + 0.55, 0.45, 75, 18, 18, 3, 'C9A24A', 0.35); wb('flat', w, T + 0.55, 0.45, 78, 3, 3, 40, 'C9A24A', 0.35);
      wb('flat', w, T + 0.55, 0.45, 112, 24, 30, 14, 'FFF3D0', 0.4);
      wb('flat', w, T, 1.3, 0, 50, 50, 48, CHAIR, 0.8);
      if (wclaim(w, T + 1.6, 0.4, 1.1, 0.8)) wb('flat_c', w, T + 1.6, 0.4, 0, 100, 70, 110, 'E8E8E4', 0.4);
      break;
    }
    for (let i = 0; i < 6; i++) { const T = -Ry + 1.5 + 0.55 * i; if (wclaim(1, T, 0.35, 0.5, 0.6)) wb('flat_c', 1, T, 0.35, 0, 50, 60, 130, STEEL, 0.3); }
  }

  // ---- sign
  const SIGN: Record<string, [string, string, string | null, string]> = {
    bank: ['1F4E9A', 'FFFFFF', null, spot.name.toUpperCase()], airport: ['1F4E9A', 'FFFFFF', null, 'DEPARTURES'],
    casino: ['4A1070', 'FFCD3C', 'D4A017', spot.name.toUpperCase()], job: ['C41E24', 'FFC72C', 'FFC72C', "McSHEKEL'S"],
    shop: ['E07020', '141414', null, spot.name.split(' - ')[0].toUpperCase()], forger: ['5F6368', 'FFFFFF', null, 'PASSPORT PHOTOS'],
  };
  const s = SIGN[mode];
  if (s) {
    const [sx, sy] = W(0, Ry + 0.62);
    g.signs.push({ x: sx, y: sy, z: 4.95, yaw: Math.atan2(D[1], D[0]) / DEG, w: 2 * Rx - 0.6, text: s[3], board: s[0], ink: s[1], edging: s[2] });
  }
  // ---- lights
  const Lh = 2 * Math.max(hX, hD), N = Math.max(1, Math.min(5, Math.ceil(Lh / 25)));
  const longX = hX >= hD;
  for (let i = 0; i < N; i++) {
    const t = ((i + 0.5) / N - 0.5) * Lh * 0.98;
    const [x, y] = longX ? [t, 0] : [0, t];
    const [wx, wy] = W(x, y);
    g.lights.push({ x: wx, y: wy, z: H - 0.8, radius: Math.max(2 * Math.min(hX, hD), 25) });
    lb('flat_ns', x, y, H - 0.14, 1.4, 1.4, 0.14, 'FFF3D0', 0.15);
    if (mode === 'casino') { lb('flat', x, y, H - 1.95, 0.08, 0.08, 1.81, 'D4A017', 0.25); cyl('cyl', x, y, H * 100 - 220, 260, 25, 'D4A017', 0.25); cyl('cyl', x, y, H * 100 - 260, 150, 40, 'D4A017', 0.25); }
  }
  const outer: [number, number] = W(0, hD);
  g.shells.push({ spotIdx, mode, building: f.id, cx: f.cx, cy: f.cy, L: f.L, W: f.W, yaw: f.yaw, dx: D[0], dy: D[1], doorX: outer[0], doorY: outer[1], H });
  spot.shell = g.shells.length - 1;
}
