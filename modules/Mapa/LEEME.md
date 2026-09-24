# Mapa de flota — piloto

`/mapa` · permiso `/mapa` · grupo **Tráfico**

Dónde está cada coche y si hay alguien dando servicio, en la misma pantalla.
Junta lo que hoy hay que mirar en dos aplicaciones distintas: **Mapon** (el GPS)
y **Bolt Fleet** (quién está conectado).

**Lo que se busca es el rojo**: un coche que rueda sin que nadie esté conectado
en BOLT.

## Las dos mitades ya existían por separado

| Qué | De dónde sale | ¿Era nuevo? |
|---|---|---|
| Dónde está el coche | `fv_posicion` | **Sí.** Es lo único que se ha añadido |
| Qué hace en BOLT | `fv_ahora` | No. Ya daba situación, conductor, teléfono y km |

La posición **ya llegaba** de Mapon en cada vuelta de Flota viva:
`unit/list.json` la trae en el mismo objeto del que se sacan el estado y el
odómetro, y el código la leía y la tiraba. Lo único que faltaba era guardarla.

## El semáforo

Es la única regla del módulo, y vive en `mapa.service.js` (`tono`). No reparte
por estado de Mapon ni por estado de BOLT: por **los dos a la vez**. Renovado el
24/09/2026, en este orden:

| Tono | Color | Cuándo |
|---|---|---|
| En viaje | verde | de viaje en BOLT |
| En espera en la M-30 | azul | en espera en BOLT, dentro de la M-30 (`m30.js`) |
| En espera fuera de la M-30 | azul que parpadea | en espera en BOLT, fuera de la M-30 |
| Rodando en descanso | amarillo | rueda con el conductor en descanso |
| **Rodando desconectado** | **rojo** | **rueda y no hay nadie conectado** |
| Error de GPS | morado | de viaje en BOLT y Mapon lo da por parado 10 min o más |

Detrás: parado, GPS sin fijar, sin señal y sin nada en Mapon. El detalle, en
`docs/modulos/Mapa de flota.md`.

El rojo junta dos casos a propósito: el coche que está en BOLT con el conductor
desconectado, y el equipo que no casa con ningún coche de BOLT. Los dos son *se
mueve y nadie responde por él*. Cuál de los dos es se dice al pinchar, no en el
color.

> Medido el 21/09/2026 a las 18:00 — 26 trabajando, 2 rodando en descanso y
> **13 rodando sin nadie**, incluidas las dos unidades del 3031LTV y un equipo
> llamado `1159283703` que no es una matrícula.

## Por qué la consulta sale de la posición

`FROM fv_posicion LEFT JOIN fv_ahora`, y no al revés. Si fuera al revés
desaparecerían justo los que hay que mirar: un equipo que rueda y no casa con
ningún coche de BOLT **no tiene fila en `fv_ahora`**. De 108 unidades, 14 no son
coches del ERP y cinco de ellas estaban en marcha.

## La vuelta de 30 segundos

`services/flotaViva/posiciones.js`, cron en `app.js`, **apagado por defecto**
(`MAPA_CRON=on`). Va aparte del motor de Flota viva: ese corre cada 5 min porque
eso es lo que vale para medir horas y km, y arrastrarlo entero cada 30 segundos
sería diez veces el trabajo para el mismo resultado. Esta hace **una llamada y
una escritura**.

**30 segundos y no 5** porque más rápido no da más verdad: medido pidiendo dos
veces con un minuto de diferencia, el equipo del coche renueva cada **~67 s** de
media (mediana de antigüedad: 17 s conduciendo, 3 min parado). Preguntar cada
5 s serían 17.280 llamadas al día para recibir lo mismo.

Lleva bandera anti-solape porque **node-cron no espera a la promesa**: dispara la
vuelta siguiente aunque la anterior siga dentro. A 5 minutos eso no pasa nunca;
a 30 segundos basta con que Mapon tarde 31.

## Lo que cuesta

Medido contra la base de producción el 21/09/2026:

| | |
|---|---|
| Escribir las 108 posiciones | **1 ms** de trabajo (una sola sentencia) |
| La tabla entera | **88 kB**, y no crece: se sobreescribe |
| Un fotograma por el cable | 9,7 kB en crudo, **1,5 kB con gzip** |
| CPU de PostgreSQL a 30 s | **0,003 %** |

No guarda rastro. Guardar cada posición serían 256.000 filas al día, y el
recorrido ya lo tiene Mapon y los km ya están en `fv_ruta` y `fv_odometro`. Lo
único que no había en ningún sitio era el **ahora**.

## El mapa: MapLibre + OpenFreeMap, 0 €

Ni clave, ni cuenta, ni tarjeta, ni límite de vistas. Ningún proveedor cobra por
mover marcadores: todos cobran por **inicializar** el mapa, una vez por carga de
página. Con 15 usuarios son unas 300 al mes.

La URL del estilo está en la vista, en una función de dos líneas
(`estiloDelTema`): cambiar de proveedor es cambiar esa cadena.

**Hubo que tocar la CSP** (`app.js`): los mosaicos vectoriales se piden por
`fetch` — caen en `connect-src` — y MapLibre los dibuja en un Worker creado
desde un blob. Sin `connect-src https://tiles.openfreemap.org` y `worker-src
blob:`, el mapa se queda en gris.

El fondo del mapa se elige por la **luminancia** de `--tc-dark`, no por una
lista de temas claros: vale para los quince de hoy y para el que se añada
mañana.

## Dos decisiones que no son las obvias

**La lista lateral no es un `Listado`.** La regla de la casa dice que toda
pantalla que liste algo use el componente, y aquí no se usa: esto no es una
pantalla que liste, es el **índice del mapa** —se pincha para volar a un
coche— y el componente trae tabla, paginación, KPIs y panel de ficha, que en
una columna de 288 px estorban. Si el mapa crece a pantalla de trabajo, esa
lista sí debería ser un `Listado`.

**El mapa no se reencuadra al refrescar.** Solo la primera vez. Después no:
alguien puede estar mirando una calle concreta, y que la vista salte cada
treinta segundos haría la pantalla inservible.

## Pendiente si el piloto convence

- **Aviso al momento** cuando aparece un rojo. Hoy solo se ve si estás mirando.
  Lo que ya existe —`km_parado` de Control— va por franjas y umbral de 20 km, y
  `rueda_caido` de Flota viva está apagado desde el 08/09.
- **Rastro de las últimas horas** de un coche, si hace falta: hoy hay que ir a
  Mapon.
- **Empujar en vez de preguntar.** Mapon tiene `data_forward/save.json`, que
  manda la posición a un endpoint nuestro y quitaría el sondeo entero.
