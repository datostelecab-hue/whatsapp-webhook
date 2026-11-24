// ============================================================
// PORTAL — MIS HORAS: el reloj que corre y los números que se refrescan
// ============================================================
// La página sale con los números del servidor. Aquí: «Horas con el coche»
// corre cada segundo (desde que vinculó, con la hora del servidor de
// referencia, no la del móvil) y cada 30 s se piden otra vez las horas de
// BOLT, los km y el estado (/horas/vivo). Con la pestaña escondida no se pide
// nada; al volver, se pide en el momento.
'use strict';
(function () {
  const raiz = document.querySelector('[data-horas]');
  const bolt = document.querySelector('[data-bolt]');
  const $ = sel => document.querySelector(sel);
  const pon = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };
  const dur = s => { s = Math.max(0, Math.round(Number(s) || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`; };
  const reloj = s => { s = Math.max(0, Math.floor(Number(s) || 0)); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const km = n => `${Number(n || 0).toFixed(1).replace('.', ',')} km`;
  const haceTxt = ms => {
    const s = Math.max(0, Math.round((Date.now() + desfase - ms) / 1000));
    return s < 60 ? 'ahora mismo' : s < 3600 ? `desde hace ${Math.round(s / 60)} min` : `desde hace ${dur(s)}`;
  };

  // La hora del servidor manda: el móvil puede ir adelantado o atrasado.
  let desfase = raiz ? Number(raiz.dataset.ahoraMs) - Date.now() : 0;
  let inicio = raiz ? Number(raiz.dataset.inicioMs) : null;

  function pintarReloj() {
    if (raiz && inicio) pon('[data-con-coche]', reloj((Date.now() + desfase - inicio) / 1000));
    const d = $('[data-bolt-desde]');
    if (d && d.dataset.desdeMs) d.textContent = haceTxt(Number(d.dataset.desdeMs));
  }

  function pintarBolt(b) {
    if (!bolt) return;
    const punto = $('[data-bolt-punto]');
    if (punto) punto.className = `hor-punto hor-${(b && b.situacion) || 'desconectado'}`;
    pon('[data-bolt-etiqueta]', (b && b.etiqueta) || 'Sin datos de BOLT');
    const d = $('[data-bolt-desde]');
    if (d) { d.dataset.desdeMs = b && b.desdeMs ? b.desdeMs : ''; d.textContent = ''; }
  }

  async function refrescar() {
    if (document.hidden) return;
    let j;
    try {
      const r = await fetch('/horas/vivo', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      j = await r.json();
      if (!r.ok || !j.ok) return;
    } catch (e) { return; }
    pintarBolt(j.bolt);
    // Si se ha vinculado o desvinculado mientras miraba, la página cambia entera.
    if (!!raiz !== !!j.vinculado) { location.reload(); return; }
    if (!raiz) return pintarReloj();
    desfase = Number(j.ahoraMs) - Date.now();
    inicio = Number(j.inicioMs);
    pon('[data-trabajando]', dur(j.trabajando));
    pon('[data-viaje]', dur(j.viaje));
    pon('[data-espera]', dur(j.espera));
    pon('[data-descanso]', dur(j.descanso));
    pon('[data-utilizacion]', j.utilizacion == null ? '—' : `${j.utilizacion} %`);
    pon('[data-km-bolt]', km(j.kmBolt));
    pon('[data-km-fuera]', km(j.kmFuera));
    const barra = $('[data-barra-viaje]');
    if (barra) barra.style.width = `${j.trabajando ? Math.round((j.viaje / j.trabajando) * 100) : 0}%`;
    const b = $('[data-barra]');
    if (b) b.setAttribute('aria-label', `Viaje ${dur(j.viaje)} y espera ${dur(j.espera)}`);
    pintarReloj();
  }

  pintarReloj();
  setInterval(pintarReloj, 1000);
  setInterval(refrescar, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescar(); });
})();
