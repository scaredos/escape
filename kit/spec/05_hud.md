## HUD / UI, front-end flow, multiplayer and test hooks

All HUD numbers below are for a 1920×1080 reference. **S = viewportHeight / 1080** scales every pixel value. Inside the code, "cm" means Unreal world centimetres. The web build uses metres (1 m = 100 cm).

---

### H1. HUD rendering model and shared text helpers

- The HUD is an immediate-mode overlay that is fully redrawn every frame on top of the 3D view. In Unreal it is a Canvas HUD, and Lyra's own HUD (health, ammo, crosshair) sits above it. The primitives are text, filled rectangle, filled triangle list (stars, diamonds, arrows, map) and "panel".
- **Font:** Roboto. Regular below scale 1.2, **Bold at scale ≥ 1.2**. Size is `max(6, 16 × scale × S)` Slate points. On the web that is **px = max(8, 21.33 × scale × S)**. At 1080p this works out to:

  | scale | px |
  |---|---|
  | 0.7 | 15 |
  | 0.75 | 16 |
  | 0.8 | 17 |
  | 0.85 | 18 |
  | 0.9 | 19 |
  | 1.0 | 21 |
  | 1.1 | 23 |
  | 1.15 | 25 |
  | 1.5 | 32 (bold) |
  | 2.0 | 43 (bold) |
  | 2.2 | 47 (bold) |
  | 2.4 | 51 (bold) |
  | 4.0 | 85 (bold) |

  Use line height ≈ 1.2 × px (choose).
- **Text shadow:** black, offset `max(1, round(2·S))` px on both x and y. It is on for every HUD text.
- **Panel(x, y, rows, alignX):** each row is `{text, colour, scale, rowBack}`.
  - pad = 12·S, gap = 3·S.
  - W = max(row width) + 2·pad. H = Σ(row height + gap) + 2·pad − gap.
  - Left edge = x − W·alignX (0 = x is the left edge, 0.5 = centre, 1 = right edge). The top edge is y.
  - Background rgba(0,0,0,0.55).
  - Each row's text starts at `left + pad + (W − 2·pad − rowW)·alignX`, so rows are centred inside centred panels and right-aligned inside right-aligned panels.
  - A row with a rowBack gets a highlight box at (left + 4·S, rowY − gap/2, W − 8·S, rowH + gap).
- **Colours.** The code uses linear values. Unreal converts UI colours linear→sRGB, so use the **display hex** in CSS. Alpha is not converted.

  | name | linear | display hex | used for |
  |---|---|---|---|
  | Gold | (1, .8, .25) | #FFE789 | wallet, titles, selected menu line, local player, shops/casino/job/bank/forger markers |
  | Wanted | (.95, .2, .2) | #F97C7C | lit stars, WANTED bar, pier/border finale title, delivery timer under 30 s |
  | Grey | (.62, .62, .62) | #CECECE | secondary lines, info menu lines, city name |
  | BagGreen | (.3, .9, .4) | #95F3AA | CASH markers, "Carrying" line |
  | Boat | (.3, .8, 1) | #95E7FF | BOAT / AIRPORT / BORDER, BOARDING title |
  | Friend | (.55, .75, 1) | #C4E1FF | SAFEHOUSE, other players on the map |
  | Parcel | (1, .55, .15) | #FFC46C | DELIVERY / DROP-OFF, delivery objective line |
  | Outline | (0, 0, 0, .85) | #000000 @ .85 | star and diamond outlines |
  | Panel | (0, 0, 0, .55) | #000000 @ .55 | every panel |

- **Text formats** (exact):
  - **Money `Shekels(n)`:** `"₪" + groupedThousands(|n|)`, with a "-" prefix if negative. Examples: `₪500`, `₪12,345`, `-₪3,000`. Web: `(n<0?'-':'')+'₪'+Math.abs(n).toLocaleString('en-US')`.
  - **Clock(sec):** `t = max(0, ceil(sec))`, then `${floor(t/60)}:${pad2(t%60)}`. Examples: `0:42`, `2:13`, `12:05`. Negative input shows `0:00`.
  - **Distance(cm):**
    - cm ≥ 100000: `"%.1f km"` (for example `1.2 km`).
    - Otherwise: `round(cm/100) + " m"` (for example `6 m`, `340 m`).
    - Edge case: 999.6 m shows `1000 m`.
  - **PlaceName(inset):** `""` → `Highway`, `telaviv` → `Tel Aviv-Jaffa`, `haifa` → `Haifa`, `jerusalem` → `Jerusalem`, `eilat` → `Eilat`, anything else → the raw name.
  - **Food list:** item names `Burger, Fries, Cola, Falafel` joined with ", ". An empty list shows `empty`. An unknown index shows `?`.

Source: EscHUD.cpp:32-48, 51-55, 108-117, 164-179, 799-876; EscCommon.h:47-50.

Web: draw the HUD in one full-window 2D `<canvas>` overlay, sized to `innerWidth×innerHeight×devicePixelRatio`. Load Roboto 400/700 from Google Fonts, and measure text with `ctx.measureText` (keep a cache per string+size).

---

### H2. Screen states and draw order (every frame)

1. Draw nothing until the director state (wallet and phase) has arrived from the host.
2. On the first frame, log `PROBE {"event":"hud_ready","w":<px>,"h":<px>}` once.
3. **Phase = Escaped:** draw only the end card (H10) and return.
4. **Map open (M):** draw the full map (H9), then the wallet panel (H3), and return. Nothing else is drawn, but the player can still move.
5. Otherwise, in this order: world markers (H8), wallet (H3), objective (H4), job panel (H6), message feed (H7), prompt/menu (H5).
6. Health/ammo/crosshair (H11) is drawn above everything. Keep the bottom 120·S px free for it.

Source: EscHUD.cpp:202-245.

---

### H3. Wallet panel (top right): money, 5 stars, search bar, city name

- Constants: pad = 14·S, starStep = 34·S, barH = 22·S. stars = clamp(director.stars, 0, 5).
- The wallet text is `Shekels(money)` at scale 2.4 in Gold (bold). Measure it to get walletW and walletH.
- Size and position:
  - W = max(walletW, 5·starStep) + 2·pad
  - H = 2·pad + walletH + starStep + (stars > 0 ? 8·S + barH : 0)
  - X = viewW − 24·S − W, Y = 24·S. Background is Panel colour.
- The wallet text is right-aligned: x = X + W − pad − walletW, y = Y + pad.
- **Stars:**
  - Centre of star i (i = 0..4): x = X + W − pad − starStep·(4.5 − i), y = Y + pad + walletH + starStep/2.
  - Each star is two filled 5-point stars: outer radius 15·S in Outline colour, then 12·S filled.
  - Fill is Wanted for i < stars, otherwise rgba(.32,.32,.32,.9) (#999999 @ .9). Stars light up from the left.
  - Geometry: 10 vertices alternating between the outer radius and 0.45×outer, starting straight up (angle −90°), with a step of 36°. Fill as a triangle fan.
- **Search bar** (only when stars > 0):
  - barX = X + pad, barY = starsY + starStep/2 + 8·S, barW = W − 2·pad.
  - Background rgba(.12,.12,.12,.85).
  - If director.searchAlpha > 0: fill width barW·searchAlpha with rgba(1,.8,.25,.75), label `SEARCHING`.
  - Otherwise (being seen, in the 8 s grace, or in a boat/border finale where the search never runs): a full-width pulsing red fill rgba(.95,.2,.2, .35 + .35·p) with p = 0.5 + 0.5·sin(6·realTimeSeconds). Label `WANTED`.
  - The label is white, scale 0.8, centred in the bar.
- **City name under the panel:** `PlaceName(insetAt(myPawn))`, Grey, scale 0.9, right edge aligned with the panel's right edge, y = Y + H + 6·S. It is shown only when the player has a pawn.

Source: EscHUD.cpp:247-321; EscDirector.cpp:817-835 (searchAlpha = unseenTime/15 s, which runs only after 8 s with no heat gain and nobody seen, and only while Playing).

---

### H4. Objective panel (top left)

`Panel(24·S, 24·S, rows, alignX 0)`. Rows are built in this order.

**During the finale (phase = Finale):**

1. `"<TITLE>  <Clock(finaleLeft)>"` (two spaces), scale 2.2 (bold). Title and colour depend on the kind:
   - Airport: `BOARDING` in Boat colour.
   - Crossing: `HOLD THE BORDER` in Wanted.
   - Boat: `HOLD THE PIER` in Wanted.
2. Hint, white, scale 1.0:
   - Airport: `Stay at the gate and keep it quiet: one star cancels boarding`
   - Crossing: `Keep someone at the crossing until the smugglers' truck rolls in`
   - Boat: `Keep someone on the pier until the boat casts off`

**Otherwise (Playing):**

- living = number of living human players (at least 1). Prices:
  - crossing = 10,000 (flat, for the team)
  - boat = 15,000 × living
  - airport = 25,000 × living, and open only if passportsMissing == 0 and stars == 0
- Sort the three ways by cost, ascending. The names are `the southern border at Eilat`, `a boat from Jaffa or Haifa` and `a plane from Ben Gurion`.
- Affordable = the ways that are open and cost ≤ money.
- Row 1:
  - If any are affordable: `Get out: ` + join(`<name> (<₪cost>)`, `" or "`). Gold, scale 1.1.
  - Otherwise: `Make <₪cheapest cost of all three> to get out  (<₪money> so far)`. White, scale 1.1. The cheapest is always the crossing, ₪10,000. Example at start: `Make ₪10,000 to get out  (₪500 so far)`.
- Row 2, Grey, scale 0.85, always shown. Prices are per player (living = 1):
  `Boat from Jaffa/Haifa ₪15,000 each - airport ₪25,000 each + passports, no stars - southern border ₪10,000`
- Row 3, Grey, scale 0.85. Shown only if missing > 0 and (missing < living, or money ≥ airport price for the current living count):
  `Passports: <living−missing> of <living> - the forger in Jerusalem sells them (₪5,000)`

**In both phases, appended:**

- If the carried bag value > 0: `Carrying <₪bag> - fence it at a SHOP (30% slower)`. BagGreen, scale 1.0.
- If carrying a package: `Deliver to <deliveryLabel>  <Clock(deadline − hostNow)>  (+<₪reward>)`. Parcel colour, or Wanted when under 30 s left. Scale 1.0. Example: `Deliver to Haifa - Carmel Cargo & Courier  2:13  (+₪3,300)`.

Source: EscHUD.cpp:323-391; EscInteractable.cpp:669-683 (EscapeCost); EscInteractable.h:192-195.

---

### H5. Prompt and menu (bottom centre), focus and selection

**Panel:** `Panel(viewW·0.5, viewH·0.64, rows, alignX 0.5)`. It is drawn only if there is at least one row.

**Rows:**

1. **Focus is a spot:**
   - Label row: the spot's label in Gold, scale 1.15. Labels are the world.json spot names, for example `Abu Shmulik's Garage - guns, armour, fence`. A dropped bag's label is `Cash bag`.
   - Exactly 1 option: `"[E] " + text` in white if it is actionable. If it is info only, show the plain text in Grey with no `[E]`.
   - 2 or more options: one row per option.
     - The selected row is `"> " + text`. All other rows are `"   " + text` (three spaces).
     - Text colour: Grey if the line is info only, otherwise Gold if selected, otherwise white.
     - The selected row's highlight is rgba(1,.8,.25,.22).
     - Last row: `Up/Down choose - E select` in Grey, scale 0.8.
   - Edge case: if no option is actionable, row 0 is still drawn selected (grey "> ").
2. **Focus is a civilian:** `[E] Hold them up`, white, scale 1.15.
3. **Car line,** appended:
   - While seated in a car: `[F] Get out`, Grey, scale 0.9.
   - Otherwise, if a car is in reach: `[F] Get in`, or `[F] Get in (drag the driver out)` for a traffic car with a driver. White, scale 1.15.

**Focus** (local client, every frame; only while my pawn is alive, including while seated in a car):

- Candidate spots: within the spot's use radius (2D, pawn to spot) and with a non-empty option list. Required view alignment: dot(cameraForward, normalize(spot − camera)) ≥ 0.3.
- Use radii:

  | spot | radius |
  |---|---|
  | shop, job, casino, forger | 4.5 m |
  | bank | 5 m |
  | airport, delivery | 6 m |
  | boat, crossing | 9 m |
  | crate, bag | 3 m |

- Candidate civilians: only while I hold a ranged weapon. Living civilians within 5 m, with dot ≥ 0.9.
- Score = dot − dist/range. The highest score wins.
- When the focus changes, the remembered selection is cleared.

**Car in reach:**

- No player is at the wheel.
- The pawn is within 2.5 m of the car's body box (not its centre).
- A traffic car only counts when its speed is ≤ 4 m/s.
- The car counts as "none" while I am seated.

**Selection:**

- The client remembers the selected line's action id, not its index. Every frame it re-finds that action in the current option list. If the action is gone, it selects the first actionable line.
- Up/Down step to the previous/next actionable line, wrapping around.
- **E:** if there is a focus, send `use(targetId, selectedActionId)` to the host. Otherwise, if a car is in reach, toggle the vehicle.
- **F:** always toggles the vehicle.

**Host validation:**

- `use`: my pawn is alive, and the 2D distance is ≤ use radius + 1.5 m. Run the action only if it is an actionable line of the option list rebuilt on the host right now. A civilian hold-up needs the civilian to be alive, within 6.5 m (5 m + 1.5 m), and the user holding a ranged weapon.
- Vehicle toggle: if I am driving, exit. Otherwise find a car within 2.5 + 1.5 m. If there is none, send this player `No car close enough - walk up to one until it says [F] Get in`.

The option list must be a pure function of replicated state, so host and client build identical lists.

Source: EscHUD.cpp:393-436; EscPlayerComponent.cpp:247-350, 371-430; EscInteractable.cpp:605-624, 897-912; EscVehicle.cpp:312-337; EscVehicle.h:109, 238; EscPlayerComponent.h:236.

---

### H6. Burger job panel (right side)

- Shown only while ordersLeft > 0.
- `Panel(viewW − 24·S, viewH·0.30, rows, alignX 1)`. Rows:
  1. `McShekel's - order: <foods(order)>` in Gold, scale 1.1.
  2. `Tray: <foods(tray)>` in white, scale 1.0.
  3. `Orders left <n>  Time <Clock(jobEnd − hostNow)>` in Grey, scale 0.9.

Source: EscHUD.cpp:438-450.

---

### H7. Message feed (left)

- Each client keeps a local list of `{text, localRealTime}`. At most 12 are stored; the oldest are dropped.
- Draw only the last 6 messages. Skip any older than 8 s.
- Alpha is 1 for 6 s, then fades linearly to 0 at 8 s: alpha = 1 − (age − 6)/2.
- Layout:
  - Start y = viewH·0.30.
  - Each line has a box at x = 24·S, size (textW + 20·S, textH + 8·S), colour rgba(0,0,0,0.45·alpha).
  - Text at (34·S, y + 4·S), white with that alpha, scale 1.0.
  - Then y += textH + 12·S.
- Sources:
  - **Broadcast:** host → all players, reliable.
  - **Client message:** host → one player, reliable.
  - Fading uses the receiver's own clock.
- System and multiplayer lines (exact; spot-specific receipts are listed in the spots section):
  - `Wanted level <n>`
  - `They lost your trail: wanted level <n>`
  - `The heat is off`
  - `<Name> is down: back at the safehouse in 10 s`
  - `Everyone is down! Lost <₪x>, the heat is off`
  - `A civilian was killed. That never pays.`
  - `A soldier saw you kill a civilian!`
  - `Hold the pier: <n> s` / `Hold the border: <n> s` / `Boarding: <n> s` (one at each 10 s boundary)
  - `Boarding cancelled: you're wanted! Tickets refunded (<₪x>). Lose the stars and try again`
  - `ESCAPED <by boat from Jaffa|by boat from Haifa|on a plane from Ben Gurion|over the southern border> with <₪x>: <Broke|Comfortable|Kingpin>`
  - `Helicopter overhead! Stay out of the spotlight.`
  - `A TANK is rolling in. Run.`
  - `Roadblock ahead on <Highway name>!`
  - `A bag was dropped!`
  - `Welcome back - progress loaded (<₪x>)`
  - `No car close enough - walk up to one until it says [F] Get in`

Source: EscHUD.cpp:452-471; EscPlayerComponent.cpp:437-452; EscDirector.cpp:382, 458-470, 832, 850, 873, 886, 1139, 1158, 1194.

---

### H8. World markers

**Which markers.** The camera is the local view point.

1. **DROP-OFF** (Parcel colour) at the player's delivery location while carrying a package. Shown at any distance, with priority.
2. Every spot entity whose mode has a tag (crates are never marked):

   | mode | tag | colour |
   |---|---|---|
   | shop | `SHOP` | Gold |
   | casino | `CASINO` | Gold |
   | job | `McSHEKEL'S` | Gold |
   | bank | `BANK` | Gold |
   | forger | `FORGER` | Gold |
   | boat | `BOAT` | Boat |
   | airport | `AIRPORT` | Boat |
   | crossing | `BORDER` | Boat |
   | bag | `CASH` | BagGreen |
   | delivery | `DELIVERY` | Parcel |

   - **The ways out (boat, airport, crossing) show at any distance and have priority.** Everything else shows only within 1.5 km (2D, camera to spot).
   - Skip a spot within 1 m (2D) of the drop-off while carrying a package, because DROP-OFF replaces it.
   - Dim (alpha 0.4) when the spot is unavailable (closed or looted), or when stars > 0 and the mode is casino, job or airport.
3. `SAFEHOUSE` (Friend colour) for each city's safehouse spot (static world data) within 1.5 km. No priority.
4. Teammates have no world marker. They appear only on the map.

**Projection:**

- The anchor point is the spot plus 3 m up.
- Skip it if it is behind the camera: dot(anchor − camera, forward) ≤ 0.
- Clamp the screen position to [48·S, viewW − 48·S] × [48·S, viewH − 48·S].
- The distance label is `Distance(3D distance camera→anchor)`.

**Label box:**

- tag: scale 0.75. dist: scale 0.7.
- halfW = max(tagW, distW, 18·S)/2.
- rect = (x − halfW, y − 12·S − tagH) to (x + halfW, y + 10·S + distH).

**Declutter (no explicit maximum count):**

1. Sort the markers: priority ones first, then nearest first.
2. For each marker, find the first already-placed rect that intersects it. Touching counts as intersecting.
3. If there is a hit, try shifting the rect by step = rectH + 2·S. Shift down, unless rect.maxY + 2·step > viewH, in which case shift up. Try ×1, then ×2. Each try is tested against all placed rects. Take the first free one.
4. If both tries are blocked, do not draw this marker. Instead increment the merge count of the **first** rect hit at its original position.
5. A merged tag shows as `"<TAG> +N"` (for example `SHOP +2`).

**Drawing:**

- All diamonds first: outer radius 9·S in rgba(0,0,0,0.6·colourAlpha), inner radius 6.5·S in the colour. A diamond is a square rotated 45°, with vertices at ±r on each axis.
- Then the text:
  - Tag centred at (x, rect.minY), in the marker colour, scale 0.75.
  - Distance centred at (x, y + 10·S), in rgba(1,1,1,0.85·colourAlpha), scale 0.7.

Source: EscHUD.cpp:138-161, 181-195, 473-595.

Web: gather candidates from the replicated spot table, which is always relevant (H15). Project with `vec.clone().project(camera)`, then convert NDC to pixels.

---

### H9. Full-screen map (M toggles, local only)

**Layout:**

- Full-screen background rgba(.02,.03,.05,.92) (#27303F @ .92).
- The world rect is the world.json `bounds` [xmin, ymin, xmax, ymax] = [−1500, −14500, 7500, 8500] inset-metres (x east, y north). If bounds are missing, use the union of the insets expanded by 500 m.
- North is up, with one scale on both axes:
  - topRoom = 70·S, bottomRoom = 160·S.
  - scale = min((viewW − 80·S)/worldWidthEast, (viewH − topRoom − bottomRoom)/worldHeightNorth), in px per metre.
  - mapW and mapH are the world size × scale.
  - left = (viewW − mapW)/2, top = topRoom + (viewH − topRoom − bottomRoom − mapH)/2.
  - toMap(east, north) = (left + (east − minEast)·scale, top + (maxNorth − north)·scale).

**Layers in order:**

1. **Sea:** the map rect filled rgba(.06,.19,.32) (#457999).
2. **Land:**
   - bands = clamp(round(mapH/(3·S)), 60, 400) horizontal bands from south to north.
   - For each band, query the land intervals on the row through the band's middle: the inset `land_rows` plus the filler land east of `west_coast`; see the world section.
   - Draw each interval, clamped to the world rect, as a quad covering the band, colour (.23,.22,.19) (#848179).
3. **Streets:** every road segment whose midpoint is inside a city inset. Width max(1, 0.8·S) px, colour (.52,.52,.5) (#BFBFBC).
4. **Buildings:** each footprint as an oriented rectangle (4 corners), colour (.84,.76,.6) (#ECE2CB).
5. **Highways:** road segments whose midpoint is outside every inset. That covers the world.json highways and the airport runway (900 m long). Width max(2, 3·S) px, colour (.95,.72,.3) (#F9DD95), drawn above the buildings.
6. **City names:**
   - For each inset, take the mean position of all its spots (including crates), plus 1.2 km north.
   - Draw `PlaceName(inset).toUpperCase()` (`TEL AVIV-JAFFA`, `HAIFA`, `JERUSALEM`, `EILAT`) centred horizontally, with the text's bottom at that point. White, scale 1.1.
7. **Spots** (the static world spot list, so availability is not shown here; crates are skipped; bags are not on the map):
   - Diamond radius 6.5·S for the ways out, the forger and the delivery spots ("tagged"), and 4·S for all others. Outline radius = radius + 2.5·S in Outline colour, fill in the spot colour (H8 table; safehouse = Friend).
   - Tagged spots draw their tag at (x + 12·S, vertically centred), scale 0.8, in the spot colour. The package's destination is tagged `DROP-OFF`.
   - Untagged dots: shops, casino, job, banks, safehouses.
8. **Players** (humans with a pawn; bots never):
   - Local player: an arrow pointing along the camera heading, with north = up. ahead = (sin yaw, −cos yaw) in screen space, where yaw is the compass bearing (0 = north, 90 = east; = 90° − the map yaw of spec 01 §1); across = (−ahead.y, ahead.x). Triangle tip = p + ahead·1.4L, base = p − ahead·0.8L ± across·L. Draw L = 11·S in Outline, then L = 8·S in Gold.
   - Other players: diamond 7·S Outline, then 5·S Friend.
   - Name label at (x + 12·S, y + 4·S), scale 0.7, Gold for the local player, Friend for others.
9. **Title** `ISRAEL (COMPRESSED)`: Gold, scale 2.0, centred at (viewW/2, top − 52·S).
10. **Legend,** Grey, scale 0.9, centred at (viewW/2, top + mapH + 10·S):
    `Ways out: BOAT (Jaffa, Haifa) - AIRPORT (passports, no stars) - BORDER (Eilat)    DELIVERY: courier jobs    M to close`
11. Then the wallet panel (H3).

Source: EscHUD.cpp:597-779; EscCity.cpp:1215-1216, 1270-1279, 1407-1408, 1461-1462, 1652.

Web: render layers 1–5 once to an offscreen canvas per viewport size and blit it each frame. Draw layers 6–11 live. Web addition: a small Grey line `© OpenStreetMap contributors` at the bottom-right of the map screen (ODbL attribution).

---

### H10. End card (phase = Escaped)

- Full-screen dim rgba(0,0,0,0.6).
- `Panel(viewW·0.5, viewH·0.30, rows, alignX 0.5)`. Rows:
  1. `ESCAPED`: Gold, scale 4.0.
  2. `You got out <describe> with <₪finalMoney>`: white, scale 1.5. Describe is `by boat from Haifa` if the escape spot is in the Haifa inset, otherwise `by boat from Jaffa`; `on a plane from Ben Gurion`; or `over the southern border`.
  3. Tier, scale 2.2:

     | final money | tier | colour |
     |---|---|---|
     | < 10,000 | `Broke` | Grey |
     | < 60,000 | `Comfortable` | Gold |
     | otherwise | `Kingpin` | Gold |

  4. `Thanks for playing Escape Israel`: Grey, scale 1.0.
- Log `PROBE {"event":"hud_end_card","money":N,"tier":"..."}` once.
- In Unreal the card stays until players quit. Web: after 5 s add a `Back to menu` button under the panel (choose).

Source: EscHUD.cpp:781-797; EscDirector.cpp:57-58, 426-438, 878-886.

---

### H11. Replacements for Lyra's HUD (health, ammo, crosshair, respawn)

The original game uses Lyra's own widgets for these. Their exact layout lives in binary assets, so the values below are partly chosen.

- **Health:** humans have 100 HP. A bought plate carrier (armour 0.5) scales max and current health by 1/(1 − armor/2), which gives 133.3. Civilians have 60 HP.
  - Show a bar at the bottom left, within the bottom 120·S px: 300·S × 18·S at (24·S, viewH − 24·S − 18·S). Fill colour is white (choose), turning Wanted red below 30% (choose). Show the text `<hp>` (choose).
- **Ammo:** at the bottom right, `<magazine> / <spare>` plus the weapon name (`Pistol`/`Shotgun`/`Rifle`), scale 1.2 (choose). Three slot boxes for keys 1–3 (choose). Magazine sizes come from the weapons section. Ammo refill adds 60 spare.
- **Crosshair:** a small white cross at the screen centre, only while holding a weapon on foot (choose). Hide it while driving and when the map is open.
- **Respawn:** while dead, centre text `Back at the safehouse in <ceil(s)> s` (choose). Respawn happens 10 s after death.
- Guardrail: no blood, gore or damage-splatter overlays. Hit feedback is a brief non-graphic white vignette (choose).

Source: LyraHealthSet.cpp:22-23; Docs/escape_design.md:40, 52, 62-64; EscPlayerComponent.cpp:698-715; EscHUD.cpp:611 (bottom 120 px kept free).

---

### H12. Credits and attribution

The Unreal build has no in-game credits screen; the attribution is in README_friends.md and the data files. The web build must show a Credits screen from the main menu with exactly:

- `Map data (c) OpenStreetMap contributors, ODbL 1.0. Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.`
- `This is a parody for a private group of friends; all businesses, units and people in it are fictional.`
- `Built with Three.js, Rapier and PeerJS.` This replaces the Unreal line "Built on Epic's Lyra Starter Game".
- The main menu footer also shows `Map data © OpenStreetMap contributors`.

Source: Data/gen/*/inset.json `attribution`; README_friends.md:58-59; Tools/geo/fetch.py:3-4.

---

### H13. Front-end flow

**Unreal build as shipped:**

- The game boots into Lyra's front-end map. The menu path is Play → Host → tile **Escape Israel** → Start.
  - Tile title `Escape Israel`, subtitle `Co-op · Tel Aviv-Jaffa`, description `Get rich, get armed, get out. 1-4 friends.`
  - MaxPlayerCount 4.
- Hosting loads the single world map as a listen server: `/Game/Maps/L_TelAviv?listen?Experience=B_EscapeExperience`. The whole country (4 insets plus highways) is one world, built on every machine from the same data.
- Joining: accept a Steam invite (Shift+Tab overlay → Invite to Game), or Play → Browse → pick the host's game.
- Spawning:
  - There are no player starts. Every human spawns in a safehouse, scattered randomly within 2.5 m, 1 m above the floor, facing a random direction.
  - The safehouse is the one nearest a living teammate. With nobody alive (the first spawn, or a team wipe), it is `Safehouse (The Postel)` in Tel Aviv.
  - Pawn roles: players are fugitives, AI are soldiers, civilian controllers are civilians.
- Esc opens the in-game menu: resume / options / quit to menu.

**Web flow (implement):**

1. **Boot screen:** download and parse the world data with a progress bar: `Loading Israel… <pct>%` (choose).
2. **Main menu:**
   - Title `Escape Israel`, subtitle `Co-op · Tel Aviv-Jaffa`, description `Get rich, get armed, get out. 1-4 friends.`
   - Name field: stored in localStorage `esc.name`, default `Player-<4 random digits>` (choose), at most 16 characters.
   - Buttons: **Host game**, **Join game** (code input), **Settings** (quality preset Low / Medium / High, spec 06 §11; stored in localStorage, choose), **Controls**, **Credits**.
   - Solo play is simply hosting with nobody joining.
3. **Host:**
   - Create a room code: 5 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (choose).
   - Open the PeerJS peer `escape-israel-<CODE>`, build the world, start the director (or load the host save), spawn the host at the Postel, then accept joins.
   - The room code and invite link `<origin>/?join=<CODE>` are shown:
     - for 10 s at the top centre: `Room <CODE> - invite friends: <link>` (choose)
     - permanently in the Esc menu with a Copy button.
4. **Join:**
   - Enter a code, or open an invite link. Show `Connecting…`, then load and build the world locally, then send `hello`.
   - On `welcome`, spawn and play.
   - Errors return to the menu with a message: `Room not found`, `Room full (4/4)`, `Version mismatch (host <v>, you <v>)`, `Host left the game` (choose wording).
5. **Esc menu:** Resume, Invite (code and copy link), Controls, Leave game. Opening it releases pointer lock. Nothing ever pauses.
6. **Controls** (README table):

   | key | action |
   |---|---|
   | WASD + mouse | move / look |
   | hold Shift | sprint ×1.6 (×0.7 while carrying a bag) |
   | LMB / RMB | shoot / aim |
   | R | reload |
   | 1–3 | weapon slots |
   | E | use / confirm / hold up / get in when nothing else is in focus |
   | Up / Down | menu line |
   | F | car in/out |
   | W/S | throttle / brake-reverse (in a car) |
   | A/D | steer (in a car) |
   | Space | handbrake (in a car) |
   | M | map |
   | Esc | menu |
   | ` | dev console |

Source: Tools/ue/make_game.py:177-194; README_friends.md:12-29, 61-68; EscGameMode.cpp:19-47; EscDirector.cpp:59, 483-505; Tools/package/Host.bat, Join.bat.

---

### H14. Persistence (host only)

- **Slot:** `EscapeIsrael`. Web: localStorage key `esc.save.v1` (spec 02 §7, which owns the save rules). The payload:
  - `version` 1
  - `savedAt` (ISO UTC)
  - `money`
  - per spot: `key`, `available`, `cooldownLeft` in seconds. The key is `<SpotMode>_<round(northMetres)>_<round(eastMetres)>`, for example `Crate_1234_-567`. Bags are never saved.
  - `passportHolders`: a list of player names.
- **Load:**
  - On the host, once the director and spots exist: set money, then restore each spot whose key matches. A closed spot reopens after its remaining cooldown.
  - Broadcast `Welcome back - progress loaded (<₪money>)`.
  - Every 1 s afterwards, any player whose name is in passportHolders gets their passport back. This includes late joiners and rejoiners. The holder list only grows.
- **Save** (only after the load ran, only while phase = Playing):
  - every 120 s;
  - at the safehouses, at most every 20 s, while any living human is within 8 m (2D) of a safehouse spot;
  - on world end (web: `pagehide`/`beforeunload` on the host, or Leave game; spec 02 §7).
  - The finale is never saved, so a crash keeps the fare.
- **Escaped:** delete the save once and stop saving.
- **Not saved:** weapons, armour, bags, heat, the burger shift, packages.
- Clients never save (there is no host migration).
- Test runs (`?script=`) neither load nor save unless `&save=1`. `&nosave` disables saving entirely.
- Probes: `save_loaded`, `save_written` (reason `autosave|safehouse|world_end|cheat`), `passport_restored`, `save_cleared`.

Source: EscSaveGame.h:1-64; EscSaveGame.cpp:26-31, 62-249; EscInteractable.cpp:634-649.

---

### H15. Multiplayer model to rebuild (as built in Unreal)

**Topology:**

- A host-authoritative listen server: the host is a player and runs all game rules, AI, traffic and physics. 1 host plus up to 3 clients (4 maximum). Unreal used Steam P2P (SteamSockets) with a plain-IP fallback over UDP 7777 (`-nosteam`).
- Clients send inputs and requests. The host validates them.
- The world geometry is not replicated. Every machine builds the identical city from the same data files.

**Replicated state:**

| object | who receives | fields / messages |
|---|---|---|
| Director (game state) | all | `money`, `heat` (0..500, stars = ceil(heat/100) clamped 0..5), `searchAlpha`, `phase` (Playing/Finale/Escaped), `finaleLeft` (s), `escapeSpot`, `finaleKind` (Escape/Airport/Crossing), `finalMoney`, `passportsMissing`. Messages: reliable broadcast. |
| Per-player state | **owner only** | `bagValue`, `armor`, `passport`, `jobOrder[]`, `jobTray[]`, `jobOrdersLeft`, `jobEndTime`, `jobCooldownEnd`, `deliveryLabel`, `deliveryLocation`, `deliveryReward`, `deliveryDeadline` (host time, 0 = none). Messages: reliable private message. Other players only learn the team passport count, through the director. |
| Player pawns | all, always relevant | transform, velocity, animation state (walk/sprint/aim/dead), health/max health, held weapon, seated-in-car id, name |
| Soldiers / civilians | within 300 m of the viewer | transform, animation state, health, model/part id, civilian walk/run flag; civilians at 20 Hz |
| Spots, including dropped cash bags | all, always relevant, ~2 Hz / on change | `mode`, `label`, `available`, `value`, `timerEnd` (host time), `boatOut` |
| Vehicles | all, always relevant | transform, linear/angular velocity, wheel/steer visuals, `driver` (player id or none), `model`, `npcDriver` (0 = none, 1..255 picks the civilian look). Traffic at 30 Hz; player-driven cars at the full rate. |
| Roadblocks | all, always relevant, 1 Hz | spawn transform only; each machine builds the barriers and jeeps from it |
| Helicopter / tank | all, always relevant | movement; heli `spotTarget`, `leaving`; tank `turretYaw`; tank shells |
| Ragdoll launch | all | event (velocity change); each machine simulates its ragdoll locally (cosmetic, unsynced) |

**Client → host requests:**

- `use(targetId, actionId)`: reliable.
- `toggleVehicle()`: reliable.
- `setSprint(on)`: reliable, sent only on change. The host accepts the client's position for 0.5 s after a sprint change so the speed switch never snaps the player back.
- `carInput(throttle −1..1, steer −1..1, handbrake)`: unreliable, every frame from the driver's machine. Negative throttle means brake, then reverse once slow. The host ignores it if the car has no driver.
- Weapon fire/aim/reload/slot: see the weapons section.

**Relevancy:**

- Human pawns are marked always relevant when they spawn: map dots and price counts need every living human on every machine.
- Spots, vehicles, roadblocks, heli and tank are always relevant.
- Other characters are culled beyond 300 m.
- Bandwidth cap was 200,000 B/s per client. Civilians are throttled to 20 Hz because 60 walkers at the default rate would fill about 100 KB/s.

**Join in progress:**

- Allowed at any time up to 4 players.
- The joiner receives the full current state, spawns at the safehouse nearest a living teammate, and gets the shared wallet as it is.
- A saved passport comes back within 1 s if the name matches.
- If the phase is Escaped, the joiner sees the end card.

**Disconnect:**

- The leaver's pawn is removed without a death: no heat, no respawn, no team-wipe check.
- A carried bag drops on the ground (z = 0) at the pawn's last living position, with the broadcast `A bag was dropped!`.
- A car they were driving is exited and left stopped with the handbrake on.
- Their package and burger shift vanish.
- Prices (per living player) recompute immediately.
- Host leaving ends the session for everyone (no host migration). The host save is written on world end.

**Deaths:**

- A human death broadcasts the down message and respawns the player after 10 s.
- If no other human is alive (and the phase is not Escaped), it is a team wipe: the wallet loses floor(money/4), heat goes to 0, with its broadcast.

Source: EscDirector.cpp:244-256, 458-470, 1137-1195; EscPlayerComponent.cpp:119-134, 141-157, 432-435, 512-558, 591-602; EscPlayerComponent.h:31-78, 140-149; EscInteractable.cpp:292-296, 1267-1276; EscVehicle.cpp:47, 183-185, 306, 433-451, 494-500, 732-744; EscVehicle.h:159-160; EscRoadblock.cpp:51-53; EscHunters.cpp:94-96, 191-205, 358-369; EscPawnComponent.cpp:177-180; LyraCharacter.cpp:37; EscCity.cpp:316; Config/DefaultEngine.ini:66-73, 436-489; Config/DefaultGame.ini:43-47; Docs/escape_design.md:229-236.

---

### H16. Web netcode design (recommended)

**Transport:**

- PeerJS (WebRTC DataChannels). The host peer id is `escape-israel-<CODE>`.
- Each client opens two channels to the host:
  - `rel`: `{reliable:true}`, ordered. Used for events, spawns/despawns, state changes, private state, messages and requests.
  - `snap`: `{reliable:false, ordered:false, maxRetransmits:0}`. Used for snapshots and inputs.
- Signalling defaults to the PeerJS cloud with Google STUN. Allow overrides through `?peerhost=&peerport=&peerpath=&turn=` (the self-hosted equivalent of the IP fallback). Tests use a local `peerjs --port 9000`.
- Messages are compact binary (DataView) or msgpack (choose). Every message carries a protocol `v`; on a mismatch, send `kick{reason:"version"}`.

**Host loop:**

- Fixed-step simulation at 60 Hz (character and vehicle physics in Rapier).
- Game-rule ticks keep their original periods:
  - director 0.25 s
  - hunters/roadblocks 2 s
  - save 1 s (0.5 s until loaded)
  - script runner 0.25 s
- **Snapshots at 20 Hz** per client:
  - Header: host time, the last input seq processed for that client, the director fields (plus `livingHumans`, so clients never have to count).
  - Entity records: id, type, position (float32 m), yaw (uint16), velocity, anim flags, health.
  - Interest set: all humans, all vehicles, heli, tank, plus soldiers and civilians within 300 m of that client's pawn (or camera when dead).
  - Budget ≤ 100 KB/s per client.
- Entity lifecycle uses reliable `spawn{id,type,model,part,transform}` and `despawn{id}`.
- Spots and roadblocks are sent reliably only on change. A joiner receives them all in `welcome`.

**Clock:**

- Clients estimate `hostNow = localNow + offset` from ping/pong every 2 s. Keep the sample with the smallest RTT: offset = hostT − (t0 + rtt/2).
- All HUD timers (delivery deadline, job end, bank timer, finale) use hostNow.

**Remote entities:**

- Render 100 ms in the past with snapshot interpolation: lerp position, shortest-arc lerp for yaw.
- If snapshots stop, extrapolate along velocity for up to 250 ms, then hold.
- Snap instead of smoothing when the error is over 5 m (choose).

**Own character (client-side prediction):**

- Each 60 Hz step, send `input{seq, dt, moveX, moveY, yaw, pitch, sprint, jump, fire, aim}` over `snap`, including the last 3 inputs for redundancy. Simulate locally with the same movement code and speeds as the host (walk speed × 0.7 if bag > 0, × 1.6 while sprinting, with the bag value from private state).
- On each snapshot, compare the predicted position at the acked seq with the authoritative one:
  - over 0.5 m (choose): rewind to the host position and replay the unacked inputs;
  - smaller: blend the error away over 100 ms.
- Because sprint is part of every input, no sprint grace window is needed.

**Vehicles:**

- While seated, the driver's client sends `carInput` every frame over `snap`. The host simulates the car and sends it in snapshots at the full 20 Hz.
- The driver's own car is rendered with 50 ms interpolation delay plus velocity extrapolation (choose). Other cars use the normal 100 ms delay.
- Enter/exit, carjacking and run-overs are host-only and replicated through the car's `driver`/`npcDriver` fields.

**Requests and validation:**

- Implement exactly as in H5: `use(targetId, actionId)` (actionId, never the menu index), `toggleVehicle`, weapon requests and `cheat{cmd}`.
- The host checks liveness, ranges with 1.5 m slack, and that the action is in the host-built option list.

**Session rules:**

- **Join:**
  1. The client builds the world, then sends `hello{name, v}`.
  2. The host checks capacity (if 4 humans are already present, kick with `room_full`), version, and a unique name (append ` 2`, ` 3`).
  3. The host replies `welcome{playerId, hostTime, director, players[], spots[], vehicles[], roadblocks[], hunters[], entities[]}` and spawns the pawn per H13.
- **Heartbeat:** every 1 s each way. Treat 10 s of silence, or a DataConnection `close`, as a disconnect (choose). Apply H15's disconnect rules.
- **Host gone:** clients show `Host left the game` and return to the menu.

---

### H17. Dev console and cheats

- **Console:** backquote (`` ` ``) toggles a text-input overlay with a scrolling log. Commands are case-insensitive. Arguments are space-separated, except `EscKey`, which takes the rest of the line.
- **Where commands run:** commands marked "host" run on the host for the issuing player. On a client they are forwarded automatically via `cheat{cmd}`, and a leading `Cheat ` prefix is accepted and stripped, as in Unreal. The others run locally.
- Every command logs a PROBE line.
- The console is enabled in all builds, because the friends build was Development configuration with cheats on (choose).

| command | runs | behaviour | PROBE |
|---|---|---|---|
| `EscMoney <int>` | host | wallet += amount (clamped ≥ 0) | `cheat_money{amount,money}` |
| `EscHeat <float>` | host | sets heat. Raising it counts as heat gain (it broadcasts `Wanted level n` when stars rise and resets the search); lowering it is like laying low. | `cheat_heat{heat,stars}` |
| `EscTp <arg>` | host | See the target list below. Lands 3 m (2 m for indoor spots) from the spot toward the nearest safehouse; for indoor venues, in front of the set piece, along its facing. 1 m up, facing the spot; camera yaw set too. | `tp{mode,name,x,y,ok}` |
| `EscGive pistol\|shotgun\|rifle` | host | adds and equips the weapon, or refills ammo if already owned | `cheat_give{weapon,ok}` |
| `EscReport` | local | logs the two report lines below | `report` + `report2` (+`nav_report`) |
| `EscHost` | local | from a solo game, open the room (web: just open the PeerJS peer and print the code) | `cheat_host{room}` |
| `EscSave` | host | write the host save now, reason `cheat` | `save_written` |
| `EscMap` | local | toggle the map | — |
| `EscCar [""\|walk\|traffic]` | host | See the variants below. | `cheat_car{mode,car,in}` |
| `EscKey <Key> [holdSec]` | local | Synthesises a press through the real input path and releases it after hold (default 0.15 s). Key names: `E F M W A S D LeftShift Up Down SpaceBar`; web maps them to `KeyE, KeyF, …, ShiftLeft, ArrowUp, ArrowDown, Space`. | `cheat_key{key,hold,handled}`, `cheat_key_up{key}` |
| `EscTraffic [""\|stop\|go\|spawn]` | host | freeze/release all traffic, or spawn one car on the road vertex nearest a point 40 m ahead; then log the state | `traffic_state{cars,target,frozen,roads,verts,links,list}` |
| `EscDrive <throttle> <steer>` | local | while driving, holds these inputs (−1..1) instead of the keys until changed | `cheat_drive{car,speed_kmh,x,y,z,car_yaw,vel_yaw,roll}` |
| `EscUse <index>` | host | runs option **index** of the focused spot (or the nearest spot, 2D) as this player. Info lines and out-of-range indices are ignored. | `cheat_use{target,index,dist}` |
| `God`, `DamageSelf <n>`, `HealSelf <n>`, `DamageSelfDestruct`, `UnlimitedHealth [0\|1]` | host | invulnerability, damage, heal, kill self, infinite health | — |

`EscTp` targets:

- `<mode>`: the first spot of that mode in world.json order. Modes: safehouse, shop, casino, job, bank, escape, airport, crossing, forger, delivery.
- `crate`: the first outdoor crate.
- `stash`: the first crate inside a building.
- `city:<inset>`: that inset's safehouse.
- `<mode>:<inset>`: that mode in that inset.
- `dropoff`: the delivery spot within 30 m of my package's destination.

`EscCar` variants:

- `""`: teleport 1.5 m outside the driver's (left) door of the nearest free parked car, facing it, and get in.
- `walk`: the same, but stay outside.
- `traffic`: freeze all traffic, then stand at the door of the nearest traffic car.

`EscReport` lines:

- `report{money, heat, stars, phase, finale ("none" while Playing), humans, soldiers, civilians, bag, armor, passport, passports_missing}`
- `report2{roadblocks, delivery_to, delivery_reward, delivery_left, driving, near_car, sprint, max_walk, traffic_cars}`
- `nav_report{bots_moving (non-humans moving faster than 0.5 m/s), nearest_soldier_m, health}`

Source: EscCheats.h:1-76; EscCheats.cpp:46-393; LyraCheatManager.h:72-94; memory notes (God/DamageSelfDestruct used in tests).

---

### H18. Scripted tests, PROBE log and harnesses

**PROBE log:**

- Every machine-checkable event is one line: `PROBE {json}`. Web: `console.log('PROBE ' + JSON.stringify(o))`, and also push to `window.__probes`.
- Tests grep these lines. Events this section must emit: `hud_ready`, `hud_end_card`, `script_step`, `script_done`, all the cheat probes above, and the save probes.
- Web addition: `world_ready{host:bool}` once the world is built and the local pawn has spawned. It replaces the Unreal log line `OnExperienceLoadComplete` that the harnesses wait for.

**Script runner** (Unreal `-EscScript="..."`, web `?script=<urlencoded>`):

- Split on `;`, drop empty steps, trim each step.
- Every 0.25 s:
  - If the local player has no pawn yet, set resume = now + 3 s and return.
  - Otherwise, while now ≥ resume and steps remain, pop a step:
    - `wait N`: set resume = now + N (float seconds, game time).
    - Anything else: log `script_step{cmd}` and run it as a console command. Several steps can run in the same tick.
    - A step starting with `shot` also sets resume = now + 0.5 s.
- When no steps remain and now ≥ resume, log `script_done` once.
- `shot` takes a screenshot without the HUD; `shot showui` includes the HUD.
  - Web: the game hides the HUD canvas for `shot` and logs `PROBE {"event":"shot","n":k,"ui":bool}`.
  - The harness, on that console event, calls `page.screenshot()`.
  - Keep the 0.5 s settle.
- Example: `EscTp casino;wait 3;shot showui`.

**Other URL parameters** (Unreal command-line equivalents):

| web | Unreal | meaning |
|---|---|---|
| `host=1&room=CODE` | — | host with a fixed code |
| `join=CODE` | — | join a room |
| `name=` | — | player name |
| `nosave` | `-EscNoSave` | disable the host save |
| `save=1` | `-EscSave` | let a scripted run load and save |
| `mute` | `-nosound` | no audio |
| `seed=<int>` | — | deterministic RNG for tests (choose) |
| `showcase` | `-EscShowcase` | lines up every character and vehicle model next to the player, with an 8 s overview camera |
| `peerhost=…` | — | local PeerJS server |

**Screenshot harness** (mirrors Tools/ue/game_shot.ps1), `tools/shot.mjs` with Playwright:

- Arguments: `--script "<steps>" --out shots/x.png`, viewport 1280×720, timeout 1800 s.
- Steps:
  1. Open `/?script=…&nosave&mute`.
  2. Wait for `world_ready`.
  3. Collect a screenshot per `shot` probe as `<out>_<n>.png`.
  4. Wait for `script_done` plus 2 s.
- Print `GAME_SHOT OK shots=<n> base=<path> load_s=<s> log_errors=<console error count>`. Fail if the page errors out or the script does not finish in time.

**Two-player net test** (mirrors Tools/ue/net_test.ps1), `tools/net_test.mjs`:

1. Start a local PeerJS server on port 9000.
2. Open the host page, viewport 960×540: `/?host=1&room=NETT&peerhost=localhost&peerport=9000&nosave&mute&script=wait 10;EscMoney 3000;wait 30`.
3. After the host's `world_ready`, open the client page in a second browser context: `/?join=NETT&…&script=wait 8;shot showui;wait 1;EscReport;wait 6;EscReport;shot showui;wait 1`.
4. Stop when the client logs `script_done`. Timeout 900 s.
5. Save the client's shots as `net_client_<n>.png`.
6. Web-addition assertion: the client's last `report.money` is 3500 (start ₪500 + 3000 from the host), which proves the shared wallet replicates.
7. Print `NET_TEST OK|INCOMPLETE shots=<n> host_log=… client_log=…`.

Source: EscCity.h:100-112; EscCity.cpp:474-480, 712-744; EscSaveGame.cpp:65-71; Tools/ue/game_shot.ps1; Tools/ue/net_test.ps1; EscShowcaseComponent.h:1-2; Config/DefaultGame.ini:266-267.

---

### Addendum: PROBE catalogue (every event the Unreal code logs)

PROMPT §4 asks every system to log PROBE events "with the same names as the spec", but H18 only names a few. Here is the
full list from `Source/LyraGame/Escape`.
- Emit them on the machine noted (H = host, L = local client, A = any).
- Unreal logged `x`/`y`/`z` in world cm (X north, Y east). **The web logs metres in web world inset-metres (x east, y north).**
  Fields ending `_m` or `_kmh` already are metres or km/h.
- Booleans are JSON `true`/`false`. Unreal sometimes wrote 0/1; the web always uses booleans.
- Extra fields are fine; missing ones are not.

| Event | Where | Fields | When |
|---|---|---|---|
| `city_built` | A | `insets{<name>:{buildings, road_segments, land_boxes, parks, walk_points}}`, `buildings`, `shells`, `shell_overlaps_dropped`, `building_overlaps`, `interior_instances`, `road_boxes`, `highways`, `ground_boxes`, `trees`, `rocks`, `shell_skin`, `port_yards`, `cranes`, `hills`, `scatter`, `drive_roads`, `walk_points`, `textured`, `dressing_instances`, `dressing{layer:n}`, `ms` | world generated (01) |
| `world_ready` | A | `host` | web addition (H18) |
| `director_ready` | H | `money` | director started (before the save load) |
| `hud_ready`, `hud_end_card` | L | H2, H10 | |
| `money` | H | `reason`, `delta`, `money` | every `addMoney` |
| `money_set` | H | `money` | save load / cheat |
| `spend` | H | `amount`, `money` | successful `trySpend` |
| `heat` | H | `reason`, `amount`, `heat`, `stars` | every `addHeat` |
| `heat_lower` | H | `amount`, `heat`, `stars` | lay low / cheat lowering |
| `heat_decay` | H | `heat`, `stars` | a 15 s decay step |
| `spawn` | H | human: `role:"human"`, `safehouse`, `x`, `y`. Ring spawns: `role` (`soldier`/`civilian`), `dist_m`, `hidden`. Fixed-point spawns: `role`, `at` (`point`/`roadblock`), `x`, `y` | each pawn spawn |
| `soldier_despawn` | H | `soldiers`, `target`, `dist_m` | farthest-soldier cull |
| `civilian_spawn_at` | H | `ok`, `flee`, `x`, `y`, `civilians` | carjacked driver |
| `civilian_spawn_far` | H | `dist_m` | spawned > 150 m from everyone, deleted |
| `civilian_panic` | H | `civilian`, `seconds` | panic starts or extends |
| `civilian_robbed` | H | `civilian`, `robber` | hold-up accepted |
| `holdup` | H | `amount`, `seen`, `heat` | hold-up paid |
| `population` | A | `authority`, `civilians`, `walking`, `running`, `standing`, `followers`, `soldiers`, `bots`, `unarmed`, `unarmed_linked`, `avg_frame_ms`, `max_frame_ms` | every 30 s |
| `kill` | H | `victim` (`human`/`civilian`/`soldier`/`bot`), `by_human` | every death |
| `ragdoll` | H | `victim`, `killer`, `weapon`, `armor`, `magnitude` | weapon-death knockback computed |
| `knockback` | A | `pawn`, `speed`, `tries`, `forced` | launch applied to a ragdoll |
| `pawn_setup` | H | `pawn`, `role` (`human`/`soldier`/`civilian`), `armor`, `max_health` | new body set up |
| `character_part` | H | `role` (0 human, 1 civilian, 2 soldier), `part`, `armor` | look assigned |
| `respawn` | H | `controller` | human respawned |
| `team_wipe` | H | `lost`, `money` | |
| `finale_start` | H | `kind` (`Escape`/`Airport`/`Crossing`), `seconds`, `x`, `y` | |
| `finale_cancel` | H | `kind:"Airport"`, `refund` | |
| `run_end` | H | `kind`, `escaped` (living humans in the radius), `humans`, `money`, `tier` | phase → Escaped |
| `escape_paid` | H | `kind`, `cost` | fare paid |
| `crate_open` | H | `label`, `pistol`, `money` (amount found) | |
| `buy` | H | `item` (`pistol`/`shotgun`/`rifle`/`ammo`/`armor`/`laylow`/`passport`), `price` | |
| `give_weapon` | H | `item`, `slot`, `refill` | weapon granted or refilled |
| `weapons_kept` | H | `count`, `slot` | weapons returned after respawn |
| `fence` | H | `value` | |
| `casino` | H | `game` (`slots`/`highroller`/`roulette`), `bet`, `win` | |
| `job_order` | H | start: `action:"start"`, `orders`; serve: `action:"serve"`, `correct`, `left`, `earned` | |
| `job_timeout` | H | — | shift ran out |
| `heist_start` | H | `label` | |
| `heist_done` | H | `label`, `ok`, `value` | |
| `bag_pickup` | H | `value` | |
| `bag_drop` | H | `value`, `x`, `y` | death / disconnect |
| `delivery_start` | H | `from`, `to`, `reward`, `seconds`, `dist_m` | |
| `delivery_done` | H | `to`, `reward`, `secs_left` | |
| `delivery_failed` | H | `reason` (`timeout`/`death`), `to`, `reward` | |
| `sprint` | A | `on`, `max_walk` (m/s on web), `peak`, `authority`, `local` | sprint state change |
| `vehicle_key` | L | `key` (`E`/`F`), `near`, `driving` | toggle requested |
| `vehicle_toggle` | H | `result:"none"`, `car` | no car in reach |
| `vehicle_enter` | H | `car`, `model`, `driver` | |
| `vehicle_exit` | H | `car`, `driver`, `alive` | |
| `carjack` | H | `car`, `driver`, `civilian`, `x`, `y` | |
| `run_over` | H | `victim`, `civilian`, `speed`, `heat` | |
| `vehicles_parked` | H | `count`, `wanted`, `candidates`, `models` | each parking batch |
| `traffic_graph` | H | `roads`, `verts`, `links`, `snapped_ends`, `ms` | road graph built |
| `traffic_spawn` | H | `car`, `x`, `y`, `dist_m`, `hidden`, `highway`, `cars` | |
| `traffic_despawn` | H | `car`, `reason` (`far`/`stuck`), `dist_m`, `stucks`, `cars` | |
| `traffic_stuck` | H | `car`, `stucks`, `blocked`, `wall`, `touch`, `kmh`, `want_kmh`, `target_deg`, `off_m`, `plan_m`, `x`, `y` | stuck trigger |
| `traffic_count` | H | `cars`, `target`, `moving` (> 3 m/s), `doomed`, `humans`, `frozen` | every 30 s |
| `traffic_frozen` | H | `frozen`, `cars` | `EscTraffic stop/go` |
| `traffic_state` | H | H17 | `EscTraffic` |
| `cheat_traffic_spawn` | H | `car` | `EscTraffic spawn` |
| `hunter_heli` | A | `authority` | helicopter spawned (each machine) |
| `hunter_tank` | A | `authority` | tank spawned |
| `tank_fire` | H | `dist_m` | shell fired |
| `tank_shell` | H | `killed` | shell exploded |
| `roadblock_spawn` | H | `highway`, `x`, `y`, `dist_m`, `hidden`, `driving`, `guards`, `roadblocks` | |
| `roadblock_built` | A | `authority`, `barriers`, `jeeps`, `x`, `y` | geometry built on a machine |
| `roadblock_remove` | H | `reason` (`stars`/`far`), `x`, `y`, `roadblocks` | |
| `save_*`, `passport_restored`, `script_*`, `shot`, cheats, `report`/`report2`/`nav_report` | | H14, H17, H18 | |
| `showcase_ready`, `showcase_spawn` | H | `free_m` (web; Unreal `free_cm`) / `mesh` | showcase mode |

`part_pelvis` (the retarget pelvis check) is Unreal-only: drop it.

---

### Addendum: Weapon netcode (H15 says "see the weapons section"; 04 §5 has no messages)

**Unreal model.** Lyra traces shots **on the shooter's own machine** and sends the hit results ("target data") to the
server. The server accepts them unchecked (`bIsTargetDataValid = true`, `LyraGameplayAbility_RangedWeapon.cpp:494`),
then applies damage, ammo and cues. So what a player sees is what they hit. Keep that model, with light host checks.

**Client → host** (`rel` unless noted):
- `equip{slot}`: the host checks the slot is non-empty, the pawn is alive and on foot.
- `reload{}`: the host runs the reload timer (04 §5.1) and sends the new mag/spare when it ends.
- `shot{seq, weapon, origin, dirs[], hits[{id, point, head, d}]}`, one per trigger pull/round, built like this:
  - **Spread rays.** The shooter's client builds the spread rays from its local spread state. The ray RNG is seeded
    from `hash(playerId, seq)`, so the host can rebuild the same rays.
  - **Hit test** against its own view of the world: interpolated remote entities plus static geometry and car bodies.
  - **Instant feedback.** It plays the muzzle flash, tracer and sound at once.
  - **Shotgun:** one message holds all 10 pellets.
- The `fire`/`aim` flags in the `input` message only drive animation and spread, never damage.

**Host checks** (drop the hit, not the shot, on failure):
- **The shot itself:**
  - The shooter is alive, on foot and holds `weapon`.
  - Mag > 0. The host decrements the mag; it is authoritative.
  - At least 0.9 × the fire interval since the last accepted shot.
  - `origin` is within 3 m of the shooter's host-side eye.
- **Each hit:**
  - The target exists, is alive and is on another team.
  - `point` is within 2.5 m + targetSpeed × 0.25 s of the target's current host position. That is the slack for the
    shooter's 100 ms interpolation plus latency; there is no lag-compensation rewind (choose).
  - `d` ≤ the weapon's max range.
- **Damage:** the host computes falloff from |point − origin| and applies the headshot multiplier.

**Host side effects of an accepted shot:**
- Mark "fired since the last director tick" (shot heat, 03 §1.1).
- Panic civilians within 40 m (03 §7.3).
- Send `shotFx{shooterId, weapon, origin, ends[]}` **unreliable** to every other client within 300 m, for tracers,
  muzzle flash, sound and impact puffs.
- Send `hitConfirm{seq, hits, kills}` to the shooter (hit marker, damage numbers).
- Send `hurt{amount, fromYaw}` privately to a damaged human (hit vignette).

**Soldiers and the tank.** The host traces their shots itself against current positions, applies damage, and sends the
same `shotFx` (tank: `shell` spawn plus a `blast{pos}` event, 03 §5).

**Ammo state.** `weapons[{type, mag, spare}]` and `activeSlot` are per-player private state (owner only), sent on change.
The owner predicts the decrement and the reload timer, and takes the host's values when they arrive. Other players only
see the held weapon type in the pawn snapshot (H15).

---

### Addendum: HUD extras (nameplates, damage numbers) and what is NOT in the game

What the Unreal build showed beyond EscHUD came from Lyra's ShooterCore action sets used by the Escape experience
(`Tools/ue/make_game.py:43-44`: SharedInput, StandardComponents, StandardHUD, **not** the Accolades set):
- **Nameplates** (`/Game/UI/Indicators/NameplateSource` on every hero pawn, `NameplateManagerComponent` on every
  player controller). The widget `W_Nameplate` shows the pawn's player name and a normalised health bar. The bar is blue
  when the pawn is on the viewer's team and red otherwise. Bots are named `Soldier` / `Civilian` (03 §2, §7.1). The
  distance, occlusion and clamping rules live in Blueprints and are unknown.
  - **Web (choose):** nameplates for **teammates only**, drawn after the world markers (H8):
    - name at scale 0.75 in Friend colour, centred 2.2 m above the teammate's feet
    - a 60·S × 5·S health bar under it: white fill, Wanted red below 30 %, on rgba(0,0,0,.55)
    - shown at any distance up to 1.5 km, not occluded by walls, hidden behind the camera
    - hidden while the map is open, and on dead teammates
  - Soldiers and civilians get none: 60 `Civilian` labels would bury the street.
- **Damage numbers** (`B_NiagaraNumberPopComponent` on the controller): Lyra pops the damage the local player dealt at
  the hit point. **Web (choose, on):** the rounded damage as white text at scale 0.8, rising 0.8 m and fading over 0.7 s.
  Gold for a headshot. Driven by `hitConfirm`.
- Lyra's quick bar (`W_QuickBar`, 3 slots), weapon reticle (`W_WeaponReticleHost`), ammo and health widgets are covered
  by H11 (all choose).
- **Not in the game. Do not add them** (PROMPT §1: no unasked features):
  - The kill/elimination feed and accolade toasts. Their relays are in the Accolades action set, which the Escape
    experience leaves out.
  - The Tab scoreboard (needs Lyra's elimination ability set).
  - Minimap, compass, speedometer.
  - Text chat and voice chat. Lyra's voice chat needs EOS; the Steam build had none. Friends use their own voice app, and
    the web README says so.
- **Web additions allowed** (choose; they replace Steam's own notices): broadcast `<Name> joined` when a `hello` is
  accepted, and `<Name> left` on disconnect.

---

### Addendum: Front-end details (settings, continue, pointer lock, background host, errors, showcase)

**Settings screen** (the main-menu button PROMPT §5.8 names, also reachable from the Esc menu; all choose):
- Stored as JSON in localStorage `esc.settings`; read and write in try/catch. Applied live.
- Quality: Low / Medium / High (06 §11). Default **auto**: Low if the WebGL renderer string contains `SwiftShader` or
  `llvmpipe`, or `navigator.hardwareConcurrency` ≤ 4; else Medium.
- Mouse sensitivity 0.02–0.30 °/px, default 0.10. Invert Y: off.
- FOV (on foot) 70–100°, default 80. ADS and car FOV keep their own values.
- Master volume 0–100, default 80. `?mute` forces 0 without saving.
- Show FPS: off.

**Host with a save.** If `esc.save.v1` exists, **Host game** asks first:
- `Continue (<₪money>, saved <local date and time>)`: load the save as H14 describes.
- `New run`: confirm with `Start over? Your saved run will be deleted.`, then delete the save and start with ₪500.

Unreal had no such prompt: it always loaded the save. Scripted runs follow H14 (`?script` ignores the save).

**How to play** (main-menu button next to Controls; text adapted from README_friends.md):
> You start broke and unarmed in the Tel Aviv safehouse: grab the pistol from the Stash next to you. Make money from
> crates, holding up civilians (gun out, E), shifts at McShekel's, the Club Gagarin casino (only while nobody is hunting
> you), courier packages between cities, or rob a bank and carry the cash bag to any SHOP to fence it (bags slow you and
> drop when you die). Crimes raise your stars; break line of sight to lose them, or lay low at a shop. Buy guns, ammo and
> a plate carrier at a shop. Take a parked car or carjack one (F) to drive the highways; M shows the map. Three ways out:
> a boat from Jaffa or Haifa (₪15,000 each, hold the pier 60 s at five stars), a plane from Ben Gurion (₪25,000 each, a
> forged passport each from the forger in Jerusalem, zero stars, 30 s boarding), or the southern border at Eilat
> (₪10,000 for the crew, hold 90 s at five stars). Dead players are back at the nearest safehouse in 10 s; if the whole
> crew is down you lose a quarter of the money. Escape with more money for a better ending.

**Pointer lock and Esc** (web-specific):
- Clicking the game canvas requests pointer lock. While in game with no menu open and the lock not held, show a centred
  `Click to play` overlay.
- Browsers release pointer lock on Esc themselves and do not deliver that key press. So a `pointerlockchange` to
  "unlocked" that the game did not cause **opens the Esc menu**. **Resume** re-requests the lock, which needs a user
  gesture, so it is a button.
- The console (`` ` ``) releases the lock and takes keyboard focus while open. The map (M) keeps the lock.
- `preventDefault` on every game key while in game (Space, arrows, `` ` ``, `'`, `/`, F, M, 1–3, Tab), so the page never
  scrolls and Firefox quick-find never opens.
- The host also gets a `beforeunload` confirmation: `Leaving ends the game for everyone`.

**The host tab in the background** (web-specific, critical):
- Hidden tabs get no `requestAnimationFrame`, and their timers are throttled to about 1 Hz. That would freeze the whole
  session for the clients.
- So the host's simulation must not be driven by rAF. Drive the fixed 60 Hz step from a dedicated Worker that posts a
  tick message every 16 ms (worker timers are not throttled like page timers).
- On each tick, run as many fixed steps as real time requires, capped at 15 per tick.
- Render only when visible. Keep snapshots and the director running while hidden.
- Clients may use rAF (a hidden client simply catches up through snapshots).

**Connection errors** (map PeerJS and ICE failures onto H13's messages; choose wording):
- `peer-unavailable` → `Room not found`.
- `network` / `server-error` / `socket-error` → `Can't reach the matchmaking server`.
- A DataConnection not open within 15 s → `Couldn't connect to the host: a firewall or strict NAT blocks peer-to-peer.
  Try another network, or the host can add a TURN server (?turn=)`.
- The host getting `unavailable-id` (code taken) → silently pick a new code.
- The protocol version and build id are shown in the main-menu footer.

**Touch devices.** The original has keyboard/mouse plus optional gamepad only. Lyra's on-screen joysticks are mobile-only.
On a device with only a coarse pointer, the main menu shows `Keyboard and mouse needed` but still allows play (choose).

**Showcase mode** (`?showcase`, mirrors `-EscShowcase`; a look-check tool, host only):
- 2 s after the local pawn exists, cast 16 rays (every 22.5°) 40 m out, from 1 m above the feet. Take the most open
  direction `dir` and its free distance `free`. Let `max = max(free − 3, 6)` m.
- Lay out three rows across `dir`. Each model is dropped onto the floor with a down ray, has no collision, and does not
  animate (mesh only):
  - the 10 character looks at min(5, max) m, 1.6 m apart, facing the player
  - sedan, taxi, van, pickup, jeep at min(11, max) m, 6 m apart, side-on
  - tank and helicopter at min(19, max) m, 14 m apart, side-on
- Overview camera at `origin − dir·7 + 6.5 m up`, looking at the middle row, for 8 s (`OverviewSeconds=8`). Then blend
  back to the player in 0.5 s.
- Unreal also spawned 4 passive Lyra bots (`EscBotSpawner`, `NumBots=4`, `B_AI_Controller_LyraShooter_Passive`: stand
  and never shoot) to show the looks animated. Web (choose): spawn 4 idle soldiers that never fire, outside the director's
  counts.
- PROBEs `showcase_spawn{mesh}` per model and `showcase_ready{free_m}`.

Source: Plugins/GameFeatures/ShooterCore/Content/Experiences/LAS_ShooterGame_StandardComponents.uasset and
LAS_ShooterGame_StandardHUD.uasset (bundle lists); Content/UI/Indicators/W_Nameplate.uasset (CompareTeams, GetPlayerName,
GetHealthNormalized, Blue/Red health-bar materials); Source/LyraGame/Weapons/LyraGameplayAbility_RangedWeapon.cpp:480-530;
EscShowcaseComponent.cpp:29-131, EscShowcaseComponent.h:22-36; Config/DefaultGame.ini:262-288; README_friends.md:31-56.
