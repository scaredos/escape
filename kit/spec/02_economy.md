## Economy, interactables, jobs, items and saving

> The live values are the C++ defaults. `Config/DefaultGame.ini` has no `[EscInteractable]`, `[EscSaveSubsystem]` or economy `[EscDirector]` keys, and `[EscPlayerComponent]` only sets `SprintSpeedScale=1.6`. Units: UE cm are given as metres here (web: 1 unit = 1 m). "Host" means the authoritative peer: every rule, roll and timer runs on the host, and clients only display state and send requests.

---

### 1. Shared wallet, money formatting, run-end tiers

- **One team wallet** (integer shekels) for all players, held by the host and replicated to everyone.
- **Start money:** ₪500.
- **Earning:** `addMoney(delta)` sets `money = max(0, money + delta)`. Every income goes to the shared wallet: crates, hold-ups, casino wins, burger pay, fencing, deliveries, refunds.
- **Spending:** `trySpend(amount)` fails when `amount < 0 || amount > money`. There is no partial payment. If it fails, nothing happens and only the buyer gets the message `Not enough money (₪<price>)`.
- **Team wipe** (every human is dead at once, outside the Escaped phase):
  - `lost = floor(money / 4)` and `money -= lost`.
  - Heat is set to 0 and the search timer resets. The phase does not change.
  - Broadcast: `Everyone is down! Lost ₪<lost>, the heat is off`.
- **Killing civilians never pays.** No loot or money drops, ever. The killer gets +100 heat, or +200 if a living soldier has line of sight within 100 m of the body.
  - Broadcast when unseen: `A civilian was killed. That never pays.`
  - Broadcast when a soldier saw it: `A soldier saw you kill a civilian!`
- **Run-end tier** uses the wallet left after the fare is paid:
  - `< 10,000` gives `Broke`.
  - `< 60,000` gives `Comfortable`.
  - Anything else gives `Kingpin`.
  - End card lines:
    - `ESCAPED`
    - `You got out <how> with ₪<n>`
    - the tier
    - `Thanks for playing Escape Israel`
  - `<how>` is one of: `by boat from Jaffa`, `by boat from Haifa`, `on a plane from Ben Gurion`, `over the southern border`.
- **Money format** `shekels(n)`: `"₪" + abs(n)` with en-US thousands separators, prefixed with `-` if negative. Example: `₪1,500`.
  - Web: `(n<0?'-':'')+'₪'+Math.abs(n).toLocaleString('en-US')`.
- **Clock format** `clock(s)`: `t = max(0, ceil(s))`, shown as `${floor(t/60)}:${pad2(t%60)}`. Example: `0:42`.

Source: EscDirector.h:116,149; EscDirector.cpp:57-58,271,340-365,878-886,1154-1158,1186-1195; EscCommon.h:47-50; EscHUD.cpp:51-55,781-797.

---

### 2. Interaction model (focus, E, Up/Down, menus)

**Spot entity** (one class for every usable spot). Replicated fields:
- `mode`
- `label` (the display name)
- `available` (bool)
- `value` (int, used by bags)
- `timerEnd` (host time when a crate/bank timer ends; 0 means no timer)
- `boatOut` (escape spots only: how far out along the spot's +X, in metres, the moored boat prop lies over open water; default 6)

Host-only fields:
- `hasPistol`
- `heistRunning`
- the per-player burger earnings map

**Use radius** (2D distance from the player's pawn to the spot origin):

| Mode | Radius |
|---|---|
| Crate, Bag | 3.0 m |
| Shop, Job, Casino, Forger | 4.5 m |
| Bank | 5.0 m |
| Airport, Delivery | 6.0 m ("pull up beside the van": works from a car) |
| Escape (boat), Crossing | 9.0 m |

**Focus** is recomputed on the local client every frame, and only while the local pawn is alive.
1. Collect candidates:
   - Every spot whose 2D distance to the pawn is ≤ its use radius, with `minDot = 0.3`.
   - If the player has a ranged weapon in hand (the active slot holds a gun): every living civilian (not self) within 5.0 m (2D), with `minDot = 0.9`.
2. For each candidate:
   - `dot = cameraForward · normalize(candidate.origin − cameraPos)`
   - `dist = 2D distance from the pawn`
   - Reject it if `dist > range` or `dot < minDot`.
   - `score = dot − dist / range`. The highest score wins. Spots and civilians compete in the same pool.
3. When the focused target changes, the remembered selected action resets.

**Menu.** `getOptions(spot, player)` returns ordered lines `{text, actionable, action}`. Info lines have `action = 0` and are not actionable.
- The list must be built only from replicated state, so the host and the owning client build the same list.
- The selection is stored as the **action id** of the selected line, not its index:
  - Each frame the index is found again by that action.
  - If the action is gone, or nothing was selected yet, the selection moves to the first actionable line. If no line is actionable, the index is 0.
- **Up / Down:** step −1 / +1 to the next actionable line, wrapping around and skipping info lines.
- **E:**
  - If something is in focus: send `use(targetId, selectedAction)` to the host.
  - Else, if a car is in reach: get in (see the vehicles section).
  - Holding E does not repeat. Each press is one action, and the selection stays on the same line, so repeated E repeats the same action.
- **No modal and no explicit close.** The menu is visible while the target is in focus. It "closes" when:
  - the player walks out of radius,
  - the player looks away (dot drops below the minimum),
  - the player dies,
  - another target scores higher.
- While the full-screen map (M) is open the prompt is hidden, but E still uses the current focus.
  - Web: you may block E while the map is open (allowed simplification).

**Host validation of `use(target, action)`:**
1. The requester's pawn is alive, and the target exists and is not being destroyed.
2. Distance check:
   - Spot: 2D distance ≤ `useRadius + 1.5 m` (slack for lag).
   - Civilian: ≤ `5.0 + 1.5 m`.
3. For spots, rebuild `getOptions` on the host and require that `action` appears as an **actionable** line right now. This rejects stale menus and double presses. Action 0 does nothing.
4. Run the action, then push the spot's state to clients immediately.

**Prompt panel** (bottom centre, anchored at x = 50%, y = 64% of the screen):
- Row 1: the spot label in gold (scale 1.15).
- If there is exactly 1 line: `[E] <text>` in white, or just `<text>` in grey when it is an info line.
- If there are 2 or more lines:
  - Each line is prefixed `> ` when selected (gold text, row background rgba(1, 0.8, 0.25, 0.22)) or with 3 spaces otherwise. Info lines are grey (0.62).
  - Footer: `Up/Down choose - E select` (grey, scale 0.8).
- Civilian focus: the single row `[E] Hold them up` (scale 1.15).
- Car rows follow: `[F] Get out` / `[F] Get in` / `[F] Get in (drag the driver out)`.

**Messages:**
- `clientMessage` goes to one player only (receipts, casino results, errors).
- `broadcast` goes to every player.
- Each client keeps the last 12 lines and draws the last 6 on the left at 30% screen height. A line stays fully opaque for 6 s, fades out over 2 s, and is gone at 8 s.
- Player names in messages are the lobby display name, falling back to `Someone`.

**Action ids** (send these over the network, never line indices):

| Id | Action |
|---|---|
| 0 | Info |
| 1 | OpenCrate |
| 2 | BuyPistol |
| 3 | BuyShotgun |
| 4 | BuyRifle |
| 5 | BuyAmmo |
| 6 | BuyArmor |
| 7 | LayLow |
| 8 | Fence |
| 9 | Slots |
| 10 | Roulette |
| 11 | HighRoller |
| 12 | JobStart |
| 13 | JobServe |
| 14 | JobClear |
| 15 | HeistStart |
| 16 | PayBoat |
| 17 | PickUpBag |
| 18 | BuyPassport |
| 19 | BuyTickets |
| 20 | PaySmugglers |
| 21 | Deliver |
| 22–25 | JobAdd + food (Burger 0, Fries 1, Cola 2, Falafel 3) |
| 38+i | TakePackage + i (i = index in the nearest-first destination list) |

- Web: PeerJS message `{t:'use', id, action}`. The host answers through the normal state sync plus `{t:'msg', text}` for personal messages.
- Web: all time-based fields (`timerEnd`, deadlines, cooldowns) are **host timestamps**. Clients show `ts − hostNow()` using the clock offset from the ping/pong estimate in spec 05 H16.

Source: EscInteractable.cpp:605-625,685-699,887-927,1221; EscInteractable.h:44-52; EscPlayerComponent.cpp:58-85,247-350,371-392,442-452; EscHUD.cpp:393-436,452-471.

---

### 3. Spot catalogue (from `Data/zones/world.json`)

Coordinates are world metres (x east, y north). There are 4 safehouses, 4 shops, 1 casino, 1 job, 7 banks, 2 boats, 1 forger, 1 crossing, 1 airport, 4 delivery vans, and 58 crates + 1 Stash.

| City | Spots (label, x, y) |
|---|---|
| Tel Aviv-Jaffa | Safehouse (The Postel) 1164.3, 1275.4 · **Stash** (pistol crate) at safehouse + (2.5 m, 2.5 m) · Shop `Abu Shmulik's Garage - guns, armour, fence` 1531.3, 1260.0 · Casino `Club Gagarin Casino` 1689.1, 1060.2 · Job `McShekel's` 1251.5, 1153.8 · Banks `Jaffa Savings Bank` 1217.3, 1235.6 and `Shuk Credit Bank` 1262.9, 1081.9 · Escape `Boat out of Jaffa` 335.0, 1307.4 · Delivery `Yossi's Express Courier` 730.7, 1277.1 · 24 crates |
| Haifa | Safehouse (Carmel Backpackers) 2641.1, 6656.2 · Shop `Uncle Moti's Motors - guns, armour, fence` 1703.2, 7429.1 · Banks `Carmel Mutual Savings` 2009.9, 6768.6 and `Bay & Port Trust` 2881.8, 6706.3 · Escape `Boat out of Haifa port` 3301.2, 6795.9 · Delivery `Carmel Cargo & Courier` 2877.3, 6153.8 · 12 crates |
| Jerusalem | Safehouse (Rooftop Hostel) 6190.4, −1786.7 · Shop `Shuki's Pawn & Hardware - guns, armour, fence` 5640.1, −1498.7 · Forger `Shimon's Passport Photos & Print` 5566.1, −754.2 · Banks `Golden City Credit` 5266.2, −732.9 and `Zion Square Savings & Loan` 6357.3, −2090.1 · Delivery `Moshe's Moving & Parcels` 6186.0, −2229.4 · 12 crates |
| Eilat | Safehouse (Coral Motel) 4645.1, −12095.3 · Shop `Duty-Free Dudu - guns, armour, fence` 4930.0, −12947.4 · Bank `Red Sea Offshore Bank` 5041.5, −13132.6 · Crossing `Southern crossing (Taba road)` 3995.4, −13985.0 · Delivery `Red Sea Rush Deliveries` 4475.5, −12446.7 · 10 crates |
| Highway | Airport `Ben Gurion Airport - departures` 3000.0, −900.0 |

- Crate labels are `Crate`; the pistol one is `Stash`.
- Only the Tel Aviv Stash has the pistol. It is generated as a copy of the first Tel Aviv safehouse spot with `"pistol": true`.
- All spots are shared world state: a looted crate or emptied vault is looted or empty for everyone.

Source: Data/zones/world.json `spots`; Tools/geo/zones.py:277-279; EscCity.cpp:3565-3591.

---

### 4. Modes

#### 4.1 Crate and Stash
- **Available:** one line, `Open the crate` (OpenCrate).
- **Looted:** info line `Empty (respawns soon)`. No countdown is shown.
- **OpenCrate, Stash:** if the player owns no gun at all (no pistol, shotgun or rifle in the inventory), give them a pistol (equipped) with the message `You found a pistol in the stash`. No money in that case.
- **Otherwise** (any normal crate, or the Stash when the player already owns a gun): `found = randInt(50, 300)` inclusive, uniform, added to the wallet. Message: `You found ₪<found> in the crate`.
- The spot then closes:
  - `timerEnd = now + respawn`, where respawn is 60 s for the Stash and 300 s for a crate.
  - It reopens when the timer ends.
- Closed look: open-lid prop, or the box darkened ×0.25. Crates have no HUD marker.

Source: EscInteractable.cpp:704-713,931-951; EscInteractable.h:169-172.

#### 4.2 Shop (4 shops, one per city): weapons, ammo, armour, lay low, fence
Menu, in this order:
1. `Pistol  ₪1,500` (BuyPistol)
2. `Shotgun  ₪6,000` (BuyShotgun)
3. `Rifle  ₪10,000` (BuyRifle)
4. `Ammo refill  ₪200` (BuyAmmo)
5. One of:
   - `Plate carrier  ₪8,000` (BuyArmor), or
   - info `Plate carrier (wearing one)` when the player's armour ≥ 0.5.
6. Only when stars > 0: `Lay low (-1 star)  ₪2,000` (LayLow).
7. Only when this player carries a bag: `Fence the bag (+₪<bag>)` (Fence).

Actions:
- **Buy a gun:**
  - Pay, then give the weapon. Message: `Bought: Pistol` / `Bought: Shotgun` / `Bought: Rifle`.
  - A new weapon goes into the next free quick-bar slot (3 slots, keys 1-3) and is equipped. If the bar is full, it replaces the weapon in hand.
  - **Edge case:** buying a type you already own still charges the full price, and it only refills ammo (see Ammo).
  - If the hand-over fails: refund, with the message `Couldn't hand over the weapon: refunded`.
- **Ammo:**
  - If the player owns no gun: the message `You have no gun to load` and **no charge**.
  - Otherwise: pay 200, then add **+60 spare rounds to every gun in the inventory**. Message: `Ammo refilled`.
- **Plate carrier:**
  - Pay, then `armour = 0.5`. Message: `Plate carrier on (lost if you die)`.
  - Effect: `maxHealth = baseHealth / (1 − armour × 0.5)`, with base 100, which gives 133.3. The current health *fraction* is kept, so health is rescaled with max health.
  - The death knockback (ragdoll launch) is multiplied by `(1 − armour)`.
  - The armour value is stored on the player, not the body, and applied to each new body at setup. It is reset to 0 as soon as the pawn is dead.
- **Lay low:**
  - Pay, then `heat = max(0, heat − 100)` and the search/decay timer resets to 0. One star always drops.
  - Broadcast: `<Name> paid to lay low: -1 star`.
  - It has no phase gate (it is offered whenever stars > 0, even in a finale).
- **Fence:**
  - The bag's value goes to the wallet (100%, no cut). The bag is cleared and the walk speed restored.
  - Broadcast: `<Name> fenced the cash bag: +₪<value>`.
  - Any shop works.

Weapon stats come from Lyra assets, which are not readable here. Use the weapon table in spec 04 §5.3 (magazine / starting spare: Pistol 12 / 36, Shotgun 6 / 18, Rifle 30 / 90).

Source: EscInteractable.cpp:715-736,953-1019; EscInteractable.h:173-179; EscPlayerComponent.cpp:644-715; EscPawnComponent.cpp:205-220,263; LyraQuickBarComponent.h:64; LyraHealthSet.cpp:21-23.

#### 4.3 Cash bags (mode Bag)
- **Spawned by:** a successful bank heist, a carrier's death, or a carrier disconnecting.
- **Look:** a green duffel. Players and cars pass through it, but it still blocks the "visibility" trace used for focus. HUD marker `CASH` in green (0.3, 0.9, 0.4).
- **Label:** `Cash bag`.
- **Menu:**
  - If the player already carries a bag: info `You already carry a bag`.
  - Otherwise: `Pick up the cash bag (₪<value>)` (PickUpBag).
- **Pick up:**
  - The player's `bagValue = value` and the bag entity is destroyed.
  - Broadcast: `<Name> grabbed the cash bag (₪<value>): fence it at the shop`.
  - One bag per player.
- **Carrying:**
  - Walk speed is multiplied by **0.7**. It stacks multiplicatively with sprint (×1.6): `maxWalk = base × (bag ? 0.7 : 1) × (sprint ? 1.6 : 1)`. Cars are unaffected.
  - Objective row: `Carrying ₪<value> - fence it at a SHOP (30% slower)` (green).
- **Death:** the bag drops at the body's position (ground level). Broadcast: `A bag was dropped!`.
- **Disconnect:** the bag drops at the last position where the pawn was alive, with the same broadcast.
- Bags never expire and are never saved; they are lost on reload.

Source: EscInteractable.cpp:400-414,580-589,874-883,1166-1175; EscPlayerComponent.h:33-35,234; EscPlayerComponent.cpp:141-157,456-482,542-558,579-588; EscPawnComponent.cpp:248-255.

#### 4.4 Bank heist (7 banks)
- **Menu:**
  - Available, no heist running: `Rob the vault (alarm!)` (HeistStart).
  - Heist running (still available, with `timerEnd > 0`): info `Cracking the vault... <ceil(secondsLeft)>s`.
  - Closed: info `Vault empty`.
- **Start:**
  - `setHeatAtLeast(300)` (spec 03 §1), i.e. at least 3 stars. It always resets the search grace, even when heat is already ≥ 300.
  - `timerEnd = now + 40 s`, checked every 1 s.
  - Broadcast: `<Name> is robbing <Label>! Stay within 25 m of the vault for 40 s`.
- **End**, checked only once, when the timer expires:
  - Success if **any** living human (not necessarily the starter) is within **25 m 3D** of the vault origin at that moment.
  - On success: `cash = randInt(20000, 50000)` inclusive. A bag with that value spawns 2 m in front of the vault, facing the hall door. Broadcast: `The vault at <Label> is open: grab the cash bag (₪<cash>)!`.
  - On failure: broadcast `The heist at <Label> failed: nobody stayed at the vault`.
  - Either way the bank closes (`Vault empty`) for **600 s**, then reopens.

Source: EscInteractable.cpp:773-787,1119-1131,1224-1265; EscInteractable.h:187-191.

#### 4.5 Casino (`Club Gagarin Casino`, Tel Aviv only)
- **Stars > 0:** the only line is info `Closed while you're wanted`.
- **Otherwise:**
  1. `Slots  ₪200` (Slots)
  2. `Roulette: red  ₪1,000` (Roulette)
  3. `High-roller slots  ₪5,000` (HighRoller)
- There is no limit or cooldown: each E press is one paid play. All rolls happen on the host.
- **Slots / High-roller** (same table, bet 200 or 5,000). Roll `r = random()` in [0, 1):

  | Roll | Payout | Reels |
  |---|---|---|
  | r < 0.005 | ×50 | `7 \| 7 \| 7` |
  | r < 0.045 | ×5 | `BAR \| BAR \| BAR` |
  | r < 0.28 | ×2 | `CHERRY \| CHERRY \| CHERRY` |
  | otherwise | ×0 | one of `LEMON \| BELL \| 7`, `CHERRY \| LEMON \| BAR`, `BELL \| BAR \| LEMON` (uniform) |

  - The bet is taken first, then `bet × mult` is added.
  - Expected return 0.25 + 0.20 + 0.47 = **92%** (house edge 8%).
  - Messages: `Slots: [<reels>] - you win ₪<win>!` or `Slots: [<reels>] - no luck`. High-roller uses the same `Slots:` text.
- **Roulette:**
  - Win with p = 18/37. The win pays ₪2,000 (2× the bet), for a return of 97.3%.
  - Messages: `Roulette: red! You win ₪2,000` or `Roulette: black. The house wins`. A zero also shows "black".

Source: EscInteractable.cpp:738-747,1021-1066; EscInteractable.h:180-182.

#### 4.6 Burger job (`McShekel's`, Tel Aviv only)
State is kept per player:
- `jobOrder`: 3 foods
- `jobTray`: up to 4 foods
- `ordersLeft`
- `jobEnd`
- `jobCooldownEnd`

Menu, first matching rule wins:
1. Stars > 0: info `No shifts while you're wanted`. This also hides an ongoing shift's lines, and the shift clock keeps running.
2. On shift (ordersLeft > 0): `Add Burger`, `Add Fries`, `Add Cola`, `Add Falafel`, `Serve order`, `Clear tray`.
3. `now < jobCooldownEnd`: info `Next shift in <ceil(s)>s`.
4. Otherwise: `Start a shift at McShekel's (5 orders, 90 s)`.

Actions:
- **Start:**
  - `ordersLeft = 5`, `jobEnd = now + 90`, the tray is emptied, and a new random order is drawn: **3 items, each uniform over the 4 foods, duplicates allowed**.
  - Message: `Shift started: 5 orders in 90 s`.
  - Earnings for this shift are tracked from 0.
- **Add food:**
  - If the tray already holds 4 items: message `The tray is full`.
  - Otherwise the food is appended.
- **Clear tray:** empties the tray silently.
- **Serve:**
  - The order is correct when the sorted tray equals the sorted order (same items, any order).
  - Correct: +₪80 to the wallet, message `Order up! +₪80`.
  - Wrong: message `Wrong order: no pay`.
  - Then the tray empties and `ordersLeft −= 1`.
  - If orders remain: a new random order is drawn.
  - If none remain: the order clears, `jobCooldownEnd = now + 120`, and the message is `Shift over: you earned ₪<shiftTotal>`.
- **Timeout** (the host checks each tick; when `now > jobEnd` with orders left):
  - Everything is cleared and `jobCooldownEnd = now + 120`.
  - Message: `Shift over: out of time` (no earnings summary).
- The maximum pay is ₪400 per shift.
- Several players can work at once, each with their own shift.
- Walking away does not pause the shift. Serving needs you within the use radius.

Job panel (right side, right-aligned at screen width − 24 px, y = 30%), shown only while on shift:
- `McShekel's - order: Burger, Fries, Cola` in gold.
- `Tray: <items>`, or `Tray: empty`.
- `Orders left <n>  Time <clock>` in grey.

Source: EscInteractable.cpp:73-81,749-771,1068-1117,1189-1199; EscInteractable.h:183-186; EscPlayerComponent.cpp:719-730; EscHUD.cpp:108-117,438-450.

#### 4.7 Delivery (courier vans, one per city)
- **With a package**, standing at its destination van (the stored destination is within 1 m of this spot): `Deliver the package (+₪<reward>)` (Deliver).
  - Pays the reward to the wallet and clears the package.
  - Broadcast: `<Name> delivered a package to <Label>: +₪<reward>`.
  - The deadline is not re-checked here; the host's timeout tick is the only fail path.
- **With a package**, at a different van: info `Deliver it to <destLabel> first`.
- **Without a package** (any stars): one line per *other* delivery spot, sorted by 2D distance nearest first:
  - `Take a package to <City>  +₪<reward> in <clock(seconds)>`, with action TakePackage + i.
  - City names: `Tel Aviv-Jaffa`, `Haifa`, `Jerusalem`, `Eilat`.
  - If there are no other spots: info `No packages right now`.
- **Terms:**
  - `m = 2D distance in metres`
  - `reward = min(5000, round((2000 + 0.25·m)/100)·100)`
  - `seconds = ceil(m/18 + 60)`
- **Take:**
  - Store `destLabel = "<City> - <spot label>"` (e.g. `Haifa - Carmel Cargo & Courier`), plus the destination position, the reward, and `deadline = now + seconds`.
  - Message: `Package for <destLabel>: get it there within <clock> for ₪<reward>`.
  - One package per player. It cannot be cancelled, and there is no cooldown.
- **Failure** (no other penalty; no heat):
  - `now > deadline`: message `The client cancelled - too slow`.
  - Pawn dead: message `The package was lost when you went down`.
  - Disconnect: the package is lost silently.
  - Packages are not saved.
- **HUD while carrying:**
  - Objective row `Deliver to <destLabel>  <clock(left)>  (+₪<reward>)`, in red when less than 30 s are left, else orange (1, 0.55, 0.15).
  - A `DROP-OFF` marker at the destination, shown at any distance.
  - `DELIVERY` markers within 1.5 km.
- Computed terms (each pair is symmetric):

  | From → to | Distance | Pay | Time |
  |---|---|---|---|
  | Tel Aviv ↔ Haifa | 5,328 m | ₪3,300 | 5:57 |
  | Tel Aviv ↔ Jerusalem | 6,485 m | ₪3,600 | 7:01 |
  | Tel Aviv ↔ Eilat | 14,226 m | ₪5,000 | 14:11 |
  | Haifa ↔ Jerusalem | 9,013 m | ₪4,300 | 9:21 |
  | Haifa ↔ Eilat | 18,669 m | ₪5,000 | 18:18 |
  | Jerusalem ↔ Eilat | 10,359 m | ₪4,600 | 10:36 |

Source: EscInteractable.cpp:83-107,627-632,842-872,1177-1186,1200-1218; EscInteractable.h:196-200; EscPlayerComponent.h:64-78; EscPlayerComponent.cpp:583-586,731-760; EscHUD.cpp:384-389.

#### 4.8 Forger (`Shimon's Passport Photos & Print`, Jerusalem)
- **Menu:**
  - If this player already has a passport: info `You already have a passport`.
  - Otherwise: `Forged passport  ₪5,000` (BuyPassport).
- **Buy:**
  - Sets `passport = true` for the buyer only. Each player buys their own.
  - Broadcast: `<Name> bought a forged passport`.
- Passports are never spent, are kept through death, and are saved by player name.
- `passportsMissing` is recomputed by the host every 0.25 s as the number of **living** humans without a passport, and replicated. Dead players never block the airport.

Source: EscInteractable.cpp:831-840,1157-1164; EscPlayerComponent.h:41-44; EscDirector.cpp:718-726.

#### 4.9 Ways out: Escape (boat), Airport, Crossing
- **Price**, with `living` = humans whose pawn is alive (minimum 1; players waiting to respawn don't count and don't pay):
  - Boat: `15000 × living`
  - Airport: `25000 × living`
  - Crossing: a flat `10000`
- The price is computed when the menu is built, and again when E is pressed.
- **Menu**, a single line, first matching rule wins:
  1. Phase is Escaped: info `You made it out`.
  2. Phase is Finale and this is the finale's spot (within 1 m): info `Hold the pier! <n>s` / `Boarding... <n>s` / `Hold the border! <n>s`, with `n = ceil(finaleLeft)`.
  3. Phase is Finale elsewhere: info `Your ride out is waiting somewhere else`.
  4. Boat: `Bribe the captain: ₪<price>` (PayBoat).
  5. Crossing: `Pay the smugglers: ₪<price>` (PaySmugglers).
  6. Airport, stars > 0: info `Security won't let you in while you're wanted`.
  7. Airport, passportsMissing > 0: info `Everyone needs a passport (forger in Jerusalem)`.
  8. Airport otherwise: `Buy tickets: ₪<price>` (BuyTickets).
- **Pay** (only while the phase is Playing):
  - `trySpend(price)`, then start the finale at this spot.
  - Hold times: boat 60 s, airport 30 s, crossing 90 s.
  - Boat and crossing force heat to 500 (5 stars), which broadcasts `Wanted level 5` first.
  - The airport leaves heat at 0.
- **Broadcasts:**
  - Boat: `<Name> bribed the captain (₪<cost>). Hold the pier until the boat leaves!`
  - Airport: `<Name> bought the tickets (₪<cost>). Boarding in 30 s: stay at the gate and don't get wanted!`
  - Crossing: `<Name> paid the smugglers (₪<cost>). Hold the border for 90 s until the truck comes!`
- **Airport no-stars rule:** if stars > 0 at any point during boarding:
  - The phase goes back to Playing, the hold timer resets to 0, and the fare is refunded in full.
  - Broadcast: `Boarding cancelled: you're wanted! Tickets refunded (₪<paid>). Lose the stars and try again`.
- Boat and crossing fares are never refunded.
- Hold rules, summarised for completeness:
  - The clock runs only while at least one living human is within 30 m (2D) of the spot.
  - Each 10 s boundary broadcasts `Hold the pier: <n> s` / `Boarding: <n> s` / `Hold the border: <n> s`.
  - At 0: the phase becomes Escaped, the final money is the current wallet, heat is set to 0, and the broadcast is `ESCAPED <how> with ₪<money>: <Tier>`.

Source: EscInteractable.cpp:109-113,669-683,789-829,1133-1155; EscInteractable.h:192-195; EscDirector.cpp:407-424,837-887; EscDirector.h:169-172.

#### 4.10 Safehouse (4, one per city)
- Not an interactable: there is no prompt.
- HUD marker `SAFEHOUSE` in light blue (0.55, 0.75, 1), within 1.5 km.
- It is the respawn point, 10 s after death:
  - at the safehouse nearest a living teammate,
  - or at `Safehouse (The Postel)` when nobody is alive.
- It is the safehouse autosave trigger (any living human within 8 m; see §7).
- The Tel Aviv Stash sits 2.5 m north and 2.5 m east of its spawn point.

Source: EscCity.cpp:3577-3583; EscDirector.cpp:59-70; EscSaveGame.cpp:30-54.

#### 4.11 Hold-up (robbing a civilian)
- **Requirements:**
  - A gun is in hand.
  - The civilian is alive.
  - The civilian is in focus: within 5 m and `dot ≥ 0.9`. On the host, the range is 6.5 m.
- **Prompt:** `[E] Hold them up`.
- **Each civilian can be robbed once in its lifetime.** A second try gets the message `Nothing to take`, and so does a target that is not a civilian controller.
- **On success:**
  - `amount = randInt(20, 300)` inclusive goes to the wallet.
  - Heat +40, plus +60 more if a living soldier within 100 m has line of sight to the robber's position (+0.5 m up).
  - Message: `They hand over ₪<amount>`.
- **The civilian's reaction:**
  - It stops and turns to face the robber for **1.5 s** ("hands up": stand still; web may play a hands-up pose).
  - Then it panics and runs (5.5 m/s) away from where the robber stood, for 15 s after the freeze ends.
- Civilians are generic, unnamed passers-by. There is no blood or gore anywhere; deaths are ragdolls only.

Source: EscPlayerComponent.cpp:296-305,389-409; EscPlayerComponent.h:236; EscCivilianController.cpp:230-247; EscHUD.cpp:420-423.

---

### 5. Per-player items and state: what survives what

| State | Scope | On death | On disconnect | Saved |
|---|---|---|---|---|
| Guns (quick bar, 3 slots) | player | kept: given back to the new body in the same slot order, as fresh items with default ammo, and the active slot is restored | lost | no |
| Armour (0 or 0.5) | player | lost (set to 0) | lost | no |
| Cash bag | player | dropped at the body | dropped at the last alive position | no |
| Passport | player | kept | kept by name in the host's holder list (restored when they rejoin) | yes |
| Package | player | lost (message) | lost | no |
| Burger shift / cooldown | player | shift keeps running (it will time out) | lost | no |
| Wallet | team | unchanged (team wipe: −25%) | n/a | yes |

Source: EscPlayerComponent.cpp:579-640; EscSaveGame.h:1-28.

---

### 6. Objective line (top-left panel)

**Finale phase:**
- Title row (scale 2.2):
  - `HOLD THE PIER  <clock>` (red)
  - `BOARDING  <clock>` (blue 0.3, 0.8, 1)
  - `HOLD THE BORDER  <clock>` (red)
- Hint row (white):
  - Boat: `Keep someone on the pier until the boat casts off`
  - Airport: `Stay at the gate and keep it quiet: one star cancels boarding`
  - Crossing: `Keep someone at the crossing until the smugglers' truck rolls in`

**Otherwise:**
1. Build the ways out with the current `living` count, and sort them by cost, ascending:
   - `the southern border at Eilat`: cost 10000, always open.
   - `a boat from Jaffa or Haifa`: cost 15000 × living, always open.
   - `a plane from Ben Gurion`: cost 25000 × living, open only when passportsMissing == 0 **and** stars == 0.
2. "Affordable" means open and `money ≥ cost`, kept in ascending cost order.
3. Row 1:
   - If any way is affordable: `Get out: <name> (₪<cost>)` with the affordable ways joined by ` or `, in gold.
   - Else: `Make ₪<cost of cheapest overall> to get out  (₪<money> so far)` in white. The cheapest is always the crossing, so this reads ₪10,000.
4. Row 2 (grey, always): `Boat from Jaffa/Haifa ₪15,000 each - airport ₪25,000 each + passports, no stars - southern border ₪10,000`.
5. Row 3 (grey), shown only when `missing > 0 && (missing < living || money ≥ 25000 × living)`: `Passports: <living−missing> of <living> - the forger in Jerusalem sells them (₪5,000)`.

**Always appended:** the bag row (§4.3) and the delivery row (§4.7).

Source: EscHUD.cpp:323-391.

---

### 7. Save system (host only)

- **Slot:** `EscapeIsrael`.
  - Web: `localStorage['esc.save.v1']` on the host (`EscapeIsrael` is the Unreal slot name). Wrap every read and write in try/catch. If the save is missing or corrupt, start fresh.
- **Clients never save or load.** A joining friend plays on the host's save. There is no host migration.
- **Contents:**
  - `version: 1`
  - `savedAt` (UTC ISO timestamp)
  - `money`
  - one row per spot, except bags: `{key, available, cooldownLeft}`
  - `passportHolders: [playerName…]`
- **Spot key:** `<ModeName>_<round(north m)>_<round(east m)>` (Unreal X = north first, then Y = east; i.e. round(y) then round(x) of the spot's runtime position in world inset-metres), e.g. `Crate_1234_-567`, where ModeName is the enum name (`Crate`, `Bank`, …).
  - Web: any stable mode + rounded position works.
- **cooldownLeft** is `max(0, timerEnd − now)` while closed, else 0. A heist in progress is saved as "available", so it is lost on reload.
- **Load** runs once, as soon as the wallet and the spots exist. If a save exists:
  - `money = saved` (clamped ≥ 0).
  - Each matching key first cancels any running timer or heist. Then the spot either reopens, or closes with `timerEnd = now + cooldownLeft` and reopens after `max(cooldownLeft, 0.1 s)`.
  - The holder list is restored.
  - Broadcast: `Welcome back - progress loaded (₪<money>)`.
  - With no save: a fresh run with ₪500.
  - A save must never be written before the load step has run.
- **Tick every 1 s after load:**
  1. If the phase is Escaped: delete the save (once), stop saving, done.
  2. Sync passports. Any connected player with a passport is added to the holders (the list only grows). Any connected player whose name is in the list gets their passport back, which covers late joiners and rejoiners.
  3. If the phase is not Playing (a finale), save nothing. The pre-fare save stays, so a crash mid-finale doesn't lose the fare.
  4. If 120 s or more have passed since the last save: autosave.
  5. Else, if 20 s or more have passed and any living human is within 8 m (2D) of any safehouse: save.
- **Quit / page unload:**
  - Phase Playing: save.
  - Phase Escaped: delete the save.
  - Phase Finale: do nothing, keeping the pre-fare save.
  - Web: `pagehide`/`beforeunload` on the host, and the Esc menu's Leave game.
- **Not saved:** guns, armour, carried or dropped bags, heat/stars, burger shifts and cooldowns, packages, positions, finale state.

Source: EscSaveGame.h:1-64; EscSaveGame.cpp:24-249; EscInteractable.cpp:634-667.

---

### Addendum: Save key and spec conflicts resolved

- **localStorage key.** Use **`esc.save.v1`** everywhere (§7 and 05 H14), with
  the H14 payload (`version` 1). It matches the other web keys (`esc.name`, `esc.settings`). `EscapeIsrael` is only the
  Unreal slot name. This file owns the save, so this line decides it.
- **Starting ammo.** §4.2's fallback (Shotgun 8 / 24) only applies when the combat section defines nothing. 04 §5.3
  does define it, so use 04: Pistol 12 / 36, Shotgun 6 / 18, Rifle 30 / 90.
- **What a host with a save sees** (Continue / New run) is a front-end rule: 05_hud.md, Addendum: Front-end details.
  In Unreal a save, if present, always loads silently.
- **Items have no look.** The plate carrier, the forged passport, a carried cash bag and a package change nothing on the
  character model in the original (state only). The web may add a duffel on the carrier's back (choose; 06_art.md,
  Addendum: Animation state selection).
