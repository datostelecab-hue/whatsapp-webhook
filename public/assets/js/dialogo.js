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


  // ── Formulario en una ventana ───────────────────────────────────────────
  //
  // Estaba escrito dentro de la pantalla de Plantilla. En cuanto una segunda
  // pantalla necesito lo mismo quedaba claro que no era suyo: pedir unos datos
  // y devolverlos es de aqui.
  //
  // `campos` = [{ id, etiqueta, tipo: 'texto'|'fecha'|'lista'|'semana'|'texto-largo',
  //               opciones, valor, ayuda, grupo, obligatorio, marcador }]
  // Devuelve los valores, o null si se cancela.

  const DIAS = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'];

  /** dd/mm/aaaa → aaaa-mm-dd, que es lo que entiende la base. */
  const aISO = v => {
    const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : (v || null);
  };

  /**
   * Ventana pequeña para pedir unos datos. Se usa para todas las acciones de la
   * ficha en vez de repetir el mismo modal seis veces.
   *
   * `campos` = [{ id, etiqueta, tipo: 'texto'|'fecha'|'lista'|'semana', opciones, valor, ayuda }]
   * Devuelve los valores, o null si se cancela.
   */
  function formulario(titulo, campos, { textoBoton = 'Guardar', nota, ancho = 'max-w-md', columnas = 1 } = {}) {
    return new Promise(resolver => {
      const fondo = document.createElement('div');
      fondo.className = 'fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/60 backdrop-blur-sm';
      fondo.innerHTML = `
        <div class="bg-telecab-card border border-telecab-border rounded-2xl shadow-soft w-full ${ancho} my-8">
          <div class="px-5 py-4 border-b border-telecab-border">
            <h3 class="font-bold">${esc(titulo)}</h3>
            ${nota ? `<p class="text-xs text-telecab-muted mt-1">${esc(nota)}</p>` : ''}
          </div>
          <form class="p-5 max-h-[70vh] overflow-y-auto grid gap-x-4 gap-y-3 ${
            columnas === 2 ? 'sm:grid-cols-2' : 'grid-cols-1'}">
            ${campos.map((c, i) => {
              // Cabecera de grupo cuando cambia: con treinta campos seguidos no
              // se distingue la dirección de la Seguridad Social.
              const cabecera = c.grupo && (i === 0 || campos[i - 1].grupo !== c.grupo)
                ? `<p class="col-span-full text-[11px] uppercase tracking-wider font-semibold
                             text-telecab-gold border-b border-telecab-border pb-1 pt-2">${esc(c.grupo)}</p>`
                : '';
              const base = 'w-full px-3 py-2 bg-telecab-card2 border border-telecab-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-telecab-gold/40';
              let campo;
              if (c.tipo === 'lista') {
                const ops = (c.opciones || []).map(o => (typeof o === 'string' ? { valor: o, texto: o } : o));
                // Se deja elegir "sin dato": obligar a un valor inventaría uno.
                const vacio = c.obligatorio ? '' : '<option value=""></option>';
                campo = `<select id="pd-${c.id}" class="${base}">${vacio}${ops.map(o =>
                  `<option value="${esc(o.valor)}" ${String(o.valor) === String(c.valor || '') ? 'selected' : ''}>${esc(o.texto)}</option>`).join('')}</select>`;
              } else if (c.tipo === 'opciones') {
                // UN SELECTOR CON LA CARA DE LA CASA, no el desplegable del
                // navegador. El <select> nativo se pinta con los colores del
                // sistema operativo —fondo blanco, azul de Windows— y en una
                // pantalla oscura canta: parece de otra aplicación.
                //
                // Y admite DOS NIVELES: `grupos` pinta primero el tipo (Taller,
                // RRHH, Tráfico…) y debajo solo sus casos. Con treinta casos en
                // una lista plana hay que leerlos todos; agrupados se elige por
                // dónde viene el problema, que es como se piensa al llamar.
                const grupos = c.grupos || [{ codigo: '', etiqueta: '', opciones: c.opciones || [] }];
                const solo = grupos.length === 1 && !grupos[0].etiqueta;
                campo = `<div id="pd-${c.id}" data-opciones>
                  ${solo ? '' : `<div class="flex flex-wrap gap-1.5 mb-2" data-grupos>${grupos.map((g, i) =>
                    `<button type="button" data-g="${esc(g.codigo)}"
                       class="px-2.5 py-1 rounded-lg text-xs font-semibold border transition
                         ${i === 0 ? 'bg-telecab-gold text-telecab-dark border-telecab-gold'
                                   : 'bg-telecab-card2 border-telecab-border text-telecab-muted hover:border-telecab-gold/50'}">
                       ${g.icono ? `<i class="fa-solid ${esc(g.icono)} mr-1"></i>` : ''}${esc(g.etiqueta)}</button>`).join('')}</div>`}
                  <div class="grid gap-1 max-h-56 overflow-y-auto" data-casos></div>
                  <p class="hidden text-[11px] text-telecab-muted mt-1" data-vacio></p>
                </div>`;
              } else if (c.tipo === 'items') {
                // UNA LISTA DE COSAS QUE SE MARCAN Y SE COMENTAN, una a una. En
                // una sola llamada se pregunta por TODO lo que tiene abierto, y
                // cada respuesta es distinta: un comentario por cosa, no uno
                // para el montón.
                campo = `<div id="pd-${c.id}" data-items class="space-y-1.5">${(c.items || []).map(it => `
                  <div class="rounded-xl border border-telecab-border bg-telecab-card2/40 px-3 py-2" data-item="${esc(it.codigo)}">
                    <label class="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" data-marca class="mt-0.5 w-4 h-4 accent-telecab-gold shrink-0">
                      <span class="min-w-0 flex-1">
                        <span class="block text-sm font-medium ${it.tono === 'error' ? 'text-telecab-red' : 'text-telecab-text'}">${esc(it.etiqueta)}</span>
                        ${it.detalle ? `<span class="block text-[11px] text-telecab-muted">${esc(it.detalle)}</span>` : ''}
                      </span>
                    </label>
                    <input data-comentario disabled placeholder="Qué te ha dicho sobre esto…"
                      class="hidden w-full mt-1.5 px-2.5 py-1.5 bg-telecab-card border border-telecab-border rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-telecab-gold/40">
                  </div>`).join('') || '<p class="text-xs text-telecab-muted">Nada pendiente.</p>'}</div>`;
              } else if (c.tipo === 'semana') {
                const puestos = c.valor || [];
                campo = `<div class="flex gap-1" id="pd-${c.id}">${[1,2,3,4,5,6,7].map(n =>
                  `<button type="button" data-dia="${n}"
                     class="w-9 h-9 rounded-lg text-sm font-semibold transition border
                       ${puestos.includes(n)
                         ? 'bg-telecab-gold text-telecab-dark border-telecab-gold'
                         : 'bg-telecab-card2 text-telecab-muted border-telecab-border'}">${DIAS[n]}</button>`).join('')}</div>`;
              } else if (c.tipo === 'texto-largo') {
                campo = `<textarea id="pd-${c.id}" rows="2" class="${base}">${esc(c.valor || '')}</textarea>`;
              } else {
                campo = `<input id="pd-${c.id}" class="${c.tipo === 'fecha' ? 'js-fecha ' : ''}${base}"
                          value="${esc(c.valor || '')}" placeholder="${esc(c.marcador || (c.tipo === 'fecha' ? 'dd/mm/aaaa' : ''))}">`;
              }
              return cabecera + `<div class="${c.tipo === 'texto-largo' ? 'col-span-full' : ''}">
                <label class="block text-xs text-telecab-muted uppercase tracking-wide mb-1">${esc(c.etiqueta)}</label>
                ${campo}
                ${c.ayuda ? `<p class="text-[11px] text-telecab-muted mt-1">${esc(c.ayuda)}</p>` : ''}
              </div>`;
            }).join('')}
            <p class="hidden text-sm text-telecab-red col-span-full" data-error></p>
            <div class="flex items-center gap-2 pt-1 col-span-full">
              <button type="submit" class="flex-1 px-4 py-2.5 rounded-xl bg-telecab-gold text-telecab-dark font-semibold text-sm shadow-gold">${esc(textoBoton)}</button>
              <button type="button" data-cancelar class="px-4 py-2.5 rounded-xl bg-telecab-card2 border border-telecab-border text-sm">Cancelar</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(fondo);

      // ── El selector de la casa: grupo arriba, casos debajo ──────────────
      campos.filter(c => c.tipo === 'opciones').forEach(c => {
        const caja = fondo.querySelector('#pd-' + c.id);
        const grupos = c.grupos || [{ codigo: '', etiqueta: '', opciones: c.opciones || [] }];
        const lista = caja.querySelector('[data-casos]');
        const vacio = caja.querySelector('[data-vacio]');
        let grupoSel = grupos[0], elegido = c.valor || null;
        const norm = o => (typeof o === 'string' ? { valor: o, texto: o } : o);

        const pintaCasos = () => {
          const ops = (grupoSel.opciones || []).map(norm);
          lista.innerHTML = ops.map(o => `
            <button type="button" data-o="${esc(o.valor)}" data-texto="${esc(o.texto)}"
              class="w-full text-left px-3 py-2 rounded-lg border text-sm transition
                ${String(o.valor) === String(elegido)
                  ? 'bg-telecab-gold/15 border-telecab-gold text-telecab-text font-medium'
                  : 'bg-telecab-card2/40 border-telecab-border text-telecab-text hover:border-telecab-gold/50'}">
              ${esc(o.texto)}${o.detalle ? `<span class="block text-[11px] text-telecab-muted">${esc(o.detalle)}</span>` : ''}
            </button>`).join('');
          vacio.classList.toggle('hidden', ops.length > 0);
          vacio.textContent = grupoSel.vacio || 'No hay casos para este tipo.';
          lista.querySelectorAll('[data-o]').forEach(b => b.addEventListener('click', () => {
            elegido = b.dataset.o;
            caja.dataset.valor = elegido;
            caja.dataset.grupo = grupoSel.codigo || '';
            // El TEXTO DEL CASO, no el del botón. Un caso puede llevar debajo su
            // explicación (las alertas la llevan siempre), y `textContent` las
            // pegaba sin espacio: en la base quedaron resultados como
            // "1 viaje rechazadoLos rechazó ÉL, con el dedo. No se puede…",
            // recortados a 60 caracteres y sin sentido en el informe.
            caja.dataset.texto = b.dataset.texto || b.textContent.trim();
            pintaCasos();
          }));
        };
        caja.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => {
          grupoSel = grupos.find(g => String(g.codigo) === b.dataset.g) || grupos[0];
          // Cambiar de tipo BORRA el caso elegido: un "Buzón" de seguimiento no
          // significa nada bajo Taller, y dejarlo marcado invita a enviarlo.
          elegido = null; delete caja.dataset.valor;
          caja.querySelectorAll('[data-g]').forEach(x => {
            const on = x === b;
            x.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold border transition ' +
              (on ? 'bg-telecab-gold text-telecab-dark border-telecab-gold'
                  : 'bg-telecab-card2 border-telecab-border text-telecab-muted hover:border-telecab-gold/50');
          });
          pintaCasos();
        }));
        pintaCasos();
      });

      // ── La lista de cosas que se marcan y se comentan ───────────────────
      fondo.querySelectorAll('[data-items] [data-item]').forEach(fila => {
        const marca = fila.querySelector('[data-marca]');
        const com = fila.querySelector('[data-comentario]');
        marca.addEventListener('change', () => {
          com.classList.toggle('hidden', !marca.checked);
          com.disabled = !marca.checked;
          fila.classList.toggle('border-telecab-gold/50', marca.checked);
          if (marca.checked) com.focus();
        });
      });

      // Los días de la semana se marcan pinchando.
      fondo.querySelectorAll('[id^="pd-"] [data-dia]').forEach(b => {
        b.addEventListener('click', () => {
          const on = b.classList.toggle('bg-telecab-gold');
          b.classList.toggle('text-telecab-dark', on);
          b.classList.toggle('border-telecab-gold', on);
          b.classList.toggle('bg-telecab-card2', !on);
          b.classList.toggle('text-telecab-muted', !on);
          b.classList.toggle('border-telecab-border', !on);
        });
      });

      const cerrar = v => { fondo.remove(); document.removeEventListener('keydown', esc2); resolver(v); };
      const esc2 = e => { if (e.key === 'Escape') cerrar(null); };
      document.addEventListener('keydown', esc2);
      fondo.addEventListener('click', e => { if (e.target === fondo) cerrar(null); });
      fondo.querySelector('[data-cancelar]').addEventListener('click', () => cerrar(null));

      fondo.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        // DOS PASADAS: primero se lee TODO y luego se valida. Con una sola, un
        // campo que depende de otro (el caso, que se da por contestado si hay
        // alertas marcadas) se validaba antes de que el otro existiera.
        const salida = {};
        const fallos = [];
        campos.forEach(c => {
          const el = fondo.querySelector('#pd-' + c.id);
          if (c.tipo === 'semana') {
            salida[c.id] = [...el.querySelectorAll('[data-dia]')]
              .filter(b => b.classList.contains('bg-telecab-gold'))
              .map(b => Number(b.dataset.dia));
          } else if (c.tipo === 'opciones') {
            const v = el.dataset.valor || '';
            salida[c.id] = v ? { valor: v, grupo: el.dataset.grupo || '', texto: el.dataset.texto || v } : null;
          } else if (c.tipo === 'items') {
            const marcados = [...el.querySelectorAll('[data-item]')]
              .filter(f => f.querySelector('[data-marca]').checked)
              .map(f => ({
                codigo: f.dataset.item,
                etiqueta: f.querySelector('.font-medium').textContent.trim(),
                comentario: f.querySelector('[data-comentario]').value.trim(),
              }));
            salida[c.id] = marcados;
          } else {
            salida[c.id] = c.tipo === 'fecha' ? aISO(el.value.trim()) : el.value.trim();
          }
        });
        // ── Segunda pasada: validar con TODO ya leído ──────────────────────
        campos.forEach(c => {
          if (c.tipo === 'opciones') {
            // `obligatorioSalvo` deja que OTRO campo lo dé por contestado.
            // Marcar las alertas y escribir qué dijo de cada una YA ES decir qué
            // ha pasado: pedir además un caso de la lista era hacer repetir lo
            // mismo, y el "elige qué ha pasado" saltaba con la respuesta escrita
            // ahí delante.
            const cubierto = c.obligatorioSalvo && (salida[c.obligatorioSalvo] || []).length > 0;
            if (c.obligatorio && !salida[c.id] && !cubierto) fallos.push(`Elige ${c.etiqueta.toLowerCase()}.`);
          } else if (c.tipo === 'items' && c.comentarioObligatorio) {
            // UN COMENTARIO POR CADA UNA. Marcar sin escribir nada es decir "ya
            // pregunté" sin dejar la respuesta, y eso es justo lo que hace que
            // el siguiente controlador vuelva a llamar por lo mismo.
            if ((salida[c.id] || []).some(x => !x.comentario)) {
              fallos.push('Escribe qué te ha dicho en cada una de las que marcas.');
            }
          }
        });

        const aviso = fondo.querySelector('[data-error]');
        if (fallos.length) {
          aviso.textContent = fallos.join(' ');
          aviso.classList.remove('hidden');
          return;
        }
        cerrar(salida);
      });

      const primero = fondo.querySelector('input, select, textarea');
      if (primero) primero.focus();
    });
  }


  // ── Confirmacion breve ──────────────────────────────────────────────────
  //
  // Hasta ahora guardar algo era MUDO: la ventana se cerraba y ya. Quien lo hace
  // no distingue "guardado" de "no ha pasado nada", y acaba comprobandolo a mano
  // o guardando otra vez.
  //
  // Un modal para esto seria peor: obliga a un clic mas por cada guardado. Esto
  // aparece abajo, se lee de un vistazo y se va solo.
  function hecho(texto, { tono = 'ok', segundos = 3 } = {}) {
    const t = TONOS[tono] || TONOS.ok;
    const caja = document.createElement('div');
    // Arriba y centrado, debajo de la cabecera. Abajo a la derecha estaba fuera
    // de donde mira nadie: un aviso que no se ve es lo mismo que no darlo.
    caja.className = 'fixed top-20 left-1/2 -translate-x-1/2 z-[130] flex items-center gap-2 '
      + 'px-4 py-3 rounded-xl bg-telecab-card border border-telecab-' + t.color + '/40 '
      + 'shadow-soft text-sm transition-all duration-300';
    caja.innerHTML = '<i class="fa-solid ' + t.icono + ' text-telecab-' + t.color + '"></i>'
      + '<span>' + esc(texto) + '</span>';
    // Si alguien ha pedido menos movimiento, aparece y se va sin gesto.
    const quieto = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!quieto) caja.style.transform = 'translate(-50%, -12px)';
    if (!quieto) caja.style.opacity = '0';
    document.body.appendChild(caja);
    if (!quieto) {
      // Un fotograma despues, para que el navegador vea el cambio y lo anime.
      requestAnimationFrame(() => {
        caja.style.transform = 'translate(-50%, 0)';
        caja.style.opacity = '1';
      });
    }
    setTimeout(() => {
      if (!quieto) caja.style.opacity = '0';
      setTimeout(() => caja.remove(), quieto ? 0 : 300);
    }, segundos * 1000);
  }

  global.Dialogo = { abrir, aviso, confirmar, elegir, formulario, hecho, aISO, TONOS };

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
