// views/configuracion.ejs — la tarjeta «Notificaciones» (A8, db/250).
//
// Este dispositivo (activar, desactivar, probar) y la lista de los míos, con
// «Quitar». El permiso del navegador solo se pide al pulsar «Activar».

(function () {
  const caja = document.querySelector('#n-cuerpo');
  if (!caja) return;
  const esc = Casa.esc;
  let ocupado = false;

  const fecha = iso => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const TEXTO = {
    activadas: { icono: 'fa-bell text-telecab-gold', texto: 'Activadas en este dispositivo.' },
    apagadas: { icono: 'fa-bell-slash text-telecab-muted', texto: 'No están activadas en este dispositivo.' },
    bloqueadas: {
      icono: 'fa-ban text-telecab-warn',
      texto: 'Bloqueadas en este navegador. Pulsa el candado de la barra de direcciones, pon «Notificaciones» en «Permitir» y recarga la página.',
    },
    instalar: {
      icono: 'fa-mobile-screen text-telecab-warn',
      texto: 'En el iPhone y el iPad solo llegan con el ERP instalado: en Safari, pulsa Compartir → «Añadir a pantalla de inicio», ábrelo desde ese icono y actívalas ahí.',
    },
    'sin-soporte': { icono: 'fa-circle-xmark text-telecab-muted', texto: 'Este navegador no puede recibir notificaciones.' },
  };

  const boton = (accion, icono, texto, principal) => `
    <button type="button" data-accion="${accion}" class="px-4 py-2 rounded-xl border transition font-semibold text-sm ${principal
      ? 'bg-telecab-gold/15 border-telecab-gold/40 text-telecab-gold hover:bg-telecab-gold/25'
      : 'bg-telecab-card2 border-telecab-border text-telecab-text hover:border-telecab-gold'}">
      <i class="fa-solid ${icono} mr-1" aria-hidden="true"></i>${texto}</button>`;

  async function pintar(mensaje) {
    let est, aqui;
    try {
      [est, aqui] = await Promise.all([Api.get('/push/api/estado'), NotificacionesPush.estadoAqui()]);
    } catch (e) {
      caja.innerHTML = `<p class="text-xs text-telecab-warn">No se ha podido leer: ${esc(e.message)}</p>`;
      return;
    }
    // Lo que el navegador tiene, con la sesión de ahora: así «este» sale marcado.
    let esteId = null;
    if (aqui.aqui === 'activadas') {
      const c = await NotificacionesPush.confirmar({ forzar: true }).catch(() => null);
      if (c && c.estado === 'no-esta') aqui = { aqui: 'apagadas' };
      if (c && c.id) esteId = c.id;
    }
    const t = TEXTO[aqui.aqui];
    if (!est.configurado) {
      caja.innerHTML = '<p class="text-xs text-telecab-muted">Aún no están configuradas en el servidor.</p>';
      return;
    }
    const mias = est.mias || [];
    caja.innerHTML = `
      <div class="flex items-start gap-2 text-sm mb-3">
        <i class="fa-solid ${t.icono} mt-0.5" aria-hidden="true"></i><span>${esc(t.texto)}</span>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        ${aqui.aqui === 'apagadas' ? boton('activar', 'fa-bell', 'Activar en este dispositivo', true) : ''}
        ${aqui.aqui === 'activadas' ? boton('desactivar', 'fa-bell-slash', 'Desactivar en este dispositivo') : ''}
        ${mias.length ? boton('probar', 'fa-paper-plane', 'Mandarme una de prueba') : ''}
        <span id="n-msg" class="text-xs ${mensaje ? '' : 'hidden'} ${mensaje && mensaje.error ? 'text-telecab-warn' : 'text-telecab-muted'}" role="status">${mensaje ? esc(mensaje.texto) : ''}</span>
      </div>
      ${mias.length ? `
        <h3 class="text-xs font-semibold text-telecab-text uppercase tracking-wide mt-5 mb-2">Dónde te llegan</h3>
        <ul class="space-y-2">${mias.map(d => `
          <li class="flex items-center gap-3 px-3 py-2 rounded-xl bg-telecab-card2 border border-telecab-border">
            <i class="fa-solid ${/iPhone|Android|iPad/.test(d.dispositivo || '') ? 'fa-mobile-screen' : 'fa-display'} text-telecab-muted w-4 text-center" aria-hidden="true"></i>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold truncate">${esc(d.dispositivo || 'Un dispositivo')}${d.id === esteId ? ' <span class="text-telecab-gold text-xs">(este)</span>' : ''}</p>
              <p class="text-[11px] text-telecab-muted">Activadas el ${esc(fecha(d.creado))}${d.ultimoAviso ? ` · última el ${esc(fecha(d.ultimoAviso))}` : ''}${
                d.sesionAbierta ? '' : ' · <span class="text-telecab-warn">ahora no le llegan: su sesión está cerrada</span>'}</p>
            </div>
            <button type="button" data-quitar="${d.id}" class="w-8 h-8 rounded-lg border border-telecab-border text-telecab-muted hover:border-telecab-gold/50 hover:text-telecab-gold"
                    aria-label="Quitar ${esc(d.dispositivo || 'este dispositivo')}" title="Quitar"><i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i></button>
          </li>`).join('')}</ul>` : ''}`;
  }

  caja.addEventListener('click', async e => {
    const b = e.target.closest('[data-accion], [data-quitar]');
    if (!b || ocupado) return;
    ocupado = true;
    b.disabled = true;
    let mensaje = null;
    try {
      if (b.dataset.quitar) {
        await Api.post('/push/api/quitar', { id: Number(b.dataset.quitar) });
        mensaje = { texto: 'Quitado: ya no te llegan a ese dispositivo.' };
      } else if (b.dataset.accion === 'activar') {
        await NotificacionesPush.activar();
        mensaje = { texto: 'Activadas. Prueba a mandarte una.' };
      } else if (b.dataset.accion === 'desactivar') {
        await NotificacionesPush.desactivar();
        mensaje = { texto: 'Desactivadas en este dispositivo.' };
      } else if (b.dataset.accion === 'probar') {
        const r = await Api.post('/push/api/probar', {});
        mensaje = r.enviados
          ? { texto: `Mandada a ${r.enviados} dispositivo${r.enviados === 1 ? '' : 's'}${r.fallidos ? ` (${r.fallidos} no la ${r.fallidos === 1 ? 'aceptó' : 'aceptaron'})` : ''}.` }
          : { texto: r.dispositivos ? 'No ha llegado a ninguno: inténtalo en un momento.' : 'No tienes ningún dispositivo con la sesión abierta.', error: true };
      }
    } catch (err) {
      mensaje = { texto: err.message, error: true };
    } finally {
      ocupado = false;
    }
    await pintar(mensaje);
  });

  pintar();
})();
