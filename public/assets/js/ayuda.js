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

  let globo = null, objetivo = null, tEntrar = null, tSalir = null;

  const activas = () =>
    document.documentElement.getAttribute('data-ayudas') !== '0';

  // Sin ratón no hay «pasar por encima»: en un móvil el primer toque abriría el
  // globo en vez de pulsar el botón, que es peor que no tener ayuda.
  const hayRaton = () => !global.matchMedia
    || global.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

  function mostrar(el, texto) {
    crear();
    // Los saltos de línea del `title` son parte del mensaje: el de los km lleva
    // dos frases, y la segunda es la que dice qué preguntar.
    globo.querySelector('.ayuda-texto').innerHTML =
      esc(texto).replace(/\r?\n/g, '<br>');
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

  function ocultar() {
    clearTimeout(tEntrar); clearTimeout(tSalir);
    if (globo) globo.classList.remove('ayuda-visible');
    // El `title` se devuelve SIEMPRE, incluso si el elemento ya no está en la
    // página: quien lo tenga guardado se lo lleva con su ayuda.
    if (objetivo && objetivo.dataset && objetivo.dataset.ayuda != null) {
      objetivo.setAttribute('title', objetivo.dataset.ayuda);
      delete objetivo.dataset.ayuda;
    }
    objetivo = null;
  }

  function entrar(el) {
    if (!activas() || !hayRaton()) return;
    const texto = (el.getAttribute('title') || '').trim();
    if (!texto) return;
    if (objetivo === el) return;
    ocultar();
    // Se quita YA, no al mostrar: entre el cursor y los 120 ms de espera, el
    // navegador ya habría empezado a contar para su propio globo.
    el.dataset.ayuda = texto;
    el.removeAttribute('title');
    objetivo = el;
    clearTimeout(tEntrar);
    tEntrar = setTimeout(() => mostrar(el, texto), ESPERA_ENTRAR);
  }

  const salir = () => { clearTimeout(tEntrar); clearTimeout(tSalir); tSalir = setTimeout(ocultar, ESPERA_SALIR); };

  // ── Enganches ─────────────────────────────────────────────────────────────
  // Delegados en el documento: vale para lo que ya está y para lo que se pinte
  // después, que en este sistema es casi todo.
  document.addEventListener('mouseover', e => {
    const el = e.target.closest && e.target.closest('[title]');
    if (el) entrar(el); else if (objetivo && !objetivo.contains(e.target)) salir();
  });
  document.addEventListener('mouseout', e => {
    const el = e.target.closest && e.target.closest('[data-ayuda]');
    if (el && el === objetivo) salir();
  });
  // Con el teclado también: quien navega con el tabulador tiene el mismo
  // derecho a saber qué es ese número.
  document.addEventListener('focusin', e => {
    const el = e.target.closest && e.target.closest('[title]');
    if (el) entrar(el);
  });
  document.addEventListener('focusout', () => { if (objetivo) salir(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ocultar(); });
  // Al moverse la página el globo señalaría a otro sitio: mejor que desaparezca
  // que que mienta.
  global.addEventListener('scroll', () => { if (objetivo) ocultar(); }, true);
  global.addEventListener('resize', ocultar);
  // Un clic quita el globo: ya has decidido, no hace falta la explicación.
  document.addEventListener('mousedown', ocultar, true);

  global.Ayudas = {
    /** Encenderlas o apagarlas en caliente, sin recargar. */
    activar(si) {
      document.documentElement.setAttribute('data-ayudas', si ? '1' : '0');
      if (!si) ocultar();
    },
    activas,
    ocultar,
  };
})(window);
