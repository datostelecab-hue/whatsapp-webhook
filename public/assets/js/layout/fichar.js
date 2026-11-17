// views/layout-gestion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const btn = document.getElementById('fichar-btn');
  const txt = document.getElementById('fichar-txt');
  if (!btn || !txt) return;

  // QUIÉN TIENE QUE FICHAR LO DICE EL SERVIDOR, no la sesión. La cookie se
  // firmó al entrar y puede ser de antes de que le activaran el fichaje: si
  // esto mirara la cookie, a alguien recién marcado no le saldría el botón
  // hasta volver a entrar, y parecería que no funciona.
  let estado = null, reloj = 0;

  const dur = m => Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');

  function pintar() {
    if (!estado || !estado.debeFichar) { btn.classList.add('hidden'); return; }
    btn.classList.remove('hidden');
    btn.classList.add('flex');
    const abierta = !!estado.abierto;
    // Verde mientras la jornada corre; ámbar cuando falta fichar la entrada,
    // que es la forma de que se vea desde la otra punta de la oficina.
    btn.className = 'flex items-center gap-2 h-9 px-3 rounded-lg text-xs font-semibold transition ' +
      (abierta
        ? 'bg-telecab-green/15 text-telecab-green hover:bg-telecab-green/25'
        : 'bg-telecab-gold/20 text-telecab-gold hover:bg-telecab-gold/30');
    if (abierta) {
      const desde = new Date(estado.abierto.entrada).getTime();
      const tic = () => { txt.textContent = dur(Math.max(0, Math.round((Date.now() - desde) / 60000))); };
      tic();
      clearInterval(reloj);
      reloj = setInterval(tic, 30000);
      btn.title = estado.olvidada
        ? 'Jornada del ' + estado.abierto.dia + ' SIN CERRAR — entra y ciérrala'
        : 'Jornada abierta. Pulsa para fichar la salida';
      if (estado.olvidada) {
        btn.className = 'flex items-center gap-2 h-9 px-3 rounded-lg text-xs font-semibold transition ' +
          'bg-telecab-warn/20 text-telecab-warn hover:bg-telecab-warn/30';
      }
    } else {
      clearInterval(reloj);
      txt.textContent = 'Fichar entrada';
      btn.title = 'Todavía no has fichado hoy';
    }
  }

  async function cargar() {
    try {
      const r = await fetch('/fichaje/api/estado').then(x => x.json());
      if (r.status === 'ok') {
        estado = r; pintar();
        // La entrada del menú sale por lo mismo que el botón: porque el SERVIDOR
        // dice que esta persona ficha. Quien lleva el registro ya la tiene
        // pintada desde el servidor y esto no se la quita.
        if (r.debeFichar) {
          const nav = document.getElementById('nav-fichaje');
          if (nav) nav.classList.remove('hidden');
        }
        // Las correcciones por aprobar ya no se pintan aquí: son el contador
        // «fichaje.correcciones» de la entrada del menú (A9, contadores.js).
      }
    } catch (_) { /* si falla, el botón simplemente no sale */ }
  }

  // La pantalla de fichaje avisa por aquí en cuanto alguien ficha. Sin esto, se
  // ficha la entrada y la barra sigue diciendo "Fichar entrada" hasta el
  // siguiente refresco: parece que no ha funcionado y la gente vuelve a pulsar.
  // Y los contadores: pedir o resolver una corrección cambia el número del menú.
  window.__refrescarFichaje = () => {
    cargar();
    if (window.Contadores) window.Contadores.refrescar();
  };

  // Con retraso, por lo mismo que la campana: no entra en la carga inicial.
  setTimeout(cargar, 1200);
  // Cada 5 min basta: el cronómetro corre solo en el cliente y lo único que
  // cambia por detrás es que alguien fiche desde otra pestaña.
  setInterval(cargar, 300000);
  // Al volver a la pestaña sí conviene mirar: es cuando vuelves de fichar en el
  // móvil y esperas verlo reflejado aquí.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(); });
})();

// ── LOS PENDIENTES DE CADA BANDEJA, EN SU CUADRO ─────────────────────────────
// Los pedidos desde el corte y sin cerrar. Desde el 16/11/2026 (A9) son los
// contadores «tickets.<área>» y sus partes: llegan con todos los demás
// (contadores.js), al momento cuando un ticket cambia y cada dos minutos si no.
// La bandeja los pide también al tocar un ticket (window.__refrescarBandejas).
(function () {
  const barra = document.getElementById('tk-barra');
  if (!barra) return;
  // El cuadro de la bandeja en la que se está, marcado. En el grupo partido, la
  // parte que se está mirando (?grupo=), o el nombre si se mira la bandeja entera.
  const aqui = h => location.pathname === h || location.pathname.startsWith(h + '/');
  const grupo = new URLSearchParams(location.search).get('grupo');
  const marcar = a => { a.classList.add('tk-activo'); a.setAttribute('aria-current', 'page'); };
  barra.querySelectorAll('[data-tk-href]').forEach(a => { if (aqui(a.getAttribute('data-tk-href'))) marcar(a); });
  barra.querySelectorAll('[data-tk-todo]').forEach(a => { if (aqui(a.getAttribute('data-tk-todo')) && !grupo) marcar(a); });
  barra.querySelectorAll('[data-tk-parte]').forEach(a => {
    const u = new URL(a.href, location.origin);
    if (aqui(u.pathname) && grupo && u.searchParams.get('grupo') === grupo) marcar(a);
  });
  const BASE = 'min-w-[22px] h-6 px-1.5 rounded-md text-[11px] font-bold tabular-nums flex items-center justify-center ';
  // Aquí el 0 sí se enseña (el cuadro está siempre), y en oro lo que tiene algo.
  const pinta = (el, v) => {
    if (!v) return;   // sin número todavía: se queda el «·»
    const c = el.querySelector('[data-tk-n]');
    c.textContent = v.n > 99 ? '99+' : v.n;
    c.className = BASE + (v.n ? 'bg-telecab-gold/20 text-telecab-gold' : 'bg-telecab-card2 text-telecab-muted');
    if (v.titulo) el.title = v.titulo;
  };
  function pintarBarra(valores) {
    barra.querySelectorAll('[data-tk-area]').forEach(a => pinta(a, valores['tickets.' + a.getAttribute('data-tk-area')]));
    barra.querySelectorAll('[data-tk-parte]').forEach(el => {
      const [area, clave] = el.getAttribute('data-tk-parte').split('|');
      const v = valores['tickets.' + area + '.' + clave];
      pinta(el, v);
      // «Otros» solo sale si tiene algo.
      if (el.hasAttribute('data-tk-otros')) {
        const hay = !!(v && v.n);
        el.classList.toggle('hidden', !hay);
        el.classList.toggle('flex', hay);
      }
    });
  }
  if (window.Contadores) window.Contadores.alCambiar(pintarBarra);
  window.__refrescarBandejas = () => (window.Contadores ? window.Contadores.refrescar() : null);
})();
