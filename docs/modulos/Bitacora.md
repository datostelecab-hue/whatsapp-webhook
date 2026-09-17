---
tags: [modulo, operaciones, bitacora, horas]
ruta: /bitacora
codigo: modules/Operaciones/bitacora.repo.js
---

# Bitácora

El calendario de la plantilla: **qué hizo cada persona cada día** —cuántas horas, si libró, si estaba de vacaciones o de baja, si hay una J puesta—. Nació de una hoja de Excel y hoy sale entero de PostgreSQL.

- `/bitacora` — el día a día, con el panel de un día concreto.
- `/bitacora/general` — la plantilla entera contra el calendario entero.

## Las dos pantallas leen el MISMO `/api/datos`

Son dos formas de mirar la misma rejilla, ya resuelta para toda la plantilla y todos los días. Dos consultas distintas del mismo dato acabarían pintando distinto, y el día que no cuadraran **nadie sabría cuál creer**.

La rejilla empieza el **1 de junio de 2026** y son 365 días. Los índices de día se calculan en UTC a propósito, para que no dependan de la zona de quien ejecuta el proceso.

## Las horas van por JORNADA 05→05

La jornada operativa va de las **05:00 a las 05:00** de Madrid, y el tramo **se recorta por ella** — igual que en el Reporte de horas de Control (ver [[Jornada y turnos]]).

> Un tramo que empieza a las **04:22** y acaba a las **05:36** deja **38 minutos en la jornada que cierra y 36 en la que abre**. Antes se le daba entero al día en que empezaba, y la bitácora discrepaba del reporte en unos minutos por persona.

La hora del corte sale de `services/nucleo.js` (`HORA_DIA`), no de una constante propia: el día que se mueva, esta pantalla no se puede quedar sola diciendo otra cosa.

Lo que cuenta es el **tiempo efectivo** del núcleo de [[Flota viva]]: los tramos de `fv_tramo` cuya situación está marcada como `efectivo` en el catálogo, o sea **viaje + espera**. El descanso no cuenta.

**Los solapes se funden.** Si una persona tiene dos cuentas de [[BOLT]] que se pisan, ese rato cuenta **una** vez. Y si la cuenta estaba **prestada** ese día, las horas son de quien la usaba: manda `cuenta_fantasma` sobre el titular, porque el préstamo es lo que Tráfico sabe y el sistema no. Se resuelve **por día**, porque la misma cuenta puede ser de su dueño en mayo y estar prestada en septiembre.

## De dónde sale cada marca

| Marca | Origen |
|---|---|
| un número | horas efectivas de `fv_tramo`, recortadas por la jornada |
| **V / B / P** | `conductor_estado_hist` + `cat_estado_conductor.marca_bitacora` |
| **J** | un justificante vivo (`anulado_at IS NULL`), con sus horas y su nota |
| **L** | asignado a plaza pero sin cubrir ese día (`f_cobertura`), o puesto a mano |

Las horas reales **siempre pisan la L**: si al final trabajó, se ve que trabajó.

**Quién sale:** toda la plantilla, vigentes y de baja. Antes el listado salía de `v_agenda`, que solo tiene a los vigentes, y a las **74 personas** que trabajaron y luego se fueron se les inventaba el nombre `#id`. Ahora sale de la dimensión de conductores (`bi_dim_conductor`). Quien tenga cuenta de BOLT pero ninguna ficha no se pinta como persona: se cuenta y se avisa (`avisos.sinFicha`).

**Se ven 60 días de futuro.** Sin eso, poner a alguien de vacaciones para mañana no se veía en ninguna parte: su ficha salía en blanco y había que acordarse. Las libranzas futuras solo se calculan **14 días**, porque más allá el cuadrante es una intención y no una promesa: cambia cada semana. Las ausencias y las J van a todo el horizonte, porque son decisiones ya tomadas y con fecha.

## El sellado: por qué el pasado no se recalcula solo

`bitacora_horas` guarda el histórico ya calculado —una fila por conductor y jornada, en segundos— y `bitacora_sello` guarda **qué jornadas están selladas**, tengan filas o no.

La razón es sencilla: **un mes cerrado tiene que seguir diciendo lo mismo mañana**. Si las horas se recalcularan en cada carga, enlazar hoy una cuenta de BOLT que faltaba, o cambiar a alguien de plaza, movería números de hace tres meses sin que nadie lo pidiera — y esos números ya se han mirado, se han discutido y han acabado en una nómina.

Cómo funciona en `horasDeLaRejilla()`:

- Las jornadas **cerradas** se leen de `bitacora_horas` y no se vuelven a calcular.
- La jornada **en curso y la anterior** se calculan en vivo: todavía reciben tramos con retraso.
- Los **huecos** del pasado —la primera vez son todos; después, como mucho el día que el cron no llegó a cerrar— se calculan y **se sellan al vuelo**, para no repetirlo mañana.

> **Se mira el sello, no las filas.** Un día en el que no trabajó nadie tampoco tiene filas, así que buscando filas se estaría recalculando para siempre: junio entero, antes de encender la ingesta, en **cada carga de la pantalla**.

Sellar borra el rango y lo reescribe, para que un día que se quedó a cero —o una persona a la que se le desenlazó una cuenta— no arrastre su fila vieja. Va en bloques de 2.000 filas porque un INSERT de 30.000 con parámetros no cabe de una vez.

### El cron

`35 5 * * *` (Madrid), en `app.js`: al cerrar la jornada se sellan los **tres últimos días cerrados**, no solo uno, **porque BOLT entrega tramos con retraso y el de anteayer puede haber crecido**. Entra por `bitacora.service.sellarHoras()`, no por el repositorio.

### Resellar

`POST /bitacora/api/resellar` rehace un rango a mano. Es **solo del desarrollador** (`sesion.requiereDesarrollador`): reescribe histórico. Es la salida para cuando cambia algo que afecta al pasado **a propósito** —se enlaza una cuenta de BOLT que faltaba, se corrige un id mal puesto—, no un botón de refrescar.

## Un dato, una fuente

`horasDeJornada(dia)` lee del histórico sellado si ese día ya cerró, y calcula en vivo si no. Lo usa el **reporte de la ETT**: si ese informe contara las horas por su cuenta, dos pantallas dirían cosas distintas del mismo día **y una de ellas se le manda a un tercero**.

## La caché

La rejilla se rehace en cada carga y es cara, así que se cachea **tres minutos** — lo bastante para que un refresco no repita la consulta, y lo bastante poco para que nadie esté mirando una foto de ayer.

Pero **al escribir se tira**: al poner una J, anularla o marcar una libranza, la caché se invalida, para que el cambio salga **ya** y no dentro de tres minutos — que es cuando quien lo hizo ya se ha ido.

## Justificar y librar

- **Justificar** es con **horas exactas**, no con las 8 fijas. Va por `conductor_id`, que es lo que trae la vista: **el nombre no identifica**.
- **Anular** una J no la borra: el registro queda **anulado**, no desaparecido.
- **La libranza manual** ("ese día le tocaba librar") vive en `bitacora_dia` con marca `L` y `marca_manual`. **El planificador no se toca:** el cuadrante dice lo que estaba *planificado* y la bitácora lo que de verdad *pasó*.

### El permiso de escribir es una llave aparte

Abrir la bitácora es `/bitacora`. Poner la J, quitarla y marcar libranza es **`/bitacora/justificar`**, en el grupo de Aprobaciones del catálogo (`services/permisos.js`).

Antes eso era una lista de roles escrita dentro de la vista —`['trafico','desarrollador','superadmin']`— así que el de taller no podía justificar sus propias averías y **no había forma de dárselo sin tocar código**. Y la API no comprobaba nada: el candado era solo el botón.

## Las piezas

```
bitacora.controller.js   las rutas
bitacora.service.js      la caché, la invalidación y la puerta del módulo
bitacora.repo.js         el SQL: la rejilla, las horas por jornada y el sellado
vistas/bitacora.ejs · vistas/bitacoraGeneral.ejs
```

Las llamadas de un día (`/api/dia`) van aparte del payload gordo: ese se cachea entero para toda la plantilla y 365 días, y esto solo se pide cuando alguien abre **un** día de **una** persona.

## Ver también

[[Operaciones]] · [[Jornada y turnos]] · [[Flota viva]] · [[BOLT]] · [[Base de datos]] · [[Glosario]]
