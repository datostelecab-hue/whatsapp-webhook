# Operaciones

Qué hace la flota cuando nadie mira. Los avisos del coche, los kilómetros que no
cuadran, quién corre de más y el calendario de lo que de verdad pasó cada día.

```
/operaciones                      las alertas de Mapon
/operaciones/auditoria            KM del GPS vs KM facturado, y repostajes
/operaciones/fichaje/diagnostico  la herramienta de Mapon (por URL, sin botón)
/sanciones                        excesos de velocidad
/bitacora  ·  /bitacora/general   el calendario de la plantilla
```

## Las piezas

```
operaciones.controller.js   HTTP. No decide nada.
operaciones.service.js      alertas, auditoría, descargables y las dos pasadas de la ingesta
auditoria.service.js        el cálculo de la auditoría · auditoria.repo.js  su SQL
auditoria.excel.js          las cinco tablas, un Excel por cada una
alertasMapon.repo.js        SQL de los avisos que trae la ingesta
mapon.diagnostico.js        la herramienta: preguntarle a Mapon en crudo
sanciones.controller.js     /sanciones · sanciones.service.js · velocidad.repo.js
bitacora.controller.js      /bitacora · bitacora.service.js · bitacora.repo.js
vistas/  operaciones · auditoriaFlota · sanciones · bitacora · bitacoraGeneral
```

Desde fuera del módulo se entra por un `.service`, nunca por un `.repo`.

## Lo que hay que saber

**Las alertas ya no se le piden a Mapon en cada carga.** Las trae la ingesta cada
15 minutos y aquí se leen de PostgreSQL. Antes, si Mapon estaba caído la pantalla
no decía "esto es de hace un rato": decía error. Y como la ventana de su API es
de 31 días, lo anterior **no existía para nadie**. Por eso se sirve también la
**frescura**: es lo que distingue "no ha pasado nada" de "hace rato que no llega
nada".

**El título y el icono de cada tipo de alerta son presentación**, y se ponen en
el servicio, no en la tabla: cambiar cómo se llama un tipo en pantalla no puede
exigir una migración ni reescribir el histórico.

**La auditoría se sirve del histórico.** Solo hoy y ayer tocan las APIs. Y **se
cura sola**: si ayer ya está calculado, la pasada nocturna se ocupa del día
pendiente más antiguo de la última semana, uno por vuelta. Un fallo suelto deja
de necesitar que alguien lo vea.

**Hay parada de emergencia, y no es un adorno.** Un backfill largo consume mucha
cuota de Google y puede dejar sin servicio al resto del ERP —el login también lee
de Sheets—. Se acepta por GET a propósito, para poder cortarlo desde la barra del
navegador sin reiniciar nada.

**Un Excel por tabla, no un libro de cinco hojas.** Quien pide "la auditoría"
casi siempre quiere una de las cinco, y un libro obliga a buscar la suya antes de
poder mandarla a nadie. Cada una lleva TODAS sus columnas, incluidos los
conductores que BOLT vio en ese tramo, que en pantalla no caben.

**La bitácora se cachea tres minutos y se invalida al escribir.** La rejilla se
rehace en cada carga y es cara; refrescar no puede repetirla entera. Pero al
poner una J o una libranza la caché se tira, para que el cambio salga YA y no
dentro de tres minutos — que es cuando quien lo hizo ya se ha ido.

**Las dos bitácoras leen el MISMO `/api/datos`.** La del día a día y la general
son dos formas de mirar la misma rejilla. Dos consultas distintas del mismo dato
acabarían pintando distinto, y el día que no cuadraran nadie sabría cuál creer.

**Lo pasado está sellado.** `bitacora_horas` guarda el histórico ya calculado, y
por eso un mes cerrado sigue diciendo lo mismo mañana. Resellar es la salida para
cuando cambia algo que afecta al pasado a propósito, y por eso es del
desarrollador: reescribe histórico.

**La libranza manual vive en `bitacora_dia`; el planificador no se toca.** El
cuadrante dice lo que estaba planificado y la bitácora lo que de verdad pasó.

## La herramienta de Mapon

`mapon.diagnostico.js` no tiene pantalla ni enlace, a propósito: se llama por URL
cuando hace falta, y quien la escribe sabe lo que hace. Existe porque los nombres
de los campos de Mapon —`mileage`, `last_update`— y sus unidades no están
documentados en ningún sitio nuestro, y porque el error 1006 del relé podía ser
de permiso o de que estuviéramos mandando mal la petición.

**Nunca se toca un coche en marcha.** Antes de mandar cualquier orden al relé se
pregunta la velocidad. No es una cortesía: cortar el motor a un coche con un
pasajero dentro es lo único irreversible que hay en todo el ERP.

## Dos comprobadores que no miraban aquí

Al mudar este módulo salieron a la luz dos agujeros en la red de seguridad, y los
dos por la misma causa: **no escaneaban `modules/`**.

- **`comprobar-ingesta.js`** vigila que nadie llame a BOLT o a Mapon por su
  cuenta. Al no mirar en `modules/`, cada módulo mudado salía del alcance de la
  regla sin que nadie lo decidiera. Al arreglarlo aparecieron dos ficheros reales
  fuera de control: `Conductores/cazamiento.repo` (que es un brazo legítimo de la
  ingesta, y la lista aún lo llamaba por su nombre viejo) y el `setups` de este
  módulo, que preguntaba a Mapon en caliente desde una pantalla.
- **`comprobar-rutas.js`** acusaba de "sin ruta" a `/bitacora/justificar`, que
  aparece **dentro de un comentario** explicando de qué permiso depende un botón.
  Ahora se tiran las líneas que empiezan por `//` antes de mirar. Comprobado con
  un sabotaje: una URL mal escrita de verdad sigue saltando.

`setups` se fue a la herramienta: preguntarle a Mapon por **su propia
configuración** —con qué límite avisa— no es traer un dato, así que la ingesta no
puede hacerlo por ti.

## Lo que se quedó fuera, y por qué

**`auditoriaPdf` sigue en `services/`:** lo comparten esta auditoría y el Sankey
de Control.

**`repo/calificacion`, `repo/rendimiento` y `repo/rechazos` tampoco se mueven.**
Son el rendimiento del conductor y los leen Control y Planificación; un
repositorio puede llamar a otro repositorio.

## Lo que aún no está bien

`auditoria.service.js` llama a Mapon y a BOLT por su cuenta, con permiso
apuntado: la traza GPS punto a punto la pide él y se la come al vuelo, porque
guardarla serían 200.000 puntos al día para contestar a lo mismo. Está declarado
en `comprobar-ingesta.js`, no escondido.
