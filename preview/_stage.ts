// Shared preview stage for vehicles.html / characters.html: renderer, sky-blue background, SW sun at 50°, hemi light.
import * as THREE from 'three';
export function stage(shadowHalf = 20) {
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setSize(innerWidth, innerHeight);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.8;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.style.margin = '0';
  document.body.appendChild(r.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc3e6);
  scene.add(new THREE.HemisphereLight(0xbfd4ea, 0xc8b394, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 3.0);
  sun.color.setRGB(1, 0.93, 0.82, THREE.LinearSRGBColorSpace);
  const az = 215 * Math.PI / 180, el = 50 * Math.PI / 180; // bearing 215° (SW); three: +X east, -Z north
  sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(60);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -shadowHalf, right: shadowHalf, top: shadowHalf, bottom: -shadowHalf, near: 1, far: 200 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0xcbc3b4, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 500);
  return { r, scene, cam, sun };
}
export const params = new URLSearchParams(location.search);
