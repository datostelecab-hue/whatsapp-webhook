// ============================================================
// LOS VÍDEOS QUE SE MANDAN POR WHATSAPP (15/10/2026)
// ============================================================
// Camilo: «prepara el envío de vídeos y monta lo del vídeo de explicación que
// hicimos sobre el bloqueo de motor».
//
// Un vídeo es un mensaje más DENTRO DE LA VENTANA DE 24 H (fuera de ella, Meta
// solo deja plantillas). Va por ENLACE: Meta lo baja de nuestra dirección
// pública, así que el fichero vive en /assets (se sirve sin sesión) y el enlace
// tiene que ser https. MP4 (H.264 + AAC), hasta 16 MB.
//
// Un vídeo nuevo es una entrada más aquí y su fichero en public/assets/videos/.

const VIDEOS = [
  {
    id: 'bot_coche',
    titulo: 'El WhatsApp del coche',
    // De Documents/Claude/reel-bot-coche (07/10/2026): 72 s, vertical, 11 MB.
    // Cuenta el caso de la multa, cómo se usa el bot (matrícula, puertas,
    // «Entregar coche», «Terminar turno») y que sin matrícula el coche no arranca.
    ruta: '/assets/videos/bot-coche.mp4',
    portada: '/assets/videos/bot-coche.jpg',
    duracion: '1:12',
    para: 'Para los nuevos, y para quien no se aclara con el bot: matrícula, puertas, entregar y terminar el turno, y el bloqueo del motor.',
    pie: 'Así funciona el WhatsApp de Telecab con tu coche: escribe la matrícula para empezar tu turno y desbloquear el motor, '
      + 'abre y cierra las puertas desde aquí, y al acabar pulsa «Terminar turno» con el coche aparcado y apagado.',
  },
];

/** Lo que necesita una pantalla para enseñarlos y elegir uno. */
const lista = () => VIDEOS.map(({ id, titulo, ruta, portada, duracion, para }) => ({ id, titulo, ruta, portada, duracion, para }));

const de = id => VIDEOS.find(v => v.id === String(id || '')) || null;

/**
 * EL ENLACE QUE SE LE DA A META: nuestra dirección pública más la ruta del
 * fichero. `URL_PUBLICA` manda si está puesta; si no, la de la petición (en
 * Render llega como https). Sin https no se manda nada: Meta no lo bajaría, y
 * desde una prueba en local tampoco tiene que salir nada.
 */
function enlace(v, base) {
  const b = String(process.env.URL_PUBLICA || base || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/i.test(b)) {
    throw new Error('No sé la dirección pública del ERP con https: sin ella Meta no puede bajar el vídeo.');
  }
  return b + v.ruta;
}

module.exports = { VIDEOS, lista, de, enlace };
