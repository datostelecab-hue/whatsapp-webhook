// modules/Chat/vistas/chat.ejs — el chat interno (ítem 2, entrega 2a, db/256).
//
// A la izquierda, los canales y los directos con sus no leídos; a la derecha, la
// conversación; los hilos, al lado (Panel). Llega todo al momento por el tiempo
// real (canal «chat»); sin él, se pregunta cada 15 segundos.
//
// LAS MENCIONES: al escribir «@» salen las personas (y @canal). En el texto que
// se manda van como <@id> y <!canal>; aquí se pintan con el nombre.
(function () {
  'use strict';
  const esc = Casa.esc;
  const API = '/chat/api';
  const raiz = document.getElementById('chat');
  const lista = document.getElementById('chat-lista');
  const conv = document.getElementById('chat-conversacion');
  const filtro = document.getElementById('chat-filtro');

  // El chat ocupa el alto de la pantalla menos la barra de arriba, que en el
  // móvil puede ser de dos líneas (los cuadros de tickets): se mide.
  const cabecera = document.querySelector('header.sticky');
  const medir = () => { if (cabecera) document.documentElement.style.setProperty('--tc-cabecera', cabecera.offsetHeight + 'px'); };
  medir();
  addEventListener('resize', medir);

  let yo = { id: 0, puedeCrear: false };
  let canales = [];
  const personas = new Map();
  let actual = null;          // la ficha del canal abierto
  let mensajes = [];          // los de arriba del canal abierto, del más viejo al más nuevo
  let hayMas = false;
  let nuevosDesde = null;     // el primer mensaje sin leer al abrirlo (la raya «Nuevos»)
  let hilo = null;            // { raiz, respuestas, panel }

  const iniciales = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x.charAt(0)).join('').toUpperCase() || '·';
  const hora = iso => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  const diaDe = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  function etiquetaDia(d) {
    const hoy = diaDe(new Date());
    const ayer = diaDe(new Date(Date.now() - 86400000));
    if (d === hoy) return 'Hoy';
    if (d === ayer) return 'Ayer';
    const f = new Date(d + 'T12:00:00');
    return f.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function haceCuanto(iso) {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    return h < 24 ? `hace ${h} h` : `el ${new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}`;
  }

  // ── El texto: menciones y enlaces, siempre a partir del texto escapado ───
  function pintarTexto(t) {
    let h = esc(t || '');
    h = h.replace(/&lt;@(\d{1,9})&gt;/g, (m, id) => {
      const p = personas.get(Number(id));
      return `<span class="tc-chat-mencion${Number(id) === yo.id ? ' tc-chat-mencion--yo' : ''}">@${esc(p ? p.nombre : 'alguien')}</span>`;
    });
    h = h.replace(/&lt;!canal&gt;/g, '<span class="tc-chat-mencion tc-chat-mencion--todos">@canal</span>');
    h = h.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
    return h;
  }
  const meMenciona = m => !!(m.menciones && (m.menciones.todos || (m.menciones.usuarios || []).includes(yo.id)));

  // ── La lista de la izquierda ──────────────────────────────────────────────
  const orden = (a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { numeric: true });
  function pintarLista() {
    const q = filtro.value.trim().toLowerCase();
    const pasa = c => !q || String(c.titulo || '').toLowerCase().includes(q);
    const deCanal = canales.filter(c => c.tipo !== 'directo').filter(pasa).sort(orden);
    const directos = canales.filter(c => c.tipo === 'directo').filter(pasa)
      .sort((a, b) => String(b.ultimoAt || '').localeCompare(String(a.ultimoAt || '')));
    const item = c => {
      const marca = c.tipo === 'directo' ? c.sinLeer : c.menciones;
      const icono = c.tipo === 'privado' ? 'fa-lock' : 'fa-hashtag';
      return `<button type="button" class="tc-chat-item${actual && actual.id === c.id ? ' tc-chat-item--activo' : ''}${c.sinLeer ? ' tc-chat-item--sin-leer' : ''}"
          data-canal="${c.id}" ${actual && actual.id === c.id ? 'aria-current="true"' : ''}>
          ${c.tipo === 'directo'
            ? `<span class="tc-avatar tc-avatar--chico" aria-hidden="true">${esc(iniciales(c.titulo))}</span>`
            : `<i class="fa-solid ${icono} tc-chat-item-icono" aria-hidden="true"></i>`}
          <span class="tc-chat-item-nombre">${esc(c.titulo)}</span>
          ${marca ? `<span class="tc-contador">${marca > 99 ? '99+' : marca}</span>` : ''}
        </button>`;
    };
    lista.innerHTML = `
      <section class="tc-chat-seccion"><h3>Canales</h3>${deCanal.map(item).join('') || '<p class="tc-chat-nada">Ninguno</p>'}</section>
      <section class="tc-chat-seccion"><h3>Mensajes directos</h3>${directos.map(item).join('') || '<p class="tc-chat-nada">Aún no has escrito a nadie</p>'}</section>`;
  }
  async function cargarLista() {
    const r = await Api.get(`${API}/canales`).catch(() => null);
    if (!r) return;
    yo = r.yo;
    canales = r.canales;
    document.getElementById('chat-canal').classList.toggle('hidden', !yo.puedeCrear);
    pintarLista();
  }
  let tLista = null;
  const cargarListaPronto = () => { clearTimeout(tLista); tLista = setTimeout(cargarLista, 250); };

  lista.addEventListener('click', ev => {
    const b = ev.target.closest('[data-canal]');
    if (b) abrir(Number(b.dataset.canal));
  });
  filtro.addEventListener('input', pintarLista);

  // ── Un mensaje ────────────────────────────────────────────────────────────
  function mensajeHtml(m, { seguido = false, enHilo = false } = {}) {
    const cuerpoTexto = m.anulado ? '<span class="tc-chat-anulado">Mensaje anulado</span>' : pintarTexto(m.texto);
    return `<article class="tc-chat-msj${seguido ? ' tc-chat-msj--seguido' : ''}${meMenciona(m) ? ' tc-chat-msj--mencion' : ''}" data-msj="${m.id}">
        <div class="tc-chat-msj-lado">${seguido
          ? `<time class="tc-chat-msj-hora" datetime="${esc(m.creadoAt)}">${esc(hora(m.creadoAt))}</time>`
          : `<span class="tc-avatar tc-avatar--chico" aria-hidden="true">${esc(iniciales(m.autor))}</span>`}</div>
        <div class="tc-chat-msj-cuerpo">
          ${seguido ? '' : `<header><b>${esc(m.autor)}</b><time datetime="${esc(m.creadoAt)}">${esc(hora(m.creadoAt))}</time></header>`}
          <div class="tc-chat-texto">${cuerpoTexto}${m.editado ? ' <span class="tc-chat-editado">(editado)</span>' : ''}</div>
          ${!enHilo && m.respuestas ? `<button type="button" class="tc-chat-respuestas" data-hilo="${m.id}">
              <i class="fa-regular fa-comments" aria-hidden="true"></i>${m.respuestas} ${m.respuestas === 1 ? 'respuesta' : 'respuestas'}
              <span>· ${esc(haceCuanto(m.ultimaRespuestaAt))}</span></button>` : ''}
        </div>
        ${enHilo || m.anulado ? '' : `<div class="tc-chat-msj-acciones">
          <button type="button" class="tc-boton tc-boton--chico" data-hilo="${m.id}" title="Responder en un hilo" aria-label="Responder en un hilo">
            <i class="fa-solid fa-reply" aria-hidden="true"></i></button></div>`}
      </article>`;
  }
  // Una serie: con su día, la raya de «Nuevos» y los seguidos del mismo autor juntos.
  function serieHtml(lista_, { enHilo = false, marcaNuevos = null } = {}) {
    let html = '', prev = null, dia = '';
    lista_.forEach(m => {
      const d = diaDe(m.creadoAt);
      if (d !== dia) { html += `<div class="tc-chat-dia"><span>${esc(etiquetaDia(d))}</span></div>`; dia = d; prev = null; }
      if (marcaNuevos && m.id === marcaNuevos) { html += '<div class="tc-chat-nuevos" role="separator"><span>Nuevos</span></div>'; prev = null; }
      const seguido = !!(prev && prev.autorId === m.autorId && !prev.respuestas
        && new Date(m.creadoAt) - new Date(prev.creadoAt) < 5 * 60000);
      html += mensajeHtml(m, { seguido, enHilo });
      prev = m;
    });
    return html;
  }

  // ── La conversación ───────────────────────────────────────────────────────
  function pintarCabeza() {
    const c = actual;
    const icono = c.tipo === 'directo' ? 'fa-user' : c.tipo === 'privado' ? 'fa-lock' : 'fa-hashtag';
    return `<header class="tc-chat-cabeza">
        <button type="button" class="tc-boton tc-boton--chico tc-chat-volver" data-volver aria-label="Volver a la lista"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>
        <div class="min-w-0 flex-1">
          <h2><i class="fa-solid ${icono}" aria-hidden="true"></i>${esc(c.titulo)}</h2>
          ${c.tema || c.descripcion ? `<p>${esc(c.tema || c.descripcion)}</p>` : ''}
        </div>
        <button type="button" class="tc-boton tc-boton--chico" data-miembros title="Quién está dentro">
          <i class="fa-solid fa-user-group" aria-hidden="true"></i>${c.miembros.length}</button>
        ${c.puede.anadir ? `<button type="button" class="tc-boton tc-boton--chico" data-anadir title="Añadir a alguien"><i class="fa-solid fa-user-plus" aria-hidden="true"></i>Añadir</button>` : ''}
      </header>`;
  }
  function escribirHtml(donde, marcador) {
    return `<form class="tc-chat-escribir" data-escribir="${donde}">
        <div class="tc-chat-caja">
          <textarea rows="1" maxlength="8000" placeholder="${esc(marcador)}" aria-label="${esc(marcador)}"></textarea>
          <button type="submit" class="tc-boton tc-boton--principal tc-boton--chico" aria-label="Enviar"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i></button>
        </div>
        <p class="tc-chat-pista">Intro envía · Mayús + Intro, otra línea · @ para mencionar</p>
      </form>`;
  }

  async function abrir(id, { mantener = false } = {}) {
    const [f, m] = await Promise.all([
      Api.get(`${API}/canales/${id}`, { aviso: 'No se ha podido abrir' }),
      Api.get(`${API}/canales/${id}/mensajes`).catch(() => null),
    ]);
    if (!f || !m) return;
    actual = f.canal;
    mensajes = m.mensajes;
    hayMas = m.hayMas;
    const primeroNuevo = mensajes.find(x => x.id > m.ultimoLeido && x.autorId !== yo.id);
    nuevosDesde = primeroNuevo ? primeroNuevo.id : null;
    raiz.dataset.vista = 'conversacion';
    conv.innerHTML = pintarCabeza() + `
      <div class="tc-chat-mensajes" data-mensajes tabindex="0" aria-label="Mensajes">
        ${hayMas ? '<button type="button" class="tc-boton tc-boton--chico tc-chat-mas" data-mas>Ver los anteriores</button>' : ''}
        <div data-serie>${serieHtml(mensajes, { marcaNuevos: nuevosDesde })}</div>
        ${mensajes.length ? '' : `<div class="tc-chat-vacio"><i class="fa-regular fa-comment" aria-hidden="true"></i><p>Aún no hay mensajes. Escribe el primero.</p></div>`}
      </div>
      ${actual.puede.escribir ? escribirHtml('canal', actual.tipo === 'directo' ? `Escribe a ${actual.titulo}` : `Escribe en #${actual.nombre}`)
        : '<p class="tc-chat-pista p-4">Este canal está archivado: ya no se escribe en él.</p>'}`;
    const caja = conv.querySelector('[data-mensajes]');
    const nuevo = caja.querySelector('.tc-chat-nuevos');
    if (nuevo && !mantener) nuevo.scrollIntoView({ block: 'center' }); else caja.scrollTop = caja.scrollHeight;
    prepararEscribir(conv.querySelector('[data-escribir="canal"]'), { padreId: null });
    const sitio = canales.find(c => c.id === id);
    if (sitio) { sitio.sinLeer = 0; sitio.menciones = 0; }
    pintarLista();
    marcarLeido();
    const u = new URL(location.href); u.searchParams.set('canal', id); history.replaceState(history.state, '', u);
    if (!mantener) { const ta = conv.querySelector('textarea'); if (ta && matchMedia('(min-width: 1024px)').matches) ta.focus(); }
  }

  function repintarSerie({ alFinal = false } = {}) {
    const caja = conv.querySelector('[data-mensajes]');
    if (!caja) return;
    const abajo = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 80;
    caja.querySelector('[data-serie]').innerHTML = serieHtml(mensajes, { marcaNuevos: nuevosDesde });
    const vacio = caja.querySelector('.tc-chat-vacio');
    if (vacio && mensajes.length) vacio.remove();
    if (alFinal || abajo) caja.scrollTop = caja.scrollHeight;
  }

  async function cargarNuevos() {
    if (!actual) return;
    const ultimo = mensajes.length ? mensajes[mensajes.length - 1].id : 0;
    const r = await Api.get(`${API}/canales/${actual.id}/mensajes?despues=${ultimo}`).catch(() => null);
    if (!r || !r.mensajes.length) return;
    const ids = new Set(mensajes.map(x => x.id));
    mensajes.push(...r.mensajes.filter(x => !ids.has(x.id)));
    repintarSerie();
    marcarLeido();
  }

  async function verAnteriores() {
    if (!actual || !mensajes.length) return;
    const caja = conv.querySelector('[data-mensajes]');
    const alto = caja.scrollHeight;
    const r = await Api.get(`${API}/canales/${actual.id}/mensajes?antes=${mensajes[0].id}`).catch(() => null);
    if (!r) return;
    mensajes = [...r.mensajes, ...mensajes];
    hayMas = r.hayMas;
    const boton = caja.querySelector('[data-mas]');
    if (!hayMas && boton) boton.remove();
    repintarSerie();
    caja.scrollTop = caja.scrollHeight - alto;
  }

  // Leído: con la conversación a la vista y la pestaña delante.
  let tLeido = null;
  function marcarLeido({ hasta = null } = {}) {
    clearTimeout(tLeido);
    tLeido = setTimeout(() => {
      if (!actual || document.hidden) return;
      const max = hasta || Math.max(0, ...mensajes.map(x => x.id));
      if (!max) return;
      Api.post(`${API}/canales/${actual.id}/leido`, { hasta: max }).catch(() => {});
    }, 600);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) marcarLeido(); });

  conv.addEventListener('click', async ev => {
    if (ev.target.closest('[data-volver]')) { raiz.dataset.vista = 'lista'; return; }
    if (ev.target.closest('[data-mas]')) { verAnteriores(); return; }
    const h = ev.target.closest('[data-hilo]');
    if (h) { abrirHilo(Number(h.dataset.hilo)); return; }
    if (ev.target.closest('[data-miembros]')) { verMiembros(); return; }
    if (ev.target.closest('[data-anadir]')) { anadir(); }
  });

  // ── Escribir, con las menciones ──────────────────────────────────────────
  function candidatos() {
    const gente = actual && actual.tipo !== 'publico'
      ? actual.miembros
      : [...personas.values()];
    return [...gente.filter(p => p.id !== yo.id).map(p => ({ id: p.id, nombre: p.nombre, puesto: p.puesto || '' })),
      { id: 'canal', nombre: 'canal', puesto: 'Avisa a todos los del canal' }];
  }
  function codificar(t, mapa) {
    let s = t;
    [...mapa.entries()].sort((a, b) => b[0].length - a[0].length).forEach(([texto, id]) => {
      s = s.split(texto).join(`<@${id}>`);
    });
    return s.replace(/(^|[^\w@])@canal\b/g, '$1<!canal>');
  }

  function prepararEscribir(form, { padreId }) {
    if (!form) return;
    const ta = form.querySelector('textarea');
    const mapa = new Map();
    let sug = null, elegido = 0, desde = -1;
    const crecer = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; };
    const cerrarSug = () => { if (sug) sug.remove(); sug = null; desde = -1; };
    function pintarSug(lista_) {
      if (!lista_.length) { cerrarSug(); return; }
      if (!sug) { sug = document.createElement('ul'); sug.className = 'tc-chat-sugerencias'; sug.setAttribute('role', 'listbox'); form.appendChild(sug); }
      elegido = Math.min(elegido, lista_.length - 1);
      sug.innerHTML = lista_.map((p, i) => `<li role="option" aria-selected="${i === elegido}" data-i="${i}">
          ${p.id === 'canal' ? '<i class="fa-solid fa-bullhorn" aria-hidden="true"></i>' : `<span class="tc-avatar tc-avatar--chico" aria-hidden="true">${esc(iniciales(p.nombre))}</span>`}
          <b>@${esc(p.nombre)}</b>${p.puesto ? `<small>${esc(p.puesto)}</small>` : ''}</li>`).join('');
      sug._lista = lista_;
    }
    function buscarSug() {
      const antes = ta.value.slice(0, ta.selectionStart);
      const m = /(^|\s)@([^\s@]{0,30}(?:\s[^\s@]{0,30})?)$/.exec(antes);
      if (!m) { cerrarSug(); return; }
      desde = antes.length - m[2].length - 1;
      const q = m[2].toLowerCase();
      const lista_ = candidatos().filter(p => !q || p.nombre.toLowerCase().split(/\s+/).some(w => w.startsWith(q.split(/\s+/)[0]))
        && p.nombre.toLowerCase().includes(q)).slice(0, 8);
      pintarSug(lista_);
    }
    function elegir(i) {
      const p = sug && sug._lista[i];
      if (!p) return;
      const visto = `@${p.nombre}`;
      if (p.id !== 'canal') mapa.set(visto, p.id);
      const fin = ta.selectionStart;
      ta.value = ta.value.slice(0, desde) + visto + ' ' + ta.value.slice(fin);
      const pos = desde + visto.length + 1;
      ta.setSelectionRange(pos, pos);
      cerrarSug();
      ta.focus();
      crecer();
    }
    ta.addEventListener('input', () => { crecer(); buscarSug(); });
    ta.addEventListener('keydown', ev => {
      if (sug) {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          elegido = (elegido + (ev.key === 'ArrowDown' ? 1 : -1) + sug._lista.length) % sug._lista.length;
          pintarSug(sug._lista);
          return;
        }
        if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); elegir(elegido); return; }
        if (ev.key === 'Escape') { ev.preventDefault(); cerrarSug(); return; }
      }
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener('mousedown', ev => {
      const li = ev.target.closest('.tc-chat-sugerencias li');
      if (li) { ev.preventDefault(); elegir(Number(li.dataset.i)); }
    });
    ta.addEventListener('blur', () => setTimeout(cerrarSug, 150));
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const crudo = ta.value.trim();
      if (!crudo || !actual) return;
      const boton = form.querySelector('button[type="submit"]');
      const r = await Api.post(`${API}/canales/${actual.id}/mensajes`, { texto: codificar(crudo, mapa), padreId },
        { boton, aviso: 'No se ha enviado' });
      if (!r) return;
      ta.value = ''; mapa.clear(); crecer();
      if (padreId) { await recargarHilo(); actualizarRaiz(r.mensaje.padreId); }
      else {
        if (!mensajes.some(x => x.id === r.mensaje.id)) mensajes.push(r.mensaje);
        nuevosDesde = null;
        repintarSerie({ alFinal: true });
      }
    });
  }

  // ── Los hilos, al lado ────────────────────────────────────────────────────
  async function abrirHilo(id) {
    const r = await Api.get(`${API}/mensajes/${id}/hilo`, { aviso: 'No se ha podido abrir el hilo' });
    if (!r) return;
    const panel = Panel.abrir({
      titulo: 'Hilo', subtitulo: actual ? (actual.tipo === 'directo' ? actual.titulo : `#${actual.nombre}`) : '',
      html: '', alCerrar: () => { hilo = null; },
    });
    hilo = { raiz: r.raiz, respuestas: r.respuestas, panel };
    pintarHilo();
  }
  function pintarHilo() {
    if (!hilo) return;
    const { raiz: rz, respuestas: rs, panel } = hilo;
    panel.cuerpo.innerHTML = `
      <div class="tc-chat-hilo">
        ${mensajeHtml(rz, { enHilo: true })}
        <div class="tc-chat-dia"><span>${rs.length ? `${rs.length} ${rs.length === 1 ? 'respuesta' : 'respuestas'}` : 'Sin respuestas todavía'}</span></div>
        <div data-respuestas>${serieHtml(rs, { enHilo: true })}</div>
      </div>
      ${actual && actual.puede.escribir ? escribirHtml('hilo', 'Responde en el hilo') : ''}`;
    prepararEscribir(panel.cuerpo.querySelector('[data-escribir="hilo"]'), { padreId: rz.id });
    const max = Math.max(rz.id, ...rs.map(x => x.id));
    marcarLeido({ hasta: max });
    const ta = panel.cuerpo.querySelector('textarea');
    if (ta) ta.focus();
  }
  async function recargarHilo() {
    if (!hilo) return;
    const r = await Api.get(`${API}/mensajes/${hilo.raiz.id}/hilo`).catch(() => null);
    if (!r || !hilo) return;
    hilo.raiz = r.raiz; hilo.respuestas = r.respuestas;
    pintarHilo();
  }
  async function actualizarRaiz(id) {
    if (!id) return;
    const r = await Api.get(`${API}/mensajes/${id}`).catch(() => null);
    if (!r) return;
    const i = mensajes.findIndex(x => x.id === id);
    if (i >= 0) { mensajes[i] = r.mensaje; repintarSerie(); }
  }

  // ── Canales, directos y miembros ─────────────────────────────────────────
  function verMiembros() {
    if (!actual) return;
    const quitar = actual.puede.quitar;
    Panel.abrir({
      titulo: 'Quién está dentro', subtitulo: actual.tipo === 'directo' ? actual.titulo : `#${actual.nombre}`,
      html: `<ul class="tc-chat-miembros">${actual.miembros.map(p => `<li>
          <span class="tc-avatar tc-avatar--chico" aria-hidden="true">${esc(iniciales(p.nombre))}</span>
          <span class="min-w-0 flex-1"><b>${esc(p.nombre)}</b>${p.puesto ? `<small>${esc(p.puesto)}</small>` : ''}</span>
          ${quitar && p.id !== yo.id ? `<button type="button" class="tc-boton tc-boton--chico tc-boton--peligro" data-quitar="${p.id}">Sacar</button>` : ''}
          ${actual.tipo === 'privado' && p.id === yo.id ? '<button type="button" class="tc-boton tc-boton--chico" data-salir>Salir</button>' : ''}
        </li>`).join('')}</ul>`,
      alCerrar: () => {},
    }).cuerpo.addEventListener('click', async ev => {
      const q = ev.target.closest('[data-quitar]');
      const salir = ev.target.closest('[data-salir]');
      if (!q && !salir) return;
      const quien = q ? Number(q.dataset.quitar) : yo.id;
      const nombre = (actual.miembros.find(p => p.id === quien) || {}).nombre || '';
      const si = await Dialogo.confirmar({ titulo: salir ? `¿Salir de #${actual.nombre}?` : `¿Sacar a ${nombre} de #${actual.nombre}?`,
        texto: salir ? 'Dejarás de ver sus mensajes. Te pueden volver a añadir.' : 'Dejará de ver sus mensajes. Se le puede volver a añadir.',
        si: salir ? 'Salir' : 'Sacarle', no: 'Volver' });
      if (!si) return;
      const r = await Api.post(`${API}/canales/${actual.id}/miembros/quitar`, { usuarioId: quien }, { aviso: 'No se ha podido' });
      if (!r) return;
      if (salir) { location.href = '/chat'; return; }
      await abrir(actual.id, { mantener: true });
      verMiembros();
    });
  }

  async function anadir() {
    const dentro = new Set(actual.miembros.map(p => p.id));
    const fuera = [...personas.values()].filter(p => !dentro.has(p.id));
    if (!fuera.length) { await Dialogo.aviso({ titulo: 'Ya están todos', texto: 'Toda la oficina está dentro de este canal.' }); return; }
    const v = await Dialogo.formulario(`Añadir a #${actual.nombre}`, [
      { id: 'quien', etiqueta: 'Quién', tipo: 'lista', obligatorio: true, multiple: true,
        opciones: fuera.map(p => ({ valor: String(p.id), texto: p.nombre + (p.puesto ? ` · ${p.puesto}` : '') })) },
    ], { textoBoton: 'Añadir', nota: 'Verán todo lo que se ha escrito en el canal.' });
    if (!v) return;
    for (const id of [].concat(v.quien)) {
      const r = await Api.post(`${API}/canales/${actual.id}/miembros`, { usuarioId: Number(id) }, { aviso: 'No se ha podido añadir' });
      if (!r) return;
    }
    Dialogo.hecho('Añadido');
    await abrir(actual.id, { mantener: true });
  }

  document.getElementById('chat-directo').addEventListener('click', async () => {
    const gente = [...personas.values()].filter(p => p.id !== yo.id);
    const v = await Dialogo.formulario('Mensaje directo', [
      { id: 'quien', etiqueta: 'Con quién', tipo: 'lista', obligatorio: true, multiple: true,
        opciones: gente.map(p => ({ valor: String(p.id), texto: p.nombre + (p.puesto ? ` · ${p.puesto}` : '') })),
        ayuda: 'Con una persona, o con varias (hasta 8) para un grupo.' },
    ], { textoBoton: 'Escribir' });
    if (!v) return;
    const r = await Api.post(`${API}/directos`, { usuarios: [].concat(v.quien).map(Number) }, { aviso: 'No se ha podido abrir' });
    if (!r) return;
    await cargarLista();
    abrir(r.canal.id);
  });

  document.getElementById('chat-canal').addEventListener('click', async () => {
    const v = await Dialogo.formulario('Nuevo canal', [
      { id: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, max: 80, minimo: 2, marcador: 'Ej.: 17-compras',
        ayuda: 'En minúsculas y con guiones, como en Slack: se arregla solo.' },
      { id: 'tipo', etiqueta: 'Quién lo ve', tipo: 'lista', obligatorio: true, valor: 'publico',
        opciones: [{ valor: 'publico', texto: 'Público: toda la oficina, dentro' }, { valor: 'privado', texto: 'Privado: solo quien se añada' }] },
      { id: 'tema', etiqueta: 'Tema', tipo: 'texto', max: 250, marcador: 'Opcional: de qué va, en una línea' },
      { id: 'descripcion', etiqueta: 'Descripción', tipo: 'texto-largo', max: 2000 },
    ], { textoBoton: 'Crear el canal' });
    if (!v) return;
    const r = await Api.post(`${API}/canales`, v, { aviso: 'No se ha creado' });
    if (!r) return;
    await cargarLista();
    abrir(r.canal.id);
  });

  // ── Al momento ───────────────────────────────────────────────────────────
  TiempoReal.escuchar('chat', {
    alLlegar: d => {
      if (!d) return;
      if (d.tipo === 'mensaje' && actual && d.canal === actual.id) {
        if (d.padre) {
          actualizarRaiz(d.padre);
          if (hilo && hilo.raiz.id === d.padre) recargarHilo();
        } else cargarNuevos();
      }
      if ((d.tipo === 'miembros' || d.tipo === 'canal') && actual && d.canal === actual.id) abrir(actual.id, { mantener: true });
      cargarListaPronto();
    },
    sondear: () => { cargarLista(); cargarNuevos(); recargarHilo(); },
    cada: 15000,
  });

  // ── Arranque ─────────────────────────────────────────────────────────────
  (async () => {
    const [p] = await Promise.all([Api.get(`${API}/personas`).catch(() => null), cargarLista()]);
    if (p) p.personas.forEach(x => personas.set(x.id, x));
    const pedido = Number(new URLSearchParams(location.search).get('canal'));
    const primero = canales.find(c => c.id === pedido)
      || (matchMedia('(min-width: 1024px)').matches ? canales.filter(c => c.tipo !== 'directo').sort(orden)[0] : null);
    if (primero) abrir(primero.id);
  })();
})();
