---
tags: [modulo, administracion, recaudacion, caja, efectivo, bolt]
aliases: [Administración, Recaudación, Caja]
---

# Administración

Hoy este módulo es, en la práctica, **recaudación**: el dinero que el conductor debe a la casa. Vive en `modules/Administracion/` y se ve en `/recaudacion`.

[[BOLT]] le paga al conductor todo lo que factura, **incluido lo que cobró en efectivo** y ya tiene en el bolsillo. Ese efectivo es una deuda con la empresa, y aquí se lleva.

```
recaudacion.controller.js   HTTP. Lo único que decide: quién firma sale de la sesión.
recaudacion.service.js      los dos permisos, el cuadro, el cierre
recaudacion.repo.js         el SQL (PostgreSQL puro)
vistas/recaudacion.ejs      la pantalla
```

Desde fuera se entra por `recaudacion.service` — el cron de `app.js` incluido. Ver [[Reglas de la casa]].

## Las tres columnas

```
DEUDA     lo que BOLT dice que cobró en efectivo en la quincena (el cierre)
RECAUDADO lo que ha entregado: presencial + descontado de nómina, menos lo devuelto
PENDIENTE deuda − recaudado
```

El pendiente que importa es el **acumulado**, no el de una quincena suelta: quien debe 300 € de julio y entrega 300 € en agosto está a cero, aunque la quincena de agosto salga con "recaudado" y sin deuda. Por eso cada cifra se da en las dos alturas —la quincena que se mira y el arrastre— y **nunca se mezclan**.

**El cuadro es el acumulado, sin quincenas.** La quincena sigue existiendo por dentro (es la caja donde se guarda cada cierre de BOLT) pero ya no se navega: lo que se pregunta de alguien es cuánto debe **en total**.

La quincena es `(año, mes, 1|2)`: la 1 del 1 al 15, la 2 del 16 al último día sea 28, 30 o 31. **Se calcula siempre y no se guarda**: dos filas con el corte escrito acabarían discrepando el día que alguien lo teclee mal.

## Dos permisos, no uno

Entrar y cobrar **en mano** es `/recaudacion`; apuntar lo que se descuenta **por nómina** es `/recaudacion/nomina`, y eso es de RRHH: quien cobra en ventanilla no tiene por qué poder tocar la nómina de nadie.

Ninguno de los dos viene sembrado en ningún rol — están marcados `manual` en el catálogo, así que el módulo **nace apagado para todo el mundo**, hasta para dirección, y los reparte el jefe a mano en `/usuarios`. Es una caja: quién puede tocarla no se decide por descarte. Ver [[Usuarios y permisos]].

Y hay dos reglas más que el servicio defiende:

- **El permiso se comprueba en el servidor, no solo en el menú.** Esconder un botón no es una autorización: quien conozca la URL la llama igual. Por eso `puedeNomina` se vuelve a preguntar **al apuntar**, y no solo al pintar la pantalla. Si la consulta de permisos falla, la respuesta es **no**: en un módulo de caja la duda se resuelve cerrando.
- **Quién es cada uno sale de la sesión, nunca del cuerpo de la petición.** En caja, "lo apuntó Fulano" tiene que ser verdad.

## Caja y deuda no son lo mismo

Cada movimiento tiene **dos efectos que no van juntos**, y confundirlos es lo que descuadra una caja: si entra o sale dinero físico del cajón, y si el conductor debe menos después. Un descuento de nómina baja la deuda y no mete un billete en la caja; una salida al banco vacía la caja y no cambia lo que nadie debe.

| Tipo | Caja | Deuda | |
|---|---|---|---|
| En mano | +1 | +1 | se **cuenta** billete a billete |
| Descontado de nómina | 0 | +1 | |
| Devuelto al conductor | −1 | −1 | deshace un ingreso suyo |
| Cambio entregado | −1 | −1 | se **cuenta**; le prestamos dinero nuestro |
| Banco · Gastos empresa · Caja chica · Nómina | −1 | 0 | las cuatro bocas de salida |
| Traspaso de apertura | −1 | 0 | interno, de un solo uso |

El **cambio entregado** lleva los mismos signos que "devuelto" pero es otra cosa, y por eso es otro tipo: mezclarlos haría imposible contestar *"¿cuánto cambio tenemos en la calle?"*, que es la pregunta por la que existe. El **traspaso de apertura** es todo lo que salió de la caja antes de que existiera el módulo, sin desglosar porque no lo está en ninguna parte; `interno` lo deja fuera del desplegable.

Los importes que se cuentan van en **céntimos** y por denominación, de mayor a menor: con euros en coma flotante, `0.1 + 0.2` no da `0.3` y el recibo no cuadraría con su total. En "en mano" y en "cambio", **el recuento manda sobre el importe tecleado**.

**Anular no borra**: el movimiento queda anulado con su motivo.

## La cifra de BOLT no se teclea

Cada pedido trae su método de pago y su precio desglosado, así que el efectivo de una quincena es:

```
Σ (ride_price − cash_discount + booking_fee)   de los pedidos 'cash' 'finished'
```

Comprobado contra el Excel que llevaban a mano en la quincena 1–15 de agosto: los 8 conductores mirados, **al céntimo**.

Aun así la cifra **se congela** en `recaudacion_cierre` cuando se calcula: se está cobrando dinero contra ella y no puede moverse sola porque BOLT corrija un viaje tres semanas después. Se recalcula cuando alguien lo pide, y **se ve que cambió**.

Lo anterior al corte lo manda el Excel que se importó, y **el repositorio se niega a tocarlo**: si no, un recálculo reescribiría un histórico que ya se cuadró con la gente.

`GET /recaudacion/api/cierre/bolt` enseña lo que dice BOLT **ahora mismo sin congelar nada**: es la vista previa de lo que haría "calcular", para mirar antes de tocar. Y hay además cierre manual conductor a conductor, ajuste con motivo, e importación del cierre pegando el Excel entero.

## Las ocho comprobaciones

`GET /recaudacion/api/comprobar` son ocho pruebas que **pueden fallar de verdad**. No escribe nada, así que se puede pulsar cuando se quiera. Las primeras cruzan **la tabla contra la caja** —la deuda, lo entregado en mano, el cambio en la calle y lo que queda por recaudar—, que son dos consultas distintas sobre las mismas tablas: una agrupa por persona y la otra suma en bloque, así que si una fila se queda fuera del listado (un centinela, un cierre huérfano) los dos números dejan de coincidir y ahí se ve. Otra comprueba que, **desde el corte, cada importe guardado sea el que dice BOLT**, y nombra tanto lo que se desvió como lo que BOLT tiene y no tiene cierre.

## El cron

Cada media hora, `app.js` llama a `recalcularReciente`, que rehace **solo las quincenas vivas**: la de ahora y la anterior. Rehacer el histórico entero treinta veces al día sería trabajo tirado, y lo cerrado no cambia.

## Lo que no se mudó, y por qué

**La pantalla `/administracion` ya no existe** (24/09/2026). Era el PIN de Ballenoil y los códigos de lavado, y los dos se quitaron: ya no se trabaja con Ballenoil. La ruta lleva ahora a `/administracion/tickets`. **La llave `/administracion` se queda**: por el prefijo, es la que cierra esos tickets —sin ella quedarían abiertos a cualquiera—, y en `/usuarios` se llama «Administración (tickets)». Con ella se fue `services/codigosBallenoil.js`; la tabla `ballenoil_codigo` se queda en la base por lo ya repartido.

Por eso este módulo es, hoy, solo recaudación.
