---
tags: [nucleo, ficheros, gestoria]
actualizado: 2026-11-25
---

# Ficheros importados

La puerta común para lo que se **sube de fuera** (25/11/2026, db/284, fase 0 del [[Plan RRHH y nominas]]): la gestoría y el INSS mandan ficheros (la plantilla en alta, las bajas médicas, la proforma, los borradores) y Diana los sube al ERP. Todos se cargan igual.

```
services/ficherosImportados.js        la puerta: registrar el tipo, huella, «ya se cargó», apuntar, guardar el original
services/repo/ficherosImportados.js   el SQL (tabla fichero_importado)
```

## Qué se guarda de cada carga

`fichero_importado`: el **tipo** (`legajos`, y los que vengan), el **periodo** si lo tiene, el **nombre**, la **huella** (sha256 de los bytes), los bytes, la **estructura** que se le detectó (hoja, fila de cabecera, columnas), el **resultado** (recuentos y la lista de incidencias), cuántas **incidencias** dejó, quién y cuándo. Bajo el [[Libro de auditoria]]. El **original** se guarda como adjunto (dueño `fichero_importado`, ver [[Adjuntos]]) y lo ve quien puede ver las cargas de ese tipo.

## El mismo fichero no entra dos veces

Un tipo y una huella, **una sola carga viva** (índice único parcial sobre `estado = 'cargado'`). Es el criterio del encargo («un fichero cargado dos veces no duplica»), y vale para todos los tipos sin que cada módulo lo vuelva a escribir. La previa ya avisa («se cargó el 25/11/2026 a las 10:12, por …»); confirmar, lanza. Si dos personas lo cargan a la vez, el índice para a la segunda.

## Cómo lo usa un módulo

```js
ficherosImportados.registrarTipo('legajos', { etiqueta: 'Legajos de la gestoría', ver: async quien => … });

const h = ficherosImportados.huella(buffer);
await ficherosImportados.exigirNuevo('legajos', h);           // lanza si ya se cargó
const id = await libro.conFirma(firma, async cli => {
  … escribe lo suyo …
  return ficherosImportados.apuntar(cli, { tipo, periodo, nombre, buffer, estructura, resultado, incidencias, usuarioId });
});
await ficherosImportados.guardarOriginal(id, { nombre, buffer, mime, usuarioId });   // fuera de la transacción
```

La carga se apunta **dentro de la transacción del módulo**: si lo demás falla, no queda apuntada. El original va después; si el almacén falla, la carga se queda y se dice en el log.

**El primero que la usa**: la carga de legajos de [[Conductores]].
