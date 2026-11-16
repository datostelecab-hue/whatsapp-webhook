---
tags: [nucleo, notificaciones, web-push, pwa, hoja-de-ruta]
actualizado: 2026-11-16
---

# Notificaciones al dispositivo

Desde el 16/11/2026 (db/250) el ERP puede **avisar a alguien en su móvil o su ordenador aunque no tenga el ERP abierto**. Es la pieza A8 de la [[Hoja de ruta]]. Hasta aquí solo se avisaba con la pantalla delante: la campana, los contadores y el [[Tiempo real]].

Va por **Web Push**:
1. Al pulsar «Activar», el navegador da una dirección de **su** servicio de avisos (Google, Mozilla, Apple o Microsoft) con dos claves.
2. El servidor manda por esa dirección, cifrado con esas claves y firmado con sus propias claves (VAPID).
3. El servicio lo entrega aunque el navegador esté cerrado.

## Cómo se usa desde un módulo

```js
const push = require('../../services/notificacionesPush');
await push.enviar([usuarioId], {
  titulo: 'Nueva tarea',                        // hasta 80 letras
  cuerpo: 'Revisar la J de Luis (ficha 12)',    // hasta 200
  url: '/tareas/42',                            // al pulsarla; solo páginas del ERP
  etiqueta: 'tarea-42',                         // opcional: la nueva sustituye a la anterior
  urgente: false,                               // opcional: true = se entrega aunque el móvil ahorre batería
});
// → { dispositivos, enviados, fallidos, bajas }
```

- **Sin DNI ni datos sensibles en el texto:** sale en la pantalla bloqueada. Lo que se diga, que lleve a la página, y allí se mira el permiso como siempre.
- **No lanza por un dispositivo que falle:** lo apunta. Si el servicio dice que ya no existe (404/410) o que se firmó con otras claves (403), lo da de baja; si falla cinco veces seguidas, también.
- **Mandar notificaciones a otros es cosa del servidor**, de cada módulo. No hay ninguna ruta para mandárselas a otro.

## Lo que ve cada uno

En **Configuración → Notificaciones**:
- **Este dispositivo:** «Activar» (el permiso del navegador **solo se pide al pulsarlo**: pedirlo al entrar lo bloquea), «Desactivar» y «Mandarme una de prueba».
- **Dónde te llegan:** sus dispositivos, con el último aviso, y «Quitar» en cada uno. Si su sesión está cerrada, lo dice: «ahora no le llegan».
- **Los casos que no van:**
  - bloqueadas en el navegador: cómo permitirlas;
  - en el iPhone o el iPad sin el ERP instalado: cómo instalarlo;
  - un navegador que no puede.

**Brave** no deja recibir notificaciones hasta que se activa *Configuración → Privacidad y seguridad → «Usar los servicios de Google para la mensajería push»*. Si falla al activar en Brave, el mensaje lo dice.

## Solo mientras la sesión siga abierta

Cada dispositivo lleva la **sesión** (`sid`) de la última vez que la pantalla lo confirmó, y **solo se avisa si esa sesión sigue abierta**. Así:
- al **salir**, al **cerrar la sesión desde otro dispositivo** o al caducar, ese navegador deja de recibirlas;
- en un **PC compartido** de la oficina, lo de una persona no sale en la pantalla de la siguiente;
- al **volver a entrar**, la pantalla lo confirma con la sesión nueva (`NotificacionesPush.confirmar`, una vez por sesión y como mucho cada seis horas: la huella de la sesión va en `<meta name="tc-s">`) y vuelven a llegar.

**Confirmar no da de alta** lo que la persona quitó, ni lo que activó **otra persona** en ese navegador. Si alguien entra en un PC donde otro las tenía activadas, ese navegador se suelta y el que acaba de entrar las activa a mano si quiere.

## Seguridad

- **Solo direcciones de los servicios de los navegadores** (`SERVICIOS` en `services/notificacionesPush.js`): `fcm.googleapis.com`, Mozilla, Apple y `*.notify.windows.com`, por https y en el 443. La dirección la manda el navegador y el servidor la va a llamar: si se aceptara cualquiera, el ERP llamaría a donde se le dijera, a su propia red por ejemplo.
- **La notificación solo lleva a páginas del ERP:** `url` empieza por `/`, nunca por `//` ni con otro dominio. El service worker lo vuelve a comprobar al pulsarla.
- **El service worker no guarda nada en caché ni intercepta peticiones** (`public/sw.js`, sin `fetch`): el ERP se sigue cargando del servidor como siempre. Va en `/sw.js` (la raíz) porque desde `/assets` solo controlaría `/assets`.
- **La clave privada VAPID** solo está en Render. Si se cambia, todas las suscripciones hechas con la anterior dejan de valer (el servicio da 403, se dan de baja) y cada uno tiene que volver a «Activar».

## El ERP instalable

`/manifest.webmanifest` (en `app.js`) hace el ERP instalable como una app. En el **iPhone y el iPad** las notificaciones **solo llegan con la web instalada**: Safari → Compartir → «Añadir a pantalla de inicio», y abrirla desde ese icono.

Los iconos están en `public/assets/iconos`, dibujados con la marca:
- 192 y 512 normales, y 512 «maskable» con la marca dentro de la zona segura;
- 180 para el iPhone;
- la insignia de 96, solo el pin en blanco, para la barra del móvil.

## Ponerlo en marcha (lo hace Camilo)

1. **Generar las claves en tu PC**, una vez por servicio:
   ```bash
   node scripts/generar-claves-push.js
   ```
2. **Pegar las tres en Render** (servicio → Environment) y desplegar:

   | Variable | Qué es |
   |---|---|
   | `VAPID_PUBLICA` | la clave pública (va también al navegador) |
   | `VAPID_PRIVADA` | la privada: **un secreto**, solo en Render |
   | `VAPID_CONTACTO` | `https://erptelecab.es` (el servicio de avisos escribe aquí si algo va mal) |

   **Un par distinto para el ERP y para el servidor de pruebas.** No se cambian después: si se cambian, todos tienen que volver a activarlas.
3. **Probarlo:** Configuración → Notificaciones → «Activar en este dispositivo» → «Mandarme una de prueba».

En el [[Entorno de pruebas local]], `arrancar.js` hace unas claves solo de ese PC la primera vez y las guarda en `scripts/entorno-local/push.env` (fuera de git).

## Ficheros

```
db/250-notificaciones-push.sql                         la tabla push_suscripcion
services/notificacionesPush.js                         activar, confirmar, quitar, mias, enviar
modules/NotificacionesPush/notificacionesPush.controller.js   /push/api/*
public/sw.js                                           el service worker (servido en /sw.js)
public/assets/js/notificacionesPush.js                 el componente (en layout-gestion)
public/assets/js/vistas/configuracion/notificaciones.js       la tarjeta de Configuración
public/assets/iconos/                                  los iconos de la app
scripts/generar-claves-push.js                         las claves VAPID para Render
test/notificacionesPush.test.js                        8 pruebas
```

## Pendiente

- Los primeros avisos de verdad: los del tablero de tareas (ítem 1) y los urgentes de los contadores (A9).
- Que la persona elija qué avisos quiere en el móvil (cuando haya más de un tipo).
- No avisar al móvil de lo que ya está viendo en la pantalla (con el [[Tiempo real]]).
