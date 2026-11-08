# Escape Israel (web)

A co-op GTA-style crime caper in a compressed, stylised Israel, rebuilt for the browser from the Unreal version.
1–4 friends start broke in a Tel Aviv safehouse, make money, get armed and pay their way out by boat, plane or the southern
border. Everything (city, props, cars, people, textures, sound) is generated in code from a 345 KB map pack.

## Play

Open the game URL, type a name, press **Host game**. You get a 5-letter room code and an invite link
(`<url>?join=CODE`, also in the Esc menu with a Copy button). Friends open the link (or press **Join game** and type the code).
Solo play is just hosting with nobody joining. Use your own voice chat (Discord etc.); there is no in-game chat.

The host's browser runs the game for everyone: keep the host tab open (it can be in the background). If the host leaves, the
session ends; the host's progress (money, looted crates, passports) is saved in that browser and offered as **Continue** next time.

If a friend can't connect ("firewall or strict NAT"), try another network, or add a TURN server with `?turn=turn:host:port`.

### Controls

| key | action |
|---|---|
| WASD + mouse | move / look |
| hold Shift | sprint ×1.6 (×0.7 while carrying a bag) |
| LMB / RMB | shoot / aim |
| R | reload |
| 1–3 | weapon slots (mouse wheel cycles) |
| E | use / confirm / hold up / get in when nothing else is in focus |
| Up / Down | menu line |
| F | car in/out (traffic cars under 15 km/h can be carjacked) |
| W/S, A/D, Space | throttle / brake-reverse, steer, handbrake (in a car) |
| M | map |
| Esc | menu (Resume, invite link, controls, leave) |
| ` | dev console |

### How to play
Grab the pistol from the Stash next to you in the Tel Aviv safehouse. Make money from crates, holding up civilians (gun out,
E), shifts at McShekel's, the Club Gagarin casino (only while nobody hunts you), courier packages between cities, or rob a
bank and carry the cash bag to any SHOP to fence it. Crimes raise your stars; break line of sight to lose them, or lay low at a
shop. Three ways out: a **boat** from Jaffa or Haifa (₪15,000 each, hold the pier 60 s at five stars), a **plane** from Ben
Gurion (₪25,000 each + a forged passport each from the forger in Jerusalem, zero stars, 30 s boarding), or the **southern
border** at Eilat (₪10,000 for the crew, hold 90 s at five stars). Escape richer for a better ending.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # packs data, type-checks, builds dist/
npm test             # Playwright milestone tests (headless Chromium, SwiftShader)
```

- `npm run pack-data` turns `data/` (OSM-derived, see credits) into `public/data/world.pack.json` and fails the build if any
  gameplay spot lies inside a 75 m sensitive-site buffer.
- Scripted runs: `/?script=EscTp casino;wait 3;shot showui` (see `kit/spec/05_hud.md` H17-H18), `node tools/shot.mjs
  --script "..." --out tests/screenshots/x` saves screenshots, `node tools/net_test.mjs` runs the two-player test on a local
  PeerJS server (`npm run peer`).
- Spec: `kit/spec/*.md`; decisions: `DECISIONS.md`.

## Credits
Map data (c) OpenStreetMap contributors, ODbL 1.0. Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and
Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.
This is a parody for a private group of friends; all businesses, units and people in it are fictional.
Built with Three.js, Rapier and PeerJS.
