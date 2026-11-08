## Art direction and asset recipes (small-download web build)

The whole look is generated in code. The game downloads no textures. Props and vehicles are low-poly flat-shaded parts with one flat colour per part. Buildings are boxes painted by a shader. Ground, roads and walls use procedural tiling textures that are baked on the GPU when the game loads. Everything below is measured from the Unreal build. Values marked "(choose)" are web defaults that do not exist in the source.

---

### 1. Target look and master palette

**Overall look.** A bright, sunny Mediterranean city at mid-day: hard sun, short crisp shadows, a warm dusty haze on the horizon and a blue sky with white cumulus clouds.

- **Buildings.** Cities are pale cream, beige and off-white plaster boxes, or honey limestone in Jerusalem and old Jaffa. Every wall has a regular grid of aluminium sliding windows, and each window has a roller shutter that is open, half down or closed. Some upper floors have balcony doors with dark railings. About 40 % of buildings have a shopfront ground floor of dark glass under a coloured fascia.
- **Roofs.** Roofs are flat light-grey concrete with dark-blue solar water heaters, black water tanks and parapets. Some walls carry white AC units.
- **Streets.** Dark asphalt with cream lane dashes, light-grey square pavers on the sidewalks, round dark-green ficus trees, date palms, galvanised street lamps and striped canvas awnings.
- **Sea and land.** The sea is a deep teal-navy that turns pale sky-blue at grazing angles. Beaches are warm sand. The land between cities is tan desert strewn with pebbles, with olive scrub and flat-topped acacias.
- **Style.** Stylised low-poly, faceted (flat-shaded with a 40° crease) and colour-blocked. There are no photographic textures, no logos and no readable text, except the venue sign names drawn on sign boards.
- **People.** Soft "clay figure" humans with smooth tube limbs, a big head (×1.1), dark dot eyes and solid-colour clothes. Soldiers wear olive.

**Master palette** (sRGB hex; roughness after the slash where it matters):

| Group | Colours |
|---|---|
| Plaster walls (8, chosen by building-id hash) | `F2EFE6` `E8DCC0` `D9C7A3` `EDE8DA` `D6D6D2` `EBD3C8` `EFE3B0` `F5F1EA` |
| Limestone walls (4) | `CFC1A0` `C9B48A` `D8C9A6` `BFAE8C` |
| Faction (army) | uniform `5B6B3A`, vest `4A5530`, helmet `56603C`, boots `2E2A24`, patch `C9B46A` (plain rectangle, no insignia) |
| Skin tones in the roster | `C68642` `E0AC69` `8D5524` `F1C27D` `D4A373` |
| Road / ground fallbacks | asphalt `3B3D40`, paving `CBC3B4`, lot `B9B2A3`, sand `E3CF9F`, desert `D8B784`, fields `B3B386`, lawns `8DA05E`, markings `E8E2C8`/.7, kerbs `BDBAB2`/.85 |
| Sea | DeepColor linear (0.012, 0.12, 0.21) ≈ `1C617E`; SkyColor linear (0.2, 0.42, 0.55) ≈ `7CADC4`; flat fallback `1F6E99` |
| Vegetation | palm fronds `5F7F38`/`7C9447`, dry `9C7A48`; ficus `3D6A2E` `4F7D36` `2F5A27`; scrub `7E8456`/`A39A6A`; acacia `6B7A3A`/`8A9450` |
| Accents | awnings `B8322A` `2E7D4F` `2C5F9E` `D9822B` + stripes `F1EEE6`; container red/blue/green/grey `9E3B2E` `2B5D8F` `3F6E47` `8C9196`; crane red `C23B2E` |

The source's hex codes are sRGB. It converts them to linear before lighting. Web: create every hex colour with `new THREE.Color(0xRRGGBB)` while `ColorManagement` is enabled, so it is converted to linear. Pass the "linear" values in this document straight to `setRGB` with no conversion.

Source: EscCity.cpp:95 (Hex = sRGB), 914–946, 1637–1645; roster.json:2–9; make_materials.py:396–399.

---

### 2. Lighting, sky, fog and post-processing

Lighting is fixed at mid-day with no day/night cycle.

| Item | Unreal value | Web (three.js) |
|---|---|---|
| Sun | Directional, rotator pitch −50°, yaw 35°. Elevation 50°. The light travels toward bearing 35° (NNE→NE), so the sun stands at bearing **215° (south-west)**. Intensity 10 lux. Colour linear (1.0, 0.93, 0.82) ≈ `FFF7EA`. Drives the atmosphere. | `DirectionalLight` colour linear (1, 0.93, 0.82), intensity 3.0 (choose). Direction to the sun: elevation 50°, azimuth 215° from north. Shadows on: 2048² map, ortho box ±60 m that follows the camera, `bias −0.0005`, `normalBias 0.02` (choose). CSM with 3 cascades to 300 m on High (choose). |
| Sky light | SkyLight, real-time capture, intensity 1.2 | `HemisphereLight` sky `BFD4EA`, ground `C8B394`, intensity 1.0 (choose) |
| Sky | SkyAtmosphere (defaults) plus VolumetricCloud (default simple clouds) | Gradient sky dome from zenith `5D8CC6` to horizon `C9D3D8` (choose), or three/examples `Sky` with turbidity 4 and rayleigh 1.5 (choose). Clouds: fbm cumulus in the dome shader, about 35 % cover (choose). |
| Height fog | Exponential, density 0.005, in-scatter linear (0.8, 0.72, 0.6) ≈ `E7DDCB` (warm dust) | `FogExp2`, colour `D9D2C4` (between the in-scatter colour and the horizon, choose), density 0.00045 /m (≈ 50 % at 1.85 km, 84 % at 3 km). Camera far plane 3000 m (choose). |
| Exposure | Auto exposure, bias −0.3 EV (because a pale city with bright sky looked washed out) | `ACESFilmicToneMapping`, `toneMappingExposure` 0.8 (= 2^−0.3, choose) |
| Grade | White balance temperature 7000 K (warms the image), saturation 1.08, bloom 0.3, AO intensity 0.6 | Final pass: `col = mix(luma, col, 1.08) * vec3(1.03, 1.0, 0.95)` (choose). No bloom. SSAO/N8AO intensity 0.6 on High only. |
| Interior venue lights | Point lights, 7000 lm, colour (1, 0.9, 0.75), no shadows. Radius max(hall width, 25 m). Placed 0.8 m under the ceiling, ceil(hall length / 25 m) of them, between 1 and 5. A ceiling lamp panel `FFF3D0`/.15 (1.4 × 1.4 × 0.14 m) under each light. | `PointLight` colour (1, 0.9, 0.75), intensity ≈ 7000 lm / 4π cd (choose), `castShadow false`. Only turn these on when the player is within 40 m (choose). |
| Helicopter searchlight | colour (1, 0.96, 0.85) | `SpotLight`, same colour |

Source: make_game.py:234–257; EscCity.cpp:2241–2263; EscHunters.cpp:110.

---

### 3. Conventions for every asset

- **Units.** Metres, Z up in the source. Props and vehicles are built facing **+X (front)**, with **+Y = left** as seen from behind the object looking at its front, and the pivot at the centre of the base on the ground. Exceptions: the Boat's pivot is on the waterline, and the PortCrane's pivot is between its legs.
- **Axis conversion.** Map source (x, y, z) to three.js (x, z, −y). This is a proper rotation, the same one Blender's glTF exporter applies.
- **Placement.** World placements use the map yaw θ of spec 01 §1 (degrees counter-clockwise from east). The Unreal yaw is the compass bearing ψ = 90° − θ (0 = north, clockwise). Rotate the prop so that its local +X points along that heading: `rotation.y = θ·π/180` in three.js.
- **Shading.** Flat-shaded. Parts marked "smooth" keep smooth normals, but any edge sharper than **40°** stays hard. Web: `BufferGeometryUtils.toCreasedNormals(geo, 40°)` on the merged geometry. Vehicles use a 35° crease.
- **Thin surfaces.** Leaves, fabric and flags are double-sided because each face is stored twice, front and reversed. Keep back-face culling on.
- **Materials.** One flat colour and one roughness per part role (`Role HEX/roughness`). The default roughness is 0.75 for characters and props and 0.6 for vehicles. Metalness is 0 everywhere.
- **Web material model.** Merge each prop or vehicle into one `BufferGeometry` with a `color` attribute (linear) and a `rough` attribute. Draw it with one shared `MeshStandardMaterial` whose `onBeforeCompile` reads roughness from the attribute. That gives one draw call per prop type through `InstancedMesh`.
- **Glass.** Every part named "Glass" is **opaque** on props, buildings, the van, the helicopter and the tank. Only the sedan, taxi, pickup and jeep use see-through glass (section 5.5).
- **Collision.** Only the parts listed as colliders block movement. Trees collide on the trunk only. Rapier: a cuboid for each box, a capsule or cylinder for tubes, and a convex hull where the source used a hull.

Source: props.py:6–11, 150–184; veh_common.py:5–7; veh_heli.py:152; make_game.py:116.

---

### 4. Procedural textures (baked on the GPU at load)

**4.1 Generator.**
- Make one WebGL2 render-to-texture pass per set into a square **RGBA8** target: 512² by default, 1024² on High. The source baked at 1024² (choose).
- Output two textures per set:
  - `BC`: base colour encoded sRGB in RGB. A = 1, except for the window atlas, where A is the wall mask.
  - `NR`: R and G hold the tangent normal's x and y mapped to [0, 1], B holds roughness, A holds height.
- **Normals.** Build them from height × depth in metres, using wrap-around central differences with metres-per-pixel = tile / resolution. Compute n = normalize(−dh/du, −dh/dv, 1), where **v points down the image**. The material shaders rebuild the normal as `normalize(t.x*tU + t.y*tV + sqrt(1−t·t)*N)`, with tU and tV the world directions in which u and v grow, so generator and shader always agree.
- Generate mipmaps. Use repeat wrapping. Upload with `flipY = false`, so (0, 0) is the image's top-left.
- Do the colour maths in linear space and encode sRGB on output. Ramp stops are hex colours converted to linear and interpolated linearly.

**4.2 Noise vocabulary.** All of these must tile exactly over one tile. u and v run from 0 to 1 across a tile of TILE metres.
- `N(scale, detail=2, rough=.5, dist=0, su=1, sv=1, seed)` returns fBm in about 0..1, centred at 0.5.
  - Sample 4D simplex noise (webgl-noise, MIT) at P = (Ru·cos 2πu, Ru·sin 2πu, Rv·cos 2πv, Rv·sin 2πv)·scale + offset(seed).
  - Ru = TILE·su/2π and Rv = TILE·sv/2π, so `scale` means features per metre. su > 1 makes features finer along u.
  - Octaves = detail + 1 (blend the fractional last octave), lacunarity 2, gain = `rough`.
  - fac = 0.5 + 0.5·sum/Σamp. If it looks too contrasty, use 0.5 + 0.35·… (choose).
  - `dist` is a domain warp of that many metres.
- `vor(scale, warp?)` gives (F1 distance in cell units, per-cell random colour c.rgb). Use periodic 2D Worley noise with n = max(1, round(scale·TILE)) cells per tile edge and hash cells modulo n. `vorEdge` returns the distance to the nearest cell border, in cell units.
- `warp(s, amt)` offsets the sample point by (N(s, 3).rgb − 0.5)·amt metres.
- `ss(e0, e1, x)` is smoothstep, `mix` is lerp, and `ramp(t: stops)` is a piecewise-linear colour ramp.
- `bricks(rows, cmin, cmax, seed, stagger=true, vary=0)` works as follows:
  - vv = v + sin(4πv)·vary
  - rowf = vv·rows + 0.5, r = floor(rowf) mod rows
  - cols = cmin + floor(hash(0, r)·(cmax − cmin + 1))
  - x = u·cols + (stagger ? hash(1, r) : 0.5), c = floor(x) mod cols
  - **edge** = min(min(fx, 1 − fx)·TILE/cols, min(fy, 1 − fy)·TILE/rows), in metres
  - **rid** = hash(c, r, seed + 7)

**4.3 Sets.** Each entry gives the baked tile, the height depth per unit of height, base colour (BC), roughness (R) and height (H). Seeds are arbitrary but fixed.

- **Plaster** (4 m, 0.002 m)
  - fine = N(60, 8, .65); blob = N(9, 4, .6); mott = N(1.1, 5, .6)
  - streak = N(.8, 3, .5, su=16)·ss(.45, .7, N(.45, 2))
  - shade = 1 − (mott − .5)·.12 − ss(.35, .6, streak)·.045 − (fine − .5)·.12
  - BC = `EFECE5`·shade; R = .82 + (fine − .5)·.2; H = .6·fine + .4·blob
- **Stone** (4 m, 0.012 m). Ashlar with 12 courses of 5–7 blocks, staggered, vary .03.
  - chis = N(40, 7, .62); strokes = N(10, 3, .5, su=10) (vertical chisel marks); pits = vor(60).d
  - weather = N(1.4, 5, .6); wpatch = ss(.55, .75, N(.9, 5, .6)); mott = N(6, 4, .6)
  - tone = ramp(rid: 0 `EBE4D6`, .25 `E2D6C0`, .5 `EFE9DD`, .7 `DDD0B8`, .85 `E9DCCD`, 1 `D8C7AC`)
  - pit = 1 − ss(0, .18, pits); face = ss(.015, .035, edge)
  - tone ×= 1 − (weather − .5)·.25 − (mott − .5)·.15 − ((chis − .5)·.22 + (strokes − .5)·.18)·face − pit·.2 + (1 − face)·.03 − (1 − ss(0, .02, edge))·.06
  - tone = mix(tone, `AAA294`, wpatch·.4)
  - mortar = 1 − ss(.004, .007, edge)
  - BC = mix(tone, `CBC1B0`, mortar); R = .72 + .2·chis·face + .1·mortar
  - H = .6·ss(0, .015, edge) + (.4·chis + .3·strokes)·face − .15·pit
- **Asphalt** (6 m, 0.004 m)
  - (d, c) = vor(70); stones = ss(.8, .86, c.r); grain = N(60, 3, .6); patch = N(.45, 4, .6)
  - base = mix(`404041`, `52514E`, ss(.35, .65, patch))·(.82 + .36·grain); col = mix(base, `7D7972`, .85·stones)
  - ce = vorEdge(.45, warp(3, .2)); crack = (1 − ss(.002, .006, ce))·ss(.56, .62, N(.3, 2))
  - BC = mix(col, `1B1B1B`, .9·crack); R = .92 − .15·stones; H = .6·(1 − d)·stones + .4·grain − .8·crack
- **Paving** (3 m, 0.004 m). 10 × 10 square pavers of 30 cm, not staggered.
  - pick = hash(c, r, 34); tile = ramp(rid: 0 `CCC7BF`, .5 `C8C3BB`, 1 `C4BFB6`)
  - tile = mix(tile, `C0ACA0`, ss(.975, .977, pick)) (about 1 in 40 faded terracotta)
  - tile = mix(tile, `BFBBB4`, 1 − ss(.05, .052, pick)) (about 1 in 20 darker replacements)
  - (sd, sc) = vor(60); tile = mix(tile, ramp(sc.g: `A6A199` → `DAD6CE`), (1 − ss(.2, .35, sd))·ss(.5, .52, sc.r)·.3)
  - dots = N(110, 2); wear = N(9, 3, .6); dirt = N(.7, 4, .6); rim = 1 − ss(0, .015, edge)
  - tile ×= .95 + .08·dots + .1·(wear − .5) − .06·ss(.5, .8, dirt) − .05·rim
  - grout = 1 − ss(.002, .004, edge)
  - BC = mix(tile, `A19C93`, grout); R = .82 + .08·grout − .08·(wear − .5); H = ss(0, .012, edge)·(.9 + .1·dots) + .06·(rid − .5)
- **RoofConcrete** (6 m, 0.003 m)
  - mott = N(1.5, 6, .6); speck = N(45, 3, .6); pore = 1 − ss(0, .15, vor(55).d); stain = N(.35, 4, .6)
  - tar = (1 − ss(.002, .005, vorEdge(.5, warp(3, .15))))·ss(.6, .66, N(.4, 2))
  - base = mix(`C6C3BC`·(.92 + .1·mott + .07·speck − .08·pore), `ACA69B`, .35·ss(.5, .8, stain))
  - BC = mix(base, `7D7A74`, .8·tar); R = .9 − .25·tar; H = .3·mott + .2·speck + .3·tar − .3·pore
- **Sand** (4 m, 0.012 m). Ripples have a 14 cm wavelength.
  - ph = fract(28v + 2·N(.7, 3) + .3·N(2.5, 2)); rip = ss(0, .7, ph)·(1 − ss(.7, 1, ph))
  - amp = .3 + .7·ss(.3, .7, N(.4, 2)); grains = N(90, 2); mott = N(.8, 4, .6); speck = ss(.95, .97, vor(40).c.r)
  - BC = mix(`DCC59F`·(.88 + .14·grains + .1·rip·amp + .12·(mott − .5)), `8E7F6C`, .5·speck); R = .93; H = rip·amp + .15·grains
- **Desert** (6 m, 0.015 m). Desert pavement.
  - soil_n = N(2, 6, .6); big = N(.3, 3); fine = N(70, 2)
  - (d1, c1) = vor(7, warp(25, .06)) (stones 6–13 cm); (d2, c2) = vor(22) (grit); (d3, c3) = vor(2.2, warp(8, .15)) (rocks 15–35 cm)
  - pres1 = 1 − ss(.25 + .6·big, .27 + .6·big, c1.r); pres2 = 1 − ss(.45, .47, c2.r); pres3 = 1 − ss(.12, .14, c3.r)
  - r1 = .25 + .2·c1.g; r3 = .25 + .15·c3.g
  - dome(d, r, p) = √max(1 − (d/r)², 0)·p; dome1 = dome(d1, r1, pres1); dome2 = dome(d2, .3, pres2); dome3 = dome(d3, r3, pres3)
  - peb1 = ss(0, .2, dome1); peb2 = ss(0, .2, dome2); peb3 = ss(0, .15, dome3); halo = (1 − ss(0, .12, d1 − r1))·pres1
  - pcol = ramp(c1.b: 0 `4A382A`, .25 `6B5541`, .5 `8D8579`, .7 `A89C88`, .85 `8A5638`, 1 `5E4A3A`)·(.75 + .35·dome1)
  - rcol = ramp(c3.b: 0 `BDB5A5`, .5 `A59C8C`, 1 `C4B398`)·(.55 + .5·dome3 + .3·(fine − .5))
  - soil = mix(mix(`C2A983`, `AD9271`, soil_n), `D1BB97`, .6·ss(.55, .75, big))·(.9 + .2·fine − .12·halo)
  - BC = mix(mix(mix(soil, `7D6C58`, .75·peb2), pcol, peb1), rcol, peb3); R = .95 − .3·peb1 − .1·peb3
  - H = .15·soil_n + .05·fine + .8·dome1 + .3·dome2 + 1.5·dome3
- **Grass** (4 m, 0.008 m). Dry summer grass.
  - patch = N(.5, 4, .6); (td, tc) = vor(14, warp(30, .03)); tuft = 1 − ss(.15, .65, td)
  - blades = max(N(30, 3, .7, sv=5), N(30, 3, .7, su=5)); dirt = ss(.62, .72, N(1.2, 4, .6))
  - hue = ramp(.75·patch + .25·tc.r: .25 `6E7A40`, .45 `909050`, .62 `B5A663`, .8 `C6B47E`)
  - BC = mix(hue·(.5 + .35·tuft + .4·blades), `8A7356`, .8·dirt); R = .92; H = .6·tuft + .4·blades − .3·dirt
- **Lot** (6 m, 0.006 m). Dusty urban ground.
  - big = N(.35, 3); soil_n = N(1.6, 6, .6); fine = N(70, 2)
  - slab = ss(.55, .57, N(.5, 4, .6, dist=.4) + .08·(N(5, 4, .6) − .5))
  - crack = (1 − ss(.006, .012, vorEdge(1.3, warp(5, .1))))·ss(.5, .56, N(.6, 2))·slab
  - (gd, gc) = vor(28); peb = (1 − ss(.25, .5, gd))·ss(.75, .77, gc.r)·(1 − .8·slab)
  - (fd, fc) = vor(80); grit = (1 − ss(.2, .45, fd))·ss(.6, .62, fc.r)
  - (td, tc) = vor(2.5, warp(20, .04)); blades = max(N(40, 3, .7, su=6), N(40, 3, .7, sv=6))
  - clump = max(.75·ss(.5, .62, N(.45, 3, .6)), .04)·(1 − .9·slab); there = 1 − ss(clump − .01, clump, 1 − tc.r)
  - tuft = ss(.5, .58, .95 − 2.5·td + .75·ss(.4, .7, blades))·there
  - soil = mix(mix(`C4BCAD`, `B7AE9E`, soil_n), `CDC6B8`, .35·ss(.5, .75, big))·(.95 + .1·fine − .08·(1 − ss(0, .5, td))·there)
  - conc = mix(`C4C0B7`, `BAB5AB`, ss(.4, .7, big))·(.95 + .05·fine + .06·(soil_n − .5))
  - col = mix(soil, conc, .7·slab)
  - col = mix(col, ramp(fc.g: `A2988A` → `D2CBBE`), .35·grit)
  - col = mix(col, ramp(gc.g: 0 `9C9180`, .4 `CDC6B8`, .7 `B0A491`, 1 `8D8577`), .7·peb)
  - col = mix(col, `958C7A`, .6·crack)
  - tcol = ramp(tc.g: 0 `B4A984`, .5 `C0B38C`, 1 `A09D7C`); tcol = mix(.65·tcol, tcol, ss(.3, .7, blades))
  - BC = mix(col, tcol, .9·tuft); R = .95 − .06·slab
  - H = .08·soil_n + .1·fine + .2·slab − .3·crack + .35·peb + .1·grit + tuft·(.5 + .5·blades)
- **Tiles** (2.4 m, 0.002 m). Interior beige terrazzo, 6 × 6 tiles of 40 cm, not staggered.
  - (cd, cc) = vor(55, warp(30, .02)); chip = (1 − ss(.3, .42, cd))·ss(.3, .32, cc.r)
  - (fd, fc) = vor(110); grit = (1 − ss(.25, .4, fd))·ss(.3, .32, fc.r); wear = N(.8, 4, .6)
  - tile = ramp(rid: 0 `DCD3C4`, .5 `D8CEBE`, 1 `D4CAB9`)
  - tile = mix(tile, ramp(cc.g: 0 `A39888`, .3 `EFE9DF`, .6 `C2AD92`, .8 `8F8A84`, 1 `B89A83`), .55·chip)
  - tile = mix(tile, ramp(fc.g: `9A9186` → `ECE6DC`), .4·grit)·(.97 + .08·(wear − .5))
  - grout = 1 − ss(.0015, .003, edge)
  - BC = mix(tile, `B8AD9B`, grout); R = .3 + .12·(wear − .5) + .5·grout; H = ss(0, .004, edge) + .02·chip + .05·(rid − .5)
- **Water** (8 m, 0.35 m). Only NR.rg is used.
  - swell = N(.4, 3, .5, su=.6); chop = 1 − |2·N(1.2, 3, .5) − 1|; rip = N(4, 3, .55)
  - H = .6·swell + .25·chop + .08·rip

**4.4 Window atlas.** One texture of 2 × 2 cells. Each cell is one bay, **2.8 m wide × 3.2 m tall**, with the floor line at the bottom of the cell. Cell 0 (top-left) is a plain window with the shutter open. Cell 1 (top-right) has the shutter half down. Cell 2 (bottom-left) is a balcony door. Cell 3 (bottom-right) has the shutter closed.

Draw it with Canvas2D or a shader. Work in metres, with x from the cell's left edge and y up from the floor. `box()` is an anti-aliased rectangle. Colours are sRGB in 0..1.

1. Start with BC = 1 (white wall, so the wall tint multiplies it), roughness .85, height 0, alpha 1.
2. Every painted part sets **alpha 0**.
3. **Opening.** Window: (0.7, 0.95)–(2.1, 2.45). Door: (0.8, 0.03)–(2.0, 2.35). Fill it with the reveal colour alu (.80, .81, .81)·0.9, r .45, h −.09.
4. **Two sliding sashes.** Margins f = .05, s = .045, mid = (x0 + x1)/2.
   - The left sash spans x0 + f to mid + .02 (h −.10). The right sash spans mid − .02 to x1 − f (h −.085). Both are colour alu, r .4.
   - The glass is inset by s and sits 1 cm below its sash. r .05.
   - Glass colour = bot (.13, .16, .19) + (top (.60, .68, .76) − bot)·g^1.5, with g the height fraction inside the glass. Add 0.10·exp(−((x − gx0 − .55(y − gy0) − .15)/.07)²) as a diagonal glint.
   - Curtain: on the left sash for the plain window, on the right sash for the door. It covers the left 65 % of that pane with (.82, .78, .70)·(.85 + .15 sin(2πx/.09)) at 60 % opacity.
5. **Shutter guide rails.** 3.5 cm wide on both sides, colour shut (.86, .84, .80)·.9, r .55, h −.045.
6. **Shutter slats.** These fill from shut_to up to the top of the opening. shut_to is the top (open) for plain, 1.72 m for half, y0 for closed and 1.95 m for the door.
   - t = ((y1 − y)/.045) mod 1 (4.5 cm pitch); prof = sin πt
   - colour = shut·(.8 + .2·prof)·(t < .07 ? .62 : 1), r .55, h −.06 + .012·prof
   - Bottom bar: 4 cm, shut·.82.
7. **Window sill.** (x0 − .08, y0 − .06)–(x1 + .08, y0), sill colour (.83, .80, .75), r .7, h .03.
   - Below the sill, darken the wall with two dirt run-off streaks: ×(1 − .07·Σ exp(−((x − sx)/.05)²)) at sx = x0 − .04 and x1 + .04. They fade over 0.8 m and stay alpha 1.
8. **Door extras.**
   - Threshold ledge (x0 − .15, 0)–(x1 + .15, .04), colour sill.
   - Dark railing, rail colour (.22, .23, .24), r .45, h .12:
     - top rail at y 1.00–1.05 and bottom rail at y .08–.11, both spanning x0 − .1 to x1 + .1
     - two 4 cm posts, at x0 − .1 and x1 + .06
     - 1.6 cm balusters every 11 cm from x0 − .02 to x1 + .03, between y .11 and 1.0
9. **Baked light.** Pad the height map by 16 px.
   - Cast shadow downward: shadow = max over k = 1..15 px of (h[row − k] − h − k·py·0.9).
   - Cavity: cav = max(blur₆(h) − h, 0).
   - BC ×= clamp(1 − 4·shadow − 3·cav, .5, 1).
   - Compute the normal from blur₁(h).

Source: bake_textures.py:24, 96–141, 145–343, 434–439, 459–533.

---

### 5. World materials (shaders)

**5.1 Flat.** Colour and roughness only. Used for kerbs, markings, awnings, balconies and interior furniture boxes.

**5.2 Textured (ground, roads, rocks, hills).** World-aligned box projection along the instance's own axes, so road textures follow the road's yaw and stay continuous between boxes that share a yaw. Parameters: set, `Tint` (linear multiplier), `TileMetres`, RoughMul = 1.

```glsl
// W = world pos (m); ax, ay, up = instance axes (unit); N = world normal
vec3 nl = vec3(dot(N,ax), dot(N,ay), dot(N,up)), an = abs(nl), sg = sign(nl + 1e-6);
vec3 p = vec3(dot(W,ax), dot(W,ay), dot(W,up)) / Tile;
vec2 uv = p.xy; vec3 tU = ax, tV = ay;                                  // top / bottom faces
if (an.x >= an.y && an.x >= an.z) { uv = vec2(-sg.x*p.y, -p.z); tU = -sg.x*ay; tV = -up; }
else if (an.y >= an.z)            { uv = vec2( sg.y*p.x, -p.z); tU =  sg.y*ax; tV = -up; }
// sample with textureGrad(…, dFdx(uv), dFdy(uv)) built from W, so face edges get no mip seams
vec4 nr = texture(NR, uv); vec2 t = nr.rg*2.-1.;
N' = normalize(t.x*tU + t.y*tV + sqrt(max(0.,1.-dot(t,t)))*N);  rough = nr.b;
// slow tonal drift (tens of metres) so plains and long roads don't read as one tile; W.h1/h2 = the two horizontal coords
float drift = sin(W.h1/17. + sin(W.h2/23.)) + sin(W.h2/13. + 1.7*sin(W.h1/29.));
albedo = BC(uv).rgb * Tint * (1. + .04*drift);
```

Web: patch `MeshStandardMaterial` through `onBeforeCompile`, passing world position and instance axes as varyings. The instance axes are the columns of `instanceMatrix`, normalised.

**5.3 Facade (all building boxes, enterable-building outer skins and parapets).** Per-instance data: tint RGB (linear) and stone (0 = plaster, 1 = limestone). The box size comes from the instance scale. The geometry is a 1 m unit cube with its pivot at the centre.

```glsl
// q = metres from the box's lowest corner (box axes x=length, y=width, z=up); S = size (m); nl = normal in box axes
vec3 Sc = S*100.;                                   // hash in centimetres (matches the source)
vec3 k = fract(vec3(Sc.x*.731 + Sc.y*.317, Sc.z*.513 + stone*7.1, dot(tint, vec3(31.7,57.1,71.3))) * .1031);
k += dot(k, k.zyx + 31.32);
float hb = fract((k.x+k.y)*k.z), hb2 = fract(hb*173.31+.27), hb3 = fract(hb*371.17+.61);
bool endFace = abs(nl.x) > abs(nl.y);
float Wd = endFace ? S.y : S.x, H = S.z, z = q.z;
vec3 tU = normalize(cross(UP, Nworld)), tV = -UP;    // tU = viewer's right on the wall
float u = endFace ? (dot(tU,ay) > 0. ? q.y : S.y-q.y) : (dot(tU,ax) > 0. ? q.x : S.x-q.x);
// walls: 4 m world-aligned tiles, so parapets continue the wall below them
vec2 uvW = vec2(dot(W,tU), -dot(W,UP)) / 4.;
float lt = max(dot(tint, vec3(.2126,.7152,.0722)), .05);
vec3 wallC = mix(PlasterBC(uvW)*tint, StoneBC(uvW)*mix(vec3(1.), tint/lt, .35), stone);
vec2 wallN = mix(PlasterNR(uvW).rg, StoneNR(uvW).rg, stone)*2.-1.;  float wallR = mix(PlasterNR.b, StoneNR.b, stone);
vec3 col = wallC; vec2 tn = wallN; float r = wallR;
bool wall = abs(nl.z) < .5;
if (wall && H > 2.5 && Wd > 1.8) {
  float nF = max(1., round(H/3.2)), fh = H/nF, nB = max(1., round(Wd/2.8)), bw = Wd/nB;
  float bay = clamp(floor(u/bw), 0., nB-1.), flo = clamp(floor(z/fh), 0., nF-1.);
  float cu = u/bw - bay, cz = z/fh - flo;
  vec3 c = fract(vec3(bay, flo, hb*97.)*.1031); c += dot(c, c.zyx+31.32); float hcell = fract((c.x+c.y)*c.z);
  c = fract(vec3(bay, hb*89., nB)*.1031);       c += dot(c, c.zyx+31.32); float hcol  = fract((c.x+c.y)*c.z);
  if (flo < .5 && hb3 < .4 && Wd > 3.5) {          // shopfront on ~40% of ground floors
    float e = min(cu, 1.-cu)*bw, top = fh - .70;
    if (z > top) { col = z > fh-.12 ? wallC*.75 : PAL[int(hb2*4.99)]; r = .45; tn = vec2(0); }   // fascia
    else if (e < .10) col = wallC*.92;                                                           // pier
    else if (e < .16 || z < .12 || z > top-.06 || abs(cu-.5)*bw < .03) { col = vec3(.06,.06,.065); r=.35; tn=vec2(0); } // frame
    else if (hcell < .25) { float sl = 6.2832*z/.09; col = vec3(.45,.46,.47)*(.9+.1*sin(sl)); r=.45; tn=vec2(0., .3*cos(sl)); } // roller shutter
    else { float g = clamp((z-.12)/(top-.18),0.,1.); col = mix(vec3(.02,.025,.03), vec3(.09,.11,.13), g*g); r=.05; tn=vec2(0); } // dark glass
  } else {
    float cell = (flo > .5 && hcol < mix(.1,.4,hb2)) ? 2. : (hcell < .5 ? 0. : (hcell < .82 ? 1. : 3.));
    vec2 uvA = (vec2(mod(cell,2.), floor(cell*.5)) + vec2(cu, 1.-cz)) * .5;
    // textureGrad with derivatives of the continuous (u/bw, -z/fh)*.5, so bay borders get no mip seams
    vec4 a = WinBC(uvA); col = a.rgb * mix(vec3(1.), wallC, a.a);
    tn = mix(WinNR(uvA).rg*2.-1., wallN, a.a); r = mix(WinNR(uvA).b, wallR, a.a);
  }
}
if (wall) {
  col *= (H - z < (H > 2.5 ? .25 : .10)) ? .8 : 1.;                       // roof-edge / coping band
  if (H > 2.5) { float g = clamp(1.-z/1.5,0.,1.); col *= (1.-.3*g*g)*(.94+.06*clamp(z/H,0.,1.)); } // ground grime
} else if (nl.z > .5) {                                                    // roof
  vec2 uvR = vec2(dot(W,ax), dot(W,ay))/6. + vec2(hb, hb3);
  col = RoofBC(uvR)*mix(vec3(1.), tint, .1)*(.9+.12*hb2); tn = RoofNR(uvR).rg*2.-1.; r = RoofNR(uvR).b; tU = ax; tV = ay;
}
N' = normalize(tn.x*tU + tn.y*tV + sqrt(max(0.,1.-dot(tn,tn)))*Nworld);
```

`PAL` (linear) = black (.02, .02, .02), red (.45, .04, .03), blue (.02, .1, .3), green (.03, .18, .07), cream (.8, .78, .72).

How the instance data is chosen:
- The tint is the palette entry at index (building base-id hash mod 8). For stone buildings it is the limestone entry at index (hash mod 4), and stone = 1.
- Stone buildings are all of Jerusalem, Tel Aviv inset-local x < 1100 and y < 1250 m (old Jaffa), village houses, and 15 % of the rest by the seeded roll PRNG(hash(base id) ^ 0x57043).FRand() < 0.15 (spec 01 §12). The airport hall is plaster.
- The parts of a split building share the first part's facade.
- Building height = levels × 3.2 m.

**5.4 Water (opaque sea).** The surface is at −0.15 m and the seabed at −0.70 m. The seabed uses Sand at a 4 m tile with tint (.7, .66, .58).

```glsl
vec2 p = horizontal world pos (m);
vec2 a = WaterNR(p/9.  + t*vec2(.021, .013)).rg*2.-1.;
vec2 b = WaterNR(vec2(-p.y,p.x)/31. + t*vec2(-.006, .004)).rg*2.-1.;   // second layer turned 90°
vec2 s = a + .7*vec2(b.y, -b.x);
vec3 n = normalize(N + vec3(s along the two horizontal axes, 0.) * clamp(N.up,0.,1.));   // only up faces get waves
rough = mix(.06, .14, clamp(viewDepth/1500., 0., 1.));
float f = pow(1. - clamp(dot(n, toCamera), 0., 1.), 3.);
albedo = mix(DeepColor, SkyColor, f);   // linear (.012,.12,.21) → (.2,.42,.55); metalness 0
```

**5.5 Glass for cabins with an interior** (sedan, taxi, pickup and jeep only).
- Translucent, colour linear (.02, .03, .042) ≈ `27303A`, roughness .05.
- Opacity = mix(.35, .85, Schlick fresnel with exponent 5).
- `depthWrite false`, `castShadow false`, drawn after opaque.
- The cabin glass is one closed prism, so with back-face culling you see one pane, then the driver, then out the far side.
- The van, helicopter and tank keep opaque glass `2A3440`/.15, because a solid body sits behind their panes.

Source: make_materials.py:191–218, 242–350, 376–423; make_game.py:116–142; EscCity.cpp:916–929, 1248, 1497, 1594–1662.

---

### 6. World layers and dressing colours

**Layer tops** (separated to avoid z-fighting): ground 0, park lawns 0.01, sidewalks 0.02, paths 0.03, roads 0.04, markings 0.05, kerbs 0.10 m.

| Layer | Texture set, tile (m), tint (linear) | Notes |
|---|---|---|
| City ground | Lot, 6, 1 | Paving at 3.5 m tinted (.9, .86, .8) if Lot is missing |
| Jerusalem urban ground | Stone, 3, (.85, .83, .8) | |
| Beaches | Sand, 4, 1 | |
| Fields / beige fields | Grass, 6, 1 / (1, .88, .68) | |
| Desert / village ground | Desert, 8, 1 / Desert, 5, (.9, .8, .68) | |
| Zone rock boxes | Desert, 10, (.62, .5, .42) | |
| Piers | RoofConcrete, 3, 1 | |
| Roads | Asphalt, 6, 1 | Markings flat `E8E2C8`/.7 |
| Sidewalks and paths | Paving, 2, 1 (20 cm pavers) | Kerbs flat `BDBAB2`/.85 |
| Park lawns | Grass, 4, (.72, 1, .66) | Greener than the fields |
| Prop rocks | Desert, 4, (.95, .9, .84) | Replaces the rock's own colours |
| Hills | Desert 8 / Grass 6 / Grass 6 tinted (1, .88, .68) | Matches the ground underneath so the foot shows no seam |
| Interior walls | Plaster, 3, (1, .9, .76) | |
| Floors | Tiles 2.4, 1 (job, roughness .35); Tiles 3.6, (.7, .62, .53) (shop = garage); Tiles 2.4, (1, .86, .7) (safehouse, forger); Tiles 2.4, 1 (bank, airport, roughness .12); casino carpet flat `6E1A28` | The job floor gets a red checker `C41E24`/.35 over it |
| Airport plane | flat `F4F4F2`/.4 | |

**Interior flat colours:** carpet `6E1A28`/.95, slot body `4A1070`/.35, gold `D4A017`/.25, wood `7A5230`/.7, fabric `2F5D8A`/1, felt `1F6B3A`/1, booths `B03024`/.5, rugs `8E3B2A`/1, wainscot `5E4632`/.6, baseboard `2B2119`/.6, steel `A7ACB2`/.3, black fittings `161616`/.4, tyres `1A1A1A`/.9, glass `1E3560`/.05, white fittings `E4E2DC`/.4, chairs `3B302A`/.8, crates `9A7448`/.85, yellow `FFC72C`/.5, bottles `2E6B3A`/`A35A1A`/.1.

**Venue sign boards:**
- Board size: clamp(text width + 1.2 m, min(5.4 m, span), span) wide (spec 01 §13), 0.2 m deep, 1.9 m tall, bottom 4.0 m up (spanning 4.0–5.9 m; the text is centred at 4.95 m).
- Text: 1.3 m letter height, shrunk to fit.
- Board and ink colours:

| Venue | Board | Ink | Edging | Text |
|---|---|---|---|---|
| Bank, airport | blue `1F4E9A` | white | none | airport reads "DEPARTURES" |
| Casino | purple `4A1070` | (255, 205, 60) | gold | |
| Job | red `C41E24` | (255, 199, 44) | yellow | "McSHEKEL'S" |
| Shop | orange `E07020` | (20, 20, 20) | none | the name before " - " |
| Forger | grey `5F6368` | | | "PASSPORT PHOTOS" |
| Safehouse | no board | | | |

Web: draw the text into a CanvasTexture.

**Dressing:**
- **Parapets.** 0.25 m thick and 0.40 m tall on the roof edge. They use the facade shader with the building's tint.
- **Bauhaus balconies.** On about 35 % of Tel Aviv and Haifa blocks with 2–6 levels and a long side of at least 8 m, on every floor above the ground. Slab: wall length − 1.2 m long, 1.2 m deep, 0.15 m thick, `EFEBE3`/.85. Rail: 0.05 × 0.9 m tall, plus end rails, `D3CDC1`/.8.
- **Shop awnings.** On about 60 % of blocks within 8 m of a road of rank 2 or higher, one per 3.2 m bay, up to 5 per wall, each bay with 80 % chance.
  - Canvas 2.6 × 1.3 × 0.06 m, tilted 20° down, top edge 3 m up the wall.
  - One colour per building: red `B8322A`, green `2E7D4F`, blue `2C5F9E` or orange `D9822B`.
  - Two white stripes `F1EEE6` (0.52 m wide, at ±0.52 m), lifted 1.5 cm above the canvas.
- **Roof props.** On roofs of at least 5 × 5 m, with 80 % chance:
  - 1 to clamp(floor(L·W/70), 1, 4) SolarHeaters, facing south ±4°.
  - 0–2 WaterTanks when L·W > 60 m², at a random yaw.
  - Everything 1.5 m in from the edges and at least 2.4 m apart.
- **AC units.** On about 40 % of buildings with 2+ levels: 0–2 per wall of 6 m or more, at storey × 3.2 + 0.4 m, facing out.
- **Shell awning.** Over the door of an enterable building: `C0392B`/.6, door width + 1.6 m × 2.4 m × 0.2 m, 3.5 m up.
- **Roadblock.** Barriers are flat linear (.42, .41, .39)/.9. The boom is white (.9, .9, .9)/.5 with red stripes (.6, .03, .02)/.5.

Source: EscCity.cpp:905–946, 1603–1636, 2173–2238, 2346–2389, 2830, 2839–2951; EscRoadblock.cpp:107–110.

---

### 7. Characters

**7.1 Roster.** No dealer or vendor NPCs exist in the code: the shop, casino, burger counter, bank, forger and check-in desk are all unstaffed props. Looks are handed out **round-robin** per role: humans get fugitives 1→4, soldier bots get soldiers 1→4, and civilians alternate beach and elder. Traffic drivers use the civilian looks.

Defaults: height 1.75, shoulders/hips/girth 1.0, head 1.1, sleeve 0.55, hair `222222`, top `777777`, bottom `444444`, shoes `222222`.

| id | Height | Shoulders / hips / girth | Skin | Hair (style) | Hat | Top / sleeve | Bottom | Shoes | Extras | Armour | Tris |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fugitive_driver | 1.78 | 1.05 / 1 / 1 | `C68642` | `2B1D14` short | cap `E8833A` | `5B3A29` / .55 | `2F4A6D` | `F2F2F2` | | 0 | 6580 |
| fugitive_brains | 1.72 | .95 / 1 / .9 | `E0AC69` | `4A3020` short | | `1D9E75` / .55 | `3D3D3D` | `6B4F3A` | glasses, backpack `8C6A43` | 0 | 7036 |
| fugitive_muscle | 1.86 | 1.2 / 1 / 1.22 | `8D5524` | `1A1A1A` buzz | | `EDEDED` / .04 (vest top) | `6B6B47` | `2B2B2B` | beard | 0 | 6106 |
| fugitive_fixer | 1.68 | .9 / 1.1 / .92 | `F1C27D` | `6A2E1A` long | | `C0392B` / .55 | `1F1F1F` | `1F1F1F` | | 0 | 7102 |
| soldier_rifleman | 1.80 | 1.08 / 1 / 1.05 | `D4A373` | `2B1D14` buzz | helmet | uniform | uniform | boots | vest, kneepads, patch | 0.3 | 7276 |
| soldier_officer | 1.82 | 1.05 / 1 / 1 | `E0AC69` | `3A2A1E` short | beret `4E5A2E` | uniform | uniform | boots | belt, patch | 0.0 | 6712 |
| soldier_heavy | 1.84 | 1.18 / 1 / 1.25 | `C68642` | `1A1A1A` buzz | helmet | uniform | uniform | boots | beard, vest, kneepads, backpack `4A5530`, patch | 0.8 | 6626 |
| soldier_marksman | 1.76 | 1.0 / 1 / .95 | `F1C27D` | `6A4A2A` short | boonie `5B6B3A` | uniform | uniform | boots | vest, patch | 0.2 | 7388 |
| civ_beach | 1.74 | 1 / 1 / 1 | `C68642` | `2B1D14` short | | `F2C14E` / .12 (T-shirt) | `3A6EA5` shorts | `8B5A2B` | | 0 | 6768 |
| civ_elder | 1.70 | 1 / 1 / 1.1 | `E0AC69` | `C9C9C9` short | | `D9CBA8` / .55 | `6E5E4A` | `3B2F25` | beard `C9C9C9` | 0 | 6054 |

- **Soldiers.** Top and bottom are uniform `5B6B3A`, sleeves 0.55, boots `2E2A24` and 0.14 m tall (others 0.10). Helmet `56603C`/.85, vest and kneepads `4A5530`/.9, belt `2A2620`/.6 (any soldier or `belt`), patch `C9B46A`/.5.
- **Fixed colours.** Eyes, glasses and detail `1A1A1A`/.4. Lips `7A3B30`/.5. Eyebrows use the hair colour. Skin roughness .6, shoes .6, pack .85, everything else .75.
- **Civilian variety (web, choose).** Two civilian looks repeat visibly across 30–60 walkers. Generate variants instead:
  - skin from the faction tones `D4A373` `C68642` `E0AC69` `8D5524`
  - top from `F2C14E` `D9CBA8` `EDEDED` `1D9E75` `3A6EA5` `C0392B` `5B3A29` `8C6A43`
  - bottom from `3A6EA5` `6E5E4A` `3D3D3D` `2F4A6D` `6B6B47`
  - sleeve .12 or .55, shorts 30 %, beard 20 %, cap 15 %
  - Never use olive uniform colours on civilians.

**7.2 Body plan.** Use the reference height 1.75. Multiply every position by s = height/1.75. x = +left, −y = **front**, z up. The arms are in an A-pose at 45° from vertical, with arm direction d = (±sin 45°, 0, −cos 45°).

**Bones (26).** root; pelvis; spine_01…05; neck_01, neck_02; head; then per side clavicle, upperarm, lowerarm, hand, thigh, calf, foot, ball. root does not deform.

| Joint | Position (×s) |
|---|---|
| pelvis | (0, 0, .97) |
| spine_01 … spine_05 | (0, 0, 1.05), (0, 0, 1.12), (0, 0, 1.20), (0, 0, 1.28), (0, 0, 1.36) |
| neck_01, neck_02 | (0, 0, 1.46), (0, 0, 1.52) |
| head, head_end | (0, 0, 1.58), (0, 0, 1.79) |
| clavicle | (±.03, 0, 1.43) |
| upperarm (shoulder, sh) | (±.17·sw, 0, 1.415) |
| lowerarm, hand, hand_end | sh + d·.29, sh + d·.55, sh + d·.71 |
| thigh | (±.095·hw, 0, .92) |
| calf | (±.10·hw, −.005, .52) |
| foot | (±.10·hw, .015, .10) |
| ball, ball_end | (±.10·hw, −.10, .025), (±.10·hw, −.17, .025) |

**Body surface.** Smooth tubes through these nodes. Radii are (x, y) and are multiplied by girth·s. The source used Skin + Subsurf 2, which shrinks radii by about 20 %, so for code-built tubes use about 0.8 × these:
- pelvis (0, 0, .95) r (.175hw, .125); spine (0, 0, 1.07) (.16, .115); 1.19 (.17, .12); 1.31 (.185sw, .125); chest 1.40 (.175sw, .115); neck 1.48 r .06; 1.58 r .055.
- Arm: shoulder r .068, elbow (sh + .29d) r .054, wrist (sh + .56d) r (.04, .038).
- Leg: hip (±.095hw, 0, .90) r (.105hw, .105), knee (±.10hw, −.005, .52) r .07, ankle (±.10hw, .015, .075) r .05.

**Clothing.** Straight hem cuts:
- above z/s 1.49 is skin
- on an arm beyond |x| > .17·sw·s, the top colour runs until fraction `sleeve` along shoulder→hand, then skin
- above z/s .99 is top
- if `shorts`, below z/s .55 is skin
- everything else is bottom

**Head.** Centre hc = (0, 0, 1.58 + .085·hk)·s with hk = 1.1. Ellipsoid radii hs = (.088, .098, .112)·s·hk. All offsets below are ×s·hk; "front y" means −y. Box sizes are full extents; sphere and cylinder sizes are radii, except a cylinder's thickness.
- Face: eyes (±.034, front .088, +.016) r (.012, .01, .013) dark; ears (±.092, .004, 0) r (.012, .024, .03); brows box (±.034, front .083, +.044) size (.03, .01, .007) hair colour; nose (0, front .099, −.006) r (.014, .02, .022); mouth box (0, front .088, −.047) (.03, .01, .006) lips.
- Hair:
  - short and long: ellipsoid hs × 1.07 at hc + (0, back .008, +.012). Keep the side above a plane through hc + (0, 0, .018) with normal (0, back .45, 1), so the hairline rises toward the face.
  - buzz: the same with ×1.025.
  - long adds an ellipsoid (0, back .058, −.075) r (.092, .05, .14).
- Beard: ellipsoid (0, front .03, −.055) r (.082, .072, .075). Keep the side below a plane through −.038 with normal (0, back .35, −1).
- Helmet: hs × 1.24 at (0, back .008, .02). Keep above a plane through +.028 with normal (0, back .55, 1).
- Cap: hs × 1.1 at +.02, cut flat at +.035. Brim: cylinder r (.078, .075), thickness .012, at (0, front .11, .03), tipped 14° down. `cap_back` puts the brim at the back.
- Beret: ellipsoid (.018, back .005, .098) r (.112, .112, .036), rolled −14°.
- Boonie: hs × 1.12 cut at +.03, plus a brim disc r .16, thickness .008, 24 segments, at +.035.
- Glasses: two discs r .022, thickness .006, at (±.034, front .095, .016), plus a bridge (.03, .006, .005), dark.

**Hands, shoes and gear.**
- Hands: ellipsoid r (.032, .05, .085) at hand + .055 along d, rolled with the arm.
- Shoes: bevelled box (.105, .255, h) at (±.10hw, front .055, h/2), bevel .018, flat-shaded.
- Vest: bevelled box (.37·sw·g, .255·g, .31) at z 1.235, bevel .03, plus 3 pouches (.07, .04, .085) at x ∈ {−.09, 0, .09}·sw, front .135g, z 1.15.
- Belt: elliptic cylinder r (.165·hw·g, .118·g), h .045, at z .985.
- Backpack: box (.27, .13, .34) at (0, back .15g + .03, 1.25), bevel .025.
- Kneepads: (.075, .035, .085) at (±.10hw, front .06g, .50).
- Patch: (.006, .05, .055) on the left upper arm, 32 % of the way to the elbow and .05g out.

**Weights.** Each vertex takes its 2 nearest allowed bone segments with w ∝ 1/d⁴; drop weights under 1 %. Allowed bones per part: head parts → head; hands → hand; shoes → foot + ball; torso gear → pelvis + spine; kneepads → calf; patch → upperarm_l.

**7.3 Web build options.** Lyra's animations cannot come along, so animation has to be CC0.

- **A — recommended: one CC0 rigged, animated humanoid glTF, recoloured per roster.**
  - Example sources: Quaternius Universal Animation Library or animated character packs, or KayKit character packs. Check the CC0 licence in the download.
  - Scale the model to the roster height.
  - At load, paint vertex colours with the clothing rule from 7.2. Use each vertex's dominant skin bone to tell arm from leg, and its bind position to measure the fraction along the arm, so the rule works on any rig.
  - Add the code-built head, hat and gear pieces from 7.2, parented to the head and spine_03-equivalent bones. Add face dots if the base model has none.
  - Every look shares one skeleton and one set of clips.
  - Budget ≤ 1.5 MB for the glb (meshopt, clips included).
- **B — zero download.** Build the look entirely in code: capsules and ellipsoids as rigid children of a code-built 26-bone skeleton, with a procedural walk/run cycle. Use this as the fallback or Low setting (choose).

**Clips needed (choose).** Idle; walk (authored at or retimed to civilian 1.7 m/s); jog/run (player speed and sprint ×1.6, flee run 5.5 m/s); seated idle (vehicle seats and traffic drivers); hands up (robbery, 1.5 s, choose); pistol and rifle aim layer (upper body); death fall leading into a ragdoll.

Scale clip playback rate by movement speed ÷ the clip's authored speed. Characters cast shadows. At 60 civilians, use a 1.5–3k tri LOD beyond 40 m (choose).

Source: char_build.py:15–89, 138–189, 193–397; roster.json:1–44; DefaultGame.ini:245–260; EscCharacterPartsComponent.cpp:52–63; Saved/Agent/import_art.log (per-mesh triangle sections).

---

### 8. Vehicles

All vehicles are generic and stylised, not replicas of real models. Each is one mesh of rigid parts, with one bone per moving part.

**Shared part roles:** Paint (.45 on cars), Glass `2A3440`/.15, Tyre `1C1C1C`/.9, Rim `B8B8B8`/.35, Trim `3A3A3A`/.7, Headlight `F2E6B0`/.3, Taillight `B3261E`/.35.

**Wheels.**
- Tyre: a cylinder of radius r and width tw with 20 segments; the cap edges are bevelled 0.22 × min(r, tw).
- Rim: r × 0.6, width tw + .02, 12 segments.
- Hub: r × 0.2, width tw + .05, 8 segments, in Trim.

**8.1 Cars.**
- The body is a side profile (x, z) extruded across ±W, with bevel 0.05 (0.06 on the van, 0.04 on the pickup, 0.035 on the jeep).
- Profile path: (xr_body + .1, zb) → round wheel arches of radius ra centred (axle x, r), sweeping from π − t0 to t0 with t0 = asin((zb − r)/ra) and 10 segments each → (xf_body − .1, zb) → (xf_body, zb + .1) → the top points → (xr_body, zb + .1).
- Sizes in the table are the measured mesh bounds (mirrors included) from the import log, the same numbers as spec 04 §6; the car body collider uses them.
- The "greenhouse" is a dark glass prism through the quad (bf, tf, tr, br). Its half-width tapers from wb at the base to wt at the top. It has a body-colour roof cap 3 cm proud, an A-pillar .07, a C-pillar .12 and an optional B-pillar .09 at x = xB.

| id | Size L × W × H (m) | Wheels r / tw / front x / rear x / \|y\| | Profile and parts | Paint (variants) | Tris |
|---|---|---|---|---|---|
| sedan | 4.60 × 1.82 × 1.45 | .32 / .22 / 1.38 / −1.32 / .74 | W .87, body x ±2.25, zb .24, ra .37. Top: (2.25,.70) (2.12,.80) (.98,.90) (−1.62,.95) (−2.18,.97) (−2.25,.88). Greenhouse bf (.98,.88), tf (.15,1.40), tr (−.95,1.40), br (−1.62,.93), wb .81, wt .65, xB −.3. Bumpers .16 × 1.78 × .18/.20 at z .36/.38. Grille (2.245, 0, .53) .03 × .66 × .13. Headlights (2.24, ±.6, .62) .04 × .34 × .10. Taillights (−2.24, ±.6, .78) .04 × .36 × .12. Paint mirrors (.86, ±.86, .94). Door seams at x .99/−.27/−.93; handles at x −.12/−.78, z .8. | `3B6FB6` (`F2F2F2` `1C1C1C` `9AA0A6` `6E6E6E` `8C2F2A` `2F4A3A` `D9CBA8`) | 3024 |
| taxi | sedan + sign (4.60 × 1.82 × 1.62) | as sedan | Sign base (−.4, 0, 1.465) .18 × .5 × .04 Trim; sign box (−.4, 0, 1.55) .22 × .62 × .14, `F2C318`/.4 | `F2F2F2` (`E6E6E6`) | 3144 |
| van | 5.00 × 2.07 × 2.20 | .34 / .24 / 1.65 / −1.55 / .81 | W .96, ±2.45, zb .30, ra .39. Top: (2.45,.92) (2.36,1.10) (1.95,1.20) (1.22,2.12) (1.12,2.20) (−2.38,2.20) (−2.45,2.12). Windshield slab on edge (1.95,1.2)–(1.22,2.12), ±.84. Cab side windows (1.75,1.32) (1.21,2.0) (.72,2.0) (.72,1.32). Rear windows (−2.46, ±.42, 1.72) .03 × .66 × .5. Sliding-door seams on the right side. | `E8E6DF` (`F2F2F2` `9AA0A6` `3A4A5C` `B8C7D6` `C9B88F`) | 3340 |
| pickup | 5.30 × 1.96 × 1.82 | .38 / .26 / 1.75 / −1.45 / .75 | W .92, ±2.6, zb .36, ra .43. Top: (2.6,1.02) (2.5,1.14) (1.2,1.22) (−.35,1.22) (−.35,.92) (−2.6,.92). Greenhouse bf (1.25,1.17), tf (.45,1.77), tr (−.2,1.77), br (−.3,1.17), wb .86, wt .72. Open bed: floor (−1.43, 0, .93) 2.14 × 1.68 × .03 Trim; walls (−1.43, ±.88, 1.05) 2.14 × .08 × .34 with Trim caps; tailgate (−2.555, 0, 1.06). | `8C2F2A` (`F2F2F2` `1C1C1C` `9AA0A6` `C9B88F` `2F4A6D`) | 3348 |
| hunter_jeep | 4.42 × 2.05 × 1.92 | .40 / .30 / 1.4 / −1.2 / .78, all-wheel drive | W .95, x 2.08 to −1.88, zb .42, ra .46. Top: (2.08,1.12) (2.02,1.2) (.9,1.22) (.9,.98) (−1.72,.98) (−1.72,1.22) (−1.88,1.22). Open tub with side walls (−.41, ±.91, 1.09) 2.62 × .08 × .3. Plain patch `C9B46A` (.35, ±.953, 1.09) .2 × .14. Windshield slab (.9,1.22)–(.8,1.68) with a .07 frame. Roll bars at x −.17 and −1.55 (tubes r .035 up to z 1.78) with roof rails. Spotlight cylinder (−.12, .55, 1.86) r .06. Canvas roll `4A5530` r .09 across the back. Grille with 3 paint bars. Brush guard. Spare tyre at (−2.06, 0, 1.08). Rims `56603C`. | `5B6B3A` (`4A5530` `56603C`) | 4680 |

**8.2 Hunter tank** (generic main battle tank), about 10.2 × 3.6 × 2.6 m, 7696 tris. Parts: chassis, turret (yaws), barrel (pitches), 12 road wheels.
- Roles: Paint `5B6B3A`/.7, PaintDark `4A5530`, Detail `56603C`, Trim `3A3A3A`/.6, Track `2E2E2E`/.9, Tyre `1C1C1C`, Glass `2A3440`/.2, Patch `C9B46A` (plain, no insignia).
- Hull: bevelled convex blocks from x −3.7 to 3.78, roof at 1.70. Skirts: 5 panels at y ±1.77, 1.27 × .6.
- Turret: ring at x −0.1, r 1.15. Faceted turret block up to 2.42, bustle basket, stowage bins, smoke launchers, commander cupola (right side), loader hatch with roof machine gun (left).
- Gun: trunnion at (1.2, 0, 2.08). Mantlet, sleeve r .15, tube r .11; muzzle at x **6.475**.
- Running gear: 6 road wheels per side at x 2.15 − 0.86i, |y| 1.42; physics radius .40, visual radius .31. Idler (3.05, .62) r .27; sprocket (−3.10, .66) r .31.
- Track band: 0.6 m wide, .09 m thick, loop length **14.756 m**, U = metres along the loop.
  - Web: scroll U by distance driven (choose a tread texture with 0.15 m pitch).

**8.3 Hunter helicopter** (generic utility, not a replica), about 15 m long × 2.8 m wide over the skids × 4.5 m tall (bounds with the rotor: 15.75 × 10.24 × 4.49 m, spec 04 §6), 6076 tris. Bones: body, main_rotor, tail_rotor.
- Roles: Paint `5B6B3A`/.6, Accent `4A5530`/.6, Glass `2A3440`, Trim `3A3A3A`/.5, Patch `C9B46A`/.7, Headlight `F2E6B0`.
- Civilian scheme: paint `EDEBE4`, accent `B3261E`.
- Cabin with open side doors (x −1.3..1.3, z 1.0..2.42), rounded nose and dark canopy (half-ellipsoids), engine hump.
- Tail boom: a cone r .38→.22 from x −4 to −9.3, a swept fin with an accent cap, and a stabiliser 2.6 m wide.
- Skids at y ±1.35.
- Main rotor: hub at (0, 0, 4.2), 4 blades of 6.76 × .5 m, **radius 7.0**. Tail rotor: hub (−9.4, .44, 3.4), radius 1.4.
- Door-gunner pintles at (.95, ±1.28, 1.68). Searchlight at (4.27, 0, .5).
- Web: spin the rotors and fade in a translucent blur disc above about 3 rev/s (choose).

**Colour variants.** The UE build always shows the first (default) paint. Web: pick a random variant per spawned civilian car (choose).

Source: veh_cars.py:17–19, 82–165, 168–310; veh_common.py:104–107; veh_hunter_tank.py:12–23, 117–231; veh_heli.py:13–19, 60–177; Art/out/SK_veh_*.json; import_art.log.

---

### 9. Props (all 39)

In the material lists, `Role HEX/rough`; roughness is .75 where omitted. Sizes are X (front) × Y × Z in metres. Tri counts are the source meshes. Collision is listed in the prop frame: box centre then box size. That is the mesh's own collision; the world places SolarHeater, WaterTank, ACUnit, Bench, Bin, Umbrella, Lounger, Shrub and small rocks (scale < 0.8) with collision off (spec 01 §28).

| Prop | Size | Tris | Materials | Collision | Build and facing |
|---|---|---|---|---|---|
| Palm | 7.56×7.61×9.83 | 2712 | Trunk `7A6650`/.95, Crown `5E5034`/.9, Stalk `C98B2E`, Dates `D9822B`/.6, Frond `5F7F38`, FrondLight `7C9447`, FrondDry `9C7A48` | Trunk hull r .30/.24/.20 (web: capsule r .3, 0→7.3 m) | Trunk 7.3 m curving 0.6 m toward +X (x = .6t²), 30 rings × 8 sides twisted π/8 per ring (diamond bark), r = .26 − .07t (+ root flare), alternating ×1.08/×.93. Crown ellipsoid, 3 date clusters. 14 fronds at 137.5° steps: elevation 68° − 95°f, length 3.1 + .9·min(1, 2f), sag .25 + .45f. The lowest 2 are dry, at −62° and 2.6 m. Each frond has two V rows of split leaflets. |
| Ficus | 5.92×5.5×6.46 | 1326 | Bark `857F74`/.9 smooth; Leaf `3D6A2E`, LeafLight `4F7D36`, LeafDark `2F5A27` | Trunk tube r .32→.22, 0→2 m | Gnarly trunk to 2 m, 5 buttress roots, 4 limbs. Crown of lumpy noise-displaced icospheres: main r 1.9 at 4.3 m (scale 1.4/1.4/.95), 7 lobes r 1.05–1.3 at radius 1.75, top lobe r 1.15 at 5.25 m. |
| StreetLamp | 2.98×.38×7.94 | 420 | Metal `8E9499`/.45, MetalDark `4A4F55`/.5, Lens `FFF1C4`/.2 | (0, 0, 3.8) .34×.34×7.6 | Pole r .13→.075 to 7.0 m, quarter bend R .8 toward +X, arm to x 2.15. Head .8×.34×.15 at x 2.4 tilted 4°, lens below. Base sleeve r .19 h .6. The arm reaches over the road (+X). |
| Bench | .61×1.8×.91 | 732 | Wood `B07A45`/.8, Iron `2E3A33`/.5 | .55×1.85×.9, centred | 3 seat slats at .45 m, 2 tilted back slats, 3 cast frames at y −.78/0/.78, armrests. Faces +X. |
| Bin | .59×.51×1.2 | 300 | Paint `2F6A47`/.55, PaintDark `24533A`, Liner `1B1B1B`/.9, Label `E8E4D6`/.6, Metal `8E9499`/.45 | (−.03, 0, .6) .6×.52×1.2 | Drum r .24 h .6 at z .67 hanging on a post (x −.31, r .035, 1.2 m). |
| BusStop | 1.82×4.22×2.91 | 352 | MetalDark `3A3F44`/.45, Roof `D8D8D2`/.6, Fascia `1F5FA8`/.5, Glass `9EC4D0`/.08 (opaque), Ad `F2B33D`/.4, AdText `C8352B`/.4, Steel `9AA0A6`/.4, SignWhite `F2F2EE`, SignBlue `1F5FA8` | Back wall (−.7, 0, 1.25) .12×3.6×2.5; ad (−.05, 1.75, 1.2) 1.25×.15×1.95; roof (−.05, 0, 2.55) 1.8×3.9×.2; bench (−.45, −.2, .25) .4×2.4×.5 | Open toward +X (the road). Glass back. Ad panel at the left end. Stop sign on a 2.9 m pole at the right end (.85, −2.05). |
| SolarHeater | 1.41×2.0×1.41 | 520 | Frame `B8BCC0`/.4, Panel `1D2F4D`/.15, Tank `F1F0EB`/.45, TankCap `C9CACB`, Steel `A0A5AA`/.45, Pipe `B87333`/.4 | none | 1×2 m collector tilted 40° toward +X (placed facing south) with 9 strips. White tank r .28 × 1.55 along Y at (−.6, 1.12). Bar frame. Recentred. |
| WaterTank | 1.37×1.25×1.52 | 500 | Concrete `B5B0A6`/.9, Plastic `3A3E42`/.6, PlasticRib `4A4F54`, Lid `5A6066`, PipeWhite `E3E1DA`/.5 | none | Pad 1.25²×.15; drum r .55 h 1.2 with 3 ribs; cone top to r .25; lid. |
| ACUnit | .39×.88×.64 | 476 | Plastic `ECEBE5`/.5, PlasticGrey `C9C8C2`, Ring `9A9EA2`, Grille `2E3134`/.6, Metal, PipeWhite | none | Body .3×.82×.56. Fan r .2 facing +X. The wall plane is x = −.21 (mount flush), on L-brackets. |
| Umbrella | 2.4×2.4×2.53 | 360 | Fabric `2D6DB3`/.85 and FabricWhite `F2F0E8` (12 alternating panels), Metal, Pole `E8E6E0`/.5 | none | R 1.2, apex 2.42, rib ends 2.08, scalloped valance dropping .17. |
| Lounger | 1.84×.69×.85 | 264 | Plastic `F0F0EC`/.5, Fabric `2D7FB8`/.85, Pillow `F2F0E8` | none | Profile (1, .36)→(−.3, .36)→(−.82, .8), backrest at −X. Recentred. |
| LifeguardTower | 4.24×3.65×7.31 | 884 | Post `D9D4C8`/.8, Steel `7A8085`/.45, Trim `2A6DB5`/.5, Deck `8A7A66`/.85, Wall `F2EFE6`/.8, Glass `33505E`/.1, Rail `F2F2EE`, Buoy `E8452C`/`F4F4F0`, Flag `D2302A` | 4 posts (±1.2, ±1.2, 1.45) .2×.2×2.9; hut (−.1, 0, 4.15) 3.2×3.2×2.5 | Stilts 2.9 m with cross braces, deck 3.2² at 2.95, hut 2.3×2.5×2.1. Windows face +X (the sea). Ladder at −X. Flag to 7.3 m. |
| Kiosk | 4.2×3.88×3.42 | 530 | Concrete `B8B2A6`, Wall `E6D9BC`, Glass `3C5560`/.1, FrameGreen `2E4F48`/.5, Sign `F3EFE3`, Logo `C8352B` (plain block), Roof `2E7466`/.6, Wood `A9773F`/.7, Awning `C8352B`/`F3EFE3`, Metal | Octagonal prism r 1.56 h 3 | Octagonal with a flat face to +X: base r 1.75, wall r 1.5, glass band, sign ring at 2.5, teal roof r 2.1 with a cone. Counter, 7-stripe awning and 2 stools on +X. |
| Bollard | .24×.24×.93 | 248 | MetalDark `3B3F44`/.45, Reflector `EDEDE8`/.3 | .24×.24×.92 | r .085, dome cap, bands at .6 and .72. |
| Planter | 1.21×1.22×1.33 | 580 | Concrete `B9B2A4`/.9, Soil `4A3829`/1, Leaf, LeafLight, Flower `C8337E`/.7 | 1.2×1.2×.56 | Concrete box, 4 shrub blobs, 7 bougainvillea blobs. |
| Crate | .83×.83×.62 | 852 | CrateWood `B8894F`/.85, CrateFrame `8C6239`/.85, CrateInside `4E3824`/.95 | .83×.83×.625 | 0.56 m body: 3 planks per side, corner posts, rails, diagonal braces, 4-plank lid. |
| CrateOpen | 1.07×.83×.79 | 852 | as Crate | .83×.83×.56 | Lid leaning against the −X side at 70°, showing the dark inside. |
| CashBag | .7×.38×.46 | 548 | Canvas `3E6B3A`/.9, Strap `22251F`/.8, Zip `C9A24A`/.4 | none (pickup) | Duffel along X, R .19, flat bottom, 2 straps with handles. |
| ShopCounter | 1.26×3.06×2.0 | 1356 | Counter `4C5560`/.6, Worktop `C9A66B`/.6, ShopRed `B33A2E`/.5, Black `1E1E1E`/.5, Metal, goods `2D6DB3`/`E8B923`/`EDEBE4`/`B33A2E` | (.02, 0, .55) .84×3.06×1.1; (−.62, 0, 1) .4×3×2 | Customer side +X. Till at +Y. A 5-shelf unit behind at −X stocked with seeded random packets. |
| SlotMachine | .78×.98×2.0 | 552 | SlotPurple `5B1E7A`/.4, Gold `D4A637`/.3, Black, Glow `F2C14E`/.3, Reel `F4F1E8`, Red `C8202A`, Chrome `D0D4D8`/.25 | (.04, 0, 1) .78×.92×2 | Screen and buttons face +X. 3 reels with the middle row lined up red. Arched topper. Lever on +Y. |
| BurgerCounter | 1.1×3.06×2.6 | 1240 | BurgerRed `C8202A`/.5, BurgerYellow `F2B705`, Steel `9AA0A6`/.4, Black, MenuLight `F5E6B8`/.4, Bun `D9963A`, Patty `5A3420`, Tray `8A3A1E` | (.02, 0, .55) .94×3.06×1.1; (−.53, 0, 1.3) .15×3.02×2.6 | Parody with no logo or text. Red front with yellow bands, 2 tills, trays of burger, fries and drink. 3 lit menu panels of picture blocks. |
| Vault | 2.31×2.04×2.2 | 1060 | VaultSteel `8C9196`/.4, SteelDark `4E5459`/.5, VaultDoor `B4B9BE`/.3, Chrome, VaultInside `6E747A`/.6 | (.15, 0, 1.1) 2.3×2.04×2.2 | Round door r .8 on +X at z 1.1, 3-spoke wheel r .36, 8 bolts, hinges on the left (+Y). |
| VaultOpen | 3.78×2.29×2.2 | 1336 | as Vault | 9 wall boxes + door hull | Door swung 100° about the hinge (1.11, .87). Empty 4×5 wall of deposit boxes. |
| ForgerDesk | 1.0×1.8×1.21 | 624 | WoodDark `5A3A22`/.7, Brass `C9A24A`/.35, LampGreen `2F5A3A`/.5, Paper `F2F0E8`/.8, Passport `6E1E2A`/.6, Black | 1×1.8×.75 | Top at .75. Customer at +X, drawers on −X. Banker's lamp, green mat, loose A4 sheets, blank booklets (no emblems or text), stamp. |
| CheckInDesk | 1.23×6.04×2.4 | 732 | DeskWhite `E8E8E4`/.4, PanelBlue `1F4FA0`/.5, Steel, Black, ScreenBlue `3A7BD5`/.2, SignWhite, Accent `E37222`/.5 | Pods (.33, ±1.9, .55) .56×2.24×1.1; belt (.08, 0, .21) 1.05×1.6×.42; panel (−.53, 0, 1.2) .14×6×2.4 | Passengers at +X. Two desk pods with a bag belt between them. Blue 2.4 m back panel with lightboxes. |
| ParcelStack | 1.1×1.01×1.18 | 1356 | Cardboard `B8895A`/`A27648`/.9, Tape `D9C08E`/.5, Label `F2F0E8`/.7, Pallet `A08A68`/.9 | 1.1×1×1.2 | Pallet with 9 taped parcels in 3 layers; labels on +X. |
| GuardBooth | 2.5×2.5×2.91 | 360 | Concrete, Wall `F2EFE6`, Glass `33505E`, MetalDark, Trim `2A6DB5`, DoorGrey `8A9096`/.5 | 2.2×2.2×2.8 | Door on +X. Glass band 1.12–2.28 m. Blue sill band and roof slab 2.5². Beacon. |
| BoomGate | .68×8.61×1.17 | 368 | Yellow `E8B923`/.5, ArmWhite `F4F4F0`, ArmRed `D2302A`, MetalDark | Housing .5×.5×1.1 (the arm does not collide) | Hub on +X at z .95. The arm runs 8 m to the right (−Y) in 10 segments of 0.8 m, alternating and starting red. Counterweight on +Y. |
| JerseyBarrier | .61×2.0×.88 | 144 | Concrete `B5B0A6`/.9, ConcreteDirty `8F887B`/.95, MetalDark | Convex hull | Half-width profile (.3, 0) (.3, .075) (.125, .33) (.075, .8), 2 m along Y. Dirty foot, drain slots, lifting loops. |
| Boat | 8.0×3.09×6.9 | 1560 | Antifoul `7A2A22`/.7, HullWhite `F2F1EC`/.5, HullBlue `1F5FA8`, Deck `A8957A`/.85, Glass, Rubber `1E1E1E`/.8, Net `3E7A5A`/.9, Buoy `E8452C` | Hull hull; wheelhouse (−.6, 0, 1.89) 1.9×1.75×2.34 | Bow at +X, pivot on the waterline. Lofted hull with keel at −.6 and deck at .72. Blue sheer band. Wheelhouse 1.8×1.7×2.2. Mast to 6.2 m. Tyre fenders. Net pile and floats aft. |
| ContainerRed/Blue/Green/Grey | 12.2×2.45×2.59 | 1112 each | Body/frame (.6): `9E3B2E`/`7E2E24`, `2B5D8F`/`22496F`, `3F6E47`/`2F5436`, `8C9196`/`6E7378`; LockBar `7A8085`/.45 | 12.19×2.44×2.59 | 40 ft container: 36 trapezoid corrugations per side, ribbed blind end at −X, double doors with 4 lock bars on +X. |
| PortCrane | 58.2×21.4×45.4 | 1072 | CraneRed `C23B2E`/.6, CraneWhite `EDEDE8`/.6, SteelDark `4E5459`/.5, Glass, SpreaderYellow `E8B923` | 4 legs (±8, ±9, 15) 1.6×3.4×30 | Pivot between the legs (16 m apart in X, 18 m in Y). Red legs, white portal beams at 29 m, girder x −20..8, boom x 8..38 over the water (+X), A-frame to 44.6 m, trolley and cab at x 22, spreader at 17.5 m. |
| Shrub | 1.55×1.38×.87 | 484 | Scrub `7E8456`/.95, ScrubDry `A39A6A`/.95, Twig `6B5A45`/.95 | none | 5 flattened noisy blobs and 7 twigs. |
| Rock | 3.38×2.62×1.79 | 480 | Limestone `BFB298`/.9, LimestoneDark `9C8E72` (in the world: Desert texture, 4 m, tint (.95, .9, .84)) | Hull of a 162-vertex version | Noisy icosphere with radii 1.45×1.2×1.3, top flattened at 0.8, alternating 30 cm bedding ledges, 2 loose stones. |
| Acacia | 7.19×6.71×5.89 | 948 | AcaciaBark `5E4C3A`/.9, AcaciaLeaf `6B7A3A`/.9, AcaciaLeafLight `8A9450` | Trunk tube r .32→.19 to 2.1 m | Leaning trunk forking into 4 limbs. Flat umbrella crown r 2.6 (scale 1.25/1.2/.2) at 5.35 m, plus 5 clumps r 1.2 flattened to .3. |
| Hill | 104×104×15.5 | 544 | Ground `C9A878` (in the world: Desert or Grass texture) | Convex hull | R 50, H 15, rounded cone on a 32×8 polar grid with mild noise; rim ring at r 52 dipping to −0.5 m. |

**Cull distances (start–end)** from the source: shrubs 350–500 m, small rocks (scale < 0.8, no collision) 250–350 m, desert rocks 500–700 m, acacias 600–800 m, containers 1200–1500 m. Hills and cranes are never culled because they form the horizon. Everything else: 600 m (choose).

Source: props.py:200–1166; Art/out/props/props.json; EscCity.cpp:2316–2375.

---

### 10. Weapons and effects (Lyra assets with no source; all choose)

- **Pistol.** 0.20 × 0.035 × 0.14 m, slide and grip `2B2B2B`/.5.
- **Shotgun.** 1.0 m: barrel tube r .015 and pump `2B2B2B`, stock and fore-grip wood `6B4A2E`/.7.
- **Rifle.** 0.9 m `2E2E2E`/.5: box receiver, magazine 0.12 m, barrel r .012.
- Weapons attach to hand_r. Each one is under 300 tris and built in code.
- **Muzzle flash.** Additive quad 0.25 m, colour `FFE9A8`, shown for 50 ms.
- **Tracer.** 0.02 m wide line `FFF2C0`, 60 ms.
- **Impacts.** A grey dust puff, or sparks on metal.
- **Hit feedback on people.** A 100 ms white emissive flash.

---

### 11. Web rendering pipeline

- **Buildings.**
  - A unit-cube `InstancedMesh` per 500 m chunk (choose; the same tiles as spec 01 §5 and §22), using the facade material.
  - Per-instance `aTint` (vec3, linear) and `aStone` (float) as `InstancedBufferAttribute`s; the size comes from `instanceMatrix`.
  - Ground, road and kerb boxes: the same scheme with one textured material per layer.
  - Chunking makes frustum culling work.
- **Props.** Merged geometry per prop type: vertex colour, a roughness attribute and creased normals. One `InstancedMesh` per prop type per chunk. Distance-cull whole chunks.
- **Vehicles.** Build each model once in code and clone it per car. Wheels, rotors, the turret and the barrel are separate child meshes so they can rotate. Glass is a separate transparent mesh.
- **Characters.** `SkinnedMesh` with a shared skeleton template and an `AnimationMixer` per character. Freeze the mixer beyond 80 m (choose).
- **Shadows.** Buildings, props, vehicles and characters cast shadows. Ground, water and buildings receive them. Small dressing does not cast (choose): AC units, parapets, markings and stripes.
- **Quality presets.**

| Preset | Texture size | Shadow map | SSAO | CSM | Pixel ratio | Clouds |
|---|---|---|---|---|---|---|
| Low | 512 | 1024 | off | off | 1 | off |
| Medium | 512 | 2048 | off | off | as device | on |
| High | 1024 | 2048 | on | on | as device | on |

  On Low, characters use option B (section 7.3).
- **Frame targets (choose).** Under 300 draw calls; under 1.5 M visible triangles on Medium.

---

### 12. Download and memory budget (all targets are choose)

| Asset class | Approach | Download (compressed) |
|---|---|---|
| three.js (tree-shaken) + examples used (Sky, BufferGeometryUtils, CSM) | npm, bundled by Vite | ≤ 200 KB |
| Rapier (compat build with embedded wasm) | npm | ≤ 1 MB |
| PeerJS | npm | ≤ 40 KB |
| Game code including every procedural builder (textures, facade, props, vehicles, character parts) | TypeScript | ≤ 350 KB |
| Textures (12 sets + window atlas) | generated on the GPU at load in ≤ 1.5 s | **0** |
| Props (39) and vehicles (7) | built in code from sections 8–9 (≈ 31k + 31k source tris) | **0**. If exported instead: glTF + meshopt ≤ 250 KB props, ≤ 150 KB vehicles |
| Characters | Option A: one CC0 glb with clips, meshopt | ≤ 1.5 MB (Option B: 0) |
| City and world data, audio | other sections | ≤ 2.5 MB and ≤ 1.5 MB |
| **First load total** | | **≤ 6 MB** |

**GPU memory.** Generated textures take about 32 MB at 512² (24 RGBA8 maps with mipmaps) or about 128 MB at 1024². Merged prop geometry is about 3 MB.

---

### 13. Art guardrails (kept from the source)

- **No gore.** No blood, wounds or dismemberment. Corpses stay intact until removed: civilians after 20 s, soldiers after 6 s. Hits show dust or a white flash only.
- **Generic.**
  - Vehicles are stylised and not replicas: the helicopter and tank are explicitly generic.
  - The faction patch is a plain `C9B46A` rectangle with no real insignia or flags.
  - The burger venue is a parody with no logo or text on the counter.
  - Passports are blank.
  - Civilians are generic everyday people, not caricatures of any group.
- **Sensitive sites.** Places of worship, cemeteries, schools, hospitals and major historic sites get no special models. They are ordinary boxes with the same facade shader. Gameplay spots are already placed outside their buffers by the data.
- **Killing civilians never pays.** No art rewards it: no loot sparkle or pickup on civilian bodies.

Source: Docs/escape_design.md:49–53; props.py:689; veh_heli.py:1; veh_hunter_tank.py:181; Tools/geo/zones.py:37, 162.

---

### Addendum: Audio

**What the Unreal build plays.**
- Every gameplay sound comes from Lyra's own content, not from Escape code:
  - weapon fire, reload, dry-fire and equip for the pistol, shotgun and rifle
  - footsteps and bullet impacts through Lyra's context-effects system, keyed by surface: Character, Concrete, Glass and
    default (`Config/DefaultGame.ini` `SurfaceTypeToContextMap`)
  - jump and land, menu clicks, and front-end music
  - volume buses Overall / Music / SFX / Dialogue / VoiceChat (`LyraAudioSettings`)
- The Escape code plays **exactly one** sound: Lyra's grenade-explosion MetaSound at every tank-shell blast
  (`EscHunters.cpp:444`).
- Cars, traffic, the helicopter and the tank have **no engine or rotor sound**. There is no in-game music, no city
  ambience, no sirens and no voice lines.

**Web** (PROMPT milestone 8, "audio if budget allows"; everything below is choose):
- **Format.** Synthesise with WebAudio at runtime (0 bytes). Samples are allowed within the 1.5 MB audio budget (§12),
  CC0 only.
- **Context.** One `AudioContext`, created or resumed on the first user gesture (the Host / Join click). Graph:
  master gain → destination, and sfx gain → master. Settings volume and `?mute` set the master
  (05_hud.md, Addendum: Front-end details).
- **3D.** One `PannerNode` per voice: `panningModel 'equalpower'`, `distanceModel 'inverse'`, refDistance 5 m,
  rolloff 1, maxDistance 300 m. The listener follows the camera. Skip any sound beyond 300 m. Keep at most 24 voices;
  steal the quietest.
- **Who hears.** Positional sounds play on every client from the events that already exist: `shotFx`, `blast`,
  snapshots, broadcasts. UI sounds play only for the local player.

| Sound | Trigger | Recipe (all choose) | Gain |
|---|---|---|---|
| Pistol shot | own shot / `shotFx` | 60 ms white-noise burst through a bandpass at 1.8 kHz (Q 0.8), plus a sine falling 150→60 Hz over 80 ms | 0.8 |
| Rifle shot | same | 45 ms burst, bandpass 2.4 kHz, plus a thump 120→50 Hz | 0.7 |
| Shotgun shot | same | 120 ms burst, lowpass 1.2 kHz, plus a thump 90→40 Hz over 150 ms | 1.0 |
| Distant shot | any shot > 80 m away | the same voice through a lowpass at 800 Hz, plus a 0.3 s noise tail | ×0.6 |
| Dry fire | fire with mag 0 and spare 0 | 5 ms click, highpass 3 kHz | 0.4 |
| Reload | reload start | 2 clicks, at 30 % and 85 % of the reload time | 0.4 |
| Bullet impact | each tracer end | concrete or default: 20 ms noise tick, highpass 2 kHz; glass: 3 sines at 3–6 kHz, 150 ms decay; character: 40 ms soft 80 Hz thud (no pain sounds) | 0.3 |
| Footsteps (optional) | every 0.5 s walking, 0.33 s running, 0.25 s sprinting, while grounded | 30 ms lowpassed noise at 400–700 Hz (random), local player plus others within 30 m | 0.15 |
| Tank cannon | `tank_fire` | 0.5 s boom: noise lowpass 600 Hz plus a 50 Hz sine | 1.0 |
| Shell blast | `blast` | 1.2 s brown noise with its lowpass swept 1.5 kHz→150 Hz, plus a 45 Hz sine thump over 0.4 s; refDistance 15 m | 1.0 |
| Helicopter rotor (web addition) | while a helicopter exists | lowpassed noise (300 Hz), amplitude-modulated at 18 Hz (the blade rate); refDistance 30 m. Recommended: the threat should be audible | 0.6 |
| Car engine (web addition, optional) | the own car, plus cars within 40 m | sawtooth at rpm/30 Hz (rpm from 04 §7), lowpass 800 Hz, gain 0.2 + 0.5 × throttle | 0.4 |
| Tyre skid (optional) | handbrake, or lateral slip > 3 m/s | bandpassed noise at 1 kHz | 0.3 |
| Car impact (optional) | body speed change > 3 m/s in one step | 60 ms thud, lowpass 300 Hz | 0.6 |
| Menu step | Up / Down | 20 ms sine at 1.2 kHz | 0.2 |
| Menu select | E sent | two tones, 660 then 990 Hz, 60 ms | 0.25 |
| Money in | the local wallet value rises | "cha-ching": sines at 1.3 and 1.9 kHz, 120 ms, the second delayed 40 ms | 0.3 |
| Error | `Not enough money …`, `No car close enough …` | 120 ms square wave at 200 Hz | 0.2 |
| Star up | `Wanted level N` | 3 descending square notes, 0.4 s | 0.35 |
| Star down / heat off | `They lost your trail…`, `The heat is off` | 3 ascending sine notes | 0.3 |
| Countdown | each `Hold …: N s` / `Boarding: N s` | 80 ms beep at 880 Hz | 0.3 |
| Escape | end card | 1.5 s major-chord arpeggio | 0.4 |

- **Guardrails:** no screams, pain or death cries (03 §9), and no music by default. Music, if ever added, is one loop
  under 1 MB, off by default.

---

### Addendum: Animation state selection (which clip when)

**What Unreal does.**
- An invisible Lyra mannequin runs Lyra's animation Blueprint, and the visible Blender character copies its pose by
  retargeting (`EscCosmeticPart`, `EscRetargetAnimInstance`).
- Lyra's locomotion is 4-way cardinal (Fwd / Bwd / Left / Right). It has start, stop and pivot clips, turn-in-place
  (90° and 180°), crouch sets, jump / fall / land, an idle break, and an upper-body aim offset.
- Unarmed pawns use `ABP_UnarmedAnimLayers`. Pistol, Rifle and Shotgun each link their own layer set while equipped.
- The walk set (instead of the jog) plays when the pawn has the `Event.Movement.ADS` tag. That is aiming for armed
  players; for civilians, Escape adds the tag while they walk (`EscPawnComponent::SetWalking`).
- Traffic drivers play `int_sit_bench_sit_idle_loop` on a mannequin placed at seat − 0.45 m.

**Web: choose a state each frame, on every peer, from replicated state** (velocity, grounded, crouch, held weapon, aim,
seated, frozen, dead, walk flag):

| Priority | State | Clip(s) | Notes |
|---|---|---|---|
| 1 | dead | none: ragdoll (03 §9) | Hold the last pose for the 0.1 s before the launch |
| 2 | seated (player in a car, or a traffic driver) | seated idle loop | Pelvis at the seat point; hands near the wheel if the rig allows |
| 3 | frozen (held up) | hands-up | Faces the robber, 1.5 s |
| 4 | airborne > 0.15 s | jump / fall loop, land on touchdown | |
| 5 | crouched (players) | crouch idle / crouch walk | 3 m/s |
| 6 | moving, planar speed v ≥ 0.15 m/s | walk set if (walk flag or ADS), else run set | Playback rate = v ÷ the clip's authored speed, clamped 0.6–1.8. Above 1.8 (sprint) use a sprint clip if the pack has one, else clamp |
| 7 | standing | idle (civilians: idle with the look-around turns from 03 §7.2) | Turn-in-place is optional |

- **Direction.** Players and soldiers face the camera or aim yaw and strafe, so blend 4-way clips by the angle between
  velocity and facing. If the pack has only forward clips, rotate the lower body toward the move direction (up to ±90°)
  and play the clip backwards when moving away from the facing.
- **Upper-body layer** (on top of rows 4–7):
  - unarmed: none
  - pistol: one-handed or two-handed pistol hold
  - rifle and shotgun: long-gun hold
  - soldiers always hold the rifle
  - aim pitch spread over spine_01–03 (±60°)
  - firing: a 0.1 s recoil kick
  - reload: lower the weapon for the reload time
- **Carried items have no look in the original** (bag, plate carrier, passport, package). Web (choose): a `CashBag` prop
  on the carrier's back, attached to spine_03.

---

### Addendum: Explosion and shell effects (Lyra Niagara assets with no source)

- **Shell blast** (Unreal: `NS_Grenade_Explosion` at 2.5× scale; web: on every client on `blast{pos}`):
  - Additive fireball sphere, emissive `FFB347` → `FF5A1F`, radius 0 → 4 m in 0.15 s, fading out by 0.5 s.
  - 12 dust sprites `8C857A`, expanding to 8 m while rising 3 m over 1.5 s, fading out.
  - A `PointLight` `FFB060` for 0.1 s (intensity choose, no shadows).
  - Camera shake for players within 30 m: 0.4 s, amplitude 0.3° × (1 − d/30).
  - No scorch decal.
- **Tank muzzle:** a 1.5 m additive flash quad at the barrel tip (06 §8.2, x 6.475) for 80 ms, plus a 3 m dust puff.
- **Shell in flight:** the 0.5 m sphere from 03 §5, dark grey `3A3A3A`, with a short 3 m smoke trail (both choose). No tracer.
- **Helicopter spotlight:** besides 03 §4's light, draw a faint additive cone mesh (alpha 0.06, `FFF5D9`) from the
  searchlight to the aim point, and a ground disc of 6 m radius (alpha 0.25). That makes the "stay out of the spotlight"
  rule readable at mid-day.

Source: EscHunters.cpp:436-447; EscVehicle.cpp:678-714, EscVehicle.h:232-235; EscPawnComponent.cpp:88-146;
Content/Characters/Heroes/Mannequin/Animations/Locomotion/{Unarmed,Pistol,Rifle,Shotgun}; Config/DefaultGame.ini:217-233.
