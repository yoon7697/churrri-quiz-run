"""Optional compatibility sprites baked from the same original GLB for CPU-only browsers."""
import bpy,math
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'relay-rabbit.glb'))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=False;scene.render.film_transparent=True
scene.world=bpy.data.worlds.new('Sky');scene.world.color=(.64,.71,.90)
def aim(o):o.rotation_euler=(Vector((0,0,1.02))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='AREA', location=(-3,-5,6));o=bpy.context.object;o.data.energy=430;o.data.shape='DISK';o.data.size=4;aim(o)
bpy.ops.object.light_add(type='AREA', location=(3,2,4));o=bpy.context.object;o.data.energy=220;o.data.size=3;aim(o)
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=2.54
scene.render.resolution_x=scene.render.resolution_y=128;scene.render.resolution_percentage=100
for palette,rgb in enumerate([(.18,.10,.7),(.96,.12,.32),(.035,.57,.53),(.98,.49,.04)]):
    bpy.data.materials['Jersey'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*rgb,1)
    for angle in range(4):
        a=angle*math.pi/2;camera.location=(4*math.sin(a),-4*math.cos(a),2.05);aim(camera)
        scene.render.filepath=str(root/('crowd-%d-%d.png'%(palette,angle)));bpy.ops.render.render(write_still=True)
