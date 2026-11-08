# Decisions (the spec's "(choose)" items and judgement calls)

## Architecture
- **One code path.** The host runs `game/Sim` (listen server); its own player talks to it through a `LocalLink` that JSON-clones
  every message exactly like the wire. Friends use PeerJS links. Clients (including the host's own) predict their own
  character with the shared `physics/character.ts` step and render everything else 100 ms in the past.
- **Physics frame.** Rapier runs in the map frame (x east, y north, z up, gravity −z); only rendering converts to three.js
  (x, z, −y). The same static colliders are built on every machine from the generated world.
- **Wire format.** JSON over PeerJS (`rel` reliable + `snap` unreliable channels). Entity records are compact number arrays,
  soldiers/civilians culled beyond 300 m. Measured ~6 KB per 20 Hz snapshot in a busy street (~120 KB/s). Binary encoding is the
  upgrade path if bandwidth matters.
- **Host tick.** The 60 Hz fixed step is driven by a tiny Worker that posts every 16 ms (hidden tabs keep serving friends).
- **Input sub-steps.** A long client frame is split into ≤ 1/30 s inputs (max 0.25 s per frame), so slow machines lose no time.

## World (spec 01)
- Hash: 32-bit FNV-1a over the lower-cased string; integer-pair hash for desert cells. PRNG: exact `FRandomStream` clone.
  Parity with Unreal is not required; parity between peers is.
- Shell keep-clear "slack 0.3 m" is read as *overlap deeper than 0.3 m* (SAT gap < −0.3). That reproduces Unreal's
  `shell_overlaps_dropped = 1`; the looser reading would drop every neighbour touching a hall.
- Ground boxes are one per land interval per 10 m row for rendering (3034, same as Unreal); colliders merge identical
  consecutive rows (spec 01 §6 web note).
- Interiors are built from flat-coloured instanced boxes/cylinders, faithfully to §13 sizes; door awning, wainscot, baseboard,
  furniture claims as specified. Hall walls are 40 cm colliders with the 3.8 × 3.2 m door gap.
- Mooring search uses `onLand`/pier distance instead of vertical rays (same result on flat water).
- `city_built.trees` counts every planted Palm/Ficus/Acacia (Unreal counted park/village trees only).

## Rendering (spec 06)
- Characters: **option B** (code-built 26-bone rig with rigid parts, procedural walk/run/sprint/seated/hands-up/aim), zero
  download, with a one-draw-call far LOD beyond 70 m.
- Props and vehicles are built in code (`render/props`, `render/vehicles`), each prop also has a low-poly LOD.
- **Draw calls:** every vertex-coloured street/roof/scatter prop lives in ONE `BatchedMesh` (multi-draw); per-instance
  detail/LOD geometry and distance culling are refreshed from a 100 m grid when the camera moves 15 m. Hills and rocks
  (textured) stay instanced per chunk with a LOD swap. Each character is one skinned mesh (rigid parts weighted to the
  code-built bones). Layers sharing a material are merged for rendering. Measured: 160-275 draw calls (incl. shadows),
  0.8-1.1 M triangles; 6-8 ms per frame uncapped on an RTX 5080 at Medium, host simulation included (laptop not measured).
- Textures are baked on the GPU at load (11 sets + window atlas, ~0.4 s on a desktop GPU). Facade windows use the baked atlas.
- Sea surface uses polygon offset so it never z-fights the ground 15 cm above it at distance.
- Venue point lights: the 6 nearest hall lights within ~40 m are switched on (pooled `PointLight`s).
- Sky: gradient dome with fbm clouds (no three/examples Sky); no SSAO/CSM yet (High preset only differs by texture size).

## Gameplay
- Weapon stats are the 04 §5.3 table. Shots are traced on the shooter's machine; the host validates (alive, holds the weapon,
  mag, fire interval, origin within 3 m of the eye, hit within 2.5 m + speed·0.25 s of the target) and applies damage.
- Soldier AI uses the 03 defaults (perception 50/60 m, 180° cone, 0.2 s LOS checks, 0.5 s reaction, 3–6 round bursts,
  6°→1.5° accuracy ramp). Navigation: lazily built 1 m grid whose cells are tested against the real static colliders
  (so door gaps and furniture match physics exactly), A* + string pulling.
- Civilians and soldiers are kinematic grid agents (no Rapier capsule) — allowed by 03 §7.1 "lightweight host agents".
- Ragdoll: a single capsule rigid body with a limp pose, launched with the broadcast velocity (03 §9 allows this).
- Car physics: Rapier ray-cast vehicle; the spec drivetrain (gear ratios, torque curve, shift points, 95 km/h clamp,
  steering speed curve, Ackermann 0.7). Brakes are Rapier per-step impulses sized for ~8 m/s² (service) and ~6 m/s² (hand).
- Traffic "leg clear" and "wall sweep" use footprint tests against building boxes (inflated 1.1 m / car half-width) instead
  of shape sweeps, as 04 §12.3 suggests for the web.
- Tank hull sweep: sampled footprint + car distance test along the hop.
- Roadblock barriers and jeeps get static colliders and block the nav grid while they stand.
- Test-only console helpers beyond spec 05 H17 (marked in `dev/cheats.ts`): `EscSpawn civ|soldier`, `EscKillNear`,
  `EscTp door:<mode>` / `xy:<x>,<y>`, `EscCar spawn <yaw> [model]`, `cam`, `look`, `fov`, `EscKey LMB`.

## Front-end
- Room code: 5 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, peer id `escape-israel-<CODE>`; `unavailable-id` silently
  picks a new code. Default name `Player-NNNN`. Settings in `esc.settings` (quality auto/low/medium/high, sensitivity, FOV,
  volume, FPS). Quality "auto" = Low on SwiftShader/llvmpipe or ≤ 4 cores, else Medium.
- Heartbeat: clients ping every 1 s from a timer; the host drops a client after 30 s of silence (spec: 10 s, choose) because
  first frames on slow GPUs compile shaders for longer than 10 s.
- `?offline` skips opening the PeerJS room (used by single-machine tests).
- Audio: procedural Web Audio per the 06 addendum (shots, distant shots, UI, star up/down, countdown beeps, escape chord,
  tank blast, helicopter rotor loop). No music, no screams.

## Spec conflicts noted
- 03 §0 vs design doc on civilian teams: followed the code (team 2), as 03 and 04 addenda say.
- 02 §4.2 shotgun 8/24 vs 04 §5.3 6/18: used 04 (02's addendum says so).
- Save key: `esc.save.v1` (02 addendum).
