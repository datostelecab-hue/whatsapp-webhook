// ============================================================
// LAS ZONAS DEL PLANIFICADOR — las reglas
// ============================================================
// Desde el 21/10/2026 las zonas (las bases) se crean, se renombran y se cambian
// de sitio desde el planificador, y a un cuadrante se le cambia la zona desde su
// cabecera. Aquí se prueba lo que se lee de la ubicación (ubicacion.js) y lo que
// deja y no deja hacer zonas.repo.js.
//
//   node scripts/comprobar-zonas.js
//
// No toca ninguna base: se sustituye por una de mentira, en memoria.
const path = require('path');
const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};

// ── La base de mentira ──────────────────────────────────────────────────────
let zonas, cuadrantes, apuntes;
function reiniciar() {
  zonas = [
    { id: 3, nombre: 'Getafe', lat: 40.32737, lng: -3.719625, activa: true },
    { id: 7, nombre: 'Barcelona', lat: 41.3874, lng: 2.1686, activa: false },
    { id: 10, nombre: 'Aravaca', lat: 40.4617, lng: -3.7856, activa: true },
  ];
  cuadrantes = [
    { id: 36, base_zona_id: 3, baja: false },
    { id: 37, base_zona_id: 3, baja: true },
  ];
  apuntes = [];
}
const norm = s => String(s).trim().toLowerCase();
const fila = z => ({ id: z.id, nombre: z.nombre, lat: z.lat, lng: z.lng });
function responde(sql, p = []) {
  if (/FROM base_zona\s+WHERE nombre_norm/.test(sql)) {
    return { rows: zonas.filter(z => norm(z.nombre) === norm(p[0]) && (p[1] == null || z.id !== Number(p[1])))
      .map(z => ({ id: z.id, nombre: z.nombre, activa: z.activa })) };
  }
  if (/INSERT INTO base_zona/.test(sql)) {
    const z = { id: 100 + zonas.length, nombre: p[0], lat: p[1], lng: p[2], activa: true };
    zonas.push(z);
    return { rows: [fila(z)] };
  }
  if (/FROM base_zona WHERE id = \$1 AND activa/.test(sql)) {
    return { rows: zonas.filter(z => z.id === Number(p[0]) && z.activa).map(fila) };
  }
  if (/UPDATE base_zona SET nombre/.test(sql)) {
    const z = zonas.find(x => x.id === Number(p[0]));
    Object.assign(z, { nombre: p[1], lat: p[2], lng: p[3] });
    return { rows: [fila(z)] };
  }
  if (/FROM cuadrante cu LEFT JOIN base_zona/.test(sql)) {
    const cu = cuadrantes.find(c => c.id === Number(p[0]) && !c.baja);
    const z = cu && zonas.find(x => x.id === cu.base_zona_id);
    return { rows: cu ? [{ id: cu.id, base_zona_id: cu.base_zona_id, zona: z ? z.nombre : null }] : [] };
  }
  if (/UPDATE cuadrante SET base_zona_id/.test(sql)) {
    cuadrantes.find(c => c.id === Number(p[0])).base_zona_id = Number(p[1]);
    return { rows: [] };
  }
  if (/INSERT INTO cambio_campo/.test(sql)) {
    for (let i = 0; i < p.length; i += 7) apuntes.push({ tabla: p[i], id: p[i + 1], campo: p[i + 2], antes: p[i + 3], ahora: p[i + 4], usuario: p[i + 5] });
    return { rows: [] };
  }
  throw new Error('La base de mentira no sabe contestar a: ' + sql.slice(0, 80));
}
sustituir('services/db.js', {
  HAY_BD: true,
  consulta: async (sql, p) => responde(sql, p),
  transaccion: async fn => fn({ query: async (sql, p) => responde(sql, p) }),
});

const { leerUbicacion } = require('../modules/Planificacion/ubicacion');
const Z = require('../modules/Planificacion/zonas.repo');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
/** Que falle, y con un mensaje que contenga `trozo`. */
async function falla(nombre, fn, trozo) {
  try { await fn(); igual(nombre, 'no falló', 'falla con «' + trozo + '»'); }
  catch (e) { igual(nombre, e.message.includes(trozo) ? 'falla bien' : e.message, 'falla bien'); }
}

(async () => {
  // ── La ubicación ──────────────────────────────────────────────────────────
  const A = { lat: 40.4617, lng: -3.7856 };
  igual('Lo que copia el clic derecho de Google Maps', leerUbicacion('40.4617, -3.7856'), A);
  igual('Sin espacio tras la coma', leerUbicacion('40.4617,-3.7856'), A);
  igual('Separado por un espacio', leerUbicacion(' 40.4617 -3.7856 '), A);
  igual('Coma decimal y punto y coma', leerUbicacion('40,4617; -3,7856'), A);
  igual('Coma decimal y coma con espacio', leerUbicacion('40,4617, -3,7856'), A);
  igual('Se queda en seis decimales', leerUbicacion('40.46170049, -3.78560012'), A);
  igual('El enlace largo: manda el sitio (!3d!4d) sobre lo que se ve (@)',
    leerUbicacion('https://www.google.com/maps/place/Aravaca/@40.47,-3.79,15z/data=!3m1!4b1!4m6!3m5!1s0xd41!8m2!3d40.4617!4d-3.7856'), A);
  igual('El enlace con solo @', leerUbicacion('https://www.google.es/maps/@40.4617,-3.7856,17z'), A);
  igual('El enlace con ?q=', leerUbicacion('https://maps.google.com/?q=40.4617%2C-3.7856'), A);
  await falla('El enlace corto no se abre: se dice qué hacer', () => leerUbicacion('https://maps.app.goo.gl/AbC123xyz'), 'enlace es el corto');
  await falla('Al revés: se avisa', () => leerUbicacion('-3.7856, 40.4617'), 'al revés');
  await falla('Fuera de España', () => leerUbicacion('48.8566, 2.3522'), 'fuera de España');
  await falla('Vacía', () => leerUbicacion('  '), 'Falta la ubicación');
  await falla('Lo que no son coordenadas', () => leerUbicacion('Calle de la Golondrina 2'), 'No entiendo');
  await falla('Coma decimal sin espacio: no se sabe cuál es cuál', () => leerUbicacion('40,4617,-3,7856'), 'No entiendo');

  // ── Crear ─────────────────────────────────────────────────────────────────
  reiniciar();
  const nueva = await Z.crearZona({ nombre: '  Las   Rozas ', lat: 40.49, lng: -3.87 }, { usuarioId: 7 });
  igual('Crear: se guarda sin espacios de más', nueva.zona.nombre, 'Las Rozas');
  igual('Crear: queda apuntado quién la dio de alta', apuntes.map(a => [a.tabla, a.campo, a.ahora, a.usuario]),
    [['base_zona', 'alta', 'Las Rozas (40.49, -3.87)', 7]]);
  await falla('Crear una que ya existe (sin mirar mayúsculas)', () => Z.crearZona({ nombre: 'getafe', lat: 40, lng: -3 }), 'Ya hay una zona');
  await falla('Crear Barcelona: existe, retirada a propósito', () => Z.crearZona({ nombre: 'Barcelona', lat: 40, lng: -3 }), 'no es una base del planificador');
  await falla('«Sin base» no puede ser una zona', () => Z.crearZona({ nombre: 'Sin base', lat: 40, lng: -3 }), 'no puede ser el nombre');
  await falla('Sin nombre', () => Z.crearZona({ nombre: ' ', lat: 40, lng: -3 }), 'Falta el nombre');

  // ── Editar ────────────────────────────────────────────────────────────────
  reiniciar();
  const ed = await Z.editarZona(10, { nombre: 'Aravaca Norte', lat: 40.47, lng: -3.79 }, { usuarioId: 7 });
  igual('Renombrar: devuelve el nombre de antes y el nuevo', [ed.antes, ed.zona.nombre], ['Aravaca', 'Aravaca Norte']);
  igual('Renombrar: se apunta cada campo que cambia', apuntes.map(a => [a.campo, a.antes, a.ahora]),
    [['nombre', 'Aravaca', 'Aravaca Norte'], ['lat', '40.4617', '40.47'], ['lng', '-3.7856', '-3.79']]);
  apuntes = [];
  await Z.editarZona(3, { nombre: 'GETAFE', lat: 40.32737, lng: -3.719625 });
  igual('Cambiarle solo las mayúsculas a la propia no choca consigo misma', zonas.find(z => z.id === 3).nombre, 'GETAFE');
  await falla('Renombrar con el nombre de otra', () => Z.editarZona(10, { nombre: 'Getafe', lat: 40, lng: -3 }), 'Ya hay una zona');
  await falla('Barcelona no se edita desde aquí', () => Z.editarZona(7, { nombre: 'BCN', lat: 41, lng: 2 }), 'no es una base del planificador');

  // ── Cambiar la zona de un cuadrante ───────────────────────────────────────
  reiniciar();
  const cz = await Z.cambiarZonaCuadrante(36, 10, { usuarioId: 7 });
  igual('Cuadrante a Aravaca', [cz.cambiado, cz.antes, cz.zona, cuadrantes[0].base_zona_id], [true, 'Getafe', 'Aravaca', 10]);
  igual('Cuadrante: se apunta de dónde a dónde', apuntes.map(a => [a.tabla, a.id, a.campo, a.antes, a.ahora]),
    [['cuadrante', 36, 'zona', 'Getafe', 'Aravaca']]);
  apuntes = [];
  igual('A la zona que ya tiene: no cambia nada ni se apunta', [(await Z.cambiarZonaCuadrante(36, 10)).cambiado, apuntes.length], [false, 0]);
  await falla('Un cuadrante borrado no se mueve', () => Z.cambiarZonaCuadrante(37, 10), 'ya se borró');
  await falla('A Barcelona no', () => Z.cambiarZonaCuadrante(36, 7), 'no es una base del planificador');
  await falla('Sin zona elegida', () => Z.cambiarZonaCuadrante(36, ''), 'Elige la zona');

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
