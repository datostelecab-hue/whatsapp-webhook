// ============================================================
// −J — el formulario para poner una −J (30/10/2026, db/227)
// ============================================================
// Camilo: «Alex no le da el coche temprano a Carlos, Carlos sale tarde por culpa
// de Alex: le dejamos una −J a Alex por perjuicio a la empresa». Es constancia:
// no toca horas, nómina ni letra, y nace pendiente hasta que la aprueba un área
// en /justificantes.
//
// El MISMO formulario en las tres pantallas que la ponen (Bitácora, Control y
// /justificantes), para que pida lo mismo en todas:
//
//   await MenosJ.poner({
//     url,            a dónde se manda (POST JSON) — la puerta de cada pantalla
//     dia,            'AAAA-MM-DD'
//     conductor,      { id, nombre } quien la recibe; sin él, se elige en una lista
//     perjudicado,    { id, nombre } el compañero, fijo; sin él, se elige (opcional)
//     personas,       [{ id, nombre }] para las listas
//     casuisticas,    [{ codigo, etiqueta }] (del servidor)
//     minutos, motivo lo que se sugiere
//     justificanteId, origen
//     titulo, nota
//   })  → la respuesta del servidor, o null si se cancela o falla (ya avisado)
//
// Necesita Dialogo y HorasMin (layout-gestion los carga antes).
(function (global) {
  const CASUISTICAS = [{ codigo: 'perjuicio_empresa', etiqueta: 'Perjuicios a la empresa' }];

  async function poner(o) {
    o = o || {};
    const personas = (o.personas || []).filter(p => p && p.id);
    const casuisticas = (o.casuisticas && o.casuisticas.length) ? o.casuisticas : CASUISTICAS;
    const opcionesDe = (fuera) => personas
      .filter(p => !fuera || String(p.id) !== String(fuera))
      .map(p => ({ valor: String(p.id), texto: p.nombre }));
    const campos = [];
    if (!o.conductor) {
      campos.push({ id: 'quien', etiqueta: 'A quién se le pone (quien lo causó)', tipo: 'lista', obligatorio: true,
        opciones: opcionesDe(o.perjudicado && o.perjudicado.id), buscador: { marcador: 'Buscar por nombre', tope: 10 } });
    }
    campos.push(
      { id: 'casuistica', etiqueta: 'Casuística', tipo: 'lista', obligatorio: true, valor: casuisticas[0].codigo,
        opciones: casuisticas.map(c => ({ valor: c.codigo, texto: c.etiqueta })) },
      { id: 'motivo', etiqueta: 'Motivo', tipo: 'texto-largo', obligatorio: true, valor: o.motivo || '',
        marcador: 'Qué pasó. Por ejemplo: no le dio el coche a tiempo y salió 1 h tarde', max: 500 });
    if (!o.perjudicado) {
      campos.push({ id: 'companero', etiqueta: 'Compañero perjudicado (opcional)', tipo: 'lista',
        opciones: opcionesDe(o.conductor && o.conductor.id), buscador: { marcador: 'Buscar por nombre', tope: 10 },
        ayuda: 'Si el perjuicio fue a un compañero. Si fue por otra cosa, déjalo en blanco: lo dice el motivo.' });
    }
    campos.push({ id: 'horas', etiqueta: 'Tiempo que costó (opcional)', tipo: 'horas',
      minutos: o.minutos != null ? o.minutos : null });

    const titulo = o.titulo || ('Poner una −J' + (o.conductor ? ' a ' + o.conductor.nombre : ''));
    const nota = o.nota || ('Constancia de un perjuicio a la empresa' +
      (o.perjudicado ? ': ' + o.perjudicado.nombre + ' es el perjudicado' : '') +
      '. No toca horas, nómina ni letra. Queda PENDIENTE hasta que la apruebe un área en Justificantes.');
    const v = await global.Dialogo.formulario(titulo, campos, { textoBoton: 'Poner la −J', nota });
    if (!v) return null;

    const quien = o.conductor ? o.conductor.id : v.quien;
    const companero = o.perjudicado ? o.perjudicado.id : (v.companero || null);
    try {
      const r = await fetch(o.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conductorId: quien, dia: o.dia, casuistica: v.casuistica, motivo: v.motivo,
          companeroId: companero, horas: v.horas || '', justificanteId: o.justificanteId || null,
          origen: o.origen || '',
        }),
      }).then(x => x.json());
      if (r.status !== 'ok') throw new Error(r.msg || 'No se pudo poner');
      return r;
    } catch (e) {
      await global.Dialogo.aviso({ titulo: 'No se pudo poner la −J', texto: e.message, tono: 'error' });
      return null;
    }
  }

  // ── EL HISTORIAL de una J o una −J (db/228) ────────────────────────────────
  // `MenosJ.historial(contenedor, url)`: lo pide y lo pinta dentro; una segunda
  // pulsación lo cierra. Lo usan /justificantes y la Bitácora.
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ORIGEN = { bitacora: 'Bitácora', control: 'Control', justificantes: 'Justificantes', campanas: 'Campañas' };
  const valor = (c, v) => {
    if (v == null || v === '') return '—';
    if (c.clave === 'horas_seg_momento') return (global.HorasMin && global.HorasMin.texto(Math.round(v / 60))) || '0 min';
    if (c.clave === 'minutos') return (global.HorasMin && global.HorasMin.texto(v)) || v + ' min';
    if (c.clave === 'aprobado_at') return 'sí';
    return String(v);
  };
  async function historial(caja, url) {
    if (caja.dataset.abierto) { caja.innerHTML = ''; delete caja.dataset.abierto; return; }
    caja.dataset.abierto = '1';
    caja.innerHTML = '<div class="text-[11px] text-telecab-muted mt-1.5">Cargando el historial…</div>';
    try {
      const r = await fetch(url).then(x => x.json());
      if (r.status !== 'ok') throw new Error(r.msg || 'No se pudo leer');
      const h = r.historial || [];
      caja.innerHTML = '<div class="mt-1.5 rounded-lg border border-telecab-border bg-telecab-dark/30 px-2.5 py-2">' +
        '<div class="text-[11px] uppercase tracking-wide text-telecab-muted mb-1">Historial · ' + h.length + '</div>' +
        (h.length ? h.map(e =>
          '<div class="text-xs py-1 border-t border-telecab-border/40 first:border-0">' +
            '<span class="text-telecab-muted tabular-nums">' + esc(e.en) + '</span> ' +
            '<b class="text-telecab-text">' + esc(e.etiqueta) + '</b>' +
            ' <span class="text-telecab-muted">por ' + esc(e.quien || 'sin usuario') +
            (e.origen ? ' · ' + esc(ORIGEN[e.origen] || e.origen) : '') + '</span>' +
            (e.cambios || []).filter(c => !(e.accion === 'poner')).map(c =>
              '<div class="text-[11px] text-telecab-muted pl-3">' + esc(c.campo) + ': ' +
                esc(valor(c, c.antes)) + ' → <span class="text-telecab-text">' + esc(valor(c, c.despues)) + '</span></div>').join('') +
            (e.nota ? '<div class="text-[11px] text-telecab-muted pl-3">' + esc(e.nota) + '</div>' : '') +
          '</div>').join('')
          : '<div class="text-xs text-telecab-muted">Sin cambios apuntados.</div>') +
        '</div>';
    } catch (e) {
      caja.innerHTML = '<div class="text-[11px] text-telecab-red mt-1.5">' + esc(e.message) + '</div>';
    }
  }

  global.MenosJ = { poner, historial, CASUISTICAS };
})(window);
