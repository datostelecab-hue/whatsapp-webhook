# Portal de conductores (`conductorestelecab.es`)

Lo que cada conductor ve de sí mismo, desde el móvil: sus **turnos** de hoy a 7
días y su **puntuación semana a semana**. Sus horas todavía no (Camilo,
19/10/2026). Es otro sitio, en otro dominio, servido por el mismo servidor que el
ERP: `porDominio` va en `app.js` antes que todo lo del ERP y se queda con las
peticiones de su dominio (`PORTAL_HOSTS`).

```
portal.controller.js   las rutas y la frontera por dominio (porDominio): /entrar,
                       /entrar/codigo, /salir, /, /turnos, /puntuacion, /efectivo
portal.service.js      el acceso (pedirCodigo, entrar, quienEs, salir) y lo que
                       ve (inicio, turnos, semanas); el correo con el código
portal.repo.js         códigos, sesiones y quién puede entrar (db/211)
formato.js             fechas, semanas, teléfonos y nombres, para las vistas (puras)
vistas/                portalLayout + Entrar, Inicio, Turnos, Puntuacion, Efectivo, Aviso
                       y los trozos Relevo y Partes
public/assets/css/portal.css   su hoja: los tokens de la casa, sin Tailwind
```

El acceso: DNI o NIE → un código de 6 cifras al email de su ficha (10 minutos, 5
intentos, un uso) → una sesión de 30 días que vive en la base y se puede cerrar.
Los turnos salen de `cobertura.service.proximosDe` (lo mismo que «Ver mis turnos»
del bot), la puntuación de `services/repo/puntuacionSemanal.js` (db/210), la
facturación del mes de `nominas.service` (dineroDe, umbralFASDe) y el efectivo de
`recaudacion.service.extractoDe`.

Se prueba en el entorno local (`scripts/entorno-local`), con
`conductor-de-prueba.js` para no escribir el DNI de nadie de verdad. Comprobador:
`scripts/comprobar-portal.js`. Nota del vault: `docs/modulos/Portal de conductores.md`.
