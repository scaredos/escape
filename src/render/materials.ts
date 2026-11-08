// World materials (spec 06 §5): MeshStandardMaterial patched through onBeforeCompile, so lights, shadows and fog
// keep working. Textured = box projection along the instance's own axes (§5.2), facade = the building painter
// (§5.3), water = two scrolling normal layers with a fresnel colour (§5.4), flat = cached colour + roughness (§5.1).
import * as THREE from 'three';
import type { Textures, TexSet } from './textures';

type Shader = THREE.WebGLProgramParametersWithUniforms;

// World position, world normal and the instance's axes (ax = local x, up = local y, ay = source +y = local -z).
// The normal uses R·S⁻¹ (columns divided by their squared length), exact for rotation·scale without shear.
const V_DECL = /* glsl */ `
varying vec3 vW; varying vec3 vNw; varying vec3 vAx; varying vec3 vAy; varying vec3 vUpA;`;
const V_BODY = /* glsl */ `
#ifdef USE_INSTANCING
  mat4 xM = modelMatrix * instanceMatrix;
#else
  mat4 xM = modelMatrix;
#endif
  vec3 xc0 = xM[0].xyz, xc1 = xM[1].xyz, xc2 = xM[2].xyz;
  vW = (xM * vec4(transformed, 1.)).xyz;
  vNw = normalize(mat3(xM) * (objectNormal / vec3(dot(xc0, xc0), dot(xc1, xc1), dot(xc2, xc2))));
  vAx = normalize(xc0); vUpA = normalize(xc1); vAy = -normalize(xc2);`;
/** Tangent-space normal (tU, tV = world directions of +u, +v) -> view-space `normal`. */
const toViewNormal = (t: string, tU: string, tV: string, N: string) => /* glsl */ `
  normal = normalize((viewMatrix * vec4(normalize(${t}.x * ${tU} + ${t}.y * ${tV} + sqrt(max(0., 1. - dot(${t}, ${t}))) * ${N}), 0.)).xyz);`;

function patch(mat: THREE.MeshStandardMaterial, key: string, uniforms: Record<string, THREE.IUniform>,
  v: { decl: string; body: string }, f: { decl: string; map: string; rough: string; normal: string }) {
  mat.onBeforeCompile = (s: Shader) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${v.decl}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${v.body}`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${f.decl}`)
      .replace('#include <map_fragment>', f.map)
      .replace('#include <roughnessmap_fragment>', f.rough)
      .replace('#include <normal_fragment_maps>', f.normal);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// ---------------------------------------------------------------- 5.2 textured
export function texturedMaterial(t: Textures, set: TexSet, tint: THREE.ColorRepresentation | [number, number, number],
  tileMetres: number, opts?: { roughMul?: number }): THREE.MeshStandardMaterial {
  const c = Array.isArray(tint) ? new THREE.Color().setRGB(tint[0], tint[1], tint[2]) : new THREE.Color(tint);
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  return patch(mat, 'esc-textured', {
    uBC: { value: t.sets[set].bc }, uNR: { value: t.sets[set].nr }, uTint: { value: c },
    uTileM: { value: tileMetres }, uRoughMul: { value: opts?.roughMul ?? 1 },
  }, { decl: V_DECL, body: V_BODY }, {
    decl: `${V_DECL}\nuniform sampler2D uBC, uNR; uniform vec3 uTint; uniform float uTileM, uRoughMul;`,
    map: /* glsl */ `
  vec3 xN = normalize(vNw), xax = normalize(vAx), xay = normalize(vAy), xup = normalize(vUpA);
  vec3 xnl = vec3(dot(xN, xax), dot(xN, xay), dot(xN, xup)), xan = abs(xnl), xsg = sign(xnl + 1e-6);
  vec3 xbu = xax, xbv = xay;                                               // top / bottom faces
  if (xan.x >= xan.y && xan.x >= xan.z) { xbu = -xsg.x * xay; xbv = -xup; }
  else if (xan.y >= xan.z)              { xbu =  xsg.y * xax; xbv = -xup; }
  vec2 xuv = vec2(dot(vW, xbu), dot(vW, xbv)) / uTileM;
  vec3 xdx = dFdx(vW), xdy = dFdy(vW);                                     // gradients from W: no seams at face edges
  vec2 xgx = vec2(dot(xdx, xbu), dot(xdx, xbv)) / uTileM, xgy = vec2(dot(xdy, xbu), dot(xdy, xbv)) / uTileM;
  vec4 xNR = textureGrad(uNR, xuv, xgx, xgy);
  float xdrift = sin(vW.x / 17. + sin(vW.z / 23.)) + sin(vW.z / 13. + 1.7 * sin(vW.x / 29.));
  diffuseColor.rgb *= textureGrad(uBC, xuv, xgx, xgy).rgb * uTint * (1. + .04 * xdrift);`,
    rough: 'float roughnessFactor = roughness * xNR.b * uRoughMul;',
    normal: `vec2 xt = xNR.rg * 2. - 1.;${toViewNormal('xt', 'xbu', 'xbv', 'xN')}`,
  });
}

// ---------------------------------------------------------------- 5.3 facade
const FACADE_VARY = /* glsl */ `${V_DECL}
varying vec3 vQ; varying vec3 vNl; flat varying vec3 vS; flat varying vec3 vTint; flat varying float vStone;`;
const FACADE_V_DECL = `${FACADE_VARY}
attribute vec3 aTint; attribute float aStone;`;
// Spec box axes: x = length (three local x), y = width (three local -z), z = up (three local y).
const FACADE_V_BODY = /* glsl */ `${V_BODY}
  vS = vec3(length(xc0), length(xc2), length(xc1));
  vQ = vec3((position.x + .5) * vS.x, (.5 - position.z) * vS.y, (position.y + .5) * vS.z);
  vNl = vec3(objectNormal.x, -objectNormal.z, objectNormal.y);
  vTint = aTint; vStone = aStone;`;
const FACADE_MAP = /* glsl */ `
  const vec3 UP = vec3(0., 1., 0.);
  const vec3 PAL[5] = vec3[5](vec3(.02, .02, .02), vec3(.45, .04, .03), vec3(.02, .1, .3), vec3(.03, .18, .07), vec3(.8, .78, .72));
  vec3 xN = normalize(vNw), S = vS, q = vQ, nl = vNl, tint = vTint, ax = normalize(vAx), ay = normalize(vAy);
  float stone = vStone;
  vec3 Sc = S * 100.;                                                       // hash in centimetres (matches the source)
  vec3 k = fract(vec3(Sc.x * .731 + Sc.y * .317, Sc.z * .513 + stone * 7.1, dot(tint, vec3(31.7, 57.1, 71.3))) * .1031);
  k += dot(k, k.zyx + 31.32);
  float hb = fract((k.x + k.y) * k.z), hb2 = fract(hb * 173.31 + .27), hb3 = fract(hb * 371.17 + .61);
  bool endFace = abs(nl.x) > abs(nl.y);
  float Wd = endFace ? S.y : S.x, H = S.z, z = q.z;
  vec3 tU = cross(UP, xN); tU = dot(tU, tU) > 1e-6 ? normalize(tU) : ax; vec3 tV = -UP;   // tU = viewer's right
  float u = endFace ? (dot(tU, ay) > 0. ? q.y : S.y - q.y) : (dot(tU, ax) > 0. ? q.x : S.x - q.x);
  vec3 xdx = dFdx(vW), xdy = dFdy(vW);
  vec2 uvW = vec2(dot(vW, tU), -vW.y) / 4.;                                 // 4 m world-aligned wall tiles
  vec2 gWx = vec2(dot(xdx, tU), -xdx.y) / 4., gWy = vec2(dot(xdy, tU), -xdy.y) / 4.;
  vec4 pNR = textureGrad(uPNR, uvW, gWx, gWy), sNR = textureGrad(uSNR, uvW, gWx, gWy);
  float lt = max(dot(tint, vec3(.2126, .7152, .0722)), .05);
  vec3 wallC = mix(textureGrad(uPBC, uvW, gWx, gWy).rgb * tint, textureGrad(uSBC, uvW, gWx, gWy).rgb * mix(vec3(1.), tint / lt, .35), stone);
  vec2 wallN = mix(pNR.rg, sNR.rg, stone) * 2. - 1.; float wallR = mix(pNR.b, sNR.b, stone);
  vec3 col = wallC; vec2 tn = wallN; float fr = wallR;
  bool wall = abs(nl.z) < .5;
  if (wall && H > 2.5 && Wd > 1.8) {
    float nF = max(1., floor(H / 3.2 + .5)), fh = H / nF, nB = max(1., floor(Wd / 2.8 + .5)), bw = Wd / nB;
    float bay = clamp(floor(u / bw), 0., nB - 1.), flo = clamp(floor(z / fh), 0., nF - 1.);
    float cu = u / bw - bay, cz = z / fh - flo;
    vec3 c = fract(vec3(bay, flo, hb * 97.) * .1031); c += dot(c, c.zyx + 31.32); float hcell = fract((c.x + c.y) * c.z);
    c = fract(vec3(bay, hb * 89., nB) * .1031);         c += dot(c, c.zyx + 31.32); float hcol = fract((c.x + c.y) * c.z);
    if (flo < .5 && hb3 < .4 && Wd > 3.5) {                                 // shopfront on ~40% of ground floors
      float e = min(cu, 1. - cu) * bw, top = fh - .70;
      if (z > top) { col = z > fh - .12 ? wallC * .75 : PAL[int(hb2 * 4.99)]; fr = .45; tn = vec2(0.); }   // fascia
      else if (e < .10) col = wallC * .92;                                                                // pier
      else if (e < .16 || z < .12 || z > top - .06 || abs(cu - .5) * bw < .03) { col = vec3(.06, .06, .065); fr = .35; tn = vec2(0.); } // frame
      else if (hcell < .25) { float sl = 6.2832 * z / .09; col = vec3(.45, .46, .47) * (.9 + .1 * sin(sl)); fr = .45; tn = vec2(0., .3 * cos(sl)); } // roller shutter
      else { float g = clamp((z - .12) / (top - .18), 0., 1.); col = mix(vec3(.02, .025, .03), vec3(.09, .11, .13), g * g); fr = .05; tn = vec2(0.); } // dark glass
    } else {
      float cell = (flo > .5 && hcol < mix(.1, .4, hb2)) ? 2. : (hcell < .5 ? 0. : (hcell < .82 ? 1. : 3.));
      vec2 uvA = (vec2(mod(cell, 2.), floor(cell * .5)) + vec2(cu, 1. - cz)) * .5;
      vec2 cont = vec2(u / bw, -z / fh) * .5;                               // continuous: no mip seams at bay borders
      vec2 gAx = dFdx(cont), gAy = dFdy(cont);
      vec4 a = textureGrad(uWBC, uvA, gAx, gAy), an = textureGrad(uWNR, uvA, gAx, gAy);
      col = a.rgb * mix(vec3(1.), wallC, a.a);
      tn = mix(an.rg * 2. - 1., wallN, a.a); fr = mix(an.b, wallR, a.a);
    }
  }
  if (wall) {
    col *= (H - z < (H > 2.5 ? .25 : .10)) ? .8 : 1.;                      // roof-edge / coping band
    if (H > 2.5) { float g = clamp(1. - z / 1.5, 0., 1.); col *= (1. - .3 * g * g) * (.94 + .06 * clamp(z / H, 0., 1.)); } // ground grime
  } else if (nl.z > .5) {                                                   // roof
    vec2 uvR = vec2(dot(vW, ax), dot(vW, ay)) / 6. + vec2(hb, hb3);
    vec2 gRx = vec2(dot(xdx, ax), dot(xdx, ay)) / 6., gRy = vec2(dot(xdy, ax), dot(xdy, ay)) / 6.;
    vec4 rNR = textureGrad(uRNR, uvR, gRx, gRy);
    col = textureGrad(uRBC, uvR, gRx, gRy).rgb * mix(vec3(1.), tint, .1) * (.9 + .12 * hb2);
    tn = rNR.rg * 2. - 1.; fr = rNR.b; tU = ax; tV = ay;
  }
  diffuseColor.rgb *= col;`;

export function facadeMaterial(t: Textures): THREE.MeshStandardMaterial {
  const s = t.sets;
  return patch(new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }), 'esc-facade', {
    uPBC: { value: s.plaster.bc }, uPNR: { value: s.plaster.nr }, uSBC: { value: s.stone.bc }, uSNR: { value: s.stone.nr },
    uRBC: { value: s.roof.bc }, uRNR: { value: s.roof.nr }, uWBC: { value: t.window.bc }, uWNR: { value: t.window.nr },
  }, { decl: FACADE_V_DECL, body: FACADE_V_BODY }, {
    decl: `${FACADE_VARY}\nuniform sampler2D uPBC, uPNR, uSBC, uSNR, uRBC, uRNR, uWBC, uWNR;`,
    map: FACADE_MAP,
    rough: 'float roughnessFactor = fr;',
    normal: toViewNormal('tn', 'tU', 'tV', 'xN'),
  });
}

// ---------------------------------------------------------------- 5.4 water
const waterTime = { value: 0 };
export function updateWater(time: number): void { waterTime.value = time; }

export function waterMaterial(t: Textures): THREE.MeshStandardMaterial {
  return patch(new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }), 'esc-water', {
    uWNR: { value: t.sets.water.nr }, uTime: waterTime,
    uDeep: { value: new THREE.Vector3(0.012, 0.12, 0.21) }, uSky: { value: new THREE.Vector3(0.2, 0.42, 0.55) },
  }, { decl: V_DECL, body: V_BODY }, {
    decl: `${V_DECL}\nuniform sampler2D uWNR; uniform float uTime; uniform vec3 uDeep, uSky;`,
    map: /* glsl */ `
  vec3 xN = normalize(vNw);
  vec2 xp = vec2(vW.x, -vW.z);                                              // source horizontal (x east, y north)
  vec2 xa = texture(uWNR, xp / 9. + uTime * vec2(.021, .013)).rg * 2. - 1.;
  vec2 xb = texture(uWNR, vec2(-xp.y, xp.x) / 31. + uTime * vec2(-.006, .004)).rg * 2. - 1.;   // second layer turned 90°
  vec2 xs = xa + .7 * vec2(xb.y, -xb.x);
  vec3 xn = normalize(xN + vec3(xs.x, 0., -xs.y) * clamp(xN.y, 0., 1.));  // only up faces get waves
  float xf = pow(1. - clamp(dot(xn, normalize(cameraPosition - vW)), 0., 1.), 3.);
  diffuseColor.rgb *= mix(uDeep, uSky, xf);`,
    rough: 'float roughnessFactor = mix(.06, .14, clamp(length(vViewPosition) / 1500., 0., 1.));',
    normal: 'normal = normalize((viewMatrix * vec4(xn, 0.)).xyz);',
  });
}

// ---------------------------------------------------------------- 5.1 flat
const flatCache = new Map<string, THREE.MeshStandardMaterial>();
export function flatMaterial(hex: string, rough: number): THREE.MeshStandardMaterial {
  const h = hex.replace('#', '').toUpperCase(), key = `${h}/${rough}`;
  let m = flatCache.get(key);
  if (!m) flatCache.set(key, m = new THREE.MeshStandardMaterial({ color: new THREE.Color(`#${h}`), roughness: rough, metalness: 0 }));
  return m;
}
