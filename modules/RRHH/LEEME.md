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
convenio.repo.js         el SQL del convenio
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

## Lo que aún no está bien

**El convenio no tiene datos cargados.** Comprobado contra producción el
15/09/2026: `trabajadores`, `nominaMes`, `periodos` y `absentismo` devuelven
**cero filas**. Las pantallas funcionan, el Excel se genera y las fichas
individuales sí traen datos reales (salen de la tabla de conductores), pero los
objetivos mensuales del convenio nunca se han cargado. Eso no es un fallo de
este módulo: falta el Hito 2 de la migración del convenio.
