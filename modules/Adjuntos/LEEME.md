# Adjuntos

Las rutas de los adjuntos de cualquier dueño (una tarea, un mensaje, un
siniestro…) y el banco de pruebas. Pieza A6 de `docs/Hoja de ruta.md`
(13/11/2026, db/249).

```
adjuntos.controller.js     /adjuntos: subir (multipart, por trozos), lista, fichero (con Range), anular; el banco
vistas/adjuntosBanco.ejs   /adjuntos/banco, solo el desarrollador
```

## Lo que NO vive aquí, y es una decisión

Las reglas (quién ve, qué se abre en la página, el tope, la huella, anular)
están en `services/adjuntos.js`, y los bytes en `services/almacen.js`: los
usarán todos los módulos, y si vivieran aquí todos dependerían de este.

Cada módulo dueño se registra con `adjuntos.registrarDueno(tipo, { ver,
adjuntar })`. Por eso `/adjuntos` no está en el catálogo de permisos: entra
cualquiera con sesión, y cada fichero se comprueba contra su dueño.

El banco registra el dueño `prueba`: el desarrollador adjunta a su propio id de
usuario, y sirve para ver que el almacén funciona en local, en el servidor de
pruebas y en Render.

Ver `docs/nucleo/Adjuntos.md`.
