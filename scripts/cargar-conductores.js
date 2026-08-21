// ============================================================
// CARGA DE CONDUCTORES desde los Excel al núcleo de PostgreSQL
// ============================================================
//   node scripts/cargar-conductores.js [carpeta]
// Necesita DATABASE_URL. Carpeta por defecto: C:/Users/ricar/Downloads.
//
// ORDEN Y REGLAS (acordadas con el cliente, agosto 2026):
//
//  1. BOLT PRIMERO. `CONDUCTORES_BOLT` es la única fuente con teléfono en el
//     100 % de las filas, trae el correo y sobre todo el `driver_uuid`, que es
//     un identificador DURO. Se siembra el padrón con él.
//     Hay 72 personas con varias cuentas: manda la que está `active`, y eso
//     resuelve los 7 teléfonos que aparecían compartidos entre personas.
//
//  2. TRAFICO 2.0 manda en lo operativo (quién está y quién no).
//  3. PLANTILLA TRABAJADORES aporta los datos legales y los periodos de empleo.
//  4. GestionConductores y Operaciones 1.0 SOLO aportan alias: no crean a nadie.
//
//  · Identidad = DNI cuando existe; si no, el nombre normalizado.
//  · MISMO DNI con nombres distintos NO es conflicto: uno suele ser como sale en
//    BOLT y otro como lo escribe la Seguridad Social. Misma persona, dos alias.
//  · MISMO NOMBRE con DNI distinto SÍ son personas distintas: se crean las dos y
//    su nombre se marca `ambiguo` para que nunca se resuelva solo.

const path = require('path');
const ExcelJS = require('exceljs');
const db = require('../services/db');
const { normClave } = require('../services/conductores');

const NL = String.fromCharCode(10);
const primeraLinea = e => String(e.message).split(NL)[0];
const DIR = process.argv[2] || 'C:/Users/ricar/Downloads';
const F = {
  trafico: 'Trafico 2.0.xlsx',
  plantilla: 'PLANTILLA TRABAJADORES.xlsx',
  gestion: 'GestionConductores (1).xlsx',
  operaciones: 'Operaciones 1.0.xlsx',
};

// ── Lectura de celdas ────────────────────────────────────────────────────────
const txt = v => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return txt(v.result);
    return '';
  }
  return String(v);
};
const s = v => txt(v).trim();
const nulo = (v, max) => { const x = s(v); return x === '' ? null : (max ? x.slice(0, max) : x); };
const dniLimpio = v => { const x = s(v).toUpperCase().replace(/[^0-9A-Z]/g, ''); return x.length >= 6 ? x : null; };
const tel9 = v => { const x = s(v).replace(/\D/g, '').slice(-9); return x.length === 9 ? x : null; };

// Las fechas llegan como Date de Excel o como texto dd/mm/aaaa. Y '00/00/0000'
// NO es una fecha: la gestoría lo usa para decir "sin fecha". Cargarlo tal cual
// habría dado de baja a 248 de los 251 trabajadores.
function fecha(v) {
  const x = s(v);
  if (!x || /^0+$/.test(x.replace(/\D/g, ''))) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(x)) return x.slice(0, 10);
  const m = x.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return null;
  const a = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

async function hoja(libro, nombre) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(DIR, libro));
  const ws = wb.getWorksheet(nombre);
  if (!ws) throw new Error(`No existe la hoja "${nombre}" en ${libro}`);
  return ws;
}
function filas(ws, filaCab = 1) {
  const cab = (ws.getRow(filaCab).values || []).slice(1).map(v => s(v).toUpperCase());
  const out = [];
  ws.eachRow({ includeEmpty: false }, (r, ri) => {
    if (ri <= filaCab) return;
    const o = { _fila: ri };
    cab.forEach((c, i) => { if (c) o[c] = r.getCell(i + 1).value; });
    out.push(o);
  });
  return out;
}

// ── Padrón en memoria ────────────────────────────────────────────────────────
const PRIO = { BOLT: 2, T2: 1, PLANTILLA: 2, GC: 4, OP: 5 };

class Padron {
  constructor() { this.porDni = new Map(); this.porNombre = new Map(); this.porTel = new Map(); this.gente = []; }

  nueva(dni, nombre) {
    const clave = normClave(nombre);
    const p = { dni, nombre, clave, alias: new Map(), externos: new Map(),
                telefonos: new Map(), empleos: [], datos: {}, nombreAmbiguo: false, fuentePrio: 9 };
    this.gente.push(p);
    if (dni) this.porDni.set(dni, p);
    if (clave) {
      if (!this.porNombre.has(clave)) this.porNombre.set(clave, []);
      const l = this.porNombre.get(clave);
      l.push(p);
      // Mismo nombre con DNI distinto = personas distintas. El nombre deja de
      // servir para resolver y se marca en todas las implicadas.
      if (l.length > 1) l.forEach(x => { x.nombreAmbiguo = true; });
    }
    return p;
  }

  /**
   * Busca sin crear: DNI, luego TELEFONO, luego nombre.
   *
   * El telefono es imprescindible como clave. BOLT siembra el padron por nombre
   * y no trae DNI; la agenda trae DNI y a veces OTRO nombre. Sin cruzar por
   * telefono, la misma persona se creaba dos veces: una con el uuid y el
   * telefono, otra con el DNI. Eran los 84 "telefonos repetidos".
   */
  buscar(dni, nombre, tel) {
    if (dni && this.porDni.has(dni)) return this.porDni.get(dni);
    const t = tel9(tel);
    if (t && this.porTel.has(t)) return this.porTel.get(t);
    const l = this.porNombre.get(normClave(nombre)) || [];
    return l.length === 1 ? l[0] : null;
  }

  /** Busca y, si no está, la crea. */
  ubicar(dni, nombre, tel) {
    const y = this.buscar(dni, nombre, tel);
    if (y) {
      // Si la encontramos por otra via y ahora traemos DNI, se lo ponemos.
      if (dni && !y.dni) { y.dni = dni; this.porDni.set(dni, y); }
      const t0 = tel9(tel);
      if (t0 && !this.porTel.has(t0)) this.porTel.set(t0, y);
      return y;
    }
    const l = this.porNombre.get(normClave(nombre)) || [];
    if (!dni && l.length > 1) { l.forEach(x => { x.nombreAmbiguo = true; }); return null; }
    const p = this.nueva(dni, nombre);
    const t1 = tel9(tel);
    if (t1 && !this.porTel.has(t1)) this.porTel.set(t1, p);
    return p;
  }

  poner(p, fuente, campos) {
    const prio = PRIO[fuente] || 9;
    for (const [k, v] of Object.entries(campos)) {
      if (v == null || v === '') continue;
      const prev = p.datos[k];
      if (prev === undefined || prio < prev.prio) p.datos[k] = { v, prio };
    }
    if (prio < p.fuentePrio) p.fuentePrio = prio;
  }
  val(p, k) { return p.datos[k] ? p.datos[k].v : null; }

  alias(p, tipo, nombre) {
    const n = s(nombre); if (!n) return;
    const k = normClave(n); if (!k) return;
    if (!p.alias.has(k)) p.alias.set(k, { tipo, alias: n, norm: k });
  }
  externo(p, sistema, id, nombre, estado) {
    const e = s(id); if (!e) return;
    const prev = p.externos.get(sistema + '|' + e);
    // Entre varias cuentas del mismo sistema gana la activa.
    if (!prev || (estado === 'active' && prev.estado !== 'active')) {
      p.externos.set(sistema + '|' + e, { sistema, externo_id: e, nombre: s(nombre), estado });
    }
  }
  telefono(p, e164, origen, activo) {
    const t = tel9(e164); if (!t) return;
    if (!this.porTel.has(t)) this.porTel.set(t, p);
    const prev = p.telefonos.get(t);
    if (!prev || (activo && !prev.activo)) p.telefonos.set(t, { e164: s(e164), origen, activo });
  }
}

// ── Carga ────────────────────────────────────────────────────────────────────
(async () => {
  const P = new Padron();
  const avisos = [];
  console.log(`Leyendo de ${DIR}` + NL);

  // ── 1) BOLT: siembra el padrón con identificadores duros ──
  // Se procesan ANTES las cuentas activas: así, cuando dos cuentas comparten
  // nombre, la persona queda creada a partir de la buena.
  const cb = filas(await hoja(F.trafico, 'CONDUCTORES_BOLT'));
  const orden = [...cb].sort((a, b) =>
    (s(b.STATE).toLowerCase() === 'active' ? 1 : 0) - (s(a.STATE).toLowerCase() === 'active' ? 1 : 0));
  let nAct = 0, nIna = 0;
  for (const r of orden) {
    const nombre = s(r.NOMBRE); if (!nombre) continue;
    const estado = s(r.STATE).toLowerCase();
    const activo = estado === 'active';
    // Las cuentas desactivadas NO crean personas nuevas: son historia, y crear
    // una persona por cada cuenta vieja llenaría el padrón de fantasmas.
    const p = activo ? P.ubicar(null, nombre, r.PHONE) : P.buscar(null, nombre, r.PHONE);
    if (!p) { if (!activo) nIna++; continue; }
    P.poner(p, 'BOLT', { nombre, email: nulo(r.EMAIL, 160) });
    P.alias(p, 'bolt_nombre', nombre);
    P.externo(p, 'bolt', r.DRIVER_UUID, nombre, estado);
    P.telefono(p, r.PHONE, 'bolt', activo);
    if (activo) nAct++;
  }
  console.log(`  CONDUCTORES_BOLT     ${nAct} cuentas activas · ${nIna} desactivadas sin dueño (historia)`);

  // ── 2) TRAFICO 2.0: manda en lo operativo ──
  for (const [h, esBaja] of [['AGENDA_V2', false], ['CONDUCTORES_OUT', true]]) {
    let n = 0;
    for (const r of filas(await hoja(F.trafico, h))) {
      const nombre = s(r.NOMBRE_APELLIDOS);
      if (!nombre || !/[a-zá-úñ]/i.test(nombre)) continue;
      const p = P.ubicar(dniLimpio(r.DNI_NIE), nombre, r.TELEFONO);
      if (!p) { avisos.push(`Homonimo sin DNI en ${h} fila ${r._fila}: ${nombre}`); continue; }
      P.poner(p, 'T2', {
        nombre, dni_nie: dniLimpio(r.DNI_NIE),
        recomendador: nulo(r.RECOMENDADOR, 120), observaciones: nulo(r.OBSERVACIONES),
        tel_emergencia: nulo(r.TEL_EMERGENCIA, 20),
      });
      P.alias(p, 'manual', nombre);
      P.alias(p, 'bolt_nombre', r.ID_BOLT);
      P.telefono(p, r.TELEFONO, 'agenda', false);
      if (esBaja) p.bajaT2 = fecha(r.FECHA_BAJA) || true; else p.enAgendaT2 = true;
      n++;
    }
    console.log(`  T2/${h.padEnd(18)} ${n}`);
  }

  // ── 3) PLANTILLA: datos legales y periodos de empleo ──
  let nPl = 0;
  for (const r of filas(await hoja(F.plantilla, 'PLANTILLA'), 3)) {
    const nombre = s(r['APELLIDOS Y NOMBRE']) || s(r.TRABAJADOR);
    if (!nombre) continue;
    const p = P.ubicar(dniLimpio(r.DNI), nombre, r['TELÉFONO']);
    if (!p) { avisos.push(`Homonimo sin DNI en PLANTILLA fila ${r._fila}: ${nombre}`); continue; }
    P.poner(p, 'PLANTILLA', {
      nombre_ss: nulo(nombre, 200), dni_tipo: nulo(r['TIPO DNI'], 20), dni_nie: dniLimpio(r.DNI),
      fecha_nacimiento: fecha(r['FECHA NACIMIENTO']), sexo: nulo(r.SEXO, 10),
      estado_civil: nulo(r['E.CIVIL'], 30),
      pais_nacimiento: nulo(r['PAÍS NACIMIENTO'], 60), pais_nacimiento_codigo: nulo(r['COD.PAÍS NACIMIENTO'], 5),
      naf_provincia: nulo(r['NAF(PROV)'], 4), naf_numero: nulo(r['NAF(NÚM)'], 12), naf_control: nulo(r['NAF(D.CTR)'], 2),
      legajo: nulo(r.LEGAJO, 20),
      via_tipo: nulo(r['TIPO VÍA'], 20), via_nombre: nulo(r['VÍA PÚBLICA'], 120), via_numero: nulo(r['NÚMERO'], 10),
      escalera: nulo(r.ESCALERA, 10), piso: nulo(r.PISO, 10), puerta: nulo(r.PUERTA, 10),
      localidad: nulo(r.MUNICIPIO, 80), codigo_postal: nulo(r['COD.POSTAL'], 10),
      provincia: nulo(r.PROVINCIA, 80), pais: nulo(r['PAÍS'], 60), pais_codigo: nulo(r['COD.PAÍS'], 5),
      email: nulo(r['E-MAIL'], 160),
    });
    P.alias(p, 'ss_nombre', nombre);
    P.telefono(p, r['TELÉFONO'], 'agenda', false);
    const alta = fecha(r['FECHA INGRESO']);
    if (alta) p.empleos.push({ tipo: 'propia', alta, baja: fecha(r['FECHA BAJA']),
                               antiguedad: fecha(r['FECHA ANTIGÜEDAD']) });
    nPl++;
  }
  console.log(`  PLANTILLA${' '.repeat(13)}${nPl}`);

  // OJO: en esta hoja las CABECERAS NO CORRESPONDEN CON EL CONTENIDO.
  // La columna rotulada "Telefono" trae la fecha de ingreso, y la rotulada
  // "Fecha Ingreso" trae un estado ("NSPP", "SIGUE TRABAJANDO"). Se leen por
  // POSICION, no por nombre, y se deja constancia aqui para que nadie lo
  // "arregle" mas adelante creyendo que es un error.
  let nEtt = 0, ettSinFecha = 0;
  const wsEtt = await hoja(F.plantilla, 'PLANTILLA ETT');
  wsEtt.eachRow({ includeEmpty: false }, () => {});
  const filasEtt = [];
  wsEtt.eachRow({ includeEmpty: false }, (r, ri) => {
    if (ri < 2) return;
    filasEtt.push({ _fila: ri, nombre: s(r.getCell(1).value), dni: s(r.getCell(2).value),
                    ingreso: r.getCell(3).value, baja: r.getCell(4).value, estado: s(r.getCell(5).value) });
  });
  for (const r of filasEtt) {
    if (!r.nombre) continue;
    const p = P.ubicar(dniLimpio(r.dni), r.nombre, null);
    if (!p) { avisos.push(`Homonimo sin DNI en PLANTILLA ETT fila ${r._fila}: ${r.nombre}`); continue; }
    P.poner(p, 'PLANTILLA', { nombre: r.nombre, dni_nie: dniLimpio(r.dni) });
    P.alias(p, 'ss_nombre', r.nombre);
    const alta = fecha(r.ingreso);
    if (alta) p.empleos.push({ tipo: 'ett', alta, baja: fecha(r.baja), estadoEtt: r.estado });
    else ettSinFecha++;
    nEtt++;
  }
  console.log(`  PLANTILLA ETT${' '.repeat(9)}${nEtt}  (${ettSinFecha} sin fecha de ingreso legible)`);

  // ── 4) Las abandonadas: SOLO alias ──
  for (const [libro, h, et] of [
    [F.gestion, 'AGENDAV2', 'GC/AGENDAV2'],
    [F.operaciones, 'AGENDA_CONDUCTORES', 'OP/AGENDA'],
    [F.operaciones, 'CONDUCTORES_OUT', 'OP/OUT'],
  ]) {
    let n = 0;
    for (const r of filas(await hoja(libro, h))) {
      const nombre = s(r.NOMBRE_APELLIDOS);
      if (!nombre || !/[a-zá-úñ]/i.test(nombre)) continue;
      const p = P.buscar(dniLimpio(r.DNI_NIE), nombre, r.TELEFONO);
      if (!p) continue;             // no está en las que mandan: no se inventa
      P.alias(p, 'manual', nombre);
      P.alias(p, 'bolt_nombre', r.ID_BOLT);
      n++;
    }
    console.log(`  ${et.padEnd(21)}${n} alias`);
  }

  // ── Escritura ──
  console.log(NL + `══ ${P.gente.length} personas → PostgreSQL ══`);
  let creados = 0, nAlias = 0, nExt = 0, nTel = 0, nEmp = 0, ambiguos = 0;

  await db.transaccion(async cli => {
    // En PostgreSQL cualquier error aborta la transaccion entera. Los INSERT que
    // pueden fallar POR DISENO (telefono ya usado, alias en conflicto) van en un
    // punto de guardado para poder seguir con el resto de la carga.
    const intentar = async (sql, params, alFallar) => {
      await cli.query('SAVEPOINT sp');
      try {
        const r = await cli.query(sql, params);
        await cli.query('RELEASE SAVEPOINT sp');
        return r;
      } catch (err) {
        await cli.query('ROLLBACK TO SAVEPOINT sp');
        if (alFallar) alFallar(err);
        return null;
      }
    };

    for (const p of P.gente) {
      const v = k => P.val(p, k);
      const completo = v('nombre') || p.nombre;
      // La agenda guarda "APELLIDOS, NOMBRE" junto; se parte por la coma si la hay.
      let nom = completo, ape = null;
      if (completo.includes(',')) {
        const t = completo.split(',');
        ape = t[0].trim(); nom = t.slice(1).join(',').trim();
      }
      const r = await intentar(
        `INSERT INTO conductor (nombre, apellidos, nombre_ss, dni_tipo, dni_nie, fecha_nacimiento,
           sexo, estado_civil, pais_nacimiento, pais_nacimiento_codigo,
           naf_provincia, naf_numero, naf_control, legajo,
           via_tipo, via_nombre, via_numero, escalera, piso, puerta,
           localidad, codigo_postal, provincia, pais, pais_codigo,
           email, tel_emergencia, recomendador, observaciones)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
         RETURNING id`,
        [nom.slice(0, 80), ape && ape.slice(0, 120), v('nombre_ss'), v('dni_tipo'), v('dni_nie'),
         v('fecha_nacimiento'), v('sexo'), v('estado_civil'), v('pais_nacimiento'), v('pais_nacimiento_codigo'),
         v('naf_provincia'), v('naf_numero'), v('naf_control'), v('legajo'),
         v('via_tipo'), v('via_nombre'), v('via_numero'), v('escalera'), v('piso'), v('puerta'),
         v('localidad'), v('codigo_postal'), v('provincia'), v('pais'), v('pais_codigo'),
         v('email'), v('tel_emergencia'), v('recomendador'), v('observaciones')],
        err => avisos.push(`Conductor no creado (${completo}): ${primeraLinea(err)}`));
      if (!r) continue;
      const id = r.rows[0].id;
      creados++;
      if (p.nombreAmbiguo) ambiguos++;

      for (const a of p.alias.values()) {
        const ok = await intentar(
          `INSERT INTO conductor_alias (conductor_id, tipo, alias, alias_norm, ambiguo)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [id, a.tipo, a.alias.slice(0, 200), a.norm.slice(0, 200), p.nombreAmbiguo],
          () => avisos.push(`Alias en conflicto: "${a.alias}" (${completo})`));
        if (ok) nAlias++;
      }

      for (const e of p.externos.values()) {
        const ok = await intentar(
          `INSERT INTO conductor_externo (conductor_id, sistema, externo_id, externo_nombre, estado_externo)
           VALUES ($1,$2,$3,$4,$5)`,
          [id, e.sistema, e.externo_id.slice(0, 64), e.nombre.slice(0, 200), e.estado],
          () => avisos.push(`ID externo repetido: ${e.sistema}/${e.externo_id.slice(0, 8)} (${completo})`));
        if (ok) nExt++;
      }

      let principal = true;
      const tels = [...p.telefonos.values()].sort((a, b) => (b.activo ? 1 : 0) - (a.activo ? 1 : 0));
      for (const t of tels) {
        const ok = await intentar(
          `INSERT INTO conductor_telefono (conductor_id, e164, origen, principal) VALUES ($1,$2,$3,$4)`,
          [id, t.e164.slice(0, 20), t.origen, principal],
          () => avisos.push(`Telefono ya usado por otra persona: ${completo} (${t.origen})`));
        if (ok) { nTel++; principal = false; }
      }

      // Un solo periodo abierto: se ordenan y se cierra todo menos el último.
      const emp = p.empleos.sort((a, b) => a.alta.localeCompare(b.alta));
      for (let i = 0; i < emp.length; i++) {
        const e = emp[i];
        let baja = e.baja;
        if (!baja && i < emp.length - 1) baja = emp[i + 1].alta;
        // Está en CONDUCTORES_OUT y no en la agenda viva: se cierra el periodo.
        if (!baja && i === emp.length - 1 && p.bajaT2 && !p.enAgendaT2) {
          baja = typeof p.bajaT2 === 'string' ? p.bajaT2 : e.alta;
        }
        const ok = await intentar(
          `INSERT INTO conductor_periodo_empleo (conductor_id, tipo, alta, baja, fecha_antiguedad)
           VALUES ($1,$2,$3,$4,$5)`,
          [id, e.tipo, e.alta, baja, e.antiguedad || null],
          err => avisos.push(`Periodo no cargado (${completo}): ${primeraLinea(err)}`));
        if (ok) nEmp++;
      }
    }
    await cli.query(`UPDATE conductor c SET empleo_vigente = EXISTS
      (SELECT 1 FROM conductor_periodo_empleo e WHERE e.conductor_id = c.id AND e.baja IS NULL)`);
  });

  console.log(`  conductores ${creados} · alias ${nAlias} · IDs externos ${nExt} · telefonos ${nTel} · empleos ${nEmp}`);
  console.log(`  con nombre ambiguo (homonimos): ${ambiguos}`);

  const q = await db.consulta(`SELECT
    (SELECT count(*) FROM conductor WHERE NOT es_centinela)                        total,
    (SELECT count(*) FROM conductor WHERE empleo_vigente)                          empleados,
    (SELECT count(*) FROM conductor WHERE dni_nie IS NULL AND NOT es_centinela)    sin_dni,
    (SELECT count(*) FROM conductor WHERE email IS NOT NULL)                       con_email,
    (SELECT count(*) FROM conductor WHERE legajo IS NOT NULL)                      con_legajo,
    (SELECT count(DISTINCT conductor_id) FROM conductor_externo WHERE sistema='bolt') con_uuid_bolt,
    (SELECT count(DISTINCT conductor_id) FROM conductor_telefono)                  con_telefono,
    (SELECT count(*) FROM conductor_periodo_empleo WHERE tipo='ett')               periodos_ett,
    (SELECT count(*) FROM conductor_alias WHERE ambiguo)                           alias_ambiguos`);
  console.log(NL + '══ EN LA BASE ══');
  Object.entries(q.rows[0]).forEach(([k, val]) => console.log(`  ${k.padEnd(15)} ${val}`));

  if (avisos.length) {
    const tipos = {};
    avisos.forEach(a => { const t = a.split(/[:(]/)[0].trim(); tipos[t] = (tipos[t] || 0) + 1; });
    console.log(NL + `══ ${avisos.length} avisos ══`);
    Object.entries(tipos).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${n}× ${t}`));
    console.log(NL + '  primeros:');
    avisos.slice(0, 8).forEach(a => console.log('    · ' + a));
  }
  await db.cerrar();
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
