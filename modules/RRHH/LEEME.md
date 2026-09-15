# RRHH

Lo que el convenio VTC obliga a llevar: la jornada de cada trabajador contra su
objetivo, el cierre del periodo, la nómina que se manda a la gestoría y el cuadro
de absentismo.

```
/convenio             la jornada del mes
/convenio/cierre      cerrar un periodo (y regularizar en el siguiente)
/convenio/nomina      la nómina, con su export a la gestoría
/convenio/absentismo  el cuadro por módulos del convenio
/pendientes           el buzón (sus datos salen de /notificaciones)
```

## Las piezas

```
convenio.controller.js   HTTP. No decide nada.
convenio.service.js      qué mes se mira, el cierre, la regularización
convenio.repo.js         el SQL del panel, el cierre y la nómina
convenio.motor.js        contratos, objetivos y derivación de la jornada
contratos.repo.js        el SQL de contrato y objetivo_mensual
jornada.repo.js          de los estados de BOLT a asientos del convenio (Hito 2)
nomina.excel.js          el libro que se manda a la gestoría
pendientes.controller.js una pantalla, sin dominio detrás
vistas/                  convenio · convenioCierre · convenioNomina ·
                         convenioAbsentismo · pendientes
vistas/partials/         convenio-nav (solo lo usan estas cuatro)
```

Desde fuera del módulo se entra por `convenio.service`, nunca por `convenio.repo`.

## Lo que hay que saber

**El mes por defecto es el ÚLTIMO CON OBJETIVOS, no el de hoy.** Los objetivos se
cargan por adelantado y el mes en curso casi nunca es el que se está revisando.
Se resuelve en el servidor para que el selector y la primera carga salgan ya en
el mes correcto, sin un parpadeo. Y si la base no contesta, se cae al mes natural
y la pantalla sale igual: un fallo de lectura no puede dejarla en blanco.

**Cerrar un mes es irreversible y deja rastro.** Fotografía, congela y sella con
un manifiesto, y queda apuntado quién lo hizo. Es la pieza que hace que un
periodo cerrado siga diciendo lo mismo dentro de un año, que es lo que pide una
inspección.

**La regularización va al mes abierto siguiente, no hacia atrás.** Corregir un
mes cerrado rompería el sello; lo que sobra o falta se apunta en el primer mes
abierto. Si no se dice cuál, se toma el siguiente al cerrado.

**La nómina y los finiquitos van en hojas separadas**, y la segunda solo si la
hay. Son dos trámites con dos plazos distintos: la nómina se presenta el mes que
viene y un finiquito se paga al irse la persona. Mezclados en una tabla, el
finiquito se cuela como un trabajador más con un importe raro. Y una hoja vacía
en un libro que va a la gestoría es una pregunta garantizada por correo.

**Un hueco vacío no es un cero.** En el Excel, `null` deja la celda en blanco y
un cero dice "se calculó y salió cero". En una nómina esa diferencia se discute.

**Los minutos van en minutos**, no en horas decimales: el convenio los cuenta así
y la gestoría los teclea así.

## El partial se mudó con sus vistas

`partials/convenio-nav.ejs` entró en `modules/RRHH/vistas/partials/` porque solo
lo usan estas cuatro pantallas. Es al revés que `control-nav`, que se quedó en
`views/` porque `reportes.ejs` —que no se ha mudado— también lo incluye. EJS
busca primero al lado de la plantilla y después en las raíces de `views`, así que
las dos formas funcionan; la diferencia es de quién es el fichero.

## Lo que NO se mudó, y por qué

**`rrhh`, `peticiones` y `ticketera` se quedan donde están.** Las tres cuelgan de
Google Sheets:

| Ruta | Motor | Además |
|---|---|---|
| `/rrhh` | `services/tickets.js` (880 líneas, sobre hojas) | lo usan también `administracion`, `botPuertas`, `fichas` y `notificaciones` |
| `/peticiones` | `services/peticiones.js` (hojas) + `planificadorV2` | |
| `/ticketera` | `services/ticketsRRHH.js` (hojas) + `planificadorV2` | |

Es la misma regla que dejó fuera a `agenda`, `fichas` y `libranzas` en
Conductores: meterlas en un módulo sería meter Sheets dentro, en la dirección
contraria a la que va el proyecto. Y `tickets.js` tiene un agravante propio —lo
consumen cuatro rutas de fuera—: mudarlo obligaría a media casa a entrar por la
puerta de RRHH para algo que hoy es infraestructura compartida.

Se mudan cuando esa parte pase a PostgreSQL.

## El motor: lo que estaba escrito y no estaba enchufado

El Hito 2 —convertir los cambios de estado de BOLT en asientos del convenio—
estaba **escrito desde hacía meses y no lo llamaba nadie**. `jornada.repo`
(antes `services/repo/jornada.js`) no aparecía en un solo `require` del
proyecto. Resultado: cero contratos, cero objetivos, cero asientos, cero
registros, y las cuatro pantallas de /convenio en blanco pareciendo rotas.

Lo que faltaba está en `convenio.motor.js`, en el orden en que hay que hacerlo:

```
1. CONTRATOS   sin contrato no hay objetivo: objetivo_mensual cuelga de contrato
2. OBJETIVOS   sin objetivo no hay contra qué comparar
3. DERIVACIÓN  los asientos y el registro del art. 18.9
```

Y se enchufa por tres sitios: el **cron de las 05:50** (deriva ayer; el día 1 de
cada mes abre contratos y publica objetivos), las **rutas `/convenio/api/motor/*`**
(para arrancar, ponerse al día o saber por qué algo sale vacío) y
`convenio.service`, que es la puerta por la que entra el cron.

### Las cuatro decisiones que se tomaron

**Contrato solo para plantilla propia.** El objetivo mensual, el cierre y la
nómina son obligaciones NUESTRAS; a la gente de la ETT la contrata la agencia.
Lo que sí se les calcula es el REGISTRO DE JORNADA, porque cuántas horas hizo
alguien en nuestros coches es un hecho y hace falta para el parte de la agencia.

**Grupo G3A por omisión** (conductores de aplicación): es lo que son casi todos
y lo que el propio esquema documenta como normal. Quien no lo sea se corrige a
mano; abrir un contrato mal es mejor que no abrirlo, porque uno equivocado se ve
y uno que falta no.

**40 horas cuando no consta.** 77 de las 215 personas no tenían `jornada_horas`
anotada. Sale contado aparte en el resultado, para que RRHH sepa a cuántos hay
que mirarles la ficha.

**El contrato empieza el día del alta**, aunque sea de 2022. El objetivo se
prorratea por días de alta EN EL MES, así que una antigüedad larga no inventa
objetivos de meses viejos.

### El agujero que apareció al generar objetivos de verdad

`f_objetivo_min` prorrateaba las 1.776 h del convenio por días de alta **y nada
más**: a quien tiene 32 horas le exigía lo mismo que a quien tiene 40, un 25 %
de más todos los meses. Con `contrato` vacío no se notaba. `db/112` añade
`contrato.horas_semana` y escala el objetivo por ella, leyendo la semana completa
de `agreement_parameter` (NON_DRIVER_WEEKLY_HOURS) y no de una constante.

Comprobado contra las seis combinaciones que hay en producción: 40 h y mes
completo → 8.758 min; 32 h → 7.007; y los prorrateos de 28, 27, 26 y 23 días de
alta, todos clavados.

### Dos consultas que hacían la derivación inviable

Derivar un día tardaba **cuatro minutos**, y esto corre cada noche:

- `enArea` se preguntaba **una vez por tramo de espera** —~1.700 al día— contra
  una base que está en Frankfurt. Ahora va en una sola ida y vuelta
  (`staging.enAreaVarios`): medido, 37× más rápido y la misma respuesta.
- `guardarAsientos` insertaba **de uno en uno**. Ahora es un `unnest` con el
  mismo `ON CONFLICT`: la idempotencia no depende de cuántas filas viajen juntas.

Con las dos, un día baja a **17 segundos**, y los 13 días de historia que había
en `bolt_state_log` se derivaron en dos minutos.

## Lo que aún no está bien

**LA ESPERA NO CUENTA COMO TRABAJO, Y NO ES UN FALLO DEL CÓDIGO.** El art. 18.7
dice que estar conectado esperando solo es trabajo efectivo si estás DENTRO DEL
ÁREA. El área se prueba con las zonas de Mapon, y hoy hay **17 cruces de zona en
dos semanas, sobre 2 zonas**, para una flota de ~100 coches. Consecuencia: de los
minutos derivados, **138.481 de espera caen a TE_NO (no computa) y CERO a TE_A1**.

Son 2.308 horas en trece días que el convenio no reconoce como trabajo. El
cálculo es correcto; lo que falta es configurar las zonas en Mapon. Hasta que se
haga, el "cumplido estricto" del panel va a salir muy por debajo del total, y la
diferencia es exactamente la columna `espera_fuera_area`.

**Absentismo y nómina siguen vacíos**, y eso sí son otros hitos: las ausencias
del convenio (Hito 4) y las variables de nómina (Hito 8) tienen sus propias
tablas y nadie las ha llenado. El panel de jornada, que es lo que arregla el
Hito 2, ya sale con sus 145 personas.
