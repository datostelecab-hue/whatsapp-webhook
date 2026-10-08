// ============================================================
// CITAS DEL TALLER — lo que Mantenimientos y Control pintan igual
// ============================================================
// Las dos pantallas enseñan la misma cita con distinto trabajo detrás:
// Mantenimientos sube el Excel, avisa y la da por hecha; Control llama al
// conductor y apunta lo que dice. Quién la lleva, cómo va el aviso y qué ha
// contestado se ven IGUAL en las dos, y por eso se pintan aquí una sola vez.
//
//   CitasTaller.responsable(cita)     el conductor de ese turno, con teléfono y enlaces
//   CitasTaller.aviso(cita, hoy)      si se le avisó, cuándo y cómo, o cuándo se le avisará
//   CitasTaller.confirmacion(cita)    la pastilla de lo que contestó
//   CitasTaller.porDia(citas, hoy)    las citas agrupadas por día, con «Hoy», «Mañana»…
//   CitasTaller.verSeguimiento(url)   todo lo que ha pasado con una cita, en un diálogo

(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const fecha = iso => new Date(Date.parse(iso + 'T12:00:00Z'));
  const sumar = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const corta = iso => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '');

  /** 'Viernes 9 de octubre' */
  function diaLargo(iso) {
    const d = fecha(iso);
    const t = `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /** 'Hoy', 'Mañana', 'Pasado mañana' o nada. */
  function cercania(iso, hoy) {
    if (iso === hoy) return 'Hoy';
    if (iso === sumar(hoy, 1)) return 'Mañana';
    if (iso === sumar(hoy, 2)) return 'Pasado mañana';
    return '';
  }

  /** '+34600112233' → '600 11 22 33'. */
  function telefono(e164) {
    const d = String(e164 || '').replace(/\D/g, '');
    const n = d.length > 9 && d.startsWith('34') ? d.slice(2) : d;
    return n.length === 9 ? `${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}` : (e164 || '');
  }

  function turnoTexto(c) {
    if (c.turno === 'noche' && c.diaTurno !== c.fecha) return `Noche del ${corta(c.diaTurno)}`;
    return c.turno === 'noche' ? 'Turno de noche' : 'Turno de día';
  }

  /** Una persona: el nombre lleva a su ficha; el teléfono, a llamar; el icono, a su chat. */
  function persona(p, { grande = false } = {}) {
    return `<a href="/plantilla#${encodeURIComponent(p.conductorId)}" class="${grande ? 'font-semibold text-telecab-text' : 'text-telecab-text'} hover:text-telecab-gold"
               title="Abrir su ficha en Plantilla">${esc(p.nombre)}</a>` +
      (p.telefono
        ? ` <span class="whitespace-nowrap"><a href="tel:${esc(p.telefono)}" class="tabular-nums text-telecab-muted hover:text-telecab-gold" title="Llamar">${esc(telefono(p.telefono))}</a>` +
          ` <a href="/whatsapp?conductor=${encodeURIComponent(p.conductorId)}" class="text-telecab-muted hover:text-telecab-gold ml-1" title="Abrir su chat de WhatsApp"><i class="fa-brands fa-whatsapp"></i></a></span>`
        : ' <span class="text-[11px] text-telecab-warn">sin teléfono</span>');
  }

  /** QUIÉN LA LLEVA, según el planificador de ahora. */
  function responsable(c) {
    if (!c.responsable) {
      const otros = (c.otros || []).length
        ? `<div class="text-[11px] text-telecab-muted mt-1">Ese día lo llevan: ${c.otros.map(o => persona(o) + ` <span class="text-telecab-muted">(${o.turno === 'noche' ? 'noche' : 'día'})</span>`).join(' · ')}</div>`
        : '';
      return `<span class="text-telecab-warn font-semibold"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Nadie en el ${c.turno === 'noche' ? 'turno de noche' : 'turno de día'}</span>
        <div class="text-[11px] text-telecab-muted">Según el planificador, a esa hora no lo lleva nadie: que lo coloque Tráfico.</div>${otros}`;
    }
    const r = c.responsable;
    return `<div>${persona(r, { grande: true })}</div>
      <div class="text-[11px] text-telecab-muted">${esc(turnoTexto(c))}${r.rol === 'CT' ? ' · correturnos' : ''}</div>` +
      (c.cambioDeConductor
        ? `<div class="text-[11px] text-telecab-warn mt-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Se avisó a ${esc(c.aviso_conductor || 'otra persona')}: ahora lo lleva ${esc(r.nombre)}. Hay que avisarle a él.</div>`
        : '');
  }

  /** CÓMO VA EL AVISO. Sin avisar, cuándo lo hará el sistema (o que toca a mano). */
  function aviso(c, hoy, diasAntes = 2) {
    if (c.aviso_at) {
      const via = c.aviso_via === 'whatsapp' ? '<i class="fa-brands fa-whatsapp mr-1"></i>Por WhatsApp' : '<i class="fa-solid fa-hand mr-1"></i>A mano';
      return `<span class="text-telecab-green">${via}</span>
        <div class="text-[11px] text-telecab-muted">${esc(c.aviso_at)}${c.aviso_conductor ? ' · a ' + esc(c.aviso_conductor) : ''}${c.aviso_via === 'manual' && c.aviso_por ? ' · lo apuntó ' + esc(c.aviso_por) : ''}</div>`;
    }
    if (c.estado !== 'pendiente') return '<span class="text-telecab-muted">—</span>';
    const toca = sumar(c.fecha, -diasAntes);
    const error = c.aviso_error
      ? `<div class="text-[11px] text-telecab-red mt-0.5" title="${esc(c.aviso_error)}">No salió (${esc(c.aviso_intento_at || '')}): ${esc(c.aviso_error)}</div>` : '';
    if (toca > hoy) return `<span class="text-telecab-muted">Sin avisar</span><div class="text-[11px] text-telecab-muted">Lo avisa el sistema el ${esc(corta(toca))} a las 10:00</div>`;
    if (toca === hoy) return `<span class="text-telecab-warn font-semibold">Hoy</span><div class="text-[11px] text-telecab-muted">El sistema lo avisa entre las 10:00 y las 20:00</div>${error}`;
    return `<span class="text-telecab-red font-semibold">Sin avisar</span><div class="text-[11px] text-telecab-muted">Ya no lo avisa el sistema: hay que avisarle a mano</div>${error}`;
  }

  const TONO_CONF = {
    confirmada: 'bg-telecab-green/15 text-telecab-green border-telecab-green/40',
    no_puede: 'bg-telecab-red/15 text-telecab-red border-telecab-red/40',
    no_contesta: 'bg-telecab-warn/15 text-telecab-warn border-telecab-warn/40',
    otro_conductor: 'bg-telecab-violet/15 text-telecab-violet border-telecab-violet/40',
  };

  /** LO QUE CONTESTÓ, en una pastilla, y por dónde. */
  function confirmacion(c) {
    if (c.estado !== 'pendiente') {
      const t = { hecha: 'bg-telecab-green/15 text-telecab-green border-telecab-green/40',
        no_presentado: 'bg-telecab-red/15 text-telecab-red border-telecab-red/40' }[c.estado] || 'bg-telecab-card2 text-telecab-muted border-telecab-border';
      return `<span class="inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${t}">${esc(c.estadoEtiqueta)}</span>`;
    }
    if (!c.confirmacion) return '<span class="inline-block px-2 py-0.5 rounded-full border border-telecab-border text-[11px] text-telecab-muted">Sin confirmar</span>';
    const via = c.confirmacion_via === 'whatsapp' ? 'por WhatsApp' : 'en llamada';
    return `<span class="inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${TONO_CONF[c.confirmacion] || ''}">${esc(c.confirmacionEtiqueta)}</span>
      <div class="text-[11px] text-telecab-muted mt-0.5">${esc(via)} · ${esc(c.confirmacion_at || '')}${c.confirmacion_por ? ' · ' + esc(c.confirmacion_por) : ''}</div>`;
  }

  /** La última llamada de Control, en una línea. */
  function ultimaLlamada(c) {
    const u = c.ultima_llamada;
    if (!u) return '<span class="text-[11px] text-telecab-muted">Sin llamadas</span>';
    return `<div class="text-xs text-telecab-text">${esc(u.resultado)}${c.llamadas > 1 ? ` <span class="text-telecab-muted">(${c.llamadas} llamadas)</span>` : ''}</div>
      <div class="text-[11px] text-telecab-muted">${esc(u.cuando)}${u.quien ? ' · ' + esc(u.quien) : ''}${u.nota ? ' · ' + esc(u.nota) : ''}</div>`;
  }

  /** Las citas por día, en orden, con su etiqueta. */
  function porDia(citas, hoy) {
    const m = new Map();
    citas.forEach(c => { if (!m.has(c.fecha)) m.set(c.fecha, []); m.get(c.fecha).push(c); });
    return [...m.entries()].map(([f, cs]) => ({ fecha: f, titulo: diaLargo(f), cerca: cercania(f, hoy), citas: cs }));
  }

  const ICONO_SEG = { aviso: 'fa-paper-plane', respuesta: 'fa-reply', llamada: 'fa-phone', estado: 'fa-flag' };

  /** TODO LO QUE HA PASADO con una cita, lo último arriba. */
  async function verSeguimiento(url) {
    try {
      const j = await fetch(url).then(r => r.json());
      if (j.status !== 'ok') throw new Error(j.msg || 'Error');
      const c = j.cita;
      const lineas = (c.seguimiento || []).map(s => `
        <li class="flex gap-3 py-2 border-b border-telecab-border/60 last:border-0">
          <i class="fa-solid ${ICONO_SEG[s.tipo] || 'fa-circle'} text-telecab-muted mt-1 w-4 text-center"></i>
          <div class="min-w-0">
            <div class="text-sm text-telecab-text">${esc(s.resultado || s.tipo)}</div>
            <div class="text-[11px] text-telecab-muted">${esc(s.cuando)}${s.quien ? ' · ' + esc(s.quien) : ''}${s.conductor ? ' · ' + esc(s.conductor) : ''}</div>
            ${s.nota ? `<div class="text-xs text-telecab-text mt-0.5">${esc(s.nota)}</div>` : ''}
          </div>
        </li>`).join('');
      await Dialogo.aviso({
        titulo: `${c.matricula} · ${diaLargo(c.fecha)} a las ${c.hora}`, ancho: 'max-w-lg',
        html: `<div class="text-sm mb-3">${responsable(c)}</div>
          <p class="text-[11px] uppercase tracking-wide text-telecab-muted mb-1">Seguimiento</p>
          ${lineas ? `<ul>${lineas}</ul>` : '<p class="text-sm text-telecab-muted">Todavía no ha pasado nada con esta cita.</p>'}
          <p class="text-[11px] text-telecab-muted mt-3">Del Excel «${esc(c.fichero || '—')}», subido el ${esc(c.creado_at || '')}.</p>`,
      });
    } catch (e) {
      Dialogo.aviso({ titulo: 'No se pudo abrir la cita', texto: e.message, tono: 'error' });
    }
  }

  global.CitasTaller = { esc, diaLargo, cercania, telefono, responsable, aviso, confirmacion, ultimaLlamada, porDia, verSeguimiento, sumar };
})(window);
