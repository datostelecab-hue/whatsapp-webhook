// ============================================================
// ERRORES DEL NAVEGADOR — que un fallo de JavaScript deje rastro
// ============================================================
// Una pantalla con un error de JavaScript se queda a medias —cargando para
// siempre, un botón que no hace nada— y hasta ahora no quedaba un solo rastro
// en el servidor: el desarrollador se enteraba cuando alguien se quejaba.
// public/assets/js/api.js manda aquí los errores que nadie captura (como mucho
// cinco por página) y aquí se apuntan en el log, una línea cada uno.
//
// Va detrás de la sesión: solo quien ha entrado puede mandar. Y con tope por
// usuario y tamaño máximo, para que esto no sirva para llenar el log.

const express = require('express');
const router = express.Router();

const MAX_POR_VENTANA = 30;
const VENTANA_MS = 10 * 60 * 1000;
const MAX_BYTES = 8 * 1024;
const cuentas = new Map();   // usuario → { desde, n }

// Una línea, sin saltos y con tope: lo que llega lo escribe el navegador.
const corta = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

function dentroDelTope(quien) {
  const ahora = Date.now();
  if (cuentas.size > 5000) cuentas.clear();   // memoria acotada pase lo que pase
  const c = cuentas.get(quien);
  if (!c || ahora - c.desde > VENTANA_MS) { cuentas.set(quien, { desde: ahora, n: 1 }); return true; }
  c.n++;
  return c.n <= MAX_POR_VENTANA;
}

router.post('/', (req, res) => {
  // Siempre 204: el navegador no espera nada y no hay nada que contarle.
  res.status(204).end();
  const b = req.body;
  if (!b || typeof b !== 'object') return;
  if (JSON.stringify(b).length > MAX_BYTES) return;
  const quien = (req.usuario && (req.usuario.id || req.usuario.email)) || 'anónimo';
  if (!dentroDelTope(String(quien))) return;
  const donde = b.fuente ? ` @ ${corta(b.fuente, 120)}:${Number(b.linea) || 0}:${Number(b.columna) || 0}` : '';
  const pila = corta(String(b.pila || '').split('\n').slice(1, 4).join(' | '), 400);
  console.error(`🧯 [CLIENTE] usuario ${corta(quien, 60)} en ${corta(b.ruta, 120)}: ${corta(b.mensaje, 300)}${donde}${pila ? ' · ' + pila : ''}`);
});

module.exports = router;
