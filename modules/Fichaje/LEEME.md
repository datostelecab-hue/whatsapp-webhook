# Fichaje

El registro de jornada de la gente de oficina: entrada y salida, pulsadas por la
propia persona.

```
fichaje.controller.js    la pantalla y la API
fichaje.service.js       LA PUERTA: quién ficha, qué se puede corregir
fichaje.repo.js          el SQL
vistas/fichaje.ejs       /fichaje
```

## Esto NO es `registro_jornada`

Hay otra tabla con un nombre parecido y no tiene nada que ver:

| | `registro_jornada` | `fichaje` (esta) |
|---|---|---|
| De quién | `conductor_id` | `usuario_id` |
| Quién la escribe | el sistema, desde los logs de BOLT | una persona pulsando un botón |
| Qué es | la jornada del conductor en la calle | el registro laboral de oficina |

Mezclarlas habría sido el error caro.

## Dónde está el botón

**En la barra de arriba, en todas las pantallas.** No en su página: fichar se
olvida, y si hay que ir a buscarlo se olvida más. Verde mientras la jornada
corre, ámbar cuando falta fichar la entrada, y en ámbar de aviso si quedó una
jornada de otro día sin cerrar.

Quién ve el botón **lo dice el servidor, no la sesión**. La cookie se firmó al
entrar y puede ser de antes de que le activaran el fichaje; si esto mirara la
cookie, a alguien recién marcado no le saldría hasta volver a entrar y parecería
que no funciona.

## Qué se guarda, y qué no

**Entrada, salida y dónde estaban al pulsar.** Sin pausas: dos pulsaciones al día
se olvidan mucho menos que cuatro, y un registro con pausas a medias es peor que
uno sin ellas.

**La ubicación se pide siempre y NUNCA bloquea el fichaje.** El registro de
jornada es obligatorio por ley (RD 8/2019): si el navegador deniega el permiso,
el GPS no coge o el móvil está en modo avión, esa persona no puede quedarse sin
fichar. El fichaje se guarda marcado como `denegada` o `error`, y así el hueco se
ve y se puede reclamar — en vez de perder el registro que la ley obliga a tener.

> **Es dato personal.** Guardar dónde está un empleado obliga a informarles por
> escrito de que se recoge, para qué y cuánto se guarda. Eso no lo arregla el
> código.

Y un detalle que sorprende: la geolocalización del navegador **solo funciona
sobre HTTPS** (o en localhost). En Render lo es; si algún día se sirviera por
HTTP plano, todas las ubicaciones llegarían como `error` sin que nadie tocara
nada.

## Los candados, que no son iguales

| | Quién |
|---|---|
| **Fichar** | cualquiera que haya entrado y tenga el fichaje activado en su ficha |
| **Pedir que se corrija lo suyo** | lo mismo: viene con el fichaje (db/159) |
| **Ver el registro de todos** | la llave `/fichaje/revisar` y los roles de acceso total |
| **Corregir a mano, confirmar y aprobar correcciones** | **solo** quien tiene `/fichaje/revisar` **en su matriz** |

`/fichaje` **no** está en el catálogo de permisos, a propósito: lo que no está en
el catálogo queda abierto a quien haya entrado. Si fichar necesitara un permiso,
habría que concedérselo a cada uno y sería una forma más de que alguien no pueda
fichar el día que le toca.

La llave de aprobar la tiene **una sola persona**: lo vigila la base
(`uq_permiso_fichaje_revisar`), y el servicio exige que esté en la matriz, así
que ni superadmin ni desarrollador aprueban por su rol. La responsabilidad del
registro recae en una sola persona y repartirla la diluiría.

## Las correcciones que pide cada uno

Son **peticiones** (`fichaje_correccion`): el fichaje no cambia hasta que se
aprueban. Aprobar aplica el cambio con su rastro (lo que había, en
`*_original`), lo firma quien lo pidió y deja la jornada confirmada. La única que
toca algo al momento es la de una jornada que se quedó **abierta** de un día
pasado: se cierra con la hora de la pulsación para que pueda volver a fichar.
Ver la nota Fichaje del vault.

## Por qué corregir no pisa nada

`entrada_original` y `salida_original` guardan lo que se pulsó, y **solo se
escriben la primera vez**: una segunda corrección no puede tapar el original.
Corregir exige motivo (lo comprueba la base con un CHECK, no solo la aplicación)
y queda con quién y cuándo.

Un registro que se edita sin rastro no vale delante de un inspector, y ese es
justo el momento en que hace falta que valga.

## El invariante vive en la base

Una persona no puede tener dos jornadas abiertas a la vez. Eso **no** se defiende
con un `if`: dos pulsaciones seguidas en un móvil con mala cobertura llegan como
dos peticiones y el `if` las deja pasar a las dos. Lo garantiza un índice único
parcial (`uq_fichaje_abierto`), que es lo único que no se puede burlar.

## Lo que falta

- **Nadie avisa a quien se olvida.** El parte del día dice quién no ha fichado,
  pero hay que entrar a mirarlo. Un WhatsApp a las 10:00 a quien no haya fichado
  sería lo natural — y la plantilla de Meta habría que pedirla.
- **Las horas del fichaje no entran en ningún informe.** Están en su pantalla y
  en el parte; no se cruzan todavía con nóminas ni con nada.
