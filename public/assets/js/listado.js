// ============================================================
// LISTADO — el componente "lista → ficha → atrás"
// ============================================================
// Casi todas las pantallas del sistema hacen lo mismo: traer una lista, dejar
// buscar y filtrar, y al pinchar una fila enseñar la ficha de ese elemento con
// un botón para volver. Escrito a mano en cada módulo son unas 200 líneas
// iguales por pantalla, y cada copia envejece por su cuenta.
//
// Aquí está una sola vez. Cada módulo solo DESCRIBE lo suyo: qué columnas
// tiene, de dónde salen los datos y qué se ve en la ficha. Todo lo demás
// (buscar, filtrar, estado vacío, errores, la navegación y el historial del
// navegador) ya está resuelto.
//
// Uso mínimo:
//
//   Listado.montar({
//     raiz: '#modulo',
//     titulo: 'Flota',
//     origen: '/vehiculos/api/lista',
//     columnas: [{ titulo: 'Matrícula', campo: 'matricula' }],
//     detalle: {
//       origen: id => `/vehiculos/api/ficha/${id}`,
//       titulo: d => d.matricula,
//       bloques: [{ titulo: 'Datos', campos: [{ etiqueta: 'Modelo', valor: d => d.marca_modelo }] }]
//     }
//   });
//
// EL BOTÓN DE ATRÁS: no es solo el de la pantalla. La ficha cambia la URL
// (#id), así que el botón del navegador y el gesto de atrás del móvil también
// funcionan, y una ficha se puede compartir por enlace o recargar sin perderla.

(function (global) {
  'use strict';

  // ---------- utilidades ----------

  /** Escapa texto para meterlo en HTML. Todo lo que venga de la base pasa por aquí. */
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Convierte HTML en un elemento de verdad. */
  function nodo(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  /** dd/mm/aaaa, que es como se escriben las fechas aquí. Vacío si no hay. */
  function fecha(v) {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d)) return String(v);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  /** Fecha y hora, para sellos de tiempo (última lectura, último cambio…). */
  function fechaHora(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return String(v);
    const p = n => String(n).padStart(2, '0');
    return `${fecha(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** "hace 3 días". Para saber de un vistazo si un dato está fresco. */
  function hace(v) {
    if (!v) return '';
    const ms = Date.now() - new Date(v).getTime();
    if (isNaN(ms)) return '';
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'ahora mismo';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'ayer';
    if (d < 30) return `hace ${d} días`;
    const m = Math.floor(d / 30);
    return m === 1 ? 'hace un mes' : `hace ${m} meses`;
  }

  /** Metros a kilómetros con separador de miles. Mapon los da en metros. */
  function km(metros) {
    if (metros === null || metros === undefined || metros === '') return '';
    const n = Math.round(Number(metros) / 1000);
    return isNaN(n) ? '' : n.toLocaleString('es-ES') + ' km';
  }

  /** Etiqueta de color. `tono` es uno de los colores del tema. */
  function etiqueta(texto, tono) {
    if (texto === null || texto === undefined || texto === '') return '';
    const t = tono || 'muted';
    return `<span class="inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-lg text-xs font-semibold bg-telecab-${t}/15 text-telecab-${t} border border-telecab-${t}/30">${esc(texto)}</span>`;
  }

  /** Los días que faltan, en color: rojo si pasó, ámbar si está cerca. */
  function caduca(dias, texto) {
    if (dias === null || dias === undefined || dias === '') return esc(texto || '');
    const n = Number(dias);
    const tono = n < 0 ? 'red' : n <= 30 ? 'warn' : 'muted';
    const aviso = n < 0 ? ' (caducada)' : n <= 30 ? ` (${n} d)` : '';
    return `<span class="text-telecab-${tono}">${esc(texto || '')}${aviso}</span>`;
  }

  /** Lee el valor de una fila: acepta 'campo', 'a.b' o una función. */
  function valorDe(fila, ref) {
    if (typeof ref === 'function') return ref(fila);
    if (typeof ref !== 'string') return '';
    return ref.split('.').reduce((o, k) => (o === null || o === undefined ? o : o[k]), fila);
  }

  /**
   * Trae los datos de un `origen`, que puede ser de tres formas:
   *   · una URL                          → se pide
   *   · una función que DEVUELVE una URL → se pide la que devuelva (la ficha:
   *                                        `id => '/x/api/ficha/' + id`)
   *   · una función que devuelve datos   → se usan tal cual
   *
   * La distinción es por lo que devuelve, no por cómo se declaró: nadie que
   * quiera dar datos devuelve una cadena suelta.
   */
  async function traer(origen, arg) {
    const x = typeof origen === 'function' ? await origen(arg) : origen;
    if (typeof x !== 'string') return x;
    const r = await fetch(x);
    const j = await r.json().catch(() => null);
    if (!r.ok || (j && j.status === 'error')) {
      throw new Error((j && (j.msg || j.error)) || `Error ${r.status}`);
    }
    return j;
  }

  /** Sin acentos y en minúsculas, para que buscar "jose" encuentre "José". */
  function plano(v) {
    return String(v === null || v === undefined ? '' : v)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  // ---------- el componente ----------

  class Listado {
    constructor(cfg) {
      this.cfg = cfg;
      this.raiz = typeof cfg.raiz === 'string' ? document.querySelector(cfg.raiz) : cfg.raiz;
      if (!this.raiz) throw new Error(`Listado: no encuentro la raíz "${cfg.raiz}"`);

      this.clave = cfg.clave || 'id';
      this.filas = [];
      this.extra = {};
      this.filtros = {};          // id de filtro → valor elegido
      this.busca = '';
      this.abierto = null;        // clave del elemento abierto, o null
      this.propia = false;        // ¿la entrada del historial la pusimos nosotros?
      this.cargando = false;
      this.porPagina = cfg.porPagina || 50;
      this.pagina = 0;

      this.pintarArmazon();
      this.escuchar();
    }

    // --- armazón: se pinta una vez, luego solo cambian los trozos de dentro ---

    pintarArmazon() {
      const c = this.cfg;
      this.raiz.innerHTML = `
        <div class="p-4 lg:p-6 max-w-[1400px] mx-auto">

          <!-- LISTA -->
          <section data-parte="lista">
            <div class="flex flex-wrap items-center gap-3 mb-5">
              <div>
                <h2 class="text-xl font-bold flex items-center gap-2">
                  ${c.icono ? `<i class="fa-solid ${esc(c.icono)} text-telecab-gold"></i>` : ''}
                  ${esc(c.titulo || '')}
                </h2>
                <p class="text-sm text-telecab-muted mt-0.5" data-parte="subtitulo"></p>
              </div>
              <div class="ml-auto flex items-center gap-2">
                ${c.buscar === false ? '' : `
                  <div class="relative">
                    <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-telecab-muted text-xs"></i>
                    <input data-parte="busca" placeholder="${esc((c.buscar && c.buscar.texto) || 'Buscar…')}"
                           class="pl-8 pr-3 py-2 w-48 sm:w-64 bg-telecab-card border border-telecab-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-telecab-gold/40 focus:border-telecab-gold/50">
                  </div>`}
                <div data-parte="acciones" class="flex items-center gap-2"></div>
              </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5" data-parte="kpis"></div>
            <div class="flex flex-wrap gap-2 mb-4" data-parte="filtros"></div>

            <!-- Rejilla de datos, no tarjeta. La cabecera se queda fija arriba
                 mientras el cuerpo se desplaza: con doscientas filas es la
                 diferencia entre leer una tabla y adivinarla. -->
            <div data-parte="rejilla"
                 class="overflow-auto border-y border-telecab-border ${esc(c.alto || 'max-h-[calc(100vh-15rem)] min-h-[16rem]')}">
              <table class="w-full text-sm border-collapse">
                <thead class="sticky top-0 z-10">
                  <tr data-parte="cabecera" class="bg-telecab-card2"></tr>
                </thead>
                <tbody data-parte="cuerpo"></tbody>
              </table>
            </div>
            <div data-parte="vacio" class="hidden p-10 text-center text-telecab-muted border-y border-telecab-border">
              <i class="fa-solid ${esc(c.icono || 'fa-inbox')} text-3xl mb-2 opacity-40"></i>
              <p>${esc(c.vacio || 'No hay nada que coincida.')}</p>
            </div>
            <div data-parte="paginador" class="hidden flex-wrap items-center gap-2 py-3"></div>
          </section>

          <!-- FICHA -->
          <section data-parte="detalle" class="hidden"></section>
        </div>`;

      const q = s => this.raiz.querySelector(`[data-parte="${s}"]`);
      this.el = {
        lista: q('lista'), detalle: q('detalle'), cuerpo: q('cuerpo'),
        cabecera: q('cabecera'), vacio: q('vacio'), kpis: q('kpis'),
        filtros: q('filtros'), busca: q('busca'), acciones: q('acciones'),
        subtitulo: q('subtitulo'), rejilla: q('rejilla'), paginador: q('paginador'),
      };

      // Cabecera de la tabla.
      this.el.cabecera.innerHTML = c.columnas.map(col =>
        `<th class="text-left font-semibold px-3 py-2.5 text-[11px] uppercase tracking-wider
                    text-telecab-text/70 border-b-2 border-telecab-border whitespace-nowrap
                    ${esc(col.claseCabecera || '')}">${esc(col.titulo || '')}</th>`
      ).join('') + '<th class="w-8 border-b-2 border-telecab-border"></th>';

      // Botones de la cabecera (alta, exportar, sincronizar…).
      (c.acciones || []).forEach(a => {
        const b = nodo(`<button class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
          a.principal === false
            ? 'bg-telecab-card border border-telecab-border hover:bg-telecab-card2'
            : 'bg-telecab-gold text-telecab-dark hover:bg-telecab-gold-soft shadow-gold'
        }">${a.icono ? `<i class="fa-solid ${esc(a.icono)}"></i>` : ''}<span>${esc(a.texto || '')}</span></button>`);
        b.addEventListener('click', () => a.onClick(this));
        this.el.acciones.appendChild(b);
      });
    }

    escuchar() {
      if (this.el.busca) {
        let reloj;
        this.el.busca.addEventListener('input', e => {
          clearTimeout(reloj);
          const v = e.target.value;
          // Pequeña espera: no se repinta la tabla en cada tecla.
          reloj = setTimeout(() => { this.busca = v; this.pagina = 0; this.pintarFilas(); }, 150);
        });
      }

      // Atrás del navegador y gesto de atrás del móvil.
      this._popstate = () => this.sincronizarConUrl();
      global.addEventListener('popstate', this._popstate);

      // Escape cierra la ficha, como en el resto del sistema.
      this._teclado = e => {
        if (e.key === 'Escape' && this.abierto !== null) this.volver();
      };
      document.addEventListener('keydown', this._teclado);
    }

    // --- datos ---

    /** Trae la lista y la pinta. Si la URL traía una ficha, la abre. */
    async cargar() {
      this.cargando = true;
      try {
        const datos = await traer(this.cfg.origen);
        this.filas = Array.isArray(datos) ? datos : (datos.filas || datos.datos || []);
        this.extra = Array.isArray(datos) ? {} : datos;
        this.pintarKpis();
        this.pintarFiltros();
        this.pintarFilas();
        await this.sincronizarConUrl();
      } catch (e) {
        this.error(e.message);
      } finally {
        this.cargando = false;
      }
    }

    error(msg) {
      this.el.cuerpo.innerHTML = '';
      this.el.rejilla.classList.add('hidden');
      this.el.vacio.classList.remove('hidden');
      this.el.vacio.innerHTML = `
        <i class="fa-solid fa-triangle-exclamation text-3xl mb-2 text-telecab-red/60"></i>
        <p class="text-telecab-red">${esc(msg)}</p>`;
    }

    /** Las filas que pasan la búsqueda y los filtros. */
    visibles() {
      const c = this.cfg;
      const campos = (c.buscar && c.buscar.campos) || c.columnas.map(x => x.campo).filter(Boolean);
      const aguja = plano(this.busca).trim();

      return this.filas.filter(f => {
        for (const [id, valor] of Object.entries(this.filtros)) {
          if (valor === '' || valor === null || valor === undefined) continue;
          const def = (c.filtros || []).find(x => x.id === id);
          if (!def) continue;
          if (def.pasa) { if (!def.pasa(f, valor)) return false; continue; }
          if (String(valorDe(f, def.campo)) !== String(valor)) return false;
        }
        if (!aguja) return true;
        return campos.some(k => plano(valorDe(f, k)).includes(aguja));
      });
    }

    // --- pintado de la lista ---

    pintarKpis() {
      if (!this.cfg.kpis) { this.el.kpis.classList.add('hidden'); return; }
      const tarjetas = this.cfg.kpis(this.filas, this.extra) || [];
      this.el.kpis.innerHTML = '';
      tarjetas.forEach(k => {
        const t = nodo(`
          <div class="bg-telecab-card border border-telecab-border rounded-2xl p-4 shadow-soft ${k.filtro ? 'cursor-pointer hover:border-telecab-gold/40 transition' : ''}">
            <p class="text-xs text-telecab-muted uppercase tracking-wide">${esc(k.etiqueta || '')}</p>
            <p class="text-2xl font-bold mt-1 text-telecab-${esc(k.tono || 'text')}">${esc(k.valor)}</p>
            ${k.pie ? `<p class="text-xs text-telecab-muted mt-1">${esc(k.pie)}</p>` : ''}
          </div>`);
        // Una tarjeta puede ser un atajo al filtro que representa.
        if (k.filtro) {
          t.addEventListener('click', () => {
            this.filtros[k.filtro.id] = this.filtros[k.filtro.id] === k.filtro.valor ? '' : k.filtro.valor;
            this.pagina = 0;
            this.pintarFiltros();
            this.pintarFilas();
          });
        }
        this.el.kpis.appendChild(t);
      });
    }

    pintarFiltros() {
      const defs = this.cfg.filtros || [];
      if (!defs.length) { this.el.filtros.classList.add('hidden'); return; }
      this.el.filtros.className = 'flex flex-wrap items-center gap-x-2 gap-y-2 mb-4';

      this.el.filtros.innerHTML = '';
      defs.forEach((def, i) => {
        const opciones = typeof def.opciones === 'function'
          ? def.opciones(this.filas, this.extra) : (def.opciones || []);
        const todas = [{ valor: '', texto: def.textoTodos || 'Todos' }].concat(opciones);

        // Cada grupo va en su propia caja: se ve de un vistazo que "Día" y
        // "Noche" son lo mismo y "Sin coche" es otra cosa.
        const caja = nodo('<div class="flex flex-wrap gap-1 items-center"></div>');
        if (i) caja.prepend(nodo('<span class="w-px h-5 bg-telecab-border mx-1"></span>'));
        this.el.filtros.appendChild(caja);

        todas.forEach(op => {
          const activo = String(this.filtros[def.id] || '') === String(op.valor);
          const chip = nodo(`
            <button class="px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
              activo
                ? 'bg-telecab-gold text-telecab-dark border-telecab-gold'
                : 'bg-telecab-card border-telecab-border text-telecab-muted hover:border-telecab-gold/40'
            }">${esc(op.texto)}${op.cuenta !== undefined ? ` <span class="opacity-60">${esc(op.cuenta)}</span>` : ''}</button>`);
          chip.addEventListener('click', () => {
            this.filtros[def.id] = op.valor;
            this.pagina = 0;
            this.pintarFiltros();
            this.pintarFilas();
          });
          caja.appendChild(chip);
        });
      });
    }

    pintarFilas() {
      const todas = this.visibles();
      const c = this.cfg;

      // La pagina puede quedarse fuera de rango al filtrar: se recoloca.
      const paginas = Math.max(1, Math.ceil(todas.length / this.porPagina));
      if (this.pagina > paginas - 1) this.pagina = paginas - 1;
      if (this.pagina < 0) this.pagina = 0;
      const desde = this.pagina * this.porPagina;
      const filas = todas.slice(desde, desde + this.porPagina);

      if (this.el.subtitulo) {
        this.el.subtitulo.textContent = c.subtitulo
          ? c.subtitulo(todas, this.filas, this.extra)
          : `${todas.length} de ${this.filas.length}`;
      }

      this.el.vacio.classList.toggle('hidden', todas.length > 0);
      this.el.rejilla.classList.toggle('hidden', todas.length === 0);
      this.pintarPaginador(todas.length, paginas, desde, filas.length);
      this.el.cuerpo.innerHTML = filas.map(f => {
        const celdas = c.columnas.map(col => {
          const bruto = col.campo !== undefined ? valorDe(f, col.campo) : undefined;
          const html = col.pinta ? col.pinta(bruto, f) : esc(bruto);
          return `<td class="px-3 py-2 align-middle ${esc(col.clase || '')}">${html === undefined || html === null ? '' : html}</td>`;
        }).join('');
        return `<tr data-clave="${esc(f[this.clave])}"
                    class="border-b border-telecab-border/70 even:bg-telecab-card2/30
                           hover:bg-telecab-gold/10 cursor-pointer transition-colors">${celdas}<td class="px-2 text-telecab-muted"><i class="fa-solid fa-chevron-right text-xs"></i></td></tr>`;
      }).join('');

      this.el.cuerpo.querySelectorAll('tr[data-clave]').forEach(tr => {
        tr.addEventListener('click', () => this.abrir(tr.dataset.clave, { historial: true }));
      });
    }

    /**
     * El paginador. Si todo cabe en una pagina no aparece: un "1 de 1" con dos
     * flechas apagadas es ruido.
     */
    pintarPaginador(total, paginas, desde, enPagina) {
      const p = this.el.paginador;
      p.classList.toggle('hidden', paginas <= 1);
      p.classList.toggle('flex', paginas > 1);
      if (paginas <= 1) { p.innerHTML = ''; return; }

      const ir = n => {
        this.pagina = n;
        this.pintarFilas();
        // Al cambiar de pagina se vuelve arriba de la tabla; si no, apareces a
        // media altura de la pagina nueva.
        if (this.el.rejilla) this.el.rejilla.scrollTop = 0;
      };

      p.innerHTML = '';
      p.appendChild(nodo(`<span class="text-xs text-telecab-muted mr-auto">
        ${desde + 1}–${desde + enPagina} de ${total}</span>`));

      const boton = (contenido, destino, activo) => {
        const b = nodo(`<button class="min-w-[2rem] h-8 px-2 rounded-lg text-xs font-semibold border transition ${
          activo
            ? 'bg-telecab-gold text-telecab-dark border-telecab-gold'
            : destino === null
              ? 'border-transparent text-telecab-muted cursor-default'
              : 'bg-telecab-card border-telecab-border hover:border-telecab-gold/50'
        }">${contenido}</button>`);
        if (destino !== null && !activo) b.addEventListener('click', () => ir(destino));
        if (destino === null) b.disabled = true;
        return b;
      };

      p.appendChild(boton('<i class="fa-solid fa-chevron-left text-[10px]"></i>',
        this.pagina > 0 ? this.pagina - 1 : null));

      // Ventana de numeros alrededor de la actual, con la primera y la ultima
      // siempre a la vista. Con 200 conductores son 5 paginas, pero con 5.000
      // registros esto evita una fila de cien botones.
      const nums = new Set([0, paginas - 1]);
      for (let n = this.pagina - 1; n <= this.pagina + 1; n++) if (n >= 0 && n < paginas) nums.add(n);
      const orden = [...nums].sort((a, b) => a - b);
      orden.forEach((n, i) => {
        if (i && n - orden[i - 1] > 1) p.appendChild(boton('…', null));
        p.appendChild(boton(String(n + 1), n, n === this.pagina));
      });

      p.appendChild(boton('<i class="fa-solid fa-chevron-right text-[10px]"></i>',
        this.pagina < paginas - 1 ? this.pagina + 1 : null));
    }

    // --- navegación ---

    /** Pone la lista o la ficha según lo que diga la URL. */
    async sincronizarConUrl() {
      const id = (global.location.hash || '').replace(/^#/, '');
      if (id) await this.abrir(decodeURIComponent(id), { historial: false });
      else this.volver({ historial: false });
    }

    /**
     * Abre la ficha de un elemento. `historial:true` añade una entrada al
     * historial del navegador, para que "atrás" devuelva a la lista.
     */
    async abrir(clave, { historial = true } = {}) {
      if (clave === null || clave === undefined || clave === '') return;
      this.abierto = String(clave);

      if (historial) {
        global.history.pushState({ ficha: this.abierto }, '', '#' + encodeURIComponent(this.abierto));
        this.propia = true;
      }

      this.el.lista.classList.add('hidden');
      this.el.detalle.classList.remove('hidden');
      this.el.detalle.innerHTML = `
        <div class="p-10 text-center text-telecab-muted">
          <i class="fa-solid fa-circle-notch fa-spin text-2xl"></i>
        </div>`;

      const d = this.cfg.detalle;
      if (!d) return;

      try {
        const datos = await traer(d.origen, this.abierto);
        // Si mientras se traía la ficha el usuario ya volvió, no se pinta encima.
        if (this.abierto !== String(clave)) return;
        this.pintarDetalle(datos && datos.ficha ? datos.ficha : datos);
      } catch (e) {
        this.el.detalle.innerHTML = `
          <div class="p-10 text-center">
            <i class="fa-solid fa-triangle-exclamation text-3xl mb-2 text-telecab-red/60"></i>
            <p class="text-telecab-red">${esc(e.message)}</p>
            <button data-volver class="mt-4 px-4 py-2 rounded-xl bg-telecab-card border border-telecab-border text-sm">Volver</button>
          </div>`;
        this.el.detalle.querySelector('[data-volver]').addEventListener('click', () => this.volver());
      }
    }

    /** Vuelve a la lista. */
    volver({ historial = true } = {}) {
      // Si la entrada del historial la pusimos nosotros, se retrocede de verdad:
      // así el botón de atrás del navegador y el de la pantalla hacen lo mismo.
      if (historial && this.propia && global.location.hash) {
        global.history.back();
        return;
      }
      // Si se llegó a la ficha por enlace directo no hay a dónde retroceder: un
      // history.back() sacaría al usuario del sistema. Se limpia la URL y ya.
      if (global.location.hash) {
        global.history.replaceState(null, '', global.location.pathname + global.location.search);
      }
      this.propia = false;
      this.abierto = null;
      this.el.detalle.classList.add('hidden');
      this.el.detalle.innerHTML = '';
      this.el.lista.classList.remove('hidden');
    }

    /** Vuelve a traer la lista sin perder búsqueda ni filtros. */
    async recargar() {
      const datos = await traer(this.cfg.origen);
      this.filas = Array.isArray(datos) ? datos : (datos.filas || datos.datos || []);
      this.extra = Array.isArray(datos) ? {} : datos;
      this.pintarKpis();
      this.pintarFiltros();
      this.pintarFilas();
    }

    // --- pintado de la ficha ---

    pintarDetalle(d) {
      const cfg = this.cfg.detalle;
      const cab = nodo(`
        <div>
          <div class="flex flex-wrap items-center gap-3 mb-5">
            <button data-volver class="w-9 h-9 rounded-xl bg-telecab-card border border-telecab-border hover:border-telecab-gold/40 text-telecab-muted transition flex items-center justify-center" title="Volver (Esc)">
              <i class="fa-solid fa-arrow-left"></i>
            </button>
            <div>
              <h2 class="text-xl font-bold">${esc(cfg.titulo ? cfg.titulo(d) : '')}</h2>
              <p class="text-sm text-telecab-muted mt-0.5">${esc(cfg.subtitulo ? cfg.subtitulo(d) : '')}</p>
            </div>
            <div data-acciones class="ml-auto flex items-center gap-2"></div>
          </div>
          <div data-bloques class="grid gap-4"></div>
        </div>`);

      cab.querySelector('[data-volver]').addEventListener('click', () => this.volver());

      (cfg.acciones || []).forEach(a => {
        if (a.visible && !a.visible(d)) return;
        const b = nodo(`<button class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
          a.peligro
            ? 'bg-telecab-red/10 text-telecab-red border border-telecab-red/30 hover:bg-telecab-red/20'
            : a.principal
              ? 'bg-telecab-gold text-telecab-dark hover:bg-telecab-gold-soft shadow-gold'
              : 'bg-telecab-card border border-telecab-border hover:bg-telecab-card2'
        }">${a.icono ? `<i class="fa-solid ${esc(a.icono)}"></i>` : ''}<span>${esc(a.texto || '')}</span></button>`);
        b.addEventListener('click', () => a.onClick(d, this));
        cab.querySelector('[data-acciones]').appendChild(b);
      });

      const cont = cab.querySelector('[data-bloques]');
      (cfg.bloques || []).forEach(b => {
        if (b.visible && !b.visible(d)) return;
        cont.appendChild(this.pintarBloque(b, d));
      });

      this.el.detalle.innerHTML = '';
      this.el.detalle.appendChild(cab);
    }

    /**
     * Un bloque de la ficha. Tres formas, de la más declarativa a la más libre:
     *   · campos → rejilla de etiqueta/valor
     *   · tabla  → una tabla dentro de la ficha (plazas, historial…)
     *   · pinta  → puerta de salida: el módulo hace lo que quiera con el hueco
     */
    pintarBloque(b, d) {
      const caja = nodo(`
        <div class="bg-telecab-card border border-telecab-border rounded-2xl shadow-soft overflow-hidden">
          ${b.titulo ? `
            <div class="px-5 py-3 border-b border-telecab-border flex items-center gap-2">
              ${b.icono ? `<i class="fa-solid ${esc(b.icono)} text-telecab-gold text-sm"></i>` : ''}
              <h3 class="font-semibold text-sm uppercase tracking-wide text-telecab-muted">${esc(b.titulo)}</h3>
            </div>` : ''}
          <div data-hueco></div>
        </div>`);
      const hueco = caja.querySelector('[data-hueco]');

      if (b.campos) {
        const campos = (typeof b.campos === 'function' ? b.campos(d) : b.campos)
          .filter(c => !c.visible || c.visible(d));
        hueco.className = 'p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4';
        hueco.innerHTML = campos.map(c => {
          const v = c.valor(d);
          const pintado = c.html ? (v || '') : (esc(v) || '<span class="text-telecab-muted">—</span>');
          // La etiqueta puede depender del dato: "DNI", "NIE" o "Pasaporte"
          // segun lo que sea esa persona.
          const et = typeof c.etiqueta === 'function' ? c.etiqueta(d) : c.etiqueta;
          return `
            <div class="${esc(c.ancho || '')}">
              <p class="text-xs text-telecab-muted uppercase tracking-wide mb-1">${esc(et)}</p>
              <p class="text-sm ${esc(c.clase || '')}">${pintado}</p>
            </div>`;
        }).join('');
        return caja;
      }

      if (b.tabla) {
        const filas = b.tabla.datos(d) || [];
        if (!filas.length) {
          hueco.className = 'p-6 text-center text-telecab-muted text-sm';
          hueco.textContent = b.tabla.vacio || 'Sin datos.';
          return caja;
        }
        hueco.className = 'overflow-x-auto';
        const cuerpo = filas.map(f => `<tr>${b.tabla.columnas.map(c => {
          const bruto = c.campo !== undefined ? valorDe(f, c.campo) : undefined;
          const html = c.pinta ? c.pinta(bruto, f, d) : esc(bruto);
          return `<td class="px-5 py-2.5 ${esc(c.clase || '')}">${html === undefined || html === null ? '' : html}</td>`;
        }).join('')}</tr>`).join('');
        hueco.innerHTML = `
          <table class="w-full text-sm">
            <thead class="bg-telecab-card2 text-telecab-muted text-xs uppercase tracking-wide">
              <tr>${b.tabla.columnas.map(c => `<th class="text-left font-semibold px-5 py-2.5">${esc(c.titulo)}</th>`).join('')}</tr>
            </thead>
            <tbody class="divide-y divide-telecab-border/60">${cuerpo}</tbody>
          </table>`;
        return caja;
      }

      if (b.pinta) { hueco.className = b.clase || 'p-5'; b.pinta(d, hueco, this); return caja; }

      return caja;
    }

    /** Suelta los oyentes globales. Para cuando una pantalla se desmonta. */
    destruir() {
      global.removeEventListener('popstate', this._popstate);
      document.removeEventListener('keydown', this._teclado);
    }
  }

  // ---------- lo que se expone ----------

  global.Listado = {
    montar(cfg) {
      const l = new Listado(cfg);
      if (cfg.autoCargar !== false) l.cargar();
      return l;
    },
    // Formateadores, para que cada módulo no reinvente el suyo.
    fmt: { fecha, fechaHora, hace, km, etiqueta, caduca, esc },
  };
})(window);
