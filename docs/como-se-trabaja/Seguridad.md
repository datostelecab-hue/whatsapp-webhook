---
tags: [seguridad, laboratorio, cabeceras, pentest]
aliases: [Seguridad, Laboratorio de seguridad, Pentest]
---

# Seguridad

Cómo se prueba la seguridad del ERP y qué endurecimiento lleva puesto. La idea de fondo: **se ataca en un laboratorio aislado, con datos de mentira**, nunca contra producción ni con datos reales.

## El laboratorio aislado

Un montaje de VirtualBox donde **Kali Linux** (el atacante) y una **copia del ERP** (el objetivo) viven en la misma red privada, sin salida a la red de casa ni a internet.

- **Objetivo** — el ERP en Docker (`Documents\lab-erp`): su código, un **Postgres local desechable** y **claves ficticias**. Arranca con `MODO_PRUEBAS=1`, que apaga los 16 crons y bloquea toda escritura externa (Sheets, WhatsApp, Mapon). Escucha **solo** en `192.168.56.1:3000` (la red host-only), no en la LAN.
- **Datos** — sintéticos: un usuario `lab@lab.local` (superadmin) y cinco conductores de mentira. **Cero personas reales.**
- **Sin secretos** — la copia del laboratorio lleva neutralizados los dos secretos que en el repo real están hardcodeados (el `client_id`/`client_secret` de [[BOLT]] en `services/bolt.js` y la URL de Apps Script en `routes/botPuertas.js`). Un objetivo que se va a atacar no puede llevar credenciales de verdad.

> [!warning] Regla del laboratorio
> Nunca apuntar el objetivo a la base de Render ni meterle datos reales. Si el objetivo cae —que es el objetivo del ejercicio—, lo que haya dentro es lo que se lleva el atacante.

Levantar / resetear (desde `Documents\lab-erp`):

```powershell
docker compose --env-file .env.lab up -d --build   # levantar
docker compose down -v                              # reset total (borra la BD del lab)
```

Volver a un Kali limpio: `VBoxManage snapshot "kali-linux-2026.2-virtualbox-amd64" restore "base-limpia"`.

## Cabeceras de seguridad

Todas las respuestas pasan por un middleware en `app.js` que pone las cabeceras. Lo que hay y por qué:

| Cabecera                          | Para qué                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `X-Content-Type-Options: nosniff` | que el navegador no adivine el tipo de un fichero (anti MIME-sniffing)                      |
| `X-Frame-Options: SAMEORIGIN`     | anti-clickjacking clásico (navegadores viejos)                                              |
| `Referrer-Policy`                 | no filtrar la URL interna al salir a un enlace externo                                      |
| `Strict-Transport-Security`       | forzar HTTPS — **solo en producción** (Render sirve el TLS)                                 |
| `Permissions-Policy`              | apaga cámara, micro, geolocalización y pago: si se cuela un script ajeno, no puede pedirlas |
| `Content-Security-Policy`         | anti-clickjacking moderno + cierra vectores reales                                          |

> [!info] La CSP va en DOS partes a propósito
> **Obligatoria** (`Content-Security-Policy`): solo `frame-ancestors`, `base-uri`, `object-src 'none'` y `form-action`. No tocan de dónde se cargan scripts ni estilos, así que **no pueden dejar la pantalla en blanco**, y cierran vectores reales (robar la `<base>`, cargar plugins, mandar un formulario a otro sitio).
>
> **En observación** (`Content-Security-Policy-Report-Only`): la política de recursos completa. Report-Only **no bloquea nada** — el navegador solo avisa en su consola de lo que incumpliría. Es el paso profesional para desplegar una CSP sin romper la web: se vigila la consola y, cuando no salta nada, se promueve a obligatoria.

> [!warning] Lo que impide una CSP de scripts de verdad: la CDN de Tailwind
> [!note] Lo que se abrió para el mapa (21/09/2026)
> [[Mapa de flota]] necesitó tres permisos más en la parte **en observación**, y
> ninguno toca `script-src`:
>
> - `connect-src https://tiles.openfreemap.org` — MapLibre pide cada trozo de
>   mapa por `fetch`, así que cae ahí. Sin esto el mapa se queda en gris.
> - `worker-src 'self' blob:` y `child-src 'self' blob:` — los dibuja en un
>   Worker creado desde un blob.
> - `img-src` gana `blob:` por lo mismo.
>
> Es un dominio de mosaicos, sin clave y sin cuenta: no puede ejecutar nada
> nuestro ni leer nada nuestro. Si algún día se cambia de proveedor de mapas,
> esta línea se cambia con él.

> El ERP carga Tailwind desde `cdn.tailwindcss.com`, que exige `'unsafe-inline'` y `'unsafe-eval'` en `script-src`. Con eso, la CSP casi no protege de XSS por script. **El arreglo de fondo es compilar Tailwind en el build y quitar la CDN**; entonces la política de recursos puede hacerse obligatoria y con `nonce` en vez de `unsafe-inline`. Pendiente. → [[Estado y pendientes]]

Se quitó también la cabecera **`X-Powered-By: Express`** que Express pone sola: no ayuda a nadie de dentro y le dice a quien audita desde fuera el framework de un vistazo (`app.disable('x-powered-by')`).

Verificado el 18/09/2026 contra el ERP arreglado: la huella desaparece, las cabeceras nuevas salen, y la pantalla se pinta igual (la CSP obligatoria no rompe la UI).

## Fugas de menor riesgo, anotadas

- **Los comentarios del HTML se sirven tal cual.** La página de login lleva comentarios que explican la lógica interna (que hay un freno anti fuerza bruta, la sesión de 30 días). Es información para el que audita. No se tocan porque [[Reglas de la casa|los comentarios son el porqué de la casa]] y valen más de lo que cuestan; el arreglo, si algún día pesa, es minificar el HTML servido en producción (quita comentarios sin tocar el fuente).

## Guía de pruebas para principiante

El método, no las películas: **reconocer → mapear → probar → confirmar**, como un checklist. El 90 % es mirar con atención. Y como es el laboratorio aislado, no se puede romper nada de verdad: si algo se estropea, se restaura el snapshot.

**Antes de empezar** — conseguir la cookie de sesión (muchas pruebas la necesitan):
```bash
curl -c galletas.txt -d "email=lab@lab.local&password=labpass123" http://192.168.56.1:3000/login
# luego, en cada prueba autenticada:  curl -b galletas.txt ...
```
Cómo leer cada respuesta: **`401` o `302 → /login` = protegido (bien)**; **`200` con datos = fuga**.

Cada punto lleva su severidad. Los anclajes son a notas reales del vault.

### Fase 1 · Reconocimiento

**Huella del stack y cabeceras** `✅ ya arreglado (18/09)`
`whatweb http://192.168.56.1:3000` y `curl -sI .../login`. Antes salía `X-Powered-By: Express` y no había CSP; ahora la huella no está y la CSP sí (ver arriba). Es el bucle completo: se encontró → se arregló → se re-comprueba.

**Fuerza bruta de rutas** `informativa` — de `[[Usuarios y permisos]]`, `[[Reglas de la casa]]` §10.
Casi todas las URL son palabras en español (`/control`, `/taller`, `/nominas`…). Aunque no salgan en ningún menú, responden si aciertas el nombre.
```bash
ffuf -w /usr/share/seclists/Discovery/Web-Content/spanish.txt -u http://192.168.56.1:3000/FUZZ -mc 200,301,302,401,403
```
*Bien:* las de dentro dan `302 → /login`; las inventadas `404 Cannot GET`. Descubrir rutas es inevitable; lo que importa es que cada una valide permiso **al actuar**, no solo que oculte el botón.

**Endpoints de diagnóstico** `media` — de `[[Trampas conocidas]]` (trust proxy) y `[[Estado y pendientes]]`.
`/mi-red` está tras login pero **sin clave de permiso**: cualquier usuario ve la topología interna (rangos de IP de la empresa, saltos de proxy).
```bash
curl -s -b galletas.txt http://192.168.56.1:3000/mi-red
curl -s -b galletas.txt -H 'X-Forwarded-For: 1.2.3.4' http://192.168.56.1:3000/mi-red   # la IP NO cambia: trust proxy=2 bien puesto
```
*Arreglo:* ponerle clave de desarrollador (como `/explorador` y `/migraciones`) o quitar `redesDeLaEmpresa` del JSON. Mira también `/whatsapp/plantillas` y el explorador de BD.

### Fase 2 · Autenticación y sesiones

**SQLi en el login** `informativa` — el ejemplo canónico. La consulta usa `WHERE lower(u.email) = $1` (parametrizada).
```bash
curl -i -d "email=admin' OR '1'='1&password=x" http://192.168.56.1:3000/login
sqlmap -u "http://192.168.56.1:3000/login" --data="email=t@t.com&password=x" -p email --batch
```
*Bien:* sigue dando `401` y sqlmap dice "no inyectable".

**Freno de fuerza bruta + truco X-Forwarded-For** `bien` — de `[[Usuarios y permisos]]`.
```bash
for i in $(seq 1 10); do curl -s -o /dev/null -w "%{http_code} " -d "email=x@y.z&password=mal" -H "X-Forwarded-For: 9.9.9.$i" http://192.168.56.1:3000/login; done
```
*Bien:* hacia el intento 8 salta "Demasiados intentos", y sigue saltando **aunque cambies el X-Forwarded-For** (cuenta por la IP real, no por la cabecera).

**La sesión es una cookie firmada con tu rol dentro** `ALTA` — de `[[Usuarios y permisos]]`.
No hay sesión en servidor: la cookie es un "papelito" (id, correo, **rol**) firmado con `SESSION_SECRET`. Si ese secreto falta o se filtra, un atacante se firma una cookie con `rol: superadmin` y entra a todo.
```bash
# el rol viaja legible dentro del token (es firma, no cifrado):
echo 'PEGA_TU_TOKEN' | cut -d. -f1 | tr '_-' '/+' | base64 -d 2>/dev/null; echo
```
*Arreglo:* `SESSION_SECRET` largo y aleatorio en el entorno (`openssl rand -hex 32`), nunca el efímero por defecto, nunca en git. → [[Estado y pendientes]]

**Banderas de la cookie** `baja` · **Enumeración de usuarios** `bien` (el reset contesta siempre lo mismo) · **Superadmin semilla + provisional en logs** `media` (si el SMTP está apagado, la contraseña provisional acaba en el log).

### Fase 3 · Control de acceso (el filón)

**Pedir sin sesión** `bien` — ya lo probaste: `/inicio/api/panel` y `/fichaje/api/estado` dan `401`. El acceso anónimo está cerrado.

**La regla del prefijo más largo** `media` — de `[[Usuarios y permisos]]`.
El permiso es un trozo de la ruta. Tener `/control` no debería abrir `/control/reportes`.
```bash
curl -i -b galletas.txt 'http://192.168.56.1:3000/control/reporte/excel?...'
```
*Mal:* `200` con el Excel sin tener ese permiso. *Arreglo:* cada submódulo bajo un prefijo ajeno va en `RUTA_A_CLAVE` (`services/permisos.js`).

**IDOR — cambiar el número del id** `ALTA` — el ejercicio estrella. De `[[Documentos]]`.
Muchos recursos se piden por un número correlativo (`/documentos/api/doc/1`, `/2`…). Si el servidor comprueba que puedes usar el módulo pero **no que ese registro sea tuyo**, cambiando el número lees lo de cualquiera (DNI, contrato).
```bash
for id in $(seq 1 50); do printf 'doc %s -> ' "$id"; curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -b galletas.txt http://192.168.56.1:3000/documentos/api/doc/$id/descargar; done
```
*Mal:* bajas papeles de conductores que no son "tuyos" solo cambiando el número. *Arreglo:* comprobar la propiedad/ámbito **por registro** en `documentos.service`, no solo el permiso de módulo.

**/documentos/api/vencen enseña lo de todo el mundo** `media` — de `[[Trampas conocidas]]`. El endpoint mira si puedes abrir `/documentos`, no de quién son los papeles → devuelve la lista global.

**Rutas "libres" por defecto** `media` — lo que no está en el catálogo de permisos queda abierto a cualquier usuario con sesión (`/configuracion`, `/soporte`, `/perfil`, `/mi-red`). Es deuda: para lo sensible conviene el modelo inverso (cerrado por defecto).

### Fase 4 · Inyección

**El punto ciego de `comprobar-sql`** `ALTA` — de `[[Comprobadores]]`.
El comprobador de SQL solo mira lo escrito entre backticks; lo interpolado con `${...}` **no lo revisa**. Ahí es donde puede colarse un valor de usuario pegado a la consulta.
```bash
# en un endpoint con parámetro (id, ?dia=, buscador):
curl -s -b galletas.txt "http://192.168.56.1:3000/UNA/RUTA?dia=2026-01-01'"
```
*Mal:* error 500 o mensaje de PostgreSQL → el parámetro va pegado. *Arreglo:* todo dato de usuario va como `$1`; `${...}` solo para nombres FIJOS de tabla/columna.

**XSS almacenado en un ticket** `ALTA` — de las vistas (`esc()` / `<%= %>`).
Guardas `<img src=x onerror=alert(1)>` en la descripción; si al abrir la bandeja **otra persona** lo ve sin escapar, se ejecuta en su navegador con su sesión.
*Bien:* se ve el texto literal. *Mal:* salta el `alert`. *Arreglo:* `esc()` en cada campo pintado en JS con `${...}`, `<%= %>` en el servidor — sin olvidar ninguno.

**XSS reflejado en `?next=`** `informativa` (comprueba que `<%= %>` escapa) · **XSS de segundo orden** `media` — un nombre que llega de BOLT o de un PDF también puede traer código: hay que escapar **todo dato externo**, no solo lo que se teclea en tus campos.

### Fase 5 · Endpoints peligrosos y secretos

**El bot de puertas** `ALTA` — de `[[WhatsApp]]`.
El webhook recibe un POST y puede accionar `open_doors`/`close_doors` en un coche real. Riesgo: quizá no verifica `X-Hub-Signature-256` (que el mensaje viene de verdad de Meta), y la URL de Apps Script no pide autenticación.
*Arreglo:* verificar la firma HMAC en **cada** POST antes de actuar; sacar y proteger la URL de Apps Script. → [[Estado y pendientes]]

**Credenciales de BOLT en el código** `ALTA` — de `[[BOLT]]`. `client_id`/`client_secret` escritos en `services/bolt.js` y en el historial de git. Como prueba de exposición, un atacante mira si `/.git/` se sirve:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.56.1:3000/.git/HEAD   # 404 = bien
```
*Arreglo:* al entorno **y rotarlas** (quitarlas del fichero no las borra del historial). → [[Estado y pendientes]]

**CSRF en los POST que cambian estado** `ALTA` — la web te reconoce solo por la cookie, que el navegador manda sola. Una página trampa podría hacer que el navegador de un empleado con sesión abierta mande un POST a escondidas. *Arreglo:* token CSRF por sesión + `SameSite=Lax/Strict` en la cookie.

**Subida de ficheros** `media` — de `[[Documentos]]`. Las rutas viejas (`/api/subir`, `/api/archivo/:id`) arman la carpeta con texto libre → posible path traversal (`../`). *Arreglo:* retirar las rutas viejas (ya marcadas "para borrar") y nunca construir la ruta con texto del usuario.

Relacionado: [[Estado y pendientes]] · [[Reglas de la casa]] · [[Trampas conocidas]] · [[BOLT]] · [[WhatsApp]] · [[Usuarios y permisos]] · [[Documentos]]
