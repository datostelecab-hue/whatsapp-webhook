/* ============================================================
 * AVISO · EFECTIVO ACTIVO Y NUNCA UNA ENTREGA (27/10/2026)
 * ============================================================
 * Camilo: «necesito un PopUp como el de los cumpleaños pero solo para Víctor y
 * Dahian, en el cual salgan las personas con efectivo activo, desestima a los
 * que ya entregaron efectivo así sea una vez en recaudación».
 *
 * UNA tarjeta abajo a la derecha, con el aspecto de las de cumpleaños
 * (cumpleanos.js): quien tiene el efectivo activado en BOLT y nunca ha pasado
 * por la ventanilla. Primero los que siguen en plantilla (a esos se les llama),
 * después los que ya no (a esos se les quita el efectivo en BOLT).
 *
 * Solo se cierra con la X, y cerrada no vuelve hasta mañana en este navegador:
 * al día siguiente sale otra vez si sigue habiendo alguien. Si hay tarjetas de
 * cumpleaños, se pone encima de ellas para no taparlas.
 *
 * La carga layout-gestion.ejs para quien tiene la llave '/avisos/efectivo'
 * (Víctor y Daiane, db/220), y el servidor lo vuelve a mirar
 * (modules/Administracion/avisoEfectivo.service.js).
 */
(function () {
  const yo = (document.currentScript && document.currentScript.dataset.usuario) || '';
  if (!yo) return;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tit = s => String(s || '').toLowerCase().replace(/(^|[\s-])\S/g, c => c.toUpperCase());
  const euros = n => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
  const ddmm = iso => { const [, m, d] = String(iso || '').split('-'); return d && m ? `${d}/${m}` : ''; };
  // +34622947704 → 622 94 77 04. Lo que no sea un móvil de 9 cifras, tal cual.
  const telVisto = e164 => {
    const d = String(e164 || '').replace(/\D/g, '').replace(/^34(?=\d{9}$)/, '');
    return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7)}` : String(e164 || '');
  };

  // ── Cerrada hoy, en este navegador ────────────────────────────────────────
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  const CLAVE = `telecab:aviso-efectivo:v1:${yo}:${hoy}`;
  const cerradaHoy = () => { try { return localStorage.getItem(CLAVE) === '1'; } catch (_) { return false; } };
  const apuntarCerrada = () => { try { localStorage.setItem(CLAVE, '1'); } catch (_) {} };

  // ── El estilo, el de las tarjetas de cumpleaños ───────────────────────────
  const css = `
  #efec-aviso { position: fixed; right: 16px; bottom: 16px; z-index: 90; width: min(360px, calc(100vw - 32px));
    border-radius: 1rem; padding: 14px 16px 14px 18px; overflow: hidden;
    background: rgb(var(--tc-card)); color: rgb(var(--tc-text));
    border: 1px solid rgb(var(--tc-border)); box-shadow: 0 18px 40px -18px rgb(0 0 0 / .55);
    animation: efec-entra .32s cubic-bezier(.23, 1, .32, 1);
    transition: opacity .18s ease, transform .18s cubic-bezier(.23, 1, .32, 1), bottom .2s cubic-bezier(.23, 1, .32, 1); }
  @keyframes efec-entra { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  #efec-aviso::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: rgb(var(--tc-warn)); }
  .efec-tipo { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600;
    color: rgb(var(--tc-warn)); margin-right: 28px; }
  .efec-titulo { font-size: 16px; font-weight: 700; line-height: 1.25; margin-top: 4px; text-wrap: balance; }
  .efec-texto { font-size: 12.5px; line-height: 1.45; color: rgb(var(--tc-muted)); margin-top: 4px; }
  .efec-x { position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; border-radius: 10px;
    display: grid; place-items: center; color: rgb(var(--tc-muted)); background: transparent; border: 0; cursor: pointer; }
  .efec-x:hover { background: rgb(var(--tc-border) / .45); color: rgb(var(--tc-text)); }
  .efec-x:focus-visible, .efec-btn:focus-visible, .efec-tel:focus-visible { outline: 2px solid rgb(var(--tc-gold)); outline-offset: 1px; }
  .efec-lista { margin-top: 10px; max-height: min(300px, 42vh); overflow-y: auto; overscroll-behavior: contain;
    border-top: 1px solid rgb(var(--tc-border) / .7); }
  .efec-grupo { font-size: 11px; font-weight: 600; color: rgb(var(--tc-muted)); padding: 10px 0 2px; }
  .efec-fila { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; align-items: center;
    padding: 7px 0; border-bottom: 1px solid rgb(var(--tc-border) / .45); }
  .efec-fila:last-child { border-bottom: 0; }
  .efec-nombre { font-size: 13px; font-weight: 600; line-height: 1.3; min-width: 0; }
  .efec-dato { grid-column: 1; font-size: 11.5px; color: rgb(var(--tc-muted)); font-variant-numeric: tabular-nums; }
  .efec-dato b { color: rgb(var(--tc-text)); font-weight: 600; }
  .efec-chip { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 6px;
    background: rgb(var(--tc-border) / .5); color: rgb(var(--tc-muted)); margin-left: 6px; vertical-align: 1px; }
  .efec-tel { grid-column: 2; grid-row: 1 / span 2; font-size: 12px; font-weight: 600; white-space: nowrap;
    color: rgb(var(--tc-gold)); text-decoration: none; padding: 6px 8px; border-radius: 8px;
    font-variant-numeric: tabular-nums; }
  @media (hover: hover) and (pointer: fine) { .efec-tel:hover { background: rgb(var(--tc-border) / .45); } }
  .efec-acciones { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .efec-btn { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 14px; border-radius: 10px;
    font-size: 12.5px; font-weight: 600; text-decoration: none; border: 1px solid transparent;
    background: rgb(var(--tc-gold)); color: rgb(var(--tc-on-gold));
    transition: background-color .15s ease, transform .12s cubic-bezier(.23, 1, .32, 1); }
  .efec-btn:active { transform: scale(.97); }
  @media (hover: hover) and (pointer: fine) { .efec-btn:hover { background: rgb(var(--tc-gold-soft)); } }
  @media (prefers-reduced-motion: reduce) { #efec-aviso { animation: none; transition: opacity .2s ease; } }
  @media print { #efec-aviso { display: none; } }`;

  function estilo() {
    if (document.getElementById('efec-estilo')) return;
    const st = document.createElement('style');
    st.id = 'efec-estilo';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ── Encima de los cumpleaños, si los hay ──────────────────────────────────
  // Las tarjetas de cumpleaños asoman hasta 30 px por encima de su caja (el mazo).
  function colocar(el) {
    const pila = document.getElementById('cumple-pila');
    el.style.bottom = pila ? `${16 + pila.offsetHeight + 30 + 12}px` : '16px';
  }
  function seguirAlMazo(el) {
    const re = () => { if (el.isConnected) colocar(el); };
    let ro = null;
    const mirarPila = () => {
      const pila = document.getElementById('cumple-pila');
      if (ro) { ro.disconnect(); ro = null; }
      if (pila && window.ResizeObserver) { ro = new ResizeObserver(re); ro.observe(pila); }
      re();
    };
    new MutationObserver(mirarPila).observe(document.body, { childList: true });
    mirarPila();
  }

  // ── La tarjeta ────────────────────────────────────────────────────────────
  function fila(p) {
    const partes = [];
    if (!p.enPlantilla && p.baja) partes.push(`baja el ${ddmm(p.baja)}`);
    partes.push(p.debe > 0.005 ? `debe <b>${esc(euros(p.debe))}</b>` : 'sin deuda en BOLT');
    return `<div class="efec-fila">
        <span class="efec-nombre">${esc(tit(p.nombre))}${p.ett ? '<span class="efec-chip">ETT</span>' : ''}</span>
        ${p.telefono ? `<a class="efec-tel" href="tel:${esc(p.telefono)}" title="Llamar a ${esc(tit(p.nombre))}">${esc(telVisto(p.telefono))}</a>` : ''}
        <span class="efec-dato">${partes.join(' · ')}</span>
      </div>`;
  }

  function pintar(d) {
    estilo();
    const siguen = d.gente.filter(p => p.enPlantilla);
    const fuera = d.gente.filter(p => !p.enPlantilla);
    const n = d.gente.length;
    const el = document.createElement('article');
    el.id = 'efec-aviso';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Efectivo activo sin entregar');
    el.innerHTML = `
      <button type="button" class="efec-x" aria-label="Cerrar hasta mañana" title="Cerrar hasta mañana"><i class="fa-solid fa-xmark"></i></button>
      <p class="efec-tipo"><i class="fa-solid fa-money-bill-wave"></i>Efectivo activo sin entregar</p>
      <p class="efec-titulo">${n === 1 ? '1 persona tiene' : `${n} personas tienen`} el efectivo activo y nunca ${n === 1 ? 'ha' : 'han'} entregado</p>
      <p class="efec-texto">BOLT les deja cobrar en mano y no han pasado ni una vez por Recaudación.</p>
      <div class="efec-lista">
        ${siguen.length ? `<p class="efec-grupo">Siguen en plantilla · ${siguen.length}</p>${siguen.map(fila).join('')}` : ''}
        ${fuera.length ? `<p class="efec-grupo">Ya no trabajan aquí · ${fuera.length} · hay que quitarles el efectivo en BOLT</p>${fuera.map(fila).join('')}` : ''}
      </div>
      ${d.puedeRecaudacion ? '<div class="efec-acciones"><a class="efec-btn" href="/recaudacion"><i class="fa-solid fa-cash-register"></i>Abrir Recaudación</a></div>' : ''}`;
    el.querySelector('.efec-x').addEventListener('click', () => {
      apuntarCerrada();
      el.style.opacity = '0';
      el.style.transform = 'translateY(12px) scale(.98)';
      setTimeout(() => el.remove(), 180);
    });
    document.body.appendChild(el);
    seguirAlMazo(el);
  }

  async function cargar() {
    if (cerradaHoy()) return;
    try {
      const r = await fetch('/avisos/efectivo/api', { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const d = await r.json();
      if (d.status !== 'ok' || !d.ver || !(d.gente || []).length) return;
      pintar(d);
    } catch (_) { /* sin aviso: la pantalla sigue igual */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cargar);
  else cargar();
})();
