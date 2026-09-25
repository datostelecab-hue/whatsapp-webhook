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

## Los descuentos de nómina de septiembre 2026 (db/162)

El 25/09/2026 Camilo pasó el Excel **«Recaudación de efectivo nomina septiembre 2026»** con el encargo de dejar como responsable a **Ignacio Cafferata**. Se cargó como **67 movimientos de tipo `nomina`** (20.777,90 €), firmados por Ignacio (usuario 1, que tiene la llave `/recaudacion/nomina`), con fecha del día en que se apuntaron: la recaudación no acepta fechas futuras, y el día de la nómina lo es.

- **Solo la hoja «Cierre».** La otra se llama «Inicial (Desestimado)» y por su nombre no cuenta.
- **La columna «ID Bolt» trae el NOMBRE**, a veces con una nota pegada al final («ya no está», «SIN FICHA»). Se quitaron las notas y se cruzó contra el nombre de BOLT y el de la ficha, sin acentos y sin importar el orden: 66 casaron con una sola ficha. **Christian Munoz De La Guia no tiene ficha** y va por su cuenta de BOLT (`bolt_uuid`), como ya salía en el cuadro. La nota «ya no está» queda en la observación del movimiento.
- **52 importes eran exactamente la deuda del cuadro; en 14 el cuadro era mayor**: cobraron efectivo después del cierre del Excel. Esa diferencia —3.071,15 € entre los 14— les sigue quedando pendiente, que es lo correcto.
- La deuda total del cuadro pasó de 24.454,85 € a 3.676,95 €. La caja no se mueve: un descuento de nómina es *caja =, deuda −*.

Se cargó por migración para que entre una sola vez y quede el rastro. Si alguno está mal, **se anula desde la pantalla con su motivo**, no se borra.

> [!warning] La caja ya estaba en −540,05 € antes de cargarlo
> Es la comprobación que falla (*«El efectivo de la caja no es negativo»*), y no la
> causan los descuentos: las salidas de septiembre (apertura 26.394,27 €, banco
> 12.255 €, adelanto de nómina 1.360 €, gastos 700 €) suman 40.709,27 € y lo
> entrado en mano, 40.212,67 €.

### Por qué da negativo (averiguado el 25/09/2026)

No falta dinero: **la apertura resta 884,40 € que ya no están sumados**.

- El traspaso del Excel (09/09) trajo **dos entregas con fecha 15/09**, seis días en el futuro: **Redy Emmeli Pinza Rivadeneira, 500 €** (id 138) y **Enrique Sancristobal Edoko, 384,40 €** (id 99). La carga fue por SQL, así que no pasó por la regla de «no se apunta dinero con fecha futura».
- La apertura (id 146) se calculó con **todo** lo importado, esas dos incluidas: 26.394,27 € = 25.553,32 de entregas vivas hasta el 08/09 + 884,40 de estas dos − 43,45 de devoluciones. Cuadra al céntimo.
- El **15/09 Ignacio anuló las dos** (motivo «Ignacio»). Al anularlas dejan de sumar como entrada, pero la apertura las sigue restando: la caja se queda 884,40 € por debajo de lo real.
- Pista de por qué: los 384,40 € de Enrique salen **exactos** en los descuentos de nómina de septiembre (id 217). Lo del Excel no era efectivo en mano, era deuda para nómina.

Sin ese descuadre la caja estaría en **+344,35 €**, que es lo entrado desde el 09/09 (14.659,35 €) menos lo salido desde entonces (14.315 €). Encaja con la nota de la salida a Angie del 22/09: «me quedo con las monedas».

### El arreglo: db/163

Camilo dio el visto bueno el mismo 25/09. **`db/163-recaudacion-apertura-corregida.sql` anula la apertura 146** (firmado por Camilo, usuario 7, con el motivo escrito) **y apunta otra de 25.509,87 €** (26.394,27 − 884,40) con la misma fecha, 09/09. No se pisa el importe de la vieja: es dinero y tiene que quedar el rastro de las dos. Con ella la caja queda en **+344,35 €** y la comprobación vuelve a verde.

- **Solo actúa si todo está como se diagnosticó**: la 146 viva y con 26.394,27 €, y las entregas 99 y 138 anuladas. Si algo no cuadra (o en una base sin estos datos) no hace nada, y la comprobación lo seguirá diciendo.
- **La lección**: una carga por SQL se salta las reglas de la pantalla (aquí, la de no apuntar con fecha futura). Lo que se importe a mano tiene que pasar las mismas comprobaciones que el formulario, o dejar escrito por qué no.

## El cron

Cada media hora, `app.js` llama a `recalcularReciente`, que rehace **solo las quincenas vivas**: la de ahora y la anterior. Rehacer el histórico entero treinta veces al día sería trabajo tirado, y lo cerrado no cambia.

## Lo que no se mudó, y por qué

**La pantalla `/administracion` ya no existe** (24/09/2026). Era el PIN de Ballenoil y los códigos de lavado, y los dos se quitaron: ya no se trabaja con Ballenoil. La ruta lleva ahora a `/administracion/tickets`. **La llave `/administracion` se queda**: por el prefijo, es la que cierra esos tickets —sin ella quedarían abiertos a cualquiera—, y en `/usuarios` se llama «Administración (tickets)». Con ella se fue `services/codigosBallenoil.js`; la tabla `ballenoil_codigo` se queda en la base por lo ya repartido.

Por eso este módulo es, hoy, solo recaudación.
