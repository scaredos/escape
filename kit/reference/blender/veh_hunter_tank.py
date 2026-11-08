"""Hunter tank: generic modern MBT for UE Chaos Vehicles. Headless only:

    blender -b --factory-startup -P Tools/blender/veh_hunter_tank.py -- --out <Art/out> --renders <Art/renders>

Metres, +X forward, Z up, +Y = left. Bones: root > chassis > turret > barrel, chassis > wheel_l1..6 / wheel_r1..6
(1 = front). Track bands are on chassis with a UV map (U = metres along the loop) so UE can UV-scroll them.
"""
import bmesh, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veh_common import *  # noqa: F401,F403

VID = "hunter_tank"
PAINT, DARK, DETAIL, PATCH = "5B6B3A", "4A5530", "56603C", "C9B46A"
XT = -0.1                                    # turret ring centre x
ROOF, TOP = 1.70, 2.42                       # hull roof / turret roof z
PIV = Vector((XT + 1.30, 0.0, 2.08))         # gun trunnion = mantlet pivot
FACE = PIV.x + 0.275                         # mantlet front face x
GUN = 5.0                                    # barrel length ahead of the mantlet
WR, WV, TT = 0.40, 0.31, 0.09               # physics wheel radius = visual road wheel + track thickness
WY, TW = 1.42, 0.60                          # track centre |y| and width
WX = [2.15 - i * 0.86 for i in range(6)]     # road wheels, front to rear
IDLER, SPROCKET = (3.05, 0.62, 0.27), (-3.10, 0.66, 0.31)  # (x, z, r)
RY90 = Matrix.Rotation(math.pi / 2, 4, "Y")  # cylinder Z -> X


def box(c, s, bevel=0.03, rot=None):
    return prim("cube", Vector(c), Vector(s), rot=rot, bevel=bevel)


def cylx(c, r, length, n=16):
    return prim("cyl", Vector(c), Vector((r, r, length)), rot=RY90, segs=(n, 1))


def cylz(c, r, h, n=16):
    return prim("cyl", Vector(c), Vector((r, r, h)), segs=(n, 1))


def solid(pts, bevel=0.04):
    """Bevelled convex hull of the points mirrored to +-y: faceted armour blocks."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, s * y, z)) for x, y, z in pts for s in (1, -1)]
    bmesh.ops.convex_hull(bm, input=vs)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:], offset=bevel, segments=2,
                        affect="EDGES", profile=0.5, clamp_overlap=True)
    return bm


def hull2d(pts):
    """Andrew's monotone chain: convex outline of 2D points, in order, collinear points dropped."""
    pts = sorted(set(pts))

    def half(seq):
        h = []
        for p in seq:
            while len(h) >= 2 and ((h[-1][0] - h[-2][0]) * (p[1] - h[-2][1])
                                   - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0])) <= 0:
                h.pop()
            h.append(p)
        return h[:-1]
    return half(pts) + half(pts[::-1])


def track(s):
    """Closed band hugging road wheels + idler + sprocket on side s (+1 left). -> (bmesh, [(u, v)] per vert, loop length)."""
    centre = {}
    for cx, cz, r in [(x, WR, WV) for x in WX] + [IDLER, SPROCKET]:
        for k in range(32):
            a = 2 * math.pi * k / 32
            centre[(round(cx + r * math.cos(a), 5), round(cz + r * math.sin(a), 5))] = (cx, cz)
    inner = hull2d(list(centre))
    outer = []
    for p in inner:  # offset radially from the circle each outline point came from (exact Minkowski offset)
        c = centre[p]
        d = Vector((p[0] - c[0], p[1] - c[1])).normalized()
        outer.append((p[0] + d.x * TT, p[1] + d.y * TT))
    u = [0.0]
    for i in range(1, len(outer)):
        u.append(u[-1] + (Vector(outer[i]) - Vector(outer[i - 1])).length)
    loop = u[-1] + (Vector(outer[0]) - Vector(outer[-1])).length
    bm, uv, rings = bmesh.new(), [], []
    ys = (s * (WY - TW / 2), s * (WY + TW / 2))  # inboard, outboard
    for i in range(len(inner)):
        ring = []
        for prof in (inner, outer):
            for vi, y in enumerate(ys):
                ring.append(bm.verts.new((prof[i][0], y, prof[i][1])))
                uv.append((u[i], float(vi)))
        rings.append(ring)  # in_a, in_b, out_a, out_b
    for i in range(len(rings)):
        a, b = rings[i], rings[(i + 1) % len(rings)]
        for q in ((a[2], b[2], b[3], a[3]), (a[0], a[1], b[1], b[0]),
                  (a[0], b[0], b[2], a[2]), (a[1], a[3], b[3], b[1])):
            bm.faces.new(q)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    assert abs(min(p[1] for p in outer)) < 1e-4, "track must touch the ground"
    return bm, uv, loop


def track_uv(me, uvmap, loop):
    """UV only the track faces; the face crossing the loop start gets u + loop so it doesn't smear backwards."""
    layer = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        vids = [me.loops[li].vertex_index for li in poly.loop_indices]
        if vids[0] not in uvmap:
            continue
        us = [uvmap[v][0] for v in vids]
        wrap = max(us) - min(us) > loop / 2
        for li, v in zip(poly.loop_indices, vids):
            uu, vv = uvmap[v]
            layer.data[li].uv = (uu + loop if wrap and uu < loop / 2 else uu, vv)


def build(o):
    clear_scene()
    r = Rig(VID)
    r.bone("root", (0, 0, 0), (0.5, 0, 0))
    r.bone("chassis", (0, 0, 0.9), (0.5, 0, 0.9), "root")
    r.bone("turret", (XT, 0, ROOF), (XT + 0.5, 0, ROOF), "chassis")
    r.bone("barrel", PIV, PIV + Vector((0.5, 0, 0)), "turret")
    wheels = []
    for side, s in (("l", 1), ("r", -1)):
        for i, x in enumerate(WX, 1):
            wheels.append((r.bone(f"wheel_{side}{i}", (x, s * WY, WR), (x, s * (WY + 0.2), WR), "chassis"), x, s))

    paint = r.mat("Paint", PAINT, 0.7)
    dark, detail = r.mat("PaintDark", DARK, 0.7), r.mat("Detail", DETAIL, 0.7)
    trim, trk, tyre = r.mat("Trim", "3A3A3A", 0.6), r.mat("Track", "2E2E2E", 0.9), r.mat("Tyre", "1C1C1C", 0.9)
    glass, patch = r.mat("Glass", "2A3440", 0.2), r.mat("Patch", PATCH, 0.7)
    head, tail = r.mat("Headlight", "F2E6B0", 0.3), r.mat("Taillight", "B3261E", 0.3)

    # ---- hull (chassis)
    C = "chassis"
    r.add(solid([(-3.55, 1.1, 0.45), (-3.62, 1.1, 1.12), (3.2, 1.1, 0.45), (3.78, 1.1, 1.12)]), C, paint)
    r.add(solid([(-3.7, 1.75, 1.08), (-3.62, 1.75, ROOF), (2.45, 1.75, ROOF), (3.75, 1.75, 1.2),
                 (3.75, 1.75, 1.08)], 0.05), C, paint)
    r.add(cylz((XT, 0, ROOF + 0.02), 1.15, 0.08, 24), C, dark)                    # turret ring
    for y in (0.62, -0.62):
        r.add(box((-2.75, y, ROOF + 0.02), (1.3, 1.0, 0.06), 0.015), C, trim)      # engine grilles
    r.add(cylz((2.1, 0.4, ROOF + 0.03), 0.28, 0.07, 12), C, detail)               # driver hatch (left)
    r.add(box((2.42, 0.4, ROOF + 0.04), (0.1, 0.45, 0.08), 0.01), C, glass)       # driver vision block
    r.add(box((-3.66, 0, 1.38), (0.06, 1.8, 0.24), 0.01), C, trim)                # rear exhaust grille
    r.add(box((3.72, 0, 0.98), (0.14, 1.7, 0.14), 0.02), C, trim)                 # front tow bar
    uvmap, loop = {}, 0.0
    for s in (1, -1):
        r.add(box((3.2, s * 1.45, 1.43), (0.16, 0.28, 0.16), 0.02), C, trim)
        r.add(box((3.285, s * 1.45, 1.44), (0.03, 0.2, 0.1)), C, head)
        r.add(box((-3.68, s * 1.5, 1.55), (0.05, 0.2, 0.1), 0.0), C, tail)
        for k in range(5):                                                         # skirt panels
            r.add(box((-3.2 + k * 1.3 + 0.635, s * 1.77, 0.86), (1.27, 0.06, 0.6), 0.02), C, paint)
        y = s * WY
        r.add(wheel((IDLER[0], y, IDLER[1]), IDLER[2], 0.42, 18), C, tyre)
        r.add(wheel((IDLER[0], y, IDLER[1]), 0.21, 0.48, 12), C, dark)
        r.add(wheel((SPROCKET[0], y, SPROCKET[1]), SPROCKET[2], 0.36, 10), C, trim)
        r.add(wheel((SPROCKET[0], y, SPROCKET[1]), 0.22, 0.46, 10), C, dark)
        r.add(wheel((SPROCKET[0], y, SPROCKET[1]), 0.10, 0.52, 8), C, trim)
        start = len(r.bm.verts)
        bm, uv, loop = track(s)
        uvmap.update({start + k: t for k, t in enumerate(uv)})
        r.add(bm, C, trk)

    # ---- road wheels (one bone each)
    for n, x, s in wheels:
        c = (x, s * WY, WR)
        r.add(wheel(c, WV, 0.46, 20), n, tyre)
        r.add(wheel(c, 0.26, 0.50, 16), n, dark)
        r.add(wheel(c, 0.10, 0.54, 8), n, trim)

    # ---- turret
    T = "turret"
    r.add(solid([(XT + 1.55, 0.55, 1.72), (XT + 1.1, 1.6, 1.72), (XT - 2.1, 1.45, 1.72), (XT - 2.2, 1.15, 1.72),
                 (XT + 1.05, 0.6, TOP), (XT + 0.7, 1.5, TOP), (XT - 2.0, 1.35, TOP), (XT - 2.15, 1.1, TOP)], 0.05),
          T, paint)
    r.add(box((XT - 2.38, 0, 2.05), (0.4, 2.3, 0.42), 0.03), T, dark)             # bustle basket
    for s in (1, -1):
        r.add(box((XT - 1.3, s * 1.5, 2.05), (1.2, 0.22, 0.5), 0.03), T, detail)    # stowage bin
        r.add(box((XT + 0.25, s * 1.525, 2.07), (0.3, 0.04, 0.2), 0.008,
                  rot=Matrix.Rotation(math.radians(7 * s), 4, "X")), T, patch)      # plain faction patch
        r.add(box((XT + 0.5, s * 1.3, TOP + 0.06), (0.3, 0.26, 0.12), 0.02), T, dark)  # smoke launchers
        for k in range(3):
            r.add(cylx((XT + 0.7, s * (1.2 + 0.1 * k), TOP + 0.07), 0.04, 0.16, 8), T, trim)
    r.add(cylz((XT - 0.55, -0.7, TOP + 0.05), 0.36, 0.1, 14), T, detail)            # commander cupola (right)
    r.add(cylz((XT - 0.55, -0.7, TOP + 0.12), 0.29, 0.05, 14), T, dark)
    r.add(cylz((XT - 0.55, 0.7, TOP + 0.03), 0.3, 0.06, 12), T, detail)             # loader hatch (left)
    r.add(box((XT + 0.55, -0.85, TOP + 0.1), (0.4, 0.32, 0.2), 0.02), T, detail)    # gunner sight
    r.add(box((XT + 0.76, -0.85, TOP + 0.12), (0.02, 0.24, 0.1), 0.0), T, glass)
    r.add(cylz((XT + 0.1, -0.35, TOP + 0.05), 0.12, 0.1, 10), T, detail)            # commander sight
    r.add(box((XT + 0.1, -0.35, TOP + 0.15), (0.26, 0.24, 0.12), 0.02), T, detail)
    r.add(box((XT + 0.24, -0.35, TOP + 0.15), (0.02, 0.18, 0.07), 0.0), T, glass)
    MG = Vector((XT + 0.5, 0.7, TOP + 0.19))                                        # roof MG on loader ring
    r.add(cylz((XT - 0.4, 0.7, TOP + 0.1), 0.03, 0.1, 6), T, trim)
    r.add(box((XT - 0.3, 0.7, MG.z - 0.01), (0.42, 0.1, 0.1), 0.01), T, trim)
    r.add(cylx((MG.x - 0.3, 0.7, MG.z), 0.025, 0.6, 8), T, trim)
    r.add(box((XT - 0.3, 0.78, MG.z - 0.04), (0.16, 0.08, 0.12), 0.01), T, dark)

    # ---- gun (barrel bone; mantlet elevates with it)
    B = "barrel"
    r.add(box((PIV.x + 0.05, 0, PIV.z), (0.45, 0.8, 0.56), 0.05), B, dark)          # mantlet
    r.add(cylx((FACE + 0.6, 0, PIV.z), 0.15, 1.2), B, paint)                        # breech-end sleeve
    r.add(cylx((FACE + 3.1, 0, PIV.z), 0.11, 3.8), B, paint)                        # tube
    r.add(cylx((FACE + 2.4, 0, PIV.z), 0.16, 0.55), B, paint)                       # bore evacuator
    r.add(cylx((FACE + GUN - 0.1, 0, PIV.z), 0.13, 0.2), B, dark)                   # muzzle ring
    r.add(cylx((FACE + GUN, 0, PIV.z), 0.07, 0.01, 12), B, tyre)                    # bore

    arm, body = r.build()
    track_uv(body.data, uvmap, loop)

    fbx = os.path.join(o["out"], f"SK_veh_{VID}.fbx")
    export_fbx(arm, body, fbx)
    rep = check_fbx(fbx)
    h = rep["bone_heads_m"]
    wb = [n for n, _, _ in wheels]
    assert rep["unweighted_verts"] == 0 and all(n in h for n in wb + ["turret", "barrel"]), rep
    bx = h["barrel"]
    meta = {
        "id": VID, "kind": "tank", "mass_kg": 55000,
        "wheels": [{"bone": n, "center": h[n], "radius": WR, "width": TW, "steer": False, "drive": True} for n in wb],
        "seats": [{"name": "driver", "pos": [2.1, 0.4, 1.05]},
                  {"name": "gunner", "pos": [round(XT + 0.3, 3), -0.6, 1.55]},
                  {"name": "commander", "pos": [round(XT - 0.55, 3), -0.7, 1.85]}],
        "paint_slot": f"M_Paint_{PAINT}",
        "colour_variants": [PAINT, "A8946A", "6B6E66"],
        "sockets": {"muzzle": [round(bx[0] + FACE + GUN - PIV.x, 3), bx[1], bx[2]],
                    "turret_ring": h["turret"],
                    "roof_mg_muzzle": [round(c, 3) for c in MG]},
        "track": {"bone": "chassis", "material": "M_Track_2E2E2E", "uv": "U = metres along the loop, V = 0..1 inboard->outboard",
                  "loop_length_m": round(loop, 3), "thickness_m": TT, "road_wheel_visual_radius_m": WV},
    }
    jpath = write_meta(os.path.join(o["out"], f"SK_veh_{VID}.json"), meta)
    renders = render_views(os.path.join(o["renders"], f"veh_{VID}"), [body])
    print("VEH", json.dumps({"id": VID, "fbx": fbx, "meta": jpath, "renders": renders, **rep}))
    clear_scene()


if __name__ == "__main__":
    build(args())
