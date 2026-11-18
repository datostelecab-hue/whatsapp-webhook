---
tags: [modulo, operaciones, km, fichaje]
ruta: /operaciones/banco-km
codigo: modules/Operaciones/bancoKm.service.js
actualizado: 2026-11-18
---

# Banco de KM

`/operaciones/banco-km`, en el grupo **Operaciones** del menú. Los km que cada conductor hace **fuera de BOLT** en la semana, contra su límite. Y las matrículas, con de quién son esos km.

Camilo, 18/11/2026:

> Va a haber un banco de KM por así decirlo por fuera, en el cual va por conductor y un resumen de matrículas por semana. La idea es que tengan un límite de 17,5 km por fuera desconectado al día, por cada uno; si descansa no se le suma al límite. Por ejemplo, si es una persona que está programada para trabajar en el planificador 5 días, entonces tiene 87,5 km de límite a la semana, pero si se programó otro día de la nada entonces son 6 días y el límite sube a 105. Esto también aplica a los NN: si salieron como NN X día, entonces el límite también le sube.

```
modules/Operaciones/bancoKm.service.js     las reglas, la foto de cada jornada y la semana
modules/Operaciones/bancoKm.repo.js        el SQL
modules/Operaciones/bancoKm.controller.js  /operaciones/banco-km (montado desde operaciones.controller)
modules/Operaciones/vistas/bancoKm.ejs     la pantalla: dos pestañas y la semana
public/assets/js/vistas/Operaciones/bancoKm.js
db/267-banco-de-km.sql                     km_banco_dia, km_banco_coche, km_banco_calculo y la llave
test/bancoKm.test.js
```

## Las reglas (las eligió Camilo el mismo día)

| | |
|---|---|
| **Qué km gastan banco** | **Todos los de fuera de BOLT**: desconectado y en descanso. Son los de la columna «KM fuera BOLT» del [[Control Reportes\|reporte de horas]] de Control, con su misma regla: con el coche **fichado** por WhatsApp, de quien lo fichó (también si se le olvidó terminar el turno); sin fichar, del **último que estuvo en BOLT** con el coche |
| **El límite** | **17,5 km** (el parámetro `banco_km.km_dia`, ver [[Parametros]]) por cada día que **le tocaba en el planificador**, haya salido o no, y por cada día que **salió sin tocarle** (un NN, un día extra). Vacaciones, baja o libranza no suman |
| **La semana** | De lunes a domingo, y **empieza de cero** |
| **La jornada** | La del reporte de Control: el turno de día y el de noche de ese día. Se calcula **cerrada**, después de las 12:00 del día siguiente (más una hora de margen). **Hoy no cuenta** |

- **La oficina** (un viaje fichado por WhatsApp) no tiene banco: sus km salen solo en las matrículas.
- **Barcelona** no entra: ni sus conductores ni los km de sus coches.
- Quien **libraba** y no salió, pero el coche anduvo y él fue el último en BOLT con él, **sí gasta**: no suma límite y sus km cuentan. El reporte de Control no lo saca (allí no es una falta); el banco lo pide con `reporteDia(dia, { conKmFuera: true })`.
- **Un cambio del parámetro** vale para las jornadas que se calculen desde entonces: cada día guarda el límite de su día (`limite_km`).

## De dónde salen los números: del mismo código que el reporte

El banco **no calcula los km por su cuenta**: llama a `reporteDia` de `modules/Control/reporteHoras.repo.js`, el mismo que arma el Excel de Control. Dos cuentas distintas del mismo dato acabarían discrepando y nadie sabría cuál creer. Para el banco, cada fila del reporte lleva desde el 18/11 tres cosas más (el Excel no las usa):

- `persona`: quién es. `c<id>` el conductor; `u<id>` alguien de la oficina; `b<uuid>` una cuenta de BOLT sin ficha; `t<teléfono>` quien fichó sin ficha.
- `conductorId`.
- `kmFueraPorCoche`: matrícula → km fuera de BOLT, sin los coches de otra sede. Sale de la actividad de cada cuenta (ya sin lo que se lleva el fichaje) y de los km de sus fichajes.

Contra la copia local (19–25/10/2026, solo GPS), los km de las personas suman exacto lo de los coches (5.043,2 km el 20/10, sin un descuadre), y cada día se calcula en un segundo.

## La foto de cada jornada

`km_banco_dia` (cada persona y día: si le tocaba, si salió, lo que suma al límite, sus km) y `km_banco_coche` (esos km coche a coche). Es una **foto que se rehace**, como `auditoria_km`: no va bajo el [[Libro de auditoria]].

- **La tarea programada `banco_km.dia`** ([[Tareas programadas]]) calcula las jornadas cerradas que faltan desde el **lunes 26/10/2026** (cuando toda la plantilla entró en el [[Ciclo de bloqueo de motor|ciclo de bloqueo]], db/219): **como mucho tres por vuelta**, la más nueva primero. La de ayer sale enseguida y el histórico se rellena poco a poco, sin cargar la base de golpe ([[No consultas pesadas en prod]]).
- **Si los km con el fichaje no salen** (el tope de 25 s de `kmFichaje.js`), el día **no se guarda**: sin el fichaje, los km de quien tenía el coche fichado se los llevaría otro. Se reintenta solo.
- **«Recalcular»** rehace las jornadas cerradas de la semana que se mira (por ejemplo, después de aprobar una [[Fichaje#Correcciones|corrección de fichaje]]). Va por detrás, de una en una, y solo una semana a la vez; la pantalla dice por dónde va.

## La pantalla

- **Por conductor**: días (los que le tocaban, más los que salió sin tocarle), límite, km fuera de BOLT con su barra, y el saldo («le quedan 12,5 km» o «pasado 15,0 km», en rojo). Cifras arriba: pasados, cerca del límite (desde el 80 %), dentro y el total. La ficha, en el panel lateral: la semana día a día (qué fue, lo que sumó al límite, sus km y en qué coches, su fichaje, «sin fichar» y «REVISAR») y sus últimas ocho semanas.
- **Por matrícula**: los km fuera de BOLT de cada coche en la semana y **de quién son, en %**. Con un binomio de fijos se ve en el acto si es reparto de cambio de turno (48/52) o uso por fuera de uno (10/90). La ficha: el reparto y el día a día.
- **La semana** se elige con las flechas; arriba se dice qué jornadas faltan por calcular y, en la semana en curso, hasta qué día cuenta.

## El desglose: de dónde sale cada km (18/11/2026)

Camilo, con la ficha de un fijo de noche que salía con 661 km en una semana: *«Dejemos la regla, pero que por día, al darle click a la persona de la semana, me desglose todos los KM: si es por descanso, si es por supuesto fichaje no cerrado, etc. Necesitamos decirles: ey, por no haber desfichado, mira los KM que se te imputan»*.

Al abrir la ficha de un conductor, arriba sale **de dónde salen sus km** de la semana (una barra y su leyenda) y, debajo de cada día, lo mismo coche a coche:

| Causa | Cuándo |
|---|---|
| **Por no terminar el turno** | Tenía el coche **fichado** y quien estaba en BOLT con él era **otro**, desconectado o en descanso. Dice quién lo llevaba y qué pasó con su fichaje («su fichaje del jueves 12 a las 03:09 se cerró solo a las 18:56») |
| **En descanso en BOLT** | Él, conectado pero en pausa |
| **Desconectado de BOLT** | Él, desconectado y el último con el coche (con el corte de siempre: hasta que otro se conecta, él aparece en otro coche o pasan 12 h) |
| **Fichado, sin conectarse a BOLT** | Tenía el coche fichado y nadie estaba en BOLT con él |

Si hay km por no terminar el turno, un recuadro en rojo lo dice con la cifra y quién llevaba el coche, y **«Copiar el mensaje para mandárselo»** deja en el portapapeles un texto para el conductor (sus km, su límite, los del turno sin terminar y «Cuando dejes el coche, pulsa «Terminar turno» en el bot»).

- **La regla no cambia** (Camilo: «dejemos la regla»): siguen contando en su banco. El desglose solo dice por qué.
- **Cómo**: `modules/Operaciones/bancoKm.desglose.js` reparte minuto a minuto los km de sus coches de esa semana con la regla del reporte (`FIN_KM` y el fichaje), y el reparto **se escala a los km de la foto**: la ficha no puede dar dos cifras para lo mismo. Si los datos crudos no dan nada para ese día y coche, sale «Sin desglose».
- **Se calcula al abrir la ficha**, solo con sus coches de esa semana (unos miles de filas, por índices). Contra producción, la semana del 9 al 15/11 de ese conductor tardó 2 s desde fuera de Render y salió: en descanso 330,9 km, **por no terminar el turno 280,7** (el coche lo llevaba su compañero de día, que no fichó ni una vez), desconectado 48,5 y 1 sin desglose; los 661,1 km de su ficha al décimo.

## Permisos

La llave **`/operaciones/banco-km`** («Banco de KM»). db/267 se la da a quien ya veía la [[Auditoria de flota]].

Relacionado: [[Operaciones]] · [[Control Reportes]] · [[Fichaje]] · [[Planificacion]] · [[Parametros]]
