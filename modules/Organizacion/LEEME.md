# Organización

El área, el superior y las funciones de cada persona de la oficina: quién
aprueba, a quién le llega cada tarea. Pieza A5 de `docs/Hoja de ruta.md`
(13/11/2026, db/248).

```
organizacion.controller.js   la pantalla /organizacion y su API
vistas/organizacion.ejs      la pantalla (Listado)
```

## Lo que NO vive aquí, y es una decisión

El catálogo de funciones y las reglas están en `services/organizacion.js`, no
aquí: los usará todo el ERP (`quienes`, `exigir`, `superiorDe`, `equipo`), y si
vivieran en este módulo todos dependerían de él. Es transversal, como
`services/permisos.js`.

## Quién entra

Los mismos que en Usuarios y permisos: el desarrollador por su rol, o quien
tenga la llave `/usuarios` (Ignacio). Entrar no da ninguna función: una
función se mira en la persona, nunca en el rol.

Ver `docs/modulos/Organizacion.md`.
