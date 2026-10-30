---
tags: [modulo, visibilidad, horas, graficos]
aliases: [Visibilidad, Visor de horas]
actualizado: 2026-10-25
---

# Visibilidad

`/visibilidad`: las horas efectivas de la flota —**viaje + espera, nada de descanso**— contra la meta del mes, en vivo desde el núcleo de BOLT y sin hojas. Es el antiguo «VISOR EN VIVO AMBAS FLOTAS» de la hoja, rehecho sobre PostgreSQL. Barcelona tiene la suya con la misma pantalla y las mismas cuentas ([[Barcelona#La Visibilidad (`/barcelona/visibilidad`)]]); el [[Inicio]] enseña sus cifras.

| Pieza | Dónde |
|---|---|
| La ruta | `routes/visibilidad.js` |
| Las cuentas de siempre (tarjetas, serie del mes, config, fotos) | `services/visibilidad.js` |
| La tendencia: rangos, cómo vamos, cómo hemos crecido | `services/visibilidadTendencia.js` (las reglas, puras) |
| El SQL de las series largas (fotos + histórico) | `services/repo/visibilidadSerie.js` |
| La vista (las dos sedes) | `views/visibilidad.ejs` |
| Barcelona | `modules/Barcelona/visibilidad.service.js` (sus días, las mismas piezas) |
| El comprobador | `node scripts/comprobar-visibilidad-tendencia.js` (y `comprobar-barcelona.js`) |

## Dos vistas a propósito, que NO se unifican

- **Por día natural** (00:00 → 24:00): lo que cuadra con BOLT y con el mes. Hoy, ayer, la semana, el mes y todos los gráficos.
- **Por turno / jornada**: la gente de cada turno (`repartoTurnos`: el día de 00:00 a 24:00 y la noche de 12:00 a 12:00 por el turno de cada conductor; los NN por su hora de inicio). Cuadra con el Reporte de horas y la Bitácora.

No dan lo mismo porque la noche cruza la medianoche, y esa diferencia es lo que hay que ver. Ver [[Jornada y turnos]].

## Las fotos diarias

`visibilidad_dia` (día, viaje, espera, descanso, conductores, `capturado_at`) es la foto del núcleo (`fv_tramo`) de cada día natural. La escribe el cron (hoy, ayer y anteayer) y `serieMes` rellena cualquier día del mes que falte **o esté a 0**. Hoy va siempre en vivo por encima de su foto.

**La historia de antes del núcleo** (db/217, 25/10/2026). El núcleo empieza el 01/07/2026. Los días de antes viven en una tabla aparte, `visibilidad_dia_historico`, sacados del historial de estados de BOLT (cómo, con su error medido, en la cabecera de `db/217-visibilidad-historico.sql`). Nadie la recalcula ni la pisa: `capturarDia` escribiría un 0 encima de un día de junio, y por eso no van en `visibilidad_dia`. **La regla del contrato, para cualquier serie**: un día vale lo de `visibilidad_dia` si tiene horas y, si no, lo del histórico (`fundirDias`). Un día sin horas en ninguna de las dos **no está**: un hueco no es un cero y no baja ninguna media.

- `serieMes` aplica la misma regla a los días a 0 del mes (junio se ve en la tabla y en las cifras del mes) y **no recalcula los días de antes del primer tramo del núcleo**: abrir julio, que se compara con junio, rehacía cada vez los 30 días de junio (30 consultas a `fv_tramo` para escribir ceros otra vez).
- **El rango también rellena los días del núcleo sin foto** (o a 0, un cron caído) con el mismo `capturarDia`, pero **como mucho 7 por petición** y los más recientes primero (`TOPE_RELLENO`, `diasSinFoto`). Antes solo leía fotos y el mismo día salía hueco en «Horas por día» y con horas en «Cómo vamos», que lo había recalculado; si era de un mes que nadie abría, hueco para siempre. En producción no hay ninguno hoy.
- Sin db/217 aplicada, todo funciona con lo del núcleo y la pantalla lo dice («el histórico de antes de julio aún no está cargado»).
- En la tabla del mes, un día del histórico lleva la marca **BOLT**.

### Lo que hay que saber de la historia de antes de julio

- **Sale de los estados de BOLT** de las dos empresas de Madrid (63530 y 143626), con el mismo método que el núcleo (un tramo por racha de situación, recortado al día natural de Madrid; viaje y espera efectivas, el descanso aparte). Medido contra julio con los mismos coches: −0,007 % en la semana del 06 al 12/07. Los cálculos y su validación están en `Documents\Claude\Scripts de análisis\visibilidad-historico` (fuera del repo, con su README).
- **El 01/07/2026 se queda a medias** (498,8 h): `fv_tramo` empieza ese día a las 02:02 y la regla del contrato da el núcleo, que tiene horas. El histórico no lo puede cubrir (el CHECK de db/217 solo admite días anteriores al 01/07). Baja un poco la media de julio (792 h/día) y la semana del 29/06. Es un límite conocido; cambiarlo (mover el CHECK y hacer una excepción de ese día) lo decide Camilo.
- **A julio le faltan las horas del 3035LTX** (unas 18 h al día, unas 560 h, un 2,3 % del mes): rodó en Madrid en julio pero sus tramos en `fv_tramo` empiezan el 01/08. Se arreglaría rehaciendo el backfill de julio y sus fotos (`backfillMes(2026, 7)`), en producción.
- **Del 06/05 la empresa 143626 cae a una décima parte** (en estados y en pedidos de BOLT) y no vuelve a lo de antes: mayo y junio son un bache real, no un fallo de descarga (cada trozo cuadra con el total de filas que declara BOLT).
- **BOLT guarda los datos desde el 26/06/2025, y esa fecha avanza un día cada día.** No se ha traído nada de 2025: para que «1 año» esté entero haría falta del 26/10 al 31/12/2025 (unas 350 peticiones); todo lo que queda, del 26/06 al 31/12/2025 (unas 900).
- **Las cifras de arriba de esos meses no tienen dinero**: `bolt_order` empieza el 01/07/2026, así que de enero a junio €/h, neto y viajes/h salen «—» con «sin pedidos de BOLT ese mes» (y no «0,00 €»).

## A esta hora (30/10/2026)

Camilo: *«ayer a las 12:28 estábamos con este total de horas, hoy con estas. Así pero con dos días hacia atrás y también con el día de la semana pasada, como comparando el viernes de esta semana con el viernes de la semana pasada, con porcentajes reales, con gráficos que entienda una persona que no sabe de datos, directo al punto»*.

Una tarjeta debajo de las de en vivo, en Madrid y, desde el mismo día, en [[Barcelona]] (con sus horas y su planificador). Compara las **horas efectivas de hoy desde las 00:00 hasta ahora** con las de **ayer, anteayer y el mismo día de la semana pasada desde las 00:00 hasta la misma hora**.

- **La frase de arriba** dice lo que se pregunta primero: «A las 12:28, hoy llevamos 485 horas: 4,9 % menos que ayer a esta hora».
- **Una barra por día** (hoy en oro, los demás en gris) con sus horas. En los días de antes, una etiqueta con cuánto va hoy por encima o por debajo, en horas y en %: verde si hoy va por encima, rojo si va por debajo y «Igual que hoy» si no llega a media hora.
- **El % es real**, con un decimal: (hoy − ese día) ÷ ese día.
- **Es día natural**, como la tarjeta de Hoy. La ventana la clava el SQL en Madrid: un día con cambio de hora corta a la misma hora del reloj (el 25/10/2026, de 00:00 a 12:28 hubo una hora más).
- Se refresca con las tarjetas, cada 5 minutos, y con «Actualizar».
- Piezas: `services/visibilidad.js` → `aEstaHora()` (con `ref` para probar un día pasado), `GET /visibilidad/api/a-esta-hora`, y el pintado `cargarAEstaHora` en `views/visibilidad.ejs`. Comprobado contra una consulta aparte el 27/10 a las 12:28: los cuatro días cuadran al décimo.
- **Tres botones: Día natural, Por turno y Jornada** (30/10/2026, Camilo: *«dos botones para cambiar a la vista de hora natural y hora por turno… y jornada»*). Las tres llegan en la misma respuesta y cambiar de botón no pide nada; el navegador recuerda el último elegido.
    - **Día natural:** todo lo trabajado desde las 00:00 hasta esa hora.
    - **Por turno:** dos bloques, turno de día y turno de noche, con la regla de las tarjetas de turno (`repartoTurnos`: la gente de cada turno según el cuadrante; el día desde las 00:00, la noche desde las 12:00), cortados a la misma hora. La noche es la que está en curso: desde las 12:00 de hoy si ya han dado, y si no, la que empezó ayer a las 12:00 (sus etiquetas dicen «noche del domingo 25»). Entre las 12:00 y las 17:00 la noche apenas suma, y la tarjeta lo dice.
    - **Jornada:** el turno de día de cada día más su turno de noche, todo lo que lleva hasta esa hora (antes de las 12:00 su noche aún no ha empezado y es igual al turno de día).
    - El corte a una hora es `porTurno(fechas, { hasta })` (y `cargar`): sin `hasta` da exactamente lo de antes (comprobado con el 20/10: 492,1 y 482,8 h).
    - **Contra un día con menos de 10 h no se da %** («Muy pocas horas para comparar»): a las 12:28 la noche lleva media hora y 0 contra 0,5 h saldría «−100 %».
- **En la copia local** hoy, ayer y anteayer salen casi iguales: los tramos que quedaron abiertos al copiar (27/10) se alargan hasta ahora. En producción se cierran solos.

## Los gráficos (25/10/2026)

Camilo: *«necesito que le des una actualización a visibilidad, nuevos gráficos… que en el gráfico que muestras los últimos 15 días se pueda agrandar, tipo, última semana, últimos 15 días, hace 30 días, 2 meses, 1 año, etc. Pero quiero gráficos mucho más profesionales y que muestren cómo van las horas actualmente y cómo hemos crecido»*.

Hechos con la skill de visualización (`dataviz`): **un acento** (el oro, o el color del tema de cada uno) para lo que importa, el **gris** para el contexto y la **tinta** para la media; rayas finas; **un solo eje** siempre; el globo con **todas las series** del día que se mira y la **cruceta**; **leyenda siempre** y etiquetas solo donde dicen algo (hoy, los finales de línea, el % de cada mes); **una tabla al lado de cada gráfico** (el botón de la tabla) para leerlo sin el dibujo; claro y oscuro de los tokens del tema; sin animación para quien pide «reducir movimiento». Los colores se pasaron por el validador de la skill: oro y gris se distinguen también con daltonismo (ΔE 18 en oscuro, 22 en claro); en claro el gris del contexto va más claro que el del texto, porque con el del texto quedaban a ΔE 14 y se confundían hasta sin daltonismo.

**Líneas, no barras** (el mismo 25/10/2026). La primera versión de «Horas por día» y de «Cómo hemos crecido» iba en barras, y Camilo: *«Me gustaba más sin barras, quítale las barras, la línea de subida y bajada estaba mejor»*. Las cuatro van ahora en **línea** oro con el área que se apaga hacia abajo (`Graficos.area`), curva `monotone` (no se pasa por encima del mejor día ni baja de cero entre dos puntos) y un punto por día o mes mientras quepa. **Lo que aún corre va en un punto hueco** (anillo), fuera de la línea si va a medias. La **cifra de cada punto, encima si sube y debajo si baja**, para que la raya que llega no la pise.

Arriba, **las cifras de siempre** (horas del mes contra la meta, utilización, €/h, neto, viajes/h) y las tarjetas en vivo **no cambian**: son las del Inicio. Debajo, cuatro tarjetas:

### 1. Horas por día, con su rango

El viejo «Capacidad por día · últimos 15 días», con un selector: **Semana · 15 días · 30 días · 2 meses · 6 meses · 1 año · Todo**. Se recuerda en ese navegador (`localStorage`, cada sede el suyo).

- **Hasta 2 meses, un punto por día**; 6 meses y 1 año, **por semanas** (de lunes a domingo); más de 400 días, por meses. Por semanas o meses **cada punto es la media diaria del periodo** (h/día): el eje dice lo mismo en todos los rangos, la línea de la meta vale para todos, y la semana en curso no parece un hundimiento. El total del periodo va en el globo.
- **Hoy, en un punto hueco y fuera de la línea** («en curso»). Por días es el parcial en vivo (en la línea la hundiría al final: un día de mil horas lleva cuatrocientas a mediodía); por semanas o meses **no entra en la media** del cubo (a las diez de la mañana la bajaría entera) y va aparte en el globo.
- **Las cifras de cada punto**, mientras quepan (unos 38 px por punto): con 15 días se leen todas; con 2 meses o un año por semanas, la línea sola (sin puntos), y las cifras en el globo y la tabla.
- **Sin media móvil** (quitada el mismo 25/10/2026). Era una raya gris por encima de la del día (7 días por días, 4 semanas por semanas) y Camilo no sabía qué era: *«quita la línea de la mediana, no sé de qué es, una gris»*. La tendencia la dice la línea oro y la media del periodo, la cifra de arriba. **El servidor la sigue calculando** (`media` y `ventanaMedia` en `/api/rango`): no la pinta nadie, pero está por si vuelve.
- **El ritmo que pide la meta**: la meta ÷ los días de **cada** mes (968 h/día en octubre, 1.000 en septiembre, 1.071 en febrero), en escalones. Ojo: es la meta de **hoy** aplicada a todos los meses; no hay meta guardada por mes.
- **Las cifras**: la media del periodo (días cerrados), **frente al periodo anterior** de la misma longitud (solo si ese periodo tiene datos en el 90 % de sus días: Barcelona comparaba sus 15 días con un periodo que empezaba antes de su primer apunte y le daba «+26,5 %»), **contra el ritmo de la meta**, y el mejor día (semana, mes).
  - **«La misma longitud» son los días cerrados del periodo**, sin hoy: «15 días» se compara con los 15 de antes, «Semana» con los 7 de antes. Con el rango entero (16 días, y por semanas el lunes adelantado) un lado llevaba un día de más, y con semanas idénticas salía −1,8 % o +1,8 % sin que cambiara nada (ver [[Trampas conocidas]]).
  - **El ritmo de la meta es el de los mismos días que la media** (meta ÷ días de su mes, día a día). Si el periodo cruza meses de distinta longitud, la cifra dice «de media» (987 h/día en «1 año»). Antes era la media de los ritmos de cada punto y el % no salía con el ritmo que se leía debajo.
- **Lo que se lee**: las fotos y, de hoy, el núcleo en vivo. **Nunca recalcula el núcleo día a día** (un año serían 365 consultas por pintar). En local, con la copia de producción, cualquier rango tarda 100-200 ms.

`GET /visibilidad/api/rango?ultimos=N` (los N días cerrados y hoy, N de 1 a 1.099: con hoy son N + 1 días) o `?desde=AAAA-MM-DD|inicio&hasta=AAAA-MM-DD`, con `&agrupar=dia|semana|mes` si se quiere forzar. Tope de 1.100 días, por días 186 como mucho; lo que pase de hoy se corta en hoy; antes del primer día con datos se empieza ahí (y se dice). **«Todo» se recorta a los últimos 1.100 días** (hacia 2029 la historia pasará de ahí y el botón seguirá funcionando); un `desde` escrito a mano más largo es un 400. Un parámetro que no vale es un **400 con el motivo**, no un 500 (`agrupar` se compara con una lista: `constructor` o `__proto__` colaban).

**En la pantalla, cada carga lleva su turno**: si se cambia de rango (o de mes) rápido, solo pinta la última que se pidió. Antes, una respuesta lenta («Todo») que llegaba después de la rápida («Semana») pintaba encima.

### 2. Cómo vamos (el mes contra el anterior, a la misma altura)

Sigue al selector de mes de arriba, como la tabla. El acumulado del mes contra el del anterior **día a día**, con el ideal de la meta y el **crítico** (el suelo por debajo del cual la meta ya no se alcanza con la capacidad que queda), y en el mes en curso **la previsión de cierre** en raya de puntos.

- **En el mes en curso, «a la misma altura»**: el último día cerrado (ayer; hoy va a medias y siempre saldría por detrás) contra el mismo día del anterior. Contra un mes más corto, se compara con su último día y se dice cuál. Un mes anterior sin datos hasta esa altura (Barcelona: su septiembre es un día) no sirve de base.
- **Un mes cerrado se compara entero**: total contra total y, por día, la media de los días con datos de cada uno, la misma cuenta que «Cómo hemos crecido». Antes se cortaba el anterior en el día 30 y la misma pantalla daba tres cifras para lo mismo (septiembre: −6,0 %, −9,5 % y −6,4 %). Ahora septiembre frente a agosto es **−2.737 h (−9,5 %) · 874 frente a 934 h/día**, en todas las tarjetas.
- **Un mes sin un dato** (diciembre de 2025) se titula «sin datos» y no enseña cierre, brecha ni comparación: antes «cerraba con 0 h y −30.000 h sobre el ideal». Su corte es su último día con horas.
- **Las cifras**: por delante o por detrás del anterior (h, % y h/día), sobre el ideal de la meta, **el cierre previsto** (y su % de la meta) y **lo que hace falta al día** para llegar. En un mes pasado, su cierre y su media por día.
- **La previsión**: lo hecho hasta ayer + **los últimos 7 días cerrados** × los días que quedan (hoy incluido). Siete días crucen o no el mes: el día 2 la media del mes sería la de un día, y siete llevan dentro un fin de semana entero. En el globo de la cifra, la otra cuenta (al ritmo del mes).

`GET /visibilidad/api/como-vamos?mes=AAAA-MM`: la serie de `/api/serie` de siempre, más el mes anterior y la comparación. La pantalla ya no pide `/api/serie` (se queda para quien la use).

### 2 bis. Brecha sobre el ideal (solo del mes)

La de antes de la tendencia, **en barras**: se quitó con ella (la cifra quedó en Cómo vamos y la serie en la tabla) y volvió el mismo día. Camilo: *«Conserva el gráfico de antes en donde teníamos la visibilidad de las horas que debíamos por medio de barras, esa era muy buena, solo del mes»*.

- **Una barra por día cerrado** del mes elegido (sigue al selector de mes, como Cómo vamos y la tabla): el acumulado menos el ideal de la meta a su cierre. **Verde** si vamos por delante, **rojo** con las horas que debemos; aquí rojo y verde porque el dato **es** un estado. El cero, más marcado.
- **Hoy no entra** (va a medias: su barra siempre saldría hundida). Los días por venir dejan su hueco: se ve cuánto mes queda.
- **La cifra grande** de arriba a la derecha es la de la tarjeta «Sobre el ideal de la meta» de Cómo vamos (`comoVamos.brecha`, al cierre del día `corte`): el mismo día, la misma cuenta.
- **En el globo**, el acumulado y el ideal de ese día, y **cuánto movió la brecha** ese día (sus horas menos lo que pedía la meta).
- **Sin meta** (una sede que aún no la tiene en Config) no hay ideal: la tarjeta lo dice y no pinta barras.
- Lee la misma respuesta que Cómo vamos (`/api/como-vamos`): no hay petición nueva.

### 3. Cómo hemos crecido

Mes a mes desde el primero con datos, en **tres gráficos pequeños en vez de uno con dos ejes** (horas, horas por día y conductores tienen escalas distintas; con dos ejes, dónde se cruzan las líneas lo decide la escala, no los datos): **Horas al mes** a todo el ancho, y debajo **Horas por día** y **Conductores al día**.

- **Horas al mes**: la línea va por los meses cerrados. El mes en curso **no entra en ella** (a día 10 lleva un tercio y parecería que se hunde): va su punto hueco con lo hecho y, **en raya discontinua, la previsión**, desde el último mes cerrado hasta donde cerraría al ritmo de ahora. Si el mes anterior lleva pocos días (el septiembre de Barcelona), la raya no sale de él y la previsión es su punto solo.
- **Horas por día** = la media de los días cerrados con datos de cada mes: febrero y marzo se comparan sin trampa.
- **Conductores al día** = la media de `visibilidad_dia.conductores` (quien hizo viaje o espera ese día). En el globo, las **horas por conductor**: si crecemos por tener más gente o porque cada uno hace más.
- **El % frente al mes anterior** en cada punto, encima si sube y debajo si baja (si cabe; si no, en el globo y en la tabla). Solo entre meses con **7 días o más** con datos; en el mes en curso, el de las horas compara su previsión y lo dice.
- **Las cifras**: tres comparaciones a la vez de las horas por día del último mes —**frente al mes anterior, frente a hace tres meses y desde el primer mes**— y el mejor mes. Una sola habría contado media historia: con el histórico, desde enero sale −5 % y desde julio +15 %.
- **De dónde sale cada mes** (núcleo, histórico de BOLT o, en Barcelona, sus apuntes), en el globo y en la nota de debajo.
- **Un mes con menos de 7 días con datos va en gris** (su punto, y el tramo de línea que lo toca, gris y discontinuo) y el eje dice «pocos días»: el septiembre de Barcelona (el 30/09 desde las 15:00, 29 h/día) al lado de octubre (134) sugería que se había multiplicado por 4,6.

Los tres gráficos usan la escala de la casa (`ejeEscalado`): un techo y un paso redondos y sin el `grace` de Chart.js, que con el techo fijado doblaba el paso y dejaba la raya de arriba suelta (0 · 10.000 · 20.000 · 30.000 · 35.000).

`GET /visibilidad/api/crecimiento`.

### Lo que se quitó, y por qué

Tres de los cuatro gráficos de antes los cubren los nuevos (el cuarto, la brecha, volvió tal cual: ver arriba):

| Antes | Ahora |
|---|---|
| Capacidad por día · últimos 15 días | Horas por día, rango «15 días» (y el resto de rangos) |
| Acumulado vs Ideal vs Crítico | entero en Cómo vamos, con el mes anterior encima. El crítico pasó de rojo al 40 % (lo que más se veía sin ser un dato) a un lavado suave |
| Horas efectivas por día (y su espera) | Horas por día por días; la espera y la utilización, en el globo y en su tabla |
| Brecha sobre el ideal | **volvió el mismo día, en barras** (ver «2 bis»): se quitó y Camilo la echó de menos |

`/api/ultimos` y `ultimosDias` (Madrid y Barcelona) se quitaron: no los llamaba nadie más.

## Qué enseñan con los datos de producción (25/10/2026, 18:08)

Sacado de las fotos diarias de producción (lectura), con las mismas cuentas. Los periodos anteriores, con la corrección de la revisión (la misma longitud que los días cerrados), salen de las fotos de la copia local, que son las de producción hasta el 22/10:

- **Los últimos 15 días**: 938 h/día de media, **+8 %** frente a los 15 anteriores (868, del 25/09 al 09/10) y un 3 % por debajo del ritmo de la meta (968). La última semana, 993 h/día, **+12,8 %** sobre la anterior (880) y un 2,6 % por encima del ritmo: cinco de sus siete días por encima; el mejor, el sábado 24/10 con 1.070 h.
- **Octubre a día 24**: 21.858 h, **+878 h (+4,2 %) sobre septiembre** a la misma altura (911 frente a 874 h/día), 1.368 h por debajo del ideal. **Cierre previsto: unas 28.800 h, el 96 % de la meta**; para llegar a las 30.000 harían falta 1.163 h/día los siete días que quedan, prácticamente la capacidad entera (16 h × 73 coches = 1.168). Va solo 35 h por encima del crítico.
- **Mes a mes** (horas por día): enero 960, febrero 959, marzo 964, abril 1.062 (el mejor), mayo 582, junio 598, julio 792, agosto 934, septiembre 874, octubre 911. **+4 % frente a septiembre, +15 % frente a julio, −5 % desde enero.** Los meses de enero a junio salen del histórico de BOLT y no estarán en producción hasta aplicar db/217.

## Historial

- **25/10/2026** · Los gráficos nuevos (rangos, cómo vamos, cómo hemos crecido), la historia de antes del núcleo (db/217) y `serieMes` con su regla. Ver [[Historial de decisiones]].
- **25/10/2026** · La revisión: el periodo anterior con la longitud de los días cerrados, el ritmo de la meta de esos mismos días, el mes cerrado comparado entero, el mes sin datos, «—» sin pedidos, el turno de cada carga, los días sin foto que rellena el rango, «Todo» recortado, `agrupar` por lista, la escala sin `grace`, los meses con pocos días en gris y el píxel de más de las tarjetas a 375 px.
- **23/10/2026** · El Inicio enseña sus cifras ([[Inicio]]).
- **07/10/2026** · La Visibilidad de Barcelona: la misma pantalla con sus datos.
- **06/10/2026** · El turno es su gente, no un reloj (`repartoTurnos`).

Relacionado: [[Inicio]] · [[Barcelona]] · [[Jornada y turnos]] · [[Componentes de la casa]] · [[Identidad visual]]
