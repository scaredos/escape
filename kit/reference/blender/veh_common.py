"""Shared helpers for vehicle scripts (veh_*.py). Headless only:

    blender -b --factory-startup -P Tools/blender/veh_<x>.py -- --out <Art/out> --renders <Art/renders>

Conventions (UE Chaos Vehicles): metres, vehicle faces +X (= UE forward), Z up, origin on the ground
under the vehicle centre. Every mesh part is rigid: weighted 100% to exactly one bone.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from char_build import lin, material, prim, export_fbx_cm  # noqa: E402  (reuse)

__all__ = ["Vector", "Matrix", "math", "lin", "material", "prim", "args", "clear_scene", "Rig",
           "export_fbx", "check_fbx", "write_meta", "render_views", "wheel"]


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = {a.lstrip("-"): (argv[i + 1] if i + 1 < len(argv) else "") for i, a in enumerate(argv) if a.startswith("--")}
    root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    opt.setdefault("out", os.path.join(root, "Art", "out"))
    opt.setdefault("renders", os.path.join(root, "Art", "renders"))
    os.makedirs(opt["out"], exist_ok=True)
    os.makedirs(opt["renders"], exist_ok=True)
    return opt


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.cameras, bpy.data.lights, bpy.data.materials):
        for d in [d for d in coll if d.users == 0]:
            coll.remove(d)


class Rig:
    """Collects rigid parts, then builds one skinned mesh + armature named SK_veh_<id> / ARM_veh_<id>."""

    def __init__(self, vid):
        self.vid = vid
        self.bm = bmesh.new()
        self.layer = self.bm.verts.layers.int.new("bone")
        self.bones = []  # (name, head, tail, parent)
        self.slots, self.mats = {}, []

    def bone(self, name, head, tail, parent=None):
        self.bones.append((name, Vector(head), Vector(tail), parent))
        return name

    def mat(self, role, hexv, rough=0.6):
        key = (role, hexv.upper())
        if key not in self.slots:
            self.slots[key] = len(self.mats)
            self.mats.append(material(role, hexv, rough))
        return self.slots[key]

    def add(self, src, bone, mat, smooth=False):
        """Merge bmesh `src` (consumed) as a rigid part of `bone` with material slot `mat`."""
        bi = [b[0] for b in self.bones].index(bone)
        vmap = {}
        for v in src.verts:
            nv = self.bm.verts.new(v.co)
            nv[self.layer] = bi
            vmap[v] = nv
        for f in src.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = mat
            nf.smooth = smooth
        src.free()

    def build(self):
        me = bpy.data.meshes.new(f"SK_veh_{self.vid}")
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        col = bpy.context.scene.collection
        body = bpy.data.objects.new(f"SK_veh_{self.vid}", me)
        col.objects.link(body)
        ad = bpy.data.armatures.new(f"ARM_veh_{self.vid}")
        arm = bpy.data.objects.new(f"ARM_veh_{self.vid}", ad)
        col.objects.link(arm)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode="EDIT")
        for n, h, t, p in self.bones:
            b = ad.edit_bones.new(n)
            b.head, b.tail, b.roll = h, t, 0.0
            if p:
                b.parent = ad.edit_bones[p]
        bpy.ops.object.mode_set(mode="OBJECT")
        groups = [body.vertex_groups.new(name=n) for n, _, _, _ in self.bones]
        data = me.attributes["bone"].data
        for v in me.vertices:
            groups[data[v.index].value].add([v.index], 1.0, "REPLACE")
        body.parent = arm
        body.modifiers.new("Armature", "ARMATURE").object = arm
        return arm, body


def wheel(center, radius, width, segs=20, axis="Y"):
    """Cylinder bmesh lying along the axle (Y by default)."""
    rot = Matrix.Rotation(math.radians(90), 4, "X") if axis == "Y" else Matrix.Identity(4)
    return prim("cyl", Vector(center), Vector((radius, radius, width)), rot=rot, segs=(segs, 1))


def export_fbx(arm, body, path):
    """Same as the characters (centimetre numbers, no bone scale, armature renamed 'Armature'), but bone axes X/-Y:
    a bone pointing along Blender +X then gets an identity frame in Unreal. Chaos takes the vehicle's forward axis
    from the chassis body's bone frame; with the character axes (Y/X) the cars drove sideways."""
    return export_fbx_cm(arm, body, path, bone_axes=("X", "-Y"))


def check_fbx(path):
    """Re-import into the current scene, report what UE will see, then remove the import."""
    before = set(bpy.data.objects)
    mats_before = set(bpy.data.materials)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    mesh = next(o for o in new if o.type == "MESH")
    bpy.context.view_layer.update()
    s = arm.matrix_world.to_scale()
    dims = [round(mesh.dimensions[i] * mesh.matrix_world.to_scale()[i], 3) for i in range(3)]
    rep = {"bones": [b.name for b in arm.data.bones],
           "roots": [b.name for b in arm.data.bones if b.parent is None],
           "armature_scale": [round(x, 3) for x in s],
           "dims_m_xyz": dims,
           "bone_heads_m": {b.name: [round(c, 3) for c in (arm.matrix_world @ b.head_local)] for b in arm.data.bones},
           "unweighted_verts": sum(1 for v in mesh.data.vertices if not v.groups),
           "tris": sum(len(p.vertices) - 2 for p in mesh.data.polygons),
           "materials": len(mesh.data.materials)}
    for o in new:
        d = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if d is not None and d.users == 0:
            (bpy.data.meshes if isinstance(d, bpy.types.Mesh) else bpy.data.armatures).remove(d)
    for m in [m for m in bpy.data.materials if m not in mats_before and m.users == 0]:
        bpy.data.materials.remove(m)
    return rep


def write_meta(path, meta):
    """Sidecar JSON for the UE import script (wheel radius/width/bone, seats, mass, ...)."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    return path


def _stage():
    for o in [o for o in bpy.data.objects if o.name.startswith("STAGE_")]:
        bpy.data.objects.remove(o, do_unlink=True)
    col = bpy.context.scene.collection
    sun = bpy.data.objects.new("STAGE_sun", bpy.data.lights.new("STAGE_sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-30))
    col.objects.link(sun)
    fme = bpy.data.meshes.new("STAGE_floor")
    b = bmesh.new()
    bmesh.ops.create_grid(b, x_segments=1, y_segments=1, size=200)
    b.to_mesh(fme)
    b.free()
    fme.materials.append(material("Floor", "C8C2B4", 0.9))
    col.objects.link(bpy.data.objects.new("STAGE_floor", fme))
    scn = bpy.context.scene
    if scn.world is None:
        scn.world = bpy.data.worlds.new("World")
    try:
        bg = next(n for n in scn.world.node_tree.nodes if n.type == "BACKGROUND")
        bg.inputs[0].default_value = (0.55, 0.62, 0.72, 1)
        bg.inputs[1].default_value = 0.9
    except Exception:
        scn.world.color = (0.55, 0.62, 0.72)
    scn.render.engine = "BLENDER_EEVEE"
    scn.render.image_settings.file_format = "PNG"


def _bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def _shoot(cam, path, res):
    scn = bpy.context.scene
    scn.camera = cam
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def render_views(prefix, objs, res=(1600, 1000)):
    """prefix_34.png (front 3/4 perspective) and prefix_side.png (left side, ortho). Returns both paths."""
    _stage()
    lo, hi = _bbox(objs)
    c, size = (lo + hi) / 2, (hi - lo)
    big = max(size)
    col = bpy.context.scene.collection
    cam = bpy.data.objects.new("STAGE_cam34", bpy.data.cameras.new("STAGE_cam34"))
    col.objects.link(cam)
    cam.data.lens = 50
    cam.location = c + Vector((1.15, -1.0, 0.55)).normalized() * big * 2.1
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    side = bpy.data.objects.new("STAGE_camside", bpy.data.cameras.new("STAGE_camside"))
    col.objects.link(side)
    side.data.type = "ORTHO"
    side.data.ortho_scale = max(size.x, size.z * res[0] / res[1]) * 1.15
    side.location = (c.x, lo.y - 30, c.z)
    side.rotation_euler = (math.radians(90), 0, 0)
    return [_shoot(cam, prefix + "_34.png", res), _shoot(side, prefix + "_side.png", res)]
