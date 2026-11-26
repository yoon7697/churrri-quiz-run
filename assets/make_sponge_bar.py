"""Build the original Quiz Run sponge bar with Blender 4.3.2.

Run: blender -b -P assets/make_sponge_bar.py
The GLB uses +X along the shaft, +Y up, and +Z across the bar.
"""
from pathlib import Path
from math import cos, pi, sin
import struct
import tempfile
import zlib

import bpy


OUT = Path(__file__).resolve().parent
HALF_LENGTH = 18.6
RADIUS = .52
HALF_HEIGHT = .104
SIDES = 12
WIDTH, HEIGHT = 512, 64


def png_chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))


def vinyl_pixel(col, row):
    """Two-tone vinyl, welded panel seams, and small printed direction marks."""
    u, v = col / (WIDTH - 1), row / HEIGHT
    end = min(u, 1 - u)
    phase = (u * 8) % 1
    seam = min(phase, 1 - phase)
    light = .86 + .14 * cos(2 * pi * v) + .035 * cos(16 * pi * u)
    grain = ((col * 37 + row * 17) % 11 - 5) * .32
    color = (39, 207, 191)
    if end < .034:
        color = (255, 226, 157)
        light *= .88 if .019 < end < .025 else 1.03
    elif .034 <= end < .041:
        color = (248, 255, 243)
    elif seam < .045:
        color = (20, 144, 139)
        if .012 < seam < .026:
            color = (111, 241, 219)
    elif .25 < phase < .75 and (abs(v-.25) < .031 or abs(v-.75) < .031):
        direction_mark = abs(v - (.25 if v < .5 else .75)) * 5
        if abs(phase-.46-direction_mark) < .026 or abs(phase-.57-direction_mark) < .026:
            color = (230, 255, 238)
    return tuple(max(0, min(255, round(channel * light + grain))) for channel in color)


def vinyl_image(path):
    scanlines = bytearray()
    for row in range(HEIGHT):
        scanlines.append(0)
        for col in range(WIDTH):
            scanlines.extend(vinyl_pixel(col, row))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(scanlines, 9))
        + png_chunk(b"IEND", b"")
    )


def create_shell(material):
    cap_steps = 4
    # Profile radii never extend outside the capsule used by the server.
    rings = []
    for step in range(cap_steps - 1, -1, -1):
        a = step * pi / (2 * cap_steps)
        rings.append((-HALF_LENGTH - RADIUS*sin(a), cos(a)))
    for i in range(1, 8):
        rings.append((HALF_LENGTH*(i/4-1), 1 if i % 2 else .961))
    for step in range(cap_steps):
        a = step * pi / (2 * cap_steps)
        rings.append((HALF_LENGTH + RADIUS*sin(a), cos(a)))

    vertices = []
    for x, scale in rings:
        for i in range(SIDES):
            angle = 2*pi*i/SIDES
            vertices.append((x, -RADIUS*scale*sin(angle), HALF_HEIGHT*scale*cos(angle)))

    faces, uvs = [], []
    length = 2*(HALF_LENGTH + RADIUS)
    along = lambda x: .5 + x/length
    for j in range(len(rings)-1):
        for i in range(SIDES):
            a, b = j*SIDES+i, j*SIDES+(i+1)%SIDES
            faces.append((a, b, b+SIDES, a+SIDES))
            u0, u1 = along(rings[j][0]), along(rings[j+1][0])
            v0, v1 = i/SIDES, (i+1)/SIDES
            uvs.append(((u0, v0), (u0, v1), (u1, v1), (u1, v0)))

    for side in [-1, 1]:
        tip = len(vertices)
        x = side*(HALF_LENGTH + RADIUS)
        vertices.append((x, 0, 0))
        ring = 0 if side < 0 else (len(rings)-1)*SIDES
        u = along(rings[ring//SIDES][0])
        for i in range(SIDES):
            a, b = ring+i, ring+(i+1)%SIDES
            v0, v1 = i/SIDES, (i+1)/SIDES
            ids = (b, a, tip)
            coords = ((u, v1), (u, v0), (along(x), (v0+v1)/2))
            faces.append(ids if side < 0 else ids[::-1])
            uvs.append(coords if side < 0 else coords[::-1])

    mesh = bpy.data.meshes.new("Inflatable cushion shell")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(material)
    uv_layer = mesh.uv_layers.new(name="Vinyl")
    for face, coords in zip(mesh.polygons, uvs):
        face.use_smooth = True
        for loop, uv in zip(face.loop_indices, coords):
            uv_layer.data[loop].uv = uv
    obj = bpy.data.objects.new("Sponge bar", mesh)
    bpy.context.collection.objects.link(obj)


bpy.ops.wm.read_factory_settings(use_empty=True)
with tempfile.TemporaryDirectory() as temporary:
    path = Path(temporary) / "vinyl.png"
    vinyl_image(path)
    surface = bpy.data.materials.new("Welded vinyl")
    surface.use_nodes = True
    shader = surface.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = .36
    shader.inputs["Metallic"].default_value = 0
    texture = surface.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(path))
    texture.image.pack()
    surface.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    create_shell(surface)
    bpy.ops.export_scene.gltf(filepath=str(OUT / "sponge-bar.glb"), export_format="GLB", export_yup=True)
