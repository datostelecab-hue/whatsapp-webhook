/* ============================================================
 * CUMPLEAÑOS — las tarjetas que salen en todas las pantallas
 * ============================================================
 * Camilo, 15/10/2026: «En el perfil de TODOS (sin excepción) saldrán tarjetas
 * de notificación de los conductores que están cumpliendo años ese día… una
 * ventanita emergente que saldrá automáticamente en la pantalla de todos los
 * usuarios, no se podrá cerrar hasta que manualmente le dé click en la x; si
 * son varias, una sobre otra; que diga si es conductor o si es de oficina…
 * al que sea el cumpleañero el sistema lo felicitará a nombre de Telecab».
 *
 * Un MAZO abajo a la derecha: la de arriba se lee entera y las demás asoman
 * detrás. Solo se cierran con la X; cerrada una, sale la siguiente. Lo cerrado
 * se apunta por persona y día en este navegador, para no volver a salir en
 * cada pantalla; si el navegador no deja apuntar, vuelve a salir (es lo seguro).
 *
 * Tres caras:
 *   · CONDUCTOR   azul, «Cumpleaños de un conductor».
 *   · OFICINA     oro, «Cumpleaños en la oficina».
 *   · TÚ          la felicitación de Telecab, para quien cumple.
 *
 * Lo carga layout-gestion.ejs con el id de quien está dentro (data-usuario).
 */
(function () {
  const yo = (document.currentScript && document.currentScript.dataset.usuario) || '';
  if (!yo) return;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pila = n => String(n || '').trim().split(/\s+/)[0] || '';
  const tit = s => String(s || '').toLowerCase().replace(/(^|[\s-])\S/g, c => c.toUpperCase());

  // ── Lo cerrado, por persona y día ──────────────────────────────────────────
  const clave = dia => `telecab:cumple:${yo}:${dia}`;
  const leidas = dia => { try { return new Set(JSON.parse(localStorage.getItem(clave(dia)) || '[]')); } catch (_) { return new Set(); } };
  const apuntar = (dia, id) => {
    try { const s = leidas(dia); s.add(id); localStorage.setItem(clave(dia), JSON.stringify([...s])); } catch (_) {}
  };

  // ── El estilo, una vez ─────────────────────────────────────────────────────
  const css = `
  #cumple-pila { position: fixed; right: 16px; bottom: 16px; z-index: 90; width: min(360px, calc(100vw - 32px));
    display: grid; animation: cumple-entra .32s cubic-bezier(.23, 1, .32, 1); }
  @keyframes cumple-entra { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  #cumple-pila > .cumple-t { grid-area: 1 / 1; align-self: end; transform-origin: 50% 100%;
    transition: transform .26s cubic-bezier(.23, 1, .32, 1), opacity .26s cubic-bezier(.23, 1, .32, 1); }
  .cumple-t { position: relative; border-radius: 1rem; padding: 14px 16px 14px 18px; overflow: hidden;
    background: rgb(var(--tc-card)); color: rgb(var(--tc-text));
    border: 1px solid rgb(var(--tc-border)); box-shadow: 0 18px 40px -18px rgb(0 0 0 / .55); }
  .cumple-t::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: rgb(var(--cumple-tono)); }
  .cumple-t.conductor { --cumple-tono: var(--tc-azul); }
  .cumple-t.oficina   { --cumple-tono: var(--tc-gold); }
  .cumple-t.yo        { --cumple-tono: var(--tc-gold); border-color: rgb(var(--tc-gold) / .55);
    background: linear-gradient(160deg, rgb(var(--tc-gold) / .10), rgb(var(--tc-card)) 55%); }
  .cumple-tipo { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600;
    color: rgb(var(--cumple-tono)); margin-right: 28px; }
  .cumple-nombre { font-size: 16px; font-weight: 700; line-height: 1.25; margin-top: 4px; text-wrap: balance; }
  .cumple-texto { font-size: 12.5px; line-height: 1.45; color: rgb(var(--tc-muted)); margin-top: 4px; }
  .cumple-chip { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 6px;
    background: rgb(var(--tc-border) / .5); color: rgb(var(--tc-muted)); margin-left: 6px; vertical-align: 2px; }
  .cumple-x { position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; border-radius: 10px;
    display: grid; place-items: center; color: rgb(var(--tc-muted)); background: transparent; border: 0; cursor: pointer; }
  .cumple-x:hover { background: rgb(var(--tc-border) / .45); color: rgb(var(--tc-text)); }
  .cumple-x:focus-visible { outline: 2px solid rgb(var(--tc-gold)); outline-offset: 1px; }
  .cumple-cuenta { font-size: 10.5px; color: rgb(var(--tc-muted)); margin-top: 8px; }
  .cumple-firma { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 12px; font-weight: 600; color: rgb(var(--tc-gold)); }
  .cumple-firma img { width: 26px; height: 26px; border-radius: 6px; }
  .cumple-t.yo .cumple-nombre { font-size: 19px; }
  @media (prefers-reduced-motion: reduce) {
    #cumple-pila { animation: none; }
    #cumple-pila > .cumple-t { transition: opacity .2s ease; }
  }
  @media print { #cumple-pila { display: none; } }`;

  // ── Cada tarjeta ───────────────────────────────────────────────────────────
  function htmlDe(t, total, pos) {
    const cuenta = total > 1 ? `<p class="cumple-cuenta">${pos} de ${total} · al cerrar esta sale la siguiente</p>` : '';
    const x = '<button type="button" class="cumple-x" aria-label="Cerrar" title="Cerrar"><i class="fa-solid fa-xmark"></i></button>';
    if (t.tipo === 'yo') {
      return `${x}
        <p class="cumple-tipo"><i class="fa-solid fa-cake-candles"></i>Hoy es tu día</p>
        <p class="cumple-nombre">¡Feliz cumpleaños, ${esc(tit(pila(t.nombre)))}!</p>
        <p class="cumple-texto">Todo el equipo te desea un día estupendo. Gracias por lo que haces cada día.</p>
        <p class="cumple-firma"><img src="/assets/logo-128.png" alt="">De parte de Telecab</p>${cuenta}`;
    }
    if (t.tipo === 'oficina') {
      return `${x}
        <p class="cumple-tipo"><i class="fa-solid fa-cake-candles"></i>Cumpleaños en la oficina</p>
        <p class="cumple-nombre">${esc(tit(`${t.nombre} ${t.apellidos || ''}`.trim()))}${t.rol ? `<span class="cumple-chip">${esc(t.rol)}</span>` : ''}</p>
        <p class="cumple-texto">Hoy cumple años: felicítale cuando le veas.</p>${cuenta}`;
    }
    return `${x}
      <p class="cumple-tipo"><i class="fa-solid fa-cake-candles"></i>Cumpleaños de un conductor</p>
      <p class="cumple-nombre">${esc(tit(t.nombre))}${t.ett ? '<span class="cumple-chip">ETT</span>' : ''}</p>
      <p class="cumple-texto">Hoy cumple años. Si hablas hoy con ${esc(tit(pila(t.nombre)))}, felicítale de parte de Telecab.</p>${cuenta}`;
  }

  // ── El mazo ────────────────────────────────────────────────────────────────
  function pintar(dia, tarjetas) {
    let mazo = document.getElementById('cumple-pila');
    if (!mazo) {
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      mazo = document.createElement('div');
      mazo.id = 'cumple-pila';
      mazo.setAttribute('role', 'region');
      mazo.setAttribute('aria-label', 'Cumpleaños de hoy');
      document.body.appendChild(mazo);
    }
    mazo.innerHTML = '';
    const total = tarjetas.length;
    tarjetas.forEach((t, i) => {
      const el = document.createElement('article');
      el.className = 'cumple-t ' + t.tipo;
      el.innerHTML = htmlDe(t, total, i + 1);
      // La de arriba entera; detrás asoman dos como mucho.
      const atras = Math.min(i, 3);
      el.style.zIndex = String(100 - i);
      el.style.transform = `translateY(${-10 * atras}px) scale(${1 - 0.04 * atras})`;
      el.style.opacity = i > 2 ? '0' : String(1 - 0.18 * atras);
      el.style.pointerEvents = i === 0 ? 'auto' : 'none';
      if (i > 0) el.setAttribute('aria-hidden', 'true');
      el.querySelector('.cumple-x').addEventListener('click', () => {
        apuntar(dia, t.clave);
        el.style.opacity = '0';
        el.style.transform = 'translateY(12px) scale(.98)';
        setTimeout(() => pintar(dia, tarjetas.slice(1)), 180);
      });
      mazo.appendChild(el);
    });
    if (!total) mazo.remove();
  }

  async function cargar() {
    try {
      const r = await fetch('/cumpleanos/api/hoy', { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const d = await r.json();
      if (d.status !== 'ok') return;
      const cerradas = leidas(d.dia);
      const tarjetas = [
        ...(d.felicitar ? [{ tipo: 'yo', clave: 'yo', ...d.felicitar }] : []),
        ...(d.oficina || []).map(o => ({ tipo: 'oficina', clave: 'o' + o.id, ...o })),
        ...(d.conductores || []).map(c => ({ tipo: 'conductor', clave: 'c' + c.id, ...c })),
      ].filter(t => !cerradas.has(t.clave));
      if (tarjetas.length) pintar(d.dia, tarjetas);
    } catch (_) { /* sin tarjetas: la pantalla sigue igual */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cargar);
  else cargar();
})();
