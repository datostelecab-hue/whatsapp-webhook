// ============================================================
// DIÁLOGOS — avisar, confirmar y elegir, con la cara del sistema
// ============================================================
// Sustituye a `alert()` y `confirm()`, que son los del navegador: salen con el
// dominio arriba ("serverdeprueba-q2wq.onrender.com dice"), no se pueden
// maquetar y no distinguen un aviso de un error de una pregunta.
//
//   await Dialogo.aviso({ titulo, texto, tono })                  → nada
//   await Dialogo.confirmar({ titulo, texto, si, no, tono })      → true / false
//   await Dialogo.elegir({ titulo, texto, opciones })             → el valor elegido, o null
//
// Los tres devuelven una promesa. Es la diferencia importante con `confirm()`,
// que bloquea el navegador entero: aquí se espera con `await`.
//
// `window.alert` se sustituye por el de aquí al cargar. `confirm` NO: devuelve
// un booleano de forma síncrona y ninguna ventana bonita puede hacer eso, así
// que cada llamada hay que convertirla a mano.

(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Cada tono trae su color y su icono. Es lo que hace que un error no se lea
  // igual que una confirmación.
  const TONOS = {
    info:     { color: 'gold',  icono: 'fa-circle-info' },
    ok:       { color: 'green', icono: 'fa-circle-check' },
    aviso:    { color: 'warn',  icono: 'fa-triangle-exclamation' },
    error:    { color: 'red',   icono: 'fa-circle-exclamation' },
    pregunta: { color: 'gold',  icono: 'fa-circle-question' },
    peligro:  { color: 'red',   icono: 'fa-triangle-exclamation' },
  };

  let abierto = null;   // solo uno a la vez: dos ventanas encima no se leen

  /**
   * El diálogo de verdad. Todo lo demás son atajos sobre esto.
   *
   * `opciones` = [{ texto, valor, tono, principal }]. La última es la que se
   * dispara con Enter; Escape y el fondo devuelven `valorAlCerrar`.
   */
  function abrir({ titulo, texto, html, tono = 'info', opciones = [], valorAlCerrar = null, ancho = 'max-w-md' }) {
    if (abierto) { abierto.cerrar(null); }

    return new Promise(resolver => {
      const t = TONOS[tono] || TONOS.info;
      const fondo = document.createElement('div');
      fondo.className = 'dialogo fixed inset-0 z-[120] flex items-center justify-center p-4 ' +
                        'bg-black/60 backdrop-blur-sm';
      fondo.innerHTML = `
        <div class="dialogo-caja bg-telecab-card border border-telecab-border rounded-2xl shadow-soft
                    w-full ${ancho}" role="alertdialog" aria-modal="true">
          <div class="p-5 flex gap-4">
            <span class="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center
                         bg-telecab-${t.color}/15 text-telecab-${t.color}">
              <i class="fa-solid ${t.icono}"></i>
            </span>
            <div class="min-w-0 flex-1">
              ${titulo ? `<h3 class="font-bold text-base leading-snug">${esc(titulo)}</h3>` : ''}
              <div class="text-sm text-telecab-text/85 mt-1 space-y-2">${html || esc(texto || '').replace(/\n/g, '<br>')}</div>
            </div>
          </div>
          <div class="px-5 pb-5 flex flex-wrap items-center justify-end gap-2" data-botones></div>
        </div>`;

      const caja = fondo.querySelector('.dialogo-caja');
      const barra = fondo.querySelector('[data-botones]');

      const cerrar = valor => {
        if (abierto !== ficha) return;
        abierto = null;
        document.removeEventListener('keydown', alTeclado);
        fondo.classList.add('dialogo-saliendo');
        // Se espera a la animación para que no desaparezca de golpe.
        setTimeout(() => fondo.remove(), 120);
        resolver(valor);
      };
      const ficha = { cerrar };
      abierto = ficha;

      opciones.forEach((o, i) => {
        const ultimo = i === opciones.length - 1;
        const tn = TONOS[o.tono] || null;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'px-4 py-2 rounded-xl text-sm font-semibold transition ' + (
          o.principal
            ? (tn && tn.color !== 'gold'
                ? `bg-telecab-${tn.color}/10 text-telecab-${tn.color} border border-telecab-${tn.color}/40 hover:bg-telecab-${tn.color}/20`
                : 'bg-telecab-gold text-telecab-dark hover:bg-telecab-gold-soft shadow-gold')
            : 'bg-telecab-card2 border border-telecab-border text-telecab-text hover:border-telecab-gold/40');
        b.textContent = o.texto;
        b.addEventListener('click', () => cerrar(o.valor));
        if (o.principal || (ultimo && !opciones.some(x => x.principal))) b.dataset.principal = '1';
        barra.appendChild(b);
      });

      const alTeclado = e => {
        if (e.key === 'Escape') { e.preventDefault(); cerrar(valorAlCerrar); }
        if (e.key === 'Enter' && !e.shiftKey) {
          const p = barra.querySelector('[data-principal]');
          if (p) { e.preventDefault(); p.click(); }
        }
      };
      document.addEventListener('keydown', alTeclado);
      // Pinchar fuera cierra, pero no si se pincha dentro de la caja.
      fondo.addEventListener('mousedown', e => { if (e.target === fondo) cerrar(valorAlCerrar); });

      document.body.appendChild(fondo);
      const p = barra.querySelector('[data-principal]') || barra.querySelector('button');
      if (p) p.focus();
    });
  }

  /** Un aviso: solo informa. Sustituye a `alert()`. */
  const aviso = o => {
    const c = typeof o === 'string' ? { texto: o } : (o || {});
    return abrir({
      tono: 'info', ...c,
      opciones: [{ texto: c.boton || 'Entendido', valor: true, principal: true }],
      valorAlCerrar: true,
    });
  };

  /** Una pregunta de sí o no. Sustituye a `confirm()`, pero con `await`. */
  const confirmar = o => {
    const c = typeof o === 'string' ? { texto: o } : (o || {});
    return abrir({
      tono: 'pregunta', ...c,
      opciones: [
        { texto: c.no || 'Cancelar', valor: false },
        { texto: c.si || 'Aceptar', valor: true, principal: true, tono: c.tono },
      ],
      valorAlCerrar: false,
    });
  };

  /** Varias salidas, no solo sí o no. Devuelve el valor elegido, o null. */
  const elegir = o => abrir({ tono: 'pregunta', valorAlCerrar: null, ...(o || {}) });

  global.Dialogo = { abrir, aviso, confirmar, elegir, TONOS };

  // `alert` se sustituye de una vez para TODAS las pantallas: no devuelve nada,
  // así que ningún código que lo llame se entera del cambio. Con `confirm` no
  // se puede hacer lo mismo — devuelve un booleano al instante y eso una
  // ventana con animación no lo puede fingir.
  const alertNativo = global.alert.bind(global);
  global.alert = mensaje => {
    try {
      const t = String(mensaje == null ? '' : mensaje);
      // Un mensaje que ya empieza con ❌ o ⚠️ trae su tono puesto.
      const tono = /^\s*(❌|✖|Error)/i.test(t) ? 'error'
                 : /^\s*(⚠️|⚠)/.test(t) ? 'aviso'
                 : /^\s*(✅|✔)/.test(t) ? 'ok' : 'info';
      const limpio = t.replace(/^\s*(❌|✖|⚠️|⚠|✅|✔)\s*/, '');
      // La primera línea hace de título si el mensaje tiene varias.
      const lineas = limpio.split('\n');
      const titulo = lineas.length > 1 && lineas[0].length < 80 ? lineas[0] : '';
      aviso({ titulo, texto: titulo ? lineas.slice(1).join('\n').trim() : limpio, tono });
    } catch (e) {
      alertNativo(mensaje);   // si algo falla, mejor el feo que ninguno
    }
  };
})(window);
