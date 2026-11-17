// ============================================================
// TIEMPO REAL — el componente de la casa para enterarse al momento (A7)
// ============================================================
// Lo carga layout-gestion en todas las pantallas; no hace nada hasta que una
// llama a `escuchar`. Una sola conexión por pestaña para todos los canales.
//
//   const oido = TiempoReal.escuchar('tickets', {
//     alLlegar: (datos, aviso) => recargar(),   // cada aviso del canal
//     sondear: recargar,                         // cómo ponerse al día sin tiempo real
//     cada: 30000,                               // y cada cuánto, si no lo hay
//     alConectar: recargar,                      // opcional: al conectar la primera vez
//   });
//   oido.dejar();
//
//   TiempoReal.estado()        'directo' | 'conectando' | 'sondeo' | 'parado'
//   TiempoReal.alCambiar(fn)   avisa al cambiar de estado (→ función para dejar de avisar)
//
// CÓMO SE PORTA:
//   · En directo, los avisos llegan en cuanto el servidor los publica.
//   · Si se corta, el navegador vuelve solo (3-7 s) y el servidor le manda lo
//     que se perdió. Si ya no lo tiene (más de 10 minutos fuera, o el servidor
//     se reinició), manda «reinicio» y aquí se llama a `sondear` una vez.
//   · Si no vuelve en 30 s, o el servidor no lo deja, se pasa a SONDEO: cada
//     `cada` ms se llama a `sondear` (con la pestaña oculta, no), y cada minuto
//     se reintenta el directo.
//   · Si la sesión caducó, lleva al login como cualquier petición de Api.
//
// EN LOCAL (http://…localhost, HTTP/1.1) VA POR SONDEO: el navegador solo abre
// seis conexiones por servidor, y seis pestañas con el tiempo real abierto
// dejarían sin sitio al resto de peticiones. En producción, detrás de
// Cloudflare, es HTTP/2 y no hay ese límite. `TiempoReal.forzarDirecto()` lo
// abre igual (el banco de pruebas, en una pestaña).
(function (global) {
  'use strict';

  const RUTA = '/tiempo-real/eventos';
  const CAIDO_MS = 30000;      // sin volver en este tiempo, se sondea mientras
  const REINTENTO_MS = 60000;  // desde el sondeo, cada cuánto se prueba el directo

  const oyentes = new Set();
  const avisos = new Set();
  let estado = 'parado';
  let fuente = null;
  let conectados = '';
  let ultimoId = null;
  let forzado = false;
  let haConectado = false;
  let tConectar = null;
  let tCaido = null;
  let tReintento = null;

  // ── El estado ───────────────────────────────────────────────────────────
  function ponerEstado(nuevo) {
    if (nuevo === estado) return;
    const antes = estado;
    estado = nuevo;
    if (nuevo === 'sondeo') arrancarSondeos(antes === 'directo' || antes === 'conectando');
    else pararSondeos();
    for (const f of [...avisos]) { try { f(nuevo, antes); } catch (e) { console.error(e); } }
  }

  // ── El sondeo: lo de siempre, para cuando no hay directo ────────────────
  function sondearUno(o) {
    if (!o.sondear) return;
    try { const r = o.sondear(); if (r && r.catch) r.catch(() => {}); } catch (e) { console.error(e); }
  }
  function arrancarUno(o) {
    if (!o.sondear || o.temporizador) return;
    o.temporizador = setInterval(() => { if (!document.hidden) sondearUno(o); }, Math.max(Number(o.cada) || 30000, 2000));
  }
  function arrancarSondeos(ponerseAlDia) {
    for (const o of oyentes) {
      arrancarUno(o);
      // Si venía del directo, lo de los últimos segundos puede haberse perdido.
      if (ponerseAlDia) sondearUno(o);
    }
  }
  function pararSondeos() {
    for (const o of oyentes) if (o.temporizador) { clearInterval(o.temporizador); o.temporizador = null; }
  }
  document.addEventListener('visibilitychange', () => {
    // Al volver a la pestaña en sondeo, se pone al día sin esperar a la vuelta.
    if (!document.hidden && estado === 'sondeo') for (const o of oyentes) sondearUno(o);
  });

  // ── El directo ──────────────────────────────────────────────────────────
  const http1 = () => {
    try {
      const n = global.performance.getEntriesByType('navigation')[0];
      return !!n && n.nextHopProtocol === 'http/1.1';
    } catch (_) { return false; }
  };
  const puedeDirecto = () => typeof global.EventSource === 'function' && (forzado || !http1());
  const canalesOidos = () => [...new Set([...oyentes].map(o => o.canal))].sort().join(',');

  function cerrarFuente() {
    if (fuente) { fuente.close(); fuente = null; }
    conectados = '';
    clearTimeout(tCaido);
  }

  /** Comprueba la sesión: con un 401, Api avisa y lleva al login. */
  function comprobarSesion() {
    if (global.Api && global.Api.get) global.Api.get('/tiempo-real/api/estado').catch(() => {});
  }

  function aSondeo() {
    cerrarFuente();
    ponerEstado('sondeo');
    clearTimeout(tReintento);
    tReintento = setTimeout(conectar, REINTENTO_MS);
  }

  function conectar() {
    clearTimeout(tConectar);
    clearTimeout(tReintento);
    const canales = canalesOidos();
    if (!canales) { cerrarFuente(); ponerEstado('parado'); return; }
    if (!puedeDirecto()) { cerrarFuente(); ponerEstado('sondeo'); return; }
    if (fuente && fuente.readyState !== 2 && canales === conectados) return;

    cerrarFuente();
    conectados = canales;
    // Una conexión nueva no manda sola el último id: va en `desde`, y el
    // servidor manda lo que haya pasado entre una y otra.
    const url = `${RUTA}?canales=${encodeURIComponent(canales)}${ultimoId ? '&desde=' + encodeURIComponent(ultimoId) : ''}`;
    // Desde el sondeo se sigue sondeando hasta que el directo conteste.
    if (estado !== 'sondeo') ponerEstado('conectando');
    const es = new global.EventSource(url);
    fuente = es;

    es.addEventListener('suscrito', e => {
      if (fuente !== es) return;
      clearTimeout(tCaido);
      // Lleva el id del último aviso del servidor: desde aquí se retoma.
      if (e.lastEventId) ultimoId = e.lastEventId;
      let d = {};
      try { d = JSON.parse(e.data); } catch (_) { /* sin datos */ }
      if (d.rechazados && d.rechazados.length) console.warn('[TiempoReal] sin permiso o sin canal:', d.rechazados.join(', '));
      ponerEstado('directo');
      if (!haConectado) {
        haConectado = true;
        for (const o of [...oyentes]) if (o.alConectar) { try { o.alConectar(); } catch (err) { console.error(err); } }
      }
    });

    es.onmessage = e => {
      if (fuente !== es) return;
      if (e.lastEventId) ultimoId = e.lastEventId;
      let m;
      try { m = JSON.parse(e.data); } catch (_) { return; }
      for (const o of [...oyentes]) {
        if (o.canal !== m.c || !o.alLlegar) continue;
        try { o.alLlegar(m.d, { canal: m.c, id: e.lastEventId }); } catch (err) { console.error(err); }
      }
    };

    // Lo perdido ya no está en el servidor: cada pantalla se pone al día entera.
    es.addEventListener('reinicio', () => {
      if (fuente !== es) return;
      for (const o of [...oyentes]) sondearUno(o);
    });

    es.addEventListener('fin', e => {
      if (fuente !== es) return;
      let motivo = '';
      try { motivo = JSON.parse(e.data).motivo; } catch (_) { /* sin motivo */ }
      if (motivo === 'sesion') { cerrarFuente(); ponerEstado('parado'); comprobarSesion(); return; }
      // Demasiadas pestañas, ningún canal o el servidor lleno: por sondeo.
      if (motivo === 'demasiadas' || motivo === 'sin-canales' || motivo === 'lleno') { aSondeo(); return; }
      // Lo demás (lento, apagado): el navegador vuelve solo, con el último id.
    });

    es.onerror = () => {
      if (fuente !== es) return;
      if (es.readyState === 2) {
        // Cerrada del todo: el servidor contestó con un error (401, 403, 500…).
        comprobarSesion();
        aSondeo();
        return;
      }
      // Volviendo sola. Si tarda, se sondea mientras.
      if (estado === 'directo') ponerEstado('conectando');
      clearTimeout(tCaido);
      tCaido = setTimeout(() => { if (fuente === es && es.readyState !== 1) ponerEstado('sondeo'); }, CAIDO_MS);
    };
  }

  // Varias llamadas a `escuchar` seguidas (una pantalla con tres canales) abren UNA conexión.
  const conectarPronto = () => { clearTimeout(tConectar); tConectar = setTimeout(conectar, 0); };

  // ── Lo que usan las pantallas ───────────────────────────────────────────
  function escuchar(canal, { alLlegar, sondear, cada = 30000, alConectar } = {}) {
    const o = { canal: String(canal), alLlegar, sondear, cada, alConectar, temporizador: null };
    oyentes.add(o);
    if (estado === 'sondeo') arrancarUno(o);
    conectarPronto();
    return {
      dejar() {
        if (!oyentes.delete(o)) return;
        if (o.temporizador) { clearInterval(o.temporizador); o.temporizador = null; }
        // Sin nadie que oiga, se cierra; con menos canales, la misma conexión vale.
        if (!oyentes.size) { cerrarFuente(); ponerEstado('parado'); }
      },
    };
  }

  function alCambiar(fn) {
    avisos.add(fn);
    return () => avisos.delete(fn);
  }

  global.TiempoReal = {
    escuchar,
    alCambiar,
    estado: () => estado,
    ultimoId: () => ultimoId,
    /** Abre el directo aunque sea HTTP/1.1 (el banco de pruebas, en local). */
    forzarDirecto() { forzado = true; conectarPronto(); },
    /** Corta sin volver (el banco: para probar que al volver llega lo perdido). */
    cortar() { cerrarFuente(); clearTimeout(tReintento); ponerEstado('parado'); },
    /** Vuelve a conectar, pidiendo lo perdido desde el último aviso. */
    reconectar() { cerrarFuente(); conectar(); },
  };
})(window);
