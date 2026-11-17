# Entorno de pruebas local

El ERP en este PC, contra una copia de producción, con los correos encerrados en
un buzón falso. La explicación entera está en el vault:
`docs/como-se-trabaja/Entorno de pruebas local.md`.

```
# 1. Copia de producción (solo lee de producción; unos 2 minutos)
DATABASE_URL_PRODUCCION='postgresql://…render.com/telecab' node scripts/entorno-local/refrescar.js

# 2. Arrancar
node scripts/entorno-local/arrancar.js
```

| | |
|---|---|
| ERP | http://erptelecab.localhost:3100 |
| Portal de conductores | http://conductorestelecab.localhost:3100 |
| Buzón de pruebas (Mailpit) | http://localhost:8025 |
| S3 de mentira (los adjuntos, hace de Cloudflare R2) | http://127.0.0.1:9090 — lo adjuntado se pierde al parar el contenedor, y las filas siguen en la base |
| Base local | `postgresql://telecab:pruebas@127.0.0.1:5433/telecab` |

Para entrar al portal sin el DNI de nadie de verdad, `node scripts/entorno-local/conductor-de-prueba.js [id_de_ficha]`
le pone a un conductor de la copia un DNI y un email de prueba (los dice al acabar).

Para que los correos lleguen de verdad, pero SIEMPRE a datostelecab@gmail.com, copia
`correo.env.ejemplo` como `correo.env`, pon el SMTP y vuelve a arrancar. No se sube a GitHub.

Hace falta Docker Desktop abierto. Para pararlo todo:

```
docker compose -f scripts/entorno-local/docker-compose.yml stop
```
