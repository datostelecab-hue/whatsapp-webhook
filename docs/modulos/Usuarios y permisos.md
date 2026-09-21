---
tags: [modulo, usuarios, permisos, seguridad, sesion, roles]
aliases: [Usuarios, Permisos, Login, Sesión, Roles]
---

# Usuarios y permisos

Las cuentas del ERP: alta, roles, permisos, contraseñas y entrada al sistema. El módulo es `modules/Usuarios/`, pero **el control de acceso no vive ahí**, y eso es una decisión.

```
modules/Usuarios/auth.controller.js        login, logout, cambiar y recuperar contraseña
modules/Usuarios/usuarios.controller.js    la pantalla /usuarios y su API
modules/Usuarios/usuarios.service.js       las cuentas: leer, crear, cambiar, contraseñas
modules/Usuarios/vistas/                   login, usuarios, cambiar-password, olvide-password

services/sesion.js          la cookie firmada y los middlewares de acceso
services/permisos.js        EL CATÁLOGO de permisos y la clave que gobierna cada ruta
services/limiteIntentos.js  el freno de fuerza bruta
```

`sesion.js`, `permisos.js` y `limiteIntentos.js` se quedan fuera del módulo a propósito: conceptualmente son de Usuarios, pero son **middleware que usa la aplicación entera**, y meterlos dentro haría que todos los demás módulos dependieran de este. Son transversales —quién eres y qué puedes—, la misma categoría que ya reconoce `scripts/comprobar-capas.js`. Ver [[Reglas de la casa]].

## Entrar

**No hay auto-registro**: las cuentas las crea el desarrollador desde `/usuarios`. Al crear una se genera una **contraseña provisional** legible (sin caracteres ambiguos: nada de 0/O ni 1/I/L) que se manda por correo; en el primer acceso la plataforma obliga a cambiarla (`forzarCambio` redirige a `/cambiar-password` y deja pasar solo eso y `/logout`).

Las contraseñas van **hasheadas con scrypt** en formato `saltHex:hashHex` —el mismo de la hoja vieja, así que los hashes migrados siguen valiendo— y se comparan con `timingSafeEqual`. La contraseña del **buzón de correo** del usuario es distinta: va **cifrada** (AES reversible, `services/cripto.js`) porque hay que poder usarla contra el SMTP, y la clave de cifrado vive en la variable de entorno `CRED_KEY`.

El login (`auth.controller.js`) tiene un freno anti fuerza bruta **por IP y por correo**. La IP se lee de `req.ip` y no de la cabecera a mano: con `trust proxy` puesto en `app.js`, Express ya descarta lo que el cliente haya metido delante en `X-Forwarded-For` — leyendo el primer valor de esa cabecera, como se hacía, se esquivaba el freno cambiándola en cada intento.

"Olvidé mi contraseña" contesta **siempre lo mismo** —"si ese correo tiene una cuenta, te hemos enviado una provisional"— para no revelar qué correos existen. Si el SMTP no está configurado, la provisional queda en los logs del servidor, para no quedarse nunca fuera. Lo mismo con el superadministrador semilla: con `SUPERADMIN_EMAIL` definido, si esa cuenta no existe se crea al arrancar.

## La sesión es una cookie firmada

`services/sesion.js`: la sesión va en una cookie firmada con HMAC-SHA256 (estilo JWT), **sin store**. Es *stateless*, así que sobrevive a los reinicios y despliegues del servidor — nadie se desloguea al desplegar. El secreto de firma vive en la variable de entorno `SESSION_SECRET`; si falta, se usa uno efímero y se avisa por consola de que las sesiones no sobrevivirán a un reinicio.

Dentro del token viajan el id, el correo, el nombre, el rol, el tema y si hay que cambiar la contraseña. **El rol se lee de la sesión y se valida en el servidor**, no en el navegador.

### "Mantener sesión iniciada"

Marcándola, la sesión dura **30 días** en vez de 12 h.

**Esto solo es seguro porque se puede cortar desde el servidor.** La cookie va firmada y el servidor no la consulta contra la base: con 12 h eso se aguantaba —bloquear a alguien le dejaba dentro medio día como mucho—, pero con 30 días **bloquear a alguien no haría nada durante un mes**, porque su firma seguiría siendo válida.

La solución no es guardar sesiones en una tabla: es guardar **la fecha del corte**, `usuario.sesiones_desde` (`db/105`). Toda cookie emitida antes de esa marca deja de valer. Una columna en vez de un almacén de sesiones.

| Acción | Efecto |
|---|---|
| Bloquear al usuario | se le echa de todos sus dispositivos, en el acto |
| Resetear su contraseña | igual |
| Que él cambie su contraseña | cierra sus otras sesiones y conserva la de aquí |
| "Cerrar sesiones" en su ficha | le echa sin bloquearle la cuenta |

Tres detalles a propósito:

- **Solo se comprueban las sesiones largas.** Las de 12 h no pagan una consulta por petición: su peor caso es medio día. La cookie lleva `larga` para saberlo.
- **El corte se cachea 30 s.** No es instantáneo al segundo, pero sí en menos de un minuto — de sobra para echar a alguien, y evita una consulta por cada imagen que pida el navegador.
- **Si la base no contesta, no se echa a nadie.** Un fallo de red dejaría la aplicación entera sin acceso. Se anota el error y se sigue.

Re-emitir una sesión (cambiar el tema, cambiar la contraseña) **conserva lo que era**: si alguien marcó "mantener sesión iniciada", cambiarle el tema no debería echarle a las 12 h.

## Sesiones abiertas, y el dispositivo padre

En **Configuración → Sesiones abiertas** cada uno ve dónde tiene la cuenta abierta y puede cerrar. Dos tablas nuevas (db/142), y son dos cosas distintas a propósito:

| | qué es | para qué |
|---|---|---|
| `usuario_sesion` | una fila por **inicio de sesión**, con su `sid` dentro del token | cerrar **una** |
| `usuario_dispositivo` | una fila por **navegador**, con su propia cookie que no se borra al salir | decidir **quién manda** |

De un PC sales y vuelves a entrar diez veces y sigue siendo el mismo PC. Por eso el dispositivo va aparte: si el mando dependiera de la sesión en curso, bastaría con que la del padre caducara una noche para que el teléfono lo heredara a la mañana siguiente.

### La regla

**Solo el dispositivo con el primer inicio de sesión más antiguo puede cerrar las sesiones de los demás.** Entraste por primera vez en el PC en abril y en el móvil en mayo: el PC manda, y desde el móvil no se puede echar al PC.

> [!info] Por qué existe la regla
> Un robo de sesión se parece mucho a esta pantalla. Quien te coge el móvil desbloqueado no puede usarlo para dejarte fuera de tu propio ordenador; lo único que puede hacer desde ahí es cerrar lo que ya tiene.

Dos permisos distintos, y hay que separarlos:

- **La propia siempre se puede cerrar.** No es echar a nadie, es salir — negárselo a quien está en un dispositivo que no manda le dejaría sin forma de cerrar el que tiene delante.
- **La de otro dispositivo, solo desde el padre.**

Y nunca la de otra persona: el `usuario_id` de la fila tiene que ser el de quien pide. Sin esa comprobación, un `sid` ajeno —que es un texto que alguien puede haber visto— cerraría la sesión de cualquiera.

> [!warning] El mando solo se mueve desde la base de datos
> `usuario_dispositivo.principal_forzado` gana a las fechas, y **ninguna pantalla lo escribe**. Es a propósito: si se pudiera cambiar desde dentro de la aplicación, la regla no protegería de nada — el que entrase se haría padre y luego echaría al de verdad.
>
> ```sql
> UPDATE usuario_dispositivo SET principal_forzado = TRUE
>  WHERE usuario_id = <id> AND dispositivo = '<el de la cookie>';
> ```

### Cerrar una sesión tiene que NOTARSE

El token está firmado y seguiría valiendo treinta días, así que si nadie mira la fila, cerrarla no echa a nadie. `cargarSesion` comprueba que la sesión siga abierta en **cada petición**, con dos cuidados:

- **Solo los tokens que llevan `sid`.** Los de antes de esto no lo tienen y siguen valiendo hasta caducar: desplegar esto no echa a nadie. A cambio, esas no se pueden cerrar por separado — para ellas solo existe el corte de todas.
- **Caché de 5 segundos, y solo lo positivo.** Sin caché serían dos o tres consultas por pantalla; cinco segundos es lo que tarda como mucho en notarse un cierre. Lo negativo no se cachea: en cuanto deja de valer, deja de valer.

Y como con el corte: **si la base no contesta, no se echa a nadie**.

**Salir cierra la fila**, no solo la cookie. Si no, la sesión seguiría saliendo en la lista de abiertas y esa lista dejaría de significar nada.

**Re-emitir conserva el `sid`** (cambiar el tema, el perfil): no es volver a entrar, y perderlo dejaría la fila huérfana y a esa pestaña sin forma de cerrarse a sí misma.

> [!note] Lo que esto NO puede saber
> El dispositivo se reconoce por una cookie. Borrar los datos del navegador, usar otro navegador en el mismo PC o entrar en incógnito son **dispositivos nuevos** — y si el padre se pierde así, el mando pasa al siguiente más antiguo. El `user-agent` del que sale la etiqueta («Windows · Chrome») miente con facilidad: es una ayuda para reconocer cuál es cuál, nunca lo que decide nada.

## Cómo se decide si alguien entra a una ruta

La cadena de `app.js` es: `cargarSesion` (decodifica, nunca corta) → `protegido` (sin sesión, a `/login` o 401 si es API) → `forzarCambio` → **`controlAcceso`** → `cargarPermisos` (deja las claves en `res.locals` para que el menú pinte solo lo que se puede abrir).

`controlAcceso` hace exactamente esto:

1. Si el rol tiene **`acceso_total`**, pasa. Son los roles marcados así en la tabla `rol` (`db/01-nucleo.sql`): hoy **superadmin y desarrollador**. No llevan filas de permisos ni matriz en la pantalla — entran a todo.
2. Si la ruta está en `SIEMPRE_ABIERTO`, pasa. Hoy solo `/inicio`.
3. Se calcula **la clave del catálogo que gobierna esa ruta** (`permisos.claveDeRuta(path, method)`). **Si no hay clave, es libre**: lo que no está en el catálogo queda abierto a quien haya entrado (configuración, soporte, exportar, perfil, fichaje…).
4. Si la hay, se mira si el usuario la tiene concedida en `usuario_permiso`. Si no, 403 — JSON para las APIs y la vista `sin-permiso` para las pantallas.

**El panel de inicio no se bloquea nunca.** Es donde cae todo el mundo al entrar, y rebotarlo contra "sin permiso" es lo que hacía que la gente creyera que la web se había caído. Su clave `/inicio` sigue existiendo, pero la mira **la propia pantalla** para decidir si enseña las cifras de la empresa o el panel vacío.

### La regla del prefijo más largo

La clave de un permiso **es el prefijo de ruta del módulo**: `/control`, `/control/km`, `/taller`, `/taller/apuntar`… Todas las claves se aplanan y se ordenan **de la más larga a la más corta**, y gana la primera que case con la URL.

La consecuencia es la que se quería: **tener `/control` no abre `/control/km`** si ese submódulo está en el catálogo aparte. Así los submódulos se conceden de verdad uno a uno, en vez de venir de regalo con el padre.

Sobre eso hay tres capas más:

- **`ALIAS`** — rutas que son el mismo módulo con otro nombre (`/planificador-v2` → `/planificador`, porque el front del tablero llama ahí).
- **`RUTA_A_CLAVE`** — la tabla explícita, que **manda por encima de todo**: rutas que viven bajo un prefijo pero pertenecen a otro submódulo. Sin ella, `/control/reporte/excel` no casa con `/control/reportes` y caía en `/control`: quien solo tenía "Reportes de control" abría la pestaña y cada botón le daba 403, y quien tenía "En directo" sin Reportes descargaba todo igualmente. Ahí están también los candados de escritura por ruta (justificar en la bitácora, apuntar en el taller) y las cuentas fantasma, que **cuelgan de un prefijo limpio a propósito**: enlazar una cuenta mueve horas —y dinero— de una persona a otra, y si esas rutas colgaran de `/plantilla/api/…` cualquiera que abre la plantilla podría hacerlo.
- **El método** — en los módulos partidos en *mirar* y *tocar*, un `GET` pide la clave de leer y **todo lo demás** la de escribir. Es el caso del planificador: mirarlo lo necesita media empresa, tocarlo es de Tráfico. Y va por método y no por una lista de rutas porque **el tablero tiene veinte endpoints que escriben**, y una lista a mano se queda corta el día que alguien añade el veintiuno — que es justo el día en que un candado tiene que seguir cerrado. Marcar el hijo con `escribir: true` en el catálogo es lo único que hay que hacer para partir un módulo en dos. `HEAD` y `OPTIONS` cuentan como `GET`: ninguno cambia nada.

Las claves concedidas se **cachean 60 s** por usuario, porque el control de acceso corre en cada petición; guardar los permisos de alguien invalida su caché.

## El catálogo

`services/permisos.js` es **la única fuente de verdad**, y lo usan tres sitios: el control de acceso, el menú lateral y la matriz de `/usuarios`. Está agrupado por áreas — General, Contratación, RRHH, Tráfico, Taller, Operaciones, Aprobaciones, Caja, Puertas y Dirección — y cada módulo puede llevar `hijos` con clave propia.

Dos marcas importan:

- **`escribir: true`** — el hijo es el permiso de tocar, y se exige para todo lo que no sea `GET`.
- **`manual: true`** — la clave **nace apagada para todo el mundo**, incluidos los roles que llevan el catálogo entero: no entra en la semilla de ningún rol y se da usuario a usuario. Es lo que protege la caja (`/recaudacion`, `/recaudacion/nomina`), **abrir puertas por WhatsApp** (`/puertas`), la configuración de alertas y los vehículos de otra sede. Una puerta es física y una caja es una caja: quién puede tocarlas no se decide por descarte.

Las claves que se guardan se filtran contra el catálogo: lo que no sea una clave conocida no se escribe.

## Roles y semillas

Los roles **salen de la base** (tabla `rol`), no de una lista escrita a mano. Antes eran un array en el servicio y otra copia con sus nombres bonitos en cada vista, así que añadir un rol obligaba a acordarse de tres sitios y el que se olvidara dejaba un rol que existe pero que nadie puede elegir.

Al crear un usuario se le **siembran** los permisos típicos de su rol (`semillaDeRol`). Eso **no es lo que puede ver para siempre**: en cuanto el usuario existe, el permiso real es el suyo y se afina uno a uno. La semilla solo evita que entre a una pantalla vacía el primer día.

La regla al repartir: **cada uno con lo suyo y nada más**. Es más fácil añadirle un módulo a quien lo pide que enterarse de que lleva un año viendo las nóminas de los demás.

Hoy hay semilla para `oficina`, `trafico`, `jefe_trafico`, `gestor_trafico`, `taller`, `reclutador`, `administracion`, `operaciones`, y `gerencia`/`directiva`. Estos dos últimos lo ven **todo, pero por la matriz y no por `acceso_total`**: así se ve en `/usuarios` lo que alcanzan y se les puede quitar algo sin tocar código. `superadmin` y `desarrollador` no tienen semilla porque no la necesitan.

Dos candados por rol, además del catálogo:

- **`requiereSuperadmin`** — superadmin *o* desarrollador.
- **`requiereDesarrollador`** — **solo** el desarrollador, excluyendo al superadmin. Es el candado de las migraciones, de descongelar una nómina, de corregir un fichaje y de la bandeja de Tickets Telecab.

## La pantalla `/usuarios`

Es **solo del desarrollador**: `router.use(sesion.requiereDesarrollador)` en la primera línea del controlador; un superadmin ni la ve. Desde ahí se crea la cuenta, se cambia el rol, se bloquea o se activa, se resetea la contraseña, se cierran sus sesiones, se marca quién ficha y se marca **casilla a casilla** qué módulos abre.

Nunca se devuelve el hash. A los de acceso total no se les pinta matriz, y guardar permisos sobre uno de ellos da error explicando por qué.

Cuatro reglas que el controlador defiende:

- No puedes quitarte a ti mismo el rol de desarrollador.
- No puedes desactivarte a ti mismo.
- **Debe quedar al menos un administrador activo**: no se puede dejar el sistema sin nadie con acceso total.
- Si alguien **baja** de un rol con acceso total a uno normal y no tiene matriz, se le siembra la de su rol nuevo para que no se quede mirando una pantalla vacía.

Bloquear o resetear cortan las sesiones en el acto (ver arriba).

## Quién tiene que fichar

La empresa quiere que los empleados fichen por el ERP, **pero no todos**: la directiva y la gerencia no fichan.

Se elige **persona a persona** con una casilla en su ficha (`usuario.ficha_obligatorio`, `db/105`; `POST /usuarios/fichaje`), **no por rol**. Por rol parece más limpio y es peor: en cuanto haya un jefe de tráfico que sí ficha y otro que no, la regla se rompe y hay que inventar excepciones.

Y **nace apagado para todos**: se elige a quién **sí**. Si se olvida marcar a alguien, el fallo es que no fiche —se arregla marcándolo—, no que le empiece a contar una jornada que nadie pidió. Ver [[Fichaje]].

## Lo que falta

`usuarios.service.js` lleva dentro sus consultas SQL: es servicio y repositorio a la vez, y hay que sacarlo a un `usuarios.repo.js`. No se hizo al mudarlo porque la mudanza tenía que ser mecánica y revisable de un vistazo.
