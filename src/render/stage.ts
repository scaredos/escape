// Renderer, scene, sky, sun, fog and post grade (spec 06 §2).
import * as THREE from 'three';

export type Quality = 'low' | 'medium' | 'high';
export const QUALITY: Record<Quality, { tex: 512 | 1024; shadow: number; pixelRatio: number; clouds: boolean }> = {
  low: { tex: 512, shadow: 1024, pixelRatio: 1, clouds: false },
  medium: { tex: 512, shadow: 2048, pixelRatio: Math.min(devicePixelRatio, 2), clouds: true },
  high: { tex: 1024, shadow: 2048, pixelRatio: Math.min(devicePixelRatio, 2), clouds: true },
};

// sun: elevation 50 deg, standing at bearing 215 (SW). Direction TO the sun in map frame (x east, y north, z up)
const EL = 50 * Math.PI / 180, AZ = 215 * Math.PI / 180;
export const SUN_DIR = new THREE.Vector3(Math.sin(AZ) * Math.cos(EL), Math.sin(EL), -Math.cos(AZ) * Math.cos(EL)).normalize(); // three frame

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(80, 1, 0.1, 3000);
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  constructor(public canvas: HTMLCanvasElement, public quality: Quality) {
    const q = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(q.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.fog = new THREE.FogExp2(0xd9d2c4, 0.00045);
    this.sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1, 0.93, 0.82, THREE.LinearSRGBColorSpace), 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
    const c = this.sun.shadow.camera; c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 1; c.far = 400;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd4ea, 0xc8b394, 1.0);
    this.scene.add(this.hemi);
    this.sky = makeSky(q.clouds);
    this.scene.add(this.sky);
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  /** Shadow box follows the camera; sky follows the camera. */
  frame(time: number) {
    const p = this.camera.position;
    const snap = 2; // texel snapping to reduce shimmer
    const tx = Math.round(p.x / snap) * snap, tz = Math.round(p.z / snap) * snap;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + SUN_DIR.x * 200, SUN_DIR.y * 200, tz + SUN_DIR.z * 200);
    this.sky.position.copy(p);
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    this.renderer.render(this.scene, this.camera);
  }
}

function makeSky(clouds: boolean) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uClouds: { value: clouds ? 1 : 0 }, uSun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: `
      varying vec3 vDir; uniform float uTime; uniform float uClouds; uniform vec3 uSun;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
      vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
      void main(){
        vec3 d = normalize(vDir); float e = clamp(d.y, -0.2, 1.);
        vec3 zen = toLin(vec3(0x5D,0x8C,0xC6)/255.), hor = toLin(vec3(0xC9,0xD3,0xD8)/255.), haze = toLin(vec3(0xD9,0xD2,0xC4)/255.);
        vec3 col = mix(hor, zen, pow(max(e,0.), 0.55));
        col = mix(col, haze, smoothstep(0.08, -0.02, e));
        float sd = max(dot(d, normalize(uSun)), 0.); col += vec3(1.,.93,.82) * (pow(sd, 600.) * 6. + pow(sd, 8.) * .12);
        if (uClouds > .5 && d.y > 0.02) {
          vec2 uv = d.xz / (d.y + .12) * 1.6 + vec2(uTime * .004, uTime*.002);
          float c = fbm(uv) ; c = smoothstep(.52, .78, c) * smoothstep(0.02, 0.2, d.y);
          vec3 cc = mix(vec3(1.), toLin(vec3(.78,.8,.84)), smoothstep(.6,.95,fbm(uv*1.7+3.)));
          col = mix(col, cc * 1.05, c * .9);
        }
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), mat);
  m.frustumCulled = false; m.renderOrder = -1;
  return m;
}
