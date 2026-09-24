---
tags: [modulo, control, reportes, excel, pdf, horas]
aliases: [Reportes de control]
---

# Control · Reportes

`/control/reportes` es **solo descargables**: cada tarjeta baja un Excel o un PDF y nada se mira en pantalla. Lo que se mira en vivo está en [[Control En directo]], con el telefonito y la J al lado de cada uno. La vista es `modules/Control/vistas/reportes.ejs`; las rutas, `modules/Control/control.controller.js`.

Las dos listas que esta pantalla tenía ("Quién sale — para llamar" y "Control del día") se quitaron el **07/09/2026**. Con el "Tablero clásico" —que leía las horas de la hoja `Datos_API`— se fueron también sus rutas huérfanas: el `POST /excel` que exportaba filas que ya no mandaba nadie y el `POST /enviar-ws`, que mandaba hasta 200 plantillas de WhatsApp a los números que llegaran en el cuerpo **sin ningún botón detrás**.

Todo sale de PostgreSQL. Ver [[Base de datos]].

## Reporte de horas del día

`GET /control/reporte/excel?dia=1|2|3` — `modules/Control/reporteHoras.service.js` (el Excel) sobre `modules/Control/reporteHoras.repo.js` (los datos). El `dia` no es una fecha: es la clave 1 = ayer, 2 = hace 2, 3 = hace 3, que es como lo pide la pantalla desde siempre.

### Por qué se reescribió (07/09/2026)

El reporte del domingo 06/09 decía **752 h** y Visibilidad, del mismo día, **825,3 h**. La causa no era el cálculo de las horas sino **de dónde salía la lista de gente**: las filas venían de las hojas (`AGENDA_V2` para el plan y `Datos_API` para los NN) y las horas de PostgreSQL, y las dos partes se cruzaban **por el nombre**. Todo el que se escribiera distinto en los dos sitios entraba con 0 h, y quien no estuviera en ninguna hoja no entraba siquiera. Encima a cada uno se le medía solo la ventana de su turno: el de día que alargó hasta las 20:00 perdía esas horas y nadie las veía.

Ahora la lista y las horas salen del mismo sitio y se cruzan por el `conductor_uuid` de [[BOLT]], que es un identificador y no un nombre.

### La jornada 05→05, y con qué tiene que cuadrar

Las horas son `actividadPorConductor(iso, 'operativo')`: la jornada operativa entera, **viaje + espera**, con los solapes fundidos. Es la misma ventana y la misma definición que la tarjeta "AYER · JORNADA" de Visibilidad, **así que los dos números tienen que coincidir**. Ver [[Jornada y turnos]].

Descargado entre las 00:00 y las 05:00, "ayer" es una jornada que sigue abierta (los de noche siguen rodando): el Excel lo dice en la cabecera (`PARCIAL`), no lo esconde.

### Quién sale en el reporte

Tres vías, y la unión de las tres:

1. Todo el que **trabajó** (o al menos se conectó), aunque no estuviera planificado y aunque no tenga ficha nuestra — esos son los NN.
2. Todo el que estaba en el cuadrante **aunque no saliera** (fila con 0 h).
3. Todo el que tenga una **J**, por si no entró por las dos anteriores.

Quien libraba y no trabajó no sale: no es una falta.

### Las columnas

| Columna | Qué es |
|---|---|
| **Nº** | orden dentro del reporte |
| **Nombre** | el de la cuenta de BOLT, o el de la ficha |
| **Prom. mes** | su promedio de horas del mes corrido. Va pegado al nombre a propósito: es lo que convierte el dato del día en un juicio — 6 h en alguien que promedia 9 es una caída; en alguien que promedia 6, un martes normal. Sin la letra: en un Excel que se manda fuera, una nota escolar al lado de un nombre sobra |
| **Teléfono** | del padrón |
| **Turno** | el de **su plaza** ese día, libre o no |
| **Horas** | las efectivas de la jornada. Es la única celda con color |
| **Observaciones** | la banda automática + el aviso (*Fuera del cuadrante*, *Trabajó en su libranza*, *Solo en BOLT · sin ficha*), o el motivo de la J con sus horas delante |
| **Matrícula** | los coches que llevó |
| **KM BOLT** | km rodados trabajando |
| **KM descon.** | km rodados en descanso o desconectado |

**Los km de un coche de Barcelona no se cuentan** (24/09/2026). La flota que se vigila es la de Madrid (ver [[Vehiculos#La sede manda, y ahora se puede cambiar|la sede]]). Las horas no se tocan —Control sigue igual—; lo que cambia es el apartado de km:

- Si **todos** los coches de esa persona ese día son de Barcelona, las dos celdas de km dicen **«Barcelona»**, en malva claro y con una nota. No es un REVISAR: no falta nada.
- Si llevó **uno de Madrid y otro de Barcelona** —el 22/09 hubo tres—, van los km del de Madrid y una nota dice cuántos se apartaron y de qué matrícula. Antes se sumaban.
- La matrícula lleva la sede al lado: `1096MJY, 1888LTJ (Barcelona)`.

Para apartar un solo coche hace falta el reparto que la suma se comía: `actividadPorConductor` (`services/flotaViva/rutas.js`) devuelve ahora también `kmPorCoche`. La lógica está en `apartarOtraSede` (`reporteHoras.repo.js`).

> [!note] El 1888LTJ
> Mapon lo sitúa en Barcelona y en BOLT sale con conductores del cuadrante de Madrid. El 21/09 a uno de ellos se le sumaban 307,8 km de noche de ese coche. O se elige mal el coche en la app de BOLT, o alguien usa esas cuentas allí: el reporte ya no lo suma, pero la pregunta sigue abierta.

La **cascada de KM y el Sankey** tampoco cuentan Barcelona (24/09/2026): `bucketsTurno` suma los coches con los que alguien fichó en BOLT, y si el coche es de Barcelona se ignoran el coche, sus km y quien lo llevara. El 23/09 fueron 6 coches y 2.025 km, casi todos de «sin nadie fichado»: el titular pasó de 57 a 62 km con pasajero de cada 100. El cockpit de Control no cambia, así que ahí los totales no cuadran al km con la cascada, y el pie del PDF lo dice.

**El turno lo dice la plaza, no si ese día le tocaba trabajar.** Un fijo de noche sigue siendo de noche el día que libra. Antes el turno salía solo de `f_cobertura` y al librante se le quedaba en blanco; el reporte caía entonces en deducirlo por sus horas y a un fijo de noche que libra lunes y martes le ponía "Día". Solo se deduce por las horas (`turnoDeHecho`) cuando la persona **no tiene plaza**: ahí no hay nada mejor. Y ese cálculo mira dónde cayó el grueso de sus minutos, no la hora de su primera conexión — antes, al de noche que remató la noche anterior a las 05:00 le salía "Día" con sus 11 h de noche.

### Las bandas de color

Solo en la celda de horas. Son los colores de siempre porque Tráfico ya los tiene interiorizados:

| Color | Rango | Etiqueta |
|---|---|---|
| verde | ≥ 9 h | Muy efectivo |
| verde | 7,6 – 8,9 h | Efectivo |
| amarillo | 6,4 – 7,5 h | Poco efectivo |
| rojo | ≤ 6,3 h | No cumplieron |
| azul | — | Justificado (J): sus horas justificadas **se suman** a las de BOLT |
| gris | — | Sin dato de horas ese día |
| ámbar (en los KM) | — | **REVISAR** |

**REVISAR** es que fichó en BOLT con un coche del que Mapon no midió nada: no se puede dar el km por bueno y lo cuadra Tráfico, que conoce el apaño del taller (típicamente, el coche estaba en el taller y salió con otro sin dar de alta). Ver [[Mapon]].

**KM POR GPS** es distinto y va en ámbar suave con nota: los km buenos son los del **odómetro** del coche (`can`); unos pocos coches llevan un equipo que no lee el CAN y de esos solo hay la estimación del GPS, que corta las curvas y pierde lo que no ve. El número sigue valiendo —por eso suma— pero la celda avisa de con qué vara está medido: sin eso, dos filas iguales parecen igual de firmes y no lo son. Hay una trampa de implementación anotada en el código: la banda de filas alternas va **después** y pisaba el ámbar, comiéndose la mitad de los avisos (los de las filas pares).

### El orden

Por turno, con su título antes de cada bloque: primero **Día**, luego **Noche**, luego **TodoTurno** y al final quien no tiene turno. Dentro de cada bloque, los no justificados de más a menos horas y los justificados al final. Antes era una lista de 138 nombres mezclando día y noche.

### El resumen del día

Se calcula **sobre las filas que se imprimen**, para que quien lea el Excel pueda sumar a mano y le cuadre: personas que salieron, no salieron (sin contar libranzas), cumplieron las 8 h, salieron con menos de 4 h, justificados y horas justificadas, **salieron fuera del cuadrante** con sus horas (el número que antes no existía), de ellos los que **trabajaron en su libranza**, y las horas por turno (jornada completa: el de día que alargó hasta las 20:00 suma todo en "DÍA").

## El Sankey y la cascada

Los dos cuentan **el mismo dato**: cada kilómetro que rodó la flota, repartido por lo que estaba haciendo el conductor en ese momento. El dato va **por matrícula** y sin duplicar (`rutas.sankeyFlota(iso)`).

- **Sankey** — `GET /control/sankey/pdf`. Diagrama de flujo, día en verde y noche en azul. Enseña los dos turnos a la vez y por dónde se va cada km.
- **Cascada** — `GET /control/cascada/pdf`, `modules/Control/kmCascada.pdf.js`. Se hizo porque **dirección no leía el Sankey**: hay que seguir cintas de grosor variable y comparar anchos a ojo, y un gráfico que hay que explicar no sirve para una reunión. La cascada es el gráfico de contabilidad de toda la vida — se parte del bruto y se va restando:

```
Todo lo que rodó la flota      28.646 km
  - sin nadie fichado          -3.676
  - en descanso                -1.058
  - esperando aviso            -4.044
= Kilómetros con pasajero      19.867 km   (69 %)
```

La cifra que se lleva la reunión va arriba en una frase: "de cada 100 km que rueda la flota, 69 llevan pasajero". Se dibuja nativo (rectángulos y texto), no como captura: se amplía sin pixelar y pesa unos pocos KB. El Sankey se queda para quien lo prefiera.

Una etiqueta del Sankey está corregida a mano: BOLT marca "en viaje" desde que acepta hasta que deja al pasajero, así que la ida a recoger va **dentro** de ese km. Ponía "Con pasajero · 0 de camino", que se leía como que nadie fue a recoger; ahora dice **"En viaje (con pasajero o de camino)"**.

El botón "Excel + cascada" baja **los dos ficheros de un clic**, con un pequeño desfase porque algunos navegadores frenan dos descargas seguidas.

## Reporte por turnos (5-5)

`GET /control/reporte-turnos/excel?dia=` — `modules/Control/reporteTurnos.service.js`. Es el reporte que sacaba el control antiguo, con ventana horaria fija:

- **Día** 05:00 → 17:00
- **Noche** 17:00 → 05:00 del día siguiente

Columnas: **Nº · Conductor · Teléfono · Matrícula(s) · Horas · Estado**. Los cinco estados:

| Estado | Qué significa |
|---|---|
| **Salió** | trabajó en su turno y estaba previsto |
| **Otro turno** | trabajó en esta ventana pero estaba previsto en la otra — el de noche que ficha a las 16:40, el de día que apura pasadas las 17:00, el de la noche de ayer que remata a las 05:30. **No es un NN** |
| **NN (sin plan)** | trabajó y no estaba en el plan de ninguno de los dos turnos |
| **No salió** | estaba previsto, la ventana ya cerró y no rodó |
| **Pendiente** | estaba previsto y la ventana aún no ha cerrado (o no ha empezado) |

Si la ventana no ha cerrado se dice en el título del bloque (`SIN EMPEZAR` / `EN CURSO`): los "pendientes" no son faltas.

Dos decisiones de fondo: el puente uuid → `conductor_id` se hace **por identificador**, porque cruzando por nombre una persona con dos cuentas salía dos veces (o ninguna); y lo esencial va **sin red** — si el núcleo o el plan no responden, la ruta contesta 500. Antes se tragaba el error y salía un Excel plausible con todos "No salió" (o todos NN) que alguien se podía creer. Menos de un minuto sin estar previsto se descarta: es el ruido de un login, no una fila.

## Turnos para imprimir · el parte de flota

`GET /control/turnos/excel?dias=2` — `modules/Control/turnos.excel.js`. Hoy (solo noche) más los N días siguientes con las dos tablas. Pensado para el viernes: llevar impreso quién sale el sábado y el domingo.

**Va por COCHE y no por conductor**, y ese es el cambio que lo hace útil. Antes era la lista de a quién llamar: una fila por conductor que sale, y eso contesta media pregunta. La otra media —**cuántos coches se quedan parados y por qué**— no salía por ninguna parte, porque un coche sin nadie y un coche cuyo fijo está de baja **se ven exactamente igual** cuando solo listas a los que salen: no aparecen. Y no son el mismo problema: uno hay que cubrirlo esta mañana y el otro hay que reclutarlo.

Ahora la unidad es el coche: salen los operativos del cuadrante —71 hoy—, cada uno con sus dos turnos. **71 filas por turno, siempre**, así el papel cuadra con la flota y los coches parados se cuentan solos. El orden lo pidió Tráfico y se lee de arriba abajo, de lo que funciona a lo que hay que resolver:

1. Sale, sin incidencias
2. Planificado pero de **baja médica**
3. Planificado pero con **permiso**
4. Planificado pero de **vacaciones**
5. Planificado pero ausente (otros)
6. **No sale · sin nadie planificado**

Detrás, aparte y sin contar en los 71, los coches del cuadrante que **no están operativos** (taller, reserva, emergencia) con su estado: esa también es una respuesta. Sale del mismo tablero que la Cobertura (`f_cobertura`), así que lo que se imprime es exactamente lo que se ve en pantalla.

## Parrilla del planificador (ANEXO)

`GET /control/planificador/excel?dia=` — delega en `modules/Planificacion/tablero.service.parrilla()`. El anexo completo **por correturno**: cada coche con su descanso, matrícula y las 4 plazas (fijo/CT × día/noche) con teléfono y zona. Sale del planificador real (PostgreSQL), no de las hojas.

## Asistencia · los más reincidentes

`GET /control/asistencia/excel` y `/asistencia/pdf` — `modules/Control/asistencia.repo.js`. El Excel es el que se usa de verdad (se ordena y se filtra); el PDF es el mismo reporte para imprimir.

**Una falta es un día en el que a alguien le tocaba salir y no hizo ni una hora en BOLT, sin justificante que lo explique.** Ni más ni menos: quien estuvo en el taller y tiene su J no falta, y quien está de vacaciones tampoco, porque esos días ni siquiera le tocaba salir.

Dos advertencias que el propio reporte escribe en su cabecera:

- **La libranza que se usa es la de HOY, proyectada hacia atrás.** Si su coche descansa hoy los miércoles, se da por librado el miércoles pasado. Es una simplificación deliberada: el descanso de un coche cambia poco y pedirle a Tráfico que reconstruya el cuadrante de hace tres semanas no es razonable. Si el cuadrante cambió mucho en el periodo, el número se queda **corto** (marca menos faltas), que es el lado bueno por el que equivocarse en algo que se usa para llamar a la gente.
- **Quien no tiene cuenta de BOLT enlazada va al final:** su 0 no significa que faltara, significa que no se puede leer.

El periodo por defecto lo decide **el servidor** (día 1 del mes → ayer, en hora de Madrid) y no el navegador: a las 00:30 el reloj del cliente daría un mes distinto. Y llega hasta ayer porque la jornada de hoy no ha terminado y quien entra a las 17:00 aún no ha faltado a nada.

## Informe del Histórico

`GET /control/historico/excel?desde=&hasta=` — no está en la pantalla de Reportes sino en `/control/historico`, pero es un descargable más. Un día por defecto; con rango, apila varios en las mismas hojas con la fecha delante, para la tabla dinámica. **Tope de 7 días** y el calendario se camina día a día: ver [[Control]].

## La auditoría de los lunes

`GET /control/auditoria-lunes/excel?lunes=8` (máximo 12). **Sin botón, a propósito**: se pidió como un vistazo puntual, no como un reporte de cada semana.

El lunes es el día que más horas se cae y no había forma de mirar por qué. Contesta dos preguntas por separado: **por conductor** (de los N últimos lunes, en cuáles le tocaba, en cuáles salió, cuántas horas hizo y, si no salió, la razón) y **por matrícula** (el mismo lunes visto desde el coche, con los huecos, que es donde se pierden las horas de verdad).

Tres reglas que hay que tener presentes al leerlo:

- **El plan es el de hoy, proyectado hacia atrás**: en PostgreSQL no hay planificación anterior al 3 de septiembre. Se dice en la cabecera del Excel para que nadie lo lea como una foto histórica.
- Solo entra quien tiene plaza y a quien le toca lunes. Los fijos de un coche que descansa L-M no salen nunca un lunes: fuera del reporte, "siempre son los mismos".
- **Un lunes anterior a su fecha de alta no es exigible**: quien entró el martes pasado tiene un solo lunes que contar.

## Ver también

[[Control]] · [[Control En directo]] · [[Control Alertas]] · [[Jornada y turnos]] · [[BOLT]] · [[Mapon]] · [[Base de datos]] · [[Glosario]]
