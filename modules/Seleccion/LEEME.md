# Selección

Cómo entra alguien a trabajar aquí: se abre el hueco, se busca a quien lo llene, y se le
lleva hasta el alta.

Son cuatro pantallas y **una misma historia**, por eso viven en el mismo módulo:

```
Generador  →  Vacantes  →  Selección  →  (RRHH)
                             ETT
```

| Pantalla | Qué hace |
|---|---|
| **Generador** | Tráfico arma el puesto que falta: por hueco (plazas vacías encadenadas) o por recambio (se elige a quien se va) |
| **Vacantes** | Lo que hay que reclutar, y en qué estado va |
| **Selección** | El candidato, de un teléfono a la ficha de alta firmada |
| **ETT** | Lo mismo pero por la agencia: se pega la tabla del correo en vez de escribir un teléfono |

La vacante es el enlace entre las cuatro: la abre el generador, la reclutan Selección o ETT,
y muere **cubierta** (entró alguien) o **anulada** (ya no hace falta).

```
/generador     /generador/api/…    armar la vacante
/vacantes      /vacantes/api/…     el tablero de lo que falta
/seleccion     /seleccion/api/…    el proceso del candidato
/ett           /ett/api/…          la bolsa de la agencia
```

## Las piezas

```
generador.controller.js  generador.service.js      HTTP / armar la vacante
vacantes.controller.js   vacantes.service.js       HTTP / el tablero
                         vacantes.repo.js          SQL de la vacante y sus plazas
seleccion.controller.js  seleccion.service.js      HTTP / el proceso
ett.controller.js        ett.service.js            HTTP / la bolsa
                         ett.excel.js              el fichero que se le manda a la agencia
                         candidaturas.service.js   la candidatura con la persona (abrir, guardar, contratar)
                         candidaturas.repo.js      SQL de la candidatura (1.200 líneas)
                         exigencia.repo.js         qué le falta a alguien para poder entrar
                         incorporaciones.service.js  la puerta para Planificación y notificaciones
                         incorporaciones.repo.js   quien entra a cubrir una vacante
vistas/                  las cuatro pantallas
```

Desde fuera del módulo se entra por un `.service`, nunca por un `.repo`.

## Lo que hay que saber

**La clave es el ID DE LA CANDIDATURA, no el teléfono.** El teléfono sirve para *buscar* a
alguien —es lo que se sabe de un candidato antes que nada— pero no identifica: una persona
puede cambiar de número y haber tenido dos procesos.

**Una vacante viva es abierta o en proceso**, que no es lo mismo que "no cerrada": una
anulada tampoco está cerrada y no hay que reclutar para ella.

**Lo que cuesta una vacante son sus PLAZAS, no su número.** Una de correturnos puede valer
por seis, y el número que dice cuánto coche está esperando gente es la suma de plazas.

**Los documentos son DE LA PERSONA, no de la candidatura.** Van colgados del `conductor_id`,
así que quien se cae del proceso y vuelve seis meses después no tiene que traer otra vez el
DNI. El catálogo de qué papeles se piden vive en `seleccion.service.js` y en ningún otro
sitio: cuando estaba repartido entre la vista y la ruta, añadir uno eran dos ficheros y
olvidarse de uno dejaba un papel que se pedía pero no se guardaba.

**Descartar no es borrar.** Descartar deja rastro porque es una decisión del proceso;
borrar es para lo que no debería existir (un teléfono mal tecleado, una prueba) y se niega
si la persona ha trabajado aquí.

## La ETT

Sus candidatos son candidaturas como las demás, con `canal = bolsa_ett`. Una tabla, dos
puertas: en Selección se escribe un teléfono, aquí se pega la tabla del correo.

El extra son las **tandas** (`solicitud`): la unidad con la que se le contesta a la agencia.
Pegar la tabla es abrir una tanda; el Excel se manda por tanda **entera** —es la respuesta
oficial a una petición suya— y por eso `/api/comprobar` se niega si queda alguien sin
decidir, con sus nombres. Para todo lo demás está el Excel **de elegidos a mano**, que se
puede generar las veces que haga falta.

Se pregunta antes de descargar porque **una descarga del navegador no sabe enseñar un
error**: si el servidor se niega, el fichero simplemente no aparece y no hay forma de saber
por qué.

El nombre de la agencia sale de `ETT_NOMBRE`, y el orden en que se decide importa: lo que
manda el formulario solo gana **si trae algo**. Puesto delante, su vacío pisaba al
configurado y el alta se caía por falta de nombre.

## Lo que se quedó fuera, y por qué

`repo/alta` sigue en `services/repo/`, pero ya solo lee (`porTelefono`) y hace el paso a
propia. Dar de alta es de Conductores: `Conductores/conductores.service.realizarAlta`.

**Las incorporaciones entraron aquí (01/10/2026).** Nacen de una vacante cumplida, y las
vacantes son de Selección: `incorporaciones.repo.js` entraba en el repositorio de vacantes
desde `services/repo/`. Planificación (el tablero) y las notificaciones entran por
`incorporaciones.service.js`; dentro del módulo se usa el repositorio.

`services/vacantes.js` es una capa de compatibilidad que traduce la vacante al idioma de la
hoja vieja. Ya solo la usa `routes/notificaciones.js`: muere con ese módulo.

`matching` **no es de aquí** pese al nombre: solo usa el tablero del planificador. Es de
Planificación.

## Lo que aún no está bien

**Partida el 01/10/2026.** Lo que la candidatura hace con la persona —abrir, guardar,
contratar, importar la matriz, tramitar— está en `candidaturas.service.js` y entra por la
puerta de Conductores; el SQL se quedó en `candidaturas.repo.js`, cada consulta con el texto
que tenía. Se comprobó con una traza de 42 casos contra el código de antes: idéntica. Ver
`docs/ARQUITECTURA.md`.

Lo que queda en el repositorio y huele a regla: qué estado se adelanta en `abrirContratada`
lo dice el orden del catálogo dentro del SQL, y `cambiarEstado` suelta la vacante.
