// ============================================================
// PORTAL — LO DE TODAS LAS PÁGINAS (24/11/2026)
// ============================================================
// Las heurísticas de usabilidad de Nielsen aplicadas a la app de los
// conductores (Camilo: «muchos pasan de los 30 - 40 años y no saben mucho de
// sistemas de software»). Aquí lo que vale para todas las páginas:
//
//   · EL TOQUE EN IPHONE (antes toque.js): Safari no aplica :active si la
//     página no escucha ningún toque. Un escuchador vacío y pasivo basta.
//   · QUE SE VEA QUE ESTÁ HACIENDO ALGO (heurística 1) y QUE NO SE PULSE DOS
//     VECES (5): al enviar un formulario, su botón se apaga y dice «Un
//     momento…» (o lo que diga su data-enviando). Las cinco fotos no: tienen
//     su propio aviso (portal/coche.js).
//   · PREGUNTAR ANTES DE LO QUE CUESTA DESHACER (3 y 5): un formulario con
//     data-confirmar pregunta eso antes de enviarse («¿Salir del portal?»).
//   · SIN COBERTURA, DECIRLO (1 y 9): un aviso arriba mientras no hay red.
//   · RECORDAR EL DNI EN ESTE MÓVIL (6 y 7): el campo con data-recordar se
//     rellena con el último DNI que se usó aquí. Si el navegador no deja
//     guardarlo, no pasa nada.
'use strict';
(function () {
  document.addEventListener('touchstart', function () {}, { passive: true });

  // ── Enviar: preguntar si hace falta, y luego «Un momento…» ────────────────
  document.addEventListener('submit', ev => {
    const form = ev.target;
    if (!(form instanceof HTMLFormElement) || form.hasAttribute('data-fotos-form')) return;
    const pregunta = form.getAttribute('data-confirmar');
    if (pregunta && !window.confirm(pregunta)) { ev.preventDefault(); return; }
    if (ev.defaultPrevented) return;
    // Después de que el navegador recoja el formulario, para que el botón pulsado viaje igual.
    setTimeout(() => {
      form.querySelectorAll('button[type=submit], button:not([type])').forEach(b => {
        if (b.disabled) return;
        b.dataset.textoAntes = b.innerHTML;
        b.disabled = true;
        b.classList.add('cargando');
        b.setAttribute('aria-busy', 'true');
        const t = b.getAttribute('data-enviando') || 'Un momento…';
        b.innerHTML = `<span class="girando" aria-hidden="true"></span>${t}`;
      });
    }, 0);
  });
  // Al volver atrás con el botón del móvil, la página puede salir de la caché con
  // los botones apagados: se encienden otra vez.
  window.addEventListener('pageshow', () => {
    document.querySelectorAll('button.cargando').forEach(b => {
      b.disabled = false;
      b.classList.remove('cargando');
      b.removeAttribute('aria-busy');
      if (b.dataset.textoAntes) b.innerHTML = b.dataset.textoAntes;
    });
  });

  // ── Sin cobertura ─────────────────────────────────────────────────────────
  const sinRed = document.querySelector('[data-sin-red]');
  const pintarRed = () => { if (sinRed) sinRed.hidden = navigator.onLine !== false; };
  window.addEventListener('online', pintarRed);
  window.addEventListener('offline', pintarRed);
  pintarRed();

  // ── El DNI de este móvil ──────────────────────────────────────────────────
  const dni = document.querySelector('input[data-recordar]');
  if (dni) {
    const CLAVE = 'tc_portal_dni';
    try { if (!dni.value) dni.value = localStorage.getItem(CLAVE) || ''; } catch (e) { /* sin almacenamiento */ }
    dni.form && dni.form.addEventListener('submit', () => {
      try { localStorage.setItem(CLAVE, dni.value.trim().toUpperCase()); } catch (e) { /* sin almacenamiento */ }
    });
  }
})();
