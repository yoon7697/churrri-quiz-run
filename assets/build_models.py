"""blender -b -P build_models.py. Original CHURRRI'S LAB arena models."""
from pathlib import Path
import bpy, math
from math import pi, sin, cos
out=Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(name,h):
    rgb=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    rgb=[v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*rgb,1);p.inputs['Roughness'].default_value=.30
    return m
def export(name):
    bpy.ops.export_scene.gltf(filepath=str(out/(name+'.glb')),export_format='GLB',export_yup=True)
def skin(name,verts,faces,materials,slots=None):
    m=bpy.data.meshes.new(name);m.from_pydata(verts,[],faces);m.update()
    for material in materials:m.materials.append(material)
    for i,p in enumerate(m.polygons):p.use_smooth=True;p.material_index=slots[i] if slots else 0
    o=bpy.data.objects.new(name,m);bpy.context.collection.objects.link(o);return o
# Air-filled rectangular envelope. Consecutive profile samples form the seam, welt and crown.
profile=[(.84,-.30,0),(.95,-.28,0),(.99,-.21,0),(1,-.13,0),(.997,-.095,0),(.98,-.076,0),(.968,-.065,0),(.965,-.042,1),(.959,-.019,1),(.944,-.002,1),(.923,.004,1),(.911,-.004,1),(.904,.002,2),(.892,.014,2),(.858,.026,2),(.78,.031,2),(.58,.033,2)]
v=[];faces=[];slots=[];n=64
for k,(r,z,slot) in enumerate(profile):
    for i in range(n):
        a=2*pi*i/n;cx,cy=cos(a),sin(a);q=(abs(cx)**8+abs(cy)**8)**(-1/8)
        v.append((cx*r*q,cy*r*q,z))
    if k:
        for i in range(n):
            j=(i+1)%n;b=(k-1)*n;faces.append((b+i,b+j,b+j+n,b+i+n));slots.append(slot)
faces.extend([tuple(reversed(range(n))),tuple(range(len(v)-n,len(v)))]);slots.extend([0,2])
skin('Air cushion',v,faces,[mat('Shell','EF4AAE'),mat('Champagne trim','FFE4AE'),mat('Landing face','FF70C8')],slots)
export('answer-cushion')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete()
fur=mat('Velvet cream','FFF0DB');pink=mat('Petal','FF9BBE');ink=mat('Eyes','362843');suit=mat('Jersey','7160DC');cuff=mat('Butter','FFD163');sole=mat('Soles','50417B');white=mat('Shine','FFFDF5')
def soft(name,xyz,scale,m,rot=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=10,location=xyz)
    o=bpy.context.object;o.name=name;o.scale=scale;o.rotation_euler.y=rot;o.data.materials.append(m)
    for f in o.data.polygons:f.use_smooth=True
    return o
# Front faces Blender -Y (glTF +Z). Ear silhouettes curve outward independently.
for sign in [-1,1]:
    verts=[];fs=[];ids=[];steps=12;sides=12
    for j in range(steps+1):
        u=j/steps;r=max(.014,sin(pi*u)**.6)
        for i in range(sides):
            a=2*pi*i/sides
            verts.append((sign*(.17+.17*u+.085*sin(pi*u))+.14*r*cos(a),.018+.075*u*u+.095*r*sin(a),1.48+(.70 if sign<0 else .62)*u))
        if j:
            for i in range(sides):
                k=(j-1)*sides+i;l=(j-1)*sides+(i+1)%sides;fs.append((k,l,l+sides,k+sides));ids.append(1 if 2<=j<=10 and i in [8,9] else 0)
    skin('Ear'+str(sign),verts,fs,[fur,pink],ids)
soft('Head',(0,-.01,1.23),(.51,.42,.48),fur)
soft('Jersey',(0,.015,.60),(.405,.34,.46),suit)
soft('Collar',(0,0,.86),(.35,.30,.11),cuff)
soft('Tail',(0,.33,.48),(.16,.145,.155),fur)
for s in [-1,1]:
    soft('Arm'+str(s),(s*.37,-.014,.62),(.135,.15,.225),fur,s*-.26)
    soft('Boot'+str(s),(s*.206,-.083,.159),(.168,.212,.154),sole)
    soft('Eye'+str(s),(s*.175,-.394,1.29),(.059,.037,.075),ink)
    soft('Glint'+str(s),(s*.175-.012,-.423,1.315),(.019,.013,.022),white)
    soft('Blush'+str(s),(s*.296,-.345,1.18),(.080,.024,.042),pink)
soft('Nose',(0,-.432,1.196),(.044,.032,.03),ink)
# Little courier scarf tails on the back, useful for reading running direction.
soft('Scarf',(.12,.29,.81),(.085,.047,.19),cuff,-.55)
export('relay-rabbit')
