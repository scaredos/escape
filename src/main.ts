// Boot: load the pack, generate the world in a worker, bake textures, build the view.
import * as THREE from 'three';
import { loadPack, generateInWorker } from './data/pack';
import { Stage, type Quality } from './render/stage';
import { bakeTextures } from './render/textures';
import { WorldView } from './render/world-view';
import { probe } from './core/probe';
import { updateWater } from './render/materials';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
app.innerHTML = `<canvas id="gl"></canvas><div id="boot"><div class="t">Escape Israel</div><div class="bar"><i></i></div><div class="l">Loading Israel… 0%</div></div>`;
const bootBar = app.querySelector('#boot i') as HTMLElement, bootLbl = app.querySelector('#boot .l') as HTMLElement;
const setBoot = (f: number) => { bootBar.style.width = (f * 100).toFixed(0) + '%'; bootLbl.textContent = `Loading Israel… ${Math.round(f * 100)}%`; };

async function boot() {
  const quality = (params.get('quality') as Quality) || 'medium';
  const stage = new Stage(app.querySelector('#gl') as HTMLCanvasElement, quality);
  const t0 = performance.now();
  const pack = await loadPack((f) => setBoot(f * 0.2));
  const [gen, tex] = await Promise.all([
    generateInWorker(pack, (f) => setBoot(0.2 + f * 0.6)),
    bakeTextures(stage.renderer, quality === 'high' ? 1024 : 512),
  ]);
  setBoot(0.9);
  const view = new WorldView(stage.scene, gen, tex);
  const genMs = Math.round(performance.now() - t0);
  probe('city_built', { ...gen.stats, ms_total: genMs, colliders: gen.colliders.length / 7 });
  (app.querySelector('#boot') as HTMLElement).remove();
  (window as any).__world = { gen, stage, view, pack };

  // ---- free-fly camera (milestone 1 tool): ?cam=x,y,height,bearingDeg,pitchDeg
  const cam = stage.camera;
  const c = (params.get('cam') || '1164,1200,40,0,-25').split(',').map(Number);
  let yaw = c[3] * Math.PI / 180, pitch = c[4] * Math.PI / 180;
  cam.position.set(c[0], c[2], -c[1]);
  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.code)); addEventListener('keyup', (e) => keys.delete(e.code));
  stage.canvas.addEventListener('click', () => stage.canvas.requestPointerLock());
  addEventListener('mousemove', (e) => { if (document.pointerLockElement) { yaw += e.movementX * 0.002; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.002)); } });
  let last = performance.now(), frames = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const fwd = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const sp = (keys.has('ShiftLeft') ? 200 : 40) * dt;
    if (keys.has('KeyW')) cam.position.addScaledVector(fwd, sp); if (keys.has('KeyS')) cam.position.addScaledVector(fwd, -sp);
    if (keys.has('KeyD')) cam.position.addScaledVector(right, sp); if (keys.has('KeyA')) cam.position.addScaledVector(right, -sp);
    cam.lookAt(cam.position.clone().add(fwd));
    view.update(cam.position.x, -cam.position.z);
    updateWater(now / 1000);
    stage.frame(now / 1000);
    if (++frames === 3) { probe('world_ready', { host: true, draw_calls: stage.renderer.info.render.calls, tris: stage.renderer.info.render.triangles }); (window as any).__ready = true; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
boot().catch((e) => { console.error(e); bootLbl.textContent = 'Error: ' + e.message; });
