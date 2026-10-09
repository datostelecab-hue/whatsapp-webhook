# Portal del conductor

Lo que ven los conductores, por SU dominio (`DOMINIO_CONDUCTORES`). Entran con
su teléfono y su DNI/NIE y ven su información básica. Primera parte (09/10/2026):
entrar y salir.

```
portal.controller.js   las rutas (/, /entrar, /salir) y `porDominio`, el reparto
                       que monta app.js antes que todo lo de la oficina
portal.service.js      LA PUERTA: el login, la sesión del conductor y sus reglas
portal.repo.js         su SQL (la ficha, el teléfono y conductor_acceso, db/189)
vistas/                las pantallas, pensadas para el móvil
```

Por ese dominio no hay nada más: lo que no sea de aquí da 404 y nunca pasa al
ERP. La sesión es otra cookie con otra clave: no vale en la oficina.

Más en docs/modulos/Portal del conductor.md. Prueba: `node scripts/comprobar-portal-conductor.js`.
