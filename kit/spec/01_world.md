## World, map data and city generation

The world is built at load time from small data files. Generation is deterministic: every peer builds the same world from the same data and the same seeds, and none of it is networked. Nothing in `Config/DefaultGame.ini` overrides `AEscCity`, so the C++ defaults below are the live values: `DataDir` "EscData", `ZoneFile` "zones/world.json", `ParkedCars` 40, `CarsPerHighwayEnd` 3.

---

### 1. Units, coordinate system, determinism

- **Inset metres** are the unit of every data file. x points east, y points north, and the ground is flat at height 0.
  - Each inset's files are in that inset's own metres, with its SW corner at (0,0) and the square 0..2000 on both axes.
  - **World inset-metres** = inset metres + the inset's `offset` from `world.json`. The Tel Aviv inset's SW corner is world (0,0).
- **Unreal mapping**, for reference only: `ToWorld(x, y, z)` = (X = y·100, Y = x·100, Z cm), with X north and Y east. Unreal yaw = 90° − map yaw, where map yaw is in degrees counter-clockwise from east.
- **Height levels** used throughout:

| Surface | Height |
|---|---|
| Ground top | 0 |
| Park lawns top | +1 cm |
| Sidewalks top | +2 cm |
| Footpaths top | +3 cm |
| Roads top | +4 cm |
| Road markings top | +5 cm |
| Kerbs top | +10 cm |
| Sea surface | −15 cm |
| Seabed top | −70 cm |

- **Seeds.** Every random choice uses a seeded stream: Unreal `FRandomStream` seeded with Unreal's 32-bit `GetTypeHash` of a string (case-insensitive for strings), XORed with a constant.

| What is seeded | Seed |
|---|---|
| Stone facade roll (§12) | hash(base id) ^ 0x57043 |
| Roof and wall dressing (§14) | hash(base id) ^ 0xD3E55 |
| Ports (§15) | hash(inset name) ^ 0xC0A7A |
| Streets (§16) | hash(way id) |
| Park dressing (§17) | hash(park id) ^ 0xBE4C4 |
| Park trees (§20) | hash(park id) |
| Park shrubs (§23) | hash(park id) ^ 0x5C2B7 |
| Beaches (§18) | hash(inset name) |
| City lot scatter (§23) | hash(inset name) ^ 0x10751 |
| Zones (§11) | hash(zone name) |
| Village palms (§20) | 0xE5CA1 |
| Highway ridges (§21) | 0x41D6E |
| Free hills (§21) | 0x4177 |
| Desert scatter cells (§22) | hash(cell x, y) ^ 0x5C3B1 |
| Parked cars (§25) | 0xE5CA + candidate count |

- **Unreal `FRandomStream`** behaves like this:
  - `next: seed = (seed*196314165 + 907633515) mod 2^32`
  - `FRand = float with bits 0x3F800000 | (seed>>9), minus 1`
  - `FRandRange(a,b) = a + (b−a)·FRand`
  - `RandHelper(n) = min(trunc(FRand·n), n−1)`
  - `RandRange(a,b) = a + RandHelper(b−a+1)` (both ends inclusive)
  - `RandBool = RandHelper(2)==1`

- **Noise.** `PerlinNoise2D` is standard 2D Perlin, roughly in −1..1.

**Web:**
- Use metres as the unit. Map Three.js so that `three.x = x`, `three.z = −y` and `three.y = up`.
- A map yaw θ becomes `object.rotation.y = θ·π/180` for an object whose local +X is its length or forward axis. Use `BoxGeometry(L, h, W)`.
- Every "faces direction d" rule below means `rotation.y = atan2(d.y, d.x)`, with props modelled facing +X and their pivot at the base centre.
- Use one PRNG in the style of `FRandomStream`, one 32-bit string hash (for example FNV-1a) and one Perlin implementation, shared by every peer. Never use `Math.random` in generation.
- Parity with Unreal is not required; parity between peers is. Host-authoritative vehicles absorb any last-ulp differences in prop placement.

Source: EscCity.h:57; EscCity.cpp:39-47, 219-223, 905-906; EscCity.cpp:1425, 2783, 3406 (seeds).

---

### 2. World layout v2 ("compressed Israel")

There are four 2 × 2 km city squares. Each is OpenStreetMap at 1:1 scale, with no warping. They are placed by hand-picked offsets, not at their true relative positions, and joined by three highways across generic filler land.

| Inset | Offset (SW, world m) | Size | Real bbox lat (N) | Real bbox lon (E) | kx (m/°lon) | Content | Water |
|---|---|---|---|---|---|---|---|
| telaviv | (0, 0) | 2000 | 32.0440–32.0620 | 34.7465–34.7677 | 94244.236 | Ajami / Jaffa port up to Charles Clore & Neve Tzedek | Mediterranean to the NW; 77 % land |
| haifa | (1500, 6000) | 2000 | 32.8135–32.8315 | 34.9855–35.0069 | 93443.217 | German Colony (Ben Gurion Blvd), downtown / Paris Sq, the port | port and bay to the N and E; 67 % land |
| jerusalem | (5000, −2500) | 2000 | 31.7765–31.7945 | 35.2030–35.2242 | 94518.719 | Jaffa Rd, Mahane Yehuda, Ben Yehuda, King George; the Old City is east of the square (outside it) | none; 100 % land |
| eilat | (3500, −14000) | 2000 | 29.5420–29.5600 | 34.9430–34.9637 | 96730.501 | city centre, north beach, marina / lagoon (the port, 3 km SW, is out) | Gulf to the SE, lagoon; 77 % land |

- **Projection.** Equirectangular per inset:
  - x = (lon − lon0)·kx and y = (lat − lat0)·ky.
  - ky = R·π/180 = 111195.080 m/°, with R = 6371008.8 m.
  - kx = ky·cos(lat0 + 1000/ky), i.e. the cosine of the inset's centre latitude.
- **World bounds** are `[−1500, −14500, 7500, 8500]`, i.e. x −1500..7500 and y −14500..8500 (9 × 23 km).
- **Insets are half-open:** a point is in an inset when `ox ≤ x < ox+2000` and `oy ≤ y < oy+2000`.

**West coast.** This is the Mediterranean shoreline outside the insets. Sea lies to the WEST of it, and the points are sorted by y.
- The coast is linearly interpolated between consecutive points.
- South of the first point (y < −8000) or north of the last point, everything is land (coast x = −1e9).
- Inside insets their own `land_rows` win.
- Exact points:
  `[[-1400,-8000],[-1150,-6000],[-800,-4000],[-450,-2000],[-170,0],[11.4,470],[87.4,570],[140.6,670],[168.6,770],[287.1,870],[293,970],[317,1070],[400,1170],[529.2,1270],[841.4,1370],[947.1,1470],[1023.5,1570],[1072.8,1670],[1105.2,1770],[1164.2,1870],[1224.5,1970],[1236.5,2000],[1240,3000],[1180,4000],[1170,5000],[1230,6000],[1260,6689],[3900,6691],[3950,7500],[4050,8500]]`
- How it was built:
  - It follows the start of Tel Aviv's mainland every 10th land row (y 470..2000).
  - It runs west of Haifa.
  - At the land row where Haifa's port water reaches the inset's east edge (local row 69, y = 6689), it jumps east to x = 3900. North of that there is sea west, north and east of the Carmel (Haifa Bay), and land east of x ≈ 3900–4050.
- The Eilat gulf water stops with straight edges at the inset's south (y −14000) and east (x 5500) edges, because the filler there is land.

**Gaza / West Bank rule.** The plan's rule is that these areas get terrain only: no buildings, POIs, labels or zones.
- In v2 it holds by construction. No inset covers them; the Jerusalem square's east edge, 35.2242 E, stops west of the Old City.
- The filler between insets is generic, not georeferenced, and every zone name is a place inside Israel.
- The web build must keep it that way.

Source: Tools/geo/zones.py:30-31, 223-235; osm.py:50-57, 436-439; Data/gen/*/inset.json `proj`; EscCity.cpp:350-403; Docs/escape_design.md:98-107; plan line 238.

---

### 3. Data files

**Files read at runtime:**
- `zones/world.json`
- per inset `gen/<inset>/inset.json`, `roads.json`, `pois.json` and `buildings.csv`

**Files not read at runtime:**
- `sensitive.json` is used only by the build-time scripts and checks.
- `preview.png` is a debug image and is never shipped.

**Sizes on disk.** Bytes raw / bytes gzip −9:

| File | telaviv | haifa | jerusalem | eilat |
|---|---|---|---|---|
| buildings.csv | 123,393 / 42,512 | 72,740 / 25,537 | 188,800 / 64,242 | 79,596 / 26,716 |
| roads.json | 269,399 / 64,493 | 173,546 / 40,468 | 373,733 / 89,943 | 245,239 / 60,347 |
| pois.json | 69,579 / 12,954 | 40,049 / 7,200 | 97,758 / 17,474 | 56,047 / 8,939 |
| sensitive.json | 15,484 / 4,565 | 12,549 / 3,760 | 57,220 / 14,330 | 2,336 / 855 |
| inset.json | 7,623 / 2,231 | 14,124 / 3,818 | 3,413 / 350 | 10,951 / 3,360 |
| preview.png (do not ship) | 1,550,936 | 1,310,869 | 2,060,160 | 1,244,500 |

- `zones/world.json` is 18,711 bytes (3,234 gzip).
- All data except the PNGs totals 1,932,290 bytes.

**Contents per inset:**

| Inset | buildings.csv rows | Distinct buildings | Extra split parts | Road polylines (pts) | POIs (usable) | Parks | Kiosks | Sensitive sites | Coast lines | Piers |
|---|---|---|---|---|---|---|---|---|---|---|
| telaviv | 2763 | 1824 | 939 | 1705 (8498) | 453 (285) | 40 | 5 | 49 (worship 26, historic 11, school 10, cemetery 2) | 7 | 12 |
| haifa | 1686 | 1381 | 305 | 1100 (5680) | 264 (177) | 10 | 1 | 48 (worship 24, school 12, cemetery 8, historic 2, hospital 2) | 5 | 18 |
| jerusalem | 4180 | 2526 | 1654 | 2336 (12022) | 638 (238) | 85 | 0 | 192 (worship 114, school 49, historic 21, hospital 5, cemetery 3) | 0 | 0 |
| eilat | 1776 | 1054 | 722 | 1196 (9510) | 369 (347) | 72 | 2 | 8 (school 4, worship 3, historic 1) | 3 | 35 |

#### 3.1 buildings.csv

- Header: `id,x,y,width,length,yaw,levels`. One game box per row.
- **id** is the OSM id, `w<id>` or `r<id>`.
  - An irregular footprint is split into touching rectangles `<id>`, `<id>_2`, `<id>_3`, … with the largest first (at most 6).
  - Base id rule: strip a trailing `_<digits>`; `w123_2` → `w123`. All parts of one building share the base id. That base id drives the facade tone, the stone roll, the dressing dice and the "same building" tests.
- **x, y** are the box centre in inset metres. They are rounded to 0.1 for single boxes and 0.01 for split parts, so that parts meet without slits.
- **width ≤ length**, both in metres.
- **yaw** is in degrees counter-clockwise from +x to the length axis, in [0, 180).
- **levels** is the number from the OSM tag `building:levels` (first number, rounded, at least 1), else 4. At runtime it is clamped to 1..40. Maximum levels per inset: Tel Aviv 44, Haifa 29, Jerusalem 35, Eilat 12; most rows are 4.
- Examples:
  - `w84091775,322.4,1004.4,25.8,132.9,87.1,4`
  - `w84091782,251.97,816.11,42.66,75.57,177.87,1` and its part `w84091782_2,318.25,871.06,32.58,41.81,87.87,1`

#### 3.2 roads.json

- An array with one JSON object per line: `{"id":"w5050728","highway":"footway","name":"","pts":[[x,y],…]}`.
- Only segments with at least one end inside the 0..2000 box are kept. Consecutive kept segments form one run, so one OSM way can give several entries with the same id.
- Coordinates can reach slightly outside the box (−124..2231 m).
- `name` is `name:en`, else `name`. It is unused at runtime.
- `highway` is the raw OSM value. Types without a style (§8), such as `proposed`, `construction` and `corridor`, are skipped at runtime.

#### 3.3 pois.json

- Shape: `{"id","kind","name","brand","x","y","area_m2"?,"building","usable"}`.
- **kind** is `key=value` from the first matching rule, checked in this order:
  - `shop=*` (any value)
  - `amenity` ∈ {marketplace, fuel, parking, cafe, restaurant, fast_food, bar, pub, nightclub, ice_cream, bank, atm, bureau_de_change, pharmacy, car_rental, car_wash, bicycle_rental, ferry_terminal, bus_station, post_office}
  - `tourism` ∈ {hotel, hostel, guest_house, viewpoint}
  - `leisure` ∈ {marina, park}
  - `man_made` ∈ {pier, lighthouse}
  - `harbour=*`
  - `industrial=port`
  - `landuse` ∈ {harbour, port}
  - `aeroway` ∈ {helipad, heliport}
- **x, y** are the node position, or for areas the mean of all outer-ring vertices.
- **area_m2** (areas only) is the shoelace area of the outer rings.
- **building** is the id of the smallest min-area box of a surviving building that contains the point within 1 m; "" means outdoors.
- **usable** means the point is outside every sensitive buffer.
- A sensitive feature is never a POI.
- Extra entry `{"id":"escape_boat","kind":"escape_boat","name":"Jaffa port pier tip" / "Haifa port pier tip",…}`.
- **At runtime only `leisure=park` (id, x, y, area_m2) and `shop=kiosk` (x, y) are used.** Spots are already resolved in world.json.

#### 3.4 sensitive.json (build-time guardrail)

- Shape: `{"id","kind","tag","name","x","y","buffer_m":75,"rings"?}`.
- **kind** ∈ worship | cemetery | school | hospital | historic_major.
- **tag** is the triggering tag.
- **rings** (areas only) are the footprint polygons. The buffer is measured from the footprint edge (0 inside it), or from x, y for points.
- A site is included when its buffer reaches into the box: the box is grown by the site's radius (largest vertex distance from its mean) plus 75 m.

#### 3.5 inset.json

- Shape: `{"name","sw":[lat0,lon0],"size_m":2000,"proj":"equirectangular, x=(lon-…)*kx, y=(lat-…)*ky metres","attribution","coast":[polylines],"piers":[polylines],"land_rows":[200 rows]}`.
- **land_rows[i]** is the flat list of land intervals `[x0,x1,x0,x1,…]` for the 10 m row y ∈ [10i, 10i+10], sampled at the row centre, sorted and clipped to 0..2000.
  - Example from Eilat row 0: `[0.0,594.9,607.5,740.7]`.
  - An empty `land_rows` array means the whole inset is land.
  - An empty row inside the array means the whole row is water.
- **piers** are `man_made=pier|breakwater|groyne` ways clipped like roads. They are open polylines, or closed rings with first point = last point.
- **coast** is unused at runtime.
- **attribution** must be shown in the credits:

  "Map data (c) OpenStreetMap contributors, ODbL 1.0. Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA."

#### 3.6 world.json

```
{ "insets":[{"name","offset":[x,y],"gen":"gen/<name>"}],
  "bounds":[xmin,ymin,xmax,ymax],
  "west_coast":[[x,y],…],                  // sorted by y (§2)
  "highways":[{"name","pts":[[x,y],…]}],   // world inset-metres (§10)
  "zones":[{"name","kind":"airport|village|fields|desert","rect":[x0,y0,x1,y1]}],
  "spots":[{"mode","name","x","y","building","inset","pistol"?}] }   // §27
```

Missing optional arrays are treated as empty. If `bounds` is missing, the bounds become the union of the insets grown by 500 m. A highway with an empty name is called "the highway".

Source: osm.py:1-29, 77-89, 120-159, 352-354, 433-562; zones.py:6-19; EscCity.cpp:61-93, 107-116, 839-887, 1027-1060, 1229-1279.

---

### 4. How the data was produced (pipeline; rerun only if the files are missing)

**4.1 Fetch.** `Tools/geo/fetch.py` downloads into `Data/raw/`:
- the Geofabrik `israel-and-palestine-latest.osm.pbf`
- Copernicus GLO-30 DEM + WBM water-mask tiles N32_00_E034_00, N32_00_E035_00, N31_00_E035_00 and N29_00_E034_00 from `copernicus-dem-30m.s3.amazonaws.com`

The DEM is not used; the ground is flat.

**4.2 OSM filter** (`osm.py`, pyosmium with areas, key filter building, highway, natural, shop, amenity, tourism, leisure, man_made, harbour, industrial, landuse, historic, religion, military, aeroway):
- **Ways as lines:** only `highway=*`, `natural=coastline` and pier ways.
  - Prefilter: the first node must be within 3000 m of the box, except for coastline.
- **Areas:** the first outer-ring node must be within 3000 m.
  - A **building** is any area with `building` ≠ "no". Each outer ring is one shape, with its holes, and the centre of its min-area box must lie inside the box.
- **Military:** every feature with `landuse=military` or any `military=*` tag is dropped entirely (not a building, POI or sensitive site).
- **Sensitive classification,** checked in this order:
  1. `amenity=school|hospital`
  2. `amenity=grave_yard` or `landuse=cemetery` → cemetery
  3. `amenity=place_of_worship` → worship
  4. `building` ∈ {church, mosque, synagogue, temple, cathedral, chapel, shrine, religious} → worship
  5. `landuse=religious` → worship
  6. any `religion=*` → worship
  7. `memorial=war_memorial` → historic_major
  8. `historic=*` not in the minor set → historic_major
- **Minor historic set** (ordinary features, not sites): cannon, memorial, plaque, blue_plaque, boundary_stone, milestone, survey_point, railway_car, locomotive, wreck, aircraft, tank, vehicle, ship, anchor, wayside_cross, stone, highwater_mark, pillory, bench.
- **Buffer** = 75 m for every kind.
- **Self-checks:**
  - more than 300 buildings
  - land rows valid
  - no POI id is sensitive
  - every buffer = 75
  - usable ⇔ clearance ≥ 0
  - no boxes of different buildings overlap
  - shell boxes unchanged
  - no box under 2 m wide except shells
  - every POI's building exists

**4.3 land_rows.**
- If OSM's open coastline crosses a row:
  - Sort the crossings. Land lies left of the way's direction, so a southbound segment puts land to the east.
  - The state before the first crossing is the opposite of the first crossing's state.
  - Closed islet rings are ignored.
- Otherwise use the Copernicus WBM sampled every 1 m: ocean is water, lakes and rivers count as land.
- Touching intervals merge. Intervals are rounded to 0.1 m and clipped to 0..2000.

**4.4 Boat escape** (Tel Aviv anchor 32.05574 N 34.75013 E; Haifa 32.82064 N 35.00474 E):
- Take the nearest pier vertex. If it is more than 50 m away, take the nearest coastline vertex instead.
- If that is also more than 50 m away, there is no escape.
- The tip must clear every buffer. Otherwise no `escape_boat` is written; the report lists the three nearest clear alternatives at least 30 m apart.

**4.5 Footprint → game boxes.**
- Constants: FILL_KEEP 0.85, AREA_SLACK 1.03, COVER 0.90, MAX_PARTS 6, MIN_DIM 3.0, INSET_M 0.15, GAP_MIN 0.15, GAP_CUT 0.3, MIN_KEEP 2.0.
- Steps:
  1. Compute the min-area oriented box over the convex-hull edges.
  2. If the footprint area is at least 0.85 × box area, keep the box, shrinking each side inward by d so the box area is at most 1.03 × the footprint area:
     - e = l·w − 1.03·area
     - d = min(w/4, max(0.15, ((l+w) − √((l+w)² − 4e))/4)) when e > 0, else 0.15
  3. Otherwise rasterise the footprint in the box frame at a resolution of clamp(√(l·w)/40, 0.5, 1) m, minus the holes.
     - Repeatedly peel off the largest all-inside rectangle at least min(3, w/2) m in both directions (histogram-stack maximal rectangle).
     - Stop at 6 parts, when 90 % of the cells are covered, or when no such rectangle exists. If none were found, keep the shrunk box.
     - Every outer side of a part is set in 0.15 m. Sides shared with another part of the same building are not set in.
  4. Drop parts narrower than 2 m, except for shells.
  5. Shell buildings (ids named by world.json spots) keep their raw min-area box, untouched.

**4.6 Overlap removal (`separate`).**
- Shells go first and are never changed. After them, boxes are processed largest first.
- A box nearer than 0.15 m (separating-axis gap) to an already-kept box of a different building is trimmed clear of it, deepest overlap first:
  - On each of its 4 sides, binary-search (16 steps) the smallest trim that makes the gap at least 0.3 m without the box going below 3 m.
  - Choose the side that loses the least area.
  - If no side works, drop the box.
- Boxes whose centre ends up outside 0..2000 are dropped.
- Output order: buildings in OSM order, parts by area descending.
- Result: no two boxes of different buildings overlap at all.

**4.7 zones.py (world.json):**
- Insets, bounds, west coast (§2), highways (§10) and zones (§11).
- **Hand-picked spots** come from usable POIs.
  - An enterable spot (safehouse, shop, casino, job, bank, forger) must be in a building with 10 ≤ width ≤ length ≤ 80 m whose 9 box points (centre, corners, edge midpoints) all clear every buffer.
  - Tel Aviv is "legacy": only its POI points are checked. The far ends of The Postel and Abu Shmulik's Garage buildings lie inside a buffer; Gagarin is 138 m long and McShekel's 99 m long.
- **Stash:** a copy of the first Tel Aviv safehouse spot with mode "crate", name "Stash" and `pistol: true`.
- **Southern crossing** (Eilat): on the big road where it crosses the line 15 m inside the south edge (the road may run diagonally), nearest local x = 470. Its y is oy + 15.
- **Crates:** farthest-point sampling over POIs that are usable, outdoors (no building), on land, at 60 < x < 1960 and 40 < y < 1960, and whose kind is one of:
  - parking, park, viewpoint, kiosk, convenience, car_wash, marketplace, car_repair, fuel, alcohol
  - Each new crate must be at least 60 m from every spot taken so far, starting from the inset's hand-picked spots.
  - Counts: Tel Aviv 24, Haifa 12, Jerusalem 12, Eilat 10.
- **Airport spot:** at the airport zone centre, inset "".
- **Delivery spots:** appended last so nothing earlier moves. Each is an outdoor parking lot at least 100 m from every other spot.

Source: fetch.py:9-20; osm.py:58-117, 162-308, 369-430, 433-598; zones.py:33-101, 245-322, 325-368.

---

### 5. Runtime build order

Every peer runs these steps, in this order:

1. Load world.json, building the spots (with their locations), zones, highway lines and highway drive roads.
2. For each inset:
   - load the land rows
   - build piers
   - build ground and sand
   - build roads, sidewalks, kerb runs, markings, drive roads, map roads and road vertices
   - read the buildings
   - read the parks and kiosks
3. Filler ground.
4. Sea, seabed and edge walls.
5. Highways.
6. Zones (airport, villages, desert mesas).
7. Shell selection and dropping of blocking footprints; then building blocks, shells, interiors, signs and lights.
8. Spatial grids; overlap warning.
9. Kerbs (clipped).
10. Ports.
11. Building dressing.
12. Street props.
13. Parks.
14. Beaches.
15. Highway lamps.
16. Trees (parks, villages).
17. Hills.
18. Desert scatter.
19. City scatter.
20. Walk points.
21. Host only: interactable spots, parked cars, hunter timer (2 s).

The order matters because later items test against earlier ones. For example, every prop keeps off the port yards and off building overhangs.

**Web:** run the generation in a Web Worker at load, using transferable typed arrays per layer. Build an `InstancedMesh` per layer, chunked into roughly 500 m tiles for culling.

**`city_built` PROBE.** When the build finishes, log one line `PROBE {"event":"city_built", …}` with per-inset counts (`buildings`, `road_segments`, `land_boxes`, `parks`, `walk_points`) and the totals. Reference values from the Unreal build (2026-10-20): `buildings` 10436 (the 10,405 csv rows + village houses + the airport hall), `shells` 19, `shell_overlaps_dropped` 1, `building_overlaps` 0, `road_boxes` 29016, `highways` 3, `ground_boxes` 3034, `trees` 874, `port_yards` 129, `cranes` 6, `hills` 696, `scatter` 71293, `drive_roads` 2686, `walk_points` 9931, `ms` (build time). Per inset (buildings / road segments / land boxes / parks / walk points): telaviv 2763 / 6723 / 370 / 40 / 2333, haifa 1686 / 4544 / 570 / 10 / 1545, jerusalem 4180 / 9424 / 200 / 85 / 3371, eilat 1776 / 8233 / 467 / 72 / 2391. The web build should land in the same range.

Source: EscCity.cpp:448-472, 817-3563 (PROBE at 3559); Saved/Agent/packaged_smoke.log.

---

### 6. Ground, sand, sea, seabed, map edges

**Inset ground.**
- One 1 m-thick box per land interval per 10 m row, top at 0, with collision. A missing `land_rows` gives one box for the whole square.
- Jerusalem uses limestone slabs (`GroundStone`); the other insets use dusty lot ground.

**Sand strips.**
- In each interval, if water lies west of it (x0 > inset west edge + 0.5), the first min(30, x1−x0) m are sand.
- If water lies east of it (x1 < east edge − 0.5), the last min(30, remaining) m are sand.
- There is no sand at a quay: no sand if the row end is within 25 m of a pier segment and that point has at least 4 pier segments within 150 m (a harbour).

**Sea.**
- One water surface covers the world rectangle + 400 m: 2 cm thick, top at −15 cm, no collision.
- A seabed box lies under it: 1 m thick, top at −70 cm, with collision.
- The sea is simply wherever no ground box covers it. It is 55 cm of wadeable water.

**Edge walls.** Four invisible colliding boxes:
- 10 m thick and 60 m tall (0..60 m)
- centred 5 m outside each world edge
- each as long as that side + 20 m

**Map bounds** = the world rectangle, used by the HUD map and spawn checks.

**Web:**
- For the Rapier colliders, merge identical consecutive land rows into one cuboid, since most rows are [0, 2000].
- Use one large plane for the seabed.

Source: EscCity.cpp:39-41, 959-967, 1123-1145, 1271-1279, 1358-1368; Docs/escape_design.md:21.

---

### 7. Piers and breakwaters

- A pier is an **escape pier** if any of its segments is within 40 m of an escape spot. Port yards keep off escape piers (§15).
- **Open polyline** (or 3 points or fewer, or first point ≠ last point within 0.5 m): one concrete box per segment.
  - Length = segment + 6 m, width 6 m, height 1.9 m, spanning −1.5..+0.4 m, yawed along the segment.
- **Closed ring:** scanline fill in 4 m rows.
  - At each row centre, take the crossings with the ring and fill between pairs, widened 3 m at each end.
  - Each fill is a box 4 m (north–south) × width, 1.9 m tall, centre at −0.55 m.
- Material: `RoofConcrete` texture, 3 m tiles, fallback colour #9C9A94. With collision.

Source: EscCity.cpp:1062-1121.

---

### 8. City roads

**Road styles.** Any `highway` value not in this table is skipped.

| highway= | Width m | Paved path | Sidewalk | Rank |
|---|---|---|---|---|
| motorway | 16.0 | no | no | 0 |
| motorway_link | 8.0 | no | no | 0 |
| trunk | 14.0 | no | yes | 4 |
| trunk_link | 8.0 | no | yes | 0 |
| primary | 13.0 | no | yes | 4 |
| primary_link | 8.0 | no | yes | 0 |
| secondary | 13.0 | no | yes | 3 |
| secondary_link | 8.0 | no | yes | 0 |
| tertiary | 10.0 | no | yes | 2 |
| tertiary_link | 7.0 | no | yes | 0 |
| residential | 7.5 | no | yes | 1 |
| unclassified | 7.0 | no | yes | 0 |
| living_street | 5.5 | no | yes | 0 |
| service | 4.5 | no | no | 0 |
| track | 3.5 | no | no | 0 |
| pedestrian | 6.0 | yes | no | 0 |
| footway | 2.5 | yes | no | 0 |
| path | 2.0 | yes | no | 0 |
| cycleway | 2.0 | yes | no | 0 |
| steps | 2.5 | yes | no | 0 |

- Rank 4 is trunk/primary, 3 secondary (palms, bus stops), 2 tertiary, 1 residential (ficus).
- Street lamps go along ranks 1–4. Shop awnings face ranks 2–4.
- "Paved" means pedestrian paving. Every other style is asphalt.

**Per segment.** A segment is built if at least one of its ends is on land.
- **Surface box:**
  - Length = segment + width/2, so joints are filled. Width = style width, 6 cm thick, yawed along the segment, no collision.
  - Asphalt: centre at +1 cm (top 4 cm). Asphalt texture, 6 m tiles, #3B3D40.
  - Paving: centre at 0 (top 3 cm). Paving texture, 2 m tiles, #CBC3B4.
- **Sidewalk** (sidewalk styles, segment longer than 0.5 m):
  - One box per segment, width = road width + 6 m (3 m each side), length = segment + that width/2, 6 cm thick, top at +2 cm.
  - Paving texture, 2 m tiles, #CBC3B4, no collision.
  - Plus two kerb runs, one along each road edge, offset width/2 + 0.125 m from the centre line.
- **Kerbs** (clipped after the shells exist):
  - Sample each kerb run every 0.5 m. A sample is free if it is not within (half width + 0.05 m) of any asphalt carriageway's centre segment, of any rank, and not inside a shell or its door apron (0.3 m margin).
  - Each free stretch of at least 0.5 m becomes a box 25 cm wide × 12 cm high, centre at +4 cm (top 10 cm).
  - Colour #BDBAB2, no collision.
- **Dashed centre line** (asphalt, width ≥ 7 m, segment longer than 6 m):
  - Dashes 3 m long × 15 cm wide, centred at distances t + 1.5 for t = 3, 12, 21, … while t + 3 < length.
  - Top at +5 cm, colour #E8E2C8.
- **Map roads:** every built segment is added as a point pair for the HUD map.

**Drive roads.**
- Asphalt ways of width ≥ 5.5 m qualify, so service roads, tracks and paths do not.
- Consecutive segments that touch land form one drive road. A segment with neither end on land ends it.
- Each drive road stores its centre-line points and half width = width/2, with `highway = false`.
- The three world highways come first in the list: half width 9 m, `highway = true`.
- Traffic drives the right lane at clamp(half width/2, 1.5, 4.5) m from the centre (EscTraffic.cpp:207).

**Road vertices.**
- Every polyline vertex of every styled way, including footways, that is on land with a 6 m margin and more than 30 m inside every inset edge.
- After the inset loop, highway lane points are appended (§10).
- Road vertices are used by the shell doors and the walk points.

**Streets list:** the asphalt ways of rank ≥ 1, used for street props (§16).

Source: EscCity.cpp:969-997, 1147-1227, 2443-2476; EscTraffic.cpp:207.

---

### 9. Filler terrain between the insets

- **Rows.** Rows are 50 m from the world's south edge up. Extra cuts are made at every inset's south and north edge and every zone's y0 and y1. Slivers under 0.5 m are skipped.
- **Each row** at centre y:
  1. Start with one land span from max(west-coast x, world xmin) to world xmax.
  2. Cut out the x range of every inset that covers y; each inset fills its own square.
  3. Split the span at the x edges of every zone that covers y.
- **Each piece** is a 1 m-thick ground box, top at 0, with collision. Its layer depends on the piece's midpoint:
  - inside a zone of kind desert → Desert; fields → Fields; village → Village ground. Airport zones are not matched, so they fall through to the default.
  - otherwise y > 2000 → Fields; y < −4000 → Desert; else Beige.

| Layer | Texture, tile | Tint | Fallback colour |
|---|---|---|---|
| Fields | Grass, 6 m | none | #B3B386 |
| Beige | Grass, 6 m | (1, 0.88, 0.68) | #CDBC98 |
| Desert | Desert, 8 m | none | #D8B784 |
| Village | Desert, 5 m | (0.9, 0.8, 0.68) | #C4A57C |
| Inset lot ground | Lot, 6 m (if missing: Paving 3.5 m, tint (0.9, 0.86, 0.8)) | none | #B9B2A3 |
| Jerusalem ground | Stone, 3 m | (0.85, 0.83, 0.8) | #B9B2A3 |
| Sand | Sand, 4 m | none | #E3CF9F |
| Seabed | Sand, 4 m | (0.7, 0.66, 0.58) | #C7B27E |
| Water | — | — | #1F6E99, roughness 0.05 |

Textures are box-projected in world space, so one tile = the stated metres.

**Web:** use small procedural or generated tiling textures with world-space UVs (u = x/tile, v = y/tile); flat colours are acceptable (choose).

Source: EscCity.cpp:43-44, 905-935, 1281-1356; Tools/ue/make_materials.py:10-12.

---

### 10. Highways

| Name | From (edge, preferred position) | To | Points | Length |
|---|---|---|---|---|
| Highway 2 | Tel Aviv north edge, x = 1397.3 (pref. local 1400) | Haifa south edge, x = 3163.2 (local 1663.2, pref. 1700) | 23 | 4439 m |
| Highway 1 | Tel Aviv east edge, y = 175.9 (pref. 200) | Jerusalem west edge, y = −1249.1 (local 1250.9, pref. 1250) | 18 | 3433 m |
| Highway 90 | Jerusalem south edge, x = 5579.8 (local 579.8, pref. 600) | Eilat north edge, x = 4951.1 (local 1451.1, pref. 1450) | 49 | 9661 m |

**How the lines were made** (zones.py):
- **Ends.** Each end sits where the biggest OSM road crosses that inset edge.
  - Bigness: motorway > trunk > primary > secondary. A `_link` counts as its road but ranks after it.
  - Ties go to the road nearest the preferred position.
  - The line runs end P → Q, where Q is 150 m out perpendicular to the edge, so the road enters straight.
- **Control points:**
  - Highway 2: (1450, 2400), (1750, 3300), (2350, 4300), (2950, 5200)
  - Highway 1: (2350, 100), (2700, −280), (3200, −470), (3800, −560), (4400, −900), (4750, −1180)
  - Highway 90: (5560, −3100), (5450, −4300), (5150, −5600), (5350, −7000), (5050, −8500), (4700, −9800), (4850, −11200)
- **Curve.** Uniform Catmull-Rom through [P, Q, control points…, Q′, P′], with the end points duplicated. 20 samples per span, resampled to n = round(length/200) points, keeping both ends, rounded to 0.1.
- **Checks:**
  - segments under 300 m
  - the interior outside every inset and at least 100 m east of the coast
  - the ends exactly on an inset edge
  - every zone 30 m clear

**Exact polylines** (world m):
- Highway 2: `[[1397.3,2000],[1402,2204.2],[1450,2400],[1512.4,2619.1],[1565.8,2803.1],[1630.2,3002.2],[1706.7,3203],[1797.8,3396.4],[1878.9,3545.3],[1999.6,3748.8],[2095.6,3902.4],[2193,4054.7],[2319.6,4252.1],[2411.7,4395.2],[2542.2,4585.2],[2641.5,4725.7],[2768.6,4907.5],[2881,5079.5],[2969.6,5238.7],[3049.1,5429.1],[3111.8,5638],[3152.2,5806.4],[3163.2,6000]]`
- Highway 1: `[[2000,175.9],[2201.6,168.3],[2378.2,73.5],[2506.2,-82.9],[2658.2,-248.3],[2812.1,-343.2],[3011.6,-418.5],[3200,-470],[3402.6,-498.9],[3616.8,-517.8],[3800,-560],[3987.9,-645.5],[4178,-756.3],[4350.1,-867.3],[4510.9,-979.2],[4655.9,-1100],[4805.6,-1226.1],[5000,-1249.1]]`
- Highway 90: `[[5579.8,-2500],[5578.5,-2708.8],[5571.8,-2927.7],[5556.8,-3143],[5543.3,-3344.9],[5531.6,-3521.2],[5517.5,-3711.4],[5499.8,-3909],[5477.7,-4107.4],[5438.7,-4362.6],[5394.2,-4552],[5339.1,-4743.6],[5280.6,-4937.5],[5225.6,-5133.6],[5181,-5332],[5153.9,-5532.6],[5152,-5735.5],[5176.6,-5940.6],[5202.9,-6078.6],[5250,-6287.5],[5297.1,-6498.6],[5334,-6712],[5350.7,-6927.6],[5346.3,-7073],[5322.8,-7296.8],[5284,-7525.6],[5251.8,-7679.3],[5197.6,-7909.6],[5159.4,-8061.6],[5102.5,-8284.9],[5050,-8500],[4995.4,-8704.9],[4954.3,-8836.7],[4889.6,-9029.6],[4826.3,-9219.3],[4753.5,-9472.7],[4715,-9666.9],[4696.3,-9868.6],[4695.9,-10011.8],[4709.8,-10236.3],[4736.2,-10465],[4758,-10615.5],[4792.8,-10832],[4825.4,-11029.7],[4856.3,-11250],[4881.1,-11427],[4909.9,-11603.1],[4945.3,-11808.6],[4951.1,-12000]]`

**Built per segment** (length ≥ 0.1 m; "right" = (fwd.y, −fwd.x)):
- **Asphalt:** length = segment + 9 m, width 18 m, 6 cm thick, top at +4 cm, no collision.
- **Concrete divider:** on the centre line, segment length × 0.6 m wide × 0.8 m tall (0..0.8 m), with collision, concrete material.
- **Edge lines:** continuous lines 20 cm wide at ±8.3 m from the centre.
- **Lane dashes:** at ±4.5 m, 4 m long × 15 cm wide, centred at t + 2 for t = 2, 14, 26, … while t + 4 < length. Markings top at +5 cm.
- **Lane points:** every 60 m along the whole line (cumulative, starting at 0), a point 4.5 m to the right. These are appended to the road vertices (walk points).
- **Highway ends:** both ends of each line are recorded for parked cars (§25).
- **Map roads:** every highway segment is added. The HUD draws segments whose midpoint is outside every inset as thick lines.
- **Lamps:** see §19.

**Lookups:** the highways are available as centre lines (for roadblocks), with their names in parallel.

Source: zones.py:73-81, 166-215, 335-357; EscCity.cpp:42, 847-864, 1370-1410.

---

### 11. Zones (between the cities)

| Name | Kind | rect [x0, y0, x1, y1] |
|---|---|---|
| Ben Gurion Airport | airport | 2400, −1200, 3600, −600 |
| Sharon fields | fields | 1900, 2300, 2700, 3200 |
| Coastal orchards | fields | 1500, 4300, 2050, 5400 |
| Kfar HaSharon | village | 2600, 3700, 3100, 4100 |
| Lod plain fields | fields | 2400, −2300, 3800, −1350 |
| Abu Ghosh | village | 4150, −650, 4650, −250 |
| Judean foothills | fields | 3900, −2400, 4800, −1450 |
| Arad junction | village | 5750, −4700, 6250, −4200 |
| Negev west | desert | 2600, −11800, 4500, −3200 |
| Negev east | desert | 5800, −11800, 7300, −5000 |
| Kibbutz Yahel | village | 5050, −10600, 5500, −10200 |

Zones are asserted to be at least 50 m clear of every inset, east of the coast, and at least 30 m clear of the highways. Each zone has its own random stream, seeded by hash(name).

**Airport** (the airport spot inside the zone; else the zone centre is C):
- **Orientation.** Map yaw 0 if the zone is wider than tall, else 90. U = along, V = across.
- **Side.** Side = +1 if C + V·150 is farther from the highways than C − V·150, else −1. For Ben Gurion this resolves to the south.
- **Hall placement.**
  - While C is within 40 m of a highway, move C by Side·10 m along V, at most 10 times.
  - Create the terminal footprint `airport_<zone name>`: 80 × 30 m, levels 2, plaster (not stone), at C.
  - The spot's building is set to it and the spot moves to C. The hall then becomes a shell (§13); its door faces the nearest road vertex, which for Ben Gurion is Highway 1 to the north.
- **Apron:** paving 320 × 110 m at C + Side·80·V, top at +3 cm.
- **Runway:** asphalt 900 × 45 m at C + Side·165·V. White dashes 30 × 0.9 m every 50 m from −420 to +420 along U. Added to map roads as one ±450 m segment.
- **Parked airliner** (colour #F4F4F2, roughness 0.4, with collision). Centre J = C + Side·85·V; "along" is the U offset in m, "bottom" is the height of its underside:

| Part | Along | Across | Size (along × across × height) | Bottom |
|---|---|---|---|---|
| Fuselage | 0 | 0 | 40 × 4.2 × 4.2 m | 1.6 m |
| Wings | +1 | 0 | 6.5 × 36 × 0.5 m | 2.4 m |
| Fin | −17.5 | 0 | 5 × 0.4 × 6.5 m | 5.8 m |
| Tailplane | −18 | 0 | 3 × 12 × 0.3 m | 5.2 m |
| Nose gear | +15 | 0 | 0.6 × 0.6 × 1.6 m (dark) | 0 |
| Main gear | −1 | ±2.5 | 0.6 × 0.6 × 2.4 m (dark) | 0 |

**Village:**
- RandRange(5, 10) stone houses, up to 80 tries.
- Each try picks a point uniformly in the zone rectangle inset by 8 m. It is rejected if it is within 20 m of a highway, not on land with an 8 m margin, or within 18 m of any existing footprint centre.
- House: length 9–14 m, width 7–11 m, yaw 0–90°, levels RandRange(1, 2), stone. Ids `<zone>_house<n>`.
- Then 8 palm candidates are placed uniformly in the zone rectangle (§20).

**Desert mesas:**
- Wanted = clamp(round(ext.x·ext.y·4/2e6), 3, 24), where ext is the half size. That gives 8 for Negev west and 5 for Negev east.
- Up to wanted·10 tries. A try is rejected if it is within 250 m of a highway, within 150 m of an inset square, not on land with an 80 m margin, or inside any non-desert zone grown by 100 m.
- Height H = 6–25 m.
- Footprint: length 40–160 m × width 30–110 m, random yaw 0–180°. The box is sunk 1 m (spans −1..H−1).
- Cap: 0.6 × length, 0.55 × width, 0.3·H tall, centred at 1.15·H − 1 m, yaw ± up to 15°.
- Rocks layer: Desert texture, 10 m tiles, tint (0.62, 0.5, 0.42), fallback #A47E5A, with collision.
- Mesas are recorded as landforms (boxes) for the hills and scatter.

Source: zones.py:82-95, 347-357; EscCity.cpp:1412-1531.

---

### 12. Buildings (solid blocks)

- **Placement.** Every buildings.csv row becomes one box: centre (x, y) + inset offset, length × width, yaw, height = levels × 3.2 m. The box stands on 0 and has collision.
- **Stone vs plaster.** The value is fixed by the first part read of each base id, so all parts share it. A building is stone if any of these holds:
  - it is in Jerusalem (the Jerusalem-stone bylaw)
  - it is in Tel Aviv old Jaffa, i.e. local x < 1100 and local y < 1250
  - a seeded roll: PRNG(hash(base) ^ 0x57043).FRand() < 0.15
  - it is a village house (always stone); the airport hall is plaster
- **Facade tone,** by hash(base):
  - plaster palette, index hash % 8: #F2EFE6, #E8DCC0, #D9C7A3, #EDE8DA, #D6D6D2, #EBD3C8, #EFE3B0, #F5F1EA
  - stone palette, index hash % 4: #CFC1A0, #C9B48A, #D8C9A6, #BFAE8C
  - The per-instance data is (R, G, B, stone 0/1).
- **Facade shader.** Everything is computed in instance and world space; per-building randomness hashes the box size and tint.
  - **Walls:**
    - plaster texture × tint, or limestone × lerp(1, tint/luminance, 0.35)
    - 4 m world-aligned tiles, so parapets continue the wall below them
  - **Windows** only on walls taller than 2.5 m and wider than 1.8 m:
    - floors nF = max(1, round(H/3.2 m)); bays nB = max(1, round(W/2.8 m))
    - cell per bay and floor: 50 % open window, 32 % shutter half down, 18 % shutter closed
    - on upper floors, whole bay columns with hash < lerp(0.1, 0.4, hb2) are balcony doors
  - **Shopfront** on the ground floor of about 40 % of buildings (hash hb3 < 0.4), on walls wider than 3.5 m:
    - fascia across the top 70 cm, colour from black / dark red / dark blue / dark green / off-white, with a 12 cm darker band (wall × 0.75) at the very top
    - 10 cm piers at the bay edges in wall × 0.92
    - 6 cm dark frames (0.06), a 12 cm sill, and a 6 cm mullion at mid-bay
    - 25 % of bays behind a grey roller shutter (9 cm slats); otherwise dark glass with a vertical gradient
  - **Shading bands:**
    - a darker band (× 0.8) of 25 cm at the roof edge (10 cm on boxes ≤ 2.5 m tall, i.e. parapets)
    - ground grime × (1 − 0.3·g²) with g = 1 − z/1.5 m, and × (0.94 + 0.06·z/H)
  - **Roof:** light concrete with 6 m tiles along the building, shifted per building, tint at 10 %, brightness × (0.9 + 0.12·hash).
  - **Web:** use a `ShaderMaterial` or `onBeforeCompile` with instance attributes (tint RGB, stone, box size). Draw the window cells procedurally as rectangles instead of the window-atlas texture (choose).
- **HUD map:** the 4 corners of every surviving footprint, including village houses and the airport hall.
- **Safety net:** different base ids overlapping by more than 0.3 m are only logged, never fixed.

Source: EscCity.cpp:1229-1252, 1594-1663, 1637-1646, 2267-2297; make_materials.py:12-13, 237-350.

---

### 13. Enterable venues ("shells")

**Which buildings.** Every spot with a non-empty `building` and a mode other than crate becomes a hollow hall: 18 in total (safehouse ×4, shop ×4, casino, job, bank ×7, forger) plus the airport terminal. The shell box is the spot's building id itself; osm.py kept it as one unsplit box.

| Mode / inset | Building | Centre (local) | W × L m | Yaw | Levels |
|---|---|---|---|---|---|
| safehouse telaviv | w265656590 | 1122.2, 1262.6 | 35.1 × 86.2 | 173.8 | 4 |
| shop telaviv | w265984631 | 1509.9, 1276.9 | 56.9 × 57.7 | 81.4 | 4 |
| casino telaviv | w265984634 | 1714.6, 1108.9 | 74.1 × 138.3 | 59.2 | 4 |
| job telaviv | w265984660 | 1247.1, 1145.2 | 14.2 × 98.9 | 84.9 | 4 |
| bank telaviv | w265656589 | 1196.4, 1245.2 | 19.5 × 49.6 | 174.5 | 4 |
| bank telaviv | w265984678 | 1259.4, 1077.7 | 18.4 × 52.4 | 175.3 | 4 |
| safehouse haifa | w190109318 | 1149.7, 657.1 | 25.0 × 28.6 | 139.9 | 4 |
| shop haifa | w176540320 | 200.0, 1423.9 | 21.2 × 26.0 | 50.7 | 4 |
| bank haifa | w133462190 | 512.7, 763.4 | 11.9 × 15.9 | 148.8 | 4 |
| bank haifa | w189599270 | 1386.9, 683.7 | 49.0 × 50.1 | 47.7 | 4 |
| safehouse jerusalem | w160318257 | 1192.1, 712.0 | 24.1 × 28.6 | 69.3 | 4 |
| shop jerusalem | w262948282 | 656.3, 1004.8 | 25.2 × 26.6 | 153.7 | 10 |
| forger jerusalem | w551037976 | 571.9, 1738.2 | 26.8 × 31.8 | 96.3 | 11 |
| bank jerusalem | w546094562 | 284.3, 1762.9 | 34.5 × 64.6 | 148.7 | 11 |
| bank jerusalem | w158080734 | 1369.3, 406.9 | 12.6 × 50.6 | 174.5 | 4 |
| safehouse eilat | w959763370 | 1140.0, 1915.2 | 24.2 × 39.0 | 95.7 | 4 |
| shop eilat | w852999335 | 1432.9, 1057.1 | 27.4 × 31.5 | 2.7 | 4 |
| bank eilat | w852999292 | 1545.8, 862.5 | 13.8 × 19.5 | 86.0 | 4 |
| airport | airport_Ben Gurion Airport | world (3000, −900) | 30 × 80 | 0 | 2 |

**Door facing.**
1. Find the road vertex (§8, highway lane points included) nearest the shell centre that is not inside the box with a 1 m margin. If there is none, use C + V·100.
2. With T = vertex − C, compute du = (T·U)/(L/2) and dv = (T·V)/(W/2).
3. If |du| > |dv| the door goes in the end wall at sign(du)·U; otherwise in the long wall at sign(dv)·V.

**Keep-clear.**
- The keep-clear set is each shell box plus a door apron: 6 m along the door wall × 5 m out, centred 2.5 m outside the wall.
- Every non-shell footprint that overlaps any keep-clear box (separating-axis test, slack 0.3 m) is removed, including another part of the same building.
- Kerbs and all street props also keep out of shells and aprons.

**Spot moves.** The spot, and every other spot naming the same building (the Stash), moves to the hall centre. The Stash crate's interactable is then offset +2.5 m north and +2.5 m east of it.

**Construction.** All sizes are in cm.

| Element | Size or placement |
|---|---|
| Hall height H | min(levels, 3)·320 + 100 (1060 for 4+ levels, 740 for the airport) |
| Walls | 40 cm thick, height H |
| Door gap | 380 wide × 320 high, centred on the door wall |
| Lintel | over the door, from 320 to H, built as 3 slices |
| Roof slab | 30 cm thick, from H to H+30 |
| Collision | one invisible box per wall piece (full 40 cm thickness) plus the roof slab |

Skins:
- **Outside:** a 20 cm facade skin with the building's tone and stone flag, running up to H+30 to cover the roof edge. The long walls own the corners; the end-wall skins are shortened by 20 cm at each end.
- **Inside:** a 20 cm warm plaster skin up to H: Plaster texture, 3 m tiles, tint (1, 0.9, 0.76), fallback #D9CDB8.
- **Ceiling:** plaster from H to H+15. **Roof top:** facade material from H+15 to H+30.

Door awning:
- red #C0392B, 540 along the wall × 240 out × 20 thick
- centred 120 cm out from the wall's centre line, at height 350

**Interior frame.**
- x runs along the door wall (−Rx..Rx); y runs from the back wall (−Ry) to the door wall (+Ry); the door is at x = 0.
- Rx and Ry are the inner half sizes = outer half − 0.4 m.
- Walls are numbered 0 back, 1 left (−x), 2 right (+x), 3 door.
- Furniture claims floor space first come, first served. A claim must:
  - stay at least 5 m (box-to-point distance) from the hall centre, where the spot is
  - keep out of the door lane |x| < 3 + half width, unless the item lies entirely in the back half (y + half depth ≤ 0)
  - stay inside the room and not intersect earlier claims (touching is fine)
- Decorations (bands, rugs, lamps) skip the claim test.
- Sizes below are along-wall × out-from-wall × height for wall items, or x × y × z, in cm.
- "@D" is the centre's distance out from the wall in m; "@T" is the position along the wall from its middle in m; "Z" is the bottom height in cm.

**All venues:**
- floor 3 cm thick over the inner area
- wainscot #5E4632 on all 4 walls: 4 cm proud, 110 high
- baseboard #2B2119: 6 × 14
- both broken by a 3.8 m gap at the door

Floors:

| Venue | Floor | Material |
|---|---|---|
| casino | carpet | #6E1A28 |
| shop | garage tiles | Tiles texture, 3.6 m, tint (0.7, 0.62, 0.53), #8A7E6E |
| safehouse, forger | warm tiles | Tiles texture, 2.4 m, tint (1, 0.86, 0.7), #8B6A45 |
| bank, airport | marble | Tiles texture, 2.4 m, #ECE8DF, roughness 0.12 |
| job | white tiles + red checker | Tiles texture, 2.4 m, no tint, #E9E4DA, roughness 0.35, with flat red #C41E24 checker tiles over it |

**Casino:**
- **Bar** on wall 1 if Ry ≤ Rx, else wall 0. BarLen = min(wall length − 4, 12) m, built if > 3.
  - claim: (BarLen + 1) × 4 m @D 2
  - back unit: wood #7A5230, BarLen × 40 × 100 @D 0.25
  - 3 shelves: BarLen × 30 × 4 at Z 136 / 181 / 226 @D 0.2
  - bottles 9 × 9 × 30 every 0.3 m on each shelf, alternating green #2E6B3A and amber #A35A1A
  - counter: BarLen × 70 × 110 @D 3, with a gold #D4A017 top (BarLen + 10) × 80 × 5 at Z 110
  - stools every 1.2 m from −BarLen/2 + 0.6, @D 3.7: steel post Ø8 × 72 and a red #B03024 seat 40 × 40 × 8 at Z 72
- **Slot machines** on walls 0, 1 and 2 except the bar wall, every 1.3 m with |T| ≤ wall/2 − 0.8:
  - claim: 0.9 × 0.7 @D 0.45
  - cabinet: purple #4A1070, 90 × 70 × 190, with a gold top 96 × 76 × 22 at Z 190
  - black screen: 60 × 2 × 45 at Z 105, @D 0.81
- **Card tables** at x = −Rx+6 … Rx−6 step 12 and y = −Ry+6 … Ry−4 step 9:
  - claim: half 1.9 × 1.3
  - wood base 200 × 100 × 72, green felt #1F6B3A 240 × 140 × 6 on top
  - 4 chairs #3B302A, 45 × 45 × 46, at (±0.6, ±1.0)
- **Chandelier** under each hall light: gold rod 8 × 8 × 181 (Z H−195), disc 260 × 260 × 25 (Z H−220), disc 150 × 150 × 40 (Z H−260).

**Job (McShekel's):**
- **Floor checker:** red tiles 200 × 200 × 0.6 on a 2 m checker, at Z 3.
- **Kitchen** on the back wall. KitchenLen = min(2Rx − 2, 16).
  - claim: KitchenLen × 1.2 @D 0.6
  - steel counter #A7ACB2: × 80 × 90 @D 0.45
  - hood: × 90 × 45 at Z 205, @D 0.5
  - appliances every 1.5 m from −KitchenLen/2 + 0.9, alternating:
    - grill: black #161616, 120 × 65 × 8 at Z 90
    - fryer: steel 70 × 65 × 35 at Z 90, with black oil 56 × 50 × 2 at Z 125
  - yellow #FFC72C menu board: min(KitchenLen, 10) m × 10 × 130 at Z 270, @D 0.05
  - 3 red lines on the board: (MenuLen − 0.8 m) × 2 × 12 at Z 295 / 327 / 359, @D 0.11
- **Booths** on all 4 walls every 2.8 m with |T| ≤ wall/2 − 1.3:
  - claim: 2.4 × 1.3 @D 0.7
  - table: wood 80 × 120 × 75
  - red benches 50 × 120 × 45 at ±0.7, with high backs 16 × 120 × 110 at ±1.08
- **Tables for two** at x = −Rx+3 step 4.5 and y = −Ry+3.2 step 3.5, up to Rx−3 / Ry−2.5:
  - claim: half 1.05 × 0.5
  - table 80 × 80 × 75, chairs 45 × 45 × 46 at x ± 0.75

**Bank:**
- **Vault door** on the back wall, at the first x of {0, Rx/2, −Rx/2} that claims (half 1.3 × 0.35 at y = −Ry + 0.35):
  - steel disc Ø240 × 40 at y = −Ry + 0.2, centre Z 150
  - inner disc Ø70 × 20 at −Ry + 0.45
  - handle: horizontal bar 150 × 8 × 8 at Z 146 and vertical bar 8 × 8 × 150 at Z 75, at −Ry + 0.6
- **Teller counter** at y = −Ry + 2.2, x = −Rx+1.5 … Rx−2.7 step 3, each piece claiming half 1.5 × 0.35:
  - wood 300 × 70 × 110
  - blue glass #1E3560: 290 × 4 × 100 at Z 110, y − 0.2
  - steel post 6 × 8 × 104 at x − 1.47
  - chair 50 × 50 × 50 at y − 0.9 when |x| < 6
- **Queue lanes** at y = counter + 1.7 and + 2.9, 4 posts each at x = −2.25 + 1.5i:
  - claim: half 0.16
  - post Ø6 × 95, base Ø32 × 3 at Z 3
  - belt 144 × 3 × 6 at Z 84 between neighbouring placed posts

**Shop (garage):**
- **Car lifts** at y = −Ry + 4, x = −Rx+3.5 step 6.5:
  - claim: half 1.9 × 2.4
  - two red posts 30 × 40 × 300 at x ± 1.7
  - steel platform 310 × 460 × 12 at Z 200
- **Workbenches** on the back wall every 3 m:
  - claim: 2 × 0.7 @D 0.4
  - wood 200 × 70 × 90
  - red toolbox 60 × 35 × 30 at Z 90, @T − 0.5
  - pegboard #3B302A 200 × 3 × 100 at Z 120, @D 0.03
- **Tyre stacks** in both front corners: 4 positions each, at x = ±(Rx − 0.45 − (i%2)·0.75), y = Ry − 0.45 − ⌊i/2⌋·0.75.
  - claim: half 0.35
  - 4 tyres #1A1A1A, Ø66 × 21, every 23 cm up
- **Shelves** on walls 1, 2 and 3, every 3 m with |T| ≤ wall/2 − 1.5:
  - claim: 2.6 × 0.6 @D 0.35
  - wood 260 × 60 × 210

**Safehouse:**
- **Central rug** #8E3B2A: 520 × 360 × 1.2 at Z 3. It is flat because the spawn scatter lands on it.
- **Living corner** on the right wall, at the first y of {0, −Ry/2, Ry/2} that claims (Rx − 2.4, half 2.4 × 1.3):
  - rug 300 × 240 at x = Rx − 2.5
  - TV stand: wood 45 × 160 × 55 at Rx − 0.3, with a black TV 8 × 130 × 75 on it (Z 55)
  - coffee table 60 × 110 × 40 at Rx − 2.3
  - sofa in blue fabric #2F5D8A: seat 90 × 220 × 45 at Rx − 3.8, back 20 × 220 × 85 at Rx − 4.35, arms 100 × 20 × 62 at Rx − 3.85, y ± 1.2
- **Crates by the door:** claim at (−Rx+1, Ry−1), half 0.95.
  - three crates #9A7448, 85 × 85 × 75, at (−Rx+0.5, Ry−0.5), (−Rx+1.45, Ry−0.55) and (−Rx+0.55, Ry−1.45)
  - one 75 × 75 × 65 at (−Rx+0.75, Ry−0.75), Z 75
- **Beds** on the back and left walls, every 2.4 m with |T| ≤ wall/2 − 1.3:
  - claim: 2.1 × 1.0 @D 0.55
  - wooden frame 205 × 95 × 30
  - mattress 200 × 90 × 20 at Z 30
  - white pillow #E4E2DC 35 × 70 × 10 at Z 50, @T − 0.78

**Airport terminal:**
- **4 white pillars** 90 × 90 × H at (±0.5Rx, ±0.4Ry).
- **Check-in.** RowHalf = Rx − 3.
  - black bag belt (2·RowHalf) × 60 × 45 @D 0.75 (claim × 1.5)
  - desks every 3.4 m from −RowHalf + 1.3: claim 2.6 × 0.7 @D 2.2; white 260 × 70 × 110
  - blue sign 200 × 4 × 45 over each desk at Z 230, @D 0.03
- **Departures board:** black min(2Rx − 4, 9) m × 20 × 260 at Z 320, @D 0.1.
  - yellow title strip (len − 0.6 m) × 2 × 22 at Z 545
  - 5 yellow flight lines × 2 × 12 at Z 350 + 38i; every other line is 1.2 m shorter and shifted 0.6 m
- **Luggage carousel** at the first of (−(Rx−7), 0), (Rx−7, 0), (0, −Ry+6.5) that claims half 4.8 × 1.4:
  - black belt 650 × 160 × 45
  - round ends Ø160 × 45 at x ± 3.25
  - steel rail 700 × 40 × 70
- **Seat rows** facing the door, at y = −Ry+6 step 4 to Ry−2.5 and x = −Rx+3.5 step 6:
  - claim: half 2.5 × 0.45
  - seat 500 × 60 × 45, back 500 × 12 × 85 at y − 0.35

**Forger:**
- **Photo corner** on the back wall: claim 3.4 × 5.2 @D 2.6.
  - white backdrop 280 × 4 × 280 @D 0.5
  - steel top bar 310 × 8 × 8 at Z 285
  - 2 stands 6 × 6 × 293 at @T ± 1.55
  - stool 40 × 40 × 50 @D 1.5
  - tripod at (0, −Ry + 4.4): 3 legs Ø4 × 140, pitched 15°, yaw = door direction + 120°·k, 18 cm out, centre Z 68
  - camera: black 22 × 16 × 16 at Z 135, @D 4.4; lens 10 × 14 × 10 at Z 138, @D 4.25
- **Desk** on the right wall, else the left, at @T = −Ry/2: claim 1.8 × 1.8 @D 0.9.
  - wood 160 × 80 × 75 @D 0.45
  - lamp at @T + 0.55: base Ø18 × 3 at Z 75, stem 3 × 3 × 40, shade #FFF3D0 24 × 30 × 14 at Z 112
  - chair 50 × 50 × 48 @D 1.3
  - white printer 100 × 70 × 110 at @T + 1.6, @D 0.4, if it claims 1.1 × 0.8
- **Filing cabinets:** 6 on the left wall at @T = −Ry + 1.5 + 0.55i. Claim 0.5 × 0.6 @D 0.35; steel 50 × 60 × 130.

**Door sign** (none on safehouses):
- Text = the spot name in upper case. A title starting "MC" becomes "Mc…" (McSHEKEL'S).

| Venue | Board | Edging | Text colour | Text |
|---|---|---|---|---|
| bank | blue #1F4E9A | — | white | name |
| airport | blue #1F4E9A | — | white | "DEPARTURES" |
| casino | purple #4A1070 | gold | (255, 205, 60) | name |
| job | red #C41E24 | yellow | (255, 199, 44) | name |
| shop | orange #E07020 | — | (20, 20, 20) | name up to " - " |
| forger | grey #5F6368 | — | white | "PASSPORT PHOTOS" |

- Text height is 130 cm.
- Let span = (door-wall inner length × 100 − 60) cm. If text width + 120 > span, the text is scaled down to fit span − 120.
- Board width = clamp(text + 120, min(540, span), span). Board: 20 deep × 190 high, bottom at 400, flush on the outer wall face (y = Ry + 0.5).
- Edging: (board + 20) × 26 × 15, bottom 385.
- Text faces out at y = Ry + 0.62, height 495.

**Lights.**
- N = clamp(⌈L/25⌉, 1, 5) point lights along the length, at fractions (i + 0.5)/N − 0.5 of L.
- Height H − 80. 7000 lumens, colour (1, 0.9, 0.75), radius max(W, 25) m, no shadows.
- Each has a glowing fixture #FFF3D0 140 × 140 × 14 at H − 14.

**Web:** light only the shells within about 40 m of the local player (choose; same value as spec 06 §2).

Source: EscCity.cpp:225-309, 1533-1593, 1594-2265, 3565-3591; osm.py:526-528; zones.py:33-35, 154-163.

---

### 14. Building dressing (roofs, walls)

**Skips.**
- Shells get nothing.
- A small box (L < 4 or W < 4) of a single-part building gets nothing.
- A small part of a split building gets only its parapet.

**Seed.** PRNG(hash(base) ^ 0xD3E55) is re-seeded for every part, so the parts of a building roll alike. The roof top is levels × 3.2 m.

**Parapet:**
- 40 cm high, 25 cm thick, flush with the outer wall (centre 12.5 cm in), sitting on the roof. Facade material with the building tone.
- It runs along each wall except where another part of the same building, at least as tall, touches a 20 cm strip outside that wall.
- A stretch that stops at such a part runs on 25 cm into the inner corner.
- The long walls own the corners: an end wall is shortened by 25 cm at each corner a long-wall piece reached.
- Pieces under 0.3 m are dropped.

**Roof items** (when the solar-heater or water-tank prop exists, L ≥ 5, W ≥ 5, with 80 % probability):
- heaters = RandRange(1, clamp(⌊L·W/70⌋, 1, 4))
- tanks = RandRange(0, 2) if L·W > 60, else 0
- Each item gets up to 8 tries at a uniform position at least 1.5 m from the box edges, at least 2.4 m from the other items.
- Heaters face south ± 4°; tanks have random yaw. Both stand on the roof.

**AC units** (levels ≥ 2, 40 %):
- On each wall at least 6 m long: RandRange(0, 2) units.
- Storey RandRange(1, levels − 1), along the wall uniformly at least 1 m from its ends, height storey·3.2 m + 0.4 m, facing out.
- The pivot is out from the wall by the mesh's back depth + 0.02 m (default 0.2 m); half width 0.45 m by default.
- A unit is kept only if no building or other part lies within that distance − 0.01 m of points every 0.5 m across its width.

**Bauhaus balconies** (Tel Aviv or Haifa insets only; levels 2–6; max(L, W) ≥ 8 m; 35 %):
- Use the long-wall pair whose point 5 m out from the wall middle is nearer a road (rank 0).
- Slab length = wall − 1.2 m.
- Required: nothing within 0.6 m of points 0.7 m out along the whole slab.
- On every storey 1..levels−1:
  - slab #EFEBE3: 1.2 m deep × 15 cm thick, top at storey·3.2 m, centred 0.6 m out
  - front rail #D3CDC1: 5 cm × 90 cm at 1.175 m out
  - two end rails 1.15 m deep
- Sets the building's overhang to 1.3 m.

**Shop awnings** (city buildings, 60 %):
- The shopfront is the wall (at least 4 m long) whose middle point is nearest a carriageway of rank ≥ 2, and less than 8 m from it.
- bays = min(⌊(len − 0.8)/3.2⌋, 5), spaced 3.2 m around the wall middle.
- One colour per building: red #B8322A, green #2E7D4F, blue #2C5F9E or orange #D9822B.
- Per bay, with 80 % probability and when the 2.6 × 1.2 m footprint is clear (nothing within 0.55 m of points 0.61 m out over ±1.0 m):
  - canvas 1.3 m deep × 2.6 m wide × 6 cm, pitched 20° down, centre 0.61 m out at 2.78 m (top edge at 3 m on the wall)
  - two white #F1EEE6 stripes 0.52 m wide at ±0.52 m along, 1.5 cm above the canvas
- Sets the overhang to 1.3 m.
- Later street props and tree crowns keep off overhangs.

Source: EscCity.cpp:2745-2953.

---

### 15. Ports (container yards and cranes)

**Quays.** Pier segments of at least 30 m whose midpoint is on land 25 m to one side and not 25 m to the other side. The land side is "inland".

**Plans.**

| Port | Max blocks | Max cranes | Seed |
|---|---|---|---|
| haifa | 120 | 6 | hash(name) ^ 0xC0A7A |
| telaviv | 8 | 0 | hash(name) ^ 0xC0A7A |
| eilat | 6 | 0 | hash(name) ^ 0xC0A7A |

**Cranes.**
- Along each quay of that port, every 50 m from 25 m (while along + 25 ≤ length).
- Position = quay point + 9 m inland, facing the water so the boom is over it.
- Requirements:
  - water 20 m and 35 m out from the quay
  - the ground under the landward legs (14 × 20 m box centred 11 m inland) passes the yard-clear test
  - at least 45 m from other cranes
- Each crane reserves an 18 × 20 m yard.

**Block.**
- 24.8 × 13.0 m, in two rows of five stacks: stack offsets (i − 0.5)·12.6 m along and (j − 2)·2.64 m across.
- Each stack is empty with 12 % probability, else RandRange(1, 3) tiers high.
- Tier height = the container mesh height (2.59 m).
- Colour per box at random: red, blue, green or grey.
- The block's doors all face one end, flipped 180° at random.
- Pitch: 31.8 m along, 23 m across (7 m and 10 m aisles).

**Fill.**
- For rows 0..5 back from each quay of the port: fit = ⌊(length + 7)/31.8⌋ blocks per quay, centred along it.
  - Block centre = A + fwd·((length − fit·31.8 + 7)/2 + 12.4 + k·31.8) + inland·(22 + 6.5 + row·23).
- Then, while the port is below its cap, a lattice of i, j ∈ −5..5 pitches around each pier segment of at least 5 m (from its first point, aligned with it). Each lattice block must be on land and in a harbour (at least 4 pier segments within 150 m).

**Yard-clear test.**
- At least reach + 120 m from escape spots and at least reach + 15 m from other spots.
- At least reach + 20 m + half the lawn side (clamp(√area, 14, 60)/2) from parks.
- Not overlapping another yard grown by 6 m.
- Sampled every ~4 m over the box, each sample must be:
  - on land
  - not inside a building (2.5 m margin) or shell (2 m)
  - not within 3.5 m of any carriageway or path edge
  - at least 30 m from any escape-pier segment

Port yards are reserved for later props (4 m margin).

Source: EscCity.cpp:2573-2743.

---

### 16. Street furniture and placement rules

**Clear-spot test** for a point and margin m. All of these must hold:
- on land
- not inside any building box grown by m plus its overhang
- more than m from every asphalt carriageway edge
- not within 0.6 m of a footpath centre line
- not inside a shell or apron grown by m
- not inside a port yard grown by m
- at least 6 m from every gameplay spot

**Spacing.** Claim the 1.5 m cell; the cell and its 8 neighbours must be empty, so no two street items are within about 1.5 m.

**Street props** stand at +2 cm, on the sidewalk.

**Tree crown test.**
- The crown is the circle of radius half the larger side of the prop's mesh bounds at its yaw and scale. A palm's crown sits about 0.6 m off its foot along its +X.
- The crown must clear every building (grown by its overhang) and every shell. For palms, only buildings of 2+ levels count, since the fronds hang no lower than ~4 m.
- A tree needs the crown test, then the clear-spot test with a 0.8 m margin, then the spacing claim.

Per street (rank ≥ 1), with PRNG(hash(way id)):

| Item | Rule |
|---|---|
| Bus stops (rank ≥ 3) | want = way length/400; stops = ⌊want⌋ + (FRand < fraction). Spaced length/stops, the first at half that. On the right side at half width + 1.8 m, facing the road. The shelter's mesh box must not overlap a building or shell; the clear-spot test with 0.3 m must pass at both ends (±2.2 m along); then placed with margin 1.2. |
| Street lamps (ranks 1–4) | Every 35 m from FRandRange(5, 35), alternating sides (right on even steps), at half width + 0.75 m (0.5 m behind the kerb), facing the road so the 2.4 m arm reaches over it. The mesh box must not overlap a building or shell; margin 0.6. |
| Palms (rank ≥ 3) | Every 15 m from 7.5 m, both sides, at half width + 1.2 m. Yaw = facing the road ± up to 35°, so the crown leans out; scale 0.9–1.1. If refused, retry at half width + 1.0 m, scale 0.85. |
| Ficus (rank 1) | One side (RandBool), every 20 m from FRandRange(3, 20), at half width + 1.4 m, yaw 0–360, scale 0.85–1.15. If refused, retry at half width + 1.0 m, scale 0.85. |
| Kiosks | At each `shop=kiosk` POI, the counter (+X) facing the nearest carriageway centre point (default east), margin 2.3 m. |

Rank 2 (tertiary) streets get lamps and awnings only.

Source: EscCity.cpp:2477-2571, 2955-3030.

---

### 17. Parks and lawns

For each `leisure=park` POI, with PRNG(hash(id) ^ 0xBE4C4):
- **Lawn:** a square of side clamp(√area, 14, 60) m, shrunk by 12 m steps (minimum 14) until all 4 corners are on land.
  - Top +1 cm, no collision. Grass texture, 4 m tiles, tint (0.72, 1, 0.66), fallback #8DA05E.
  - The lawn is not tested against buildings.
- **Seating:** 2 benches and 1 bin, each at a random bearing and radius 5–12 m from the park point, facing the middle. Margin 1.0 for benches (the bench ends are 0.93 m), 0.5 for the bin.
- **Trees:** see §20. **Shrubs:** see §23.

Source: EscCity.cpp:1253-1269, 3032-3052.

---

### 18. Beaches (Tel Aviv and Eilat)

**Strips.**
- Per land row and interval, using the same sand widths as §6 but without the quay test.
- For each side with water and sand at least 20 m wide, with PRNG(hash(inset name)):
  - The water edge is x0 (sea to the west, items face west) or x1 (sea to the east, items face east).
  - Every pier within 60 m of a candidate rejects it.

**Lifeguard towers.** Rows where row % 25 == 12, i.e. every 250 m:
- one tower at 0.45 × sand width in from the water, at the row centre, facing the sea
- clear-spot test with margin 2.8; the tower is 4.2 × 3.7 m on stilts

**Umbrellas.** All other rows:
- at depths 7, 14, 21 … ≤ sand width − 5 m from the water
- each skipped with 30 % probability; y jitter ±2 m; random yaw
- clear-spot test with margin 1.3
- two loungers at ±0.9 m north/south of the umbrella, facing the sea

**Tel Aviv promenade.** West water, first interval of each row only:
- marks every 15 m up the coast, mark = ⌈row·10/15⌉, y = mark·15 if it falls in this row
- skipped if a pier is within 60 m of (back of the sand, y)
- palm at back + 5 m (tree rules)
- bench at back + 1 m facing the sea when mark % 2 == 0 (every 30 m)
- bin at (back + 1, y + 7.5) when mark % 4 == 1 (every 60 m)
- kiosk at back + 10 m facing the sea when mark % 20 == 10 (every 300 m, margin 2.3)

Source: EscCity.cpp:3054-3136.

---

### 19. Highway lamps

- Every 60 m from 30 m, only where distance along < 1000 m or > length − 1000 m (by the cities).
- Both sides at 10.5 m from the centre, facing the road.
- Each lamp must be on land, not within 1 m of a building box, have its mesh box clear of buildings and shells, be more than 0.5 m from city carriageways, and pass the spacing claim. Placed at Z 0.

Source: EscCity.cpp:3138-3160.

---

### 20. Trees in parks and villages

**Planting rule.**
- Random yaw 0–360°, scale 0.85–1.15.
- The point must be:
  - on land with a 4 m margin
  - not within 2 m of a building
  - at least 12 m from the highways
  - clear (clear-spot test, margin 1)
  - crown-clear and spacing-clear

**Where.**
- **Parks:** 7 tries per park with PRNG(hash(id)), offsets uniform ±18 m; palm with 35 % probability, else ficus.
- **Villages:** the 8 palm points per village (§11), PRNG 0xE5CA1, all palms.

**Fallback** when the palm or ficus prop is missing:
- trunk cylinder #6B5236: palm Ø35 cm × 7–10 m, ficus Ø45 cm × 3.5–5.5 m
- crown sphere #4F7A35: palm 4.5 × 4.5 × 1.6 m, ficus 3.8–5.6 m, centred at trunk top + 0.2/0.3 × crown height

Source: EscCity.cpp:3162-3200.

---

### 21. Hills and ridges (desert, fields and beige land)

**Hill mesh.**
- A 100 × 100 × 15 m mound. With normalized radius r, top = 0.45 and s = 15/(1 − top/2):
  - height = 15 − s·r²/(2·top) for r < top
  - height = s·(1 − r) otherwise
- Mild noise of ±0.6·(1 − r) m. The rim is tucked 0.5 m below ground.
- Placed at −0.5 m, scaled (L/100, W/100, rise/15), yaw along its length axis. With collision.
- Material follows the ground under its centre:
  - Fields → Grass texture, 6 m tiles (#B3B386)
  - Beige → Grass 6 m with the beige tint (#CDBC98)
  - otherwise Desert, 8 m tiles (#D8B784)

**Hill-clear test.** The 17 foot points (centre + 16 on the ellipse) must all be on land and more than 150 m outside every inset. And:
- either the centre is at least 150 m + half the larger side from the highways, or no foot point is within 150 m of a highway
- no spot inside the ellipse grown by 150 m
- airport zone kept at 150 m and villages at 60 m: neither the zone centre inside the grown ellipse nor any foot point inside the zone rectangle grown by that distance
- no overlap (separating-axis test) with any landform (mesas, earlier hills), allowing slack 0.15·(min side + other's min side)

**Placement.** Short hills are one mound. A hill of 300 m or longer becomes three mounds:
- **Main hump:** length × (0.55–0.7), full width, centred.
- **Two shoulders**, one at each end:
  - length Ls = length × (0.35–0.5)
  - width = W·√(Ls/L)·(0.85–1.0)
  - centred at C ± U·(L − Ls)/2
  - rise = min(rise·(0.35–0.7), 0.27·width)

**Highway ridges** (PRNG 0x41D6E). Every 150 m from 100 m along each highway, on both sides:
- length = 300 + 1200·FRand²
- width = length × (0.3–0.5)
- centre = point + left normal·side·(150..600 m + width/2) + fwd·(−100..100 m)
- yaw = road direction ± 8°
- rise = min(20..60 m, 0.27·width)
- placed with 90 % probability if the hill-clear test passes

**Free hills** (PRNG 0x4177). Up to 420 placed in 9000 tries. Each try:
- band = FRand, inward = 40–900 m, turn = ±25°, P uniform over the world, axis 0–180°
- band < 0.5: x = xmax − inward, axis 90 + turn (north–south ridges along the east edge)
- band < 0.65: y = ymin + inward, axis = turn
- band < 0.75: y = ymax − inward, axis = turn
- otherwise P stays random
- big with 25 % probability: length 300–1200, rise min(20..60, 0.27·W)
- small: length 60–300, rise min(clamp(L·(0.06..0.12), 5, 25), 0.35·W)
- width = length × (0.35–0.6)

Source: EscCity.cpp:3202-3317; Tools/blender/props.py:1135-1152.

---

### 22. Desert scatter (between the cities)

**Cells.** 100 m cells over the world. A cell is skipped if its centre is off land or inside an inset. Seed PRNG(hash(cx, cy) ^ 0x5C3B1).

**Inputs per cell:**
- **Highway ring.** Walk each highway every 25 m; mark the cells within Chebyshev distance 4 with their minimum ring distance.
  - near = (5 − ring)/5 (1.0 on the road, 0.2 four cells off), else 0
  - near-road flag = ring ≤ 1
- **Biome** = the filler layer at the cell centre (§9). Desert and Beige count as dry.
- **Patch** = clamp(1 + 1.6·perlin(c/650 + (31.7, 12.3)), 0.15, 2).
- **Rocky** = clamp((perlin(c/900 + (−7.9, 44.1)) − 0.1)/0.25, 0, 1).
- **Wadi(P)** = max(0, 1 − |perlin(P/1300 + (5.3, 9.1)) + 0.5·perlin(P/560 + (17.2, 3.4))|/0.045). It is about 1 down the middle of a winding dry stream bed ~50 m wide.

**Scatter-spot test** for an item of radius r:
- not inside an inset
- if near-road: at least 25 + r m from the highways
- not on a landform (inside a mesa box or a hill ellipse)
- not in the airport zone grown by 30 m
- if r > 2: at least 6 + r m from spots
- clear-spot test with margin r, then the spacing claim

**Scrub** (shrub prop, ~1.4 m wide, no collision).
- Bushes per hectare:
  - village: 2
  - desert: (1 + 90·near²)·patch
  - beige: (0.8 + 72·near²)·patch
  - fields: (0.2 + 14·near²)·patch
- 16 sites per cell, uniform in the cell. Wadi = Wadi(site) if dry, else 0.
- A site is used if FRand·72 < bushes + 45·wadi·(0.5 + 0.5·near).
- Clump = RandRange(2, 7) + (2 if wadi > 0). Spread 4–11 m; clump scale 0.7–1.2.
- Each bush: at radius spread·√FRand, scale clump × (0.65–1.3), random yaw, item radius 0.7·scale.

**Rocks** (not in villages; rock prop ~3 m across, ~1.8 m tall).
- Clusters per cell:
  - desert: 0.25 + 1.2·near + 2.2·rocky
  - beige: 0.15 + 0.8·near + 1.5·rocky
  - fields: 0.03
  - count = ⌊value⌋ + (FRand < fraction)
- Each cluster: 1–4 rocks within 6 m. Scale lerp(0.5, 1.3, FRand²), sink 0.1–0.35, tilt 8°.
- **Outcrop** probability:
  - desert: 0.03 + 0.12·near + 0.08·rocky
  - beige: 0.02 + 0.08·near + 0.05·rocky
  - fields: 0
  - centre ±0.4 cell
  - 3–6 boulders: scale 1.2–3, within 1.6·scale m, sink 0.2–0.5, tilt 15°
  - 4–8 rubble rocks: 6–16 m out, scale 0.5–0.9, sink 0.1–0.3, tilt 10°
- **Each rock:**
  - item radius 1.7·scale
  - squash (0.8–1.25, 0.8–1.25, 0.7–1.15)
  - pitch and roll ± tilt, random yaw
  - height −1.8 m·sink·scale·squash z
  - scale < 0.8: no-collision layer; otherwise collidable
  - none inside a village rectangle grown by 20 m

**Acacias** (desert biome and cell centre y < −9000, the Arava):
- 3 sites per cell, uniform; yaw random, scale 0.75–1.2
- used if FRand·3 < 0.1 + 0.5·near + 2.4·Wadi(P)
- must pass the crown test and the scatter-spot test with radius 3.5

**Fade-out distances** (start–end):

| Item | Fade-out |
|---|---|
| Shrubs | 350–500 m |
| Small rocks | 250–350 m |
| Rocks | 500–700 m |
| Acacias | 600–800 m |
| Containers | 1.2–1.5 km |

Hills and cranes always show. The scatter totals about 70k items.

**Web:** use an `InstancedMesh` per prop per 500 m tile, and hide tiles beyond the fade distance.

Source: EscCity.cpp:45-46, 2346-2375, 3319-3478.

---

### 23. City lot scatter

- **Park shrubs.** With PRNG(hash(id) ^ 0x5C2B7): 3 shrubs per park at radius (half the lawn side) + 1–4 m. Random yaw, scale 0.6–1.0, placed with the street-prop rule at margin 3.5.
- **Lots.** Per inset, with PRNG(hash(name) ^ 0x10751):
  - wanted: Eilat 240, others 100; up to wanted × 6 tries
  - P is uniform over the inset
  - 15 % small rock (scale 0.25–0.5, at −10 cm, no collision), else shrub (scale 0.5–1.1), random yaw
  - required:
    - on land with a 35 m margin
    - not within 8 m of a building
    - clear-spot test with margin 4
    - not within 1.5 m of any carriageway or path edge
    - spacing claim

Source: EscCity.cpp:3479-3510.

---

### 24. Walk points

- Take the road vertices (§8) and the highway lane points (§10), in that order.
- Drop a point if another kept point is within 12 m, or if it is within 1 m of a building box.
- Uses: spawning walkers (civilians and soldiers, which spawn in rings around humans), roadblock and other logic, and parked cars.

Source: EscCity.cpp:3512-3529.

---

### 25. Parked cars (host only)

1. For each of the 6 highway ends, take the walk points within 150 m of the end and park **3** cars there.
2. Then park **40** cars over all walk points.

Each parking call:
- Shuffle the candidates deterministically: PRNG(0xE5CA + candidate count), Fisher-Yates from the last element down, swapping i with RandRange(0, i).
- Greedily keep points at least 40 m from cars placed in **the same call**.
- For each kept point, try the 4 axis-aligned yaws (0/90/180/270°) starting at a random one. The car goes 1 m to the car's **right** of the point (Unreal local +Y, which is −y in the car space of spec 04) and 0.4 m up. Use the first yaw where a box of half size 2.6 × 1.1 × 0.6 m, centred 1 m up, hits no blocking geometry.
- Random car model.
- Cars are axis-aligned, not aligned to the road. Aligning them to the nearest road segment is an optional improvement (choose).

Source: EscCity.cpp:138-142, 463-470; EscVehicle.cpp:46, 230-288.

---

### 26. World queries (API the other systems use)

| Query | Behaviour |
|---|---|
| **InsetAt(p)** | "telaviv", "haifa", "jerusalem", "eilat", or "" (highways and filler). Insets are half-open. |
| **OnLand(x, y)** | Inside an inset: its land rows, row = ⌊(y − oy)/10⌋, intervals inclusive; an out-of-range row is not land; missing rows mean all land. Outside: inside the world rectangle (inclusive) and x ≥ west-coast x(y). |
| **LandAt(p, m)** | OnLand at p, and at p ± m on both axes when m > 0. |
| **LandSpans(y)** | For the HUD map: [max(coast x, xmin), xmax], minus each inset's x range, plus that inset's intervals for the row (or the whole square). Sorted. |
| **CoastX(y)** | The start of the first land span (xmax if there is none). |
| **FindSpot(mode)** | The first spot with that mode. |
| **FindNearestSpot(mode, p)** | Nearest in 2D; used for respawn at "safehouse". |
| **GetHighways()** | The highway centre lines, with names in parallel ("Highway 2", "Highway 1", "Highway 90"). |
| **GetDriveRoads()** | §8. |
| **GetWalkPoints()** | §24. |
| **GetMapBounds()** | The world rectangle. |
| **MapBuildings / MapRoads** | Building corners and road segment pairs for the HUD map. |

Supporting spatial grids:

| Grid | Cell | Padding |
|---|---|---|
| Footprints | 50 m | + 8 m |
| Road segments | 20 m | half width + 9 m |
| Shells and yards | 50 m | — |
| Landforms | 100 m | — |
| Walk points | 12 m | — |

**Web:** draw the HUD map once into an offscreen canvas.

Source: EscCity.h:62-94; EscCity.cpp:172-199, 332-446, 888-891.

---

### 27. Gameplay spots

**Spawning** (host): spots map to interactables with these modes: crate, shop, casino, job, bank, escape, airport, crossing, forger, delivery.
- "safehouse" spots are only spawn and respawn points.
- Enterable spots sit at their hall centre (§13). The Stash goes 2.5 m north and 2.5 m east of its safehouse spot.

All 85 spots from world.json (x, y in world inset-metres):

| # | mode | name | inset | x | y | building | pistol |
|---|---|---|---|---|---|---|---|
| 0 | safehouse | Safehouse (The Postel) | telaviv | 1164.3 | 1275.4 | w265656590 | |
| 1 | shop | Abu Shmulik's Garage - guns, armour, fence | telaviv | 1531.3 | 1260.0 | w265984631 | |
| 2 | casino | Club Gagarin Casino | telaviv | 1689.1 | 1060.2 | w265984634 | |
| 3 | job | McShekel's | telaviv | 1251.5 | 1153.8 | w265984660 | |
| 4 | bank | Jaffa Savings Bank | telaviv | 1217.3 | 1235.6 | w265656589 | |
| 5 | bank | Shuk Credit Bank | telaviv | 1262.9 | 1081.9 | w265984678 | |
| 6 | escape | Boat out of Jaffa | telaviv | 335.0 | 1307.4 | - | |
| 7 | crate | Stash | telaviv | 1164.3 | 1275.4 | w265656590 | yes |
| 8 | crate | Crate | telaviv | 97.6 | 66.2 | - | |
| 9 | crate | Crate | telaviv | 1042.7 | 75.6 | - | |
| 10 | crate | Crate | telaviv | 1646.4 | 1954.7 | - | |
| 11 | crate | Crate | telaviv | 1861.4 | 381.0 | - | |
| 12 | crate | Crate | telaviv | 231.2 | 688.3 | - | |
| 13 | crate | Crate | telaviv | 1339.6 | 531.6 | - | |
| 14 | crate | Crate | telaviv | 625.2 | 315.0 | - | |
| 15 | crate | Crate | telaviv | 1948.6 | 1599.7 | - | |
| 16 | crate | Crate | telaviv | 736.0 | 1113.3 | - | |
| 17 | crate | Crate | telaviv | 1254.9 | 1938.9 | - | |
| 18 | crate | Crate | telaviv | 1919.4 | 776.8 | - | |
| 19 | crate | Crate | telaviv | 1568.1 | 163.9 | - | |
| 20 | crate | Crate | telaviv | 1110.8 | 716.5 | - | |
| 21 | crate | Crate | telaviv | 1606.6 | 781.7 | - | |
| 22 | crate | Crate | telaviv | 1286.4 | 233.0 | - | |
| 23 | crate | Crate | telaviv | 861.7 | 468.8 | - | |
| 24 | crate | Crate | telaviv | 1521.6 | 1521.9 | - | |
| 25 | crate | Crate | telaviv | 1041.4 | 1502.3 | - | |
| 26 | crate | Crate | telaviv | 1811.4 | 1277.3 | - | |
| 27 | crate | Crate | telaviv | 1349.8 | 1713.7 | - | |
| 28 | crate | Crate | telaviv | 1294.3 | 1495.6 | - | |
| 29 | crate | Crate | telaviv | 1546.2 | 469.9 | - | |
| 30 | crate | Crate | telaviv | 1449.5 | 999.9 | - | |
| 31 | crate | Crate | telaviv | 273.5 | 158.3 | - | |
| 32 | safehouse | Safehouse (Carmel Backpackers) | haifa | 2641.1 | 6656.2 | w190109318 | |
| 33 | shop | Uncle Moti's Motors - guns, armour, fence | haifa | 1703.2 | 7429.1 | w176540320 | |
| 34 | bank | Carmel Mutual Savings | haifa | 2009.9 | 6768.6 | w133462190 | |
| 35 | bank | Bay & Port Trust | haifa | 2881.8 | 6706.3 | w189599270 | |
| 36 | escape | Boat out of Haifa port | haifa | 3301.2 | 6795.9 | - | |
| 37 | crate | Crate | haifa | 2484.9 | 7777.3 | - | |
| 38 | crate | Crate | haifa | 2338.9 | 6050.3 | - | |
| 39 | crate | Crate | haifa | 3173.4 | 6192.5 | - | |
| 40 | crate | Crate | haifa | 1800.0 | 7953.9 | - | |
| 41 | crate | Crate | haifa | 1874.9 | 6257.7 | - | |
| 42 | crate | Crate | haifa | 2828.9 | 6049.5 | - | |
| 43 | crate | Crate | haifa | 1955.9 | 7157.2 | - | |
| 44 | crate | Crate | haifa | 2553.7 | 6302.4 | - | |
| 45 | crate | Crate | haifa | 2972.9 | 6416.6 | - | |
| 46 | crate | Crate | haifa | 1728.0 | 6688.6 | - | |
| 47 | crate | Crate | haifa | 2184.2 | 7030.6 | - | |
| 48 | crate | Crate | haifa | 2042.2 | 7954.0 | - | |
| 49 | safehouse | Safehouse (Rooftop Hostel) | jerusalem | 6190.4 | -1786.7 | w160318257 | |
| 50 | shop | Shuki's Pawn & Hardware - guns, armour, fence | jerusalem | 5640.1 | -1498.7 | w262948282 | |
| 51 | forger | Shimon's Passport Photos & Print | jerusalem | 5566.1 | -754.2 | w551037976 | |
| 52 | bank | Golden City Credit | jerusalem | 5266.2 | -732.9 | w546094562 | |
| 53 | bank | Zion Square Savings & Loan | jerusalem | 6357.3 | -2090.1 | w158080734 | |
| 54 | crate | Crate | jerusalem | 6892.6 | -573.2 | - | |
| 55 | crate | Crate | jerusalem | 5237.3 | -2373.0 | - | |
| 56 | crate | Crate | jerusalem | 6891.8 | -1784.8 | - | |
| 57 | crate | Crate | jerusalem | 6504.6 | -1289.9 | - | |
| 58 | crate | Crate | jerusalem | 5065.2 | -1420.4 | - | |
| 59 | crate | Crate | jerusalem | 6386.2 | -580.2 | - | |
| 60 | crate | Crate | jerusalem | 5071.5 | -1920.1 | - | |
| 61 | crate | Crate | jerusalem | 6916.3 | -2256.2 | - | |
| 62 | crate | Crate | jerusalem | 5356.0 | -1150.8 | - | |
| 63 | crate | Crate | jerusalem | 5330.6 | -1648.6 | - | |
| 64 | crate | Crate | jerusalem | 6296.8 | -2366.7 | - | |
| 65 | crate | Crate | jerusalem | 5544.4 | -1762.9 | - | |
| 66 | safehouse | Safehouse (Coral Motel) | eilat | 4645.1 | -12095.3 | w959763370 | |
| 67 | shop | Duty-Free Dudu - guns, armour, fence | eilat | 4930.0 | -12947.4 | w852999335 | |
| 68 | bank | Red Sea Offshore Bank | eilat | 5041.5 | -13132.6 | w852999292 | |
| 69 | crossing | Southern crossing (Taba road) | eilat | 3995.4 | -13985.0 | - | |
| 70 | crate | Crate | eilat | 3685.2 | -12759.5 | - | |
| 71 | crate | Crate | eilat | 5446.2 | -12454.8 | - | |
| 72 | crate | Crate | eilat | 3604.1 | -12071.9 | - | |
| 73 | crate | Crate | eilat | 4410.1 | -13345.9 | - | |
| 74 | crate | Crate | eilat | 4239.0 | -12485.4 | - | |
| 75 | crate | Crate | eilat | 3856.8 | -13504.7 | - | |
| 76 | crate | Crate | eilat | 4203.4 | -12937.3 | - | |
| 77 | crate | Crate | eilat | 4214.0 | -12041.7 | - | |
| 78 | crate | Crate | eilat | 5448.3 | -13107.1 | - | |
| 79 | crate | Crate | eilat | 4711.8 | -12494.2 | - | |
| 80 | airport | Ben Gurion Airport - departures | - | 3000.0 | -900.0 | - (runtime: airport_Ben Gurion Airport) | |
| 81 | delivery | Yossi's Express Courier | telaviv | 730.7 | 1277.1 | - | |
| 82 | delivery | Carmel Cargo & Courier | haifa | 2877.3 | 6153.8 | - | |
| 83 | delivery | Moshe's Moving & Parcels | jerusalem | 6186.0 | -2229.4 | - | |
| 84 | delivery | Red Sea Rush Deliveries | eilat | 4475.5 | -12446.7 | - | |

**Counts:** 59 crates (including the Stash), 7 banks, 4 safehouses, 4 shops, 4 delivery, 2 escape, 1 casino, 1 job, 1 forger, 1 crossing, 1 airport.

**Guardrails.**
- Every spot comes from a POI outside all 75 m buffers around worship sites, cemeteries, schools, hospitals and major historic sites.
- The boat spots are pier tips that clear their buffers.
- All names are generic or parody: no real brands, no real people.
- Cities and venues are the only labels.

Source: Data/zones/world.json `spots`; zones.py:37-101, 262-298; EscCity.cpp:878-887, 1666-1673, 3565-3591.

---

### 28. Layer summary (collision and colours)

**With collision:**
- all ground layers (inset, filler, sand), the seabed, piers and the highway divider, edge walls
- mesas, hills and big rocks
- the airliner
- buildings and hidden shell boxes
- props: street lamps, palms, ficus (trunk only), bus stops, kiosks, lifeguard towers, containers, cranes, acacias
- interior items: slot machines, wood, fabric, felt, booths, steel, round steel, black fittings, tyres, glass, white fittings, crates
- fallback tree trunks

**No collision:**
- water, roads, paths, markings, sidewalks, kerbs, lawns
- solar heaters, water tanks, AC units, benches, bins, umbrellas, loungers, shrubs, small rocks
- parapets, balconies, rails, awnings
- shell skins (facade and plaster)
- floors, rugs, wainscot, baseboards, lamps, gold, chairs, bottles, yellow fittings, signs
- fallback tree crowns

**Prop size reference** (from `Tools/blender/props.py`; pivot at the base centre, +X forward):

| Prop | Size / notes |
|---|---|
| Palm | ~9 m |
| Ficus | ~6 m |
| Street lamp | ~8 m pole, 2.4 m arm over the road (+X) |
| Bench | 1.8 m, faces +X |
| Bus shelter | 4.2 m, open to +X |
| Kiosk | 4.2 m octagon, counter on +X |
| Lifeguard tower | 4.2 × 3.7 m, windows to +X |
| Container | 12.19 × 2.44 × 2.59 m, doors +X |
| Port crane | ~45 m tall, legs 18 m apart along Y and 16 m along X, 30 m boom over +X |
| Shrub | ~1.4 m |
| Rock | ~3 m × 1.8 m |
| Acacia | ~6 m tall, ~7 m crown |
| AC unit | wall plane at local x = −0.21 m, grille to +X |
| Solar heater | collector faces +X |
| Hill | 100 × 100 × 15 m (§21) |

Source: EscCity.cpp:752-774, 905-958, 1594-1636, 2316-2389; props.py:200-1152.

---

### 29. Shipping the data in the web build

**What to ship.**
- Ship only the runtime inputs:
  - `world.json`
  - per inset: `buildings.csv`, `roads.json`, `inset.json` (`size_m`, `land_rows`, `piers`, `attribution`)
  - the `leisure=park` and `shop=kiosk` rows of `pois.json`
- Do not ship `preview.png` (6.2 MB) or `coast`.
- `sensitive.json` stays in the repo for a build-time test: assert that no spot lies inside a buffer.

**Packing.** At build time, a Node script (`tools/pack-data.mjs`) writes one file, `public/data/world.pack.json`:
- coordinates as integers in decimetres, sizes and yaw in hundredths
- road types as indices into the style table
- every building id string kept, because the hashes need it
- flat arrays
- served gzip or brotli (Vite static)
- Measured: **973,364 bytes raw / 347,643 bytes gzip**, against 1.93 MB for the loose files.

**Load path.**
1. Fetch the pack.
2. Generate in a worker (§5).
3. Show progress, then start.

**If the data files are not available,** regenerate them with §4: Python with pyosmium, rasterio, numpy and scipy, plus the Geofabrik extract and the 4 WBM tiles. Expect small differences if OSM has changed since.

Source: osm.py:549-562; Tools/ue/make_game.py:8, 96-103; Config/DefaultGame.ini:198; measured on Data/ (2026-10-20 files).

---

### Addendum: Spot set pieces (the prop at each gameplay spot, its facing and collision)

§13 builds the halls and §27 places the spots, but each interactable spot also carries its own prop. These props are the
things players look at when they press E. Every spot stands on the ground or hall floor (z = 0). In the **spot frame**,
+F is the spot's facing and +R is 90° clockwise from +F seen from above (right-handed web: R = cross(F, up)). All props
come from 06 §9, modelled facing +X, so the prop's +X is set to +F unless a yaw is given.

**Facing (+F), set once on the host when the spot is created.** It is deterministic from static data, so every peer can
compute it.

| Mode | +F |
|---|---|
| shop, casino, job, bank, forger, airport | Out through the hall door, from the hall centre toward the door wall chosen in §13 (Unreal: from the hall centre a chest-high ray, 1.5 m up, toward each of the 4 wall mid-faces; the single wall the ray passes is the door). If that fails (0 or 2+ open walls), use the town direction. Counters therefore face the door, and customers stand between the door and the counter. |
| delivery | The town direction rotated 90° counter-clockwise, so the spot's **+R side faces town** (the parcels and the open side of the van). |
| escape (boat) | The mooring direction (below). |
| crate, stash, bag, crossing | Unrotated: +F = north. |

**Town direction** = the 2D direction from the spot to the nearest safehouse spot. `EscTp` lands on that side (05 H17).

**Props per mode** (offsets in metres, spot frame (F, R, up)):

| Mode | Prop(s) | Placement | When unavailable |
|---|---|---|---|
| crate / stash | `Crate` | origin | `CrateOpen` |
| shop | `ShopCounter` | origin | — |
| casino | `SlotMachine` (one) | origin | — (the hall's slot-machine rows are §13 decoration) |
| job | `BurgerCounter` | origin | — |
| bank | `Vault` | origin | `VaultOpen`. A running heist still counts as available, so the door stays shut until the heist ends; then the vault shows open for the 600 s cooldown |
| forger | `ForgerDesk` | origin | — |
| airport | `CheckInDesk` | origin | — |
| delivery | courier `van` model (06 §8, white `E8E6DF`, front +F, wheels on the ground) at (0, −0.4); `ParcelStack` at (−0.3, +1.4) | everything lies within 2.5 m of the origin, so `EscTp`'s landing 3 m out is clear | — |
| bag | `CashBag` | origin, yaw 0 (heist bags: 2 m in front of the vault, 02 §4.4) | — |
| crossing | `GuardBooth` at (0, −4.5) with its door toward +F (north, toward town); `BoomGate` at (0, −3.0), its arm spanning 8 m to the east across the road | — | — |
| escape (boat) | `Boat` with its centre at (D, 0) and the waterline at sea level (−0.15 m), bow along +R (lying alongside the pier) | D = mooring distance | — |

**Mooring search (boat spots only).** Find open water for an 8 × 2.8 m boat lying alongside:
- Try yaws starting seaward (town direction + 180°), then +15°, −15°, +30°, −30° … up to ±120° (17 yaws).
- For each yaw, step the distance D from 2.5 m to 10 m in 0.25 m steps, and stop at the first clear D. Skip any D at or
  beyond the best found so far.
- A D is clear when all 39 sample points are open water: 3 rows across the beam (D − 1.6, D, D + 1.6 m out) × 13 points
  along the hull (−4.3 … +4.3 m, 0.72 m apart). "Open" means a vertical ray from +5 m to −5 m hits no static geometry,
  or hits only the seabed (impact below −0.10 m). Ground, piers and props count as blocked.
- The smallest clear D over all yaws wins, and its yaw becomes +F. If none is clear, use yaw 0 (north) and D = 6 m.
- Unreal replicates D as `boatOut`. On the web every peer can run the search on its own static world; or send D in
  `welcome`.

**Collision.**
- Props that have collision in 06 §9 block with it.
- The first prop without its own collision gets an invisible blocking box of its bounds instead. In practice that is the
  van (5.0 × 2.07 × 2.2 m at (0, −0.4)).
- **Bags never block** players, cars or bullets. Unreal kept them on the visibility channel only, so they can be focused.
  On the web, give them no physics collider.
- Spot props are static. They are part of the soldiers' and civilians' navigation obstacles (03_ai.md, Addendum: Web navigation for on-foot AI).

Source: EscInteractable.cpp:160-232 (mooring), 234-277 (door), 346-393 (facing), 421-590 (props, collision, bag);
EscInteractable.h:142 (`BoatOut` 600).
