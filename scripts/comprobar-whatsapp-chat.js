// ============================================================
// EL CHAT DE WHATSAPP — las reglas y el apunte de cada envío
// ============================================================
// Las reglas del módulo /whatsapp (db/185, 07/10/2026): qué es cada mensaje que
// entra o sale, la ventana de 24 h en la que se puede escribir gratis, cuándo
// atiende el bot (la pausa mientras habla la oficina) y que cada envío del
// servicio de WhatsApp quede apuntado en el chat con su origen.
//
//   node scripts/comprobar-whatsapp-chat.js
//
// No toca la base ni Meta: el repositorio del chat y `fetch` se sustituyen.
const W = require('../services/whatsappChat');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

(async () => {
  // ── Lo que entra ────────────────────────────────────────────────────────
  igual('Un texto', W.describirEntrante({ type: 'text', text: { body: 'Hola' } }), { tipo: 'texto', texto: 'Hola', detalle: null });
  igual('Un botón del bot', W.describirEntrante({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'abrir_puertas', title: '🔓 Abrir' } } }),
    { tipo: 'boton', texto: '🔓 Abrir', detalle: { id: 'abrir_puertas' } });
  igual('El botón de una plantilla', W.describirEntrante({ type: 'button', button: { text: 'Ver turnos', payload: 'Ver turnos' } }),
    { tipo: 'boton', texto: 'Ver turnos', detalle: { payload: 'Ver turnos' } });
  igual('Una foto con texto', W.describirEntrante({ type: 'image', image: { id: 'M1', mime_type: 'image/jpeg', caption: 'el golpe' } }),
    { tipo: 'imagen', texto: 'el golpe', detalle: { media_id: 'M1', mime: 'image/jpeg' } });
  igual('Una nota de voz', W.describirEntrante({ type: 'audio', audio: { id: 'A1', mime_type: 'audio/ogg', voice: true } }).detalle, { media_id: 'A1', mime: 'audio/ogg', voz: true });
  igual('Una ubicación', W.describirEntrante({ type: 'location', location: { latitude: 40.4, longitude: -3.7, name: 'Atocha' } }),
    { tipo: 'ubicacion', texto: 'Atocha', detalle: { lat: 40.4, lng: -3.7 } });
  igual('Algo que no se conoce', W.describirEntrante({ type: 'nuevo' }).tipo, 'otro');

  // ── Lo que sale ─────────────────────────────────────────────────────────
  igual('Botones: el texto y los títulos', W.describirSaliente({ type: 'interactive', interactive: { body: { text: '¿Qué hacemos?' }, action: { buttons: [{ reply: { title: 'Abrir' } }, { reply: { title: 'Cerrar' } }] } } }),
    { tipo: 'botones', texto: '¿Qué hacemos?', detalle: { botones: ['Abrir', 'Cerrar'] } });
  igual('Plantilla: nombre y parámetros', W.describirSaliente({ type: 'template', template: { name: 'advertencia_limite', language: { code: 'es' }, components: [{ type: 'body', parameters: [{ text: 'Ana' }, { text: '1234ABC' }] }] } }).texto,
    'Plantilla «advertencia_limite»: Ana · 1234ABC');
  igual('Resumen de una foto sin texto', W.resumen({ tipo: 'imagen', texto: '' }), 'Foto');
  igual('Resumen de un texto con saltos', W.resumen({ tipo: 'texto', texto: 'Hola\n\nqué tal' }), 'Hola qué tal');

  // ── La ventana de 24 h ──────────────────────────────────────────────────
  const T = Date.parse('2026-10-07T12:00:00Z');
  igual('Escribió hace 23 h: abierta', W.ventana(new Date(T - 23 * 3600e3), T).abierta, true);
  igual('Escribió hace 25 h: cerrada', W.ventana(new Date(T - 25 * 3600e3), T).abierta, false);
  igual('Nunca escribió: cerrada', W.ventana(null, T), { abierta: false, cierraAt: null });

  // ── La pausa del bot ────────────────────────────────────────────────────
  const enPausa = new Date(T + 10 * 60e3), pasada = new Date(T - 60e3);
  igual('Sin pausa, el bot atiende el texto', W.botAtiende('text', null, T), true);
  igual('En pausa, el texto NO lo atiende el bot', W.botAtiende('text', enPausa, T), false);
  igual('En pausa, los botones del turno SÍ', [W.botAtiende('interactive', enPausa, T), W.botAtiende('button', enPausa, T)], [true, true]);
  igual('Pausa ya pasada: atiende', W.botAtiende('text', pasada, T), true);
  igual('En pausa, una foto tampoco', W.botAtiende('image', enPausa, T), false);

  // ── El texto de la oficina ──────────────────────────────────────────────
  igual('Se limpia', W.textoDeOficina('  hola \r\n'), 'hola');
  try { W.textoDeOficina('   '); igual('Vacío lanza', 'no lanzó', 'lanza'); } catch (e) { igual('Vacío lanza', true, true); }
  try { W.textoDeOficina('x'.repeat(W.MAX_TEXTO + 1)); igual('Muy largo lanza', 'no lanzó', 'lanza'); } catch (e) { igual('Muy largo lanza', /demasiado largo/.test(e.message), true); }

  // ── Cada envío queda apuntado con su origen ─────────────────────────────
  const repo = require('../services/repo/whatsappChat');
  const apuntados = [];
  repo.guardar = async x => { apuntados.push(x); return 1; };
  let siguiente = { messages: [{ id: 'wamid.OK' }] };
  global.fetch = async () => ({ json: async () => siguiente });
  const wa = require('../services/whatsapp');

  await wa.enviarTexto('600111222', 'Hola desde el bot');
  igual('Texto del bot: apuntado como bot, con el teléfono con prefijo y el wamid',
    [apuntados[0].origen, apuntados[0].telefono, apuntados[0].wamid, apuntados[0].texto, apuntados[0].sentido], ['bot', '34600111222', 'wamid.OK', 'Hola desde el bot', 'saliente']);
  await wa.enviarTexto('34600111222', 'Hola desde la oficina', { origen: 'oficina', usuarioId: 7 });
  igual('Texto de la oficina: con quién lo escribió', [apuntados[1].origen, apuntados[1].usuarioId], ['oficina', 7]);
  await wa.enviarPlantillaPosicional('600111222', 'advertencia_limite', ['Ana', '1234ABC']);
  igual('Plantilla de velocidad: se reconoce sola', [apuntados[2].origen, apuntados[2].tipo], ['velocidad', 'plantilla']);
  await wa.enviarPlantillaPosicional('600111222', 'alerta_x', ['a'], { origen: 'alerta' });
  igual('Plantilla con origen dicho por quien la manda', apuntados[3].origen, 'alerta');
  await wa.enviarBotonesCrudos('34600111222', 'Panel', [{ type: 'reply', reply: { id: 'a', title: '🔓 Abrir' } }]);
  igual('Botones del bot de puertas: tal cual', [apuntados[4].tipo, apuntados[4].detalle.botones], ['botones', ['🔓 Abrir']]);
  siguiente = { error: { message: '(#131042) Business eligibility payment issue' } };
  const r = await wa.enviarTexto('600111222', 'No saldrá');
  igual('Un envío rechazado: sin wamid y con el error', [r.ok, apuntados[5].wamid, /131042/.test(apuntados[5].error)], [false, null, true]);

  console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
