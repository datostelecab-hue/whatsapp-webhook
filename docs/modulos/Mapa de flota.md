---
tags: [modulo, piloto, trafico]
---

# Mapa de flota

`/mapa` · permiso `/mapa` · grupo **Tráfico** · **PILOTO** (21/09/2026)

Dónde está cada coche y si hay alguien dando servicio, en la misma pantalla.
Junta lo que hoy hay que mirar en dos aplicaciones distintas: [[Mapon]] (el GPS)
y [[BOLT]] (quién está conectado).

> [!important] Lo que se busca es el rojo
> Un coche que **rueda sin que nadie esté conectado**. El resto del mapa es
> contexto; ese es el dato.

## Las dos mitades ya existían por separado

| Qué | De dónde sale | ¿Era nuevo? |
|---|---|---|
| Dónde está el coche | `fv_posicion` | **Sí.** Es lo único que se ha añadido |
| Qué hace en BOLT | `fv_ahora` | No. Ya daba situación, conductor, teléfono y km |

La posición **ya llegaba** de Mapon en cada vuelta de [[Flota viva]]:
`unit/list.json` la trae en el mismo objeto del que se sacan el estado y el
odómetro, y el código la leía y **la tiraba**. Todo el proyecto era dejar de
tirarla.

## El semáforo

La única regla del módulo, en `mapa.service.js`. No reparte por estado de Mapon
ni por estado de BOLT: por **los dos a la vez**.

| Tono | Cuándo | Qué significa |
|---|---|---|
| verde | rueda y está en viaje o espera | lo normal |
| ámbar | rueda estando en descanso | conectado, pero no da servicio |
| **rojo** | **rueda y no hay nadie conectado** | **esto es lo que se busca** |
| apagado | no se mueve | da igual lo que diga BOLT |
| gris punteado | Mapon dice `nogps` | el equipo habla, el GPS no fija: **está donde marca el punto** |
| gris | Mapon dice `nodata` | el equipo no habla: **no se sabe dónde está** |

El rojo junta dos casos a propósito: el coche que está en BOLT con el conductor
desconectado, y el equipo que no casa con ningún coche de BOLT. Los dos son *se
mueve y nadie responde por él*. Cuál de los dos es se dice al pinchar, no en el
color.

> Medido el 21/09/2026 a las 19:00 — 33 trabajando, 2 rodando en descanso y
> **11 rodando sin nadie**, incluidas las dos unidades del 3031LTV y un equipo
> llamado `1159283703` que no es una matrícula. Uno de ellos llevaba **15 h
> desconectado y 47,4 km** en ese tramo.

> [!warning] El «sin señal» lo dice Mapon, no un cronómetro nuestro
> La primera versión marcaba gris todo lo que llevara más de diez minutos
> callado. Estaba mal por los dos lados: un coche aparcado tarda de sobra ese
> rato y no le pasa nada, y un equipo desenchufado hace tres meses salía igual
> que uno que acaba de callarse. **Y peor: en cuanto la vuelta se paraba, el
> mapa entero se iba poniendo gris solo.** Eso es lo que producía los ~60 grises.
>
> Ahora lo contesta Mapon: `nodata` (no habla — los 18 medidos llevaban 13 días
> de media, el peor 87) y `nogps` (habla pero no coge satélite, son minutos).
> Que la VUELTA vaya con retraso se dice una vez y arriba, no pintando cien
> coches de gris.

> [!note] Y `nogps` no es «sin señal» — 23/09/2026
> Estaban los dos en el mismo gris, y no son lo mismo. Medido ese día: los 10
> `nodata` llevaban **18 días de media** callados (el peor 89); los 5 `nogps`
> habían hablado hacía **entre 83 y 250 segundos**. De estos últimos tenemos su
> posición, de hace minutos, y es **la misma que enseña Mapon en su pantalla**
> —que fue justo la queja: *«dice sin señal y en Mapon sí me dice dónde
> están»*—. Ahora `nogps` es su propio tono, **«GPS sin fijar»**, con el borde
> punteado; «Sin señal» queda solo para los que de verdad no hablan.

## Las dos mitades no van al mismo ritmo

Esta pantalla junta **dos vueltas distintas**, y conviene saberlo:

| | Cada cuánto | Qué escribe |
|---|---|---|
| `posiciones.refrescar()` | **30 s** | dónde está el punto |
| la ingesta / el motor | **10 / 5 min** | quién va conectado, la etiqueta |

### Y la mitad de BOLT entra por DOS tuberías

La pregunta del semáforo —*¿hay alguien conectado con este coche?*— se puede
contestar de dos sitios, y el mapa coge **la noticia más fresca de las dos**:

| | Quién la escribe | Cada cuánto | Cómo es |
|---|---|---|---|
| `bolt_state_log` (el **apunte crudo**) | la ingesta | 10 min | una tabla tonta: un apunte por cambio de estado. **Aguanta.** |
| `fv_ahora` → `fv_tramo` (el **tramo**) | el motor de Flota viva | 5 min | construye rachas, km, franjas, odómetro. **Más listo y más frágil.** |

Los dos salen de los mismos logs de BOLT y traen la **hora del apunte**, así que
se comparan y gana el más reciente. Lo pidió Camilo el 23/09/2026 —*«si en
Control sale el estado y se actualiza solo, ¿no puedes sacarlo igual?»*— y
tenía razón: medido ese día, **10 de 94 coches discrepaban y en todos el apunte
crudo iba por delante**, hasta 55 minutos (1085MJY: el tramo decía «descanso» de
las 13:45 y el apunte decía «viaje» de las 14:40).

> [!note] Control leía los TRAMOS, y ahora hace lo mismo
> La intuición era buena pero el ejemplo no: `cockpit.service` y `panel.service`
> leían `fv_ahora` y `fv_tramo` como leía el mapa, así que Control se congeló
> igual ese día. El mismo criterio está ya en los dos sitios de Control que
> enseñan el AHORA — ver [[Control En directo]].

Si se para la segunda, **la pantalla sigue pareciendo viva**: los puntos se
mueven y las etiquetas mienten. Eso es lo que pasó el 23/09/2026 —ver
[[Trampas conocidas]]— y el mapa acusó de «rueda sin nadie» a gente que estaba
de viaje en BOLT.

Desde entonces la cinta dice la edad de **las dos**, y cuando la de BOLT pasa de
diez minutos:

- sale un aviso arriba diciendo de cuándo es,
- los rojos se pintan **huecos** y su explicación lleva el *OJO* delante,
- y **`sueltos()` no devuelve nada**, así que el aviso de [[Control Alertas]] no
  llama a nadie. Llamar a un conductor que está trabajando para preguntarle por
  qué no trabaja se paga dos veces: en el ridículo y en que la próxima vez ya
  nadie se crea el aviso.

## Solo los coches de la casa, y solo de tu sede

`JOIN vehiculo` **INNER**, filtrado por las sedes que puede ver quien mira. De
las 106 unidades de la cuenta de Mapon quedan **88**: se van 12 que no son
coches del ERP —equipos de otra cosa, matrículas nunca dadas de alta, un
`1159283703`— y 6 de Barcelona.

El recorte va por el permiso `/vehiculos/sedes`, el mismo de [[Vehiculos]] y
Mantenimientos, no por un `'madrid'` escrito a mano: así Óscar sigue viendo los
suyos. Ante cualquier fallo, Madrid.

> [!note] Lo que se cae, se cuenta
> Un equipo que rueda y no casa con ningún coche del maestro **deja de salir**.
> Desaparecer a la vista está bien; desaparecer en silencio es que un día falte
> un coche y nadie sepa por qué. Por eso la cinta dice «18 equipos fuera del
> mapa», con el desglose en el tooltip.

## La vuelta de 30 segundos

`services/flotaViva/posiciones.js`, cron en `app.js`, **apagado por defecto**
(`MAPA_CRON=on`). Va aparte del motor de [[Flota viva]]: ese corre cada 5 min
porque eso es lo que vale para medir horas y km. Esta hace **una llamada y una
escritura**.

**30 segundos y no 5** porque más rápido no da más verdad: medido pidiendo dos
veces con un minuto de diferencia, el equipo del coche renueva cada **~67 s** de
media — mediana de antigüedad 17 s conduciendo y 3 min parado. Preguntar cada
5 s serían 17.280 llamadas al día para recibir lo mismo.

Lleva bandera anti-solape porque **node-cron no espera a la promesa**. A 5
minutos eso no pasa nunca; a 30 segundos basta con que Mapon tarde 31 — y una
vuelta medida tardó **8,9 s**, así que no es teórico.

## Lo que cuesta

Medido contra producción el 21/09/2026:

| | |
|---|---|
| Escribir las 106 posiciones | **1 ms** de trabajo (una sola sentencia) |
| La tabla entera | **88 kB**, y no crece: se sobreescribe |
| Un fotograma por el cable | 39 kB en crudo, **5,9 kB con gzip** |
| CPU de PostgreSQL a 30 s | **0,003 %** |
| Coste en dinero | **0 €/mes** |

No guarda rastro: serían 256.000 filas al día, y el recorrido ya lo tiene Mapon
y los km ya están en `fv_ruta` y `fv_odometro`. Lo único que no había en ningún
sitio era el **ahora**.

## El mapa: MapLibre + OpenFreeMap

Ni clave, ni cuenta, ni tarjeta, ni límite de vistas. Ningún proveedor cobra por
mover marcadores: todos cobran por **inicializar** el mapa, una vez por carga de
página. Con 15 usuarios son unas 300 al mes, y el tramo gratis de Google son
10.000 — o sea que también habría salido a cero, pero con tarjeta de por medio.

**Hubo que tocar la CSP** de `app.js`: los mosaicos se piden por `fetch` (caen
en `connect-src`) y MapLibre los dibuja en un Worker creado desde un blob.

El fondo se elige por la **luminancia** de `--tc-dark`, no por una lista de temas
claros: vale para los quince de hoy y para el que se añada mañana. →
[[Componentes de la casa]]

## Dos decisiones que no son las obvias

**La lista lateral no es un `Listado`.** No es una pantalla que liste, es el
**índice del mapa** —se pincha para volar a un coche— y el componente trae
tabla, paginación, KPIs y panel de ficha, que en una columna de 288 px estorban.
Si el mapa crece a pantalla de trabajo, esa lista sí debería serlo. →
[[Componentes de la casa]]

**No se reencuadra al refrescar, y el primer encuadre va por la MEDIANA.** Hay
coches en Barcelona: encuadrar hasta el último abría el mapa de Madrid al
Mediterráneo y no se distinguía un punto. Se encuadra lo que cae a menos de medio
grado de la mediana; los de fuera siguen en el mapa y en la lista.

## El aviso al momento

Cuando un coche lleva **3 minutos seguidos rodando** sin nadie conectado, sale
un WhatsApp a los controladores. Tipo `rueda_suelto` en [[Control Alertas]], así
que hereda destinatarios, registro, modo test/live, tope por franja y la
pantalla de /alertas — no hay una segunda máquina de avisar.

**Suena a cualquier hora** (`ventana: 'siempre'`). Un coche rodando solo a las
cuatro de la mañana es más raro, no menos.

> [!important] Por qué tres minutos y no cero
> El estado de BOLT se refresca cada cinco minutos: quien acaba de conectarse
> puede figurar desconectado un rato, y un aviso en falso gasta la credibilidad
> de todos los demás. Tres minutos de marcha continua no son un salto del GPS.
>
> Y los mide **Mapon**, con el `start` de su propio `state` (guardado en
> `fv_posicion.estado_desde`), no una cuenta nuestra en memoria: así sobrevive a
> un despliegue.
>
> Medido el 21/09/2026 muestreando cada 30 s durante cinco minutos: de cinco
> rojos, **ninguno parpadeó** y tres aguantaron las diez vueltas. El rojo es
> señal sólida.

**Un aviso por coche, franja y día**, y eso lo garantiza el índice único
`uq_alerta_control_coche` ([[Migraciones|db/145]]), no un `if`. Va por
**matrícula** y no por conductor porque en un coche suelto muchas veces no hay
conductor — y en PostgreSQL dos `NULL` no chocan en un índice único, así que el
caso que más preocupa habría sonado cada treinta segundos para siempre.

El `ON CONFLICT` va **sin diana** a propósito: la fila puede chocar con el
índice de coche siempre y con el de persona cuando además hay conductor
desconectado. Nombrar uno dejaría el otro sin atrapar y saldría un `23505`
crudo — el fallo que obligó a escribir db/141.

## Pendiente si el piloto convence

- **Centrar por la sede del que mira**, en vez de por la mediana de la flota.
- **Los 12 equipos que no son coches del ERP**: o se dan de alta, o se quitan de
  la cuenta de Mapon. Hoy se cuentan pero no se pintan.
- **Empujar en vez de preguntar**: Mapon tiene `data_forward/save.json`, que
  quitaría el sondeo entero. → [[API_MAPON]]
