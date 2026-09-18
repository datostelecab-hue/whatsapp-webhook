---
tags: [modulo, control, alertas, whatsapp, franjas, postgresql]
aliases: [Alertas de control]
---

# Control · Alertas

`/alertas` es la vigilancia de las franjas críticas: cuando un conductor se pasa de la raya, un WhatsApp a los controladores elegidos. Vive en `modules/Control/alertas.controller.js` → `alertas.service.js` → `alertas.repo.js`, con la pantalla en `modules/Control/vistas/alertas.ejs` y las tablas en `db/97-alertas-control.sql`.

El servicio es fino a propósito: la regla de cada umbral y el orden del envío viven en el repositorio, que es quien habla con la base y con WhatsApp. Lo que se gana poniéndolo en un servicio es **la puerta**: desde fuera del módulo —el cron de `app.js`, el cockpit, el Histórico— se entra por `alertas.service` y no por el repositorio. Ver [[Reglas de la casa]].

## Qué dispara un aviso

Tres cosas, y cada una tiene su umbral configurable:

| Tipo | Qué es | Umbral por defecto | Ventana |
|---|---|---|---|
| `sin_respuesta` | deja pasar ofertas **sin contestar** | 5 viajes | la franja |
| `rechazo_directo` | **las rechaza él, con el dedo** | 1 viaje, y solo por debajo del 75 % de utilización | la jornada entera |
| `km_parado` | **rueda** estando en descanso o desconectado | 20 km | la franja |
| `zona_notificacion` | sale del área de trabajo **sin viaje** | cada salida | la franja |
| `zona_madrid` | sale de **Zona Madrid**, aunque vaya de viaje | cada salida | siempre |

**No responder no es rechazar.** Puede ser cobertura, el móvil colgado o el soporte del salpicadero. Por eso aguanta hasta cinco, por eso **no baja la calificación del conductor** (el modelo ABCD no cuenta rechazos, §15) y por eso lo que dispara es una comprobación —"¿qué le pasa, necesita algo?"— y no un expediente.

**Rechazar a dedo salta al primero.** Aquí no se rechaza ningún viaje de ningún tipo: rechazar uno ya es motivo de llamada. Si resulta que iba lejísimos, se justifica por teléfono — pero se pregunta. Por eso el umbral es 1 y no un "a partir de". Y se mide en **toda la jornada**, no solo en la franja: rechazar no está permitido a ninguna hora, así que uno hecho a las 15:30 —entre franja y franja— tiene que sonar igual en cuanto abra la siguiente. Por lo mismo, el texto del mensaje no dice "(franja 08:00-13:00)" para este tipo: sería mentir sobre de dónde salen esos viajes.

### El rechazo solo suena si NO está dando servicio

Rechazar sigue sin estar permitido, pero **un rechazo no significa lo mismo en los dos casos**: quien va al 90 % de utilización está cargado de trabajo y rechazó uno que le venía mal; quien va al 60 % está eligiendo viajes.

Por debajo del **75 %** se avisa; de ahí para arriba **la alerta no se abre siquiera** — ni en pantalla ni por WhatsApp. La pantalla aplica el mismo filtro que el envío a propósito: si dijera «esto está pasando» de gente a la que nunca se va a avisar, Tráfico llamaría igual y el filtro no habría servido de nada.

Utilización = **horas en viaje sobre horas efectivas** (viaje + espera) de su jornada. Es la misma cifra de [[Calificacion de conductores]] y de la ficha 360, pero se calcula aquí sobre `fv_tramo` y **no** sobre las vistas de BI (`bi_*`): la alerta tiene que poder contestar ahora mismo, sin esperar a que BI esté calculado.

> [!note] Sin utilización se avisa igual
> Cero horas efectivas no es «cero por ciento», es «no se sabe» — y alguien con cero horas que además rechaza es justo el caso que hay que mirar.

Medido el 18/09/2026 en la franja de mañana: de **21 conductores con rechazo directo, 16 dejan de sonar y quedan 5**. Se callan quien lleva 10 rechazos al 86,4 % y quien lleva 6 al 93 %; sigue sonando quien lleva 14 al 45,9 %.

### Las dos alertas de zona

Mapon vigila geocercas y dispara `not_in_obj` cuando un coche se sale. Las alertas entran por la puerta de siempre —la pasada de [[Ingesta|flota viva]], cada 5 minutos— y se guardan crudas en `mapon_zona_alerta`. → [[Mapon]]

**Las dos zonas no significan lo mismo, y por eso son dos tipos:**

- **«Zona Notificación»** es el área de trabajo. Salir de ahí **sin viaje** y en horas de vigilancia es raro —tienen que estar cerca de la M30—; salir **con viaje** es su trabajo. Solo cuenta para coches del cuadrante.
- **«Zona Madrid»** es enorme: de ahí no se sale ni con pasajero. Suena esté de viaje o no, a cualquier hora, y también con coches que no están en el cuadrante — que son los que más preocupan.

> [!warning] Ir a por el pasajero y llevarlo son la MISMA situación
> En flota viva, `has_order` (va de camino), `riding` (lo lleva) y `on_order` caen todos en `viaje`. Las dos cosas son su trabajo, así que las dos callan la alerta de notificación. Sin ese filtro sonaría cada vez que alguien lleva un cliente a Alcalá.

**La franja se mide sobre la HORA DE LA SALIDA**, no sobre la del cron: si no, una salida de las 12:58 dejaría de contar por revisarse a las 13:06 — que es justo para lo que existen los minutos de cortesía.

**El conductor sale del TRAMO, no de la alerta**: Mapon no sabe quién va dentro. Y cuando no hay tramo, el aviso lo dice con todas las letras —«SIN CONDUCTOR FICHADO»—, porque ese es el caso que hay que mirar primero. → [[Control Coches sin cuadrante]]

Plantillas propias `zona_notificacion` y `zona_madrid`, con la reserva de siempre: si aún no están aprobadas en Meta, el aviso sale por la genérica y no se pierde.

> [!danger] Depende de un setup que vive en Mapon, no aquí
> «Zona Madrid» ya dispara. **«Zona Notificación» no tiene setup de *fuera de zona* en la cuenta de Mapon** (en la semana del 11 al 18/09 no disparó ni una), así que ese aviso no sonará hasta que se cree desde la app de Mapon. El código está listo y no hay forma de saberlo desde aquí: una alerta que no llega es indistinguible de una zona de la que nadie sale.

## La franja

Dos franjas al día, en hora de Madrid, definidas en el `MODELO` de `alertas.repo.js`:

- **Mañana** 08:00 → 13:00
- **Noche** 20:00 → 01:00 (cruza medianoche)

**Fuera de la franja no se avisa a nadie.** `franjaDe()` devuelve `null` en el hueco entre franjas, y eso es a propósito.

`franja_dia` es **el día al que pertenece la franja, no el del reloj**: a las 00:30 seguimos en la franja de noche de ayer, y es ahí donde tiene que contar el conductor para no avisar dos veces de lo mismo al cruzar la medianoche.

**Hay 10 minutos de cortesía** (`graciaMin`) después de cerrar. Las órdenes de BOLT llegan con algo de retraso, y sin ese margen lo que cruzaba el umbral a las 12:58 no se llegaba a avisar nunca.

**Los instantes de la franja los monta PostgreSQL, no JavaScript.** `new Date('2026-09-11T08:00:00')` usa el reloj del servidor, y Render va en UTC: las ocho de la mañana habrían sido las diez en Madrid, y en invierno las nueve. Así que la franja viaja como (día, hora, salto de día) y la base la clava con `AT TIME ZONE`, igual que en Visibilidad y en el núcleo. Ver [[Jornada y turnos]] y [[Base de datos]].

**Los km se prorratean por tiempo.** Un tramo de descanso que empezó antes de que abriera la franja trae kilómetros de antes, y cargarlos enteros sería acusar a alguien de lo que hizo a otra hora: se cuenta solo la parte del tramo que cae dentro. Los tramos que nacen y mueren dentro de la franja —la mayoría— van enteros y son exactos. El corte de los tramos (`FIN_KM`, `TOPE_TRAMO_ABIERTO`) **no se copia aquí**: se importa de `services/flotaViva/rutas`, porque si la alerta repartiera los km con una regla y la pantalla con otra se llamaría a la gente con un número que no sale por ningún lado.

**Las horas que se enseñan en el aviso son las efectivas (viaje + espera) de su jornada operativa** (05:00 → ahora), no las de la franja: quien recibe el aviso quiere saber si el tío lleva dos horas o diez, no cuánto lleva desde las ocho.

La franja pertenece siempre a la jornada de su propio día. Eso se corrigió para poder **mirar hacia atrás**: antes la jornada salía de `ahora` y en vivo daba igual, pero preguntando por la franja de mañana del día 3 contaba los viajes desde las 05:00 de hoy. Con el arreglo, el [[Control]] · Histórico puede reconstruir las alertas de un día ya cerrado recorriendo las dos franjas con la **misma consulta** que dispara los WhatsApps.

## Un mensaje por alerta: lo garantiza el índice único

> [!warning] Son DOS índices, y cada uno manda en lo suyo
> `uq_alerta_control_persona (tipo, driver_uuid, franja_dia, franja)` es «un aviso por conductor y franja», y es **parcial**: solo vale donde `mapon_alerta_id IS NULL`. En las de zona manda `uq_alerta_control_mapon`, cuya clave es el **id de la alerta de Mapon** — la única definición honesta de «esta salida ya se avisó».
>
> Hizo falta separarlos (db/141): un coche puede salirse de la zona dos veces en la misma franja con el mismo conductor dentro, y son dos salidas. Con el índice entero la segunda **reventaba el INSERT** con una violación de unicidad que el `ON CONFLICT` no atrapaba —mira el otro índice— y se caía la revisión completa.
>
> Y un `ON CONFLICT` sobre un índice **parcial** tiene que repetir su predicado (`... WHERE mapon_alerta_id IS NOT NULL`), o Postgres contesta `42P10`.

La regla es que el mismo conductor puede levantar las tres alertas en la misma franja —son tres avisos distintos— pero **cada una suena una sola vez**: que siga rechazando después del aviso no vuelve a molestar a nadie.

Eso **no se resuelve con un `if`**. Se resuelve con el índice único de `db/97-alertas-control.sql`:

```sql
CREATE UNIQUE INDEX uq_alerta_control
  ON alerta_control (tipo, driver_uuid, franja_dia, franja);
```

Y el `INSERT` de `revisar()` es el que decide si la alerta es nueva:

```sql
INSERT INTO alerta_control (...) VALUES (...)
ON CONFLICT (tipo, driver_uuid, franja_dia, franja) DO NOTHING
RETURNING id
```

Si no devuelve fila, no se manda nada. Dos pasadas del cron a la vez —o el botón "Revisar ahora" pulsado mientras corre el cron— no pueden mandar el mismo aviso dos veces. **Un guardia escrito en JavaScript sí se lo salta.**

Por eso el botón es seguro de pulsar: **revisar a mano hace exactamente lo mismo que el cron**, no es un camino distinto con sus propias reglas. Si la franja está cerrada no manda nada, y lo ya avisado no se repite.

## Quién lo recibe

**Por usuario y sin mirar el rol**, que es justo lo que se pidió: el controlador de noche recibe y el jefe de tráfico puede no recibir, aunque tenga más permisos. La lista vive en `alerta_control_destinatario` y se fija entera desde la pantalla (los que vengan reciben, los demás dejan de recibir).

El teléfono sale de la ficha del usuario, salvo que se rellene uno alternativo en la tabla (un número de guardia, por ejemplo).

**Quien no tiene teléfono no recibe**, y hay que verlo antes de contar con él. `telefonoUtil()` no se conforma con contar nueve dígitos: en las fichas hay números de relleno —`000000000`— puestos para poder crear la cuenta, y **esos pasaban el filtro**. El aviso se daba por mandado, Meta lo rechazaba y nadie se enteraba de que el controlador no recibió nada. Un número de un solo dígito repetido no es un teléfono. La pantalla marca a esos con `sinTelefono`.

Si no hay nadie a quien avisar, la alerta se registra igual y queda en estado `sin_destinatarios`.

## Nace apagado

**Modo `test` y sin destinatarios.** Registra las alertas (estado `simulada`) y no manda nada. Hasta que no se elige a alguien en `/alertas/config` y se pasa el modo a `live`, no sale un solo WhatsApp por mucho que alguien rechace viajes.

**Cortafuegos:** `maxPorFranja` = 25. Si un día se disparan cuarenta, algo pasa con los datos o con el umbral, y lo último que ayuda son cuarenta WhatsApps. Se avisa de los peores —la lista se ordena por **exceso sobre el umbral**, no por valor bruto— y el resto queda en la pantalla.

**Sin la tabla** (migración sin aplicar) el módulo se ve pero no alerta: `leerConfig()` devuelve el modelo con `sinTabla` y `revisar()` no hace nada. Ver [[Base de datos]] y la regla de no ejecutar `db/*.sql` a mano.

## El mensaje

Sale por plantilla de WhatsApp con cuatro variables posicionales: **nombre en BOLT · teléfono · horas efectivas de la jornada · qué ha hecho**. El nombre de la plantilla genérica vive en la variable de entorno `PLANTILLA_ALERTA_CONTROL` (por defecto `alerta_control`) y se puede cambiar desde los ajustes.

Cada tipo puede tener **plantilla propia** (`PLANTILLA_ALERTA_RECHAZO_DIRECTO`, `PLANTILLA_ALERTA_SIN_RESPUESTA`, `PLANTILLA_ALERTA_KM_PARADO`). Nacen vacías a propósito: mientras lo estén, los tres tipos salen por la genérica y esto no cambia nada. Con plantilla propia el texto fijo ya dice qué ha pasado, así que la cuarta variable lleva solo la cifra ("3 viajes") en vez de la frase entera — salvo los km, que se quedan con la franja porque sin ella "24,6 km" no dice de cuándo son.

**Si la plantilla propia todavía no está aprobada en Meta, el aviso no se pierde:** sale por la genérica con su frase larga. Y solo se reintenta cuando el fallo es *esa plantilla no se puede usar* (`132001`, `132015`, `132016`, "paused", "disabled"); un fallo de número de parámetros o de teléfono daría igual con otra plantilla y gastaría envíos. Ver [[Glosario]].

Lo que quedó a medias en la misma franja (un fallo de red, una plantilla aún sin aprobar) se **reintenta**, con tope de 3 intentos por destinatario: la alerta ya existe, así que no se duplica.

## El cron, y por qué solo a esas horas

`app.js` programa la revisión cada 5 minutos **dentro de las franjas**:

```
*/5 8-13,20-23,0-1 * * *     timezone: Europe/Madrid
```

Fuera de ellas el propio módulo no hace nada, pero no se programa a todas horas para no preguntar 288 veces al día lo que solo importa en diez.

## La pantalla

- **Estado** — la franja en curso, el modo (`test` / `live`) y a quién le llega.
- **Está pasando AHORA** — quién está por encima del umbral en la franja en curso, **esté avisado o no**. Es la diferencia entre "saltó una alerta" y "esto está pasando".
- **Las alertas del día** — el historial con su hora, valor, umbral, estado y a quién se le mandó. El umbral se guarda **en la fila**: sin él, una alerta vieja no se puede leer después de cambiarlo.
- **Revisar ahora** — el botón, que hace lo mismo que el cron y devuelve el estado recién calculado para que la pantalla se repinte sin una segunda petición.
- **Ajustes** — umbrales, quién recibe, modo de envío, plantilla y tope por franja.

## Los dos permisos

Mirar las alertas es una cosa; decidir **quién las recibe** y a partir de cuántos rechazos suenan es otra:

- `/alertas` — ver la pantalla y el histórico, y pulsar "Revisar ahora".
- `/alertas/config` — cambiar umbrales y destinatarios. Está marcado **`manual`** en el catálogo de `services/permisos.js`: nace apagado **hasta para quien lleva el catálogo entero** y lo reparte el desarrollador usuario a usuario. Era el requisito, literal: *"solo yo elijo a quién le llegan"*.

La vista comprueba el permiso para ni siquiera pintar el botón de Ajustes, y el controlador cuelga las dos rutas de escritura de `/alertas/config/api/*` para que el candado sea el prefijo y no el botón. Ver [[Permisos]].

## Dónde más se usa la franja

La configuración de este módulo la leen dos sitios más, y a propósito, para que todos repartan los km con la misma regla:

- **[[Control En directo]]** — el aviso `km_parado` y el de `sin_respuesta` del cockpit miran solo desde que abre la franja, no la jornada entera. Con la jornada entera pasaban de 20 km 22 personas; con la franja, 6.
- **`historico.service.alertasDeFranja()`** — reconstruye las dos franjas de un día cerrado con la misma consulta `candidatos()`, porque el cockpit solo conoce la franja en curso y esas dos alertas son justo las que más falta hacen al día siguiente, cuando toca explicar por qué no se cumplieron los horarios.

## Ver también

[[Control]] · [[Control En directo]] · [[Control Reportes]] · [[Permisos]] · [[BOLT]] · [[Mapon]] · [[Base de datos]] · [[Glosario]]
