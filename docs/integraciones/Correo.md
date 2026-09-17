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

## Lo que hay que saber

- **Un fallo de correo nunca rompe el proceso.** Crear un usuario funciona aunque el aviso no salga; por eso las pantallas devuelven `correoEnviado` y, cuando hace falta, la contraseña provisional a la vista de quien la creó.
- **Los tiempos límite están puestos**: 10 s de conexión, 10 s de saludo, 20 s de socket. Un servidor SMTP que no contesta no puede colgar una petición HTTP.
- **La configuración se lee en cada envío.** Cambiarla surte efecto sin reiniciar — y por eso importaba tanto que dejara de estar en una hoja de cálculo.
- No hay cola ni reintentos: lo que no sale, no sale. Si algún día hace falta garantía de entrega, eso es una tabla de salientes, no un `try` más. Ver [[Trampas conocidas]].
