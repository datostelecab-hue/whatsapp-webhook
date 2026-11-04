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
        // A quien aprueba, cuántas correcciones de fichaje le esperan. Solo lo
        // manda el servidor a quien tiene la llave; al resto no le sale nada.
        const nav = document.getElementById('nav-fichaje');
        if (nav) {
          let chapa = nav.querySelector('[data-corr]');
          const n = Number(r.correccionesPorAprobar || 0);
          if (n > 0) {
            if (!chapa) {
              chapa = document.createElement('span');
              chapa.setAttribute('data-corr', '');
              chapa.className = 'text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-telecab-azul/20 text-telecab-azul';
              nav.appendChild(chapa);
            }
            chapa.textContent = n;
            chapa.title = n + ' corrección(es) de fichaje esperando a que las apruebes';
          } else if (chapa) chapa.remove();
        }
      }
    } catch (_) { /* si falla, el botón simplemente no sale */ }
  }

  // La pantalla de fichaje avisa por aquí en cuanto alguien ficha. Sin esto, se
  // ficha la entrada y la barra sigue diciendo "Fichar entrada" hasta el
  // siguiente refresco: parece que no ha funcionado y la gente vuelve a pulsar.
  window.__refrescarFichaje = cargar;

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
// Los pedidos desde el corte y sin cerrar. Se piden al cargar, cada dos minutos y al volver
// a la pestaña; la bandeja los pide también al tocar un ticket
// (window.__refrescarBandejas), para que el número baje en el momento.
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
  let pidiendo = false;
  async function cargar() {
    if (pidiendo) return;
    pidiendo = true;
    try {
      const r = await fetch('/bandejas/api/pendientes').then(x => x.json());
      if (r.status !== 'ok') return;
      (r.bandejas || []).forEach(b => {
        const a = barra.querySelector('[data-tk-area="' + b.area + '"]');
        if (!a) return;
        const pinta = (el, n, nombre) => {
          const c = el.querySelector('[data-tk-n]');
          c.textContent = n;
          c.className = BASE + (n ? 'bg-telecab-gold/20 text-telecab-gold' : 'bg-telecab-card2 text-telecab-muted');
          el.title = nombre + ': ' + (n ? n + (n === 1 ? ' ticket pendiente' : ' tickets pendientes') : 'nada pendiente') +
            ' desde el ' + r.desde;
        };
        pinta(a, b.pendientes, b.etiqueta);
        // Las partes (RRHH en pantalla grande). «Otros» solo se enseña si tiene algo.
        (b.partes || []).forEach(p => {
          const el = barra.querySelector('[data-tk-parte="' + b.area + '|' + p.clave + '"]');
          if (!el) return;
          pinta(el, p.pendientes, el.querySelector('span').textContent);
          if (el.hasAttribute('data-tk-otros')) {
            el.classList.toggle('hidden', !p.pendientes);
            el.classList.toggle('flex', !!p.pendientes);
          }
        });
      });
    } catch (_) { /* si falla, los cuadros siguen sin número */ }
    finally { pidiendo = false; }
  }
  window.__refrescarBandejas = cargar;
  cargar();
  setInterval(cargar, 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(); });
})();
