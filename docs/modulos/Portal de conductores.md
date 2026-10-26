---
tags: [portal, conductores, acceso, turnos, calificacion]
aliases: [Portal, conductorestelecab.es, Ficha del conductor]
---

# Portal de conductores

Lo que cada conductor ve de sí mismo desde su móvil, en **conductorestelecab.es**. Lo autorizaron el 19/10/2026, con dominio propio. Camilo: *«la idea es que todavía no vean sus horas, solo turnos y la puntuación que llevan semana tras semana»*.

Vive en `modules/Portal/`. Se prueba en el [[Entorno de pruebas local]] antes de subirlo.

## Otro sitio, el mismo servidor

El portal **no es una sección del ERP**: tiene su propio dominio, sus cookies, su sesión, su hoja de estilos y sus pantallas. Lo sirve el mismo servidor de Render, que decide por el dominio de cada petición:

- `porDominio` va en `app.js` **antes que todo lo del ERP**, incluida su sesión. Si la petición es de un dominio del portal (`PORTAL_HOSTS`), se queda allí: con su página, su 404 o su error. **Nunca llega a una pantalla del ERP.** Sin haber entrado, cualquier dirección manda a `/entrar`.
- Por el dominio del ERP no se llega al portal: `/turnos` o `/entrar` piden el login del ERP.

`PORTAL_HOSTS` vale por omisión `conductorestelecab.es`, `www.conductorestelecab.es` y `conductorestelecab.localhost` (el del entorno local).

## El acceso, sin contraseñas

*«El login es con su DNI y el sistema le enviará un código de verificación al email que fue dado de alta.»*

1. **El DNI o NIE.** Se limpia (sin puntos, guiones ni espacios, en mayúsculas) y se busca entre quien tiene un contrato abierto o que empieza más adelante: el que entra el lunes ya quiere ver sus turnos.
2. **El código.** Seis cifras al email de su ficha, que caducan a los **10 minutos**, admiten **5 intentos** y sirven **una vez**. Pedir otro anula el anterior. En la base solo se guarda su huella (HMAC), nunca el código.
3. **La sesión.** **30 días desde la última vez que entra.** En la cookie va un testigo aleatorio y en la base su huella (`portal_sesion`). Por eso se puede cerrar desde el servidor: al pulsar «Salir» y, sobre todo, al darle de baja, porque una sesión solo vale mientras la persona puede entrar.

Lo que **no** se dice: si un DNI está o no en la casa. A quien no se encuentra, a quien no tiene email y a quien no tiene contrato se le contesta lo mismo: *«No podemos mandarte el código con ese DNI. Habla con RRHH para que revisen tu DNI y tu email»*. Así el formulario no sirve para averiguar quién trabaja aquí.

**Los límites:** 3 códigos por persona y 10 por IP cada 15 minutos, y 30 búsquedas de DNI por IP y hora (estas, en memoria, porque un DNI que no existe no deja código).

El correo sale por el «Correo para procesos» de siempre ([[Correo]]). El asunto lleva el código, para que se vea en el aviso del móvil.

> [!warning] Sin email no hay acceso
> El 19/10/2026, de 216 conductores de alta, **51 no tenían email** (47 de la ETT) y **23 no tenían DNI**. Esos no pueden entrar hasta que RRHH los complete. Ver [[Estado y pendientes]].

## Lo que ve

**Inicio**: su próximo turno (cuándo, día o noche, el coche, de quién lo recibe y a quién se lo entrega, con el teléfono para llamar) y su última nota, con cuánto ha cambiado respecto a la semana anterior.

**El dinero del mes**, en la portada (19/10/2026). Camilo: *«una barra de progreso de la facturación que lleva, dependiendo si es 32 o 40 horas»*, y después: *«los de la ETT exclúyeles esta función ya que ellos no tienen tal cosa. Las propinas y peajes ponlas también, pero recuerda que es a mes vencido esto de los extras. Las propinas y peajes sí deben de poder verlos los de la ETT»*.

- **La barra**: su facturación neta del mes, del día 1 a hoy, contra **el umbral del MBO FAS de su jornada**. Es el mismo número que la nómina (`nominas.umbralFASDe`): **40 h → 4.750 €, 32 h → 3.750 €**, y las demás jornadas, el de 40 h, como en la nómina. Se cambia en la configuración de [[Nominas]] y el portal lo sigue solo. Debajo dice cuánto le falta, o cuánto lo ha pasado.
- **Propinas y peajes** del mes.
- **A mes vencido**: se dice que lo del mes se cobra en la nómina del mes siguiente. Y se enseña el mes pasado, que es lo que entra en la nómina de este mes.
- **La ETT no ve la barra**, porque el MBO es solo de plantilla propia, pero **sí sus propinas y peajes**.
- El dinero es el de la nómina: `v_ordenes_conductor` por **día natural** (`nominas.dineroDe`), no por jornada operativa.

**Efectivo** (19/10/2026): lo que tiene por entregar, en la portada, y una pestaña con todo su histórico desde junio, quincena a quincena. Cada quincena enseña lo que traía de antes, lo que cobró en efectivo según BOLT, cada entrega con su fecha y lo que le quedó. Arriba, lo cobrado, lo entregado y el cambio o las devoluciones que se le dieron, que con lo de antes suman el pendiente. Sale de la ficha de Recaudación tal cual (`recaudacion.extractoDe`), sin notas internas ni anulados; ver [[Administracion#Lo que ve el conductor en su portal (19/10/2026)]]. La ETT también lo ve: el efectivo es de todos.

**Turnos**: de hoy a 7 días, lo mismo que le contesta el bot a «Ver mis turnos». Sale de `cobertura.service.proximosDe`, que guarda un minuto la ventana de toda la flota, porque es la misma para todos. Si hay un evento en marcha, se avisa de que esos días los turnos son temporales. Cuando recibe el coche y se lo devuelve a la misma persona en relevo directo (las parejas fijas), se dice en una línea: *«Compartes el coche con…»*.

**Puntuación**: la nota de cada semana, que es la de [[Calificacion de conductores#La puntuación de cada semana, para el portal de conductores (19/10/2026, db/210)|la puntuación semanal sellada]]:

- la última, con sus tres partes **en puntos**: horas, utilización y velocidad, más los excesos que le cuentan (ya se le avisaron por WhatsApp);
- una barra por semana, desde septiembre;
- las anteriores, plegadas;
- y cómo se calcula.

**Ni horas ni porcentajes**: el promedio y la utilización se quedan en el ERP.

## El aspecto

La identidad de la casa ([[Identidad visual]]): un solo acento, superficies lisas, IBM Plex Sans. Pero en una hoja propia y pequeña (`public/assets/css/portal.css`), **sin Tailwind**: se abre desde el móvil, a veces con poca cobertura. **El tema lo decide el móvil** (claro u oscuro), porque el conductor no tiene ajustes que tocar. Las letras: A en el acento, B neutra, C en ámbar, D en rojo.

## Para subirlo a producción

1. Desplegar y aplicar **db/210** (la puntuación semanal) y **db/211** (el acceso) desde `/migraciones`.
2. En Render, en el servicio de producción **whatsapp-webhook** (`whatsapp-webhook-g7wa.onrender.com`; el de pruebas está suspendido y no se usa), *Settings → Custom Domains*: añadir `erptelecab.es` y `conductorestelecab.es`. Render añade solo el `www` de cada uno y lo manda a la raíz.
3. En DonDominio, en los dos dominios (26/10/2026; venían aparcados): `@` **A 216.24.57.1** (el balanceador de Render; DonDominio no tiene ALIAS) en lugar de 31.214.178.55, y `www` **CNAME whatsapp-webhook-g7wa.onrender.com** en lugar de parkingsrv0.dondominio.com. Sin registros AAAA. Los NS no se tocan. Render pone el candado solo cuando ve los registros.
4. Cuando https://erptelecab.es ya abra con candado: `DOMINIO_ERP=erptelecab.es` en Render. Desde ahí, quien abra la dirección de Render en el navegador acaba en erptelecab.es con la misma ruta (`services/dominioErp.js`). **El webhook de Meta no cambia**: los mensajes del bot (POST /), la verificación (GET /?hub.mode=…) y los vídeos que Meta baja de /assets se siguen contestando en la dirección de Render; solo se redirige un GET o HEAD que pide una página. Redirección temporal (302): quitando la variable se deshace al momento. La sesión de cada uno es de su dirección, así que la primera vez en erptelecab.es hay que volver a entrar.
5. Drive: si `GOOGLE_OAUTH_REDIRECT` está puesta en Render, sigue funcionando igual. Si no, la vuelta se deduce de la dirección y hay que dar de alta `https://erptelecab.es/documentos/auth/callback` en Google Cloud antes de reconectar.
6. Opcional: `PORTAL_SECRETO` en Render. Sin ella, las huellas de los códigos usan `SESSION_SECRET`.

## Tablas

- `portal_codigo` (db/211): cada código mandado, con su huella, el email al que fue, la caducidad, los intentos y la IP.
- `portal_sesion` (db/211): cada sesión, con la huella del testigo, el último uso, la caducidad y el navegador.
- `conductor_puntuacion_semana` (db/210): la nota de cada semana. Ver [[Calificacion de conductores]].

Comprobador: `scripts/comprobar-portal.js`.
