// ============================================================
// AYUDAS — el globo que explica, con la cara de la casa
// ============================================================
// Pasar el cursor por encima y que el sistema te cuente qué es ese número es la
// parte del ERP que más se usa sin darse cuenta. Quien lleva dos días aquí no
// sabe qué son «16,7 km fuera» ni por qué el 11 % está en rojo, y no va a
// preguntar por cada celda.
//
// ── LO QUE HACE ─────────────────────────────────────────────────────────────
//
// Se queda con el `title` de cualquier elemento y lo pinta él. Por eso vale para
// TODO el sistema sin tocar una sola pantalla: los 227 `title=` que ya había
// pasan a verse así el día que esto se despliega, y los que se escriban mañana
// también. Escribir la ayuda sigue siendo poner un `title`, que es lo que ya
// sabe hacer cualquiera.
//
// ── POR QUÉ SE *ROBA* EL `title` Y NO SE DEJA ───────────────────────────────
//
// Si el atributo se queda puesto, el navegador pinta ADEMÁS su propio globo
// encima del nuestro al segundo y medio: dos cajas con el mismo texto, una de
// ellas con los colores de Windows. Así que al entrar se mueve a `data-ayuda` y
// al salir se devuelve — se devuelve siempre, porque hay quien copia el HTML,
// porque las pruebas de accesibilidad lo leen, y porque si esto se apaga a
// mitad de sesión el atributo tiene que seguir donde estaba.
//
// ── Y SE CALLA TODA LA CADENA, NO SOLO EL ELEMENTO (04/11/2026) ─────────────
//
// Camilo: «algunos textos predeterminados tapan los mensajes guía». Quitar el
// `title` del elemento no bastaba: el navegador busca entonces el del PADRE y
// pinta ese. En Inicio, la raya del ideal («El ideal a cierre de ayer») está
// dentro de la barra del mes, que tiene el suyo, y al pasar por la raya salían
// las dos cajas. Así que se callan el elemento y cada antepasado con ayuda, y el
// hueco se deja como `title=""`, que corta la búsqueda hacia arriba.
//
// Lo mismo con los `<title>` de los SVG (las barras del mes): son el globo del
// navegador por otro camino. Se leen igual que un `title` y se vacían mientras
// el cursor está encima.
//
// Y si la pantalla vuelve a escribir el `title` mientras el cursor está encima
// —Inicio lo hace en cada refresco—, el navegador pintaba el suyo. Un
// observador lo recoge al momento y pone el texto nuevo en nuestro globo.
//
// ── SE PUEDE APAGAR ─────────────────────────────────────────────────────────
//
// `<html data-ayudas="0">` y no hace nada: vuelven los globos del navegador,
// que es el comportamiento de siempre. Lo decide cada uno en Configuración y
// viaja en su perfil, como el tema. A quien lleva dos años aquí las ayudas le
// estorban; a quien lleva dos días le sostienen.

(function (global) {
  'use strict';

  // 120 ms: lo justo para que no parpadee al cruzar la pantalla con el ratón,
  // y lo bastante poco para que no parezca que no responde.
  const ESPERA_ENTRAR = 120;
  const ESPERA_SALIR = 80;
  const MARGEN = 10;          // separación entre el globo y lo que explica
  const BORDE = 8;            // lo que no se acerca a los bordes de la ventana

  const SVG = 'http://www.w3.org/2000/svg';

  let globo = null, objetivo = null, tEntrar = null, tSalir = null;
  // Lo callado ahora: el objetivo y sus antepasados con ayuda (ver arriba).
  let robados = [];

  const activas = () =>
    document.documentElement.getAttribute('data-ayudas') !== '0';

  // Sin ratón no hay «pasar por encima»: en un móvil el primer toque abriría el
  // globo en vez de pulsar el botón, que es peor que no tener ayuda.
  const hayRaton = () => !global.matchMedia
    || global.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // El `<title>` hijo de un elemento SVG, que es su `title`.
  const tituloSvg = n => n.namespaceURI === SVG ? n.querySelector(':scope > title') : null;

  /** El texto de la ayuda: el guardado si ya está callado, si no el del navegador. */
  function textoDe(n) {
    if (n.dataset && n.dataset.ayuda != null) return n.dataset.ayuda.trim();
    const t = tituloSvg(n);
    return ((t ? t.textContent : n.getAttribute('title')) || '').trim();
  }

  /**
   * El elemento con ayuda más cercano, subiendo desde donde está el cursor.
   * Un `title=""` también para la búsqueda, como en el navegador: es la forma de
   * decir «aquí no hay nada que explicar» aunque el padre tenga algo.
   */
  function ayudaDe(n) {
    for (; n && n.nodeType === 1; n = n.parentNode) {
      if (n.dataset && n.dataset.ayuda != null) return n;
      if (n.hasAttribute('title') || tituloSvg(n)) return n;
    }
    return null;
  }

  function guardar(n) {
    const t = tituloSvg(n);
    if (t) { n.dataset.ayuda = t.textContent; t.textContent = ''; }
    else { n.dataset.ayuda = n.getAttribute('title'); n.setAttribute('title', ''); }
  }

  function soltar(n) {
    if (!n.dataset || n.dataset.ayuda == null) return;
    const t = tituloSvg(n);
    if (t) t.textContent = n.dataset.ayuda; else n.setAttribute('title', n.dataset.ayuda);
    delete n.dataset.ayuda;
  }

  /** Calla el elemento y cada antepasado que el navegador podría pintar en su lugar. */
  function callar(el) {
    robados = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (!textoDe(n)) continue;
      guardar(n);
      robados.push(n);
    }
  }

  function crear() {
    if (globo) return globo;
    globo = document.createElement('div');
    globo.className = 'ayuda-globo';
    globo.setAttribute('role', 'tooltip');
    globo.innerHTML = '<div class="ayuda-texto"></div><span class="ayuda-pico"></span>';
    document.body.appendChild(globo);
    return globo;
  }

  /**
   * Dónde cabe.
   *
   * Debajo si cabe y encima si no, porque debajo no tapa lo que estás mirando.
   * Y en horizontal se recorta contra la ventana en vez de salirse: una ayuda
   * que hay que arrastrar para leer no es una ayuda. El pico sigue apuntando al
   * elemento aunque la caja se haya corrido.
   */
  function colocar(el) {
    const r = el.getBoundingClientRect();
    const g = globo.getBoundingClientRect();
    const centro = r.left + r.width / 2;

    const abajo = r.bottom + MARGEN + g.height <= global.innerHeight - BORDE;
    const arriba = r.top - MARGEN - g.height >= BORDE;
    // Si no cabe en ningún lado gana abajo: recortar por el borde inferior
    // molesta menos que taparle a alguien la fila que está leyendo.
    const pone = abajo || !arriba ? 'abajo' : 'arriba';
    const y = pone === 'abajo' ? r.bottom + MARGEN : r.top - MARGEN - g.height;

    let x = centro - g.width / 2;
    x = Math.max(BORDE, Math.min(x, global.innerWidth - g.width - BORDE));

    globo.style.left = Math.round(x) + 'px';
    globo.style.top = Math.round(y) + 'px';
    globo.dataset.lado = pone;
    // El pico, relativo a la caja ya recortada.
    const pico = Math.max(12, Math.min(centro - x, g.width - 12));
    globo.style.setProperty('--ayuda-pico', Math.round(pico) + 'px');
  }

  // Los saltos de línea del `title` son parte del mensaje: el de los km lleva
  // dos frases, y la segunda es la que dice qué preguntar.
  const escribir = texto => {
    globo.querySelector('.ayuda-texto').innerHTML = esc(texto).replace(/\r?\n/g, '<br>');
  };

  function mostrar(el, texto) {
    crear();
    escribir(texto);
    globo.classList.add('ayuda-midiendo');   // se mide sin que se vea
    globo.classList.remove('ayuda-visible');
    colocar(el);
    globo.classList.remove('ayuda-midiendo');
    // SE FUERZA EL REFLUJO Y SE ENCIENDE EN LA MISMA VUELTA.
    //
    // La transición necesita que el navegador haya visto el estado inicial; si
    // no, junta los dos cambios y no hay animación. Lo normal sería esperar un
    // fotograma con `requestAnimationFrame`, y ahí estaba el fallo: cuando la
    // pestaña no está pintando —en segundo plano, o mientras otra ventana tapa
    // la del navegador— ese fotograma NO LLEGA, y el globo se quedaba puesto
    // pero invisible para siempre. Leer `offsetHeight` obliga al reflujo ahora
    // mismo y no depende de que nadie pinte nada.
    void globo.offsetHeight;
    globo.classList.add('ayuda-visible');
    objetivo = el;
  }

  /** Devuelve los `title` a su sitio. Siempre acaba pasando; la duda es cuándo. */
  function devolver() {
    robados.forEach(soltar);
    robados = [];
  }

  /**
   * Esconde el globo.
   *
   * `soltar` decide si además se devuelve el `title`, y NO es un detalle: si se
   * devuelve mientras el cursor sigue encima, el navegador empieza a contar
   * para pintar el SUYO. Es lo que hacía que al mover el ratón unos centímetros
   * dentro de la misma celda apareciera de pronto la caja blanca de Windows con
   * el mismo texto.
   *
   * Así que al ocultar por desplazamiento, por Escape o por un clic el atributo
   * se queda robado; se devuelve cuando el cursor SALE de verdad.
   */
  function ocultar(soltar = true) {
    clearTimeout(tEntrar); clearTimeout(tSalir);
    if (globo) globo.classList.remove('ayuda-visible');
    if (!soltar) return;
    devolver();
    objetivo = null;
  }

  function entrar(el) {
    if (!activas() || !hayRaton()) return;
    if (objetivo === el) return;
    const texto = textoDe(el);
    if (!texto) return;
    ocultar();
    // Se calla YA, no al mostrar: entre el cursor y los 120 ms de espera, el
    // navegador ya habría empezado a contar para su propio globo.
    callar(el);
    objetivo = el;
    clearTimeout(tEntrar);
    // El texto se lee al mostrar: la pantalla puede haberlo cambiado entretanto.
    tEntrar = setTimeout(() => mostrar(el, textoDe(el) || texto), ESPERA_ENTRAR);
  }

  const salir = () => { clearTimeout(tEntrar); clearTimeout(tSalir); tSalir = setTimeout(ocultar, ESPERA_SALIR); };

  // ── Enganches ─────────────────────────────────────────────────────────────
  // Delegados en el documento: vale para lo que ya está y para lo que se pinte
  // después, que en este sistema es casi todo.
  document.addEventListener('mouseover', e => {
    const el = ayudaDe(e.target);
    if (el) entrar(el); else if (objetivo && !objetivo.contains(e.target)) salir();
  });
  document.addEventListener('mouseout', e => {
    const el = e.target.closest && e.target.closest('[data-ayuda]');
    if (!el || el !== objetivo) return;
    // MOVERSE A UN HIJO NO ES SALIR.
    //
    // `mouseout` salta también al cruzar de un elemento a otro DENTRO del mismo:
    // la celda del calendario lleva el `title` y dentro tiene el número. Sin
    // esta comprobación, pasar el ratón del borde de la celda a la cifra se
    // leía como una salida: se devolvía el `title`, el navegador se ponía a
    // contar y pintaba su globo. De ahí el cambio de aspecto al moverse unos
    // centímetros sin salir de la casilla.
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    salir();
  });
  // Con el teclado también: quien navega con el tabulador tiene el mismo
  // derecho a saber qué es ese número.
  document.addEventListener('focusin', e => {
    const el = ayudaDe(e.target);
    if (el) entrar(el);
  });
  document.addEventListener('focusout', () => { if (objetivo) salir(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ocultar(false); });
  // Al moverse la página el globo señalaría a otro sitio: mejor que desaparezca
  // que que mienta.
  global.addEventListener('scroll', () => { if (objetivo) ocultar(false); }, true);
  global.addEventListener('resize', () => ocultar(false));
  // Un clic quita el globo: ya has decidido, no hace falta la explicación.
  document.addEventListener('mousedown', () => ocultar(false), true);
  // LA PANTALLA REESCRIBE EL `title` CON EL CURSOR ENCIMA.
  //
  // Inicio pone el de la barra del mes en cada refresco. Un `title` nuevo en algo
  // callado haría que el navegador pintara el suyo, y al salir se devolvería el
  // texto viejo encima del bueno. Se guarda al momento, y si es el del globo que
  // se ve, se cambia también ahí.
  new MutationObserver(cambios => {
    cambios.forEach(({ target: n }) => {
      // Los SVG callados guardan su `<title>`, no este atributo: no se tocan.
      if (!robados.includes(n) || tituloSvg(n) || !(n.getAttribute('title') || '').trim()) return;
      guardar(n);
      if (n === objetivo && globo && globo.classList.contains('ayuda-visible')) {
        escribir(n.dataset.ayuda);
        colocar(n);
      }
    });
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['title'] });

  global.Ayudas = {
    /** Encenderlas o apagarlas en caliente, sin recargar. */
    activar(si) {
      document.documentElement.setAttribute('data-ayudas', si ? '1' : '0');
      // Apagarlas SÍ suelta el atributo: si no, el que estuviera robado en ese
      // momento se quedaría sin `title` para siempre y ese elemento perdería su
      // ayuda hasta recargar.
      if (!si) ocultar(true);
    },
    activas,
    ocultar,
  };
})(window);
