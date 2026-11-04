// modules/Barcelona/vistas/barcelona-planificador.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const $ = s => document.querySelector(s);
  const esc = Casa.esc;
  const aDdmm = iso => (iso ? iso.split('-').reverse().join('/') : '');
  const aIso = v => { const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  let datos = null;

  const kpi = (titulo, valor, ayuda) => `<div class="rounded-2xl border border-telecab-border bg-telecab-card p-3" title="${esc(ayuda)}">
      <div class="text-xs text-telecab-muted">${esc(titulo)}</div>
      <div class="text-2xl font-bold text-telecab-text mt-0.5">${esc(valor)}</div></div>`;

  const celda = (f, turno) => {
    const p = f[turno];
    const base = 'w-full text-left px-3 py-2 rounded-xl border transition';
    if (!p) {
      return `<button type="button" data-mat="${esc(f.matricula)}" data-turno="${turno}"
        class="${base} border-dashed border-telecab-border text-telecab-muted hover:border-telecab-gold/60 hover:text-telecab-text"
        title="Plaza libre. Pulsa para poner a alguien.">
        <i class="fa-solid fa-plus mr-1.5 text-xs"></i>Asignar</button>`;
    }
    return `<button type="button" data-mat="${esc(f.matricula)}" data-turno="${turno}"
      class="${base} border-telecab-border bg-telecab-card2 hover:border-telecab-gold/60"
      title="Desde el ${esc(aDdmm(p.desde))}. Pulsa para cambiarla o dejarla libre.">
      <div class="font-semibold text-telecab-text ${p.activa ? '' : 'line-through'}">${esc(p.nombre)}</div>
      <div class="text-xs text-telecab-muted">${esc(p.telefono || 'sin teléfono')} · desde ${esc(aDdmm(p.desde))}${p.activa ? '' : ' · <span class="text-telecab-warn">ya no está activa en BOLT</span>'}</div>
    </button>`;
  };

  function pintar() {
    const d = datos;
    $('#b-aviso').classList.toggle('hidden', !d.faltaMigracion);
    if (d.faltaMigracion) {
      $('#b-aviso').innerHTML = '<i class="fa-solid fa-triangle-exclamation mr-1"></i> Falta aplicar la migración <b>db/181</b> (en Migraciones). Hasta entonces Barcelona no tiene planificador.';
      $('#b-filas').innerHTML = '';
      $('#b-kpis').innerHTML = '';
      $('#b-sinplaza').innerHTML = '';
      return;
    }
    const r = d.resumen;
    $('#b-kpis').innerHTML =
      kpi('Coches', r.coches, 'Los de la empresa de BOLT de Barcelona y los de Vehículos con sede Barcelona que aún no están en BOLT.') +
      kpi('Plazas cubiertas', `${r.cubiertas} / ${r.plazas}`, 'Cada coche tiene dos plazas: día y noche.') +
      kpi('Conductores activos', r.conductores, 'Las cuentas activas en BOLT Barcelona.') +
      kpi('Sin plaza', r.sinPlaza, 'Conductores activos que ese día no están en ninguna matrícula.');
    $('#b-filas').innerHTML = d.filas.length ? d.filas.map(f => `
      <tr class="border-b border-telecab-border/60 last:border-0 ${f.activo ? '' : 'opacity-70'}">
        <td class="px-4 py-3 align-top">
          <div class="font-mono font-semibold text-telecab-text">${esc(f.matricula)}</div>
          <div class="text-xs text-telecab-muted">${esc(f.modelo || '')}${!f.enBolt && f.activo
            ? ` · <span class="text-telecab-warn" title="Está en Vehículos con sede Barcelona, pero no en la empresa de BOLT de Barcelona: hasta que se dé de alta, nadie puede trabajar con él en BOLT.">No está dado de alta en BOLT</span>`
            : f.activo ? '' : ` · <span class="text-telecab-warn">${esc(f.estado || 'desactivado')}${f.enBolt ? ' en BOLT' : ''}</span>`}</div>
        </td>
        <td class="px-4 py-3 align-top">${celda(f, 'dia')}</td>
        <td class="px-4 py-3 align-top">${celda(f, 'noche')}</td>
      </tr>`).join('')
      : '<tr><td colspan="3" class="px-4 py-6 text-telecab-muted">Todavía no hay coches de Barcelona: la ingesta los trae de BOLT cada seis horas, y los de Vehículos salen si tienen la sede Barcelona.</td></tr>';
    $('#b-sinplaza').innerHTML = d.sinPlaza.length
      ? d.sinPlaza.map(c => `<span class="px-3 py-1.5 rounded-xl bg-telecab-card2 border border-telecab-border text-xs">
          <b class="text-telecab-text">${esc(c.nombre)}</b> <span class="text-telecab-muted">${esc(c.telefono || '')}</span></span>`).join('')
      : '<span class="text-xs text-telecab-muted">Todos tienen plaza.</span>';
  }

  async function cargar() {
    const iso = aIso($('#b-fecha').value) || '';
    try {
      const r = await fetch('/barcelona/api/tablero' + (iso ? '?fecha=' + iso : '')).then(x => x.json());
      if (r.status !== 'ok') throw new Error(r.msg || 'No se pudo cargar');
      datos = r;
      if (!$('#b-fecha').value) $('#b-fecha').value = aDdmm(r.fecha);
      pintar();
    } catch (e) {
      $('#b-filas').innerHTML = `<tr><td colspan="3" class="px-4 py-6 text-telecab-red">${esc(e.message)}</td></tr>`;
    }
  }

  // Pulsar una plaza: quién y desde cuándo.
  $('#b-filas').addEventListener('click', async ev => {
    const b = ev.target.closest('button[data-mat]');
    if (!b || !datos) return;
    const mat = b.dataset.mat, turno = b.dataset.turno;
    const fila = datos.filas.find(f => f.matricula === mat) || {};
    const actual = fila[turno];
    const nombreTurno = turno === 'dia' ? 'día' : 'noche';
    const opciones = datos.conductores.map(c => {
      const otra = c.plazas.find(p => p.turno === turno && p.matricula !== mat);
      return { valor: c.uuid, texto: `${c.nombre}${c.telefono ? ' · ' + c.telefono : ''}${otra ? ` — ahora en ${otra.matricula}` : ''}` };
    });
    const v = await Dialogo.formulario(`${mat} · ${nombreTurno}`, [
      { id: 'conductor', etiqueta: 'Conductor', tipo: 'lista', opciones, valor: actual ? actual.uuid : '',
        buscador: { marcador: 'Busca por nombre o teléfono', tope: 12 },
        ayuda: 'Si ya estaba en otra matrícula de ' + nombreTurno + ', se mueve aquí. «Sin dato» deja la plaza libre.' },
      { id: 'desde', etiqueta: 'Desde', tipo: 'fecha', valor: $('#b-fecha').value || aDdmm(datos.hoy),
        ayuda: 'Vale todos los días desde esa fecha hasta que se cambie.' },
    ], { textoBoton: 'Guardar' });
    if (!v) return;
    try {
      const r = await fetch('/barcelona/api/asignar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matricula: mat, turno, conductor: v.conductor, desde: v.desde }),
      }).then(x => x.json());
      if (r.status !== 'ok') throw new Error(r.msg || 'No se pudo guardar');
      Dialogo.hecho(r.cambio ? (r.movidaDe ? `Hecho. Se ha movido desde ${r.movidaDe}.` : 'Hecho.') : 'Ya estaba así.');
      cargar();
    } catch (e) {
      Dialogo.aviso({ titulo: 'No se pudo guardar', texto: e.message, tono: 'error' });
    }
  });

  $('#b-fecha').addEventListener('change', cargar);
  cargar();
})();
