// views/configuracion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const card = document.getElementById('card-usuarios');
  if (!card) return;   // no es superadmin → no hay tarjeta
  const ROLN = { superadmin: 'Superadmin', oficina: 'Oficina', trafico: 'Tráfico' };
  const lista = document.getElementById('u-lista');
  const msg = document.getElementById('u-msg');
  let YO = '';
  const esc = Casa.esc;
  const aviso = (t, cls) => { msg.textContent = t; msg.className = 'text-xs mt-2 ' + cls; msg.classList.remove('hidden'); };
  // Pasa por Api (03/11/2026): sin el velo, el `boton` que se le da es lo que
  // impide crear o cambiar dos veces con un doble clic. Al fallar devuelve
  // igualmente un objeto con `status`, que es lo que miran quienes lo llaman.
  async function api(url, body, boton) {
    try { return await Api.post(url, body || {}, { boton }); }
    catch (e) { return e.respuesta || { status: 'error', msg: e.message }; }
  }

  function fila(u) {
    const el = document.createElement('div');
    el.className = 'flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-telecab-dark/40 border border-telecab-border';
    const bloqueado = u.estado === 'bloqueado';
    const yo = u.email === YO;
    el.innerHTML =
      `<span class="min-w-0 flex-1">
         <span class="block text-sm text-telecab-text truncate">${esc(u.nombre)} ${esc(u.apellidos || '')} ${yo ? '<span class="text-[10px] text-telecab-gold">(tú)</span>' : ''} ${u.debe_cambiar ? '<span class="text-[10px] text-telecab-muted">· provisional</span>' : ''}</span>
         <span class="block text-[11px] text-telecab-muted font-mono truncate">${esc(u.email)}${u.telefono ? ' · ' + esc(u.telefono) : ''}${u.ultimo_acceso ? ' · último: ' + esc(u.ultimo_acceso) : ' · nunca ha entrado'}</span>
       </span>
       <select class="u-rol inp !w-32 text-xs !py-1" data-email="${esc(u.email)}" aria-label="Rol de ${esc(((u.nombre || '') + ' ' + (u.apellidos || '')).trim() || u.email)}">
         ${['superadmin', 'oficina', 'trafico'].map(r => `<option value="${r}" ${u.rol === r ? 'selected' : ''}>${ROLN[r]}</option>`).join('')}
       </select>
       <button class="u-estado text-xs px-2 py-1 rounded-lg border ${bloqueado ? 'border-telecab-red/40 text-telecab-red' : 'border-telecab-green/40 text-telecab-green'}" data-email="${esc(u.email)}" data-estado="${bloqueado ? 'activo' : 'bloqueado'}">${bloqueado ? 'Activar' : 'Desactivar'}</button>
       <button class="u-reset text-xs px-2 py-1 rounded-lg border border-telecab-border text-telecab-muted hover:text-telecab-gold" data-email="${esc(u.email)}" title="Enviar nueva contraseña provisional"><i class="fa-solid fa-key"></i></button>`;
    return el;
  }

  async function cargar() {
    try {
      const r = await (await fetch('/usuarios/api/datos')).json();
      if (r.status !== 'ok') return aviso(r.msg || 'No se pudo cargar la lista', 'text-telecab-red');
      YO = r.yo || '';
      lista.innerHTML = '';
      (r.usuarios || []).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')).forEach(u => lista.appendChild(fila(u)));
    } catch (_) {}
  }

  document.getElementById('u-crear').addEventListener('click', async () => {
    const nombre = document.getElementById('u-nombre').value.trim();
    const apellidos = document.getElementById('u-apellidos').value.trim();
    const telefono = document.getElementById('u-telefono').value.trim();
    const email = document.getElementById('u-email').value.trim();
    const rol = document.getElementById('u-rol').value;
    if (!nombre || !apellidos || !telefono || !email) return aviso('Completa nombre, apellidos, teléfono y correo.', 'text-telecab-red');
    const r = await api('/usuarios/crear', { nombre, apellidos, telefono, email, rol }, document.getElementById('u-crear'));
    if (r.status !== 'ok') return aviso(r.msg || 'No se pudo crear', 'text-telecab-red');
    ['u-nombre', 'u-apellidos', 'u-telefono', 'u-email'].forEach(id => { document.getElementById(id).value = ''; });
    if (r.correoEnviado) aviso('Usuario creado. Se le envió la contraseña provisional por correo.', 'text-telecab-green');
    else aviso('Usuario creado. El correo aún no está configurado → contraseña provisional: ' + r.passwordProvisional + ' (pásasela tú).', 'text-telecab-gold');
    cargar();
  });

  lista.addEventListener('change', async e => {
    const sel = e.target.closest('.u-rol');
    if (!sel) return;
    const r = await api('/usuarios/rol', { email: sel.dataset.email, rol: sel.value });
    if (r.status !== 'ok') aviso(r.msg || 'No se pudo cambiar el rol', 'text-telecab-red');
    cargar();
  });

  lista.addEventListener('click', async e => {
    const est = e.target.closest('.u-estado');
    const res = e.target.closest('.u-reset');
    if (est) {
      const r = await api('/usuarios/estado', { email: est.dataset.email, estado: est.dataset.estado }, est);
      if (r.status !== 'ok') aviso(r.msg || 'No se pudo cambiar el estado', 'text-telecab-red');
      cargar();
    } else if (res) {
      if (!(await Dialogo.confirmar({
        titulo: 'Nueva contraseña provisional', tono: 'aviso', si: 'Enviar la provisional', no: 'Cancelar',
        texto: 'Para ' + res.dataset.email + '. La que tenga ahora deja de valer y se le cierran las sesiones abiertas; al entrar con la provisional se le pedirá crear otra.',
      }))) return;
      const r = await api('/usuarios/reset', { email: res.dataset.email });
      if (r.status !== 'ok') return aviso(r.msg || 'No se pudo resetear', 'text-telecab-red');
      if (r.correoEnviado) aviso('Nueva provisional enviada por correo a ' + res.dataset.email + '.', 'text-telecab-green');
      else aviso('Nueva provisional (correo sin configurar) de ' + res.dataset.email + ': ' + r.passwordProvisional, 'text-telecab-gold');
    }
  });

  cargar();
})();
