---
tags: [entorno, pruebas, docker, postgres, correo]
aliases: [Entorno local, Pruebas en local]
---

# Entorno de pruebas local

El ERP entero en el PC de desarrollo, contra una **copia de producción**, para ver un flujo completo antes de subirlo. Nació el 19/10/2026 con el portal de conductores, que cambia el diseño del sistema: Camilo, *«que sea este el entorno de pruebas antes de enviarlo directamente a producción»*.

Vive en `scripts/entorno-local/`, con su `LEEME.md`.

## Qué es

| Pieza | Dónde | Qué hace |
|---|---|---|
| `telecab-pg` | `127.0.0.1:5433` | PostgreSQL 18, la misma versión mayor que producción, con la copia |
| `telecab-correo` | `http://localhost:8025` | Mailpit, un buzón falso: **todo correo del entorno cae aquí** |
| El ERP | `http://erptelecab.localhost:3100` | `app.js` de siempre, arrancado por `arrancar.js` |
| El portal | `http://conductorestelecab.localhost:3100` | el mismo servidor, por la dirección de los conductores |

Los `*.localhost` los resuelve el navegador solo: no hay que tocar el fichero `hosts`. Dos direcciones distintas porque así será en producción (`erptelecab.es` y `conductorestelecab.es`, ver [[Historial de decisiones]]), y cada una lleva sus cookies.

## Cómo se usa

```
node scripts/entorno-local/refrescar.js      (con DATABASE_URL_PRODUCCION en el entorno)
node scripts/entorno-local/arrancar.js
```

**Refrescar** rehace la base local con una copia de producción que se saca en ese momento: unos 100 MB comprimidos y dos minutos. Lo que hubiera en local se pierde, y es la idea: partir siempre de lo que hay en producción. La dirección de producción va **solo** en la variable `DATABASE_URL_PRODUCCION`, nunca en un fichero.

**Arrancar** levanta los contenedores si no lo están y arranca el ERP. Desde el panel del navegador de Claude es la configuración `entorno-local` del `launch.json`.

Para entrar al ERP local valen los usuarios y contraseñas de producción, porque la copia los trae.

Para entrar al [[Portal de conductores]] sin escribir el DNI de nadie de verdad:

```
node scripts/entorno-local/conductor-de-prueba.js [id_de_ficha]
```

Le pone a un conductor de la copia un DNI y un email de prueba (están en el propio script). Sin id, elige a quien más semanas con nota tenga y turnos esta semana. El código llega al buzón falso. La próxima copia de producción lo deja todo como estaba.

## Por qué no puede tocar producción

Son cuatro candados, y cada uno basta por sí solo para lo suyo:

- **La base es la local, fijada en `arrancar.js`.** No se lee de ninguna variable de fuera. Además, la base tiene que llevar la marca que le pone `refrescar.js` (la tabla `entorno_local`): sin ella, no arranca.
- **`MODO_PRUEBAS=1`.** No arranca ningún cron. El cortafuegos frena todo envío de [[WhatsApp]] y toda escritura en Mapon y en las hojas. Ver `services/modoPruebas.js`.
- **El correo va al buzón falso, o siempre a la misma dirección.** Desde el 19/10/2026 el cortafuegos también cubre el correo: con `MODO_PRUEBAS=1`, `services/correo.js` lo manda a `CORREO_PRUEBAS`, y solo si es de este PC (`127.0.0.1` o `localhost`). Sin esa variable lo frena y lo apunta. Antes de esto, un servidor de ensayo con la configuración de producción podía mandar correos de verdad por DonDominio. Ver [[Correo]].

  Camilo quiso verlo en un buzón de verdad: *«que en entorno de pruebas siempre llegue a datostelecab@gmail.com»*. Si en `scripts/entorno-local/correo.env` hay un SMTP de verdad, **todo correo sale desviado a esa dirección y a ninguna otra**, sea para quien sea. El asunto lleva `[PRUEBAS]` y arriba se dice a quién habría ido. El fichero se copia de `correo.env.ejemplo`, lleva la contraseña del SMTP y **no se sube a GitHub** (está en `.gitignore`). Solo puede poner las claves del correo, nada de la base ni del modo pruebas. Al arrancar, el log dice adónde van los correos.
- **La copia no tiene con qué mandar correo.** `refrescar.js` apaga el «Correo para procesos» y borra su contraseña cifrada.

La copia **solo lee** de producción: `pg_dump` no escribe, y además va con la sesión en solo lectura.

## Lo que la copia no trae

- **Los datos de `fv_odometro`**, el odómetro de Mapon: es la mitad de la base y aquí no hace falta. La tabla se crea, pero vacía. Los kilómetros de Taller salen mal en local.
- **Nada de lo que pase después de copiarla.** Los crons están apagados, así que no entran BOLT ni Mapon. Para ver lo de hoy, se refresca.

> [!warning] La copia tiene datos personales de verdad
> DNI, email y teléfono de los conductores. Se quedan en el volumen de Docker de este PC (`telecab-pruebas_pg`); el fichero intermedio de la copia se borra al acabar. Lo eligió Camilo el 19/10/2026: con los correos encerrados en el buzón falso, se puede entrar al portal con el DNI de cualquiera y ver el código en Mailpit.

## No confundir con el laboratorio de seguridad

El laboratorio de [[Seguridad]] (`Documents\lab-erp`) es otra cosa: **datos sintéticos** y claves ficticias, aislado en la red host-only para atacarlo con Kali. Este entorno es para **ver funcionar** el ERP con los datos de verdad, nunca para atacarlo.
