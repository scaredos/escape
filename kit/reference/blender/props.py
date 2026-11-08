"""Street / beach / rooftop props, gameplay set pieces, port and desert pieces for Escape Israel -> one static-mesh FBX
each (Art/out/props/SM_<Name>.fbx).

    blender -b --factory-startup -P Tools/blender/props.py -- [--only Palm,Bench] [--out <dir>] [--sheet <png>|none] [--cell 520x560] [--no-export]

Conventions (shared contract): built in metres, exported in centimetres; Z up, +X forward (= UE +X), pivot at the base
centre on the ground (Boat: on the waterline); UE +Y = Blender -Y (the FBX importer mirrors Y, FbxUtilsImport ConvertPos),
so a contract "+Y" is built along -Y here; flat-colour material slots M_<Role>_<HEX>. Props that players/cars should bump into also carry
UCX_SM_<Name>_NN convex collision parts (trunk only for trees), which the UE FBX importer turns into simple collision
(Tools/ue/import_props.py). Prints "PROPS OK {json}" with tri counts and sizes; contact sheets of 20 props each go to
Saved/Agent/props_sheet.png, props_sheet2.png, ...
"""
import bpy, bmesh, json, math, os, random, sys
from mathutils import Vector, Matrix, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from char_build import material, prim  # noqa: E402  (reuse: M_<Role>_<HEX> materials, primitive bmesh)

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
Z = Vector((0, 0, 1))


def V(x, y, z):
    return Vector((x, y, z))


def rot(deg, axis):
    return Matrix.Rotation(math.radians(deg), 4, axis)


# ---------------------------------------------------------------- geometry helpers (all return a new bmesh)
def box(c, s, r=None, bevel=0.0):
    return prim("cube", Vector(c), Vector(s), rot=r, bevel=bevel)


def cyl(c, r, h, segs=12, r2=None, m=None):
    """Cylinder (cone when r2 is given) of height h centred on c, axis Z before the rotation m."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h,
                          matrix=Matrix.Translation(Vector(c)) @ (m or Matrix.Identity(4)))
    return bm


def bar(a, b, w, h=None):
    """Box beam from a to b, cross-section w x h (h is the side closest to vertical)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    r = d.to_track_quat("Z", "X" if abs(d.normalized().z) > 0.95 else "Y").to_matrix().to_4x4()
    return box((a + b) / 2, (w, h or w, d.length), r=r)


def tube(pts, radii, segs=8, twist=0.0, caps=True):
    """Swept tube through pts (parallel-transport frames, no flipping). twist rotates ring i by i*twist."""
    pts = [Vector(p) for p in pts]
    radii = radii if isinstance(radii, (list, tuple)) else [radii] * len(pts)
    n = len(pts)
    tans = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    nrm = tans[0].cross(V(1, 0, 0) if abs(tans[0].x) < 0.9 else V(0, 1, 0)).normalized()
    bm, rings = bmesh.new(), []
    for i, (p, t) in enumerate(zip(pts, tans)):
        if i:
            nrm = tans[i - 1].rotation_difference(t) @ nrm
        nrm = (nrm - t * nrm.dot(t)).normalized()
        bi = t.cross(nrm)
        rings.append([bm.verts.new(p + (nrm * math.cos(a) + bi * math.sin(a)) * radii[i])
                      for a in (2 * math.pi * k / segs + twist * i for k in range(segs))])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(segs):
            bm.faces.new((r0[k], r0[(k + 1) % segs], r1[(k + 1) % segs], r1[k]))
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return bm


def blob(c, r, sub=2, amp=0.2, seed=0.0, scale=(1, 1, 1)):
    """Lumpy foliage ball: icosphere pushed in/out by Perlin noise."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    off = V(seed * 7.31, seed * 3.17, seed * 5.71)
    for v in bm.verts:
        n = v.co.normalized()
        k = r * (1 + amp * noise.noise(n * 1.7 + off))
        v.co = Vector(c) + V(n.x * scale[0], n.y * scale[1], n.z * scale[2]) * k
    return bm


def sheet(polys):
    """Double-sided thin surface (leaves, fabric, flags): each polygon plus a reversed copy."""
    bm = bmesh.new()
    for poly in polys:
        for order in (poly, poly[::-1]):
            bm.faces.new([bm.verts.new(Vector(p)) for p in order])
    return bm


def convex(points):
    bm = bmesh.new()
    res = bmesh.ops.convex_hull(bm, input=[bm.verts.new(p) for p in points])
    junk = list({g for g in res["geom_interior"] + res["geom_unused"] if isinstance(g, bmesh.types.BMVert)})
    bmesh.ops.delete(bm, geom=junk, context="VERTS")
    return bm


def skin(rings, segs=None, wrap=False):
    """Quads between consecutive point rings over ring edges k -> k+1 for k in segs (default: every edge, closed loops);
    the last ring joins the first when wrap. Coincident points weld, so a ring of one repeated point closes a fan."""
    bm = bmesh.new()
    vs = [[bm.verts.new(Vector(p)) for p in r] for r in rings]
    n = len(vs[0])
    for r0, r1 in zip(vs, vs[1:] + vs[:1] if wrap else vs[1:]):
        for k in range(n) if segs is None else segs:
            bm.faces.new((r0[k], r0[(k + 1) % n], r1[(k + 1) % n], r1[k]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    return bm


def lathe(profile, c, segs=16, m=None, wrap=True):
    """Solid of revolution: (radius, z) profile (counter-clockwise in r/z = outward faces; closed when wrap) swept round
    the local Z axis, turned by m and centred on c. Rings, tyres, tori."""
    m = Matrix.Translation(Vector(c)) @ (m or Matrix.Identity(4))
    angs = [2 * math.pi * k / segs for k in range(segs)]
    return skin([[m @ V(r * math.cos(a), r * math.sin(a), z) for a in angs] for r, z in profile], wrap=wrap)


def torus(c, R, r, segs=16, rsegs=6, m=None):
    return lathe([(R + r * math.cos(t), r * math.sin(t)) for t in (2 * math.pi * k / rsegs for k in range(rsegs))],
                 c, segs, m)


def cap(points, flip=False):
    """Flat (possibly concave) polygon through points, triangulated."""
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(Vector(p)) for p in (points[::-1] if flip else points)])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm


def moved(bm, m):
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts[:])
    return bm


class Prop:
    """Collects parts into one mesh SM_<name> (one material slot per role/colour) + UCX collision hulls."""

    def __init__(self, name):
        self.name, self.bm, self.mats, self.ucx = name, bmesh.new(), [], []

    def add(self, src, role, hexv, rough=0.75, smooth=False):
        m = material(role, hexv, rough)
        if m not in self.mats:
            self.mats.append(m)
        vmap = {v: self.bm.verts.new(v.co) for v in src.verts}
        for f in src.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:  # duplicate face
                continue
            nf.material_index, nf.smooth = self.mats.index(m), smooth
        src.free()

    def collide(self, src):
        """Collision part = convex hull of src's vertices (src consumed)."""
        self.ucx.append(convex([v.co.copy() for v in src.verts]))
        src.free()

    def recenter(self):
        """Put the XY centre of the bounding box on the pivot."""
        xs, ys = [v.co.x for v in self.bm.verts], [v.co.y for v in self.bm.verts]
        d = V(-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0)
        for b in [self.bm] + self.ucx:
            bmesh.ops.translate(b, vec=d, verts=b.verts[:])

    def build(self):
        col = bpy.context.scene.collection
        name = f"SM_{self.name}"
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        me.set_sharp_from_angle(angle=math.radians(40))  # smooth parts keep crisp edges at caps / corners
        obj = bpy.data.objects.new(name, me)
        col.objects.link(obj)
        hulls = []
        for i, b in enumerate(self.ucx):
            hme = bpy.data.meshes.new(f"UCX_{name}_{i:02d}")
            b.to_mesh(hme)
            b.free()
            h = bpy.data.objects.new(hme.name, hme)
            h.display_type, h.hide_render = "WIRE", True
            col.objects.link(h)
            hulls.append(h)
        return obj, hulls


# ---------------------------------------------------------------- props
def palm(P, rnd):
    """Date palm ~9 m: diamond-patterned curved trunk, crown, 13 drooping split fronds, date clusters."""
    H, n = 7.3, 30
    pts, rad = [], []
    for i in range(n + 1):
        t = i / n
        pts.append(V(0.6 * t * t, 0.15 * math.sin(t * 2.2), H * t))
        r = 0.26 - 0.07 * t + 0.16 * max(0.0, 1 - t / 0.07)  # root flare
        rad.append(r * (1.08 if i % 2 else 0.93))
    P.add(tube(pts, rad, segs=8, twist=math.pi / 8), "Trunk", "7A6650", 0.95)
    P.collide(tube([pts[0], pts[n // 2], pts[-1]], [0.3, 0.24, 0.2], segs=8))
    top = pts[-1]
    P.add(prim("sphere", top + V(0, 0, 0.1), V(0.36, 0.36, 0.5), segs=(8, 6)), "Crown", "5E5034", 0.9)
    for k in range(3):  # date clusters
        a = k * 2.1 + 0.4
        c = top + V(math.cos(a) * 0.42, math.sin(a) * 0.42, -0.5)
        P.add(bar(top + V(math.cos(a) * 0.15, math.sin(a) * 0.15, -0.05), c + V(0, 0, 0.2), 0.04), "Stalk", "C98B2E")
        P.add(prim("sphere", c, V(0.17, 0.17, 0.3), segs=(6, 5)), "Dates", "D9822B", 0.6)
    N, golden = 14, math.radians(137.5)
    for k in range(N):
        f = k / (N - 1)  # 0 = top fronds, 1 = lowest
        dry = k >= N - 2
        a = k * golden + rnd.uniform(-0.15, 0.15)
        e = math.radians(68 - 95 * f + rnd.uniform(-5, 5)) if not dry else math.radians(-62)
        L = (2.6 if dry else 3.1 + 0.9 * min(1, f * 2)) + rnd.uniform(-0.25, 0.25)
        sag = 0.25 + 0.45 * f
        role = ("FrondDry", "9C7A48") if dry else (("Frond", "5F7F38") if k % 2 else ("FrondLight", "7C9447"))
        frond(P, top + V(0, 0, 0.3), a, e, L, sag, role)


def frond(P, base, a, e, L, sag, role, segs=14, leaflet=1.0, vees=(math.radians(40), math.radians(-6))):
    """Feather frond: tapered rachis + split leaflet strips in two V rows (upper/lower) on each side."""
    d = V(math.cos(a), math.sin(a), 0)
    pts = [base + d * (L * t * math.cos(e)) + Z * (L * t * math.sin(e) - sag * L * t * t)
           for t in (i / segs for i in range(segs + 1))]
    spine = pts[::2]
    P.add(tube(spine, [0.05 * (1 - 0.75 * i / (len(spine) - 1)) for i in range(len(spine))], segs=3), *role)
    tris = []
    for j in range(2, segs):
        t = j / segs
        p0, p1 = pts[j], pts[j + 1]
        tan = (p1 - p0).normalized()
        side = tan.cross(Z).normalized()
        up = side.cross(tan)
        w = leaflet * min(1.0, (t - 0.05) / 0.3) * (1 - t) ** 0.6 + 0.08
        for s in (1, -1):
            for row, vee in enumerate(vees):
                out = (side * s * math.cos(vee) + up * math.sin(vee) + tan * 0.4).normalized()
                a0 = 0.5 * row  # rows offset half a segment so the strips interleave
                tris.append((p0.lerp(p1, a0), p0.lerp(p1, a0 + 0.7), p0.lerp(p1, a0 + 0.3) + out * w * (1 - 0.15 * row)))
    P.add(sheet(tris), *role)


def ficus(P, rnd):
    """Round street ficus ~6 m: gnarly grey trunk with root flare and limbs, lumpy crown of noisy icospheres."""
    bark = ("Bark", "857F74", 0.9)
    trunk = [V(0, 0, 0), V(0.06, 0.02, 0.7), V(-0.05, 0.07, 1.4), V(0.05, -0.02, 2.0)]
    P.add(tube(trunk, [0.3, 0.23, 0.22, 0.2], segs=8), *bark, smooth=True)
    P.collide(tube(trunk, [0.32, 0.25, 0.24, 0.22], segs=8))
    for k in range(5):  # buttress roots
        a = k * 1.26 + 0.3
        c, s = math.cos(a), math.sin(a)
        P.add(tube([V(c * 0.7, s * 0.7, -0.03), V(c * 0.32, s * 0.32, 0.12), V(c * 0.08, s * 0.08, 0.7)],
                   [0.06, 0.11, 0.12], segs=5), *bark, smooth=True)
    top = trunk[-1]
    for k in range(4):  # limbs into the crown
        a = k * math.pi / 2 + 0.5 + rnd.uniform(-0.3, 0.3)
        c, s, out = math.cos(a), math.sin(a), rnd.uniform(1.1, 1.6)
        P.add(tube([top - Z * 0.25, top + V(c * 0.35, s * 0.35, 0.45), top + V(c * out * 0.7, s * out * 0.7, 1.2),
                    top + V(c * out, s * out, 1.9)], [0.15, 0.12, 0.09, 0.06], segs=6), *bark, smooth=True)
    leaves = [("Leaf", "3D6A2E"), ("LeafLight", "4F7D36"), ("LeafDark", "2F5A27")]
    P.add(blob(V(0, 0, 4.3), 1.9, sub=3, amp=0.18, seed=1.0, scale=(1.4, 1.4, 0.95)), *leaves[0])
    for k in range(7):
        a = k * 2 * math.pi / 7 + rnd.uniform(-0.2, 0.2)
        c = V(math.cos(a) * 1.75, math.sin(a) * 1.75, 3.65 + rnd.uniform(0, 0.6))
        P.add(blob(c, rnd.uniform(1.05, 1.3), amp=0.25, seed=k + 2.0, scale=(1, 1, 0.85)), *leaves[(k % 2) + 1])
    P.add(blob(V(0.2, -0.1, 5.25), 1.15, amp=0.25, seed=11.0), *leaves[1])


def street_lamp(P, rnd):
    """~8 m galvanised pole bending into an arm over the road (+X), flat LED head."""
    metal = ("Metal", "8E9499", 0.45)
    z0, R = 7.0, 0.8
    pts = [V(0, 0, 0), V(0, 0, 3.0), V(0, 0, z0)]
    pts += [V(R - R * math.cos(math.radians(a)), 0, z0 + R * math.sin(math.radians(a))) for a in range(15, 91, 15)]
    pts += [V(1.6, 0, z0 + R + 0.06), V(2.15, 0, z0 + R + 0.08)]
    radii = [0.13, 0.1, 0.075] + [0.065] * 6 + [0.055, 0.05]
    P.add(tube(pts, radii, segs=10), *metal, smooth=True)
    P.add(cyl((0, 0, 0.3), 0.19, 0.6, segs=10), "MetalDark", "4A4F55", 0.5, smooth=True)
    P.add(box((0.185, 0, 0.35), (0.03, 0.14, 0.3)), "MetalDark", "4A4F55", 0.5)  # service hatch
    P.add(cyl((0, 0, 3.0), 0.115, 0.08, segs=10), "MetalDark", "4A4F55", 0.5, smooth=True)
    hz = z0 + R + 0.04
    P.add(box((2.4, 0, hz), (0.8, 0.34, 0.15), r=rot(4, "Y"), bevel=0.03), "MetalDark", "4A4F55", 0.5)
    P.add(box((2.42, 0, hz - 0.085), (0.6, 0.25, 0.03), r=rot(4, "Y")), "Lens", "FFF1C4", 0.2)
    P.collide(box((0, 0, 3.8), (0.34, 0.34, 7.6)))


def bench(P, rnd):
    """1.8 m city bench, wooden slats on cast-iron frames; sits facing +X."""
    wood, iron = ("Wood", "B07A45", 0.8), ("Iron", "2E3A33", 0.5)
    Lb = 1.8
    for x in (-0.15, 0.0, 0.15):
        P.add(box((x, 0, 0.45), (0.13, Lb, 0.04), bevel=0.008), *wood)
    back = lambda z: -0.22 - 0.14 * (z - 0.43) / 0.47  # rear support line x(z)
    ang = math.degrees(math.atan2(0.14, 0.47))
    for z in (0.62, 0.8):
        P.add(box((back(z) + 0.035, 0, z), (0.035, Lb, 0.12), r=rot(-ang, "Y"), bevel=0.006), *wood)
    for y in (-0.78, 0.0, 0.78):
        P.add(bar((0.2, y, 0), (0.17, y, 0.43), 0.05), *iron)
        P.add(bar((-0.2, y, 0), (-0.22, y, 0.43), 0.05), *iron)
        P.add(bar((-0.22, y, 0.43), (-0.36, y, 0.9), 0.05), *iron)
        P.add(bar((-0.25, y, 0.41), (0.22, y, 0.41), 0.05, 0.03), *iron)
    for y in (-0.86, 0.86):  # armrests
        P.add(bar((0.2, y, 0.43), (0.18, y, 0.64), 0.04), *iron)
        P.add(bar((-0.27, y, 0.65), (0.22, y, 0.65), 0.05, 0.035), *iron)
    P.collide(box((-0.05, 0, 0.45), (0.55, 1.85, 0.9)))
    P.recenter()


def bin_(P, rnd):
    """Street litter bin hanging on a post."""
    green = ("Paint", "2F6A47", 0.55)
    P.add(cyl((0, 0, 0.67), 0.24, 0.6, segs=14), *green, smooth=True)
    P.add(cyl((0, 0, 0.985), 0.255, 0.04, segs=14), "PaintDark", "24533A", 0.55, smooth=True)
    P.add(cyl((0, 0, 1.007), 0.215, 0.006, segs=14), "Liner", "1B1B1B", 0.9)
    P.add(cyl((0, 0, 0.8), 0.243, 0.07, segs=14), "Label", "E8E4D6", 0.6, smooth=True)
    P.add(cyl((0, 0, 0.37), 0.2, 0.02, segs=14, ), *green, smooth=True)
    P.add(cyl((-0.31, 0, 0.6), 0.035, 1.2, segs=8), "Metal", "8E9499", 0.45, smooth=True)
    P.add(box((-0.27, 0, 0.88), (0.1, 0.06, 0.1)), "Metal", "8E9499", 0.45)
    P.collide(box((-0.03, 0, 0.6), (0.6, 0.52, 1.2)))


def bus_stop(P, rnd):
    """Bus shelter, open towards the road (+X): glass back, ad panel, bench, roof, stop sign."""
    frame, glass = ("MetalDark", "3A3F44", 0.45), ("Glass", "9EC4D0", 0.08)
    for x, y in ((-0.7, -1.75), (-0.7, 1.75), (0.6, -1.75), (0.6, 1.75)):
        P.add(box((x, y, 1.25), (0.08, 0.08, 2.5)), *frame)
    P.add(box((-0.05, 0, 2.55), (1.75, 3.85, 0.1), r=rot(-3, "Y"), bevel=0.02), "Roof", "D8D8D2", 0.6)
    P.add(box((0.79, 0, 2.53), (0.06, 3.85, 0.22)), "Fascia", "1F5FA8", 0.5)
    P.add(box((-0.7, 0, 1.2), (0.02, 3.42, 1.9)), *glass)
    for z in (0.25, 2.15):
        P.add(box((-0.7, 0, z), (0.05, 3.5, 0.05)), *frame)
    P.add(box((-0.05, 1.75, 1.2), (1.2, 0.12, 1.9)), *frame)  # ad panel frame
    for y in (1.68, 1.82):
        P.add(box((-0.05, y, 1.2), (1.05, 0.02, 1.7)), "Ad", "F2B33D", 0.4)
    P.add(box((-0.05, 1.83, 1.45), (0.8, 0.02, 0.5)), "AdText", "C8352B", 0.4)
    P.add(box((-0.45, -0.2, 0.46), (0.38, 2.4, 0.05)), "Steel", "9AA0A6", 0.4)
    for y in (-1.2, 0.8):
        P.add(box((-0.45, y, 0.22), (0.05, 0.05, 0.44)), *frame)
    P.add(cyl((0.85, -2.05, 1.45), 0.04, 2.9, segs=8), "Steel", "9AA0A6", 0.4, smooth=True)
    P.add(box((0.85, -2.05, 2.6), (0.03, 0.5, 0.62)), "SignWhite", "F2F2EE", 0.5)
    P.add(box((0.87, -2.05, 2.66), (0.02, 0.36, 0.36)), "SignBlue", "1F5FA8", 0.5)
    P.add(box((0.885, -2.05, 2.66), (0.01, 0.2, 0.14)), "SignWhite", "F2F2EE", 0.5)
    P.collide(box((-0.7, 0, 1.25), (0.12, 3.6, 2.5)))
    P.collide(box((-0.05, 1.75, 1.2), (1.25, 0.15, 1.95)))
    P.collide(box((-0.05, 0, 2.55), (1.8, 3.9, 0.2)))
    P.collide(box((-0.45, -0.2, 0.25), (0.4, 2.4, 0.5)))


def solar_heater(P, rnd):
    """Rooftop 'dud shemesh': tilted dark-blue collector facing +X, white tank on a galvanised frame."""
    steel = ("Steel", "A0A5AA", 0.45)
    tilt = 40
    c = V(0.1, 0, 0.25 + 0.5 * math.sin(math.radians(tilt)))
    r = rot(tilt, "Y")
    nrm = r.to_3x3() @ Z
    P.add(box(c, (1.0, 2.0, 0.06), r=r), "Frame", "B8BCC0", 0.4)
    P.add(box(c + nrm * 0.032, (0.92, 1.92, 0.012), r=r), "Panel", "1D2F4D", 0.15)
    for k in range(9):
        y = -0.8 + k * 0.2
        P.add(box(c + nrm * 0.04 + V(0, y, 0), (0.9, 0.02, 0.006), r=r), "Frame", "B8BCC0", 0.4)
    P.add(cyl((-0.6, 0, 1.12), 0.28, 1.55, segs=16, m=rot(90, "X")), "Tank", "F1F0EB", 0.45, smooth=True)
    for y in (-0.79, 0.79):
        P.add(cyl((-0.6, y, 1.12), 0.29, 0.04, segs=16, m=rot(90, "X")), "TankCap", "C9CACB", 0.45, smooth=True)
    for y in (-0.75, 0.75):
        P.add(bar((0.5, y, 0), (0.48, y, 0.25), 0.04), *steel)
        P.add(bar((-0.8, y, 0), (-0.62, y, 0.86), 0.04), *steel)
        P.add(bar((-0.3, y, 0), (-0.3, y, 0.86), 0.04), *steel)
        P.add(bar((0.48, y, 0.22), (-0.3, y, 0.86), 0.04), *steel)
        P.add(bar((0.5, y, 0.02), (-0.8, y, 0.02), 0.04), *steel)
        P.add(box((-0.6, y, 0.86), (0.4, 0.06, 0.05)), *steel)
    for y in (-0.6, 0.6):
        P.add(tube([V(-0.27, y, 0.92), V(-0.36, y, 0.98), V(-0.45, y, 0.98)], 0.018, segs=6), "Pipe", "B87333", 0.4)
    P.recenter()


def water_tank(P, rnd):
    """Rooftop water tank: ribbed dark plastic drum on a concrete pad."""
    plastic = ("Plastic", "3A3E42", 0.6)
    P.add(box((0, 0, 0.075), (1.25, 1.25, 0.15), bevel=0.015), "Concrete", "B5B0A6", 0.9)
    P.add(cyl((0, 0, 0.75), 0.55, 1.2, segs=16), *plastic, smooth=True)
    for z in (0.35, 0.75, 1.15):
        P.add(cyl((0, 0, z), 0.57, 0.06, segs=16), "PlasticRib", "4A4F54", 0.6, smooth=True)
    P.add(cyl((0, 0, 1.41), 0.55, 0.12, segs=16, r2=0.25), *plastic, smooth=True)
    P.add(cyl((0, 0, 1.49), 0.24, 0.06, segs=16), "Lid", "5A6066", 0.6, smooth=True)
    P.add(tube([V(0.5, 0, 0.3), V(0.7, 0, 0.3), V(0.72, 0, 0.0)], 0.03, segs=6), "PipeWhite", "E3E1DA", 0.5, smooth=True)
    P.recenter()


def ac_unit(P, rnd):
    """Wall-mounted outdoor AC unit on L brackets; wall plane at X = -0.21, fan grille facing +X."""
    body = ("Plastic", "ECEBE5", 0.5)
    P.add(box((0, 0, 0.36), (0.3, 0.82, 0.56), bevel=0.015), *body)
    P.add(box((0, 0.3, 0.36), (0.31, 0.16, 0.5)), "PlasticGrey", "C9C8C2", 0.5)
    face = rot(90, "Y")
    P.add(cyl((0.152, -0.12, 0.36), 0.215, 0.01, segs=20, m=face), "Ring", "9A9EA2", 0.5)
    P.add(cyl((0.156, -0.12, 0.36), 0.2, 0.01, segs=20, m=face), "Grille", "2E3134", 0.6)
    P.add(cyl((0.163, -0.12, 0.36), 0.05, 0.012, segs=12, m=face), "Ring", "9A9EA2", 0.5)
    for s in ((0.006, 0.4, 0.015), (0.006, 0.015, 0.4)):
        P.add(box((0.164, -0.12, 0.36), s), "Ring", "9A9EA2", 0.5)
    for y in (-0.3, 0.3):
        P.add(bar((-0.21, y, 0.0), (-0.21, y, 0.38), 0.03), "Metal", "8E9499", 0.45)
        P.add(bar((-0.21, y, 0.065), (0.13, y, 0.065), 0.03), "Metal", "8E9499", 0.45)
        P.add(bar((-0.21, y, 0.3), (0.06, y, 0.075), 0.025), "Metal", "8E9499", 0.45)
    for z in (0.14, 0.2):
        P.add(tube([V(0.0, 0.41, z), V(-0.05, 0.46, z), V(-0.21, 0.46, z)], 0.014, segs=6), "PipeWhite", "E3E1DA", 0.5)


def umbrella(P, rnd):
    """Striped beach parasol: 12 alternating panels with a pennant valance, ribs, white pole."""
    N, R, apex, rib_z = 12, 1.2, V(0, 0, 2.42), 2.08
    cols = (("Fabric", "2D6DB3"), ("FabricWhite", "F2F0E8"))
    ring = lambda a, r, z: V(r * math.cos(a), r * math.sin(a), z)
    for i in range(N):
        a0, a1 = 2 * math.pi * i / N, 2 * math.pi * (i + 1) / N
        m0, m1 = ring(a0, 0.6 * R, 2.3), ring(a1, 0.6 * R, 2.3)
        r0, r1 = ring(a0, R, rib_z), ring(a1, R, rib_z)
        low = (r0 + r1) / 2 - Z * 0.17
        P.add(sheet([(apex, m0, m1), (m0, r0, r1, m1), (r1, r0, low)]), *cols[i % 2], 0.85)
        P.add(bar(apex - Z * 0.05, ring(a0, R * 0.98, rib_z - 0.01), 0.012), "Metal", "8E9499", 0.45)
    P.add(tube([V(0, 0, 0), V(0, 0, 2.47)], 0.022, segs=8), "Pole", "E8E6E0", 0.5, smooth=True)
    P.add(cyl((0, 0, 1.85), 0.04, 0.12, segs=8), "Pole", "E8E6E0", 0.5, smooth=True)
    P.add(prim("sphere", apex + Z * 0.06, V(0.05, 0.05, 0.05), segs=(8, 5)), "Pole", "E8E6E0", 0.5, smooth=True)


def lounger(P, rnd):
    """Beach sun lounger: white frame, blue fabric, backrest raised at the -X end."""
    white, fabric = ("Plastic", "F0F0EC", 0.5), ("Fabric", "2D7FB8", 0.85)
    prof = [(1.0, 0.36), (0.3, 0.36), (-0.3, 0.36), (-0.82, 0.8)]
    for y in (-0.32, 0.32):
        for (x0, z0), (x1, z1) in zip(prof, prof[1:]):
            P.add(bar((x0, y, z0), (x1, y, z1), 0.045, 0.05), *white)
        for x in (0.9, -0.2):
            P.add(bar((x, y, 0), (x, y, 0.36), 0.045), *white)
    P.add(bar((0.9, -0.32, 0.12), (0.9, 0.32, 0.12), 0.03), *white)
    P.add(bar((-0.2, -0.32, 0.12), (-0.2, 0.32, 0.12), 0.03), *white)
    strip = []
    for (x0, z0), (x1, z1) in zip(prof, prof[1:]):
        strip.append((V(x0, -0.3, z0 + 0.02), V(x1, -0.3, z1 + 0.02), V(x1, 0.3, z1 + 0.02), V(x0, 0.3, z0 + 0.02)))
    P.add(sheet(strip), *fabric)
    P.add(box((-0.7, 0, 0.75), (0.24, 0.5, 0.08), r=rot(-40, "Y"), bevel=0.03), "Pillow", "F2F0E8", 0.85)
    P.recenter()


def lifeguard_tower(P, rnd):
    """Lifeguard station on stilts: white hut with blue trim, sea-facing (+X) windows, railing, ladder, flag."""
    post, steel, blue = ("Post", "D9D4C8", 0.8), ("Steel", "7A8085", 0.45), ("Trim", "2A6DB5", 0.5)
    for x in (-1.2, 1.2):
        for y in (-1.2, 1.2):
            P.add(box((x, y, 1.45), (0.18, 0.18, 2.9)), *post)
            P.collide(box((x, y, 1.45), (0.2, 0.2, 2.9)))
    for y in (-1.2, 1.2):
        P.add(bar((-1.2, y, 0.3), (1.2, y, 2.6), 0.07), *steel)
        P.add(bar((1.2, y, 0.3), (-1.2, y, 2.6), 0.07), *steel)
    P.add(bar((1.2, -1.2, 0.3), (1.2, 1.2, 2.6), 0.07), *steel)
    P.add(bar((1.2, 1.2, 0.3), (1.2, -1.2, 2.6), 0.07), *steel)
    P.add(box((0, 0, 2.95), (3.2, 3.2, 0.18)), "Deck", "8A7A66", 0.85)
    P.add(box((-0.25, 0, 4.1), (2.3, 2.5, 2.1)), "Wall", "F2EFE6", 0.8)
    P.add(box((-0.25, 0, 3.2), (2.34, 2.54, 0.24)), *blue)
    P.add(box((0.91, 0, 4.45), (0.04, 2.2, 0.85)), "Glass", "33505E", 0.1)
    for y in (-1.26, 1.26):
        P.add(box((-0.25, y, 4.45), (1.8, 0.04, 0.85)), "Glass", "33505E", 0.1)
    for y in (-0.55, 0.0, 0.55):
        P.add(box((0.935, y, 4.45), (0.02, 0.05, 0.85)), "Wall", "F2EFE6", 0.8)
    P.add(box((-1.41, 0.5, 3.95), (0.04, 0.8, 1.75)), *blue)
    P.add(box((-0.2, 0, 5.3), (3.0, 3.1, 0.16), r=rot(-6, "Y"), bevel=0.02), *blue)
    P.collide(box((-0.1, 0, 4.15), (3.2, 3.2, 2.5)))
    rail = ("Rail", "F2F2EE", 0.5)
    for y in (-1.5, -0.75, 0.0, 0.75, 1.5):
        P.add(bar((1.5, y, 3.04), (1.5, y, 4.0), 0.05), *rail)
    for z in (3.5, 4.0):
        P.add(bar((1.5, -1.53, z), (1.5, 1.53, z), 0.05), *rail)
        for y in (-1.53, 1.53):
            P.add(bar((1.5, y, z), (0.9, y, z), 0.05), *rail)
    ring = [V(1.56, 0.9 + 0.3 * math.cos(a), 3.6 + 0.3 * math.sin(a)) for a in (math.pi * k / 8 for k in range(17))]
    for q in range(4):  # red/white lifebuoy
        P.add(tube(ring[q * 4:q * 4 + 5], 0.06, segs=6), *(("Buoy", "E8452C") if q % 2 else ("BuoyWhite", "F4F4F0")), 0.6, smooth=True)
    for y in (-0.38, 0.38):  # ladder at the back (-X)
        P.add(bar((-2.6, y, 0), (-1.6, y, 2.95), 0.07, 0.05), *steel)
        P.add(bar((-1.6, y, 2.95), (-1.55, y, 3.9), 0.05), *steel)
    for k in range(1, 10):
        t = k / 10
        x, z = -2.6 + 1.0 * t, 2.95 * t
        P.add(bar((x, -0.38, z), (x, 0.38, z), 0.06, 0.03), *steel)
    P.add(tube([V(0.6, 1.3, 5.3), V(0.6, 1.3, 7.3)], 0.03, segs=6), *steel, smooth=True)
    P.add(sheet([(V(0.6, 1.3, 7.25), V(0.6, 2.05, 7.18), V(0.6, 2.05, 6.72), V(0.6, 1.3, 6.8))]), "Flag", "D2302A", 0.85)


def kiosk(P, rnd):
    """Boulevard cafe kiosk (Rothschild style): octagonal pavilion, glass band, sign ring, teal roof, counter on +X."""
    oct_ = rot(22.5, "Z")  # flat face towards +X
    P.add(cyl((0, 0, 0.08), 1.75, 0.16, segs=8, m=oct_), "Concrete", "B8B2A6", 0.9)
    P.add(cyl((0, 0, 0.66), 1.5, 1.0, segs=8, m=oct_), "Wall", "E6D9BC", 0.8)
    P.add(cyl((0, 0, 1.75), 1.45, 1.18, segs=8, m=oct_), "Glass", "3C5560", 0.1)
    for k in range(8):
        a = math.radians(22.5 + 45 * k)
        P.add(box((1.5 * math.cos(a), 1.5 * math.sin(a), 1.75), (0.07, 0.07, 1.18), r=rot(22.5 + 45 * k, "Z")), "FrameGreen", "2E4F48", 0.5)
    P.add(cyl((0, 0, 2.5), 1.55, 0.32, segs=8, m=oct_), "Sign", "F3EFE3", 0.6)
    P.add(box((1.445, 0, 2.5), (0.04, 0.9, 0.22)), "Logo", "C8352B", 0.5)
    P.add(cyl((0, 0, 2.72), 2.1, 0.12, segs=8, m=oct_), "Roof", "2E7466", 0.6)
    P.add(cyl((0, 0, 3.0), 2.0, 0.45, segs=8, r2=0.3, m=oct_), "Roof", "2E7466", 0.6)
    P.add(prim("sphere", V(0, 0, 3.3), V(0.12, 0.12, 0.12), segs=(8, 5)), "Sign", "F3EFE3", 0.6)
    P.add(box((1.6, 0, 1.12), (0.45, 1.3, 0.07)), "Wood", "A9773F", 0.7)
    for y in (-0.6, 0.6):
        P.add(bar((1.45, y, 0.16), (1.75, y, 1.09), 0.04), "FrameGreen", "2E4F48", 0.5)
    stripes = []
    for k in range(7):
        y0, y1 = -0.75 + k * 1.5 / 7, -0.75 + (k + 1) * 1.5 / 7
        stripes.append([(V(1.42, y0, 2.32), V(1.42, y1, 2.32), V(2.1, y1, 2.02), V(2.1, y0, 2.02)),
                        (V(2.1, y0, 2.02), V(2.1, y1, 2.02), V(2.1, (y0 + y1) / 2, 1.88))])
    for k, polys in enumerate(stripes):
        P.add(sheet(polys), *(("Awning", "C8352B") if k % 2 == 0 else ("AwningWhite", "F3EFE3")), 0.85)
    for y in (-0.45, 0.45):
        P.add(cyl((2.1, y, 0.38), 0.025, 0.76, segs=6), "Metal", "8E9499", 0.45)
        P.add(cyl((2.1, y, 0.77), 0.17, 0.05, segs=10), "Wood", "A9773F", 0.7)
    P.collide(cyl((0, 0, 1.5), 1.56, 3.0, segs=8, m=oct_))


def bollard(P, rnd):
    """Steel street bollard with two reflective bands."""
    dark = ("MetalDark", "3B3F44", 0.45)
    P.add(cyl((0, 0, 0.02), 0.12, 0.04, segs=12), *dark, smooth=True)
    P.add(cyl((0, 0, 0.45), 0.085, 0.86, segs=12), *dark, smooth=True)
    P.add(prim("sphere", V(0, 0, 0.88), V(0.085, 0.085, 0.045), segs=(12, 4)), *dark, smooth=True)
    for z in (0.6, 0.72):
        P.add(cyl((0, 0, z), 0.088, 0.05, segs=12), "Reflector", "EDEDE8", 0.3, smooth=True)
    P.collide(box((0, 0, 0.46), (0.24, 0.24, 0.92)))


def planter(P, rnd):
    """Concrete planter box with a shrub and bougainvillea flowers."""
    P.add(box((0, 0, 0.28), (1.2, 1.2, 0.56), bevel=0.02), "Concrete", "B9B2A4", 0.9)
    P.add(box((0, 0, 0.55), (1.08, 1.08, 0.04)), "Soil", "4A3829", 1.0)
    leaves = (("Leaf", "3D6A2E"), ("LeafLight", "4F7D36"))
    shrub = [(V(0.18, 0.1, 0.85), 0.42), (V(-0.25, -0.15, 0.8), 0.36), (V(-0.12, 0.3, 0.9), 0.33), (V(0.25, -0.3, 0.78), 0.3)]
    for k, (c, r) in enumerate(shrub):
        P.add(blob(c, r, amp=0.25, seed=k + 20.0), *leaves[k % 2])
    for k in range(7):
        a = k * 2.4
        c = V(0.38 * math.cos(a), 0.38 * math.sin(a), 0.95 + 0.12 * math.sin(k * 1.7))
        P.add(blob(c, 0.13, sub=1, amp=0.2, seed=k + 40.0), "Flower", "C8337E", 0.7)
    P.collide(box((0, 0, 0.28), (1.2, 1.2, 0.56)))


# ---------------------------------------------------------------- gameplay set pieces (player at +X)
def crate(P, rnd, lid=True):
    """Wooden crate 0.8 m: plank sides with dark gaps, edge battens, rails and braces round a hollow box; the plank lid
    on top, or (lid=False) leaning against the back (-X) so the empty inside shows."""
    wood, frame, inside = ("CrateWood", "B8894F", 0.85), ("CrateFrame", "8C6239", 0.85), ("CrateInside", "4E3824", 0.95)
    H = 0.56  # body height; the lid adds 6 cm
    for s in (1, -1):  # 3 cm walls + floor
        P.add(box((s * 0.37, 0, H / 2), (0.03, 0.77, H)), *inside)
        P.add(box((0, s * 0.37, H / 2), (0.71, 0.03, H)), *inside)
    P.add(box((0, 0, 0.03), (0.71, 0.71, 0.06)), *inside)
    for k in range(3):
        z = 0.1 + k * 0.18
        for s in (1, -1):
            P.add(box((s * 0.395, 0, z), (0.02, 0.66, 0.165)), *wood)
            P.add(box((0, s * 0.395, z), (0.66, 0.02, 0.165)), *wood)
    for sx in (1, -1):
        for sy in (1, -1):
            P.add(box((sx * 0.365, sy * 0.365, H / 2), (0.1, 0.1, H), bevel=0.006), *frame)
    for s in (1, -1):
        for z in (0.035, H - 0.035):
            P.add(box((s * 0.405, 0, z), (0.025, 0.63, 0.07)), *frame)
            P.add(box((0, s * 0.405, z), (0.63, 0.025, 0.07)), *frame)
        P.add(bar((-0.27, s * 0.405, 0.08), (0.27, s * 0.405, H - 0.08), 0.025, 0.07), *frame)
        P.add(bar((s * 0.405, -0.27, 0.08), (s * 0.405, 0.27, H - 0.08), 0.025, 0.07), *frame)
    if lid:
        m = Matrix.Translation(V(0, 0, H + 0.0175))
    else:  # tilted 20 deg off vertical, battens out, inner face resting on the back top edge (-0.415, H)
        m = Matrix.Translation(V(-0.4955, 0, 0.39)) @ rot(-70, "Y")
    r = m.to_3x3().to_4x4()
    for k in range(4):
        P.add(box(m @ V(0, -0.3075 + k * 0.205, 0), (0.83, 0.195, 0.035), r=r), *wood)
    for x in (-0.3, 0.3):
        P.add(box(m @ V(x, 0, 0.03), (0.08, 0.81, 0.025), r=r), *frame)
    P.collide(box((0, 0, (H + 0.065 * lid) / 2), (0.83, 0.83, H + 0.065 * lid)))


def cash_bag(P, rnd):
    """Green canvas duffel lying along X: rounded body with a flat bottom, two dark straps round it rising into carry
    handles, brass zip along the top."""
    canvas, strap, zip_ = ("Canvas", "3E6B3A", 0.9), ("Strap", "22251F", 0.8), ("Zip", "C9A24A", 0.4)
    zc, R = 0.16, 0.19

    def squash(bm):  # slightly narrower than tall, sat flat on the ground
        for v in bm.verts:
            v.co.y *= 0.95
            v.co.z = max(v.co.z, 0.0)
        return bm
    xs = [-0.35, -0.335, -0.29, -0.2, 0.0, 0.2, 0.29, 0.335, 0.35]
    rs = [0.06, 0.13, 0.175, R, R, R, 0.175, 0.13, 0.06]
    P.add(squash(tube([V(x, 0, zc) for x in xs], rs, segs=12)), *canvas, smooth=True)
    for x in (-0.14, 0.14):
        P.add(squash(lathe([(R - 0.002, -0.022), (R + 0.01, -0.022), (R + 0.01, 0.022), (R - 0.002, 0.022)],
                           (x, 0, zc), segs=12, m=rot(90, "Y"))), *strap)
    for y in (-0.035, 0.035):
        P.add(tube([V(-0.14, y, zc + R - 0.01), V(-0.1, y, zc + R + 0.06), V(0, y, zc + R + 0.085),
                    V(0.1, y, zc + R + 0.06), V(0.14, y, zc + R - 0.01)], 0.014, segs=5), *strap, smooth=True)
    P.add(cyl((0, 0, zc + R + 0.085), 0.026, 0.1, segs=8, m=rot(90, "X")), *strap, smooth=True)  # handle wrap
    P.add(box((0, 0, zc + R - 0.002), (0.4, 0.018, 0.012)), *zip_)
    P.add(box((0.16, 0.012, zc + R + 0.004), (0.045, 0.02, 0.008)), *zip_)


def shop_counter(P, rnd):
    """Corner-shop counter 3 m: slate body with a red band, wood top, till at +Y; directly behind it (-X, X -0.82..-0.42)
    a 2 m goods shelf unit stocked with runs of packets in a few colours."""
    slate, top, red = ("Counter", "4C5560", 0.6), ("Worktop", "C9A66B", 0.6), ("ShopRed", "B33A2E", 0.5)
    black, metal = ("Black", "1E1E1E", 0.5), ("Metal", "8E9499", 0.45)
    goods = [("GoodsBlue", "2D6DB3", 0.5), ("GoodsYellow", "E8B923", 0.5), ("GoodsWhite", "EDEBE4", 0.5), red]
    P.add(box((0.02, 0, 0.05), (0.7, 2.94, 0.1)), *black)  # recessed kick plinth
    P.add(box((0, 0, 0.58), (0.76, 3.0, 0.96)), *slate)
    P.add(box((0.385, 0, 0.84), (0.012, 3.0, 0.1)), *red)
    for y in (-0.5, 0.5):  # panel joints on the customer face
        P.add(box((0.383, y, 0.45), (0.01, 0.015, 0.7)), *black)
    P.add(box((0.02, 0, 1.08), (0.84, 3.06, 0.04), bevel=0.01), *top)
    P.add(box((-0.05, 0.9, 1.15), (0.36, 0.42, 0.1)), *black)  # till: drawer, clerk screen (-X), pole display (+X)
    P.add(box((-0.12, 0.9, 1.36), (0.04, 0.36, 0.26), r=rot(-12, "Y")), *black)
    P.add(box((-0.145, 0.9, 1.36), (0.006, 0.32, 0.22), r=rot(-12, "Y")), *goods[0])
    P.add(bar((0.1, 0.62, 1.2), (0.1, 0.62, 1.4), 0.025), *metal)
    P.add(box((0.11, 0.62, 1.43), (0.04, 0.2, 0.07)), *black)
    P.add(box((0.15, 0.4, 1.12), (0.08, 0.12, 0.04)), *black)  # card reader
    P.add(box((0.05, -0.6, 1.14), (0.3, 0.42, 0.08)), *goods[2])  # newspapers
    P.add(box((0.1, -1.15, 1.18), (0.25, 0.35, 0.16)), *goods[1])  # sweets box
    for y in (-1.485, -0.5, 0.5, 1.485):
        P.add(box((-0.62, y, 1.0), (0.4, 0.03, 2.0)), *metal)
    P.add(box((-0.81, 0, 1.0), (0.02, 3.0, 2.0)), *metal)
    P.add(box((-0.62, 0, 0.04), (0.38, 3.0, 0.08)), *black)
    for z in (0.08, 0.46, 0.84, 1.22, 1.6, 1.985):
        P.add(box((-0.62, 0, z), (0.4, 3.0, 0.025)), *metal)
    for z0 in (0.0925, 0.4725, 0.8525, 1.2325, 1.6125):
        for y0, y1 in ((-1.47, -0.515), (-0.485, 0.485), (0.515, 1.47)):
            y = y0
            while y < y1 - 0.12:
                role, w, h, d = rnd.choice(goods), rnd.uniform(0.12, 0.22), rnd.uniform(0.12, 0.28), rnd.uniform(0.18, 0.3)
                for _ in range(rnd.randint(1, 3)):  # a few facings of one product
                    if y + w > y1:
                        break
                    P.add(box((-0.43 - d / 2, y + w / 2, z0 + h / 2), (d, w - 0.012, h)), *role)
                    y += w
    P.collide(box((0.02, 0, 0.55), (0.84, 3.06, 1.1)))
    P.collide(box((-0.62, 0, 1.0), (0.4, 3.0, 2.0)))


def slot_machine(P, rnd):
    """Casino slot machine: purple cabinet with gold trim, three-reel screen and button deck facing +X, lit belly panel,
    arched topper, pull lever on the +Y side."""
    purple, gold, black = ("SlotPurple", "5B1E7A", 0.4), ("Gold", "D4A637", 0.3), ("Black", "1E1E1E", 0.5)
    glow, reel, red, chrome = ("Glow", "F2C14E", 0.3), ("Reel", "F4F1E8", 0.4), ("Red", "C8202A", 0.4), ("Chrome", "D0D4D8", 0.25)
    P.add(box((0, 0, 0.04), (0.6, 0.84, 0.08)), *black)
    P.add(box((-0.02, 0, 0.44), (0.64, 0.9, 0.72)), *purple)
    P.add(box((0.3, 0, 0.47), (0.01, 0.76, 0.38)), *gold)
    P.add(box((0.304, 0, 0.47), (0.01, 0.7, 0.32)), *glow)
    P.add(box((0.31, 0, 0.16), (0.05, 0.32, 0.08)), *black)  # coin tray
    deck = rot(12, "Y")
    P.add(box((0.33, 0, 0.84), (0.2, 0.9, 0.08), r=deck), *black)
    for k, y in enumerate((-0.3, -0.1, 0.1, 0.3)):
        P.add(box(V(0.33, y, 0.84) + deck.to_3x3() @ V(0, 0, 0.045), (0.07, 0.09, 0.025), r=deck), *((glow, red)[k % 2]))
    P.add(box((-0.04, 0, 1.25), (0.6, 0.86, 0.9)), *purple)
    for y in (-0.425, 0.425):
        P.add(box((0.25, y, 1.25), (0.04, 0.03, 0.9)), *gold)
    P.add(box((0.265, 0, 1.3), (0.012, 0.7, 0.56)), *gold)
    P.add(box((0.272, 0, 1.3), (0.01, 0.64, 0.5)), *black)
    for i, y in enumerate((-0.2, 0.0, 0.2)):
        P.add(box((0.279, y, 1.3), (0.006, 0.18, 0.38)), *reel)
        for j, z in enumerate((1.18, 1.3, 1.42)):  # symbols: the middle row lines up red
            P.add(box((0.283, y, z), (0.004, 0.08, 0.07)), *((red, gold, purple)[0 if j == 1 else (i + j) % 3]))
    up = (V(0, 0, 1.7), V(0, 0, 1))
    P.add(prim("cyl", V(-0.04, 0, 1.7), V(0.3, 0.43, 0.58), rot=rot(90, "Y"), cut=up, segs=(16, 1)), *purple)
    P.add(prim("cyl", V(0.255, 0, 1.7), V(0.25, 0.37, 0.02), rot=rot(90, "Y"), cut=up, segs=(16, 1)), *glow)
    P.add(box((-0.04, 0, 1.71), (0.6, 0.88, 0.02)), *gold)
    P.add(cyl((0.08, 0.465, 1.1), 0.06, 0.07, segs=10, m=rot(90, "X")), *chrome, smooth=True)  # lever
    P.add(bar((0.08, 0.48, 1.1), (0.12, 0.48, 1.42), 0.03), *chrome)
    P.add(prim("sphere", V(0.12, 0.48, 1.47), V(0.055, 0.055, 0.055), segs=(10, 6)), *red, smooth=True)
    P.collide(box((0.04, 0, 1.0), (0.78, 0.92, 2.0)))


def burger_counter(P, rnd):
    """Fast-food counter 3 m (parody, no logo or text): red front with yellow bands, steel top with two tills and trays
    of burger, fries and a drink; a red back panel at -X carries a lit three-panel menu board (picture blocks) up to 2.6 m."""
    red, yellow, steel, black = ("BurgerRed", "C8202A", 0.5), ("BurgerYellow", "F2B705", 0.5), ("Steel", "9AA0A6", 0.4), ("Black", "1E1E1E", 0.5)
    light, bun, patty, tray = ("MenuLight", "F5E6B8", 0.4), ("Bun", "D9963A", 0.7), ("Patty", "5A3420", 0.8), ("Tray", "8A3A1E", 0.5)
    P.add(box((0.02, 0, 0.05), (0.8, 2.94, 0.1)), *black)
    P.add(box((0, 0, 0.57), (0.86, 3.0, 0.94)), *red)
    for z, h in ((0.86, 0.12), (0.3, 0.05)):
        P.add(box((0.433, 0, z), (0.012, 3.0, h)), *yellow)
    P.add(box((0.02, 0, 1.07), (0.94, 3.06, 0.06), bevel=0.01), *steel)
    for y in (-0.9, 0.9):
        P.add(box((-0.15, y, 1.15), (0.34, 0.4, 0.1)), *black)
        P.add(box((-0.2, y, 1.36), (0.04, 0.34, 0.26), r=rot(-12, "Y")), *black)
    for y in (-0.3, 0.35):
        P.add(box((0.17, y, 1.11), (0.36, 0.46, 0.02)), *tray)
        P.add(cyl((0.2, y - 0.08, 1.135), 0.055, 0.03, segs=10), *bun, smooth=True)
        P.add(cyl((0.2, y - 0.08, 1.157), 0.059, 0.016, segs=10), *patty, smooth=True)
        P.add(prim("sphere", V(0.2, y - 0.08, 1.168), V(0.056, 0.056, 0.04), segs=(10, 5), cut=(V(0, 0, 1.166), Z)), *bun, smooth=True)
        P.add(box((0.08, y + 0.1, 1.17), (0.05, 0.08, 0.1)), *red)
        P.add(box((0.08, y + 0.1, 1.235), (0.04, 0.07, 0.03)), *yellow)
        P.add(cyl((0.24, y + 0.14, 1.195), 0.042, 0.15, segs=10, r2=0.05), *light, smooth=True)
        P.add(cyl((0.24, y + 0.14, 1.275), 0.052, 0.012, segs=10), *red, smooth=True)
        P.add(bar((0.24, y + 0.14, 1.27), (0.25, y + 0.15, 1.35), 0.008), *yellow)
    for k in range(4):  # spare trays
        P.add(box((0.15, 1.3, 1.11 + k * 0.022), (0.36, 0.3, 0.02)), *tray)
    P.add(box((-0.55, 0, 1.3), (0.1, 3.0, 2.6)), *red)
    P.add(box((-0.55, 0, 2.56), (0.12, 3.02, 0.08)), *yellow)
    P.add(box((-0.46, 0, 2.12), (0.08, 2.86, 0.8)), *black)
    for py in (-0.93, 0.0, 0.93):
        P.add(box((-0.415, py, 2.12), (0.01, 0.88, 0.72)), *light)
        for row, z in enumerate((2.3, 1.98)):
            for col, dy in enumerate((-0.27, 0.0, 0.27)):
                pic = (bun, red, patty, yellow)[(row * 3 + col + int(py * 2)) % 4]
                P.add(box((-0.408, py + dy, z), (0.006, 0.22, 0.16)), *pic)
                P.add(box((-0.408, py + dy, z - 0.12), (0.006, 0.16, 0.025)), *black)
    P.collide(box((0.02, 0, 0.55), (0.94, 3.06, 1.1)))
    P.collide(box((-0.53, 0, 1.3), (0.15, 3.02, 2.6)))


def vault(P, rnd, open_=False):
    """Bank vault 2 x 2 x 2.2 m: steel block with seams on a dark plinth, round bolted door with a three-spoke wheel on
    +X (reaching X +1.3), hinges on the Blender +Y (UE -Y) side; open_: the door swung out 100 deg (reaching X +2.75)
    showing the empty deposit-box room."""
    steel, dark, door = ("VaultSteel", "8C9196", 0.4), ("SteelDark", "4E5459", 0.5), ("VaultDoor", "B4B9BE", 0.3)
    chrome, inside = ("Chrome", "D0D4D8", 0.25), ("VaultInside", "6E747A", 0.6)
    zc, a = 1.1, 0.62  # door axis height, half-size of the square hole behind the round collar
    hx = 1.11  # hinge axis X; the door parts below are drawn 6 cm further out and pulled back by m
    ax = rot(90, "Y")  # cylinder axis -> +X
    P.add(box((0, 0, 0.06), (2.04, 2.04, 0.12)), *dark)
    walls = [((-0.9, 0, 1.06), (0.2, 2.0, 1.88)), ((0, 0.9, 1.06), (1.6, 0.2, 1.88)), ((0, -0.9, 1.06), (1.6, 0.2, 1.88)),
             ((0, 0, 2.1), (2.0, 2.0, 0.2)), ((0, 0, 0.22), (1.6, 1.6, 0.2)),
             ((0.9, (1 + a) / 2, 1.06), (0.2, 1 - a, 1.88)), ((0.9, -(1 + a) / 2, 1.06), (0.2, 1 - a, 1.88)),
             ((0.9, 0, (zc + a + 2.0) / 2), (0.2, 2 * a, 2.0 - zc - a)), ((0.9, 0, (zc - a + 0.12) / 2), (0.2, 2 * a, zc - a - 0.12))]
    for c, s in walls:
        P.add(box(c, s), *steel)
        if open_:
            P.collide(box(c, s))
    for s in (1, -1):
        for x in (-0.5, 0.0, 0.5):
            P.add(box((x, s * 1.005, 1.16), (0.03, 0.01, 1.96)), *dark)
    P.add(lathe([(0.6, 0), (0.95, 0), (0.95, 0.08), (0.6, 0.08)], (1.0, 0, zc), segs=24, m=ax), *steel)
    for z in (zc - 0.4, zc + 0.4):  # hinge knuckles on arms off the wall
        P.add(box(((1.0 + hx) / 2, 0.87, z), (hx - 1.0, 0.12, 0.2)), *dark)
        P.add(cyl((hx, 0.87, z), 0.07, 0.3, segs=10), *dark, smooth=True)
    m = Matrix.Translation(V(-0.06, 0, 0))
    if open_:
        m = Matrix.Translation(V(hx, 0.87, 0)) @ rot(100, "Z") @ Matrix.Translation(V(-hx, -0.87, 0)) @ m
        for y in (-0.795, 0.795):
            P.add(box((0, y, 1.16), (1.56, 0.01, 1.66)), *inside)
        P.add(box((0, 0, 0.325), (1.58, 1.58, 0.01)), *inside)
        for y in (-0.54, -0.18, 0.18, 0.54):  # empty deposit-box wall
            for r in range(5):
                P.add(box((-0.79, y, 0.5 + r * 0.28), (0.02, 0.33, 0.24)), *chrome)
    P.add(moved(cyl((1.05, 0, zc), 0.585, 0.3, segs=16, m=ax), m), *door, smooth=True)
    P.add(moved(cyl((1.17, 0, zc), 0.8, 0.06, segs=24, m=ax), m), *door, smooth=True)
    P.add(moved(cyl((1.21, 0, zc), 0.62, 0.02, segs=24, m=ax), m), *chrome, smooth=True)
    P.add(moved(cyl((1.26, 0, zc), 0.11, 0.08, segs=12, m=ax), m), *dark, smooth=True)
    P.add(moved(torus((1.33, 0, zc), 0.36, 0.025, segs=16, rsegs=5, m=ax), m), *chrome, smooth=True)
    for k in range(3):
        t = math.radians(90 + 120 * k)
        P.add(moved(bar((1.28, 0, zc), (1.33, 0.36 * math.cos(t), zc + 0.36 * math.sin(t)), 0.035), m), *chrome)
    for k in range(8):
        t = 2 * math.pi * (k + 0.5) / 8
        P.add(moved(box((1.205, 0.71 * math.cos(t), zc + 0.71 * math.sin(t)), (0.03, 0.05, 0.05)), m), *dark)
    if open_:
        P.collide(moved(cyl((1.1, 0, zc), 0.8, 0.46, segs=12, m=ax), m))
    else:
        P.collide(box((0.15, 0, 1.1), (2.3, 2.04, 2.2)))


def forger_desk(P, rnd):
    """Document forger's desk 1.8 m (customer at +X, drawers on the forger's side -X): green cutting mat, an angled desk
    lamp over scattered papers, blank passport booklets (one open), rubber stamp and ink pad."""
    wood, brass, green = ("WoodDark", "5A3A22", 0.7), ("Brass", "C9A24A", 0.35), ("LampGreen", "2F5A3A", 0.5)
    paper, pp, black = ("Paper", "F2F0E8", 0.8), ("Passport", "6E1E2A", 0.6), ("Black", "1E1E1E", 0.5)
    T = 0.75
    P.add(box((0, 0, T - 0.02), (1.0, 1.8, 0.04), bevel=0.008), *wood)
    P.add(box((0, -0.6, 0.355), (0.9, 0.5, 0.71)), *wood)  # drawer pedestal
    for k in range(3):
        z = 0.125 + k * 0.22
        P.add(box((-0.457, -0.6, z), (0.015, 0.44, 0.19)), *wood)
        P.add(box((-0.47, -0.6, z + 0.05), (0.015, 0.12, 0.025)), *brass)
    for x in (-0.44, 0.44):
        P.add(box((x, 0.84, 0.355), (0.05, 0.05, 0.71)), *wood)
    P.add(box((0.46, 0.245, 0.445), (0.02, 1.19, 0.49)), *wood)  # modesty panel facing the customer
    P.add(box((0.05, 0.05, T + 0.002), (0.5, 0.7, 0.004)), *green)
    P.add(cyl((-0.3, 0.65, T + 0.015), 0.09, 0.03, segs=12), *black, smooth=True)
    P.add(bar((-0.3, 0.65, T + 0.03), (-0.22, 0.6, T + 0.42), 0.025), *brass)
    P.add(bar((-0.22, 0.6, T + 0.42), (-0.03, 0.48, T + 0.44), 0.022), *brass)
    P.add(cyl((0.0, 0.46, T + 0.37), 0.13, 0.15, segs=12, r2=0.05, m=rot(20, "Y")), *green, smooth=True)
    for k in range(6):  # loose sheets, stacked a hair apart
        x, y = rnd.uniform(-0.3, 0.3), rnd.uniform(-0.25, 0.55)
        P.add(box((x, y, T + 0.006 + k * 0.0025), (0.21, 0.297, 0.002), r=rot(rnd.uniform(-40, 40), "Z")), *paper)
    P.add(box((-0.32, 0.15, T + 0.03), (0.21, 0.3, 0.06), r=rot(5, "Z")), *paper)
    for k, (x, y, z, a) in enumerate(((0.3, -0.15, 0, 10), (0.3, -0.13, 1, -5), (0.33, 0.05, 0, 30), (0.12, 0.38, 0, -20))):
        P.add(box((x, y, T + 0.01 + z * 0.01), (0.09, 0.125, 0.01), r=rot(a, "Z")), *pp)
    r = rot(-8, "Z")
    P.add(box((0.05, -0.05, T + 0.006), (0.18, 0.125, 0.004), r=r), *pp)  # open passport
    P.add(box((0.05, -0.05, T + 0.0095), (0.17, 0.115, 0.003), r=r), *paper)
    P.add(box((0.25, -0.45, T + 0.015), (0.08, 0.05, 0.03)), *black)  # stamp + ink pad
    P.add(cyl((0.25, -0.45, T + 0.065), 0.018, 0.07, segs=8), *wood, smooth=True)
    P.add(prim("sphere", V(0.25, -0.45, T + 0.105), V(0.03, 0.03, 0.025), segs=(8, 5)), *wood, smooth=True)
    P.add(box((0.1, -0.5, T + 0.008), (0.1, 0.07, 0.016)), *black)
    P.collide(box((0, 0, T / 2), (1.0, 1.8, T)))


def checkin_desk(P, rnd):
    """Airport check-in row 6 m (passengers at +X): two white desk pods (high front ledge, lower agent top with a screen)
    either side of a bag-drop belt with a scale display, and a 2.4 m blue back panel along -X with lightboxes."""
    white, blue, steel, black = ("DeskWhite", "E8E8E4", 0.4), ("PanelBlue", "1F4FA0", 0.5), ("Steel", "9AA0A6", 0.4), ("Black", "1E1E1E", 0.5)
    screen, sign, accent = ("ScreenBlue", "3A7BD5", 0.2), ("SignWhite", "F2F2EE", 0.5), ("Accent", "E37222", 0.5)
    for y in (-1.9, 1.9):
        P.add(box((0.475, y, 0.55), (0.25, 2.2, 1.1)), *white)
        P.add(box((0.2, y, 0.38), (0.3, 2.2, 0.76)), *white)
        P.add(box((0.2, y, 0.775), (0.34, 2.2, 0.03)), *steel)
        P.add(box((0.48, y, 1.1), (0.3, 2.24, 0.04), bevel=0.008), *steel)
        P.add(box((0.605, y, 0.95), (0.01, 2.2, 0.12)), *blue)
        P.add(box((0.603, y, 0.04), (0.012, 2.2, 0.08)), *black)
        P.add(box((0.27, y - 0.3, 1.07), (0.04, 0.5, 0.32)), *black)  # agent screen facing -X
        P.add(box((0.248, y - 0.3, 1.07), (0.005, 0.46, 0.28)), *screen)
        P.add(box((0.27, y - 0.3, 0.86), (0.04, 0.06, 0.16)), *black)
        P.add(box((0.5, y + 0.6, 1.2), (0.03, 0.26, 0.16), r=rot(-10, "Y")), *black)  # passenger display
        P.add(box((0.518, y + 0.6, 1.2), (0.005, 0.22, 0.12), r=rot(-10, "Y")), *screen)
        P.add(box((0.15, y + 0.55, 0.87), (0.25, 0.3, 0.16)), *steel)  # tag printer
        P.add(box((-0.46, y, 2.0), (0.12, 1.6, 0.42)), *sign)  # lightbox + info screen on the back panel
        P.add(box((-0.398, y, 1.9), (0.005, 1.5, 0.08)), *accent)
        P.add(box((-0.5, y, 1.42), (0.04, 0.8, 0.45)), *black)
        for z in (1.3, 1.4, 1.5):
            P.add(box((-0.478, y, z), (0.005, 0.6, 0.03)), *sign)
        P.collide(box((0.33, y, 0.55), (0.56, 2.24, 1.1)))
    P.add(box((0.08, 0, 0.175), (1.05, 1.56, 0.35)), *steel)  # bag belt into the back panel, scale post
    P.add(box((0.08, 0, 0.36), (1.0, 1.4, 0.02)), *black)
    for y in (-0.76, 0.76):
        P.add(box((0.08, y, 0.38), (1.05, 0.04, 0.06)), *steel)
    P.add(box((-0.51, 0, 0.6), (0.02, 1.3, 0.5)), *black)
    P.add(box((0.55, 0.68, 0.5), (0.06, 0.06, 1.0)), *steel)
    P.add(box((0.56, 0.68, 1.05), (0.05, 0.22, 0.13)), *black)
    P.add(box((0.586, 0.68, 1.05), (0.005, 0.18, 0.09)), *screen)
    P.add(box((-0.56, 0, 1.2), (0.08, 6.0, 2.4)), *blue)
    P.collide(box((0.08, 0, 0.21), (1.05, 1.6, 0.42)))
    P.collide(box((-0.53, 0, 1.2), (0.14, 6.0, 2.4)))


def parcel_stack(P, rnd):
    """Courier pallet: wooden pallet with three layers of taped cardboard parcels, shipping labels on the +X faces."""
    card = (("Cardboard", "B8895A", 0.9), ("CardboardDark", "A27648", 0.9))
    tape, label, pallet = ("Tape", "D9C08E", 0.5), ("Label", "F2F0E8", 0.7), ("Pallet", "A08A68", 0.9)
    for y in (-0.44, 0.0, 0.44):
        P.add(box((0, y, 0.05), (1.1, 0.1, 0.1)), *pallet)
    for k in range(5):
        P.add(box((-0.48 + k * 0.24, 0, 0.12), (0.14, 1.0, 0.04)), *pallet)
    parcels = [(-0.27, -0.25, 0.14, 0.52, 0.48, 0.4, 0), (0.27, -0.25, 0.14, 0.52, 0.48, 0.4, 0),
               (-0.27, 0.24, 0.14, 0.52, 0.5, 0.4, 0), (0.27, 0.24, 0.14, 0.52, 0.5, 0.4, 0),
               (-0.25, -0.22, 0.54, 0.56, 0.52, 0.36, 3), (0.28, -0.2, 0.54, 0.46, 0.5, 0.32, -4),
               (0.0, 0.27, 0.54, 0.9, 0.44, 0.34, 2), (0.05, 0.22, 0.88, 0.5, 0.4, 0.3, 12),
               (-0.22, -0.2, 0.9, 0.4, 0.36, 0.28, -8)]
    for i, (x, y, z0, sx, sy, sz, yaw) in enumerate(parcels):
        r = rot(yaw, "Z")
        c = V(x, y, z0 + sz / 2)
        at = lambda dx, dy, dz: c + r.to_3x3() @ V(dx, dy, dz)
        P.add(box(c, (sx, sy, sz), r=r, bevel=0.012), *card[i % 2])
        P.add(box(at(0, 0, sz / 2 + 0.002), (sx + 0.004, 0.06, 0.006), r=r), *tape)
        P.add(box(at(sx / 2 + 0.002, 0, sz / 2 - 0.05), (0.006, 0.06, 0.1), r=r), *tape)
        if i % 3 != 2:
            P.add(box(at(sx / 2 + 0.003, 0.12 if i % 2 else -0.13, -0.04), (0.006, 0.12, 0.09), r=r), *label)
    P.collide(box((0, 0, 0.6), (1.1, 1.0, 1.2)))


def guard_booth(P, rnd):
    """Checkpoint booth 2.2 m: white walls with a blue sill band under a glass band all round, dark mullions, door on
    +X, flat roof slab overhanging 0.3 m with a blue fascia, beacon."""
    conc, wall, glass, frame = ("Concrete", "B5B0A6", 0.9), ("Wall", "F2EFE6", 0.8), ("Glass", "33505E", 0.1), ("MetalDark", "3A3F44", 0.45)
    trim, door = ("Trim", "2A6DB5", 0.5), ("DoorGrey", "8A9096", 0.5)
    P.add(box((0, 0, 0.075), (2.2, 2.2, 0.15), bevel=0.02), *conc)
    P.add(box((0, 0, 0.6), (1.9, 1.9, 0.9)), *wall)
    P.add(box((0, 0, 1.075), (1.94, 1.94, 0.09)), *trim)
    P.add(box((0, 0, 1.7), (1.86, 1.86, 1.16)), *glass)
    P.add(box((0, 0, 2.29), (1.92, 1.92, 0.03)), *frame)
    P.add(box((0, 0, 2.43), (1.9, 1.9, 0.3)), *wall)
    P.add(box((0, 0, 2.66), (2.5, 2.5, 0.16)), *trim)
    P.add(box((0, 0, 2.765), (2.44, 2.44, 0.05)), *wall)
    for sx in (1, -1):
        for sy in (1, -1):
            P.add(box((sx * 0.92, sy * 0.92, 1.7), (0.08, 0.08, 1.16)), *frame)
    for s in (1, -1):
        P.add(box((0, s * 0.935, 1.7), (0.05, 0.03, 1.16)), *frame)
    P.add(box((-0.935, 0, 1.7), (0.03, 0.05, 1.16)), *frame)
    P.add(box((0.935, -0.2, 1.7), (0.03, 0.05, 1.16)), *frame)
    P.add(box((0.955, 0.25, 1.1), (0.04, 0.8, 1.9)), *door)
    P.add(box((0.977, 0.25, 1.55), (0.01, 0.6, 0.75)), *glass)
    P.add(box((0.985, -0.08, 1.05), (0.03, 0.12, 0.03)), *frame)
    P.add(cyl((0.75, -0.75, 2.85), 0.07, 0.12, segs=10), *trim, smooth=True)
    P.collide(box((0, 0, 1.4), (2.2, 2.2, 2.8)))


def boom_gate(P, rnd):
    """Boom barrier: yellow housing (0.5 m, at the origin) with the hinge hub on its +X face at Z 0.95; red/white arm
    along UE +Y (Blender -Y) for 8 m, counterweight on the short stub behind the hub, red lamp on the cap."""
    yellow, white, red, dark = ("Yellow", "E8B923", 0.5), ("ArmWhite", "F4F4F0", 0.5), ("ArmRed", "D2302A", 0.5), ("MetalDark", "3A3F44", 0.45)
    P.add(box((0, 0, 0.025), (0.6, 0.6, 0.05)), *dark)
    P.add(box((0, 0, 0.55), (0.5, 0.5, 1.0), bevel=0.02), *yellow)
    P.add(box((0, 0, 1.07), (0.54, 0.54, 0.04)), *dark)
    P.add(cyl((0, 0, 1.13), 0.05, 0.08, segs=10), *red, smooth=True)
    P.add(box((0.252, 0, 0.45), (0.006, 0.34, 0.6)), *dark)  # service door
    P.add(cyl((0.3, 0, 0.95), 0.09, 0.1, segs=12, m=rot(90, "Y")), *dark, smooth=True)
    for i in range(10):
        P.add(box((0.3, -0.4 - i * 0.8, 0.95), (0.08, 0.8, 0.12)), *(red if i % 2 == 0 else white))
    P.add(box((0.3, 0.3, 0.95), (0.08, 0.6, 0.1)), *dark)
    P.add(box((0.3, 0.5, 0.95), (0.16, 0.22, 0.26)), *dark)
    P.collide(box((0, 0, 0.55), (0.5, 0.5, 1.1)))


def jersey_barrier(P, rnd):
    """Concrete 'jersey' road barrier 2 m: safety-shape profile (0.6 base, 0.15 top), dirty foot, drain slots, lifting
    loops."""
    conc, dirt, dark = ("Concrete", "B5B0A6", 0.9), ("ConcreteDirty", "8F887B", 0.95), ("MetalDark", "3A3F44", 0.45)
    prof = [(0.3, 0.0), (0.3, 0.075), (0.125, 0.33), (0.075, 0.8)]
    ring = [V(x, 0, z) for x, z in prof] + [V(-x, 0, z) for x, z in prof[::-1]]
    rings = [[p + V(0, 1.0, 0) for p in ring], [p - V(0, 1.0, 0) for p in ring]]
    P.add(skin(rings, segs=(1, 2, 3, 4, 5)), *conc)
    P.add(skin(rings, segs=(0, 6, 7)), *dirt)
    P.add(cap(rings[0], flip=True), *conc)
    P.add(cap(rings[1]), *conc)
    for s in (1, -1):
        P.add(box((s * 0.3, 0.5 * s, 0.04), (0.012, 0.3, 0.05)), *dark)
        y = 0.6 * s
        P.add(tube([V(0, y - 0.08, 0.79), V(0, y - 0.06, 0.85), V(0, y, 0.87), V(0, y + 0.06, 0.85), V(0, y + 0.08, 0.79)],
                   0.012, segs=5), *dark, smooth=True)
    P.ucx.append(convex(rings[0] + rings[1]))


def boat(P, rnd):
    """Mediterranean fishing boat 8 m, bow +X, pivot on the waterline centre: lofted hull (antifouling below the water,
    white topsides, blue sheer band, bulwarks round a planked deck at +0.72), wheelhouse with mast and derrick, tyre
    fenders, net pile with floats and fish boxes on the after deck."""
    anti, white, blue = ("Antifoul", "7A2A22", 0.7), ("HullWhite", "F2F1EC", 0.5), ("HullBlue", "1F5FA8", 0.5)
    deck, glass, rubber = ("Deck", "A8957A", 0.85), ("Glass", "33505E", 0.1), ("Rubber", "1E1E1E", 0.8)
    net, buoy = ("Net", "3E7A5A", 0.9), ("Buoy", "E8452C", 0.6)
    D = 0.72
    width = lambda x: max(0.03, 1.4 * math.cos(min(1.0, max(0.0, (x - 0.6) / 3.4)) * math.pi / 2) ** 0.75
                          * (1 - 0.14 * max(0.0, (-x - 2.0) / 2.0) ** 2))
    keel = lambda x: -0.6 + 0.85 * max(0.0, (x - 1.8) / 2.2) ** 1.6 + 0.1 * max(0.0, -x - 3.0)
    sheer = lambda x: 1.15 + 0.4 * max(0.0, (x - 0.5) / 3.5) ** 2 + 0.06 * max(0.0, (-x - 2.0) / 2.0)
    rings = []
    for x in (-4.0, -3.6, -2.8, -1.8, -0.6, 0.6, 1.6, 2.4, 3.0, 3.45, 3.8, 4.0):
        w, k, s = width(x), keel(x), sheer(x)
        zw, t = max(0.02, k + 0.1 * (s - k)), min(0.08, w * 0.4)
        half = [(0.3 * w, k + 0.2 * (zw - k)), (0.78 * w, k + 0.65 * (zw - k)), (0.96 * w, zw), (w, s - 0.3), (w, s),
                (w - t, s), (w - t, D)]
        rings.append([V(x, 0, k)] + [V(x, y, z) for y, z in half] + [V(x, 0, D)] + [V(x, -y, z) for y, z in half[::-1]])
    for segs, role in (((0, 1, 2, 13, 14, 15), anti), ((3, 5, 6, 9, 10, 12), white), ((4, 11), blue), ((7, 8), deck)):
        P.add(skin(rings, segs=segs), *role, smooth=True)
    P.add(cap(rings[0], flip=True), *white)
    P.add(cap(rings[-1]), *white)
    P.ucx.append(convex([p for r in rings for p in r]))
    for x in (-2.6, -0.9, 0.9):  # tyre fenders on lanyards
        for sy in (1, -1):
            y = sy * (width(x) + 0.075)
            P.add(lathe([(0.12, -0.07), (0.24, -0.07), (0.24, 0.07), (0.12, 0.07)], (x, y, 0.62), segs=8, m=rot(90, "X")), *rubber)
            P.add(bar((x, y, 0.86), (x, sy * width(x), sheer(x)), 0.025), *rubber)
    wx, wl = -0.6, 1.8
    P.add(box((wx, 0, D + 1.1), (wl, 1.7, 2.2)), *white)
    P.add(box((wx, 0, D + 0.08), (wl + 0.02, 1.72, 0.16)), *blue)
    P.add(box((wx + wl / 2 + 0.01, 0, 2.35), (0.04, 1.5, 0.6)), *glass)
    P.add(box((wx - 0.1, 0.86, 2.38), (1.3, 0.04, 0.5)), *glass)
    P.add(box((wx + 0.45, -0.86, 2.38), (0.6, 0.04, 0.5)), *glass)
    P.add(box((wx - 0.4, -0.865, D + 0.82), (0.62, 0.04, 1.6)), *blue)  # door
    P.add(box((wx, 0, D + 2.26), (2.1, 1.95, 0.12), bevel=0.02), *blue)
    P.add(box((wx + 0.3, 0, D + 2.4), (0.3, 0.5, 0.16)), *white)
    P.add(torus((wx - wl / 2 - 0.05, 0.35, 2.0), 0.26, 0.05, segs=12, rsegs=6, m=rot(90, "Y")), *buoy, smooth=True)
    P.collide(box((wx, 0, D + 1.17), (wl + 0.1, 1.75, 2.34)))
    P.add(tube([V(-0.9, 0, D + 2.3), V(-0.9, 0, 6.2)], [0.07, 0.045], segs=8), *white, smooth=True)
    P.add(bar((-0.9, -0.75, 5.4), (-0.9, 0.75, 5.4), 0.05), *white)
    P.add(cyl((-0.9, 0, 6.25), 0.06, 0.1, segs=8), *white, smooth=True)
    P.add(bar((-0.9, 0, 3.6), (-3.3, 0, 2.3), 0.06), *white)
    P.add(bar((-3.3, 0, 2.3), (-3.3, 0, 1.25), 0.015), *rubber)
    pile = blob(V(-3.0, 0.35, D + 0.12), 0.55, sub=2, amp=0.3, seed=80.0, scale=(1.1, 1.0, 0.45))
    for v in pile.verts:
        v.co.z = max(v.co.z, D)
    P.add(pile, *net)
    for k, (x, y) in enumerate(((-2.7, 0.7), (-3.2, 0.05), (-3.5, 0.65))):
        P.add(prim("sphere", V(x, y, D + 0.3 - 0.04 * k), V(0.12, 0.12, 0.12), segs=(8, 5)), *buoy, smooth=True)
    P.add(box((-2.55, -0.6, D + 0.12), (0.55, 0.38, 0.24)), *blue)
    P.add(box((-2.55, -0.6, D + 0.36), (0.55, 0.38, 0.24), r=rot(8, "Z")), *blue)


def container(P, rnd, body, frame):
    """40 ft shipping container 12.19 x 2.44 x 2.59: trapezoid-corrugated sides, ribbed blind end (-X), corner posts
    with castings, top/bottom rails, ribbed double doors on +X with four locking bars."""
    c, f, bars = ("Container", body, 0.6), ("ContainerFrame", frame, 0.6), ("LockBar", "7A8085", 0.45)
    L, W, H = 12.19, 2.44, 2.59
    hx, hy = L / 2, W / 2
    P.add(box((0, 0, 1.3), (L - 0.2, W - 0.14, 2.4)), *c)
    for s in (1, -1):
        P.add(box((0, s * (hy - 0.035), 0.08), (L - 0.2, 0.07, 0.16)), *f)
        P.add(box((0, s * (hy - 0.035), H - 0.07), (L - 0.2, 0.07, 0.14)), *f)
        P.add(box((s * (hx - 0.06), 0, 0.08), (0.12, W - 0.2, 0.16)), *f)
        P.add(box((s * (hx - 0.06), 0, H - 0.07), (0.12, W - 0.2, 0.14)), *f)
        for sy in (1, -1):
            P.add(box((s * (hx - 0.08), sy * (hy - 0.08), H / 2), (0.16, 0.16, H)), *f)
            for z in (0.06, H - 0.06):
                P.add(box((s * (hx - 0.09), sy * (hy - 0.09), z), (0.19, 0.19, 0.12)), *f)
    n, x0 = 36, hx - 0.16
    p = 2 * x0 / n
    prof = [(-x0 + i * p + d * p, o) for i in range(n) for d, o in ((0, 1), (0.3, 1), (0.5, 0), (0.8, 0))] + [(x0, 1)]
    for s in (1, -1):  # corrugation 4 cm deep, 3 cm inside the rails
        line = lambda z: [V(x, s * (hy - 0.07 + 0.04 * o), z) for x, o in prof]
        P.add(skin([line(2.45), line(0.16)] if s > 0 else [line(0.16), line(2.45)], segs=range(len(prof) - 1)), *c)
    for y in (-0.9, -0.45, 0.0, 0.45, 0.9):
        P.add(box((-hx + 0.065, y, 1.3), (0.06, 0.18, 2.29)), *c)
    for s in (1, -1):
        P.add(box((hx - 0.08, s * 0.565, 1.3), (0.04, 1.12, 2.29)), *c)
        for z in (0.65, 1.3, 1.95):
            P.add(box((hx - 0.05, s * 0.565, z), (0.02, 1.0, 0.1)), *c)
        for y in (0.25, 0.85):
            P.add(cyl((hx - 0.025, s * y, 1.31), 0.025, 2.2, segs=6), *bars)
            P.add(box((hx - 0.01, s * (y - 0.1), 1.1), (0.03, 0.22, 0.04)), *bars)
    P.collide(box((0, 0, H / 2), (L, W, H)))


def port_crane(P, rnd):
    """Ship-to-shore container crane ~45 m, pivot at the centre between its legs: four red legs on rail bogies (18 m
    apart along Y, 16 m along X), white portal beams and twin girders running into a 30 m boom over the water (+X),
    A-frame with forestays, machinery house on the back-reach, trolley with operator cab, hoist ropes, yellow spreader."""
    red, white, dark = ("CraneRed", "C23B2E", 0.6), ("CraneWhite", "EDEDE8", 0.6), ("SteelDark", "4E5459", 0.5)
    glass, yellow = ("Glass", "33505E", 0.1), ("SpreaderYellow", "E8B923", 0.5)
    LX, LY, G = 8.0, 9.0, 2.6
    for sx in (1, -1):
        for sy in (1, -1):
            x, y = sx * LX, sy * LY
            P.add(box((x, y, 0.6), (1.6, 3.4, 0.7)), *dark)
            for wy in (-1.1, 1.1):
                P.add(cyl((x, y + wy, 0.32), 0.32, 1.8, segs=8, m=rot(90, "Y")), *dark, smooth=True)
            P.add(box((x, y, 15.4), (1.3, 1.3, 29.0)), *red)
            P.add(bar((x, y, 22.0), (x, sy * (LY - 5.5), 27.7), 0.8), *red)  # knee brace into the portal beam
            P.collide(box((x, y, 15.0), (1.6, 3.4, 30.0)))
        P.add(box((sx * LX, 0, 29.0), (1.5, 2 * LY + 1.3, 2.6)), *white)  # portal beam
        P.add(box((0, sx * LY, 13.0), (2 * LX - 1.3, 1.0, 1.4)), *red)  # sill beam
        P.add(bar((-LX, sx * LY, 13.7), (LX, sx * LY, 27.7), 0.8), *red)
    for gy in (-G, G):
        P.add(box((-6.0, gy, 31.5), (28.0, 1.2, 2.4)), *white)  # girder x -20..8
        P.add(box((23.2, gy, 31.6), (30.0, 1.1, 2.0)), *white)  # boom x 8.2..38.2
        P.add(box((37.7, gy, 31.6), (1.0, 1.14, 2.04)), *red)
        P.add(cyl((8.2, gy, 31.6), 0.5, 1.4, segs=8, m=rot(90, "X")), *dark, smooth=True)
        P.add(bar((LX, gy, 32.7), (5.0, gy, 44.6), 1.0), *red)  # A-frame
        P.add(bar((-LX, gy, 32.7), (5.0, gy, 44.6), 1.0), *red)
        for tx in (22.0, 37.0):
            P.add(bar((5.0, gy, 44.6), (tx, gy, 32.6), 0.3), *dark)
        P.add(bar((5.0, gy, 44.6), (-19.0, gy, 32.7), 0.35), *dark)
    P.add(box((5.0, 0, 44.8), (1.2, 2 * G + 1.2, 1.2)), *red)
    for x in range(-18, 38, 6):
        P.add(box((x, 0, 30.6), (0.4, 2 * G, 0.4)), *white)
        if x < 32:  # plan bracing over the girders
            P.add(bar((x, -G * (-1) ** (x // 6), 32.75), (x + 6, G * (-1) ** (x // 6), 32.75), 0.25), *white)
    P.add(box((-15.5, 0, 34.9), (7.0, 7.4, 4.4)), *white)  # machinery house
    P.add(box((-15.5, 0, 35.8), (7.04, 7.44, 0.5)), *glass)
    P.add(box((22.0, 0, 33.4), (4.0, 6.4, 1.4)), *dark)  # trolley
    P.add(box((20.5, -1.4, 30.2), (1.0, 1.0, 0.3)), *dark)
    P.add(box((20.5, -1.4, 28.9), (2.6, 2.4, 2.4)), *white)  # operator cab
    P.add(box((20.5, -1.4, 29.0), (2.64, 2.44, 1.0)), *glass)
    for dx in (-1.2, 1.2):
        for dy in (-1.0, 1.0):
            P.add(bar((22.0 + dx, dy, 30.3), (22.0 + dx * 0.6, dy, 18.6), 0.08), *dark)
    P.add(box((22.0, 0, 18.2), (2.0, 3.0, 0.8)), *dark)
    P.add(box((22.0, 0, 17.5), (2.3, 12.0, 0.6)), *yellow)


# ---------------------------------------------------------------- desert
def shrub(P, rnd):
    """Dry desert scrub ~1.4 m wide: low clumps of dusty sage and straw-coloured foliage with bare twigs poking out."""
    sage, dry, twig = ("Scrub", "7E8456", 0.95), ("ScrubDry", "A39A6A", 0.95), ("Twig", "6B5A45", 0.95)
    clumps = [((0, 0, 0.42), 0.48, sage), ((0.42, 0.2, 0.2), 0.3, dry), ((-0.35, 0.3, 0.22), 0.32, sage),
              ((-0.2, -0.4, 0.18), 0.28, dry), ((0.3, -0.35, 0.2), 0.27, sage)]
    for k, (c, r, role) in enumerate(clumps):
        b = blob(c, r, sub=2, amp=0.35, seed=k + 60.0, scale=(1.15, 1.15, 0.8))
        for v in b.verts:
            v.co.z = max(v.co.z, 0.0)
        P.add(b, *role)
    for k in range(7):
        a = k * 0.9 + rnd.uniform(-0.2, 0.2)
        d = V(math.cos(a), math.sin(a), 0)
        P.add(bar(d * 0.1 + Z * 0.05, d * rnd.uniform(0.45, 0.65) + Z * rnd.uniform(0.6, 0.9), 0.015), *twig)


def rock(P, rnd):
    """Limestone boulder ~3 m: lumpy noisy icosphere with a flattened top and stepped bedding ledges, sat on a flat
    base; two loose stones."""
    lime, dark = ("Limestone", "BFB298", 0.9), ("LimestoneDark", "9C8E72", 0.95)

    def stone(c, size, seed, sub):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
        off = V(seed, seed * 1.7, seed * 0.6)
        for v in bm.verts:
            n = v.co.normalized()
            k = 1 + 0.25 * noise.noise(n * 1.3 + off) + 0.1 * noise.noise(n * 3.1 + off)
            z = min(n.z * size[2] * k, size[2] * 0.8)
            k *= 1 - 0.07 * (int((z + c[2]) / 0.3) % 2)  # alternate 30 cm beds stand out / weather back
            v.co = Vector(c) + V(n.x * size[0] * k, n.y * size[1] * k, z)
            v.co.z = max(v.co.z, 0.0)
        return bm
    P.collide(stone((0, 0, 0.75), (1.45, 1.2, 1.3), 2.0, 2))  # same shape at 162 verts: a lean hull for physics
    P.add(stone((0, 0, 0.75), (1.45, 1.2, 1.3), 2.0, 3), *lime)
    P.add(stone((1.45, 0.95, 0.12), (0.35, 0.3, 0.25), 5.0, 2), *dark)  # tucked in: bounds stay ~3.4 x 2.7
    P.add(stone((-1.25, -1.1, 0.1), (0.28, 0.22, 0.2), 9.0, 2), *dark)


def acacia(P, rnd):
    """Flat-topped desert acacia ~6 m: leaning dark trunk forking into four spreading limbs under a wide, thin umbrella
    crown (~7 m) of dusty olive leaf clumps."""
    bark, leaf, light = ("AcaciaBark", "5E4C3A", 0.9), ("AcaciaLeaf", "6B7A3A", 0.9), ("AcaciaLeafLight", "8A9450", 0.9)
    trunk = [V(0, 0, 0), V(0.1, 0.05, 0.8), V(0.25, 0.1, 1.6), V(0.3, 0.12, 2.1)]
    P.add(tube(trunk, [0.3, 0.22, 0.19, 0.17], segs=7), *bark, smooth=True)
    P.collide(tube(trunk, [0.32, 0.24, 0.21, 0.19], segs=7))
    top = trunk[-1]
    for k in range(4):
        a = k * math.pi / 2 + 0.4 + rnd.uniform(-0.25, 0.25)
        d, out = V(math.cos(a), math.sin(a), 0), rnd.uniform(1.9, 2.6)
        P.add(tube([top - Z * 0.2, top + d * 0.6 + Z * 0.7, top + d * out * 0.75 + Z * 1.9, top + d * out + Z * 2.9],
                   [0.14, 0.11, 0.08, 0.05], segs=6), *bark, smooth=True)
    P.add(blob(V(0.3, 0.1, 5.35), 2.6, sub=3, amp=0.22, seed=3.0, scale=(1.25, 1.2, 0.2)), *leaf)
    for k in range(5):
        a = k * 2 * math.pi / 5 + 0.3 + rnd.uniform(-0.2, 0.2)
        c = V(0.3 + math.cos(a) * 2.4, 0.1 + math.sin(a) * 2.3, 5.2 + rnd.uniform(-0.1, 0.15))
        P.add(blob(c, 1.2, sub=2, amp=0.3, seed=k + 70.0, scale=(1, 1, 0.3)), *(light if k % 2 else leaf))


def hill(P, rnd):
    """Desert mound 100 x 100 x 15 m for world-aligned ground materials: rounded cone (gentle and convex, so one hull
    fits) on a 32 x 8 polar grid with mild noise, the rim tucked 0.5 m below ground."""
    R, H, top, segs, rings = 50.0, 15.0, 0.45, 32, 8
    s = H / (1 - top / 2)  # slope of the cone, rounded off by a paraboloid cap inside r < top
    h = lambda r: H - s * r * r / (2 * top) if r < top else s * (1 - r)
    pts = []
    for i in range(rings + 2):
        r = i / rings if i <= rings else 1.04
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            x, y = R * r * math.cos(a), R * r * math.sin(a)
            z = h(r) + 0.6 * (1 - r) * noise.noise(V(x * 0.035, y * 0.035, 3.3)) if i <= rings else -0.5
            ring.append(V(x, y, z))
        pts.append(ring)
    P.add(skin(pts[::-1]), "Ground", "C9A878", 0.95, smooth=True)
    P.ucx.append(convex([p for i, r in enumerate(pts) if i % 2 == 0 or i > rings for p in r]))


PROPS = {"Palm": palm, "Ficus": ficus, "StreetLamp": street_lamp, "Bench": bench, "Bin": bin_, "BusStop": bus_stop,
         "SolarHeater": solar_heater, "WaterTank": water_tank, "ACUnit": ac_unit, "Umbrella": umbrella,
         "Lounger": lounger, "LifeguardTower": lifeguard_tower, "Kiosk": kiosk, "Bollard": bollard, "Planter": planter,
         "Crate": crate, "CrateOpen": lambda P, rnd: crate(P, rnd, lid=False), "CashBag": cash_bag,
         "ShopCounter": shop_counter, "SlotMachine": slot_machine, "BurgerCounter": burger_counter, "Vault": vault,
         "VaultOpen": lambda P, rnd: vault(P, rnd, open_=True), "ForgerDesk": forger_desk, "CheckInDesk": checkin_desk,
         "ParcelStack": parcel_stack, "GuardBooth": guard_booth, "BoomGate": boom_gate, "JerseyBarrier": jersey_barrier,
         "Boat": boat, "ContainerRed": lambda P, rnd: container(P, rnd, "9E3B2E", "7E2E24"),
         "ContainerBlue": lambda P, rnd: container(P, rnd, "2B5D8F", "22496F"),
         "ContainerGreen": lambda P, rnd: container(P, rnd, "3F6E47", "2F5436"),
         "ContainerGrey": lambda P, rnd: container(P, rnd, "8C9196", "6E7378"), "PortCrane": port_crane,
         "Shrub": shrub, "Rock": rock, "Acacia": acacia, "Hill": hill}


# ---------------------------------------------------------------- export + contact sheet
def export_fbx(obj, hulls, path):
    """Static mesh in centimetre numbers: bake x100 into the mesh data, 1 Blender unit = 1 cm, export, undo."""
    scn = bpy.context.scene
    objs = [obj] + hulls
    old = scn.unit_settings.scale_length
    for o in objs:
        o.data.transform(Matrix.Scale(100.0, 4))
    scn.unit_settings.scale_length = 0.01
    try:
        bpy.context.view_layer.update()
        for o in bpy.data.objects:
            o.select_set(o in objs)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={"MESH"}, apply_unit_scale=True,
                                 apply_scale_options="FBX_SCALE_UNITS", mesh_smooth_type="FACE", bake_anim=False,
                                 use_mesh_modifiers=False, add_leaf_bones=False)
    finally:
        scn.unit_settings.scale_length = old
        for o in objs:
            o.data.transform(Matrix.Scale(0.01, 4))
    return path


def stats(obj):
    me = obj.data
    xs, ys, zs = ([v.co[i] for v in me.vertices] for i in range(3))
    return {"tris": sum(len(p.vertices) - 2 for p in me.polygons), "materials": [m.name for m in me.materials],
            "size_m": [round(max(a) - min(a), 2) for a in (xs, ys, zs)], "min_z": round(min(zs), 3),
            "centre_xy": [round((max(xs) + min(xs)) / 2, 2), round((max(ys) + min(ys)) / 2, 2)]}


def render_sheet(built, report, path, cols=5, cell=(520, 560)):
    """One Eevee 3/4 orthographic shot per prop (framed to fit, labelled), tiled into a contact sheet."""
    import numpy as np
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_EEVEE"
    scn.eevee.taa_render_samples = 32
    scn.view_settings.view_transform = "Standard"
    scn.render.resolution_x, scn.render.resolution_y = cell
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = "PNG"
    for m in bpy.data.materials:
        m.use_backface_culling = True  # like UE: the double-sided leaves show their own front face only
    col = scn.collection
    if scn.world is None:
        scn.world = bpy.data.worlds.new("World")
    bg = next(n for n in scn.world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value, bg.inputs[1].default_value = (0.62, 0.7, 0.8, 1), 0.9
    fme = bpy.data.meshes.new("STAGE_floor")
    b = bmesh.new()
    bmesh.ops.create_grid(b, x_segments=1, y_segments=1, size=400)
    b.to_mesh(fme)
    b.free()
    fme.materials.append(material("StageFloor", "D8D0BE", 0.95))
    floor = bpy.data.objects.new("STAGE_floor", fme)
    col.objects.link(floor)
    sun = bpy.data.objects.new("STAGE_sun", bpy.data.lights.new("STAGE_sun", "SUN"))
    sun.data.energy, sun.data.angle = 3.2, math.radians(3)
    sun.rotation_euler = (math.radians(48), math.radians(8), math.radians(-35))
    col.objects.link(sun)
    cam = bpy.data.objects.new("STAGE_cam", bpy.data.cameras.new("STAGE_cam"))
    cam.data.type, cam.data.sensor_fit, cam.data.clip_end = "ORTHO", "HORIZONTAL", 3000
    view = V(1.0, -0.95, 0.6).normalized()  # from front-left, above
    q = (-view).to_track_quat("-Z", "Y")
    cam.rotation_euler = q.to_euler()
    col.objects.link(cam)
    scn.camera = cam
    ink = bpy.data.materials.new("STAGE_ink")
    nt = ink.node_tree
    nt.nodes.clear()
    em, out = nt.nodes.new("ShaderNodeEmission"), nt.nodes.new("ShaderNodeOutputMaterial")
    em.inputs[0].default_value = (0.02, 0.02, 0.03, 1)
    nt.links.new(em.outputs[0], out.inputs[0])
    txt = bpy.data.objects.new("STAGE_label", bpy.data.curves.new("STAGE_label", "FONT"))
    txt.data.align_x, txt.data.align_y = "CENTER", "CENTER"
    txt.data.materials.append(ink)
    txt.parent = cam
    col.objects.link(txt)

    aspect, strip = cell[1] / cell[0], 0.12  # label strip = bottom 12% of each cell
    R = q.to_matrix()
    cols = min(cols, len(built))
    rows = (len(built) + cols - 1) // cols
    W, H = cols * cell[0], rows * cell[1]
    page = np.ones((H, W, 4), np.float32)
    page[..., :3] = 0.35
    tmp = bpy.app.tempdir or os.path.dirname(path)
    for i, (name, (obj, _)) in enumerate(built.items()):
        for o in bpy.data.objects:
            if o.name.startswith("SM_"):
                o.hide_render = o is not obj
        floor.location.z = min(0.0, report[name]["min_z"])  # the boat's hull below the waterline
        loc = [R.transposed() @ (obj.matrix_world @ Vector(c)) for c in obj.bound_box]
        xs, ys, zs = [p.x for p in loc], [p.y for p in loc], [p.z for p in loc]
        ortho = max(max(xs) - min(xs), (max(ys) - min(ys)) / (aspect * (1 - strip))) * 1.12
        cam.data.ortho_scale = ortho
        vh = ortho * aspect
        cam.location = R @ V((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2 - strip * vh / 2, max(zs) + 400)  # far back: the ground in front of big props stays in view
        st = report[name]
        txt.data.body = f"{name}   {st['size_m'][2]:.1f} m   {st['tris']} tris"
        txt.data.size = strip * vh * 0.42
        txt.location = (0, -vh / 2 + strip * vh * 0.5, -1.0)
        f = os.path.join(tmp, f"_props_cell_{name}.png")
        scn.render.filepath = f
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(f)
        px = np.empty(len(img.pixels), np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        r, c = divmod(i, cols)
        y0, x0 = H - (r + 1) * cell[1], c * cell[0]
        page[y0:y0 + cell[1], x0:x0 + cell[0]] = px.reshape(cell[1], cell[0], 4)
        page[y0:y0 + cell[1], x0, :3] = page[y0, x0:x0 + cell[0], :3] = 0.3  # grid lines
    for o in list(bpy.data.objects):
        if o.name.startswith("SM_"):
            o.hide_render = False
        elif o.name.startswith("STAGE_"):
            bpy.data.objects.remove(o, do_unlink=True)  # the next sheet builds its own stage
    out = bpy.data.images.new("props_sheet", W, H, alpha=False)
    out.pixels.foreach_set(page.ravel())
    out.filepath_raw, out.file_format = path, "PNG"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save()
    return path


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = {a.lstrip("-"): (argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else "1")
           for i, a in enumerate(argv) if a.startswith("--")}
    out_dir = opt.get("out", os.path.join(ROOT, "Art", "out", "props"))
    sheet_png = opt.get("sheet", os.path.join(ROOT, "Saved", "Agent", "props_sheet.png"))
    only = opt["only"].split(",") if "only" in opt else list(PROPS)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    built, report = {}, {}
    for name in only:
        P = Prop(name)
        PROPS[name](P, random.Random(name))
        built[name] = P.build()
        report[name] = stats(built[name][0]) | {"collision_hulls": len(built[name][1])}
    if "no-export" not in opt:
        os.makedirs(out_dir, exist_ok=True)
        for name, (obj, hulls) in built.items():
            report[name]["fbx"] = export_fbx(obj, hulls, os.path.join(out_dir, f"SM_{name}.fbx"))
        # sidecar for Tools/ue/import_props.py: slot roughness (FBX drops it) + expected collision hulls; merged so --only keeps the rest
        side = os.path.join(out_dir, "props.json")
        meta = json.load(open(side, encoding="utf-8")) if os.path.exists(side) else {"materials": {}, "props": {}}
        for name, (obj, _h) in built.items():
            meta["props"][name] = {k: report[name][k] for k in ("tris", "size_m", "collision_hulls")}
            for m in obj.data.materials:
                bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
                meta["materials"][m.name] = round(bsdf.inputs["Roughness"].default_value, 2)
        with open(side, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=1, sort_keys=True)
    if opt.get("sheet") != "none":
        cell = tuple(int(v) for v in opt.get("cell", "520x560").split("x"))
        names, per = list(built), 20  # 5 x 4 cells a sheet: props_sheet.png, props_sheet2.png, ...
        for i in range(0, len(names), per):
            path = sheet_png if not i else f"{os.path.splitext(sheet_png)[0]}{i // per + 1}.png"
            report[f"_sheet{i // per + 1}"] = render_sheet({n: built[n] for n in names[i:i + per]}, report, path, cell=cell)
    print("PROPS OK " + json.dumps(report))


if __name__ == "__main__":
    main()
