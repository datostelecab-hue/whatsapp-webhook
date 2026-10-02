---
tags: [nucleo, sedes, barcelona, bolt, mapon]
fecha: 2026-10-02
estado: hecho (etapas 1 y 2), pendiente de aplicar db/174
---

# Sedes

Telecab opera en **Madrid** y en **Barcelona**, pero el ERP es de Madrid: la flota que se vigila, el cuadrante, las horas, las fichas y las nóminas son de Madrid. Barcelona va entrando por piezas y **sin que ninguna pantalla de Madrid cambie**, hasta que se decida cómo conviven las dos en el sistema (Camilo, 02/10/2026: «cuando me den las instrucciones de cómo van a convivir Barcelona y Madrid, hacemos el resto»).

Una sola constante dice cuál es la sede que se vigila: `SEDE_FLOTA = 'madrid'` en `services/nucleo.js`. El catálogo de sedes es `cat_sede` (db/132).

## Qué hay de Barcelona y dónde vive

| Pieza | Dónde | Desde | Se ve en |
|---|---|---|---|
| Los **coches** | `vehiculo.sede = 'barcelona'`, estado «B», sin baja | db/132; repasados con BOLT y Mapon en db/173 | Solo en Vehículos, con el permiso `/vehiculos/sedes` |
| La **empresa de BOLT** | `flota` con `sede = 'barcelona'` (company **329430**) | db/174 | Ninguna pantalla |
| Las **cuentas de BOLT** de sus conductores | `conductor_externo` con `bolt_company_id = 329430`, **sin ficha** (`conductor_id` vacío) | db/174 + el padrón de cada hora | Ninguna pantalla |
| Las **horas** de BOLT | — | no se traen | — |
| Las **fichas** de las personas | — | no hay: Camilo no tiene sus datos todavía | — |

## Los coches

La convención y el cruce de las tres fuentes están en [[Vehiculos]] («Los coches de Barcelona, cruzados con BOLT y Mapon»). Lo que importa aquí: las pantallas de flota filtran con `deLaFlotaVigilada(col)` (`nucleo.js`), y lo que manda órdenes a un coche —motor, puertas, el conductor en Mapon— pregunta a `services/otraSede.js` y **no toca un coche de otra sede** ([[Fichaje]], «Los coches de otra sede no se tocan»).

## Las cuentas de BOLT

BOLT tiene **cuatro empresas** en nuestra integración (`getCompanies`, 02/10/2026):

| company_id | Qué es | Conductores | En el ERP |
|---|---|---|---|
| 63530 | Madrid, cerrada en agosto (histórico hasta junio) | 72 | `CONFIG_BOLT.flotas` |
| 143626 | Madrid | 1.525 (216 activos) | `CONFIG_BOLT.flotas` |
| 329430 | **Barcelona** | 28 (22 activos) | `CONFIG_BOLT.flotasOtrasSedes` |
| 364138 | sin uso | 0 | no |

Son **dos listas a propósito** (`services/bolt.js`):

- `flotas` la recorren la ingesta de horas y viajes, los coches, el mapa y la auditoría. Todo eso es de Madrid y **no cambia**.
- `flotasOtrasSedes` la lee **solo el padrón de cuentas** (`cazamiento.sincronizarDesdeBolt`), para saber quién es cada teléfono.

El padrón pregunta a las dos listas **en la misma vuelta**. Tiene que ser así: las cuentas activas que BOLT no devuelve se marcan `no_vista`, y si Barcelona fuera en una vuelta aparte, cada vuelta marcaría como desaparecidas las cuentas de la otra. Con las mismas cuentas en dos empresas gana la activa, y entre dos activas la de Madrid (va primero en la lista).

Cada cuenta guarda la empresa en la que se vio: `conductor_externo.bolt_company_id`. **Vacío = no se ha visto desde db/174**, y se trata como de Madrid, que es lo que era todo hasta entonces.

### Por qué no se ven en Madrid

Una cuenta de BOLT sin ficha es, en Madrid, un «ID de BOLT libre» que alguien puede enlazar. Las de Barcelona no deben ofrecerse, así que **todo lo que enseña o propone cuentas sin dueño las deja fuera**:

- Las dos vistas de las que beben «IDs de BOLT libres», las sugerencias por teléfono y la situación en BOLT de cada persona: `v_bolt_libres` y `v_bolt_por_telefono` (de esta salen `v_bolt_sugerencia` y `v_conductor_alta_bolt`).
- Las tres consultas escritas a mano que miran las mismas cuentas, con `cuentaDeLaSedeVigilada(alias)` de `nucleo.js`: las cuentas hermanas del enlace automático (`cazamiento.autoEnlazar`), las cuentas que se pueden prestar ([[Conductores]], cuentas fantasma) y la cuenta de BOLT del alta por teléfono (`services/repo/alta.js`).

Lo demás que lee `conductor_externo` parte de una ficha (`conductor_id`), y las de Barcelona no tienen.

Medido el 02/10/2026 antes de aplicar: de las 28 cuentas de Barcelona **ninguna estaba ya en la base**; dos tienen el teléfono de una ficha de Madrid, y las dos están **desactivadas** en Barcelona (son cuentas viejas de gente de Madrid). Ningún teléfono se repite entre ellas y todos tienen 9 cifras.

### Entre desplegar y aplicar db/174

El código nombra columnas que crea la migración. Mientras no se aplica, el padrón guarda **solo las cuentas de Madrid, como antes** (las de Barcelona sin empresa se verían como libres), y las tres consultas a mano preguntan sin el filtro: todavía no hay cuentas de otra sede que esconder. En cuanto se aplica, la siguiente vuelta del padrón (cada hora) mete las 28.

## El bot de WhatsApp para Barcelona (etapa 2, 02/10/2026)

Pedido por Camilo el 02/10/2026: que los conductores de Barcelona abran turno y abran y cierren coches con el bot, como en Madrid. El detalle está en [[Fichaje]] («Los conductores de Barcelona en el bot»).

- **Quién escribe.** Si el teléfono no es de un usuario ni de un conductor de alta, se busca una **cuenta activa de BOLT de Barcelona** con ese teléfono (`externo_sufijo9`). Hace turnos con el nombre de BOLT y sin ficha.
- **Qué coche.** No se comprueba la matrícula contra BOLT ni contra el cuadrante: basta con que esté en Mapon y sea un coche de Barcelona en Vehículos, que se cruzó con BOLT y Mapon en db/173.
- **La regla de la sede** pasa de «un coche de otra sede no se toca» a «**el coche tiene que ser de la sede de la persona**». El motor de Barcelona no se corta ni se suelta nunca: se lleva desde Mapon.
- **La oficina con `/puertas`** (y el desarrollador) abre y cierra los coches de las **dos sedes** (Camilo, 02/10/2026). Los viajes de la empresa siguen siendo solo con coches de Madrid.
- **«Ver mis turnos» y «Código de lavado»** no les salen: Barcelona aún no tiene planificador ni Ballenoil. Si lo escriben, se les dice que por el momento no está disponible.
- Sus turnos quedan en el mismo libro (`fichaje_turno`, sin `conductor_id`) y no salen en el panel del planificador de Madrid.

**Hasta aplicar db/174 el bot no reconoce a nadie de Barcelona**: sin la empresa de cada cuenta no se sabe cuáles son de allí. Para Madrid no cambia nada.

**Escalar a otra sede** pide tres cosas, y ninguna es código del bot:
1. su empresa de BOLT en `flota` con su sede;
2. la empresa en `CONFIG_BOLT.flotasOtrasSedes`;
3. sus coches en Vehículos con esa sede.

Ver [[Fichaje]], [[WhatsApp]], [[BOLT]], [[Vehiculos]].
