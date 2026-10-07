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

  // ── El fallo del 07/10: la conversación no se guardaba ──────────────────
  // Postgres rechaza un parámetro usado con dos tipos (una columna varchar y una
  // comparación con texto). Los mensajes entraban y su conversación no.
  const fuenteRepo = require('fs').readFileSync(require('path').join(__dirname, '../services/repo/whatsappChat.js'), 'utf8');
  igual('La conversación se pone al día con $5 con su tipo (db/186)', /CASE WHEN \$5::varchar = 'entrante'/.test(fuenteRepo), true);

  // ════════════════════════════════════════════════════════════════════════
  // SEGUNDA FASE (db/186)
  // ════════════════════════════════════════════════════════════════════════

  // ── Los adjuntos: qué se enseña y qué se descarga ───────────────────────
  igual('Fotos, audio y vídeo se enseñan en la página',
    ['image/jpeg', 'audio/ogg; codecs=opus', 'video/mp4', 'image/webp'].map(W.adjuntoEnLinea), [true, true, true, true]);
  igual('Un SVG, un HTML o un PDF, solo se descargan',
    ['image/svg+xml', 'text/html', 'application/pdf', '', null].map(W.adjuntoEnLinea), [false, false, false, false, false]);
  igual('El nombre de un documento, limpio', W.nombreAdjunto({ nombre: 'parte/del:golpe?.pdf', mime: 'application/pdf', tipo: 'documento', id: 3 }), 'parte del golpe .pdf');
  igual('Sin nombre, uno con su extensión', W.nombreAdjunto({ mime: 'image/jpeg', tipo: 'imagen', id: 12 }), 'WhatsApp Foto 12.jpg');
  igual('La descarga lleva el nombre en ASCII y en UTF-8', W.disposicion('Ñandú.pdf', false), "attachment; filename=\"Nandu.pdf\"; filename*=UTF-8''%C3%91and%C3%BA.pdf");

  // ── Las plantillas ──────────────────────────────────────────────────────
  const META = {
    name: 'contacto_oficina', language: 'es_ES', status: 'APPROVED', category: 'UTILITY',
    components: [{ type: 'BODY', text: 'Hola {{1}}, te escribe {{2}} desde Telecab. {{1}}, contéstanos por aquí.' }, { type: 'FOOTER', text: 'Telecab' }],
  };
  const P = W.plantillaDeMeta(META);
  igual('Plantilla por posición: variables en orden y sin repetir', [P.formato, P.variables, P.usable, P.pie], ['posicional', ['1', '2'], true, 'Telecab']);
  const PN = W.plantillaDeMeta({ ...META, parameter_format: 'NAMED', components: [{ type: 'BODY', text: 'Hola {{nombre}}' }] });
  igual('Plantilla con nombres', [PN.formato, PN.variables], ['nombrado', ['nombre']]);
  igual('Con una foto en la cabecera no se puede mandar desde aquí',
    W.plantillaDeMeta({ ...META, components: [{ type: 'HEADER', format: 'IMAGE' }, ...META.components] }).motivo, 'Lleva en la cabecera una foto, un documento o una variable');
  igual('Con un enlace variable en un botón, tampoco',
    W.plantillaDeMeta({ ...META, components: [...META.components, { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Ver', url: 'https://x.es/{{1}}' }] }] }).usable, false);
  igual('Un botón de respuesta rápida sí vale',
    W.plantillaDeMeta({ ...META, components: [...META.components, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Vale' }] }] }).usable, true);
  igual('Sin aprobar, no', W.plantillaDeMeta({ ...META, status: 'PENDING' }).motivo, 'Meta todavía no la ha aprobado');
  igual('El cuerpo relleno, con los saltos de línea aplanados (Meta no los admite)',
    W.rellenarPlantilla(P.cuerpo, { 1: ' Ana\n', 2: 'Laura' }), 'Hola Ana, te escribe Laura desde Telecab. Ana, contéstanos por aquí.');
  igual('Lo que falta se queda a la vista', W.rellenarPlantilla(P.cuerpo, { 1: 'Ana' }).includes('{{2}}'), true);
  try { W.validarValores(P, { 1: 'Ana', 2: '  ' }); igual('Falta un valor: lanza', 'no lanzó', 'lanza'); } catch (e) { igual('Falta un valor: lanza', e.message, 'Rellena {{2}}.'); }
  try { W.validarValores(P, { 1: 'x'.repeat(600), 2: 'y' }); igual('Más de 1024: lanza', 'no lanzó', 'lanza'); } catch (e) { igual('Más de 1024: lanza', /1024/.test(e.message), true); }
  igual('Parámetros por posición', W.parametrosDePlantilla(P, { 1: 'Ana', 2: 'Laura\tO' }), [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'Laura O' }]);
  igual('Parámetros por nombre', W.parametrosDePlantilla(PN, { nombre: 'Ana' }), [{ type: 'text', parameter_name: 'nombre', text: 'Ana' }]);

  // ── El nombre de pila y las respuestas rápidas ──────────────────────────
  igual('Nombre de pila de la ficha', [W.primerNombre('ANDRÉS JOSÉ GARRIDO'), W.primerNombre('+34600111222'), W.primerNombre('')], ['Andrés', '', '']);
  igual('Se propone el nombre a la variable del nombre o a la primera',
    [W.valorSugerido('1', 'ANA LÓPEZ'), W.valorSugerido('2', 'ANA LÓPEZ'), W.valorSugerido('nombre_conductor', 'ANA LÓPEZ')], ['Ana', '', 'Ana']);
  igual('{nombre} en una respuesta', W.respuestaPara('Recibido, gracias {nombre}.', 'HAROLD TORRES'), 'Recibido, gracias Harold.');
  igual('Sin nombre no queda un espacio suelto', W.respuestaPara('Hola {nombre}, ahora te llamamos.', ''), 'Hola, ahora te llamamos.');
  igual('Una respuesta, limpia', W.validarRespuesta({ titulo: '  Te   llamamos ', texto: ' Ahora te llamamos. ' }), { titulo: 'Te llamamos', texto: 'Ahora te llamamos.' });
  try { W.validarRespuesta({ titulo: '', texto: 'x' }); igual('Sin título: lanza', 'no lanzó', 'lanza'); } catch (e) { igual('Sin título: lanza', /título/.test(e.message), true); }

  // ── El servicio, con la base y Meta sustituidos ─────────────────────────
  const svc = require('../modules/WhatsApp/whatsapp.service');
  const hechos = [];
  const ANA = { telefono: '34600111222', existe: true, nombre: 'ANA LÓPEZ', conductor_id: 9, ultima_entrante_at: null, asignado_a: null };
  repo.chat = async tel => (tel === ANA.telefono ? ANA : tel === '34611000000' ? { telefono: tel, existe: false, nombre: null } : null);
  repo.pausar = async (tel, min, u) => hechos.push(['pausa', tel, u]);
  repo.asignarSiLibre = async (tel, u) => { hechos.push(['asignar', tel, u]); return true; };
  wa.plantillasCrudas = async () => ({ ok: true, data: [META, { ...META, name: 'pendiente', status: 'PENDING' },
    { ...META, name: 'con_foto', components: [{ type: 'HEADER', format: 'IMAGE' }, ...META.components] }] });
  let mandada = null;
  wa.enviarPlantillaCuerpo = async (tel, nombre, params, op) => { mandada = { tel, nombre, params, op }; return { ok: true, id: 'wamid.P' }; };

  const lista = await svc.plantillas({ telefono: ANA.telefono });
  igual('Plantillas: sin las pendientes, primero las que se pueden mandar, con el nombre propuesto',
    lista.plantillas.map(p => [p.nombre, p.usable, p.sugeridos]), [['contacto_oficina', true, { 1: 'Ana', 2: '' }], ['con_foto', false, { 1: 'Ana', 2: '' }]]);
  await svc.enviarPlantilla({ telefono: ANA.telefono, nombre: 'contacto_oficina', idioma: 'es_ES', valores: { 1: 'Ana', 2: 'Laura' } }, 7);
  igual('Mandar una plantilla: parámetros, su idioma exacto y el texto que lee la persona',
    [mandada.nombre, mandada.params, mandada.op.idioma, mandada.op.origen, mandada.op.usuarioId, mandada.op.texto],
    ['contacto_oficina', [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'Laura' }], 'es_ES', 'oficina', 7,
      'Hola Ana, te escribe Laura desde Telecab. Ana, contéstanos por aquí.']);
  igual('Después: el bot en pausa y la conversación, de quien la manda', hechos, [['pausa', ANA.telefono, 7], ['asignar', ANA.telefono, 7]]);
  try { await svc.enviarPlantilla({ telefono: ANA.telefono, nombre: 'con_foto', idioma: 'es_ES', valores: { 1: 'a', 2: 'b' } }, 7); igual('Una plantilla con foto: no', 'no lanzó', 'lanza'); }
  catch (e) { igual('Una plantilla con foto: no', /no se puede mandar desde aquí/.test(e.message), true); }
  try { await svc.enviarPlantilla({ telefono: '34611000000', nombre: 'contacto_oficina', valores: { 1: 'a', 2: 'b' } }, 7); igual('A un teléfono que no es de nadie: no', 'no lanzó', 'lanza'); }
  catch (e) { igual('A un teléfono que no es de nadie: no', /No hay ninguna conversación/.test(e.message), true); }

  // Abrir la de alguien que nunca ha escrito: se puede, sin mensajes ni «leído».
  let leido = 0;
  repo.marcarLeido = async () => { leido++; };
  repo.chat = async tel => (tel === '34622000000' ? { telefono: tel, existe: false, nombre: 'PEDRO RUIZ', conductor_id: 4 } : null);
  const nuevo = await svc.abrir('34622000000');
  igual('Una conversación que aún no existe se abre vacía', [nuevo.chat.existe, nuevo.mensajes.length, leido, nuevo.chat.ventana.abierta], [false, 0, 0, false]);

  // Los adjuntos: al llegar se bajan y se guardan; lo grande no.
  const guardados = [];
  repo.guardarAdjunto = async (id, a) => guardados.push([id, a.mime, a.nombre, a.bytes.length]);
  wa.descargarMedia = async (mid, { maxBytes } = {}) => (mid === 'GRANDE'
    ? { ok: false, grande: true, tamano: maxBytes + 1, error: 'demasiado grande' }
    : { ok: true, bytes: Buffer.from('foto'), tamano: 4, mime: 'image/jpeg', sha256: 'x' });
  await svc.bajarAdjunto(41, { media_id: 'M1', mime: 'image/jpeg' });
  const grande = await svc.bajarAdjunto(42, { media_id: 'GRANDE' });
  igual('Al llegar: la foto se guarda; lo que pasa del tope, no', [guardados, grande.grande], [[[41, 'image/jpeg', null, 4]], true]);

  repo.adjunto = async id => (id === 41 ? { id: 41, tipo: 'imagen', detalle: { media_id: 'M1' }, mime: 'image/jpeg', bytes: Buffer.from('foto') }
    : id === 43 ? { id: 43, tipo: 'documento', detalle: { media_id: 'M3', nombre: 'parte.html', mime: 'text/html' }, mime: null, bytes: null }
    : id === 44 ? { id: 44, tipo: 'audio', detalle: { media_id: 'VIEJO' }, bytes: null }
    : { id, tipo: 'texto', detalle: null });
  const foto = await svc.adjunto(41);
  igual('Una foto guardada se enseña en la página', [foto.enLinea, foto.mime, foto.disposicion.startsWith('inline')], [true, 'image/jpeg', true]);
  wa.descargarMedia = async mid => (mid === 'VIEJO' ? { ok: false, caducado: true, error: 'no existe' }
    : { ok: true, bytes: Buffer.from('<script>'), tamano: 8, mime: 'text/html' });
  const doc = await svc.adjunto(43);
  igual('Un documento sin guardar se pide a Meta, se guarda y va como descarga',
    [doc.enLinea, doc.mime, doc.disposicion.startsWith('attachment'), guardados.length], [false, 'application/octet-stream', true, 2]);
  try { await svc.adjunto(44); igual('Pasados 30 días sin guardar: 410', 'no lanzó', 'lanza'); } catch (e) { igual('Pasados 30 días sin guardar: 410', e.status, 410); }
  try { await svc.adjunto(45); igual('Un texto no tiene fichero: 404', 'no lanzó', 'lanza'); } catch (e) { igual('Un texto no tiene fichero: 404', e.status, 404); }

  // Quién la lleva.
  repo.chat = async tel => (tel === ANA.telefono ? ANA : { telefono: tel, existe: false, nombre: 'PEDRO' });
  repo.asignables = async () => [{ id: 5, nombre: 'Laura' }, { id: 7, nombre: 'Camilo' }];
  const asignaciones = [];
  repo.asignar = async (tel, u, por) => asignaciones.push([tel, u, por]);
  await svc.asignar({ telefono: ANA.telefono, usuario: '5' }, 7);
  await svc.asignar({ telefono: ANA.telefono, usuario: '' }, 7);
  igual('Dársela a alguien, y a nadie', asignaciones, [[ANA.telefono, 5, 7], [ANA.telefono, null, 7]]);
  try { await svc.asignar({ telefono: ANA.telefono, usuario: 99 }, 7); igual('A quien no entra en WhatsApp: no', 'no lanzó', 'lanza'); }
  catch (e) { igual('A quien no entra en WhatsApp: no', /no entra en WhatsApp/.test(e.message), true); }
  try { await svc.asignar({ telefono: '34622000000', usuario: 5 }, 7); igual('Una conversación que no existe: no', 'no lanzó', 'lanza'); }
  catch (e) { igual('Una conversación que no existe: no', /Escríbele primero/.test(e.message), true); }

  // Las respuestas rápidas, con el nombre de cada uno.
  repo.respuestas = async () => [{ id: '1', titulo: 'Recibido', texto: 'Recibido, gracias {nombre}.' }];
  igual('Las respuestas llegan con {nombre} ya puesto', (await svc.respuestas({ telefono: ANA.telefono })).respuestas[0].listo, 'Recibido, gracias Ana.');

  // Sin db/186, la pantalla lo dice en vez de romperse.
  repo.conversaciones = async () => { throw Object.assign(new Error('column c.asignado_a does not exist'), { code: '42703' }); };
  igual('Sin db/186: lo dice', await svc.conversaciones({}, 7), { faltaMigracion: 'db/186' });
  repo.conversaciones = async () => { throw Object.assign(new Error('relation "whatsapp_chat" does not exist'), { code: '42P01' }); };
  igual('Sin db/185: lo dice', await svc.conversaciones({}, 7), { faltaMigracion: 'db/185' });

  console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
