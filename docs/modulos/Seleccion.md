---
tags: [modulo, seleccion, rrhh, contratacion, vacantes, ett]
aliases: [Selección, Contratación, Bolsa ETT]
---

# Selección

Cómo entra alguien a trabajar en Telecab: se abre el hueco, se busca a quien lo llene y se le lleva hasta el alta. Vive en `modules/Seleccion/` y son **cuatro pantallas contando una sola historia**, por eso comparten módulo:

```
Generador  →  Vacantes  →  Selección  →  Planificación
                             ETT
```

| Ruta | Pantalla | Qué hace |
|---|---|---|
| `/generador` | `vistas/generador.ejs` | Tráfico arma el puesto que falta: por hueco o por recambio |
| `/vacantes` | `vistas/vacantes.ejs` | El tablero de lo que hay que reclutar y en qué estado va |
| `/seleccion` | `vistas/seleccion.ejs` | El candidato, de un teléfono a la ficha de alta firmada |
| `/ett` | `vistas/ett.ejs` | Lo mismo por la agencia: se pega la tabla del correo |

La **vacante es el enlace** entre las cuatro: la abre el generador, la reclutan Selección o ETT, y muere *cubierta* (entró alguien) o *anulada* (ya no hace falta).

## Las piezas

```
generador.controller.js  generador.service.js     armar la vacante
vacantes.controller.js   vacantes.service.js      el tablero
                         vacantes.repo.js         SQL de la vacante y sus plazas
seleccion.controller.js  seleccion.service.js     el proceso del candidato
ett.controller.js        ett.service.js           la bolsa de la agencia
                         ett.excel.js             el fichero que se manda a la agencia
                         candidaturas.repo.js     SQL de la candidatura (1.500 líneas)
                         exigencia.repo.js        qué le falta a alguien para poder entrar
```

Desde fuera del módulo se entra por un `.service`, nunca por un `.repo` — ver [[Reglas de la casa]].

## Lo que identifica es la candidatura, no el teléfono

`modules/Seleccion/seleccion.service.js` lo dice en su cabecera: el teléfono sirve para **buscar** a alguien —es lo primero que se sabe de un candidato— pero **no identifica**, porque una persona puede cambiar de número y haber tenido dos procesos. La clave es el id de la candidatura.

Antes de abrir nada, `/seleccion/api/telefono/:tel` contesta qué hay detrás de ese número: si tiene proceso vivo, si ya existe su ficha y si está en [[BOLT]]. Con eso se decide entre continuar, restaurar o empezar de cero.

Un candidato es **una fila de `conductor` sin periodo de empleo** (`modules/Seleccion/candidaturas.repo.js`). No es un apaño: es literalmente lo que significa "todavía no trabaja aquí", y desde el primer día le da lo que la hoja nunca tuvo — que su DNI no se repita y que su teléfono no sea el de otro. Ver [[Base de datos]].

La regla de reparto del repositorio: **aquí solo vive el proceso**. El nombre, el DNI, la dirección y el NAF son de la persona y ya tienen tablas, así que `guardar()` reparte — lo que es campo de `conductor` va por `conductores.actualizar`, y solo lo del embudo se escribe en la candidatura. No se copia nada.

## La vacante cuesta plazas, no unidades

`modules/Seleccion/vacantes.repo.js`: una vacante es un conjunto de **plazas reales** que se prometen a alguien que todavía no está. Antes era una fila de hoja con las matrículas metidas en una celda en JSON; ahora son plazas colgando, y eso cambia tres cosas que se notan:

- Se sabe qué plaza está comprometida, así que el planificador puede pintarla reservada y **no se puede prometer el mismo sitio dos veces**.
- Existe el **recambio**: una vacante sobre una plaza que tiene dueño y se va a quedar libre. Antes solo se sabían generar vacantes de huecos vacíos, que es la mitad del trabajo.
- Selección la señala por clave foránea, así que se puede contestar "quién viene a esta plaza y cuándo".

**La jornada no se teclea**: sale de las plazas. Un fijo lleva su coche toda la semana, son 40 h; un correturnos cubre los descansos de dos o tres coches, y con 4 días son 32 h y con 6 son 40. Quien monta la vacante elige plazas; el contrato que se ofrece lo dice `cat_jornada.dias_ct`.

Una vacante **viva** es *abierta* o *en proceso*, que no es lo mismo que "no cerrada": una anulada tampoco está cerrada y no hay que reclutar para ella. Y el número que dice cuánto coche está esperando gente es la **suma de plazas**, no el recuento de vacantes: una de correturnos puede valer por seis.

> [!note] La limpieza del 24/09/2026 (db/146)
> El módulo se estrenó sin que nadie supiera bien cómo usarlo: entre el 10 y el
> 21/09 se crearon 27 vacantes, casi todas en tandas de un minuto, que no
> respondían a ninguna plaza real. Se borraron **24** y se quedaron las tres que
> tienen a alguien contratado colgando (6, 15 y 20). Ojo: la candidatura se
> enlaza por clave foránea, pero `candidatura.vacante_ref` e
> `incorporacion.vacante_id` guardan el **código como texto** y sin clave: borrar
> una vacante no las avisa, las deja apuntando a nada. Lo borrado está copiado en
> `vacante_archivo_20260924` y sus dos tablas hermanas, por si hay que devolverlo.

## El generador: hueco y recambio

`modules/Seleccion/generador.service.js` arma el puesto de dos maneras, y la segunda es la que faltaba:

- **Hueco** — la de siempre. Un correturnos se monta encadenando los días de descanso de varias matrículas: los turnos fijos libran 2 días y en esos 2 entra el CT, así que cada matrícula aporta un **bloque que se coge entero**. Se pide por contrato (32 h = 4 días = 2 bloques; 40 h = 6 días = 3), y lo dice `cat_jornada`, no una lista escrita en el código. Los bloques tienen que tener días **disjuntos** —nadie está en dos coches el mismo día— y se prefiere la misma zona; si no completa, se propone la más cercana por coordenadas (haversine sobre `base_zona`).
- **Recambio** — a alguien se le va a sacar. Se elige a la persona y la vacante sale sola de lo que ocupa hoy: sus plazas, su zona, sus libranzas, los días que cubre, y el contrato que corresponde a eso.

La fuente es el tablero de PostgreSQL, y se entra por la puerta de Planificación (`modules/Planificacion/tablero.service`). Un hueco de CT es un día en que el coche descansa y el tramo de ese turno se queda sin nadie según `f_cobertura`.

`GET /generador/api/plantilla` sale ordenada **por quien menos horas hace**, que es por donde se empieza a mirar a quién se sustituye.

## Los papeles son de la persona

El catálogo de documentos que pide la ficha de alta vive en `modules/Seleccion/seleccion.service.js` (`DOCUMENTOS`) **y en ningún otro sitio**: DNI y reverso, carné de conducir y reverso, certificado bancario, vida laboral y certificado de delitos sexuales. Cuando esa traducción estaba repartida entre la vista y la ruta, añadir un documento eran dos ficheros, y olvidarse de uno dejaba un papel que se pedía pero no se guardaba.

Se suben de tres maneras, y las tres acaban en el mismo sitio: desde el explorador, **arrastrando** el fichero sobre su línea, o **poniendo el ratón encima y pegando** el pantallazo con Ctrl+V. El pegado no se puede enganchar a la fila —el evento va al elemento con el foco o al documento—, así que se escucha una vez en el documento y se mira sobre qué línea está el ratón.

**No se piden fechas al subir.** Eran dos fechas tecleadas por papel con la imagen delante, y por eso salían mal: en un alta real el carné decía 12/12/2024 donde el papel ponía 12/02/2024. Quien quiera el aviso de caducidad puede ponerla después desde la ficha.

El **reverso** del DNI y del carné se piden pero no son obligatorios (`db/139`): el frente lleva lo que la gestoría necesita, y la cara de atrás a veces no se consigue. La **Tarjeta VTC** dejó de ser obligatoria (`db/138`) por un motivo más tonto: el sistema bloqueaba el alta por un papel que él mismo no ofrecía subir en ninguna pantalla.

Los documentos van colgados del `conductor_id`, no de la candidatura: quien se cae del proceso y vuelve seis meses después **no tiene que traer otra vez el DNI**. Los bytes van a Drive por la puerta de [[Documentos]]; lo que queda en la base es el índice con su tipo y su caducidad.

Selección también genera la **ficha de alta en PDF** con sus adjuntos (`POST /seleccion/api/candidatura/:id/ficha-pdf`, apoyada en `services/fichaAlta.js`) y geocodifica la dirección del candidato.

## Descartar no es borrar

**Descartar deja rastro** porque es una decisión del proceso. **Borrar** es para lo que no debería existir —un teléfono mal tecleado, una fila duplicada, una prueba— y el servicio **se niega si la persona ha trabajado aquí**. Lo mismo con las vacantes: una recién generada se borra, pero si ya tiene candidato o se cubrió se *anula*, que deja rastro.

## Qué se exige para contratar

## Dar de alta: el final del recorrido (18/09/2026)

El botón que cierra Selección se llama **«Dar de alta»** y deja a la persona dada de alta, no «esperando a RRHH». Cuando se pulsa ya está todo hecho: contrato abierto, turno puesto y cuenta de [[BOLT]] enlazada. Las dos paradas que había después —«Listo para RRHH» y «Pendiente de alta en Ballenoil»— no añadían nada que la persona necesitara para trabajar, y **Ballenoil ya no forma parte del alta**.

Lo que le falta a partir de ahí no es papeleo nuestro: es un coche. Por eso el aviso al planificador nace **siempre** ([[Planificacion]]):

- **Con vacante** → la alerta trae las plazas prometidas y se acepta (coloca todo o nada) o se rechaza (al banquillo, y la vacante vuelve a abrirse).
- **Sin vacante** → la alerta solo dice «hay alguien nuevo sin coche» y **se va sola** en cuanto se le da una plaza en el cuadrante.

Las 32 fichas que estaban en «Listo para RRHH» el día del cambio se quedaron donde estaban: esa bandeja sigue funcionando hasta que se vacíe sola.

### La ficha no sale a medias

`fichaPDF` comprueba antes de generar que estén **todos los datos que el papel imprime** y los documentos obligatorios; si falta algo, lo dice y no genera nada. Una ficha con huecos no sirve, y el hueco se descubriría en la gestoría.

Las fechas salen de la base ya escritas en **dd/mm/aaaa** (`to_char`), que es como las quiere la gestoría. Antes se formateaban en JS con `String(v).slice(0,10)` y sobre un `Date` de node eso da `"Thu Jul 06 2000 …"`: la ficha se mandaba con «Thu Jul 06» en la fecha de nacimiento ([[Trampas conocidas]]).

`modules/Seleccion/exigencia.repo.js` está fuera de los otros ficheros a propósito: lo necesitan **dos momentos que no se conocen entre sí** — Selección al pasar a RRHH, y los tres meses al convertir a alguien de ETT en plantilla propia (`services/repo/alta.convertirAPropia`). Si la lista viviera en uno de los dos, el otro tendría que copiarla, y en el sentido contrario habría un ciclo de dependencias.

La regla: **"obligatorio" no es una propiedad del dato, es de la relación**.

| Vía | Qué se exige |
|---|---|
| `propia` | el expediente entero: nombre, apellidos, DNI/NIE, fecha de nacimiento, sexo, correo, dirección, código postal, estado civil y nº de Seguridad Social |
| `ett` | lo mínimo para existir y abrirle cuenta en BOLT: nombre y DNI/NIE |

La agencia no da más por protección de datos y los papeles los manda después; exigirlos antes bloquearía a gente que **ya está trabajando**.

## La bolsa de empleo ETT

Sus candidatos son candidaturas como las demás, con `canal = bolsa_ett` (`modules/Seleccion/ett.service.js`). Una tabla, dos puertas: en Selección se escribe un teléfono, aquí se pega la tabla del correo.

El extra son las **tandas** (`solicitud`): la unidad con la que se le contesta a la agencia. Pegar la tabla es abrir una tanda.

- El Excel se manda **por tanda entera** — es la respuesta oficial a una petición suya —, y por eso `GET /ett/api/comprobar` se niega si queda alguien sin decidir, y devuelve **sus nombres** con el error. Para todo lo demás está el Excel **de elegidos a mano** (`POST /ett/api/excel-elegidos`), que se puede generar las veces que haga falta.
- Se pregunta **antes** de descargar porque una descarga del navegador no sabe enseñar un error: si el servidor se niega, el fichero simplemente no aparece y no hay forma de saber por qué. Por eso las dos descargas no pasan por el envoltorio de JSON del controlador.
- La lista trae **también las cerradas**: a la agencia se le responde igual por quien no se presentó o no pasó.
- El nombre de la agencia sale de la variable de entorno `ETT_NOMBRE`, con `GiGroup` de último recurso, **y el orden en que se decide importa**: lo que manda el formulario solo gana *si trae algo*. Puesto delante, su vacío pisaba al configurado y el alta se caía por falta de nombre. El último recurso no es la palabra "ETT": ese literal llenó la base de 99 periodos que decían "ETT" a secas y no se sabía con quién estaba contratada la gente.

El Excel (`modules/Seleccion/ett.excel.js`) mantiene **exactamente** las columnas y el significado de la matriz de siempre, porque la ETT las lee tal cual; el color y la leyenda solo refuerzan lo que ya dice el texto. Son cuatro resultados: Contratado, Pendiente (de asignar), No pasa y No se presentó. Había un quinto, "Presentó", y se quitó: quien está entrevistado y sin puesto **es** el pendiente de asignar, y dos nombres para lo mismo solo confunden a quien lo lee.

## Permisos

Son tres claves separadas del catálogo (`services/permisos.js`), en el grupo *Contratación*: `/vacantes`, `/seleccion` y `/ett`; `/generador` va en el grupo de Tráfico, porque quien arma la vacante es Tráfico. Ver [[Usuarios y permisos]].

## Lo que aún no está bien

`candidaturas.repo.js` pasa de 1.500 líneas y tiene dentro reglas que son de servicio —el recorrido del embudo, qué pasa al pasar a RRHH—. Se partió el módulo primero porque mover y partir a la vez es cómo se pierde una ruta sin enterarse; lo segundo viene después.

`services/repo/alta` e `services/repo/incorporaciones` siguen fuera: son el **traspaso** a Conductores y a Planificación y los usan también otros módulos. `services/vacantes.js` es una capa de compatibilidad que traduce la vacante al idioma de la hoja vieja y ya solo la usa `routes/notificaciones.js`: muere con ese módulo.

Y `matching` **no es de aquí** pese al nombre: solo usa el tablero del planificador, así que es de Planificación.
