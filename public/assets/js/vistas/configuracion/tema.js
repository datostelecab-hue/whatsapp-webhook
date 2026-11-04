// views/configuracion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.

  const DEL_SERVIDOR = Casa.datos();
  const KEY = 'telecab-tema';
  // Cada tema: clave (= data-theme), nombre, y colores de la mini-vista-previa.
  const TEMAS = [
    // Desde el 27/09/2026 las superficies son las mismas en todos los temas
    // (grafito en oscuro, blanco en claro): de un tema a otro cambia el ACENTO.
    // Los colores son los de public/assets/css/telecab.css.
    { k: 'dark',       n: 'Oscuro',          bg: '#16181c', ac: '#e3b23c', tx: '#e8eaed', claro: false },
    { k: 'azul',       n: 'Azul',            bg: '#16181c', ac: '#6898e4', tx: '#e8eaed', claro: false },
    { k: 'verde',      n: 'Verde',           bg: '#16181c', ac: '#4cba8a', tx: '#e8eaed', claro: false },
    { k: 'purpura',    n: 'Púrpura',         bg: '#16181c', ac: '#9886e2', tx: '#e8eaed', claro: false },
    { k: 'rosa',       n: 'Rosa',            bg: '#16181c', ac: '#de74a2', tx: '#e8eaed', claro: false },
    { k: 'cian',       n: 'Cian',            bg: '#16181c', ac: '#40bcb8', tx: '#e8eaed', claro: false },
    { k: 'naranja',    n: 'Naranja',         bg: '#16181c', ac: '#e4883e', tx: '#e8eaed', claro: false },
    { k: 'contraste',  n: 'Alto contraste',  bg: '#000000', ac: '#ffd60a', tx: '#ffffff', claro: false },
    { k: 'light',         n: 'Claro',           bg: '#ffffff', ac: '#966a00', tx: '#181c22', claro: true },
    { k: 'claro-azul',    n: 'Claro azul',      bg: '#ffffff', ac: '#1d4eaa', tx: '#181c22', claro: true },
    { k: 'claro-verde',   n: 'Claro verde',     bg: '#ffffff', ac: '#146e46', tx: '#181c22', claro: true },
    { k: 'claro-rosa',    n: 'Claro rosa',      bg: '#ffffff', ac: '#aa1e5a', tx: '#181c22', claro: true },
    { k: 'claro-purpura', n: 'Claro púrpura',   bg: '#ffffff', ac: '#643cbe', tx: '#181c22', claro: true },
    { k: 'claro-naranja', n: 'Claro naranja',   bg: '#ffffff', ac: '#b0460c', tx: '#181c22', claro: true },
    { k: 'auto',          n: 'Automático',      bg: 'auto',    ac: '#8e949e', tx: '#8e949e', claro: false }
  ];

  const resolver = pref => pref === 'auto'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : pref;
  const aplicar = pref => document.documentElement.setAttribute('data-theme', resolver(pref));

  function preview(t) {
    if (t.k === 'auto') {
      // Mitad oscuro / mitad claro para representar "automático".
      return `<div style="height:52px;border-radius:8px;overflow:hidden;display:flex;">
          <div style="flex:1;background:#16181c;display:flex;align-items:center;justify-content:center;">
            <span style="width:12px;height:12px;border-radius:50%;background:#e3b23c;"></span></div>
          <div style="flex:1;background:#ffffff;display:flex;align-items:center;justify-content:center;">
            <span style="width:12px;height:12px;border-radius:50%;background:#966a00;"></span></div>
        </div>`;
    }
    return `<div style="height:52px;border-radius:8px;background:${t.bg};border:1px solid ${t.claro ? '#dee2e7' : '#2c3037'};padding:8px 10px;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="width:11px;height:11px;border-radius:50%;background:${t.ac};"></span>
          <span style="height:5px;width:38%;border-radius:3px;background:${t.tx};opacity:.85;"></span>
        </div>
        <div style="display:flex;gap:4px;align-items:center;">
          <span style="height:4px;width:55%;border-radius:3px;background:${t.tx};opacity:.35;"></span>
          <span style="height:14px;width:22px;border-radius:5px;background:${t.ac};opacity:.22;border:1px solid ${t.ac};"></span>
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
