// Shot and explosion effects (spec 06 §10, explosion addendum). No gore: dust puffs and white flashes only.
import * as THREE from 'three';

interface Item { obj: THREE.Object3D; until: number; t0: number; kind: string; extra?: any }
export class Fx {
  group = new THREE.Group();
  items: Item[] = [];
  private tracerMat = new THREE.LineBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.9 });
  private flashMat = new THREE.SpriteMaterial({ color: 0xffe9a8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  private puffMat = new THREE.SpriteMaterial({ color: 0x9c968c, transparent: true, opacity: 0.6, depthWrite: false });
  private fireMat = new THREE.MeshBasicMaterial({ color: 0xffb347, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  private dustMat = new THREE.SpriteMaterial({ color: 0x8c857a, transparent: true, opacity: 0.5, depthWrite: false });
  constructor(scene: THREE.Scene) { scene.add(this.group); }
  /** origin/ends in three coords */
  shot(origin: THREE.Vector3, ends: THREE.Vector3[], now: number) {
    for (const e of ends) {
      const g = new THREE.BufferGeometry().setFromPoints([origin, e]);
      const l = new THREE.Line(g, this.tracerMat); this.add(l, now, 0.06, 'tracer');
      const p = new THREE.Sprite(this.puffMat); p.position.copy(e); p.scale.setScalar(0.4); this.add(p, now, 0.5, 'puff');
    }
    const f = new THREE.Sprite(this.flashMat); f.position.copy(origin); f.scale.setScalar(0.25); this.add(f, now, 0.05, 'flash');
  }
  blast(pos: THREE.Vector3, now: number) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), this.fireMat.clone()); s.position.copy(pos); this.add(s, now, 0.5, 'fire');
    for (let i = 0; i < 12; i++) {
      const d = new THREE.Sprite(this.dustMat.clone()); d.position.copy(pos);
      this.add(d, now, 1.5, 'dust', new THREE.Vector3(Math.cos(i * 0.52), 0.6 + (i % 3) * 0.3, Math.sin(i * 0.52)));
    }
    const light = new THREE.PointLight(0xffb060, 400, 40); light.position.copy(pos); this.add(light, now, 0.1, 'light');
  }
  private add(obj: THREE.Object3D, now: number, life: number, kind: string, extra?: any) { this.group.add(obj); this.items.push({ obj, until: now + life, t0: now, kind, extra }); }
  update(now: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i], k = (now - it.t0) / (it.until - it.t0);
      if (now >= it.until) { it.obj.removeFromParent(); (it.obj as any).geometry?.dispose?.(); this.items.splice(i, 1); continue; }
      if (it.kind === 'puff') it.obj.scale.setScalar(0.4 + k * 0.8);
      if (it.kind === 'fire') { it.obj.scale.setScalar(Math.min(1, k / 0.3) * 4); ((it.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1 - k; }
      if (it.kind === 'dust') { const e = it.extra as THREE.Vector3; it.obj.position.addScaledVector(e, 0.08); it.obj.scale.setScalar(1 + k * 7); ((it.obj as THREE.Sprite).material as THREE.SpriteMaterial).opacity = 0.5 * (1 - k); }
    }
  }
}
