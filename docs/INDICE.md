---
tags: [indice, mapa]
actualizado: 2026-09-17
---

# INDICE

El mapa del proyecto. Cada nota cuenta una pieza y enlaza con las de al lado; si te pierdes, vuelve aquí.

> [!tip] Cómo está montado esto
> El **vault es el propio repositorio**, así que las notas están al lado del código que describen y se versionan con él. Viven en `docs/`. La configuración de Obsidian (`.obsidian/`) no se versiona: es de cada ordenador.
>
> Para moverse: `Ctrl+O` busca una nota por nombre, `Ctrl+Shift+F` busca dentro de todas, y la **vista de grafo** enseña cómo se enlazan. Las notas tienen etiquetas (`#modulo`, `#nucleo`, `#integracion`, `#decision`) para filtrar.

## Empezar por aquí

- **[[Telecab]]** — El negocio y la forma en que se trabaja. Sin esto, la mitad de las decisiones del sistema no se entienden.
- **[[Arquitectura]]** — Cómo está organizado el código, qué puede llamar a qué, y cómo se mueve una
- **[[Estado y pendientes]]** — Lo que está abierto hoy. Esta nota se actualiza; si algo de aquí ya está hecho, se borra de aquí y se cuenta donde toque.

## Referencia de las APIs

Dos documentos anteriores al vault, que siguen siendo la referencia buena y los cita el código:

- **[[API_MAPON]]** — el mapa de la API de Mapon endpoint a endpoint, con lo que sirve y lo que no.
- **[[PLANTILLAS-WHATSAPP]]** — los textos exactos de las plantillas aprobadas por Meta.

## El núcleo — cómo funciona por dentro

- **[[Base de datos]]** — Todo el ERP vive en PostgreSQL (15 o superior).
- **[[Flota viva]]** — El motor que cada cinco minutos pregunta a BOLT quién va en cada coche y en qué estado, y a Mapon dónde está ese coche y cuánto ha rodado.
- **[[Ingesta]]** — La única puerta por la que entran datos externos.
- **[[Jornada y turnos]]** — El día operativo no es el día natural: va de las 05:00 a las 05:00 del día siguiente.
- **[[Migraciones]]** — El esquema de la Base de datos no se toca a mano: se cambia añadiendo un fichero a db/.

## Los módulos — lo que se ve y se usa

- **[[Administracion]]** — Hoy este módulo es, en la práctica, recaudación: el dinero que el conductor debe a la casa.
- **[[Auditoria de flota]]** — Compara los kilómetros que hizo el coche con lo que ese coche facturó en BOLT, y reparte cada metro según en qué estado estaba el conductor cuando lo recorrió.
- **[[Bitacora]]** — El calendario de la plantilla: qué hizo cada persona cada día —cuántas horas, si libró, si estaba de vacaciones o de baja, si hay una J puesta—.
- **[[Calificacion de conductores]]** — Una letra por conductor y periodo. Es lo que Tráfico ve al lado del nombre —*"Juan Manuel Akieme (9,4 h · A)"*— en el planificador, en el cockpit, en las campañas y en el reporte de…
- **[[Conductores]]** — Quién trabaja aquí y en qué condiciones: la ficha de la persona, su contrato, sus papeles y su cuenta de BOLT.
- **[[Control Alertas]] · [[Control Coches sin cuadrante]]** — /alertas es la vigilancia de las franjas críticas: cuando un conductor se pasa de la raya, un WhatsApp a los controladores elegidos.
- **[[Mapa de flota]]** — PILOTO: dónde está cada coche y si hay alguien dando servicio, en la misma pantalla. Lo que se busca es el rojo: rueda y nadie conectado.
- **[[Control En directo]]** — El cockpit de tráfico: el plan del cuadrante fundido con lo que rueda ahora mismo, para contestar una sola pregunta — a quién hay que llamar.
- **[[Control Reportes]]** — /control/reportes es solo descargables: cada tarjeta baja un Excel o un PDF y nada se mira en pantalla.
- **[[Control]]** — Control es el puesto de tráfico del ERP: quién tenía que salir, quién salió, a quién se llamó y qué contestó.
- **[[Documentos]]** — El archivo documental de la empresa. Sustituye a tener los papeles en el ordenador de alguien: el índice vive en PostgreSQL y los bytes en Drive. Está en modules/Documentos/.
- **[[Fichaje]]** — Bajo el mismo nombre hay dos cosas distintas, y conviene no mezclarlas:
- **[[Nominas]]** — La compensación variable del mes: lo que se suma al recibo por encima del sueldo base — nocturnas, propinas, peajes y el MBO (por horas extra o por facturación).
- **[[Operaciones]]** — Qué hace la flota cuando nadie mira: los avisos del coche, los kilómetros que no cuadran, quién corre de más y el calendario de lo que de verdad pasó cada día.
- **[[Planificacion]]** — Quién conduce qué coche, qué día y en qué turno.
- **[[RRHH]]** — Lo que el convenio VTC obliga a llevar: la jornada de cada trabajador contra su objetivo, el cierre del periodo, la nómina que se manda a la gestoría y el cuadro de absentismo.
- **[[Sanciones de velocidad]]** — Del exceso que detecta Mapon al aviso de WhatsApp al conductor, y de ahí a un registro que queda.
- **[[Seleccion]]** — Cómo entra alguien a trabajar en Telecab: se abre el hueco, se busca a quien lo llene y se le lleva hasta el alta.
- **[[Ticketera]]** — Lo que pide la gente y qué se hace con ello.
- **[[Usuarios y permisos]]** — Las cuentas del ERP: alta, roles, permisos, contraseñas y entrada al sistema.
- **[[Vehiculos]]** — El maestro de coches —alta, ficha, estados, zonas, plazas y el enlace con Mapon—, el mantenimiento por kilómetros y las facturas de taller.
- **[[Inspeccion de vehiculos]]** — Primer submódulo de taller: la última inspección de cada coche (16 elementos, ITV, pegatinas VTC, resultado), su historial y el importador del Excel del taller.

## Las integraciones — lo que viene de fuera

- **[[BOLT]]** — BOLT es el operador con el que trabaja la flota, y su API —el *Fleet Integration Gateway*— es la que dice quién conduce, en qué estado está y cuánto ha facturado.
- **[[Correo]]** — El correo es el canal con la oficina y con fuera, lo contrario de WhatsApp, que es el canal con los conductores.
- **[[Google Drive y Sheets]]** — Google fue el sitio donde vivía el ERP entero: los datos en hojas de cálculo y los papeles en Drive.
- **[[Mapon]]** — Mapon es el GPS de la flota: ~144 turismos con equipo instalado.
- **[[WhatsApp]]** — WhatsApp es el canal con los conductores. No usan la app de Mapon ni entran al ERP: lo que se les dice y lo que piden pasa por aquí. Son dos cosas distintas montadas sobre el mismo número:

## Las decisiones — por qué es así y no de otra forma

- **[[Corte de tramos]]** — Hasta dónde cuentan los kilómetros de un tramo de BOLT.
- **[[Historial de decisiones]]** — Las decisiones que explican por qué el sistema es como es.
- **[[Km por odometro CAN]]** — Desde el 17/09/2026 los kilómetros del sistema salen del odómetro del propio coche —el número del cuadro, leído del bus CAN— y no de la estimación que hace el GPS uniendo puntos.

## Cómo se trabaja aquí

- **[[Comprobadores]]** — En este proyecto no hay pruebas automáticas, ni linter, ni npm scripts.
- **[[Glosario]]** — El vocabulario de la casa. Son palabras que en este ERP significan una cosa
- **[[Reglas de la casa]] · [[Componentes de la casa]]** — Lo que se respeta sí o sí en este repositorio.
- **[[Trampas conocidas]]** — Lo que ya costó tiempo, con su cifra y su remedio.
- **[[Seguridad]]** — Cómo se prueba la seguridad (laboratorio Kali aislado) y el endurecimiento que lleva puesto.

---

## Cómo se mantiene

- Cuando una decisión explique **por qué** algo es como es, se escribe su nota en `docs/decisiones/` y se enlaza desde [[Historial de decisiones]].
- Lo que está a medias no va aquí: va a [[Estado y pendientes]], que se **actualiza**, no se acumula.
- Los nombres de fichero llevan espacios, no guiones, para que los enlaces entre notas resuelvan solos.
- Si una nota y el código se contradicen, manda el código — y se corrige la nota en el mismo rato.
