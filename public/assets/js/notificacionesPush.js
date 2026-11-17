// ============================================================
// NOTIFICACIONES AL DISPOSITIVO — el componente de la casa (A8)
// ============================================================
// Lo carga layout-gestion en todas las pantallas. Por sí solo confirma, al
// cargar, que este navegador sigue activado, con la sesión de ahora (así los
// avisos vuelven a llegar tras entrar otra vez), y, si este dispositivo no las
// tiene, INVITA a activarlas con su botón (ver «La invitación al entrar», al
// final). Lo demás lo pide Configuración:
//
//   await NotificacionesPush.estadoAqui()   { aqui: 'activadas' | 'apagadas' | 'bloqueadas'
//                                             | 'instalar' (iPhone sin instalar) | 'sin-soporte' }
//   await NotificacionesPush.activar()      tras un CLIC: pide el permiso y lo apunta
//   await NotificacionesPush.desactivar()
//
// El permiso del navegador SOLO se pide al pulsar «Activar» (en la invitación o
// en Configuración): pedirlo al entrar, sin clic, lo bloquea (y los navegadores
// castigan a las webs que lo hacen).
(function (global) {
  'use strict';

  const ALCANCE = '/';
  const BLOQUEADAS = 'Las notificaciones del ERP están bloqueadas en este navegador. Pulsa el candado de la barra de direcciones, '
    + 'pon «Notificaciones» en «Permitir» y vuelve a pulsar «Activar».';
  const BRAVE = 'Brave no deja recibir notificaciones hasta que se activa una opción: Configuración → Privacidad y seguridad → '
    + '«Usar los servicios de Google para la mensajería push». Actívala, reinicia Brave y vuelve a pulsar «Activar».';

  const soporte = () => 'serviceWorker' in navigator && 'PushManager' in global && 'Notification' in global && global.isSecureContext;
  const esIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada = () => (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  const bytesDe = b64 => {
    const t = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(global.atob(t), c => c.charCodeAt(0));
  };
  const igualBytes = (a, b) => {
    if (!a || !b) return false;
    const x = new Uint8Array(a), y = new Uint8Array(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  };

  /** «Chrome en Windows», para que la persona reconozca cada uno en su lista. */
  function nombreDispositivo() {
    const ua = navigator.userAgent;
    const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
      : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? (navigator.brave ? 'Brave' : 'Chrome')
      : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
    const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
      : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    return so ? `${nav} en ${so}${instalada() ? ' (app)' : ''}` : nav;
  }

  async function suscripcionActual() {
    const reg = await navigator.serviceWorker.getRegistration(ALCANCE);
    return reg ? reg.pushManager.getSubscription() : null;
  }

  /** Cómo está ESTE navegador. */
  async function estadoAqui() {
    if (!soporte()) return { aqui: 'sin-soporte' };
    if (esIOS() && !instalada()) return { aqui: 'instalar' };
    if (global.Notification.permission === 'denied') return { aqui: 'bloqueadas' };
    const sub = global.Notification.permission === 'granted' ? await suscripcionActual() : null;
    return { aqui: sub ? 'activadas' : 'apagadas', endpoint: sub ? sub.endpoint : null };
  }

  /** «Activar»: SOLO tras un clic. Lanza con un mensaje que se puede enseñar. */
  async function activar() {
    if (!soporte()) throw new Error('Este navegador no puede recibir notificaciones.');
    if (esIOS() && !instalada()) {
      throw new Error('En el iPhone y el iPad las notificaciones solo llegan con el ERP instalado: en Safari, pulsa Compartir → «Añadir a pantalla de inicio», ábrelo desde ese icono y actívalas ahí.');
    }
    const est = await global.Api.get('/push/api/estado');
    if (!est.clave) throw new Error('Las notificaciones aún no están configuradas en el servidor. Avisa al desarrollador.');
    const permiso = await global.Notification.requestPermission();
    if (permiso !== 'granted') throw new Error(permiso === 'denied' ? BLOQUEADAS : 'No has dado permiso: vuelve a pulsar «Activar» y elige «Permitir».');

    const reg = await navigator.serviceWorker.register('/sw.js', { scope: ALCANCE });
    await navigator.serviceWorker.ready;
    const clave = bytesDe(est.clave);
    let sub = await reg.pushManager.getSubscription();
    // Hecha con otras claves del servidor (se cambiaron): no vale, se rehace.
    if (sub && !igualBytes(sub.options && sub.options.applicationServerKey, clave)) { await sub.unsubscribe(); sub = null; }
    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave });
      } catch (e) {
        const brave = navigator.brave && await navigator.brave.isBrave().catch(() => false);
        throw new Error(brave ? BRAVE : `Este navegador no ha podido activarlas (${e.message}).`);
      }
    }
    const r = await global.Api.post('/push/api/activar', { suscripcion: sub.toJSON(), dispositivo: nombreDispositivo() });
    recordarConfirmado();
    return r;
  }

  /** «Desactivar» en este navegador: de baja en el servidor y fuera del navegador. */
  async function desactivar() {
    const sub = soporte() ? await suscripcionActual() : null;
    if (!sub) return;
    await global.Api.post('/push/api/quitar', { endpoint: sub.endpoint });
    await sub.unsubscribe();
    try { global.localStorage.removeItem(CLAVE_CONFIRMADO); } catch (_) { /* sin almacenamiento */ }
  }

  // ── Confirmar al cargar ─────────────────────────────────────────────────
  // Con la sesión de ahora (su huella va en <meta name="tc-s">): como mucho una
  // vez cada seis horas por sesión, para no escribir en la base en cada clic.
  const CLAVE_CONFIRMADO = 'tc-push-confirmado';
  const huellaSesion = () => { const m = document.querySelector('meta[name="tc-s"]'); return m ? m.content : ''; };
  function recordarConfirmado() {
    try { global.localStorage.setItem(CLAVE_CONFIRMADO, JSON.stringify({ s: huellaSesion(), t: Date.now() })); } catch (_) { /* sin almacenamiento */ }
  }

  /** → { estado: 'ok', id } | { estado: 'no-esta' } | null (nada que confirmar) */
  async function confirmar({ forzar = false } = {}) {
    if (!soporte() || global.Notification.permission !== 'granted') return null;
    const huella = huellaSesion();
    if (!huella) return null;
    if (!forzar) {
      let antes = {};
      try { antes = JSON.parse(global.localStorage.getItem(CLAVE_CONFIRMADO) || '{}'); } catch (_) { /* sin almacenamiento */ }
      if (antes.s === huella && Date.now() - antes.t < 6 * 3600 * 1000) return null;
    }
    const sub = await suscripcionActual();
    if (!sub) return null;
    // Con fetch y no con Api: si falla, no hay nada que enseñar a nadie.
    const r = await global.fetch('/push/api/confirmar', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ suscripcion: sub.toJSON() }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    // La quitó la persona desde otro dispositivo, o la activó otra persona en
    // este navegador: aquí ya no vale.
    if (j.estado === 'no-esta') { await sub.unsubscribe().catch(() => {}); return j; }
    recordarConfirmado();
    return j;
  }

  if (soporte() && global.Notification.permission === 'granted') {
    global.setTimeout(() => { confirmar().catch(() => {}); }, 2000);
  }

  // ── La invitación al entrar (17/11/2026) ────────────────────────────────
  // Camilo: «haz que la aplicación pida permisos de notificaciones de una vez,
  // que no tengamos que ir hasta Configuración». El permiso del navegador sigue
  // pidiéndose tras un clic (sin él, Chrome lo silencia y Firefox y Safari lo
  // rechazan), pero el clic está aquí: en cada dispositivo que no las tenga
  // sale «Activa las notificaciones · Activar / Ahora no». Con «Ahora no», se
  // vuelve a ofrecer a los 7 días (lo decidió Camilo). Si están bloqueadas en
  // el navegador, no se insiste: eso se arregla desde el candado.
  const CLAVE_INVITACION = 'tc-push-invitacion';
  const ESPERA_INVITACION = 7 * 24 * 3600 * 1000;
  const invitadoHace = () => { try { return Date.now() - Number(global.localStorage.getItem(CLAVE_INVITACION) || 0); } catch (_) { return 0; } };
  const apuntarInvitacion = () => { try { global.localStorage.setItem(CLAVE_INVITACION, String(Date.now())); } catch (_) { /* sin almacenamiento */ } };
  // La pantalla quieta: sin la carga, sin un diálogo, una ficha, las novedades ni un recorrido.
  function ocupada() {
    const carga = document.getElementById('cargando-overlay');
    return (carga && !carga.classList.contains('hidden'))
      || document.querySelector('.dialogo, .tc-panel, [data-formulario], .tc-novedades-fondo')
      || (global.Recorrido && global.Recorrido.enMarcha && global.Recorrido.enMarcha());
  }
  /** ¿Hay que invitar en este dispositivo? → 'apagadas' | 'instalar' | null. Antes de esperar a que la pantalla esté quieta. */
  async function hayQueInvitar() {
    const est = await estadoAqui();
    if (est.aqui !== 'apagadas' && est.aqui !== 'instalar') return null;
    let srv = null;
    try { srv = await global.Api.get('/push/api/estado'); } catch (_) { return null; }
    return srv && srv.clave ? est.aqui : null;    // sin claves en el servidor, no hay nada que activar
  }
  /** La ventana, YA con la pantalla quieta (se abre en el mismo instante en que se comprueba). */
  async function invitar(aqui) {
    apuntarInvitacion();
    if (aqui === 'instalar') {
      await global.Dialogo.aviso({ titulo: 'Instala Telecab para recibir avisos',
        texto: 'En el iPhone y el iPad las notificaciones solo llegan con Telecab instalado: en Safari, pulsa Compartir → «Añadir a pantalla de inicio», ábrelo desde ese icono y actívalas ahí.' });
      return;
    }
    const v = await global.Dialogo.abrir({
      titulo: 'Activa las notificaciones', tono: 'info',
      html: '<p>Te avisaremos en este dispositivo de lo que es para ti, aunque no tengas Telecab abierto: los mensajes directos, las menciones y las respuestas del chat, y tus tareas del tablero.</p>'
        + '<p class="text-telecab-muted text-xs">Al pulsar «Activar», el navegador te preguntará: elige «Permitir». Se pueden quitar cuando quieras en Configuración.</p>',
      opciones: [{ texto: 'Ahora no', valor: null }, { texto: 'Activar', valor: 'si', principal: true }],
    });
    if (v !== 'si') return;
    try {
      await activar();
      global.Dialogo.hecho('Notificaciones activadas en este dispositivo');
    } catch (e) {
      global.Dialogo.aviso({ titulo: 'No se han activado', texto: (e && e.message) || 'No se ha podido.', tono: 'error' });
    }
  }
  async function invitarCuandoSePueda() {
    if (!document.getElementById('menu') || !global.Dialogo || !global.Api) return;   // solo en la gestión, con sesión
    if (!soporte() && !esIOS()) return;
    if (invitadoHace() < ESPERA_INVITACION) return;
    const aqui = await hayQueInvitar().catch(() => null);
    if (!aqui) return;
    let intentos = 0;
    const probar = () => {
      if (ocupada()) { if (++intentos < 40) global.setTimeout(probar, 1500); return; }
      invitar(aqui).catch(() => {});
    };
    global.setTimeout(probar, 3500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', invitarCuandoSePueda);
  else invitarCuandoSePueda();

  global.NotificacionesPush = { estadoAqui, activar, desactivar, confirmar, nombreDispositivo, soporte };
})(window);
