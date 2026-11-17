// ============================================================
// EL SERVICE WORKER DEL ERP — solo para las notificaciones (A8)
// ============================================================
// Se sirve en /sw.js (app.js) para que su alcance sea todo el ERP: desde
// /assets solo controlaría /assets. Lo registra NotificacionesPush.activar(),
// tras pulsar «Activar» en Configuración.
//
// NO GUARDA NADA EN CACHÉ ni intercepta peticiones (no hay 'fetch'): el ERP se
// sigue cargando siempre del servidor, como hasta ahora. Solo:
//   · 'push': enseña la notificación que manda el servidor;
//   · 'notificationclick': abre la página del ERP de la notificación (o la
//     trae delante si ya está abierta);
//   · 'pushsubscriptionchange': si el navegador cambia la dirección, la apunta.
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ¿Tiene esa persona delante (pestaña visible y con el foco) ese canal del chat?
// Entonces el mensaje ya lo está viendo: no hace falta notificación (17/11/2026).
const canalDe = url => { try { const u = new URL(url, self.location.origin); return u.pathname === '/chat' ? u.searchParams.get('canal') : null; } catch (_) { return null; } };
async function mirandoElCanal(url) {
  const canal = canalDe(url);
  if (!canal) return false;
  const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return ventanas.some(v => v.focused && v.visibilityState === 'visible' && canalDe(v.url) === canal);
}

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    if (await mirandoElCanal(d.url)) return;
    return self.registration.showNotification(d.titulo || 'Telecab', {
      body: d.cuerpo || '',
      icon: '/assets/iconos/icono-192.png',
      badge: '/assets/iconos/insignia-96.png',
      lang: 'es',
      // La misma etiqueta sustituye a la anterior (y vuelve a sonar), en vez de amontonarse.
      tag: d.etiqueta || undefined,
      renotify: !!d.etiqueta,
      timestamp: d.en || Date.now(),
      data: { url: d.url || '/inicio' },
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || '/inicio', self.location.origin);
  if (destino.origin !== self.location.origin) return;   // solo páginas del ERP
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Si esa página ya está abierta, delante. Si no, en una ventana nueva: no
    // se cambia la página de otra pestaña, que puede tener algo a medio escribir.
    const misma = ventanas.find(v => new URL(v.url).pathname === destino.pathname);
    if (misma && 'focus' in misma) {
      // El chat ya abierto va él solo al canal y al mensaje, sin recargar.
      if (destino.pathname === '/chat') misma.postMessage({ tipo: 'chat-ir', url: destino.href });
      return misma.focus();
    }
    return self.clients.openWindow(destino.href);
  })());
});

const bytesDe = b64 => {
  const t = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t), c => c.charCodeAt(0));
};

self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const est = await (await fetch('/push/api/estado', { credentials: 'same-origin' })).json();
      if (!est.clave) return;
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDe(est.clave) });
      await fetch('/push/api/activar', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suscripcion: sub.toJSON(), dispositivo: null }),
      });
    } catch (_) { /* sin sesión: se pondrá al día al volver a entrar */ }
  })());
});
