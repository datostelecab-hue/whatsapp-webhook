// ============================================================
// ETT — Bolsa de empleo (empresa de trabajo temporal)
// ============================================================
// Flujo distinto al de Selección normal: la ETT nos manda una TABLA por correo (no
// Excel) con datos básicos de los candidatos. Selección marca si se presentó, si se
// contrata o si no pasa, y para los contratados añade FECHA DE ALTA, JORNADA, TURNO y
// ZONA. Luego se reexporta la matriz para responder a la ETT por el mismo hilo.
//
// Estos candidatos NO se pueden dar de alta en BOLT todavía (faltan documentos que la
// ETT entrega tras el alta en SS). Aun así hay que poder PLANIFICARLOS: la ficha se
// crea con un ID_BOLT provisional (el nombre) y, cuando el conductor aparece en BOLT
// —cruzando por TELÉFONO—, se le pone el ID de BOLT real. (Eso son los pasos 2 y 3;
// aquí, paso 1, solo la entrada de Selección.)
//
// Hoja propia "ETT_CANDIDATOS" en el mismo libro del Planificador. Clave: teléfono (9 díg.).

const { readSheet, writeSheet, writeSheetRaw, appendRows, ensureSheet } = require('./sheets');
const { SPREADSHEET_PLANIFICADOR } = require('./planificadorV2');

const ID = SPREADSHEET_PLANIFICADOR;
const HOJA = 'ETT_CANDIDATOS';
const RANGO = `${HOJA}!A:U`;
const TZ = 'Europe/Madrid';

// Esquema de la hoja (orden lógico; el parser de la matriz mapea por su propia posición).
const COL = {
  telefono: 0, nombre: 1, dni: 2, correo: 3, direccion: 4, cp: 5,
  fecha_entrevista: 6, hora_entrevista: 7, jornada_ett: 8, turno_ett: 9,
  estado: 10, fecha_alta: 11, jornada: 12, turno: 13, zona: 14,
  bolt_estado: 15, id_bolt: 16, ficha: 17, creado: 18, actualizado: 19, notas: 20
};
const N_COLS = 21;
const CABECERA = [
  'TELEFONO', 'NOMBRE', 'DNI/NIE', 'CORREO', 'DIRECCION', 'CP',
  'FECHA_ENTREVISTA', 'HORA_ENTREVISTA', 'JORNADA_ETT', 'TURNO_ETT',
  'ESTADO', 'FECHA_ALTA', 'JORNADA', 'TURNO', 'ZONA',
  'BOLT_ESTADO', 'ID_BOLT', 'FICHA', 'CREADO', 'ACTUALIZADO', 'NOTAS'
];

// Estados del candidato ETT (decisiones de Selección).
const ESTADOS = ['Pendiente', 'No se presentó', 'Presentó', 'Contratado', 'No pasa'];

// ── Utilidades ──────────────────────────────────────────────────────────────
const colLetra = i => String.fromCharCode(65 + i);   // 0→A … 20→U (una sola letra basta)
function normalizarTel(t) { const d = String(t == null ? '' : t).replace(/\D/g, ''); return d.length > 9 ? d.slice(-9) : d; }
function ahora() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

function filaAObjeto(row, i) {
  const o = { _fila: i + 1 };
  for (const [k, ci] of Object.entries(COL)) o[k] = (row[ci] == null ? '' : row[ci]).toString().trim();
  return o;
}

async function ensureHoja() {
  await ensureSheet(ID, HOJA);
  const filas = await readSheet(ID, `${HOJA}!A1:U1`);
  if (!filas.length || !(filas[0] || []).length) await writeSheetRaw(ID, `${HOJA}!A1`, [CABECERA]);
}

// ── Lectura ─────────────────────────────────────────────────────────────────
async function leer() {
  await ensureHoja();
  const filas = await readSheet(ID, RANGO);
  const lista = [];
  for (let i = 1; i < filas.length; i++) {
    const tel = normalizarTel((filas[i] || [])[COL.telefono]);
    if (!tel) continue;
    lista.push(filaAObjeto(filas[i], i));
  }
  // Los más nuevos abajo; los mostramos con los "Pendiente"/"Presentó" primero.
  return lista;
}

async function datos() {
  const lista = await leer();
  const cont = e => lista.filter(c => c.estado === e).length;
  return {
    lista,
    resumen: {
      total: lista.length,
      pendientes: cont('Pendiente') + cont('Presentó'),
      contratados: cont('Contratado'),
      noPasan: cont('No pasa'),
      noPresentados: cont('No se presentó')
    }
  };
}

// ── Importar la matriz pegada del correo ────────────────────────────────────
// Orden de columnas de la matriz de la ETT:
//   0 Fecha Entrevista · 1 Hora · 2 JORNADA(ett) · 3 TURNO(ett) · 4 Nombre · 5 DNI/NIE ·
//   6 Teléfono · 7 Dirección · 8 CP · 9 Correo · [10 FECHA ALTA · 11 JORNADA · 12 TURNO · 13 ZONA]
function parsearMatriz(texto) {
  const filas = [];
  for (const linea of String(texto || '').split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const c = linea.split('\t').map(s => s.trim());
    if (c.length < 7) continue;                        // no parece una fila de la matriz
    const tel = normalizarTel(c[6]);
    if (tel.length !== 9) continue;                    // cabecera o fila sin teléfono válido
    const round2 = c.slice(10).join(' ');
    const noPresento = /no se present/i.test(round2);
    filas.push({
      telefono: tel,
      fecha_entrevista: c[0] || '', hora_entrevista: c[1] || '',
      jornada_ett: c[2] || '', turno_ett: c[3] || '',
      nombre: c[4] || '', dni: (c[5] || '').toUpperCase(),
      direccion: c[7] || '', cp: c[8] || '', correo: c[9] || '',
      fecha_alta: noPresento ? '' : (c[10] || ''), jornada: noPresento ? '' : (c[11] || ''),
      turno: noPresento ? '' : (c[12] || ''), zona: noPresento ? '' : (c[13] || ''),
      estadoSugerido: noPresento ? 'No se presentó' : null
    });
  }
  return filas;
}

function filaNueva(p) {
  const fila = new Array(N_COLS).fill('');
  fila[COL.telefono] = p.telefono;
  fila[COL.nombre] = p.nombre; fila[COL.dni] = p.dni; fila[COL.correo] = p.correo;
  fila[COL.direccion] = p.direccion; fila[COL.cp] = p.cp;
  fila[COL.fecha_entrevista] = p.fecha_entrevista; fila[COL.hora_entrevista] = p.hora_entrevista;
  fila[COL.jornada_ett] = p.jornada_ett; fila[COL.turno_ett] = p.turno_ett;
  fila[COL.estado] = p.estadoSugerido || 'Pendiente';
  fila[COL.fecha_alta] = p.fecha_alta; fila[COL.jornada] = p.jornada;
  fila[COL.turno] = p.turno; fila[COL.zona] = p.zona;
  fila[COL.creado] = ahora(); fila[COL.actualizado] = ahora();
  return fila;
}

// Añade los candidatos NUEVOS (por teléfono). Los que ya existen se dejan intactos
// (para no pisar la decisión de Selección) y se cuentan como "ya estaban".
async function importar(texto) {
  const parsed = parsearMatriz(texto);
  await ensureHoja();
  const filas = await readSheet(ID, RANGO);
  const existentes = new Set();
  for (let i = 1; i < filas.length; i++) { const t = normalizarTel((filas[i] || [])[COL.telefono]); if (t) existentes.add(t); }
  const vistos = new Set();
  const nuevas = [];
  let yaEstaban = 0;
  for (const p of parsed) {
    if (existentes.has(p.telefono) || vistos.has(p.telefono)) { yaEstaban++; continue; }
    vistos.add(p.telefono);
    nuevas.push(filaNueva(p));
  }
  if (nuevas.length) await appendRows(ID, RANGO, nuevas);
  return { añadidos: nuevas.length, yaEstaban, total: parsed.length };
}

// ── Edición desde el panel ──────────────────────────────────────────────────
async function localizarFila(tel) {
  const t = normalizarTel(tel);
  if (!t) return null;
  const filas = await readSheet(ID, `${HOJA}!A:A`);
  for (let i = 1; i < filas.length; i++) if (normalizarTel((filas[i] || [])[0]) === t) return i + 1;
  return null;
}
const tocar = fila => writeSheet(ID, `${HOJA}!${colLetra(COL.actualizado)}${fila}`, [[ahora()]]);

async function guardarDecision(tel, estado) {
  if (!ESTADOS.includes(estado)) throw new Error('Estado no válido: ' + estado);
  const fila = await localizarFila(tel);
  if (!fila) throw new Error('No encuentro ese candidato');
  await writeSheet(ID, `${HOJA}!${colLetra(COL.estado)}${fila}`, [[estado]]);
  await tocar(fila);
  return { ok: true, estado };
}

// Guarda los 4 campos que crea Selección (contiguos: FECHA_ALTA..ZONA = L:O).
async function guardarCampos(tel, campos = {}) {
  const fila = await localizarFila(tel);
  if (!fila) throw new Error('No encuentro ese candidato');
  const v = [[(campos.fecha_alta || '').toString().trim(), (campos.jornada || '').toString().trim(),
  (campos.turno || '').toString().trim(), (campos.zona || '').toString().trim()]];
  await writeSheet(ID, `${HOJA}!${colLetra(COL.fecha_alta)}${fila}:${colLetra(COL.zona)}${fila}`, v);
  await tocar(fila);
  return { ok: true };
}

// ── Pasar a RRHH: la ficha se crea en PostgreSQL ────────────────────────────
//
// Hasta aquí el candidato solo existía en esta hoja. Al contratarlo se convierte
// en una ficha de verdad, la misma tabla en la que están los de TIBUS: es la
// MISMA persona y a los tres meses pasará a plantilla propia sin cambiar de
// ficha, arrastrando la antigüedad de la ETT.
//
// De la ETT viene menos información que de Selección: nombre, DNI, teléfono,
// correo, dirección y código postal. Lo que falte se rellena luego desde la
// ficha, que es editable. Lo que NO puede faltar es la fecha de alta.

/** "40 HORAS" -> 40. Es lo único numérico que hay en esa celda. */
const horasDe = v => { const m = String(v == null ? '' : v).match(/(\d{1,2})/); return m ? Number(m[1]) : null; };

/** dd/mm/aaaa -> aaaa-mm-dd. La hoja la escribe a la española; la base la quiere ISO. */
function aIso(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[0] : null;
}

const sinTildes = s => String(s == null ? '' : s).normalize('NFD')
  .replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Crea (o restaura) la ficha del candidato contratado y la deja en PostgreSQL.
 *
 * El nombre de la ETT no se adivina: viene en `ettNombre` o en la variable de
 * entorno ETT_NOMBRE. Inventarlo dejaria un contrato firmado por una empresa que
 * no existe.
 */
async function pasarARRHH(tel, { ettNombre, usuarioId, rol } = {}) {
  const alta = require('./repo/alta');
  const con = require('./repo/conductores');

  const t9 = normalizarTel(tel);
  const c = (await leer()).find(x => x.telefono === t9);
  if (!c) throw new Error('No encuentro ese candidato');
  if (c.ficha) throw new Error(`Ya tiene ficha creada (nº ${c.ficha})`);
  if (c.estado !== 'Contratado') {
    throw new Error(`Solo se pasa a RRHH a quien está "Contratado"; este está "${c.estado || 'sin estado'}"`);
  }
  const fechaAlta = aIso(c.fecha_alta);
  if (!fechaAlta) throw new Error('Falta la fecha de alta, o no está en formato dd/mm/aaaa');

  const empresa = String(ettNombre || process.env.ETT_NOMBRE || '').trim();
  if (!empresa) {
    throw new Error('Falta el nombre de la ETT: ponlo en la variable de entorno ETT_NOMBRE');
  }

  // El turno de la hoja es texto ("Día", "Noche"); la base lo guarda por id.
  let turnoId = null;
  if (c.turno) {
    const { turnos } = await con.catalogos();
    const buscado = sinTildes(c.turno);
    const encontrado = (turnos || []).find(x =>
      sinTildes(x.etiqueta) === buscado || sinTildes(x.codigo) === buscado);
    if (encontrado) turnoId = encontrado.id;
  }

  const { nombre, apellidos } = alta.partirNombre(c.nombre);
  const r = await alta.realizar({
    telefono: t9,
    nombre, apellidos,
    dni_nie: (c.dni || '').toUpperCase() || undefined,
    email: c.correo || undefined,
    // La ETT manda la direccion en una sola cadena. Se guarda entera en el
    // nombre de la via: despiezarla a ojo inventaria portales y pisos.
    via_nombre: c.direccion || undefined,
    codigo_postal: c.cp || undefined,
    tipo: 'ett',
    ettNombre: empresa,
    alta: fechaAlta,
    jornadaHoras: horasDe(c.jornada) || horasDe(c.jornada_ett),
    turnoId,
  }, { usuarioId, rol });

  // Se anota en la hoja para no crearla dos veces y para poder ir de una a otra.
  await writeSheet(ID, `${HOJA}!${colLetra(COL.ficha)}${c._fila}`, [[String(r.id)]]);
  await tocar(c._fila);
  return r;
}

// ── Exportar la matriz de vuelta para la ETT (mismo formato, pegable en el correo) ──
async function exportarMatriz() {
  const lista = await leer();
  const CAB = ['Fecha Entrevista', 'Hora entrevista', 'JORNADA', 'TURNO', 'Nombre', 'DNI / NIE', 'Teléfono',
    'DIRECCIÓN', 'CÓDIGO POSTAL', 'Correo Electrónico', 'FECHA DE ALTA', 'JORNADA', 'TURNO', 'ZONA'];
  const filas = [CAB];
  for (const c of lista) {
    let alta = c.fecha_alta, jor = c.jornada, tur = c.turno, zon = c.zona;
    if (c.estado === 'No se presentó') { alta = 'No se presentó'; jor = tur = zon = ''; }
    else if (c.estado === 'No pasa') { alta = 'No pasa la entrevista'; jor = tur = zon = ''; }
    filas.push([c.fecha_entrevista, c.hora_entrevista, c.jornada_ett, c.turno_ett, c.nombre, c.dni, c.telefono,
      c.direccion, c.cp, c.correo, alta, jor, tur, zon]);
  }
  return filas.map(f => f.join('\t')).join('\n');
}

module.exports = { datos, leer, importar, guardarDecision, guardarCampos, pasarARRHH,
                   exportarMatriz, normalizarTel, ESTADOS, HOJA };
