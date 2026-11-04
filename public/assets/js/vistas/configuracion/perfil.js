// views/configuracion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const card = document.getElementById('card-perfil');
  if (!card) return;
  const $ = id => document.getElementById(id);
  const msg = $('p-msg');
  const aviso = (t, cls) => { msg.textContent = t; msg.className = 'text-xs ml-auto ' + cls; msg.classList.remove('hidden'); };
  const cMsg = $('p-correo-msg');
  const cAviso = (t, cls) => { cMsg.textContent = t; cMsg.className = 'text-xs ' + cls; cMsg.classList.remove('hidden'); };

  async function estadoCorreo() {
    try {
      const r = await (await fetch('/configuracion/mi-correo')).json();
      if (r.status === 'ok') $('p-correo-estado').innerHTML = r.tieneCorreo
        ? '<span class="text-telecab-green">✓ guardada (déjala vacía para no cambiarla)</span>'
        : '<span class="text-telecab-gold">— aún sin configurar</span>';
    } catch (_) {}
  }
  estadoCorreo();

  async function guardarPerfil(incluirCorreo) {
    const body = { nombre: $('p-nombre').value.trim(), apellidos: $('p-apellidos').value.trim(), telefono: $('p-telefono').value.trim() };
    // dd/mm/aaaa → aaaa-mm-dd; vacía, se borra.
    const fn = $('p-nacimiento').value.trim();
    const m = fn.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    body.fecha_nacimiento = m ? `${m[3]}-${m[2]}-${m[1]}` : (fn ? 'mal' : '');
    if (incluirCorreo && $('p-pass-correo').value) body.pass_correo = $('p-pass-correo').value;
    return (await fetch('/configuracion/mi-perfil', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  }

  // Sin el velo (03/11/2026), los dos botones se apagan mientras dura lo suyo:
  // es lo que impide guardar o mandar la prueba dos veces con un doble clic.
  $('p-guardar').addEventListener('click', async () => {
    if (!$('p-nombre').value.trim()) return aviso('Pon tu nombre.', 'text-telecab-red');
    const b = $('p-guardar');
    b.disabled = true;
    try {
      const r = await guardarPerfil(true);
      if (r.status !== 'ok') return aviso(r.msg || 'No se pudo guardar', 'text-telecab-red');
      $('p-pass-correo').value = '';
      aviso('Guardado.', 'text-telecab-green');
      estadoCorreo();
    } catch (_) { aviso('No se pudo guardar', 'text-telecab-red'); }
    finally { b.disabled = false; }
  });

  $('p-probar-correo').addEventListener('click', async () => {
    const b = $('p-probar-correo');
    b.disabled = true;
    try {
      // Si escribió una contraseña nueva, se guarda antes de probar.
      if ($('p-pass-correo').value) {
        const g = await guardarPerfil(true);
        if (g.status !== 'ok') return cAviso(g.msg || 'No se pudo guardar la contraseña', 'text-telecab-red');
        $('p-pass-correo').value = '';
        estadoCorreo();
      }
      cAviso('Enviando prueba…', 'text-telecab-muted');
      const r = await (await fetch('/configuracion/mi-perfil/probar-correo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })).json();
      if (r.enviado) cAviso('Prueba enviada a tu correo. Revísalo (mira también spam).', 'text-telecab-green');
      else cAviso('No se pudo enviar: ' + (r.msg || 'revisa tu contraseña de correo'), 'text-telecab-red');
    } catch (_) { cAviso('No se pudo enviar la prueba', 'text-telecab-red'); }
    finally { b.disabled = false; }
  });
})();
