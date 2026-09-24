# Plantillas de WhatsApp (Meta)

Todo lo que sale por WhatsApp a alguien que no nos ha escrito en las últimas 24 h
tiene que ir en una **plantilla aprobada por Meta**. Aquí están las nuestras: las
que ya funcionan y las que hay que mandar a revisión.

Para crearlas sin teclearlas a mano:

```bash
node scripts/crear-plantillas-whatsapp.js --ver
```

`--ver` enseña lo que se va a mandar y compara con lo que ya existe en la cuenta.
`--go` las envía de verdad a revisión. Necesita `WHATSAPP_TOKEN` en el entorno.

---

## Las que ya están aprobadas

| Nombre | Variables | Quién la usa |
|---|---|---|
| `atencion_hora` | `nombre` (con nombre, no posicional) | Aviso de horas |
| `ballenoil` | `nombre` (con nombre) | **Ya no se usa** (24/09/2026): era la bienvenida con el PIN de Ballenoil |
| `detalle_turnos` | 1 posicional (nombre) | Aviso de turnos, con botón "Ver mis turnos" |
| `advertencia_limite` | 2 posicionales (nombre, matrícula) | Sanciones por exceso de velocidad |

## Las que faltan — ALERTAS DE CONTROL

Sin estas, el módulo `/alertas` detecta pero no avisa: a día de hoy hay **338
alertas en estado `sin_destinatarios`** desde el 11/09.

**Van a NUESTROS CONTROLADORES, no a los conductores.** Son usuarios del ERP que
alguien marca a mano en `/alertas/config`. Eso importa para dos cosas: el tono
(es una orden de trabajo, no un aviso al conductor) y la categoría en Meta.

### Las cuatro variables, iguales en las cuatro plantillas

El código (`services/repo/alertasControl.js`, función `mandar`) construye
siempre el mismo array de 4 valores posicionales, en este orden:

| | Qué es | Ejemplo |
|---|---|---|
| `{{1}}` | Nombre del conductor en BOLT | `Juan Antonio Vázquez Uscanga` |
| `{{2}}` | Su teléfono | `+34 600 11 22 33` |
| `{{3}}` | Horas efectivas de SU jornada (05:00 → ahora) | `7 h 42 min` |
| `{{4}}` | El hecho concreto | depende de la plantilla |

Mantener el mismo orden en las cuatro es deliberado: así cambiar de una plantilla
genérica a una por tipo no toca cómo se arman los parámetros.

---

### 1. `alerta_control` — LA IMPRESCINDIBLE

Es la que el código usa **hoy mismo, sin tocar nada**. Vale para los tres tipos
de alerta porque el hecho concreto viaja en `{{4}}`. Si solo se aprueba una, que
sea esta.

- **Categoría:** UTILITY
- **Idioma:** Español (`es`)
- **Encabezado (TEXTO):** `Aviso de control`
- **Cuerpo:**

```
Hay que llamar a un conductor.

Conductor: {{1}}
Teléfono: {{2}}
Jornada acumulada: {{3}}

Motivo: {{4}}

Llámale y deja anotado en el panel qué te ha dicho.
```

- **Pie:** `Telecab · Alertas de control`
- **Ejemplos que pide Meta:**
  1. `Juan Antonio Vázquez Uscanga`
  2. `+34 600 11 22 33`
  3. `7 h 42 min`
  4. `3 viajes RECHAZADOS por él hoy (no se puede rechazar ningún viaje)`

---

### 2. `alerta_rechazo_directo`

El conductor rechaza viajes con el dedo. Umbral **1**: al primero se llama.

- **Categoría:** UTILITY · **Idioma:** `es`
- **Encabezado:** `Viajes rechazados`
- **Cuerpo:**

```
Un conductor está rechazando viajes. No se puede rechazar ninguno, así que toca llamarle.

Conductor: {{1}}
Teléfono: {{2}}
Jornada acumulada: {{3}}
Rechazados hoy: {{4}}

Si tenía un motivo, déjalo anotado en el panel de alertas.
```

- **Pie:** `Telecab · Alertas de control`
- **Ejemplos:** `Juan Antonio Vázquez Uscanga` · `+34 600 11 22 33` · `7 h 42 min` · `3 viajes`

---

### 3. `alerta_sin_respuesta`

Deja pasar ofertas sin contestar. Umbral **5**. Ojo al tono: **no responder no es
rechazar** — puede ser cobertura o el móvil colgado, así que se pregunta antes de
acusar.

- **Categoría:** UTILITY · **Idioma:** `es`
- **Encabezado:** `Viajes sin responder`
- **Cuerpo:**

```
Un conductor está dejando pasar ofertas sin contestar. Puede ser cobertura o el móvil, así que pregúntale primero si necesita algo.

Conductor: {{1}}
Teléfono: {{2}}
Jornada acumulada: {{3}}
Perdidos sin responder: {{4}}

Deja anotado en el panel qué te ha dicho.
```

- **Pie:** `Telecab · Alertas de control`
- **Ejemplos:** `Marian Nicolae Dan Voivozeanu` · `+34 600 11 22 33` · `5 h 10 min` · `7 viajes`

---

### 4. `alerta_km_parado`

El coche hace kilómetros estando en descanso o con la aplicación desconectada.
Umbral **20 km**.

- **Categoría:** UTILITY · **Idioma:** `es`
- **Encabezado:** `Coche rodando en descanso`
- **Cuerpo:**

```
Un coche está haciendo kilómetros estando en descanso o con la aplicación desconectada.

Conductor: {{1}}
Teléfono: {{2}}
Jornada acumulada: {{3}}
Kilómetros: {{4}}

Llámale para saber quién lo lleva y anótalo en el panel.
```

- **Pie:** `Telecab · Alertas de control`
- **Ejemplos:** `Dylan Hernández García` · `+34 600 11 22 33` · `9 h 05 min` · `24,6 km (franja 20:00-01:00)`

---

## Las reglas de Meta que respetan estos textos

Las plantillas se rechazan casi siempre por lo mismo, y es todo evitable:

- El cuerpo **no empieza ni termina con una variable**. Meta lo rechaza sin más.
- **No hay dos variables pegadas** (`{{1}} {{2}}`): entre cada par hay texto fijo.
- Las variables van **numeradas y seguidas** desde `{{1}}`.
- **Todas llevan ejemplo.** Sin ejemplo no se puede ni enviar el formulario.
- El pie no admite variables y se queda **por debajo de 60 caracteres**.
- Nada de lenguaje promocional, ni emojis de reclamo: eso es lo que empuja a Meta
  a recategorizar una UTILITY como MARKETING.

**Lo que puede pasar aunque esté todo bien:** Meta decide la categoría por su
cuenta y puede mover estas plantillas a MARKETING, que se cobra distinto y está
sujeta a los límites de marketing. Son avisos internos a empleados, que no encaja
del todo en la definición de UTILITY ("una transacción, cuenta o pedido
concretos"). Si las recategoriza, se puede pedir revisión desde el propio
WhatsApp Manager.

## Aprobar la plantilla NO enciende las alertas

Faltan tres cosas más, y son independientes:

1. **La plantilla aprobada** (esto).
2. **Elegir quién las recibe** en `/alertas/config`. Hoy no hay nadie: por eso
   las 338 alertas están en `sin_destinatarios`. Ese permiso nace apagado y lo
   reparte el desarrollador a mano.
3. **Pasar el modo a `live`** en esa misma pantalla. Ahora está en `test`, que
   registra la alerta y no manda nada (estado `simulada`).

## Si el nombre en Meta acaba siendo otro

No hace falta tocar código:

- `PLANTILLA_ALERTA_CONTROL` cambia la genérica.
- `PLANTILLA_ALERTA_RECHAZO_DIRECTO`, `PLANTILLA_ALERTA_SIN_RESPUESTA` y
  `PLANTILLA_ALERTA_KM_PARADO` cambian las de cada tipo.

Si una de las de tipo no está puesta o no está aprobada, se usa la genérica.
