# Administración

El dinero que el conductor debe a la casa. BOLT le paga todo lo que factura,
incluido lo que cobró **en efectivo** y ya tiene en el bolsillo: ese efectivo es
una deuda con la empresa, y aquí se lleva.

```
/recaudacion                      el cuadro: quién debe cuánto
/recaudacion/api/comprobar        ocho comprobaciones que pueden fallar de verdad
/recaudacion/api/movimiento POST  apuntar una entrega (en mano o por nómina)
/recaudacion/api/cierre/*         lo que dice BOLT, calculado y congelado
```

## Las piezas

```
recaudacion.controller.js   HTTP. Lo único que decide: quién firma sale de la sesión.
recaudacion.service.js      los dos permisos, el cuadro, el cierre
recaudacion.repo.js         el SQL (PostgreSQL puro)
vistas/recaudacion.ejs      la pantalla
```

Desde fuera se entra por `recaudacion.service` — el cron de `app.js` incluido.

## Lo que hay que saber

**Dos permisos, no uno.** Entrar y cobrar EN MANO es `/recaudacion`; apuntar lo
que se descuenta POR NÓMINA es `/recaudacion/nomina`, y eso es de RRHH: quien
cobra en ventanilla no tiene por qué poder tocar la nómina de nadie. Ninguno
viene sembrado en ningún rol — el módulo nace apagado para todo el mundo y los
reparte el jefe a mano en `/usuarios`.

**El permiso se comprueba en el servidor, no solo en el menú.** Esconder un botón
no es una autorización: quien conozca la URL la llama igual. Por eso
`puedeNomina` se vuelve a preguntar al apuntar, y no solo al pintar la pantalla.
Y si la consulta de permisos falla, la respuesta es **no**: en un módulo de caja
la duda se resuelve cerrando.

**Quién es cada uno sale de la sesión, nunca del cuerpo de la petición.** En caja,
"lo apuntó Fulano" tiene que ser verdad.

**La cifra de BOLT no se teclea: se calcula y se congela.** Lo anterior al corte
lo manda el Excel que se importó y el repositorio se niega a tocarlo — si no, un
recálculo reescribiría un histórico que ya se cuadró con la gente.

**El cuadro es el acumulado, sin quincenas.** La quincena sigue existiendo por
dentro (es la caja donde se guarda cada cierre de BOLT) pero ya no se navega: lo
que se pregunta de alguien es cuánto debe EN TOTAL.

**El cron recalcula solo las quincenas vivas.** Cada media hora, la de ahora y la
anterior. Rehacer el histórico entero treinta veces al día sería trabajo tirado,
y lo cerrado no cambia.

## Lo que NO se mudó, y por qué

**`administracion` se queda donde está.** Es la otra mitad del reparto, pero no
está en PostgreSQL: cuelga de `services/tickets.js` y `services/conductoresBolt.js`
(los dos sobre hojas) y de `services/planificadorV2.js`. Misma regla que dejó
fuera a `rrhh`, `peticiones`, `ticketera`, `agenda`, `fichas` y `libranzas`.

**`services/codigosBallenoil.js` ya no existe.** Los códigos de lavado y el PIN
de Ballenoil se quitaron el 24/09/2026: ya no se trabaja con Ballenoil. La
pantalla `/administracion` se fue con ellos y ahora lleva a sus tickets; la
tabla `ballenoil_codigo` se queda en la base por lo ya repartido.

Por eso este módulo es, hoy, solo recaudación.
