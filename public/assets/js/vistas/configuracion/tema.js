// views/configuracion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.

  const DEL_SERVIDOR = Casa.datos();
  const KEY = 'telecab-tema';
  // Cada tema: clave (= data-theme), nombre, y colores de la mini-vista-previa.
  const TEMAS = [
    // V3 (16/11/2026): azul sobre azul marino en oscuro, blanco limpio en claro.
    // Las superficies son las mismas en todos los temas de una familia: de un
    // tema a otro cambia el ACENTO, y ahora con el color entero, no apagado.
    // Los colores son los de public/assets/css/telecab.css.
    { k: 'dark',       n: 'Oscuro',          bg: '#0f1628', ac: '#3b82f6', tx: '#e9eef8', claro: false },
    { k: 'azul',       n: 'Celeste',         bg: '#0f1628', ac: '#38bdf8', tx: '#e9eef8', claro: false },
    { k: 'verde',      n: 'Verde',           bg: '#0f1628', ac: '#34d399', tx: '#e9eef8', claro: false },
    { k: 'purpura',    n: 'Púrpura',         bg: '#0f1628', ac: '#a78bfa', tx: '#e9eef8', claro: false },
    { k: 'rosa',       n: 'Rosa',            bg: '#0f1628', ac: '#f472b6', tx: '#e9eef8', claro: false },
    { k: 'cian',       n: 'Cian',            bg: '#0f1628', ac: '#22d3ee', tx: '#e9eef8', claro: false },
    { k: 'naranja',    n: 'Naranja',         bg: '#0f1628', ac: '#fb923c', tx: '#e9eef8', claro: false },
    { k: 'oro',        n: 'Dorado',          bg: '#0f1628', ac: '#f5be3c', tx: '#e9eef8', claro: false },
    { k: 'contraste',  n: 'Alto contraste',  bg: '#000000', ac: '#ffd60a', tx: '#ffffff', claro: false },
    { k: 'light',         n: 'Claro',           bg: '#ffffff', ac: '#2563eb', tx: '#101828', claro: true },
    { k: 'claro-azul',    n: 'Claro celeste',   bg: '#ffffff', ac: '#0369a1', tx: '#101828', claro: true },
    { k: 'claro-verde',   n: 'Claro verde',     bg: '#ffffff', ac: '#047857', tx: '#101828', claro: true },
    { k: 'claro-rosa',    n: 'Claro rosa',      bg: '#ffffff', ac: '#db2777', tx: '#101828', claro: true },
    { k: 'claro-purpura', n: 'Claro púrpura',   bg: '#ffffff', ac: '#7c3aed', tx: '#101828', claro: true },
    { k: 'claro-naranja', n: 'Claro naranja',   bg: '#ffffff', ac: '#c2410c', tx: '#101828', claro: true },
    { k: 'auto',          n: 'Automático',      bg: 'auto',    ac: '#8b96ae', tx: '#8b96ae', claro: false }
  ];

  const resolver = pref => pref === 'auto'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : pref;
  const aplicar = pref => document.documentElement.setAttribute('data-theme', resolver(pref));

  function preview(t) {
    if (t.k === 'auto') {
      // Mitad oscuro / mitad claro para representar "automático".
      return `<div style="height:52px;border-radius:8px;overflow:hidden;display:flex;">
          <div style="flex:1;background:#0f1628;display:flex;align-items:center;justify-content:center;">
            <span style="width:12px;height:12px;border-radius:50%;background:#3b82f6;"></span></div>
          <div style="flex:1;background:#ffffff;display:flex;align-items:center;justify-content:center;">
            <span style="width:12px;height:12px;border-radius:50%;background:#2563eb;"></span></div>
        </div>`;
    }
    return `<div style="height:52px;border-radius:8px;background:${t.bg};border:1px solid ${t.claro ? '#e2e7f0' : '#24304e'};padding:8px 10px;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="width:11px;height:11px;border-radius:50%;background:${t.ac};"></span>
          <span style="height:5px;width:38%;border-radius:3px;background:${t.tx};opacity:.85;"></span>
        </div>
        <div style="display:flex;gap:4px;align-items:center;">
          <span style="height:4px;width:55%;border-radius:3px;background:${t.tx};opacity:.35;"></span>
          <span style="height:14px;width:26px;border-radius:5px;background:${t.ac};"></span>
        </div>
      </div>`;
  }

  function pintarSel(sel) {
    document.querySelectorAll('.tema').forEach(b => {
      const on = b.dataset.tema === sel;
      b.classList.toggle('border-telecab-gold', on);
      b.classList.toggle('border-2', on);
      b.classList.toggle('border-telecab-border', !on);
    });
    const t = TEMAS.find(x => x.k === sel);
    const el = document.getElementById('tema-msg');
    el.textContent = sel === 'auto'
      ? `Automático — ahora mismo se ve ${resolver('auto') === 'light' ? 'claro' : 'oscuro'}.`
      : `Tema “${(t && t.n) || sel}” activo.`;
  }

  const cont = document.getElementById('temas');
  cont.innerHTML = TEMAS.map(t =>
    `<button data-tema="${t.k}" class="tema text-left p-2 rounded-xl border border-telecab-border hover:border-telecab-gold/50 transition">
       ${preview(t)}
       <span class="block text-xs text-telecab-text mt-2 px-0.5">${t.n}</span>
     </button>`).join('');

  let actual = (DEL_SERVIDOR.tema) || localStorage.getItem(KEY) || 'dark';
  document.querySelectorAll('.tema').forEach(b => b.addEventListener('click', () => {
    actual = b.dataset.tema;
    localStorage.setItem(KEY, actual);
    aplicar(actual); pintarSel(actual);
    // Persiste el tema en el perfil (y en la cookie de sesión): sigue al usuario entre dispositivos.
    // Sin el velo (03/11/2026), el botón apagado es lo que evita mandarlo dos veces con un doble clic.
    b.disabled = true;
    fetch('/configuracion/mi-tema', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tema: actual }) }).catch(() => {})
      .finally(() => { b.disabled = false; });
  }));
  pintarSel(actual);

  // Si está en "automático", seguir al sistema en vivo.
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if ((localStorage.getItem(KEY) || 'dark') === 'auto') { aplicar('auto'); pintarSel('auto'); }
  });
