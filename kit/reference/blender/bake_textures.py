"""Bake seamless procedural PBR texture sets for Escape Israel (headless):

    blender -b --factory-startup -P Tools/blender/bake_textures.py [-- Stone Sand Windows ...]

No args = every set. Writes Art/out/textures/T_<Set>_BC.png (sRGB), _N.png (DirectX / UE, green = +V down),
_R.png (linear grey) and Saved/Agent/textures_sheet.png (+ _lit.png preview with the normals lit).

Surface sets: procedural Cycles node materials, EMIT-baked per pass (colour, roughness, height) onto a 0..1 UV
plane. Tiling is exact by construction: every noise/voronoi samples a 4D Clifford torus
(cos/sin of u and v, radius = tile/2pi, so feature sizes stay in metres), block patterns use integer counts
per tile with wrapped ids. Normals come from the baked height with wrap-around central differences.
T_Water_N feeds M_EscWater's panning wave layers (its BC/R are unused placeholders).
T_Windows_* is a 2x2 atlas drawn in numpy (one 2.8 m wide x 3.2 m tall bay per cell, image top-left origin):
  [0] top-left plain sliding window   [1] top-right roller shutter half down
  [2] bottom-left balcony door+railing [3] bottom-right shutter closed
Wall area BC = 1.0 (tint multiplies); T_Windows_BC alpha = 1 on wall, 0 on window parts.
"""
import bpy, math, os, random, struct, sys, time, zlib
import numpy as np

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "Art", "out", "textures")
SHEET = os.path.join(ROOT, "Saved", "Agent", "textures_sheet.png")
RES = 1024
SAMPLES = 16


# ---------------------------------------------------------------- tiny node DSL (sockets wrapped in S)
NT = None          # node tree being built
U = V = None       # UV components (S)
TILE = 4.0         # metres covered by one texture tile of the set being built


class S:
    __slots__ = ("o",)

    def __init__(self, o):
        self.o = o

    def __add__(self, b): return m("ADD", self, b)
    __radd__ = __add__
    def __sub__(self, b): return m("SUBTRACT", self, b)
    def __rsub__(self, b): return m("SUBTRACT", b, self)
    def __mul__(self, b): return m("MULTIPLY", self, b)
    __rmul__ = __mul__
    def __truediv__(self, b): return m("DIVIDE", self, b)
    def __rtruediv__(self, b): return m("DIVIDE", b, self)


def lin(hexc):
    c = [int(hexc[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def put(sock, v):
    if isinstance(v, S):
        NT.links.new(v.o, sock)
    else:
        for l in sock.links:                    # a constant must replace the previous pass's link
            NT.links.remove(l)
        sock.default_value = lin(v) if isinstance(v, str) else v


def node(kind, ins=(), out=0, **props):
    n = NT.nodes.new(kind)
    for k, v in props.items():
        setattr(n, k, v)
    for k, v in (ins.items() if isinstance(ins, dict) else enumerate(ins)):
        put(n.inputs[k], v)
    return S(n.outputs[out])


def m(op, *a): return node("ShaderNodeMath", a, operation=op)
def mx(a, b): return m("MAXIMUM", a, b)
def mn(a, b): return m("MINIMUM", a, b)
def sstep(e0, e1, x): return node("ShaderNodeMapRange", [x, e0, e1, 0.0, 1.0], interpolation_type="SMOOTHSTEP")
def mixc(a, b, t): return node("ShaderNodeMix", {0: t, 6: a, 7: b}, out=2, data_type="RGBA")
def mulc(a, f): return node("ShaderNodeMix", {0: 1.0, 6: a, 7: f}, out=2, data_type="RGBA", blend_type="MULTIPLY")
def sep(v, i): return node("ShaderNodeSeparateXYZ", [v], out=i)
def white(a, b, seed): return node("ShaderNodeTexWhiteNoise", [node("ShaderNodeCombineXYZ", [a, b, seed])], noise_dimensions="3D")


def ramp(t, stops, interp="LINEAR"):
    n = NT.nodes.new("ShaderNodeValToRGB")
    put(n.inputs[0], t)
    cr = n.color_ramp
    cr.interpolation = interp
    el = cr.elements
    el[0].position, el[0].color = stops[0][0], lin(stops[0][1])
    el[1].position, el[1].color = stops[-1][0], lin(stops[-1][1])
    for p, c in stops[1:-1]:
        el.new(p).color = lin(c)
    return S(n.outputs[0])


def torus(su=1.0, sv=1.0, seed=0):
    """UV -> point on a flat 4D torus: any 4D texture sampled here tiles exactly. su/sv > 1 = finer along u/v."""
    r = random.Random(seed)
    o = [r.uniform(-40, 40) for _ in range(4)]
    a, b = U * (2 * math.pi), V * (2 * math.pi)
    ru, rv = TILE * su / (2 * math.pi), TILE * sv / (2 * math.pi)
    vec = node("ShaderNodeCombineXYZ", [m("COSINE", a) * ru + o[0], m("SINE", a) * ru + o[1], m("COSINE", b) * rv + o[2]])
    return vec, m("SINE", b) * rv + o[3]


def noise(scale, detail=2.0, rough=0.5, dist=0.0, su=1.0, sv=1.0, seed=0, out=0):
    """4D fBm, scale = features per metre. out 0 = Fac, 1 = Color."""
    vec, w = torus(su, sv, seed)
    return node("ShaderNodeTexNoise", {"Vector": vec, "W": w, "Scale": scale, "Detail": detail, "Roughness": rough,
                                       "Distortion": dist}, out=out, noise_dimensions="4D")


def warp(scale, amt, seed):
    c = node("ShaderNodeVectorMath", [noise(scale, 3, seed=seed, out=1), (0.5, 0.5, 0.5)], operation="SUBTRACT")
    return node("ShaderNodeVectorMath", {0: c, 3: amt}, operation="SCALE")


def vor(scale, feature="F1", rand=1.0, seed=0, wv=None):
    """4D voronoi -> (distance in cell units, per-cell random colour)."""
    vec, w = torus(seed=seed)
    if wv is not None:
        vec = node("ShaderNodeVectorMath", [vec, wv], operation="ADD")
    n = NT.nodes.new("ShaderNodeTexVoronoi")
    n.voronoi_dimensions, n.feature = "4D", feature
    for k, v in (("Vector", vec), ("W", w), ("Scale", scale), ("Randomness", rand)):
        put(n.inputs[k], v)
    return S(n.outputs["Distance"]), (S(n.outputs["Color"]) if "Color" in n.outputs else None)


def bricks(rows, cmin, cmax, seed, stagger=True, vary=0.0):
    """Periodic block grid: integer rows per tile, per-row integer column count in [cmin, cmax] and random offset.
    vary (< 0.08) makes course heights uneven. Returns (edge distance in metres, per-block random, col id, row id)."""
    vv = V + m("SINE", V * (4 * math.pi)) * vary if vary else V
    rowf = vv * rows + 0.5                                  # tile edge mid-course, not on a joint
    r = m("FLOORED_MODULO", m("FLOOR", rowf), rows)
    cols = m("FLOOR", white(0.0, r, seed) * (cmax - cmin + 1)) + cmin if cmax > cmin else cmin
    x = U * cols + (white(1.0, r, seed) if stagger else 0.5)
    c = m("FLOORED_MODULO", m("FLOOR", x), cols)
    fx, fy = m("FRACT", x), m("FRACT", rowf)
    edge = mn(mn(fx, 1.0 - fx) * (TILE / cols), mn(fy, 1.0 - fy) * (TILE / rows))
    return edge, white(c, r, seed + 7), c, r


# ---------------------------------------------------------------- the sets: each returns (base colour, roughness, height 0..~1)
def plaster():
    fine = noise(60, 8, 0.65, seed=1)
    blob = noise(9, 4, 0.6, seed=2)
    mott = noise(1.1, 5, 0.6, seed=3)
    streak = noise(0.8, 3, 0.5, su=16, seed=4) * sstep(0.45, 0.7, noise(0.45, 2, seed=5))
    shade = 1.0 - (mott - 0.5) * 0.12 - sstep(0.35, 0.6, streak) * 0.045 - (fine - 0.5) * 0.12
    return mulc("#efece5", shade), 0.82 + (fine - 0.5) * 0.2, fine * 0.6 + blob * 0.4


def stone():
    edge, rid, _, _ = bricks(12, 5, 7, seed=11, vary=0.03)
    chis = noise(40, 7, 0.62, seed=12)
    strokes = noise(10, 3, 0.5, su=10, seed=15)                 # vertical chisel ("taltish") marks
    pits, _ = vor(60, seed=13)
    weather = noise(1.4, 5, 0.6, seed=14)
    wpatch = sstep(0.55, 0.75, noise(0.9, 5, 0.6, seed=16))
    mott = noise(6, 4, 0.6, seed=17)
    tone = ramp(rid, [(0.0, "#ebe4d6"), (0.25, "#e2d6c0"), (0.5, "#efe9dd"), (0.7, "#ddd0b8"), (0.85, "#e9dccd"), (1.0, "#d8c7ac")])
    pit = 1.0 - sstep(0.0, 0.18, pits)
    face = sstep(0.015, 0.035, edge)                            # smooth drafted margin around a rough face
    tone = mulc(tone, 1.0 - (weather - 0.5) * 0.25 - (mott - 0.5) * 0.15 - ((chis - 0.5) * 0.22 + (strokes - 0.5) * 0.18) * face
                - pit * 0.2 + (1.0 - face) * 0.03 - (1.0 - sstep(0.0, 0.02, edge)) * 0.06)
    tone = mixc(tone, "#aaa294", wpatch * 0.4)
    mortar = 1.0 - sstep(0.004, 0.007, edge)
    h = sstep(0.0, 0.015, edge) * 0.6 + (chis * 0.4 + strokes * 0.3) * face - pit * 0.15
    return mixc(tone, "#cbc1b0", mortar), 0.72 + chis * 0.2 * face + mortar * 0.1, h


def asphalt():
    d, c = vor(70, seed=21)
    stones = sstep(0.8, 0.86, sep(c, 0))
    grain = noise(60, 3, 0.6, seed=22)
    patch = noise(0.45, 4, 0.6, seed=23)
    base = mixc("#404041", "#52514e", sstep(0.35, 0.65, patch))
    base = mulc(base, 0.82 + grain * 0.36)
    col = mixc(base, "#7d7972", stones * 0.85)
    ce, _ = vor(0.45, "DISTANCE_TO_EDGE", seed=25, wv=warp(3.0, 0.2, 24))
    crack = (1.0 - sstep(0.002, 0.006, ce)) * sstep(0.56, 0.62, noise(0.3, 2, seed=26))
    col = mixc(col, "#1b1b1b", crack * 0.9)
    h = (1.0 - d) * stones * 0.6 + grain * 0.4 - crack * 0.8
    return col, 0.92 - stones * 0.15, h


def paving():
    edge, rid, c, r = bricks(10, 10, 10, seed=31, stagger=False)
    pick = white(c, r, 34)                                      # light warm-grey squares; ~1 in 40 a faded terracotta,
    tile = ramp(rid, [(0.0, "#ccc7bf"), (0.5, "#c8c3bb"), (1.0, "#c4bfb6")])  # ~1 in 20 a darker newer replacement
    tile = mixc(tile, "#c0aca0", sstep(0.975, 0.977, pick))
    tile = mixc(tile, "#bfbbb4", 1.0 - sstep(0.05, 0.052, pick))
    sd, sc = vor(60, seed=36)                                   # exposed aggregate specks
    tile = mixc(tile, ramp(sep(sc, 1), [(0.0, "#a6a199"), (1.0, "#dad6ce")]), (1.0 - sstep(0.2, 0.35, sd)) * sstep(0.5, 0.52, sep(sc, 0)) * 0.3)
    dots = noise(110, 2, 0.5, seed=32)
    wear = noise(9, 3, 0.6, seed=35)                            # per-paver scuffs
    dirt = noise(0.7, 4, 0.6, seed=33)
    rim = 1.0 - sstep(0.0, 0.015, edge)                         # chamfer + grime along the joints
    tile = mulc(tile, 0.95 + dots * 0.08 + (wear - 0.5) * 0.1 - sstep(0.5, 0.8, dirt) * 0.06 - rim * 0.05)
    grout = 1.0 - sstep(0.002, 0.004, edge)
    h = sstep(0.0, 0.012, edge) * (0.9 + dots * 0.1) + (rid - 0.5) * 0.06
    return mixc(tile, "#a19c93", grout), 0.82 + grout * 0.08 - (wear - 0.5) * 0.08, h


def roof_concrete():
    """Light grey / off-white flat roof concrete: calm mottling, faint water stains, a few thin sealed cracks."""
    mott = noise(1.5, 6, 0.6, seed=41)
    speck = noise(45, 3, 0.6, seed=48)
    pores, _ = vor(55, seed=42)
    stain = noise(0.35, 4, 0.6, seed=43)
    ce, _ = vor(0.5, "DISTANCE_TO_EDGE", seed=45, wv=warp(3.0, 0.15, 47))
    tarline = (1.0 - sstep(0.002, 0.005, ce)) * sstep(0.6, 0.66, noise(0.4, 2, seed=46))
    pore = 1.0 - sstep(0.0, 0.15, pores)
    base = mulc("#c6c3bc", 0.92 + mott * 0.1 + speck * 0.07 - pore * 0.08)
    base = mixc(base, "#aca69b", sstep(0.5, 0.8, stain) * 0.35)
    return mixc(base, "#7d7a74", tarline * 0.8), 0.9 - tarline * 0.25, mott * 0.3 + speck * 0.2 + tarline * 0.3 - pore * 0.3


def sand():
    ph = m("FRACT", V * 28 + noise(0.7, 3, 0.5, seed=51) * 2.0 + noise(2.5, 2, seed=52) * 0.3)
    rip = sstep(0.0, 0.7, ph) * (1.0 - sstep(0.7, 1.0, ph))
    amp = sstep(0.3, 0.7, noise(0.4, 2, seed=53)) * 0.7 + 0.3
    grains = noise(90, 2, 0.5, seed=54)
    mott = noise(0.8, 4, 0.6, seed=56)
    _, sc = vor(40, seed=55)
    speck = sstep(0.95, 0.97, sep(sc, 0))
    col = mulc("#dcc59f", 0.88 + grains * 0.14 + rip * amp * 0.1 + (mott - 0.5) * 0.12)
    return mixc(col, "#8e7f6c", speck * 0.5), 0.93, rip * amp + grains * 0.15


def desert():
    soil_n = noise(2.0, 6, 0.6, seed=61)
    big = noise(0.3, 3, 0.5, seed=62)
    fine = noise(70, 2, 0.5, seed=63)
    d1, c1 = vor(7, seed=64, wv=warp(25, 0.06, 66))             # irregular stones 6-13 cm (desert pavement)
    d2, c2 = vor(22, seed=65)                                   # grit 1-3 cm
    d3, c3 = vor(2.2, seed=67, wv=warp(8, 0.15, 68))            # scattered limestone rocks 15-35 cm
    pres1 = 1.0 - sstep(0.25 + big * 0.6, 0.27 + big * 0.6, sep(c1, 0))
    pres2 = 1.0 - sstep(0.45, 0.47, sep(c2, 0))
    pres3 = 1.0 - sstep(0.12, 0.14, sep(c3, 0))
    r1, r3 = 0.25 + sep(c1, 1) * 0.2, 0.25 + sep(c3, 1) * 0.15

    def dome(d, r, pres): return m("SQRT", mx(1.0 - (d / r) * (d / r), 0.0)) * pres
    dome1, dome2, dome3 = dome(d1, r1, pres1), dome(d2, 0.3, pres2), dome(d3, r3, pres3)
    peb1, peb2, peb3 = sstep(0.0, 0.2, dome1), sstep(0.0, 0.2, dome2), sstep(0.0, 0.15, dome3)
    halo = (1.0 - sstep(0.0, 0.12, d1 - r1)) * pres1            # darker soil ring hugging each stone
    pcol = ramp(sep(c1, 2), [(0.0, "#4a382a"), (0.25, "#6b5541"), (0.5, "#8d8579"), (0.7, "#a89c88"), (0.85, "#8a5638"), (1.0, "#5e4a3a")])
    pcol = mulc(pcol, 0.75 + dome1 * 0.35)
    rcol = mulc(ramp(sep(c3, 2), [(0.0, "#bdb5a5"), (0.5, "#a59c8c"), (1.0, "#c4b398")]), 0.55 + dome3 * 0.5 + (fine - 0.5) * 0.3)
    soil = mixc("#c2a983", "#ad9271", soil_n)
    soil = mixc(soil, "#d1bb97", sstep(0.55, 0.75, big) * 0.6)
    soil = mulc(soil, 0.9 + fine * 0.2 - halo * 0.12)
    col = mixc(mixc(mixc(soil, "#7d6c58", peb2 * 0.75), pcol, peb1), rcol, peb3)
    h = soil_n * 0.15 + fine * 0.05 + dome1 * 0.8 + dome2 * 0.3 + dome3 * 1.5
    return col, 0.95 - peb1 * 0.3 - peb3 * 0.1, h


def grass():
    patch = noise(0.5, 4, 0.6, seed=71)
    td, tc = vor(14, seed=72, wv=warp(30, 0.03, 76))            # tufts ~7 cm, dark gaps between
    tuft = 1.0 - sstep(0.15, 0.65, td)
    b1 = noise(30, 3, 0.7, sv=5, seed=73)
    b2 = noise(30, 3, 0.7, su=5, seed=74)
    blades = mx(b1, b2)
    dirt = sstep(0.62, 0.72, noise(1.2, 4, 0.6, seed=75))
    hue = ramp(patch * 0.75 + sep(tc, 0) * 0.25, [(0.25, "#6e7a40"), (0.45, "#909050"), (0.62, "#b5a663"), (0.8, "#c6b47e")])
    col = mulc(hue, 0.5 + tuft * 0.35 + blades * 0.4)
    return mixc(col, "#8a7356", dirt * 0.8), 0.92, tuft * 0.6 + blades * 0.4 - dirt * 0.3


def lot():
    """Dusty urban ground between buildings: compacted pale earth, old concrete patches, grit, sparse dry tufts."""
    big = noise(0.35, 3, 0.5, seed=81)
    soil_n = noise(1.6, 6, 0.6, seed=82)
    fine = noise(70, 2, 0.5, seed=83)
    # old concrete remnants: irregular patches with crumbly edges, only a shade greyer and smoother than the earth
    slab = sstep(0.55, 0.57, noise(0.5, 4, 0.6, dist=0.4, seed=84) + (noise(5, 4, 0.6, seed=86) - 0.5) * 0.08)
    ce, _ = vor(1.3, "DISTANCE_TO_EDGE", seed=87, wv=warp(5.0, 0.1, 88))
    crack = (1.0 - sstep(0.006, 0.012, ce)) * sstep(0.5, 0.56, noise(0.6, 2, seed=89)) * slab
    gd, gc = vor(28, seed=90)                                   # gravel 1-2 cm
    peb = (1.0 - sstep(0.25, 0.5, gd)) * sstep(0.75, 0.77, sep(gc, 0)) * (1.0 - slab * 0.8)
    fd, fc = vor(80, seed=95)                                   # grit
    grit = (1.0 - sstep(0.2, 0.45, fd)) * sstep(0.6, 0.62, sep(fc, 0))
    td, tc = vor(2.5, seed=91, wv=warp(20, 0.04, 92))           # dry grass tufts ~20-40 cm, clumped, fibrous ragged edge
    blades = mx(noise(40, 3, 0.7, su=6, seed=94), noise(40, 3, 0.7, sv=6, seed=96))
    clump = mx(sstep(0.5, 0.62, noise(0.45, 3, 0.6, seed=93)) * 0.75, 0.04) * (1.0 - slab * 0.9)
    there = 1.0 - sstep(clump - 0.01, clump, 1.0 - sep(tc, 0))
    tuft = sstep(0.5, 0.58, 0.95 - td * 2.5 + sstep(0.4, 0.7, blades) * 0.75) * there
    soil = mixc("#c4bcad", "#b7ae9e", soil_n)
    soil = mixc(soil, "#cdc6b8", sstep(0.5, 0.75, big) * 0.35)
    soil = mulc(soil, 0.95 + fine * 0.1 - (1.0 - sstep(0.0, 0.5, td)) * there * 0.08)
    conc = mulc(mixc("#c4c0b7", "#bab5ab", sstep(0.4, 0.7, big)), 0.95 + fine * 0.05 + (soil_n - 0.5) * 0.06)
    col = mixc(soil, conc, slab * 0.7)
    col = mixc(col, ramp(sep(fc, 1), [(0.0, "#a2988a"), (1.0, "#d2cbbe")]), grit * 0.35)
    col = mixc(col, ramp(sep(gc, 1), [(0.0, "#9c9180"), (0.4, "#cdc6b8"), (0.7, "#b0a491"), (1.0, "#8d8577")]), peb * 0.7)
    col = mixc(col, "#958c7a", crack * 0.6)
    tcol = ramp(sep(tc, 1), [(0.0, "#b4a984"), (0.5, "#c0b38c"), (1.0, "#a09d7c")])
    tcol = mixc(mixc(tcol, "#000000", 0.35), tcol, sstep(0.3, 0.7, blades))   # shaded gaps, straw blades
    col = mixc(col, tcol, tuft * 0.9)
    h = soil_n * 0.08 + fine * 0.1 + slab * 0.2 - crack * 0.3 + peb * 0.35 + grit * 0.1 + tuft * (0.5 + blades * 0.5)
    return col, 0.95 - slab * 0.06, h


def floor_tiles():
    """Interior floor: 40 cm beige terrazzo tiles, thin grout, subtle per-tile shade."""
    edge, rid, _, _ = bricks(6, 6, 6, seed=95, stagger=False)
    cd, cc = vor(55, seed=96, wv=warp(30, 0.02, 97))            # marble chips ~1-2 cm
    chip = (1.0 - sstep(0.3, 0.42, cd)) * sstep(0.3, 0.32, sep(cc, 0))
    fd, fc = vor(110, seed=98)                                  # fine chips
    grit = (1.0 - sstep(0.25, 0.4, fd)) * sstep(0.3, 0.32, sep(fc, 0))
    wear = noise(0.8, 4, 0.6, seed=99)
    tile = ramp(rid, [(0.0, "#dcd3c4"), (0.5, "#d8cebe"), (1.0, "#d4cab9")])
    tile = mixc(tile, ramp(sep(cc, 1), [(0.0, "#a39888"), (0.3, "#efe9df"), (0.6, "#c2ad92"), (0.8, "#8f8a84"), (1.0, "#b89a83")]), chip * 0.55)
    tile = mixc(tile, ramp(sep(fc, 1), [(0.0, "#9a9186"), (1.0, "#ece6dc")]), grit * 0.4)
    tile = mulc(tile, 0.97 + (wear - 0.5) * 0.08)
    grout = 1.0 - sstep(0.0015, 0.003, edge)
    h = sstep(0.0, 0.004, edge) + chip * 0.02 + (rid - 0.5) * 0.05
    return mixc(tile, "#b8ad9b", grout), 0.3 + (wear - 0.5) * 0.12 + grout * 0.5, h


def water():
    """Normal source for M_EscWater (only _N is sampled): swell, cross chop and ripples."""
    swell = noise(0.4, 3, 0.5, su=0.6, seed=101)
    chop = 1.0 - m("ABSOLUTE", noise(1.2, 3, 0.5, seed=102) * 2.0 - 1.0)
    rip = noise(4.0, 3, 0.55, seed=103)
    return 0.5, 0.06, swell * 0.6 + chop * 0.25 + rip * 0.08


# name: (builder, tile metres, height depth in metres per unit)
SETS = {
    "Plaster": (plaster, 4.0, 0.002),
    "Stone": (stone, 4.0, 0.012),
    "Asphalt": (asphalt, 6.0, 0.004),
    "Paving": (paving, 3.0, 0.004),
    "RoofConcrete": (roof_concrete, 6.0, 0.003),
    "Sand": (sand, 4.0, 0.012),
    "Desert": (desert, 6.0, 0.015),
    "Grass": (grass, 4.0, 0.008),
    "Lot": (lot, 6.0, 0.006),
    "Tiles": (floor_tiles, 2.4, 0.002),
    "Water": (water, 8.0, 0.35),
}


# ---------------------------------------------------------------- baking
def setup():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = SAMPLES
    sc.cycles.device, p = "CPU", None
    try:
        p = bpy.context.preferences.addons["cycles"].preferences
        for t in ("OPTIX", "CUDA"):
            p.compute_device_type = t
            p.refresh_devices()
            if any(d.type == t for d in p.devices):
                for d in p.devices:
                    d.use = d.type == t
                sc.cycles.device = "GPU"
                break
    except Exception as e:  # no GPU backend: CPU is fine for emission bakes
        print("GPU setup failed:", e)
    print("Cycles device:", sc.cycles.device, getattr(p, "compute_device_type", ""))
    bpy.ops.mesh.primitive_plane_add(size=1)
    return bpy.context.active_object


def bake_set(plane, img, name, fn, tile):
    global NT, U, V, TILE
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    NT, TILE = mat.node_tree, tile
    NT.nodes.clear()
    emis = NT.nodes.new("ShaderNodeEmission")
    NT.links.new(emis.outputs[0], NT.nodes.new("ShaderNodeOutputMaterial").inputs[0])
    uv = NT.nodes.new("ShaderNodeSeparateXYZ")
    NT.links.new(NT.nodes.new("ShaderNodeTexCoord").outputs["UV"], uv.inputs[0])
    U, V = S(uv.outputs[0]), S(uv.outputs[1])
    passes = fn()
    tex = NT.nodes.new("ShaderNodeTexImage")
    tex.image = img
    NT.nodes.active = tex
    plane.data.materials.clear()
    plane.data.materials.append(mat)
    out, buf = [], np.empty(RES * RES * 4, np.float32)
    for s in passes:
        put(emis.inputs["Color"], s if isinstance(s, S) else (s, s, s, 1.0))
        bpy.ops.object.bake(type="EMIT", margin=0, use_clear=True)
        img.pixels.foreach_get(buf)
        out.append(buf.reshape(RES, RES, 4)[::-1, :, :3].copy())  # top row first
    return out


# ---------------------------------------------------------------- image helpers (top-down HxW[xC] arrays)
def u8(a): return np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
def srgb(x): x = np.clip(x, 0, 1); return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)
def to_lin(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def write_png(path, a):
    a = a if a.ndim == 3 else a[..., None]
    h, w, c = a.shape
    raw = b"".join(b"\x00" + a[y].tobytes() for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, {1: 0, 3: 2, 4: 6}[c], 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def read_png(path):
    """Reads only what write_png writes (8-bit, filter 0)."""
    d = open(path, "rb").read()
    w, h, _, ct = struct.unpack(">IIBB", d[16:26])
    c = {0: 1, 2: 3, 6: 4}[ct]
    idat, p = b"", 8
    while p < len(d):
        n, t = struct.unpack(">I4s", d[p:p + 8])
        idat += d[p + 8:p + 8 + n] if t == b"IDAT" else b""
        p += 12 + n
    return np.frombuffer(zlib.decompress(idat), np.uint8).reshape(h, w * c + 1)[:, 1:].reshape(h, w, c)


def blur(a, r):
    """Wrap-around box blur, radius r px."""
    for ax in (0, 1):
        a = sum(np.roll(a, k, ax) for k in range(-r, r + 1)) / (2 * r + 1)
    return a


def normal_map(h, mx_, my_):
    """h in metres, top-down rows; mx_/my_ metres per pixel. DirectX/UE: G = -dh/d(down)."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * mx_)
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * my_)
    n = np.dstack([-dx, -dy, np.ones_like(h)])
    return n / np.linalg.norm(n, axis=2, keepdims=True) * 0.5 + 0.5


def seam(name, a):
    """Tiling check: wrap-around neighbour difference vs the average interior neighbour difference."""
    a = a.astype(np.int16)
    sx, sy = np.abs(a[:, 0] - a[:, -1]), np.abs(a[0] - a[-1])
    ix, iy = np.abs(np.diff(a, axis=1)).mean(), np.abs(np.diff(a, axis=0)).mean()
    ok = sx.mean() <= 2 * ix + 1 and sy.mean() <= 2 * iy + 1
    print(f"  {name:22s} seam max L/R {sx.max():3d} T/B {sy.max():3d} | mean {sx.mean():5.2f} {sy.mean():5.2f}"
          f" vs interior {ix:5.2f} {iy:5.2f}  {'OK' if ok else 'SEAM!'}")
    return ok


def save(name, kind, a):
    write_png(os.path.join(OUT, f"T_{name}_{kind}.png"), a)
    return seam(f"T_{name}_{kind}", a)


# ---------------------------------------------------------------- window atlas (numpy, sRGB values)
def window_cell(kind):
    n, W, H = RES // 2, 2.8, 3.2
    px, py = W / n, H / n
    x = ((np.arange(n) + 0.5) * px)[None, :]
    y = (H - (np.arange(n) + 0.5) * py)[:, None]                 # metres above the floor line, row 0 = top
    bc, rough, h, a = np.ones((n, n, 3)), np.full((n, n), 0.85), np.zeros((n, n)), np.ones((n, n))

    def box(x0, y0, x1, y1):
        return (np.clip(np.minimum(x - x0, x1 - x) / px + 0.5, 0, 1) * np.clip(np.minimum(y - y0, y1 - y) / py + 0.5, 0, 1))

    def paint(msk, col, r, hh, alpha=0.0):
        bc[:] = bc * (1 - msk[..., None]) + np.asarray(col) * msk[..., None]
        rough[:] = rough * (1 - msk) + r * msk
        h[:] = h * (1 - msk) + hh * msk
        a[:] = a * (1 - msk) + alpha * msk

    alu, shut, rail, sill = np.array([.80, .81, .81]), np.array([.86, .84, .80]), np.array([.22, .23, .24]), np.array([.83, .80, .75])
    top, bot = np.array([.60, .68, .76]), np.array([.13, .16, .19])
    if kind == "door":
        x0, y0, x1, y1, shut_to = 0.8, 0.03, 2.0, 2.35, 1.95
    else:
        x0, y0, x1, y1 = 0.7, 0.95, 2.1, 2.45
        shut_to = {"plain": y1, "half": 1.72, "closed": y0}[kind]
    paint(box(x0, y0, x1, y1), alu * 0.9, 0.45, -0.09)              # outer frame / reveal
    f, s, mid = 0.05, 0.045, (x0 + x1) / 2
    for i, (sx0, sx1, z) in enumerate(((x0 + f, mid + 0.02, -0.1), (mid - 0.02, x1 - f, -0.085))):
        paint(box(sx0, y0 + f, sx1, y1 - f), alu, 0.4, z)             # sliding sash
        gx0, gx1, gy0, gy1 = sx0 + s, sx1 - s, y0 + f + s, y1 - f - s
        g = np.clip((y - gy0) / (gy1 - gy0), 0, 1)[..., None] ** 1.5
        glass = bot + (top - bot) * g + 0.10 * np.exp(-((x - gx0 - 0.55 * (y - gy0) - 0.15) / 0.07) ** 2)[..., None]
        if (kind == "plain" and i == 0) or (kind == "door" and i == 1):  # curtain behind the glass
            cur = np.array([.82, .78, .70]) * (0.85 + 0.15 * np.sin(x * 2 * np.pi / 0.09))[..., None]
            cm = box(gx0, gy0, gx0 + (gx1 - gx0) * 0.65, gy1)[..., None]
            glass = glass * (1 - 0.6 * cm) + cur * 0.6 * cm
        paint(box(gx0, gy0, gx1, gy1), np.broadcast_to(glass, bc.shape), 0.05, z - 0.01)
    g = 0.035                                                        # shutter guide rails
    paint(box(x0, y0, x0 + g, y1), shut * 0.9, 0.55, -0.045)
    paint(box(x1 - g, y0, x1, y1), shut * 0.9, 0.55, -0.045)
    if shut_to < y1 - 1e-3:                                          # trisol slats (4.5 cm pitch) + bottom bar
        t = ((y1 - y) / 0.045) % 1.0
        prof = np.sin(np.pi * t) * np.ones_like(x)
        col = shut * (0.8 + 0.2 * prof)[..., None] * np.where(t < 0.07, 0.62, 1.0)[..., None]
        sm = box(x0 + g, shut_to, x1 - g, y1)
        paint(sm, col, 0.55, -0.06 + 0.012 * prof)
        paint(box(x0 + g, shut_to, x1 - g, shut_to + 0.04), shut * 0.82, 0.5, -0.05)
    if kind == "door":
        paint(box(x0 - 0.15, 0.0, x1 + 0.15, 0.04), sill, 0.7, 0.04)   # threshold ledge
        rm = np.maximum(box(x0 - 0.1, 1.0, x1 + 0.1, 1.05), box(x0 - 0.1, 0.08, x1 + 0.1, 0.11))
        for bx in (x0 - 0.1, x1 + 0.06):
            rm = np.maximum(rm, box(bx, 0.04, bx + 0.04, 1.05))
        for bx in np.arange(x0 - 0.02, x1 + 0.03, 0.11):
            rm = np.maximum(rm, box(bx, 0.11, bx + 0.016, 1.0))
        paint(rm, rail, 0.45, 0.12)
    else:
        paint(box(x0 - 0.08, y0 - 0.06, x1 + 0.08, y0), sill, 0.7, 0.03)
        streak = sum(np.exp(-((x - sx) / 0.05) ** 2) for sx in (x0 - 0.04, x1 + 0.04)) * np.clip(1 - (y0 - 0.06 - y) / 0.8, 0, 1) * (y < y0 - 0.06)
        bc *= (1 - 0.07 * streak)[..., None]                         # dirt run-off below the sill ends
    hp = np.pad(h, 16, mode="edge")                                  # pad: a cell must not wrap into itself
    shadow = np.zeros_like(hp)                                       # sun from above: cast shadow downwards
    for k in range(1, 16):
        shadow = np.maximum(shadow, np.roll(hp, k, 0) - hp - k * py * 0.9)
    cav = np.clip(blur(hp, 6) - hp, 0, None)
    bc *= np.clip(1 - 4 * shadow - 3 * cav, 0.5, 1)[16:-16, 16:-16, None]
    return bc, rough, normal_map(blur(hp, 1), px, py)[16:-16, 16:-16], a


def windows():
    cells = [window_cell(k) for k in ("plain", "half", "door", "closed")]
    grid = lambda i: np.concatenate([np.concatenate([cells[0][i], cells[1][i]], 1), np.concatenate([cells[2][i], cells[3][i]], 1)], 0)
    bc, r, nrm, a = (grid(i) for i in range(4))
    print("  (atlas cells are picked per bay, not wrapped: the door ledge on the floor line shows as a T/B 'seam')")
    save("Windows", "BC", np.dstack([u8(bc), u8(a)]))
    save("Windows", "N", u8(nrm))
    save("Windows", "R", u8(r))
    return True


# ---------------------------------------------------------------- contact sheets
def sheets():
    names = list(SETS) + ["Windows"]
    cell, cols = 512, 4
    flat = np.zeros((cell * -(-len(names) // cols), cell * cols, 3), np.uint8)
    lit = flat.copy()
    L = np.array([-0.45, -0.55, 0.7]); L /= np.linalg.norm(L)       # light from the top-left (+G = image down)
    for i, nme in enumerate(names):
        bc = read_png(os.path.join(OUT, f"T_{nme}_BC.png"))[..., :3].astype(np.float32) / 255
        nn = read_png(os.path.join(OUT, f"T_{nme}_N.png")).astype(np.float32) / 127.5 - 1
        shade = np.clip(nn @ L, 0, 1)[..., None] * 0.85 + 0.25
        pair = [bc, srgb(to_lin(bc) * shade)]
        if nme != "Windows":                                         # 2x2 tiling at quarter res shows the seams
            pair = [np.tile(p.reshape(256, 4, 256, 4, 3).mean((1, 3)), (2, 2, 1)) for p in pair]
        else:
            pair = [p.reshape(512, 2, 512, 2, 3).mean((1, 3)) for p in pair]
        r, c = divmod(i, cols)
        flat[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = u8(pair[0])
        lit[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = u8(pair[1])
    os.makedirs(os.path.dirname(SHEET), exist_ok=True)
    write_png(SHEET, flat)
    write_png(SHEET.replace(".png", "_lit.png"), lit)
    print("sheets:", SHEET)


def main():
    want = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    os.makedirs(OUT, exist_ok=True)
    plane = setup()
    img = bpy.data.images.new("bake", RES, RES, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    ok = True
    for name, (fn, tile, depth) in SETS.items():
        if want and name not in want:
            continue
        t0 = time.time()
        bc, r, h = bake_set(plane, img, name, fn, tile)
        print(f"{name}: baked in {time.time() - t0:.1f}s, height {h[..., 0].min():.2f}..{h[..., 0].max():.2f}")
        ok &= save(name, "BC", u8(srgb(bc)))
        ok &= save(name, "N", u8(normal_map(h[..., 0] * depth, tile / RES, tile / RES)))
        ok &= save(name, "R", u8(r[..., 0]))
    if not want or "Windows" in want:
        ok &= windows()
    files = [f"T_{n}_{k}.png" for n in list(SETS) + ["Windows"] for k in ("BC", "N", "R")]
    missing = [f for f in files if not os.path.exists(os.path.join(OUT, f))]
    print(f"{len(files) - len(missing)}/{len(files)} textures in {OUT}", "missing: " + ", ".join(missing) if missing else "")
    if not missing:
        sheets()
    print("ALL SEAMLESS" if ok else "SEAM CHECK FAILED")


main()
