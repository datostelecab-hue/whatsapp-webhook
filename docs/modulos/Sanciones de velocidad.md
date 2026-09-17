---
tags: [modulo, operaciones, velocidad, whatsapp]
ruta: /sanciones
codigo: modules/Operaciones/sanciones.service.js
---

# Sanciones de velocidad

Del **exceso que detecta [[Mapon]]** al **aviso de WhatsApp** al conductor, y de ahí a un **registro que queda**. La pregunta que contesta el módulo no es "a quién multamos": es **quién sigue corriendo después de que se le diga**.

La ruta se sigue llamando `/sanciones` porque es la clave del permiso y la que la gente tiene guardada, pero **el módulo ya no sanciona: avisa**.

## El flujo, cada 15 minutos

1. **`mapon_alerta`** — la ingesta de Mapon trae todas las alertas cada 15 min. Las de tipo `speeding` llevan su clave, su instante y su matrícula.
2. **`fv_tramo`** — la ingesta de [[BOLT]] (cada 5 min) dice qué conductor llevaba ese coche y entre qué horas, y por tanto **quién iba al volante en ese minuto**.
3. **Se avisa.** Siempre, con la misma plantilla, tantas veces como haga falta.
4. **Queda registrado** en `velocidad_exceso`, y de ahí salen las dos preguntas del módulo: cuántas veces se le ha dicho a cada uno, y qué ha pasado.

> **Este módulo no llama a ninguna API.** Todo sale de PostgreSQL. Lo único que sale fuera es el WhatsApp, que es el trabajo.

## Por qué ya no se llama a ninguna API

Porque ya lo sabíamos, y para eso se hizo la ingesta.

El módulo le preguntaba a Mapon por las alertas de velocidad —que la ingesta acababa de guardar en `mapon_alerta`, **con la misma clave** que usa el dedup— y después le preguntaba a BOLT quién conducía —que la ingesta tiene en `fv_tramo`—. Dos APIs para leer lo que había en casa.

Y lo de BOLT se hacía de la peor manera posible: **por cada exceso, hasta siete barridos paginados** de `getFleetStateLogs` con ventanas crecientes (15 min, 30, 1 h, 6 h, 24 h, 3 días, 15 días) contra las dos flotas. Medido el 10/09/2026:

| | Antes (API de BOLT) | Ahora (PostgreSQL) |
|---|---|---|
| Ventana de 15 días | **65.884 logs, 90 segundos** (+5 s por cada HTTP 429) | — |
| Una resolución | — | **33 ms** |
| Las mismas 30 alertas | minutos | **2,6 segundos** |

Y ese camino —el largo— era justo el que recorrían los coches que **no** están en BOLT: **minuto y medio para acabar diciendo "no hay conductor"**. Por eso el botón "Revisar ahora" se quedaba pensando.

**Además es más exacto.** La API daba la antigüedad del último *cambio de estado* anterior al exceso; ahora se sabe si el instante cae **dentro** de un tramo, que es la certeza de que esa persona estaba conectada en ese momento. Contrastado contra los 30 excesos ya registrados: mismo conductor en los 24 resolubles, **cero discrepancias**, y los 30 caen dentro de su tramo.

## Si la ingesta no ha llegado, se espera

Antes de atribuir nada se pregunta **hasta cuándo sabe la ingesta de BOLT** (`frescuraIngesta()`). Si el exceso es posterior a eso, **no se escribe nada**: se deja para la pasada siguiente.

Va primero que nada porque, si no, un tramo todavía **abierto** contesta que sí a cualquier instante posterior: el coche "sigue" con su último conductor, y un exceso de dentro de una hora saldría atribuido a quien iba esta tarde.

> No es lo mismo "no había nadie" que "todavía no lo sé". Registrarlo como *sin conductor* sería mentir, y además **definitivo**: la clave quedaría en el libro y ese exceso no se volvería a mirar nunca.

## Media hora: hasta ahí es un dato, más allá es una conjetura

`VENTANA_FIABLE_SEG` = **1.800 segundos** (`SANCIONES_VENTANA_FIABLE`).

El motivo es el relevo. Estos coches cambian de manos cada turno, y entre que uno lo deja y el otro se conecta hay un hueco de silencio en los logs. Si el último rastro es de hace 45 minutos, el exceso puede perfectamente ser del que acaba de recibir el coche y aún no se ha puesto en marcha en BOLT: **avisar al anterior sería cargarle lo que hizo otro**.

Por encima de media hora el caso **se registra pero no se avisa a nadie**: queda como `dudoso`, para mirarlo a mano. Es preferible revisar que acusar al que no fue.

*(La intención a futuro es que el propio `busy` haga de fichaje del relevo —el que entrega lo quita, el que recibe lo pone— y entonces la responsabilidad dejará de deducirse y pasará a estar declarada.)*

## Los estados de un exceso

| Estado | Qué es |
|---|---|
| `avisado` | se le mandó el WhatsApp |
| `simulado` | modo pruebas: se **habría** mandado |
| `sin_conductor` | el coche no tenía a nadie identificable |
| `dudoso` | hay candidato, pero el log es demasiado viejo |
| `error` | se intentó mandar y falló |

Viven también en el `CHECK` de la tabla: si se añade uno aquí, hay que añadirlo allí.

> **"Avisado" es solo `avisado`.** Los tuve juntos con `simulado` y estaba mal. La lista de "quién no hace caso" es lo que alguien lleva delante cuando se sienta a hablar con un conductor, y decirle *"te hemos avisado cinco veces"* cuando no ha recibido ni uno es **la peor manera posible de empezar esa conversación**. Los simulados se cuentan aparte y se ven aparte.

## El aviso

Siempre el mismo: la plantilla **`advertencia_limite`**, ya aprobada en Meta, con el nombre y la matrícula como variables (`services/whatsapp.js`, envío posicional).

**No hay una segunda plantilla ni un segundo tono.** Si alguien no hace caso, lo que cambia no es el mensaje sino el número de veces que aparece en la lista.

### Relleno hacia atrás

Al procesar días viejos (`sinAvisar`) **se registra el exceso pero no se manda el WhatsApp**. Un aviso por algo que pasó hace diez días no avisa de nada —el conductor ya no se acuerda de ese trayecto— y además llegarían treinta de golpe. Pero el exceso sí tiene que quedar contado: es lo que alimenta la calificación del conductor, y para eso da igual que se avisara o no. **Un exceso es un exceso.**

### Cuentas prestadas

Si a alguien le suspendieron la suya y sale con la de otro, **el exceso es suyo**: manda `cuenta_fantasma` sobre el titular, resuelto por la fecha del exceso, porque la misma cuenta puede estar prestada a uno en septiembre y a otro en octubre. El **teléfono es el de la persona**, no el de la cuenta: el aviso tiene que llegarle a quien iba al volante.

Sin esto, la cuenta no tenía dueño, el aviso no se mandaba a nadie, no entraba en su libro y tampoco le bajaba la calificación —donde la velocidad pesa un **20 %**—. Un conductor con la cuenta prestada conducía sin consecuencias.

## El registro legal: `velocidad_exceso`

Es el libro. Una fila por exceso, con la clave de Mapon como identidad única: instante, matrícula y coche nuestro, `driver_uuid` y ficha del conductor, teléfono, velocidad, límite, exceso, coordenadas, estado, plantilla, id de envío, hora de envío, la ventana en segundos y una **nota en castellano** que explica por qué se decidió lo que se decidió.

**Si la clave ya está, no se toca** (`ON CONFLICT (clave) DO NOTHING`): un exceso registrado es un hecho, y una segunda pasada del cron no puede reescribirlo ni mandar otro aviso por lo mismo. El dedup es un `NOT EXISTS` en la propia consulta, no un `Set` en memoria.

Las notas distinguen casos que se arreglan de forma distinta: *"La matrícula no está en Bolt"* no es lo mismo que *"El coche estaba desconectado de Bolt en ese momento"*.

## Lo que este módulo ya no hace

Antes era un **expediente sancionador**: la primera vez avisaba y, a partir de la segunda dentro de tres meses, abría un caso que alguien tenía que aprobar a mano para mandar otra plantilla más dura.

En la práctica eso lo convertía en una **bandeja de aprobaciones**, y lo que de verdad se quería saber —quién sigue corriendo después de que se le diga— quedaba enterrado entre estados.

Ahora el mensaje es siempre el mismo y siempre automático. **La escalada, si hace falta, la decide una persona mirando quién acumula avisos: eso es información, no un trámite.**

En el recuento por conductor, `desde_el_primero` es lo que separa a quien tuvo un mal día de quien lleva meses ignorándolo: **diez avisos en tres días son una racha; diez en seis meses son una costumbre.**

## Configuración

Todo por variables de entorno:

| Variable | Qué hace |
|---|---|
| `SANCIONES_MODO` | `live` envía de verdad. Cualquier otra cosa es **`test`**, que es el valor por defecto: no manda nada y marca `simulado`. |
| `SANCIONES_CRON` | `on` enciende el cron. **Apagado por defecto.** |
| `SANCIONES_DESDE` | Fecha de alta del sistema, `aaaa-mm-dd`. |
| `SANCIONES_VENTANA_FIABLE` | Segundos de la ventana de atribución fiable. Por defecto 1.800. |

**La fecha de alta no es un filtro de pantalla.** No se puede sancionar por reincidencia usando excesos anteriores a que el sistema existiera: al conductor nunca se le avisó de ellos, así que **no puede "reincidir"**. Con esa fecha puesta, todo lo anterior ni se registra ni cuenta como infracción previa. También evita que una consulta con rango amplio mande WhatsApps por excesos de hace meses.

El cron corre a `3,18,33,48 * * * *` — con desfase, para no coincidir con el resto de las pasadas en punto. La ventana de lectura por defecto son **3 días**: ya no cuesta nada, porque es una consulta, y así una alerta que Mapon entregue con retraso se recoge igual. **Lo que evita repetir avisos no es la ventana: es la clave.**

## Las piezas

```
sanciones.controller.js   /sanciones · una sola llamada pinta la pantalla entera
sanciones.service.js      la decisión: quién conducía, si se avisa y con qué nota
velocidad.repo.js         el libro, el padrón y las dos preguntas del módulo
vistas/sanciones.ejs      la pantalla
```

`GET /sanciones/api/datos` devuelve las cifras, el ranking por conductor y el histórico en tres consultas. El rango por defecto son **30 días**: el módulo va de acumulación, y en una ventana de un día eso no se ve.

## Ver también

[[Operaciones]] · [[Mapon]] · [[BOLT]] · [[Flota viva]] · [[Base de datos]] · [[Glosario]]
