// views/layout-gestion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

// IIFE para NO filtrar estos nombres al ámbito global: los scripts de cada vista
// (bitácora, fichas…) también corren en global y declaran su propia función
// `abrir`; sin este aislamiento chocaban ("Identifier 'abrir' already declared")
// y ese error rompía el enganche de los desplegables de departamento.
(function () {
  const menu = document.getElementById('menu');
  const fondo = document.getElementById('menu-fondo');
  const btnAbrir = document.getElementById('menu-abrir');
  const abrir = () => { menu.classList.remove('-translate-x-full'); fondo.classList.remove('hidden'); btnAbrir.setAttribute('aria-expanded', 'true'); };
  const cerrar = () => { menu.classList.add('-translate-x-full'); fondo.classList.add('hidden'); btnAbrir.setAttribute('aria-expanded', 'false'); };
  btnAbrir.addEventListener('click', abrir);
  fondo.addEventListener('click', cerrar);
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', cerrar));

  // ── Menú contraído ──────────────────────────────────────────────────────
  // Tres formas de manejarlo, de la más automática a la más explícita:
  //   · sin preferencia guardada, se decide por el ancho de la pantalla;
  //   · contraído, basta pasar el ratón para verlo entero (lo hace el CSS);
  //   · el botón (o Ctrl+B) fija la decisión y se recuerda.
  const raiz = document.documentElement;
  const btnCorto = document.getElementById('menu-corto');
  const icoCorto = btnCorto.querySelector('i');

  const pintarBoton = () => {
    const corto = raiz.getAttribute('data-menu') === 'corto';
    icoCorto.className = 'fa-solid ' + (corto ? 'fa-angles-right' : 'fa-angles-left');
    const t = corto ? 'Fijar el menú abierto (Ctrl+B)' : 'Contraer el menú (Ctrl+B)';
    btnCorto.title = t;
    btnCorto.setAttribute('aria-label', t);
    btnCorto.setAttribute('aria-expanded', String(!corto));
  };

  // ¿Ha elegido ya alguien, o seguimos decidiendo por el ancho de pantalla?
  let elegido = false;
  try { elegido = localStorage.getItem('telecab-menu') !== null; } catch (e) {}

  const alternar = () => {
    const corto = raiz.getAttribute('data-menu') === 'corto';
    if (corto) raiz.removeAttribute('data-menu');
    else raiz.setAttribute('data-menu', 'corto');
    try { localStorage.setItem('telecab-menu', corto ? 'largo' : 'corto'); } catch (e) {}
    elegido = true;   // a partir de aquí manda la persona, no la ventana
    pintarBoton();
  };

  pintarBoton();
  btnCorto.addEventListener('click', alternar);

  // Ctrl+B, como en cualquier editor. No se roba la tecla mientras se escribe.
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'b') return;
    // Ojo con `matches`: el destino de la tecla no siempre es un elemento (puede
    // ser el propio documento si no hay nada enfocado), y entonces no existe.
    const d = e.target;
    if (d && typeof d.matches === 'function' &&
        (d.matches('input, textarea, select') || d.isContentEditable)) return;
    e.preventDefault();
    alternar();
  });

  // Mientras nadie haya elegido, el menú sigue al tamaño de la ventana. La
  // comprobación va DENTRO del oyente: si estuviera fuera, quien pulsara el
  // botón y luego cambiara el tamaño se encontraría con que le ignora.
  let reloj;
  window.addEventListener('resize', () => {
    if (elegido) return;
    clearTimeout(reloj);
    reloj = setTimeout(() => {
      if (window.innerWidth < 1280) raiz.setAttribute('data-menu', 'corto');
      else raiz.removeAttribute('data-menu');
      pintarBoton();
    }, 150);
  });

  // Desplegables de departamento en el menú.
  document.querySelectorAll('.grupo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const oculto = btn.nextElementSibling.classList.toggle('hidden');
      btn.setAttribute('aria-expanded', String(!oculto));
      btn.querySelector('.grupo-chev').classList.toggle('rotate-180');
    });
  });
})();
