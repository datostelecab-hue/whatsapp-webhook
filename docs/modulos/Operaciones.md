---
tags: [modulo, operaciones]
ruta: /operaciones
codigo: modules/Operaciones/
---

# Operaciones

Qué hace la flota cuando nadie mira: los avisos del coche, los kilómetros que no cuadran, quién corre de más y el calendario de lo que de verdad pasó cada día.

## Las pantallas

| Ruta | Qué es | Permiso |
|---|---|---|
| `/operaciones` | Las alertas de [[Mapon]] (exceso, frenazo, golpe, batería, zonas) | `/operaciones` |
| `/operaciones/auditoria` | [[Auditoria de flota]]: km del coche contra lo facturado en [[BOLT]] | `/operaciones/auditoria` |
| `/operaciones/fichaje/diagnostico` | La herramienta de Mapon. Sin pantalla ni enlace: se llama por URL | — |
| `/operaciones/sin-traza` | Bandeja de la Ticketera con lo que el reparto automático no supo clasificar | `/operaciones` |
| `/sanciones` | [[Sanciones de velocidad]] | `/sanciones` |
| `/bitacora` · `/bitacora/general` | [[Bitacora]]: el calendario de la plantilla | `/bitacora` |

Los permisos son **prefijos de ruta** y manda el **más largo** que case con la URL: tener `/operaciones` no abre `/operaciones/auditoria`, porque ese submódulo está en el catálogo aparte (`services/permisos.js`). Escribir en la bitácora es una llave distinta de abrirla: `/bitacora/justificar`, en el grupo de Aprobaciones.

En `app.js` el orden importa: `/operaciones/sin-traza` se monta **antes** que `/operaciones`, para que la bandeja de tickets no se la coma el router del módulo.

## Las piezas

```
operaciones.controller.js   HTTP. No decide nada.
operaciones.service.js      alertas, auditoría, descargables y las dos pasadas de la ingesta
auditoria.service.js        el cálculo · auditoria.repo.js  su SQL · auditoria.excel.js  los Excel
alertasMapon.repo.js        SQL de los avisos que trae la ingesta
mapon.diagnostico.js        la herramienta: preguntarle a Mapon en crudo
sanciones.controller.js · sanciones.service.js · velocidad.repo.js
bitacora.controller.js · bitacora.service.js · bitacora.repo.js
vistas/  operaciones · auditoriaFlota · sanciones · bitacora · bitacoraGeneral
```

Desde fuera del módulo se entra por un `.service`, **nunca** por un `.repo`. Lo comprueba `scripts/comprobar-capas.js`.

## Las alertas ya no se le piden a Mapon en cada carga

Las trae la ingesta cada 15 minutos (`alertas_mapon` en `services/ingesta.js`, ventana de dos días) y aquí se leen de PostgreSQL, de la tabla `mapon_alerta`.

Antes la pantalla llamaba a Mapon en CADA carga. Si Mapon estaba caído, no decía "esto es de hace un rato": decía error. Y como la ventana de su API es de **31 días**, lo anterior no existía para nadie. Por eso el servicio sirve también la **frescura**: es lo que distingue "no ha pasado nada" de "hace rato que no llega nada".

El solape entre pasadas no cuesta nada porque las repetidas se descartan por su clave (`unit_id|instante|tipo`), y una alerta ya guardada no se reescribe: una alerta es un hecho.

El listado se corta en **1.000** alertas y lo dice (`truncado`). Mil ya son más de las que nadie lee de una sentada; lo que importa es avisar para que quien mire acote el rango.

**El título y el icono de cada tipo son presentación** y se ponen en `operaciones.service.js`, no en la tabla: cambiar cómo se llama un tipo en pantalla no puede exigir una migración ni reescribir el histórico.

## La herramienta de Mapon

`modules/Operaciones/mapon.diagnostico.js` no tiene pantalla ni enlace, **a propósito**: se llama por URL cuando hace falta, y quien la escribe sabe lo que hace. Se sirve sin `status: 'ok'` porque se lee como un volcado, no como una respuesta de API.

Existe porque los nombres de los campos de Mapon —`mileage`, `last_update`— y sus unidades no están documentados en ningún sitio nuestro, y porque el **error 1006** del relé podía ser de permiso o de que estuviéramos mandando mal la petición. Aquí se ve, y se deja de suponer.

Es **solo lectura por omisión**. Sin parámetros no toca nada. Lo que sí actúa está marcado uno a uno en la cabecera del fichero: `?ejecutar=`, `?rele=0|1`, `?probarrele=`, `?crear=`, `?asignar=`, `?soltar=`.

> **Nunca se toca un coche en marcha.** Antes de mandar cualquier orden al relé se pregunta la velocidad. No es una cortesía: cortar el motor a un coche con un pasajero dentro es lo único irreversible que hay en todo el ERP.

`?setups=` —con qué límite avisa Mapon ahora mismo— vive aquí y no en la ingesta: preguntarle a Mapon por **su propia configuración** no es traer un dato.

La clave de la API vive en la variable de entorno `MAPON_API_KEY`; el diagnóstico solo dice si está puesta, no la enseña.

## Las dos pasadas de la ingesta

Entran por `operaciones.service.js` y no por los repositorios, porque `services/ingesta.js` está fuera del módulo y la puerta es lo único que permite cambiar esto por dentro.

- **`pasadaDeAlertas()`** — cada 15 min. Trae las alertas de Mapon y las guarda.
- **`pasadaDiaria()`** — una vez al día. La auditoría de flota. Es la tarea más cara con diferencia: una llamada a Mapon por coche.

La diaria **se cura sola**: si ayer ya está calculado, se ocupa del día pendiente más antiguo de la última semana, uno por vuelta. Un fallo suelto deja de necesitar que alguien lo vea. Ver [[Auditoria de flota]].

## Hay parada de emergencia, y no es un adorno

Un backfill largo consume mucha cuota de Google y puede dejar sin servicio al resto del ERP —el login también lee de Sheets—. Por eso `/operaciones/auditoria/procesar/detener` **se acepta también por GET**, para poder cortarlo desde la barra del navegador sin reiniciar nada.

## Dos comprobadores que no miraban aquí

Al mudar este módulo a `modules/` salieron a la luz dos agujeros en la red de seguridad, los dos por la misma causa: **no escaneaban `modules/`**.

- **`scripts/comprobar-ingesta.js`** vigila que nadie llame a BOLT o a Mapon por su cuenta. Al no mirar en `modules/`, cada módulo mudado salía del alcance de la regla sin que nadie lo decidiera. Al arreglarlo aparecieron dos ficheros reales fuera de control.
- **`scripts/comprobar-rutas.js`** acusaba de "sin ruta" a `/bitacora/justificar`, que aparece **dentro de un comentario** explicando de qué permiso depende un botón. Ahora se tiran las líneas que empiezan por `//` antes de mirar, y se comprobó con un sabotaje: una URL mal escrita de verdad sigue saltando.

## Lo que aún no está bien

`auditoria.service.js` llama a Mapon y a BOLT por su cuenta, con permiso apuntado: la traza GPS punto a punto la pide él y se la come al vuelo, porque guardarla serían **200.000 puntos al día** para contestar siempre a lo mismo. Está declarado en `scripts/comprobar-ingesta.js`, no escondido.

## Lo que se quedó fuera, y por qué

- `services/auditoriaPdf.js` no se mudó: lo comparten esta auditoría y el Sankey de Control.
- `services/repo/calificacion`, `rendimiento` y `rechazos` tampoco. Son el rendimiento del conductor y los leen Control y Planificación; un repositorio puede llamar a otro repositorio.

## Ver también

[[Auditoria de flota]] · [[Bitacora]] · [[Sanciones de velocidad]] · [[Mapon]] · [[BOLT]] · [[Flota viva]] · [[Base de datos]] · [[Glosario]]
