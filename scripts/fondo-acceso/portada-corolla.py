# ============================================================
# LA PORTADA DEL ACCESO (Telecab V3) — el Corolla, de noche y en azul
# ============================================================
# La pantalla de acceso de la V3 (16/11/2026) lleva a la izquierda una foto de
# un Toyota Corolla —el coche de la flota— con el tono azul de noche de la
# referencia que trajo Camilo. La foto de partida la eligió él: es de la web de
# Toyota (la serie del Corolla Hybrid en ciudad) y NO va en el repositorio, que
# es público: este guion la prepara en local y deja el resultado en
# public/assets/acceso/portada.webp (y portada-900.webp para el móvil).
#
# Lo que hace:
#   1. RECORTA por la izquierda de la persona que cruza la foto: el coche se
#      queda entero y en la foto no sale nadie.
#   2. LA PASA A NOCHE: baja la exposición, enfría el color hacia el azul de la
#      casa y deja las luces del coche encendidas (lo más claro se conserva).
#   3. La guarda en WebP en dos tamaños.
#
# Uso:
#   python scripts/fondo-acceso/portada-corolla.py <foto-de-partida.jpg>
# Requiere Pillow y numpy.

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = RAIZ / 'public' / 'assets' / 'acceso'

# El encuadre, en fracciones de la foto de partida (4:3). La persona empieza
# hacia el 0,68 del ancho; el coche acaba en el 0,54.
IZQ, DER = 0.0, 0.655
ARRIBA, ABAJO = 0.04, 1.0


def a_noche(im):
    """Día → noche azul. Trabaja en lineal aproximado (0..1)."""
    a = np.asarray(im.convert('RGB'), dtype=np.float32) / 255.0
    lum = (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2])[..., None]

    # Menos color (la noche apaga los ocres) y una curva que hunde los medios.
    gris = np.repeat(lum, 3, axis=2)
    a = gris + (a - gris) * 0.38
    a = np.power(np.clip(a, 0, 1), 1.55)

    # El tinte: sombras azul marino, medios azul noche, luces frías. Contenido:
    # tiene que parecer una calle de noche, no un cartel a dos tintas.
    sombra = np.array([0.012, 0.028, 0.075], dtype=np.float32)
    medio = np.array([0.085, 0.200, 0.520], dtype=np.float32)
    luz = np.array([0.560, 0.720, 0.980], dtype=np.float32)
    l2 = (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2])[..., None]
    t1 = np.clip(l2 / 0.45, 0, 1)
    t2 = np.clip((l2 - 0.45) / 0.55, 0, 1)
    tinte = sombra + (medio - sombra) * t1
    tinte = tinte + (luz - tinte) * (t2 ** 1.6)
    frio = np.array([0.62, 0.82, 1.18], dtype=np.float32)
    out = tinte * (0.30 + 0.70 * l2) * 0.62 + a * 0.40 * frio

    # El cielo quemado del fondo: de noche es un resplandor azul, no un blanco.
    h = a.shape[0]
    y = (np.arange(h, dtype=np.float32) / h)[:, None, None]
    cielo = np.clip((lum - 0.72) / 0.28, 0, 1) * np.clip((0.50 - y) / 0.22, 0, 1)
    out = out * (1 - cielo * 0.78) + cielo * 0.78 * np.array([0.16, 0.30, 0.66], dtype=np.float32)

    # Las luces de verdad (los faros, el brillo del capó): vuelven, frías. Solo
    # de la mitad para abajo, que es donde está el coche.
    brillo = (np.clip((lum - 0.86) / 0.14, 0, 1) ** 2) * np.clip((y - 0.38) / 0.10, 0, 1)
    out = out + brillo * np.array([0.50, 0.62, 0.75], dtype=np.float32)
    return np.clip(out, 0, 1)


def vineta(a):
    """Los bordes, un punto más oscuros: lleva la vista al coche."""
    h, w = a.shape[:2]
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((x - w * 0.52) / (w * 0.75)) ** 2 + ((y - h * 0.60) / (h * 0.80)) ** 2)
    v = 1.0 - np.clip(d - 0.55, 0, 1) * 0.55
    return a * v[..., None]


def main():
    if len(sys.argv) < 2:
        print('Uso: python scripts/fondo-acceso/portada-corolla.py <foto-de-partida.jpg>')
        sys.exit(2)
    im = Image.open(sys.argv[1]).convert('RGB')
    w, h = im.size
    im = im.crop((int(w * IZQ), int(h * ARRIBA), int(w * DER), int(h * ABAJO)))
    a = vineta(a_noche(im))
    fin = Image.fromarray((a * 255).astype(np.uint8), 'RGB')
    fin = fin.filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
    SALIDA.mkdir(parents=True, exist_ok=True)
    for nombre, alto in (('portada.webp', 1500), ('portada-900.webp', 900)):
        esc = alto / fin.height
        f = fin.resize((round(fin.width * esc), alto), Image.LANCZOS)
        f.save(SALIDA / nombre, 'WEBP', quality=80, method=6)
        print(nombre, f.size, round((SALIDA / nombre).stat().st_size / 1024), 'KB')


if __name__ == '__main__':
    main()
