# Conductores

Quién trabaja aquí y en qué condiciones. La ficha de la persona, su contrato, sus papeles y
su cuenta de BOLT.

```
/plantilla                    la pantalla
/plantilla/api/lista          quién hay, con su resumen
/plantilla/api/ficha/:id      la ficha administrativa
/plantilla/api/ficha360/:id   la hoja de un vistazo
/plantilla/api/gestoria.xlsx  el Excel para la gestoría
```

## Las piezas

```
plantilla.controller.js   HTTP. No decide nada.
plantilla.service.js      La lista, los campos por rol, los papeles, el Excel.
conductores.repo.js       SQL de la persona y su contrato (1.236 líneas)
ficha360.repo.js          SQL de la hoja de un vistazo
cazamiento.repo.js        SQL del enlace conductor ↔ cuenta de BOLT
gestoria.excel.js         el fichero que se le manda a la gestoría
vistas/plantilla.ejs      la pantalla
```

Desde fuera del módulo se entra por `plantilla.service`, nunca por un `.repo`.

## Lo que hay que saber

**La misma plantilla la miran dos áreas** y buscan cosas distintas: Tráfico quiere saber
quién puede conducir hoy, RRHH quién está de alta y con qué contrato. Por eso hay **dos
fichas** —la administrativa, con sus historiales y sus acciones, y la de un vistazo— y por
eso **lo editable depende del rol**: la pantalla pregunta `/api/campos` y enseña unos campos
abiertos y otros de solo lectura, en vez de dejar intentarlo y fallar.

**Salen TODOS por omisión**: activos, ausentes y quien ya causó baja. La pregunta más
frecuente incluye a los que se fueron ("¿este trabajó aquí?"). Con `?vigentes=1` se limita a
los contratados ahora mismo.

**`momento` deja mirar una fecha pasada**: quién estaba de alta, en qué turno y en qué coche.
Con las hojas esto no se podía preguntar.

**Nada de aquí llama a BOLT.** Los datos los trae la ingesta cada pocos minutos y aquí solo
se lee de PostgreSQL. Lo único que se ofrece es saber **de cuándo son** (`/api/frescura`),
que es lo que sustituye a preguntar.

**El nombre no decide nada** en el enlace con BOLT. La pasada automática solo casa por
teléfono 1:1; quién es quién lo confirma una persona. Los homónimos existen —hay tres en el
padrón real— y una cuenta enlazada con quien no es le imputa las horas a otro.

**Pasar de ETT a plantilla propia no es una baja seguida de un alta.** La persona sigue en su
coche y en su turno, y la antigüedad de la ETT se arrastra al contrato nuevo.

**Ninguna escritura pone fechas "hasta" a mano.** Las vigencias pasan por `repo/vigencia`,
que cierra la anterior y abre la nueva en una sola transacción.

## El cazamiento con BOLT, y una infracción que murió

`cazamiento.repo.js` era `services/cazamientoBolt.js`. Al entrar en el módulo pasó de ser
"un servicio al que un repositorio llamaba hacia arriba" a ser el repositorio de al lado, y
con eso **cayó una de las siete infracciones de capas** que arrastraba el proyecto.

Al moverlo apareció otra: pedía el padrón de BOLT a `services/conductoresBolt.js`, que es un
padrón **sobre hojas de cálculo** con la llamada a la API metida dentro. Eso convertía a este
repositorio en uno que depende de Sheets sin necesitarlo. La llamada se mudó a
`services/bolt.js` —el adaptador, que es donde vive "cómo se le pregunta a BOLT"— y los dos
la usan de ahí. `conductoresBolt` la reexporta con su nombre de siempre.

## Lo que se quedó fuera, y por qué

**`repo/alta` sigue en `services/repo/`.** Es el traspaso desde Selección y lo usan también
`tickets`, `candidaturas.repo` y `ett.service`. Si entrara aquí, Selección estaría entrando
al repositorio de otro módulo. Se coloca cuando se decida dónde vive la frontera.

**`agenda`, `fichas` y `libranzas` NO son de aquí todavía**, aunque el reparto original las
ponía en Conductores. Las tres cuelgan de `services/planificadorV2.js`, que lee de las hojas
`AGENDA_V2`, `PLANIFICADOR_V2` y `BASES`. Meterlas en un módulo sería meter Sheets dentro,
justo en la dirección contraria a la que va el proyecto. Se mudan cuando esa parte pase a
PostgreSQL.

## Lo que aún no está bien

`conductores.repo.js` son 1.236 líneas con reglas dentro que son de servicio: qué campos
puede tocar cada rol, qué pasa al dar de baja. Se movió el módulo primero porque mover y
partir a la vez es cómo se pierde una ruta sin enterarse.
