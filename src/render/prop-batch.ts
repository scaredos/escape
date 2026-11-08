// All vertex-coloured props in ONE BatchedMesh (multi-draw): one draw call (+ shadow) for ~100k instances.
// Per-instance detail/LOD geometry and distance culling are refreshed from a 100 m grid when the camera moves.
import * as THREE from 'three';
import { PROP } from '../world/types';
import { buildProp, buildPropLOD, type PropName } from './props/index';
import { vertexColorMaterial } from './geo';
import { propMatrix } from './world-view';

const CELL = 100;
export class PropBatch {
  mesh: THREE.BatchedMesh;
  private cells = new Map<number, number[]>();        // cell -> instance ids
  private inst: { cx: number; cy: number; det: number; lod: number; lodD: number; cull: number; vis: boolean; isLod: boolean }[] = [];
  private active = new Set<number>(); private lastX = 1e9; private lastY = 1e9; private maxCull = 0;
  constructor(scene: THREE.Scene, layers: [string, Float32Array][], lodDist: (name: string) => number, cullDist: (name: string) => number) {
    let nInst = 0, nVert = 0, nIdx = 0;
    const geos: { name: string; det: THREE.BufferGeometry; lod: THREE.BufferGeometry }[] = [];
    for (const [name, data] of layers) {
      const det = buildProp(name as PropName).geometry, lod = buildPropLOD(name as PropName);
      geos.push({ name, det, lod }); nInst += data.length / PROP;
      for (const g of [det, lod]) { nVert += g.attributes.position.count; nIdx += g.index ? g.index.count : g.attributes.position.count; }
    }
    this.mesh = new THREE.BatchedMesh(nInst, nVert, nIdx, vertexColorMaterial());
    this.mesh.perObjectFrustumCulled = true; this.mesh.sortObjects = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.name = 'props';
    const m = new THREE.Matrix4();
    layers.forEach(([name, data], li) => {
      const g = geos[li], det = this.mesh.addGeometry(g.det), lod = g.det === g.lod ? det : this.mesh.addGeometry(g.lod);
      const lodD = lodDist(name), cull = cullDist(name); this.maxCull = Math.max(this.maxCull, Math.min(cull, 3000));
      for (let o = 0; o < data.length; o += PROP) {
        const id = this.mesh.addInstance(lod);
        this.mesh.setMatrixAt(id, propMatrix(data, o, m));
        this.mesh.setVisibleAt(id, false);
        const cx = data[o], cy = data[o + 1];
        this.inst[id] = { cx, cy, det, lod, lodD, cull, vis: false, isLod: true };
        const k = this.key(Math.floor(cx / CELL), Math.floor(cy / CELL));
        let c = this.cells.get(k); if (!c) this.cells.set(k, (c = [])); c.push(id);
      }
    });
    scene.add(this.mesh);
  }
  private key(i: number, j: number) { return (i + 1000) * 4000 + (j + 1000); }
  /** Refresh visibility + LOD for instances around the camera (map coords). Cheap when the camera barely moved. */
  update(x: number, y: number) {
    if (Math.hypot(x - this.lastX, y - this.lastY) < 15) return;
    this.lastX = x; this.lastY = y;
    const R = this.maxCull + CELL, ci = Math.floor(x / CELL), cj = Math.floor(y / CELL), n = Math.ceil(R / CELL);
    const now = new Set<number>();
    for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) { const k = this.key(i, j); if (this.cells.has(k)) now.add(k); }
    for (const k of this.active) if (!now.has(k)) for (const id of this.cells.get(k)!) this.set(id, false, true);
    for (const k of now) for (const id of this.cells.get(k)!) {
      const s = this.inst[id], d = Math.hypot(s.cx - x, s.cy - y);
      this.set(id, d < s.cull, d >= s.lodD);
    }
    this.active = now;
  }
  private set(id: number, vis: boolean, lod: boolean) {
    const s = this.inst[id];
    if (s.vis !== vis) { s.vis = vis; this.mesh.setVisibleAt(id, vis); }
    if (vis && s.isLod !== lod) { s.isLod = lod; this.mesh.setGeometryIdAt(id, lod ? s.lod : s.det); }
  }
}
