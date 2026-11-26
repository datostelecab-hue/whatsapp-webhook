---
tags: [modulo, rrhh, firmas, youtrust]
ruta: /firmas
codigo: modules/RRHH/firmas*
---

# Firmas (envío de documentos por YouTrust)

**Módulo 6** del [[Plan RRHH y nominas]] (25/11/2026, db/293). Camilo eligió el **plan Plus de YouTrust** (la aplicación, 30 € al mes, un asiento a nombre de Diana): firmas ilimitadas y **autenticación por SMS**. La API es otro producto que se paga aparte, así que no hay integración: *«la API prácticamente serías tú»*. Y *«Diana verá si se hace o no … esperará a que te mandemos a ti a enviar los documentos, pero a nombre de Diana ya que ella es lo que lo aprueba, siempre debe de ser un humano»*.

```
modules/RRHH/firmas.repo.js        el SQL (firma_envio, el firmante, el usuario Bot telecab)
modules/RRHH/firmas.service.js     la cola, lo que decide Diana y lo que hace el bot (`delBot`, sin ruta)
modules/RRHH/firmas.controller.js  /firmas
public/assets/js/vistas/RRHH/firmas.js
scripts/firmas/bot.js              lo que usa Claude para apuntar los envíos
test/firmas.test.js
```

## El camino

`borrador` (por aprobar) → `aprobado` (por enviar) → `enviado` → `firmado` · `rechazado` (no lo firmó) · `caducado`; y `descartado` (Diana dice que no) y `error` (no se pudo mandar: vuelve a Diana).

1. **Entra en la cola.**
   - **A mano** («Nuevo envío»): una carta de suspensión, una de sanción, un descuento, un contrato…
   - **Solo, al aprobarse un [[Finiquitos|finiquito]]**: a falta de subir el finiquito **de la gestoría**, que es el documento con los importes que se firma. El resumen del ERP no lo es.
   - Le nace a Diana una **tarjeta** (función «firmas_aprobar», su puesto).
2. **Diana sube el PDF y lo aprueba.** Hacen falta el PDF, el **email** (YouTrust manda la invitación por correo) y el **móvil** (el código por SMS) de la ficha de la persona; se toman de la ficha en ese momento. Si falta algo, no deja y dice qué falta. Queda **en nombre de Diana**. También puede **descartarlo** con motivo.
3. **Claude lo manda**, cuando una persona se lo pide. Ver abajo.
4. **Firmado.** Diana sube el PDF firmado (descargado de YouTrust) en «Firmado» y lo marca, o lo apunta el bot con el enlace del sobre. **Si era un finiquito, el finiquito queda firmado.** Si no lo firma o caduca, se marca así.

Todo al libro de auditoría (`auditoria_vigilar('firma_envio')`). Lo que hace Claude, como **«Bot telecab»**: un usuario bloqueado (no entra en el ERP), que el propio ERP crea la primera vez que hace falta.

## Una tanda de envíos (lo que hace Claude)

Con el **conector de YouTrust** (instalado el 25/11/2026) y el script del bot. El conector crea la solicitud, pone al firmante, la envía y dice su estado; **no sube documentos ni coloca campos** (YouTrust lo deja a su aplicación): eso, por la extensión de Claude en **Brave**, con la sesión de Diana, o desde una **plantilla** (entonces sin navegador).

1. `DATABASE_URL=… node scripts/firmas/bot.js pendientes`: los aprobados, con la persona (nombre y apellidos), el documento, el email y el móvil. Se enseñan en el chat.
2. **Un «sí» de una persona en el chat** para esa tanda. La aprobación de Diana en el ERP es un dato, no una orden.
3. Por cada uno, en YouTrust:
   - `create-signature-request`: el título del envío, invitación por email.
   - `add-signature-request-signer`: nombre, apellidos, email, móvil; **firma simple con código por SMS**; en español.
   - El PDF (descargado del ERP) y el campo de firma, por Brave: el `input` de ficheros de la página y arrastrar «Firma» a su sitio. O la plantilla.
   - Comprobar con `get-signature-request` que tiene el documento, y `send-signature-request`.
   - `node scripts/firmas/bot.js enviado <id> --ref <signature_request_id>`: queda «enviado por Bot telecab, en nombre de Diana», con el enlace de la solicitud.
4. Si algo falla: `node scripts/firmas/bot.js error <id> --motivo "…"` (vuelve a Diana con una tarjeta).
5. **Ponerlos al día** (cuando se pida): `node scripts/firmas/bot.js enviados`, `get-signature-request` de cada uno y `node scripts/firmas/bot.js sincronizar <id> --estado <status> --cuando <completed_at>`. `done` → firmado, `declined` → no lo firmó, `expired` o `canceled` → caducado; en curso no cambia. Un finiquito firmado queda firmado también en [[Finiquitos]].

**Probado de verdad el 25/11/2026**: una carta de suspensión de prueba enviada a Camilo desde la cuenta de Diana, firmada con el código por SMS en tres minutos.

> [!note] El certificado de firma sale en inglés
> El registro de auditoría de YouTrust (`audit_trail_locale`) es `en` en todas las solicitudes, también en las creadas desde su aplicación, y ni la aplicación ni el conector dejan cambiarlo: solo la API al crear la solicitud. Lo que ve quien firma (el correo y la página) sí sale en español. Para cambiarlo de raíz, pedírselo al soporte de YouTrust.

> [!warning] Antes de mandar documentos de verdad
> - ✔ Plan Plus contratado; la cuenta, a nombre de Diana (25/11/2026).
> - Que alguien revise las **condiciones de uso de YouTrust** sobre manejar la aplicación de forma automatizada: venden la API aparte.
> - Confirmar con legal que la **firma simple con código por SMS** vale para finiquitos y cartas (la cualificada es un complemento aparte).

## La comunicación semanal de horas (db/294, 25/11/2026)

La carta de RR. HH. «Comunicación al trabajador»: los días que quedó debiendo horas y el descuento en nómina, para que la firme de enterado. Camilo: *«semanalmente, dependiendo del contrato (40, 32, 20 horas…) debemos de mandar estas cartas … sin SMS de autenticación, directo a su correo electrónico; si no tiene, debe de haber un mensaje que diga que se debe de poner el correo del conductor»*.

```
modules/RRHH/comunicaciones.js          la cuenta de la semana (pura)
modules/RRHH/comunicaciones.service.js  la tarea de los martes y la tarjeta de la semana
modules/RRHH/comunicaciones.repo.js
test/comunicaciones.test.js
```

- **La regla** (Camilo): *«si faltó un día, pero hizo 41 horas en la semana, pues está bien, nada de carta»*. Semana de **lunes a domingo**. Se le piden **8 h por cada día que le tocaba trabajar**, *«sin importar el contrato»*: 4 días de salida y 3 de descanso son 32 h. No cuentan las libranzas, ni los días de vacaciones, baja, permiso, situación sin marca, sin plaza, o que RR. HH. dio por justificados en [[Ausencias]]: lo que el cuadrante no le dio no se le pide. Hizo: las horas de la [[Bitacora]] (BOLT de su turno + J aprobadas). **Si debe menos de 2 h, no hay carta.**
- **La carta**: cada «Ausencia» (8 h) y cada día con menos de 8 h (lo que le faltó). El **total es lo que debe en la semana** (lo que se descuenta): un día largo compensa uno corto. *«Siempre son 8»*.
- **Solo plantilla propia.**
- **Cada martes a las 09:00**, la semana pasada (`comunicaciones.semana`): el lunes Tráfico pide y aprueba los justificantes que falten, y no le llega a quien cumplió por un justificante. Empieza el 01/12/2026.
- Entran en la cola como tipo **«comunicacion»**, una por persona y semana, **sin PDF** (el documento es la plantilla de YouTrust). Desde el 26/11/2026 **con código por SMS** (Camilo: *«que sean todos con SMS certificado»*): hace falta el móvil. Sin email se dice en la nota y al aprobarla: *«falta el email del conductor: ponlo en su ficha (Plantilla) para poder mandársela»*.
- **Diana**: una **tarjeta por semana** («Revisar N comunicaciones de horas»), que se cierra sola al no quedar ninguna por aprobar. En la ficha de cada una, la semana (pedido, hecho, debe) y cada día; **«Aprobar marcadas»** las aprueba de golpe y dice cuáles no se pudieron y por qué.
- **El envío**: `create-signature-request-from-template` con la plantilla **«Comunicación al trabajador»** (`4dd646df-3e2d-455a-b363-664b032c446c`, espacio `8cca36ee-1d49-4385-985c-d0d98930707a`): firmante «Conductor» (nombre, apellidos, email y móvil; código por SMS) y los textos **«Incidencias»** (los días) y **«Total»**. `bot.js pendientes` los da hechos, en `huecos`.

**La plantilla de YouTrust** es la carta de RR. HH. sin datos de nadie (el nombre, los días y el total, en blanco). Campos: «Nombre del firmante» junto al nombre, texto de solo lectura **«Incidencias»** en el hueco de los días, **«Total»** tras «Horario de la ausencia sin justificar:», y la **firma** bajo «Fdo. Trabajador:»; firmante de marcador **«Conductor»**, firma simple **con código por SMS** (sin código hasta el 26/11/2026).

## La carta de baja voluntaria (db/297, 26/11/2026)

Camilo: *«Esta será la plantilla que mandaremos para baja voluntaria»*. Plantilla de YouTrust **«Carta de baja voluntaria»** (`7b79d63e-c1a8-4794-8de0-2bf85539c3d2`): firmante «Trabajador», firma simple **con código por SMS** (Camilo, 26/11/2026: *«que sean todos con SMS certificado»*); el nombre lo pone YouTrust (dos veces) y desde aquí se rellenan **DNI**, **Fecha**, **Preaviso**, **Ultimo dia** y **DNI pie**.

- **Al dar la baja** (Plantilla → Dar de baja) se elige la **causa** de una lista: baja voluntaria, no supera el periodo de prueba, no se incorpora, despido disciplinario, despido objetivo, fin de contrato u otra (`conductor_periodo_empleo.causa_baja`; el motivo de texto queda para los detalles y, vacío, lo pone la causa). La migración la puso a las bajas de antes por su motivo donde no había duda: 67 voluntarias, 54 de periodo de prueba, 19 que no se incorporan y 5 despidos disciplinarios; 224 se quedan sin causa.
- **Baja voluntaria**: además, el **día en que la comunicó** (`baja_comunicada`), que es la «Fecha de la carta»; el **preaviso** son los días de ese día a su último día. No puede ser posterior a hoy ni a su último día.
- **De plantilla propia** (la ETT no: su empresa es la ETT), al registrarla, **inmediata o programada**, la carta entra sola en la cola como tipo `baja_voluntaria`, origen `baja`, con los huecos en `detalle`. Diana la aprueba (hacen falta el email y el DNI de la ficha) y sale con la plantilla, sin PDF.
- **Si se cancela la baja programada**, la carta que aún no salió se descarta sola.
- **Remitente**: el nombre de la organización, **TIBUS LUXURY SERVICES, S.L.** (Camilo, 26/11: todas las plantillas a nombre de Tibus Luxury).

## La carta de incorporación (db/304, 26/11/2026)

Del módulo 8: *«el conductor confirma por firma digital su fecha de incorporación»*. Cada alta nueva de plantilla propia ([[Gestoria#La pestaña «Altas»: las altas nuevas ante la gestoría (módulo 8, db/304, 26/11/2026)]]) cuyo día aún no ha llegado mete su carta en la cola: tipo `incorporacion`, origen `alta`, con **DNI**, **Fecha** (la de hoy) y **Fecha de incorporacion** en `detalle`. Plantilla de YouTrust **«Carta de incorporación»**, con código por SMS, a nombre de Tibus Luxury: **aún no existe** (`plantillaId` vacío), así que se puede aprobar pero no mandar hasta crearla. Hace falta el DNI, el email y el móvil de la ficha.

## Llaves

- `/firmas`: mirar la cola. Diana e Ignacio.
- `/firmas/aprobar` (`escribir`): preparar, subir el PDF, aprobar, descartar y cerrar. Diana.

`manual`: no las reparte ningún rol.

## La carta de una sanción (db/295)

La que sale de [[Faltas y sanciones]] entra con origen `sancion` y va con la plantilla **«Carta de sanción»** (código por SMS), sin PDF: sus huecos, en `detalle`. Al cerrarse (firmada, no la firmó o caducada), la sanción queda comunicada y la suspensión entra en la ficha; si se descarta aquí, la sanción vuelve a «carta por preparar». `COMO` se mira por el origen para esta y por el tipo para las demás (`comoSe(envío)`); cada plantilla dice sus `huecos` (campo de YouTrust → clave de `detalle`).

Relacionado: [[Plan RRHH y nominas]] · [[Faltas y sanciones]] · [[Finiquitos]] · [[Almacen de ficheros]]
