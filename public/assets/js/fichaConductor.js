// ============================================================
// FICHA DEL CONDUCTOR — la hoja de una persona, densa y de un vistazo
// ============================================================
// Una sola pantalla con lo que hay que saber de alguien: su calificación, cómo
// va de horas y de dinero, qué papeles le faltan, cómo conduce y qué se ha
// hablado con él. Está pensada para leerse entera sin desplegar nada, como una
// hoja de papel: por eso va en dos columnas y con la tipografía apretada, y no
// como la lista de campos de siempre.
//
// ── Los huecos se ven ───────────────────────────────────────────────────────
// El modelo que la inspira tiene más cosas de las que hoy sabemos: siniestros,
// multas, pluses, finiquito. Esos bloques SALEN, marcados como pendientes de
// conectar, en vez de desaparecer. Un hueco visible es una lista de trabajo; un
// bloque ausente no es nada, y dentro de tres meses nadie recuerda que faltaba.
//
// Se usa así:  FichaConductor.pintar(hueco, datos, { nombre, subtitulo, estado })

(function (global) {
  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const num = (v, dec) => (v == null || v === ''
    ? '—'
    : Number(v).toFixed(dec == null ? 0 : dec).replace('.', ','));
  const fecha = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
  const fechaHora = s => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : '—');

  // El tono de la letra, el mismo que en el cuadrante: si alguien ve una C aquí
  // y una C allí, tiene que ser el mismo color o parecerán cosas distintas.
  const TONO_LETRA = {
    A: 'bg-telecab-green/15 text-telecab-green border-telecab-green/40',
    B: 'bg-telecab-gold/15 text-telecab-gold border-telecab-gold/40',
    C: 'bg-telecab-warn/15 text-telecab-warn border-telecab-warn/40',
    D: 'bg-telecab-red/15 text-telecab-red border-telecab-red/40',
    'N/E': 'bg-telecab-muted/10 text-telecab-muted border-telecab-border',
  };
  const TONO_DOC = {
    ok: 'bg-telecab-green/10 text-telecab-green border-telecab-green/30',
    pronto: 'bg-telecab-warn/10 text-telecab-warn border-telecab-warn/30',
    caducado: 'bg-telecab-red/10 text-telecab-red border-telecab-red/30',
    falta: 'bg-telecab-red/10 text-telecab-red border-telecab-red/30',
    sin: 'bg-telecab-muted/10 text-telecab-muted border-telecab-border',
  };

  /**
   * Un epígrafe de sección: la regla horizontal con su título en versalitas y,
   * si el apartado se puede editar, su lápiz a la derecha. El lápiz abre los
   * campos DE ESE apartado: pinchar en "Dirección" no puede sacar los treinta
   * campos de la ficha, porque entonces nadie sabe qué está cambiando.
   */
  const epigrafe = (t, editarGrupo) =>
    `<div class="col-span-full mt-3 mb-1 flex items-center gap-2">
       <span class="text-[10px] uppercase tracking-[0.12em] font-bold text-telecab-muted whitespace-nowrap">${esc(t)}</span>
       <span class="flex-1 h-px bg-telecab-border/70"></span>
       ${editarGrupo
      ? `<button data-editar="${esc(editarGrupo)}" title="Editar ${esc(editarGrupo)}"
                 class="shrink-0 text-telecab-muted hover:text-telecab-gold transition px-1">
           <i class="fa-solid fa-pen text-[10px]"></i></button>`
      : ''}
     </div>`;

  /** Una línea "etiqueta … valor" de las tablas a dos columnas. */
  const linea = (et, val, clase) =>
    `<div class="flex items-baseline justify-between gap-3 py-[3px] border-b border-telecab-border/30 last:border-0">
       <span class="text-[13px] text-telecab-muted shrink-0">${esc(et)}</span>
       <span class="text-[13px] font-semibold text-right ${clase || 'text-telecab-text'}">${val}</span>
     </div>`;

  /** La tarjeta de un número grande con su comparación contra el mes anterior. */
  function tarjeta(k) {
    const v = k.valor == null ? '—'
      : (typeof k.valor === 'number' ? num(k.valor, k.id === 'euros_hora' ? 2 : 1) : esc(k.valor));
    let pie = '';
    if (k.delta != null && k.delta !== 0) {
      const sube = k.delta > 0;
      pie = `<p class="text-[11px] ${sube ? 'text-telecab-green' : 'text-telecab-red'} mt-0.5">
               ${sube ? '▲' : '▼'} ${sube ? '+' : ''}${num(k.delta, 2)}${esc(k.unidadDelta || '')} vs mes anterior</p>`;
    } else if (k.delta === 0) {
      pie = '<p class="text-[11px] text-telecab-muted mt-0.5">= igual que el mes anterior</p>';
    } else if (k.detalle) {
      pie = `<p class="text-[11px] ${k.nota ? 'text-telecab-warn' : 'text-telecab-muted'} mt-0.5">${esc(k.nota || k.detalle)}</p>`;
    }
    return `<div class="px-3 py-2 rounded-xl border border-telecab-border bg-telecab-dark/40">
        <p class="text-[10px] uppercase tracking-wide text-telecab-muted">${esc(k.etiqueta)}</p>
        <p class="text-xl font-bold text-telecab-text leading-tight">${v}${esc(k.sufijo || '')}</p>
        ${pie}
      </div>`;
  }

  /** La semana en siete casillas: verde el día que sale, apagado el que libra. */
  function semana(dias) {
    return `<div class="grid grid-cols-7 gap-1">${dias.map(d => `
      <div class="text-center py-1 rounded-lg border text-[12px] font-bold
                  ${d.trabaja
        ? 'border-telecab-green/40 bg-telecab-green/10 text-telecab-green'
        : 'border-telecab-border bg-telecab-dark/40 text-telecab-muted'}"
           title="${d.trabaja ? 'Trabaja' : 'Libra'}">${d.letra}</div>`).join('')}</div>`;
  }

  /** Un bloque que todavía no tiene datos: se ve, y dice qué le falta. */
  const pendiente = p =>
    `<div class="px-3 py-2 rounded-xl border border-dashed border-telecab-border/70 bg-telecab-dark/20">
       <p class="text-[12px] font-semibold text-telecab-muted">${esc(p.bloque)}</p>
       <p class="text-[11px] text-telecab-muted/70 mt-0.5">Pendiente de conectar: ${esc(p.que)}</p>
     </div>`;

  function pintar(hueco, f, ctx) {
    const c = f.calificacion;
    const m = f.mesActual;
    const v = f.velocidad;
    const cab = ctx || {};
    const p = cab.persona || {};
    // El lápiz solo se pinta si el rol puede tocar ese apartado. Un botón que
    // siempre falla es peor que no tener botón.
    const ed = g => (cab.puedeEditar && cab.onEditar ? g : null);
    const fmt = cab.fecha || fecha;

    const letra = c ? c.letra : 'N/E';
    const chipLetra = `<span class="inline-flex items-center justify-center w-7 h-7 rounded-full border text-[13px] font-bold align-middle ${TONO_LETRA[letra] || TONO_LETRA['N/E']}"
        title="${esc(c && c.total != null ? `${num(c.total, 2)} puntos · ${c.desde ? fecha(c.desde) + ' – ' + fecha(c.hasta) : ''}` : (c && c.motivo) || 'sin calificar')}">${esc(letra)}</span>`;

    // ── Cabecera ──────────────────────────────────────────────────────────
    const cabecera = `
      <div class="flex flex-wrap items-start justify-between gap-2 pb-2 border-b border-telecab-border">
        <div class="min-w-0">
          <h2 class="text-lg font-bold text-telecab-text leading-tight">
            ${esc(cab.nombre || '')} ${chipLetra}</h2>
          <p class="text-[11px] text-telecab-muted mt-0.5">${esc(cab.subtitulo || '')}</p>
        </div>
        <div class="text-right shrink-0">
          ${cab.estado ? `<span class="text-[11px] px-2 py-0.5 rounded-full border ${esc(cab.estadoClase || 'border-telecab-border text-telecab-muted')}">${esc(cab.estado)}</span>` : ''}
          <p class="text-[11px] text-telecab-muted mt-1">Ficha de ${esc(f.mes.nombre)}</p>
        </div>
      </div>`;

    // ── Lo que hay que arreglar, antes que nada ───────────────────────────
    // Iba en un bloque aparte y ahora va aquí: es lo primero que hay que ver al
    // abrir a alguien, no algo que se encuentra bajando.
    const faltan = (p.faltan || []).length
      ? `<div class="mt-3 px-3 py-2 rounded-xl border border-telecab-warn/40 bg-telecab-warn/5">
           <p class="text-[11px] uppercase tracking-wide text-telecab-warn font-bold mb-1">
             <i class="fa-solid fa-triangle-exclamation"></i> Falta por completar</p>
           <p class="text-[12px] text-telecab-text">${p.faltan.map(esc).join(' · ')}</p>
         </div>`
      : '';

    // ── Los cuatro números ────────────────────────────────────────────────
    const kpis = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">${f.kpis.map(tarjeta).join('')}</div>`;

    // ── La semana y el coche ──────────────────────────────────────────────
    const coches = (f.coches || []).map(x =>
      `${esc(x.matricula)} <span class="text-telecab-muted">· ${esc(x.rol === 'CT' ? 'CT' : 'Fijo')} ${esc(x.turno)}${x.zona ? ' · ' + esc(x.zona) : ''}${x.cuadrante ? ' · ' + esc(x.cuadrante) : ''}</span>`
    ).join('<br>') || '<span class="text-telecab-warn">Sin coche asignado</span>';
    // El turno, la libranza y la situación se cambian DESDE AQUÍ: es donde se
    // están mirando. Los botones son los mismos que la ficha ya tenía arriba;
    // cambia que ahora están al lado del dato que modifican.
    const btn = (attr, txt, ico) =>
      `<button data-${attr} class="text-[11px] px-2 py-0.5 rounded-lg border border-telecab-border
               text-telecab-muted hover:text-telecab-gold hover:border-telecab-gold transition">
         <i class="fa-solid ${ico} text-[9px] mr-1"></i>${txt}</button>`;

    const jornada = `
      <div class="col-span-full mt-3 mb-1 flex items-center gap-2">
        <span class="text-[10px] uppercase tracking-[0.12em] font-bold text-telecab-muted whitespace-nowrap">Jornada semanal</span>
        <span class="flex-1 h-px bg-telecab-border/70"></span>
        <span class="flex items-center gap-1 shrink-0">
          ${btn('turno', 'Turno', 'fa-clock')}
          ${btn('libranzas', 'Libranzas', 'fa-calendar-week')}
          ${btn('situacion', 'Situación', 'fa-user-clock')}
        </span>
      </div>
      <div class="col-span-full grid sm:grid-cols-[1fr_auto] gap-3 items-center">
        <div>${semana(f.semana)}</div>
        <p class="text-[12px] text-telecab-text sm:text-right">${coches}</p>
      </div>`;

    // ── Quién es y de dónde viene ─────────────────────────────────────────
    const tel = (p.telefonos || []).find(t => !t.vigente_hasta);
    const personales = `
      ${/* El bloque enseña campos de cuatro apartados distintos —identidad,
            dirección, contacto y Seguridad Social—, así que su lápiz los abre
            todos. '*' significa "sin filtrar por apartado". */ ''}
      ${epigrafe('Datos personales', ed('*'))}
      <div>
        ${linea('Teléfono', tel ? `<span class="tabular-nums">${esc(tel.e164)}</span>` : '<span class="text-telecab-warn">sin teléfono</span>')}
        ${linea('Dirección', esc(p.direccion || '—'))}
        ${linea('Contacto de emergencia', esc(p.tel_emergencia || '—'))}
        ${linea('Correo', esc(p.email || '—'))}
      </div>
      <div>
        ${linea(esc(p.dni_tipo || 'DNI'), esc(p.dni_nie || '—'))}
        ${linea('Nacimiento', fmt(p.fecha_nacimiento))}
        ${linea('Nacionalidad', esc(p.nacionalidad || '—'))}
        ${linea('NAF', esc(p.naf || '—'))}
      </div>

      ${epigrafe('Origen y contrato')}
      <div>
        ${linea('Tipo de contrato', esc(p.empleo_tipo === 'ett'
      ? `ETT${p.ett_nombre ? ' · ' + p.ett_nombre : ''}` : 'Plantilla propia'))}
        ${linea('Jornada', p.jornada_horas ? esc(p.jornada_horas) + ' h/semana' : '—')}
        ${linea('Alta', fmt(p.alta))}
        ${linea('Antigüedad reconocida', fmt(p.antiguedad))}
      </div>
      <div>
        ${linea('Turno', esc(p.turno || '—'))}
        ${linea('Libra', esc(p.libranzas || '—'))}
        ${linea('Zona', esc(p.zona || '—'))}
        ${linea('Recomendado por', esc(p.recomendador || '—'))}
      </div>

      ${p.empleo_vigente === false ? `
      ${epigrafe('Baja')}
      <div>${linea('Causó baja el', fmt(p.fecha_baja || p.baja), 'text-telecab-red')}</div>
      <div>${linea('Motivo', esc(p.motivo_baja || '—'))}</div>` : ''}
`;

    // ── Documentación ─────────────────────────────────────────────────────
    const docs = `
      ${epigrafe('Documentación')}
      <div class="col-span-full flex flex-wrap gap-1.5">
        ${(f.documentacion || []).length
        ? f.documentacion.map(d => `<span class="text-[10px] px-2 py-0.5 rounded-full border ${TONO_DOC[d.estado] || TONO_DOC.sin}"
             title="${esc(d.caduca ? 'Caduca el ' + fecha(d.caduca) : (d.obligatorio ? 'Obligatorio' : 'Opcional'))}">${esc(d.texto)}</span>`).join('')
        : '<span class="text-[12px] text-telecab-muted">Sin documentos registrados.</span>'}
      </div>`;

    // ── Operativa y conducción | Calidad (pendiente) ───────────────────────
    const operativa = `
      ${epigrafe('Operativa y conducción')}
      <div>
        ${linea('Excesos de velocidad (14 días)', num(v && v.ult14),
      (v && v.ult14 > 2) ? 'text-telecab-red' : (v && v.ult14 ? 'text-telecab-warn' : 'text-telecab-green'))}
        ${linea('Excesos totales registrados', num(v && v.total))}
        ${linea('Avisos recibidos', num(v && v.avisos), (v && v.avisos) ? 'text-telecab-warn' : '')}
        ${linea('Velocidad punta', v && v.punta ? num(v.punta) + ' km/h' : '—')}
        ${linea('Último exceso', v && v.ultimo ? fecha(v.ultimo) : 'ninguno')}
      </div>
      <div>
        ${linea('Viajes rechazados', m ? num(m.rechazados) : '—')}
        ${linea('Ofertas perdidas', m ? `${num(m.perdidas)} de ${num(m.ofertas)}` : '—')}
        ${linea('% de ofertas perdidas', m && m.pctPerdidas != null ? num(m.pctPerdidas, 1) + ' %' : '—',
      m && m.pctPerdidas > 25 ? 'text-telecab-warn' : '')}
        ${linea('Sin responder', m ? num(m.sinRespuesta) : '—')}
        ${linea('Canceladas por él', m ? num(m.canceladas) : '—')}
      </div>`;

    // ── El mes ────────────────────────────────────────────────────────────
    const economico = `
      ${epigrafe('El mes de ' + f.mes.nombre)}
      <div>
        ${linea('Horas efectivas', m ? num(m.horasEfectivas, 1) + ' h' : '—')}
        ${linea('En viaje', m ? num(m.horasViaje, 1) + ' h' : '—')}
        ${linea('En espera', m ? num(m.horasEspera, 1) + ' h' : '—')}
        ${linea('Días trabajados', m ? num(m.diasTrabajados) : '—')}
        ${linea('Promedio por día', m ? num(m.horasPorDia, 1) + ' h' : '—')}
        ${linea('Coches distintos', m ? num(m.cochesDistintos) : '—')}
      </div>
      <div>
        ${linea('Facturación generada', m && m.neto != null ? num(m.neto, 2) + ' €' : '—', 'text-telecab-green')}
        ${linea('Propinas', m && m.propina != null ? num(m.propina, 2) + ' €' : '—')}
        ${linea('Ingreso por hora', m && m.eurosHora != null ? num(m.eurosHora, 2) + ' €' : '—')}
        ${linea('Ingreso por viaje', m && m.eurosViaje != null ? num(m.eurosViaje, 2) + ' €' : '—')}
        ${linea('Viajes', m ? num(m.viajes) : '—')}
        ${linea('Viajes por hora', m && m.viajesHora != null ? num(m.viajesHora, 2) : '—')}
      </div>
      ${f.mesAnterior ? `<p class="col-span-full text-[11px] text-telecab-muted mt-1">
        Mes anterior: ${num(f.mesAnterior.horasEfectivas, 1)} h · ${num(f.mesAnterior.neto, 2)} € ·
        ${num(f.mesAnterior.eurosHora, 2)} €/h · ${num(f.mesAnterior.utilizacion, 1)} % de utilización</p>` : ''}`;

    // ── Cómo se calculó la letra ──────────────────────────────────────────
    const calif = c ? `
      ${epigrafe('Cómo se calcula su calificación')}
      <div class="col-span-full rounded-xl border border-telecab-border bg-telecab-dark/30 px-3 py-2">
        ${c.total == null
        ? `<p class="text-[12px] text-telecab-muted">Sin calificar: ${esc(c.motivo || 'datos insuficientes')}.</p>`
        : `<div class="grid sm:grid-cols-3 gap-x-4">
             ${linea(`Horas · ${num(c.horas_prom, 2)} h/día en ${c.dias_trabajados} día(s)`, `${c.pts_horas} pts <span class="text-telecab-muted font-normal">× 50 %</span>`)}
             ${linea(`Utilización · ${num(c.util_prom, 2)} %`, `${c.pts_utilizacion} pts <span class="text-telecab-muted font-normal">× 30 %</span>`)}
             ${linea(`Excesos · ${c.excesos_total} en el periodo`, `${c.pts_velocidad} pts <span class="text-telecab-muted font-normal">× 20 %</span>`)}
           </div>
           <div class="flex flex-wrap items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-telecab-border/50">
             <p class="text-[11px] text-telecab-muted">
               Periodo ${fecha(c.desde)} – ${fecha(c.hasta)} · modelo ${esc(c.version_modelo)}
               ${c.dias_telemetria != null && c.dias_telemetria < 14
          ? ` · <span class="text-telecab-warn">solo ${c.dias_telemetria} día(s) de telemetría: faltan excesos por contar</span>` : ''}</p>
             <p class="text-[12px] font-bold">${num(c.total, 2)} puntos → ${esc(c.letra)}
               ${c.tope_aplicado ? `<span class="text-telecab-warn font-normal">(por puntos sería ${esc(c.letra_por_puntos)}; la baja el tope por velocidad)</span>` : ''}</p>
           </div>`}
      </div>
      ${(f.historicoCalificacion || []).length > 1 ? `
      <div class="col-span-full flex flex-wrap items-center gap-1.5 mt-1">
        <span class="text-[11px] text-telecab-muted">Periodos anteriores:</span>
        ${f.historicoCalificacion.slice(1).map(h =>
        `<span class="text-[10px] px-1.5 py-0.5 rounded border ${TONO_LETRA[h.letra] || TONO_LETRA['N/E']}"
                title="${esc(fecha(h.hasta))}">${esc(h.letra)}${h.total != null ? ' · ' + num(h.total, 0) : ''}</span>`).join('')}
      </div>` : ''}` : '';

    // ── Lo que se ha hablado con él ───────────────────────────────────────
    const fila = (cuando, texto, cola, tono) =>
      `<div class="flex items-baseline gap-2 py-[3px] text-[12px] border-b border-telecab-border/25 last:border-0">
         <span class="text-telecab-muted tabular-nums shrink-0 w-[74px]">${esc(cuando)}</span>
         <span class="flex-1 min-w-0 text-telecab-text">${esc(texto)}</span>
         <span class="shrink-0 ${tono || 'text-telecab-muted'}">${esc(cola || '')}</span>
       </div>`;

    const comunicaciones = `
      ${epigrafe('Comunicaciones e incidencias')}
      <div class="col-span-full">
        ${[
        ...(f.llamadas || []).map(l => fila(fechaHora(l.cuando),
          `Llamada de seguimiento${l.nota ? ' · ' + l.nota : ''}`, l.resultado || '')),
        ...(f.justificantes || []).map(j => fila(fecha(j.dia),
          `Justificante de ${j.tipo || 'sin tipo'}${j.observacion ? ' · ' + j.observacion : ''}`,
          (j.horas != null ? num(j.horas, 1) + ' h' : '') + (j.anulado ? ' · anulado' : ''),
          j.anulado ? 'text-telecab-muted line-through' : 'text-telecab-gold')),
      ].join('') || '<p class="text-[12px] text-telecab-muted">Sin comunicaciones registradas.</p>'}
      </div>`;

    // ── Expediente ────────────────────────────────────────────────────────
    const expediente = `
      ${epigrafe(`Expediente de conducción${v && v.total ? ` — ${v.total} exceso(s), ${v.avisos} aviso(s) enviado(s)` : ' — sin antecedentes'}`)}
      <div class="col-span-full">
        ${(f.avisos || []).length
        ? f.avisos.map(a => fila(fechaHora(a.cuando),
          `${a.placa} · ${num(a.velocidad)} km/h (límite ${num(a.limite)})`,
          a.estado === 'avisado' ? 'avisado' : a.estado === 'dudoso' ? 'sin avisar · dudoso' : 'no enviado',
          a.estado === 'avisado' ? 'text-telecab-red' : 'text-telecab-muted')).join('')
        : '<p class="text-[12px] text-telecab-muted">Ni un exceso de velocidad registrado.</p>'}
      </div>`;

    // ── Lo que falta por conectar ─────────────────────────────────────────
    const pendientes = `
      ${epigrafe('Todavía sin datos en el sistema')}
      <div class="col-span-full grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        ${(f.pendientes || []).map(pendiente).join('')}
      </div>`;

    hueco.className = 'p-5';
    hueco.innerHTML = `
      ${cabecera}
      ${faltan}
      ${kpis}
      <div class="grid sm:grid-cols-2 gap-x-6 mt-1">
        ${jornada}
        ${personales}
        ${docs}
        ${operativa}
        ${economico}
        ${calif}
        ${comunicaciones}
        ${expediente}
        ${pendientes}
      </div>
      <p class="text-[10px] text-telecab-muted/70 mt-4 pt-2 border-t border-telecab-border/40">
        Documento interno de gestión. Los importes salen de la facturación de BOLT y no sustituyen a la nómina.
        Contiene datos personales: tratamiento restringido a RRHH y Operaciones.
      </p>`;

    // Cada lápiz abre su apartado. Se engancha DESPUÉS de pintar, una sola vez.
    if (cab.onEditar) {
      hueco.querySelectorAll('[data-editar]').forEach(b =>
        b.addEventListener('click', () => cab.onEditar(b.dataset.editar)));
    }
    const boton = (sel, fn) => {
      const b = hueco.querySelector(sel);
      if (b && fn) b.addEventListener('click', fn);
      else if (b) b.remove();
    };
    boton('[data-situacion]', cab.onSituacion);
    boton('[data-turno]', cab.onTurno);
    boton('[data-libranzas]', cab.onLibranzas);
  }

  global.FichaConductor = { pintar };
})(window);
