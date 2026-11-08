// Game session: boots the world, runs the host Sim (listen server) and/or the client, render loop, HUD, console.
import * as THREE from 'three';
import { probe } from './core/probe';
import { seedGameRng } from './core/rng';
import { loadPack, generateInWorker } from './data/pack';
import { Stage, type Quality } from './render/stage';
import { bakeTextures, type Textures } from './render/textures';
import { WorldView } from './render/world-view';
import { updateWater } from './render/materials';
import { Phys, initRapier } from './physics/phys';
import { WorldQ } from './world/query';
import type { GenOutput, Pack } from './world/types';
import { Sim, type HostNet } from './game/sim';
import { E, PROTOCOL_V, type H2C } from './game/protocol';
import { LocalLink, startTicker, type ClientLink } from './net/link';
import { openHost, newRoomCode, PeerClientLink } from './net/peer';
import { Client } from './client/client';
import { Hud } from './ui/hud';
import { DevConsole, ScriptRunner } from './dev/console';
import { Audio } from './audio';
import { SpotProps } from './render/spot-props';

export interface World { pack: Pack; gen: GenOutput; tex: Textures; view: WorldView; wq: WorldQ; stage: Stage }
let worldP: Promise<World> | null = null;
export function bootWorld(stage: Stage, quality: Quality, onProgress: (f: number) => void): Promise<World> {
  return (worldP ??= (async () => {
    const t0 = performance.now();
    const pack = await loadPack((f) => onProgress(f * 0.2));
    const [gen, tex] = await Promise.all([generateInWorker(pack, (f) => onProgress(0.2 + f * 0.6)), bakeTextures(stage.renderer, quality === 'high' ? 1024 : 512), initRapier()]);
    onProgress(0.85);
    const view = new WorldView(stage.scene, gen, tex);
    probe('city_built', { ...gen.stats, ms_total: Math.round(performance.now() - t0) });
    return { pack, gen, tex, view, wq: new WorldQ(pack, gen), stage };
  })());
}

export interface SessionOpts { mode: 'host' | 'join'; name: string; room?: string; params: URLSearchParams; fresh?: boolean; onExit: (msg?: string) => void }

export class Session {
  sim: Sim | null = null; client!: Client; hud!: Hud; con!: DevConsole; phys!: Phys;
  room: string | null = null; roomShownAt = 0;
  private stopTicker: (() => void) | null = null; private raf = 0; private ended = false;
  private shotN = 0; private worldReady = false; private menuOpen = false;
  private fpsAcc = { n: 0, t: 0, fps: 0 }; frameMs: number[] = [];
  audio: Audio; spotProps!: SpotProps;
  constructor(public world: World, public opts: SessionOpts) { this.audio = new Audio(opts.params.has('mute')); }

  async start() {
    const { world, opts } = this, p = opts.params;
    if (p.get('seed')) seedGameRng(+p.get('seed')!);
    this.phys = new Phys();
    const n = this.phys.addStatics(world.gen);
    probe('physics_ready', { colliders: n });
    let link: ClientLink;
    if (opts.mode === 'host') {
      const scripted = p.has('script');
      const local = new LocalLink();
      const sends = new Map<number, (m: H2C, reliable: boolean) => void>();
      const net: HostNet = { send: (pid, m, rel = true) => sends.get(pid)?.(m, rel), drop: (pid) => sends.delete(pid) };
      const sim = (this.sim = new Sim(this.phys, world.wq, net, { nosave: p.has('nosave') || (scripted && !p.has('save')), scripted, fresh: opts.fresh }));
      const me = sim.addPlayer(opts.name, true);
      sends.set(me.id, (m) => local.deliver(m));
      local.toHost = (m) => sim.onMessage(me.id, m);
      local.deliver(sim.welcome(me));
      link = local;
      // the simulation runs from a worker tick so a hidden host tab keeps serving friends
      let last = performance.now(), acc = 0;
      this.stopTicker = startTicker(() => {
        const now = performance.now(); acc += Math.min(0.25, (now - last) / 1000); last = now;
        let n = 0; while (acc >= 1 / 60 && n < 15) { sim.step(1 / 60); acc -= 1 / 60; n++; }
      });
      // open the room unless explicitly solo-offline
      if (!p.has('offline')) this.openRoom(opts.room || p.get('room') || newRoomCode()).catch((e) => console.warn('room', e));
      addEventListener('beforeunload', this.onUnload);
      addEventListener('pagehide', () => sim.save.worldEnd());
    } else {
      const pl = new PeerClientLink(opts.room!, p);
      await pl.ready;
      link = pl;
    }
    this.client = new Client(link, this.phys, world.wq, world.stage, opts.mode === 'host');
    link.onClose = (reason) => this.exit(reason);
    if (opts.mode === 'join') this.client.hello(opts.name);
    const hudCanvas = document.createElement('canvas'); hudCanvas.id = 'hud'; document.body.appendChild(hudCanvas);
    const m = world.gen;
    this.hud = new Hud(hudCanvas, { bounds: world.wq.land.bounds, landSpans: (y) => world.wq.land.landSpans(y), roads: m.mapRoads, buildings: m.mapBuildings,
      insetAt: (x, y) => world.wq.insetAt(x, y), insets: world.pack.insets.map((i) => ({ name: i.name, ox: i.offset[0], oy: i.offset[1] })) });
    this.con = new DevConsole({ client: this.client, isHost: opts.mode === 'host', shot: (ui) => this.shot(ui), hostRoom: () => this.room,
      reportExtra: () => this.sim ? { traffic_cars: this.sim.cars.traffic.count() } : {} });
    if (p.get('script')) new ScriptRunner(p.get('script')!, this.con, () => !!this.client.myRecNow(), () => performance.now() / 1000);
    this.spotProps = new SpotProps(world.stage.scene, world.gen.lights);
    this.setupPointer();
    this.audio.attach(this.client);
    this.loop();
  }
  async openRoom(code: string) {
    const sim = this.sim!;
    const hostSends = new Map<number, (m: H2C, r: boolean) => void>();
    const { code: used } = await openHost(code, this.opts.params, {
      onConnect: (cid, send, close) => {
        let pid = -1;
        return (m) => {
          if (pid < 0) {
            if (m.t !== 'hello') return;
            if (m.v !== PROTOCOL_V) { send({ t: 'kick', reason: `Version mismatch (host ${PROTOCOL_V}, you ${m.v})` }, true); setTimeout(close, 500); return; }
            if (sim.players.size >= 4) { send({ t: 'kick', reason: 'Room full (4/4)' }, true); setTimeout(close, 500); return; }
            const pl = sim.addPlayer(m.name, false); pid = pl.id; (pl as any).cid = cid;
            hostSends.set(pid, send);
            send(sim.welcome(pl), true);
            return;
          }
          sim.onMessage(pid, m);
        };
      },
      onDisconnect: (cid) => { for (const pl of sim.players.values()) if ((pl as any).cid === cid) { sim.removePlayer(pl.id); hostSends.delete(pl.id); } },
    });
    const orig = sim.net.send;
    sim.net.send = (pid, m, rel = true) => { const s = hostSends.get(pid); if (s) s(m, rel); else orig(pid, m, rel); };
    this.room = used; this.roomShownAt = performance.now();
    probe('room_open', { room: used });
    return used;
  }
  private onUnload = (e: BeforeUnloadEvent) => { this.sim?.save.worldEnd(); if (this.sim && this.sim.players.size > 1) { e.preventDefault(); e.returnValue = 'Leaving ends the game for everyone'; } };

  private setupPointer() {
    const canvas = this.world.stage.canvas;
    const overlay = document.createElement('div'); overlay.id = 'clicktoplay'; overlay.textContent = 'Click to play'; document.body.appendChild(overlay);
    canvas.addEventListener('click', () => { if (!this.menuOpen && !this.con.open) canvas.requestPointerLock?.(); });
    overlay.addEventListener('click', () => canvas.requestPointerLock?.());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && !this.con.open && !this.menuOpen && !this.ended && this.worldReady && !this.opts.params.has('script')) this.openMenu();
    });
    addEventListener('keydown', (e) => { if (e.code === 'Backquote' && !this.con.open) { e.preventDefault(); this.con.toggle(); } });
  }
  openMenu() {
    if (this.menuOpen) return; this.menuOpen = true;
    const m = document.createElement('div'); m.id = 'escmenu';
    const link = this.room ? `${location.origin}${location.pathname}?join=${this.room}` : '';
    m.innerHTML = `<div class="panel"><h2>Paused (the game keeps running)</h2>
      <button data-a="resume">Resume</button>
      ${this.room ? `<div class="invite">Room <b>${this.room}</b><br><input readonly value="${link}"><button data-a="copy">Copy invite link</button></div>` : ''}
      <button data-a="controls">Controls</button><button data-a="leave">Leave game</button><div class="ctl"></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (a === 'resume') { this.menuOpen = false; m.remove(); this.world.stage.canvas.requestPointerLock?.(); }
      if (a === 'copy') navigator.clipboard?.writeText(link);
      if (a === 'controls') (m.querySelector('.ctl') as HTMLElement).innerHTML = CONTROLS_HTML;
      if (a === 'leave') { m.remove(); this.menuOpen = false; this.exit(); }
    });
  }
  shot(ui: boolean) {
    this.hud.hidden = !ui; this.hud.draw(this.client.hudView(undefined));
    probe('shot', { n: ++this.shotN, ui });
    setTimeout(() => { this.hud.hidden = false; }, 400);
  }
  private loop = () => {
    let last = performance.now();
    const frame = (now: number) => {
      if (this.ended) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const t0 = performance.now();
      const st = this.world.stage, c = this.client;
      const inputOn = !this.menuOpen && !this.con.open;
      if (!this.sim) this.phys.world.step();
      c.frame(dt, inputOn);
      this.world.view.update(st.camera.position.x, -st.camera.position.z);
      this.spotProps.sync(c.spots.values(), c.hostNow()); this.spotProps.updateLights(st.camera.position);
      updateWater(now / 1000);
      st.frame(now / 1000);
      const me = c.myRecNow();
      const v = c.hudView(me);
      if (this.room && performance.now() - this.roomShownAt < 10000) v.roomBanner = `Room ${this.room} - invite friends: ${location.origin}${location.pathname}?join=${this.room}`;
      this.fpsAcc.n++; this.fpsAcc.t += dt; if (this.fpsAcc.t >= 1) { this.fpsAcc.fps = this.fpsAcc.n / this.fpsAcc.t; this.fpsAcc.n = 0; this.fpsAcc.t = 0; }
      v.fps = this.opts.params.has('fps') || (window as any).__showFps ? Math.round(this.fpsAcc.fps) : null;
      this.hud.draw(v);
      this.audio.frame(dt);
      const ov = document.getElementById('clicktoplay');
      if (ov) ov.style.display = this.worldReady && !this.opts.params.has('script') && document.pointerLockElement !== st.canvas && !this.menuOpen && !this.con.open && c.director?.phase !== 'Escaped' ? 'flex' : 'none';
      if (!this.worldReady && me) {
        this.worldReady = true; (window as any).__ready = true;
        probe('world_ready', { host: this.opts.mode === 'host', draw_calls: st.renderer.info.render.calls, tris: st.renderer.info.render.triangles });
      }
      this.frameMs.push(performance.now() - t0); if (this.frameMs.length > 600) this.frameMs.shift();
      (window as any).__stats = { calls: st.renderer.info.render.calls, tris: st.renderer.info.render.triangles, fps: this.fpsAcc.fps };
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  };
  exit(msg?: string) {
    if (this.ended) return; this.ended = true;
    this.sim?.save.worldEnd();
    this.stopTicker?.(); cancelAnimationFrame(this.raf);
    removeEventListener('beforeunload', this.onUnload);
    try { this.client.link.close(); } catch { /* */ }
    this.opts.onExit(msg);
  }
}

export const CONTROLS_HTML = `<table class="controls">${[
  ['WASD + mouse', 'move / look'], ['hold Shift', 'sprint ×1.6 (×0.7 while carrying a bag)'], ['LMB / RMB', 'shoot / aim'], ['R', 'reload'], ['1–3', 'weapon slots'],
  ['E', 'use / confirm / hold up / get in when nothing else is in focus'], ['Up / Down', 'menu line'], ['F', 'car in/out'], ['W/S', 'throttle / brake-reverse (in a car)'],
  ['A/D', 'steer (in a car)'], ['Space', 'jump / handbrake (in a car)'], ['M', 'map'], ['Esc', 'menu'], ['`', 'dev console']].map(([k, a]) => `<tr><td>${k}</td><td>${a}</td></tr>`).join('')}</table>`;
export { THREE, E };
