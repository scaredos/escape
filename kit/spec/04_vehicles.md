## Player controls, movement, camera, weapons, vehicles and traffic

Conventions for this section:
- Numbers are in metres, seconds, kg and degrees unless marked otherwise. Values quoted from code in cm are converted (100 cm = 1 m, 1 km/h = 27.78 cm/s).
- "Car space" means +x forward, +y left, +z up, origin on the ground under the car's centre (the Blender convention the models use). Cars are left-hand drive and traffic drives on the right.
- "(choose)" marks a value that only exists in a binary Lyra asset, or that the web version must decide. Treat it as a sensible default, not a measured fact.
- Everything authoritative (vehicles, AI, heat, damage) runs on the host. "Owner" means the client whose player is involved.

---

### 1. Key bindings

**On foot (keyboard + mouse)**

| Input | Action | Notes |
|---|---|---|
| W A S D | Move (strafe-style: the character always faces the camera yaw) | |
| Mouse | Look | Yaw and pitch scale 1.0. Web: 0.1°/px (choose), no Y invert |
| Left Shift (hold) | Sprint: speed ×1.6 | No dash. Lyra's Shift dash is deliberately removed |
| Space | Jump | |
| C | Crouch toggle | (choose) Lyra default |
| Left mouse | Fire (hold for the rifle's full auto) | |
| Right mouse (hold) | Aim down sights (ADS) | |
| R | Reload | |
| 1 / 2 / 3 | Select quick-bar slot 1/2/3 | Mouse wheel next/previous is optional (choose) |
| E | Use the focused thing (§4). With nothing focused and a car in reach, get in the car | |
| Up / Down arrows | Move the selection in a multi-line use menu (wraps, skips non-actionable lines) | Then E selects |
| F | Get in the car in reach, or get out of the car you drive | |
| M | Toggle the full map | |
| Esc | Menu | |
| ` (backquote) | Dev console | Web build; see spec 05 H17 |

**In a car** (the driving keys take priority over on-foot bindings while you are seated)

| Input | Action |
|---|---|
| W | Throttle +1 |
| S | −1: brakes while moving forward, reverses once nearly stopped (§7) |
| W + S together | 0 (the two cancel) |
| D / A | Steer right +1 / left −1 (both = 0) |
| Space | Handbrake (no jump while seated) |
| F | Get out (E does not exit a car) |
| Mouse | No effect on the car camera |
| E, Up/Down, M | Still work as on foot. A spot whose use radius you are inside can be used from the seat |

**Gamepad (optional).** The UE build only maps sprint (left-stick click) on gamepad. Suggested mapping (choose):
- On foot: left stick move, right stick look, A jump, B crouch, X reload, Y use (E), D-pad up/down menu, RB/LB next/previous weapon, RT fire, LT aim, View toggles the map, Menu opens the menu, a long press of Y gets in the car (F).
- In a car: RT throttle, LT brake/reverse, left stick steer, A handbrake, Y gets out.

**Implementation rules**
- Sprint is polled every frame from the held state, not bound to key-down events.
- The other on-foot actions fire on key-down only.
- Lyra's other abilities (grenade, melee, emote, Shift dash) are not part of this game's controls: omit them (choose).

Source: Source/LyraGame/Escape/EscPlayerComponent.cpp:214-243 (keys E/Up/Down/F/M/LeftShift/Gamepad_LeftThumbstick, priority 1000, sprint consumes Shift); EscVehicle.cpp:802-822 (W/S negate, D/A negate, Space, priority 2000); README_friends.md:17-29.

---

### 2. On-foot movement

**Character body**
- Capsule radius 0.40 m, half-height 0.90 m (1.80 m tall).
- Eye height 0.80 m above the capsule centre, so 1.70 m above the feet. Crouched eye height 0.50 m above the capsule centre.
- Crouched capsule half-height 0.65 m.
- Gravity 9.8 m/s² (scale 1.0).

**Speeds**

| State | Speed |
|---|---|
| Walk/run (base `MaxWalkSpeed`) | 6.0 m/s (21.6 km/h) |
| Sprint | base × 1.6 = 9.6 m/s |
| Carrying a cash bag | base × 0.7 = 4.2 m/s |
| Bag + sprint | 6.0 × 0.7 × 1.6 = 6.72 m/s |
| Crouched | 3.0 m/s (choose). Sprint and bag do not change it |
| ADS | ×0.6 of the current speed (choose) |

How the multipliers combine:
- Formula: `MaxWalkSpeed = BaseWalkSpeed × (BagValue > 0 ? 0.7 : 1) × (sprinting ? 1.6 : 1)`.
- `BaseWalkSpeed` is read from each new pawn when it spawns or respawns.
- In UE the bag and sprint multipliers only scale the standing walk speed, so crouching ignores them. Web: keep that rule.

**Acceleration and braking**
- Max acceleration 24 m/s².
- Braking deceleration 14 m/s².
- Ground friction 8; braking friction 6 (factor 1).

**Rotation**
- The character's yaw follows the camera yaw (strafe movement, no orient-to-movement).
- Yaw rotation rate 720°/s.

**Jump and air**
- Jump take-off speed 5.0 m/s, about 1.28 m apex (choose; Lyra's value is in a Blueprint).
- Air control 0.35 (choose).
- Step height 0.45 m; walkable slope 44.8° (UE defaults).

**Sprint rules**
- Hold to sprint. No stamina, unlimited.
- You can sprint only while alive and on foot. Seated in a car = no sprint. Death or getting in a car ends it immediately.
- Sprint is not blocked by firing or ADS.
- A new pawn (respawn) starts walking. If the key is still held, the client re-requests sprint on the next frame.
- Multiplayer in UE:
  - The owner switches speed locally at once and sends a reliable "sprint on/off" message only on change.
  - The server applies the same multiplier.
  - For 0.5 s after the server changes the sprint state, it accepts the client's position without correction.
- Web: on-foot movement is host-authoritative with client-side prediction (spec 05 H16). Sprint is a flag in every input, so there is no separate sprint message and no grace window; the host simulates the same speed rule.

**Bag slowdown**
- Applied on the host and on the owner whenever the bag value changes, and on every new pawn.
- HUD line while carrying, exact text: `Carrying ₪<n> - fence it at a SHOP (30% slower)`.

Source: Source/LyraGame/Character/LyraCharacter.cpp:41,50-62,75-80; Escape/EscPlayerComponent.h:234-235; EscPlayerComponent.cpp:467-540,562-577; Config/DefaultGame.ini:325-326 (`SprintSpeedScale=1.6`); Escape/EscHunters.h:72 ("Lyra's run is ~600" cm/s); EscHUD.cpp:382.

---

### 3. Camera

**On foot (third person, Lyra-style)**
- Pivot = capsule centre + 0.80 m (the eye). When crouched the pivot drops; the crouch offset blends in at rate 5/s.
- The camera sits at pivot + controlRotation × offset. The offset depends on pitch (choose):

  | Pitch | Offset (back, right, up) |
  |---|---|
  | 0° | (−3.0, +0.5, +0.2) m |
  | −60° (looking down) | (−2.5, +0.5, +0.6) m |
  | +60° (looking up) | (−2.0, +0.5, −0.4) m |

  Interpolate linearly between those keys.
- Pitch is clamped to −70°..+70° (choose; Lyra's code limit is ±89°).
- FOV 80°. Camera mode changes blend over 0.5 s.
- Collision: cast a sphere (radius 0.14 m) from the pivot to the desired camera position. On a hit, pull the camera in to hit − 0.02 m. Pull in over 0.10 s and ease back out over 0.15 s.
- The crosshair is the screen centre.

**ADS (right mouse held)**
- FOV 55° (choose).
- Offset (−1.6, +0.55, +0.15) m (choose), blending over 0.2 s (choose).
- Weapon spread multiplied by the weapon's ADS factor (§5).

**In a car (chase camera)**
- Boom pivot: car space (0, 0, 2.20) m, i.e. 2.20 m above the road origin. This pivot rotates with the car.
- Boom: length 7.00 m, pitched −14°.
  - It follows the car's yaw only; world pitch and roll stay fixed.
  - The yaw follows with lag: each frame `yaw += shortestDelta(carYaw − yaw) × min(1, 6 × dt)`.
- Camera = pivot + R(yaw, −14°) × (−7.00, 0, 0) + R(yaw, −14°) × (0, 0, +0.60) socket offset. That puts it about 4.5 m above the road and about 6.8 m behind.
- The camera looks along the boom direction.
- FOV 90°.
- Collision: sphere probe radius 0.12 m from the pivot toward the camera. On a hit, shorten the boom.
- No mouse look while driving.
- The view blends to the car camera in 0.3 s on entry and back to the on-foot camera in 0.3 s on exit. Web: on exit, set the on-foot camera yaw to the car's yaw (choose).

Source: Source/LyraGame/Camera/LyraPlayerCameraManager.h:14-16; LyraCameraMode.cpp:58,82-106; LyraCameraMode_ThirdPerson.cpp:26-32; LyraCameraMode_ThirdPerson.h:59-78; Escape/EscVehicle.cpp:211-227,822,843.

---

### 4. Focus, E and F resolution

Every frame, on the owner only, compute the **focus** (what E would use):
- Candidates:
  - Interactables whose 2D distance ≤ their use radius and that offer at least one option. Minimum dot = 0.3.
  - Living civilians within 5.0 m (2D), only while a ranged weapon is in hand. Minimum dot = 0.9.
- `dot` = cameraForward · normalize(candidate − cameraPos).
- Score = `dot − dist2D / range`. The highest score wins; reject candidates with dot below their minimum.
- When the focus changes, the menu selection resets to the first actionable line.
  - The selection then follows its *action id* as lines appear and disappear.
  - If that action is gone, it falls back to the first actionable line.

Every frame, also compute **car in reach** (§8). It is "none" while dead or seated.

**E**
- If there is a focus, send "use (target, selected action)" to the host.
- Otherwise, if a car is in reach, it acts exactly like F.

**F**
- Always sends "toggle vehicle" to the host, even when no car is in reach.
- On the host:
  - If you drive a car, you exit.
  - Otherwise you enter the nearest eligible car within 4.0 m (2.5 m reach + 1.5 m slack).
  - If none: private message `No car close enough - walk up to one until it says [F] Get in`.

**HUD prompt panel**
- Centred horizontally, at 64% of screen height.
- Lines from top to bottom:
  1. The focused spot's label (gold), then its options:
     - One option: `[E] <text>`.
     - Several: a list with `> ` before the selected line, then the grey hint `Up/Down choose - E select`.
  2. A focused civilian: `[E] Hold them up`.
  3. The car line:
     - While seated: `[F] Get out` (grey, 0.9 scale).
     - A car in reach: `[F] Get in`, or `[F] Get in (drag the driver out)` when it has an NPC driver (white, 1.15 scale).

Source: Escape/EscPlayerComponent.cpp:247-334,357-362,411-430; EscPlayerComponent.h:236 (`RobRange=500`); EscHUD.cpp:393-436.

---

### 5. Weapons

Lyra's weapon system does not exist on the web. Implement the following.

#### 5.1 Inventory, slots and ammo
- **Slots.** The quick bar has 3 slots. The game has 3 weapon types: Pistol, Shotgun, Rifle.
  - Players start unarmed.
  - Slots fill in acquisition order (not fixed per type).
  - Keys 1-3 equip that slot; an empty slot does nothing.
- **Getting a weapon** (shop purchase, the Stash pistol, respawn):
  - Already owned: buying it again does not add a copy. It adds 60 spare rounds to every ammo-using weapon you carry, and the full price is still charged.
  - New: it goes in the next free slot and is equipped at once. If all 3 slots are full, it replaces the weapon in the active slot (the old one is deleted). In practice 3 types never overflow.
- **Ammo.** Each weapon tracks `mag` and `spare`. A new weapon starts with a full magazine plus starting spare (choose, table below).
- **Ammo refill** (shop, ₪200): +60 spare to every weapon you own, with no cap. It needs at least one gun; otherwise the message `You have no gun to load`.
- **Reload (R)**
  - Only when `mag < magSize` and `spare > 0`.
  - After the reload time, move `min(magSize − mag, spare)` from spare to mag.
  - Switching weapon or dying cancels it.
  - Auto-reload: when `mag` hits 0 and `spare > 0`, reload starts 0.2 s after the last shot (choose).
- **Death.**
  - The host remembers the quick bar's weapon types in slot order and the active slot.
  - The next living pawn receives them again in the same order, each fresh (full magazine + starting spare).
  - The same slot is re-selected (slot 0 if that slot is empty).
  - Armour and the bag are lost; weapons are kept.
- **"Has a gun"** = owns any Pistol, Shotgun or Rifle. This drives the Stash (it gives a pistol only if you have no gun) and the ammo purchase.
- **"Holding a gun"** = a ranged weapon is equipped in hand. This is required for hold-ups.

#### 5.2 Firing model
- **Hitscan.**
  - Ray from the camera along the crosshair direction, perturbed by spread.
  - Ignore hits closer to the camera than the shooter's own position projected on the ray, so nothing between the camera and the character can be hit.
  - Shotgun pellets are separate rays.
  - Bullets are stopped by world geometry and car bodies (cars take no damage).
  - A seated driver can still be shot (choose: keep the driver's hit volume active while seated).
- **Damage.**
  - Formula: `damage = baseDamage × falloff(distance) × (headshot ? 1.5 : 1)`.
  - Distance is measured from the shot origin to the impact point.
  - Headshot multiplier 1.5 (choose) for hits on the head; Lyra models this as a "weak spot" multiplier.
- **Who can hurt whom.**
  - Humans (team 1) and soldiers (team 2) damage each other.
  - Civilians are on team 2 with the soldiers (spec 03 §0): humans can damage them, soldiers cannot.
  - No friendly fire between humans, or between soldiers.
  - Civilians never deal damage.
- **Health and armour.**
  - Base health: 100 for humans and soldiers, 60 for civilians.
  - Armour `a` (0..1) halves its share of the damage. It is implemented as `MaxHealth = base / (1 − a/2)`, keeping the current health fraction.
  - Plate carrier: a = 0.5, giving 133.3 HP.
  - Soldiers by type: rifleman 0.3, officer 0, heavy 0.8, marksman 0.2.
- **Kill knockback** (ragdoll launch on death; no gore, no blood):
  - Speed by the killer's weapon: Shotgun 26 m/s, Rifle 13 m/s, Pistol 7 m/s, anything else 9 m/s.
  - Scaled × (1 − victim armour).
  - Direction = victim − killer (2D), plus an upward kick of 0.5 × the magnitude.
  - Applied as a velocity change to the whole ragdoll on every machine.

#### 5.3 Weapon stats
All values are (choose) except the knockback and price rows, which are exact.

| | Pistol | Shotgun | Rifle |
|---|---|---|---|
| Fire mode | semi-auto | semi-auto (pump) | full auto (hold) |
| Rate | 300 RPM (0.20 s) | 70 RPM (0.86 s) | 600 RPM (0.10 s) |
| Base damage | 18 | 9 per pellet × 10 pellets | 12 |
| Magazine | 12 | 6 | 30 |
| Starting spare | 36 | 18 | 90 |
| Reload time | 1.4 s | 2.6 s (whole magazine) | 2.1 s |
| Hip spread (half-angle) | 1.2°, +0.6° per shot up to 3.0°, recovers 6°/s | fixed 5.0° cone | 0.6°, +0.25° per shot up to 3.5°, recovers 5°/s after 0.15 s |
| ADS spread multiplier | ×0.5 | ×0.8 | ×0.4 |
| Standing-still multiplier (speed < 0.8 m/s) | ×0.8 | ×1 | ×0.8 |
| Jumping/falling multiplier | ×2 | ×1.5 | ×2 |
| Falloff | 100% to 20 m, linear to 50% at 50 m, 50% to 250 m | 100% to 6 m, 20% at 25 m, 0 beyond 40 m | 100% to 35 m, linear to 60% at 100 m, 60% to 250 m |
| Max range | 250 m | 40 m | 250 m |
| Kill knockback | 7 m/s | 26 m/s | 13 m/s |
| Shop price ("Abu Shmulik's Garage") | ₪1,500 | ₪6,000 | ₪10,000 |

- Soldiers carry the rifle with the same stats, except unlimited spare ammo; their aim error follows the accuracy ramp in spec 03 §3 instead of the spread rows.
- Lyra's code limit for every weapon is 250 m. Pellet count, falloff curves and spread live in binary assets, hence the (choose) values.

#### 5.4 Shot noise (heat)
- The host checks every 0.25 s whether each shooter fired since the last check. Several shots in one window count once, so a rifle on full auto yields at most 4 × 12 = 48 heat/s.
- A shot by a human player gives +12 heat if a living civilian is within 50 m (2D) or a living soldier within 80 m (2D).
- Any shot, by a human or a soldier, makes civilians within 40 m (2D) panic and flee. Soldier shots never give heat.

#### 5.5 HUD (replaces Lyra's)
- Health bar.
- Ammo `mag / spare` for the equipped weapon.
- Weapon slot strip 1-3.
- Crosshair at the screen centre whose gap grows with the current spread.
- All (choose) layout. No speedometer exists in the original.

Source: Source/LyraGame/Escape/EscPlayerComponent.cpp:604-715 (60 spare at :712); Equipment/LyraQuickBarComponent.h:64 (`NumSlots = 3`); Weapons/LyraRangedWeaponInstance.h:171-179 (`MaxDamageRange 25000` cm); AbilitySystem/Executions/LyraDamageExecution.cpp:131; Teams/LyraTeamSubsystem.cpp:345-369; AbilitySystem/Attributes/LyraHealthSet.cpp:22-23; Escape/EscPawnComponent.h:95-102, EscPawnComponent.cpp:216,263-281; Escape/EscInteractable.h:173-176, EscInteractable.cpp:953-986; Escape/EscDirector.cpp:38-40,752-787; Escape/EscDirector.h:162; Config/DefaultGame.ini:250-258 (soldier armour); Config/DefaultGameplayTags.ini:39 (`Gameplay.Zone.WeakSpot`).

---

### 6. Vehicle roster

Drivable cars are sedan, taxi, van, pickup and hunter jeep. The tank and the helicopter are AI-only "hunter" vehicles and cannot be driven. All models are generic and stylised: no real brand, no replica of a real military model.

**Overall size, mass, wheels, drive**

| id | Size L × W × H (m) | Mass | Wheel radius / width | Axles x (front / rear) | Wheel y | Driven |
|---|---|---|---|---|---|---|
| sedan | 4.60 × 1.82 × 1.45 | 1400 kg | 0.32 / 0.22 | +1.38 / −1.32 (base 2.70) | ±0.74 | rear |
| taxi | 4.60 × 1.82 × 1.62 (roof sign) | 1400 kg | 0.32 / 0.22 | as sedan | ±0.74 | rear |
| van | 5.00 × 2.07 × 2.20 | 2000 kg | 0.34 / 0.24 | +1.65 / −1.55 (base 3.20) | ±0.81 | rear |
| pickup | 5.30 × 1.96 × 1.82 | 1900 kg | 0.38 / 0.26 | +1.75 / −1.45 (base 3.20) | ±0.75 | rear |
| hunter_jeep (army) | 4.42 × 2.05 × 1.92 | 2400 kg | 0.40 / 0.30 | +1.40 / −1.20 (base 2.60) | ±0.78 | all 4 |
| hunter_tank (AI) | 10.19 × 3.60 × 2.65 | 55000 kg | 6 road wheels/side, r 0.40, w 0.60, x = 2.15 − 0.86·i, y ±1.42 | – | – | tracks |
| hunter_heli (AI) | 15.75 × 10.24 × 4.49 | 5000 kg | – | main rotor r 7.0 at hub (0, 0, 4.2); tail rotor r 1.4 at (−9.4, 0.44, 3.4) | – | – |

**Seats, colours, notes** (driver seat in car space; +y = left)

| id | Driver seat (m) | Base paint | Notes |
|---|---|---|---|
| sedan | (0.00, 0.38, 0.48) | `3B6FB6` blue | variants `F2F2F2 1C1C1C 9AA0A6 6E6E6E 8C2F2A 2F4A3A D9CBA8` |
| taxi | (0.00, 0.38, 0.48) | `F2F2F2` white | yellow roof sign `F2C318` at (−0.4, 0, 1.55); variant `E6E6E6` |
| van | (1.00, 0.45, 0.95) | `E8E6DF` | sliding cargo door on the right; variants `F2F2F2 9AA0A6 3A4A5C B8C7D6 C9B88F` |
| pickup | (0.05, 0.40, 0.85) | `8C2F2A` dark red | open bed; variants `F2F2F2 1C1C1C 9AA0A6 C9B88F 2F4A6D` |
| hunter_jeep | (0.20, 0.42, 1.12) | `5B6B3A` olive | open tub, roll bars, spotlight (−0.035, 0.55, 1.86), rims `56603C`, canvas `4A5530`, patch `C9B46A` |
| hunter_tank | – | `5B6B3A` | dark `4A5530`, detail `56603C`, patch `C9B46A`; turret and barrel aim |
| hunter_heli | – | `5B6B3A` | accent `4A5530`, patch `C9B46A`; spotlight socket (4.29, 0, 0.5) |

**Shared car materials** (hex, roughness):
- Glass `2A3440` 0.15, see-through/translucent.
- Tyre `1C1C1C` 0.9.
- Rim `B8B8B8` 0.35.
- Trim `3A3A3A` 0.7.
- Headlight `F2E6B0` 0.3.
- Taillight `B3261E` 0.35.
- Paint roughness 0.45.

**Paint and seat rules**
- UE uses only the base paint per model; the variant lists are data only. Web may pick a random variant per spawned car (choose).
- Seat heights are hip heights, chosen so a 1.86 m character's head stays under the roof.
- Only the driver seat is used. There are no passengers in this build, although the sedan and jeep models have 4 seats and the van and pickup 2.

**Which models appear where**
- Parked cars: any of the 5 car models, including the army jeep.
- Traffic: sedan, taxi, van, pickup (never the jeep).
- An unknown model drives with sedan numbers.

**Hunter vehicles (AI only)**
- They are spawned by the wanted system; full rules are in that section.
- Helicopter:
  - Appears from 3 stars and leaves below 2.
  - Flies at 50 m altitude on a 40 m orbit at 0.22 rad/s and follows at 15 m/s.
  - Its spotlight has a 6 m radius and sweeps at 4.5 m/s.
- Tank:
  - Appears at 5 stars and is removed below 4.
  - Moves at 4.5 m/s and stops 35 m from its target.
  - Fires every 6 s within 150 m. Shells fly at 70 m/s with gravity ×0.1.
  - Shell hit: kill radius 4 m; blast radius 8 m with a 32 m/s launch.

Source: Tools/blender/veh_cars.py:17,168-310; Art/out/SK_veh_*.json (mass, wheels, seats, variants); Tools/ue/import_art.py:147 (size_cm in the last import log); Tools/blender/veh_hunter_tank.py:12-21; veh_heli.py:13-18; Source/LyraGame/Escape/EscVehicle.cpp:61-68,76-102,113-124; EscHunters.h:1-3,66-72,112-116,145-147; EscHunters.cpp:385-388.

---

### 7. Vehicle physics and handling

Every car shares one drivetrain. Only the wheel size, mass, drive layout and final drive ratio differ.

**Engine and gearbox**
- Max 6000 rpm, idle 900 rpm.
- Torque curve, as a fraction of max torque, linear between keys: 0 rpm 0.75 → 1500 rpm 1.00 → 5200 rpm 1.00 → 6000 rpm 0.
- Max torque = 0.15 × mass N·m: sedan/taxi 210, van 300, pickup 285, jeep 360.
- Automatic gears: forward ratios 2.8, 1.9, 1.35, 1.0; reverse 2.8.
- Shift up at 5200 rpm, down at 2500 rpm; each shift takes 0.15 s.
- Final drive ratio = `6000 × 2π × r_cm / (60 × 3050)`: sedan 6.59, van 7.00, pickup 7.83, jeep 8.24. This makes top gear at 6000 rpm equal the design top speed of 30.5 m/s (110 km/h) for every car.
- Engine rpm in gear g = `6000 × ratio_g × v / 30.5`.

| Gear | Shift-up at | Peak acceleration (theoretical) |
|---|---|---|
| 1st | 34 km/h | 8.65 m/s² |
| 2nd | 50 km/h | 5.87 m/s² |
| 3rd | 70 km/h | 4.17 m/s² |
| 4th | full torque until 95 km/h | 3.09 m/s² |

- Peak acceleration in gear g = `0.15 × 20.6 × ratio_g × torqueCurve(rpm)` m/s², the same for every car because the final drive ratio scales with wheel radius. Real acceleration in first gear after losses is about 7 m/s².
- Measured top speed ≈ 95 km/h. In 4th gear torque falls to zero between 95 and 110 km/h.
- Derived 0 → 95 km/h ≈ 7 s.
- Web: apply this acceleration per gear and clamp at 95 km/h (26.4 m/s).
- Reverse: same ratio as 1st, reaching about 34-39 km/h.

**Throttle, brake and reverse (one W/S axis)**
- Throttle = clamp(+axis, 0, 1); brake = clamp(−axis, 0, 1).
- Brake input while moving forward faster than 1 m/s = full brake.
- Brake input at or below 1 m/s shifts to reverse, and S then drives backwards.
- W while in reverse shifts back to 1st. It does not auto-brake; the engine pushes forward.
- With no pedal pressed there is no idle braking.
- Input smoothing toward the target: throttle and brake rise at 6/s and fall at 10/s; handbrake 12/s.
- Service brake: 1500 N·m per wheel. Web: about 8 m/s² (choose).

**Handbrake**
- Rear wheels only, 3000 N·m per wheel, enough to lock them.
- Web: when held, rear lateral grip ×0.3 and rear wheels locked, about 6 m/s² extra deceleration (choose).
- The handbrake is on for every car at spawn and after a driver exits. It is released on entry.

**Steering**
- Front wheels only, 35° maximum.
- Speed scaling, linear in mph: 0 → ×1.0, 20 mph (32 km/h) → ×0.8, 60 mph (97 km/h) → ×0.4, 120 mph → ×0.3.
- Ackermann approximation: the outer wheel turns 0.7 × the inner wheel.
- Input response:
  - Steer input moves toward the target at 2.5/s while growing and 5/s while returning toward zero.
  - The wheel angle uses the *squared* input: `sign(s) × s²`. Keyboard ±1 is unaffected; analog input and the AI are.

**Wheels, suspension, grip**
- Friction multiplier 3.0; cornering stiffness 1000.
- Suspension: raise 0.08 m, drop 0.12 m, spring rate 250, preload 50, damping ratio 0.5.
- Wheel load ratio 0.5; anti-roll scaling 0.15.
- Wheels are raycasts with no wheel collision bodies. The wheel rays ignore characters and ragdolls, so cars roll over people instead of climbing them.

**Body**
- One box collider:
  - x/y = the model's full bounding box.
  - z from the wheel-centre height (= wheel radius, capped at roof − 0.5 m) to the roof.
  - So the body never scrapes the road.
- Mass from the roster table.
- Centre of mass forced to car space (0, 0, r): the wheel-centre height, very low and stable.
- Drag coefficient 0.3, frontal area = width × height. Downforce coefficient 0.3.
- The car body ignores ragdolls: a driver shot in the seat falls through the car.
- Cars are indestructible.
- Characters: the car's body does not physically collide with characters. Characters are pushed out of the car box and take no damage unless the run-over rule applies (§10).

**Web: Rapier `DynamicRayCastVehicleController`**
- Chassis cuboid collider; 4 ray wheels at the axle positions; suspension rest length 0.20 m, max travel 0.20 m.
- Engine force per driven wheel = mass × accel(gear, rpm) / drivenWheels.
- Steering angle = 35° × speedCurve × input².
- Wheel rays must exclude character and ragdoll collision groups.
- Parked cars sleep.

Source: Source/LyraGame/Escape/EscVehicle.cpp:44-47,126-137,140-167,179-209,535-587,732-744; Engine/Plugins/Experimental/ChaosVehiclesPlugin/Source/ChaosVehicles/Private/ChaosVehicleMovementComponent.cpp:604-648,1125-1190,1297-1312; Public/ChaosWheeledVehicleMovementComponent.h:474-482; Private/ChaosVehicleWheel.cpp:29-51.

---

### 8. Entering, exiting and carjacking

**Car in reach**
- The same test runs on the owner (for the prompt, reach 2.5 m) and on the host (reach 4.0 m, allowing for lag).
- Candidates: every car with no player driver.
- An NPC-driven traffic car is a candidate only if its speed ≤ 4 m/s (14.4 km/h). An empty car is a candidate at any speed.
- Distance = from the pawn's position, transformed into car space, to the car's collision box (0 inside). If the box is unknown, use distance to the centre − 2 m.
- The nearest candidate within reach wins.

**Enter (host)**
- Requires: the player is alive, has a controller, drives no other car, and the car has no driver.
- If the car has an NPC driver (carjack):
  - Spawn a real civilian at car position + carRight × side × (box half-width + 1.2 m), at road height (car origin z). `side` is the car's side away from the player.
  - That civilian immediately panics and flees from the player. There is no harm and no heat; carjacking itself adds no heat.
  - If the civilian population is at its hard cap (60 + 8), no civilian appears and the driver just vanishes.
  - Remove the cosmetic driver. The car leaves the traffic pool and becomes an ordinary car for good, never despawned.
- Seat the player:
  - Disable the character's collision and movement and stop it following camera yaw.
  - Attach it to the car at the driver seat: car-space seat position (seat y on the left side), zero relative rotation, facing forward.
  - Release the handbrake.
  - The player's car becomes "owned" by that player's connection.
  - In UE the seated character keeps its idle pose. Web: play a seated pose with the pelvis at the seat point (choose).
- On the driver's machine:
  - The driving keys take priority over the on-foot bindings.
  - Blend the view to the car camera in 0.3 s.

**Exit (host)** on F, or automatically when the driver dies, disconnects or loses control, or the car is destroyed:
- Clear the driver and the ownership, then detach the character.
  - Keep its world position; reset pitch and roll to 0, keep yaw.
  - Restore collision and walking, unless it is dead: the ragdoll then simply drops.
- If alive, place it on the first spot that is not blocked:
  1. carPos + (0, 0, 1.0) + yawRotate(0, driverSide × 2.5 m, 0). The driver's door side: left in car space.
  2. The same on the other side.
  3. carPos + (0, 0, 1.0 + 2.5), on the roof, forced.
- The character faces the car's yaw.
- Zero the car inputs and engage the handbrake.
- On the driver's machine, the driving keys stop overriding on-foot input and the view blends back in 0.3 s.

Source: Source/LyraGame/Escape/EscVehicle.h:109,238; EscVehicle.cpp:312-337,355-427,589-634,795-845; EscPlayerComponent.cpp:253,411-430; Escape/EscDirector.cpp:53,661-676.

---

### 9. Driving input and multiplayer authority

The host owns and simulates all vehicles. Clients do not predict cars.

**Driver client**
- Every frame, read `throttle ∈ [−1,1]`, `steer ∈ [−1,1]`, `handbrake ∈ {0,1}`.
- Send them to the host as an unreliable message, accepted only from the car's owner.
- The host clamps the values and applies them as in §7.
- Input packets that arrive after the driver exited are ignored.

**Replicated per car**
- Driver (the attached player; clients seat or unseat in response).
- Model id (clients build mesh, box and seat from it).
- NPC-driver byte (0 = none, 1-255 picks the cosmetic look).
- Transform and velocity snapshots.
- Rates: player-driven and parked cars at the pawn default rate (100 Hz in UE); traffic cars at 30 Hz.
- Every car is relevant to every client at any distance.

**Host only**
- Enter/exit (reliable requests), run-over checks, the traffic AI (10 Hz control, 1 Hz population).

**Web**
- Follow spec 05 H16: the driver sends `carInput` every frame over the unreliable/unordered `snap` channel.
- Cars ride in the 20 Hz host snapshots. Other cars render 100 ms in the past; the driver's own car 50 ms in the past plus velocity extrapolation (choose).

Source: Source/LyraGame/Escape/EscVehicle.h:1-8; EscVehicle.cpp:47,183-187,306,376,429-456,494-513,719-744.

---

### 10. Running people over

Checked on the host every frame while a **human player** drives and the car's speed ≥ 8.0 m/s (28.8 km/h). Traffic AI cars never run anyone over.

**Detection**
- Box overlap at the car's collision box enlarged by (+0.40, +0.20, +0.20) m half-extents, rotated with the car, against characters.
- The driver is excluded.
- Each character found is processed once per frame.
- The same rule fires when someone walks into a car moving at ≥ 8 m/s.

**Victims**
- Only civilians and soldiers. Other human players are immune (no friendly fire). Already-dead victims are ignored.

**Effect**
- Ragdoll launch velocity = `(carVelocity × 1.2 + (0, 0, 6.0 m/s)) × (1 − victimArmour)`. No blood or gore.
- The launch replaces the weapon death-knockback.
- The victim is killed instantly. Armour reduces only the launch, never the kill.
- The kill counts as self-inflicted, so no separate kill heat is added on top of the run-over heat.

**Heat** (reason "Hit and run")
- Civilian: +100, plus another +100 if any living soldier has line of sight within 100 m to the victim's position (+0.5 m).
- Soldier: +40.
- Killing civilians never pays: there is no money, only heat.

Source: Source/LyraGame/Escape/EscVehicle.h:240-242; EscVehicle.cpp:469-491,746-793; Escape/EscDirector.h:78; EscDirector.cpp:440-455; Escape/EscPawnComponent.cpp:284-290.

---

### 11. Parked cars

Spawned once, by the host, at world start:
1. 3 cars near each highway end (the highway polyline endpoints where highways leave the cities). The 3 highways give 6 ends, so up to 18. Candidates: walk points within 150 m of that end.
2. 40 cars across the whole world. Candidates: all walk points (road vertices and highway lane points, thinned to one per 12 m, never inside buildings).

**Per batch**
- Shuffle the candidates deterministically: Fisher-Yates with seed `0xE5CA + candidateCount`.
- Walk the shuffled list. Skip a point within 40 m (2D) of a car already placed *in this batch*. Stop at the batch count.
- For an accepted point:
  - Try the 4 world-axis yaws (0/90/180/270°), starting at a random one.
  - Car position = point + yawRotate(0, 1.0 m to the right, 0.40 m up).
  - Accept the first yaw where a box with half-extents (2.60, 1.10, 0.60) m, centred 1.0 m above that position, overlaps no blocking vehicle-channel geometry.
  - If all 4 yaws are blocked, skip the point.
- Model: uniformly random among the 5 car models, including the army jeep.

**Behaviour**
- Handbrake on. Parked cars are full physics bodies and can be shoved.
- They never despawn or respawn.

Source: Source/LyraGame/Escape/EscCity.h:138,142; EscCity.cpp:464-471,3512-3525; Escape/EscVehicle.cpp:46,230-292,502-511; Data/zones/world.json (3 highways).

---

### 12. NPC traffic

The traffic runs on the host. It keeps **14** cars in the *whole world* around the living human players.

#### 12.1 Road graph (built once, on the first population tick that has roads)

**Drive roads (input)**
- The 3 inter-city highways from world.json: centre line, half-width 9.0 m, flagged *highway*.
- City ways: every non-paved style with width ≥ 5.5 m. That is motorway 16, trunk 14, primary 13, secondary 13, tertiary 10, residential 7.5, unclassified 7, links 7-8, living_street 5.5. It excludes service 4.5, track 3.5 and every paved/pedestrian way.
- City roads are never "highway" for cruise purposes, even motorways.
- A way is split into separate roads wherever a segment has both ends off land.

**Lane offset per road**
- `clamp(halfWidth × 0.5, 1.5 m, 4.5 m)` to the right of the centre line: the middle of the right half.
- Examples: highway 4.5, motorway 4.0, trunk 3.5, primary 3.25, tertiary 2.5, residential 1.875, living street 1.5.
- Web: right = cross(forward, up) in a right-handed, y-up frame.

**Vertices**
- Road points in order, flat at z = 0.
- Indexed in a 50 m grid for lookups.

**Junction links**
- Every vertex links to every vertex of a *different* road within 3.0 m (2D).

**End snapping**
- Applies to a road-end vertex with no link.
- Link it, in both directions, to the nearest vertex of another road within 25 m, but only if one of the two roads is a highway.
- City cul-de-sacs stay dead ends.

**Dead end** = the road's end in that direction has no link.

#### 12.2 Population (every 1 s; first run 2 s after start)

- **Humans**: every player pawn, alive or dead (their camera is there). **Living**: those alive.
- **Forget** cars that were destroyed, carjacked or now have a player driver.
- **Remove** a car if it is "far" (nearest human > 500 m, 2D) or "doomed" (§12.5), **and** no human can see it.
- **Seen**:
  - For each human, check the line from the eye to the car position + 1.5 m.
  - The line must be within 600 m (3D) and blocked by nothing except that human, the car itself, and the human's own car.
- **Spawn**: up to 2 attempts per second while there are fewer than 14 cars and at least one living human. Each attempt:
  1. Anchor = a random living human.
  2. Ring = road vertices 120-400 m (2D) from the anchor and ≥ 120 m from every living human.
  3. Up to 12 tries: pick a random ring vertex and a random direction, then plan the start (§12.3).
     - Reject if another traffic car is within 30 m.
     - Reject if a box with half-extents (2.60, 1.10, 0.60) m, 1.4 m above the start point and facing the path, overlaps blocking vehicle geometry.
     - The first unseen spot spawns at once. Otherwise remember the first valid seen spot and spawn there after the tries (cars may pop in visibly when every spot is in view).
- **Spawn transform**: Path[0] + 0.40 m up, facing Path[1] − Path[0].
- **Car setup**:
  - Model: random civilian model (sedan, taxi, van, pickup).
  - NPC-driver byte: random 1-255.
  - City cruise speed: uniform 35-50 km/h. Highway cruise: uniform 80-90 km/h. Both chosen per car.

#### 12.3 Path planning

**Leg clear**
- Sweep a box with half-extents (1.50, 1.10, 0.50) m, oriented along the leg, from From + 1 m to To + 1 m against static world geometry.
- The leg is blocked if it hits city geometry (walls, buildings, tree trunks, lamps, kiosks) with surface normal z < 0.7. The ground never blocks.
- Web: segment vs. building/prop footprints inflated by 1.1 m.

**Start at (vertex V, direction d)**
- Flip d if there is no next vertex that way, or if that way is a dead end while the other way exists and is not.
- If there is still no next vertex N, fail.
- Path = [V + right × lane, lanePoint(V→N)]. The leg between them must be clear.

**Lane point (A→B)** = B + right(A→B) × lane offset of B's road. Lane 0 = the centre line.

**Extend** — keep at least 60 m of plan beyond Path[1], at most 32 points. At the current vertex:
1. Options: continue along this road; each linked vertex of another road in both directions.
2. Drop options with no next vertex, or whose first leg turns more than 120° from the incoming direction (dot < −0.5).
3. Shuffle, then stable-sort non-dead-ends first.
4. Append the U-turn (this road, reversed) as the last resort.
5. For each option in order: try its lane point, then its centre-line point. Take the first whose leg from the current path end is clear.
6. If none is clear, stop planning. The car stops at the end of its plan, and the stuck handling removes it.

#### 12.4 Driving controller (10 Hz per car; physics keeps applying the last input)

Speeds below are signed forward speeds; negative means reversing.

1. **Prune.** While the path has more than 2 points, drop Path[0] unless the car is still before Path[1] (dot(car − P1, P1 − P0) < 0 and more than 3 m from P1) and is not already closer to segment P1-P2 than to P0-P1. Then extend.
2. **Broken.**
   - Doomed if upside down (car up-vector z < 0.3).
   - If the car is more than 15 m from segment P0-P1, re-plan from the nearest vertex within 30 m, in the direction the car faces. Doomed if that fails.
3. **Look-ahead pursuit.**
   - Look distance = clamp(|speed| × 0.6 s + 3 m, 5 m, 25 m), walked along the path from the car's closest point on P0-P1. Target = the path end if the plan is shorter.
   - `steerDeg = atan(2 × 2.70 × sin(atan2(side, ahead)) / max(dist, 1 m))`, where ahead/side are the target offset along car forward/right.
   - If the target is behind (ahead < 0): full lock toward its side, and the turn angle counts as 35°.
   - Otherwise: input = `sign(r) × √|r|` with `r = clamp(steerDeg / (35° × speedCurve(speed) × 0.85), −1, 1)`, which undoes the squared input and the speed scaling.
   - Web: if the web car applies steering linearly, feed `steerDeg / lock(speed)` directly.
4. **Target speed** (cm/s from code, converted). Take the minimum of:
   - The cruise speed of the road the next point lies on.
   - The bend limit √(3.0 m/s² × 2.70 m / max(tan(turnDeg), 0.01)).
   - 5 m/s if the target is more than about 45° off the nose (ahead < 0.7 × dist).
   - For each upcoming leg within 80 m: corner speed = (that leg's cruise) × clamp(1 − angleFromCarForward/100°, 0.3, 1), and the limit is √(corner² + 2 × 4.0 m/s² × max(distanceToLegStart − 5 m, 0)).
   - Stopping at the end of the plan: √(2 × 4 × max(remainingPlan − 3 m, 0)).
5. **Obstacle sweep.**
   - Start at the nose − 0.6 m, 1 m up. Direction = normalize(forward + direction to the target).
   - Reach = clamp(speed²/(2 × 4) + 8 m, 10 m, 60 m).
   - Box half-extents (0.5, car half-width, 0.5) m.
   - Hits: static, dynamic, characters, vehicles, ragdolls. Ignore the city (handled by the wall sweep) and non-character things that do not block vehicles, such as dropped bags and triggers.
   - Nearest hit: mark the car blocked; "people ahead" if it is a character, not a car. Limit speed to √(2 × 4 × max(hitDist − 2.5 m, 0)), i.e. stop about 2 m short.
6. **Wall sweep.**
   - Reach = speed²/(2 × 4) + 3 m.
   - Direction = forward rotated toward the steering side by `min(0.5 × reach × tan(turnDeg) / 2.70, 60°)`.
   - Static world only, city walls only (normal z < 0.7).
   - Limit speed to √(2 × 4 × max(wallDist − 1 m, 0)).
   - "Wall" flag = a wall hit no farther than the obstacle hit.
7. **Pedals.**
   - target < 1 m/s and speed < 2 m/s: handbrake only.
   - Else if target > speed: throttle = clamp(0.3 + (target − speed)/8 m/s, 0, 1).
   - Else if speed − target > 0.5 m/s and speed > 2 m/s: brake = clamp((speed − target)/3 m/s, 0.2, 1).
   - Otherwise coast.

#### 12.5 Stuck recovery and removal

- "Last moved" is refreshed whenever speed > 1.5 m/s or people are ahead. Waiting for people never counts as stuck. It is also set at spawn.
- The stuck counter resets when speed > 5 m/s.
- **While reversing** (2 s):
  - Brake input 0.8 while speed > −2.5 m/s, else 0. Brake at low speed engages reverse, so the car backs up at about 9 km/h at most.
  - Steering is the opposite of the computed steering; no handbrake.
- **Stuck trigger.** Now − last moved > 1.5 s if the wall flag is set, 18 s if blocked, 6 s otherwise. Then:
  - Reverse for 2 s, and set "last moved" to now + 2 s.
  - Stuck count +1. At 3 the car is doomed.
- Doomed cars keep trying but are removed by population as soon as no human sees them.

#### 12.6 Cosmetic NPC drivers

- Every traffic car shows a generic civilian sitting at the driver seat on every client.
  - Look = civilian model index (byte − 1) mod the number of civilian looks (2: beach-goer, elderly).
  - The body is placed at seat − 0.45 m (the root of a seated idle loop whose pelvis is about 0.45 m above its root).
  - No collision, no shadow.
- Bullets do not affect it. Traffic cars cannot be destroyed or stopped by shooting.
- Removed on carjack (§8) or when the car despawns.

#### 12.7 Rules

- AI cars never cause heat and never kill: there are no run-over checks without a human driver, and the sweeps brake for people.
- AI cars brake for players, players' cars, roadblocks and crates.
- AI input is ignored the moment a player drives the car.
- The 14 cars are shared by all players, wherever each player is.
- Web performance: optionally move unseen traffic cars more than 150 m from every player as kinematic bodies along the path (choose).

Source: Source/LyraGame/Escape/EscTraffic.h:1-7,43-60,103-113; EscTraffic.cpp:25-30,53-73,108-117,121-149,186-264,266-359,363-554,589-746; Config/DefaultGame.ini:313-322; Escape/EscCity.cpp:863,972-979,1171-1189; Escape/EscVehicle.cpp:294-310,658-717,719-730; EscVehicle.h:226-235; Config/DefaultGame.ini:259-260 (civilian looks); Docs/escape_design.md:54-57.

---

### Addendum: Controls and combat details the sections leave open

- **Weapons while seated.** Unreal only overrode W/A/S/D/Space while driving (`EscVehicle.cpp:802-822`), so Lyra's
  fire/aim/reload/slot keys were never explicitly blocked. The HUD hides the crosshair while driving (05 H11), and the
  chase camera has no aim. **Web: ignore fire, ADS, reload and slot keys while seated** (no drive-bys). An equipped
  weapon stays equipped and is shown in the seated pose's hand or hidden (choose).
- **Equip time** (choose): selecting a slot, or receiving a new weapon, takes 0.4 s before the first shot. It cancels a
  running reload (§5.1). Selecting the slot already in hand does nothing. There is no holster: once armed, a weapon is
  always in hand. That is Lyra's quick-bar behaviour, and hold-ups rely on it.
- **Mouse wheel** (choose): next/previous non-empty slot, wrapping.
- **No fall damage and no healing.** Lyra has neither. Health only comes back by respawning, or proportionally through the
  plate-carrier rescale (03 §8). There are no health pickups on the map.
- **Lyra extras not in this game:** grenade, melee, emote, dash (§1), plus kill feed, accolades and scoreboard (05_hud.md,
  Addendum: HUD extras).
- **Camera while dead** (choose; Lyra keeps the third-person camera on the dying pawn): keep the on-foot camera rig on
  the ragdoll's pelvis with mouse orbit still active and collision on. Snap to the new pawn on respawn, at the respawn
  facing.
- **Flipped player cars.** There is no auto-righting in the original. Traffic cars that flip are "doomed" (§12.4), but a
  player's flipped car simply stays flipped: press F to get out (exit rule §8). Web: keep it. A "hold F 2 s to flip back"
  helper is optional (choose, record it if added).
- **Teams wording.** §5.2 says civilians "have no team". In the code they are on team 2 with the soldiers (03 §0). The
  effect is the same: fugitives hurt civilians and soldiers, soldiers hurt neither. Follow 03.
- **Soldier spread.** §5.3's "bot spread ×2" is superseded by 03's accuracy ramp (03_ai.md, Addendum: Soldier details).
- **Weapon networking** (who traces hits, the shot and ammo messages): 05_hud.md, Addendum: Weapon netcode.
