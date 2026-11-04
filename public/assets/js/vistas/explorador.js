// views/explorador.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = Casa.esc;
  const api = async (u, o) => (await fetch(u, o)).json();

  let TABLAS = [], actual = null, panel = 'datos';
  let est = { pagina: 0, orden: null, desc: false, busca: '', filtroCol: '', filtroVal: '' };

  // ── Lista de tablas ──
  function pintarTablas() {
    const f = $('#filtro-tabla').value.trim().toLowerCase();
    const v = TABLAS.filter(t => !f || t.nombre.includes(f));
    $('#lista-tablas').innerHTML = '';
    let grupo = null;
    v.forEach(t => {
      if (t.esVista && grupo !== 'v') {
        grupo = 'v';
        $('#lista-tablas').insertAdjacentHTML('beforeend',
          '<div class="px-2 pt-3 pb-1 text-[10px] uppercase tracking-wider text-telecab-muted">Vistas</div>');
      }
      const d = document.createElement('div');
      d.className = 't-item' + (actual === t.nombre ? ' on' : '');
      d.innerHTML = `<i class="fa-solid ${t.esVista ? 'fa-eye' : 'fa-table'} text-[10px] opacity-60"></i>
                     <span class="truncate">${esc(t.nombre)}</span>
                     <i class="n">${t.esVista ? '' : Number(t.filas_aprox).toLocaleString('es-ES')}</i>`;
      d.title = (t.comentario || '') + (t.tamano ? ' · ' + t.tamano : '');
      d.onclick = () => abrir(t.nombre);
      $('#lista-tablas').appendChild(d);
    });
  }

  async function cargarTablas() {
    const r = await api('/explorador/api/tablas');
    if (r.status !== 'ok') return;
    TABLAS = r.tablas;
    $('#resumen').textContent =
      `${r.resumen.bd} · ${r.resumen.version} · ${r.resumen.tablas} tablas y ${r.resumen.vistas} vistas · ${r.resumen.tamano}`;
    pintarTablas();
  }

  // ── Abrir una tabla ──
  function abrir(nombre, filtro) {
    actual = nombre;
    est = { pagina: 0, orden: null, desc: false, busca: '', filtroCol: '', filtroVal: '', ...(filtro || {}) };
    $('#busca').value = '';
    $('#sin-tabla').classList.add('hidden');
    $('#panel').classList.remove('hidden');
    $('#panel').classList.add('flex');
    pintarTablas();
    ver(panel);
  }

  function ver(p) {
    panel = p;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.p === p));
    p === 'datos' ? verDatos() : verEstructura();
  }

  // ── Datos ──
  async function verDatos() {
    $('#cuerpo').innerHTML = '<div class="p-6 text-sm text-telecab-muted">Cargando…</div>';
    const q = new URLSearchParams({
      tabla: actual, pagina: est.pagina, orden: est.orden || '', desc: est.desc ? '1' : '',
      busca: est.busca, filtroCol: est.filtroCol, filtroVal: est.filtroVal,
    });
    const r = await api('/explorador/api/datos?' + q);
    if (r.status !== 'ok') {
      $('#cuerpo').innerHTML = `<div class="p-6 text-sm text-telecab-red">${esc(r.msg)}</div>`;
      return;
    }
    $('#titulo').textContent = r.tabla;
    $('#cuenta').textContent = `${r.total.toLocaleString('es-ES')} fila(s)` +
      (est.filtroCol ? ` · filtrado por ${est.filtroCol}=${est.filtroVal}` : '');
    const fk = Object.fromEntries(r.foraneas.map(f => [f.columna, f]));
    const esNum = c => /int|numeric|double|real|serial/i.test(c.tipo);

    const cab = r.columnas.map(c => {
      const flecha = est.orden === c.nombre ? (est.desc ? ' ↓' : ' ↑') : '';
      return `<th data-col="${esc(c.nombre)}" title="${esc(c.tipo)}${c.comentario ? ' — ' + esc(c.comentario) : ''}">
                ${esc(c.nombre)}${flecha}${fk[c.nombre] ? ' <span class="fk">↗</span>' : ''}</th>`;
    }).join('');

    const cuerpo = r.filas.map(f => '<tr>' + r.columnas.map(c => {
      const v = f[c.nombre];
      if (v === null || v === undefined) return '<td><span class="nulo">null</span></td>';
      if (typeof v === 'boolean') return `<td>${v ? '✓' : '·'}</td>`;
      const txt = v instanceof Object && !(v instanceof Date) ? JSON.stringify(v) : String(v);
      const corto = txt.length > 120 ? txt.slice(0, 120) + '…' : txt;
      if (fk[c.nombre]) {
        return `<td><span class="fk" data-fk="${esc(fk[c.nombre].destino)}" data-fkc="${esc(fk[c.nombre].destino_col)}" data-fkv="${esc(txt)}">${esc(corto)}</span></td>`;
      }
      return `<td class="${esNum(c) ? 'num' : ''}" title="${esc(txt)}">${esc(corto)}</td>`;
    }).join('') + '</tr>').join('');

    $('#cuerpo').innerHTML = r.filas.length
      ? `<table class="tbl"><thead><tr>${cab}</tr></thead><tbody>${cuerpo}</tbody></table>`
      : '<div class="p-6 text-sm text-telecab-muted">Sin filas.</div>';

    // Ordenar al pinchar la cabecera
    $('#cuerpo').querySelectorAll('th').forEach(th => th.onclick = () => {
      const c = th.dataset.col;
      est.desc = est.orden === c ? !est.desc : false;
      est.orden = c; est.pagina = 0; verDatos();
    });
    // Navegar por la foránea
    $('#cuerpo').querySelectorAll('[data-fk]').forEach(s => s.onclick = () =>
      abrir(s.dataset.fk, { filtroCol: s.dataset.fkc, filtroVal: s.dataset.fkv }));

    $('#pie').classList.remove('hidden');
    $('#pie').classList.add('flex');
    $('#pag').textContent = `${r.pagina + 1} de ${Math.max(1, r.paginas)}`;
    $('#ant').disabled = r.pagina <= 0;
    $('#sig').disabled = r.pagina + 1 >= r.paginas;
    $('#tiempo').textContent = r.ms + ' ms';
  }

  // ── Estructura ──
  async function verEstructura() {
    $('#pie').classList.add('hidden');
    const r = await api('/explorador/api/estructura?tabla=' + encodeURIComponent(actual));
    if (r.status !== 'ok') return;
    $('#titulo').textContent = r.tabla;
    $('#cuenta').textContent = `${r.columnas.length} columnas`;
    const cols = r.columnas.map(c => `<tr>
      <td><code>${esc(c.nombre)}</code></td>
      <td class="text-telecab-muted">${esc(c.tipo)}</td>
      <td>${c.obligatorio ? '<span class="text-telecab-red text-[11px]">obligatorio</span>' : '<span class="nulo">admite null</span>'}</td>
      <td class="text-telecab-muted text-[11px]">${c.generada ? 'generada · ' : ''}${esc(c.predeterminado || '')}</td>
      <td class="text-telecab-muted" style="white-space:normal">${esc(c.comentario || '')}</td>
    </tr>`).join('');
    const bloque = (t, filas) => filas.length
      ? `<div class="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider text-telecab-muted">${t}</div>
         <div class="px-3 space-y-1">${filas.map(x => `<div class="text-[11.5px] text-telecab-muted"><code>${esc(x)}</code></div>`).join('')}</div>` : '';
    $('#cuerpo').innerHTML = `
      <table class="tbl"><thead><tr><th>Columna</th><th>Tipo</th><th></th><th>Por defecto</th><th>Nota</th></tr></thead>
      <tbody>${cols}</tbody></table>
      ${bloque('Restricciones', r.restricciones.map(x => x.nombre + ' — ' + x.definicion))}
      ${bloque('Índices', r.indices.map(x => x.definicion))}
      <div class="h-4"></div>`;
  }

  // ── Escritura ──
  //
  // En dos tiempos, y a propósito. Primero se PRUEBA: el servidor ejecuta la
  // sentencia, cuenta a cuántas filas afecta y la deshace. Ese número es toda la
  // protección que hace falta — un `DELETE` sin `WHERE` dice 463 y ahí te paras.
  // Solo entonces aparece el botón de guardar, con el número escrito dentro.

  let sqlProbado = null;   // la sentencia exacta que se probó, para no guardar otra

  function olvidarPrueba() {
    sqlProbado = null;
    $('#sql-guardar').classList.add('hidden');
  }

  async function escribir(confirmar, boton) {
    const sql = $('#sql').value.trim();
    if (!sql) return;
    // Guardar solo lo que se probó: si se toca el texto después de la prueba, el
    // número que se vio ya no vale.
    if (confirmar && sql !== sqlProbado) {
      olvidarPrueba();
      return Dialogo.aviso({
        titulo: 'La sentencia ha cambiado',
        texto: 'Pruébala otra vez: el número de filas que viste era de la anterior.',
        tono: 'aviso',
      });
    }

    $('#sql-info').textContent = confirmar ? 'Guardando…' : 'Probando…';
    // Por Api con el botón apagado (03/11/2026): sin el velo, un doble clic en
    // «Guardar de verdad» ejecutaba la sentencia dos veces (un INSERT, dos filas).
    let r;
    try {
      r = await Api.post('/explorador/api/escribir', { sql, confirmar: confirmar === true }, { boton });
    } catch (e) { r = e.respuesta || { status: 'error', msg: e.message }; }

    if (r.status !== 'ok') {
      olvidarPrueba();
      $('#sql-info').textContent = '';
      $('#sql-res').innerHTML = `<div class="p-4 text-sm text-telecab-red font-mono">${esc(r.msg)}</div>`;
      return;
    }

    if (!confirmar) {
      sqlProbado = sql;
      const b = $('#sql-guardar');
      b.classList.remove('hidden');
      b.textContent = r.filas === null ? 'Guardar de verdad' : `Guardar de verdad (${r.filas} filas)`;
      $('#sql-info').textContent = r.aviso + ` · ${r.ms} ms`;
      $('#sql-res').innerHTML =
        `<div class="p-4 text-sm text-telecab-warn">${esc(r.aviso)}</div>`;
      return;
    }

    olvidarPrueba();
    $('#sql-info').textContent = `Guardado · ${r.filas === null ? 'sin filas' : r.filas + ' fila(s)'} · ${r.ms} ms`;
    $('#sql-res').innerHTML =
      `<div class="p-4 text-sm text-telecab-green">Hecho. ${
        r.filas === null ? '' : r.filas + ' fila(s) afectada(s).'}</div>`;
    Dialogo.hecho('Cambio guardado en la base');
    cargarTablas();
  }

  // ── Consulta libre ──
  async function lanzar() {
    const sql = $('#sql').value.trim();
    if (!sql) return;
    $('#sql-info').textContent = 'Ejecutando…';
    const r = await api('/explorador/api/consulta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }),
    });
    if (r.status !== 'ok') {
      $('#sql-info').textContent = '';
      $('#sql-res').innerHTML = `<div class="p-4 text-sm text-telecab-red font-mono">${esc(r.msg)}</div>`;
      return;
    }
    $('#sql-info').textContent = `${r.total.toLocaleString('es-ES')} fila(s) · ${r.ms} ms` +
      (r.recortado ? ' · se muestran las primeras' : '');
    $('#sql-res').innerHTML = r.filas.length
      ? `<table class="tbl"><thead><tr>${r.columnas.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
         <tbody>${r.filas.map(f => '<tr>' + r.columnas.map(c => {
           const v = f[c];
           if (v === null || v === undefined) return '<td><span class="nulo">null</span></td>';
           const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
           return `<td title="${esc(t)}">${esc(t.length > 120 ? t.slice(0, 120) + '…' : t)}</td>`;
         }).join('') + '</tr>').join('')}</tbody></table>`
      : '<div class="p-4 text-sm text-telecab-muted">Sin resultados.</div>';
  }

  // ── Eventos ──
  $('#filtro-tabla').oninput = pintarTablas;
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => ver(b.dataset.p));
  $('#ant').onclick = () => { est.pagina--; verDatos(); };
  $('#sig').onclick = () => { est.pagina++; verDatos(); };
  let temp;
  $('#busca').oninput = e => { clearTimeout(temp); temp = setTimeout(() => {
    est.busca = e.target.value; est.pagina = 0; verDatos(); }, 350); };
  $('#btn-sql').onclick = () => { $('#modal-sql').classList.remove('hidden'); $('#sql').focus(); };
  $('#sql-cerrar').onclick = () => $('#modal-sql').classList.add('hidden');
  $('#sql-ir').onclick = lanzar;
  $('#sql-escribir').onclick = () => escribir(false, $('#sql-escribir'));
  $('#sql-guardar').onclick = () => escribir(true, $('#sql-guardar'));
  // Tocar el texto invalida la prueba: el número de filas que se vio era de otra
  // sentencia, y guardar con ese número delante sería mentir.
  $('#sql').oninput = olvidarPrueba;
  $('#sql').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) lanzar(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#modal-sql').classList.add('hidden'); });

  ver('datos');
  cargarTablas();
})();
