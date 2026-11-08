// Roadblock geometry built on every machine from {x, y, yaw} (spec 03 §6).
import * as THREE from 'three';
import { buildProp } from './props/index';
import { buildVehicle } from './vehicles/index';
import { vertexColorMaterial } from './geo';
import { RB_BARRIERS, RB_JEEPS } from '../game/hunters';
import { probe } from '../core/probe';

export class RoadblockView {
  group = new THREE.Group();
  private key = '';
  constructor(scene: THREE.Scene) { scene.add(this.group); }
  set(recs: number[][], authority: boolean) {
    const k = JSON.stringify(recs); if (k === this.key) return; this.key = k;
    this.group.clear();
    for (const [x, y, yaw] of recs) {
      const g = new THREE.Group(); g.position.set(x, 0, -y); g.rotation.y = yaw; this.group.add(g);
      const local = (lx: number, ly: number) => new THREE.Vector3(lx, 0, ly); // local +Y (right) = three +z after rotation
      for (const by of RB_BARRIERS) {
        const m = new THREE.Mesh(buildProp('JerseyBarrier').geometry, vertexColorMaterial()); m.position.copy(local(0, by)); m.castShadow = true; g.add(m);
      }
      const white = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.5 }), red = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.6, 0.03, 0.02, THREE.LinearSRGBColorSpace), roughness: 0.5 });
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), white); post.position.set(0, 0.6, 9.3); g.add(post);
      const arm = new THREE.Group(); arm.position.set(0, 1.1, 9.3); arm.rotation.x = -75 * Math.PI / 180; g.add(arm);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 4.3), white); bar.position.set(0, 0, -2.15); arm.add(bar);
      for (const f of [0.2, 0.5, 0.8]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.6), red); st.position.set(0, 0, -4.3 * f); arm.add(st); }
      for (const [jx, jy, jyaw] of RB_JEEPS) { const j = buildVehicle('hunter_jeep'); j.root.position.copy(local(jx, jy)); j.root.rotation.y = -jyaw * Math.PI / 180; j.root.traverse((o) => { o.castShadow = true; }); g.add(j.root); }
      probe('roadblock_built', { authority, barriers: RB_BARRIERS.length, jeeps: RB_JEEPS.length, x: Math.round(x), y: Math.round(y) });
    }
  }
}
