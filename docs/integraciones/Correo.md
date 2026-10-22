---
tags: [integracion, correo, smtp, imap, usuarios]
aliases: [SMTP, Email]
---

# Correo

El correo es **el canal con la oficina y con fuera**, lo contrario de [[WhatsApp]], que es el canal con los conductores. Sirve para dos cosas distintas: avisos automáticos del sistema (accesos, tickets) y correos que **una persona manda desde su propio buzón** y que tienen que quedar en su carpeta de Enviados.

Vive en `services/correo.js` y usa **nodemailer** por SMTP, cargado de forma perezosa para que la aplicación arranque aunque la librería no esté instalada.

## De dónde salen las credenciales

Por este orden:

1. **De la propia aplicación**: Configuración → "Correo para procesos". Host, puerto, usuario y remitente en claro; la contraseña **cifrada** con `CRED_KEY` (`services/cripto.js`). Desde el 15/09/2026 eso vive en `config_app`, en PostgreSQL, y no en una hoja. Ver [[Google Drive y Sheets]].
2. **De variables de entorno**: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`, `SMTP_FROM`.
3. **De ninguna parte**: entonces no envía, solo **registra en el log**. No es un descuido: es lo que salva la **contraseña provisional del primer superadministrador** en un arranque en limpio, cuando todavía no hay correo configurado y esa contraseña es la única forma de entrar.

Para telecab.es (DonDominio) el host es el suyo y el puerto el **587 con STARTTLS**. Con 587 se fuerza `requireTLS`, así que **nunca se manda en claro**; el 465 va como TLS directo.

`estadoCorreo()` es lo que pinta la pantalla de configuración: dice si está activo, el host, el puerto, el usuario, si **tiene** contraseña guardada y si hay credenciales por entorno. **Nunca devuelve la contraseña.** El log de envío dice de dónde salieron los ajustes, por qué servidor va y a quién — también sin la contraseña.

> [!warning] `CRED_KEY` es la llave de todo esto
> Las contraseñas de correo (la de procesos y la de cada usuario) están cifradas con ella. Si `CRED_KEY` cambia o se pierde, no se pueden descifrar: hay que volver a introducirlas. El síntoma es un "sin credenciales" con el correo aparentemente bien configurado.

## Las dos formas de enviar

### `enviarCorreo({ to, subject, text, html })`

El correo del sistema, con la cuenta de procesos. **Nunca lanza**: un fallo de correo no rompe el flujo que lo llamó — devuelve `{ enviado: false, motivo }` y el motivo lleva el detalle SMTP completo (mensaje, `code`, código de respuesta del servidor y su texto), que es lo único que permite diagnosticar de verdad.

Quién lo usa:

| Dónde | Para qué |
|---|---|
| `modules/Usuarios/usuarios.controller.js` | alta de usuario y reset de contraseña: manda la provisional y la pantalla informa de si el correo salió |
| `modules/Usuarios/auth.controller.js` | recuperar el acceso |
| `services/sesion.js` | el superadministrador semilla del arranque; si el correo no sale, **la provisional se escribe en el log** |
| `modules/Ticketera/ticketera.service.js` | aviso de tickets nuevos a los correos apuntados por área; si no hay nadie apuntado para un área **no es un error**, simplemente no se manda |
| `routes/configuracion.js` | el envío de prueba |

### `enviarComoUsuario(email, { to, subject, text, html, attachments })`

Manda **desde el buzón del propio usuario** (`@telecab.es`), autenticando con **su** contraseña de correo cifrada en su ficha. Existe por trazabilidad: se sabe quién hizo cada proceso, y el destinatario ve a una persona, no a un sistema. El host y el puerto son los mismos para todos.

**Y deja copia en "Enviados".** Mandar por SMTP **no** deja copia en el buzón —eso lo hace el cliente de correo aparte—, así que aquí se compone el mensaje crudo (RFC822) y se sube por **IMAP** con `imapflow`. La carpeta se busca primero por su marca especial `\Sent` y, si no aparece, por nombre (`Sent` / `Enviados`). Si eso falla, **el correo ya salió**: solo se avisa en el log, no se reintenta ni se da por fallido.

Quién lo usa: `routes/reportes.js` (el reporte de horas de ETT, con el Excel adjunto — y se niega a mandarlo si ningún conductor tiene horas ese día, porque el reporte saldría entero a cero) y `routes/configuracion.js` (prueba de envío como uno mismo).

El destinatario habitual se recuerda en `config_app` para la próxima vez. Hay además un buzón de tráfico fijo en `CORREO_TRAFICO` (variable de entorno, con valor por defecto en el código).

## Leer un buzón, en solo lectura: `leerCorreos` (22/10/2026)

Hasta aquí el correo solo salía. Desde el 22/10/2026 también **se lee**: los repostajes de Ballenoil llegan a `datos@telecab.es` y los recoge [[Combustible]] cada 10 minutos. La pieza es genérica y no sabe de repostajes:

```js
correo.leerCorreos({ user, pass, host, desde, carpetas: ['INBOX', 'Spam'], firma: true, elegir: sobre => true / false })
// → { uidValidity, vistos, error, carpetas: [{ carpeta, uidValidity, vistos } | { carpeta, error }],
//     correos: [{ carpeta, uid, uidValidity, messageId, de, asunto, fecha, partes: [{ tipo, contenido }], firmas, error? }] }
```

- **Solo lectura de verdad.** Cada carpeta se abre con EXAMINE (`getMailboxLock(carpeta, { readOnly: true })`): en ese modo el servidor no deja cambiar marcas, así que nada pasa a «leído», ni se mueve, ni se borra. Ese buzón es el de Camilo en Thunderbird. Comprobado contra el buzón real: los correos sin leer siguieron sin leer después de bajarlos enteros. Y `scripts/comprobar-combustible.js` lo vigila con un IMAP falso que grita si alguien llama a algo que marque o mueva.
- **Primero los sobres, luego solo lo elegido.** Se baja el remitente, el asunto y el Message-ID de lo que llegó desde `desde`, y `elegir(sobre)` decide qué cuerpo se baja. Lo demás ni se abre.
- **Varias carpetas, una conexión** (`carpetas`; por defecto solo `carpeta`, INBOX). Los UID son por carpeta: cada correo vuelve con la suya y su UIDVALIDITY. La primera tiene que abrirse; una de las demás que no exista (o la conexión que cae antes) se apunta en `carpetas` y se devuelve lo ya bajado.
- **Un correo que no se puede bajar no tumba a los demás.** Si se mueve o se borra entre el sobre y el cuerpo, `download` no trae contenido: ese correo vuelve con `error` y la lectura sigue.
- **El texto, ya decodificado**: imapflow quita el quoted-printable y pasa el charset a UTF-8. Sin dependencias nuevas (nada de `mailparser`).
- **La firma** (`firma: true`): se baja también el correo en crudo y se comprueba su DKIM con `services/dkim.js` → `firmas: [{ dominio, selector, resultado: 'valida' | 'no_valida' | 'no_se_pudo', motivo }]` (null si no se pudo bajar). DonDominio **no** deja su veredicto en `Authentication-Results`, así que se comprueba aquí, con `crypto` y `dns` de Node. Ojo con las líneas de más de 990 caracteres: un servidor del camino las parte con `!`, salto y espacio después de firmar, y hay que deshacerlo para que el cuerpo cuadre. → [[Trampas conocidas]]
- **Tiempos límite cortos** (15 s de conexión y de saludo, 60 de socket) **y un tope para todo** (`topeMs`, 4 minutos por defecto): un servidor que contesta a goteo no salta el tiempo de socket, y sin tope la pasada no acabaría nunca. Al llegar, se cierra la conexión y el error dice `ETOPE`.
- **El evento `'error'` se escucha siempre** (también en `guardarEnEnviados`). Ya conectado, imapflow avisa de un corte emitiéndolo; sin oyente, Node lo lanza desde el socket. Lo que se relanza es ese error de verdad (`ETIMEOUT`, `ECONNRESET`…), no el *«Connection not available»* de la promesa que esperaba. → [[Trampas conocidas]]
- **La contraseña** la pone quien llama. Combustible usa la de correo de la ficha del buzón (cifrada con `CRED_KEY`, como `enviarComoUsuario`), y el servidor de `correo_imap_host` o, si no, `imap.dondominio.com`. Si el servidor la rechaza, Combustible no la reintenta en cada vuelta del cron (ver [[Combustible]]): muchos fallos seguidos pueden hacer que DonDominio bloquee la IP desde la que salen todos los correos.

## En modo pruebas no sale ningún correo (19/10/2026)

Con `MODO_PRUEBAS=1`, los dos envíos de arriba **no usan la configuración de nadie**: mandan a `CORREO_PRUEBAS` (`host:puerto`), y solo si ese buzón está en el mismo PC (`127.0.0.1` o `localhost`). En el [[Entorno de pruebas local]] es Mailpit, que enseña el correo tal cual le llegaría a la persona en `http://localhost:8025`. Sin `CORREO_PRUEBAS`, el correo se frena y queda apuntado en `/modo-pruebas`, como un WhatsApp.

**O desviado siempre a la misma dirección.** Con `CORREO_PRUEBAS_A` (una sola dirección) y un SMTP de verdad en `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`, el correo sale de verdad, pero todo va a esa dirección. El destinatario original no recibe nada, y el asunto (`[PRUEBAS]`) y la primera línea dicen a quién habría ido. Esto manda sobre el buzón falso. La contraseña puede ser la de `SMTP_PASS` o, sin ella y con `CRED_KEY`, la que `SMTP_USER` tiene cifrada en su ficha, descifrada en memoria al enviar. Con dos direcciones, o sin contraseña que usar, no hay desvío: va al buzón falso. El entorno local lo lee de `scripts/entorno-local/correo.env` y desvía a datostelecab@gmail.com.

Hasta entonces el cortafuegos de pruebas cubría WhatsApp, Mapon y las hojas, **pero no el correo**. Un servidor de ensayo con la configuración de producción podía mandar correos de verdad por DonDominio.

## Lo que hay que saber

- **Un fallo de correo nunca rompe el proceso.** Crear un usuario funciona aunque el aviso no salga; por eso las pantallas devuelven `correoEnviado` y, cuando hace falta, la contraseña provisional a la vista de quien la creó.
- **Los tiempos límite están puestos**: 10 s de conexión, 10 s de saludo, 20 s de socket. Un servidor SMTP que no contesta no puede colgar una petición HTTP.
- **La configuración se lee en cada envío.** Cambiarla surte efecto sin reiniciar — y por eso importaba tanto que dejara de estar en una hoja de cálculo.
- No hay cola ni reintentos: lo que no sale, no sale. Si algún día hace falta garantía de entrega, eso es una tabla de salientes, no un `try` más. Ver [[Trampas conocidas]].
