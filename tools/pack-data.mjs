// Packs data/ (world.json + per-inset OSM-derived files) into public/data/world.pack.json (spec 01 §29)
// and asserts the sensitive-site guardrail at build time (no spot inside a 75 m buffer).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const data = path.join(root, 'data');
const out = path.join(root, 'public/data/world.pack.json');

// Road style table order is shared with src/world/roads.ts (STYLE_NAMES).
const STYLE_NAMES = ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary',
  'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'service', 'track',
  'pedestrian', 'footway', 'path', 'cycleway', 'steps'];

const dm = (v) => Math.round(v * 10);
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const world = read(path.join(data, 'zones/world.json'));

const insets = [];
let fails = 0;
for (const ins of world.insets) {
  const dir = path.join(data, ins.gen);
  const meta = read(path.join(dir, 'inset.json'));
  const csv = fs.readFileSync(path.join(dir, 'buildings.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
  const bIds = [], bNum = [];
  for (const line of csv) {
    const [id, x, y, w, l, yaw, lv] = line.split(',');
    bIds.push(id);
    bNum.push(Math.round(+x * 100), Math.round(+y * 100), Math.round(+w * 100), Math.round(+l * 100),
      Math.round(+yaw * 100), +lv);
  }
  const roads = read(path.join(dir, 'roads.json'));
  const rIds = [], rType = [], rLen = [], rPts = [];
  for (const r of roads) {
    const t = STYLE_NAMES.indexOf(r.highway);
    if (t < 0) continue; // unstyled types are skipped at runtime anyway (spec 01 §8)
    rIds.push(r.id); rType.push(t); rLen.push(r.pts.length);
    for (const [x, y] of r.pts) rPts.push(dm(x), dm(y));
  }
  const pois = read(path.join(dir, 'pois.json'));
  const parks = pois.filter((p) => p.kind === 'leisure=park').map((p) => [p.id, dm(p.x), dm(p.y), Math.round(p.area_m2 || 0)]);
  const kiosks = pois.filter((p) => p.kind === 'shop=kiosk').map((p) => [dm(p.x), dm(p.y)]);
  insets.push({
    name: ins.name, offset: ins.offset, attribution: meta.attribution,
    land_rows: (meta.land_rows || []).map((r) => r.map(dm)),
    piers: (meta.piers || []).map((pl) => pl.flatMap(([x, y]) => [dm(x), dm(y)])),
    b_ids: bIds, b: bNum, r_ids: rIds, r_type: rType, r_len: rLen, r_pts: rPts, parks, kiosks,
  });

  // Guardrail: every spot of this inset clears every sensitive buffer (spec 01 §3.4, §27).
  const sens = read(path.join(dir, 'sensitive.json'));
  for (const s of world.spots.filter((sp) => sp.inset === ins.name)) {
    const px = s.x - ins.offset[0], py = s.y - ins.offset[1];
    for (const site of sens) {
      const d = siteDistance(site, px, py);
      if (d < site.buffer_m) { fails++; console.error(`SENSITIVE FAIL ${s.mode} "${s.name}" ${d.toFixed(1)} m from ${site.kind} ${site.id}`); }
    }
  }
}

function siteDistance(site, x, y) {
  if (!site.rings) return Math.hypot(x - site.x, y - site.y);
  let best = Infinity, inside = false;
  for (const ring of site.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j], [bx, by] = ring[i];
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  }
  return inside ? 0 : best;
}

if (fails) { console.error(`pack-data: ${fails} spot(s) inside sensitive buffers`); process.exit(1); }

const pack = { v: 1, styles: STYLE_NAMES, world: { bounds: world.bounds, west_coast: world.west_coast,
  highways: world.highways, zones: world.zones, spots: world.spots }, insets };
const json = JSON.stringify(pack);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, json);
console.log(`pack-data: ${out} ${json.length} bytes raw / ${zlib.gzipSync(json, { level: 9 }).length} gzip; ` +
  `${world.spots.length} spots clear of sensitive buffers`);
