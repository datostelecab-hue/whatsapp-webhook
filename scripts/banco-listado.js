// ============================================================
// BANCO DE PRUEBAS DE PANTALLAS (componente Listado)
// ============================================================
// Levanta la pantalla de vehiculos con datos INVENTADOS, sin base de datos y
// sin Mapon. Sirve para disenar y probar una pantalla de listado (colores,
// columnas, la ficha, el boton de atras, el menu) sin depender de que la base
// este levantada ni de tener datos reales delante.
//
//   node scripts/banco-listado.js     y abrir http://localhost:4599/vehiculos
//
// No se despliega ni lo carga app.js: es una herramienta de desarrollo.
const express = require('express');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const app = express();
app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets')));

const ESTADOS = [
  { codigo: 'O', etiqueta: 'Operativo', es_operativo: true },
  { codigo: 'X', etiqueta: 'En taller', es_operativo: false },
  { codigo: 'S', etiqueta: 'Siniestro', es_operativo: false },
];
const ZONAS = [{ id: 1, nombre: 'Norte' }, { id: 2, nombre: 'Sur' }];

const hoy = new Date();
const masDias = n => new Date(hoy.getTime() + n * 86400000).toISOString().slice(0, 10);

const COCHES = [
  { id: 1, matricula: '3031LTV', marca_modelo: 'Toyota Corolla', anio: 2021, estado_operativo: 'O',
    estado_etiqueta: 'Operativo', es_operativo: true, base_zona_id: 1, zona: 'Norte',
    itv_caduca: masDias(200), dias_itv: 200, seguro_caduca: masDias(12), dias_seguro: 12,
    aseguradora: 'Mapfre', km_odometro_m: 184320000, km_odometro_at: new Date(Date.now() - 3600e3).toISOString(),
    plazas_ocupadas: 4, enlaces: 1, notas: 'Con enganche' },
  { id: 2, matricula: '5912LBZ', marca_modelo: 'Skoda Octavia', anio: 2020, estado_operativo: 'X',
    estado_etiqueta: 'En taller', es_operativo: false, base_zona_id: 2, zona: 'Sur',
    itv_caduca: masDias(-15), dias_itv: -15, seguro_caduca: masDias(300), dias_seguro: 300,
    aseguradora: 'Allianz', km_odometro_m: null, km_odometro_at: null,
    plazas_ocupadas: 0, enlaces: 0, notas: null },
  { id: 3, matricula: '1234ABC', marca_modelo: 'Kia Niro', anio: 2023, estado_operativo: 'O',
    estado_etiqueta: 'Operativo', es_operativo: true, base_zona_id: 1, zona: 'Norte',
    itv_caduca: masDias(500), dias_itv: 500, seguro_caduca: masDias(90), dias_seguro: 90,
    aseguradora: 'Mapfre', km_odometro_m: 45120000, km_odometro_at: new Date(Date.now() - 5 * 86400e3).toISOString(),
    plazas_ocupadas: 6, enlaces: 1, notas: null },
];

app.get('/vehiculos/api/lista', (req, res) => res.json({
  filas: COCHES,
  resumen: {
    porEstado: ESTADOS.map(e => ({ ...e, coches: COCHES.filter(c => c.estado_operativo === e.codigo).length })),
    alertas: { itv_caducada: 1, itv_pronto: 0, seguro_caducado: 0, seguro_pronto: 1, odometro_viejo: 1 },
  },
}));

app.get('/vehiculos/api/ficha/:id', (req, res) => {
  const c = COCHES.find(x => String(x.id) === req.params.id);
  if (!c) return res.status(404).json({ status: 'error', msg: 'No existe ese vehículo' });
  res.json({
    ...c,
    fecha_matriculacion: '2021-03-15',
    plazas: c.plazas_ocupadas
      ? [{ id: 1, slot: 0, turno: 'Día', rol: 'titular', conductor: 'García, Ana', conductor_id: 7, desde: '2026-01-10' },
         { id: 2, slot: 1, turno: 'Noche', rol: 'titular', conductor: null, desde: null }]
      : [],
    // Una matricula escrita distinta en Mapon: debe salir avisada en amarillo.
    enlaces: c.enlaces
      ? [{ sistema: 'mapon', externo_id: '893946', externo_matricula: c.id === 3 ? '1234-ABD' : c.matricula, visto_desde: '2026-08-20' }]
      : [],
    historialEstado: [
      { estado_codigo: c.estado_operativo, etiqueta: c.estado_etiqueta, desde: '2026-06-01', hasta: null },
      { estado_codigo: 'O', etiqueta: 'Operativo', desde: '2025-01-01', hasta: '2026-05-31' },
    ],
    historialZona: [{ base_zona_id: c.base_zona_id, etiqueta: c.zona, desde: '2025-01-01', hasta: null }],
  });
});

// Pinta una vista dentro del layout, igual que lo hara Express.
function pintar(res, vista, extra) {
  const V = path.join(__dirname, '..', 'views');
  const locals = {
    rol: 'superadmin', tema: 'dark', v: 'test',
    usuario: { nombre: 'Banco', apellidos: 'Pruebas', email: 'a@b.c' },
    est: ruta => ruta + '?v=test',
    ...extra,
  };
  const body = ejs.render(fs.readFileSync(path.join(V, vista + '.ejs'), 'utf8'),
    locals, { filename: path.join(V, vista + '.ejs') });
  res.send(ejs.render(fs.readFileSync(path.join(V, 'layout-gestion.ejs'), 'utf8'),
    { ...locals, body }, { filename: path.join(V, 'layout-gestion.ejs') }));
}

app.get('/vehiculos', (req, res) => pintar(res, 'vehiculos', {
  titulo: 'Vehículos', seccion: 'vehiculos', estadosVehiculo: ESTADOS, zonas: ZONAS,
}));

// -- Conductores -----------------------------------------------------------
const SITUACIONES = [
  { codigo: 'activo',      etiqueta: 'Activo',      es_ausencia: false },
  { codigo: 'vacaciones',  etiqueta: 'Vacaciones',  es_ausencia: true },
  { codigo: 'baja_medica', etiqueta: 'Baja médica', es_ausencia: true },
];
const TURNOS = [{ id: 1, codigo: 'dia', etiqueta: 'Día' }, { id: 2, codigo: 'noche', etiqueta: 'Noche' }];

const GENTE = [
  { id: 10, nombre: 'Ana', apellidos: 'García Ruiz', nombre_ss: 'GARCIA RUIZ ANA',
    dni_tipo: 'DNI', dni_nie: '12345678Z', nacionalidad: 'España', email: 'ana@telecab.es',
    empleo_tipo: 'propia', ett_nombre: null, alta: '2023-02-01', baja: null,
    antiguedad: '2023-02-01', anios: 3.5, situacion: 'activo', situacion_etiqueta: 'Activo',
    ausente: false, situacion_desde: '2023-02-01', hasta_previsto: null,
    turno_id: 1, turno: 'Día', telefono: '+34600111222', bolt_id: '884411', bolt_estado: 'active',
    matricula: '3031LTV', vehiculo_id: 1, rol: 'titular', zona: 'Norte', libranzas: 'S D',
    direccion: 'Calle Mayor 3, 28002 Madrid', naf: '281234567840', legajo: 'A-104',
    fecha_nacimiento: '1990-06-12' },
  { id: 11, nombre: 'Luis', apellidos: 'Pérez Soto', nombre_ss: null,
    dni_tipo: 'NIE', dni_nie: 'X1234567L', nacionalidad: 'Colombia', email: null,
    empleo_tipo: 'ett', ett_nombre: 'Randstad', alta: '2026-07-15', baja: null,
    antiguedad: '2026-07-15', anios: 0.1, situacion: 'activo', situacion_etiqueta: 'Activo',
    ausente: false, situacion_desde: '2026-07-15', hasta_previsto: null,
    turno_id: 2, turno: 'Noche', telefono: '+34600333444', bolt_id: null, bolt_estado: null,
    matricula: null, vehiculo_id: null, rol: null, zona: null, libranzas: null,
    direccion: null, naf: null, legajo: null, fecha_nacimiento: '1995-01-30' },
  { id: 12, nombre: 'Marta', apellidos: 'Ibáñez Lara', nombre_ss: 'IBANEZ LARA MARTA',
    dni_tipo: 'DNI', dni_nie: '87654321X', nacionalidad: 'España', email: 'marta@telecab.es',
    empleo_tipo: 'propia', ett_nombre: null, alta: '2021-09-01', baja: null,
    antiguedad: '2019-04-01', anios: 7.4, situacion: 'baja_medica', situacion_etiqueta: 'Baja médica',
    ausente: true, situacion_desde: '2026-08-01', hasta_previsto: null,
    turno_id: 1, turno: 'Día', telefono: '+34600555666', bolt_id: '884412', bolt_estado: 'deactivated',
    matricula: '1234ABC', vehiculo_id: 3, rol: 'titular', zona: 'Norte', libranzas: 'L M',
    direccion: 'Avenida Sur 12, 28100 Alcobendas', naf: '289876543210', legajo: 'A-077',
    fecha_nacimiento: '1988-11-02' },
];

// Relleno hasta pasar de 50 filas: sin eso el paginador no se puede probar.
// Los nombres son inventados y a proposito de largos distintos, que es lo que
// descuadra una tabla.
const APE = ['Moreno', 'Ferreira', 'Ben Ali', 'Nowak', 'Oliveira Santos', 'Ruiz', 'Ndiaye',
             'Del Campo Herrera', 'Iglesias', 'Kowalczyk', 'Sow', 'Vargas Llosa'];
const PIL = ['Adrian', 'Fatou', 'Marek', 'Joao', 'Youssef', 'Ainhoa', 'Ibrahima', 'Rocio'];
for (let i = 0; i < 120; i++) {
  const sit = i % 11 === 0 ? 'vacaciones' : i % 17 === 0 ? 'baja_medica' : 'activo';
  const ett = i % 5 === 0;
  GENTE.push({
    id: 100 + i,
    nombre: PIL[i % PIL.length],
    apellidos: APE[i % APE.length] + (i % 3 ? '' : ' ' + APE[(i + 4) % APE.length]),
    nombre_ss: (APE[i % APE.length] + ' ' + PIL[i % PIL.length]).toUpperCase(),
    dni_tipo: i % 4 ? 'DNI' : 'NIE',
    dni_nie: (i % 4 ? '' : 'X') + String(10000000 + i * 7919).slice(0, 8) + 'K',
    nacionalidad: i % 3 ? 'Espana' : 'Senegal',
    email: i % 6 ? 'p' + i + '@telecab.es' : null,
    empleo_tipo: ett ? 'ett' : 'propia', ett_nombre: ett ? 'Randstad' : null,
    alta: '202' + (3 + (i % 4)) + '-0' + (1 + (i % 9)) + '-1' + (i % 9),
    baja: null, antiguedad: '202' + (3 + (i % 4)) + '-01-01', anios: (i % 60) / 10,
    situacion: sit,
    situacion_etiqueta: sit === 'activo' ? 'Activo' : sit === 'vacaciones' ? 'Vacaciones' : 'Baja medica',
    ausente: sit !== 'activo', situacion_desde: '2026-06-01', hasta_previsto: null,
    turno_id: 1 + (i % 2), turno: i % 2 ? 'Noche' : 'Dia',
    telefono: '+346' + String(10000000 + i),
    bolt_id: i % 9 ? 'b' + (900000 + i) : null,
    bolt_estado: i % 13 ? 'active' : 'deactivated',
    // Uno de cada treinta con DOS plazas: es el caso que duplicaba la fila.
    matricula: i % 4 === 3 ? null : (i % 30 === 7 ? '00' + i + 'AAA + 11' + i + 'BBB' : '0' + (1000 + i) + 'XYZ'),
    plazas_abiertas: i % 4 === 3 ? 0 : (i % 30 === 7 ? 2 : 1),
    vehiculo_id: i, rol: 'titular', zona: i % 2 ? 'Getafe' : 'Usera',
    libranzas: i % 7 ? 'X J' : 'S D',
    direccion: 'Calle Falsa ' + i + ', 28000 Madrid', naf: null, legajo: null,
    fecha_nacimiento: '1990-01-01',
  });
}

// Los faltantes se calculan con la MISMA funcion del repositorio: si cambia la
// regla, el banco cambia con ella y no miente.
const { faltantesDe } = require('../services/repo/conductores');
const conFaltan = GENTE.map(p => ({
  ...p, faltan: faltantesDe(p), nombre_completo: p.apellidos + ', ' + p.nombre,
}));

app.get('/conductores/api/lista', (req, res) => res.json({
  filas: conFaltan,
  resumen: {
    porSituacion: SITUACIONES
      .map(s => ({ ...s, personas: conFaltan.filter(p => p.situacion === s.codigo).length }))
      .filter(s => s.personas),
    porTipo: [
      { tipo: 'propia', personas: conFaltan.filter(p => p.empleo_tipo === 'propia').length },
      { tipo: 'ett', personas: conFaltan.filter(p => p.empleo_tipo === 'ett').length },
    ],
    huecos: {
      sin_bolt: conFaltan.filter(p => !p.bolt_id).length,
      sin_telefono: conFaltan.filter(p => !p.telefono).length,
      sin_dni: conFaltan.filter(p => !p.dni_nie).length,
      sin_coche: conFaltan.filter(p => !p.matricula).length,
    },
  },
}));

app.get('/conductores/api/ficha/:id', (req, res) => {
  const p = conFaltan.find(x => String(x.id) === req.params.id);
  if (!p) return res.status(404).json({ status: 'error', msg: 'No existe ese conductor' });
  res.json({
    ...p,
    telefonos: p.telefono
      ? [{ e164: p.telefono, origen: 'bolt', principal: true, vigente_desde: '2024-01-01', vigente_hasta: null }]
      : [],
    cuentas: p.bolt_id
      ? [{ sistema: 'bolt', externo_id: p.bolt_id, externo_nombre: p.nombre + ' ' + p.apellidos,
           estado_externo: p.bolt_estado, visto_desde: '2024-01-01', visto_hasta: null }]
      : [],
    empleos: [{ tipo: p.empleo_tipo, ett_nombre: p.ett_nombre, alta: p.alta, baja: null,
                fecha_antiguedad: p.antiguedad, motivo_baja: null }],
    situaciones: [{ estado: p.situacion, etiqueta: p.situacion_etiqueta,
                    desde: p.situacion_desde, hasta: null, motivo: null }],
    turnos: [{ turno_id: p.turno_id, etiqueta: p.turno, desde: p.alta, hasta: null, origen: 'migracion' }],
    coches: p.matricula
      ? [{ id: 1, matricula: p.matricula, turno: p.turno, rol: p.rol, zona: p.zona,
           desde: '2025-01-01', hasta: null }]
      : [],
    alias: [
      { tipo: 'bolt_nombre', alias: p.nombre + ' ' + p.apellidos, ambiguo: false, vigente: true },
      { tipo: 'ss_nombre', alias: p.nombre_ss || '', ambiguo: false, vigente: true },
    ].filter(a => a.alias),
    // `patrones`, no `libranzas`: el repositorio los separa a proposito para
    // que la lista de patrones no pise el texto legible ('L M') del listado.
    patrones: p.libranzas
      ? [{ id: 1, desde: p.alta, hasta: null,
           dias: p.libranzas.split(' ').map(d => 'LMXJVSD'.indexOf(d) + 1) }]
      : [],
  });
});

app.get('/conductores', (req, res) => pintar(res, 'conductores', {
  titulo: 'Conductores', seccion: 'conductores',
  catalogos: { situaciones: SITUACIONES, turnos: TURNOS,
               tipos: [{ codigo: 'propia', etiqueta: 'Plantilla propia' },
                       { codigo: 'ett', etiqueta: 'ETT' }] },
}));

app.get('/', (req, res) => res.redirect('/conductores'));
app.listen(4599, () => console.log('Banco: http://localhost:4599/vehiculos y /conductores'));
