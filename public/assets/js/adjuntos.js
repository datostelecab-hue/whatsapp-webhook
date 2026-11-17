// ============================================================
// ADJUNTOS — el componente de la casa para adjuntar y ver ficheros (A6)
// ============================================================
// Lo usa cualquier pantalla cuyo módulo se haya registrado como dueño en
// services/adjuntos.js. Se carga en la vista que lo use:
//
//   <script src="<%= est('/assets/js/adjuntos.js') %>"></script>
//
//   const caja = Adjuntos.montar(document.querySelector('#adjuntos'),
//     { tipo: 'siniestro', dueno: 42, puedeQuitar: true, alCambiar: lista => … });
//   caja.recargar();
//
//   Adjuntos.subir({ tipo, dueno, fichero, alProgresar: f => … })   → el adjunto
//   Adjuntos.ver(adjunto)        foto en VisorFoto, PDF en la página, vídeo y audio
//                                con su reproductor; lo demás se descarga
//
// La subida va con su barra de progreso y por trozos (el servidor no la carga
// en memoria). Un fichero que pasa del tope se rechaza ANTES de subirlo. Quitar
// pide el motivo: nada se borra, se anula (queda en su historia).
(function (global) {
  'use strict';

  const esc = s => global.Casa.esc(s);
  const ICONO = { imagen: 'fa-image', pdf: 'fa-file-pdf', video: 'fa-film', audio: 'fa-music', otro: 'fa-file' };

  /** 1,2 MB · 350 KB · 12 bytes */
  function tamano(b) {
    const n = Number(b) || 0;
    if (n < 1024) return `${n} bytes`;
    if (n < 1048576) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1048576).toLocaleString('es-ES', { maximumFractionDigits: n < 10485760 ? 1 : 0 })} MB`;
  }

  const fecha = iso => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const urlDe = (a, { descargar = false } = {}) => a.url + (descargar ? '?descargar=1' : '');

  // ── Subir ───────────────────────────────────────────────────────────────
  /**
   * Sube UN fichero. Con XMLHttpRequest y no con fetch porque fetch no dice
   * cuánto lleva subido, y un vídeo de 80 MB sin barra parece colgado.
   */
  function subir({ tipo, dueno, fichero, alProgresar }) {
    return new Promise((resolve, reject) => {
      const datos = new FormData();
      datos.append('fichero', fichero, fichero.name);
      const x = new XMLHttpRequest();
      x.open('POST', `/adjuntos/api/${encodeURIComponent(tipo)}/${encodeURIComponent(dueno)}`);
      x.setRequestHeader('Accept', 'application/json');
      x.upload.onprogress = e => { if (e.lengthComputable && alProgresar) alProgresar(e.loaded / e.total); };
      x.onload = () => {
        let r = null;
        try { r = JSON.parse(x.responseText); } catch (_) { /* no es JSON */ }
        if (x.status >= 200 && x.status < 300 && r && r.status === 'ok') { resolve(r.adjunto); return; }
        if (x.status === 401) {
          // Sesión caducada: lo mismo que cualquier petición de Api (aviso y al
          // login, que devuelve aquí). Su «Sesión requerida» no se enseña.
          if (global.Api && global.Api.irAlLogin) global.Api.irAlLogin();
          reject(new Error('La sesión ha caducado: vuelve a entrar y súbelo otra vez.'));
          return;
        }
        reject(new Error((r && r.msg) || `No se ha podido subir (error ${x.status}).`));
      };
      x.onerror = () => reject(new Error('Se cortó la conexión mientras subía el fichero. Inténtalo de nuevo.'));
      x.send(datos);
    });
  }

  // ── Ver ─────────────────────────────────────────────────────────────────
  /**
   * Lo baja. Antes pregunta con un HEAD (no trae el fichero): un enlace de
   * descarga con la sesión caducada recibía el 401 y el navegador cancelaba la
   * descarga sin decir nada (revisión del 16/11/2026). Así, con la sesión
   * caducada va al login como Api, y si ya no está o no puede verlo, lo dice.
   */
  async function descargar(a) {
    const url = urlDe(a, { descargar: true });
    let r = null;
    try { r = await fetch(url, { method: 'HEAD', credentials: 'same-origin' }); } catch (_) { /* sin red: que lo intente el navegador */ }
    if (r && r.status === 401) { if (global.Api && global.Api.irAlLogin) global.Api.irAlLogin(); return; }
    if (r && !r.ok) {
      const texto = { 403: 'No tienes permiso para ver este fichero.', 404: 'Este fichero ya no está: lo han quitado.' }[r.status]
        || `No se ha podido descargar (error ${r.status}).`;
      if (global.Dialogo) global.Dialogo.aviso({ titulo: 'No se puede descargar', texto, tono: 'error' });
      return;
    }
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = a.nombre || '';
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
  }

  /** Lo enseña según lo que es; lo que no se puede ver en la página, se descarga. */
  async function ver(a) {
    const pie = `${tamano(a.bytes)}${a.creadoPor ? ' · ' + a.creadoPor : ''}${a.creadoAt ? ' · ' + fecha(a.creadoAt) : ''}`;
    if (a.clase === 'imagen' && global.VisorFoto) {
      global.VisorFoto.abrir({ src: a.url, titulo: a.nombre, pie });
      return;
    }
    const caja = {
      pdf: `<iframe src="${esc(a.url)}" title="${esc(a.nombre)}" class="w-full h-[70vh] rounded-lg border border-telecab-border bg-white"></iframe>`,
      video: `<video src="${esc(a.url)}" controls preload="metadata" playsinline class="w-full max-h-[70vh] rounded-lg bg-black" aria-label="${esc(a.nombre)}"></video>`,
      audio: `<audio src="${esc(a.url)}" controls preload="metadata" class="w-full" aria-label="${esc(a.nombre)}"></audio>`,
    }[a.clase];
    if (!caja) { descargar(a); return; }
    const v = await global.Dialogo.abrir({
      titulo: a.nombre,
      html: `${caja}<p class="text-xs text-telecab-muted mt-2">${esc(pie)}</p>`,
      ancho: a.clase === 'audio' ? 'max-w-lg' : 'max-w-5xl',
      opciones: [{ texto: 'Descargar', valor: 'bajar' }, { texto: 'Cerrar', valor: null, principal: true }],
    });
    if (v === 'bajar') descargar(a);
  }

  // ── La lista de un dueño ────────────────────────────────────────────────
  /**
   * Monta la lista de adjuntos de un dueño en `caja`, con el botón de adjuntar
   * (y arrastrar ficheros encima). → { recargar, lista }
   */
  function montar(caja, { tipo, dueno, titulo = 'Adjuntos', puedeAdjuntar = true, puedeQuitar = false, alCambiar, maxMb: maxDeFuera = null } = {}) {
    let lista = [];
    // El tope llega con la lista; la pantalla que ya lo sepa (el banco) lo pasa.
    let maxMb = maxDeFuera;
    // Hasta la primera respuesta no se sabe si hay adjuntos: «Cargando…», no
    // «Sin adjuntos.», que en un móvil lento se veía unos segundos (16/11/2026).
    let cargado = false;
    let errorCarga = null;
    const subiendo = new Map();   // id local → { nombre, progreso, error }
    let siguiente = 1;

    caja.innerHTML = `
      <div class="bg-telecab-card border border-telecab-border rounded-2xl shadow-soft overflow-hidden" data-adj>
        <div class="px-5 py-3 border-b border-telecab-border flex items-center gap-2">
          <i class="fa-solid fa-paperclip text-telecab-gold text-sm" aria-hidden="true"></i>
          <h3 class="font-semibold text-sm uppercase tracking-wide text-telecab-muted">${esc(titulo)}</h3>
          <span data-cuenta class="text-xs text-telecab-muted tabular-nums"></span>
          ${puedeAdjuntar ? `
            <label class="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition
                          bg-telecab-card2 border-telecab-border text-telecab-muted hover:border-telecab-gold/50 hover:text-telecab-gold
                          focus-within:ring-2 focus-within:ring-telecab-gold/40">
              <i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>Adjuntar
              <input type="file" multiple class="sr-only" data-input aria-label="Adjuntar ficheros">
            </label>` : ''}
        </div>
        <ul data-lista class="divide-y divide-telecab-border/60"></ul>
        ${puedeAdjuntar ? '<p data-pista class="px-5 py-2 text-[11px] text-telecab-muted border-t border-telecab-border/60">También puedes arrastrar los ficheros aquí.</p>' : ''}
      </div>`;
    const raiz = caja.querySelector('[data-adj]');
    const ul = caja.querySelector('[data-lista]');

    function pintar() {
      const filas = [];
      for (const a of lista) {
        filas.push(`
          <li class="px-5 py-2.5 flex items-center gap-3" data-id="${a.id}">
            <i class="fa-solid ${ICONO[a.clase] || ICONO.otro} text-telecab-muted w-4 text-center" aria-hidden="true"></i>
            <div class="min-w-0 flex-1">
              <button type="button" data-ver class="block max-w-full truncate text-left text-sm font-semibold hover:text-telecab-gold"
                      title="${esc(a.nombre)}">${esc(a.nombre)}</button>
              <span class="block text-[11px] text-telecab-muted tabular-nums">${esc(tamano(a.bytes))}${
                a.creadoPor ? ' · ' + esc(a.creadoPor) : ''}${a.creadoAt ? ' · ' + esc(fecha(a.creadoAt)) : ''}</span>
            </div>
            <a href="${esc(urlDe(a, { descargar: true }))}" download data-bajar class="w-7 h-7 grid place-items-center rounded-lg border border-telecab-border text-telecab-muted hover:border-telecab-gold/50 hover:text-telecab-gold"
               aria-label="Descargar ${esc(a.nombre)}" title="Descargar"><i class="fa-solid fa-download text-xs" aria-hidden="true"></i></a>
            ${puedeQuitar ? `<button type="button" data-quitar class="w-7 h-7 rounded-lg border border-telecab-border text-telecab-muted hover:border-telecab-gold/50 hover:text-telecab-gold"
               aria-label="Quitar ${esc(a.nombre)}" title="Quitar"><i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i></button>` : ''}
          </li>`);
      }
      for (const [id, s] of subiendo) {
        const pct = Math.round((s.progreso || 0) * 100);
        filas.push(`
          <li class="px-5 py-2.5 flex items-center gap-3" data-subida="${id}">
            <i class="fa-solid ${s.error ? 'fa-triangle-exclamation text-telecab-warn' : 'fa-arrow-up text-telecab-gold'} w-4 text-center" aria-hidden="true"></i>
            <div class="min-w-0 flex-1">
              <span class="block truncate text-sm">${esc(s.nombre)}</span>
              ${s.error
                ? `<span class="block text-[11px] text-telecab-warn">${esc(s.error)}</span>`
                : `<span class="block h-1.5 mt-1 rounded-full bg-telecab-card2 overflow-hidden" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Subiendo ${esc(s.nombre)}">
                     <span class="block h-full bg-telecab-gold transition-[width]" style="width:${pct}%"></span></span>`}
            </div>
            <span class="text-[11px] text-telecab-muted tabular-nums">${s.error ? '' : pct + ' %'}</span>
            ${s.error ? `<button type="button" data-cerrar class="w-7 h-7 rounded-lg border border-telecab-border text-telecab-muted hover:text-telecab-gold"
               aria-label="Quitar el aviso de ${esc(s.nombre)}"><i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i></button>` : ''}
          </li>`);
      }
      const vacia = errorCarga
        ? `<li class="px-5 py-4 text-sm text-telecab-warn">No se han podido cargar los adjuntos: ${esc(errorCarga)}</li>`
        : `<li class="px-5 py-4 text-sm text-telecab-muted">${cargado ? 'Sin adjuntos.' : 'Cargando…'}</li>`;
      ul.innerHTML = (errorCarga && filas.length ? vacia : '') + (filas.length ? filas.join('') : vacia);
      caja.querySelector('[data-cuenta]').textContent = lista.length ? `(${lista.length})` : '';
    }

    // EL FOCO NO SE PIERDE al rehacer la lista (16/11/2026). Quitar un adjunto o
    // cerrar el aviso de una subida borraba el botón que lo tenía y el foco caía
    // al <body>: el siguiente Tab empezaba por el menú. Se lleva a la fila que
    // queda en ese sitio (o a la de antes), o a «Adjuntar» si no queda ninguna.
    function enfocarEn(indice) {
      const filas = [...ul.children].filter(li => li.dataset.id || li.dataset.subida);
      const li = filas.length ? filas[Math.min(Math.max(indice, 0), filas.length - 1)] : null;
      const destino = (li && li.querySelector('button, a')) || caja.querySelector('[data-input]');
      if (destino) destino.focus();
    }
    const indiceDe = li => [...ul.children].filter(x => x.dataset.id || x.dataset.subida).indexOf(li);

    async function recargar() {
      try {
        const r = await global.Api.get(`/adjuntos/api/${encodeURIComponent(tipo)}/${encodeURIComponent(dueno)}`);
        lista = r.adjuntos || [];
        if (r.maxMb) maxMb = r.maxMb;
        errorCarga = null;
      } catch (e) {
        errorCarga = e.message;
      }
      cargado = true;
      pintar();
      return lista;
    }

    let primera = null;   // la primera carga: la subida espera a saber el tope

    async function subirVarios(ficheros) {
      // Sin el tope no se sube a ciegas: se espera a la lista y, si no llegó, se
      // vuelve a pedir. Un vídeo de 200 MB elegido mientras cargaba se mandaba
      // entero para que el servidor lo rechazara al final.
      if (primera) await primera;
      if (!maxMb) await recargar();
      for (const f of ficheros) {
        const id = siguiente++;
        if (!maxMb) {
          subiendo.set(id, { nombre: f.name, error: 'No se ha podido saber el tamaño máximo. Recarga la página y vuelve a probar.' });
          pintar();
          continue;
        }
        if (f.size > maxMb * 1048576) {
          subiendo.set(id, { nombre: f.name, error: `Pasa de ${maxMb} MB, que es lo máximo que se puede adjuntar.` });
          pintar();
          continue;
        }
        subiendo.set(id, { nombre: f.name, progreso: 0 });
        pintar();
        try {
          await subir({
            tipo, dueno, fichero: f,
            alProgresar: p => {
              const s = subiendo.get(id);
              if (!s) return;
              s.progreso = p;
              const barra = ul.querySelector(`[data-subida="${id}"] [role="progressbar"]`);
              if (barra) {
                const pct = Math.round(p * 100);
                barra.setAttribute('aria-valuenow', pct);
                barra.firstElementChild.style.width = pct + '%';
                barra.closest('li').lastElementChild.textContent = pct + ' %';
              }
            },
          });
          subiendo.delete(id);
          await recargar();
          if (alCambiar) alCambiar(lista);
        } catch (e) {
          subiendo.set(id, { nombre: f.name, error: e.message });
          pintar();
        }
      }
    }

    async function quitar(a, li) {
      const indice = indiceDe(li);
      const v = await global.Dialogo.formulario(`Quitar · ${a.nombre}`, [
        // `minimo`: lo mismo que pide el servidor. Con menos, la ventana se queda
        // abierta con lo escrito en vez de cerrarse y perderlo.
        { id: 'motivo', etiqueta: 'Por qué se quita', tipo: 'texto-largo', obligatorio: true, max: 500, minimo: 3,
          marcador: 'Ej.: es de otro siniestro; estaba repetido', ayuda: 'Queda en su historia, con tu nombre. El fichero no se borra.' },
      ], { textoBoton: 'Quitar el adjunto' });
      if (!v) { const b = li && li.isConnected && li.querySelector('[data-quitar]'); if (b) b.focus(); return; }
      try {
        await global.Api.post(`/adjuntos/api/${a.id}/anular`, { motivo: v.motivo });
        global.Dialogo.hecho('Adjunto quitado');
        await recargar();
        if (alCambiar) alCambiar(lista);
        enfocarEn(indice);
      } catch (e) {
        if (e.estado === 401) return;   // Api ya lo ha dicho y lleva al login
        await global.Dialogo.aviso({ titulo: 'No se ha quitado', texto: e.message, tono: 'error' });
        const b = li && li.isConnected && li.querySelector('[data-quitar]');
        if (b) b.focus();
      }
    }

    ul.addEventListener('click', e => {
      const li = e.target.closest('li');
      if (!li) return;
      if (e.target.closest('[data-cerrar]')) {
        const indice = indiceDe(li);
        subiendo.delete(Number(li.dataset.subida));
        pintar();
        enfocarEn(indice);
        return;
      }
      const a = lista.find(x => String(x.id) === li.dataset.id);
      if (!a) return;
      if (e.target.closest('[data-ver]')) ver(a);
      else if (e.target.closest('[data-quitar]')) quitar(a, li);
      else if (e.target.closest('[data-bajar]')) { e.preventDefault(); descargar(a); }
    });

    if (puedeAdjuntar) {
      const input = caja.querySelector('[data-input]');
      input.addEventListener('change', () => { const fs = [...input.files]; input.value = ''; subirVarios(fs); });
      // Arrastrar y soltar: el borde dorado dice que se puede soltar ahí.
      let dentro = 0;
      raiz.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dentro++; raiz.classList.add('ring-2', 'ring-telecab-gold/50'); } });
      raiz.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
      raiz.addEventListener('dragleave', () => { if (--dentro <= 0) { dentro = 0; raiz.classList.remove('ring-2', 'ring-telecab-gold/50'); } });
      raiz.addEventListener('drop', e => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        dentro = 0;
        raiz.classList.remove('ring-2', 'ring-telecab-gold/50');
        subirVarios([...e.dataTransfer.files]);
      });
    }

    pintar();
    primera = recargar();
    return { recargar, lista: () => lista };
  }

  global.Adjuntos = { montar, subir, ver, tamano, url: urlDe };
})(window);
