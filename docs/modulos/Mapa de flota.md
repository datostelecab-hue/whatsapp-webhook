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
| gris | el equipo lleva >10 min sin hablar | no se sabe dónde está |

El rojo junta dos casos a propósito: el coche que está en BOLT con el conductor
desconectado, y el equipo que no casa con ningún coche de BOLT. Los dos son *se
mueve y nadie responde por él*. Cuál de los dos es se dice al pinchar, no en el
color.

> Medido el 21/09/2026 a las 19:00 — 33 trabajando, 2 rodando en descanso y
> **11 rodando sin nadie**, incluidas las dos unidades del 3031LTV y un equipo
> llamado `1159283703` que no es una matrícula. Uno de ellos llevaba **15 h
> desconectado y 47,4 km** en ese tramo.

## Manda la posición, no el estado

`FROM fv_posicion LEFT JOIN fv_ahora`, y no al revés. Si fuera al revés
desaparecerían justo los que hay que mirar: un equipo que rueda y no casa con
ningún coche de BOLT **no tiene fila en `fv_ahora`**. De 106 unidades, 14 no son
coches del ERP y cinco de ellas estaban en marcha.

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

## Pendiente si el piloto convence

- **Aviso al momento** cuando aparece un rojo. Hoy solo se ve si estás mirando.
  Lo que ya existe —`km_parado` de [[Control Alertas]]— va por franjas y umbral
  de 20 km, y `rueda_caido` de [[Flota viva]] está apagado desde el 08/09.
- **Centrar por la sede del que mira**, en vez de por la mediana de la flota.
- **Empujar en vez de preguntar**: Mapon tiene `data_forward/save.json`, que
  quitaría el sondeo entero. → [[API_MAPON]]
