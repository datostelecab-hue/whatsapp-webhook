---
tags: [modulo, rrhh, gestoria]
ruta: /gestoria
codigo: modules/Gestoria/
---

# Plantilla de la gestoría

**Módulo 8** del [[Plan RRHH y nominas]] (25/11/2026, db/287). Camilo: *«Sí, arranca el módulo 8 con la proforma»*. El problema que ataca: aparecen en la nómina conductores ya finiquitados, hay bajas que la gestoría nunca tramitó (y se sigue cotizando) y altas que nunca llegaron.

```
modules/Gestoria/listado.js            leer el listado (.xls o .xlsx) y cruzarlo: puro
modules/Gestoria/gestoria.service.js   LA PUERTA: subir, la lista, resolver, poner el legajo, el correo, la tarjeta del lunes
modules/Gestoria/gestoria.repo.js      el SQL (gestoria_discrepancia)
modules/Gestoria/gestoria.controller.js  /gestoria
public/assets/js/vistas/Gestoria/gestoria.js
services/xls.js                        el lector de .xls, sin librerías
test/gestoria.test.js · test/apoyo/ficheros/*.xls (muestras de mentira, hechas con Excel)
```

## El fichero de la gestoría, y por qué hay un lector propio

Lo que manda la gestoría sale de **A3NOM** en **`.xls`** (Excel 97-2003, binario), y además **cifrado**: Excel cifra con su contraseña por defecto («VelvetSweatshop») los libros con la estructura o la escritura protegidas, y por eso lo abre sin preguntar. ExcelJS solo lee `.xlsx`. En vez de añadir una dependencia, `services/xls.js` lee el formato: el contenedor, los dos cifrados de Excel (el RC4 de Office 97 con MD5 y el RC4 CryptoAPI con SHA-1, que es el de la proforma) y las celdas (textos compartidos, números, fórmulas). Con la proforma de noviembre cuadra al céntimo con Excel (166 trabajadores y las sumas de cada concepto). Un fichero con **contraseña de apertura de verdad** no se puede leer, y se dice. Solo lee: escribir el `.xls` es del módulo 4. La estructura de la proforma está en [[Plan RRHH y nominas#La proforma real de A3NOM (noviembre de 2026)]].

El listado se reconoce por su cabecera: una columna «Código» (o «Legajo», «Nº empleado») y otra «Nombre» (o «Trabajador»), en las 20 primeras filas de cualquier hoja. Arriba, la empresa («EMPRESA:») y la fecha («FECHA:», «23 de Noviembre de 2026»). Si la cabecera trae columnas de conceptos («066 - PACTO PR (I)»), es una **proforma**; si no, un **listado** de plantilla. El código es el legajo sin ceros.

## El cruce: por legajo, nunca por el nombre

Contra la **plantilla propia** (la ETT no está en la gestoría) y sin la ficha de pruebas. Las diferencias:

| Tipo | Qué es | Va en el correo |
| --- | --- | --- |
| **En la gestoría y de baja con nosotros** | sale en su listado y se fue antes de la fecha de corte; con los días desde su baja y, si hay coste en Parámetros, lo estimado | Sí: «tramitad la baja» |
| **De alta con nosotros y no en la gestoría** | plantilla propia de alta desde antes de la fecha del listado, con legajo, que no sale | Sí: «¿se tramitó el alta?», con su DNI |
| **Legajo cambiado** | un legajo que el ERP no tiene cuyo nombre casa con una sola persona de alta cuyo legajo no sale: la misma persona con otro legajo (pasa al volver a contratar) | No |
| **Legajo que no está en el ERP** | con la ficha a la que se parece, si es una: de alta, **de ETT** o **de baja** | Sí, si para nosotros es de ETT o está de baja |
| **El legajo es de otra persona** | el legajo es de alguien del ERP que no se llama así | No |
| **Sin legajo** | de alta con nosotros y sin legajo: no se puede cruzar | No |

- **La fecha de corte**: en un listado, su fecha; en una **proforma**, el primer día de su mes. Quien se va a mitad de mes sale en la nómina de ese mes y no es una diferencia. La proforma no trae fechas de alta y baja, así que **«fechas que no coinciden» no se puede mirar con ella**: llegará con el listado de plantilla en alta (o el ITA).
- El nombre solo sirve para avisar y proponer. Dos palabras largas en común cuentan como el mismo nombre.

## Cómo viven las diferencias

- **Una viva por diferencia** (`clave` = tipo + ficha + legajo, índice único sobre las pendientes). La misma diferencia en el listado siguiente **sigue** (se apunta en qué listado salió la última vez); la que **ya no sale**, se **resuelve sola** («Ya no sale en el listado de la gestoría del 30/11/2026»).
- **Resuelta** (con nota opcional) o **descartada** (con motivo obligatorio). **Una descartada no vuelve a salir**: alguien decidió que no es un problema. Una resuelta sí, si vuelve a pasar.
- **Poner el legajo de la gestoría**: en un legajo cambiado, o en uno desconocido con su ficha propuesta. Por el mismo camino que la ficha (normalizado, y si es de otra persona dice de quién), y la diferencia queda resuelta con lo que se hizo.
- **El correo a la gestoría**: el texto con lo que tienen que corregir ellos, listo para copiar o abrir en el correo (el destinatario es el parámetro «Correo de la gestoría»). «Ya lo he mandado» apunta la fecha en cada diferencia (columna «A la gestoría»).
- Todo al [[Libro de auditoria]]; el fichero, en [[Ficheros importados]] (el mismo no se sube dos veces), con el original descargable.

## La tarjeta de los lunes

Cada lunes a las 08:00 (`gestoria.tarjeta_lunes`, `cuando.semanal`) nace en el [[Tablero de tareas]] «Pedir a la gestoría el listado de plantilla en alta y subirlo (semana del …)», **a quien tenga la función «Sube el listado de plantilla de la gestoría»** de [[Organizacion]] (db/287 se la pone al puesto «Administración de personal y nómina», el de Diana), con **vencimiento ese mismo día**. **Se cierra sola al subir un listado.** Si vence, avisa como todas, también a quien tiene la llave de las vencidas (Ignacio). La primera, el lunes 30/11/2026.

## Llaves, parámetros y número del menú

- `/gestoria` (mirar) y `/gestoria/gestionar` (subir, resolver, el correo; marcada `escribir`). db/287: las dos a Diana, mirar a Ignacio.
- Parámetros: **«Coste diario estimado de Seguridad Social por trabajador»** (`gestoria.coste_ss_dia`, a 0 no se calcula) y **«Correo de la gestoría»** (`gestoria.correo`). Ninguno inventado: los pone quien lleve RR. HH.
- RRHH → **Gestoría** en el menú, con las diferencias pendientes (en ámbar si hay de las que van a la gestoría).

## La primera carga (la proforma de noviembre, comprobado el 25/11 en solo lectura)

27 diferencias: **3 personas en la nómina de la gestoría que se fueron hace semanas** (una el 15/10 y dos el 04/09: 39 y 80 días), **5 legajos cambiados**, **15 legajos que el ERP no tiene** (13 con su ficha propuesta: 6 de ellos son de ETT para nosotros —uno sale dos veces, con dos legajos— y 3 están de baja), **2 de alta con nosotros que no salen** y **2 sin legajo**.

## Lo que falta del módulo 8

- El **listado de plantilla en alta** (o el ITA) real, para las **fechas que no coinciden**.
- **Altas**: alta solicitada y confirmada por la gestoría, el **bloqueo en el planificador** y la **alerta de no presentación** con su contador. Necesitan decidir cómo confirma la gestoría un alta (y la firma de la fecha de incorporación, del módulo 6).

Relacionado: [[Plan RRHH y nominas]] · [[Conductores]] · [[Ficheros importados]]
