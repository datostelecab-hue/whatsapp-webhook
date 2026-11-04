// views/rrhh.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

  const $ = s => document.querySelector(s);
  let ticketActual = null;
  let autoAbierto = false;   // para abrir una sola vez la ficha que llega por ?tel=
  const esc = Casa.esc;

  // Pasa por Api (03/11/2026): sin el velo, el `boton` que se le da es lo que
  // impide mandar dos veces lo mismo con un doble clic. Al fallar devuelve
  // igualmente un objeto con `status`, que es lo que miran quienes lo llaman.
  async function api(url, body, boton) {
    try { return await Api.post(url, body || {}, { boton }); }
    catch (e) { return e.respuesta || { status: 'error', msg: e.message }; }
  }
  function msg(texto, ok) {
    const el = $('#ficha-msg');
    el.textContent = texto;
    el.className = 'text-xs mt-3 ' + (ok ? 'text-telecab-green' : 'text-telecab-red');
    el.classList.remove('hidden');
  }

  // Campos de Selección que RRHH tiene que revisar antes del alta.
  const CAMPOS = [
    ['Datos personales', [
      ['nombre', 'Nombre'], ['apellidos', 'Apellidos'], ['dni', 'DNI / NIE'],
      ['fecha_nacimiento', 'F. nacimiento'], ['nacionalidad', 'Nacionalidad'],
      ['estado_civil', 'Estado civil'], ['num_hijos', 'Nº hijos'],
      ['email', 'Email'], ['id', 'Teléfono'], ['contacto_emergencia', 'Contacto emergencia']
    ]],
    ['Dirección', [
      ['direccion', 'Dirección'], ['codigo_postal', 'C.P.'],
      ['localidad', 'Localidad'], ['provincia', 'Provincia']
    ]],
    ['Datos laborales', [
      ['num_seg_social', 'Nº Seg. Social'], ['iban', 'IBAN'],
      ['tipo_carnet', 'Tipo carnet'], ['carnet_expedicion', 'Carnet exped.'], ['carnet_caducidad', 'Carnet cad.'],
      ['jornada', 'Jornada'],
      // La modalidad (CT-100/CT-200) y el contrato salen de la jornada, no hay campo
      // propio: 40h → CT-100 · 32h → CT-200; +ETT según el origen de la ficha.
      ['_contrato', 'Tipo contrato', t => {
        const h = String(t.jornada || '').replace(/\D/g, '');
        if (!h) return '';
        const mod = h === '32' ? 'CT-200' : 'CT-100';
        const base = h === '32' ? '32h' : '40h';
        return `${mod} (${t.ett ? base + ' ETT' : base})`;
      }],
      ['turno', 'Turno'], ['zona', 'Zona'], ['canal', 'Canal']
    ]]
  ];

  // Campos con control especial al editar.
  const FECHAS = { fecha_nacimiento: 'data-max="today"', carnet_expedicion: 'data-max="today"', carnet_caducidad: 'data-min="today"' };
  const SELECTS = { jornada: ['40 HORAS', '32 HORAS'], turno: ['', 'Día', 'Noche', 'TodoTurno'] };
  const SOLO_LECTURA = new Set(['id']);   // el teléfono es la clave; no se edita
  const INP = 'w-full text-xs text-right bg-transparent border border-transparent rounded px-1 py-0.5 text-telecab-text hover:border-telecab-border focus:border-telecab-gold focus:bg-telecab-dark focus:outline-none transition';

  // `etq` es el rótulo que se ve al lado: el control lo lleva como nombre. Los
  // abreviados, con la forma larga detrás (el lector deletrea «C.P.»).
  const NOMBRE_LARGO = {
    fecha_nacimiento: 'F. nacimiento (fecha de nacimiento)',
    num_hijos: 'Nº hijos (número de hijos)',
    codigo_postal: 'C.P. (código postal)',
    num_seg_social: 'Nº Seg. Social (número de la Seguridad Social)',
    carnet_expedicion: 'Carnet exped. (expedición del carnet)',
    carnet_caducidad: 'Carnet cad. (caducidad del carnet)',
  };
  function control(k, val, etq) {
    const v = esc(val || '');
    const nombre = `aria-label="${esc(NOMBRE_LARGO[k] || etq || k)}"`;
    if (FECHAS[k]) return `<input data-edit="${k}" ${nombre} value="${v}" placeholder="dd/mm/aaaa" readonly ${FECHAS[k]} class="js-fecha ${INP}">`;
    if (SELECTS[k]) return `<select data-edit="${k}" ${nombre} class="${INP} cursor-pointer">${SELECTS[k].map(o => `<option value="${esc(o)}" ${String(val || '') === o ? 'selected' : ''}>${o || '—'}</option>`).join('')}</select>`;
    return `<input data-edit="${k}" ${nombre} value="${v}" placeholder="— falta" class="${INP}">`;
  }

  function pintarDatos(t) {
    $('#ficha-datos').innerHTML = CAMPOS.map(([grupo, campos]) =>
      `<div class="min-w-0">
         <p class="text-[10px] uppercase tracking-wide text-telecab-gold/80 mb-1 mt-2">${grupo}</p>
         ${campos.map(([k, label, fn]) => {
           const editable = !fn && !SOLO_LECTURA.has(k);   // los computados (fn) y el teléfono no se editan
           let valorHtml;
           if (editable) {
             valorHtml = control(k, t[k], label);
           } else {
             const val = fn ? fn(t) : t[k];
             const vacio = !val || !String(val).trim();
             valorHtml = `<span class="text-xs text-right break-words ${vacio ? 'text-telecab-red/80 italic' : 'text-telecab-text'}">${vacio ? '— falta' : esc(val)}</span>`;
           }
           return `<div class="flex items-center justify-between gap-3 py-1 border-b border-telecab-border/30">
               <span class="text-xs text-telecab-muted shrink-0">${label}</span>
               <span class="min-w-0 flex-1 flex justify-end">${valorHtml}</span>
             </div>`;
         }).join('')}
       </div>`).join('');
  }

  // Recoge los campos editados de la ficha.
  function recogerEdits() {
    const d = {};
    document.querySelectorAll('#ficha-datos [data-edit]').forEach(el => { d[el.dataset.edit] = (el.value || '').trim(); });
    return d;
  }
  // Guarda los datos editados en el ticket (fusiona, no pisa el resto).
  async function guardarDatos(boton) {
    if (!ticketActual) return null;
    const edits = recogerEdits();
    const r = await api('/seleccion/ticket', { tel: ticketActual.id, ...edits }, boton);
    if (r && r.status === 'ok') Object.assign(ticketActual, edits);   // refleja los cambios en local
    return r;
  }

  function pintarDocs(t) {
    const docs = t.documentos || [];
    $('#ficha-docs').innerHTML = docs.map(d => {
      const url = `/rrhh/doc?tel=${encodeURIComponent(t.id)}&tipo=${d.key}`;
      if (!d.tiene) {
        return `<div class="rounded-xl border border-telecab-red/30 bg-telecab-red/5 p-2 flex flex-col">
            <span class="text-[10px] text-telecab-muted leading-tight mb-1">${esc(d.label)}</span>
            <span class="text-xs text-telecab-red flex items-center gap-1 mt-auto"><i class="fa-solid fa-triangle-exclamation"></i> Falta</span>
          </div>`;
      }
      const esImg = /^image\//.test(d.mime || '');
      const cuerpo = esImg
        ? `<a href="${url}" target="_blank" rel="noopener" class="block"><img src="${url}" loading="lazy" class="w-full h-24 object-cover rounded-lg border border-telecab-border bg-telecab-dark" alt="${esc(d.label)}"></a>`
        : `<a href="${url}" target="_blank" rel="noopener" class="flex flex-col items-center justify-center gap-1 h-24 rounded-lg border border-telecab-border bg-telecab-dark/40 text-telecab-gold text-xs" aria-label="Abrir ${esc(d.label)}"><i class="fa-solid fa-file-pdf text-lg" aria-hidden="true"></i> Abrir</a>`;
      return `<div class="rounded-xl border border-telecab-border bg-telecab-dark/30 p-2 flex flex-col gap-1.5">
          <span class="text-[10px] text-telecab-muted leading-tight">${esc(d.label)}</span>
          ${cuerpo}
        </div>`;
    }).join('');

    const pdf = $('#ficha-pdf');
    if (t.ficha_pdf_link) {
      pdf.innerHTML = `<a href="/rrhh/doc?tel=${encodeURIComponent(t.id)}&tipo=ficha_pdf" target="_blank" rel="noopener"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-telecab-green/10 border border-telecab-green/40 text-telecab-green text-xs font-medium hover:bg-telecab-green/20 transition">
          <i class="fa-solid fa-file-contract"></i> Ver FICHA DE ALTA (PDF)</a>`;
    } else {
      pdf.innerHTML = `<span class="inline-flex items-center gap-2 text-xs text-telecab-red"><i class="fa-solid fa-triangle-exclamation"></i> Falta la FICHA DE ALTA en PDF.</span>`;
    }
  }

  // El alta solo se habilita si la ficha va en un Excel Y RRHH la ha verificado.
  function actualizarBtnAlta() {
    const enExcel = (ticketActual && ticketActual.excel_alta || '').toString().trim();
    const verificado = $('#chk-verificado').checked;
    $('#btn-alta').disabled = !(enExcel && verificado);
  }

  function abrirFicha(t, sinScroll) {
    ticketActual = t;
    // Cada ficha exige verificación fresca; en la reapertura silenciosa (tras generar
    // el Excel) se conserva lo que RRHH ya había marcado.
    if (!sinScroll) $('#chk-verificado').checked = false;
    $('#ficha').classList.remove('hidden');
    $('#ficha-nombre').querySelector('span').textContent = `${t.nombre || '(sin nombre)'}${t.apellidos ? ' ' + t.apellidos : ''}`;
    $('#ficha-ett').classList.toggle('hidden', !t.ett);
    const bits = [t.id];
    if (t.zona) bits.push(t.zona);
    if (t.canal) bits.push(t.canal);
    if (t.fecha_deteccion) bits.push('detectado ' + t.fecha_deteccion);
    $('#ficha-sub').textContent = bits.join(' · ');

    pintarDatos(t);
    pintarDocs(t);

    $('[data-campo="fecha_alta"]').value = t.fecha_alta || '';
    $('[data-campo="fecha_habilitado"]').value = t.fecha_habilitado || '';

    // Candado del Excel: no se da el alta si la ficha no ha ido en un Excel de altas.
    const enExcel = (t.excel_alta || '').toString().trim();
    const notaExcel = $('#nota-excel');
    if (enExcel) {
      notaExcel.innerHTML = '<i class="fa-solid fa-file-excel mr-1"></i> Incluida en el Excel «' + esc(enExcel) + '».';
      notaExcel.className = 'text-xs mt-3 text-telecab-green';
    } else {
      const tipo = t.ett ? 'ETT' : 'de nuestro grupo';
      notaExcel.innerHTML = '<i class="fa-solid fa-triangle-exclamation mr-1"></i> Aún no está en ningún Excel de altas — inclúyela en el Excel ' + tipo + ' (márcala + fecha → Generar) antes del alta.';
      notaExcel.className = 'text-xs mt-3 text-telecab-gold';
    }
    actualizarBtnAlta();
    $('#ficha-msg').classList.add('hidden');
    if (!sinScroll) $('#ficha').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('#chk-verificado').addEventListener('change', actualizarBtnAlta);

  // Guardar los datos corregidos por RRHH.
  $('#btn-guardar-datos').addEventListener('click', async () => {
    if (!ticketActual) return;
    const el = $('#datos-msg');
    const aviso = (t, cls) => { el.textContent = t; el.className = 'text-xs mt-2 ' + cls; el.classList.remove('hidden'); };
    aviso('Guardando…', 'text-telecab-muted');
    const r = await guardarDatos($('#btn-guardar-datos'));
    if (r && r.status === 'ok') { aviso('Cambios guardados.', 'text-telecab-green'); pintarDatos(ticketActual); }
    else aviso((r && r.msg) || 'No se pudo guardar', 'text-telecab-red');
  });

  // Guardar + regenerar la FICHA DE ALTA en PDF con los datos corregidos.
  $('#btn-regenerar-pdf').addEventListener('click', async () => {
    if (!ticketActual) return;
    const el = $('#pdf-msg');
    const aviso = (t, cls) => { el.textContent = t; el.className = 'text-xs ' + cls; el.classList.remove('hidden'); };
    aviso('Guardando y regenerando…', 'text-telecab-muted');
    // El botón va apagado en las dos peticiones; entre una y otra no hay espera
    // en la que quepa un clic.
    const b = $('#btn-regenerar-pdf');
    const g = await guardarDatos(b);
    if (!g || g.status !== 'ok') { aviso((g && g.msg) || 'No se pudo guardar antes de regenerar', 'text-telecab-red'); return; }
    const r = await api('/seleccion/ficha', { tel: ticketActual.id }, b);
    if (r.status === 'ok') {
      if (r.ficha && r.ficha.link) ticketActual.ficha_pdf_link = r.ficha.link;
      else if (r.link) ticketActual.ficha_pdf_link = r.link;
      pintarDocs(ticketActual);   // refresca el enlace al PDF nuevo
      aviso(`FICHA regenerada${r.adjuntos != null ? ' (' + r.adjuntos + ' doc.)' : ''}.`, 'text-telecab-green');
      if (r.link) window.open(r.link, '_blank');
    } else aviso(r.msg || 'No se pudo regenerar el PDF', 'text-telecab-red');
  });

  $('#btn-alta').addEventListener('click', async () => {
    if (!ticketActual) return;
    const fecha_alta = $('[data-campo="fecha_alta"]').value.trim();
    const fecha_habilitado = $('[data-campo="fecha_habilitado"]').value.trim();
    if (!fecha_alta || !fecha_habilitado) { msg('Rellena las dos fechas.', false); return; }
    if (!$('#chk-verificado').checked) { msg('Marca la casilla de verificación antes de dar el alta.', false); return; }
    const btn = $('#btn-alta'); btn.disabled = true;
    const r = await api('/rrhh/alta', { tel: ticketActual.id, fecha_alta, fecha_habilitado });
    if (r.status === 'ok') { msg('Alta procesada. Ya está de alta.', true); setTimeout(() => { $('#ficha').classList.add('hidden'); ticketActual = null; cargar(); }, 900); }
    else { btn.disabled = false; msg(r.msg || 'No se pudo procesar el alta', false); }
  });

  $('#btn-no').addEventListener('click', async () => {
    if (!ticketActual) return;
    const motivo = prompt('Motivo para no continuar con el alta:');
    if (motivo === null) return;
    const r = await api('/rrhh/no-continuar', { tel: ticketActual.id, motivo });
    if (r.status === 'ok') { $('#ficha').classList.add('hidden'); ticketActual = null; cargar(); }
    else msg(r.msg || 'Error', false);
  });

  $('#btn-devolver').addEventListener('click', async () => {
    if (!ticketActual) return;
    const motivo = prompt('Motivo por el que se devuelve a Selección:');
    if (motivo === null) return;
    if (!motivo.trim()) { msg('Escribe el motivo de la devolución.', false); return; }
    const r = await api('/rrhh/devolver', { tel: ticketActual.id, motivo });
    if (r.status === 'ok') { msg('Ficha devuelta a Selección (Rechazado RRHH).', true); setTimeout(() => { $('#ficha').classList.add('hidden'); ticketActual = null; cargar(); }, 900); }
    else msg(r.msg || 'No se pudo devolver', false);
  });

  function fila(t) {
    const el = document.createElement('div');
    el.className = 'flex items-center gap-2 px-3 py-2.5 rounded-xl bg-telecab-dark/40 border border-transparent hover:border-telecab-border transition';
    const nom = `${t.nombre || '(sin nombre)'}${t.apellidos ? ' ' + t.apellidos : ''}`;
    const enExcel = (t.excel_alta || '').toString().trim();
    el.innerHTML =
      `<input type="checkbox" class="chk-alta accent-telecab-gold shrink-0 w-4 h-4" data-tel="${t.id}" aria-label="Marcar ${esc(nom)}">
       <button type="button" class="min-w-0 flex-1 text-left flex items-center gap-3">
         <span class="w-8 h-8 rounded-lg bg-telecab-green/15 text-telecab-green flex items-center justify-center shrink-0"><i class="fa-solid fa-user-check"></i></span>
         <span class="min-w-0 flex-1">
           <span class="block text-sm text-telecab-text truncate">${esc(nom)}</span>
           <span class="block text-xs text-telecab-muted font-mono">${t.id}${t.zona ? ' · ' + esc(t.zona) : ''}</span>
         </span>
       </button>
       ${enExcel ? `<span class="text-[11px] text-telecab-green whitespace-nowrap" title="Ya en un Excel"><i class="fa-solid fa-file-excel"></i></span>` : ''}
       ${t.fecha_deteccion ? `<span class="text-[11px] text-telecab-muted whitespace-nowrap">${esc(t.fecha_deteccion)}</span>` : ''}`;
    el.querySelector('button').addEventListener('click', () => abrirFicha(t));
    return el;
  }

  function pintarLista(sel, arr) {
    const cont = document.querySelector(`.seccion-altas[data-tipo="${sel}"] .lista`);
    cont.innerHTML = '';
    if (!arr.length) { cont.innerHTML = '<p class="text-telecab-muted text-sm">Nadie pendiente aquí.</p>'; return; }
    arr.sort((a, b) => (a.fecha_deteccion || '').localeCompare(b.fecha_deteccion || ''));
    arr.forEach(t => cont.appendChild(fila(t)));
  }

  async function cargar() {
    const r = await (await fetch('/rrhh/api/datos')).json();
    if (r.status !== 'ok') return;
    $('#c-tram').textContent = r.contadores.porTramitar;
    $('#c-altas').textContent = r.contadores.altas;
    $('#c-noalta').textContent = r.contadores.noAlta;
    $('#c-tram-split').textContent = `ETT ${r.contadores.ett} · Nuestros ${r.contadores.general}`;

    const ett = r.porTramitar.filter(t => t.ett);
    const general = r.porTramitar.filter(t => !t.ett);
    pintarLista('ett', ett);
    pintarLista('general', general);
    document.querySelector('.seccion-altas[data-tipo="ett"] .cnt').textContent = `(${ett.length})`;
    document.querySelector('.seccion-altas[data-tipo="general"] .cnt').textContent = `(${general.length})`;

    // Reabre la ficha abierta con los datos frescos (p. ej. tras generar el Excel,
    // así se actualiza el candado y se puede dar el alta sin recargar a mano).
    if (ticketActual) {
      const t2 = r.porTramitar.find(x => String(x.id) === String(ticketActual.id));
      if (t2) abrirFicha(t2, true);
    }

    // Abre directamente la ficha que llega por ?tel= (una sola vez, desde Pendientes).
    if (!autoAbierto) {
      const tel = new URLSearchParams(location.search).get('tel');
      const t = tel && r.porTramitar.find(x => String(x.id) === tel);
      if (t) { autoAbierto = true; abrirFicha(t); }
    }
  }

  // ---- Excel de Altas: cada sección (ETT / general) genera su propio Excel ----
  document.querySelectorAll('.seccion-altas').forEach(sec => {
    const tipo = sec.dataset.tipo;
    const chkTodos = sec.querySelector('.chk-todos');
    const btnExcel = sec.querySelector('.btn-excel');
    const inpFecha = sec.querySelector('.fecha-altas');
    const el = sec.querySelector('.excel-msg');
    const aviso = (txt, cls) => { el.textContent = txt; el.className = 'excel-msg text-xs w-full ' + cls; el.classList.remove('hidden'); };

    chkTodos.addEventListener('change', e => {
      sec.querySelectorAll('.chk-alta').forEach(c => { c.checked = e.target.checked; });
    });

    btnExcel.addEventListener('click', async () => {
      const tels = [...sec.querySelectorAll('.chk-alta:checked')].map(c => c.dataset.tel);
      const fecha = inpFecha.value.trim();
      if (!tels.length) return aviso('Marca al menos una ficha.', 'text-telecab-red');
      if (!fecha) return aviso('Elige la fecha del grupo de altas.', 'text-telecab-red');
      aviso('Generando el Excel…', 'text-telecab-muted');
      // Es una descarga, no JSON: no pasa por Api. Sin el velo (03/11/2026), el
      // botón apagado es lo que impide generar el mismo Excel dos veces.
      btnExcel.disabled = true;
      try {
        const r = await fetch('/rrhh/altas-excel', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tels, fecha, tipo })
        });
        if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.msg || 'Error al generar'); }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'Altas' + (tipo === 'ett' ? ' ETT' : '') + ' ' + fecha.replace(/\//g, '-') + '.xlsx';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        aviso('Excel generado (' + tels.length + ' fichas). Revisa tu carpeta de descargas.', 'text-telecab-green');
        chkTodos.checked = false;
        cargar();   // refresca la lista y la ficha: ya salen marcadas como "en Excel"
      } catch (e) { aviso('No se pudo generar: ' + e.message, 'text-telecab-red'); }
      finally { btnExcel.disabled = false; }
    });
  });

  cargar();
