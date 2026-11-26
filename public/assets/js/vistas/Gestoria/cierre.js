// modules/Gestoria/vistas/gestoria.ejs — la pestaña «Cierre del mes» (módulo 4, db/299, 26/11/2026).
//
// El mes de nómina (del 26 al 25) con sus cuatro etapas en una línea: proforma
// revisada (sola), variables y descuentos enviados, borrador revisado y nómina
// aprobada. Cada una con su fecha, quién y cuándo, y con retraso en rojo. Las
// pestañas las monta proforma.js; esta se pinta al abrirla.

(function () {
  const esc = Casa.esc;
  const $ = s => document.querySelector(s);
  const raiz = $('#gs-cierre');
  if (!raiz) return;
  let datos = null;
  let periodo = new URLSearchParams(location.search).get('periodo') || '';

  async function cargar() {
    const r = await Api.get('/gestoria/api/cierre' + (periodo ? '?periodo=' + encodeURIComponent(periodo) : ''))
      .catch(e => { raiz.innerHTML = '<div class="tc-pantalla"><p class="text-sm text-telecab-red">' + esc(e.message) + '</p></div>'; return null; });
    if (!r) return;
    datos = r;
    periodo = r.periodo;
    pintar();
  }

  const icono = e => e.hecha ? 'fa-check' : e.retraso ? 'fa-exclamation' : e.toca ? 'fa-arrow-right' : 'fa-minus';
  const tonoPunto = e => e.hecha ? 'bg-telecab-green text-telecab-dark'
    : e.retraso ? 'bg-telecab-red text-white'
      : e.toca ? 'bg-telecab-gold text-telecab-dark' : 'bg-telecab-card2 text-telecab-muted border border-telecab-border';
  const pastilla = e => e.hecha ? '<span class="tc-pastilla tc-pastilla--verde">Hecha</span>'
    : e.retraso ? '<span class="tc-pastilla tc-pastilla--rojo">Con retraso</span>'
      : e.toca ? '<span class="tc-pastilla tc-pastilla--oro">Toca ahora</span>' : '<span class="tc-pastilla">Pendiente</span>';

  // La última etapa a mano que está hecha es la única que se puede deshacer.
  function ultimaDeshacible() {
    const a = datos.etapas.filter(e => !e.sola && e.hecha);
    return a.length ? a[a.length - 1].clave : null;
  }

  function acciones(e) {
    const out = [];
    const m = esc(datos.mes);
    if (e.clave === 'proforma') {
      out.push('<a href="/gestoria?vista=proforma" class="tc-boton tc-boton--chico">Ir a la proforma</a>');
    } else if (!e.hecha) {
      if (e.clave === 'variables') {
        out.push('<a href="/nominas" class="tc-boton tc-boton--chico">Nóminas</a>', '<a href="/descuentos" class="tc-boton tc-boton--chico">Descuentos</a>');
        if (datos.puedeMarcar) out.push('<button data-marcar="variables" class="tc-boton tc-boton--principal tc-boton--chico" aria-label="Marcar enviadas las variables y los descuentos de ' + m + '">Marcar enviado</button>');
      }
      if (e.clave === 'borrador' && datos.puedeMarcar) out.push('<button data-marcar="borrador" class="tc-boton tc-boton--principal tc-boton--chico" aria-label="Marcar revisado el borrador de ' + m + '">Marcar revisado</button>');
      if (e.clave === 'aprobada' && datos.puedeAprobar) out.push('<button data-marcar="aprobada" class="tc-boton tc-boton--principal tc-boton--chico" aria-label="Aprobar la nómina de ' + m + '">Aprobar la nómina</button>');
    } else if (e.clave === ultimaDeshacible() && (e.clave === 'aprobada' ? datos.puedeAprobar : datos.puedeMarcar)) {
      out.push('<button data-deshacer="' + e.clave + '" class="tc-boton tc-boton--chico" aria-label="Deshacer «' + esc(e.titulo) + '» de ' + m + '">' +
        (e.clave === 'aprobada' ? 'Reabrir' : 'Deshacer') + '</button>');
    }
    return out.length ? '<div class="flex flex-wrap gap-2 mt-3">' + out.join('') + '</div>' : '';
  }

  function etapaHtml(e, i, n) {
    const linea = i < n - 1 ? '<span class="absolute left-[15px] top-9 bottom-0 w-px ' + (e.hecha ? 'bg-telecab-green/50' : 'bg-telecab-border') + '" aria-hidden="true"></span>' : '';
    const quien = e.hecha && e.cuando ? '<p class="text-xs text-telecab-muted mt-1">' + (e.sola ? '' : 'Marcada el ' + esc(e.cuando) + (e.por ? ' por ' + esc(e.por) : '')) + '</p>' : '';
    const req = e.requisitos && !e.hecha ? '<ul class="mt-2 space-y-1">' + e.requisitos.map(r =>
      '<li class="text-xs flex gap-2 ' + (r.ok ? 'text-telecab-green' : 'text-telecab-warn') + '">' +
        '<i class="fa-solid ' + (r.ok ? 'fa-circle-check' : 'fa-triangle-exclamation') + ' mt-0.5" aria-hidden="true"></i><span>' + esc(r.texto) + '</span></li>').join('') + '</ul>' : '';
    return '<li class="relative pl-12 pb-6">' + linea +
      '<span class="absolute left-0 top-0 w-8 h-8 rounded-full flex items-center justify-center text-xs ' + tonoPunto(e) + '">' +
        '<i class="fa-solid ' + icono(e) + '" aria-hidden="true"></i></span>' +
      '<div class="bg-telecab-card border ' + (e.retraso ? 'border-telecab-red/50' : e.toca ? 'border-telecab-gold/50' : 'border-telecab-border') + ' rounded-2xl p-4">' +
        '<div class="flex flex-wrap items-center gap-x-3 gap-y-1">' +
          '<h3 class="font-semibold text-telecab-text">' + esc(e.titulo) + '</h3>' + pastilla(e) +
          '<span class="ml-auto text-xs text-telecab-muted tabular-nums" title="La fecha de esta etapa (se cambia en Parámetros).">Hasta el ' + esc(e.vence) + '</span>' +
        '</div>' +
        '<p class="text-sm text-telecab-muted mt-1">' + esc(e.texto) + '</p>' +
        (e.detalle ? '<p class="text-sm mt-1 ' + (e.hecha ? 'text-telecab-green' : 'text-telecab-text') + '">' + esc(e.detalle) + '</p>' : '') +
        quien + (e.nota ? '<p class="text-xs text-telecab-muted mt-1">Nota: ' + esc(e.nota) + '</p>' : '') + req + acciones(e) +
      '</div></li>';
  }

  function pintar() {
    const i = datos.meses.findIndex(x => x.periodo === periodo);
    const masNuevo = i > 0 ? datos.meses[i - 1] : null;
    const masViejo = i >= 0 && i < datos.meses.length - 1 ? datos.meses[i + 1] : null;
    const cab = '<div class="flex flex-wrap items-center gap-3 mb-5">' +
      '<button data-mes="' + (masViejo ? esc(masViejo.periodo) : '') + '" class="tc-boton tc-boton--chico" ' + (masViejo ? '' : 'disabled') + ' aria-label="Mes anterior"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>' +
      '<div><h2 class="text-lg font-bold text-telecab-text capitalize">Nómina de ' + esc(datos.mes || '') + '</h2>' +
        (datos.desde ? '<p class="text-xs text-telecab-muted">Del ' + esc(datos.desde) + ' al ' + esc(datos.hasta) + '</p>' : '') + '</div>' +
      '<button data-mes="' + (masNuevo ? esc(masNuevo.periodo) : '') + '" class="tc-boton tc-boton--chico" ' + (masNuevo ? '' : 'disabled') + ' aria-label="Mes siguiente"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>' +
      (datos.etapas ? '<div class="ml-auto flex items-center gap-3 min-w-[180px]">' +
        '<div class="flex-1 h-2 rounded-full bg-telecab-card2 overflow-hidden" role="img" aria-label="' + datos.hechas + ' de 4 etapas hechas">' +
          '<div class="h-full bg-telecab-green" style="width:' + (datos.hechas * 25) + '%"></div></div>' +
        '<span class="text-sm tabular-nums text-telecab-muted">' + datos.hechas + ' de 4</span></div>' : '') +
      '</div>';
    if (datos.sinTabla) {
      raiz.innerHTML = '<div class="tc-pantalla">' + cab + '<p class="text-sm text-telecab-warn"><i class="fa-solid fa-database mr-1" aria-hidden="true"></i>Falta aplicar la migración db/299 en Migraciones.</p></div>';
      enganchar();
      return;
    }
    raiz.innerHTML = '<div class="tc-pantalla max-w-3xl">' + cab +
      (datos.cerrado ? '<p class="mb-4 text-sm text-telecab-green"><i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i>La nómina de ' + esc(datos.mes) + ' está cerrada.</p>' : '') +
      '<ol>' + datos.etapas.map((e, k) => etapaHtml(e, k, datos.etapas.length)).join('') + '</ol>' +
      (datos.historia && datos.historia.length ? '<details class="mt-2 text-sm"><summary class="cursor-pointer text-telecab-muted">Etapas que se deshicieron (' + datos.historia.length + ')</summary><ul class="mt-2 space-y-1">' +
        datos.historia.map(h => '<li class="text-xs text-telecab-muted">' + esc(h.cuando) + ' · ' + esc(h.por || '') + ': ' + esc(h.motivo) + '</li>').join('') + '</ul></details>' : '') +
      '</div>';
    enganchar();
  }

  function enganchar() {
    raiz.querySelectorAll('[data-mes]').forEach(b => b.addEventListener('click', () => {
      if (!b.dataset.mes) return;
      periodo = b.dataset.mes;
      const u = new URL(location.href); u.searchParams.set('periodo', periodo); history.replaceState(null, '', u);
      cargar();
    }));
    raiz.querySelectorAll('[data-marcar]').forEach(b => b.addEventListener('click', () => marcar(b.dataset.marcar, b)));
    raiz.querySelectorAll('[data-deshacer]').forEach(b => b.addEventListener('click', () => deshacer(b.dataset.deshacer, b)));
  }

  async function marcar(etapa, boton) {
    const e = datos.etapas.find(x => x.clave === etapa);
    let nota = '';
    if (etapa === 'aprobada') {
      if (!await Dialogo.confirmar({ titulo: 'Aprobar la nómina de ' + datos.mes,
        texto: 'La proforma, las variables y el borrador ya están. Queda con tu nombre y la fecha.', si: 'Aprobar la nómina', no: 'Cancelar' })) return;
    } else {
      const faltan = (e.requisitos || []).filter(r => !r.ok);
      const v = await Dialogo.formulario(etapa === 'variables' ? 'Variables y descuentos enviados' : 'Borrador revisado', [
        { id: 'nota', etiqueta: faltan.length ? 'Por qué se manda igual (obligatorio)' : 'Nota (opcional)', tipo: 'texto-largo',
          obligatorio: !!faltan.length, minimo: faltan.length ? 3 : undefined,
          ayuda: faltan.length ? 'Falta: ' + faltan.map(r => r.texto).join('. ') : '' },
      ], { textoBoton: etapa === 'variables' ? 'Marcar enviado' : 'Marcar revisado',
           nota: 'Queda con tu nombre y la fecha. Se puede deshacer con un motivo.' });
      if (!v) return;
      nota = v.nota || '';
    }
    const r = await Api.post('/gestoria/api/cierre/marcar', { periodo, etapa, nota }, { boton, aviso: 'No se ha podido marcar' });
    if (r) { Dialogo.hecho(etapa === 'aprobada' ? 'Nómina aprobada' : 'Marcada'); cargar(); }
  }

  async function deshacer(etapa, boton) {
    const e = datos.etapas.find(x => x.clave === etapa);
    const v = await Dialogo.formulario((etapa === 'aprobada' ? 'Reabrir' : 'Deshacer') + ' «' + e.titulo + '»', [
      { id: 'motivo', etiqueta: 'Motivo', tipo: 'texto-largo', obligatorio: true, minimo: 3 },
    ], { textoBoton: etapa === 'aprobada' ? 'Reabrir' : 'Deshacer', nota: 'Queda en la historia del mes con tu nombre.' });
    if (!v) return;
    const r = await Api.post('/gestoria/api/cierre/deshacer', { periodo, etapa, motivo: v.motivo }, { boton, aviso: 'No se ha podido deshacer' });
    if (r) cargar();
  }

  let abierta = false;
  window.GestoriaCierre = { abrir() { if (!abierta) { abierta = true; cargar(); } } };
  // Si la pantalla se abrió ya en esta pestaña, las pestañas se montaron antes que este fichero.
  if (!raiz.classList.contains('hidden')) window.GestoriaCierre.abrir();
})();
