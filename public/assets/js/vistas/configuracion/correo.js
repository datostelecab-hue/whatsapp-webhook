// views/configuracion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const card = document.getElementById('card-correo');
  if (!card) return;
  const $ = id => document.getElementById(id);
  const msg = $('c-msg');
  const aviso = (t, cls) => { msg.textContent = t; msg.className = 'text-xs mt-2 ' + cls; msg.classList.remove('hidden'); };
  // Por Api (03/11/2026), como el de usuarios: el `boton` frena el doble clic y
  // al fallar se devuelve igualmente un objeto con `status`.
  async function post(url, body, boton) {
    try { return await Api.post(url, body || {}, { boton }); }
    catch (e) { return e.respuesta || { status: 'error', msg: e.message }; }
  }
  function pintar(e) {
    $('c-host').value = e.host || '';
    $('c-port').value = e.port || '587';
    $('c-user').value = e.user || '';
    $('c-from').value = e.from || '';
    $('c-pass-nota').textContent = e.tienePass ? '(guardada — déjala vacía para no cambiarla)' : '(requerida)';
    $('c-estado').innerHTML = e.activo
      ? '<span class="text-telecab-green"><i class="fa-solid fa-circle-check"></i> Envío activo</span>'
      : (e.envCredenciales ? '<span class="text-telecab-gold">Usando credenciales del servidor</span>' : '<span class="text-telecab-muted">Sin configurar</span>');
  }
  async function cargar() { try { const r = await (await fetch('/configuracion/correo')).json(); if (r.status === 'ok') pintar(r.estado); } catch (_) {} }

  $('c-guardar').addEventListener('click', async () => {
    const body = { host: $('c-host').value.trim(), port: $('c-port').value.trim(), user: $('c-user').value.trim(), from: $('c-from').value.trim() };
    if ($('c-pass').value) body.pass = $('c-pass').value;
    const r = await post('/configuracion/correo', body, $('c-guardar'));
    if (r.status !== 'ok') return aviso(r.msg || 'No se pudo guardar', 'text-telecab-red');
    $('c-pass').value = ''; pintar(r.estado); aviso('Guardado.', 'text-telecab-green');
  });
  $('c-prueba').addEventListener('click', async () => {
    aviso('Enviando prueba…', 'text-telecab-muted');
    const to = $('c-prueba-to').value.trim();
    const r = await post('/configuracion/correo/prueba', to ? { to } : {}, $('c-prueba'));
    if (r.enviado) aviso('Prueba enviada a ' + (to || 'tu correo') + '. Revísalo (mira también spam).', 'text-telecab-green');
    else aviso('No se pudo enviar: ' + (r.msg || 'revisa los datos'), 'text-telecab-red');
  });
  cargar();
})();
