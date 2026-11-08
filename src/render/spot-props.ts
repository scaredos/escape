// Dynamic spot props drawn from the replicated spot table (crates open/closed, vaults shut/open, cash bags),
// plus the venue point lights near the camera (spec 01 §13 lights, 06 §2: only within ~40 m).
import * as THREE from 'three';
import type { SpotState } from '../game/protocol';
import type { LightInfo } from '../world/types';
import { buildProp } from './props/index';
import { vertexColorMaterial } from './geo';

export class SpotProps {
  group = new THREE.Group();
  private objs = new Map<number, { mesh: THREE.Mesh; key: string }>();
  private lights: THREE.PointLight[] = [];
  constructor(scene: THREE.Scene, private hallLights: LightInfo[]) {
    scene.add(this.group);
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(new THREE.Color().setRGB(1, 0.9, 0.75, THREE.LinearSRGBColorSpace), 0, 30, 1.2);
      l.castShadow = false; l.visible = false; this.lights.push(l); scene.add(l);
    }
  }
  sync(spots: Iterable<SpotState>, hostNow: number) {
    const seen = new Set<number>();
    for (const s of spots) {
      let prop = '';
      if (s.mode === 'crate') prop = s.available ? 'Crate' : 'CrateOpen';
      else if (s.mode === 'bank') prop = s.available ? 'Vault' : 'VaultOpen';
      else if (s.mode === 'bag') prop = 'CashBag';
      if (!prop) continue;
      seen.add(s.id);
      const key = prop;
      let o = this.objs.get(s.id);
      if (!o || o.key !== key) {
        if (o) o.mesh.removeFromParent();
        const mesh = new THREE.Mesh(buildProp(prop as any).geometry, vertexColorMaterial());
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.position.set(s.x, 0.02, -s.y); mesh.rotation.y = Math.atan2(s.fy, s.fx);
        this.group.add(mesh); o = { mesh, key }; this.objs.set(s.id, o);
      }
    }
    for (const [id, o] of this.objs) if (!seen.has(id)) { o.mesh.removeFromParent(); this.objs.delete(id); }
    void hostNow;
  }
  updateLights(cam: THREE.Vector3) {
    const near = this.hallLights.map((l) => ({ l, d: Math.hypot(l.x - cam.x, l.y + cam.z) })).filter((a) => a.d < 40 + a.l.radius * 0.5).sort((a, b) => a.d - b.d);
    this.lights.forEach((pl, i) => {
      const a = near[i];
      pl.visible = !!a;
      if (a) { pl.position.set(a.l.x, a.l.z, -a.l.y); pl.distance = a.l.radius * 1.3; pl.intensity = 7000 / (4 * Math.PI) * 0.06; }
    });
  }
}
