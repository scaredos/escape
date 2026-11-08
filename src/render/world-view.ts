// Turns GenOutput into chunked InstancedMeshes (spec 06 §11) with per-layer distance culling.
import * as THREE from 'three';
import type { GenOutput } from '../world/types';
import { BOX, PROP } from '../world/types';
import type { Textures, TexSet } from './textures';
import { facadeMaterial, texturedMaterial, waterMaterial } from './materials';
import { buildProp, type PropName } from './props/index';
import { buildVehicle } from './vehicles/index';
import { vertexColorMaterial } from './geo';

const DEG = Math.PI / 180;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YZX'), _p = new THREE.Vector3(), _s = new THREE.Vector3();

/** Map-frame box record -> three matrix (unit cube scaled L,H,W). */
export function boxMatrix(a: ArrayLike<number>, o: number, out = _m): THREE.Matrix4 {
  _p.set(a[o], a[o + 2], -a[o + 1]);
  _e.set(a[o + 8] * DEG, a[o + 6] * DEG, -a[o + 7] * DEG, 'YZX');
  _q.setFromEuler(_e); _s.set(a[o + 3], a[o + 5], a[o + 4]);
  return out.compose(_p, _q, _s);
}
export function propMatrix(a: ArrayLike<number>, o: number, out = _m): THREE.Matrix4 {
  _p.set(a[o], a[o + 2], -a[o + 1]);
  _e.set(a[o + 5] * DEG, a[o + 3] * DEG, -a[o + 4] * DEG, 'YZX');
  _q.setFromEuler(_e); _s.set(a[o + 6], a[o + 8], a[o + 7]);
  return out.compose(_p, _q, _s);
}

interface Chunk { obj: THREE.Object3D; cx: number; cy: number; r: number; cull: number }

const CHUNK: Record<string, [number, number]> = { // layer -> [chunk size, cull distance]
  lot: [2000, 1e9], jstone: [2000, 1e9], sand: [2000, 1e9], fields: [2000, 1e9], beige: [2000, 1e9], desert: [2000, 1e9],
  village: [2000, 1e9], seabed: [4000, 1e9], mesa: [2000, 1e9], facade: [1000, 3200], asphalt: [1000, 1500], paving: [1000, 900],
  apron: [1000, 2000], lawn: [1000, 900], pier: [1000, 1500], facade_nc: [500, 1000],
};
const PROP_CULL: Record<string, number> = { Shrub: 500, 'Rock:small': 350, Rock: 700, Acacia: 800, Palm: 900, Ficus: 800,
  ContainerRed: 1500, ContainerBlue: 1500, ContainerGreen: 1500, ContainerGrey: 1500, PortCrane: 1e9, 'Hill:desert': 1e9,
  'Hill:fields': 1e9, 'Hill:beige': 1e9, StreetLamp: 700, SolarHeater: 700, WaterTank: 700, ACUnit: 350, Boat: 2000 };

export class WorldView {
  group = new THREE.Group();
  chunks: Chunk[] = [];
  private flatMat: THREE.MeshStandardMaterial;
  constructor(scene: THREE.Scene, private gen: GenOutput, private tex: Textures) {
    scene.add(this.group);
    this.flatMat = flatInstancedMaterial();
    const unit = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
    for (const def of gen.layers) {
      const data = gen.boxes[def.key]; if (!data?.length) continue;
      let mat: THREE.Material, geo: THREE.BufferGeometry = unit;
      if (def.kind === 'facade') mat = facadeMaterial(tex);
      else if (def.kind === 'textured') mat = texturedMaterial(tex, def.set as TexSet, def.tint ?? [1, 1, 1], def.tile ?? 4, def.rough ? { roughMul: def.rough / 0.5 } : undefined);
      else { mat = this.flatMat; if (def.kind === 'flatcyl') geo = cyl; }
      const [size, cull] = CHUNK[def.key] ?? [500, def.key.startsWith('fl_') || def.key === 'in_plaster' ? 500 : 700];
      this.buildBoxLayer(def.key, def.kind, data, geo, mat, size, cull, def.shadow);
    }
    for (const [name, data] of Object.entries(gen.props)) this.buildPropLayer(name, data);
    // sea surface: world rect + 400 m, top at -0.15
    const [x0, y0, x1, y1] = [-1500, -14500, 7500, 8500];
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 800, y1 - y0 + 800, 1, 1), waterMaterial(tex));
    const wm = sea.material as THREE.Material; wm.polygonOffset = true; wm.polygonOffsetFactor = 4; wm.polygonOffsetUnits = 16; // never z-fight the ground above it
    sea.renderOrder = 1;
    sea.rotation.x = -Math.PI / 2; sea.position.set((x0 + x1) / 2, -0.15, -(y0 + y1) / 2); sea.receiveShadow = true;
    sea.name = 'sea'; this.group.add(sea);
    this.buildSigns();
  }

  private buildBoxLayer(key: string, kind: string, data: Float32Array, geo: THREE.BufferGeometry, mat: THREE.Material, size: number, cull: number, shadow: boolean) {
    const n = data.length / BOX, buckets = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const o = i * BOX, k = Math.floor(data[o] / size) + ',' + Math.floor(data[o + 1] / size);
      let b = buckets.get(k); if (!b) buckets.set(k, (b = [])); b.push(o);
    }
    for (const [k, list] of buckets) {
      const [i, j] = k.split(',').map(Number);
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const tint = kind === 'facade' ? new Float32Array(list.length * 3) : null, stone = kind === 'facade' ? new Float32Array(list.length) : null;
      const rough = kind === 'flat' || kind === 'flatcyl' ? new Float32Array(list.length) : null;
      list.forEach((o, idx) => {
        mesh.setMatrixAt(idx, boxMatrix(data, o));
        if (tint) { tint[idx * 3] = data[o + 9]; tint[idx * 3 + 1] = data[o + 10]; tint[idx * 3 + 2] = data[o + 11]; stone![idx] = data[o + 12]; }
        if (rough) { mesh.setColorAt(idx, new THREE.Color(data[o + 9], data[o + 10], data[o + 11])); rough[idx] = data[o + 12]; }
      });
      if (tint) { geo = geo; mesh.geometry = geo.clone(); mesh.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3)); mesh.geometry.setAttribute('aStone', new THREE.InstancedBufferAttribute(stone!, 1)); }
      if (rough) { mesh.geometry = geo.clone(); mesh.geometry.setAttribute('iRough', new THREE.InstancedBufferAttribute(rough, 1)); }
      mesh.castShadow = shadow; mesh.receiveShadow = true;
      mesh.computeBoundingSphere(); mesh.name = key;
      this.add(mesh, (i + 0.5) * size, (j + 0.5) * size, size * 0.75, cull);
    }
  }

  private buildPropLayer(name: string, data: Float32Array) {
    const base = name.split(':')[0];
    if (base === 'vehicle') {
      for (let o = 0; o < data.length; o += PROP) {
        const v = buildVehicle(data.length && name.split(':')[1] as any, 'E8E6DF');
        v.root.position.set(data[o], data[o + 2], -data[o + 1]); v.root.rotation.y = data[o + 3] * DEG; v.root.traverse((c) => { c.castShadow = true; });
        this.group.add(v.root);
      }
      return;
    }
    const def = buildProp(base as PropName);
    let mat: THREE.Material = vertexColorMaterial();
    if (base === 'Hill') {
      const sub = name.split(':')[1];
      mat = sub === 'fields' ? texturedMaterial(this.tex, 'grass', [1, 1, 1], 6) : sub === 'beige' ? texturedMaterial(this.tex, 'grass', [1, 0.88, 0.68], 6) : texturedMaterial(this.tex, 'desert', [1, 1, 1], 8);
    } else if (base === 'Rock') mat = texturedMaterial(this.tex, 'desert', [0.95, 0.9, 0.84], 4);
    const cull = PROP_CULL[name] ?? 600, size = cull > 5000 ? 2000 : 500;
    const buckets = new Map<string, number[]>();
    for (let o = 0; o < data.length; o += PROP) {
      const k = Math.floor(data[o] / size) + ',' + Math.floor(data[o + 1] / size);
      let b = buckets.get(k); if (!b) buckets.set(k, (b = [])); b.push(o);
    }
    const small = ['Shrub', 'Rock:small', 'ACUnit', 'SolarHeater', 'WaterTank', 'Lounger'].includes(name);
    for (const [k, list] of buckets) {
      const [i, j] = k.split(',').map(Number);
      const mesh = new THREE.InstancedMesh(def.geometry, mat, list.length);
      list.forEach((o, idx) => mesh.setMatrixAt(idx, propMatrix(data, o)));
      mesh.castShadow = !small && base !== 'Hill'; mesh.receiveShadow = true; mesh.name = name;
      mesh.computeBoundingSphere();
      this.add(mesh, (i + 0.5) * size, (j + 0.5) * size, size * 0.75, cull);
    }
  }

  private buildSigns() {
    for (const s of this.gen.signs) {
      const c = document.createElement('canvas'), ctx = c.getContext('2d')!;
      const px = 64; ctx.font = `bold ${px}px Roboto, Arial, sans-serif`;
      const tw = ctx.measureText(s.text).width / px * 1.3;           // text width in metres at 1.3 m letter height
      const span = s.w, text = Math.min(tw, span - 1.2), boardW = Math.max(Math.min(5.4, span), Math.min(text + 1.2, span));
      c.width = Math.ceil(boardW * 64); c.height = Math.ceil(1.9 * 64);
      ctx.fillStyle = '#' + s.board; ctx.fillRect(0, 0, c.width, c.height);
      if (s.edging) { ctx.strokeStyle = '#' + s.edging; ctx.lineWidth = 8; ctx.strokeRect(4, 4, c.width - 8, c.height - 8); }
      ctx.fillStyle = '#' + s.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.floor(1.3 * 64 * (text / tw))}px Roboto, Arial, sans-serif`;
      ctx.fillText(s.text, c.width / 2, c.height / 2 + 4);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const board = new THREE.Mesh(new THREE.BoxGeometry(boardW, 1.9, 0.2), [0, 1, 2, 3].map(() => new THREE.MeshStandardMaterial({ color: new THREE.Color('#' + s.board), roughness: 0.6 }))
        .concat([new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: new THREE.Color('#' + s.board) })]));
      // the box's +z face carries the text: face it along the door direction
      const yaw = s.yaw * DEG;
      board.position.set(s.x - Math.cos(yaw) * 0.12, s.z, -(s.y - Math.sin(yaw) * 0.12));
      board.rotation.y = Math.atan2(Math.cos(yaw), -Math.sin(yaw)); // box +z face (text) along the door direction
      board.castShadow = true;
      this.add(board, s.x, s.y, 3, 800);
    }
  }

  private add(obj: THREE.Object3D, cx: number, cy: number, r: number, cull: number) {
    this.group.add(obj); this.chunks.push({ obj, cx, cy, r, cull });
  }
  /** Distance culling around the camera (map coords). */
  update(camX: number, camY: number) {
    for (const c of this.chunks) c.obj.visible = Math.hypot(c.cx - camX, c.cy - camY) - c.r < c.cull;
  }
}

/** Flat instanced boxes: colour from instanceColor, roughness from the iRough instance attribute. */
function flatInstancedMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float iRough;\nvarying float vRough;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = iRough;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRough;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;');
  };
  m.customProgramCacheKey = () => 'flatinst';
  return m;
}
