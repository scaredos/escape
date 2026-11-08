"""Five cars (sedan, taxi, van, pickup, hunter_jeep) for UE Chaos Vehicles, from one parametric builder.

    blender -b --factory-startup -P Tools/blender/veh_cars.py -- --out <Art/out> --renders <Art/renders> [--only sedan,van]

Per car: Art/out/SK_veh_<id>.fbx + .json sidecar, Art/renders/veh_<id>_34.png + _side.png.
Metres, +X forward, +Y = vehicle left (driver side), Z up, origin on the ground under the centre.
"""
import bmesh, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veh_common import *  # noqa: F401,F403  (Vector, Matrix, math, prim, Rig, wheel, export/check/render)

A = args()
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
with open(os.path.join(ROOT, "Data", "characters", "roster.json"), encoding="utf-8") as f:
    FAC = json.load(f)["faction"]

ROLE = {"Glass": ("2A3440", 0.15), "Tyre": ("1C1C1C", 0.9), "Rim": ("B8B8B8", 0.35), "Trim": ("3A3A3A", 0.7),
        "Headlight": ("F2E6B0", 0.3), "Taillight": ("B3261E", 0.35)}
WHEELS = (("wheel_fl", 1, 1), ("wheel_fr", 1, -1), ("wheel_rl", -1, 1), ("wheel_rr", -1, -1))
RY90 = Matrix.Rotation(math.radians(90), 4, "Y")  # cylinder axis Z -> X


# ---------------------------------------------------------------- geometry helpers
def prism(pts, y0, y1, bevel=0.0, taper=None):
    """Side profile pts [(x, z), ...] extruded from y0 to y1. taper=(z0, z1, d) pulls |y| in by up to d at z1."""
    bm = bmesh.new()

    def yy(y, z):
        if not taper:
            return y
        k = min(max((z - taper[0]) / (taper[1] - taper[0]), 0.0), 1.0)
        return y - math.copysign(taper[2] * k, y)

    a = [bm.verts.new((x, yy(y0, z), z)) for x, z in pts]
    b = [bm.verts.new((x, yy(y1, z), z)) for x, z in pts]
    bm.faces.new(a)
    bm.faces.new(b[::-1])
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:], offset=bevel, segments=2, affect="EDGES",
                        profile=0.5, clamp_overlap=True)
    return bm


def beam(a, b, t, bevel=0.0):
    """Box from a to b with a t x t cross-section."""
    a, b = Vector(a), Vector(b)
    rot = Vector((1, 0, 0)).rotation_difference((b - a).normalized()).to_matrix().to_4x4()
    return prim("cube", (a + b) / 2, Vector(((b - a).length, t, t)), rot=rot, bevel=bevel)


def tube(a, b, r, segs=8):
    a, b = Vector(a), Vector(b)
    rot = Vector((0, 0, 1)).rotation_difference((b - a).normalized()).to_matrix().to_4x4()
    return prim("cyl", (a + b) / 2, Vector((r, r, (b - a).length)), rot=rot, segs=(segs, 1))


def slab(a, b, inside, t=0.022, trim=0.06):
    """Thin (x, z) quad lying on the profile edge a-b, proud by t on the side away from `inside`."""
    a, b = Vector(a), Vector(b)
    a, b = a.lerp(b, trim), b.lerp(a, trim)
    d = (b - a).normalized()
    n = Vector((d.y, -d.x))
    if n.dot(Vector(inside) - a) > 0:
        n = -n
    return [tuple(a - n * 0.01), tuple(b - n * 0.01), tuple(b + n * t), tuple(a + n * t)]


def tyre(c, r, w, rot=None, segs=20):
    """Cylinder with rounded shoulders (cap edges bevelled)."""
    bm = wheel(c, r, w, segs) if rot is None else prim("cyl", Vector(c), Vector((r, r, w)), rot=rot, segs=(segs, 1))
    rims = [e for e in bm.edges if len(e.link_faces) == 2 and any(len(f.verts) > 4 for f in e.link_faces)]
    bmesh.ops.bevel(bm, geom=rims, offset=min(r, w) * 0.22, segments=2, affect="EDGES", profile=0.5,
                    clamp_overlap=True)
    return bm


# ---------------------------------------------------------------- parametric car
class Car:
    def __init__(s, vid, paint, r, tw, xf, xr, wy, rim=ROLE["Rim"][0]):
        s.vid, s.paint, s.r, s.tw, s.axles = vid, paint.upper(), r, tw, (xr, xf)
        s.R = Rig(vid)
        s.R.bone("root", (0, 0, 0), (0.5, 0, 0))
        s.R.bone("chassis", (0, 0, r), (0.5, 0, r), "root")
        s.wc = {}
        for n, fx, sy in WHEELS:
            x = xf if fx > 0 else xr
            s.wc[n] = Vector((x, sy * wy, r))
            s.R.bone(n, s.wc[n], (x, sy * (wy + 0.2), r), "root")  # tail 0.2 m outward along the axle
        s.m = {"Paint": s.R.mat("Paint", s.paint, 0.45)}  # slot 0
        for k, (h, ro) in ROLE.items():
            s.m[k] = s.R.mat(k, rim if k == "Rim" else h, ro)
        for n, c in s.wc.items():
            s.R.add(tyre(c, r, tw), n, s.m["Tyre"])
            s.R.add(wheel(c, r * 0.6, tw + 0.02, 12), n, s.m["Rim"])
            s.R.add(wheel(c, r * 0.2, tw + 0.05, 8), n, s.m["Trim"])

    def mat(s, role, hexv, rough=0.5):
        s.m.setdefault(role, s.R.mat(role, hexv, rough))
        return role

    def add(s, bm, role="Paint"):
        s.R.add(bm, "chassis", s.m[role])

    def box(s, c, size, role="Paint", bevel=0.0):
        s.add(prim("cube", Vector(c), Vector(size), bevel=bevel), role)

    def pair(s, c, size, role="Paint", bevel=0.0):
        for sy in (1, -1):
            s.box((c[0], sy * c[1], c[2]), size, role, bevel)

    def body(s, top, xf, xr, zb, half, ra, bevel=0.05, n=10):
        """Lower body: sill at zb, round wheel arches of radius ra, `top` = profile from front-top to rear-top."""
        pts = [(xr + 0.1, zb)]
        t0 = math.asin(max(-1.0, min(1.0, (zb - s.r) / ra)))
        for ax in s.axles:
            pts += [(ax + ra * math.cos(a), s.r + ra * math.sin(a))
                    for a in (math.pi - t0 - (math.pi - 2 * t0) * i / n for i in range(n + 1))]
        pts += [(xf - 0.1, zb), (xf, zb + 0.1)] + list(top) + [(xr, zb + 0.1)]
        s.add(prism(pts, -half, half, bevel))


def greenhouse(c, bf, tf, tr, br, wb, wt, xB=None, apil=0.07, cpil=0.12):
    """Dark-glass cabin (base front bf, top front tf, top rear tr, base rear br; half widths wb->wt),
    body-colour roof cap and A/(B)/C pillars."""
    z0, zt = min(bf[1], br[1]), tf[1]
    c.add(prism([bf, tf, tr, br], -wb, wb, 0.02, (z0, zt, wb - wt)), "Glass")
    c.add(prism([(tf[0] + 0.03, zt - 0.03), (tf[0] - 0.03, zt + 0.05), (tr[0] + 0.03, zt + 0.05),
                 (tr[0] - 0.04, zt - 0.03)], -(wt + 0.03), wt + 0.03, 0.025))
    y = lambda z: wb - (wb - wt) * (z - z0) / (zt - z0)
    tuck = lambda b, t: (b[0] + (t[0] - b[0]) * (t[1] - 0.045 - b[1]) / (t[1] - b[1]), t[1] - 0.045)  # end under the roof
    mid = Vector(((bf[0] + br[0]) / 2, (z0 + zt) / 2))

    def sunk(b, t, w):
        """Pillar line b->tuck(b, t) moved into the glass so it stands only 12 mm proud of the windshield/rear glass."""
        d = Vector((t[0] - b[0], t[1] - b[1])).normalized()
        n = Vector((-d.y, d.x))
        n = (n if n.dot(mid - Vector(b)) > 0 else -n) * (w / 2 - 0.012)
        return [(q[0] + n.x, q[1] + n.y) for q in (b, tuck(b, t))]

    for sy in (1, -1):
        # and sunk into the side glass the same way, so no corner pokes past the roof cap's edge
        p = lambda x, z, t: (x, sy * (y(z) - t / 2 + 0.012), z)
        for b, t_, w in ((bf, tf, apil), (br, tr, cpil)):
            lo, hi = sunk(b, t_, w)
            c.add(beam(p(*lo, w), p(*hi, w), w))
        if xB is not None:
            zB = bf[1] + (br[1] - bf[1]) * (xB - bf[0]) / (br[0] - bf[0])
            c.add(beam(p(xB, zB, 0.09), p(xB, zt - 0.045, 0.09), 0.09))


def seams(c, half, xs, z0, z1, handles=(), hz=None):
    """Door seams (thin dark lines) on both flanks, plus door handles."""
    for x in xs:
        c.pair((x, half, (z0 + z1) / 2), (0.014, 0.012, z1 - z0), "Trim")
    for x in handles:
        c.pair((x, half + 0.008, hz), (0.13, 0.02, 0.035), "Trim")


def four_seats(xf, xr, y, zf, zr):
    return [("driver", (xf, y, zf)), ("passenger", (xf, -y, zf)), ("rear_l", (xr, y, zr)), ("rear_r", (xr, -y, zr))]


# ---------------------------------------------------------------- the five cars
def sedan(vid="sedan", paint="3B6FB6"):
    W = 0.87
    c = Car(vid, paint, 0.32, 0.22, 1.38, -1.32, 0.74)
    c.body([(2.25, 0.70), (2.12, 0.80), (0.98, 0.90), (-1.62, 0.95), (-2.18, 0.97), (-2.25, 0.88)],
           2.25, -2.25, 0.24, W, 0.37)
    greenhouse(c, (0.98, 0.88), (0.15, 1.40), (-0.95, 1.40), (-1.62, 0.93), 0.81, 0.65, xB=-0.3, cpil=0.12)
    c.box((2.22, 0, 0.36), (0.16, 1.78, 0.18), "Trim", 0.04)
    c.box((-2.22, 0, 0.38), (0.16, 1.78, 0.20), "Trim", 0.04)
    c.box((2.245, 0, 0.53), (0.03, 0.66, 0.13), "Trim")
    c.pair((2.24, 0.6, 0.62), (0.04, 0.34, 0.10), "Headlight")
    c.pair((-2.24, 0.6, 0.78), (0.04, 0.36, 0.12), "Taillight")
    c.pair((0.86, 0.86, 0.94), (0.12, 0.10, 0.09), "Paint", 0.02)  # sits on the beltline against the A-pillar
    seams(c, W, (0.99, -0.27, -0.93), 0.32, 0.88, handles=(-0.12, -0.78), hz=0.8)
    # hip height 0.48: a 1.86 m character's head top (~hip + 0.88) stays under the roof cap (1.37)
    meta = dict(mass=1400, seats=four_seats(0.0, -0.9, 0.38, 0.48, 0.48),
                variants=[paint, "F2F2F2", "1C1C1C", "9AA0A6", "6E6E6E", "8C2F2A", "2F4A3A", "D9CBA8"])
    return c, meta


def taxi():
    c, meta = sedan("taxi", "F2F2F2")
    c.box((-0.4, 0, 1.465), (0.18, 0.5, 0.04), "Trim")
    c.box((-0.4, 0, 1.55), (0.22, 0.62, 0.14), c.mat("Sign", "F2C318", 0.4), 0.03)
    meta.update(variants=["F2F2F2", "E6E6E6"], sockets={"roof_sign": [-0.4, 0.0, 1.55]})
    return c, meta


def van():
    W = 0.96
    c = Car("van", "E8E6DF", 0.34, 0.24, 1.65, -1.55, 0.81)
    c.body([(2.45, 0.92), (2.36, 1.10), (1.95, 1.20), (1.22, 2.12), (1.12, 2.20), (-2.38, 2.20), (-2.45, 2.12)],
           2.45, -2.45, 0.30, W, 0.39, bevel=0.06)
    c.add(prism(slab((1.95, 1.20), (1.22, 2.12), (0, 1.2)), -0.84, 0.84, 0.01), "Glass")  # windshield
    win = [(1.75, 1.32), (1.21, 2.0), (0.72, 2.0), (0.72, 1.32)]
    c.add(prism(win, W - 0.01, W + 0.012, 0.008), "Glass")
    c.add(prism(win, -(W + 0.012), -(W - 0.01), 0.008), "Glass")
    c.pair((-2.46, 0.42, 1.72), (0.03, 0.66, 0.5), "Glass", 0.01)  # rear door windows
    c.box((-2.455, 0, 1.25), (0.02, 0.02, 1.7), "Trim")  # rear door split
    c.box((2.42, 0, 0.42), (0.16, 1.96, 0.20), "Trim", 0.04)
    c.box((-2.42, 0, 0.42), (0.16, 1.96, 0.20), "Trim", 0.04)
    c.box((2.45, 0, 0.62), (0.03, 0.9, 0.2), "Trim")
    c.pair((2.44, 0.68, 0.80), (0.04, 0.34, 0.12), "Headlight")
    c.pair((-2.46, 0.86, 0.9), (0.04, 0.12, 0.44), "Taillight")
    c.pair((1.84, 0.98, 1.36), (0.04, 0.08, 0.03), "Trim")
    c.pair((1.84, 1.0, 1.45), (0.07, 0.07, 0.24), "Trim", 0.015)
    seams(c, W, (1.24,), 0.36, 1.22)
    seams(c, W, (0.62,), 0.36, 2.0, handles=(0.78,), hz=1.15)
    # sliding cargo door on the right (kerb) side: rear seam, top seam, track, handle
    c.box((-0.78, -W, 1.18), (0.014, 0.012, 1.64), "Trim")
    c.box((-0.08, -W, 2.0), (1.4, 0.012, 0.014), "Trim")
    c.box((-1.55, -W - 0.005, 1.3), (1.5, 0.02, 0.03), "Trim")
    c.box((-0.62, -W - 0.008, 1.15), (0.13, 0.02, 0.035), "Trim")
    meta = dict(mass=2000, seats=[("driver", (1.0, 0.45, 0.95)), ("passenger", (1.0, -0.45, 0.95))],
                variants=["E8E6DF", "F2F2F2", "9AA0A6", "3A4A5C", "B8C7D6", "C9B88F"])
    return c, meta


def pickup():
    W = 0.92
    c = Car("pickup", "8C2F2A", 0.38, 0.26, 1.75, -1.45, 0.75)
    c.body([(2.6, 1.02), (2.5, 1.14), (1.2, 1.22), (-0.35, 1.22), (-0.35, 0.92), (-2.6, 0.92)],
           2.6, -2.6, 0.36, W, 0.43, 0.04)
    greenhouse(c, (1.25, 1.17), (0.45, 1.77), (-0.2, 1.77), (-0.3, 1.17), 0.86, 0.72, cpil=0.12)
    # open bed: floor liner, side walls with rail caps, tailgate
    c.box((-1.43, 0, 0.93), (2.14, 1.68, 0.03), "Trim")
    c.pair((-1.43, 0.88, 1.05), (2.14, 0.08, 0.34), "Paint", 0.02)
    c.pair((-1.43, 0.88, 1.225), (2.14, 0.10, 0.025), "Trim")
    c.box((-2.555, 0, 1.06), (0.08, 1.84, 0.34), "Paint", 0.02)
    c.box((-2.6, 0, 1.15), (0.02, 0.3, 0.05), "Trim")
    c.box((2.57, 0, 0.5), (0.16, 1.86, 0.22), "Trim", 0.04)
    c.box((-2.57, 0, 0.5), (0.16, 1.86, 0.20), "Trim", 0.04)
    c.box((2.6, 0, 0.78), (0.03, 0.86, 0.26), "Trim")
    c.pair((2.6, 0.64, 0.92), (0.04, 0.34, 0.12), "Headlight")
    c.pair((-2.6, 0.86, 1.02), (0.03, 0.1, 0.28), "Taillight")
    c.pair((1.12, 0.885, 1.25), (0.06, 0.07, 0.10), "Trim")  # mirror arm, sunk into the door top
    c.pair((1.12, 0.94, 1.31), (0.12, 0.08, 0.14), "Trim", 0.02)
    seams(c, W, (1.27, -0.25), 0.37, 1.21, handles=(-0.1,), hz=1.1)
    # hip 0.85: tallest head top ~1.73, under the roof cap (bottom 1.74)
    meta = dict(mass=1900, seats=[("driver", (0.05, 0.4, 0.85)), ("passenger", (0.05, -0.4, 0.85))],
                variants=["8C2F2A", "F2F2F2", "1C1C1C", "9AA0A6", "C9B88F", "2F4A6D"])
    return c, meta


def hunter_jeep():
    W = 0.95
    c = Car("hunter_jeep", FAC["uniform"], 0.40, 0.30, 1.4, -1.2, 0.78, rim=FAC["helmet"])
    canvas, patch = c.mat("Canvas", FAC["vest"], 0.9), c.mat("Patch", FAC["patch"], 0.5)
    # open tub: hood + floor + rear wall in the profile, side walls as boxes
    c.body([(2.08, 1.12), (2.02, 1.2), (0.9, 1.22), (0.9, 0.98), (-1.72, 0.98), (-1.72, 1.22), (-1.88, 1.22)],
           2.08, -1.88, 0.42, W, 0.46, 0.035)
    c.pair((-0.41, 0.91, 1.09), (2.62, 0.08, 0.30), "Paint", 0.02)
    c.pair((0.35, 0.953, 1.09), (0.2, 0.012, 0.14), patch)
    seams(c, W, (0.86, -0.12, -0.7), 0.46, 1.22, handles=(0.02, -0.56), hz=1.12)
    # open rear (seated heads stand above the bars): rear seats, canvas rolled up on the rear wall
    c.pair((-0.95, 0.42, 1.05), (0.46, 0.46, 0.14), "Trim", 0.02)
    c.pair((-1.22, 0.42, 1.3), (0.1, 0.46, 0.5), "Trim", 0.02)
    c.add(wheel((-1.8, 0, 1.31), 0.09, 1.72, 10), canvas)
    # windshield with frame and centre divider
    c.add(prism(slab((0.9, 1.22), (0.8, 1.68), (0, 1.4)), -0.84, 0.84), "Glass")
    for sy in (1, -1):
        c.add(beam((0.9, sy * 0.89, 1.2), (0.8, sy * 0.89, 1.72), 0.07))
    c.add(beam((0.8, 0.92, 1.70), (0.8, -0.92, 1.70), 0.07))
    c.add(beam((0.9, 0, 1.22), (0.8, 0, 1.69), 0.05))
    # front roll bar + rear hoop joined by roof rails, spotlight on the driver side
    for sy in (1, -1):
        for x in (-0.17, -1.55):
            c.add(tube((x, sy * 0.86, 1.2), (x, sy * 0.86, 1.78), 0.035), "Trim")
        c.add(tube((0.8, sy * 0.86, 1.70), (-0.17, sy * 0.86, 1.78), 0.03), "Trim")
        c.add(tube((-0.17, sy * 0.86, 1.78), (-1.55, sy * 0.86, 1.78), 0.03), "Trim")
    for x in (-0.17, -1.55):
        c.add(tube((x, 0.86, 1.78), (x, -0.86, 1.78), 0.035), "Trim")
    c.add(prim("cyl", Vector((-0.12, 0.55, 1.86)), Vector((0.06, 0.06, 0.14)), rot=RY90, segs=(10, 1)), "Trim")
    c.add(prim("cyl", Vector((-0.045, 0.55, 1.86)), Vector((0.05, 0.05, 0.02)), rot=RY90, segs=(10, 1)), "Headlight")
    # cockpit: dash, steering wheel (left), front seats
    c.box((0.82, 0, 1.12), (0.16, 1.7, 0.2), "Trim")
    c.add(beam((0.75, 0.42, 1.18), (0.6, 0.42, 1.3), 0.04), "Trim")
    c.add(prim("cyl", Vector((0.6, 0.42, 1.3)), Vector((0.17, 0.17, 0.03)),
               rot=Matrix.Rotation(math.radians(-60), 4, "Y"), segs=(12, 1)), "Trim")
    c.pair((0.2, 0.42, 1.05), (0.46, 0.46, 0.14), "Trim", 0.02)
    c.pair((-0.05, 0.42, 1.3), (0.1, 0.46, 0.5), "Trim", 0.02)
    # front: flat dark grille panel with three horizontal body-colour bars, square lamps, bumper, brush guard
    c.box((2.083, 0, 0.9), (0.02, 0.86, 0.3), "Trim")
    for z in (0.81, 0.9, 0.99):
        c.box((2.095, 0, z), (0.03, 0.86, 0.035), "Paint")
    for sy in (1, -1):
        c.box((2.085, sy * 0.68, 0.96), (0.03, 0.22, 0.18), "Trim")
        c.box((2.1, sy * 0.68, 0.96), (0.02, 0.16, 0.12), "Headlight")
        c.add(tube((2.17, sy * 0.45, 0.62), (2.17, sy * 0.45, 1.1), 0.03), "Trim")
    c.add(tube((2.17, 0.45, 1.1), (2.17, -0.45, 1.1), 0.03), "Trim")
    c.box((2.1, 0, 0.56), (0.12, 1.92, 0.22), "Trim", 0.03)
    # rear: bumper, lamps, spare tyre on a bracket
    c.box((-1.88, 0, 0.56), (0.12, 1.9, 0.2), "Trim", 0.03)
    c.pair((-1.89, 0.8, 0.82), (0.03, 0.14, 0.12), "Taillight")
    c.box((-1.91, 0, 1.08), (0.06, 0.24, 0.24), "Trim")
    c.add(tyre((-2.06, 0, 1.08), 0.4, 0.28, rot=RY90), "Tyre")
    c.add(prim("cyl", Vector((-2.06, 0, 1.08)), Vector((0.24, 0.24, 0.30)), rot=RY90, segs=(12, 1)), "Rim")
    c.add(prim("cyl", Vector((-2.06, 0, 1.08)), Vector((0.08, 0.08, 0.33)), rot=RY90, segs=(8, 1)), "Trim")
    c.pair((0.86, 0.94, 1.32), (0.05, 0.09, 0.025), "Trim")  # mirror stalk off the windshield post
    c.pair((0.84, 0.99, 1.32), (0.05, 0.07, 0.12), "Trim")
    meta = dict(mass=2400, awd=True, seats=four_seats(0.2, -0.95, 0.42, 1.12, 1.12),
                variants=[FAC["uniform"], FAC["vest"], FAC["helmet"]],
                sockets={"spotlight": [-0.035, 0.55, 1.86]})
    return c, meta


# ---------------------------------------------------------------- export + check + render
def loose_parts(me, names, tol=0.004):
    """Mesh islands not touching (intersecting, or within tol of) the rest of their bone's geometry.
    Returns [{bone, lo, hi}] for every group except the largest per bone; [] means nothing floats."""
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    lay = bm.verts.layers.int["bone"]
    isl = [-1] * len(bm.verts)
    n = 0
    for v in bm.verts:
        if isl[v.index] < 0:
            isl[v.index], stack = n, [v]
            while stack:
                for e in stack.pop().link_edges:
                    for w in e.verts:
                        if isl[w.index] < 0:
                            isl[w.index] = n
                            stack.append(w)
            n += 1
    par = list(range(n))

    def find(i):
        while par[i] != i:
            par[i] = par[par[i]]
            i = par[i]
        return i

    fi = [isl[f.verts[0].index] for f in bm.faces]
    fb = [f.verts[0][lay] for f in bm.faces]
    tree = BVHTree.FromBMesh(bm)
    links = [(fi[i], fi[j], fb[i], fb[j]) for i, j in tree.overlap(tree)]  # intersecting triangles
    for v in bm.verts:  # touching: a vertex within tol of another island's surface
        links += [(isl[v.index], fi[h[2]], v[lay], fb[h[2]]) for h in tree.find_nearest_range(v.co, tol)]
    for a, b, ba, bb in links:
        if ba == bb:
            par[find(a)] = find(b)
    groups = {}
    for v in bm.verts:
        groups.setdefault((v[lay], find(isl[v.index])), []).append(v.co.copy())
    out = []
    for b in {k[0] for k in groups}:
        gs = sorted((pts for k, pts in groups.items() if k[0] == b), key=len)
        for pts in gs[:-1]:
            out.append({"bone": names[b], "lo": [round(min(p[i] for p in pts), 3) for i in range(3)],
                        "hi": [round(max(p[i] for p in pts), 3) for i in range(3)]})
    bm.free()
    return out


def finish(c, mass, seats, variants, sockets=None, awd=False):
    names = [b[0] for b in c.R.bones]
    arm, body = c.R.build()
    loose = loose_parts(body.data, names)
    fbx = os.path.join(A["out"], f"SK_veh_{c.vid}.fbx")
    export_fbx(arm, body, fbx)
    rep = check_fbx(fbx)
    heads = rep["bone_heads_m"]
    meta = {"id": c.vid, "kind": "car", "mass_kg": mass,
            "wheels": [{"bone": n, "center": heads[n], "radius": c.r, "width": c.tw,
                        "steer": n.startswith("wheel_f"), "drive": awd or n.startswith("wheel_r")} for n, _, _ in WHEELS],
            "seats": [{"name": n, "pos": list(p)} for n, p in seats],
            "paint_slot": f"M_Paint_{c.paint}", "colour_variants": [v.upper() for v in variants],
            "sockets": sockets or {}}
    write_meta(fbx[:-4] + ".json", meta)
    problems = [n for n, _, _ in WHEELS if abs(heads[n][2] - c.r) > 1e-3 or
                (Vector(heads[n]) - c.wc[n]).length > 1e-3]
    if rep["roots"] != ["root"] or rep["unweighted_verts"] or rep["armature_scale"] != [1.0, 1.0, 1.0]:
        problems.append("rig")
    if loose:
        problems.append("loose_parts")
    renders = render_views(os.path.join(A["renders"], f"veh_{c.vid}"), [body])
    print("VEH", json.dumps({"id": c.vid, "fbx": fbx, "renders": renders, "problems": problems, "loose": loose,
                             **{k: rep[k] for k in ("tris", "bones", "roots", "dims_m_xyz", "unweighted_verts",
                                                    "armature_scale", "materials", "bone_heads_m")}}), flush=True)
    clear_scene()


if __name__ == "__main__":
    clear_scene()
    only = [x for x in A.get("only", "").split(",") if x]
    for fn in (sedan, taxi, van, pickup, hunter_jeep):
        if not only or fn.__name__ in only:
            car, meta = fn()
            finish(car, **meta)
