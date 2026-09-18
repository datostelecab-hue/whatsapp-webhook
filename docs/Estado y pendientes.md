---
tags: [estado, pendientes]
actualizado: 2026-09-18
---

# Estado y pendientes

Lo que está abierto **hoy**. Esta nota se actualiza; si algo de aquí ya está hecho, se borra de aquí y se cuenta donde toque.

## Decisiones que esperan a Ricardo

- **Los ocho avisos de km mal mandados.** Salieron con números inflados por el fallo del corte de tramos ([[Corte de tramos]]). Afectan a Alvaro Apezteguia (×3), Macilon Dos Santos (×2), Edison Roman Vera y David A. Ibarra (×2). Falta decidir si se marcan como anulados en el libro o se dejan con una nota.
- **La fuente de km de la alerta de WhatsApp.** La alerta sigue midiendo con el GPS mientras las pantallas ya miden con el odómetro ([[Km por odometro CAN]]), así que puede quedarse un 4 % por debajo de lo que enseña Control. Pasarla al odómetro es un cambio pequeño, pero **sube cuántas veces salta**, y el umbral está calibrado sobre cifras de GPS. Es una decisión de negocio, no técnica.
- **Recaudación y cuentas fantasma.** Si alguien cobró en efectivo con una cuenta prestada, la deuda sigue colgada de la cuenta, no de la persona. Es dinero: lo decide Ricardo.
- **15,5 h fuera de las ventanas de cuenta fantasma de William**, sobre todo el 11/09 (6,8 h) y el 14/09 (6,5 h) en la cuenta de Óscar Javier Alvarez. Caen en el hueco entre sus dos enlaces.


## Cabos sueltos del alta (18/09/2026)

- **32 fichas en «Listo para RRHH»** de antes del cambio. Su bandeja sigue funcionando; la duda es si se marcan como alta en bloque o se dejan vaciar a mano.
- **El Excel de altas y el tramo de Ballenoil** (`tramitarAlta`, `avanzarTrasPin`, `services/altasExcel.js`) ya no los usa el recorrido nuevo. No se han borrado porque las 32 de arriba todavía pasan por ahí: cuando esa bandeja quede vacía, se pueden retirar.
- **El importador de códigos de lavado de Ballenoil** del bot de WhatsApp es otra cosa y sigue vivo: lo que desapareció es el paso del PIN en el alta.

## Fuera del ERP: lo que hay que crear en otro sitio (18/09/2026)

- **El setup de «fuera de zona» de «Zona Notificación», en Mapon.** La geocerca existe (id 3029835) pero **no hay ningún setup que dispare cuando un coche sale de ella**: del 11 al 18/09 no saltó ni una. El código del ERP ya la trata, así que el aviso empezará a sonar solo en cuanto se cree el setup desde la app de Mapon. El de «Zona Madrid» sí está vivo. → [[Control Alertas]]
- **Las plantillas `zona_notificacion` y `zona_madrid` en Meta.** Mientras no estén aprobadas, los avisos salen por la plantilla genérica con su frase larga; no se pierde ninguno.

## Pendientes técnicos

- **Credenciales escritas en el código.** Casi todo está bien puesto en variables de entorno, pero quedan dos cosas:
  - `services/bolt.js` lleva el `client_id` y el `client_secret` de OAuth de BOLT **en texto plano**. Es la única credencial del sistema fuera del entorno, y está en el historial de git: sacarla al entorno **y rotarla**, porque quitarla del fichero no la borra del historial.
  - `routes/botPuertas.js` lleva la URL del despliegue de Apps Script que **abre y cierra los coches**. No es una clave, pero un despliegue publicado de Apps Script no pide autenticación: quien tenga la URL acciona puertas.
- **Rotar la clave de Mapon y la cuenta de servicio de Google.** Están en el entorno, como debe ser, pero han circulado.
- **Revisión de seguridad (del laboratorio, 18/09/2026).** Puntos a verificar/endurecer que salieron al auditar el sistema en el lab aislado; el detalle y cómo se prueba cada uno están en [[Seguridad]]:
  - **IDOR en `/documentos/api/doc/:id`** — comprobar la propiedad/ámbito **por registro** en `documentos.service`, no solo el permiso de módulo. Si no, cambiar el número del id lee papeles de otros.
  - **`SESSION_SECRET` obligatorio y largo** — la sesión es una cookie firmada con el rol dentro; sin un secreto fuerte y estable en el entorno, se puede falsificar. Nunca el efímero por defecto.
  - **CSRF** — los POST que cambian estado se aceptan solo por la cookie; falta token CSRF por sesión y `SameSite` en la cookie de sesión.
  - **Firma del webhook del bot de puertas** — verificar `X-Hub-Signature-256` (HMAC con el APP_SECRET de Meta) en cada POST antes de accionar `open_doors`/`close_doors`.
  - **Punto ciego de `comprobar-sql`** — repasar a mano los SQL con interpolación `${...}` de datos de usuario (el comprobador no los ve); todo valor va como `$1`.
  - **`/mi-red` sin clave de permiso** — cualquier usuario logueado ve la topología de red interna; ponerle clave de desarrollador.
  - **Rutas viejas de subida** (`/api/subir`, `/api/archivo/:id`) — arman la carpeta con texto libre (path traversal); retirarlas (ya marcadas «para borrar»).
- **Promover la CSP de recursos a obligatoria.** Hoy va en `Report-Only` (no bloquea, solo avisa en consola) porque la CDN de Tailwind exige `unsafe-inline`/`unsafe-eval`. El camino: compilar Tailwind en el build, quitar la CDN, y entonces hacer la política obligatoria con `nonce`. → [[Seguridad]]
- **`/control/historico` va lento**: unos 26 s de base, más 12 s desde que los km salen del odómetro. Es la pantalla lenta de la casa desde antes; se arregla igual que se arregló En directo (mirar el plan de la consulta, no adivinar).
- **¿Es fija la IP de la oficina?** El reconocimiento de «dentro / fuera de la empresa» usa una IP concreta. Si el operador la cambia, todo el mundo pasa a salir «fuera». Si es dinámica, hay que dejar el prefijo en vez de la IP entera.
- **El móvil sale «fuera» estando en la WiFi de la empresa.** Sin resolver. La forma de salir de dudas es abrir `/mi-red` desde el propio teléfono conectado a la WiFi y mirar qué IP llega.

## Coches con algo raro

- **Ruedan sin que nadie esté conectado en BOLT**: 7550KYT, 3784LFV (949 km, y en Barcelona), 0970LJJ, 5646MDM. El aviso de Control los saca; falta preguntar qué hacen.
- **3031LTV** tiene dos unidades en Mapon.
- **0744MMZ** y **8475KWG** no tienen rastro en Mapon: sus km salen de BOLT y las filas van marcadas.
- **0491KPM** no está dado de alta en la flota.
- **Factura 1204MJY-13195** sin cargar.

## Lo que está en marcha y conviene no olvidar

- **Iniciar y terminar turno por WhatsApp.** Es la solución de fondo a la atribución de kilómetros: mientras no exista, un coche que rueda con la app apagada solo se puede colgar de quien lo llevó por última vez ([[Corte de tramos]]).
- **BI** (`/bi`): se pule cuando el sistema tenga más datos. No se toca por ahora.

Relacionado: [[INDICE]] · [[Historial de decisiones]]
