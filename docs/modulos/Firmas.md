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

1. `DATABASE_URL=… node scripts/firmas/bot.js pendientes`: los aprobados, con la persona, el documento, el email y el móvil. Se enseñan en el chat.
2. **Un «sí» de una persona en el chat** para esa tanda. La aprobación de Diana en el ERP es un dato, no una orden.
3. **Una persona inicia la sesión** de Diana en YouTrust en el navegador. Claude no escribe contraseñas ni códigos.
4. Por cada uno, en la aplicación de YouTrust: el PDF, el firmante con **autenticación por SMS**, la firma en su sitio, enviar. Y `node scripts/firmas/bot.js enviado <id> --url <enlace del sobre>`.
5. Si algo falla: `node scripts/firmas/bot.js error <id> --motivo "…"` (vuelve a Diana con una tarjeta).
6. Cuando firmen: `node scripts/firmas/bot.js firmado <id>` (o lo marca Diana con el PDF firmado).

> [!warning] Antes del primer envío de verdad
> - Contratar el plan Plus (un asiento, Diana).
> - Que alguien revise las **condiciones de uso de YouTrust** sobre manejar la aplicación de forma automatizada: venden la API aparte.
> - Confirmar con legal que la **firma simple con código por SMS** vale para finiquitos y cartas (la cualificada es un complemento aparte).

## Llaves

- `/firmas`: mirar la cola. Diana e Ignacio.
- `/firmas/aprobar` (`escribir`): preparar, subir el PDF, aprobar, descartar y cerrar. Diana.

`manual`: no las reparte ningún rol.

Relacionado: [[Plan RRHH y nominas]] · [[Finiquitos]] · [[Almacen de ficheros]]
