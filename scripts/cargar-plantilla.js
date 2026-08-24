// ============================================================
// CARGA DE LA PLANTILLA desde el fichero de RRHH
// ============================================================
//   node scripts/cargar-plantilla.js ["ruta/al/PLANTILLA TRABAJADORES.xlsx"]
//
//   --simular                hacerlo todo y deshacerlo: ensena los numeros y
//                            los avisos sin dejar nada escrito
//   --ett-desde=AAAA-MM-DD   fecha de alta para los ETT (ver abajo)
//   --forzar                 cargar aunque ya haya gente en la base
//
// Sustituye a `cargar-conductores.js`, que cruzaba cuatro Excels por nombre
// para adivinar quien era quien. Aqui no se adivina: hay UN fichero, y la
// identidad es el DNI, que viene en el 100% de las filas de las dos pestañas
// de personas.
//
// Las cuatro pestañas y lo que aporta cada una:
//
//   PLANTILLA       contratados por TIBUS. 40 columnas: identidad, direccion,
//                   NAF, contrato y fechas. Trae tambien a quien ya causo baja,
//                   y eso NO se descarta: es el historial de empleo, que es lo
//                   unico que no se puede reconstruir despues.
//   PLANTILLA ETT   contratados por la ETT. Solo nombre, DNI, telefono y baja.
//   BAJAS MEDICAS   quien esta de baja. Cruza por NAF, y si no por legajo.
//   VACACIONES      quien esta o estuvo de vacaciones. Cruza por DNI.
//
// LO QUE ESTE FICHERO NO TRAE, y conviene saberlo antes de fiarse de la carga:
//
//   · El fin del periodo de prueba. No esta en ninguna de las 40 columnas.
//   · Las coordenadas. La direccion viene entera, pero sin lat/lng.
//   · La fecha de ingreso de los ETT. La columna que se llama asi contiene en
//     realidad el motivo de la baja. Sin --ett-desde no se les crea periodo de
//     empleo, y por tanto no constan como empleados.
//
// Turnos y libranzas no se cargan a proposito: se asignan a mano.

const ExcelJS = require('exceljs');
const db = require('../services/db');
const { normClave } = require('../services/conductores');

const arg = n => (process.argv.find(a => a.startsWith('--' + n + '=')) || '').split('=')[1] || '';
const RUTA = process.argv.slice(2).find(a => !a.startsWith('--')) ||
             'C:/Users/ricar/Downloads/PLANTILLA TRABAJADORES.xlsx';
const ETT_DESDE = arg('ett-desde');
const FORZAR = process.argv.includes('--forzar');
const SIMULAR = process.argv.includes('--simular');
const NL = String.fromCharCode(10);

// ── Lectura de celdas ───────────────────────────────────────────────────────
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

// Emojis fuera: el estado de vacaciones viene con ellos y en la base no pintan
// nada, ademas de estropear cualquier comparacion.
const limpio = v => s(v).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();
const nulo = (v, max) => { const x = limpio(v); return x === '' ? null : (max ? x.slice(0, max) : x); };

// `00/00/0000` y `31/12/2099` son huecos disfrazados de fecha: el primero es el
// "sin baja" del programa de nominas y el segundo su "indefinido". Tratarlos
// como fechas mete a gente de baja en el año cero.
const HUECOS = /^(00\/00\/0000|31\/12\/2099|0000-00-00)$/;

function fecha(v) {
  const t = s(v);
  if (!t || HUECOS.test(t)) return null;
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    // Un año fuera de rango es un error de tecleo, no una fecha. Se descarta:
    // mejor un hueco visible que un dato falso que nadie va a revisar.
    if (Number(m[3]) < 1930 || Number(m[3]) > 2035) return null;
    return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Number(m[1]) < 1930 || Number(m[1]) > 2035 ? null : m[0];
}

const dniLimpio = v => {
  const x = limpio(v).toUpperCase().replace(/[^0-9A-Z]/g, '');
  return x.length >= 6 ? x : null;
};
const tel9 = v => { const d = limpio(v).replace(/[^0-9]/g, ''); return d.length >= 9 ? d.slice(-9) : null; };
const e164 = v => { const t = tel9(v); return t ? '+34' + t : null; };
const nafDe = r => {
  const p = limpio(r['NAF(Prov)']), n = limpio(r['NAF(Núm)']), c = limpio(r['NAF(D.Ctr)']);
  return p && n ? (p + n + c).replace(/[^0-9]/g, '') : null;
};

// "RUIZ CANO, JUAN FRANCISCO" -> apellidos + nombre.
function parte(completo) {
  const t = limpio(completo);
  if (!t.includes(',')) return { nombre: t.slice(0, 80), apellidos: null };
  const trozos = t.split(',');
  return {
    nombre: trozos.slice(1).join(',').trim().slice(0, 80),
    apellidos: trozos[0].trim().slice(0, 120),
  };
}

// La jornada sale del contrato y del coeficiente de tiempo parcial: completo
// son 40 h, y 800 es el 80% de esas 40. Cuando los dos se contradicen no se
// inventa un numero: se deja vacio y se avisa.
function jornada(r, avisa) {
  const c = (limpio(r['Contrato']) || '').toUpperCase();
  const k = Number(limpio(r['Coeficiente Tiempo Parcial']) || 0);
  const completo = /COMPLETO/.test(c), parcial = /PARCIAL/.test(c);
  if (completo && !k) return 40;
  if (parcial && k > 0 && k < 1000) return Math.round(40 * k / 1000);
  if (completo || parcial) {
    avisa('contrato "' + c + '" con coeficiente ' + (k || '000') + ': no se puede deducir la jornada');
  }
  return null;
}

(async () => {
  const avisos = [];
  const avisar = m => avisos.push(m);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(RUTA);

  // Cada pestaña con su fila de cabecera. Si el fichero cambia de forma, esto
  // falla en voz alta y no a medias.
  const leer = (nombre, hCab) => {
    const ws = wb.getWorksheet(nombre);
    if (!ws) throw new Error('Falta la pestaña ' + nombre + ' en ' + RUTA);
    const cab = ws.getRow(hCab).values.slice(1).map(s);
    const filas = [];
    for (let i = hCab + 1; i <= ws.rowCount; i++) {
      const v = ws.getRow(i).values.slice(1);
      if (cab.map((c, k) => (c ? s(v[k]) : '')).filter(Boolean).length < 3) continue;
      const o = { _fila: i };
      cab.forEach((c, k) => { if (c) o[c] = v[k]; });
      filas.push(o);
    }
    return filas;
  };

  const P = leer('PLANTILLA', 3);
  const E = leer('PLANTILLA ETT', 1);
  const B = leer('BAJAS MEDICAS', 1);
  const V = leer('VACACIONES', 1);

  console.log(NL + RUTA);
  console.log('  PLANTILLA ' + P.length + ' · ETT ' + E.length +
              ' · BAJAS ' + B.length + ' · VACACIONES ' + V.length + NL);

  // ── Nadie carga dos veces sin querer ──
  const ya = await db.consulta(`SELECT count(*)::int n FROM conductor WHERE NOT es_centinela`);
  if (ya.rows[0].n && !FORZAR) {
    console.log('Ya hay ' + ya.rows[0].n + ' persona(s) en la base. Vacia primero:');
    console.log('  node scripts/vaciar-conductores.js --si');
    console.log('...o pasa --forzar si de verdad quieres añadir encima.' + NL);
    return;
  }

  const idPorDni = new Map();      // DNI -> id de conductor
  const idPorNaf = new Map();      // NAF completo -> id, para las bajas medicas
  const idPorLegajo = new Map();   // legajo sin ceros -> id, de reserva

  // Un fallo esperado no puede tumbar la transaccion entera: cada insercion va
  // en su propio punto de guardado.
  let nPaso = 0;
  const intentar = async (sql, args, alFallar) => {
    const punto = 'p' + (++nPaso);
    await db.consulta('SAVEPOINT ' + punto);
    try {
      const r = await db.consulta(sql, args);
      await db.consulta('RELEASE SAVEPOINT ' + punto);
      return r;
    } catch (e) {
      await db.consulta('ROLLBACK TO SAVEPOINT ' + punto);
      alFallar(String(e.message).split(NL)[0]);
      return null;
    }
  };

  await db.consulta('BEGIN');
  try {
    // ── 1) Las personas contratadas por TIBUS ──
    let nP = 0;
    for (const r of P) {
      const completo = limpio(r['Apellidos y Nombre']) || limpio(r['TRABAJADOR']);
      const dni = dniLimpio(r['DNI']);
      if (!completo) continue;
      if (!dni) { avisar('PLANTILLA fila ' + r._fila + ': sin DNI (' + completo + ')'); continue; }
      if (idPorDni.has(dni)) { avisar('PLANTILLA fila ' + r._fila + ': DNI repetido ' + dni + ' (' + completo + ')'); continue; }

      const n = parte(completo);
      const q = await intentar(
        `INSERT INTO conductor (nombre, apellidos, nombre_ss, dni_tipo, dni_nie, fecha_nacimiento,
           sexo, estado_civil, pais_nacimiento, pais_nacimiento_codigo,
           naf_provincia, naf_numero, naf_control, legajo,
           via_tipo, via_nombre, via_numero, escalera, piso, puerta,
           localidad, codigo_postal, provincia, pais, pais_codigo, email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
         RETURNING id`,
        [n.nombre, n.apellidos, nulo(completo, 200), nulo(r['Tipo DNI'], 20), dni,
         fecha(r['Fecha Nacimiento']), nulo(r['Sexo'], 10), nulo(r['E.Civil'], 30),
         nulo(r['País Nacimiento'], 60), nulo(r['Cod.País Nacimiento'], 5),
         nulo(r['NAF(Prov)'], 4), nulo(r['NAF(Núm)'], 12), nulo(r['NAF(D.Ctr)'], 2),
         nulo(r['Legajo'], 20),
         nulo(r['Tipo Vía'], 20), nulo(r['Vía Pública'], 120), nulo(r['Número'], 10),
         nulo(r['Escalera'], 10), nulo(r['Piso'], 10), nulo(r['Puerta'], 10),
         nulo(r['Municipio'], 80), nulo(r['Cod.Postal'], 10), nulo(r['Provincia'], 80),
         nulo(r['País'], 60), nulo(r['Cod.País'], 5), nulo(r['E-Mail'], 160)],
        e => avisar('PLANTILLA fila ' + r._fila + ' (' + completo + '): ' + e));
      if (!q) continue;

      const id = q.rows[0].id;
      idPorDni.set(dni, id);
      const naf = nafDe(r); if (naf) idPorNaf.set(naf, id);
      const leg = limpio(r['Legajo']); if (leg) idPorLegajo.set(String(Number(leg)), id);
      nP++;

      // El nombre como lo escribe la Seguridad Social. Sirve para reconocerle
      // en los ficheros de la gestoria, no para identificarle.
      await intentar(
        `INSERT INTO conductor_alias (conductor_id, tipo, alias, alias_norm)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [id, 'ss_nombre', completo.slice(0, 200), normClave(completo).slice(0, 200)],
        e => avisar('alias de ' + completo + ': ' + e));

      const tel = e164(r['Teléfono']);
      if (tel) {
        await intentar(
          `INSERT INTO conductor_telefono (conductor_id, e164, origen, principal)
           VALUES ($1,$2,$3,TRUE)`,
          [id, tel, 'rrhh'], e => avisar('telefono de ' + completo + ': ' + e));
      } else {
        avisar('Sin telefono: ' + completo + ' — no se podra cruzar con BOLT');
      }

      // El periodo de empleo. La baja viene en la misma fila, asi que quien ya
      // se fue entra con su periodo cerrado y no como un hueco.
      const alta = fecha(r['Fecha Ingreso']);
      if (!alta) { avisar('Sin fecha de ingreso: ' + completo); continue; }
      const ant = fecha(r['Fecha Antigüedad']);
      await intentar(
        `INSERT INTO conductor_periodo_empleo
           (conductor_id, tipo, alta, baja, fecha_antiguedad, jornada_horas)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, 'propia', alta, fecha(r['Fecha Baja']),
         ant && ant !== alta ? ant : null,
         jornada(r, m => avisar(completo + ': ' + m))],
        e => avisar('periodo de ' + completo + ': ' + e));
    }
    console.log('  PLANTILLA        ' + nP + ' personas');

    // ── 2) Las personas contratadas por la ETT ──
    // Traen mucho menos: nombre, DNI, telefono y, si se fueron, la fecha. La
    // columna "Fecha Ingreso" NO es una fecha: contiene el estado (SIGUE
    // TRABAJANDO, NSPP, BAJA VOLUNTARIA), asi que de ahi sale el motivo de la
    // baja y no el alta.
    let nE = 0, sinAlta = 0;
    for (const r of E) {
      const completo = limpio(r['TRABAJADOR']);
      const dni = dniLimpio(r['DNI']);
      if (!completo) continue;
      if (!dni) { avisar('ETT fila ' + r._fila + ': sin DNI (' + completo + ')'); continue; }

      let id = idPorDni.get(dni);
      if (id) {
        avisar(completo + ' sale en PLANTILLA y en ETT: se le añade el periodo de ETT');
      } else {
        const n = parte(completo);
        const q = await intentar(
          'INSERT INTO conductor (nombre, apellidos, nombre_ss, dni_nie) VALUES ($1,$2,$3,$4) RETURNING id',
          [n.nombre, n.apellidos, nulo(completo, 200), dni],
          e => avisar('ETT fila ' + r._fila + ' (' + completo + '): ' + e));
        if (!q) continue;
        id = q.rows[0].id;
        idPorDni.set(dni, id);
        await intentar(
          `INSERT INTO conductor_alias (conductor_id, tipo, alias, alias_norm)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [id, 'ss_nombre', completo.slice(0, 200), normClave(completo).slice(0, 200)],
          e => avisar('alias ETT de ' + completo + ': ' + e));
      }
      nE++;

      const tel = e164(r['Telefono']);
      if (tel) {
        await intentar(
          `INSERT INTO conductor_telefono (conductor_id, e164, origen, principal)
           VALUES ($1,$2,$3,TRUE)`,
          [id, tel, 'rrhh'], () => {});
      }

      const baja = fecha(r['Fecha Baja']);
      const motivo = nulo(r['Fecha Ingreso'], 255);   // mal etiquetada: es el motivo
      if (!ETT_DESDE) { sinAlta++; continue; }
      await intentar(
        `INSERT INTO conductor_periodo_empleo (conductor_id, tipo, alta, baja, motivo_baja)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, 'ett', ETT_DESDE, baja, baja ? motivo : null],
        e => avisar('periodo ETT de ' + completo + ': ' + e));
    }
    console.log('  PLANTILLA ETT    ' + nE + ' personas' +
      (sinAlta ? ' · ' + sinAlta + ' SIN periodo de empleo (falta --ett-desde)' : ''));

    // ── 3) Quien esta de baja medica ──
    // Cruza por NAF; si no, por legajo. Nunca por nombre: si no cuadra por una
    // de las dos claves, se avisa y se queda fuera.
    let nB = 0;
    for (const r of B) {
      const nombre = limpio(r['Nombre Trabajador']);
      const naf = limpio(r['Afiliación Trabajador']).replace(/[^0-9]/g, '');
      const leg = limpio(r['Código Trabajador']);
      const id = idPorNaf.get(naf) || idPorLegajo.get(String(Number(leg)));
      if (!id) { if (nombre) avisar('BAJA MEDICA sin cuadrar: ' + nombre + ' (NAF ' + (naf || '?') + ')'); continue; }

      const desde = fecha(r['Fecha Inicio IT']);
      if (!desde) { avisar('BAJA MEDICA sin fecha de inicio: ' + nombre); continue; }
      // El fin previsto es informativo y NO cierra la ausencia: una baja medica
      // se cierra el dia que la persona vuelve, no el dia que decia el parte.
      const ok = await intentar(
        `INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta_previsto, motivo)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, 'baja_medica', desde, fecha(r['Fecha Tentativa Fin IT']), nulo(r['Tipo de Contingencia'], 255)],
        e => avisar('baja medica de ' + nombre + ': ' + e));
      if (ok) nB++;
    }
    console.log('  BAJAS MEDICAS    ' + nB + ' de ' + B.length);

    // ── 4) Vacaciones ──
    let nV = 0;
    for (const r of V) {
      const nombre = limpio(r['TRABAJADOR']);
      const dni = dniLimpio(r['DNI']);
      const id = dni ? idPorDni.get(dni) : null;
      if (!id) { if (nombre) avisar('VACACIONES sin cuadrar: ' + nombre); continue; }
      const desde = fecha(r['Inicio']), hasta = fecha(r['Fin']);
      if (!desde) {
        avisar('VACACIONES sin fecha de inicio: ' + nombre + ' (estado "' + (limpio(r['Estado']) || '-') + '")');
        continue;
      }
      if (!hasta) avisar('VACACIONES sin fecha de fin: ' + nombre);
      // El solape lo impide el esquema a proposito: nadie puede estar de baja
      // medica y de vacaciones el mismo dia. Cuando salta, hay que mirarlo.
      const ok = await intentar(
        `INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta) VALUES ($1,$2,$3,$4)`,
        [id, 'vacaciones', desde, hasta],
        e => avisar('vacaciones de ' + nombre + ': ' + e));
      if (ok) nV++;
    }
    console.log('  VACACIONES       ' + nV + ' de ' + V.length);

    // ── 5) Quien esta contratado ahora mismo ──
    const vig = await db.consulta(
      `UPDATE conductor c SET empleo_vigente = EXISTS
         (SELECT 1 FROM conductor_periodo_empleo e WHERE e.conductor_id = c.id AND e.baja IS NULL)
       WHERE NOT c.es_centinela`);
    console.log('  ' + vig.rowCount + ' fichas repasadas');

    // ── Resumen ──
    // Se cuenta DENTRO de la transaccion: si se esta simulando, despues de
    // deshacerla ya no habria nada que contar.
    const r = await db.consulta(
      `SELECT (SELECT count(*) FROM conductor WHERE NOT es_centinela)                personas,
              (SELECT count(*) FROM conductor WHERE empleo_vigente)                  empleados,
              (SELECT count(*) FROM conductor_periodo_empleo WHERE tipo = $1)        periodos_propia,
              (SELECT count(*) FROM conductor_periodo_empleo WHERE tipo = $2)        periodos_ett,
              (SELECT count(*) FROM conductor_periodo_empleo WHERE baja IS NOT NULL) periodos_cerrados,
              (SELECT count(*) FROM conductor_telefono)                              telefonos,
              (SELECT count(*) FROM conductor_estado_hist WHERE estado = $3)         bajas_medicas,
              (SELECT count(*) FROM conductor_estado_hist WHERE estado = $4)         vacaciones`,
      ['propia', 'ett', 'baja_medica', 'vacaciones']);
    console.log(NL + (SIMULAR ? 'QUEDARIA ASI' : 'EN LA BASE'));
    for (const [k, v] of Object.entries(r.rows[0])) console.log('  ' + String(v).padStart(6) + '  ' + k);

    // Simular hace el trabajo entero y luego lo deshace. Es la forma de ver los
    // avisos y los numeros de un fichero nuevo sin comprometerse con el.
    await db.consulta(SIMULAR ? 'ROLLBACK' : 'COMMIT');
    if (SIMULAR) console.log(NL + 'SIMULACION: no se ha escrito nada.');
  } catch (e) {
    await db.consulta('ROLLBACK');
    throw e;
  }

  if (avisos.length) {
    console.log(NL + avisos.length + ' AVISO(S)');
    // Se agrupan los repetidos: veinte veces el mismo problema es un problema,
    // no veinte problemas.
    const grupos = {};
    avisos.forEach(a => { const k = a.replace(/^[^:]*: /, ''); (grupos[k] = grupos[k] || []).push(a); });
    Object.entries(grupos).sort((a, b) => b[1].length - a[1].length).slice(0, 25)
      .forEach(([k, l]) => console.log('  ' + String(l.length).padStart(3) + ' x  ' + (l.length > 1 ? k : l[0])));
  }

  console.log(NL + 'FALTA POR HACER A MANO:');
  console.log('  · turnos y libranzas');
  console.log('  · enlazar con BOLT por telefono');
  console.log('  · asignar coches y plazas' + NL);
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
