// Contact sheet of the procedural props (spec 06 §9): one framed 3/4 orthographic view per prop, like kit/screenshots/props_sheet*.jpg.
import * as THREE from 'three';
import { vertexColorMaterial } from '../src/render/geo';
import { buildProp, PROP_NAMES } from '../src/render/props/index';

const page = Number(document.body.dataset.page ?? '1'), PER = 20, COLS = 5;
const names = PROP_NAMES.slice((page - 1) * PER, page * PER);
const rows = Math.ceil(names.length / COLS);
const W = innerWidth, H = innerHeight, cw = Math.floor(W / COLS), ch = Math.floor(H / rows), strip = 22;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H); renderer.setScissorTest(true);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.8;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene(); scene.background = new THREE.Color(0xa9c6e4);
scene.add(new THREE.HemisphereLight(0xbfd4ea, 0xc8b394, 1.0));
const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1, 0.93, 0.82), 3.0);
// sun at bearing 215 deg (south-west), elevation 50 deg; world north = three -Z
const az = 215 * Math.PI / 180, el = 50 * Math.PI / 180;
const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe6dfcc, roughness: 0.95 }));
ground.receiveShadow = true; scene.add(ground);

const view = new THREE.Vector3(1, 0.6, 0.95).normalize(); // source (1, -0.95, 0.6): from front-right, above
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
const mesh = new THREE.Mesh(undefined, vertexColorMaterial()); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);

names.forEach((name, i) => {
  const d = buildProp(name), g = d.geometry;
  mesh.geometry = g;
  const bb = g.boundingBox!, c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3()), rad = size.length() / 2;
  ground.scale.setScalar(rad * 20); ground.position.set(c.x, Math.min(0, bb.min.y), c.z);
  cam.position.copy(c).addScaledVector(view, rad * 4); cam.lookAt(c); cam.updateMatrixWorld();
  // fit the 8 bbox corners into the cell (minus the label strip)
  const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => new THREE.Vector3(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(cam.matrixWorldInverse));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const aspect = cw / (ch - strip), hw = Math.max((Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2 * aspect) * 1.12;
  const mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = (Math.max(...ys) + Math.min(...ys)) / 2, hh = hw / aspect;
  const extra = (hh * 2 * strip) / (ch - strip);
  cam.left = mx - hw; cam.right = mx + hw; cam.top = my + hh; cam.bottom = my - hh - extra; cam.far = rad * 10; cam.updateProjectionMatrix();
  sun.position.copy(c).addScaledVector(sunDir, rad * 3); sun.target.position.copy(c);
  Object.assign(sun.shadow.camera, { left: -rad * 1.5, right: rad * 1.5, top: rad * 1.5, bottom: -rad * 1.5, near: 0.01, far: rad * 8 });
  sun.shadow.camera.updateProjectionMatrix(); sun.shadow.needsUpdate = true;
  const col = i % COLS, row = Math.floor(i / COLS), x = col * cw, y = H - (row + 1) * ch;
  renderer.setViewport(x, y, cw - 1, ch - 1); renderer.setScissor(x, y, cw - 1, ch - 1);
  renderer.render(scene, cam);
  const label = document.createElement('div');
  label.textContent = `${name}  ${d.size[2].toFixed(1)} m  ${g.attributes.position.count / 3} tris`;
  Object.assign(label.style, { position: 'absolute', left: `${x}px`, top: `${(row + 1) * ch - strip}px`, width: `${cw}px`, textAlign: 'center',
    font: '12px sans-serif', color: '#222' });
  document.body.appendChild(label);
  console.log(`PROP ${name} tris=${g.attributes.position.count / 3} size=${d.size.join('x')} colliders=${d.colliders.length}`);
});
(window as unknown as { __ready: boolean }).__ready = true;
