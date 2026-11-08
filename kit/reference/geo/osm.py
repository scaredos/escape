"""Cut a 1:1 inset out of the OSM extract into Data/gen/<inset>/ for the game (AEscCity) and zones.py.

    python osm.py --inset telaviv|haifa|jerusalem|eilat      (or --inset all)   [--footprints Saved/Agent]

Coordinates: local equirectangular metres, origin = inset SW corner, x = east, y = north.
Outputs (Data/gen/<inset>/):
  buildings.csv   id,x,y,width,length,yaw,levels   one game box per row: x,y = centre, width <= length,
                  yaw = degrees CCW from +x to the box's length axis, levels = building:levels else 4.
                  A footprint filling >= FILL_KEEP of its min-area oriented box is that box, shrunk to <= AREA_SLACK
                  x its area; any other is split into up to MAX_PARTS rectangles in that box's frame (rows <id>,
                  <id>_2, ... largest first). Then boxes of different buildings are trimmed (largest first) to stay
                  GAP_CUT apart, or dropped if that leaves them under MIN_DIM; every outer wall is set in INSET_M so
                  neighbours never share a plane. Shell buildings (world.json spots) keep their min-area box as is
  roads.json      [{id, highway, name, pts:[[x,y],..]}]  clipped to segments touching the box
  pois.json       [{id, kind, name, brand, x, y, area_m2?, building, usable}]  gameplay spot candidates, never
                  sensitive; building = id of the smallest min-area box, of a building still in buildings.csv,
                  containing the POI ("" = outdoors),
                  usable = outside every sensitive buffer. kind "escape_boat" = the Jaffa pier tip, if it clears
  sensitive.json  [{id, kind, tag, name, x, y, buffer_m, rings?}]  kind = worship|cemetery|school|hospital|
                  historic_major; rings = footprint polygons (areas only); the buffer is measured from the
                  footprint edge (from x,y for points). Includes sites whose buffer reaches into the box
  inset.json      {name, sw, size_m, proj, attribution, coast:[polylines], piers:[polylines], land_rows}
                  land_rows[i] = land intervals [x0, x1, x0, x1, ...] of the 10 m row y in [10i, 10i+10] (sampled at
                  its centre), clipped to 0..size_m: from the OSM coastline where it crosses the row (open coastline
                  only, land left of the way direction; closed islet rings are ignored), else the Copernicus water
                  mask (ocean = water; lakes and rivers count as land)
  preview.png     sea drawn from land_rows
Minor historic objects (cannons, plaques, benchmarks...) are ordinary features. Military features are
dropped entirely. Data (c) OpenStreetMap contributors, ODbL 1.0.
"""
import argparse, csv, json, math, os, pathlib, re

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import osmium
import rasterio
from matplotlib.collections import LineCollection, PolyCollection
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch
from matplotlib.path import Path
from scipy.spatial import ConvexHull, QhullError

ROOT = pathlib.Path(os.path.abspath(__file__)).parents[2]  # not resolve(): breaks under the app's virtualised AppData
RAW, GEN_ROOT = ROOT / "Data" / "raw", ROOT / "Data" / "gen"
PBF = RAW / "israel-and-palestine-latest.osm.pbf"
WBM = "Copernicus_DSM_COG_10_N{:02d}_00_E{:03d}_00_WBM.tif"  # 1x1 degree tiles named by their SW corner (fetch.py)

INSETS = {  # sw = SW corner lat, lon; boat = escape dock anchor (lat, lon), snapped to the nearest pier vertex
    "telaviv": {"sw": (32.044, 34.7465),  # Ajami/Jaffa port up to Charles Clore & Neve Tzedek
                "boat": (32.05574, 34.75013), "boat_name": "Jaffa port pier tip"},  # Jaffa breakwater, harbour mouth
    "haifa": {"sw": (32.8135, 34.9855),  # German Colony (Ben Gurion Blvd), downtown/Paris Sq, the port
              "boat": (32.82064, 35.00474), "boat_name": "Haifa port pier tip"},  # finger pier by downtown
    "jerusalem": {"sw": (31.7765, 35.203)},  # Jaffa Rd, Mahane Yehuda, Ben Yehuda, King George; Old City east of it
    "eilat": {"sw": (29.542, 34.943)},  # city centre, north beach, marina/lagoon (the port is 3 km SW: out)
}
SIZE = 2000.0
ROW = 10.0  # land_rows spacing (m)
R = 6371008.8
BUFFER_M = {"worship": 75, "cemetery": 75, "school": 75, "hospital": 75, "historic_major": 75}  # user rule
# building footprints -> game boxes (see buildings.csv above), metres
FILL_KEEP, AREA_SLACK, COVER, MAX_PARTS = 0.85, 1.03, 0.90, 6
MIN_DIM, INSET_M, GAP_MIN, GAP_CUT = 3.0, 0.15, 0.15, 0.3  # boxes nearer than GAP_MIN (after the inset) get cut
MIN_KEEP = 2.0  # game boxes (parts, shrunk sheds) narrower than this are dropped: slivers and 1 m pillars
ATTRIBUTION = ("Map data (c) OpenStreetMap contributors, ODbL 1.0. "
               "Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, "
               "provided under COPERNICUS by the European Union and ESA.")

KEYS = ("building", "highway", "natural", "shop", "amenity", "tourism", "leisure", "man_made",
        "harbour", "industrial", "landuse", "historic", "religion", "military", "aeroway")
WORSHIP_BUILDINGS = {"church", "mosque", "synagogue", "temple", "cathedral", "chapel", "shrine", "religious"}
MINOR_HISTORIC = {"cannon", "memorial", "plaque", "blue_plaque", "boundary_stone", "milestone", "survey_point",
                  "railway_car", "locomotive", "wreck", "aircraft", "tank", "vehicle", "ship", "anchor",
                  "wayside_cross", "stone", "highwater_mark", "pillory", "bench"}  # small objects, not sites
PIERS = {"pier", "breakwater", "groyne"}
POI = {  # key -> allowed values (None = any)
    "shop": None,
    "amenity": {"marketplace", "fuel", "parking", "cafe", "restaurant", "fast_food", "bar", "pub", "nightclub",
                "ice_cream", "bank", "atm", "bureau_de_change", "pharmacy", "car_rental", "car_wash",
                "bicycle_rental", "ferry_terminal", "bus_station", "post_office"},
    "tourism": {"hotel", "hostel", "guest_house", "viewpoint"},
    "leisure": {"marina", "park"},
    "man_made": {"pier", "lighthouse"},
    "harbour": None,
    "industrial": {"port"},
    "landuse": {"harbour", "port"},
    "aeroway": {"helipad", "heliport"},
}
ROAD_STYLE = {  # highway -> (linewidth, colour); default = small road
    **dict.fromkeys(["motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link",
                     "primary_link", "secondary_link", "tertiary_link"], (2.4, "#555555")),
    **dict.fromkeys(["footway", "path", "steps", "pedestrian", "cycleway", "corridor", "track", "bridleway"],
                    (0.5, "#b0a080")),
}


def sensitive_kind(t):
    """-> (kind, triggering tag) or None."""
    a, lu, h = t.get("amenity"), t.get("landuse"), t.get("historic")
    if a in ("school", "hospital"):
        return a, f"amenity={a}"
    if a == "grave_yard" or lu == "cemetery":
        return "cemetery", f"amenity={a}" if a == "grave_yard" else "landuse=cemetery"
    if a == "place_of_worship":
        return "worship", "amenity=place_of_worship"
    if t.get("building") in WORSHIP_BUILDINGS:
        return "worship", f"building={t['building']}"
    if lu == "religious":
        return "worship", "landuse=religious"
    if "religion" in t:
        return "worship", f"religion={t['religion']}"
    if t.get("memorial") == "war_memorial":
        return "historic_major", "memorial=war_memorial"
    if h and h not in MINOR_HISTORIC:
        return "historic_major", f"historic={h}"
    return None


def poi_kind(t):
    for k, vals in POI.items():
        v = t.get(k)
        if v and (vals is None or v in vals):
            return f"{k}={v}"
    return None


def site_dist(P, s):
    """Metres from points P (n,2) to sensitive site s: to its footprint edge (0 inside), else to its point."""
    if "rings" not in s:
        return np.hypot(P[:, 0] - s["x"], P[:, 1] - s["y"])
    d = np.full(len(P), np.inf)
    for ring in s["rings"]:
        a = np.asarray(ring, float)
        for (ax, ay), (bx, by) in zip(a, a[1:]):
            dx, dy = bx - ax, by - ay
            t = np.clip(((P[:, 0] - ax) * dx + (P[:, 1] - ay) * dy) / max(dx * dx + dy * dy, 1e-9), 0, 1)
            d = np.minimum(d, np.hypot(P[:, 0] - ax - t * dx, P[:, 1] - ay - t * dy))
        d[Path(a).contains_points(P)] = 0
    return d


def clearance(P, sens):
    """Metres by which each point clears every site's buffer (negative = inside a buffer)."""
    P = np.asarray(P, float).reshape(-1, 2)
    return np.min([site_dist(P, s) - s["buffer_m"] for s in sens], axis=0)


def containing_building(pts, buildings):
    """Id of the smallest building box (1 m tolerance) containing each point, '' if none."""
    B = np.array([b[1:6] for b in buildings], float)  # cx, cy, width, length, yaw
    a, size = np.radians(B[:, 4]), B[:, 2] * B[:, 3]
    out = []
    for px, py in pts:
        dx, dy = px - B[:, 0], py - B[:, 1]
        hit = ((np.abs(dx * np.cos(a) + dy * np.sin(a)) <= B[:, 3] / 2 + 1) &
               (np.abs(-dx * np.sin(a) + dy * np.cos(a)) <= B[:, 2] / 2 + 1))
        out.append(buildings[np.flatnonzero(hit)[np.argmin(size[hit])]][0] if hit.any() else "")
    return out


def obb(p):
    """Min-area oriented box of points p (n,2) -> cx, cy, width, length, yaw_deg (length >= width)."""
    h = p[ConvexHull(p).vertices]
    e = np.diff(np.vstack([h, h[:1]]), axis=0)
    a = np.arctan2(e[:, 1], e[:, 0])
    u, v = np.stack([np.cos(a), np.sin(a)], 1), np.stack([-np.sin(a), np.cos(a)], 1)
    pu, pv = h @ u.T, h @ v.T  # (n, k)
    du, dv = np.ptp(pu, 0), np.ptp(pv, 0)
    i = int(np.argmin(du * dv))
    c = u[i] * (pu[:, i].min() + pu[:, i].max()) / 2 + v[i] * (pv[:, i].min() + pv[:, i].max()) / 2
    yaw = math.degrees(a[i]) + (0 if du[i] >= dv[i] else 90)
    return c[0], c[1], min(du[i], dv[i]), max(du[i], dv[i]), yaw % 180


def ring_area(r):
    return abs(np.dot(r[:, 0], np.roll(r[:, 1], 1)) - np.dot(r[:, 1], np.roll(r[:, 0], 1))) / 2


def max_rect(m, rmin, cmin):
    """Largest all-True rectangle of bool grid m at least rmin rows x cmin cols -> (r0, r1, c0, c1) or None
    (histogram stack per row: every maximal rectangle is a candidate, so the size limits filter exactly)."""
    h, best, out = np.zeros(m.shape[1], int), 0, None
    for r, row in enumerate(m):
        h = np.where(row, h + 1, 0)
        stack = []  # (first col, height)
        for c, hc in enumerate([*h.tolist(), 0]):
            start = c
            while stack and stack[-1][1] >= hc:
                s, hs = stack.pop()
                if hs >= rmin and c - s >= cmin and hs * (c - s) > best:
                    best, out = hs * (c - s), (r - hs + 1, r + 1, s, c)
                start = s
            stack.append((start, hc))
    return out


def footprint(box, outer, holes, area):
    """Game boxes (cx, cy, w, l, yaw) for one footprint (rings in metres) whose min-area box is `box`."""
    cx, cy, w, l, yaw = box
    a = math.radians(yaw)
    u, v = np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)])

    def part(s0, s1, t0, t1):  # rectangle in the box frame (s along u, t along v) -> box
        c = (cx, cy) + u * (s0 + s1) / 2 + v * (t0 + t1) / 2
        return c[0], c[1], t1 - t0, s1 - s0, yaw

    def whole():  # the box, every side in by d so its area is <= AREA_SLACK x the footprint's
        e = l * w - AREA_SLACK * area
        d = min(w / 4, max(INSET_M, ((l + w) - math.sqrt((l + w) ** 2 - 4 * e)) / 4 if e > 0 else 0))
        return [part(-l / 2 + d, l / 2 - d, -w / 2 + d, w / 2 - d)]

    if area >= FILL_KEEP * l * w:
        return whole()
    # irregular: rasterise in the box frame, peel off the largest rectangles
    res = min(1.0, max(0.5, math.sqrt(l * w) / 40))
    ns, nt = max(1, math.ceil(l / res - 1e-6)), max(1, math.ceil(w / res - 1e-6))
    ds, dt = l / ns, w / nt
    S, T = np.meshgrid(-l / 2 + (np.arange(ns) + 0.5) * ds, -w / 2 + (np.arange(nt) + 0.5) * dt)  # rows = t
    G = np.column_stack([S.ravel(), T.ravel()])
    frame = lambda r: (r - (cx, cy)) @ np.column_stack([u, v])
    m = Path(frame(outer)).contains_points(G)
    for hole in holes:
        m &= ~Path(frame(hole)).contains_points(G)
    m = m.reshape(nt, ns)
    left, mind, parts = m.copy(), min(MIN_DIM, w / 2), []
    while len(parts) < MAX_PARTS and m.sum() - left.sum() < COVER * m.sum():
        p = max_rect(left, math.ceil(mind / dt - 1e-6), math.ceil(mind / ds - 1e-6))
        if not p:
            break
        left[p[0]:p[1], p[2]:p[3]] = False
        parts.append(p)
    if not parts:  # nothing MIN_DIM wide in it (thin or tiny): keep the shrunk box
        return whole()
    out = []
    for i, (r0, r1, c0, c1) in enumerate(parts):  # walls against another part of the building are not set in
        o = parts[:i] + parts[i + 1:]
        rows, cols = lambda q: q[0] < r1 and r0 < q[1], lambda q: q[2] < c1 and c0 < q[3]
        out.append(part(-l / 2 + c0 * ds + INSET_M * (not any(q[3] == c0 and rows(q) for q in o)),
                        -l / 2 + c1 * ds - INSET_M * (not any(q[2] == c1 and rows(q) for q in o)),
                        -w / 2 + r0 * dt + INSET_M * (not any(q[1] == r0 and cols(q) for q in o)),
                        -w / 2 + r1 * dt - INSET_M * (not any(q[0] == r1 and cols(q) for q in o))))
    return out


def box_corners(b):
    cx, cy, w, l, yaw = b
    a = math.radians(yaw)
    ux, uy, vx, vy = math.cos(a) * l / 2, math.sin(a) * l / 2, -math.sin(a) * w / 2, math.cos(a) * w / 2
    return [(cx + i * ux + j * vx, cy + i * uy + j * vy) for i, j in ((1, 1), (-1, 1), (-1, -1), (1, -1))]


def box_gap(a, b):
    """Separation of boxes (cx, cy, w, l, yaw) on the best of their edge normals: > 0 apart, < 0 = overlap depth."""
    ca, cb, best = box_corners(a), box_corners(b), -math.inf
    for yaw in (a[4], b[4]):
        r = math.radians(yaw)
        for nx, ny in ((math.cos(r), math.sin(r)), (-math.sin(r), math.cos(r))):
            pa, pb = [x * nx + y * ny for x, y in ca], [x * nx + y * ny for x, y in cb]
            best = max(best, min(pb) - max(pa), min(pa) - max(pb))
    return best


def trim(b, side, d):
    """Box b with one side moved in by d: side 0/1 = +/- end (along the length), 2/3 = +/- long side."""
    cx, cy, w, l, yaw = b
    a, k = math.radians(yaw), (1, -1, 1, -1)[side] * d / 2
    if side < 2:
        return cx - k * math.cos(a), cy - k * math.sin(a), w, l - d, yaw
    return cx + k * math.sin(a), cy - k * math.cos(a), w - d, l, yaw


def clear_of(b, a):
    """b trimmed on the one side that loses least area until it is GAP_CUT clear of a; None if that needs it
    thinner than MIN_DIM."""
    best = None
    for side in range(4):
        lo, hi = 0.0, (b[3] if side < 2 else b[2]) - MIN_DIM
        if hi <= 0 or box_gap(trim(b, side, hi), a) < GAP_CUT:
            continue
        for _ in range(16):  # trimming more only shrinks b, so the gap is monotonic in d
            mid = (lo + hi) / 2
            lo, hi = (lo, mid) if box_gap(trim(b, side, mid), a) >= GAP_CUT else (mid, hi)
        loss = hi * (b[2] if side < 2 else b[3])
        if best is None or loss < best[0]:
            best = (loss, trim(b, side, hi))
    return best and best[1]


def separate(parts, pinned):
    """parts [(osm id, box)] -> kept flags and final boxes. Shells (pinned ids) first and untouched, then the largest
    first: a box nearer than GAP_MIN to a kept box of another building is trimmed clear of it, or dropped."""
    C = np.array([b[:2] for _, b in parts])
    rad = np.array([math.hypot(b[2], b[3]) / 2 for _, b in parts])
    kept, out = np.zeros(len(parts), bool), [b for _, b in parts]
    for i in sorted(range(len(parts)), key=lambda i: (parts[i][0] not in pinned, -parts[i][1][2] * parts[i][1][3])):
        oid, b = parts[i]
        if oid not in pinned:
            near = np.flatnonzero(kept & (np.hypot(*(C - C[i]).T) < rad + rad[i] + GAP_CUT))
            for j in sorted(near, key=lambda j: box_gap(b, out[j])):  # deepest overlap first
                if parts[j][0] != oid and box_gap(b, out[j]) < GAP_MIN:
                    b = clear_of(b, out[j])
                    if b is None:
                        break
            if b is None:
                continue
        out[i], C[i], rad[i], kept[i] = b, b[:2], math.hypot(b[2], b[3]) / 2, True
    return kept, out


def overlap_pairs(rows, slack, same=False):
    """Index pairs of buildings.csv rows of different buildings (same=True: of one building) overlapping more than
    slack metres deep."""
    B = np.array([r[1:6] for r in rows], float)
    rad, base, out = np.hypot(B[:, 2], B[:, 3]) / 2, [r[0].split("_")[0] for r in rows], []
    for i in range(len(rows)):
        for j in np.flatnonzero(np.hypot(*(B[i + 1:, :2] - B[i, :2]).T) < rad[i + 1:] + rad[i]) + i + 1:
            if (base[i] == base[j]) == same and box_gap(B[i], B[j]) < -slack:
                out.append((i, int(j)))
    return out


def fit(shapes, rows, step=0.5):
    """(box area outside the OSM outlines, outline area no box covers) in m2, sampled every step metres."""
    boxes = {}
    for r in rows:
        boxes.setdefault(r[0].split("_")[0], []).append(r[1:6])
    over = miss = 0
    for oid, _, outer, holes, (cx, cy, w, l, yaw), _ in shapes:
        a = math.radians(yaw)
        s, t = np.meshgrid(np.arange(-l / 2 + step / 2, l / 2, step), np.arange(-w / 2 + step / 2, w / 2, step))
        P = np.column_stack([cx + s.ravel() * math.cos(a) - t.ravel() * math.sin(a),
                             cy + s.ravel() * math.sin(a) + t.ravel() * math.cos(a)])
        poly = Path(outer).contains_points(P)
        for hole in holes:
            poly &= ~Path(hole).contains_points(P)
        hit = np.zeros(len(P), bool)
        for bx, by, bw, bl, byaw in boxes.get(oid, []):
            b, d = math.radians(byaw), P - (bx, by)
            hit |= (np.abs(d @ (math.cos(b), math.sin(b))) <= bl / 2) & (np.abs(d @ (-math.sin(b), math.cos(b))) <= bw / 2)
        over, miss = over + np.sum(hit & ~poly), miss + np.sum(poly & ~hit)
    return over * step ** 2, miss * step ** 2


def spot_buildings():
    """Ids of the buildings the game hollows into shells (Data/zones/world.json spots)."""
    w = ROOT / "Data" / "zones" / "world.json"
    spots = json.loads(w.read_text(encoding="utf-8"))["spots"] if w.exists() else []
    return {s["building"] for s in spots if s.get("building")}


def levels(t):
    m = re.search(r"\d+(\.\d+)?", t.get("building:levels", ""))
    return max(1, round(float(m.group()))) if m else 4


def sea_mask(lon, lat):
    """True where the Copernicus water mask says ocean (1), reading every tile the points fall in."""
    sea = np.zeros(lon.shape, bool)
    for tlat, tlon in {(math.floor(a), math.floor(o)) for a in (lat.min(), lat.max()) for o in (lon.min(), lon.max())}:
        with rasterio.open(RAW / WBM.format(tlat, tlon)) as src:  # missing tile: run fetch.py
            r, c = rasterio.transform.rowcol(src.transform, lon, lat)
            r, c = np.asarray(r), np.asarray(c)
            ok = (r >= 0) & (r < src.height) & (c >= 0) & (c < src.width)
            sea[ok] = src.read(1)[r[ok], c[ok]] == 1
    return sea


def land_rows(coast, lon0, lat0, kx, ky):
    """Land intervals per 10 m row (see the module doc): OSM coastline crossings where there are any, else the WBM."""
    segs = [(a, b) for line in coast if line[0] != line[-1] for a, b in zip(line, line[1:])]  # open coastline only
    xs = np.arange(0.5, SIZE, 1.0)  # 1 m WBM samples
    ys = (np.arange(SIZE / ROW) + 0.5) * ROW
    gx, gy = np.meshgrid(lon0 + xs / kx, lat0 + ys / ky)
    wet = sea_mask(gx.ravel(), gy.ravel()).reshape(gx.shape)  # (row, x)
    rows = []
    for i, y in enumerate(ys):
        cross = sorted((ax + (y - ay) / (by - ay) * (bx - ax), by < ay)  # southbound way: land (left) is east
                       for (ax, ay), (bx, by) in segs if ay <= y < by or by <= y < ay)
        if cross:
            land = [not cross[0][1]] + [l for _, l in cross]  # state before the first crossing, then after each
            bounds = [-math.inf] + [x for x, _ in cross] + [math.inf]
            iv = [(bounds[k], bounds[k + 1]) for k in range(len(land)) if land[k]]
        else:
            d = np.flatnonzero(np.diff(np.r_[False, ~wet[i], False]))  # starts/ends of land runs, in 1 m samples
            iv = list(zip(d[::2].astype(float), d[1::2].astype(float)))
        out = []
        for x0, x1 in iv:
            x0, x1 = round(max(x0, 0.0), 1), round(min(x1, SIZE), 1)
            if x1 <= x0:
                continue
            if out and x0 <= out[-1]:  # touching intervals (land on both sides of a crossing)
                out[-1] = x1
            else:
                out += [x0, x1]
        rows.append(out)
    return rows


def boat_escape(anchor, pois, piers, coast, sens, label):
    """Pier vertex (else coastline vertex, e.g. a port quay) nearest the inset's boat anchor, checked against the
    buffers; returns (report lines, poi or None)."""
    pts = np.array([q for line in piers for q in line] or [(np.inf, np.inf)])
    tip = pts[np.argmin(np.hypot(*(pts - anchor).T))]
    if np.hypot(*(tip - anchor)) > 50 and coast:
        pts = np.array([q for line in coast for q in line])
        tip = pts[np.argmin(np.hypot(*(pts - anchor).T))]
    if np.hypot(*(tip - anchor)) > 50:
        return [f"no pier/breakwater within 50 m of the boat anchor {anchor.round()}: no boat escape"], None
    term = next((p for p in pois if p["kind"] == "amenity=ferry_terminal"), {"name": "?", "x": np.nan, "y": np.nan})
    worst = min(sens, key=lambda s: site_dist(tip[None], s)[0] - s["buffer_m"])
    d = site_dist(tip[None], worst)[0]
    out = [f"pier tip ({tip[0]:.0f}, {tip[1]:.0f}), {np.hypot(tip[0] - term['x'], tip[1] - term['y']):.0f} m "
           f"from '{term['name']}' ferry terminal; "
           f"nearest sensitive: {worst['name'] or worst['tag']} ({worst['kind']}) {d:.0f} m from footprint, "
           f"buffer {worst['buffer_m']} m -> clearance {d - worst['buffer_m']:+.0f} m"]
    if d >= worst["buffer_m"]:
        return out, {"id": "escape_boat", "kind": "escape_boat", "name": label, "brand": "",
                     "x": round(float(tip[0]), 1), "y": round(float(tip[1]), 1), "building": "", "usable": True}
    cand = np.array([q for line in coast + piers for q in line])
    cand = cand[clearance(cand, sens) >= 0]
    picks = []
    for q in sorted(cand, key=lambda q: np.hypot(*(q - tip))):  # nearest clear spots, at least 30 m apart
        if all(np.hypot(*(q - p)) >= 30 for p in picks):
            picks.append(q)
        if len(picks) == 3:
            break
    out += [f"  clear alternative ({q[0]:.0f}, {q[1]:.0f}): {np.hypot(*(q - tip)):.0f} m from tip, "
            f"clearance {clearance(q, sens)[0]:+.0f} m" for q in picks]
    return out, None


def run(name, png_dir=None):
    cfg = INSETS[name]
    lat0, lon0 = cfg["sw"]
    gen = GEN_ROOT / name
    ky = R * math.pi / 180
    kx = ky * math.cos(math.radians(lat0 + SIZE / ky / 2))
    proj = lambda lon, lat: ((lon - lon0) * kx, (lat - lat0) * ky)
    inside = lambda x, y, m=0.0: -m <= x <= SIZE + m and -m <= y <= SIZE + m
    near = 3000.0  # first-node prefilter margin; areas wider than this are skipped

    shapes, roads, pois, sens, coast, piers = [], [], [], [], [], []
    n_mil = n_bad = n_minor = 0
    fp = osmium.FileProcessor(str(PBF)).with_areas().with_filter(osmium.filter.KeyFilter(*KEYS))
    for o in fp:
        try:
            if o.is_node():
                x, y = proj(o.location.lon, o.location.lat)
                rings, oid = None, f"n{o.id}"
            elif o.is_way():
                is_coast, is_pier = o.tags.get("natural") == "coastline", o.tags.get("man_made") in PIERS
                if "highway" not in o.tags and not is_coast and not is_pier:
                    continue
                nd = o.nodes
                if not is_coast and not inside(*proj(nd[0].lon, nd[0].lat), near):  # coastline ways can be km long
                    continue
                pts = [proj(n.lon, n.lat) for n in nd]
                runs, cur = [], []
                for a, b in zip(pts, pts[1:]):  # keep segments with an end in the box
                    if inside(*a) or inside(*b):
                        cur = cur or [a]
                        cur.append(b)
                    elif cur:
                        runs.append(cur); cur = []
                runs += [cur] if cur else []
                for r in runs:
                    r = [[round(px, 1), round(py, 1)] for px, py in r]
                    if is_coast:
                        coast.append(r)
                    if is_pier:
                        piers.append(r)
                    if "highway" in o.tags:
                        roads.append({"id": f"w{o.id}", "highway": o.tags["highway"],
                                      "name": o.tags.get("name:en") or o.tags.get("name", ""), "pts": r})
                continue
            elif o.is_area():
                outer = list(o.outer_rings())
                if not outer or not inside(*proj(outer[0][0].lon, outer[0][0].lat), near):
                    continue
                rings = [np.array([proj(n.lon, n.lat) for n in ring]) for ring in outer]
                holes = [[np.array([proj(n.lon, n.lat) for n in h]) for h in o.inner_rings(ring)] for ring in outer] \
                    if o.tags.get("building", "no") != "no" else []
                allp = np.vstack(rings)
                x, y = allp.mean(0)
                oid = f"{'w' if o.from_way() else 'r'}{o.orig_id()}"
            else:
                continue
        except osmium.InvalidLocationError:
            continue

        t = dict(o.tags)
        if t.get("landuse") == "military" or "military" in t:
            n_mil += inside(x, y)
            continue
        label = t.get("name:en") or t.get("name", "")
        if rings is not None and t.get("building", "no") != "no":
            for ring, hs in zip(rings, holes):
                try:
                    box = obb(ring)
                except QhullError:
                    n_bad += 1
                    continue
                if inside(box[0], box[1]):
                    shapes.append((oid, levels(t), ring, hs, box, ring_area(ring) - sum(map(ring_area, hs))))
        rad = float(np.hypot(*(allp - (x, y)).T).max()) if rings is not None else 0.0
        sk = sensitive_kind(t)
        n_minor += bool(not sk and "historic" in t and inside(x, y))
        if sk and inside(x, y, rad + BUFFER_M[sk[0]]):
            s = {"id": oid, "kind": sk[0], "tag": sk[1], "name": label, "x": round(x, 1), "y": round(y, 1),
                 "buffer_m": BUFFER_M[sk[0]]}
            if rings is not None:
                s["rings"] = [r.round(1).tolist() for r in rings]
            sens.append(s)
        elif not sk and inside(x, y) and (pk := poi_kind(t)):
            p = {"id": oid, "kind": pk, "name": label, "brand": t.get("brand:en") or t.get("brand", ""),
                 "x": round(x, 1), "y": round(y, 1)}
            if rings is not None:  # shoelace footprint area: parking lots big enough for a helicopter etc.
                p["area_m2"] = round(sum(abs(np.dot(r[:, 0], np.roll(r[:, 1], 1)) - np.dot(r[:, 1], np.roll(r[:, 0], 1)))
                                         for r in rings) / 2)
            pois.append(p)

    row = lambda cx, cy, w, l, yaw, nd=1: (tuple(round(v, nd) for v in (cx, cy, w, l, yaw % 180)) if w <= l
                                           else row(cx, cy, l, w, yaw + 90, nd))
    boxes0 = [(oid, *row(*box), lv) for oid, lv, _, _, box, _ in shapes]  # one min-area box each, as before
    pinned = spot_buildings()
    parts = [(oid, lv, b) for oid, lv, ring, hs, box, area in shapes
             for b in ([box] if oid in pinned else footprint(box, ring, hs, area)) if oid in pinned or min(b[2], b[3]) >= MIN_KEEP]
    kept, final = separate([(oid, b) for oid, _, b in parts], pinned)
    groups = {}  # osm id -> [(levels, box)], in OSM order
    for (oid, lv, _), ok, b in zip(parts, kept, final):
        if ok and inside(b[0], b[1]):
            groups.setdefault(oid, []).append((lv, b))
    # parts of a split building in cm: 0.1 m rounding opened 0.1-0.24 m slits (or overlaps) between them
    buildings = [(oid if n == 1 else f"{oid}_{n}", *row(*b, 1 if len(ps) == 1 else 2), lv) for oid, ps in groups.items()
                 for n, (lv, b) in enumerate(sorted(ps, key=lambda p: -p[1][2] * p[1][3]), 1)]

    clear = clearance([(p["x"], p["y"]) for p in pois], sens)
    alive = [b for b in boxes0 if b[0] in groups]  # a dropped building is no POI's building: the next box round it is
    for p, c, b in zip(pois, clear, containing_building([(p["x"], p["y"]) for p in pois], alive)):
        p["building"], p["usable"] = b, bool(c >= 0)
    esc_report, esc = ["no boat anchor for this inset"], None
    if "boat" in cfg:
        esc_report, esc = boat_escape(np.array(proj(*cfg["boat"][::-1])), pois, piers, coast, sens, cfg["boat_name"])
    if esc:
        pois.append(esc)
    land = land_rows(coast, lon0, lat0, kx, ky)

    gen.mkdir(parents=True, exist_ok=True)
    with open(gen / "buildings.csv", "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows([("id", "x", "y", "width", "length", "yaw", "levels"), *buildings])

    def dump(fn, rows):  # one feature per line: readable and diff-friendly (Data/gen is committed)
        with open(gen / fn, "w", encoding="utf-8") as f:
            f.write("[\n" + ",\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n]\n")
    dump("roads.json", roads)
    dump("pois.json", pois)
    dump("sensitive.json", sens)
    with open(gen / "inset.json", "w", encoding="utf-8") as f:
        json.dump({"name": name, "sw": [lat0, lon0], "size_m": SIZE,
                   "proj": f"equirectangular, x=(lon-{lon0})*{kx:.3f}, y=(lat-{lat0})*{ky:.3f} metres",
                   "attribution": ATTRIBUTION, "coast": coast, "piers": piers, "land_rows": land}, f)

    preview(lat0, lon0, buildings, roads, pois, sens, coast, piers, land, name, gen)

    # self-check (the M0b gate + guardrail)
    sens_ids = {s["id"] for s in sens}
    osm_pois = [p for p in pois if p["kind"] != "escape_boat"]
    assert len(buildings) > 300 and roads, (len(buildings), len(roads))
    assert len(land) == SIZE / ROW and all(len(r) % 2 == 0 and r == sorted(r) for r in land)
    assert all(inside(b[1], b[2]) for b in buildings)
    assert sens and not any(p["id"] in sens_ids for p in pois)
    assert all(s["kind"] in BUFFER_M and s["buffer_m"] == BUFFER_M[s["kind"]] for s in sens)
    assert not any(s["tag"].split("=")[1] in MINOR_HISTORIC for s in sens if s["tag"].startswith("historic="))
    assert all(p["usable"] == (clearance((p["x"], p["y"]), sens)[0] >= 0) for p in pois)
    over0, over1 = overlap_pairs(boxes0, 0.3), overlap_pairs(buildings, 0.0)
    assert not over1 and not overlap_pairs(buildings, 0.05, same=True), (over1[:5], "boxes overlap")  # same: cm rounding
    assert {b for b in boxes0 if b[0] in pinned} <= set(buildings), "a shell building's box changed"
    assert all(b[3] >= MIN_KEEP or b[0] in pinned for b in buildings), "sliver box"
    assert {p["building"] for p in pois} - {""} <= {b[0] for b in buildings}, "a POI names a dropped building"
    kinds = {}
    for s in sens:
        kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    print(f"[{name}] buildings {len(buildings)}  roads {len(roads)}  pois {len(osm_pois)}  sensitive {len(sens)} {kinds}  "
          f"minor historic ignored {n_minor}  coast {len(coast)}  piers {len(piers)}  military dropped {n_mil}  "
          f"degenerate footprints {n_bad}")
    print(f"usable pois (outside every per-kind buffer): {sum(p['usable'] for p in osm_pois)}/{len(osm_pois)}")
    print("\n".join(esc_report))
    print("escape_boat written to pois.json" if esc else "escape_boat NOT written")
    print(f"land: {sum(r[k + 1] - r[k] for r in land for k in range(0, len(r), 2)) * ROW / SIZE ** 2:.0%} of the inset")
    area = lambda rows: sum(r[3] * r[4] for r in rows)
    (out0, miss0), (out1, miss1) = fit(shapes, boxes0), fit(shapes, buildings)
    print(f"footprints: {len(boxes0)} buildings -> {len(buildings)} boxes, "
          f"{sum(s[5] < FILL_KEEP * s[4][2] * s[4][3] for s in shapes)} irregular (fill < {FILL_KEEP}), "
          f"{sum(len(g) > 1 for g in groups.values())} split, {len(boxes0) - len(groups)} dropped; outlines {sum(s[5] for s in shapes):.0f} m2, "
          f"boxes {area(boxes0):.0f} -> {area(buildings):.0f} m2 (outside the outlines {out0:.0f} -> {out1:.0f}, "
          f"outline uncovered {miss0:.0f} -> {miss1:.0f}); box pairs overlapping > 0.3 m {len(over0)} -> "
          f"{len(overlap_pairs(buildings, 0.3))}, at all {len(overlap_pairs(boxes0, 0.0))} -> {len(over1)}")
    if png_dir:
        footprint_png(pathlib.Path(png_dir) / f"footprints_{name}.png", name, shapes, boxes0, buildings)


def footprint_png(path, name, shapes, rows0, rows1, side=300.0):
    """Before/after of the `side` m square with the most overlapping min-area boxes: OSM outlines (black) over them
    and over the game boxes; boxes overlapping another building's by > 0.3 m in red."""
    P = np.array([rows0[i][1:3] for pair in overlap_pairs(rows0, 0.3) for i in pair] or [r[1:3] for r in rows0])
    g = np.arange(0.0, SIZE - side + 1, 50.0)
    x0, y0 = max(((x, y) for x in g for y in g), key=lambda q: np.sum(np.all((P >= q) & (P < np.add(q, side)), 1)))
    fig, axs = plt.subplots(1, 2, figsize=(17, 8.8), dpi=110)
    for ax, rows, what in zip(axs, (rows0, rows1), ("before: one min-area box per building", "after: game boxes")):
        bad = {i for pair in overlap_pairs(rows, 0.3) for i in pair}
        ax.add_collection(PolyCollection([box_corners(r[1:6]) for r in rows], linewidths=0.6, edgecolors="#5a4a35",
                                         facecolors=["#e04040" if i in bad else "#c9b8a0" for i in range(len(rows))],
                                         alpha=0.75))
        ax.add_collection(LineCollection([r for s in shapes for r in (s[2], *s[3])], colors="black", linewidths=0.8))
        ax.set_xlim(x0, x0 + side); ax.set_ylim(y0, y0 + side); ax.set_aspect("equal")
        ax.set_title(f"{name} {what}: {len(rows)} boxes, {len(bad)} overlapping (red)", fontsize=11)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def preview(lat0, lon0, buildings, roads, pois, sens, coast, piers, land, name, gen):
    fig, ax = plt.subplots(figsize=(12, 12), dpi=150)
    ax.set_facecolor("#efe9dc")
    ax.add_patch(plt.Rectangle((0, 0), SIZE, SIZE, color="#9cc3e6", zorder=0))  # sea, overdrawn by land_rows
    ax.add_collection(PolyCollection([[(r[k], i * ROW), (r[k + 1], i * ROW), (r[k + 1], i * ROW + ROW),
                                       (r[k], i * ROW + ROW)] for i, r in enumerate(land) for k in range(0, len(r), 2)],
                                     facecolors="#efe9dc", edgecolors="none", zorder=0))
    ax.add_collection(LineCollection(coast, colors="#1f5f99", linewidths=1.8, zorder=1))
    ax.add_collection(LineCollection(piers, colors="#0b3d6b", linewidths=2.6, zorder=1))
    for lw, col in {(1.2, "#888888"), *ROAD_STYLE.values()}:
        segs = [r["pts"] for r in roads if ROAD_STYLE.get(r["highway"], (1.2, "#888888")) == (lw, col)]
        ax.add_collection(LineCollection(segs, colors=col, linewidths=lw, zorder=2))
    boxes = []
    for _, cx, cy, w, l_, yaw, _lv in buildings:
        a = math.radians(yaw)
        u, v = np.array([math.cos(a), math.sin(a)]) * l_ / 2, np.array([-math.sin(a), math.cos(a)]) * w / 2
        c = np.array([cx, cy])
        boxes.append([c - u - v, c + u - v, c + u + v, c - u + v])
    ax.add_collection(PolyCollection(boxes, facecolors="#c9b8a0", edgecolors="#7a6a55", linewidths=0.3, zorder=3))
    # buffer zones: exact (footprint + buffer_m) from the same clearance() the check uses, on a 4 m grid
    g = np.arange(-60, SIZE + 60, 4.0)
    gx, gy = np.meshgrid(g, g)
    blocked = clearance(np.column_stack([gx.ravel(), gy.ravel()]), sens).reshape(gx.shape) < 0
    ax.imshow(np.ma.masked_where(~blocked, blocked.astype(float)), cmap=ListedColormap(["#d01c8b"]), alpha=0.22,
              origin="lower", extent=[g[0] - 2, g[-1] + 2, g[0] - 2, g[-1] + 2], zorder=4, interpolation="nearest")
    for s in sens:
        for ring in s.get("rings", []):
            ax.add_patch(plt.Polygon(ring, closed=True, fill=False, ec="#d01c8b", lw=0.8, zorder=5))
    osm_pois = [p for p in pois if p["kind"] != "escape_boat"]
    for ok, col, lab in ((True, "#1a9850", "POI usable"), (False, "#9e9e9e", "POI inside a buffer")):
        sel = [p for p in osm_pois if p["usable"] == ok]
        ax.scatter([p["x"] for p in sel], [p["y"] for p in sel], s=14, c=col, edgecolors="white",
                   linewidths=0.4, zorder=6, label=f"{lab} ({len(sel)})")
    ax.scatter([s["x"] for s in sens], [s["y"] for s in sens], s=34, c="#d01c8b", marker="X", edgecolors="white",
               linewidths=0.4, zorder=7, label=f"sensitive site ({len(sens)})")
    for e in (p for p in pois if p["kind"] == "escape_boat"):
        ax.scatter([e["x"]], [e["y"]], s=420, c="#ffcc00", marker="*", edgecolors="black", linewidths=1.2,
                   zorder=8, label=f"escape_boat ({e['name']})")
        ax.annotate("BOAT ESCAPE", (e["x"], e["y"]), xytext=(e["x"] + 40, e["y"] + 40), fontsize=10,
                    fontweight="bold", zorder=8, arrowprops={"arrowstyle": "-", "lw": 1})
    ax.plot([0, SIZE, SIZE, 0, 0], [0, 0, SIZE, SIZE, 0], color="black", lw=1, zorder=9)
    ax.set_xlim(-60, SIZE + 60); ax.set_ylim(-60, SIZE + 60); ax.set_aspect("equal")
    ax.set_title(f"{name}: {len(buildings)} buildings, {len(roads)} road polylines   "
                 f"(SW {lat0}, {lon0}; metres)", fontsize=11)
    handles, labels = ax.get_legend_handles_labels()
    handles.append(Patch(color="#d01c8b", alpha=0.22, label="no-gameplay buffer (75 m from footprint)"))
    ax.legend(handles=handles, loc="upper left", fontsize=9)
    fig.text(0.5, 0.01, ATTRIBUTION, ha="center", fontsize=6, wrap=True)
    fig.savefig(gen / "preview.png", bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--inset", choices=sorted(INSETS) + ["all"], required=True)
    ap.add_argument("--footprints", metavar="DIR", help="also draw a before/after footprint close-up per inset there")
    a = ap.parse_args()
    for n in INSETS if a.inset == "all" else [a.inset]:
        run(n, a.footprints)
