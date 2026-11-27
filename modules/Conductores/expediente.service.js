// ============================================================
// EL EXPEDIENTE DE RR. HH. DE UNA PERSONA (plan de RR. HH., comunes, 26/11/2026)
// ============================================================
// El encargo pide «el expediente del conductor»: todo lo de RR. HH. de una
// persona en un sitio. Aquí no se calcula nada nuevo: se REÚNE lo que ya lleva
// cada módulo (vacaciones, ausencias y bajas, permisos, faltas y sanciones,
// cartas a firma, descuentos, finiquito y el efectivo por entregar).
//
// CADA SECCIÓN CON SU LLAVE. La ficha de Plantilla la abre mucha gente, y aquí
// hay datos de salud y de dinero: cada sección sale solo si quien mira tiene la
// llave de su módulo (la misma que le deja abrir ese módulo). Si no la tiene,
// la sección no viaja (no se esconde en la pantalla: no llega). Y una sección
// que no se puede leer sale con su error, sin tumbar las demás.
'use strict';

const db = require('../../services/db');
const permisos = require('../../services/permisos');

const TOTAL = ['superadmin', 'desarrollador'];
const MESES = 12;

async function llavesDe(quien) {
  if (!quien || !quien.usuarioId) return new Set();
  if (TOTAL.includes(quien.rol)) return null;           // lo ve todo
  try { return await permisos.clavesDe(quien.usuarioId); } catch (_) { return new Set(); }
}
const tiene = (llaves, k) => llaves === null || llaves.has(k);
const existe = async t => (await db.consulta(`SELECT to_regclass($1) IS NOT NULL AS hay`, [`public.${t}`])).rows[0].hay;
const dmy = iso => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '');
const fecha = c => `to_char(${c}, 'YYYY-MM-DD')`;

// ── Las secciones: cada una, su llave, su enlace y cómo se lee ───────────────
const SECCIONES = [
  {
    id: 'vacaciones', titulo: 'Vacaciones', llave: '/vacaciones', enlace: id => `/vacaciones#${id}`,
    async leer(id) {
      const f = await require('../Vacaciones/vacaciones.service').ficha(id);
      return { saldo: f.saldo, programadas: f.programadas, saldoTras: f.saldoTras };
    },
  },
  {
    id: 'ausencias', titulo: 'Ausencias y bajas médicas', llave: '/ausencias', enlace: () => '/ausencias',
    async leer(id) {
      const out = { ausencias: {}, bajas: [] };
      if (await existe('ausencia_rrhh')) {
        const r = await db.consulta(
          `SELECT estado, count(*)::int AS n FROM ausencia_rrhh
            WHERE conductor_id = $1 AND dia >= CURRENT_DATE - ($2::int || ' months')::interval GROUP BY 1`, [id, MESES]);
        out.ausencias = Object.fromEntries(r.rows.map(x => [x.estado, x.n]));
      }
      const b = await db.consulta(
        `SELECT h.id::text AS id, ${fecha('h.desde')} AS desde, ${fecha('h.hasta')} AS hasta, ${fecha('h.hasta_previsto')} AS prevista
           FROM conductor_estado_hist h
          WHERE h.conductor_id = $1 AND h.estado = 'baja_medica' AND (h.hasta IS NULL OR h.hasta >= CURRENT_DATE - ($2::int || ' months')::interval)
          ORDER BY h.desde DESC`, [id, MESES]);
      out.bajas = b.rows;
      return out;
    },
  },
  {
    id: 'permisos', titulo: 'Permisos de este año', llave: '/ausencias', enlace: () => '/ausencias',
    async leer(id) {
      const s = await require('./permisosConvenio').saldo(Number(id));
      return { anio: s.anio, tipos: s.tipos.filter(t => t.permisos > 0) };
    },
  },
  {
    id: 'sanciones', titulo: 'Faltas y sanciones', llave: '/disciplina', enlace: () => '/disciplina',
    async leer(id) {
      if (!await existe('sancion')) return { lista: [] };
      const r = await db.consulta(
        `SELECT id::text AS id, gravedad, falta, ${fecha('fecha_hechos')} AS fecha, estado, medida, dias,
                ${fecha('suspension_desde')} AS suspension_desde, ${fecha('suspension_hasta')} AS suspension_hasta
           FROM sancion WHERE conductor_id = $1 ORDER BY fecha_hechos DESC, id DESC LIMIT 20`, [id]);
      return { lista: r.rows };
    },
  },
  {
    id: 'firmas', titulo: 'Cartas y documentos a firma', llave: '/firmas', enlace: () => '/firmas',
    async leer(id) {
      if (!await existe('firma_envio')) return { lista: [] };
      const r = await db.consulta(
        `SELECT id::text AS id, tipo, titulo, estado, ${fecha("creado_at AT TIME ZONE 'Europe/Madrid'")} AS creado,
                ${fecha("enviado_at AT TIME ZONE 'Europe/Madrid'")} AS enviado
           FROM firma_envio WHERE conductor_id = $1 ORDER BY creado_at DESC LIMIT 20`, [id]);
      return { lista: r.rows };
    },
  },
  {
    // Los comunicados a la plantilla (db/305) y si pulsó «Lo he leído».
    id: 'comunicados', titulo: 'Comunicados recibidos', llave: '/comunicados', enlace: () => '/comunicados',
    async leer(id) {
      if (!await existe('comunicado_destinatario')) return { lista: [] };
      return { lista: await require('../RRHH/comunicados.repo').expediente(id) };
    },
  },
  {
    // EL HISTÓRICO DE SU NÓMINA, MES A MES (módulo 4.7, 26/11/2026): lo que dijo
    // la proforma de A3, las variables que se le mandaron y lo descontado.
    id: 'nomina', titulo: 'Nómina por meses', llave: '/gestoria', enlace: () => '/gestoria?vista=variables',
    async leer(id) { return { meses: await require('../Gestoria/historico').deConductor(id) }; },
  },
  {
    // El SMS certificado de Mensatek (db/306), con su certificado de entrega.
    id: 'sms', titulo: 'SMS certificados', llave: '/sms', enlace: () => '/sms',
    async leer(id) {
      if (!await existe('sms_destinatario')) return { lista: [] };
      return { lista: await require('../RRHH/sms.service').expediente(id) };
    },
  },
  {
    id: 'descuentos', titulo: 'Descuentos en nómina', llave: '/descuentos', enlace: () => '/descuentos',
    async leer(id) {
      if (!await existe('descuento_nomina')) return { lista: [] };
      const r = await db.consulta(
        `SELECT id::text AS id, origen, concepto, importe::float AS importe, saldo::float AS saldo, periodo, estado, motivo
           FROM descuento_nomina WHERE conductor_id = $1 AND (estado IN ('pendiente', 'aprobado', 'aplazado') OR creado_at > now() - interval '12 months')
          ORDER BY creado_at DESC LIMIT 20`, [id]);
      return { lista: r.rows };
    },
  },
  {
    id: 'finiquito', titulo: 'Finiquito', llave: '/finiquitos', enlace: () => '/finiquitos',
    async leer(id) {
      if (!await existe('finiquito')) return { lista: [] };
      const r = await db.consulta(
        `SELECT id::text AS id, ${fecha('fecha_baja')} AS fecha_baja, tipo, estado,
                ${fecha("aprobado_at AT TIME ZONE 'Europe/Madrid'")} AS aprobado, ${fecha("enviado_at AT TIME ZONE 'Europe/Madrid'")} AS enviado
           FROM finiquito WHERE conductor_id = $1 ORDER BY fecha_baja DESC LIMIT 5`, [id]);
      return { lista: r.rows };
    },
  },
  {
    id: 'efectivo', titulo: 'Efectivo por entregar', llave: '/recaudacion', enlace: () => '/recaudacion',
    async leer(id) {
      const e = await require('../Administracion/recaudacion.service').extractoDe(id);
      return { pendiente: e && e.pendiente != null ? Number(e.pendiente) : null };
    },
  },
];

// ── TODO LO QUE SE LE HA COMUNICADO, POR FECHAS (27/11/2026) ───────────────
// Camilo: la línea de tiempo de comunicaciones. No se lee nada nuevo: se juntan
// las secciones de firmas, comunicados y SMS certificados QUE YA VIAJAN (cada una
// con su llave), así que quien no tiene la de un canal tampoco lo ve aquí.
const FIRMA_TIPO = {
  finiquito: 'Finiquito', suspension: 'Suspensión de empleo y sueldo', sancion: 'Carta de sanción', descuento: 'Descuento en nómina',
  contrato: 'Contrato', comunicacion: 'Comunicación de horas', baja_voluntaria: 'Carta de baja voluntaria',
  incorporacion: 'Carta de incorporación', informativo: 'Documento informativo del contrato', otro: 'Documento',
};
const FIRMA_ESTADO = {
  borrador: 'por aprobar', aprobado: 'aprobado, por enviar', enviado: 'enviado, sin firmar', firmado: 'firmado',
  rechazado: 'no lo firmó', caducado: 'caducado', descartado: 'descartado', error: 'error al enviar',
};
function lineaDeTiempo(secciones) {
  const de = id => { const s = secciones.find(x => x.id === id && !x.error); return s ? s.datos || {} : null; };
  const firmas = de('firmas'), comunicados = de('comunicados'), sms = de('sms');
  if (!firmas && !comunicados && !sms) return null;
  const lista = [];
  ((firmas && firmas.lista) || []).forEach(x => lista.push({ dia: x.enviado || x.creado, canal: 'Firma',
    que: x.titulo || FIRMA_TIPO[x.tipo] || x.tipo, como: FIRMA_ESTADO[x.estado] || x.estado, aviso: ['rechazado', 'caducado', 'error'].includes(x.estado) }));
  ((comunicados && comunicados.lista) || []).forEach(x => lista.push({ dia: x.dia, canal: 'Comunicado', que: x.titulo,
    como: x.leido ? `leído el ${dmy(x.leido)}` : 'sin leer', aviso: !x.leido }));
  ((sms && sms.lista) || []).forEach(x => lista.push({ dia: x.dia, canal: 'SMS certificado', que: x.asunto,
    como: x.error || x.estado_texto || 'enviado', aviso: !!x.error, certificado: x.certificado_adjunto_id || null }));
  lista.sort((a, b) => String(b.dia || '').localeCompare(String(a.dia || '')));
  return { id: 'comunicaciones', titulo: 'Todo lo que se le ha comunicado', enlace: null, datos: { lista } };
}

/** El expediente de una persona, solo con las secciones que puede ver quien mira. */
async function deUno(conductorId, quien) {
  const id = Number(conductorId);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Falta la persona'), { status: 400 });
  const llaves = await llavesDe(quien);
  const visibles = SECCIONES.filter(s => tiene(llaves, s.llave));
  const secciones = await Promise.all(visibles.map(async s => {
    try { return { id: s.id, titulo: s.titulo, enlace: s.enlace(id), datos: await s.leer(id) }; }
    catch (e) { return { id: s.id, titulo: s.titulo, enlace: s.enlace(id), error: e.message }; }
  }));
  // La línea de tiempo va justo antes de la primera de sus tres secciones.
  const linea = lineaDeTiempo(secciones);
  if (linea) {
    const i = secciones.findIndex(s => ['firmas', 'comunicados', 'sms'].includes(s.id));
    secciones.splice(i < 0 ? secciones.length : i, 0, linea);
  }
  return { secciones, ocultas: SECCIONES.length - visibles.length };
}

module.exports = { deUno, SECCIONES, lineaDeTiempo, _dmy: dmy };
