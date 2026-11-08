"""Generic medium utility helicopter "hunter_heli" (stylised, not a replica of any real model).

blender -b --factory-startup -P Tools/blender/veh_heli.py -- --out <Art/out> --renders <Art/renders>

Metres, front +X, left +Y, Z up. Origin on the ground under the main rotor hub (~centre of mass).
Bones: root > body > main_rotor (head at hub, +Z) / tail_rotor (head at hub, +Y). Every part is rigid.
"""
import os, sys, json
import bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veh_common import *  # noqa: F401,F403

VID = "hunter_heli"
PAINT, ACCENT, PATCH = "5B6B3A", "4A5530", "C9B46A"  # roster.json faction: uniform, vest, patch
CIV_PAINT, CIV_ACCENT = "EDEBE4", "B3261E"
HUB, R_MAIN = Vector((0, 0, 4.2)), 7.0
TR_HUB, R_TAIL = Vector((-9.4, 0.44, 3.4)), 1.4
GUN_X, GUN_Z = 0.95, 1.68  # gunner seat + pintle + mount socket share GUN_X
BENCH_X = -1.45
AX = {"X": Matrix.Rotation(math.radians(90), 4, "Y"), "Y": Matrix.Rotation(math.radians(-90), 4, "X"), "Z": None}


def box(c, s, bev=0.04, rot=None):
    return prim("cube", Vector(c), Vector(s), rot=rot, bevel=bev)


def cyl(c, r, length, axis="Z", segs=16):
    return prim("cyl", Vector(c), Vector((r, r, length)), rot=AX[axis], segs=(segs, 1))


def tube(a, b, r, segs=10):
    a, b = Vector(a), Vector(b)
    rot = Vector((0, 0, 1)).rotation_difference(b - a).to_matrix().to_4x4()
    return prim("cyl", (a + b) / 2, Vector((r, r, (b - a).length)), rot=rot, segs=(segs, 1))


def half_egg(c, s, x_cut, segs=(24, 12)):
    return prim("sphere", Vector(c), Vector(s), cut=(Vector((x_cut, 0, 0)), Vector((1, 0, 0))), segs=segs)


def loft(back, front, bev=0.0):
    """Y-symmetric 8-corner box. back/front = (x_at_bottom, x_at_top, half_width, z_bottom, z_top)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        xb, xt, hy, z0, z1 = front if v.co.x > 0 else back
        top = v.co.z > 0
        v.co = Vector((xt if top else xb, hy if v.co.y > 0 else -hy, z1 if top else z0))
    bm.normal_update()
    if bev:
        bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:], offset=bev, segments=2, affect="EDGES", profile=0.5)
    return bm


def fin_x(z):  # leading / trailing edge of the swept fin at height z
    t = (z - 2.15) / 1.95
    return -9.5 - 0.45 * t, -8.6 - 0.7 * t


def build():
    rig = Rig(VID)
    rig.bone("root", (0, 0, 0), (0.5, 0, 0))
    rig.bone("body", (0, 0, 1.4), (1.0, 0, 1.4), "root")
    rig.bone("main_rotor", HUB, HUB + Vector((0, 0, 0.5)), "body")
    rig.bone("tail_rotor", TR_HUB, TR_HUB + Vector((0, 0.3, 0)), "body")
    paint, accent = rig.mat("Paint", PAINT, 0.6), rig.mat("Accent", ACCENT, 0.6)
    glass, trim = rig.mat("Glass", "2A3440", 0.15), rig.mat("Trim", "3A3A3A", 0.5)
    patch, lamp = rig.mat("Patch", PATCH, 0.7), rig.mat("Headlight", "F2E6B0", 0.3)

    def B(bm, slot):
        rig.add(bm, "body", slot, smooth=True)  # hard edges come back via set_sharp_from_angle

    # cabin shell: belly + cockpit block + roof + rear walls leave an open door x -1.3..1.3, z 1.0..2.42
    B(box((0.375, 0, 0.86), (5.25, 2.4, 0.28), 0.08), paint)
    B(box((2.175, 0, 1.71), (1.75, 2.4, 1.98), 0.1), paint)
    B(box((-0.425, 0, 2.56), (3.65, 2.4, 0.28), 0.08), paint)
    B(box((-2.175, 0, 1.71), (0.15, 2.4, 1.52), 0.03), paint)
    B(box((-0.4, 0, 1.01), (3.4, 2.2, 0.04), 0), trim)  # floor plate
    for s in (1, -1):
        B(box((-2.0, s * 1.14, 1.71), (0.5, 0.12, 1.52), 0.03), paint)  # rear side wall (door x -1.75..1.3)
        B(box((-0.475, s * 1.225, 2.44), (3.55, 0.06, 0.07), 0.015), trim)  # door rail
        B(box((0.4, s * 1.215, 0.865), (5.2, 0.04, 0.17), 0.01), accent)  # cheat line
        B(box((2.175, s * 1.21, 2.025), (1.35, 0.04, 0.85), 0.015), glass)  # cockpit side window
        # door gunner: seat facing out, pintle post + arm at the front of the door
        B(box((GUN_X, s * 0.7, 1.22), (0.45, 0.45, 0.4), 0.04), trim)
        B(box((GUN_X, s * 0.47, 1.65), (0.45, 0.08, 0.5), 0.02), trim)
        B(cyl((GUN_X, s * 1.05, 1.33), 0.045, 0.62, segs=10), trim)
        B(box((GUN_X, s * 1.16, 1.64), (0.1, 0.24, 0.07), 0.015), trim)
    # passenger bench (4), forward of the short rear walls so passengers show in the door
    B(box((BENCH_X, 0, 1.22), (0.55, 2.1, 0.4), 0.04), trim)
    B(box((BENCH_X - 0.24, 0, 1.8), (0.1, 2.1, 0.75), 0.02), trim)

    # rounded nose + dark canopy
    B(half_egg((3.0, 0, 1.35), (2.3, 1.18, 0.63), 3.0), paint)
    B(half_egg((3.0, 0, 1.95), (1.85, 1.13, 0.75), 3.0), glass)

    # engine hump, mast fairing, intakes, exhausts
    B(loft((-2.5, -2.5, 0.85, 2.62, 3.35), (2.1, 1.5, 0.8, 2.62, 3.3), 0.1), paint)
    B(cyl((0, 0, 3.5), 0.34, 0.4, segs=16), paint)
    for s in (1, -1):
        B(box((1.75, s * 0.45, 3.0), (0.2, 0.55, 0.32), 0.03), trim)
        B(tube((-1.6, s * 0.7, 3.05), (-2.2, s * 1.05, 3.2), 0.16, segs=12), trim)

    # tail: taper, fairing, boom, fin (+accent cap), ventral fin, stabiliser, gearbox, patch
    B(loft((-4.3, -4.3, 0.42, 1.95, 2.6), (-2.2, -2.2, 1.15, 0.8, 2.6), 0.06), paint)
    B(loft((-5.2, -5.2, 0.3, 2.3, 2.62), (-2.4, -2.4, 0.8, 2.55, 3.3), 0.05), paint)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.38, radius2=0.22, depth=5.3,
                          matrix=Matrix.Translation((-6.65, 0, 2.25)) @ Matrix.Rotation(math.radians(-90), 4, "Y"))
    B(bm, paint)  # boom x -4.0..-9.3
    for z0, z1, slot in ((2.15, 3.8, paint), (3.8, 4.1, accent)):
        (b0, f0), (b1, f1) = fin_x(z0), fin_x(z1)
        B(loft((b0, b1, 0.09, z0, z1), (f0, f1, 0.09, z0, z1), 0.03), slot)
    B(loft((-9.65, -9.5, 0.06, 1.75, 2.25), (-9.25, -8.9, 0.06, 1.75, 2.25), 0.02), paint)
    B(box((-7.9, 0, 2.3), (0.6, 2.6, 0.08), 0.025), paint)
    B(cyl((TR_HUB.x, 0.22, TR_HUB.z), 0.14, 0.3, "Y", 12), trim)
    for s in (1, -1):
        B(box((-6.2, s * 0.31, 2.27), (0.5, 0.05, 0.28), 0.01), patch)

    # skids resting on z=0
    for s in (1, -1):
        B(box((0.3, s * 1.35, 0.06), (5.4, 0.14, 0.12), 0.035), trim)
        a = math.radians(35)
        B(box((3.0 + 0.3 * math.cos(a), s * 1.35, 0.06 + 0.3 * math.sin(a)), (0.6, 0.14, 0.12), 0.035,
              rot=Matrix.Rotation(-a, 4, "Y")), trim)
        for x in (2.0, -1.4):
            B(tube((x, s * 1.35, 0.09), (x, s * 0.95, 0.76), 0.06), trim)

    # searchlight under the nose
    B(box((4.1, 0, 0.72), (0.12, 0.12, 0.22), 0.02), trim)
    B(cyl((4.1, 0, 0.5), 0.16, 0.32, "X", 14), trim)
    B(cyl((4.27, 0, 0.5), 0.13, 0.03, "X", 14), lamp)

    # main rotor: shaft, hub, cap, 4 blades at 45 deg (parked)
    rig.add(cyl((0, 0, 3.9), 0.12, 0.6, segs=12), "main_rotor", trim, True)
    rig.add(cyl((0, 0, 4.25), 0.38, 0.22, segs=16), "main_rotor", trim, True)
    rig.add(cyl((0, 0, 4.42), 0.18, 0.14, segs=12), "main_rotor", trim, True)
    for k in range(4):
        t = math.radians(45 + 90 * k)
        d = Vector((math.cos(t), math.sin(t), 0))
        rig.add(box(HUB + d * 3.62 + Vector((0, 0, 0.08)), (6.76, 0.5, 0.07), 0.02,
                    rot=Matrix.Rotation(t, 4, "Z")), "main_rotor", trim, True)

    # tail rotor (left side, +Y): hub + 4 blades in the XZ plane
    rig.add(cyl(TR_HUB, 0.1, 0.12, "Y", 12), "tail_rotor", trim, True)
    for k in range(4):
        r = Matrix.Rotation(math.radians(45 + 90 * k), 4, "Y")
        rig.add(box(TR_HUB + r.to_3x3() @ Vector((0.74, 0, 0)), (1.32, 0.03, 0.17), 0.01, rot=r),
                "tail_rotor", trim, True)

    arm, body = rig.build()
    body.data.set_sharp_from_angle(angle=math.radians(35))
    return arm, body


def main():
    opt = args()
    clear_scene()
    arm, body = build()
    fbx = export_fbx(arm, body, os.path.join(opt["out"], f"SK_veh_{VID}.fbx"))
    rep = check_fbx(fbx)
    v3 = lambda x, y, z: [round(x, 3), round(y, 3), round(z, 3)]
    seats = [{"name": "pilot", "pos": v3(2.55, -0.55, 1.42), "facing": [1, 0, 0]},
             {"name": "copilot", "pos": v3(2.55, 0.55, 1.42), "facing": [1, 0, 0]},
             {"name": "gunner_left", "pos": v3(GUN_X, 0.7, 1.42), "facing": [0, 1, 0]},
             {"name": "gunner_right", "pos": v3(GUN_X, -0.7, 1.42), "facing": [0, -1, 0]}]
    seats += [{"name": f"passenger_{i + 1}", "pos": v3(BENCH_X, y, 1.42), "facing": [1, 0, 0]}
              for i, y in enumerate((0.75, 0.25, -0.25, -0.75))]
    meta = {"id": VID, "kind": "helicopter", "mass_kg": 5000, "wheels": [], "seats": seats,
            "paint_slot": f"M_Paint_{PAINT}", "accent_slot": f"M_Accent_{ACCENT}", "patch_slot": f"M_Patch_{PATCH}",
            "colour_variants": [PAINT, CIV_PAINT, CIV_ACCENT, ACCENT, "2E3B4E"],
            "schemes": {"faction": {"paint": PAINT, "accent": ACCENT, "patch": PATCH},
                        "civilian": {"paint": CIV_PAINT, "accent": CIV_ACCENT, "patch": CIV_PAINT}},
            "sockets": {"spotlight": v3(4.29, 0, 0.5),
                        "gunner_left_mount": v3(GUN_X, 1.28, GUN_Z), "gunner_right_mount": v3(GUN_X, -1.28, GUN_Z),
                        "rotor_radius": R_MAIN, "tail_rotor_radius": R_TAIL},
            "origin": "ground under the main rotor hub", "seat_pos": "seat surface under the pelvis"}
    write_meta(os.path.join(opt["out"], f"SK_veh_{VID}.json"), meta)
    renders = render_views(os.path.join(opt["renders"], f"veh_{VID}"), [body])
    print("VEH", json.dumps({"id": VID, "fbx": fbx, "renders": renders, **rep}))


main()
