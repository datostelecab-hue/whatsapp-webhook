// ============================================================
// LA PROFORMA DE A3, LEÍDA Y CRUZADA (módulo 4, 25/11/2026) — puro
// ============================================================
// La proforma es la nómina del mes que calcula A3NOM ANTES de las variables,
// y que la gestoría manda para revisar («EXCEL NOVIEMBRE TIBUS LUXURY SL SIN
// VARIABLES.xlsx»). No es la plantilla de importación (el `.xls` de
// listado.js): aquí cada trabajador es una COLUMNA y cada concepto una FILA.
//
//   · Arriba (filas 1 a 3), notas a mano de quien la revisa: «BAJA MEDICA»,
//     «RETIRADO», «suspensión empleo y sueldo hasta…».
//   · La fila del código: el legajo con sus ceros («000057»), desde la D.
//   · Debajo, apellidos y nombre (cortados) en tres filas.
//   · «DEL 01/11/26 AL 30/11/26»: el mes.
//   · Los conceptos: en la B su código de A3 y en la C su nombre; y las filas
//     de totales y bases por su nombre en la A («TOTAL BRUTO», «DIAS COTIZADOS»).
//
// EL CRUCE (Camilo, 25/11/2026: que el ERP haga solo lo que se hizo a mano ese
// día), contra la plantilla propia del ERP en ese mes:
//   · legajo        un código que ninguna ficha tiene (con la ficha que se le parece)
//   · sin_contrato  la nómina le paga el mes y el ERP no le da contrato propio
//   · baja_medica   una baja médica del ERP que la nómina no recoge (sin IT ni nota)
//   · suspension    una suspensión que la nómina no descuenta, o que el ERP no tiene
//   · dias          los días cotizados no son los de su contrato (menos los suspendido)
//   · fuera         plantilla propia del ERP en el mes que no está en la nómina
'use strict';

const { palabrasEnComun, plano } = require('./listado');

const CODIGO = /^\d{6}$/;
const IT = new Set(['450', '451', '452', '455']);
const TIPOS = {
  legajo: { etiqueta: 'Código que el ERP no tiene', tono: 'warn' },
  sin_contrato: { etiqueta: 'Cobra el mes sin contrato propio', tono: 'red' },
  baja_medica: { etiqueta: 'Baja médica que la nómina no recoge', tono: 'red' },
  suspension: { etiqueta: 'Suspensión que no cuadra', tono: 'red' },
  dias: { etiqueta: 'Días cotizados distintos a su contrato', tono: 'warn' },
  fuera: { etiqueta: 'Plantilla propia fuera de la nómina', tono: 'warn' },
};

const dias_ = n => `${n} ${Number(n) === 1 ? 'día' : 'días'}`;
const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const num = v => (typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(',', '.')) || 0);
const u = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
/** Días de [a, b] que caen en [desde, hasta], ambos incluidos. */
const solape = (a, b, desde, hasta) => {
  const ini = a > desde ? a : desde, fin = !b || b > hasta ? hasta : b;
  return fin < ini ? 0 : Math.round((u(fin) - u(ini)) / 86400000) + 1;
};

/**
 * LEER: { hoja, periodo ('AAAA-MM'), desde, hasta, empresa, trabajadores:
 * [{ col, legajo, nombre, nota, dias, it, bruto, liquido }], conceptos:
 * [{ fila, codigo, nombre, total }], totales: { bruto, liquido, costeEmpresa } }.
 * Lanza si no es una proforma.
 */
function leer(hojas) {
  for (const h of hojas) {
    const filas = h.filas || [];
    // La fila del código: la primera con dos o más códigos de seis cifras.
    const fCodigo = filas.slice(0, 15).findIndex(f => (f || []).filter(v => CODIGO.test(String(v == null ? '' : v).trim())).length >= 2);
    if (fCodigo < 0) continue;
    const texto = filas.slice(0, 10).flat().map(v => String(v == null ? '' : v));
    const del = texto.map(t => /DEL\s+(\d{2})\/(\d{2})\/(\d{2,4})\s+AL\s+(\d{2})\/(\d{2})\/(\d{2,4})/i.exec(t)).find(Boolean);
    if (!del) throw new Error('No encuentro el mes de la proforma (el «DEL 01/11/26 AL 30/11/26» de arriba)');
    const ano = s => (s.length === 2 ? `20${s}` : s);
    const desde = `${ano(del[3])}-${del[2]}-${del[1]}`, hasta = `${ano(del[6])}-${del[5]}-${del[4]}`;
    const emp = texto.map(t => /Empresa:\s*(\d+)\s*-\s*(.+?)(\s+NIF:.*)?$/i.exec(t.trim())).find(Boolean);
    const cols = [];
    (filas[fCodigo] || []).forEach((v, c) => { if (CODIGO.test(String(v == null ? '' : v).trim())) cols.push(c); });
    // Las filas de los conceptos (código en la B) y las de totales (nombre en la A).
    const conceptos = [];
    const porNombre = {};
    for (let f = fCodigo + 1; f < filas.length; f++) {
      const fila = filas[f] || [];
      const a = plano(fila[0]), b = String(fila[1] == null ? '' : fila[1]).trim(), c = String(fila[2] == null ? '' : fila[2]).trim();
      if (a) porNombre[a] = porNombre[a] == null ? f : porNombre[a];
      if (c) {
        const codigo = /^\d+$/.test(b) ? b.padStart(3, '0') : null;
        conceptos.push({ fila: f, codigo, nombre: c, total: Math.round(cols.reduce((s, k) => s + num(fila[k]), 0) * 100) / 100 });
      }
    }
    const filaDe = (...nombres) => { for (const n of nombres) { const k = Object.keys(porNombre).find(x => x.startsWith(n)); if (k) return porNombre[k]; } return null; };
    const fDias = filaDe('DIAS COTIZADOS'), fBruto = filaDe('TOTAL BRUTO'), fLiquido = filaDe('TOTAL LIQUIDO'), fCoste = filaDe('COSTE EMPRESA');
    if (fDias == null) throw new Error('No encuentro la fila «DIAS COTIZADOS» de la proforma');
    const filasIt = conceptos.filter(x => IT.has(x.codigo)).map(x => x.fila);
    const celda = (f, c) => (f == null ? 0 : num((filas[f] || [])[c]));
    const trabajadores = cols.map(c => {
      const notas = [];
      for (let f = 0; f < fCodigo; f++) {
        const v = (filas[f] || [])[c];
        const t = v == null ? '' : String(v).trim();
        if (t && !/^\d{4}-\d{2}-\d{2}/.test(t) && !notas.some(n => n.toLowerCase() === t.toLowerCase())) notas.push(t);
      }
      const nombre = [1, 2, 3].map(k => (filas[fCodigo + k] || [])[c]).filter(v => v != null && String(v).trim()).join(' ').replace(/\s+/g, ' ').trim();
      return {
        col: c, legajo: String(filas[fCodigo][c]).trim(), nombre, nota: notas.join(' / '),
        dias: celda(fDias, c), it: Math.round(filasIt.reduce((s, f) => s + celda(f, c), 0) * 100) / 100,
        bruto: celda(fBruto, c), liquido: celda(fLiquido, c),
      };
    });
    const suma = f => Math.round(cols.reduce((s, c) => s + celda(f, c), 0) * 100) / 100;
    return {
      hoja: h.nombre, periodo: desde.slice(0, 7), desde, hasta,
      empresa: emp ? { codigo: emp[1], nombre: emp[2].trim() } : null,
      trabajadores, conceptos,
      totales: { bruto: suma(fBruto), liquido: suma(fLiquido), costeEmpresa: suma(fCoste) },
    };
  }
  throw new Error('No parece una proforma de A3: no encuentro la fila con los códigos de los trabajadores (seis cifras, uno por columna)');
}

/**
 * EL CRUCE (puro). `personas`: las fichas con algo en el mes, [{ id, nombre,
 * nombre_ss, legajo, empleos: [{ tipo, alta, baja }], situaciones: [{ estado,
 * desde, hasta }] }] (empleos y situaciones, los que tocan el mes). `hoy`: el
 * día en que se sube (una baja que empieza después, la gestoría no la podía
 * saber). → [{ tipo, clave, conductorId, legajo, nombreA3, detalle }]
 */
function cruzar({ trabajadores, personas, desde, hasta, hoy }) {
  const porLegajo = new Map(personas.filter(p => p.legajo).map(p => [p.legajo, p]));
  const enNomina = new Set(trabajadores.map(t => t.legajo));
  const propias = p => (p.empleos || []).filter(e => e.tipo === 'propia');
  const diasContrato = p => propias(p).reduce((s, e) => s + solape(e.alta, e.baja, desde, hasta), 0);
  const susp = p => (p.situaciones || []).filter(s => s.estado === 'suspendido' || s.estado === 'suspension_permiso');
  const diasSusp = p => susp(p).reduce((s, x) => s + solape(x.desde, x.hasta, desde, hasta), 0);
  const tramo = s => ({ desde: s.desde, hasta: s.hasta });
  const salida = [];
  const poner = (tipo, p, t, detalle) => salida.push({
    tipo, clave: `${tipo}:${p ? p.id : ''}:${t ? t.legajo : ''}`, conductorId: p ? String(p.id) : null,
    legajo: t ? t.legajo : (p && p.legajo) || null, nombreA3: t ? t.nombre : null, detalle,
  });
  const vistos = new Set();
  const maxLegajo = trabajadores.reduce((m, t) => (t.legajo > m ? t.legajo : m), '');

  for (const t of trabajadores) {
    let p = porLegajo.get(t.legajo);
    if (!p) {
      // A quién se parece: dos palabras en común como poco; entre varias, la que comparte más.
      const puntos = personas.map(x => ({ x, n: x.legajo !== t.legajo ? palabrasEnComun(t.nombre, x.nombre, x.nombre_ss) : 0 })).filter(y => y.n >= 2);
      const mejor = Math.max(0, ...puntos.map(y => y.n));
      const cand = puntos.filter(y => y.n === mejor).map(y => y.x);
      const una = cand.length === 1 ? cand[0] : null;
      poner('legajo', una, t, {
        nota: t.nota, candidatos: cand.length,
        propuesta: una ? { id: String(una.id), nombre: una.nombre, legajo: una.legajo || null, propia: propias(una).length > 0 } : null,
      });
      if (!una) continue;
      p = una;
    }
    vistos.add(String(p.id));
    const dc = diasContrato(p);
    if (!propias(p).length) {
      poner('sin_contrato', p, t, { nota: t.nota, dias: t.dias, empleos: p.empleos || [] });
      continue;
    }
    // Bajas médicas del mes que ya habían empezado al subirla y que no tienen ni IT ni nota.
    const bajas = (p.situaciones || []).filter(s => s.estado === 'baja_medica' && s.desde <= hoy);
    if (bajas.length && t.it === 0 && !/BAJA MEDICA/.test(plano(t.nota))) {
      poner('baja_medica', p, t, { nota: t.nota, tramos: bajas.map(tramo), unDia: bajas.every(s => s.hasta === s.desde) });
    }
    const ds = diasSusp(p);
    const notaSusp = /SUSPEN/i.test(plano(t.nota));
    if (ds > 0 && t.dias >= dc) poner('suspension', p, t, { nota: t.nota, dias: t.dias, diasSuspension: ds, tramos: susp(p).map(tramo), que: 'erp' });
    else if (notaSusp && !ds) poner('suspension', p, t, { nota: t.nota, dias: t.dias, que: 'a3' });
    const esperados = Math.max(0, dc - ds);
    if (t.dias !== esperados && !(ds > 0 && t.dias >= dc)) {
      poner('dias', p, t, { nota: t.nota, a3: t.dias, erp: esperados, diasSuspension: ds, contrato: propias(p).map(e => ({ alta: e.alta, baja: e.baja })) });
    }
  }
  for (const p of personas) {
    if (vistos.has(String(p.id)) || !propias(p).length || !diasContrato(p)) continue;
    if (p.legajo && enNomina.has(p.legajo)) continue;
    const ultima = propias(p).at(-1);
    poner('fuera', p, null, {
      contrato: propias(p).map(e => ({ alta: e.alta, baja: e.baja })),
      // Alta después del último código de la nómina, o sin legajo y de la última semana: lo más fácil es que llegue después.
      reciente: (!!p.legajo && p.legajo > maxLegajo) || (!p.legajo && ultima.alta >= `${hoy.slice(0, 8)}01` && u(hoy) - u(ultima.alta) <= 7 * 86400000),
    });
  }
  return salida;
}

/** Lo que dice cada caso, en una frase (la pantalla y el correo a la gestoría). */
function frase(c) {
  const d = c.detalle || {};
  const tramos = ts => (ts || []).map(s => `del ${dmy(s.desde)} ${s.hasta ? `al ${dmy(s.hasta)}` : 'en adelante'}`).join(', ');
  switch (c.tipo) {
    case 'legajo': return d.propuesta
      ? `Ninguna ficha tiene este código. Parece ${d.propuesta.nombre}${d.propuesta.legajo ? `, que en el ERP tiene el ${d.propuesta.legajo}` : ', sin código en el ERP'}`
      : d.candidatos > 1 ? 'Ninguna ficha tiene este código, y se parece a varias' : 'Ninguna ficha tiene este código ni se parece a nadie';
    case 'sin_contrato': return `Cotiza ${dias_(d.dias)}, y el ERP no le da contrato propio este mes${(d.empleos || []).length
      ? ` (${d.empleos.map(e => `${e.tipo === 'ett' ? 'ETT' : e.tipo} desde el ${dmy(e.alta)}`).join(', ')})` : ''}`;
    case 'baja_medica': return `Baja médica en el ERP ${tramos(d.tramos)} y la nómina no trae IT${d.unDia ? ' (de un día: ¿justificante médico?)' : ''}`;
    case 'suspension': return d.que === 'erp'
      ? `Suspendido en el ERP ${tramos(d.tramos)} (${dias_(d.diasSuspension)}) y la nómina cotiza ${dias_(d.dias)}`
      : `La nómina dice «${d.nota}» y el ERP no tiene esa suspensión`;
    case 'dias': return `Cotiza ${dias_(d.a3)} y por su contrato ${Number(d.erp) === 1 ? 'es' : 'son'} ${d.erp} (${(d.contrato || []).map(e => `alta ${dmy(e.alta)}${e.baja ? `, baja ${dmy(e.baja)}` : ''}`).join('; ')}${d.diasSuspension ? `; ${d.diasSuspension} suspendido` : ''})`;
    case 'fuera': return `Plantilla propia en el ERP (${(d.contrato || []).map(e => `alta ${dmy(e.alta)}${e.baja ? `, baja ${dmy(e.baja)}` : ''}`).join('; ')}) y no está en la nómina${d.reciente ? ': alta reciente, puede ser posterior a la proforma' : ''}`;
    default: return '';
  }
}

module.exports = { leer, cruzar, frase, TIPOS, solape };
