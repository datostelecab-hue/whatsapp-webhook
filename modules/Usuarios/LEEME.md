# Usuarios

Las cuentas del ERP: alta, roles, permisos, contraseñas y entrada al sistema.

```
auth.controller.js        login, logout, cambiar y recuperar contraseña
usuarios.controller.js    la pantalla /usuarios y su API
usuarios.service.js       las cuentas: leer, crear, cambiar, contraseñas
vistas/                   login, usuarios, cambiar-password, olvide-password
```

## Lo que NO vive aquí, y es una decisión

`services/sesion.js`, `services/permisos.js` y `services/limiteIntentos.js` se
quedan fuera. Conceptualmente son de Usuarios, pero son **middleware que usa la
aplicación entera**: meterlos dentro haría que todos los demás módulos
dependieran de este. Son transversales —quién eres y qué puedes—, la misma
categoría que ya reconoce `scripts/comprobar-capas.js`.

`layout-auth.ejs` y `sin-permiso.ejs` tampoco: son layouts, y `sin-permiso` lo
renderiza `sesion.js`.

## Quién tiene que fichar

La empresa quiere que los empleados fichen por el ERP, pero no todos: la
directiva y la gerencia no fichan.

Se elige **persona a persona** (casilla en la ficha de cada usuario), no por rol.
Por rol parece más limpio y es peor: en cuanto haya un jefe de tráfico que sí
ficha y otro que no, la regla se rompe y hay que inventar excepciones.

Y **nace apagado para todos**: se elige a quién SÍ. Si se olvida marcar a
alguien, el fallo es que no fiche —se arregla marcándolo—, no que le empiece a
contar una jornada que nadie pidió.

- Columna: `usuario.ficha_obligatorio` (db/105)
- API: `POST /usuarios/fichaje` con `{id, debe}`
- Consulta: `usuarios.losQueFichan()`

## "Mantener sesión iniciada"

Marcándola, la sesión dura **30 días** en vez de 12 h.

**Esto solo es seguro porque se puede cortar desde el servidor.** La sesión es
una cookie firmada con HMAC que el servidor NO consulta contra la base: el rol y
el estado viajan dentro del token. Con 12 h eso se aguantaba —bloquear a alguien
le dejaba dentro medio día como mucho—; con 30 días, **bloquear a alguien no
haría nada durante un mes**, porque su firma seguiría siendo válida.

La solución no es guardar sesiones en una tabla, es guardar **la fecha del
corte**: `usuario.sesiones_desde`. Toda cookie emitida antes de esa marca deja de
valer. Una columna en vez de un almacén de sesiones.

Qué pone el corte:

| Acción | Efecto |
|---|---|
| Bloquear al usuario | se le echa de todos sus dispositivos, en el acto |
| Resetear su contraseña | igual |
| Que él cambie su contraseña | cierra sus otras sesiones y conserva la de aquí |
| "Cerrar sesiones" en su ficha | le echa sin bloquearle la cuenta |

Tres detalles que son a propósito:

- **Solo se comprueban las sesiones largas.** Las de 12 h no pagan una consulta
  por petición: su peor caso es medio día. La cookie lleva `larga` para saberlo.
- **El corte se cachea 30 s.** No es instantáneo al segundo, pero sí en menos de
  un minuto — de sobra para echar a alguien, y evita una consulta por cada imagen
  que pida el navegador.
- **Si la base no contesta, no se echa a nadie.** Un fallo de red dejaría la
  aplicación entera sin acceso. Se anota el error y se sigue.

El aviso al usuario aparece **solo al marcar la casilla**: puesto siempre, se lee
una vez y deja de verse; la decisión se toma justo en ese momento.

## Lo que falta

`usuarios.service.js` lleva dentro 9 consultas SQL: es servicio y repositorio a
la vez. Hay que sacar el SQL a `usuarios.repo.js`. No se hizo al mudarlo porque
la mudanza tenía que ser mecánica y revisable de un vistazo.
