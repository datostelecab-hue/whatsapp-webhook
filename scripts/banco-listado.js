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

app.get('/vehiculos', (req, res) => {
  const locals = {
    titulo: 'Vehículos', seccion: 'vehiculos', rol: 'superadmin',
    usuario: { nombre: 'Banco', apellidos: 'Pruebas', email: 'a@b.c' }, tema: 'dark', v: 'test',
    estadosVehiculo: ESTADOS, zonas: ZONAS,
  };
  const V = path.join(__dirname, '..', 'views');
  const body = ejs.render(fs.readFileSync(path.join(V, 'vehiculos.ejs'), 'utf8'),
    locals, { filename: path.join(V, 'vehiculos.ejs') });
  res.send(ejs.render(fs.readFileSync(path.join(V, 'layout-gestion.ejs'), 'utf8'),
    { ...locals, body }, { filename: path.join(V, 'layout-gestion.ejs') }));
});

app.get('/', (req, res) => res.redirect('/vehiculos'));
app.listen(4599, () => console.log('Banco de pruebas en http://localhost:4599/vehiculos'));
