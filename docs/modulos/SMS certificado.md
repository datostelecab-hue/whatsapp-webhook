---
tags: [modulo, rrhh, mensatek, sms, postgresql]
aliases: [SMS certificado, Mensatek, Notificaciones certificadas]
---

# SMS certificado

`/sms` (módulo 9 del [[Plan RRHH y nominas]], db/306, 26/11/2026). El encargo: *«envío a un conductor, un grupo o toda la plantilla, con texto libre o con plantillas que rellenan solas los datos del conductor (suspensión, sanción, requerimiento, aviso de finiquito, etc.). Los módulos 3 y 7 lanzan sus envíos desde aquí, y el historial queda centralizado. Cada envío guarda su certificado de entrega en el expediente del conductor»*.

| Pieza | Dónde |
|---|---|
| Cliente de la API v7 de Mensatek | `services/mensatek.js` |
| Servicio y reglas | `modules/RRHH/sms.service.js` |
| SQL | `modules/RRHH/sms.repo.js` |
| Rutas de la oficina | `modules/RRHH/sms.controller.js` (`/sms`) |
| Receptor de estados (sin sesión) | `modules/RRHH/sms.receptor.js` (`/mensatek/reports` y `/mensatek/eventos`) |
| Pantalla | `modules/RRHH/vistas/sms.ejs` + `public/assets/js/vistas/RRHH/sms.js` |
| Prueba | `test/sms-certificado.test.js` |

## Lo que decidió Camilo (26/11/2026)

- **Todo el módulo**: envíos libres o con plantilla, y Sanciones y Finiquitos preparan el suyo desde su ficha.
- **Remitente**: el que tenga la cuenta de Mensatek por defecto (parámetro `mensatek.remitente` vacío). Uno propio tiene que estar registrado en la CNMC y validado en la cuenta.
- **Para abrir la notificación, el conductor escribe su DNI** (`Identificar = DNI-…`). Sin DNI en su ficha, el móvil en el que la recibió.
- **Lo manda Diana sola** (llave `/sms/enviar`), sin segundo visto bueno.

## Cómo va

1. **Borrador**: plantilla (texto libre, requerimiento, sanción, suspensión, aviso de finiquito), asunto, texto con `{nombre}`, `{pila}`, `{dni}` y `{fecha}`, a quién va (unas personas, toda la plantilla de alta, la propia o la de ETT) y si tiene que **aceptarla o rechazarla** antes de verla (5, 10 o 15 días). Un **PDF** opcional (adjunto, dueño `sms_envio`), que va dentro del SMS y Mensatek custodia.
2. **Mandar**: se hace la foto de a quién va y sale **una petición por persona** (cada una abre con su DNI, así que no caben varias en una), en segundo plano. Quien no tiene móvil queda «Sin móvil en su ficha» y no gasta. Sin credenciales o sin créditos se para el envío (Mensatek toma los errores repetidos por spam). Cada uno queda con su `idMensaje` de Mensatek.
3. **Los estados**: Mensatek avisa al **receptor** (`POST /mensatek/reports`: entregado, entregado y certificado, apagado, número que no existe…; `POST /mensatek/eventos`: la abrió con su DNI, la aceptó o la rechazó). Todo lo que llega queda tal cual en `sms_report`. Con **«entregado y certificado» (14)** se baja el certificado (`GetSMSCERTIFICADO`, un ZIP que se abre con jszip) y se guarda como adjunto `sms_certificado`.
4. **La red**: cada hora (`sms.comprobar`) se pregunta por los de los 10 últimos días sin estado final o sin certificado (40 por vuelta), por si el receptor no está configurado o se perdió un aviso.

- **El seguimiento** se refresca solo cada 20 segundos en el panel del envío: quién lo tiene entregado, certificado, abierto, aceptado o rechazado, y el enlace al certificado.
- **Desde Sanciones** (sanción aprobada, en firma o comunicada): «Por SMS certificado» prepara el borrador a esa persona con la plantilla de sanción o de suspensión. **Desde Finiquitos** (aprobado, enviado o firmado): «Avisar por SMS certificado». El PDF se adjunta en el borrador. Un segundo clic abre el mismo borrador.
- **En el expediente** del conductor, la sección «SMS certificados» (llave `/sms`) con su estado y su certificado.
- «Créditos de Mensatek» enseña los que quedan y sirve para comprobar la conexión.
- El texto va en el alfabeto GSM (`Unicode=0`): las tildes salen sin tilde (salvo la é), y así cada SMS cabe en menos mensajes.

## Lo que cuesta (tarifa pública de Mensatek, 27/11/2026)

El ERP usa `EnviarSMSCERTIFICADO`: **9 créditos por persona** con un texto de hasta 160 caracteres, y **3 más por cada trozo de 160** que se pase. La tarifa no dice nada de cobrar aparte el enlace al PDF adjunto. Lo que gasta de verdad cada envío lo devuelve Mensatek (`CreditosUsados`) y queda en el envío. Para comparar: un SMS normal gasta 1 crédito y un SMS contrato, 10.

El crédito cuesta de 0,042 € (bono de 50 €) a 0,0354 € (100 €), 0,0318 € (500 €) o 0,0300 € (1.000 €), **sin IVA**. Por persona sale entre 0,32 y 0,38 €, o entre 0,42 y 0,50 € si el texto pasa de 160 caracteres. El 27/11 aún no se había mandado ninguno desde el ERP.

## Configuración

| Dónde | Qué |
|---|---|
| Render (entorno) | `MENSATEK_USUARIO` y `MENSATEK_API_KEY`: el Usuario API y el API Token (Mensatek → Tus Datos → Configurar cuenta) |
| Render (entorno) | `MENSATEK_WEBHOOK_USUARIO` y `MENSATEK_WEBHOOK_CLAVE`: los que se ponen en Mensatek para llamar al receptor. Sin ellos, el receptor no acepta nada (y queda la vuelta de cada hora) |
| Panel de Mensatek (configuración de la API) | recepción de reports en `https://erptelecab.es/mensatek/reports` y de eventos de adjuntos en `https://erptelecab.es/mensatek/eventos`, con autenticación básica y JSON |
| Parámetros | `mensatek.telefono` (obligatorio: Mensatek lo pide en cada envío) y `mensatek.cif` (B67065664 de serie: el NIF público de Tibus Luxury Services, S.L., inscrita en el Registro Mercantil de Barcelona), `mensatek.contacto` (TIBUS LUXURY SERVICES, S.L.), `mensatek.remitente` (vacío) y `mensatek.dias_validez` (3) |

En `MODO_PRUEBAS` no sale nada: se contesta como si se hubiera mandado.

## Llaves

| Llave | Quién (db/306) | Qué |
|---|---|---|
| `/sms` | Diana, Ignacio | ver los envíos, su estado y los certificados |
| `/sms/enviar` | Diana | prepararlos y mandarlos (gastan créditos) |

Relacionado: [[Comunicados]] · [[Faltas y sanciones]] · [[Finiquitos]] · [[Firmas]] · [[Plan RRHH y nominas]]
