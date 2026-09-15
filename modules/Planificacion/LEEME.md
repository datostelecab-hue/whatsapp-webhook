# Planificación

Quién conduce qué coche, qué día y en qué turno. De aquí sale el plan contra el
que Control compara la realidad, el WhatsApp que le dice a cada conductor cuándo
trabaja y la parrilla que se imprime.

```
/planificador  ·  /planificador-v2     el tablero (la misma pantalla, dos URL)
/planificador-v2/api/tablero           el cuadrante de una semana
/planificador-v2/api/guardar     POST  mover gente entre plazas
/planificador-v2/api/eventos           el modo eventos (CT2 abiertas unos días)
/planificador-v2/api/incorporaciones   la alerta de quien acaba de entrar
/cobertura                             qué plazas quedan sin cubrir
/cobertura/enviar-turnos         POST  el aviso por WhatsApp
```

## Las piezas

```
tablero.controller.js     HTTP. No decide nada.
tablero.service.js        el cuadrante, y LA PUERTA del módulo
planificador.repo.js      el SQL del cuadrante (2.262 líneas)
eventos.repo.js           las plazas de refuerzo con fecha de caducidad
cobertura.controller.js   HTTP de la semana y del aviso
cobertura.service.js      a quién se avisa, a qué ritmo y qué se apunta
cobertura.repo.js         el SQL de la semana · avisos.repo.js  el registro de avisos
avisoTurnos.service.js    qué semana verá quien pulse el botón del WhatsApp
turnos.service.js         el mensaje que lee el conductor en el bot
parrilla.excel.js         el ANEXO que se imprime
hoja.repo.js              las filas de PLANIFICADOR_V2 y BASES, desde PostgreSQL
vistas/planificadorV2.ejs · vistas/cobertura.ejs
```

Desde fuera del módulo se entra por `tablero.service` o por `cobertura.service`,
nunca por un `.repo`.

## Lo que hay que saber

**Lo que se guarda vale DESDE el día que se está mirando**, y lo que hubiera
antes se cierra la víspera. Así se puede poner a uno el 25 y a otro el 28 en la
misma plaza sin borrar lo del 25. Ninguna escritura pisa el pasado.

**Toda escritura devuelve el tablero recalculado.** No es comodidad: el front lo
sustituye entero y así no se queda pintando algo que la base ya no dice. Cuando
cada botón se refrescaba solo, dos personas moviendo el mismo cuadrante veían
cosas distintas hasta recargar.

**"El coche ya lo lleva otro" no es un error: es una pregunta.** Viaja con su
código y con la comprobación entera, para que la pantalla ofrezca planificar a
la fuerza sin volver a consultar.

**El aviso de turnos manda la PLANTILLA, no el detalle.** El mensaje lleva un
botón; el conductor lo pulsa y es el bot quien le cuenta sus turnos. Por eso al
enviar se marca la semana: cuando pulse, tiene que ver ESA y no la de hoy.

**Un envío masivo a la vez, y a 1,2 segundos por mensaje** (~50/min, por debajo
de los límites de Meta). Doscientas personas son cuatro minutos: va en segundo
plano y el panel sondea el progreso. El segundo envío recibe un 409, no una cola.

**El apunte nunca tumba el envío.** Si el registro falla, el WhatsApp sale igual.
No avisar a nadie porque no se pudo escribir una fila sería cambiar un problema
de contabilidad por uno de operación.

**El barrio no es la localidad.** `barrio` es la zona de casa del conductor
("Aluche", "San Blas") y sirve para repartir cuadrantes; `localidad` es el
municipio de la gestoría. Se editan en sitios distintos y no se tocan.

## La puerta, y quién llama a ella

Cinco sitios leían el cuadrante entrando directamente a `repo/planificador`:
Control (el cockpit, el reporte 5-5, el Excel de turnos y la parrilla), Selección
(el generador de vacantes) y el bot de las puertas. Ahora entran por
`tablero.service` / `cobertura.service`, que exponen **solo lo que piden**:

```
tablero.service    tablero({dia}) · contactos() · salidasHoy() · salidasPorCoche()
                   lunesDe() · parrilla(dia) · GRUPOS_SALIDA
                   liberarPlaza() · reponer() · repasarEventos()
cobertura.service  datos(semana) · conductorPorTelefono(tel)
```

`tablero({ dia })` conserva **la firma del repositorio** a propósito. Cambiarla al
poner la puerta habría sido meter un error de firma en cinco sitios a cambio de
nada. (Y aun así se coló uno: el controlador pasaba `req.query.dia` posicional a
una función que desestructura, y el tablero ignoraba la fecha y pintaba siempre
la semana de hoy. Lo cazó la comprobación en vivo, no la lectura del código.)

## Lo que se partió, y por qué

**`repo/incorporaciones` colocaba gente en el cuadrante.** Es el traspaso entre
Selección y Planificación —lo usan también la ETT y el alta rápida—, así que un
repositorio compartido tenía dentro el repositorio del planificador. Se partió
en dos:

- `repo/incorporaciones.encargoDeColocar()` prepara **qué** plazas y **desde
  cuándo** (es quien guarda la foto de la vacante), y `marcarAceptada()` apunta
  el resultado.
- `tablero.service.aceptarIncorporacion()` **coloca**, que es escribir en el
  cuadrante, y eso es de aquí.

El orden importa: se marca aceptada **después** de colocar. `plan.guardar` es
todo o nada, así que si una plaza ya no existe la alerta sigue pendiente y se
puede reintentar, en vez de quedarse cerrada sin haber colocado a nadie.

**Seis copias de los días de la semana.** `planificadorV2`, `repo/cobertura`, el
Excel de turnos, el de la parrilla, el generador de vacantes y Control tenían
cada uno su array. Bajaron a `services/nucleo.js` como `DIAS_CORTOS`,
`DIAS_LARGOS` y `LETRAS_DIA`. No es limpieza porque sí: la copia del motor del
planificador obligaba al tablero a llamar hacia arriba, a un servicio de hojas,
solo para saber cómo se abrevia "miércoles".

## La parrilla impresa dice lo que dice la pantalla

El Excel del ANEXO imprimía solo a quien estaba HOY en cada plaza, y una plaza
vacía salía en blanco sobre amarillo. Eso perdía las tres cosas que más se
preguntan mirando el papel, y ahora salen:

- **Quién llega.** Una plaza puede estar vacía —o con un temporal— y tener ya
  dueño para dentro de dos semanas: `→ Cristian Jiménez · llega 18/09/2026`. Con
  el año entero, porque esto se imprime y se cuelga: "llega el 18/9" leído en
  diciembre no dice de qué año es.
- **Que el hueco ya está prometido.** Un hueco en vacante —y más si Selección ya
  le engachó candidato— no es el mismo hueco: no hay que buscar a nadie, hay que
  esperar. Va en azul y no en amarillo, porque contarlos juntos infla la falta.
- **El relevo de una ausencia.** El titular de vacaciones y quien le cubre son
  dos personas en la misma plaza; antes solo salía una.

Y el color de la celda pasó a decidirse por **si hay gente, no por si hay
texto**. Antes se miraba si la celda estaba vacía; ahora un hueco SÍ escribe, así
que con la regla vieja las plazas por cubrir habrían dejado de salir amarillas
justo al empezar a explicarse.

## Lo que se quedó fuera, y por qué

**`agenda` y `matching` SE BORRARON** (15/09/2026). La agenda de tráfico era un
segundo sitio para mirar lo que ya está en Plantilla —turno, libranzas, coche,
teléfono— y además era la única pantalla que **escribía** en la hoja `AGENDA_V2`.
`matching` no se usaba.

**`fichas` y `libranzas` siguen fuera**, pero ya no por las hojas: desde el
15/09/2026 el motor viejo NO LEE GOOGLE para nada. Los conductores salen de
`repo/agenda` y los coches, las plazas y las zonas de aquí (`hoja.repo`). Lo que
queda es solo mudanza de ficheros.

## El último trozo del motor viejo que leía Google

`services/planificadorV2.js` sigue vivo porque ~18 sitios lo llaman, y su
`calcularTablero` es una función PURA que recibe los valores de las hojas tal
cual venían. `hoja.repo` le da esas mismas filas desde la base.

**Se siguen produciendo filas con forma de hoja a propósito.** Reescribir
`calcularTablero` —mil líneas de reglas probadas contra 87 coches— para que lea
otra forma es justo el cambio que no se puede revisar de un vistazo. La forma
rara vive en un solo fichero y se tira entera el día que el motor muera.

La hoja `PLANIFICADOR_V2` era, a estas alturas, **una copia**: el cuadrante que
se usa a diario ya estaba en PostgreSQL y la hoja solo alimentaba al motor. Dos
fuentes del mismo dato, y una sin nadie que la actualizara.

Tres traducciones que importan, y la primera es la que podía romperlo todo:

- **El ID_BOLT se le pide a `v_agenda`, no se recalcula.** Es la clave con la que
  el motor cruza las dos mitades, y es un NOMBRE, no un uuid: armarlo aquí con
  otra expresión —aunque fuera "la misma" escrita dos veces— bastaría para que
  un conductor apareciera en la agenda y no en su coche.
- **El estado del coche va en el símbolo de la hoja.** La base tiene códigos y el
  motor compara contra `✓`: se traduce solo el operativo, el resto son las
  mismas letras.
- **Las fechas en ISO**, que `parseFecha` acepta, para no dar el rodeo por
  dd/mm/aaaa y arriesgarse a invertir día y mes.

**Comprobado plaza a plaza**: el motor viejo leyendo de PostgreSQL y el
planificador del módulo dicen lo mismo en las **480 plazas de los 80 coches**,
sin una sola diferencia.

**`repo/incorporaciones` y `repo/alta` siguen en `services/repo/`.** Son la
frontera entre Selección, Conductores y este módulo, y los tres las usan. Un
repositorio puede llamar a otro repositorio; si entraran aquí, Selección estaría
entrando al repositorio de Planificación.

## Lo que aún no está bien

`planificador.repo.js` son 2.262 líneas con reglas dentro que son de servicio
—qué pasa al cambiar un coche, cómo se encadena un relevo—. Se movió el módulo
primero: mover y partir a la vez es como se pierde una ruta sin enterarse.
