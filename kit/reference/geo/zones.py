"""Lay out the v2 world (four 1:1 city insets joined by highways) -> Data/zones/world.json.

Stdlib only:  python Tools/geo/zones.py      (reads Data/gen/<inset>/ made by osm.py; deterministic)
Overview:     Tools/geo/.venv/Scripts/python.exe Tools/geo/zones.py --plot Saved/Agent/world_layout.png  (matplotlib)

world.json (format: Docs/escape_design.md, "v2: compressed Israel"). All x, y are world inset-metres: x east,
y north, Tel Aviv inset SW corner = 0,0; an inset's own metres + its offset.
  insets      name, offset (SW corner), gen dir
  bounds      [xmin, ymin, xmax, ymax]
  west_coast  Mediterranean shoreline outside the insets, sea to the WEST, sorted by y. It runs through the Tel Aviv
              inset along that inset's own coast (so it meets it at the west and north edges), passes west of Haifa,
              then jumps east across Haifa at the row where Haifa's port water reaches its east edge: sea west, north
              and east of the Carmel, land east of the bay. It starts at y = -8000: no sea south of that.
  highways    Catmull-Rom curves through hand-placed control points, resampled every ~200 m; each end sits on an
              inset edge where a big OSM road (motorway/trunk/primary/secondary) crosses it
  zones       airport + scenery rects (village/fields/desert), clear of insets and highways
  spots       per inset: hand-picked OSM POIs (enterable spots name the building they sit in; the game hollows it
              out), crates by farthest-point sampling of outdoor POIs; plus the airport and the southern crossing;
              last, one outdoor courier depot per city (mode "delivery", appended so nothing before it moves)
"""
import csv
import json
import math
import os
from pathlib import Path

ROOT = Path(os.path.abspath(__file__)).parents[2]  # not resolve(): see osm.py
GEN = ROOT / "Data" / "gen"
SIZE, ROW = 2000.0, 10.0  # inset size, land_rows spacing (osm.py)
INSETS = {"telaviv": (0, 0), "haifa": (1500, 6000), "jerusalem": (5000, -2500), "eilat": (3500, -14000)}
BOUNDS = [-1500, -14500, 7500, 8500]
BIG_ROADS = ("motorway", "trunk", "primary", "secondary")  # by rank; *_link counts as its road
ENTERABLE = {"safehouse", "shop", "casino", "job", "bank", "forger"}
LEGACY = {"telaviv"}  # the shipped slice keeps its spots as they were (only the POI must be usable): The Postel
# (86 m long, and its far end and the Garage's are within a buffer), Gagarin 138 m, McShekel's 99 m long

# (mode, name, OSM POI id), picked from the usable POIs (outside every sensitive buffer) in a 10-80 m building
SPOTS = {
    "telaviv": [
        ("safehouse", "Safehouse (The Postel)", "n4792889408"),
        ("shop", "Abu Shmulik's Garage - guns, armour, fence", "n3682812190"),
        ("casino", "Club Gagarin Casino", "n2816973652"),
        ("job", "McShekel's", "n4490683591"),
        ("bank", "Jaffa Savings Bank", "n1953544854"),
        ("bank", "Shuk Credit Bank", "n4788711516"),
        ("escape", "Boat out of Jaffa", "escape_boat"),
    ],
    "haifa": [
        ("safehouse", "Safehouse (Carmel Backpackers)", "n332447166"),
        ("shop", "Uncle Moti's Motors - guns, armour, fence", "n5651731529"),
        ("bank", "Carmel Mutual Savings", "n1870350648"),
        ("bank", "Bay & Port Trust", "n13509410001"),
        ("escape", "Boat out of Haifa port", "escape_boat"),
    ],
    "jerusalem": [
        ("safehouse", "Safehouse (Rooftop Hostel)", "w160318257"),
        ("shop", "Shuki's Pawn & Hardware - guns, armour, fence", "w44167514"),
        ("forger", "Shimon's Passport Photos & Print", "n12953458591"),
        ("bank", "Golden City Credit", "n13057613029"),
        ("bank", "Zion Square Savings & Loan", "n560661072"),
    ],
    "eilat": [
        ("safehouse", "Safehouse (Coral Motel)", "n2175360628"),
        ("shop", "Duty-Free Dudu - guns, armour, fence", "w852999335"),
        ("bank", "Red Sea Offshore Bank", "n4498171089"),
    ],
}
N_CRATES = {"telaviv": 24, "haifa": 12, "jerusalem": 12, "eilat": 10}
CRATE_KINDS = ("amenity=parking", "leisure=park", "tourism=viewpoint", "shop=kiosk", "shop=convenience",
               "amenity=car_wash", "amenity=marketplace", "shop=car_repair", "amenity=fuel", "shop=alcohol")
MIN_GAP = 60.0

# highway ends: (inset, edge, preferred position along the edge in inset metres); the nearest biggest road wins
HIGHWAYS = [
    ("Highway 2", ("telaviv", "n", 1400), ("haifa", "s", 1700),
     [(1450, 2400), (1750, 3300), (2350, 4300), (2950, 5200)]),
    ("Highway 1", ("telaviv", "e", 200), ("jerusalem", "w", 1250),
     [(2350, 100), (2700, -280), (3200, -470), (3800, -560), (4400, -900), (4750, -1180)]),
    ("Highway 90", ("jerusalem", "s", 600), ("eilat", "n", 1450),
     [(5560, -3100), (5450, -4300), (5150, -5600), (5350, -7000), (5050, -8500), (4700, -9800), (4850, -11200)]),
]
AIRPORT = [2400, -1200, 3600, -600]
ZONES = [
    ("Ben Gurion Airport", "airport", AIRPORT),
    ("Sharon fields", "fields", [1900, 2300, 2700, 3200]),
    ("Coastal orchards", "fields", [1500, 4300, 2050, 5400]),
    ("Kfar HaSharon", "village", [2600, 3700, 3100, 4100]),
    ("Lod plain fields", "fields", [2400, -2300, 3800, -1350]),
    ("Abu Ghosh", "village", [4150, -650, 4650, -250]),
    ("Judean foothills", "fields", [3900, -2400, 4800, -1450]),
    ("Arad junction", "village", [5750, -4700, 6250, -4200]),
    ("Negev west", "desert", [2600, -11800, 4500, -3200]),
    ("Negev east", "desert", [5800, -11800, 7300, -5000]),
    ("Kibbutz Yahel", "village", [5050, -10600, 5500, -10200]),
]
AIRPORT_SPOT = ("airport", "Ben Gurion Airport - departures")
# delivery jobs: (name, OSM POI id) per city, an outdoor parking lot a few metres off a street (drive up to the van),
# 110+ m from every other spot. Added after the crates are picked, so the crates stay where they were.
DELIVERY = {"telaviv": ("Yossi's Express Courier", "w103768527"), "haifa": ("Carmel Cargo & Courier", "w1071935668"),
            "jerusalem": ("Moshe's Moving & Parcels", "w44122514"), "eilat": ("Red Sea Rush Deliveries", "w959704875")}
CROSSING = ("crossing", "Southern crossing (Taba road)", "eilat", 470)  # on the big road crossing the south edge


def load(inset):
    d = GEN / inset
    rd = lambda f: json.loads((d / f).read_text(encoding="utf-8"))
    with open(d / "buildings.csv", encoding="utf-8", newline="") as f:
        b = {r["id"]: {k: (v if k == "id" else float(v)) for k, v in r.items()} for r in csv.DictReader(f)}
    return {"pois": rd("pois.json"), "roads": rd("roads.json"), "sens": rd("sensitive.json"),
            "land": rd("inset.json")["land_rows"], "buildings": b}


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / max(dx * dx + dy * dy, 1e-9)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def in_ring(px, py, ring):
    c = False
    for (ax, ay), (bx, by) in zip(ring, ring[1:]):
        if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay):
            c = not c
    return c


def clearance(px, py, sens):
    """osm.py's rule: metres by which the point clears every site's buffer (from the footprint edge, 0 inside it)."""
    best = math.inf
    for s in sens:
        if "rings" in s:
            d = 0.0 if any(in_ring(px, py, r) for r in s["rings"]) else min(
                seg_dist(px, py, *a, *b) for r in s["rings"] for a, b in zip(r, r[1:]))
        else:
            d = math.hypot(px - s["x"], py - s["y"])
        best = min(best, d - s["buffer_m"])
    return best


def box_points(b):
    """Centre, corners and edge midpoints of a buildings.csv oriented box."""
    a = math.radians(b["yaw"])
    ux, uy = math.cos(a) * b["length"] / 2, math.sin(a) * b["length"] / 2
    vx, vy = -math.sin(a) * b["width"] / 2, math.cos(a) * b["width"] / 2
    return [(b["x"] + i * ux + j * vx, b["y"] + i * uy + j * vy) for i in (-1, 0, 1) for j in (-1, 0, 1)]


def on_land(x, y, land):
    i = int(y // ROW)
    r = land[i] if 0 <= i < len(land) else []
    return any(r[k] <= x <= r[k + 1] for k in range(0, len(r), 2))


def building_ok(bid, data):
    """'' if the building is a usable enterable shell, else why not."""
    b = data["buildings"].get(bid)
    if not b:
        return "no building"
    if not 10 <= b["width"] <= b["length"] <= 80:
        return f"size {b['width']:.0f} x {b['length']:.0f} m"
    if min(clearance(x, y, data["sens"]) for x, y in box_points(b)) < 0:
        return "inside a sensitive buffer"
    return ""


def edge_roads(data, edge, at=None):
    """[((rank, is_link), position along the edge, road id)] where big roads cross an inset edge (n/s/e/w), or the
    line parallel to it at inset coordinate `at`."""
    axis, val = {"n": (1, SIZE), "s": (1, 0.0), "e": (0, SIZE), "w": (0, 0.0)}[edge]
    val = val if at is None else at
    out = []
    for r in data["roads"]:
        h = r["highway"].removesuffix("_link")
        if h not in BIG_ROADS:
            continue
        for a, b in zip(r["pts"], r["pts"][1:]):
            if (a[axis] - val) * (b[axis] - val) < 0:
                t = (val - a[axis]) / (b[axis] - a[axis])
                pos = a[1 - axis] + t * (b[1 - axis] - a[1 - axis])
                if 0 < pos < SIZE:
                    out.append(((BIG_ROADS.index(h), h != r["highway"]), pos, r["id"]))
    return out


def highway_end(end, data):
    """World point on the inset edge at the best big road, and the point 150 m out (so the road enters straight)."""
    inset, edge, pref = end
    rank, pos, rid = min(edge_roads(data[inset], edge), key=lambda c: (c[0], abs(c[1] - pref)))
    ox, oy = INSETS[inset]
    x, y = {"n": (pos, SIZE), "s": (pos, 0.0), "e": (SIZE, pos), "w": (0.0, pos)}[edge]
    dx, dy = {"n": (0, 1), "s": (0, -1), "e": (1, 0), "w": (-1, 0)}[edge]
    return (ox + x, oy + y), (ox + x + 150 * dx, oy + y + 150 * dy), f"{BIG_ROADS[rank[0]]} {rid} at {pos:.0f}"


def catmull(ctrl, step=200.0):
    """Centripetal-free (uniform) Catmull-Rom through ctrl, resampled to ~step m; keeps both end points exactly."""
    p = [ctrl[0]] + ctrl + [ctrl[-1]]
    dense = []
    for i in range(1, len(p) - 2):
        (x0, y0), (x1, y1), (x2, y2), (x3, y3) = p[i - 1:i + 3]
        for k in range(20):
            t = k / 20
            f = lambda a, b, c, d: 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t +
                                          (3 * b - a - 3 * c + d) * t ** 3)
            dense.append((f(x0, x1, x2, x3), f(y0, y1, y2, y3)))
    dense.append(ctrl[-1])
    out, acc = [dense[0]], 0.0
    total = sum(math.dist(a, b) for a, b in zip(dense, dense[1:]))
    n = max(1, round(total / step))
    for a, b in zip(dense, dense[1:]):
        acc += math.dist(a, b)
        if acc >= total / n * len(out) and len(out) < n:
            out.append(b)
    out.append(ctrl[-1])
    return [[round(x, 1), round(y, 1)] for x, y in out]


def in_inset(x, y, margin=0.0):
    return any(ox - margin < x < ox + SIZE + margin and oy - margin < y < oy + SIZE + margin
               for ox, oy in INSETS.values())


def west_coast(data):
    """Sea-to-the-west shoreline (see the module doc), sorted by y."""
    ta = data["telaviv"]["land"]
    main = [next(r[k] for k in range(0, len(r), 2) if r[k + 1] >= SIZE) for r in ta]  # start of the mainland
    first_sea = next(i for i, x in enumerate(main) if x > 0)  # the coast leaves the inset's west edge here
    pts = [(-1400, -8000), (-1150, -6000), (-800, -4000), (-450, -2000), (-170, 0)]
    pts += [(main[i], i * ROW) for i in range(first_sea, len(ta), 10)] + [(main[-1], SIZE)]
    pts += [(1240, 3000), (1180, 4000), (1170, 5000), (1230, 6000)]
    hx, hy = INSETS["haifa"]
    bay = next(i for i, r in enumerate(data["haifa"]["land"]) if not r or r[-1] < SIZE)  # port water at the east edge
    pts += [(1260, hy + bay * ROW - 1), (hx + SIZE + 400, hy + bay * ROW + 1), (hx + SIZE + 450, 7500),
            (hx + SIZE + 550, BOUNDS[3])]
    return [[round(x, 1), round(y, 1)] for x, y in pts]


def coast_x(coast, y):
    for (ax, ay), (bx, by) in zip(coast, coast[1:]):
        if ay <= y <= by:
            return ax + (y - ay) / max(by - ay, 1e-9) * (bx - ax)
    return -math.inf  # south of the coast: no sea


def pick_crates(inset, data, taken, n):
    """Farthest-point sampling over outdoor, usable, on-land POIs: spreads crates over the inset, deterministic."""
    ox, oy = INSETS[inset]
    cands = [p for p in data["pois"] if p["usable"] and not p.get("building") and p["kind"] in CRATE_KINDS
             and 60 < p["x"] < SIZE - 40 and 40 < p["y"] < SIZE - 40 and on_land(p["x"], p["y"], data["land"])]
    taken = list(taken)
    picked = []
    while len(picked) < n and cands:
        best = max(cands, key=lambda p: min(math.dist((p["x"] + ox, p["y"] + oy), t) for t in taken))
        if min(math.dist((best["x"] + ox, best["y"] + oy), t) for t in taken) < MIN_GAP:
            break
        picked.append(best)
        taken.append((best["x"] + ox, best["y"] + oy))
        cands.remove(best)
    return picked


def main():
    data = {n: load(n) for n in INSETS}
    spots = []
    for inset, (ox, oy) in INSETS.items():
        d = data[inset]
        by_id = {p["id"]: p for p in d["pois"]}
        mine = []
        for mode, name, pid in SPOTS[inset]:
            p = by_id[pid]
            assert p["usable"], (inset, pid)
            if mode in ENTERABLE:
                why = building_ok(p["building"], d) if inset not in LEGACY else ""
                assert not why, (inset, name, pid, p["building"], why)
            mine.append({"mode": mode, "name": name, "x": round(p["x"] + ox, 1), "y": round(p["y"] + oy, 1),
                         "building": p.get("building", "") if mode in ENTERABLE else "", "inset": inset})
        if inset == "telaviv":  # starter crate inside the first safehouse: always a pistol
            safe = mine[0]
            mine.append({**safe, "mode": "crate", "name": "Stash", "pistol": True})
        if inset == CROSSING[2]:  # on the road where it is 15 m inside the south edge (the road may run diagonally)
            ranked = sorted(edge_roads(d, "s", 15.0), key=lambda c: (c[0], abs(c[1] - CROSSING[3])))
            mine.append({"mode": CROSSING[0], "name": CROSSING[1], "x": round(ranked[0][1] + ox, 1), "y": oy + 15.0,
                         "building": "", "inset": inset})
        crates = pick_crates(inset, d, [(s["x"], s["y"]) for s in mine], N_CRATES[inset])
        assert len(crates) == N_CRATES[inset], (inset, len(crates))
        mine += [{"mode": "crate", "name": "Crate", "x": round(p["x"] + ox, 1), "y": round(p["y"] + oy, 1),
                  "building": "", "inset": inset} for p in crates]
        spots += mine
    ax0, ay0, ax1, ay1 = AIRPORT
    spots.append({"mode": AIRPORT_SPOT[0], "name": AIRPORT_SPOT[1], "x": (ax0 + ax1) / 2, "y": (ay0 + ay1) / 2,
                  "building": "", "inset": ""})
    for inset, (name, pid) in DELIVERY.items():
        p = next(q for q in data[inset]["pois"] if q["id"] == pid)
        assert p["usable"] and not p.get("building"), (inset, pid)
        ox, oy = INSETS[inset]
        spots.append({"mode": "delivery", "name": name, "x": round(p["x"] + ox, 1), "y": round(p["y"] + oy, 1),
                      "building": "", "inset": inset})

    coast = west_coast(data)
    highways, ends = [], []
    for name, a, b, mid in HIGHWAYS:
        (pa, qa, ra), (pb, qb, rb) = highway_end(a, data), highway_end(b, data)
        highways.append({"name": name, "pts": catmull([pa, qa, *mid, qb, pb])})
        ends.append(f"{name}: {a[0]} {a[1]} edge at {ra} -> {b[0]} {b[1]} edge at {rb}")
    zones = [{"name": n, "kind": k, "rect": r} for n, k, r in ZONES]

    world = {"insets": [{"name": n, "offset": list(o), "gen": f"gen/{n}"} for n, o in INSETS.items()],
             "bounds": BOUNDS, "west_coast": coast, "highways": highways, "zones": zones, "spots": spots}
    check(world, data)
    out = ROOT / "Data" / "zones" / "world.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(world, indent=1, ensure_ascii=False), encoding="utf-8")
    print("\n".join(ends))
    for inset in [*INSETS, ""]:
        mine = [s for s in spots if s["inset"] == inset]
        modes = {}
        for s in mine:
            modes[s["mode"]] = modes.get(s["mode"], 0) + 1
        print(f"{inset or '(none)':10s} {len(mine):3d} spots {modes}")
    print(f"{len(highways)} highways ({sum(len(h['pts']) for h in highways)} pts), {len(zones)} zones, "
          f"west_coast {len(coast)} pts -> {out}")
    return world, data


def check(world, data):
    """The layout contract: everything in bounds, highways outside insets and on land, zones clear of both."""
    x0, y0, x1, y1 = world["bounds"]
    inb = lambda x, y: x0 <= x <= x1 and y0 <= y <= y1
    coast = world["west_coast"]
    assert all(a[1] < b[1] for a, b in zip(coast, coast[1:])), "west_coast not sorted by y"
    assert all(inb(*p) for p in coast) and all(inb(*p) for h in world["highways"] for p in h["pts"])
    assert all(inb(s["x"], s["y"]) for s in world["spots"])
    for n, (ox, oy) in INSETS.items():
        assert inb(ox, oy) and inb(ox + SIZE, oy + SIZE), n
    for h in world["highways"]:
        pts = h["pts"]
        assert all(math.dist(a, b) < 300 for a, b in zip(pts, pts[1:])), h["name"]
        for a, b in zip(pts, pts[1:]):  # interior: outside every inset, on land (east of the coast)
            for t in (0.25, 0.5, 0.75):
                x, y = a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])
                assert not in_inset(x, y), (h["name"], x, y)
                assert x > coast_x(coast, y) + 100, (h["name"], "in the sea", x, y)
        for i in (0, -1):  # the ends touch an inset edge
            x, y = pts[i]
            assert any(ox <= x <= ox + SIZE and oy <= y <= oy + SIZE and
                       (x in (ox, ox + SIZE) or y in (oy, oy + SIZE)) for ox, oy in INSETS.values()), (h["name"], i)
    for z in world["zones"]:
        zx0, zy0, zx1, zy1 = z["rect"]
        assert zx0 < zx1 and zy0 < zy1 and inb(zx0, zy0) and inb(zx1, zy1), z["name"]
        assert not any(zx0 < ox + SIZE + 50 and ox - 50 < zx1 and zy0 < oy + SIZE + 50 and oy - 50 < zy1
                       for ox, oy in INSETS.values()), (z["name"], "overlaps an inset")
        assert zx0 > coast_x(coast, zy0) and zx0 > coast_x(coast, zy1), (z["name"], "in the sea")
        for h in world["highways"]:
            for a, b in zip(h["pts"], h["pts"][1:]):
                for t in (0.0, 0.25, 0.5, 0.75):
                    x, y = a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])
                    assert not (zx0 - 30 < x < zx1 + 30 and zy0 - 30 < y < zy1 + 30), (z["name"], h["name"])
    for s in world["spots"]:  # inset spots inside their inset and on land (the boat sits on a pier)
        if s["inset"]:
            ox, oy = INSETS[s["inset"]]
            assert 0 <= s["x"] - ox <= SIZE and 0 <= s["y"] - oy <= SIZE, s
            assert s["mode"] == "escape" or on_land(s["x"] - ox, s["y"] - oy, data[s["inset"]]["land"]), s
    zx0, zy0, zx1, zy1 = AIRPORT
    assert any(s["mode"] == "airport" and zx0 < s["x"] < zx1 and zy0 < s["y"] < zy1 for s in world["spots"])
    drops = [s for s in world["spots"] if s["mode"] == "delivery"]  # one per city, clear of the other spots
    assert sorted(s["inset"] for s in drops) == sorted(INSETS), drops
    for d in drops:
        assert all(s is d or math.dist((s["x"], s["y"]), (d["x"], d["y"])) >= 100 for s in world["spots"]), d


def plot(world, data, path):
    """Overview PNG of the whole world: sea, insets (buildings, roads), zones, highways, spots."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection, PolyCollection
    x0, y0, x1, y1 = world["bounds"]
    sea, land = "#9cc3e6", "#efe9dc"
    fig, ax = plt.subplots(figsize=(11, 26), dpi=110)
    ax.set_facecolor(land)
    coast = world["west_coast"]
    ax.add_patch(plt.Polygon([(x0, coast[0][1]), *coast, (x0, coast[-1][1])], color=sea, lw=0, zorder=0))
    ax.plot(*zip(*coast), color="#1f5f99", lw=1, zorder=1)
    zc = {"airport": "#b7b7c9", "village": "#e0b98a", "fields": "#c5dca0", "desert": "#ecd9a8"}
    for z in world["zones"]:
        zx0, zy0, zx1, zy1 = z["rect"]
        ax.add_patch(plt.Rectangle((zx0, zy0), zx1 - zx0, zy1 - zy0, color=zc[z["kind"]], alpha=0.8, zorder=1))
        ax.text((zx0 + zx1) / 2, (zy0 + zy1) / 2, f"{z['name']} ({z['kind']})", ha="center", va="center",
                fontsize=6, zorder=6)
    for ins in world["insets"]:
        ox, oy = ins["offset"]
        d = data[ins["name"]]
        ax.add_patch(plt.Rectangle((ox, oy), SIZE, SIZE, color=sea, zorder=2))
        ax.add_collection(PolyCollection(
            [[(ox + r[k], oy + i * ROW), (ox + r[k + 1], oy + i * ROW), (ox + r[k + 1], oy + i * ROW + ROW),
              (ox + r[k], oy + i * ROW + ROW)] for i, r in enumerate(d["land"]) for k in range(0, len(r), 2)],
            facecolors=land, edgecolors="none", zorder=2))
        ax.add_collection(LineCollection([[(ox + x, oy + y) for x, y in r["pts"]] for r in d["roads"]],
                                         colors="#999999", linewidths=0.3, zorder=3))
        corners = lambda q: [(ox + q[i][0], oy + q[i][1]) for i in (0, 6, 8, 2)]  # box_points order
        ax.add_collection(PolyCollection([corners(box_points(b)) for b in d["buildings"].values()],
                                         facecolors="#a08a70", edgecolors="none", zorder=3))
        ax.add_patch(plt.Rectangle((ox, oy), SIZE, SIZE, fill=False, ec="black", lw=0.8, zorder=4))
        ax.text(ox + 30, oy + SIZE - 30, ins["name"], fontsize=9, fontweight="bold", va="top", zorder=7)
    for h in world["highways"]:
        ax.plot(*zip(*h["pts"]), color="#333333", lw=2.2, zorder=5, solid_capstyle="round")
        mx, my = h["pts"][len(h["pts"]) // 2]
        ax.text(mx + 80, my, h["name"], fontsize=8, color="#333333", zorder=7)
    style = {"crate": ("#8c6d1f", "s", 8), "safehouse": ("#1a9850", "h", 60), "shop": ("#2166ac", "D", 40),
             "casino": ("#762a83", "D", 40), "job": ("#e66101", "D", 40), "bank": ("#b2182b", "p", 60),
             "forger": ("#5e3c99", "P", 60), "delivery": ("#a6611a", "s", 60),
             "escape": ("#ffcc00", "*", 160), "airport": ("#ffcc00", "*", 160),
             "crossing": ("#ffcc00", "*", 160)}
    for mode, (c, m, sz) in style.items():
        sel = [s for s in world["spots"] if s["mode"] == mode]
        ax.scatter([s["x"] for s in sel], [s["y"] for s in sel], c=c, marker=m, s=sz, edgecolors="black",
                   linewidths=0.4, zorder=8, label=f"{mode} ({len(sel)})")
        if mode != "crate":
            for s in sel:
                ax.annotate(s["name"].split(" - ")[0], (s["x"], s["y"]), xytext=(4, 3), textcoords="offset points",
                            fontsize=5, zorder=9)
    ax.set_xlim(x0, x1); ax.set_ylim(y0, y1); ax.set_aspect("equal")
    ax.legend(loc="lower left", fontsize=7)
    ax.set_title("Escape Israel v2 world layout (world inset-metres; x east, y north)", fontsize=10)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, bbox_inches="tight")
    print(f"overview -> {path}")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--plot", metavar="PNG", help="also render an overview (needs matplotlib: use the geo venv)")
    w, d = main()
    if ap.parse_args().plot:
        plot(w, d, ap.parse_args().plot)
