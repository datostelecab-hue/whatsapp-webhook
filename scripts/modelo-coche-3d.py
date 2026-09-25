# ============================================================
# EL COCHE EN 3D — se genera con Blender, no se dibuja a mano
# ============================================================
# El modelo que enseña la ficha del vehículo en «3D»: un Toyota Corolla sedán
# (E210) de proporciones reales —4,63 × 1,78 × 1,44 m, batalla 2,70 m, ruedas
# 205/55 R16— con sus rasgos: faros finos que acaban en punta junto a la
# rejilla, la toma inferior grande en trapecio, la ventanilla pequeña detrás de
# la puerta trasera y los pilotos que doblan la esquina. Por dentro, bloques
# simples (Camilo, 25/09/2026: «lo de por dentro, entre más simple mejor»).
#
# NO SE TROCEA POR PIEZAS. El 3D solo RESUME lo que se marca en el dibujo 2D:
# encima de cada pieza en mal estado se pone un punto. Por eso el modelo lleva,
# además del coche, un ANCLA invisible por pieza del catálogo (`p_<código>`,
# db/158) en su sitio del coche; el visor las busca por el nombre y no hay que
# mantener coordenadas en dos sitios. Las piezas que son dos (los frenos y la
# suspensión de un eje) llevan una segunda ancla `p_<código>__2`.
#
# Cómo se hace la carrocería: tres siluetas —el lateral, la planta y el frontal—
# extruidas y cruzadas (intersección), con los pasos de rueda restados y las
# aristas redondeadas. Los cristales, las luces, la rejilla y las juntas de las
# puertas son láminas finas pegadas encima, calculadas sobre las mismas
# siluetas para que caigan justo en la superficie.
#
# Nombres que usa el visor: los materiales «carroceria» y «vidrio», y los
# objetos «int_*» (el interior: lo que se ve al aclarar la carrocería).
#
# Ejes de Blender: X a lo ancho (la IZQUIERDA del coche es -X, donde se sienta el
# conductor en España), Y a lo largo (el frontal en +Y), Z hacia arriba. El glTF
# sale con Y hacia arriba (x, z, -y).
#
# Uso (sin ventana):
#   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
#       -P scripts/modelo-coche-3d.py -- public/assets/3d/coche.glb [render.png]

import bpy
import math
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SALIDA = argv[0] if argv else 'coche.glb'
RENDER = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
escena = bpy.context.scene
col = escena.collection


# ── Utilidades ─────────────────────────────────────────────────────────────
def activar(obj):
    for o in list(bpy.context.selected_objects):
        if o:
            o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def aplicar(obj, mod):
    activar(obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def material(nombre, color, metal=0.0, rugosidad=0.5, emision=None, fuerza=0.0):
    m = bpy.data.materials.new(nombre)
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rugosidad
    if emision:
        bsdf.inputs['Emission Color'].default_value = (*emision, 1.0)
        bsdf.inputs['Emission Strength'].default_value = fuerza
    return m


M_CARRO = material('carroceria', (0.46, 0.48, 0.51), metal=0.55, rugosidad=0.32)
M_VIDRIO = material('vidrio', (0.03, 0.045, 0.06), rugosidad=0.04)
M_NEGRO = material('plastico_negro', (0.025, 0.025, 0.028), rugosidad=0.65)
M_BRILLO = material('negro_brillo', (0.015, 0.015, 0.018), rugosidad=0.12)
M_JUNTA = material('junta', (0.05, 0.05, 0.055), rugosidad=0.8)
M_GOMA = material('neumatico', (0.03, 0.03, 0.032), rugosidad=0.85)
M_LLANTA = material('llanta', (0.66, 0.68, 0.71), metal=0.9, rugosidad=0.22)
M_LLANTA_F = material('llanta_fondo', (0.10, 0.10, 0.11), metal=0.6, rugosidad=0.4)
M_CROMO = material('cromo', (0.85, 0.86, 0.88), metal=1.0, rugosidad=0.12)
M_FARO = material('faro', (0.05, 0.055, 0.065), metal=0.3, rugosidad=0.08)
M_LED = material('led', (0.95, 0.97, 1.0), emision=(0.9, 0.95, 1.0), fuerza=2.0)
M_PILOTO = material('piloto', (0.45, 0.02, 0.03), rugosidad=0.15, emision=(0.7, 0.02, 0.02), fuerza=0.6)
M_MATRICULA = material('matricula', (0.93, 0.93, 0.91), rugosidad=0.45)
M_PINZA = material('pinza', (0.62, 0.06, 0.05), rugosidad=0.4)
M_INTERIOR = material('interior', (0.13, 0.13, 0.14), rugosidad=0.75)
M_TAPIZ = material('tapiceria', (0.20, 0.20, 0.22), rugosidad=0.9)
M_MOTOR = material('mecanica', (0.40, 0.41, 0.43), metal=0.6, rugosidad=0.45)
M_DISCO = material('freno', (0.50, 0.50, 0.52), metal=0.8, rugosidad=0.35)


def objeto(nombre, malla, mat):
    o = bpy.data.objects.new(nombre, malla)
    col.objects.link(o)
    o.data.materials.append(mat)
    return o


def suave(obj, angulo=None):
    activar(obj)
    if angulo is None:
        bpy.ops.object.shade_smooth()
    else:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angulo))


def normales_fuera(obj):
    activar(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def malla(nombre, verts, caras, mat):
    me = bpy.data.meshes.new(nombre)
    me.from_pydata(verts, [], caras)
    me.validate()
    return objeto(nombre, me, mat)


def interp(tabla, k):
    """Interpolación lineal en una tabla [(clave, valor)] ordenada por clave."""
    if k <= tabla[0][0]:
        return tabla[0][1]
    for (k0, v0), (k1, v1) in zip(tabla, tabla[1:]):
        if k0 <= k <= k1:
            return v0 + (v1 - v0) * ((k - k0) / (k1 - k0) if k1 != k0 else 0)
    return tabla[-1][1]


def caja(nombre, centro, medida, mat, bisel=0.02, rot=(0, 0, 0), angulo=35):
    bpy.ops.mesh.primitive_cube_add(size=1, location=centro, rotation=rot)
    o = bpy.context.active_object
    o.name = nombre
    o.scale = medida
    activar(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bisel:
        m = o.modifiers.new('bisel', 'BEVEL')
        m.width = bisel
        m.segments = 3
        aplicar(o, m)
    o.data.materials.append(mat)
    suave(o, angulo)
    return o


def cilindro(nombre, centro, radio, largo, mat, eje='x', lados=32):
    rot = {'x': (0, math.pi / 2, 0), 'y': (math.pi / 2, 0, 0), 'z': (0, 0, 0)}[eje]
    bpy.ops.mesh.primitive_cylinder_add(vertices=lados, radius=radio, depth=largo, location=centro, rotation=rot)
    o = bpy.context.active_object
    o.name = nombre
    o.data.materials.append(mat)
    suave(o, 30)
    return o


def barra(nombre, a, b, grosor, mat):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=grosor, depth=d.length, location=(a + b) / 2)
    o = bpy.context.active_object
    o.name = nombre
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    o.data.materials.append(mat)
    suave(o)
    return o


# ── Las tres siluetas ──────────────────────────────────────────────────────
# Lateral (y, z), de la parte baja del morro dando la vuelta por arriba.
# El morro baja inclinado hacia el capó; el techo es un arco que cae largo
# hasta un maletero corto y alto, como el del Corolla sedán.
LATERAL = [
    (1.98, 0.18), (2.14, 0.20), (2.24, 0.26), (2.29, 0.34), (2.31, 0.43), (2.31, 0.50),
    (2.295, 0.57), (2.265, 0.63), (2.22, 0.685), (2.15, 0.735), (2.05, 0.775), (1.90, 0.81),
    (1.65, 0.85), (1.35, 0.885),
    (1.00, 0.93),                        # base del parabrisas
    (0.05, 1.395),                       # arriba del parabrisas
    (-0.15, 1.425), (-0.40, 1.44), (-0.65, 1.432), (-0.85, 1.41),
    (-1.05, 1.365),                      # arriba de la luna trasera
    (-1.66, 1.05),                       # abajo de la luna trasera
    (-1.85, 1.045), (-2.05, 1.035), (-2.18, 1.02), (-2.26, 0.99), (-2.30, 0.95),
    (-2.32, 0.88), (-2.33, 0.76), (-2.325, 0.62), (-2.30, 0.48), (-2.26, 0.36),
    (-2.20, 0.26), (-2.10, 0.20), (-1.95, 0.18),
]
PARABRISAS = ((1.00, 0.93), (0.05, 1.395))
LUNA = ((-1.05, 1.365), (-1.66, 1.05))

# La línea de arriba (del parabrisas a la luna), como z según y.
ARRIBA = sorted([(y, z) for y, z in LATERAL if -1.66 <= y <= 1.00 and z > 0.9])
# El morro y la cola: y según z.
MORRO = sorted([(z, y) for y, z in LATERAL if y > 1.9 and z < 0.8])
COLA = sorted([(z, y) for y, z in LATERAL if y < -2.0 and z < 0.99])

# Frontal (z, x) de medio coche: el costado, la cintura y la caída de la cabina.
FRONTAL = [(0.10, 0.78), (0.22, 0.835), (0.34, 0.87), (0.46, 0.89), (0.60, 0.89), (0.74, 0.887),
           (0.86, 0.878), (0.95, 0.858), (0.985, 0.84), (1.005, 0.822), (1.46, 0.64), (1.50, 0.62)]


def ancho(y):
    """Medio ancho en planta: las puertas un poco hundidas y las aletas marcadas sobre las ruedas."""
    return 0.872 + 0.018 * max(math.exp(-((y - 1.37) / 0.45) ** 2), math.exp(-((y + 1.33) / 0.45) ** 2))


W_DEL, W_TRA = ancho(1.80), ancho(-1.90)


def arriba_z(y):
    return interp(ARRIBA, y)


def costado_x(z):
    return interp(FRONTAL, z)


def costado_n(z, s=1):
    """Normal del costado a la altura z (en el plano x-z)."""
    dz = 0.005
    dx = (costado_x(z + dz) - costado_x(z - dz)) / (2 * dz)
    n = Vector((s * 1.0, 0, -dx))
    return n.normalized()


# Planta (x, y): los lados rectos y el morro y la cola redondeados.
def planta_del(x):
    a = min(abs(x) / W_DEL, 1.0)
    return 1.80 + 0.50 * (1 - a ** 2.6) ** (1 / 2.6)


def planta_tra(x):
    a = min(abs(x) / W_TRA, 1.0)
    return -1.90 - 0.42 * (1 - a ** 3) ** (1 / 3)


_c = [math.cos(math.pi * i / 40) for i in range(41)]
_lado = [1.80 + (-1.90 - 1.80) * i / 60 for i in range(1, 60)]
PLANTA = ([(W_DEL * c, planta_del(W_DEL * c)) for c in _c]
          + [(-ancho(y), y) for y in _lado]
          + [(-W_TRA * c, planta_tra(W_TRA * c)) for c in _c]
          + [(ancho(y), y) for y in reversed(_lado)])


def prisma(nombre, pts, eje, a, b):
    n = len(pts)
    verts = []
    for d in (a, b):
        for u, v in pts:
            verts.append({'x': (d, u, v), 'y': (u, d, v), 'z': (u, v, d)}[eje])
    caras = [tuple(range(n)), tuple(range(n, 2 * n))]
    caras += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    o = malla(nombre, verts, caras, M_CARRO)
    normales_fuera(o)
    return o


def booleano(obj, otro, op):
    m = obj.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.object = otro
    m.solver = 'EXACT'
    if hasattr(m, 'material_mode'):
        m.material_mode = 'TRANSFER'
    aplicar(obj, m)
    bpy.data.objects.remove(otro, do_unlink=True)


cuerpo = prisma('carroceria', LATERAL, 'x', -1.2, 1.2)
booleano(cuerpo, prisma('_planta', PLANTA, 'z', 0.0, 2.0), 'INTERSECT')
booleano(cuerpo, prisma('_frontal', [(x, z) for z, x in FRONTAL] + [(-x, z) for z, x in reversed(FRONTAL)], 'y', -3, 3),
         'INTERSECT')

# Los pasos de rueda.
EJES = (1.37, -1.33)
R_RUEDA = 0.316
for y in EJES:
    for s in (-1, 1):
        corte = cilindro('_arco', (s * 0.80, y, R_RUEDA), 0.375, 0.40, M_NEGRO, lados=64)
        booleano(cuerpo, corte, 'DIFFERENCE')

m = cuerpo.modifiers.new('bisel', 'BEVEL')
m.width = 0.028
m.segments = 3
m.limit_method = 'ANGLE'
m.angle_limit = math.radians(35)
m.use_clamp_overlap = True
aplicar(cuerpo, m)
suave(cuerpo, 34)


# ── Láminas pegadas a la carrocería ────────────────────────────────────────
def rejilla(nombre, us, vs, fn, mat):
    verts = [tuple(fn(u, v)) for u in us for v in vs]
    nv = len(vs)
    caras = [(i * nv + j, (i + 1) * nv + j, (i + 1) * nv + j + 1, i * nv + j + 1)
             for i in range(len(us) - 1) for j in range(nv - 1)]
    o = malla(nombre, verts, caras, mat)
    suave(o)
    return o


def pasos(a, b, n):
    return [a + (b - a) * i / n for i in range(n + 1)]


def lado(y, z, s=1, off=0.004):
    """Un punto del costado (lado s) a la altura z, un pelo por fuera: manda
    la silueta frontal o la planta, la que quede más adentro."""
    xf, xw = costado_x(z), ancho(y)
    if xw < xf:
        e = 0.002
        n = Vector((s, -(ancho(y + e) - ancho(y - e)) / (2 * e), 0)).normalized()
        return Vector((s * xw, y, z)) + n * off
    return Vector((s * xf, y, z)) + costado_n(z, s) * off


def frente(x, z, off=0.006):
    """Un punto del frontal: el morro del lateral o la curva de la planta, lo que quede más atrás."""
    ys = interp(MORRO, z)
    yp = planta_del(x)
    if yp < ys:
        e = 0.002
        n = Vector((-(planta_del(x + e) - planta_del(x - e)) / (2 * e), 1, 0)).normalized()
        return Vector((x, yp, z)) + n * off
    return Vector((x, ys + off, z))


def detras(x, z, off=0.006):
    ys = interp(COLA, z)
    yp = planta_tra(x)
    if yp > ys:
        e = 0.002
        n = Vector(((planta_tra(x + e) - planta_tra(x - e)) / (2 * e), -1, 0)).normalized()
        return Vector((x, yp, z)) + n * off
    return Vector((x, ys - off, z))


def cinta(nombre, camino, ancho, mat, s=1, off=0.0045):
    """Una cinta fina que sigue un camino (y, z) por el costado: las juntas de las puertas."""
    izq, der = [], []
    for i, (y, z) in enumerate(camino):
        a = camino[max(i - 1, 0)]
        b = camino[min(i + 1, len(camino) - 1)]
        t = Vector((b[0] - a[0], b[1] - a[1])).normalized()
        q = Vector((-t.y, t.x)) * (ancho / 2)
        izq.append(tuple(lado(y + q.x, z + q.y, s, off)))
        der.append(tuple(lado(y - q.x, z - q.y, s, off)))
    verts = izq + der
    n = len(camino)
    caras = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    return malla(nombre, verts, caras, mat)


# El parabrisas y la luna trasera: planos del lateral, entre los pilares.
def cristal_inclinado(nombre, ab, margen_lado, margen_ini, margen_fin):
    (y0, z0), (y1, z1) = ab
    d = Vector((0, y1 - y0, z1 - z0)).normalized()
    n = Vector((0, -d.z, d.y))
    if n.z < 0:
        n = -n

    def fn(t, v):
        y = y0 + (y1 - y0) * t
        z = z0 + (z1 - z0) * t
        hx = costado_x(z) - margen_lado
        return Vector((v * hx, y, z)) + n * 0.004

    return rejilla(nombre, pasos(margen_ini, 1 - margen_fin, 10), pasos(-1, 1, 16), fn, M_VIDRIO)


cristal_inclinado('parabrisas', PARABRISAS, 0.075, 0.05, 0.05)
cristal_inclinado('luna_trasera', LUNA, 0.17, 0.06, 0.07)

# Las ventanillas: por encima de la cintura y por debajo del techo, en el plano
# de la cabina. Delantera, pilar B negro, trasera, marco y la ventanilla pequeña
# detrás de la puerta (la del Corolla sedán), que acaba en el pilar C.
PENDIENTE_C = (LUNA[0][1] - LUNA[1][1]) / (LUNA[0][0] - LUNA[1][0])


def z_vent(y):
    """La línea de abajo de las ventanillas: sube un poco hacia atrás."""
    return 1.03 + 0.04 * min(max((0.5 - y) / 2.0, 0.0), 1.0)


def ventana(nombre, y_de, y_a, techo, mat, s):
    ys = [y for y in pasos(y_de, y_a, 40) if techo(y) > z_vent(y) + 0.002]
    if len(ys) < 2:
        return None
    return rejilla(nombre, ys, pasos(0, 1, 4),
                   lambda y, v: lado(y, z_vent(y) + v * (techo(y) - z_vent(y)), s), mat)


def techo_vent(y):
    return arriba_z(y) - 0.07


def techo_cuarto(y):
    return min(arriba_z(y) - 0.07, z_vent(-1.58) + PENDIENTE_C * (y + 1.58))


for s in (-1, 1):
    ls = 'izq' if s < 0 else 'der'
    ventana(f'ventanilla_del_{ls}', 0.95, -0.40, techo_vent, M_VIDRIO, s)
    ventana(f'pilar_b_{ls}', -0.40, -0.50, techo_vent, M_BRILLO, s)
    ventana(f'ventanilla_tra_{ls}', -0.50, -1.12, techo_vent, M_VIDRIO, s)
    ventana(f'marco_{ls}', -1.12, -1.17, techo_cuarto, M_BRILLO, s)
    ventana(f'ventanilla_cuarto_{ls}', -1.17, -1.60, techo_cuarto, M_VIDRIO, s)
    # El embellecedor cromado bajo las ventanillas.
    cinta(f'moldura_{ls}', [(y, z_vent(y) - 0.012) for y in pasos(0.66, -1.56, 24)], 0.011, M_CROMO, s)
    # Las juntas de las puertas y el estribo.
    cinta(f'junta_del_{ls}', [(0.93, z) for z in pasos(0.33, 0.965, 8)], 0.006, M_JUNTA, s)
    cinta(f'junta_b_{ls}', [(-0.45, z) for z in pasos(0.33, 0.965, 8)], 0.006, M_JUNTA, s)
    arco = [(-1.33 + 0.40 * math.cos(a), 0.315 + 0.40 * math.sin(a))
            for a in pasos(math.radians(66.4), math.radians(2.1), 12)]
    cinta(f'junta_tra_{ls}', [(-1.17, z) for z in pasos(0.965, 0.70, 4)] + arco, 0.006, M_JUNTA, s)
    cinta(f'junta_bajo_{ls}', [(y, 0.33) for y in pasos(0.93, -0.93, 12)], 0.006, M_JUNTA, s)
    # Las manetas.
    for k, y in enumerate((0.30, -0.78)):
        p = lado(y, 0.905, s, 0.012)
        caja(f'maneta_{ls}_{k}', tuple(p), (0.03, 0.15, 0.032), M_CROMO, 0.012)
    # El retrovisor: la carcasa del color del coche sobre un pie negro.
    caja(f'retrovisor_{ls}', (s * 0.975, 0.70, 1.075), (0.20, 0.11, 0.12), M_CARRO, 0.04)
    caja(f'pie_retrovisor_{ls}', (s * 0.865, 0.72, 1.035), (0.07, 0.12, 0.05), M_NEGRO, 0.015)
    caja(f'espejo_{ls}', (s * 0.985, 0.645, 1.075), (0.16, 0.006, 0.09), M_BRILLO, 0.002)

# La tapa del depósito: a la izquierda, sobre la rueda de atrás.
cinta('tapa_deposito', [(-1.45 + 0.055 * math.cos(a), 0.87 + 0.052 * math.sin(a))
                        for a in pasos(0, 2 * math.pi, 24)], 0.005, M_JUNTA, -1)


# El frontal del Corolla: faros finos que acaban en punta junto a la rejilla,
# una rejilla superior estrecha y la toma inferior grande en trapecio.
def faro_bajo(x):
    return 0.622 + 0.02 * ((x - 0.36) / 0.505)


def faro_alto(x):
    return 0.632 + 0.105 * max((x - 0.36) / 0.505, 0) ** 0.7


def piloto_bajo(x):
    return 0.855 - 0.03 * ((x - 0.30) / 0.585)


def piloto_alto(x):
    return 0.87 + 0.09 * max((x - 0.30) / 0.585, 0) ** 0.8


for s in (-1, 1):
    ls = 'izq' if s < 0 else 'der'
    rejilla(f'faro_{ls}', [s * x for x in pasos(0.36, 0.865, 30)], pasos(0, 1, 3),
            lambda x, v: frente(x, faro_bajo(abs(x)) + v * (faro_alto(abs(x)) - faro_bajo(abs(x)))), M_FARO)
    rejilla(f'led_{ls}', [s * x for x in pasos(0.40, 0.85, 24)], pasos(0, 1, 1),
            lambda x, v: frente(x, faro_alto(abs(x)) - 0.014 + v * 0.008, 0.009), M_LED)
    rejilla(f'antiniebla_{ls}', [s * x for x in pasos(0.72, 0.80, 4)], pasos(0, 1, 2),
            lambda x, v: frente(x, 0.30 + v * 0.05), M_FARO)
    # Los pilotos: finos, con la punta hacia la matrícula y doblando la esquina.
    rejilla(f'piloto_{ls}', [s * x for x in pasos(0.30, 0.885, 30)], pasos(0, 1, 3),
            lambda x, v: detras(x, piloto_bajo(abs(x)) + v * (piloto_alto(abs(x)) - piloto_bajo(abs(x)))), M_PILOTO)

rejilla('rejilla_superior', pasos(-0.34, 0.34, 20), pasos(0, 1, 1),
        lambda x, v: frente(x, 0.596 + v * 0.028), M_BRILLO)
rejilla('toma_inferior', pasos(0.25, 0.52, 6), pasos(-1, 1, 24),
        lambda z, v: frente(v * (0.68 - (z - 0.25) / 0.27 * 0.17), z), M_NEGRO)
rejilla('matricula_delantera', pasos(-0.26, 0.26, 12), pasos(0, 1, 1),
        lambda x, v: frente(x, 0.385 + v * 0.11, 0.013), M_MATRICULA)
rejilla('matricula_trasera', pasos(-0.26, 0.26, 12), pasos(0, 1, 1),
        lambda x, v: detras(x, 0.50 + v * 0.11, 0.008), M_MATRICULA)
rejilla('difusor', pasos(-0.80, 0.80, 30), pasos(0, 1, 2),
        lambda x, v: detras(x, 0.215 + v * 0.085), M_NEGRO)
cilindro('escape', (-0.55, -2.20, 0.235), 0.035, 0.14, M_CROMO, eje='y', lados=20)
caja('antena', (0, -0.93, 1.425), (0.05, 0.15, 0.05), M_BRILLO, 0.02)

# Limpiaparabrisas, sobre la base del cristal.
barra('limpia_del_izq', (-0.64, 0.955, 0.968), (-0.05, 0.925, 0.982), 0.008, M_NEGRO)
barra('limpia_del_der', (0.02, 0.955, 0.968), (0.52, 0.925, 0.982), 0.008, M_NEGRO)
barra('limpia_tra', (0.0, -1.625, 1.07), (0.22, -1.55, 1.11), 0.007, M_NEGRO)


# ── Ruedas: 205/55 R16 con llanta de cinco radios ──────────────────────────
def rueda(nombre, x, y, z, s, tumbada=False):
    rot = (0, 0, 0) if tumbada else (0, math.pi / 2, 0)
    bpy.ops.mesh.primitive_torus_add(major_radius=R_RUEDA - 0.075, minor_radius=0.075,
                                     major_segments=48, minor_segments=14, location=(x, y, z), rotation=rot)
    t = bpy.context.active_object
    t.name = nombre
    t.scale = (1, 1, 1.36)          # el eje del toro: el ancho de la rueda
    activar(t)
    bpy.ops.object.transform_apply(scale=True)
    t.data.materials.append(M_GOMA)
    suave(t)
    if tumbada:
        cilindro(nombre + '_llanta', (x, y, z), 0.20, 0.15, M_LLANTA_F, eje='z')
        return t
    cilindro(nombre + '_llanta', (x, y, z), 0.215, 0.17, M_LLANTA_F, eje='x', lados=40)
    cara = x + s * 0.088
    for k in range(5):
        a = 2 * math.pi * k / 5 + math.pi / 2
        caja(f'{nombre}_radio{k}', (cara, y + math.cos(a) * 0.125, z + math.sin(a) * 0.125),
             (0.022, 0.17, 0.042), M_LLANTA, 0.008, rot=(a, 0, 0))
    cilindro(nombre + '_tapacubos', (cara + s * 0.004, y, z), 0.045, 0.02, M_LLANTA, eje='x', lados=24)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.205, minor_radius=0.012, major_segments=40, minor_segments=8,
                                     location=(cara, y, z), rotation=rot)
    aro = bpy.context.active_object
    aro.name = nombre + '_aro'
    aro.data.materials.append(M_LLANTA)
    suave(aro)
    return t


for y in EJES:
    for s in (-1, 1):
        ls = ('del_' if y > 0 else 'tra_') + ('izq' if s < 0 else 'der')
        rueda(f'rueda_{ls}', s * 0.765, y, R_RUEDA, s)
        cilindro(f'freno_{ls}', (s * 0.70, y, R_RUEDA), 0.165, 0.028, M_DISCO, eje='x')
        caja(f'pinza_{ls}', (s * 0.715, y + 0.06, R_RUEDA + 0.13), (0.05, 0.11, 0.07), M_PINZA, 0.015)


# ── Por dentro: bloques simples ────────────────────────────────────────────
caja('int_suelo', (0, -0.20, 0.265), (1.56, 2.30, 0.04), M_INTERIOR, 0.01)
caja('int_salpicadero', (0, 0.72, 0.86), (1.56, 0.36, 0.20), M_INTERIOR, 0.06)
caja('int_pantalla', (0, 0.555, 1.02), (0.24, 0.02, 0.15), M_BRILLO, 0.01, rot=(-0.25, 0, 0))
caja('int_consola', (0, 0.15, 0.45), (0.22, 0.85, 0.20), M_INTERIOR, 0.04)
caja('int_retrovisor', (0, 0.12, 1.30), (0.24, 0.03, 0.07), M_NEGRO, 0.015)
bpy.ops.mesh.primitive_torus_add(major_radius=0.18, minor_radius=0.022, major_segments=36, minor_segments=8,
                                 location=(-0.37, 0.45, 0.95), rotation=(math.radians(65), 0, 0))
vol = bpy.context.active_object
vol.name = 'int_volante'
vol.data.materials.append(M_NEGRO)
suave(vol)
barra('int_columna', (-0.37, 0.45, 0.95), (-0.37, 0.66, 0.85), 0.03, M_NEGRO)


def asiento(nombre, x, y, ancho=0.52, respaldo=0.62, caida=14):
    caja(nombre + '_cojin', (x, y, 0.46), (ancho, 0.52, 0.13), M_TAPIZ, 0.05)
    caja(nombre + '_respaldo', (x, y - 0.30, 0.80), (ancho, 0.12, respaldo), M_TAPIZ, 0.05,
         rot=(math.radians(caida), 0, 0))
    caja(nombre + '_cabezal', (x, y - 0.38, 1.17), (ancho * 0.5, 0.09, 0.15), M_TAPIZ, 0.04)


asiento('int_asiento_conductor', -0.37, -0.08)
asiento('int_asiento_copiloto', 0.37, -0.08)
caja('int_asientos_traseros_cojin', (0, -0.95, 0.46), (1.40, 0.50, 0.13), M_TAPIZ, 0.05)
caja('int_asientos_traseros_respaldo', (0, -1.24, 0.80), (1.40, 0.12, 0.58), M_TAPIZ, 0.05,
     rot=(math.radians(18), 0, 0))
caja('int_suelo_maletero', (0, -1.85, 0.40), (1.40, 0.80, 0.04), M_INTERIOR, 0.01)
rueda('int_rueda_repuesto', 0, -1.85, 0.49, 1, tumbada=True)
caja('int_motor', (0, 1.62, 0.55), (0.70, 0.55, 0.40), M_MOTOR, 0.04)
caja('int_tapa_motor', (0, 1.60, 0.77), (0.50, 0.36, 0.05), M_NEGRO, 0.02)
caja('int_bateria', (-0.55, 1.80, 0.63), (0.24, 0.17, 0.19), M_NEGRO, 0.015)
caja('int_radiador', (0, 2.08, 0.50), (1.00, 0.05, 0.36), M_MOTOR, 0.01)
caja('int_liquidos', (0.55, 1.80, 0.62), (0.16, 0.16, 0.18), M_MATRICULA, 0.03)
for k, y in enumerate(EJES):
    for s in (-1, 1):
        cilindro(f'int_amortiguador_{k}_{"izq" if s < 0 else "der"}', (s * 0.60, y, 0.66), 0.055, 0.30,
                 M_MOTOR, eje='z', lados=16)


# ── Las anclas: una por pieza del catálogo (db/158) ────────────────────────
ANCLAS = {
    # Carrocería
    'paragolpes_del': (0.42, 2.27, 0.33), 'capo': (0, 1.60, 0.865),
    'aleta_del_izq': (-0.89, 1.45, 0.80), 'aleta_del_der': (0.89, 1.45, 0.80),
    'puerta_del_izq': (-0.88, 0.30, 0.70), 'puerta_del_der': (0.88, 0.30, 0.70),
    'puerta_tra_izq': (-0.88, -0.75, 0.70), 'puerta_tra_der': (0.88, -0.75, 0.70),
    'aleta_tra_izq': (-0.88, -1.85, 0.74), 'aleta_tra_der': (0.88, -1.85, 0.74),
    'techo': (0, -0.45, 1.445), 'maletero': (0, -1.95, 1.045), 'paragolpes_tra': (0.42, -2.27, 0.36),
    'tapa_deposito': (-0.89, -1.45, 0.87), 'antena': (0, -0.93, 1.44),
    # Cristales
    'parabrisas': (0.30, 0.525, 1.17), 'luna_trasera': (0.30, -1.355, 1.215),
    'vent_del_izq': (-0.75, 0.10, 1.20), 'vent_del_der': (0.75, 0.10, 1.20),
    'vent_tra_izq': (-0.755, -0.85, 1.18), 'vent_tra_der': (0.755, -0.85, 1.18),
    # Luces
    'faro_izq': (-0.62, 2.215, 0.68), 'faro_der': (0.62, 2.215, 0.68),
    'antiniebla_izq': (-0.76, 2.125, 0.325), 'antiniebla_der': (0.76, 2.125, 0.325),
    'piloto_izq': (-0.62, -2.265, 0.90), 'piloto_der': (0.62, -2.265, 0.90),
    # Espejos y limpiaparabrisas
    'retrovisor_izq': (-1.085, 0.70, 1.09), 'retrovisor_der': (1.085, 0.70, 1.09),
    'limpia_del': (-0.30, 0.94, 0.98), 'limpia_tra': (0.08, -1.60, 1.09),
    # Ruedas
    'rueda_del_izq': (-0.88, 1.37, 0.316), 'rueda_del_der': (0.88, 1.37, 0.316),
    'rueda_tra_izq': (-0.88, -1.33, 0.316), 'rueda_tra_der': (0.88, -1.33, 0.316),
    # Matrículas y escape
    'matricula_del': (0, 2.325, 0.44), 'matricula_tra': (0, -2.33, 0.555), 'escape': (-0.55, -2.28, 0.235),
    # Habitáculo
    'salpicadero': (0.45, 0.72, 0.97), 'volante': (-0.37, 0.45, 0.95), 'multimedia': (0, 0.55, 1.11),
    'climatizacion': (0, 0.54, 0.85), 'retrovisor_int': (0, 0.12, 1.34), 'consola': (0, 0.10, 0.57),
    'asiento_cond': (-0.37, -0.30, 0.86), 'asiento_copi': (0.37, -0.30, 0.86),
    'asientos_tra': (0, -1.00, 0.60), 'cinturones': (-0.66, -0.42, 1.10), 'alfombrillas': (-0.37, 0.35, 0.30),
    # Maletero
    'suelo_maletero': (0.45, -1.95, 0.43), 'rueda_repuesto': (0, -1.85, 0.53),
    # Mecánica
    'motor': (0, 1.62, 0.80), 'bateria': (-0.55, 1.80, 0.74), 'radiador': (0, 2.08, 0.69),
    'liquidos': (0.55, 1.80, 0.72),
    'frenos_del': (-0.72, 1.43, 0.45), 'frenos_del__2': (0.72, 1.43, 0.45),
    'frenos_tra': (-0.72, -1.27, 0.45), 'frenos_tra__2': (0.72, -1.27, 0.45),
    'suspension_del': (-0.60, 1.37, 0.66), 'suspension_del__2': (0.60, 1.37, 0.66),
    'suspension_tra': (-0.60, -1.33, 0.66), 'suspension_tra__2': (0.60, -1.33, 0.66),
}
for cod, pos in ANCLAS.items():
    e = bpy.data.objects.new('p_' + cod, None)
    e.empty_display_size = 0.03
    e.location = pos
    col.objects.link(e)

# ── Exportar ───────────────────────────────────────────────────────────────
bpy.ops.export_scene.gltf(filepath=SALIDA, export_format='GLB', use_selection=False, export_apply=True,
                          export_yup=True, export_texcoords=False)
mallas = [o for o in bpy.data.objects if o.type == 'MESH']
tris = 0
for o in mallas:
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
print(f'OK {SALIDA} · {len(mallas)} mallas · {tris} triángulos · {len(ANCLAS)} anclas')

# ── Render de comprobación (opcional): tres cuartos de delante, de detrás y de lado ──
if RENDER:
    escena.render.engine = 'CYCLES'
    escena.cycles.device = 'CPU'
    escena.cycles.samples = 24
    escena.render.resolution_x, escena.render.resolution_y = 1100, 620
    mundo = bpy.data.worlds.new('mundo')
    escena.world = mundo
    fondo = mundo.node_tree.nodes['Background']
    fondo.inputs['Color'].default_value = (0.86, 0.88, 0.9, 1)
    fondo.inputs['Strength'].default_value = 0.8
    cam = bpy.data.objects.new('camara', bpy.data.cameras.new('camara'))
    col.objects.link(cam)
    cam.data.lens = 45
    objetivo = bpy.data.objects.new('objetivo', None)
    objetivo.location = (0, 0, 0.62)
    col.objects.link(objetivo)
    cam.constraints.new('TRACK_TO').target = objetivo
    escena.camera = cam
    sol = bpy.data.objects.new('sol', bpy.data.lights.new('sol', 'SUN'))
    sol.data.energy = 3.2
    sol.rotation_euler = (math.radians(45), math.radians(12), math.radians(40))
    col.objects.link(sol)
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    bpy.context.active_object.data.materials.append(material('suelo_render', (0.8, 0.81, 0.83), rugosidad=0.9))
    base = RENDER[:-4] if RENDER.lower().endswith('.png') else RENDER
    for sufijo, pos in (('_delante', (-4.4, 5.2, 2.1)), ('_detras', (4.6, -5.0, 2.3)), ('_lado', (-7.0, 0.0, 1.1))):
        cam.location = pos
        escena.render.filepath = base + sufijo + '.png'
        bpy.ops.render.render(write_still=True)
        print('RENDER', escena.render.filepath)
