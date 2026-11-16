// ============================================================
// CONTADORES — los números del menú y de la barra (A9)
// ============================================================
// Lo carga layout-gestion en todas las pantallas. Pide TODOS los números de
// una vez (GET /contadores/api) y los pinta donde haya una marca:
//
//   <span class="tc-contador" data-contador="pendientes" hidden></span>
//
//   · Con 0 se esconde; con más de 99 dice «99+». `tono: 'info'` (azul) o el
//     de siempre (rojo). El título, el que mande el servidor.
//   · CADA GRUPO DEL MENÚ suma los de sus entradas, en su marca
//     `data-contador-grupo`: con el grupo cerrado, o el menú plegado, se ve
//     que dentro hay algo.
//   · Contadores.alCambiar(fn) para quien pinta los suyos a su manera (los
//     cuadros de tickets de la barra). Contadores.valor(clave) → { n, tono, titulo }.
//   · Contadores.refrescar() tras hacer algo que cambia un número.
//
// SE REFRESCAN en cuanto el servidor avisa de un cambio (canal «contadores»
// del tiempo real, A7) y, por si no avisa, cada 2 minutos con la pestaña a la
// vista y al volver a ella.
(function (global) {
  'use strict';

  let valores = {};
  const avisos = new Set();
  let enCurso = null;
  let tPronto = null;

  const texto = n => (n > 99 ? '99+' : String(n));

  function pintarMarca(el, v, { tono } = {}) {
    const n = v ? v.n : 0;
    el.hidden = !(n > 0);
    if (!(n > 0)) return;
    el.textContent = texto(n);
    el.classList.toggle('tc-contador--info', (tono || (v && v.tono)) === 'info');
    if (v && v.titulo) el.title = v.titulo; else el.removeAttribute('title');
  }

  function pintar() {
    document.querySelectorAll('[data-contador]').forEach(el => pintarMarca(el, valores[el.getAttribute('data-contador')]));
    // La suma de cada grupo: rojo si alguno de dentro lo es; si no, azul.
    document.querySelectorAll('.nav-grupo').forEach(g => {
      const marca = g.querySelector('[data-contador-grupo]');
      if (!marca) return;
      let n = 0, aviso = false;
      g.querySelectorAll('.grupo-items [data-contador]').forEach(el => {
        const v = valores[el.getAttribute('data-contador')];
        if (!v || !(v.n > 0)) return;
        n += v.n;
        if (v.tono !== 'info') aviso = true;
      });
      pintarMarca(marca, { n, titulo: n ? `${n} por mirar dentro` : '' }, { tono: aviso ? 'aviso' : 'info' });
    });
    for (const f of [...avisos]) { try { f(valores); } catch (e) { console.error(e); } }
  }

  /** Vuelve a pedirlos. Si ya hay una petición en marcha, espera a esa. */
  function refrescar() {
    if (enCurso) return enCurso;
    enCurso = (async () => {
      try {
        const r = await global.fetch('/contadores/api', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!r.ok) return;
        const j = await r.json();
        if (j.status !== 'ok') return;
        valores = j.contadores || {};
        pintar();
      } catch (_) { /* sin red: se quedan los de antes */ }
      finally { enCurso = null; }
    })();
    return enCurso;
  }

  // Tras un aviso del servidor, con un poco de margen distinto en cada
  // pestaña: si hay veinte abiertas, no piden todas en el mismo milisegundo.
  function refrescarPronto() {
    clearTimeout(tPronto);
    tPronto = setTimeout(refrescar, 300 + Math.floor(Math.random() * 1200));
  }

  global.Contadores = {
    refrescar,
    valor: clave => valores[clave] || null,
    alCambiar(fn) { avisos.add(fn); if (Object.keys(valores).length) fn(valores); return () => avisos.delete(fn); },
  };

  // Arranque: un poco después de cargar (que no compita con la pantalla).
  global.setTimeout(refrescar, 800);
  global.setInterval(() => { if (!document.hidden) refrescar(); }, 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescarPronto(); });
  if (global.TiempoReal) {
    global.TiempoReal.escuchar('contadores', { alLlegar: refrescarPronto, sondear: refrescarPronto, cada: 10 * 60 * 1000 });
  }
})(window);
