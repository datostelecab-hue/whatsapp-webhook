// ============================================================
// INICIO — la pantalla de entrada
// ============================================================
// Se abre SIEMPRE, tenga uno el permiso o no (la excepción está en
// services/sesion.js). Antes se entraba directo a /pendientes y quien no tenía
// ese permiso se comía un "Sin permiso" nada más hacer login: más de uno creyó
// que la web se había caído.
//
// El permiso `/inicio` no decide si se ENTRA, decide QUÉ SE VE: con él, las
// cifras de la empresa; sin él, la bienvenida.

const express = require('express');
const router = express.Router();
const inicio = require('../services/repo/inicio');
const permisos = require('../services/permisos');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

/** ¿Puede ver las cifras quien está mirando? */
function veCifras(res) {
  const u = res.locals.usuario;
  if (u && ADMIN_TOTAL.includes(u.rol)) return true;
  // `res.locals.permisos` lo deja `cargarPermisos`: null = acceso total.
  const p = res.locals.permisos;
  return p === null || (Array.isArray(p) && p.includes('/inicio'));
}

router.get('/', (req, res) => {
  res.render('inicio', {
    titulo: 'Inicio',
    seccion: 'inicio',
    layout: 'layout-gestion',
    veCifras: veCifras(res),
    // Lo que SÍ puede abrir, para que la bienvenida no sea un callejón sin
    // salida: quien no ve cifras al menos ve por dónde seguir.
    misModulos: modulosDe(res),
  });
});

// Los datos van aparte para que la página pinte al momento y las cifras entren
// después: son casi veinte consultas y no tiene sentido esperarlas mirando el
// navegador en blanco.
router.get('/api/panel', async (req, res) => {
  if (!veCifras(res)) return res.status(403).json({ status: 'error', msg: 'Sin permiso para las cifras' });
  try {
    res.json({ status: 'ok', ...(await inicio.panel()) });
  } catch (error) {
    console.error('❌ [INICIO] panel:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

/** Los módulos del catálogo que esta persona puede abrir, con su etiqueta. */
function modulosDe(res) {
  const u = res.locals.usuario;
  const todo = u && ADMIN_TOTAL.includes(u.rol);
  const mias = res.locals.permisos;
  const puede = c => todo || mias === null || (Array.isArray(mias) && mias.includes(c));
  const salida = [];
  permisos.CATALOGO.forEach(g => g.items.forEach(i => {
    // El propio inicio no se ofrece a sí mismo, que ya se está en él.
    if (i.clave !== '/inicio' && puede(i.clave)) salida.push({ clave: i.clave, etiqueta: i.etiqueta });
  }));
  return salida;
}

module.exports = router;
