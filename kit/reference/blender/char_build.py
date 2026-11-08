"""Procedural stylized characters rigged to UE5-Mannequin bone names.

Reads Data/characters/roster.json. Every character is one skinned mesh + one armature
(root, pelvis, spine_01..05, neck_01..02, head, clavicle/upperarm/lowerarm/hand, thigh/calf/foot/ball).

Live (Blender MCP):  exec(open(PATH).read(), {"__file__": PATH, "__name__": "char_build"}); build_all()
Headless:            blender -b --factory-startup -P char_build.py -- [--only a,b] [--render out.png] [--export dir]
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
ROSTER = os.path.join(ROOT, "Data", "characters", "roster.json")
ARM = math.radians(45)  # A-pose: arm angle from vertical
SCENE = "Characters"

# name, head joint, tail joint, parent  (parents listed before children)
# UE5 Manny layout (spine_01..05, neck_01..02) so UE's auto-retarget maps Lyra animations 1:1
BONES = [("root", "root", None, None), ("pelvis", "pelvis", "spine_01", "root"),
         ("spine_01", "spine_01", "spine_02", "pelvis"), ("spine_02", "spine_02", "spine_03", "spine_01"),
         ("spine_03", "spine_03", "spine_04", "spine_02"), ("spine_04", "spine_04", "spine_05", "spine_03"),
         ("spine_05", "spine_05", "neck_01", "spine_04"), ("neck_01", "neck_01", "neck_02", "spine_05"),
         ("neck_02", "neck_02", "head", "neck_01"), ("head", "head", "head_end", "neck_02")]
for _s in ("l", "r"):
    BONES += [(f"clavicle_{_s}", f"clavicle_{_s}", f"upperarm_{_s}", "spine_05"),
              (f"upperarm_{_s}", f"upperarm_{_s}", f"lowerarm_{_s}", f"clavicle_{_s}"),
              (f"lowerarm_{_s}", f"lowerarm_{_s}", f"hand_{_s}", f"upperarm_{_s}"),
              (f"hand_{_s}", f"hand_{_s}", f"hand_end_{_s}", f"lowerarm_{_s}"),
              (f"thigh_{_s}", f"thigh_{_s}", f"calf_{_s}", "pelvis"),
              (f"calf_{_s}", f"calf_{_s}", f"foot_{_s}", f"thigh_{_s}"),
              (f"foot_{_s}", f"foot_{_s}", f"ball_{_s}", f"calf_{_s}"),
              (f"ball_{_s}", f"ball_{_s}", f"ball_end_{_s}", f"foot_{_s}")]
DEFORM = [b[0] for b in BONES if b[0] != "root"]
SPINE = ["pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05"]
# part tag -> bones allowed to influence it (None = any deform bone)
PARTS = {"body": None, "head": ["head"], "hand_l": ["hand_l"], "hand_r": ["hand_r"],
         "shoe_l": ["foot_l", "ball_l"], "shoe_r": ["foot_r", "ball_r"], "torso": SPINE,
         "knee_l": ["calf_l"], "knee_r": ["calf_r"], "patch_l": ["upperarm_l"]}
PART_ID = {k: i for i, k in enumerate(PARTS)}


def lin(hexv):
    c = [int(hexv[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


def material(role, hexv, rough=0.75):
    name = f"M_{role}_{hexv.upper()}"
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True  # deprecated in 5.x (always on), harmless if ignored
    except Exception:
        pass
    m.diffuse_color = lin(hexv)
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = m.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        out = next(n for n in m.node_tree.nodes if n.type == "OUTPUT_MATERIAL")
        m.node_tree.links.new(bsdf.outputs[0], out.inputs[0])
    bsdf.inputs["Base Color"].default_value = lin(hexv)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def joints(ch):
    s = ch.get("height", 1.75) / 1.75
    sw, hw = ch.get("shoulders", 1.0), ch.get("hips", 1.0)
    v = lambda x, y, z: Vector((x, y, z)) * s
    J = {"root": v(0, 0, 0), "pelvis": v(0, 0, 0.97), "spine_01": v(0, 0, 1.05), "spine_02": v(0, 0, 1.12),
         "spine_03": v(0, 0, 1.20), "spine_04": v(0, 0, 1.28), "spine_05": v(0, 0, 1.36), "neck_01": v(0, 0, 1.46),
         "neck_02": v(0, 0, 1.52), "head": v(0, 0, 1.58), "head_end": v(0, 0, 1.79)}
    for side, sx in (("l", 1), ("r", -1)):
        sh = Vector((sx * 0.17 * sw, 0, 1.415))
        d = Vector((sx * math.sin(ARM), 0, -math.cos(ARM)))
        J[f"clavicle_{side}"] = v(sx * 0.03, 0, 1.43)
        J[f"upperarm_{side}"] = sh * s
        J[f"lowerarm_{side}"] = (sh + d * 0.29) * s
        J[f"hand_{side}"] = (sh + d * 0.55) * s
        J[f"hand_end_{side}"] = (sh + d * 0.71) * s
        J[f"thigh_{side}"] = v(sx * 0.095 * hw, 0, 0.92)
        J[f"calf_{side}"] = v(sx * 0.10 * hw, -0.005, 0.52)
        J[f"foot_{side}"] = v(sx * 0.10 * hw, 0.015, 0.10)
        J[f"ball_{side}"] = v(sx * 0.10 * hw, -0.10, 0.025)
        J[f"ball_end_{side}"] = v(sx * 0.10 * hw, -0.17, 0.025)
    return J, s


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length, t


def nearest_bones(p, segs, allowed, k=2):
    ds = sorted((seg_dist(p, *segs[b])[0], b) for b in (allowed or DEFORM))
    return ds[:k]


# ---------------------------------------------------------------- geometry helpers
def merge(dst, src, part, mat_fn, layer, smooth=True):
    vmap = {}
    for v in src.verts:
        nv = dst.verts.new(v.co)
        nv[layer] = PART_ID[part]
        vmap[v] = nv
    for f in src.faces:
        try:
            nf = dst.faces.new([vmap[v] for v in f.verts])
        except ValueError:
            continue
        nf.material_index = mat_fn(f) if callable(mat_fn) else mat_fn
        nf.smooth = smooth
    src.free()


def prim(kind, center, scale, rot=None, cut=None, segs=(18, 10), bevel=0.0):
    bm = bmesh.new()
    m = Matrix.Translation(center) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*scale, 1.0))
    if kind == "sphere":
        bmesh.ops.create_uvsphere(bm, u_segments=segs[0], v_segments=segs[1], radius=1.0, matrix=m)
    elif kind == "cyl":
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs[0], radius1=1.0, radius2=1.0, depth=1.0, matrix=m)
    else:
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        if bevel:
            bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:], offset=bevel, segments=2,
                            affect="EDGES", profile=0.5)
    if cut:  # keep the side the plane normal points to
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                               plane_co=cut[0], plane_no=cut[1], clear_inner=True)
    return bm


def skin_body(ch, J, s):
    """Vertex skeleton + Skin + Subsurf modifiers -> evaluated mesh (bmesh)."""
    sw, hw, g = ch.get("shoulders", 1.0), ch.get("hips", 1.0), ch.get("girth", 1.0)
    V, R, E = [], [], []

    def add(co, r):
        V.append(Vector(co) * s)
        R.append((r[0] * g * s, r[1] * g * s))
        return len(V) - 1

    # subsurf shrinks skin radii ~20%, so these are deliberately chunky
    p0 = add((0, 0, 0.95), (0.175 * hw, 0.125))
    s1 = add((0, 0, 1.07), (0.16, 0.115)); E.append((p0, s1))
    s2 = add((0, 0, 1.19), (0.17, 0.12)); E.append((s1, s2))
    s3 = add((0, 0, 1.31), (0.185 * sw, 0.125)); E.append((s2, s3))
    c = add((0, 0, 1.40), (0.175 * sw, 0.115)); E.append((s3, c))
    n0 = add((0, 0, 1.48), (0.06, 0.06)); E.append((c, n0))
    n1 = add((0, 0, 1.58), (0.055, 0.055)); E.append((n0, n1))
    for sx in (1, -1):
        shv = Vector((sx * 0.17 * sw, 0, 1.415))
        d = Vector((sx * math.sin(ARM), 0, -math.cos(ARM)))
        sh = add(shv, (0.068, 0.068)); E.append((c, sh))
        el = add(shv + d * 0.29, (0.054, 0.054)); E.append((sh, el))
        wr = add(shv + d * 0.56, (0.04, 0.038)); E.append((el, wr))
        hp = add((sx * 0.095 * hw, 0, 0.90), (0.105 * hw, 0.105)); E.append((p0, hp))
        kn = add((sx * 0.10 * hw, -0.005, 0.52), (0.07, 0.07)); E.append((hp, kn))
        an = add((sx * 0.10 * hw, 0.015, 0.075), (0.05, 0.05)); E.append((kn, an))

    me = bpy.data.meshes.new("_skin_tmp")
    me.from_pydata([tuple(v) for v in V], E, [])
    ob = bpy.data.objects.new("_skin_tmp", me)
    bpy.context.scene.collection.objects.link(ob)
    try:
        sk = ob.modifiers.new("Skin", "SKIN")
        sk.use_smooth_shade = True
        sk.use_x_symmetry = True
        sk.branch_smoothing = 0.6
        for i, r in enumerate(R):
            me.skin_vertices[0].data[i].radius = r
            me.skin_vertices[0].data[i].use_root = (i == p0)
        sub = ob.modifiers.new("Sub", "SUBSURF")
        sub.levels = sub.render_levels = 2
        dg = bpy.context.evaluated_depsgraph_get()
        dg.update()
        ev = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        bm = bmesh.new()
        bm.from_mesh(ev)
        bpy.data.meshes.remove(ev)
    finally:
        bpy.data.objects.remove(ob)
        bpy.data.meshes.remove(me)
    return bm


# ---------------------------------------------------------------- character
def build(ch, fac):
    cid = ch["id"]
    J, s = joints(ch)
    segs = {b: (J[h], J[t]) for b, h, t, _ in BONES if t}
    soldier = ch.get("uniform", False)
    col_top = fac["uniform"] if soldier else ch.get("top", "777777")
    col_bot = fac["uniform"] if soldier else ch.get("bottom", "444444")
    col_shoe = fac["boots"] if soldier else ch.get("shoes", "222222")
    sleeve = 0.55 if soldier else ch.get("sleeve", 0.55)
    shorts = ch.get("shorts", False)
    sw, hw = ch.get("shoulders", 1.0), ch.get("hips", 1.0)

    # collection (rebuild = replace only our own collection)
    cname = f"CHR_{cid}"
    old = bpy.data.collections.get(cname)
    if old:
        for o in list(old.objects):
            data = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if data is not None and data.users == 0:  # drop the mesh/armature too, so names stay suffix-free
                (bpy.data.meshes if isinstance(data, bpy.types.Mesh) else bpy.data.armatures).remove(data)
        bpy.data.collections.remove(old)
    col = bpy.data.collections.new(cname)
    bpy.context.scene.collection.children.link(col)

    # materials, appended on first use
    me = bpy.data.meshes.new(f"SK_{cid}")
    slots = {}

    def mi(role, hexv, rough=0.75):
        key = (role, hexv)
        if key not in slots:
            slots[key] = len(me.materials)
            me.materials.append(material(role, hexv, rough))
        return slots[key]

    skin = mi("Skin", ch["skin"], 0.6)
    bm = bmesh.new()
    layer = bm.verts.layers.int.new("part")

    # body with clothing regions picked by nearest bone
    arm_dir = {sd: (J[f"hand_{sd}"] - J[f"upperarm_{sd}"]).normalized() for sd in "lr"}

    def body_mat(f):
        p = f.calc_center_median()
        b = nearest_bones(p, segs, None, 1)[0][1]
        z = p.z / s
        if z > 1.49:
            return skin
        if b.startswith(("upperarm", "lowerarm", "hand")) and abs(p.x) > 0.17 * sw * s:  # sleeve edge = cut planes
            t = (p - J[f"upperarm_{b[-1]}"]).dot(arm_dir[b[-1]]) / s
            return mi("Top", col_top) if t < sleeve else skin
        if z > 0.99:  # waist edge = the cut plane at z == 0.99
            return mi("Top", col_top)
        return skin if (shorts and z < 0.55) else mi("Bottom", col_bot)

    # straight hem lines: cut the body along each clothing boundary before colouring faces
    body = skin_body(ch, J, s)
    up = Vector((0, 0, 1))
    cuts = [(up * 0.99 * s, up), (up * 1.49 * s, up)] + ([(up * 0.55 * s, up)] if shorts else [])
    if sleeve < 0.55:
        cuts += [(J[f"upperarm_{sd}"] + arm_dir[sd] * sleeve * s, arm_dir[sd]) for sd in "lr"]
        cuts += [(Vector((sx * 0.17 * sw * s, 0, 0)), Vector((1, 0, 0))) for sx in (1, -1)]  # armpit line
    for co, no in cuts:
        bmesh.ops.bisect_plane(body, geom=body.verts[:] + body.edges[:] + body.faces[:], plane_co=co, plane_no=no)
    merge(bm, body, "body", body_mat, layer)

    hk = ch.get("head", 1.1)  # head size; face/hair offsets scale with it
    hc = Vector((0, 0, 1.58 + 0.085 * hk)) * s
    hs = Vector((0.088, 0.098, 0.112)) * s * hk
    merge(bm, prim("sphere", hc, hs, segs=(20, 12)), "head", skin, layer)
    dark = mi("Detail", "1A1A1A", 0.4)
    for sx in (1, -1):
        merge(bm, prim("sphere", hc + Vector((sx * 0.034, -0.088, 0.016)) * s * hk, Vector((0.012, 0.01, 0.013)) * s * hk,
                       segs=(8, 6)), "head", dark, layer)
        merge(bm, prim("sphere", hc + Vector((sx * 0.092, 0.004, 0.0)) * s * hk, Vector((0.012, 0.024, 0.03)) * s * hk,
                       segs=(8, 6)), "head", skin, layer)
        brow = mi("Hair", ch.get("hair", "222222"))
        merge(bm, prim("cube", hc + Vector((sx * 0.034, -0.083, 0.044)) * s * hk, Vector((0.03, 0.01, 0.007)) * s * hk),
              "head", brow, layer)
    merge(bm, prim("sphere", hc + Vector((0, -0.099, -0.006)) * s * hk, Vector((0.014, 0.02, 0.022)) * s * hk, segs=(8, 6)),
          "head", skin, layer)
    merge(bm, prim("cube", hc + Vector((0, -0.088, -0.047)) * s * hk, Vector((0.03, 0.01, 0.006)) * s * hk),
          "head", mi("Lips", "7A3B30", 0.5), layer)

    # hair / hats
    hair = mi("Hair", ch.get("hair", "222222"))
    style = ch.get("hair_style", "short")
    tilt = Vector((0, 0.45, 1)).normalized()
    if style in ("short", "long", "buzz"):
        k = 1.025 if style == "buzz" else 1.07
        merge(bm, prim("sphere", hc + Vector((0, 0.008, 0.012)) * s * hk, hs * k, segs=(20, 12),
                       cut=(hc + Vector((0, 0, 0.018)) * s * hk, tilt)), "head", hair, layer)
    if style == "long":
        merge(bm, prim("sphere", hc + Vector((0, 0.058, -0.075)) * s * hk, Vector((0.092, 0.05, 0.14)) * s * hk),
              "head", hair, layer)
    if ch.get("beard"):
        bc = mi("Beard", ch.get("beard_color", ch.get("hair", "222222")))
        merge(bm, prim("sphere", hc + Vector((0, -0.03, -0.055)) * s * hk, Vector((0.082, 0.072, 0.075)) * s * hk,
                       cut=(hc + Vector((0, 0, -0.038)) * s * hk, Vector((0, 0.35, -1)).normalized())), "head", bc, layer)
    hat = ch.get("hat")
    hat_col = ch.get("hat_color", fac["helmet"])
    if hat == "helmet":
        hm = mi("Helmet", fac["helmet"], 0.85)
        merge(bm, prim("sphere", hc + Vector((0, 0.008, 0.02)) * s * hk, hs * 1.24, segs=(20, 12),
                       cut=(hc + Vector((0, 0, 0.028)) * s * hk, Vector((0, 0.55, 1)).normalized())), "head", hm, layer)
    elif hat in ("cap", "cap_back"):
        cm = mi("Hat", hat_col)
        merge(bm, prim("sphere", hc + Vector((0, 0, 0.02)) * s * hk, hs * 1.1, segs=(20, 12),
                       cut=(hc + Vector((0, 0, 0.035)) * s * hk, Vector((0, 0, 1)))), "head", cm, layer)
        fy = 0.11 if hat == "cap_back" else -0.11
        pitch = Matrix.Rotation(math.radians(14 if fy < 0 else -14), 4, "X")  # brim tips down, readable from front
        merge(bm, prim("cyl", hc + Vector((0, fy, 0.03)) * s * hk, Vector((0.078, 0.075, 0.012)) * s * hk,
                       rot=pitch, segs=(16, 1)), "head", cm, layer)
    elif hat == "beret":
        merge(bm, prim("sphere", hc + Vector((0.018, 0.005, 0.098)) * s * hk, Vector((0.112, 0.112, 0.036)) * s * hk,
                       rot=Matrix.Rotation(math.radians(-14), 4, "Y")), "head", mi("Hat", hat_col), layer)
    elif hat == "boonie":
        bmat = mi("Hat", hat_col)
        merge(bm, prim("sphere", hc + Vector((0, 0, 0.03)) * s * hk, hs * 1.12, segs=(20, 12),
                       cut=(hc + Vector((0, 0, 0.03)) * s * hk, Vector((0, 0, 1)))), "head", bmat, layer)
        merge(bm, prim("cyl", hc + Vector((0, 0, 0.035)) * s * hk, Vector((0.16, 0.16, 0.008)) * s * hk, segs=(24, 1)),
              "head", bmat, layer)
    if ch.get("glasses"):
        for sx in (1, -1):
            merge(bm, prim("cyl", hc + Vector((sx * 0.034, -0.095, 0.016)) * s * hk, Vector((0.022, 0.022, 0.006)) * s * hk,
                           rot=Matrix.Rotation(math.radians(90), 4, "X"), segs=(14, 1)), "head", dark, layer)
        merge(bm, prim("cube", hc + Vector((0, -0.097, 0.018)) * s * hk, Vector((0.03, 0.006, 0.005)) * s * hk),
              "head", dark, layer)

    # hands + shoes
    for side, sx in (("l", 1), ("r", -1)):
        d = (J[f"hand_end_{side}"] - J[f"hand_{side}"]).normalized()
        merge(bm, prim("sphere", J[f"hand_{side}"] + d * 0.055 * s, Vector((0.032, 0.05, 0.085)) * s,
                       rot=Matrix.Rotation(-sx * ARM, 4, "Y"), segs=(12, 8)), f"hand_{side}", skin, layer)
        boot = 0.14 if soldier else 0.1
        merge(bm, prim("cube", Vector((sx * 0.10 * hw, -0.055, boot / 2)) * s, Vector((0.105, 0.255, boot)) * s,
                       bevel=0.018 * s), f"shoe_{side}", mi("Shoes", col_shoe, 0.6), layer, smooth=False)

    # gear
    g = ch.get("girth", 1.0)
    if ch.get("vest"):
        vm = mi("Vest", fac["vest"], 0.9)
        merge(bm, prim("cube", Vector((0, 0, 1.235)) * s, Vector((0.37 * sw * g, 0.255 * g, 0.31)) * s,
                       bevel=0.03 * s), "torso", vm, layer, smooth=False)
        for px in (-0.09, 0.0, 0.09):
            merge(bm, prim("cube", Vector((px * sw, -0.135 * g, 1.15)) * s, Vector((0.07, 0.04, 0.085)) * s,
                           bevel=0.008 * s), "torso", vm, layer, smooth=False)
    if ch.get("belt") or soldier:
        merge(bm, prim("cyl", Vector((0, 0, 0.985)) * s, Vector((0.165 * hw * g, 0.118 * g, 0.045)) * s, segs=(20, 1)),
              "torso", mi("Belt", "2A2620", 0.6), layer)
    if ch.get("backpack"):
        merge(bm, prim("cube", Vector((0, 0.15 * g + 0.03, 1.25)) * s, Vector((0.27, 0.13, 0.34)) * s,
                       bevel=0.025 * s), "torso", mi("Pack", ch["backpack"], 0.85), layer, smooth=False)
    if ch.get("kneepads"):
        for side, sx in (("l", 1), ("r", -1)):
            merge(bm, prim("cube", Vector((sx * 0.10 * hw, -0.06 * g, 0.50)) * s, Vector((0.075, 0.035, 0.085)) * s,
                           bevel=0.01 * s), f"knee_{side}", mi("Vest", fac["vest"], 0.9), layer, smooth=False)
    if ch.get("patch"):
        n = Vector((math.cos(ARM), 0, math.sin(ARM)))
        c = J["upperarm_l"] + (J["lowerarm_l"] - J["upperarm_l"]) * 0.32 + n * 0.05 * s * g
        merge(bm, prim("cube", c, Vector((0.006, 0.05, 0.055)) * s, rot=Matrix.Rotation(-ARM, 4, "Y")),
              "patch_l", mi("Patch", fac["patch"], 0.5), layer, smooth=False)

    bm.to_mesh(me)
    bm.free()
    body = bpy.data.objects.new(f"SK_{cid}", me)
    col.objects.link(body)

    # armature (edit bones need edit mode)
    ad = bpy.data.armatures.new(f"ARM_{cid}")
    arm = bpy.data.objects.new(f"ARM_{cid}", ad)
    col.objects.link(arm)
    ad.display_type = "STICK"
    arm.show_in_front = True
    vl = bpy.context.view_layer
    vl.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = ad.edit_bones
    for name, hk, tk, parent in BONES:
        b = eb.new(name)
        b.head = J[hk]
        b.tail = J[tk] if tk else J[hk] + Vector((0, 0.25 * s, 0))
        b.roll = 0.0
        if parent:
            b.parent = eb[parent]
            b.use_connect = (b.head - eb[parent].tail).length < 1e-6
    eb["root"].use_deform = False
    bpy.ops.object.mode_set(mode="OBJECT")

    # weights: nearest 2 allowed bone segments, w ~ 1/d^4
    groups = {b: body.vertex_groups.new(name=b) for b in DEFORM}
    part_of = {i: k for k, i in PART_ID.items()}
    attr = me.attributes["part"].data
    for v in me.vertices:
        allowed = PARTS[part_of[attr[v.index].value]]
        near = nearest_bones(v.co, segs, allowed, 1 if allowed and len(allowed) == 1 else 2)
        ws = [(b, 1.0 / (d ** 4 + 1e-9)) for d, b in near]
        tot = sum(w for _, w in ws)
        for b, w in ws:
            if w / tot > 0.01:
                groups[b].add([v.index], w / tot, "REPLACE")
    body.parent = arm
    body.modifiers.new("Armature", "ARMATURE").object = arm
    return arm, body


def ensure_scene():
    scn = bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)
    win = bpy.context.window or (bpy.context.window_manager.windows[0] if bpy.context.window_manager.windows else None)
    if win and win.scene != scn:
        win.scene = scn
    scn.unit_settings.system = "METRIC"
    scn.unit_settings.scale_length = 1.0
    return scn


def roster():
    with open(ROSTER, encoding="utf-8") as f:
        return json.load(f)


def build_all(only=None, spacing=1.45):
    data = roster()
    chars = [c for c in data["characters"] if not only or c["id"] in only]
    built = []
    for i, ch in enumerate(chars):
        arm, body = build(ch, data["faction"])
        arm.location.x = (i - (len(chars) - 1) / 2) * spacing
        built.append({"id": ch["id"], "verts": len(body.data.vertices), "tris": sum(len(p.vertices) - 2 for p in body.data.polygons),
                      "materials": len(body.data.materials), "bones": len(arm.data.bones)})
    return built


# ---------------------------------------------------------------- render + export
def stage(width):
    scn = bpy.context.scene
    col = bpy.data.collections.get("STAGE") or bpy.data.collections.new("STAGE")
    if col.name not in scn.collection.children:
        scn.collection.children.link(col)
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    cam = bpy.data.objects.new("CAM_lineup", bpy.data.cameras.new("CAM_lineup"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = width + 0.8
    cam.location = (0, -12, 1.0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    col.objects.link(cam)
    scn.camera = cam
    sun = bpy.data.objects.new("SUN", bpy.data.lights.new("SUN", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(55), math.radians(10), math.radians(-35))
    col.objects.link(sun)
    fill = bpy.data.objects.new("FILL", bpy.data.lights.new("FILL", "AREA"))
    fill.data.energy = 600
    fill.data.size = 6
    fill.location = (3, -6, 3)
    fill.rotation_euler = (math.radians(60), 0, math.radians(25))
    col.objects.link(fill)
    fme = bpy.data.meshes.new("FLOOR")
    bmf = bmesh.new()
    bmesh.ops.create_grid(bmf, x_segments=1, y_segments=1, size=30)
    bmf.to_mesh(fme)
    bmf.free()
    floor = bpy.data.objects.new("FLOOR", fme)
    fme.materials.append(material("Floor", "C8C2B4", 0.9))
    col.objects.link(floor)
    if scn.world is None:
        scn.world = bpy.data.worlds.new("World")
    scn.world.color = (0.55, 0.6, 0.68)
    try:
        scn.world.use_nodes = True
        bg = next(n for n in scn.world.node_tree.nodes if n.type == "BACKGROUND")
        bg.inputs[0].default_value = (0.55, 0.62, 0.72, 1)
        bg.inputs[1].default_value = 0.8
    except Exception:
        pass


def render(path, res_x=2400):
    scn = bpy.context.scene
    arms = [o for o in scn.objects if o.name.startswith("ARM_")]
    width = max(abs(o.location.x) for o in arms) * 2 + 0.8 if arms else 2
    stage(width)
    scn.render.engine = "BLENDER_EEVEE"
    scn.render.resolution_x = res_x
    scn.render.resolution_y = int(res_x * 2.4 / (width + 0.8))
    scn.render.film_transparent = False
    scn.render.image_settings.file_format = "PNG"
    bpy.data.objects["CAM_lineup"].location.z = 1.0
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def render_34(path, ids, res=(2000, 1100)):
    """3/4 perspective shot of a few characters (call after render(), which builds the stage)."""
    scn = bpy.context.scene
    arms = [bpy.data.objects[f"ARM_{i}"] for i in ids]
    target = sum((a.location for a in arms), Vector()) / len(arms) + Vector((0, 0, 1.05))
    span = max(a.location.x for a in arms) - min(a.location.x for a in arms)
    cam = bpy.data.objects.new("CAM_34", bpy.data.cameras.new("CAM_34"))
    bpy.data.collections["STAGE"].objects.link(cam)
    cam.data.lens = 50
    cam.location = target + Vector((span * 0.45 + 1.2, -(span * 0.9 + 3.5), 0.95))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    prev, scn.camera = scn.camera, cam
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    scn.camera = prev
    return path


def _scale_rig(arm, body, k):
    # Armature.transform scales every bone once (editing head/tail per bone double-scales connected children)
    body.data.transform(Matrix.Scale(k, 4))
    arm.data.transform(Matrix.Scale(k, 4))


def export_fbx_cm(arm, body, path, bone_axes=("Y", "X")):
    """Unreal wants centimetre numbers and no scale on bones (the IK retargeter ignores bone scale).
    Bake x100 into mesh + bones, export with 1 Blender unit = 1 cm, then undo."""
    scn = bpy.context.scene
    old_unit = scn.unit_settings.scale_length
    name, loc = arm.name, arm.location.copy()
    arm.location = (0, 0, 0)
    _scale_rig(arm, body, 100.0)
    scn.unit_settings.scale_length = 0.01
    arm.name = "Armature"  # UE then doesn't add an extra root bone
    try:
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        arm.select_set(True)
        body.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={"ARMATURE", "MESH"},
                                 apply_unit_scale=True, apply_scale_options="FBX_SCALE_UNITS",
                                 add_leaf_bones=False, bake_anim=False, use_armature_deform_only=True,
                                 mesh_smooth_type="FACE", armature_nodetype="NULL",
                                 primary_bone_axis=bone_axes[0], secondary_bone_axis=bone_axes[1])
    finally:
        arm.name = name
        scn.unit_settings.scale_length = old_unit
        _scale_rig(arm, body, 0.01)
        arm.location = loc
    return path


def export(cid, outdir):
    arm, body = bpy.data.objects[f"ARM_{cid}"], bpy.data.objects[f"SK_{cid}"]
    os.makedirs(outdir, exist_ok=True)
    return export_fbx_cm(arm, body, os.path.join(outdir, f"SK_{cid}.fbx"))


def export_all(outdir):
    return [export(c["id"], outdir) for c in roster()["characters"] if f"ARM_{c['id']}" in bpy.data.objects]


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = {a.lstrip("-"): (argv[i + 1] if i + 1 < len(argv) else "") for i, a in enumerate(argv) if a.startswith("--")}
    if bpy.app.background:
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    else:
        ensure_scene()
    print(json.dumps(build_all(opt["only"].split(",") if opt.get("only") else None)))
    if opt.get("render"):
        render(opt["render"])
    if opt.get("export"):
        print(export_all(opt["export"]))
