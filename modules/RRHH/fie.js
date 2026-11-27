// ============================================================
// EL FICHERO FIE, LEÍDO (db/312, 27/11/2026) — puro
// ============================================================
// El FIE de la Seguridad Social que manda la gestoría (una hoja «Report»): la
// fila 1 agrupa (EMP, TRA, AYN, DIT…) y la 2 son las cabeceras de verdad. Desde
// la 3, un proceso de IT por fila. Las columnas se buscan POR SU CABECERA, no
// por su posición: «Fecha Baja IT» sale dos veces y vale la primera (la de DIT).
// Las fechas vienen como «20261125»; una vacía es que no la hay («sin fecha de
// alta»). Un fichero sin filas es un día sin novedades.
'use strict';

const { hojasDe, plano } = require('../Gestoria/listado');

// La contingencia del FIE (código de la Seguridad Social) → la del ERP (db/303).
const CONTINGENCIA = { 1: 'comun', 2: 'accidente_no_laboral', 3: 'accidente_trabajo', 4: 'enfermedad_profesional' };

const CABECERAS = {
  registro: 'FECHA REGISTRO',
  naf: 'N A F',
  ipf: 'IPF',
  apellido1: 'PRIMER APELLIDO',
  apellido2: 'SEGUNDO APELLIDO',
  nombre: 'NOMBRE',
  fechaBaja: 'FECHA BAJA IT',
  recaida: 'INDICADOR RECAIDA',
  procesoInicial: 'FECHA PROCESO INICIAL',
  contingencia: 'CONTINGENCIA',
  duracion: 'DURACION ESTIMADA',
  fechaFin: 'FECHA FIN IT',
  causaFin: 'CAUSA FIN IT',
  bajaAnulada: 'PARTE DE BAJA ANULADO',
  altaAnulada: 'PARTE DE ALTA ANULADO',
  revision: 'FECHA SIGUIENTE REVISION MEDICA',
  confirmacion: 'FECHA PARTE CONFIRMACION',
};

/** «20261125», un número de serie de Excel o «2026-11-25» → '2026-11-25'; lo demás, null. */
function fecha(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** El IPF del FIE («051922270T», «0Y2058088Q») → el documento («51922270T», «Y2058088Q»). */
function dniDe(ipf) {
  const s = String(ipf == null ? '' : ipf).toUpperCase().replace(/[^0-9A-Z]/g, '');
  return s.length === 10 && /^\d/.test(s) ? s.slice(1) : s;
}

/** Un documento, para comparar: en mayúsculas y sin ceros delante de un DNI corto. */
function dniNorm(v) {
  const s = String(v == null ? '' : v).toUpperCase().replace(/[^0-9A-Z]/g, '');
  return /^\d+[A-Z]$/.test(s) ? s.replace(/^0+(?=\d{8}[A-Z]$)/, '').padStart(9, '0') : s;
}

const entero = v => { const n = Number(String(v == null ? '' : v).trim()); return Number.isFinite(n) ? Math.round(n) : null; };
const si = v => String(v == null ? '' : v).trim().toUpperCase() === 'S';
const texto = v => { const t = String(v == null ? '' : v).trim(); return t && t !== '---' ? t : ''; };

/**
 * Lo que dice el fichero: { hoja, procesos: [{ dni, naf, nombre, registro,
 * fechaBaja, fechaFin, causaFin, contingencia, recaida, procesoInicial,
 * duracion, revision, confirmacion, bajaAnulada, altaAnulada, fila }], avisos }.
 * Lanza si no encuentra la cabecera.
 */
function interpretar(hojas) {
  for (const h of hojas) {
    for (let f = 0; f < Math.min(10, h.filas.length); f++) {
      const fila = (h.filas[f] || []).map(plano);
      if (!fila.includes('IPF') || !fila.includes('FECHA BAJA IT')) continue;
      const col = {};
      Object.entries(CABECERAS).forEach(([k, cab]) => { const i = fila.indexOf(cab); if (i >= 0) col[k] = i; });
      const v = (r, k) => (col[k] == null ? null : r[col[k]]);
      const procesos = [], avisos = [];
      for (let k = f + 1; k < h.filas.length; k++) {
        const r = h.filas[k] || [];
        if (!r.some(x => x != null && String(x).trim() !== '')) continue;
        const dni = dniDe(v(r, 'ipf'));
        const fechaBaja = fecha(v(r, 'fechaBaja'));
        if (!dni || !fechaBaja) { avisos.push(`Fila ${k + 1}: sin documento o sin fecha de baja`); continue; }
        procesos.push({
          fila: k + 1, dni, naf: texto(v(r, 'naf')) || null,
          nombre: [texto(v(r, 'apellido1')), texto(v(r, 'apellido2'))].filter(Boolean).join(' ') + (texto(v(r, 'nombre')) ? `, ${texto(v(r, 'nombre'))}` : ''),
          registro: fecha(v(r, 'registro')), fechaBaja, fechaFin: fecha(v(r, 'fechaFin')), causaFin: texto(v(r, 'causaFin')) || null,
          contingencia: CONTINGENCIA[entero(v(r, 'contingencia'))] || null, recaida: si(v(r, 'recaida')),
          procesoInicial: fecha(v(r, 'procesoInicial')), duracion: entero(v(r, 'duracion')),
          revision: fecha(v(r, 'revision')), confirmacion: fecha(v(r, 'confirmacion')),
          bajaAnulada: si(v(r, 'bajaAnulada')), altaAnulada: si(v(r, 'altaAnulada')),
        });
      }
      return { hoja: h.nombre, procesos, avisos };
    }
  }
  throw new Error('No encuentro la cabecera del FIE (las columnas «IPF» y «Fecha Baja IT»)');
}

async function leer(buffer) {
  return interpretar(await hojasDe(buffer));
}

module.exports = { leer, interpretar, fecha, dniDe, dniNorm, CONTINGENCIA };
