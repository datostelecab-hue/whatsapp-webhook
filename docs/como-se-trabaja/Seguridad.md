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

| Cabecera | Para qué |
|---|---|
| `X-Content-Type-Options: nosniff` | que el navegador no adivine el tipo de un fichero (anti MIME-sniffing) |
| `X-Frame-Options: SAMEORIGIN` | anti-clickjacking clásico (navegadores viejos) |
| `Referrer-Policy` | no filtrar la URL interna al salir a un enlace externo |
| `Strict-Transport-Security` | forzar HTTPS — **solo en producción** (Render sirve el TLS) |
| `Permissions-Policy` | apaga cámara, micro, geolocalización y pago: si se cuela un script ajeno, no puede pedirlas |
| `Content-Security-Policy` | anti-clickjacking moderno + cierra vectores reales |

> [!info] La CSP va en DOS partes a propósito
> **Obligatoria** (`Content-Security-Policy`): solo `frame-ancestors`, `base-uri`, `object-src 'none'` y `form-action`. No tocan de dónde se cargan scripts ni estilos, así que **no pueden dejar la pantalla en blanco**, y cierran vectores reales (robar la `<base>`, cargar plugins, mandar un formulario a otro sitio).
>
> **En observación** (`Content-Security-Policy-Report-Only`): la política de recursos completa. Report-Only **no bloquea nada** — el navegador solo avisa en su consola de lo que incumpliría. Es el paso profesional para desplegar una CSP sin romper la web: se vigila la consola y, cuando no salta nada, se promueve a obligatoria.

> [!warning] Lo que impide una CSP de scripts de verdad: la CDN de Tailwind
> El ERP carga Tailwind desde `cdn.tailwindcss.com`, que exige `'unsafe-inline'` y `'unsafe-eval'` en `script-src`. Con eso, la CSP casi no protege de XSS por script. **El arreglo de fondo es compilar Tailwind en el build y quitar la CDN**; entonces la política de recursos puede hacerse obligatoria y con `nonce` en vez de `unsafe-inline`. Pendiente. → [[Estado y pendientes]]

Se quitó también la cabecera **`X-Powered-By: Express`** que Express pone sola: no ayuda a nadie de dentro y le dice a quien audita desde fuera el framework de un vistazo (`app.disable('x-powered-by')`).

Verificado el 18/09/2026 contra el ERP arreglado: la huella desaparece, las cabeceras nuevas salen, y la pantalla se pinta igual (la CSP obligatoria no rompe la UI).

## Fugas de menor riesgo, anotadas

- **Los comentarios del HTML se sirven tal cual.** La página de login lleva comentarios que explican la lógica interna (que hay un freno anti fuerza bruta, la sesión de 30 días). Es información para el que audita. No se tocan porque [[Reglas de la casa|los comentarios son el porqué de la casa]] y valen más de lo que cuestan; el arreglo, si algún día pesa, es minificar el HTML servido en producción (quita comentarios sin tocar el fuente).

Relacionado: [[Estado y pendientes]] · [[Reglas de la casa]] · [[Trampas conocidas]] · [[BOLT]]
