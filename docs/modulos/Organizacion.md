---
tags: [modulo, organizacion, permisos, hoja-de-ruta]
actualizado: 2026-11-13
---

# Organización

`/organizacion` (13/11/2026, db/248): el **área**, el **superior** y las **funciones** de cada persona de la oficina. Es la pieza A5 de la [[Hoja de ruta]]. Lo necesitan muchos ítems:
- «la aprueba un supervisor (Ángel, William o Ignacio)» (ítems 1 y 5);
- «una tarea para Daiane» (ítems 8, 10, 12, 14 y 15);
- «avisa al responsable y a su superior» y «cada responsable de área ve el suyo» (ítem 1);
- «solo lo ven Laura, Ignacio y Fernando» (ítem 4, convención 6).

Con esto, ningún ítem escribe un nombre ni un id en el código: pregunta quién tiene la función.

## Función no es llave

| | La **llave** ([[Usuarios y permisos]]) | La **función** (aquí) |
|---|---|---|
| Qué dice | Qué pantalla abre alguien | Qué le toca hacer: a quién le llega una tarea, quién aprueba |
| De dónde sale | Las de su rol, con las excepciones de cada persona | Solo de las que tenga dadas |
| Superadmin y desarrollador | Abren todo | **No tienen ninguna por su rol**, como la llave de aprobar vacaciones |
| Dónde se cambia | `/usuarios` | `/organizacion` |

La ficha de cada persona enseña también **las llaves que se salen de las de su rol**: las que tiene de más y las que le faltan. Es la «matriz por rol con excepciones por persona» que pide la convención 6. Se cambian en `/usuarios`.

## Cómo se usa desde un ítem

```js
const organizacion = require('../../services/organizacion');

await organizacion.quienes('multas');               // [{ id: 9, nombre: 'Daiane Alves', suplente: false }]
await organizacion.exigir(usuarioId, 'expedientes_ver');  // lanza «"Ve los expedientes laborales" es de …»
await organizacion.superiorDe(usuarioId);           // { id, nombre, porque } o null
await organizacion.equipo(usuarioId);               // a quién ve en el «Tablero del equipo»
```

- **`quienes`** da primero los titulares y después los suplentes. Nunca da un usuario bloqueado ni una función quitada.
- **`exigir`** es la puerta de los datos sensibles. Se comprueba en el servicio, también para el superadmin y el desarrollador. Si nadie tiene la función, lo dice: «Nadie tiene la función …: hay que dársela a alguien en Organización».
- **El superior** es el que se le ponga a mano. Si no tiene, es el responsable de su área, salvo que sea ella misma. Un superior bloqueado no cuenta.
- **El equipo** de alguien:
  - la gente de su área, si es la responsable;
  - quien la tenga puesta como superior;
  - toda la oficina, si tiene «Ve el tablero de todos».

## Las reglas

- **El catálogo de funciones está en el código** (`FUNCIONES` en `services/organizacion.js`): 22 funciones. Cada una lleva el ítem de la hoja de ruta que la usa y si la pueden tener varias personas a la vez. En la base solo está quién tiene cada una (`usuario_funcion`). Una función nueva se añade al catálogo con el ítem que la necesita.
- **De una sola persona:** «Lleva los expedientes laborales» y «Lleva la nómina». Para dársela a otra, primero se le quita a quien la tiene, o se le da a la otra como suplente.
- **Cada persona está en una sola área y solo puede ser responsable de esa.** Si se cambia de área, o se le quita la marca de responsable, deja de serlo de la que llevaba. Si el área ya tenía responsable, pasa a ser la nueva persona.
- **Nadie es su propio superior**, y no se puede cerrar un círculo (A depende de B y B de A).
- **Quitar una función es anularla con motivo:** la fila se queda.
- **Todo pasa por el [[Libro de auditoria]]**, con quién y por qué:
  - dar y quitar funciones;
  - cambiar áreas y responsables;
  - cambiar el rol, el área o el superior de un usuario.

  Del usuario no se apuntan la contraseña ni sus tokens, ni lo que cambia solo o a gusto de cada uno: el último acceso, el tema y las ayudas.

## Lo que trae db/248

- **Las áreas:** Dirección, RR. HH., Administración, Planificación, Control, Taller y Sistemas. **Sin responsables**: los decide Ignacio.
- **Áreas y superiores de cada persona:** vacíos. También los decide Ignacio, en la pantalla.
- **Las funciones que el PDF de la hoja de ruta reparte con nombre.** Cada una se busca por id **y** por nombre: si el usuario de ese id no se llama así, no se le da. Por ejemplo:
  - supervisores: Ignacio, William y Ángel;
  - expedientes: Laura; los ven Laura, Ignacio y Fernando;
  - nómina: Diana;
  - multas, documentación de los coches y reintegros: Daiane;
  - caja: Daiane e Ignacio, y Fernando de suplente;
  - taller: Óscar.
- **Angie (Formentera)** no tiene usuario. Las funciones que el PDF le da a ella también («Recibe las multas que no se pueden identificar», «Testigo del arqueo») quedan solo en los demás hasta que lo tenga.

## Quién entra

Los mismos que en [[Usuarios y permisos]]: el desarrollador por su rol, o quien tenga la llave `/usuarios` (Ignacio, db/168). Entrar no da ninguna función.

## Ficheros

```
db/248-organizacion.sql                     cat_area, usuario.area_codigo/superior_id, usuario_funcion
services/organizacion.js                    el catálogo y las reglas (lo usa todo el ERP)
services/repo/organizacion.js               el SQL
modules/Organizacion/                       la pantalla /organizacion y su API
public/assets/js/vistas/Organizacion/       la pantalla (Listado)
test/organizacion.test.js                   las reglas, con la base sintética
```

## Pendiente

- Que Ignacio ponga las áreas, los responsables y los superiores.
- Los usuarios que faltan (Angie) y repasar con él el reparto de funciones.
- El «Tablero del equipo» (ítem 1) es el primero que usará `equipo()` y `superiorDe()`.
