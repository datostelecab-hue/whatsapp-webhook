---
tags:
  - telecab
  - como-se-trabaja
  - glosario
  - vocabulario
---

# Glosario

El vocabulario de la casa. Son palabras que en este ERP significan **una cosa
concreta**, y casi todas se eligieron para no repetir una confusión que ya pasó.
Si una pantalla y otra dan números distintos, casi siempre es que una de las dos
está usando mal uno de estos términos.

Ver también [[Reglas de la casa]], [[Trampas conocidas]] y [[Jornada y turnos]].

---

### Adaptador

Un fichero que habla con el mundo de fuera ([[BOLT]], [[Mapon]], WhatsApp, Drive,
Sheets, el correo) o que es herramienta pura (cifrar, dar formato a un Excel). **No
sabe nada del negocio**, así que lo puede usar cualquier capa: es el suelo, no un
piso. La lista está escrita a mano en `scripts/comprobar-capas.js`, no se adivina
por el nombre.

### Ancla (de odómetro)

Los kilómetros del cuadro anotados a mano en una fecha, para los coches cuyo GPS no
lee el CAN. Desde ahí la cuenta se mantiene sumando el incremento de `mileage`. Ver
[[Km por odometro CAN]].

### Asiento

La unidad del libro del convenio: un [[#Tramo|tramo]] etiquetado con su supuesto del
artículo 18.6.

### Backfill

Un repaso de un rango pasado (tramos, horas, sellos). Pide rol de desarrollador, va a
segundo plano si es largo, y **todos son idempotentes**. Consume cuota de Google, y
el login también lee de Sheets: por eso tiene parada de emergencia.

### Barrio

La zona de casa del conductor ("Aluche", "San Blas"), y sirve para repartir
[[#Cuadrante|cuadrantes]]. **No es la localidad**, que es el municipio de la
gestoría. Se editan en sitios distintos y no se tocan entre sí.

### Bitácora

El calendario de lo que de verdad pasó, persona a persona y día a día: horas
trabajadas, J, L y ausencias. Vive en `/bitacora`, cuenta por
[[#Jornada operativa|jornada operativa]] y se apoya en el histórico
[[#Sellado|sellado]]. Frente al [[#Cuadrante|cuadrante]], que dice lo que estaba
planificado, la bitácora dice **lo que ocurrió**.

### Bloque

Los días de descanso que aporta **una** matrícula. Un [[#CT (correturnos)|CT]] se
monta encadenando bloques: 32 h son 4 días (2 bloques) y 40 h son 6 días (3), y
tienen que ser disjuntos.

### Calificación (modelo ABCD)

Una letra de la A a la D por conductor y periodo, de tres métricas ponderadas:
horas (50 %), utilización (30 %) y velocidad (20 %). Vive en
`services/repo/calificacion.js`, y su trampa está avisada: las dos primeras son
**promedios diarios** y la tercera es un **total acumulado** del periodo. Los
rechazos no puntúan (decisión de Tráfico del 11/09/2026).

### Campaña (o pasada)

Las tres tandas de llamadas del arranque de cada turno. Día: 10–11, 11–12, 12–17.
Noche: 18–19, 19–20, 20–05. Abren y cierran, pero **no bloquean botones**.

### Cascada de km

El informe que sustituyó al Sankey: bruto menos conceptos igual a neto. *Todo lo que
rodó − sin nadie fichado − en descanso − esperando aviso = km con pasajero.*

### Cazamiento

El enlace conductor ↔ cuenta de [[BOLT]]. La pasada automática solo casa por
**teléfono 1:1**; quién es quién lo confirma una persona, porque el nombre no
identifica y hay homónimos reales en el padrón.

### Centinela

La fila comodín de `conductor` (`es_centinela = true`) donde se imputan las horas
cuyo conductor no se resuelve. Sin ella se perderían. No confundir con la *fecha
centinela* `9999-12-31`, que en este esquema **no se usa**: los historiales cierran
con `NULL`.

### Cierre (de periodo)

En el convenio: fotografía, congela y **sella con un manifiesto**, con quién lo hizo.
Es irreversible; lo que sobra o falta después va por
[[#Regularización|regularización]].

### Cockpit (Control · En directo)

PLAN (el cuadrante) × REALIDAD (`fv_ahora`) × ALERTAS, fundidos en JavaScript por
matrícula normalizada. Va por [[#Jornada operativa|jornada operativa]]. Ver
[[Control-En-directo]].

### Comprobador

Cada `scripts/comprobar-*.js`. Es la única red de seguridad del proyecto (no hay
pruebas ni linter) y todos están escritos para callarse antes que acusar en falso.
Ver [[Comprobadores]].

### Congelar / descongelar

En nóminas: congelar guarda **los números**, no una forma de recalcularlos, más la
configuración con la que salieron. Descongelar es del desarrollador.

### Corredor

`services/migraciones.js` y su panel `/migraciones`: lo único que aplica los
`db/*.sql`, en orden numérico, cada uno una sola vez y en su propia transacción.
**Nunca se ejecuta una migración a mano por fuera de él.** Ver [[Migraciones]].

### Corte de tramo

La regla que decide **hasta dónde cuentan los km de un tramo**. Un tramo cuenta
hasta lo primero que pase: su propio fin, que otro conductor se conecte a ese
coche, que él aparezca en otro coche, o un tope de 12 horas. Es la regla que más
veces se ha equivocado. Ver [[Corte de tramos]].

### CT (correturnos)

Quien cubre el descanso de los fijos de un coche. Libra **los días que no le
pusieron**, y su semana se arma encadenando [[#Bloque|bloques]].

### CT2

Plaza de refuerzo (los slots 4 y 5 de un coche), que solo se abre en
[[#Evento (modo eventos)|modo eventos]].

### Cuadrante

El tablero semanal de quién lleva qué coche: personas colocadas en
[[#Plaza|plazas]]. Vive en `/planificador-v2` y se entra por `tablero.service`.
Lo que se guarda vale **desde el día que se está mirando**; ninguna escritura pisa
el pasado.

### Cuenta fantasma

Un periodo en el que una persona trabajó con una cuenta de [[BOLT]] que no es
suya. Enlazarla **mueve horas —y dinero— de una persona a otra**, así que es una
de las acciones más protegidas del ERP: permiso propio bajo un prefijo limpio,
libro con quién y desde qué IP, y no solape garantizado por la base con un
`EXCLUDE`, no por la aplicación.

### Cuentas hermanas

Cuentas libres de BOLT cuyo teléfono es el de alguien que ya tiene cuenta: son las
**viejas de la misma persona** (recontrataciones, altas duplicadas). Se excluyen de
las sugerencias de cazamiento, pero sus horas sí se recogen.

### Efectivo (tiempo efectivo)

Viaje + espera, **sin descanso**, con los solapes fundidos. Es lo que cuenta como
hora trabajada en [[BOLT]], y la columna `efectivo` del catálogo de estados es la
que lo decide. La misma definición la usan la [[#Bitácora|bitácora]], los reportes,
la nómina variable y el BI: no hay un segundo número distinto en la casa.

### ETT / plantilla propia

`conductor_periodo_empleo.tipo`. A la ETT se le pone a cero todo el [[#MBO|MBO]] y
los días extra, pero **sí cobra** nocturnidad, propinas y peajes — y su plus
nocturno es **€ por hora**, no un porcentaje.

### Evento (modo eventos)

Plazas de refuerzo con fecha de caducidad —un CT2 de día o de noche que se abre
unos días—. El evento cierra **al acabar el último turno de refuerzo**, no el día
que dice el papel. Esa hora no se guarda, se calcula al leer: cambia cada vez que
alguien toca el cuadrante, y guardada mentiría.

### Exigencia

Qué le falta a alguien para poder contratarle. "Obligatorio" es propiedad de la
**relación**, no del dato: plantilla propia exige el expediente entero, la ETT lo
mínimo.

### Expediente

El historial de avisos que ha **recibido** una persona: es lo que deja traza y lo
que se mira antes de escalar. En [[#Sanción|sanciones]] y en las alertas de control
es lo que persiste hasta que alguien lo justifica con un motivo. En Selección
significa otra cosa: el conjunto de datos y papeles que se le exige a alguien de
plantilla propia.

### Falta

Día en que a alguien le tocaba salir y **no hizo ni una hora** en BOLT, sin
justificante. La [[#L (libranza)|libranza]] no cuenta como falta.

### Fijo

El titular de una plaza. Libra los días de descanso de su coche.

### Flota viva (`fv_*`)

El núcleo de la ingesta: `fv_tramo`, `fv_ruta`, `fv_franja`, `fv_matricula`. No es
un módulo y no se muda a `modules/`, porque lo leen Nóminas, Visibilidad,
Bitácora, Sanciones, Inicio y Control. Ver [[Flota viva]].

### Franja

Ventana de vigilancia de un **coche**. En [[Flota viva]] son los dos tramos en que
debería estar trabajando (06:30–15:30 y 18:30–03:30); en las alertas de Control,
mañana 8–13 y noche 20–01. Entre franjas hay relevo y no se avisa a nadie.
`franja_dia` es el día **al que pertenece** la franja, no el del reloj. No confundir
con [[#Turno|turno]] (que es de una persona) ni con [[#Tramo|tramo]].

### Frescura

De cuándo son los datos que se están enseñando. *"Es lo que distingue 'no ha pasado
nada' de 'hace rato que no llega nada'."*

### Gracia

Los 10 minutos de cortesía tras cerrar una franja, porque las órdenes de BOLT llegan
con retraso.

### Hueco

Vacante armada encadenando plazas vacías. Frente al [[#Recambio|recambio]], donde la
plaza **sí** tiene dueño.

### Huérfano

Dos usos, y conviene no mezclarlos:

- **Km huérfanos**: kilómetros que rodó un coche sin que nadie estuviera conectado
  en BOLT. No desaparecen: se calculan **por resta** —porque la resta no se puede
  despistar— y salen en el aviso de coches rodando sin nadie dentro. La cuenta cierra
  siempre: *flota = en BOLT + por fuera + huérfanos*.
- **Fichero huérfano**: el que ya no alcanza nadie, según
  `node scripts/inventario-muerto.js`.

### Incorporación

El traspaso de Selección a Planificación: `encargoDeColocar()` prepara **qué** plazas
y **desde cuándo**, y `tablero.service.aceptarIncorporacion()` coloca. Se marca
aceptada **después** de colocar, no antes.

### Ingesta

La **única puerta** por la que entran los datos de [[BOLT]] y [[Mapon]]:
`services/ingesta.js`, con sus tareas periódicas. Todo lo demás lee de PostgreSQL.
Lo vigila `scripts/comprobar-ingesta.js`.

### J (justificante)

La marca con la que Tráfico justifica el día de un conductor que no llegó a horas.
Tiene tres estados y **no significan lo mismo**:

- **Pendiente = presunta.** Cuenta como hora presunta (azul) hasta que alguien la
  mira.
- **Aprobada.** Es la única que entra en bitácora y en nómina.
- **Rechazada.** Es una alerta para volver a llamar, no un silencio; y tiene dos
  finales posibles, rehacerla o cerrarla.

Hay cinco tipos por **quién responde** de ella: tráfico, RRHH, BOLT, taller y por
compañero. Vale el día entero pero **topada**, y sí cuenta para el exceso de horas.

### Jornada operativa

El día operativo va de las **05:00 a las 05:00** del día siguiente, y **no** es el
día natural: de madrugada (00:00–05:00) seguimos en la de ayer. Es la base de todo
lo que cuenta horas: Visibilidad, la bitácora, el reporte de horas, Control y las
alertas. La constante vive en `services/nucleo.js` y no se copia: dos copias de la
hora que parte el día es la forma más silenciosa de que dos pantallas no cuadren.
La excepción es la nómina, que va por día natural a propósito. Ver
[[Jornada y turnos]].

### Km por fuera

Kilómetros que el coche recorrió **sin pedido** o **con la app cerrada**: rodó, pero
no facturó. Es la pregunta que contesta la auditoría de flota. Ver
[[Auditoria de flota]].

### Km sin dueño

Ver [[#Huérfano|huérfano]]. Los km de un coche que se movió sin nadie conectado, o
los de una cuenta que en ese momento no tenía titular resuelto.

### L (libranza)

El día de descanso que le toca a alguien por cuadrante. **Ya no se teclea: sale del
cuadrante**, por la vista `v_conductor_libranza` (`db/113`). **Trabajar el día de
libranza no es una falta** y la libranza no cuenta como ausencia. La libranza manual
de RRHH vive en `bitacora_dia`, no en el cuadrante, y una J no puede machacarla.

### Lista roja

En las campañas de llamadas: sin conectar, cero horas y sin J.

### MBO

Los dos incentivos variables de la nómina: **MBO horas extra**
(`diferencia × € hora extra × utilización`) y **MBO FAS**
(`(facturación neta − umbral) × % MBO FAS`). **No se suman: se cobra el mayor.**

### Mes vencido / mes trabajado

La nómina de un mes paga el trabajo del mes **anterior**, y el selector es el mes de
**pago**. El Excel de la ETT va por mes **trabajado** y tiene su propio selector.

### Modo test / live

Las alertas y las sanciones nacen en `test`: **registran y no mandan** hasta que se
eligen destinatarios y se pasa a `live`.

### Módulo

Una carpeta de `modules/<Nombre>/` con sus `*.controller.js`, `*.service.js`,
`*.repo.js`, sus `vistas/` y su `LEEME.md`. Es un módulo **solo si desde fuera se
entra por su `.service`**; si otros le meten la mano al repo, es una carpeta.

### Momento

El parámetro que permite mirar una fecha pasada: quién estaba de alta, en qué turno
y en qué coche.

### NN

Dos usos, los dos frecuentes:

- **En Control y en los reportes**: quien **trabajó sin que el cuadrante lo
  esperase**. No tiene turno asignado, así que se le imputa el que estaba en curso
  y aparece partido en día y noche. Es el que hay que mirar.
- **En facturas de taller**: una línea cuyo papel **no dice de qué coche es**. Se
  le reclama al taller. Es distinto de [[#No reconocida|"no reconocida"]].

### No reconocida

Línea de factura cuya matrícula **sí consta** pero no la tenemos dada de alta: se
comprueba aquí, no se le reclama al taller. Empezó contada junto a [[#NN|NN]] y lo
destapó una prueba: una matrícula mal tecleada salía como NN, y entonces se le
reclamaba al taller algo que sí había puesto.

### Núcleo

Dos cosas distintas según el contexto:

- `services/nucleo.js`: constantes y funciones puras, sin base de datos, sin red y
  sin decisiones. Lo usa cualquier capa sin saltarse nada. La prueba para saber si
  algo va ahí: *si para usarlo hay que levantar algo, no va ahí*.
- **El núcleo de la ingesta**: `services/flotaViva/`, o sea las tablas `fv_*` y
  cómo se le pregunta a BOLT y a Mapon.

### Padrón

La lista de cuentas de BOLT con nombre y teléfono, hoy en `conductor_externo`
(1.626 cuentas).

### Parrilla (el ANEXO)

El Excel del cuadrante que se imprime y se cuelga. Por eso las fechas llevan el año
entero, y por eso el color se decide por **si hay gente**, no por si hay texto.

### Parte

El informe de un día, o de una franja.

### Patrón (de libranza)

La libranza puesta a mano. Se llama así y **no** `libranzas` para no pisar el texto
legible que ya viene del listado ("L M"); si se llamara igual, la pantalla enseñaría
un objeto.

### Plaza

El hueco concreto de un coche en un turno; cada coche abre **seis** al crearse. Las
personas se colocan en plazas, no en coches: por eso una [[#Vacante|vacante]] apunta
a la plaza desde el primer momento, y por eso mover a alguien puede dejar a otro sin
plaza.

### Presunta

Ver [[#J (justificante)|J]]. Una hora presunta es la que aporta una J todavía
pendiente: se pinta en azul, se ve, y **no cuenta** hasta que se aprueba.

### Prorrateo

El objetivo mensual se parte por días de alta **en el mes**, arrancando en la
**fecha de alta**, no en el primer día con horas.

### Puerta

El `*.service.js` de un módulo: la única entrada legítima desde fuera. "Poner la
puerta" es lo que convierte una mudanza de carpeta en un módulo de verdad.

### Quincena (y el corte)

La caja donde se guarda cada cierre de BOLT en recaudación. Lo anterior al **corte**
lo manda el Excel importado, y el repositorio **se niega a tocarlo**.

### Recambio

Buscar quién sustituye a una persona que se va. Parte **de la persona**, no de la
plaza: se leen sus plazas, su zona y sus libranzas, y de ahí sale la propuesta. En
el cuadrante, un recambio explica por qué existe el hueco: quién se va y cuándo.
Frente al [[#Hueco|hueco]], aquí la plaza tiene dueño.

### Reexportador (o puente)

Un fichero de una línea que queda en la ruta vieja tras mudar un módulo
(`module.exports = require('../modules/X/x.repo')`). Existe para que una referencia
que se haya escapado no dé un 500 en producción. Es **deuda con fecha de
caducidad**: se borra cuando `inventario-muerto.js` diga que no lo apunta nadie.

### Regularización

Lo que sobra o falta de un mes **ya cerrado** se apunta en el primer mes **abierto**,
nunca hacia atrás.

### Rezagado

En recaudación: quien lleva más de 7 días sin entregar. *"Ocho días ya es haberse
saltado una vuelta."*

### Ruta (`fv_ruta`)

El trayecto según el GPS. **Es de donde salen los kilómetros**, nunca de
`fv_tramo.km_m`.

### Salió / No salió

**Salió** = trabajó en su turno y estaba previsto. **No salió** = estaba previsto y
no rodó. "Salió" mira **minutos, no kilómetros**: un tramo desconectado suele llevar
conductor.

### Sanción

El registro legal de un exceso de velocidad detectado por [[Mapon]] y atribuido a
un conductor de [[BOLT]]: aviso por WhatsApp más apunte en un libro aparte. Solo
entran los atribuidos **con certeza**. Un [[#Simulado|simulado]] no es una sanción.
Ver [[Sanciones de velocidad]].

### Sede

De qué **operación** es el coche (madrid / barcelona). Distinto de `base_zona_id`,
que es desde qué barrio sale dentro de ella.

### Sellado (y resellar)

El histórico ya calculado y **congelado**: `bitacora_horas` más su marca en
`bitacora_sello`. Sirve para que el pasado no se recalcule cada vez que alguien
abre una pantalla, y para que la letra de un periodo cerrado no se mueva porque
alguien toque otra cosa. Un día en el que no trabajó nadie **también se sella**.
Resellar reescribe histórico, así que es solo del desarrollador.

### Simulado

Lo que se **habría** mandado en modo pruebas: al conductor no le llegó nada. Se
cuenta y se enseña **aparte** de lo avisado. *"Decirle 'te hemos avisado cinco veces'
cuando no ha recibido ni uno es la peor manera posible de empezar esa
conversación."*

### Tanda (`solicitud`)

La unidad con la que se le contesta a la agencia de la ETT. El Excel se manda por
tanda **entera**.

### TE_NO / TE_A1

Los supuestos del artículo 18.7 del convenio: espera que **no computa** frente a
espera **dentro del área**, que sí cuenta como trabajo efectivo. El área se prueba
con las zonas de [[Mapon]].

### Telefonito

El registro rápido de llamadas desde Control · En directo (`llamada_seguimiento`),
con su jornada 05→05.

### TodoTurno

El tercer valor de turno, junto a día y noche. Su jornada no cierra a la misma hora,
y por eso hay un recálculo a mediodía.

### Tramo

Un trozo de la línea de tiempo **de un vehículo** según el estado de [[BOLT]]:
viaje, espera, descanso, desconectado. Vive en `fv_tramo` y lo construye el motor
de [[Flota viva]] reproduciendo **todos** los apuntes de estado en orden. Se
**recorta** por el día, no se le da entero al día en que empieza. Los kilómetros
**no salen de aquí** sino de `fv_ruta`. Ver [[Corte de tramos]].

### Trinquete

El nombre de cómo aprietan las reglas de capas: lo que en `routes/` es solo un
aviso, dentro de `modules/` ya es falta. La regla aprieta hacia adelante y no
afloja.

### Turno

La ventana de trabajo de **una persona**: día 05→17, noche 17→05(+1). No confundir
con [[#Franja|franja]] (que es del coche) ni con [[#Jornada operativa|jornada
operativa]] (que es el día entero, 05→05). El "completo" **no** es día + noche: la
madrugada de 00:00 a 05:00 es del turno de noche de la víspera y se cuenta aparte.

### Utilización

Tiempo en viaje partido por tiempo [[#Efectivo (tiempo efectivo)|efectivo]]
(viaje + espera). Es la misma definición en el BI, en la nómina variable y en la
calificación. Una J suma a las horas pero **no** entra en la utilización: no genera
viaje ni espera, y meterla en el denominador castigaría dos veces a quien pasó la
mañana en el taller. La pantalla enseña siempre la **real**, antes del recorte.

### Vacante

Una plaza abierta que hay que cubrir, con sus **plazas reales** contadas. La
vacante apunta a la plaza desde el principio, no a la matrícula: cuando apuntaba a
la matrícula, el alta fallaba con la persona ya contratada. Una vacante **viva** es
abierta o en proceso, que no es lo mismo que "no cerrada": una anulada tampoco está
cerrada.

### Vigencia

La forma que comparten diez tablas del esquema: una entidad, un `desde` y un
`hasta` que vale `NULL` mientras siga abierta (empleos, situaciones, turnos,
libranzas, teléfonos, cuentas externas, asignaciones, estados y bases de coche,
cortes de turno). Todas se leen y escriben por `services/repo/vigencia.js`, para no
repetir cuarenta consultas casi iguales y cuarenta oportunidades de olvidar el
`hasta IS NULL`. Ver [[Base de datos]].

### Zona

La agrupación operativa de un coche dentro del cuadrante. En el BI la zona sale
del cuadrante, no de la ficha del coche.
