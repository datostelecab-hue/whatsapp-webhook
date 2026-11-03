// ============================================================
// API — la forma de la casa de hablar con el servidor
// ============================================================
// Cada pantalla tenía su propio envoltorio de fetch (había veinte) y cada uno
// trataba los errores a su manera: unos se tragaban el fallo, otros reventaban
// con «Unexpected token <» cuando la sesión caducaba, otros se quedaban en
// «Guardando…» para siempre. Esto es uno solo, con la misma cara para todos.
//
//   const d = await Api.get('/plantilla/api/lista');
//   const r = await Api.post('/nominas/congelar', { mes, ano }, { boton: b });
//   const r = await Api.pedir(url, { metodo: 'DELETE', boton, bloquea, aviso });
//
// Lo que hace siempre:
//   · Pide JSON (Accept) y, si hay `datos`, los manda como JSON.
//   · Sin conexión, sesión caducada, un 4xx/5xx o `status: 'error'` → lanza un
//     Api.Error con un mensaje que se puede enseñar tal cual (`e.message`), el
//     código HTTP (`e.estado`) y la respuesta (`e.respuesta`).
//   · Sesión caducada (401): lo dice y lleva a /login, que devuelve aquí.
//
// Lo que se le puede pedir:
//   · `boton`: se desactiva mientras dura la petición y vuelve como estaba. Es
//     la protección contra el doble clic, que hasta ahora dependía del velo.
//   · `bloquea: true`: tapa la pantalla con la marca mientras dura (el overlay
//     del layout), para lo que no se puede tocar a medias.
//   · `aviso: 'No se pudo congelar'`: si falla, lo dice con el Dialogo (ese es
//     el título) y devuelve null en vez de lanzar. Para no escribir un try/catch
//     en cada botón: `const r = await Api.post(…, { aviso }); if (!r) return;`
//
// Y además, en todas las pantallas: un error de JavaScript que nadie captura se
// manda al servidor (/cliente-error) y sale en el log. Antes una pantalla podía
// quedarse muerta sin dejar un solo rastro.

(function (global) {
  'use strict';

  class ApiError extends Error {
    constructor(mensaje, { estado = 0, respuesta = null } = {}) {
      super(mensaje);
      this.name = 'ApiError';
      this.estado = estado;
      this.respuesta = respuesta;
    }
  }

  // Una sola vez por página: si caducó, caducó para todas las peticiones.
  let yendoAlLogin = false;
  async function irAlLogin() {
    if (yendoAlLogin) return;
    yendoAlLogin = true;
    try {
      if (global.Dialogo) {
        await global.Dialogo.aviso({
          titulo: 'Hay que volver a entrar', tono: 'aviso', boton: 'Entrar',
          texto: 'La sesión ha caducado. Al entrar vuelves a esta misma pantalla; lo que no se hubiera guardado hay que repetirlo.',
        });
      }
    } catch (_) { /* sin diálogo, se va igual */ }
    global.location.href = '/login?next=' + encodeURIComponent(global.location.pathname + global.location.search + global.location.hash);
  }

  async function pedir(url, { metodo, datos, boton, bloquea, aviso } = {}) {
    const m = String(metodo || (datos !== undefined ? 'POST' : 'GET')).toUpperCase();
    const opciones = { method: m, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (datos !== undefined) {
      opciones.headers['Content-Type'] = 'application/json';
      opciones.body = JSON.stringify(datos);
    }
    const estabaApagado = boton ? boton.disabled : false;
    if (boton) boton.disabled = true;
    const carga = bloquea ? global.telecabCarga : null;
    if (carga) carga.abrir();
    try {
      let r;
      try { r = await global.fetch(url, opciones); }
      catch (_) { throw new ApiError('No hay conexión con el servidor. Comprueba la red y vuelve a intentarlo.'); }

      // 401: la sesión caducó. (Un servidor anterior al 03/11/2026 redirigía al
      // login incluso a un fetch: se reconoce igual.)
      const alLogin = r.redirected && /^\/login\b/.test(new URL(r.url, global.location.href).pathname);
      if (r.status === 401 || alLogin) {
        irAlLogin();
        throw new ApiError('La sesión ha caducado: hay que volver a entrar.', { estado: 401 });
      }

      let j = null;
      if ((r.headers.get('content-type') || '').includes('application/json')) {
        try { j = await r.json(); } catch (_) { /* JSON roto: abajo */ }
      }
      if (!r.ok || j === null || (j && j.status === 'error')) {
        const msg = (j && (j.msg || j.error))
          || (r.ok ? 'El servidor contestó algo que no se esperaba.' : `El servidor contestó con un error (HTTP ${r.status}).`);
        throw new ApiError(String(msg), { estado: r.status, respuesta: j });
      }
      return j;
    } catch (e) {
      if (!aviso) throw e;
      if (e.estado !== 401 && global.Dialogo) {
        await global.Dialogo.aviso({ titulo: aviso, texto: e.message, tono: 'error' });
      }
      return null;
    } finally {
      if (boton) boton.disabled = estabaApagado;
      if (carga) carga.cerrar();
    }
  }

  const get = (url, opciones) => pedir(url, { ...(opciones || {}), metodo: 'GET' });
  const post = (url, datos, opciones) => pedir(url, { ...(opciones || {}), metodo: 'POST', datos: datos === undefined ? {} : datos });

  // ── Los errores que nadie captura, al servidor ──────────────────────────
  //
  // Como mucho cinco por página y sin repetir el mismo: un error dentro de un
  // bucle no puede inundar el log. Solo los de aquí (los de una extensión del
  // navegador no son nuestros). Por sendBeacon: no pasa por fetch, no tapa la
  // pantalla y llega aunque la página se esté cerrando.
  let enviados = 0;
  const vistos = new Set();
  function informar(d) {
    if (enviados >= 5 || !global.navigator || !global.navigator.sendBeacon) return;
    const clave = (d.mensaje || '') + '|' + (d.fuente || '') + ':' + (d.linea || '');
    if (vistos.has(clave)) return;
    vistos.add(clave);
    enviados++;
    try {
      const cuerpo = JSON.stringify({ ruta: global.location.pathname + global.location.search, ...d });
      global.navigator.sendBeacon('/cliente-error', new Blob([cuerpo], { type: 'application/json' }));
    } catch (_) { /* informar de un error no puede dar otro */ }
  }
  global.addEventListener('error', e => {
    const fuente = String(e.filename || '');
    if (!fuente.startsWith(global.location.origin)) return;
    informar({
      mensaje: String(e.message || ''), fuente: fuente.slice(global.location.origin.length),
      linea: e.lineno, columna: e.colno, pila: e.error && e.error.stack ? String(e.error.stack) : '',
    });
  });
  global.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    // La sesión caducada ya se ha dicho (y se va al login): no es un fallo.
    if (r && r.name === 'ApiError' && r.estado === 401) return;
    informar({
      mensaje: 'Promesa sin capturar: ' + String((r && r.message) || r),
      pila: r && r.stack ? String(r.stack) : '',
    });
  });

  global.Api = { pedir, get, post, Error: ApiError };
})(window);
