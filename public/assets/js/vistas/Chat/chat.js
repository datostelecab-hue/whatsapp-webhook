// modules/Chat/vistas/chat.ejs — el chat interno (ítem 2, entregas 2a y 2b; db/256 y db/257).
//
// A la izquierda, los canales y los directos con sus no leídos; a la derecha, la
// conversación; los hilos, lo fijado y lo guardado, al lado (Panel). Llega todo
// al momento por el tiempo real (canal «chat»); sin él, se pregunta cada 15 s.
//
// LAS MENCIONES: al escribir «@» salen las personas (y @canal). En el texto que
// se manda van como <@id> y <!canal>; aquí se pintan con el nombre.
//
// LA 2b: cada mensaje tiene su barra (reaccionar, responder en un hilo, guardar,
// fijar, convertir en tarea, editar y anular), sus ficheros (con el componente
// de adjuntos de la casa), la vista previa de su enlace, sus reacciones y el
// sello de su tarea. El texto lleva formato: *negrita*, _cursiva_, ~tachado~,
// `código`, ```bloque```, «> cita» y listas con «-» o «1.».
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

  // Las seis reacciones que decidió Camilo (17/11/2026), por su código.
  const EMOJI = { ok: '👍', hecho: '✅', visto: '👀', gracias: '🙏', risa: '😂', corazon: '❤️' };
  const NOMBRE_EMOJI = { ok: 'De acuerdo', hecho: 'Hecho', visto: 'Lo he visto', gracias: 'Gracias', risa: 'Me hace gracia', corazon: 'Me encanta' };
  const ESTADO_TAREA = {
    por_aprobar: ['Por aprobar', 'aviso'], por_asignar: ['Por asignar', 'aviso'], por_hacer: ['Por hacer', 'azul'],
    en_curso: ['En curso', 'azul'], bloqueada: ['Bloqueada', 'rojo'], cerrada: ['Hecha', 'verde'],
    rechazada: ['Rechazada', ''], anulada: ['Anulada', ''],
  };
  const ICONO_FICHERO = { imagen: 'fa-image', pdf: 'fa-file-pdf', video: 'fa-film', audio: 'fa-music', otro: 'fa-file' };

  let yo = { id: 0, puedeCrear: false, gestiona: false };
  let canales = [];
  const personas = new Map();
  let actual = null;          // la ficha del canal abierto
  let mensajes = [];          // los de arriba del canal abierto, del más viejo al más nuevo
  let hayMas = false;
  let nuevosDesde = null;     // el primer mensaje sin leer al abrirlo (la raya «Nuevos»)
  let hilo = null;            // { raiz, respuestas, panel }
  const vistos = new Map();   // id → el último mensaje pintado (para sus ficheros y para editarlo)
  const tocar = matchMedia('(hover: none)');

  const iniciales = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x.charAt(0)).join('').toUpperCase() || '·';
  const hora = iso => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  const diaDe = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const fechaCorta = d => (d ? d.split('-').reverse().slice(0, 2).join('/') : '');
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
  function tamano(b) {
    const n = Number(b) || 0;
    if (n < 1024) return `${n} bytes`;
    if (n < 1048576) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`;
  }

  // ── El texto: formato, menciones y enlaces, siempre a partir del texto escapado ─
  const ENLACE = /\bhttps?:\/\/[^\s<>]+[^\s<>.,;:!?)\]'"]/g;
  function mencionHtml(id) {
    const p = personas.get(id);
    return `<span class="tc-chat-mencion${id === yo.id ? ' tc-chat-mencion--yo' : ''}">@${esc(p ? p.nombre : 'alguien')}</span>`;
  }
  /** Una línea: lo que no se toca (código, enlaces, menciones) se aparta, se escapa el resto y se le da formato. */
  function enLinea(s) {
    const aparte = [];
    const apartar = html => `\u0000${aparte.push(html) - 1}\u0000`;
    let t = String(s);
    t = t.replace(/`([^`\n]+)`/g, (m, c) => apartar(`<code>${esc(c)}</code>`));
    t = t.replace(ENLACE, u => apartar(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`));
    t = t.replace(/<@(\d{1,9})>/g, (m, id) => apartar(mencionHtml(Number(id))));
    t = t.replace(/<!canal>/g, () => apartar('<span class="tc-chat-mencion tc-chat-mencion--todos">@canal</span>'));
    let h = esc(t);
    const marca = (signo, etiqueta) => {
      const s2 = signo.replace(/[*~]/g, '\\$&');
      h = h.replace(new RegExp(`(^|[\\s(«¡¿])${s2}(?=\\S)([^${s2}\\n]*?\\S)${s2}(?=$|[\\s.,;:!?)»])`, 'g'), `$1<${etiqueta}>$2</${etiqueta}>`);
    };
    marca('*', 'strong'); marca('_', 'em'); marca('~', 's');
    return h.replace(/\u0000(\d+)\u0000/g, (m, i) => aparte[Number(i)]);
  }
  /** Las líneas: párrafos, listas y citas. */
  function bloques(t) {
    let out = '', parrafo = [], grupo = null;
    const cierraParrafo = () => { if (parrafo.length) { out += `<p>${parrafo.map(enLinea).join('<br>')}</p>`; parrafo = []; } };
    const cierraGrupo = () => {
      if (!grupo) return;
      out += grupo.tipo === 'cita'
        ? `<blockquote>${grupo.items.map(enLinea).join('<br>')}</blockquote>`
        : `<${grupo.tipo}>${grupo.items.map(x => `<li>${enLinea(x)}</li>`).join('')}</${grupo.tipo}>`;
      grupo = null;
    };
    const en = (tipo, x) => { cierraParrafo(); if (!grupo || grupo.tipo !== tipo) { cierraGrupo(); grupo = { tipo, items: [] }; } grupo.items.push(x); };
    String(t).split('\n').forEach(l => {
      let m;
      // Una línea en blanco separa párrafos (y cierra una lista o una cita).
      if (!l.trim()) { cierraParrafo(); cierraGrupo(); return; }
      if ((m = /^\s*[-•]\s+(.*)$/.exec(l)) || (m = /^\s*\*\s+(.*)$/.exec(l))) return en('ul', m[1]);
      if ((m = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(l))) return en('ol', m[1]);
      if ((m = /^>\s?(.*)$/.exec(l))) return en('cita', m[1]);
      cierraGrupo();
      parrafo.push(l);
    });
    cierraParrafo(); cierraGrupo();
    return out;
  }
  /** El texto entero de un mensaje, con sus bloques de código aparte. */
  function formatear(texto) {
    const trozos = String(texto || '').split('```');
    return trozos.map((tz, i) => {
      if (i % 2 === 1 && i < trozos.length - 1) return `<pre class="tc-chat-codigo">${esc(tz.replace(/^\n/, '').replace(/\n$/, ''))}</pre>`;
      return bloques(i % 2 === 1 ? '```' + tz : tz);
    }).join('');
  }
  /** El texto «en claro» de un mensaje (las menciones con su nombre): para editarlo o copiarlo en una tarea. */
  const enClaro = t => String(t || '').replace(/<@(\d{1,9})>/g, (m, id) => `@${(personas.get(Number(id)) || {}).nombre || 'alguien'}`).replace(/<!canal>/g, '@canal');
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
  function adjuntosHtml(m) {
    if (!m.adjuntos.length) return '';
    const fotos = m.adjuntos.filter(a => a.clase === 'imagen');
    const otros = m.adjuntos.filter(a => a.clase !== 'imagen');
    return `<div class="tc-chat-adjuntos">
        ${fotos.length ? `<div class="tc-chat-fotos">${fotos.map(a => `<button type="button" class="tc-chat-foto" data-adjunto="${a.id}" data-de="${m.id}" aria-label="Ver la foto ${esc(a.nombre)}">
            <img src="${esc(a.url)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
        ${otros.map(a => `<button type="button" class="tc-chat-fichero" data-adjunto="${a.id}" data-de="${m.id}" aria-label="Abrir ${esc(a.nombre)}">
            <i class="fa-solid ${ICONO_FICHERO[a.clase] || 'fa-file'}" aria-hidden="true"></i>
            <span><b>${esc(a.nombre)}</b><small>${esc(tamano(a.bytes))}</small></span></button>`).join('')}
      </div>`;
  }
  function reaccionesHtml(m, puedo) {
    if (!m.reacciones.length) return '';
    return `<div class="tc-chat-reacciones">${m.reacciones.map(r => `<button type="button" class="tc-chat-reaccion${r.mia ? ' tc-chat-reaccion--mia' : ''}"
          data-accion="reaccion" data-id="${m.id}" data-emoji="${r.emoji}" aria-pressed="${r.mia}" ${puedo ? '' : 'disabled'}
          title="${esc(r.nombres.join(', '))}" aria-label="${esc(NOMBRE_EMOJI[r.emoji])}: ${r.n}">
          <span aria-hidden="true">${EMOJI[r.emoji]}</span><b>${r.n}</b></button>`).join('')}
        ${puedo ? `<button type="button" class="tc-chat-reaccion tc-chat-reaccion--mas" data-accion="reaccionar" data-id="${m.id}" title="Reaccionar" aria-label="Añadir una reacción">
          <i class="fa-regular fa-face-smile" aria-hidden="true"></i></button>` : ''}</div>`;
  }
  function tareaHtml(m) {
    if (!m.tarea) return '';
    const [etq, tono] = ESTADO_TAREA[m.tarea.estado] || [m.tarea.estado, ''];
    const viva = !['cerrada', 'rechazada', 'anulada'].includes(m.tarea.estado);
    return `<a class="tc-pastilla${tono ? ` tc-pastilla--${tono}` : ''} tc-chat-tarea" href="/tablero?tarjeta=${m.tarea.id}" title="Abrir la tarjeta en el tablero">
        <i class="fa-solid fa-list-check" aria-hidden="true"></i>Tarea · ${esc(etq)}${m.tarea.responsable ? ` · ${esc(m.tarea.responsable)}` : ''}${viva && m.tarea.venceEl ? ` · vence el ${esc(fechaCorta(m.tarea.venceEl))}` : ''}</a>`;
  }
  function accionesHtml(m, { enHilo }) {
    if (m.anulado) return '';
    const puedo = !!(actual && actual.id === m.canalId && actual.puede.escribir);
    const propio = m.autorId === yo.id;
    const b = (accion, icono, titulo, extra = '') => `<button type="button" class="tc-chat-accion${extra}" data-accion="${accion}" data-id="${m.id}"
        title="${titulo}" aria-label="${titulo}"><i class="${icono}" aria-hidden="true"></i></button>`;
    return `<div class="tc-chat-msj-acciones" role="toolbar" aria-label="Acciones del mensaje de ${esc(m.autor)}">
        ${puedo ? b('reaccionar', 'fa-regular fa-face-smile', 'Reaccionar') : ''}
        ${enHilo ? '' : b('hilo', 'fa-solid fa-reply', 'Responder en un hilo')}
        ${b('guardar', m.guardado ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark', m.guardado ? 'Quitar de guardados' : 'Guardar para luego', m.guardado ? ' tc-chat-accion--activa' : '')}
        ${puedo ? b('fijar', 'fa-solid fa-thumbtack', m.fijado ? 'Desfijar' : 'Fijar en el canal', m.fijado ? ' tc-chat-accion--activa' : '') : ''}
        ${!m.tarea || m.tarea.estado === 'anulada' ? b('tarea', 'fa-solid fa-list-check', 'Convertir en tarea') : ''}
        ${propio && !m.evento && puedo ? b('editar', 'fa-solid fa-pen', 'Editar') : ''}
        ${propio || (actual && actual.puede.anularDeOtros) ? b('anular', 'fa-regular fa-trash-can', 'Anular', ' tc-chat-accion--peligro') : ''}
      </div>`;
  }

  /**
   * `seguido`: del mismo autor y casi a la vez (sin repetir cabeza); `enHilo`:
   * dentro del Panel del hilo; `soloVer`: en una lista (fijados, guardados), sin barra.
   */
  function mensajeHtml(m, { seguido = false, enHilo = false, soloVer = false } = {}) {
    vistos.set(m.id, m);
    const puedo = !soloVer && !!(actual && actual.id === m.canalId && actual.puede.escribir);
    const sistema = !!m.evento;
    let texto = '';
    if (m.anulado) {
      texto = `<p class="tc-chat-anulado"><i class="fa-solid fa-ban" aria-hidden="true"></i>Mensaje anulado${m.anulado.porAutor ? ''
        : ` por ${esc(m.anulado.por || 'quien lleva los canales')}${m.anulado.motivo ? `: ${esc(m.anulado.motivo)}` : ''}`}</p>`;
    } else if (m.texto) {
      texto = formatear(m.texto);
      if (m.editado) texto = /<\/p>$/.test(texto) ? texto.replace(/<\/p>$/, ' <span class="tc-chat-editado">(editado)</span></p>') : texto + '<span class="tc-chat-editado">(editado)</span>';
    } else if (!m.adjuntos.length && !m.evento) {
      // Los de antes del 17/11 que se mandaron antes de subir y no llegaron a tener ficheros.
      texto = '<p class="tc-chat-anulado"><i class="fa-regular fa-file" aria-hidden="true"></i>Los ficheros de este mensaje no llegaron a subirse</p>';
    }
    const marcas = [
      m.fijado ? `<span><i class="fa-solid fa-thumbtack" aria-hidden="true"></i>Fijado por ${esc(m.fijado.por)}</span>` : '',
      m.guardado ? '<span class="tc-chat-marca-guardado"><i class="fa-solid fa-bookmark" aria-hidden="true"></i>Guardado</span>' : '',
    ].filter(Boolean).join('');
    const clases = ['tc-chat-msj', seguido && !marcas ? 'tc-chat-msj--seguido' : '', meMenciona(m) && !m.anulado ? 'tc-chat-msj--mencion' : '',
      m.fijado ? 'tc-chat-msj--fijado' : '', sistema ? 'tc-chat-msj--sistema' : ''].filter(Boolean).join(' ');
    const lado = sistema
      ? '<span class="tc-chat-sistema-icono" aria-hidden="true"><i class="fa-solid fa-check"></i></span>'
      : seguido && !marcas ? `<time class="tc-chat-msj-hora" datetime="${esc(m.creadoAt)}">${esc(hora(m.creadoAt))}</time>`
        : `<span class="tc-avatar tc-avatar--chico" aria-hidden="true">${esc(iniciales(m.autor))}</span>`;
    return `<article class="${clases}" data-msj="${m.id}">
        ${marcas ? `<p class="tc-chat-marcas">${marcas}</p>` : ''}
        <div class="tc-chat-msj-lado">${lado}</div>
        <div class="tc-chat-msj-cuerpo">
          ${seguido && !marcas ? '' : `<header><b>${esc(m.autor)}</b><time datetime="${esc(m.creadoAt)}">${esc(hora(m.creadoAt))}</time>${m.importado ? '<span class="tc-chat-slack" title="Traído de Slack">Slack</span>' : ''}</header>`}
          ${texto ? `<div class="tc-chat-texto">${texto}</div>` : ''}
          ${m.anulado ? '' : adjuntosHtml(m)}
          ${m.enlace ? `<a class="tc-chat-previa" href="${esc(m.enlace.url)}" target="_blank" rel="noopener noreferrer">
              ${m.enlace.sitio ? `<small>${esc(m.enlace.sitio)}</small>` : ''}<b>${esc(m.enlace.titulo)}</b>
              ${m.enlace.descripcion ? `<span>${esc(m.enlace.descripcion)}</span>` : ''}</a>` : ''}
          ${reaccionesHtml(m, puedo)}
          ${tareaHtml(m)}
          ${!enHilo && !soloVer && m.respuestas ? `<button type="button" class="tc-chat-respuestas" data-accion="hilo" data-id="${m.id}">
              <i class="fa-regular fa-comments" aria-hidden="true"></i>${m.respuestas} ${m.respuestas === 1 ? 'respuesta' : 'respuestas'}
              <span>· ${esc(haceCuanto(m.ultimaRespuestaAt))}</span></button>` : ''}
        </div>
        ${soloVer ? '' : accionesHtml(m, { enHilo })}
      </article>`;
  }
  // Una serie: con su día, la raya de «Nuevos» y los seguidos del mismo autor juntos.
  function serieHtml(lista_, { enHilo = false, marcaNuevos = null } = {}) {
    let html = '', prev = null, dia = '';
    lista_.forEach(m => {
      const d = diaDe(m.creadoAt);
      if (d !== dia) { html += `<div class="tc-chat-dia"><span>${esc(etiquetaDia(d))}</span></div>`; dia = d; prev = null; }
      if (marcaNuevos && m.id === marcaNuevos) { html += '<div class="tc-chat-nuevos" role="separator"><span>Nuevos</span></div>'; prev = null; }
      const seguido = !!(prev && prev.autorId === m.autorId && !prev.respuestas && !prev.evento && !m.evento
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
        <button type="button" class="tc-boton tc-boton--chico${c.fijados ? '' : ' hidden'}" data-fijados title="Lo fijado en el canal">
          <i class="fa-solid fa-thumbtack" aria-hidden="true"></i><span data-fijados-n>${c.fijados}</span></button>
        <button type="button" class="tc-boton tc-boton--chico" data-miembros title="Quién está dentro">
          <i class="fa-solid fa-user-group" aria-hidden="true"></i>${c.miembros.length}</button>
        ${c.puede.anadir ? `<button type="button" class="tc-boton tc-boton--chico" data-anadir title="Añadir a alguien"><i class="fa-solid fa-user-plus" aria-hidden="true"></i>Añadir</button>` : ''}
      </header>`;
  }
  function escribirHtml(donde, marcador) {
    return `<form class="tc-chat-escribir" data-escribir="${donde}">
        <ul class="tc-chat-por-subir" data-por-subir hidden></ul>
        <div class="tc-chat-caja">
          <button type="button" class="tc-chat-adjuntar" data-adjuntar title="Adjuntar ficheros (o arrástralos aquí)" aria-label="Adjuntar ficheros">
            <i class="fa-solid fa-paperclip" aria-hidden="true"></i></button>
          <input type="file" multiple hidden data-fichero>
          <textarea rows="1" maxlength="8000" placeholder="${esc(marcador)}" aria-label="${esc(marcador)}"></textarea>
          <button type="submit" class="tc-boton tc-boton--principal tc-boton--chico" aria-label="Enviar"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i></button>
        </div>
        <p class="tc-chat-pista">Intro envía · Mayús + Intro, otra línea · @ menciona · *negrita* _cursiva_ ~tachado~ \`código\`</p>
      </form>`;
  }

  let escritorCanal = null;   // el de abajo de la conversación (para soltar ficheros encima)
  async function abrir(id, { mantener = false } = {}) {
    const [f, m] = await Promise.all([
      Api.get(`${API}/canales/${id}`, { aviso: 'No se ha podido abrir' }),
      Api.get(`${API}/canales/${id}/mensajes`).catch(() => null),
    ]);
    if (!f || !m) return;
    actual = f.canal;
    editando = null;
    mensajes = m.mensajes;
    hayMas = m.hayMas;
    // Lo traído de Slack no es «nuevo» aunque su número sea alto: es de antes.
    const primeroNuevo = mensajes.find(x => x.id > m.ultimoLeido && x.autorId !== yo.id && !x.importado);
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
    escritorCanal = prepararEscribir(conv.querySelector('[data-escribir="canal"]'), { padreId: null });
    const sitio = canales.find(c => c.id === id);
    if (sitio) { sitio.sinLeer = 0; sitio.menciones = 0; }
    pintarLista();
    marcarLeido();
    const u = new URL(location.href); u.searchParams.set('canal', id); u.searchParams.delete('mensaje'); history.replaceState(history.state, '', u);
    if (!mantener) { const ta = conv.querySelector('textarea'); if (ta && matchMedia('(min-width: 1024px)').matches) ta.focus(); }
  }

  function repintarSerie({ alFinal = false } = {}) {
    const caja = conv.querySelector('[data-mensajes]');
    if (!caja) return;
    const abajo = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 80;
    const arriba = caja.scrollTop;
    caja.querySelector('[data-serie]').innerHTML = serieHtml(mensajes, { marcaNuevos: nuevosDesde });
    const vacio = caja.querySelector('.tc-chat-vacio');
    if (vacio && mensajes.length) vacio.remove();
    if (alFinal || abajo) caja.scrollTop = caja.scrollHeight; else caja.scrollTop = arriba;
    seguirEditando(caja, false);
  }

  async function cargarNuevos() {
    if (!actual) return;
    const ultimo = mensajes.length ? mensajes[mensajes.length - 1].id : 0;
    const r = await Api.get(`${API}/canales/${actual.id}/mensajes?despues=${ultimo}`).catch(() => null);
    if (!r || !r.mensajes.length) return;
    const ids = new Set(mensajes.map(x => x.id));
    mensajes.push(...r.mensajes.filter(x => !ids.has(x.id)));
    // Por fecha, como los pide el servidor (lo de Slack llega con números altos y es de antes).
    mensajes.sort((a, b) => String(a.creadoAt).localeCompare(String(b.creadoAt)) || a.id - b.id);
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

  /** Un mensaje que cambió: en la conversación y en el hilo, donde esté. */
  function ponerMensaje(m) {
    if (!m) return;
    vistos.set(m.id, m);
    const i = mensajes.findIndex(x => x.id === m.id);
    if (i >= 0) { mensajes[i] = m; repintarSerie(); }
    if (hilo) {
      if (hilo.raiz.id === m.id) { hilo.raiz = m; pintarHilo({ enfocar: false }); }
      else {
        const j = hilo.respuestas.findIndex(x => x.id === m.id);
        if (j >= 0) { hilo.respuestas[j] = m; pintarHilo({ enfocar: false }); }
      }
    }
  }
  async function refrescarMensaje(id) {
    if (!vistos.has(id) && !(hilo && hilo.raiz.id === id)) return;
    const r = await Api.get(`${API}/mensajes/${id}`).catch(() => null);
    if (r) ponerMensaje(r.mensaje);
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

  conv.addEventListener('click', ev => {
    if (ev.target.closest('[data-volver]')) { raiz.dataset.vista = 'lista'; return; }
    if (ev.target.closest('[data-mas]')) { verAnteriores(); return; }
    if (ev.target.closest('[data-miembros]')) { verMiembros(); return; }
    if (ev.target.closest('[data-fijados]')) { verFijados(); return; }
    if (ev.target.closest('[data-anadir]')) { anadir(); return; }
    alPulsarMensaje(ev);
  });

  // ── Lo que se hace con un mensaje (en la conversación y en el hilo) ──────
  function alPulsarMensaje(ev) {
    const adj = ev.target.closest('[data-adjunto]');
    if (adj) {
      const m = vistos.get(Number(adj.dataset.de));
      const a = m && m.adjuntos.find(x => x.id === Number(adj.dataset.adjunto));
      if (a) Adjuntos.ver({ ...a, creadoPor: m.autor });
      return;
    }
    const b = ev.target.closest('[data-accion]');
    if (b) { accion(b.dataset.accion, Number(b.dataset.id), b); return; }
    // En una pantalla táctil la barra no sale al pasar por encima: sale al tocar el mensaje.
    const art = ev.target.closest('.tc-chat-msj');
    if (art && tocar.matches && !ev.target.closest('a, button, textarea, input')) {
      const ya = art.classList.contains('tc-chat-msj--elegido');
      document.querySelectorAll('.tc-chat-msj--elegido').forEach(x => x.classList.remove('tc-chat-msj--elegido'));
      if (!ya) art.classList.add('tc-chat-msj--elegido');
    }
  }

  const post = (url, datos, aviso) => Api.post(url, datos || {}, { aviso: aviso || 'No se ha podido' });
  async function accion(que, id, boton) {
    const m = vistos.get(id);
    if (!m && que !== 'hilo') return;
    if (que === 'hilo') { abrirHilo(id); return; }
    if (que === 'reaccionar') { elegirReaccion(id, boton); return; }
    if (que === 'reaccion') { const r = await post(`${API}/mensajes/${id}/reaccion`, { emoji: boton.dataset.emoji }); if (r) ponerMensaje(r.mensaje); return; }
    if (que === 'guardar') {
      const r = await post(`${API}/mensajes/${id}/guardar`, { guardar: !m.guardado });
      if (r) { ponerMensaje(r.mensaje); Dialogo.hecho(r.mensaje.guardado ? 'Guardado: lo tienes en «Guardados»' : 'Quitado de guardados'); }
      return;
    }
    if (que === 'fijar') {
      const r = await post(`${API}/mensajes/${id}/fijar`, { fijar: !m.fijado });
      if (r) { ponerMensaje(r.mensaje); refrescarFijados(); }
      return;
    }
    if (que === 'tarea') { convertirEnTarea(m); return; }
    if (que === 'editar') { const art = boton.closest('.tc-chat-msj'); if (art) editar(m, art); return; }
    if (que === 'anular') anular(m);
  }

  // Las seis reacciones, en una tira al lado del botón.
  let tira = null;
  function cerrarTira({ devolver = true } = {}) {
    if (!tira) return;
    const { el, boton } = tira;
    tira = null;
    el.remove();
    document.removeEventListener('mousedown', fueraDeTira, true);
    if (devolver && boton && document.contains(boton)) boton.focus();
  }
  const fueraDeTira = ev => { if (tira && !tira.el.contains(ev.target)) cerrarTira({ devolver: false }); };
  function elegirReaccion(id, boton) {
    cerrarTira({ devolver: false });
    const el = document.createElement('div');
    el.className = 'tc-chat-tira';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Elegir una reacción');
    el.innerHTML = Object.keys(EMOJI).map(k => `<button type="button" data-emoji="${k}" title="${esc(NOMBRE_EMOJI[k])}" aria-label="${esc(NOMBRE_EMOJI[k])}">${EMOJI[k]}</button>`).join('');
    document.body.appendChild(el);
    const r = boton.getBoundingClientRect();
    const ancho = el.offsetWidth, alto = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(innerWidth - ancho - 8, r.right - ancho)) + 'px';
    el.style.top = (r.top - alto - 6 > 8 ? r.top - alto - 6 : r.bottom + 6) + 'px';
    tira = { el, boton };
    const botones = [...el.querySelectorAll('button')];
    botones[0].focus();
    el.addEventListener('keydown', ev => {
      const i = botones.indexOf(document.activeElement);
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { ev.preventDefault(); botones[(i + (ev.key === 'ArrowRight' ? 1 : -1) + botones.length) % botones.length].focus(); }
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cerrarTira(); }
    });
    el.addEventListener('click', async ev => {
      const e = ev.target.closest('[data-emoji]');
      if (!e) return;
      cerrarTira();
      const res = await post(`${API}/mensajes/${id}/reaccion`, { emoji: e.dataset.emoji });
      if (res) ponerMensaje(res.mensaje);
    });
    setTimeout(() => document.addEventListener('mousedown', fueraDeTira, true), 0);
  }
  addEventListener('resize', () => cerrarTira({ devolver: false }));

  // Editar, en el sitio: Intro guarda, Escape lo deja como estaba. Si mientras
  // tanto se repinta (llega otro mensaje), la caja vuelve a abrirse con lo escrito.
  let editando = null;   // { id, enHilo, valor }
  function editar(m, articulo, { valor = null } = {}) {
    const art = articulo && articulo.querySelector('.tc-chat-msj-cuerpo');
    if (!art) return;
    const mapa = new Map();
    const crudoInicial = String(m.texto || '').replace(/<@(\d{1,9})>/g, (x, id) => {
      const nombre = `@${(personas.get(Number(id)) || {}).nombre || 'alguien'}`;
      mapa.set(nombre, Number(id));
      return nombre;
    }).replace(/<!canal>/g, '@canal');
    const crudo = valor == null ? crudoInicial : valor;
    editando = { id: m.id, enHilo: !!articulo.closest('.tc-panel-cuerpo'), valor: crudo };
    const caja = document.createElement('form');
    caja.className = 'tc-chat-editar';
    caja.innerHTML = `<textarea rows="2" maxlength="8000" aria-label="Editar el mensaje">${esc(crudo)}</textarea>
      <div class="tc-chat-editar-botones">
        <span class="tc-chat-pista">Intro guarda · Esc cancela</span>
        <button type="button" class="tc-boton tc-boton--chico" data-cancelar>Cancelar</button>
        <button type="submit" class="tc-boton tc-boton--principal tc-boton--chico">Guardar</button>
      </div>`;
    const texto = art.querySelector('.tc-chat-texto');
    if (texto) texto.replaceWith(caja); else art.querySelector('header') ? art.querySelector('header').after(caja) : art.prepend(caja);
    const ta = caja.querySelector('textarea');
    const crecer = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 260) + 'px'; };
    crecer();
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    const deshacer = () => { editando = null; ponerMensaje(vistos.get(m.id) || m); };
    ta.addEventListener('input', () => { crecer(); if (editando && editando.id === m.id) editando.valor = ta.value; });
    ta.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); deshacer(); }
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); caja.requestSubmit(); }
    });
    caja.querySelector('[data-cancelar]').addEventListener('click', deshacer);
    caja.addEventListener('submit', async ev => {
      ev.preventDefault();
      const r = await Api.post(`${API}/mensajes/${m.id}/editar`, { texto: codificar(ta.value.trim(), mapa) },
        { boton: caja.querySelector('button[type="submit"]'), aviso: 'No se ha guardado' });
      if (r) { editando = null; ponerMensaje(r.mensaje); }
    });
  }
  /** Tras repintar: si había una edición a medias en esa caja, se vuelve a abrir con lo escrito. */
  function seguirEditando(caja, enHilo) {
    if (!editando || editando.enHilo !== enHilo || !caja) return;
    const art = caja.querySelector(`.tc-chat-msj[data-msj="${editando.id}"]`);
    const m = vistos.get(editando.id);
    if (art && m && !m.anulado) editar(m, art, { valor: editando.valor });
  }

  async function anular(m) {
    const propio = m.autorId === yo.id;
    let motivo = null;
    if (propio) {
      const si = await Dialogo.confirmar({ titulo: '¿Anular el mensaje?', texto: 'Dejará de verse en el canal (con sus ficheros). Queda guardado en el libro de auditoría.',
        si: 'Anular', no: 'Volver', tono: 'peligro' });
      if (!si) return;
    } else {
      const v = await Dialogo.formulario(`Anular el mensaje de ${m.autor}`, [
        { id: 'motivo', etiqueta: 'Por qué', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 500,
          ayuda: 'Lo verá todo el canal en lugar del mensaje. El texto queda en el libro de auditoría.' },
      ], { textoBoton: 'Anular' });
      if (!v) return;
      motivo = v.motivo;
    }
    const r = await post(`${API}/mensajes/${m.id}/anular`, { motivo }, 'No se ha anulado');
    if (r) { ponerMensaje(r.mensaje); refrescarFijados(); }
  }

  // Convertir en tarea: el mismo formulario que «Nueva tarea» del tablero.
  let yoTablero = null;
  async function convertirEnTarea(m) {
    if (!yoTablero) { const r = await Api.get('/tablero/api/yo').catch(() => null); yoTablero = r ? r.yo : { aprueba: false }; }
    const claro = enClaro(m.texto).replace(/[*_~`]/g, '').trim();
    const primera = claro.split('\n')[0].slice(0, 200);
    const gente = [...personas.values()];
    const v = await Dialogo.formulario('Convertir en tarea', [
      { id: 'titulo', etiqueta: 'Qué hay que hacer', tipo: 'texto', obligatorio: true, max: 200, minimo: 3, valor: primera },
      { id: 'descripcion', etiqueta: 'Detalle', tipo: 'texto-largo', max: 4000,
        valor: claro ? `${m.autor} escribió en el chat:\n${claro}`.slice(0, 4000) : '' },
      { id: 'responsable', etiqueta: 'Quién la hace', tipo: 'lista', obligatorio: true, valor: String(yo.id),
        opciones: gente.map(p => ({ valor: String(p.id), texto: p.nombre + (p.puesto ? ` · ${p.puesto}` : '') })) },
      { id: 'dias', etiqueta: 'Plazo en días hábiles', tipo: 'texto', valor: '2', marcador: 'Ej.: 3',
        ayuda: 'Cuentan desde mañana, sin fines de semana ni festivos. O pon una fecha límite abajo (si pones las dos, manda la fecha).' },
      { id: 'fecha', etiqueta: 'O fecha límite', tipo: 'fecha' },
    ], {
      textoBoton: 'Crear la tarea',
      nota: (yoTablero.aprueba ? 'La creas tú, que apruebas: empieza a contar ya.' : 'Si es para ti, empieza a contar ya. Si es para otra persona, estará a la espera de ser aprobada y el plazo empieza a contar cuando se apruebe.')
        + ' El mensaje llevará el sello de la tarea y, al cerrarla, la respuesta saldrá en su hilo.',
    });
    if (!v) return;
    const plazo = v.fecha ? { venceEl: v.fecha } : { plazoDias: v.dias === '' ? null : Number(String(v.dias).replace(',', '.')) };
    const r = await post(`${API}/mensajes/${m.id}/tarea`, { titulo: v.titulo, descripcion: v.descripcion, responsableId: Number(v.responsable), ...plazo }, 'No se ha creado la tarea');
    if (!r) return;
    ponerMensaje(r.mensaje);
    Dialogo.hecho(r.tarea.estado === 'por_aprobar' ? 'Pedida: espera la aprobación' : 'Tarea creada');
  }

  // ── Escribir, con las menciones y los ficheros ───────────────────────────
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

  /**
   * Prepara una caja de escribir. → { anadirFicheros(lista) } (para soltar ficheros encima).
   *
   * LOS FICHEROS, COMO EN SLACK (Camilo, 17/11/2026: «que el mensaje no aparezca
   * sino hasta que se suba completamente el archivo»): se suben en cuanto se
   * eligen, a un borrador de quien escribe, con su progreso aquí abajo. El
   * mensaje se manda cuando todo está arriba (si se pulsa Enviar antes, espera)
   * y entonces los ficheros pasan a él. Nadie ve un mensaje a medias.
   */
  function prepararEscribir(form, { padreId }) {
    if (!form) return null;
    const ta = form.querySelector('textarea');
    const mapa = new Map();
    const porSubir = [];        // { fichero, estado: 'subiendo' | 'listo' | 'error', pct, adjunto, error, promesa, quitado }
    let borrador = null;        // «<mi id>-<al azar>»: donde se suben los de este mensaje
    let enviando = false;
    const listaPorSubir = form.querySelector('[data-por-subir]');
    const entrada = form.querySelector('[data-fichero]');
    const pista = form.querySelector('.tc-chat-pista');
    const pistaNormal = pista ? pista.textContent : '';
    let sug = null, elegido = 0, desde = -1;
    const crecer = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; };
    const cerrarSug = () => { if (sug) sug.remove(); sug = null; desde = -1; };

    const nuevoBorrador = () => {
      const b = new Uint8Array(12);
      crypto.getRandomValues(b);
      return `${yo.id}-${[...b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
    };
    const iconoDe = f => (f.type.startsWith('image/') ? 'fa-image' : f.type === 'application/pdf' ? 'fa-file-pdf'
      : f.type.startsWith('video/') ? 'fa-film' : f.type.startsWith('audio/') ? 'fa-music' : 'fa-file');
    const pct = x => Math.round((x.pct || 0) * 100);
    const estadoHtml = x => (x.estado === 'subiendo' ? `<small data-pct>${pct(x)} %</small>`
      : x.estado === 'error' ? `<small class="tc-chat-por-subir-error" title="${esc(x.error)}">No se ha subido</small>`
        : `<small>${esc(tamano(x.fichero.size))}</small>`);
    function pintarPorSubir() {
      listaPorSubir.hidden = !porSubir.length;
      listaPorSubir.innerHTML = porSubir.map((x, i) => `<li class="tc-chat-por-subir--${x.estado}" style="--pct: ${pct(x)}%">
          <i class="fa-solid ${iconoDe(x.fichero)}" aria-hidden="true"></i>
          <span>${esc(x.fichero.name)}</span>${estadoHtml(x)}
          <button type="button" data-quitar-fichero="${i}" aria-label="Quitar ${esc(x.fichero.name)}" title="Quitar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></li>`).join('');
    }
    // El progreso, sin repintar la lista entera en cada trocito.
    function pintarProgreso(x) {
      const li = listaPorSubir.children[porSubir.indexOf(x)];
      if (!li) return;
      li.style.setProperty('--pct', `${pct(x)}%`);
      const s = li.querySelector('[data-pct]');
      if (s) s.textContent = `${pct(x)} %`;
    }
    const quitarDelServidor = x => {
      if (x.adjunto) Api.post(`/adjuntos/api/${x.adjunto.id}/anular`, { motivo: 'Quitado antes de mandar el mensaje' }).catch(() => {});
    };
    function subirUno(x) {
      if (!borrador) borrador = nuevoBorrador();
      x.estado = 'subiendo';
      x.pct = 0;
      x.promesa = Adjuntos.subir({ tipo: 'chat_borrador', dueno: borrador, fichero: x.fichero, alProgresar: p => { x.pct = p; pintarProgreso(x); } })
        .then(a => { x.adjunto = a; x.estado = 'listo'; if (x.quitado) quitarDelServidor(x); })
        .catch(e => { x.estado = 'error'; x.error = (e && e.message) || 'No se ha podido subir'; })
        .finally(() => { if (!x.quitado) pintarPorSubir(); });
    }
    function anadirFicheros(ficheros) {
      [...ficheros].forEach(f => {
        if (!f || porSubir.length >= 20) return;
        const x = { fichero: f };
        porSubir.push(x);
        subirUno(x);
      });
      pintarPorSubir();
      ta.focus();
    }
    form.querySelector('[data-adjuntar]').addEventListener('click', () => entrada.click());
    entrada.addEventListener('change', () => { anadirFicheros(entrada.files); entrada.value = ''; });
    listaPorSubir.addEventListener('click', ev => {
      const q = ev.target.closest('[data-quitar-fichero]');
      if (!q || enviando) return;
      const [x] = porSubir.splice(Number(q.dataset.quitarFichero), 1);
      if (x) { x.quitado = true; quitarDelServidor(x); }
      pintarPorSubir();
    });
    ta.addEventListener('paste', ev => {
      const fs = ev.clipboardData && ev.clipboardData.files;
      if (fs && fs.length) { ev.preventDefault(); anadirFicheros(fs); }
    });

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
      if (enviando || !actual) return;
      if (!ta.value.trim() && !porSubir.length) return;
      const boton = form.querySelector('button[type="submit"]');
      enviando = true;
      try {
        // Si aún suben, se espera: el mensaje sale en cuanto acaben (y se puede seguir escribiendo).
        const pendientes = porSubir.filter(x => x.estado === 'subiendo');
        if (pendientes.length) {
          boton.disabled = true;
          if (pista) pista.textContent = `Subiendo ${pendientes.length === 1 ? 'el fichero' : `${pendientes.length} ficheros`}… el mensaje sale en cuanto acabe.`;
          await Promise.all(pendientes.map(x => x.promesa));
        }
        const malos = porSubir.filter(x => x.estado === 'error');
        const listos = () => porSubir.filter(x => x.estado === 'listo');
        if (malos.length) {
          const lista_ = malos.map(x => `${x.fichero.name}: ${x.error}`).join('\n');
          if (!ta.value.trim() && !listos().length) {
            await Dialogo.aviso({ titulo: malos.length === 1 ? 'El fichero no se ha subido' : 'No se ha subido ningún fichero', texto: lista_, tono: 'error' });
            return;
          }
          const si = await Dialogo.confirmar({ titulo: malos.length === 1 ? 'Un fichero no se ha subido' : `${malos.length} ficheros no se han subido`,
            texto: `${lista_}\n\n¿Mandar el mensaje sin ${malos.length === 1 ? 'él' : 'ellos'}?`, si: 'Mandarlo así', no: 'Volver' });
          if (!si) return;
          malos.forEach(x => { porSubir.splice(porSubir.indexOf(x), 1); });
          pintarPorSubir();
        }
        const crudo = ta.value.trim();
        if (!crudo && !listos().length) return;
        boton.disabled = false;
        const r = await Api.post(`${API}/canales/${actual.id}/mensajes`,
          { texto: codificar(crudo, mapa), padreId, borrador: listos().length ? borrador : null },
          { boton, aviso: 'No se ha enviado' });
        if (!r) return;
        ta.value = ''; mapa.clear(); crecer();
        porSubir.length = 0; borrador = null; pintarPorSubir();
        if (padreId) { await recargarHilo(); actualizarRaiz(r.mensaje.padreId); }
        else {
          if (!mensajes.some(x => x.id === r.mensaje.id)) mensajes.push(r.mensaje);
          nuevosDesde = null;
          repintarSerie({ alFinal: true });
        }
      } finally {
        enviando = false;
        boton.disabled = false;
        if (pista) pista.textContent = pistaNormal;
      }
    });
    return { anadirFicheros };
  }

  // Soltar ficheros encima de la conversación (van a la caja de abajo).
  function zonaDeSoltar(zona, destino) {
    let dentro = 0;
    const lleva = ev => [...(ev.dataTransfer && ev.dataTransfer.types || [])].includes('Files');
    zona.addEventListener('dragenter', ev => { if (!lleva(ev)) return; dentro++; zona.classList.add('tc-chat--soltando'); });
    zona.addEventListener('dragleave', () => { dentro = Math.max(0, dentro - 1); if (!dentro) zona.classList.remove('tc-chat--soltando'); });
    zona.addEventListener('dragover', ev => { if (lleva(ev)) ev.preventDefault(); });
    zona.addEventListener('drop', ev => {
      if (!lleva(ev)) return;
      ev.preventDefault();
      dentro = 0; zona.classList.remove('tc-chat--soltando');
      const d = destino();
      if (d) d.anadirFicheros(ev.dataTransfer.files);
    });
  }
  zonaDeSoltar(conv, () => escritorCanal);

  // ── Los hilos, al lado ────────────────────────────────────────────────────
  async function abrirHilo(id, { destacar = null } = {}) {
    const r = await Api.get(`${API}/mensajes/${id}/hilo`, { aviso: 'No se ha podido abrir el hilo' });
    if (!r) return;
    const panel = Panel.abrir({
      titulo: 'Hilo', subtitulo: actual ? (actual.tipo === 'directo' ? actual.titulo : `#${actual.nombre}`) : '',
      html: '', alCerrar: () => { hilo = null; },
    });
    hilo = { raiz: r.raiz, respuestas: r.respuestas, panel, escritor: null };
    // La caja de escribir se monta UNA vez: al repintar el hilo (llega una
    // respuesta) solo cambian los mensajes, y lo que se está escribiendo o
    // subiendo sigue ahí.
    panel.cuerpo.innerHTML = `<div class="tc-chat-hilo" data-hilo-mensajes></div>
      ${actual && actual.puede.escribir ? escribirHtml('hilo', 'Responde en el hilo') : ''}`;
    hilo.escritor = prepararEscribir(panel.cuerpo.querySelector('[data-escribir="hilo"]'), { padreId: r.raiz.id });
    panel.cuerpo.addEventListener('click', alPulsarMensaje);
    zonaDeSoltar(panel.cuerpo, () => hilo && hilo.escritor);
    pintarHilo();
    if (destacar) destacarEn(panel.cuerpo, destacar);
  }
  function pintarHilo({ enfocar = true } = {}) {
    if (!hilo) return;
    const { raiz: rz, respuestas: rs, panel } = hilo;
    const caja = panel.cuerpo.querySelector('[data-hilo-mensajes]');
    if (!caja) return;
    caja.innerHTML = `
        ${mensajeHtml(rz, { enHilo: true })}
        <div class="tc-chat-dia"><span>${rs.length ? `${rs.length} ${rs.length === 1 ? 'respuesta' : 'respuestas'}` : 'Sin respuestas todavía'}</span></div>
        <div data-respuestas>${serieHtml(rs, { enHilo: true })}</div>`;
    const ta = panel.cuerpo.querySelector('[data-escribir="hilo"] textarea');
    const max = Math.max(rz.id, ...rs.map(x => x.id));
    marcarLeido({ hasta: max });
    if (ta && enfocar && !editando) ta.focus();
    seguirEditando(panel.cuerpo, true);
  }
  async function recargarHilo() {
    if (!hilo) return;
    const r = await Api.get(`${API}/mensajes/${hilo.raiz.id}/hilo`).catch(() => null);
    if (!r || !hilo) return;
    hilo.raiz = r.raiz; hilo.respuestas = r.respuestas;
    pintarHilo({ enfocar: false });
  }
  async function actualizarRaiz(id) {
    if (!id) return;
    const r = await Api.get(`${API}/mensajes/${id}`).catch(() => null);
    if (!r) return;
    const i = mensajes.findIndex(x => x.id === id);
    if (i >= 0) { mensajes[i] = r.mensaje; repintarSerie(); }
  }

  // ── Ir a un mensaje (desde lo fijado, lo guardado o el enlace de una tarea) ─
  function destacarEn(caja, id) {
    const el = caja.querySelector(`.tc-chat-msj[data-msj="${id}"]`);
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('tc-chat-msj--destacado');
    void el.offsetWidth;
    el.classList.add('tc-chat-msj--destacado');
    return true;
  }
  async function irAlMensaje(canalId, id, padreId) {
    if (!actual || actual.id !== canalId) await abrir(canalId, { mantener: true });
    if (!actual || actual.id !== canalId) return;
    if (padreId) { abrirHilo(padreId, { destacar: id }); return; }
    if (!destacarEn(conv, id)) abrirHilo(id, { destacar: id });
  }

  // ── Lo fijado y lo guardado, en el Panel ─────────────────────────────────
  function listaHtml(ms, { conCanal = false, boton }) {
    if (!ms.length) return '';
    return ms.map(m => `<div class="tc-chat-en-lista">
        ${conCanal ? `<p class="tc-chat-en-lista-canal">${m.canal.tipo === 'directo' ? '<i class="fa-solid fa-user" aria-hidden="true"></i>' : `<i class="fa-solid ${m.canal.tipo === 'privado' ? 'fa-lock' : 'fa-hashtag'}" aria-hidden="true"></i>`}
          ${esc(m.canal.tipo === 'directo' ? ((canales.find(c => c.id === m.canal.id) || {}).titulo || 'Mensaje directo') : m.canal.nombre)} · ${esc(etiquetaDia(diaDe(m.creadoAt)))}</p>` : ''}
        ${mensajeHtml(m, { soloVer: true })}
        <div class="tc-chat-en-lista-botones">
          <button type="button" class="tc-boton tc-boton--chico" data-ir="${m.id}" data-canal-ir="${m.canalId}" data-padre-ir="${m.padreId || ''}">Ir al mensaje</button>
          ${boton(m)}
        </div></div>`).join('');
  }
  async function verFijados() {
    if (!actual) return;
    const r = await Api.get(`${API}/canales/${actual.id}/fijados`, { aviso: 'No se ha podido' });
    if (!r) return;
    const panel = Panel.abrir({ titulo: 'Fijado en el canal', subtitulo: actual.tipo === 'directo' ? actual.titulo : `#${actual.nombre}`, html: '' });
    const pintar = ms => {
      panel.cuerpo.innerHTML = ms.length
        ? listaHtml(ms, { boton: m => (actual.puede.escribir ? `<button type="button" class="tc-boton tc-boton--chico" data-desfijar="${m.id}">Desfijar</button>` : '') })
        : '<div class="tc-chat-vacio"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i><p>No hay nada fijado.</p></div>';
    };
    pintar(r.mensajes);
    panel.cuerpo.addEventListener('click', async ev => {
      const d = ev.target.closest('[data-desfijar]');
      if (d) {
        const x = await post(`${API}/mensajes/${d.dataset.desfijar}/fijar`, { fijar: false });
        if (!x) return;
        ponerMensaje(x.mensaje); refrescarFijados();
        const otra = await Api.get(`${API}/canales/${actual.id}/fijados`).catch(() => null);
        if (otra) pintar(otra.mensajes);
        return;
      }
      irDesdeLista(ev, panel);
    });
  }
  async function verGuardados() {
    const r = await Api.get(`${API}/guardados`, { aviso: 'No se ha podido' });
    if (!r) return;
    const panel = Panel.abrir({ titulo: 'Guardados', subtitulo: 'Solo los ves tú', html: '' });
    const pintar = ms => {
      panel.cuerpo.innerHTML = ms.length
        ? listaHtml(ms, { conCanal: true, boton: m => `<button type="button" class="tc-boton tc-boton--chico" data-quitar-guardado="${m.id}">Quitar</button>` })
        : '<div class="tc-chat-vacio"><i class="fa-regular fa-bookmark" aria-hidden="true"></i><p>Aún no has guardado nada. Guarda un mensaje con <i class="fa-regular fa-bookmark" aria-hidden="true"></i> para tenerlo aquí.</p></div>';
    };
    pintar(r.mensajes);
    panel.cuerpo.addEventListener('click', async ev => {
      const q = ev.target.closest('[data-quitar-guardado]');
      if (q) {
        const x = await post(`${API}/mensajes/${q.dataset.quitarGuardado}/guardar`, { guardar: false });
        if (!x) return;
        ponerMensaje(x.mensaje);
        const otra = await Api.get(`${API}/guardados`).catch(() => null);
        if (otra) pintar(otra.mensajes);
        return;
      }
      irDesdeLista(ev, panel);
    });
  }
  function irDesdeLista(ev, panel) {
    const ir = ev.target.closest('[data-ir]');
    if (ir) { panel.cerrar(); irAlMensaje(Number(ir.dataset.canalIr), Number(ir.dataset.ir), Number(ir.dataset.padreIr) || null); return; }
    const adj = ev.target.closest('[data-adjunto]');
    if (adj) alPulsarMensaje(ev);
  }
  document.getElementById('chat-guardados').addEventListener('click', verGuardados);

  async function refrescarFijados() {
    if (!actual) return;
    const f = await Api.get(`${API}/canales/${actual.id}`).catch(() => null);
    if (!f || !actual || f.canal.id !== actual.id) return;
    actual.fijados = f.canal.fijados;
    const b = conv.querySelector('[data-fijados]');
    if (b) { b.classList.toggle('hidden', !actual.fijados); b.querySelector('[data-fijados-n]').textContent = actual.fijados; }
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
      if (d.tipo === 'cambio' && actual && d.canal === actual.id) {
        refrescarMensaje(d.id);
        if (d.fijados) refrescarFijados();
        return;
      }
      if ((d.tipo === 'miembros' || d.tipo === 'canal') && actual && d.canal === actual.id) abrir(actual.id, { mantener: true });
      cargarListaPronto();
    },
    sondear: () => { cargarLista(); cargarNuevos(); recargarHilo(); },
    cada: 15000,
  });

  // ── El recorrido, la primera vez (y con el botón, cuando se quiera) ───────
  // Camilo (17/11/2026): «un recorrido del chat por primera vez para que sepan
  // cómo es el flujo de creación de tareas». Los pasos se miran al empezar: con
  // un mensaje en pantalla se ilumina su barra; sin él (los chats arrancan
  // vacíos), el paso sale en el centro. Lo que no se ve (el móvil), se salta.
  const ULTIMO = '[data-serie] > article.tc-chat-msj:last-of-type';
  const mostrarBarra = el => { const a = el.closest('.tc-chat-msj'); if (a) a.classList.add('tc-chat-msj--mostrar'); };
  function pasosChat() {
    // Solo si el mensaje se ve y la barra sale al pasar el ratón (en el móvil sale
    // al tocarlo): si no, esos pasos van en el centro, para no saltárselos.
    const art = document.querySelector(ULTIMO);
    const hayMensaje = !!(art && art.getClientRects().length && art.querySelector('.tc-chat-msj-acciones') && !tocar.matches);
    const haySello = !!document.querySelector('.tc-chat-mensajes .tc-chat-tarea');
    const enMensaje = (sel, paso) => (hayMensaje ? { sel: `${ULTIMO} ${sel}`, antes: mostrarBarra, ...paso } : paso);
    return [
      { icono: 'fa-message', titulo: 'El chat de la oficina',
        texto: 'Lo que antes iba por Slack, ahora dentro de Telecab: los canales de siempre y los mensajes directos. En un minuto te enseño cómo se usa y cómo un mensaje se convierte en una tarea del tablero.' },
      { sel: '#chat-lista', icono: 'fa-hashtag', titulo: 'Canales y mensajes directos',
        texto: 'Arriba, los canales; debajo, tus mensajes directos. En negrita, lo que no has leído. En el menú, el número rojo son los directos y las veces que te nombran.' },
      { sel: '[data-escribir="canal"]', icono: 'fa-pen', titulo: 'Escribir',
        texto: 'Intro envía y Mayús + Intro hace otra línea. Con @ nombras a alguien (le llega el aviso) y con @canal, a todos. El clip adjunta ficheros: se suben antes y el mensaje sale cuando están arriba.' },
      enMensaje('.tc-chat-msj-acciones', { icono: 'fa-hand-pointer', titulo: 'Lo que se hace con un mensaje',
        texto: `${tocar.matches ? 'Al tocar un mensaje' : 'Al pasar por encima de un mensaje'} sale su barra: reaccionar, responder en un hilo, guardarlo para luego, fijarlo en el canal, convertirlo en tarea y, si es tuyo, editarlo o anularlo.` }),
      enMensaje('[data-accion="tarea"]', { icono: 'fa-list-check', titulo: 'Convertir un mensaje en tarea',
        texto: 'Con el botón de la lista de la barra. El título y el detalle salen ya del mensaje; tú eliges quién la hace y el plazo, en días hábiles (sin fines de semana ni festivos).' }),
      { icono: 'fa-user-check', titulo: 'A la espera de aprobación',
        texto: 'Si es para otra persona, estará a la espera de ser aprobada, y el plazo empieza a contar cuando se apruebe. Si es para ti, o si tú apruebas tareas, empieza a contar ya.' },
      { sel: '.tc-chat-mensajes .tc-chat-tarea', icono: 'fa-tag', titulo: 'El sello de la tarea',
        texto: 'El mensaje lleva el sello de su tarea: en qué estado está, quién la hace y cuándo vence. Pulsándolo vas a su tarjeta en el tablero.' },
      { icono: 'fa-circle-check', titulo: 'Cuando se cierra',
        texto: `${haySello ? '' : 'Desde ese momento el mensaje lleva el sello de su tarea (su estado, quién la hace y cuándo vence), que te lleva al tablero. '}Cuando quien la hace la cierra allí, la respuesta sale en el hilo del mensaje y quien la pidió recibe una mención: todo el canal sabe que está hecha.` },
      { sel: '#menu a[href="/tablero"]', icono: 'fa-table-columns', titulo: 'Tus tareas, en el tablero',
        texto: 'Todas las tareas, con su plazo y su semáforo, están en el tablero. Allí se aprueban, se mueven y se cierran.' },
      { sel: '#chat-guardados', icono: 'fa-bookmark', titulo: 'Guardados',
        texto: 'Lo que guardas para luego, de todos los canales. Solo lo ves tú.' },
      { sel: '#chat-recorrido', icono: 'fa-route', titulo: 'Otra vez',
        texto: 'Este recorrido, cuando quieras.' },
    ];
  }
  // novedades.js se carga con `defer`: puede llegar después que esta pantalla.
  const conNovedades = fn => {
    if (window.Novedades) fn(window.Novedades);
    else addEventListener('DOMContentLoaded', () => { if (window.Novedades) fn(window.Novedades); });
  };
  document.getElementById('chat-recorrido').addEventListener('click', () => conNovedades(N => N.recorridoDe('chat', pasosChat)));

  // Al pulsar una notificación del chat con esta pestaña abierta, el service
  // worker (public/sw.js) la trae delante y dice adónde ir: sin recargar.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async ev => {
      const d = ev.data || {};
      if (d.tipo !== 'chat-ir' || !d.url) return;
      let u;
      try { u = new URL(d.url, location.origin); } catch (_) { return; }
      if (u.origin !== location.origin || u.pathname !== '/chat') return;
      const canal = Number(u.searchParams.get('canal'));
      const mensaje = Number(u.searchParams.get('mensaje'));
      if (mensaje) {
        const r = await Api.get(`${API}/mensajes/${mensaje}`).catch(() => null);
        if (r) { irAlMensaje(r.mensaje.canalId, r.mensaje.id, r.mensaje.padreId); return; }
      }
      if (canal) abrir(canal);
    });
  }

  // ── Arranque ─────────────────────────────────────────────────────────────
  (async () => {
    const [p] = await Promise.all([Api.get(`${API}/personas`).catch(() => null), cargarLista()]);
    if (p) p.personas.forEach(x => personas.set(x.id, x));
    const params = new URLSearchParams(location.search);
    const pedido = Number(params.get('canal'));
    const pedidoMensaje = Number(params.get('mensaje'));
    const primero = canales.find(c => c.id === pedido)
      || (matchMedia('(min-width: 1024px)').matches ? canales.filter(c => c.tipo !== 'directo').sort(orden)[0] : null);
    if (pedidoMensaje) {
      // El enlace de una tarea: al mensaje, aunque el canal sea uno público en el que no esté.
      const r = await Api.get(`${API}/mensajes/${pedidoMensaje}`, { aviso: 'Ese mensaje no existe o no está en un canal tuyo' }).catch(() => null);
      if (r) { await irAlMensaje(r.mensaje.canalId, r.mensaje.id, r.mensaje.padreId); return; }
    }
    if (primero) await abrir(primero.id);
    // La primera vez que entra, el recorrido (cuando la pantalla ya está pintada).
    conNovedades(N => N.primeraVez('chat', pasosChat));
  })();
})();
