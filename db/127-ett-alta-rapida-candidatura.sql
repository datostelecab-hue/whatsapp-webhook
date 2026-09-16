-- ============================================================
-- 127 - LOS DEL ALTA RÁPIDA, VISIBLES PARA LA AGENCIA
-- ============================================================
-- El alta rápida de la ETT crea la ficha y abre el contrato sin pasar por
-- selección: dos campos y a trabajar. Lo que nadie vio venir es que la pantalla
-- de la ETT y el Excel que se le manda a la agencia leen CANDIDATURAS.
--
-- Resultado: esas personas trabajan desde el primer día pero no existen para
-- gigroup. No salían en la lista, no se podían elegir y no viajaban en el
-- Excel — y son exactamente a quienes hay que facturarles.
--
-- Desde ahora el alta rápida abre también la candidatura (ver `abrirContratada`
-- en candidaturas.repo). Esto arregla a los que ya entraron por esa puerta.
--
-- ── A QUIÉN ALCANZA, Y POR QUÉ SE PUEDE SABER ──────────────────────────────
-- Hay 119 fichas de ETT sin candidatura, pero solo 11 vienen del alta rápida.
-- Las otras 108 son la carga de la plantilla que ya estaba trabajando, y esas
-- no deben aparecer como si fueran altas nuevas de la agencia.
--
-- Lo que las separa es la FECHA: el alta rápida escribe `alta = hoy` porque no
-- pregunta la fecha, mientras que a las cargadas a mano se les puso su fecha
-- real, anterior al día en que se tecleó. Así que "el periodo se creó el mismo
-- día que empieza" es la firma del alta rápida. Comprobado una a una: salen las
-- 11 que se dieron de alta desde esa pantalla y ninguna de las 108 cargadas.
--
-- ── EN QUÉ ESTADO NACEN ────────────────────────────────────────────────────
-- En `listo_rrhh`, que es donde las deja `pasarARRHH`: contratado, con el
-- contrato ya abierto y los papeles en RRHH. No en `preseleccion`, que sería
-- mentira — esta gente lleva días conduciendo.
--
-- Y con `inicio_previsto` puesto, que no es un adorno: es lo que hace que el
-- Excel de la agencia diga «Contratado» en vez de «Pendiente» (ver
-- `mapearParaETT`). Sin esa fecha, la tanda entera se niega a generarse porque
-- los cuenta como "sin decidir".

BEGIN;

INSERT INTO candidatura
  (conductor_id, estado, canal, inicio_previsto, jornada_horas, tipo_contrato,
   apto_at, creado_at)
SELECT DISTINCT ON (c.id)
       c.id, 'listo_rrhh', 'bolsa_ett', p.alta, p.jornada_horas, 'ETT',
       now(), p.creado_at
  FROM conductor c
  JOIN conductor_periodo_empleo p ON p.conductor_id = c.id AND p.tipo = 'ett'
 WHERE NOT c.es_centinela
   -- La firma del alta rápida: el contrato empieza el día en que se tecleó.
   AND p.alta = (p.creado_at AT TIME ZONE 'Europe/Madrid')::date
   -- Y nunca a quien ya tiene una: dos candidaturas de la misma persona son dos
   -- filas en el Excel, y la agencia cobra por fila.
   AND NOT EXISTS (SELECT 1 FROM candidatura k WHERE k.conductor_id = c.id)
 ORDER BY c.id, p.creado_at DESC;

COMMIT;
