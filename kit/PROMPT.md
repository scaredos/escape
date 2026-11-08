# Build "Escape Israel" as a co-op web browser game

You are building a complete, playable, co-op 3D browser game from a detailed spec. The game already exists as an
Unreal Engine 5 project (too big to share with friends: ~1 GB). Your job is to rebuild it for the browser so friends
can play by opening a URL. Work autonomously through the milestones below, verify each one yourself (automated
tests + screenshots you actually look at), and do not stop at a prototype: the goal is the full game loop, in
multiplayer, deployed as a static site.

## 1. The kit (read this first)

You have been given a folder (or zip) `escape-web-kit/`:

| Path | What it is | How to use it |
|---|---|---|
| `PROMPT.md` | this brief | the plan and the rules |
| `spec/01_world.md` | world layout, coordinates, data schemas, deterministic city generation (roads, buildings, venues, dressing, ports, beaches, desert, parked cars, gameplay spots) | **authoritative** |
| `spec/02_economy.md` | wallet, interaction model, every spot mode and menu line, prices, odds, jobs, heists, deliveries, objective line, save | **authoritative** |
| `spec/03_ai.md` | heat/stars, soldiers + web soldier AI, helicopter, tank, roadblocks, civilians, health/armour, ragdoll knockback, death/respawn/team wipe, the 3 finales, end card, broadcast texts | **authoritative** |
| `spec/04_vehicles.md` | key bindings, movement, camera, weapons, vehicle roster/physics, enter/exit/carjack, run-overs, parked cars, NPC traffic | **authoritative** |
| `spec/05_hud.md` | every HUD element and text format, world markers, full-screen map, end card, front-end flow, multiplayer model + **web netcode design**, dev console/cheats, scripted tests | **authoritative** |
| `spec/06_art.md` | look and palette, lighting/sky/fog/post, procedural textures and shaders, all 39 props, 7 vehicles, characters, rendering pipeline, download budget | **authoritative** |
| `data/zones/world.json`, `data/gen/<inset>/*` | the real map data (OpenStreetMap-derived, 4 city squares at 1:1): buildings.csv, roads.json, pois.json, inset.json, sensitive.json | input to `tools/pack-data.mjs` (spec 01 §3, §29) |
| `reference/` | the original generator scripts (Blender props/vehicles/characters/textures, OSM pipeline) | read when a spec line says "see source" or you need exact geometry; never run Blender |
| `screenshots/` | in-game screenshots of the Unreal version | the target look; compare your screenshots to these |

Read all six spec files completely before writing code, then re-read the relevant one at the start of each
milestone. The spec gives exact numbers, strings, formulas and timings: implement them as written. Items marked
**(choose)** are yours to decide; make a sensible choice and record it in `DECISIONS.md`. If two spec files
disagree, prefer the one that owns the subject (the table above) and note it in `DECISIONS.md`. Do not add features
the spec doesn't ask for until every milestone passes.

## 2. The game in one page

- **Pitch:** a GTA-style co-op crime caper in a compressed, stylised Israel. 1-4 friends start unarmed with ₪500 in a
  Tel Aviv safehouse, make money (crates, holding up civilians, burger-job shifts, a casino, courier deliveries
  between cities, bank heists whose cash bag must be carried to a shop to fence), buy guns and armour, and pay their
  way out: **boat** (Jaffa or Haifa, ₪15,000 per living player, then hold the pier 60 s at 5 stars), **airport** (Ben
  Gurion, ₪25,000 per living player + a forged passport each, 0 stars throughout, hold 30 s), or the **southern
  border** at Eilat (₪10,000 for the team, hold 90 s at 5 stars). An end card rates the run Broke / Comfortable /
  Kingpin by money left.
- **Opposition:** a 0-5 star wanted level. Crimes add heat; soldiers spawn out of sight and hunt you (more per star),
  a helicopter with a spotlight from 3 stars, a tank at 5 stars, highway roadblocks from 3 stars. Break line of sight
  and the stars decay. The hunters are the IDF in the game's design; on screen they are generic soldiers (olive
  uniforms, plain patch, no real insignia or flags), and any faction name lives in one config string.
- **World:** four 2 x 2 km city squares at real 1:1 scale from OpenStreetMap (Tel Aviv-Jaffa, Haifa, Jerusalem,
  Eilat), placed close together and joined by three highways across generic coast, fields and Negev-style desert.
  Dense textured mid-rise blocks with windows, shutters, balconies, shopfronts, rooftop solar heaters and water
  tanks; Jerusalem all in stone; palms and ficus on sidewalks; container port and cranes in Haifa; beaches with
  umbrellas; enterable venues (safehouses, shops, banks, casino, burger joint, airport hall, forger).
- **Life:** ~30 walking civilians per occupied city (pairs/trios, idling, fleeing from gunfire), ~14 NPC traffic cars
  with visible drivers, 40 parked cars (plus 3 at each highway end). Any car can be entered with **F** (or E next to
  it); traffic slowed to <= 4 m/s can be carjacked (the driver is dragged out and runs).
- **Feel:** third-person shooter controls, hold **Shift** to sprint (1.6x, no dash), slapstick ragdoll launches
  scaled by weapon and cut by armour, no gore.
- **Content guardrails (keep all of them):** no gore; civilians are generic (no religious dress or ethnic markers);
  killing civilians never pays (no loot, heavy heat); every gameplay spot stays outside the 75 m sensitive-site
  buffers (worship, cemeteries, schools, hospitals, major historic sites; `sensitive.json`); Gaza and the West Bank
  are never mapped (no buildings, labels or zones there); no military land use; no real brand logos (the burger joint
  is the parody "McShekel's"); OSM and Copernicus attribution in the credits.

## 3. Fixed technology decisions

- **Vite + TypeScript (strict)**, no UI framework. HUD/menus drawn with a 2D canvas overlay or plain DOM (spec 05).
- **three.js** (current release, pinned) for rendering: InstancedMesh per chunk and per prop type, procedural
  GPU-generated textures and world-aligned/triplanar shaders (spec 06). No large texture or model downloads.
- **Rapier** (`@dimforge/rapier3d-compat`) for physics: kinematic character controller for people, ray-cast vehicle
  controller for cars, simple ragdolls or impulse-driven bodies for knockback.
- **PeerJS (WebRTC)** for co-op: the host's browser runs the authoritative simulation (listen server); up to 3
  friends join with a 5-character room code (4 players max). Exact protocol, tick rates, snapshot/interpolation/
  prediction design: spec 05 H15-H16. Single-player is simply a host with no clients: one code path.
- **World generation in a Web Worker** from one packed data file (`tools/pack-data.mjs` -> `public/data/world.pack.json`,
  ~350 KB gzipped; spec 01 §29). Deterministic: one shared PRNG + string hash + Perlin (spec 01 §1), never
  `Math.random` in generation, so every peer builds the identical world locally and nothing about the static world
  is networked.
- **Playwright** for automated tests and screenshots (headless Chromium with WebGL via SwiftShader/ANGLE; spawn two
  browser contexts for multiplayer tests; run a local `peerjs --port 9000` server for tests).
- **Deploy** as a static site (GitHub Pages, Netlify or itch.io HTML5). First load **<= 6 MB** compressed
  (spec 06 §12). Targets: 60 fps on a mid-range laptop at the Medium preset, < 300 draw calls, world generated in
  < 5 s with a progress bar.

## 4. Architecture

```
escape-web/
  index.html  vite.config.ts  package.json  README.md  DECISIONS.md
  tools/pack-data.mjs           # data/ -> public/data/world.pack.json (+ build-time sensitive-buffer assertions)
  tools/shot.mjs net_test.mjs   # screenshot and two-player harnesses (spec 05 H18)
  public/data/world.pack.json
  src/
    main.ts                     # boot, quality preset, menus, start host/join
    core/      rng.ts hash.ts perlin.ts time.ts events.ts probe.ts   # PROBE log: window.__probes + console
    data/      pack.ts          # load/unpack world data
    world/     gen.worker.ts city.ts roads.ts buildings.ts venues.ts dressing.ts ports.ts beaches.ts desert.ts
               highways.ts spots.ts walkpoints.ts drive-roads.ts queries.ts   # spec 01
    render/    textures.ts (procedural) materials/ (facade, textured, water, glass) sky.ts props/ vehicles/
               characters/ chunks.ts quality.ts                              # spec 06
    physics/   world.ts character.ts vehicle.ts ragdoll.ts
    game/      director.ts heat.ts soldiers.ts soldier-ai.ts civilians.ts hunters.ts roadblocks.ts
               interactables.ts economy.ts jobs.ts heist.ts delivery.ts casino.ts finales.ts weapons.ts
               damage.ts traffic.ts vehicles.ts save.ts                     # specs 02-04
    net/       host.ts client.ts protocol.ts snapshots.ts prediction.ts interpolation.ts   # spec 05 H15-H16
    ui/        hud.ts wallet.ts objective.ts prompt-menu.ts feed.ts markers.ts map.ts endcard.ts
               frontend.ts credits.ts                                       # spec 05
    dev/       console.ts cheats.ts script.ts                               # spec 05 H17-H18
  tests/       *.spec.ts (Playwright) + screenshots/
```

Rules: game rules run only in the host simulation (`game/`); clients send inputs and requests and render snapshots.
Keep rendering, physics and rules separate so the host can also run headless in tests. Every system logs PROBE
events (same names as the spec) so tests can assert on them.

## 5. Milestones (do them in order; each ends with its checks passing)

For every milestone: write Playwright tests that drive the game through the dev console / URL script
(`?script=` + URL-encoded `EscTp casino;wait 3;shot` - spec 05 H18), assert on PROBE events, save screenshots to
`tests/screenshots/`, and **open and look at the screenshots yourself**; compare them with `screenshots/` in the
kit and fix what looks wrong before moving on. Commit after each milestone.

1. **Data and world.** Pack the data; generate all 4 insets, filler land, coast/sea, highways, buildings with the
   facade shader (windows, shopfronts, stone in Jerusalem/old Jaffa), roads/sidewalks/kerbs/markings, parks, ports,
   beaches, desert scatter and hills, all street furniture and rooftop dressing, enterable venues with interiors.
   Free-fly camera. Checks: a `city_built` PROBE (the Unreal event name) with counts in line with spec 01 (about
   10.4k building boxes, 19 shells, 3 highways, 0 building overlaps); generation time; draw calls; aerial screenshots
   of Tel Aviv, Jerusalem, Haifa port and Eilat plus a street-level shot look like the kit screenshots.
2. **On foot.** Character controller, third-person camera, walk/run/sprint/jump, collision with buildings and props,
   entering venues through their doors, animated characters (walk/run/idle/aim; option A or B from spec 06 §7.3),
   unarmed and armed poses. Checks: walking down a street and into a venue; no T-poses; sprint speed x1.6.
3. **Interaction and economy.** Focus/E/Up/Down menus, every spot mode in spec 02 (crates + the pistol stash, shops,
   casino, McShekel's shifts, banks/heist bags/fencing, deliveries between cities, forger, safehouses), the shared
   wallet, the objective panel, saving/loading (host). Checks: scripted runs of each mode produce the exact messages
   and wallet changes in the spec.
4. **Combat, heat, AI.** Weapons (3 slots, ammo, reload, ADS), damage/armour, ragdoll knockback, heat/stars/search
   bar, soldiers spawning out of sight and engaging, civilians (crowds, groups, fleeing, hold-ups), death/respawn after
   10 s at the safehouse nearest a living teammate, team wipe. Checks: firing near civilians raises heat; soldiers
   appear per star and lose you when you break line of sight; killing a civilian adds heat and drops nothing.
5. **Vehicles and traffic.** The 7 vehicle models, drivable cars (top speed ~95 km/h), F (or E) to enter and F to exit
   with HUD prompts, see-through glass with visible drivers, run-overs, 40 + highway-end parked cars, ~14 NPC traffic
   cars following the drive roads with junction choice, braking and stuck recovery, carjacking. Checks: get in/out
   with the real key path; traffic keeps moving (count moving vs stuck over 3 minutes); carjack spawns a fleeing
   civilian.
6. **Hunters and finales.** Helicopter with spotlight, tank, highway roadblocks; boat, airport and border finales
   with their rules, timers, cancellation/refund, and the end card. Checks: each finale reachable by script and ends
   on the right end-card text.
7. **Multiplayer.** PeerJS host/join with room codes, snapshots, interpolation, client prediction, vehicles driven by
   clients, join-in-progress, disconnect rules (bags drop), version check, 4-player cap. Checks: two (then four)
   Playwright browser contexts on a local PeerJS server: both see the same wallet, stars, NPCs and cars; the client
   drives a car; a client disconnect drops its bag.
8. **Polish, performance, deploy.** Quality presets, loading screen/progress, main menu (Host game / Join game with
   code / Settings / Controls / Credits), procedural Web Audio sounds (spec 06 Addendum: Audio), frame-time and download-size checks, README with how to play
   and how friends join, deploy to a static host and give the URL.

## 6. What matters most for the feel (don't cut these)

- The city must be dense and real (1:1 OSM streets and blocks), textured, with windows and rooftop clutter, not grey
  boxes. Calm warm palette, strong Mediterranean sun, soft haze (spec 06 §1-2).
- Busy streets: walking crowds and moving traffic around the players.
- Snappy controls: Shift sprint, F into any car, readable HUD prompts (`[E] ...`, `[F] Get in`).
- Funny ragdoll launches, scaled by weapon and cut by armour; no gore.
- Co-op that works over the internet with a room code and no install.

## 7. Don'ts

- Don't download big asset packs or ship large textures/models: build textures, props and vehicles procedurally from
  the spec (exception: one small CC0 animated character pack if you choose option A, within budget).
- Don't use Unreal or Blender, and don't try to port Unreal assets.
- Don't trust clients: the host validates every request (range, liveness, action in the host-built option list).
- Don't use `Math.random` in world generation, and don't generate the world on the main thread.
- Don't drop the guardrails in section 2.
- Don't stop at "it renders": the milestone checks define done.

When everything passes, report: the deployed URL, how to host/join, what each milestone's tests cover, your
`DECISIONS.md` highlights, the measured download size and frame time, and anything left undone.
