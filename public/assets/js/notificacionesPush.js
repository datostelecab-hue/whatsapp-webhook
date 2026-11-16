// ============================================================
// NOTIFICACIONES AL DISPOSITIVO — el componente de la casa (A8)
// ============================================================
// Lo carga layout-gestion en todas las pantallas. Por sí solo SOLO confirma, al
// cargar, que este navegador sigue activado, con la sesión de ahora (así los
// avisos vuelven a llegar tras entrar otra vez). Lo demás lo pide Configuración:
//
//   await NotificacionesPush.estadoAqui()   { aqui: 'activadas' | 'apagadas' | 'bloqueadas'
//                                             | 'instalar' (iPhone sin instalar) | 'sin-soporte' }
//   await NotificacionesPush.activar()      tras un CLIC: pide el permiso y lo apunta
//   await NotificacionesPush.desactivar()
//
// El permiso del navegador SOLO se pide al pulsar «Activar»: pedirlo al entrar
// lo bloquea (y los navegadores castigan a las webs que lo hacen).
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

  global.NotificacionesPush = { estadoAqui, activar, desactivar, confirmar, nombreDispositivo, soporte };
})(window);
