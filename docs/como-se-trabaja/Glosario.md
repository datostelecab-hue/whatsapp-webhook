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

### Calificación (modelo ABCD)

Una letra de la A a la D por conductor y periodo, de tres métricas ponderadas:
horas (50 %), utilización (30 %) y velocidad (20 %). Vive en
`services/repo/calificacion.js`, y su trampa está avisada: las dos primeras son
**promedios diarios** y la tercera es un **total acumulado** del periodo. Los
rechazos no puntúan (decisión de Tráfico del 11/09/2026).

### Centinela

La fila comodín de `conductor` (`es_centinela = true`) donde se imputan las horas
cuyo conductor no se resuelve. Sin ella se perderían. No confundir con la *fecha
centinela* `9999-12-31`, que en este esquema **no se usa**: los historiales cierran
con `NULL`.

### Comprobador

Cada `scripts/comprobar-*.js`. Es la única red de seguridad del proyecto (no hay
pruebas ni linter) y todos están escritos para callarse antes que acusar en falso.
Ver [[Comprobadores]].

### Corredor

`services/migraciones.js` y su panel `/migraciones`: lo único que aplica los
`db/*.sql`, en orden numérico, cada uno una sola vez y en su propia transacción.
**Nunca se ejecuta una migración a mano por fuera de él.** Ver [[Migraciones]].

### Corte de tramo

La regla que decide **hasta dónde cuentan los km de un tramo**. Un tramo cuenta
hasta lo primero que pase: su propio fin, que otro conductor se conecte a ese
coche, que él aparezca en otro coche, o un tope de 12 horas. Es la regla que más
veces se ha equivocado. Ver [[Corte de tramos]].

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

### Efectivo (tiempo efectivo)

Viaje + espera, **sin descanso**. Es lo que cuenta como hora trabajada en
[[BOLT]], y la columna `efectivo` del catálogo de estados es la que lo decide. La
misma definición la usan la [[#Bitácora|bitácora]], los reportes, la nómina
variable y el BI: no hay un segundo número distinto en la casa.

### Evento (modo eventos)

Plazas de refuerzo con fecha de caducidad —un CT2 de día o de noche que se abre
unos días—. El evento cierra **al acabar el último turno de refuerzo**, no el día
que dice el papel.

### Expediente

El historial de avisos que ha **recibido** una persona: es lo que deja traza y lo
que se mira antes de escalar. En [[#Sanción|sanciones]] y en las alertas de control
es lo que persiste hasta que alguien lo justifica con un motivo.

### Flota viva (`fv_*`)

El núcleo de la ingesta: `fv_tramo`, `fv_ruta`, `fv_franja`, `fv_matricula`. No es
un módulo y no se muda a `modules/`, porque lo leen Nóminas, Visibilidad,
Bitácora, Sanciones, Inicio y Control. Ver [[Flota viva]].

### Franja

Los dos tramos del día en que un coche **debería** estar trabajando: 06:30–15:30 y
18:30–03:30. Entre medias hay relevo y no se vigila nada. Las horas viven en
`fv_franja`, así que cambiar un turno es un `UPDATE`. No confundir con
[[#Turno|turno]] (que es de una persona) ni con [[#Tramo|tramo]].

### Huérfano

Dos usos, y conviene no mezclarlos:

- **Km huérfanos**: kilómetros que rodó un coche sin que nadie estuviera conectado
  en BOLT. No desaparecen: se calculan por resta y salen en el aviso de coches
  rodando sin nadie dentro. La cuenta cierra siempre: *flota = en BOLT + por fuera
  + huérfanos*.
- **Fichero huérfano**: el que ya no alcanza nadie, según
  `node scripts/inventario-muerto.js`.

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
compañero.

### Jornada operativa

El día operativo va de las **05:00 a las 05:00** del día siguiente, y **no** es el
día natural. Es la base de todo lo que cuenta horas: Visibilidad, la bitácora, el
reporte de horas, Control y las alertas. La constante vive en `services/nucleo.js`
y no se copia: dos copias de la hora que parte el día es la forma más silenciosa
de que dos pantallas no cuadren. Ver [[Jornada y turnos]].

### Km por fuera

Kilómetros que el coche recorrió **sin pedido** o **con la app cerrada**: rodó, pero
no facturó. Es la pregunta que contesta la auditoría de flota. Ver
[[Auditoria de flota]].

### Km sin dueño

Ver [[#Huérfano|huérfano]]. Los km de un coche que se movió sin nadie conectado, o
los de una cuenta que en ese momento no tenía titular resuelto.

### L (libranza)

El día de descanso que le toca a alguien por cuadrante. **Trabajar el día de
libranza no es una falta** y la libranza no cuenta como ausencia. La libranza
manual de RRHH vive en `bitacora_dia`, no en el cuadrante, y una J no puede
machacarla.

### Módulo

Una carpeta de `modules/<Nombre>/` con sus `*.controller.js`, `*.service.js`,
`*.repo.js`, sus `vistas/` y su `LEEME.md`. Es un módulo **solo si desde fuera se
entra por su `.service`**; si otros le meten la mano al repo, es una carpeta.

### NN

Dos usos, los dos frecuentes:

- **En Control y en los reportes**: quien **trabajó sin que el cuadrante lo
  esperase**. No tiene turno asignado, así que se le imputa el que estaba en curso
  y aparece partido en día y noche. Es el que hay que mirar.
- **En facturas de taller**: una línea cuyo papel **no dice de qué coche es**. Se
  le reclama al taller. Es distinto de "no reconocida", donde el papel sí lo dice y
  la matrícula no la tenemos nosotros.

### Núcleo

`services/nucleo.js`: constantes y funciones puras, sin base de datos, sin red y
sin decisiones. Lo usa cualquier capa sin saltarse nada. La prueba para saber si
algo va ahí: *si para usarlo hay que levantar algo, no va ahí*.

### Plaza

El hueco concreto de un coche en un turno. Las personas se colocan en plazas, no
en coches: por eso una [[#Vacante|vacante]] apunta a la plaza desde el primer
momento, y por eso mover a alguien puede dejar a otro sin plaza.

### Presunta

Ver [[#J (justificante)|J]]. Una hora presunta es la que aporta una J todavía
pendiente: se pinta en azul, se ve, y **no cuenta** hasta que se aprueba.

### Puerta

El `*.service.js` de un módulo: la única entrada legítima desde fuera. "Poner la
puerta" es lo que convierte una mudanza de carpeta en un módulo de verdad.

### Recambio

Buscar quién sustituye a una persona que se va. Parte **de la persona**, no de la
plaza: se leen sus plazas, su zona y sus libranzas, y de ahí sale la propuesta. En
el cuadrante, un recambio explica por qué existe el hueco: quién se va y cuándo.

### Reexportador

Un fichero de una línea que queda en la ruta vieja tras mudar un módulo
(`module.exports = require('../modules/X/x.repo')`). Existe para que una referencia
que se haya escapado no dé un 500 en producción. Es **deuda con fecha de
caducidad**.

### Sanción

El registro legal de un exceso de velocidad detectado por [[Mapon]] y atribuido a
un conductor de [[BOLT]]: aviso por WhatsApp más apunte en un libro aparte. Solo
entran los atribuidos **con certeza**. Ver [[Sanciones de velocidad]].

### Sellado

El histórico ya calculado y **congelado**: `bitacora_horas` más su marca en
`bitacora_sello`. Sirve para que el pasado no se recalcule cada vez que alguien
abre una pantalla, y para que la letra de un periodo cerrado no se mueva porque
alguien toque otra cosa. Un día en el que no trabajó nadie **también se sella**.

### Tramo

Un trozo de la línea de tiempo **de un vehículo** según el estado de [[BOLT]]:
viaje, espera, descanso, desconectado. Vive en `fv_tramo` y lo construye el motor
de [[Flota viva]] reproduciendo todos los apuntes de estado en orden. Los
kilómetros **no salen de aquí** sino de `fv_ruta`. Ver [[Corte de tramos]].

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
mañana en el taller.

### Vacante

Una plaza abierta que hay que cubrir, con sus **plazas reales** contadas. La
vacante apunta a la plaza desde el principio, no a la matrícula: cuando apuntaba a
la matrícula, el alta fallaba con la persona ya contratada.

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
