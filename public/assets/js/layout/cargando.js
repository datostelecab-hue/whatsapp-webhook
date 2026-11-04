// views/layout-gestion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const overlay = document.getElementById('cargando-overlay');
  let activos = 0, inicial = true;

  // La animación es CSS: oculto no se pinta, así que no hay nada que pausar.
  // Mientras tapa, el contenido va marcado como ocupado (`aria-busy` en el
  // <main>, no en el <body>: en un antepasado del velo callaría su «Cargando»).
  // El <main> va después de este script: al principio aún no existe, y se marca
  // en cuanto lo hay (DOMContentLoaded, abajo).
  const ocupado = si => {
    const m = document.querySelector('main');
    if (m) { if (si) m.setAttribute('aria-busy', 'true'); else m.removeAttribute('aria-busy'); }
  };
  const mostrar = () => { overlay.classList.remove('hidden'); ocupado(true); };
  const ocultar = () => { overlay.classList.add('hidden'); ocupado(false); };
  document.addEventListener('DOMContentLoaded', () => ocupado(!overlay.classList.contains('hidden')));
  const ocultarSiLibre = () => { if (activos <= 0) { activos = 0; ocultar(); } };

  // CARGA INICIAL: la marca tapa desde el primer pintado, en lugar de los textos
  // "Leyendo el tablero…", "Calculando la semana…", etc., y se mantiene hasta que
  // llegan TODOS los datos del módulo. Red de seguridad a los 15 s por si algo cuelga.
  mostrar();
  setTimeout(() => { terminarInicial(); activos = 0; ocultar(); }, 15000);

  // SOLO LA CARGA INICIAL (03/11/2026, Camilo: «quita el velo de los clics»).
  // Antes también tapaba cualquier consulta lanzada cerca de un clic, y era lo
  // único que paraba el doble clic en las pantallas que guardaban sin apagar el
  // botón; eso ahora lo hace Api con su `boton`. Mientras carga la página se
  // cuentan sus consultas, para no destapar antes de que lleguen los datos, y en
  // cuanto termina window.fetch vuelve a ser el del navegador. Quien guardó una
  // referencia durante la carga (el Planificador) la sigue usando, pero ya no
  // cuenta nada: se mira `inicial` en cada llamada.
  const origFetch = window.fetch;
  const contar = function (url, opt) {
    if (!inicial) return origFetch(url, opt);
    activos++; mostrar();
    const fin = () => { activos = Math.max(0, activos - 1); ocultarSiLibre(); };
    return origFetch(url, opt).then(r => { fin(); return r; }, e => { fin(); throw e; });
  };
  window.fetch = contar;
  function terminarInicial() {
    inicial = false;
    if (window.fetch === contar) window.fetch = origFetch;
  }

  // Cuando la página termina de cargar dejamos de tratar todo como carga inicial;
  // si ya no queda ninguna consulta en vuelo, ocultamos (las que sigan en vuelo
  // destapan al acabar).
  window.addEventListener('load', () => setTimeout(() => { terminarInicial(); ocultarSiLibre(); }, 300));

  // Nota: NO tapamos al pulsar un enlace de módulo; el logo sale ya en la página
  // destino mientras carga sus datos (evita que el logo aparezca "dos veces").

  // Al volver por el historial (bfcache) los datos ya están: no tapar.
  window.addEventListener('pageshow', (e) => { if (e.persisted) { activos = 0; terminarInicial(); ocultar(); } });

  // Control manual para acciones que NO pasan por un fetch cerca de un clic
  // (p. ej. subir un archivo soltado o pegado). abrir()/cerrar() se equilibran.
  window.telecabCarga = {
    abrir() { activos++; mostrar(); },
    cerrar() { activos = Math.max(0, activos - 1); ocultarSiLibre(); }
  };
})();
