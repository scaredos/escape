// GPU-baked procedural tiling textures (spec 06 §4). One fragment pass per set renders colour / roughness / height
// into a half-float scratch pair; a second pass builds the normal (wrap-around central differences) and writes the
// final RGBA8 targets: BC (sRGB) and NR (normal xy, roughness, height). Recipes: kit/reference/blender/bake_textures.py.
import * as THREE from 'three';

export type TexSet = 'plaster' | 'stone' | 'asphalt' | 'paving' | 'roof' | 'sand' | 'desert' | 'grass' | 'lot' | 'tiles' | 'water';
export interface TexPair { bc: THREE.Texture; nr: THREE.Texture; tile: number /* metres */; }
export interface Textures { sets: Record<TexSet, TexPair>; window: { bc: THREE.Texture; nr: THREE.Texture }; }

// ---------------------------------------------------------------- GLSL helpers (TS side)
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** sRGB hex -> linear vec3 literal. */
const L = (hex: string) => {
  const v = [0, 2, 4].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5));
  return `vec3(${v.join(',')})`;
};
/** Piecewise-linear colour ramp over hex stops (positions in 0..1), clamped at the ends; emitted as straight-line code. */
const R = (t: string, stops: [number, string][]) => `(${L(stops[0][1])}${stops.slice(1).map(([p, c], i) => {
  const [p0, c0] = stops[i];
  return ` + (${L(c)} - ${L(c0)}) * clamp(((${t}) - ${p0.toFixed(3)}) / ${(p - p0).toFixed(3)}, 0., 1.)`;
}).join('')})`;

const VS = /* glsl */ `in vec3 position; void main() { gl_Position = vec4(position.xy, 0., 1.); }`;

// webgl-noise snoise(vec4), verbatim apart from formatting.
const SNOISE4 = /* glsl */ `
//
// Description : Array and textureless GLSL 2D/3D/4D simplex
//               noise functions.
//      Author : Ian McEwan, Ashima Arts.
//  Maintainer : stegu
//     Lastmod : 20110822 (ijm)
//     License : Copyright (C) 2011 Ashima Arts. All rights reserved.
//               Distributed under the MIT License. See LICENSE file.
//               https://github.com/ashima/webgl-noise
//               https://github.com/stegu/webgl-noise
//
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
float mod289(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+10.0)*x); }
float permute(float x) { return mod289(((x*34.0)+10.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float taylorInvSqrt(float r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec4 grad4(float j, vec4 ip) {
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p,s;
  p.xyz = floor( fract (vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz*2.0 - 1.0) * s.www;
  return p;
}
#define F4 0.309016994374947451
float snoise(vec4 v) {
  const vec4  C = vec4( 0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
  vec4 i  = floor(v + dot(v, vec4(F4)) );
  vec4 x0 = v -   i + dot(i, C.xxxx);
  vec4 i0;
  vec3 isX = step( x0.yzw, x0.xxx );
  vec3 isYZ = step( x0.zww, x0.yyz );
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  vec4 i3 = clamp( i0, 0.0, 1.0 );
  vec4 i2 = clamp( i0-1.0, 0.0, 1.0 );
  vec4 i1 = clamp( i0-2.0, 0.0, 1.0 );
  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;
  i = mod289(i);
  float j0 = permute( permute( permute( permute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = permute( permute( permute( permute (
             i.w + vec4(i1.w, i2.w, i3.w, 1.0 ))
           + i.z + vec4(i1.z, i2.z, i3.z, 1.0 ))
           + i.y + vec4(i1.y, i2.y, i3.y, 1.0 ))
           + i.x + vec4(i1.x, i2.x, i3.x, 1.0 ));
  vec4 ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0) ;
  vec4 p0 = grad4(j0,   ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4,p4));
  vec3 m0 = max(0.6 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3,x3), dot(x4,x4)            ), 0.0);
  m0 = m0 * m0;
  m1 = m1 * m1;
  return 49.0 * ( dot(m0*m0, vec3( dot( p0, x0 ), dot( p1, x1 ), dot( p2, x2 )))
               + dot(m1*m1, vec2( dot( p3, x3 ), dot( p4, x4 ) ) ) ) ;
}
`;

// Noise vocabulary of §4.2. U, V in 0..1 across one tile of uTile metres; every function tiles exactly.
const LIB = /* glsl */ `
precision highp float; precision highp int;
uniform float uTile, uRes;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
float U, V;
const float TAU = 6.283185307179586, PI = 3.141592653589793;
${SNOISE4}
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash3(vec3 p) { return vec3(pcg3d(uvec3(ivec3(round(p * 4.)) + 1048576))) * (1. / 4294967295.); }
float hash(float a, float b, float s) { return hash3(vec3(a, b, s)).x; }
vec4 off4(float s) { return vec4(hash3(vec3(s, 1., 3.)), hash3(vec3(s, 2., 5.)).x) * 80. - 40.; }
float ss(float a, float b, float x) { return smoothstep(a, b, x); }
vec3 mx(vec3 a, vec3 b, float t) { return mix(a, b, clamp(t, 0., 1.)); }
float sq(float x) { return x * x; }
// fBm on the 4D torus: scale = features per metre, octaves = detail + 1, lacunarity 2, gain = rough.
// Octaves finer than one feature per texel are skipped (they would only alias); the sum keeps the full amplitude norm.
// Every N()/warp()/vor() of a recipe becomes one draw of a shared layer program into a half-float texture array
// (see layered()); recipe programs only texelFetch them. ANGLE/D3D compiles every program twice (link + first draw)
// and snoise alone costs ~50 ms per compile, so keeping noise out of the 12 recipe programs is what keeps the bake fast.
uniform vec4 uA, uB;                        // noise: A = (scale, detail, rough, dist), B = (su, sv, seed, -)
float layer() {
  float a = U * TAU, b = V * TAU, ru = uTile * uB.x / TAU, rv = uTile * uB.y / TAU;
  vec4 p = vec4(cos(a) * ru, sin(a) * ru, cos(b) * rv, sin(b) * rv) * uA.x + off4(uB.z), d = vec4(0.);
  float nyq = uRes / (uTile * max(uB.x, uB.y)), sum = 0., amp = 1., tot = 0., f = 1.;
  int nd = uA.w > 0. ? 4 : 0, n = nd + int(uA.y) + 1;
  for (int k = 0; k < n; k++) {             // k < nd: the 4 domain-distortion samples, then the octaves
    bool isD = k < nd;
    float v = 0.;
    if (isD || uA.x * f <= nyq) v = snoise(isD ? p + off4(uB.z + .25 * float(k + 1)) : (p + uA.w * d) * f);
    if (isD) d[k] = v; else { sum += amp * v; tot += amp; amp *= uA.z; f *= 2.; }
  }
  return .5 + .5 * sum / tot;
}
float cellsN(float sc) { return max(1., floor(sc * uTile + .5)); }
// Periodic Worley: (F1 distance in cell units, per-cell random colour).
vec4 vor(float sc, vec2 w, float seed) {
  float n = cellsN(sc);
  vec2 x = (vec2(U, V) + w) * n, ip = floor(x), fp = x - ip, bid = vec2(0.);
  float best = 1e9;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(i, j), id = mod(ip + g, n), r = g + hash3(vec3(id, seed)).xy - fp;
    float d = dot(r, r);
    if (d < best) { best = d; bid = id; }
  }
  return vec4(sqrt(best), hash3(vec3(bid, seed + .5)));
}
// Distance to the nearest cell border, in cell units.
float vorEdge(float sc, vec2 w, float seed) {
  float n = cellsN(sc);
  vec2 x = (vec2(U, V) + w) * n, ip = floor(x), fp = x - ip, mr = vec2(0.), mg = vec2(0.);
  float md = 1e9;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(i, j), r = g + hash3(vec3(mod(ip + g, n), seed)).xy - fp;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 1e9;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(i, j), r = g + hash3(vec3(mod(ip + g, n), seed)).xy - fp;
    if (dot(mr - r, mr - r) > 1e-6) md = min(md, dot(.5 * (mr + r), normalize(r - mr)));
  }
  return md;
}
// Block grid: (edge distance in metres, per-block random, column, row).
vec4 bricks(float rows, float cmin, float cmax, float seed, bool stagger, float vary) {
  float vv = V + sin(2. * TAU * V) * vary, rowf = vv * rows + .5, r = mod(floor(rowf), rows);
  float cols = cmin + floor(hash(0., r, seed) * (cmax - cmin + 1.));
  float x = U * cols + (stagger ? hash(1., r, seed) : .5), c = mod(floor(x), cols);
  vec2 fr = fract(vec2(x, rowf));
  return vec4(min(min(fr.x, 1. - fr.x) * uTile / cols, min(fr.y, 1. - fr.y) * uTile / rows), hash(c, r, seed + 7.), c, r);
}
// 1 - ss(e0, e1, x) for thin lines, widened to at least one texel (px = texel size in x's units) with the
// intensity scaled down so the average coverage stays the same at 512².
float line(float e0, float e1, float x, float px) {
  float w = max(1., px / e1);
  return (1. - ss(e0 * w, e1 * w, x)) / w;
}
float dome(float d, float r, float p) { return sqrt(max(1. - sq(d / r), 0.)) * p; }
`;

// ---------------------------------------------------------------- the sets (§4.3): each body sets bc (linear), r, h
const MPP = 'uTile / uRes';
const BODIES: Record<TexSet, string> = {
  plaster: `
    float fine = N(60., 8., .65, 1.), blob = N(9., 4., .6, 2.), mott = N(1.1, 5., .6, 3.);
    float streak = N(.8, 3., .5, 0., 16., 1., 4.) * ss(.45, .7, N(.45, 2., .5, 5.));
    float shade = 1. - (mott - .5) * .12 - ss(.35, .6, streak) * .045 - (fine - .5) * .12;
    bc = ${L('EFECE5')} * shade; r = .82 + (fine - .5) * .2; h = .6 * fine + .4 * blob;`,
  stone: `
    vec4 bk = bricks(12., 5., 7., 11., true, .03); float edge = bk.x, rid = bk.y;
    float chis = N(40., 7., .62, 12.), strokes = N(10., 3., .5, 0., 10., 1., 15.), pits = vor(60., vec2(0.), 13.).x;
    float weather = N(1.4, 5., .6, 14.), wpatch = ss(.55, .75, N(.9, 5., .6, 16.)), mott = N(6., 4., .6, 17.);
    vec3 tone = ${R('rid', [[0, 'EBE4D6'], [.25, 'E2D6C0'], [.5, 'EFE9DD'], [.7, 'DDD0B8'], [.85, 'E9DCCD'], [1, 'D8C7AC']])};
    float pit = 1. - ss(0., .18, pits), face = ss(.015, .035, edge);
    tone *= 1. - (weather - .5) * .25 - (mott - .5) * .15 - ((chis - .5) * .22 + (strokes - .5) * .18) * face
          - pit * .2 + (1. - face) * .03 - (1. - ss(0., .02, edge)) * .06;
    tone = mx(tone, ${L('AAA294')}, wpatch * .4);
    float mortar = line(.004, .007, edge, ${MPP});
    bc = mx(tone, ${L('CBC1B0')}, mortar); r = .72 + .2 * chis * face + .1 * mortar;
    h = .6 * ss(0., .015, edge) + (.4 * chis + .3 * strokes) * face - .15 * pit;`,
  asphalt: `
    vec4 v = vor(70., vec2(0.), 21.);
    float stones = ss(.8, .86, v.y), grain = N(60., 3., .6, 22.), ptch = N(.45, 4., .6, 23.);
    vec3 base = mx(${L('404041')}, ${L('52514E')}, ss(.35, .65, ptch)) * (.82 + .36 * grain);
    vec3 col = mx(base, ${L('7D7972')}, .85 * stones);
    float ce = vorEdge(.45, warp(3., .2, 24.), 25.);
    float crack = line(.002, .006, ce, cellsN(.45) / uRes) * ss(.56, .62, N(.3, 2., .5, 26.));
    bc = mx(col, ${L('1B1B1B')}, .9 * crack); r = .92 - .15 * stones; h = .6 * (1. - v.x) * stones + .4 * grain - .8 * crack;`,
  paving: `
    vec4 bk = bricks(10., 10., 10., 31., false, 0.); float edge = bk.x, rid = bk.y;
    float pick = hash(bk.z, bk.w, 34.);
    vec3 tile = ${R('rid', [[0, 'CCC7BF'], [.5, 'C8C3BB'], [1, 'C4BFB6']])};
    tile = mx(tile, ${L('C0ACA0')}, ss(.975, .977, pick));
    tile = mx(tile, ${L('BFBBB4')}, 1. - ss(.05, .052, pick));
    vec4 s = vor(60., vec2(0.), 36.);
    tile = mx(tile, ${R('s.z', [[0, 'A6A199'], [1, 'DAD6CE']])}, (1. - ss(.2, .35, s.x)) * ss(.5, .52, s.y) * .3);
    float dots = N(110., 2., .5, 32.), wear = N(9., 3., .6, 35.), dirt = N(.7, 4., .6, 33.), rim = 1. - ss(0., .015, edge);
    tile *= .95 + .08 * dots + .1 * (wear - .5) - .06 * ss(.5, .8, dirt) - .05 * rim;
    float grout = line(.002, .004, edge, ${MPP});
    bc = mx(tile, ${L('A19C93')}, grout); r = .82 + .08 * grout - .08 * (wear - .5);
    h = ss(0., .012, edge) * (.9 + .1 * dots) + .06 * (rid - .5);`,
  roof: `
    float mott = N(1.5, 6., .6, 41.), speck = N(45., 3., .6, 48.), stain = N(.35, 4., .6, 43.);
    float pore = 1. - ss(0., .15, vor(55., vec2(0.), 42.).x);
    float tar = line(.002, .005, vorEdge(.5, warp(3., .15, 47.), 45.), cellsN(.5) / uRes) * ss(.6, .66, N(.4, 2., .5, 46.));
    vec3 base = mx(${L('C6C3BC')} * (.92 + .1 * mott + .07 * speck - .08 * pore), ${L('ACA69B')}, .35 * ss(.5, .8, stain));
    bc = mx(base, ${L('7D7A74')}, .8 * tar); r = .9 - .25 * tar; h = .3 * mott + .2 * speck + .3 * tar - .3 * pore;`,
  sand: `
    float ph = fract(28. * V + 2. * N(.7, 3., .5, 51.) + .3 * N(2.5, 2., .5, 52.));
    float rip = ss(0., .7, ph) * (1. - ss(.7, 1., ph));
    float amp = .3 + .7 * ss(.3, .7, N(.4, 2., .5, 53.)), grains = N(90., 2., .5, 54.), mott = N(.8, 4., .6, 56.);
    float speck = ss(.95, .97, vor(40., vec2(0.), 55.).y);
    bc = mx(${L('DCC59F')} * (.88 + .14 * grains + .1 * rip * amp + .12 * (mott - .5)), ${L('8E7F6C')}, .5 * speck);
    r = .93; h = rip * amp + .15 * grains;`,
  desert: `
    float soil_n = N(2., 6., .6, 61.), big = N(.3, 3., .5, 62.), fine = N(70., 2., .5, 63.);
    vec4 v1 = vor(7., warp(25., .06, 66.), 64.), v2 = vor(22., vec2(0.), 65.), v3 = vor(2.2, warp(8., .15, 68.), 67.);
    float pres1 = 1. - ss(.25 + .6 * big, .27 + .6 * big, v1.y), pres2 = 1. - ss(.45, .47, v2.y), pres3 = 1. - ss(.12, .14, v3.y);
    // 2D Worley puts the surface through every seed point (the source sliced 4D cells): shrink the domes to match its sparse look
    float r1 = (.25 + .2 * v1.z) * DESERT_R, r3 = (.25 + .15 * v3.z) * DESERT_R;
    float dome1 = dome(v1.x, r1, pres1), dome2 = dome(v2.x, .3 * DESERT_R, pres2), dome3 = dome(v3.x, r3, pres3);
    float peb1 = ss(0., .2, dome1), peb2 = ss(0., .2, dome2), peb3 = ss(0., .15, dome3);
    float halo = (1. - ss(0., .12, v1.x - r1)) * pres1;
    vec3 pcol = ${R('v1.w', [[0, '4A382A'], [.25, '6B5541'], [.5, '8D8579'], [.7, 'A89C88'], [.85, '8A5638'], [1, '5E4A3A']])} * (.75 + .35 * dome1);
    vec3 rcol = ${R('v3.w', [[0, 'BDB5A5'], [.5, 'A59C8C'], [1, 'C4B398']])} * (.55 + .5 * dome3 + .3 * (fine - .5));
    vec3 soil = mx(mx(${L('C2A983')}, ${L('AD9271')}, soil_n), ${L('D1BB97')}, .6 * ss(.55, .75, big)) * (.9 + .2 * fine - .12 * halo);
    bc = mx(mx(mx(soil, ${L('7D6C58')}, .75 * peb2), pcol, peb1), rcol, peb3); r = .95 - .3 * peb1 - .1 * peb3;
    h = .15 * soil_n + .05 * fine + .8 * dome1 + .3 * dome2 + 1.5 * dome3;`,
  grass: `
    float ptch = N(.5, 4., .6, 71.);
    vec4 t = vor(14., warp(30., .03, 76.), 72.); float tuft = 1. - ss(.15, .65, t.x);
    float blades = max(N(30., 3., .7, 0., 1., 5., 73.), N(30., 3., .7, 0., 5., 1., 74.));
    float dirt = ss(.62, .72, N(1.2, 4., .6, 75.));
    vec3 hue = ${R('.75 * ptch + .25 * t.y', [[.25, '6E7A40'], [.45, '909050'], [.62, 'B5A663'], [.8, 'C6B47E']])};
    bc = mx(hue * (.5 + .35 * tuft + .4 * blades), ${L('8A7356')}, .8 * dirt); r = .92; h = .6 * tuft + .4 * blades - .3 * dirt;`,
  lot: `
    float big = N(.35, 3., .5, 81.), soil_n = N(1.6, 6., .6, 82.), fine = N(70., 2., .5, 83.);
    float slab = ss(.55, .57, N(.5, 4., .6, .4, 1., 1., 84.) + .08 * (N(5., 4., .6, 86.) - .5));
    float crack = line(.006, .012, vorEdge(1.3, warp(5., .1, 88.), 87.), cellsN(1.3) / uRes) * ss(.5, .56, N(.6, 2., .5, 89.)) * slab;
    vec4 g = vor(28., vec2(0.), 90.); float peb = (1. - ss(.25, .5, g.x)) * ss(.75, .77, g.y) * (1. - .8 * slab);
    vec4 f = vor(80., vec2(0.), 95.); float grit = (1. - ss(.2, .45, f.x)) * ss(.6, .62, f.y);
    vec4 t = vor(2.5, warp(20., .04, 92.), 91.);
    float blades = max(N(40., 3., .7, 0., 6., 1., 94.), N(40., 3., .7, 0., 1., 6., 96.));
    float clump = max(.75 * ss(.5, .62, N(.45, 3., .6, 93.)), .04) * (1. - .9 * slab);
    float there = 1. - ss(clump - .01, clump, 1. - t.y);
    float tuft = ss(.5, .58, .95 - 2.5 * t.x + .75 * ss(.4, .7, blades)) * there;
    vec3 soil = mx(mx(${L('C4BCAD')}, ${L('B7AE9E')}, soil_n), ${L('CDC6B8')}, .35 * ss(.5, .75, big))
              * (.95 + .1 * fine - .08 * (1. - ss(0., .5, t.x)) * there);
    vec3 conc = mx(${L('C4C0B7')}, ${L('BAB5AB')}, ss(.4, .7, big)) * (.95 + .05 * fine + .06 * (soil_n - .5));
    vec3 col = mx(soil, conc, .7 * slab);
    col = mx(col, ${R('f.z', [[0, 'A2988A'], [1, 'D2CBBE']])}, .35 * grit);
    col = mx(col, ${R('g.z', [[0, '9C9180'], [.4, 'CDC6B8'], [.7, 'B0A491'], [1, '8D8577']])}, .7 * peb);
    col = mx(col, ${L('958C7A')}, .6 * crack);
    vec3 tcol = ${R('t.z', [[0, 'B4A984'], [.5, 'C0B38C'], [1, 'A09D7C']])}; tcol = mx(.65 * tcol, tcol, ss(.3, .7, blades));
    bc = mx(col, tcol, .9 * tuft); r = .95 - .06 * slab;
    h = .08 * soil_n + .1 * fine + .2 * slab - .3 * crack + .35 * peb + .1 * grit + tuft * (.5 + .5 * blades);`,
  tiles: `
    vec4 bk = bricks(6., 6., 6., 95., false, 0.); float edge = bk.x, rid = bk.y;
    vec4 cv = vor(55., warp(30., .02, 97.), 96.); float chip = (1. - ss(.3, .42, cv.x)) * ss(.3, .32, cv.y);
    vec4 fv = vor(110., vec2(0.), 98.); float grit = (1. - ss(.25, .4, fv.x)) * ss(.3, .32, fv.y);
    float wear = N(.8, 4., .6, 99.);
    vec3 tile = ${R('rid', [[0, 'DCD3C4'], [.5, 'D8CEBE'], [1, 'D4CAB9']])};
    tile = mx(tile, ${R('cv.z', [[0, 'A39888'], [.3, 'EFE9DF'], [.6, 'C2AD92'], [.8, '8F8A84'], [1, 'B89A83']])}, .55 * chip);
    tile = mx(tile, ${R('fv.z', [[0, '9A9186'], [1, 'ECE6DC']])}, .4 * grit) * (.97 + .08 * (wear - .5));
    float grout = line(.0015, .003, edge, ${MPP});
    bc = mx(tile, ${L('B8AD9B')}, grout); r = .3 + .12 * (wear - .5) + .5 * grout;
    h = ss(0., .004, edge) + .02 * chip + .05 * (rid - .5);`,
  water: `
    float swell = N(.4, 3., .5, 0., .6, 1., 101.), chop = 1. - abs(2. * N(1.2, 3., .5, 102.) - 1.), rip = N(4., 3., .55, 103.);
    bc = vec3(.5); r = .06; h = .6 * swell + .25 * chop + .08 * rip;`,
};

// name: [tile metres, height depth in metres per unit]
const SETS: Record<TexSet, [number, number]> = {
  plaster: [4, 0.002], stone: [4, 0.012], asphalt: [6, 0.004], paving: [3, 0.004], roof: [6, 0.003], sand: [4, 0.012],
  desert: [6, 0.015], grass: [4, 0.008], lot: [6, 0.006], tiles: [2.4, 0.002], water: [8, 0.35],
};

// ---------------------------------------------------------------- window atlas (§4.4), sRGB values, painted per texel
const WINDOW_BODY = /* glsl */ `
    float cs = uRes * .5; PX = 2.8 / cs; PY = 3.2 / cs;
    int kind = int(floor(V * 2.) * 2. + floor(U * 2.));          // 0 plain, 1 half, 2 door, 3 closed
    WX = fract(U * 2.) * 2.8; WY = 3.2 * (1. - fract(V * 2.));     // metres from the cell's left edge / floor line
    vec3 alu = vec3(.80, .81, .81), shut = vec3(.86, .84, .80), rail = vec3(.22, .23, .24), sill = vec3(.83, .80, .75);
    vec3 top = vec3(.60, .68, .76), bot = vec3(.13, .16, .19);
    bool door = kind == 2;
    float x0 = door ? .8 : .7, y0 = door ? .03 : .95, x1 = door ? 2. : 2.1, y1 = door ? 2.35 : 2.45;
    float shutTo = door ? 1.95 : (kind == 0 ? y1 : (kind == 1 ? 1.72 : y0));
    gBC = vec3(1.); gR = .85; gH = 0.; gA = 1.;
    paint(box(x0, y0, x1, y1), alu * .9, .45, -.09);
    float f = .05, s = .045, mid = (x0 + x1) * .5;
    for (int i = 0; i < 2; i++) {
      float sx0 = i == 0 ? x0 + f : mid - .02, sx1 = i == 0 ? mid + .02 : x1 - f, z = i == 0 ? -.1 : -.085;
      paint(box(sx0, y0 + f, sx1, y1 - f), alu, .4, z);
      float gx0 = sx0 + s, gx1 = sx1 - s, gy0 = y0 + f + s, gy1 = y1 - f - s;
      float g = pow(clamp((WY - gy0) / (gy1 - gy0), 0., 1.), 1.5);
      vec3 glass = bot + (top - bot) * g + .10 * exp(-sq((WX - gx0 - .55 * (WY - gy0) - .15) / .07));
      if ((kind == 0 && i == 0) || (door && i == 1)) {
        vec3 cur = vec3(.82, .78, .70) * (.85 + .15 * sin(WX * TAU / .09));
        float cm = box(gx0, gy0, gx0 + (gx1 - gx0) * .65, gy1);
        glass = glass * (1. - .6 * cm) + cur * .6 * cm;
      }
      paint(box(gx0, gy0, gx1, gy1), glass, .05, z - .01);
    }
    float gw = .035;
    paint(box(x0, y0, x0 + gw, y1), shut * .9, .55, -.045);
    paint(box(x1 - gw, y0, x1, y1), shut * .9, .55, -.045);
    if (shutTo < y1 - 1e-3) {
      float t = mod((y1 - WY) / .045, 1.), prof = sin(PI * t);
      paint(box(x0 + gw, shutTo, x1 - gw, y1), shut * (.8 + .2 * prof) * (t < .07 ? .62 : 1.), .55, -.06 + .012 * prof);
      paint(box(x0 + gw, shutTo, x1 - gw, shutTo + .04), shut * .82, .5, -.05);
    }
    if (door) {
      paint(box(x0 - .15, 0., x1 + .15, .04), sill, .7, .04);
      float rm = max(box(x0 - .1, 1., x1 + .1, 1.05), box(x0 - .1, .08, x1 + .1, .11));
      rm = max(rm, max(box(x0 - .1, .04, x0 - .06, 1.05), box(x1 + .06, .04, x1 + .1, 1.05)));
      for (int i = 0; i < 12; i++) { float bx = x0 - .02 + float(i) * .11; rm = max(rm, box(bx, .11, bx + .016, 1.)); }
      paint(rm, rail, .45, .12);
    } else {
      paint(box(x0 - .08, y0 - .06, x1 + .08, y0), sill, .7, .03);
      float st = (exp(-sq((WX - x0 + .04) / .05)) + exp(-sq((WX - x1 - .04) / .05)))
               * clamp(1. - (y0 - .06 - WY) / .8, 0., 1.) * (WY < y0 - .06 ? 1. : 0.);
      gBC *= 1. - .07 * st;
    }
    bc = gBC; r = gR; h = gH; a = gA;`;
const WINDOW_LIB = /* glsl */ `
float WX, WY, PX, PY, gR, gH, gA; vec3 gBC;
float box(float x0, float y0, float x1, float y1) {
  return clamp(min(WX - x0, x1 - WX) / PX + .5, 0., 1.) * clamp(min(WY - y0, y1 - WY) / PY + .5, 0., 1.);
}
void paint(float m, vec3 col, float r, float h) { gBC = mix(gBC, col, m); gR = mix(gR, r, m); gH = mix(gH, h, m); gA = mix(gA, 0., m); }
`;

/** Turns each N(...) / warp(...) / vor(...) / vorEdge(...) of a recipe into a layer row (rendered by the shared noise /
 *  Worley programs into texture arrays); the body then reads NZ(i) and VZ(j). All arguments are numeric literals. */
function layered(body: string) {
  const nRows: number[][] = [], vRows: number[][] = [];
  const nums = (s: string) => s.split(',').map(Number);
  const addN = (a: number[]) => { nRows.push(a.length === 4 ? [a[0], a[1], a[2], 0, 1, 1, a[3]] : a); return nRows.length - 1; };
  const warpRows = (s: string) => { const [sc, , seed] = nums(s); return [addN([sc, 3, .5, seed]), addN([sc, 3, .5, seed + .5])]; };
  body = body.replace(/\b(vor|vorEdge)\(([^,()]+),\s*(vec2\(0\.\)|warp\(([^()]*)\)),\s*([^,()]+)\)/g,
    (_, fn: string, sc: string, _w: string, warp: string | undefined, seed: string) => {
      const [wa, wb] = warp ? warpRows(warp) : [-1, -1];
      vRows.push([+sc, +seed, fn === 'vorEdge' ? 1 : 0, warp ? nums(warp)[1] : 0, wa, wb]);
      return fn === 'vorEdge' ? `VZ(${vRows.length - 1}).x` : `VZ(${vRows.length - 1})`;
    });
  body = body.replace(/\bwarp\(([^()]*)\)/g, (_, s: string) => {
    const [wa, wb] = warpRows(s);
    return `((vec2(NZ(${wa}), NZ(${wb})) - .5) * ${nums(s)[1].toFixed(4)} / uTile)`;
  });
  body = body.replace(/\bN\(([^()]*)\)/g, (_, s: string) => `NZ(${addN(nums(s))})`);
  if (nRows.length > MAXN || vRows.length > MAXV || /\b(N|vor|vorEdge|warp)\(/.test(body)
    || [...nRows, ...vRows].some((r) => r.some(isNaN))) throw new Error('textures: bad layer table');
  return { body, nRows, vRows };
}

// Layer programs: noise (one N() per draw) and Worley (one vor()/vorEdge() per draw, warp from the noise layers).
const MAXN = 16, MAXV = 6;
const ARR = /* glsl */ `
uniform highp sampler2DArray uNZ, uVZ;
#define NZ(i) texelFetch(uNZ, ivec3(ivec2(gl_FragCoord.xy), i), 0).r
#define VZ(j) texelFetch(uVZ, ivec3(ivec2(gl_FragCoord.xy), j), 0)
`;
const NOISE_FS = `${LIB}
void main() { U = gl_FragCoord.x / uRes; V = gl_FragCoord.y / uRes; o0 = vec4(layer()); o1 = o0; }`;
const WORLEY_FS = `${LIB}${ARR}
uniform vec4 uW;                            // (scale, seed, edge?, warp metres)
uniform ivec2 uWL;                          // warp noise layers, or -1
void main() {
  U = gl_FragCoord.x / uRes; V = gl_FragCoord.y / uRes;
  vec2 w = uWL.x >= 0 ? (vec2(NZ(uWL.x), NZ(uWL.y)) - .5) * uW.w / uTile : vec2(0.);
  o0 = uW.z > .5 ? vec4(vorEdge(uW.x, w, uW.y)) : vor(uW.x, w, uW.y); o1 = o0;
}`;
const ALL: [string, string][] = [...(Object.keys(SETS) as TexSet[]).map((n) => [n, BODIES[n]] as [string, string]), ['window', WINDOW_BODY]];
const passOne = (body: string, win: boolean) => `${LIB}${ARR}${win ? WINDOW_LIB : ''}
#define DESERT_R .7
void main() {
  U = gl_FragCoord.x / uRes; V = gl_FragCoord.y / uRes;
  vec3 bc = vec3(0.); float r = 0., h = 0., a = 1.;
  ${body}
  o0 = vec4(bc, a); o1 = vec4(r, h, 0., 1.);
}`;

// Pass 2: normal from height (wrap-around central differences, v = +row = down the image), final BC + NR.
// WIN: atlas cells clamp at their own borders, baked cast shadow + cavity, normal from blur1(h), sRGB values -> linear.
const PASS_TWO = /* glsl */ `
precision highp float; precision highp int;
uniform sampler2D uA, uB; uniform float uRes, uDepth, uK, uBR; uniform vec2 uMpp;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
int RES, CS; ivec2 CELL0;
float Hh(ivec2 p) {
#ifdef WIN
  p = clamp(p, CELL0, CELL0 + CS - 1);
#else
  p = (p % RES + RES) % RES;
#endif
  return texelFetch(uB, p, 0).g * uDepth;
}
float B1(ivec2 p) { float s = 0.; for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) s += Hh(p + ivec2(i, j)); return s / 9.; }
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
void main() {
  RES = int(uRes); ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(uA, p, 0), B = texelFetch(uB, p, 0);
  float h0 = B.g * uDepth, dx, dy, hA;
#ifdef WIN
  CS = RES / 2; CELL0 = (p / CS) * CS;
  dx = (B1(p + ivec2(1, 0)) - B1(p - ivec2(1, 0))) / (2. * uMpp.x);
  dy = (B1(p + ivec2(0, 1)) - B1(p - ivec2(0, 1))) / (2. * uMpp.y);
  float sh = 0., bs = 0.; int br = int(uBR);
  for (int k = 1; k <= int(uK); k++) sh = max(sh, Hh(p - ivec2(0, k)) - h0 - float(k) * uMpp.y * .9);
  for (int j = -br; j <= br; j++) for (int i = -br; i <= br; i++) bs += Hh(p + ivec2(i, j));
  float cav = max(bs / float((2 * br + 1) * (2 * br + 1)) - h0, 0.);
  o0 = vec4(toLin(clamp(A.rgb * clamp(1. - 4. * sh - 3. * cav, .5, 1.), 0., 1.)), A.a);
  hA = clamp(h0 * 4. + .5, 0., 1.);
#else
  dx = (Hh(p + ivec2(1, 0)) - Hh(p - ivec2(1, 0))) / (2. * uMpp.x);
  dy = (Hh(p + ivec2(0, 1)) - Hh(p - ivec2(0, 1))) / (2. * uMpp.y);
  o0 = vec4(A.rgb, 1.);
  hA = clamp(B.g, 0., 1.);
#endif
  vec3 n = normalize(vec3(-dx, -dy, 1.));
  o1 = vec4(n.xy * .5 + .5, B.r, hA);
}`;

const nextFrame = () => new Promise<void>((res) => {
  let done = false; const go = () => { if (!done) { done = true; res(); } };
  requestAnimationFrame(go); setTimeout(go, 50);                 // rAF stalls in background tabs
});

export async function bakeTextures(renderer: THREE.WebGLRenderer, size: 512 | 1024, onProgress?: (f: number) => void): Promise<Textures> {
  const t0 = performance.now();
  const prevRT = renderer.getRenderTarget();
  const tri = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const cam = new THREE.OrthographicCamera(), scene = new THREE.Scene();
  const raw = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines = {}) => {
    const m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader, uniforms, defines,
      toneMapped: false, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(tri, m); mesh.frustumCulled = false; scene.add(mesh);
    return mesh;
  };
  const scratch = new THREE.WebGLRenderTarget(size, size, { count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  const pass2 = [false, true].map((win) => raw(PASS_TWO, { uA: { value: scratch.textures[0] }, uB: { value: scratch.textures[1] },
    uRes: { value: size }, uDepth: { value: 1 }, uMpp: { value: new THREE.Vector2() }, uK: { value: Math.round(15 * size / 1024) },
    uBR: { value: Math.max(1, Math.round(6 * size / 1024)) } }, win ? { WIN: 1 } : {}));
  const tiles = ALL.map(([n]) => n === 'window' ? 1 : SETS[n as TexSet][0]);
  const arr = (depth: number, format: THREE.PixelFormat) => new THREE.WebGLArrayRenderTarget(size, size, depth, {
    type: THREE.HalfFloatType, format, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  const nzRT = arr(MAXN, THREE.RedFormat), vzRT = arr(MAXV, THREE.RGBAFormat);
  const common = () => ({ uRes: { value: size }, uTile: { value: 1 }, uNZ: { value: nzRT.texture }, uVZ: { value: vzRT.texture } });
  const noise = raw(NOISE_FS, { ...common(), uA: { value: new THREE.Vector4() }, uB: { value: new THREE.Vector4() } });
  const worley = raw(WORLEY_FS, { ...common(), uW: { value: new THREE.Vector4() }, uWL: { value: new THREE.Vector2() } });
  const pass1 = ALL.map(([, b], i) => {
    const l = layered(b);
    return { ...l, mesh: raw(passOne(l.body, i === ALL.length - 1), { ...common(), uTile: { value: tiles[i] } }) };
  });
  renderer.setRenderTarget(scratch);
  await renderer.compileAsync(scene, cam);                        // parallel links (KHR_parallel_shader_compile)
  onProgress?.(0.5 / ALL.length);

  const draw = (mesh: THREE.Mesh, rt: THREE.WebGLRenderTarget, layer = 0) => {
    scene.children.forEach((c) => (c.visible = c === mesh));
    renderer.setRenderTarget(rt, layer); renderer.render(scene, cam);
  };
  const uni = (m: THREE.Mesh) => (m.material as THREE.RawShaderMaterial).uniforms;
  const bake = (i: number) => {
    const win = i === ALL.length - 1, depth = win ? 1 : SETS[ALL[i][0] as TexSet][1];
    const { nRows, vRows, mesh } = pass1[i], nu = uni(noise), wu = uni(worley);
    nu.uTile.value = wu.uTile.value = tiles[i];
    nRows.forEach((r, k) => { nu.uA.value.set(r[0], r[1], r[2], r[3]); nu.uB.value.set(r[4], r[5], r[6], 0); draw(noise, nzRT, k); });
    vRows.forEach((r, k) => { wu.uW.value.set(r[0], r[1], r[2], r[3]); wu.uWL.value.set(r[4], r[5]); draw(worley, vzRT, k); });
    draw(mesh, scratch);
    const out = new THREE.WebGLRenderTarget(size, size, { count: 2, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping, anisotropy: 4 });
    out.textures[0].colorSpace = THREE.SRGBColorSpace;            // SRGB8_ALPHA8: hardware encodes on write, decodes on sample
    for (const t of out.textures) t.flipY = false;
    const m2 = pass2[win ? 1 : 0], u = uni(m2);
    u.uDepth.value = depth;
    u.uMpp.value.set(win ? 2.8 / (size / 2) : tiles[i] / size, win ? 3.2 / (size / 2) : tiles[i] / size);
    draw(m2, out);
    return out;
  };

  const sets = {} as Record<TexSet, TexPair>;
  let last!: THREE.WebGLRenderTarget;
  for (let i = 0; i < ALL.length; i++) {
    last = bake(i);
    if (i < ALL.length - 1) sets[ALL[i][0] as TexSet] = { bc: last.textures[0], nr: last.textures[1], tile: tiles[i] };
    onProgress?.((i + 1) / ALL.length);
    if (i < ALL.length - 1) await nextFrame();
  }
  renderer.readRenderTargetPixels(last, 0, 0, 1, 1, new Uint8Array(4), undefined, 1);   // sync: wait for the GPU
  renderer.setRenderTarget(prevRT);
  scratch.dispose(); nzRT.dispose(); vzRT.dispose(); tri.dispose();
  scene.children.forEach((c) => ((c as THREE.Mesh).material as THREE.Material).dispose());
  console.log(`[textures] baked ${ALL.length} sets at ${size}² in ${(performance.now() - t0).toFixed(0)} ms`);
  return { sets, window: { bc: last.textures[0], nr: last.textures[1] } };
}
