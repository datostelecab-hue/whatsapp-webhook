// ============================================================
// EL INFORME DE JORNADA PARA EL SMAC — las rutas (módulo 5, 25/11/2026)
// ============================================================
// Se monta en `/informe-jornada`, con la llave '/informe-jornada'. Se pide
// desde la ficha del conductor en Plantilla:
//   GET /informe-jornada/:id.pdf?desde=aaaa-mm-dd&hasta=aaaa-mm-dd
//   GET /informe-jornada/:id.xlsx?desde=…&hasta=…
// Cada emisión queda en el libro de auditoría de la ficha.
'use strict';

const express = require('express');
const router = express.Router();
const servicio = require('./informeJornada.service');
const pdf = require('./informeJornada.pdf');
const excel = require('./informeJornada.excel');
const actor = require('../../services/repo/actor');

const quien = async req => ({ usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req), rol: (req.usuario || {}).rol || '' });
const nombreFichero = (d, ext) => `informe-jornada-${String(d.persona.nombre).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-${d.rango.desde}-a-${d.rango.hasta}.${ext}`;

for (const [ext, generar, tipo] of [
  ['pdf', pdf.generar, 'application/pdf'],
  ['xlsx', excel.generar, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]) {
  router.get(`/:id(\\d+).${ext}`, async (req, res) => {
    try {
      const d = await servicio.datos(req.params.id, { desde: req.query.desde, hasta: req.query.hasta, formato: ext }, await quien(req));
      const bytes = await generar(d);
      res.setHeader('Content-Type', tipo);
      res.setHeader('Content-Disposition', `attachment; filename="${nombreFichero(d, ext)}"`);
      res.send(bytes);
    } catch (e) {
      console.error('❌ [Informe de jornada]', req.path + ':', e.message);
      res.status(e.status && e.status < 500 ? e.status : 400).json({ status: 'error', msg: e.message });
    }
  });
}

module.exports = router;
