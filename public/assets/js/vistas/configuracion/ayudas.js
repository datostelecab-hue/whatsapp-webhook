// views/configuracion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

// ── EL INTERRUPTOR DE LAS AYUDAS ────────────────────────────────────────────
// Se enciende y se apaga EN CALIENTE: `Ayudas.activar` cambia la marca del
// documento, así que se nota en la misma pantalla sin recargar. Y además se
// guarda en el perfil, para el resto de dispositivos.
(function () {
  const caja = document.getElementById('p-ayudas');
  const msg = document.getElementById('ayudas-msg');
  if (!caja) return;

  caja.checked = document.documentElement.getAttribute('data-ayudas') !== '0';

  caja.addEventListener('change', async () => {
    const si = caja.checked;
    if (window.Ayudas) window.Ayudas.activar(si);   // se ve al momento
    msg.textContent = 'Guardando…';
    msg.className = 'text-xs text-telecab-muted mt-3';
    try {
      const r = await (await fetch('/configuracion/mis-ayudas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ayudas: si }),
      })).json();
      if (r.status !== 'ok') throw new Error(r.msg || 'No se ha podido guardar');
      msg.textContent = si
        ? '✓ Las ayudas están encendidas. Pasa el cursor por encima de este texto para verlas.'
        : '✓ Apagadas. Vuelven los globos del navegador de siempre.';
      msg.className = 'text-xs text-telecab-green mt-3';
    } catch (e) {
      // Se devuelve la casilla a donde estaba: dejarla marcada cuando no se ha
      // guardado es decirle a alguien que su preferencia está puesta y no lo está.
      caja.checked = !si;
      if (window.Ayudas) window.Ayudas.activar(!si);
      msg.textContent = e.message;
      msg.className = 'text-xs text-telecab-red mt-3';
    }
  });
})();
