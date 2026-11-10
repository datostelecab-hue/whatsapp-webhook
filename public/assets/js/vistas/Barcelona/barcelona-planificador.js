// modules/Barcelona/vistas/barcelona-planificador.ejs — el JavaScript del planificador de Barcelona.
//
// EL PLANIFICADOR DE BARCELONA v2 (06/11/2026). Camilo: «ahora necesito agregarle
// días de libranzas desde el planificador, además de agregar los promedios de
// cada uno como en el planificador de Madrid, sin letra […] Además de que ahora
// también se van a agregar zonas de Barcelona así como en Madrid». Y:
// «Prácticamente será el mismo diseño de Madrid, solo que la arquitectura y flujo
// de datos cambia».
//
// Por eso esto COPIA EL DISEÑO Y EL LENGUAJE del cuadrante de Madrid
// (public/assets/js/vistas/Planificacion/planificador/: cuadrante.js, bases.js,
// acciones.js, rendimiento.js) y NO su código: allí se habla con /planificador-v2
// y con plazas de la base; aquí, con /barcelona/api y con matrículas y cuentas de
// BOLT. Lo que se copia, con su nombre de allí para encontrarlo:
//   · las zonas como tarjetas que filtran (tarjetaBase / pintarBases);
//   · un bloque por cuadrante con su cabecera y su tabla (seccionCuadrante, filaCoche);
//   · el descanso de cada fijo: el de día (sol) y el de noche (luna) (botonesLibranzaFijos);
//   · el chip del promedio (chipRend), SIN la letra.
// Lo que NO se copia, a propósito: la letra, eventos y CT2, vacantes, libranza
// excepcional, fichaje, ausencias y banquillo. Barcelona no tiene RRHH: «no sé
// quién está de alta desde qué fecha, solo nos basamos si está activo o no en BOLT».
//
// LOS CORRETURNOS SON CASILLAS DEL CUADRANTE (db/236, 06/11/2026). Camilo: «si los
// coches pertenecen a un cuadrante y tienen correturnos, los correturnos sí o sí
// van a ser una sola casilla cogiendo los coches que estén ahí, ojo, ninguna
// plaza se puede repetir […] el correturno debe de coger las plazas que no se
// trabajan, por lo que no puede coger dos coches a la vez». Y «que se pueda
// agregar la casilla por jornada, tipo: Agregar CT al cuadrante, se abre con 3
// opciones: día, noche, todoturno».
//   · Cada fijo libra lo suyo, siempre (sol y luna). Ya no hay bloque común ni
//     CT por coche ni «Sin correturnos»: el CT cubre a TODOS los coches de su
//     cuadrante, y un coche sin cuadrante no lleva CT.
//   · Una casilla por jornada: día (sol), noche (luna) o todoturno (sin icono),
//     nunca todoturno junto a día o noche. En la tabla es UNA celda que ocupa
//     todas las filas del cuadrante: la persona, lo que coge cada día, su
//     libranza («el día que no coja ninguno de los coches en el cuadrante») y
//     cómo está ese día.
//   · El día que libra un fijo: si una casilla coge ese turno, lo lleva su
//     persona (hueco si está vacía); si no, el coche no sale (no es hueco).
//
// LAS REGLAS SON DEL SERVIDOR (barcelona.plan.js): quién libra, quién trabaja,
// qué turno es hueco, qué coge cada casilla y cuándo libra, qué casillas se
// pueden agregar, el promedio. La pantalla solo pinta el tablero tal cual llega
// (la forma está en la especificación y es el contrato) y pide los cambios.
// Toda escritura devuelve { tablero } del día de la escritura y se repinta con él.
//
// Va en una sola IIFE: no hay nombres de primer nivel que puedan chocar con los
// del layout (scripts/comprobar-vistas.js) y ESLint la mira entera de una vez.

(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const esc = Casa.esc;

  // ── Fechas y textos ─────────────────────────────────────────────────────────
  const DIAS_LETRA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const DIAS_NOMBRE = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
  const pad = n => String(n).padStart(2, '0');
  const isoAes = iso => (iso ? iso.split('-').reverse().join('/') : '');
  const ddmm = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
  const esAiso = txt => { const m = String(txt || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : ''; };
  // A mediodía UTC: sumar días nunca cae en el día de al lado por el cambio de hora.
  const sumarDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  /** 1 = lunes … 7 = domingo, como `isodow` en la base. */
  const isodow = iso => ((new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1;
  /** [1, 3] → «L X». Vacío si no hay. */
  const diasTexto = arr => (arr || []).map(Number).sort((a, b) => a - b).map(d => DIAS_LETRA[d - 1]).filter(Boolean).join(' ');
  const mismosDias = (a, b) => diasTexto(a) === diasTexto(b);
  const fmt1 = n => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const nombreTurno = t => (t === 'noche' ? 'noche' : 'día');
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : (varios || uno + 's')}`;
  const mayus = s => s.charAt(0).toUpperCase() + s.slice(1);
  // Sin tildes y en minúsculas: quien busca «Nunez» tiene que encontrar a «Núñez».
  const plano = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const slug = s => plano(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  /** Los ids son enteros (identity); si un día no lo fueran, se mandan tal cual. */
  const aId = v => (/^\d+$/.test(String(v)) ? Number(v) : v);

  const SIN = 'sin';                 // la clave de «Sin zona»

  // Las casillas de CT, por jornada y en este orden. Camilo: «Si es todoturno es
  // una sola casilla sin logo. Si es día es una sola casilla con logo de sol. Si
  // es noche es una sola casilla con logo de luna».
  const JORNADAS = ['dia', 'noche', 'todoturno'];
  const JORNADA = {
    dia: { titulo: 'CT día', nombre: 'CT de día', opcion: 'Día', icono: 'fa-sun',
      coge: 'los días que libra el fijo de día de algún coche del cuadrante' },
    noche: { titulo: 'CT noche', nombre: 'CT de noche', opcion: 'Noche', icono: 'fa-moon',
      coge: 'los días que libra el fijo de noche de algún coche del cuadrante' },
    todoturno: { titulo: 'CT todoturno', nombre: 'CT todoturno', opcion: 'Todoturno', icono: null,
      coge: 'los días que libra cualquier fijo del cuadrante, de día o de noche' },
  };
  const jornadaDe = j => JORNADA[j] || { titulo: 'CT', nombre: 'CT', opcion: 'CT', icono: null, coge: '' };

  // ── El estado ───────────────────────────────────────────────────────────────
  let T = null;                      // el tablero que llega del servidor (el contrato)
  let DIA = null;                    // el día que se mira (AAAA-MM-DD)
  let ZONA = '';                     // la zona abierta: su id en texto, SIN, o '' = todas
  let ZONA_PEDIDA = null;            // la de la dirección, hasta que llegue el tablero
  let turnoCarga = 0;                // una respuesta lenta no pinta encima de la buena
  // Índices del tablero, rehechos en cada `aplicar`.
  let cochePorMat = new Map();
  let cuadPorId = new Map();
  let plazasDe = new Map();          // uuid → [{ rol: 'fijo', turno, matricula } | { rol: 'ct', jornada, cuadrante }]

  // ── Hablar con el servidor ──────────────────────────────────────────────────
  // Con Api (api.js), la pieza de la casa: el mensaje del servidor llega en
  // e.message y la sesión caducada lleva al login sola.

  async function cargar(fecha) {
    const yo = ++turnoCarga;
    let r;
    try {
      r = await Api.get('/barcelona/api/tablero' + (fecha ? '?fecha=' + encodeURIComponent(fecha) : ''));
    } catch (e) {
      if (yo === turnoCarga) pintarError(e.message);
      return;
    }
    if (yo !== turnoCarga) return;
    // La ruta devuelve el tablero suelto ({ status, fecha, … }); se acepta
    // también envuelto, como lo devuelven las escrituras.
    aplicar(r.tablero || r);
  }

  /**
   * Escribe y repinta con el tablero que devuelve (del día de la escritura). Si
   * ese día no es el que se miraba, se dice: la pantalla salta a donde empieza
   * el cambio, y sin decirlo parecería que se ha movido sola.
   */
  async function enviar(url, datos, metodo, boton) {
    const antes = DIA;
    const r = (await Api.pedir(url, { metodo: metodo || 'POST', datos, boton })) || {};
    if (r.tablero) aplicar(r.tablero); else await cargar(DIA);
    r.salto = DIA !== antes ? DIA : null;
    return r;
  }

  /** Lo mismo, pero el fallo lo dice con el Dialogo y el mensaje del servidor, y devuelve null. */
  async function escribir(url, datos, { metodo, titulo, boton } = {}) {
    try {
      return await enviar(url, datos, metodo, boton);
    } catch (e) {
      if (e.estado !== 401) await Dialogo.aviso({ titulo: titulo || 'No se pudo guardar', texto: e.message, tono: 'error' });
      return null;
    }
  }

  /** La confirmación breve, con la fecha si la pantalla ha saltado a otro día. */
  function hecho(r, texto) {
    Dialogo.hecho(texto + (r && r.salto ? ` Se ve el ${isoAes(r.salto)}, desde cuando vale.` : ''),
      { segundos: r && r.salto ? 5 : 3 });
  }

  // ── El tablero ──────────────────────────────────────────────────────────────

  function aplicar(t) {
    T = t || {};
    DIA = T.fecha || DIA;
    $('#bp-fecha').value = isoAes(DIA);
    cochePorMat = new Map((T.coches || []).map(c => [c.matricula, c]));
    cuadPorId = new Map((T.cuadrantes || []).map(cu => [String(cu.id), cu]));
    // Dónde está cada persona ese día, sacado de los fijos de los coches y de las
    // casillas de los cuadrantes: así el selector dice dónde está ya cada uno sin
    // depender de nada más que el contrato.
    plazasDe = new Map();
    const apuntar = (uuid, x) => { if (!plazasDe.has(uuid)) plazasDe.set(uuid, []); plazasDe.get(uuid).push(x); };
    (T.coches || []).forEach(c => [['fijoDia', 'dia'], ['fijoNoche', 'noche']].forEach(([clave, turno]) => {
      const x = (c.plazas || {})[clave];
      if (x && x.uuid) apuntar(x.uuid, { rol: 'fijo', turno, matricula: c.matricula });
    }));
    (T.cuadrantes || []).forEach(cu => (cu.casillas || []).forEach(k => {
      if (k.persona && k.persona.uuid) apuntar(k.persona.uuid, { rol: 'ct', jornada: k.jornada, cuadrante: cu });
    }));
    if (ZONA_PEDIDA !== null) { ZONA = claveDeSlug(ZONA_PEDIDA); ZONA_PEDIDA = null; }
    if (ZONA && ZONA !== SIN && !(T.zonas || []).some(z => String(z.id) === ZONA)) ZONA = '';
    pintarTodo();
  }

  function pintarTodo() {
    pintarCabecera();
    pintarKpis();
    pintarZonas();
    pintarCuadrantes();
    pintarSinPlaza();
  }

  function pintarError(msg) {
    const av = $('#bp-aviso');
    av.classList.remove('hidden');
    av.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i> No se pudo cargar el planificador: ${esc(msg)}`;
    if (!T) $('#bp-cuadrantes').innerHTML = '';
  }

  /** «hoy», o «el S 08/11» si se mira otro día: «libra hoy» un sábado que no es hoy mentiría. */
  const cuando = () => (T && DIA === T.hoy ? 'hoy' : `el ${DIAS_LETRA[isodow(DIA) - 1]} ${ddmm(DIA)}`);

  function pintarCabecera() {
    const av = $('#bp-aviso');
    // Sin la migración el servidor no puede montar el tablero y lo dice así (como
    // con db/181): mejor el aviso que un error.
    if (T.faltaMigracion) {
      av.classList.remove('hidden');
      av.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i> Falta aplicar la migración
        <b>${esc(typeof T.faltaMigracion === 'string' ? T.faltaMigracion : 'db/236')}</b> (en Migraciones). Hasta entonces el planificador de Barcelona no se puede pintar.`;
    } else {
      av.classList.add('hidden');
    }
    $('#bp-sub').textContent = `${mayus(DIAS_NOMBRE[isodow(DIA) - 1])} ${isoAes(DIA)}${DIA === T.hoy ? ' · hoy' : ''}` +
      ' · Cada cambio vale desde el día que se mira hasta que se cambie.';
  }

  // ── Las cifras ──────────────────────────────────────────────────────────────

  function kpi({ titulo, valor, sub, ayuda, tono, ir }) {
    const etiqueta = ir ? 'button type="button" data-ir="' + esc(ir) + '"' : 'div';
    const cierre = ir ? 'button' : 'div';
    return `<${etiqueta} title="${esc(ayuda)}"
        class="${ir ? 'tc-pulsable text-left hover:border-telecab-gold/40 ' : ''}bg-telecab-card border border-telecab-border rounded-2xl p-3 shadow-soft">
        <p class="text-xs text-telecab-muted uppercase tracking-wide">${esc(titulo)}</p>
        <p class="text-xl font-bold mt-1 tabular-nums ${tono || ''}">${esc(valor)}</p>
        ${sub ? `<p class="text-[10px] text-telecab-muted mt-1">${esc(sub)}</p>` : ''}
      </${cierre}>`;
  }

  function pintarKpis() {
    const r = T.resumen;
    if (!r) { $('#bp-kpis').innerHTML = ''; return; }
    const n = v => Number(v || 0);
    // Las casillas: la cifra del servidor; las vacías se cuentan aquí, que son
    // las que piden a alguien.
    const casillas = (T.cuadrantes || []).flatMap(cu => cu.casillas || []);
    const nCas = r.casillas != null ? n(r.casillas) : casillas.length;
    const vacias = casillas.filter(k => !k.persona).length;
    $('#bp-kpis').innerHTML = [
      kpi({ titulo: 'Coches', valor: n(r.coches),
        sub: nCas ? `${plural(nCas, 'casilla')} de CT${vacias ? ` · ${vacias} ${vacias === 1 ? 'vacía' : 'vacías'}` : ''}` : 'ningún cuadrante con CT',
        ayuda: 'Los coches de Barcelona que se pueden planificar: los de su empresa de BOLT y los de Vehículos con sede Barcelona.\n' +
          'Debajo, las casillas de CT de los cuadrantes. Por defecto ningún cuadrante lleva CT: se le agrega con «+ CT» en su cabecera.' }),
      kpi({ titulo: 'Turnos cubiertos', valor: `${n(r.cubiertos)} / ${n(r.turnos)}`, sub: cuando(),
        ayuda: 'Cada coche tiene dos turnos al día, de día y de noche. Cuentan los que tienen que salir.\nCubierto: alguien lo lleva ese día, su fijo o, si el fijo libra, la persona de la casilla de CT del cuadrante.' }),
      kpi({ titulo: 'Huecos', valor: n(r.huecos), tono: n(r.huecos) ? 'text-telecab-red' : '', sub: 'turnos sin nadie',
        ayuda: 'Turnos que tenían que salir y no los lleva nadie: sin fijo, o el fijo libra y la casilla de CT que lo coge está vacía.\nSi el cuadrante no tiene CT de ese turno, lo que libra el fijo no es hueco: ese turno no sale.' }),
      kpi({ titulo: 'Libran', valor: n(r.libran), sub: 'el coche no sale',
        ayuda: 'Turnos en los que el coche no sale: libra su fijo y su cuadrante no tiene CT de ese turno (o el coche no está en ningún cuadrante).\nEs lo planificado: no cuenta como hueco.' }),
      kpi({ titulo: 'Sin plaza', valor: n(r.sinPlaza), sub: 'pincha para verlos', ir: '#bp-sinplaza-caja',
        ayuda: 'Cuentas activas en BOLT Barcelona que ese día no están en ninguna matrícula ni en ninguna casilla de CT.\nEstán abajo, con su promedio.' }),
    ].join('');
  }

  // ── Las zonas (como las bases de Madrid) ────────────────────────────────────

  const zonaDeCuad = cu => (cu && cu.zonaId != null && cu.zonaId !== '' ? String(cu.zonaId) : SIN);
  const cuadDe = c => (c && c.cuadranteId != null ? cuadPorId.get(String(c.cuadranteId)) || null : null);
  const zonaDeCoche = c => (c.cuadranteId != null ? zonaDeCuad(cuadDe(c)) : SIN);
  const nombreZona = clave => (clave === SIN ? 'Sin zona'
    : ((T.zonas || []).find(z => String(z.id) === clave) || {}).nombre || 'Zona');
  const slugDeClave = clave => (clave === SIN ? 'sin-zona' : slug(nombreZona(clave)));
  const claveDeSlug = s => {
    if (!s) return '';
    if (s === 'sin-zona') return SIN;
    const z = (T.zonas || []).find(x => slug(x.nombre) === s);
    return z ? String(z.id) : '';
  };
  const zonaDeLaUrl = () => { const m = String(location.hash || '').match(/zona=([^&]+)/); return m ? decodeURIComponent(m[1]) : ''; };

  /**
   * Lo que tiene una zona ese día: sus coches y cuántos de sus turnos son hueco
   * o libran. Los huecos y las libranzas, solo de los coches activos, como la
   * cifra de Huecos de arriba (el resumen del servidor): un coche desactivado en
   * BOLT no sale, y su turno sin nadie no es un hueco que cubrir.
   */
  function cuentaZona(clave) {
    const coches = (T.coches || []).filter(c => zonaDeCoche(c) === clave);
    let huecos = 0, libran = 0;
    coches.filter(c => c.activo).forEach(c => ['dia', 'noche'].forEach(t => {
      const st = (c.turnos || {})[t];
      if (st === 'hueco') huecos++;
      if (st === 'libra') libran++;
    }));
    const cuadrantes = (T.cuadrantes || []).filter(cu => zonaDeCuad(cu) === clave).length;
    return { coches: coches.length, cuadrantes, huecos, libran };
  }

  function tarjetaZona(clave) {
    const on = ZONA === clave;
    const nombre = nombreZona(clave);
    const k = cuentaZona(clave);
    const estado = !k.coches ? (k.cuadrantes ? 'Sin coches todavía' : 'Ningún cuadrante')
      : k.huecos ? `${plural(k.huecos, 'hueco')} ${cuando()}` : 'Nada por cubrir';
    const titulo = clave === SIN
      ? `Cuadrantes sin zona y coches que no están en ningún cuadrante: ${k.coches} coche(s).\nPincha para ver solo esos.`
      : `${nombre}: ${k.coches} coche(s) en ${k.cuadrantes} cuadrante(s).\n` +
        `${mayus(cuando())}: ${k.huecos} turno(s) sin nadie y ${k.libran} que libran.\n` +
        'Pincha para ver solo sus cuadrantes; otra vez, para volver a todas.';
    return `
      <button type="button" data-zona="${esc(clave)}" aria-pressed="${on}" title="${esc(titulo)}"
              class="tc-pulsable text-left rounded-2xl border p-3 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-telecab-gold/50
                     ${on ? 'border-telecab-gold bg-telecab-gold/5' : 'border-telecab-border bg-telecab-card hover:border-telecab-gold/40'}">
        <span class="flex items-baseline gap-2 min-w-0">
          <span class="font-semibold truncate ${on ? 'text-telecab-gold' : (clave === SIN ? 'text-telecab-muted' : '')}">${esc(nombre)}</span>
          <span class="ml-auto text-xs text-telecab-muted tabular-nums whitespace-nowrap">${plural(k.coches, 'coche')}</span>
        </span>
        <span class="mt-2 block text-[11px] text-telecab-muted tabular-nums truncate">${clave === SIN
          ? `${plural(k.cuadrantes, 'cuadrante')} · ${plural((T.coches || []).filter(c => c.cuadranteId == null).length, 'coche suelto', 'coches sueltos')}`
          : plural(k.cuadrantes, 'cuadrante')}</span>
        <span class="block text-xs font-semibold mt-0.5 truncate ${k.huecos ? 'text-telecab-warn' : 'text-telecab-muted'}">${esc(estado)}</span>
      </button>`;
  }

  function pintarZonas() {
    const nav = $('#bp-zonas');
    const claves = (T.zonas || []).map(z => String(z.id));
    // «Sin zona» no es una zona más: sale solo si hay algo sin zona.
    const sin = cuentaZona(SIN);
    if (sin.coches || sin.cuadrantes) claves.push(SIN);
    // Sin ninguna zona creada, una tarjeta suelta de «Sin zona» no dice nada: el
    // vacío de abajo explica cómo empezar.
    nav.classList.toggle('hidden', !(T.zonas || []).length);
    nav.innerHTML = claves.map(tarjetaZona).join('');

    $('#bp-ambito').textContent = ZONA ? nombreZona(ZONA) : 'Todas las zonas';
    const k = ZONA ? cuentaZona(ZONA) : null;
    $('#bp-ambito-sub').textContent = k ? `${plural(k.coches, 'coche')} · ${plural(k.cuadrantes, 'cuadrante')}` : '';
    const todas = $('#bp-todas');
    todas.classList.toggle('hidden', !ZONA);
    todas.classList.toggle('inline-flex', !!ZONA);
  }

  /**
   * Abrir una zona ('' = volver a todas). Con `apilar`, el navegador lo apunta
   * como un paso: «atrás» vuelve a todas en vez de salir del planificador.
   */
  function elegirZona(clave, { apilar = true } = {}) {
    ZONA = clave || '';
    const destino = location.pathname + location.search + (ZONA ? '#zona=' + slugDeClave(ZONA) : '');
    try {
      if (apilar) history.pushState({ zona: ZONA }, '', destino);
      else history.replaceState({ zona: ZONA }, '', destino);
    } catch (_) { /* sin historial, la zona se elige igual */ }
    pintarZonas();
    pintarCuadrantes();
  }

  // ── El chip del promedio (como chipRend de Madrid, sin letra) ───────────────
  // La regla es la de la casa (docs/nucleo/Promedio de horas.md) y la calcula el
  // servidor: horas ÷ (días que salió + ausencias a 0 h), del día 1 a ayer. Aquí
  // solo se escribe. Color neutro a propósito: sin letra no hay escala que pintar.

  const nombreMes = periodo => { const m = Number(String(periodo || '').slice(5, 7)); return MESES[m - 1] || 'este mes'; };
  const mesCorto = periodo => { const m = Number(String(periodo || '').slice(5, 7)); return MESES_CORTO[m - 1] || ''; };

  function tituloPromedio(pr) {
    const mes = nombreMes(pr.periodo);
    const salio = Number(pr.salio || 0), aus = Number(pr.ausencias || 0);
    // Las horas del periodo: `total` si el servidor lo manda (barcelona.horas
    // .promedios lo trae, aunque el contrato no lo pide); si no, se sacan de la
    // media de los días que salió, que va a un decimal, y por eso son «unas».
    const exacto = typeof pr.total === 'number';
    const total = exacto ? pr.total : (pr.media != null ? Math.round(Number(pr.media) * salio) : null);
    let t = `Promedio de ${mes}: ${fmt1(pr.horas)} h por día.` +
      `\n${total != null ? `${exacto ? fmt1(total) : 'Unas ' + total} h en ` : ''}${plural(salio, 'día')} que salió` +
      (aus ? ` + ${plural(aus, 'ausencia')} a 0 h` : '') + '.';
    if (aus && pr.media != null) t += `\nMedia de los días que salió: ${fmt1(pr.media)} h.`;
    if (pr.mesAnterior) t += `\nEs el de ${mes}: este mes aún no lleva 5 días que salió.`;
    // La regla de verdad (barcelona.horas.promedios): un día cerrado con horas
    // cuenta como «salió» tuviera plaza o no; lo que no cuenta son las
    // libranzas y los días sin plaza en los que no hizo nada. El del mes
    // anterior es de ese mes entero, no «hasta ayer».
    return t + (pr.mesAnterior ? `\nCuenta ${mes} entero.` : '\nCuentan los días cerrados hasta ayer.') +
      '\nUn día con horas cuenta siempre, tuviera plaza o no. Las libranzas y los días sin plaza sin horas no cuentan.';
  }

  function chipPromedio(pr) {
    if (!pr) return '';
    const base = 'shrink-0 inline-flex items-center gap-1 px-1.5 py-0 rounded border text-[10px] font-bold leading-[1.4] tabular-nums bg-telecab-card2 border-telecab-border';
    // N/E: sin días suficientes («menos de 5 días»). Un «0 h» en alguien que
    // lleva dos días no dice nada malo de él: dice que no se sabe.
    if (pr.ne || pr.horas == null) {
      return `<span class="${base} text-telecab-muted" title="${esc(`Sin promedio todavía: ${pr.ne || 'no hay días cerrados que contar'}.\nHace falta salir 5 días en el mes; cuenta del día 1 a ayer.`)}">N/E</span>`;
    }
    const mes = pr.mesAnterior && mesCorto(pr.periodo) ? `<span class="font-semibold opacity-80">· ${esc(mesCorto(pr.periodo))}</span>` : '';
    return `<span class="${base} text-telecab-text" title="${esc(tituloPromedio(pr))}">${esc(fmt1(pr.horas))} h${mes}</span>`;
  }

  // ── Los cuadrantes ──────────────────────────────────────────────────────────

  const tituloCuad = cu => `C${cu.numero}${cu.nombre ? ' · ' + cu.nombre : ''}`;

  /** Los coches de un cuadrante, en el orden que da el servidor. */
  function cochesDe(cu) {
    const orden = (cu.coches || []).map(String);
    const pos = m => { const i = orden.indexOf(m); return i < 0 ? 1e6 : i; };
    return (T.coches || []).filter(c => c.cuadranteId != null && String(c.cuadranteId) === String(cu.id))
      .sort((a, b) => pos(a.matricula) - pos(b.matricula));
  }

  /** Las casillas de un cuadrante, siempre en el mismo orden: día, noche, todoturno. */
  const casillasDe = cu => JORNADAS.flatMap(j => ((cu && cu.casillas) || []).filter(k => k.jornada === j));
  /** La casilla que coge ese turno en el cuadrante (la suya o la todoturno), o null. */
  const casillaDelTurno = (cu, turno) => casillasDe(cu).find(k => k.jornada === turno || k.jornada === 'todoturno') || null;
  /** ¿Tiene el cuadrante todas las casillas que admite? (día y noche, o todoturno) */
  const casillasCompletas = cu => {
    const j = new Set(casillasDe(cu).map(k => k.jornada));
    return j.has('todoturno') || (j.has('dia') && j.has('noche'));
  };

  /** Los fijos de un coche, para el buscador. */
  const gente = c => Object.values(c.plazas || {}).filter(Boolean);

  function pintarCuadrantes() {
    const cont = $('#bp-cuadrantes');
    if (T.faltaMigracion) { cont.innerHTML = ''; return; }
    const q = plano($('#bp-busca').value).trim();
    const pasaPersona = p => plano(`${p.nombre} ${p.telefono || ''}`).includes(q);
    const pasa = c => !q || plano([c.matricula, c.modelo, ...gente(c).map(p => `${p.nombre} ${p.telefono || ''}`)].join(' ')).includes(q);

    const cuads = (T.cuadrantes || []).filter(cu => !ZONA || zonaDeCuad(cu) === ZONA);
    const sueltos = (!ZONA || ZONA === SIN) ? (T.coches || []).filter(c => c.cuadranteId == null).filter(pasa) : [];

    // Las zonas en el orden de sus tarjetas (el del servidor: por nombre), y al
    // final los cuadrantes sin zona.
    const orden = (T.zonas || []).map(z => String(z.id)).concat(SIN);
    const piezas = [];
    orden.forEach(clave => {
      const deZona = cuads.filter(cu => zonaDeCuad(cu) === clave)
        .map(cu => {
          // Buscando a la persona de una casilla, sale el cuadrante con TODOS sus
          // coches: la casilla los coge a todos.
          const delCT = !!q && casillasDe(cu).some(k => k.persona && pasaPersona(k.persona));
          return { cu, delCT, lista: delCT ? cochesDe(cu) : cochesDe(cu).filter(pasa) };
        })
        // Buscando, un cuadrante sin nada que coincida se oculta: si no, parece
        // que el buscador no hace nada.
        .filter(x => !q || x.lista.length || x.delCT);
      if (!deZona.length) return;
      if (!ZONA) piezas.push(cabeceraZona(clave));
      deZona.forEach(x => piezas.push(seccionCuadrante(x.cu, x.lista)));
    });
    if (sueltos.length) piezas.push(seccionSueltos(sueltos));

    if (!piezas.length) {
      cont.innerHTML = vacio(q);
      return;
    }
    // Todavía sin cuadrantes: se dice cómo empezar, encima de los coches.
    if (!q && !ZONA && !(T.cuadrantes || []).length && (T.coches || []).length) piezas.unshift(comoEmpezar());
    cont.innerHTML = piezas.join('');
  }

  function vacio(q) {
    if (q) return `<div class="p-10 text-center text-sm text-telecab-muted border border-telecab-border rounded-2xl">No hay coches que coincidan con «${esc(q)}».</div>`;
    if (ZONA && ZONA !== SIN) {
      return `<div class="px-6 py-10 text-center border border-dashed border-telecab-border rounded-2xl">
        <p class="text-sm font-semibold">${esc(nombreZona(ZONA))} todavía no tiene cuadrantes</p>
        <p class="mt-1 text-xs text-telecab-muted">Crea uno y mete sus coches con «+ Coche».</p>
        <button type="button" data-accion="nuevo-cua" class="tc-pulsable mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-telecab-gold text-telecab-dark font-semibold text-sm">
          <i class="fa-solid fa-plus" aria-hidden="true"></i>Nuevo cuadrante en ${esc(nombreZona(ZONA))}</button>
      </div>`;
    }
    if (ZONA === SIN) return '<div class="p-10 text-center text-sm text-telecab-muted border border-telecab-border rounded-2xl">Todos los cuadrantes tienen zona y todos los coches están en un cuadrante.</div>';
    return `<div class="p-10 text-center text-sm text-telecab-muted border border-telecab-border rounded-2xl">
      Todavía no hay coches de Barcelona: la ingesta los trae de BOLT cada seis horas, y los de Vehículos salen si tienen la sede Barcelona.</div>`;
  }

  function comoEmpezar() {
    return `<div class="rounded-2xl border border-telecab-border bg-telecab-card p-4 text-sm">
      <p class="font-semibold flex items-center gap-2"><i class="fa-solid fa-circle-info text-telecab-gold" aria-hidden="true"></i>Todavía no hay cuadrantes</p>
      <p class="text-telecab-muted mt-1">Como en Madrid: crea las zonas con «Zonas», un cuadrante con «+ Cuadrante» y mete sus coches con «+ Coche».
        Si lleva correturnos, agrégale su casilla con «+ CT». Mientras, los coches están abajo, en «Coches sin cuadrante», y se planifican igual.</p>
    </div>`;
  }

  /** Sin zona abierta, cada zona abre su tramo con su nombre y lo que tiene (como cabeceraBase de Madrid). */
  function cabeceraZona(clave) {
    const k = cuentaZona(clave);
    const falta = k.huecos ? `${plural(k.huecos, 'hueco')} ${cuando()}` : '';
    return `<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-4 border-t border-telecab-border first:pt-0 first:border-t-0">
      <h3 class="text-base font-semibold whitespace-nowrap">${esc(nombreZona(clave))}</h3>
      <span class="text-xs text-telecab-muted tabular-nums">${plural(k.coches, 'coche')} · ${plural(k.cuadrantes, 'cuadrante')}</span>
      ${falta ? `<span class="text-xs font-semibold text-telecab-warn">${esc(falta)}</span>` : ''}
      <button type="button" data-zona="${esc(clave)}" class="tc-pulsable ml-auto text-xs text-telecab-muted hover:text-telecab-gold">Ver solo ${clave === SIN ? 'estos' : esc(nombreZona(clave))} <i class="fa-solid fa-arrow-right text-[10px]" aria-hidden="true"></i></button>
    </div>`;
  }

  function seccionCuadrante(cu, lista) {
    const n = cochesDe(cu).length;
    const casillas = casillasDe(cu);
    // Sin casillas se dice, porque cambia lo que pasa cuando libra un fijo: ese
    // turno no sale. Con ellas, ya se ven en su columna.
    const sinCT = casillas.length ? ''
      : ` · <span title="${esc('Este cuadrante no tiene CT: el día que libra un fijo, ese turno el coche no sale (no es hueco). Se le agrega con «+ CT».')}">sin CT</span>`;
    // «+ CT» sale mientras quede alguna casilla que poner: con día y noche, o
    // con todoturno, ya no cabe ninguna (Camilo: «Si se escoge día o noche no se
    // puede elegir luego el todoturno y viceversa»).
    const masCT = casillasCompletas(cu) ? ''
      : `<button type="button" data-accion="ct-agregar" aria-label="Agregar CT al ${esc(tituloCuad(cu))}"
                title="Agregar CT al cuadrante: una casilla de día, de noche o todoturno que coge las plazas que no se trabajan"
                class="tc-pulsable px-2.5 py-1 rounded-lg text-xs font-semibold bg-telecab-card border border-telecab-border hover:border-telecab-gold/50">
          <i class="fa-solid fa-plus" aria-hidden="true"></i> CT</button>`;
    return `<section data-cuadrante="${esc(cu.id)}" class="scroll-mt-24">
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-telecab-gold flex flex-wrap items-center gap-x-2">
          ${esc(tituloCuad(cu))}
          <span class="text-telecab-muted font-normal normal-case">·
            <button type="button" data-accion="zona-cua" title="Cambiar la zona de este cuadrante: sus coches van con él"
                    class="tc-pulsable inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-telecab-gold">
              <i class="fa-solid fa-location-dot text-[10px]" aria-hidden="true"></i>${cu.zona ? esc(cu.zona) : 'poner zona'}</button>
            · ${plural(n, 'coche')}${sinCT}</span>
        </h3>
        <button type="button" data-accion="nombre-cua" aria-label="Cambiar el nombre del ${esc(tituloCuad(cu))}" title="Ponerle o cambiarle el nombre (el número no cambia)"
                class="tc-pulsable w-7 h-7 rounded-lg text-telecab-muted hover:bg-telecab-card2 hover:text-telecab-gold">
          <i class="fa-solid fa-pen text-[11px]" aria-hidden="true"></i></button>
        <button type="button" data-accion="coche-cua" title="Meter en este cuadrante un coche que no esté en ninguno"
                class="tc-pulsable px-2.5 py-1 rounded-lg text-xs font-semibold bg-telecab-card border border-telecab-border hover:border-telecab-gold/50">
          <i class="fa-solid fa-plus" aria-hidden="true"></i> Coche</button>
        ${masCT}
        <span class="ml-auto"></span>
        <button type="button" data-accion="borrar-cua" class="text-xs text-telecab-muted hover:text-telecab-red"
                title="Dar de baja el cuadrante. Solo se puede vacío: antes hay que sacar sus coches.">
          <i class="fa-solid fa-trash" aria-hidden="true"></i> borrar cuadrante</button>
      </div>
      ${lista.length || casillas.length ? tablaCoches(lista, cu)
        : '<p class="text-xs text-telecab-muted px-3 py-4 border border-dashed border-telecab-border rounded-2xl text-center">Cuadrante vacío. Pulsa «+ Coche» para meter una matrícula.</p>'}
    </section>`;
  }

  function seccionSueltos(lista) {
    return `<section class="scroll-mt-24 ${ZONA ? '' : 'pt-4 border-t border-telecab-border first:pt-0 first:border-t-0'}">
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-telecab-muted flex items-center gap-2"
            title="Coches que no están en ningún cuadrante. Se planifican igual, pero no llevan CT: el día que libra un fijo, ese turno no sale. Para darles zona o CT, mételos en un cuadrante.">
          <i class="fa-solid fa-car-side" aria-hidden="true"></i>Coches sin cuadrante <span class="font-normal normal-case">${lista.length}</span></h3>
      </div>
      ${tablaCoches(lista, null)}
    </section>`;
  }

  const SOL = '<i class="fa-solid fa-sun mr-1 text-telecab-gold" aria-hidden="true"></i>';
  const LUNA = '<i class="fa-solid fa-moon mr-1 text-telecab-gold" aria-hidden="true"></i>';
  const iconoJornada = j => (jornadaDe(j).icono ? `<i class="fa-solid ${jornadaDe(j).icono} mr-1 text-telecab-gold" aria-hidden="true"></i>` : '');

  /**
   * La tabla de un cuadrante (o de los coches sin cuadrante, `cu` null). Las
   * columnas: Matrícula, Descanso, Fijo día, Fijo noche y, después, UNA columna
   * por casilla de CT del cuadrante, con una sola celda que ocupa todas las filas
   * (rowspan): «una sola casilla cogiendo los coches que estén ahí». Va en la
   * primera fila; el navegador coloca las celdas de las demás filas saltándosela.
   */
  function tablaCoches(lista, cu) {
    const casillas = cu ? casillasDe(cu) : [];
    const th = (txt, tit, extra) => `<th class="text-left font-semibold px-3 py-2.5 whitespace-nowrap${extra ? ' ' + extra : ''}"${tit ? ` title="${esc(tit)}"` : ''}>${txt}</th>`;
    const celdas = filas => casillas.map(k => celdaCasilla(cu, k, filas)).join('');
    const filas = lista.length
      ? lista.map((c, i) => filaCoche(c, !!cu, i === 0 ? celdas(lista.length) : '')).join('')
      // Un cuadrante sin coches puede tener ya su casilla (se agregó antes de
      // meterlos): se pinta igual, para poder ponerle a alguien o quitarla.
      : `<tr class="align-top"><td colspan="4" class="px-3 py-4 text-xs text-telecab-muted">Cuadrante vacío. Pulsa «+ Coche» para meter una matrícula.</td>${celdas(1)}<td></td></tr>`;
    return `<div class="overflow-x-auto border border-telecab-border rounded-2xl">
      <table class="w-full text-sm border-collapse">
        <thead class="bg-telecab-card2 text-telecab-muted text-[11px] uppercase tracking-wide">
          <tr>
            ${th('Matrícula')}
            ${th('Descanso', 'Los días que libra cada fijo: el de día (sol) y el de noche (luna).\nSi el cuadrante tiene CT de ese turno, esos días lo lleva su casilla; si no, ese turno el coche no sale.')}
            ${th(SOL + 'Fijo día', 'El turno de día: de 00:00 a 24:00.')}
            ${th(LUNA + 'Fijo noche', 'El turno de noche: de 12:00 a 12:00 del día siguiente.')}
            ${casillas.map(k => th(iconoJornada(k.jornada) + esc(jornadaDe(k.jornada).titulo),
              `La casilla de ${jornadaDe(k.jornada).nombre} del cuadrante: una sola persona que coge ${jornadaDe(k.jornada).coge}.\n` +
              'Ninguna plaza se repite: no coge dos coches el mismo día. Los días que no coge ninguna, libra.',
              'border-l border-telecab-border')).join('')}
            <th class="w-12" aria-label="Acciones"></th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
  }

  // 'deactivated' es el que de verdad da BOLT (sede_bolt_vehiculo.estado_bolt):
  // sin él la fila decía «deactivated en BOLT», en inglés.
  const estadoBolt = e => ({ inactive: 'desactivado', deactivated: 'desactivado', blocked: 'bloqueado', suspended: 'suspendido' }[String(e || '').toLowerCase()] || e || 'desactivado');

  /**
   * Una fila de coche. `casillasTd` son las celdas de las casillas (solo en la
   * primera fila). El coche desactivado se atenúa en SUS celdas, no en la fila:
   * la de la casilla, que cuelga de la primera fila, es de todo el cuadrante.
   */
  function filaCoche(c, enCuadrante, casillasTd) {
    const apagado = c.activo ? '' : ' opacity-70';
    const aviso = !c.activo
      ? ` · <span class="text-telecab-warn">${esc(estadoBolt(c.estadoBolt))}${c.enBolt ? ' en BOLT' : ''}</span>`
      : !c.enBolt
        ? ' · <span class="text-telecab-warn" title="Está en Vehículos con sede Barcelona, pero no en la empresa de BOLT de Barcelona: hasta que se dé de alta, nadie puede trabajar con él en BOLT.">No está dado de alta en BOLT</span>'
        : '';
    return `<tr data-mat="${esc(c.matricula)}" class="border-t border-telecab-border/70 align-top scroll-mt-24">
      <td class="px-3 py-2.5 whitespace-nowrap${apagado}">
        <div class="font-mono font-semibold">${esc(c.matricula)}</div>
        <div class="text-xs text-telecab-muted">${esc(c.modelo || '')}${aviso}</div>
      </td>
      <td class="px-3 py-2.5 whitespace-nowrap${apagado}">${celdaDescanso(c)}</td>
      <td class="px-3 py-2.5${apagado}">${celdaPlaza(c, 'dia')}</td>
      <td class="px-3 py-2.5${apagado}">${celdaPlaza(c, 'noche')}</td>
      ${casillasTd}
      <td class="px-2 py-2.5 text-right whitespace-nowrap">
        <button type="button" data-accion="${enCuadrante ? 'sacar' : 'meter'}" aria-label="${enCuadrante ? 'Sacar del cuadrante' : 'Meter en un cuadrante'} ${esc(c.matricula)}"
                title="${enCuadrante ? 'Sacar del cuadrante (queda en «Coches sin cuadrante», sin CT)' : 'Meter en un cuadrante'}"
                class="w-8 h-8 rounded-lg text-telecab-muted hover:bg-telecab-card2 hover:text-telecab-gold transition">
          <i class="fa-solid ${enCuadrante ? 'fa-object-ungroup' : 'fa-object-group'}" aria-hidden="true"></i></button>
      </td>
    </tr>`;
  }

  // El descanso: uno por fijo, siempre. El sol para el de día y la luna para el
  // de noche (db/203 de Madrid). Qué pasa esos días lo decide el cuadrante: con
  // casilla de ese turno, la coge su persona; sin ella, el turno no sale.
  function celdaDescanso(c) {
    const boton = (turno, icono) => {
      const dias = ((c.descansoTurno || {})[turno]) || [];
      const txt = dias.length ? 'libra ' + diasTexto(dias) : 'no libra';
      return `<button type="button" data-accion="desc-turno" data-turno="${turno}"
                title="${esc(`Los días que libra el fijo de ${nombreTurno(turno)}. Si el cuadrante tiene CT de ${nombreTurno(turno)} (o todoturno), esos días lo lleva su casilla; si no, ese turno el coche no sale. Pincha para cambiarlos.`)}"
                class="tc-pulsable inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold border hover:border-telecab-gold/50
                       ${dias.length ? 'bg-telecab-gold/10 text-telecab-gold border-telecab-gold/30' : 'border-dashed border-telecab-border text-telecab-muted'}">
                <i class="fa-solid ${icono} text-[9px]" aria-hidden="true"></i>${esc(txt)}</button>`;
    };
    return `<div class="flex flex-col items-start gap-1">${boton('dia', 'fa-sun')}${boton('noche', 'fa-moon')}</div>`;
  }

  const CLAVE = { dia: 'fijoDia', noche: 'fijoNoche' };

  /**
   * Una persona puesta (un fijo o la de una casilla): el nombre con su promedio,
   * el teléfono y la línea de debajo (`sub`, ya escapada); tachada si la cuenta
   * ya no está activa en BOLT. Es un botón: pulsarlo la cambia o la quita.
   */
  function botonPersona(p, datos, sub, titulo) {
    return `<button type="button" ${datos} class="text-left w-full group" title="${esc(titulo)}">
        <span class="flex flex-wrap items-center gap-1.5">
          <span class="${p.activa === false ? 'line-through text-telecab-muted' : 'font-medium group-hover:text-telecab-gold'} transition">${esc(p.nombre)}</span>
          ${chipPromedio(p.promedio)}
        </span>
        ${p.telefono ? `<span class="block text-[11px] text-telecab-muted font-mono tabular-nums">${esc(p.telefono)}</span>`
                     : '<span class="block text-[11px] text-telecab-warn/80">sin teléfono</span>'}
        <span class="block text-xs text-telecab-muted">${sub}</span>
        ${p.activa === false ? '<span class="block text-[11px] text-telecab-warn font-semibold">ya no está activa en BOLT</span>' : ''}
      </button>`;
  }

  /** El botón de una plaza o casilla libre: borde discontinuo y «+ Asignar». */
  const botonLibre = (datos, titulo) => `<button type="button" ${datos} title="${esc(titulo)}"
      class="tc-pulsable text-left w-full px-2 py-1 rounded-lg border border-dashed border-telecab-border text-telecab-muted text-sm hover:border-telecab-gold/60 hover:text-telecab-text">
      <i class="fa-solid fa-plus text-xs mr-1" aria-hidden="true"></i>Asignar</button>`;

  /**
   * La plaza de un fijo. Libre: «+ Asignar». Ocupada: la persona, «libra L M» y
   * «desde dd/mm». Debajo, cómo está ESE turno ese día (lineaTurno).
   */
  function celdaPlaza(c, turno) {
    const p = (c.plazas || {})[CLAVE[turno]];
    const datos = `data-accion="plaza" data-turno="${turno}"`;
    let html;
    if (!p) {
      html = botonLibre(datos, 'Plaza libre. Pincha para poner a alguien.');
    } else {
      const d = diasTexto((c.descansoTurno || {})[turno]);
      const sub = `${d ? 'libra ' + d : 'no libra'} · desde ${ddmm(p.desde)}${p.hasta ? ` · hasta ${ddmm(p.hasta)}` : ''}`;
      html = botonPersona(p, datos, esc(sub),
        `${p.nombre}, desde el ${isoAes(p.desde)}${p.hasta ? ' hasta el ' + isoAes(p.hasta) : ''}. Pincha para cambiarlo o dejar la plaza libre.`);
    }
    return html + lineaTurno(c, turno);
  }

  const pastilla = (txt, cls, tit, icono) => `<span class="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold border ${cls}" title="${esc(tit)}">
      ${icono ? `<i class="fa-solid ${icono} text-[9px]" aria-hidden="true"></i>` : ''}${esc(txt)}</span>`;
  const GRIS = 'bg-telecab-card2 border-telecab-border text-telecab-muted';
  const ROJO = 'bg-telecab-red/10 border-telecab-red/40 text-telecab-red';
  const VIOLETA = 'bg-telecab-violet/10 border-telecab-violet/30 text-telecab-violet';

  /**
   * Cómo está el turno de un fijo ese día (`turnos` del tablero, que decide el
   * servidor):
   *   'cubre-ct' → «libra hoy · lo cubre el CT»: libra y lo lleva la casilla;
   *   'hueco'    → «libra hoy · hueco» si libra y la casilla está vacía, o
   *                «hueco» si no tiene fijo;
   *   'libra'    → «libra hoy»: libra y no hay casilla de ese turno, el coche no sale;
   *   'trabaja'  → nada que decir.
   */
  function lineaTurno(c, turno) {
    const st = (c.turnos || {})[turno];
    const fijo = (c.plazas || {})[CLAVE[turno]];
    const t = nombreTurno(turno);
    const cu = cuadDe(c);
    // Un coche desactivado en BOLT (o que ya no es de la sede) no sale: su turno
    // sin nadie no es un hueco rojo que cubrir. Tampoco cuenta en la cifra de
    // Huecos ni en las tarjetas de zona.
    if (!c.activo && st === 'hueco') {
      const porque = c.enBolt ? 'coche desactivado' : 'ya no es de la sede';
      return pastilla(`no sale · ${porque}`, GRIS,
        `El coche no está activo (${porque}): ese turno no sale y no cuenta en las cifras de arriba. Si vuelve a estar activo, sale como cualquier otro.`, 'fa-ban');
    }
    if (st === 'cubre-ct') {
      const k = casillasDe(cu).find(x => x.hoy && x.hoy.matricula === c.matricula && x.hoy.turno === turno) || casillaDelTurno(cu, turno);
      const quien = k && k.persona ? k.persona.nombre : 'el correturnos';
      return pastilla(`libra ${cuando()} · lo cubre el CT`, VIOLETA,
        `Libra el fijo de ${t}; ese día lleva el coche ${quien}${k && cu ? `, la casilla de ${jornadaDe(k.jornada).nombre} del ${tituloCuad(cu)}` : ''}.`, 'fa-user-group');
    }
    if (st === 'libra') {
      return pastilla(`libra ${cuando()}`, GRIS, cu
        ? `Libra el fijo de ${t} y el ${tituloCuad(cu)} no tiene CT de ${t}: ese turno el coche no sale. Es lo planificado, no un hueco.`
        : `Libra el fijo de ${t} y el coche no está en ningún cuadrante, así que no lleva CT: ese turno no sale. Es lo planificado, no un hueco.`, 'fa-mug-hot');
    }
    if (st === 'hueco') {
      // La libranza es de la plaza (matrícula y turno): libra aunque no tenga fijo.
      const libra = ((c.descansoTurno || {})[turno] || []).map(Number).includes(isodow(DIA)) || !!(fijo && fijo.libraHoy);
      if (libra) {
        const k = casillaDelTurno(cu, turno);
        return pastilla(`libra ${cuando()} · hueco`, ROJO,
          `Libra el fijo de ${t} y ${k ? `la casilla de ${jornadaDe(k.jornada).nombre} del ${tituloCuad(cu)} está vacía: pon a alguien en ella` : 'nadie lo coge'}.`,
          'fa-triangle-exclamation');
      }
      return pastilla(`hueco ${cuando()}`, ROJO, `Ese turno tiene que salir y no lo lleva nadie: no tiene fijo de ${t}.`, 'fa-triangle-exclamation');
    }
    return '';
  }

  // ── Las casillas de CT ──────────────────────────────────────────────────────

  /** Lo que coge una casilla, por día de la semana (y de día antes que de noche). */
  const cubreOrdenado = k => (k.cubre || []).slice()
    .sort((a, b) => Number(a.dia) - Number(b.dia) || Number(a.turno === 'noche') - Number(b.turno === 'noche'));
  /** Una plaza que coge, en texto: «L 1111AAA», y en la todoturno con su turno: «M 2222BBB (noche)». */
  const textoCoge = (x, k) => `${DIAS_LETRA[Number(x.dia) - 1] || '?'} ${x.matricula}${k.jornada === 'todoturno' ? ` (${nombreTurno(x.turno)})` : ''}`;
  /** Los días que libra la casilla, en texto. */
  const textoLibra = k => { const l = (k.libra || []).map(Number); return l.length >= 7 ? 'todos los días' : l.length ? diasTexto(l) : 'no libra'; };

  /**
   * «cubre: L 1111AAA · M 2222BBB …»: lo que coge cada día de la semana. En la
   * todoturno, cada plaza con su sol o su luna. La del día que se mira, resaltada.
   */
  function lineaCubre(k) {
    const cubre = cubreOrdenado(k);
    if (!cubre.length) {
      return `<p class="mt-2 text-xs text-telecab-muted">Todavía no coge nada: ${k.jornada === 'todoturno' ? 'ningún fijo' : `ningún fijo de ${nombreTurno(k.jornada)}`} del cuadrante libra.</p>`;
    }
    const h = k.hoy;
    const items = cubre.map(x => {
      const esHoy = h && Number(x.dia) === isodow(DIA) && h.matricula === x.matricula && h.turno === x.turno;
      const turno = k.jornada === 'todoturno'
        ? ` <i class="fa-solid ${x.turno === 'noche' ? 'fa-moon' : 'fa-sun'} text-[9px]" role="img" aria-label="de ${nombreTurno(x.turno)}" title="de ${nombreTurno(x.turno)}"></i>` : '';
      return `<span class="whitespace-nowrap${esHoy ? ' text-telecab-text font-semibold' : ''}"><b class="font-semibold">${DIAS_LETRA[Number(x.dia) - 1] || '?'}</b> <span class="font-mono">${esc(x.matricula)}</span>${turno}</span>`;
    });
    return `<p class="mt-2 text-xs text-telecab-muted leading-relaxed" title="${esc(`Las plazas que coge cada día de la semana: las que no se trabajan porque libra su fijo. Ninguna se repite.`)}">
      <span class="text-[10px] uppercase tracking-wide font-semibold">cubre</span> ${items.join(' · ')}</p>`;
  }

  /**
   * LAS PLAZAS REPETIDAS (`repetidas` del tablero): días en que la casilla
   * tendría que coger más de una plaza. Las escrituras no lo dejan pasar, pero
   * la conversión de db/236 pudo dejar alguno (dos CT por coche que libraban el
   * mismo día). La casilla coge la primera y las demás quedan en hueco: se dice
   * en rojo hasta que se cambie una de esas libranzas.
   */
  function lineaRepetidas(k) {
    const reps = (k.repetidas || []).filter(x => (x.plazas || []).length > 1);
    if (!reps.length) return '';
    const items = reps.map(x => `el ${DIAS_LETRA[Number(x.dia) - 1] || '?'} ${x.plazas.map(p => `${p.matricula} (${nombreTurno(p.turno)})`).join(' y ')}`);
    return `<p class="mt-2 text-xs font-semibold text-telecab-red" title="${esc('Ninguna plaza se puede repetir: la casilla no coge dos coches a la vez. Coge la primera y las demás quedan en hueco. Cambia una de esas libranzas.')}">
      <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>Plaza repetida: libran ${esc(items.join('; '))}. Cambia una de esas libranzas.</p>`;
  }

  /**
   * LOS DOBLES TURNOS (`dobles` del tablero): días en que la persona de la
   * casilla tendría que coger un coche en un turno en que ya es fija de otro.
   * Las escrituras no lo dejan pasar, pero la conversión de db/236 pudo dejar
   * alguno (un CT por coche que también era fijo pasa a una casilla que coge a
   * todos los coches del cuadrante). Se dice en rojo hasta que se arregle.
   */
  function lineaDobles(k) {
    const dobles = (k.dobles || []).filter(x => (x.dias || []).length);
    if (!k.persona || !dobles.length) return '';
    const items = dobles.map(x => `del ${x.matricula} de ${nombreTurno(x.turno)} (los ${x.dias.map(d => DIAS_LETRA[Number(d) - 1] || '?').join(' ')})`);
    return `<p class="mt-2 text-xs font-semibold text-telecab-red" title="${esc('Nadie lleva dos coches a la vez: esos días la casilla la pone a coger un coche mientras trabaja de fija en otro. Quítala de la casilla o de su plaza fija, o cambia una libranza.')}">
      <i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>Dobla turno: ${esc(k.persona.nombre)} también es fija ${esc(items.join(' y '))}. Quítala de una de las dos.</p>`;
  }

  /** Cómo está la casilla el día que se mira: a quién cubre, o que libra, o el hueco si está vacía. */
  function estadoCasilla(k) {
    const h = k.hoy;
    if (k.persona) {
      if (h) {
        return pastilla(`cubre ${cuando()} ${h.matricula} de ${nombreTurno(h.turno)}`, VIOLETA,
          `${mayus(cuando())} libra el fijo de ${nombreTurno(h.turno)} del ${h.matricula}: lleva el coche ${k.persona.nombre}.`, 'fa-user-group');
      }
      return pastilla(`libra ${cuando()}`, GRIS,
        `${mayus(cuando())} no libra ningún fijo que coja esta casilla: ${k.persona.nombre} libra.`, 'fa-mug-hot');
    }
    if (h) {
      return pastilla(`hueco ${cuando()} · ${h.matricula} de ${nombreTurno(h.turno)}`, ROJO,
        `${mayus(cuando())} libra el fijo de ${nombreTurno(h.turno)} del ${h.matricula} y la casilla está vacía: nadie lleva ese turno. Pulsa «Asignar».`,
        'fa-triangle-exclamation');
    }
    return '';
  }

  /**
   * LA CASILLA: una celda que ocupa todas las filas del cuadrante (`filas`). La
   * persona (o «+ Asignar»), lo que coge, su libranza, cómo está ese día y el
   * botón para quitarla.
   */
  function celdaCasilla(cu, k, filas) {
    const J = jornadaDe(k.jornada);
    const p = k.persona;
    const datos = `data-accion="casilla" data-jornada="${esc(k.jornada)}"`;
    const desde = (p && p.desde) || k.desde;
    const quien = p
      ? botonPersona(p, datos, esc(`desde ${ddmm(desde)}${p.hasta ? ` · hasta ${ddmm(p.hasta)}` : ''}`),
        `${p.nombre}, ${J.nombre} del ${tituloCuad(cu)} desde el ${isoAes(desde)}. Pincha para cambiarlo o dejar la casilla vacía.`)
      : botonLibre(datos, `Casilla vacía${k.desde ? ` desde el ${isoAes(k.desde)}` : ''}. Pincha para poner a alguien.`);
    const libra = cubreOrdenado(k).length
      ? `<p class="text-xs text-telecab-muted" title="${esc('Los días que no coge ninguna plaza del cuadrante: los que no libra ningún fijo que coja. Se calcula solo.')}">
          <span class="text-[10px] uppercase tracking-wide font-semibold">libra</span> ${esc(textoLibra(k))}</p>` : '';
    return `<td rowspan="${filas}" class="px-3 py-2.5 align-top border-l border-telecab-border/70 min-w-[13rem] max-w-[20rem]">
      ${quien}
      ${lineaCubre(k)}
      ${libra}
      ${lineaRepetidas(k)}
      ${lineaDobles(k)}
      ${estadoCasilla(k)}
      <button type="button" data-accion="quitar-casilla" data-jornada="${esc(k.jornada)}"
              aria-label="Quitar la casilla de ${esc(J.nombre)} del ${esc(tituloCuad(cu))}" title="Quitar esta casilla del cuadrante desde el día que se mira"
              class="mt-2 block text-[11px] text-telecab-muted hover:text-telecab-red">
        <i class="fa-solid fa-trash mr-1" aria-hidden="true"></i>quitar la casilla</button>
    </td>`;
  }

  // ── Sin plaza ───────────────────────────────────────────────────────────────

  function pintarSinPlaza() {
    if (T.faltaMigracion) { $('#bp-sinplaza-n').textContent = ''; $('#bp-sinplaza').innerHTML = ''; return; }
    const lista = (T.sinPlaza || []).slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
    $('#bp-sinplaza-n').textContent = lista.length ? plural(lista.length, 'persona') : '';
    $('#bp-sinplaza').innerHTML = lista.length
      ? lista.map(p => `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-telecab-card2 border border-telecab-border text-xs">
          <b class="text-telecab-text font-semibold">${esc(p.nombre)}</b>
          ${p.telefono ? `<span class="text-telecab-muted font-mono tabular-nums">${esc(p.telefono)}</span>` : ''}
          ${chipPromedio(p.promedio)}</span>`).join('')
      : '<span class="text-xs text-telecab-muted">Todos tienen plaza.</span>';
  }

  // ══════════ LAS ACCIONES ══════════

  /** Dónde está ya alguien ese día, en palabras: «fijo de día en 1234ABC», «CT de noche del C1». */
  const textoPlaza = x => (x.rol === 'ct'
    ? `${jornadaDe(x.jornada).nombre} del ${tituloCuad(x.cuadrante)}`
    : `fijo de ${nombreTurno(x.turno)} en ${x.matricula}`);

  /**
   * Las cuentas activas para el selector, con dónde está ya cada una. Primero
   * las que no tienen plaza: es a quien se suele buscar. La que ocupa la plaza
   * se añade aunque ya no esté activa: si no, el selector saldría sin nada
   * elegido y «Guardar» la quitaría sin quererlo.
   */
  function opcionesConductores(actual) {
    const lista = (T.conductores || []).slice().sort((a, b) =>
      (Number(!!(plazasDe.get(a.uuid) || []).length) - Number(!!(plazasDe.get(b.uuid) || []).length))
      || String(a.nombre).localeCompare(String(b.nombre), 'es'));
    const ops = lista.map(p => {
      const sus = plazasDe.get(p.uuid) || [];
      const pr = p.promedio;
      return { valor: p.uuid, texto: p.nombre,
        detalle: [p.telefono, sus.length ? 'ahora ' + sus.map(textoPlaza).join(' · ') : 'sin plaza',
          pr && !pr.ne && pr.horas != null ? `${fmt1(pr.horas)} h de promedio` : ''].filter(Boolean).join(' · ') };
    });
    if (actual && !ops.some(o => o.valor === actual.uuid)) {
      ops.unshift({ valor: actual.uuid, texto: actual.nombre + (actual.activa === false ? ' (ya no activa en BOLT)' : ''),
        detalle: 'Es quien está ahora' });
    }
    return ops;
  }

  const buscadorConductor = { marcador: 'Busca por nombre o teléfono', tope: 12 };
  const nombreDe = uuid => ((T.conductores || []).find(p => p.uuid === uuid) || {}).nombre || 'la persona';

  // Poner, cambiar o quitar al fijo de una plaza. Un fijo no elige días: hace
  // todos menos su libranza.
  async function asignarPlaza(mat, turno) {
    const c = cochePorMat.get(mat);
    if (!c) return;
    const actual = (c.plazas || {})[CLAVE[turno]] || null;
    const t = nombreTurno(turno);
    const v = await Dialogo.formulario(`Fijo ${t} · ${mat}`, [
      { id: 'uuid', etiqueta: 'Conductor', tipo: 'lista', opciones: opcionesConductores(actual), valor: actual ? actual.uuid : '',
        buscador: buscadorConductor, ayuda: `Si ya era fijo de ${t} en otra matrícula, se mueve aquí. «Sin dato» deja la plaza libre.` },
      { id: 'desde', etiqueta: 'Desde', tipo: 'fecha', valor: isoAes(DIA),
        ayuda: 'Vale todos los días desde esa fecha hasta que se cambie. Lo de antes se cierra la víspera.' },
    ], {
      textoBoton: 'Guardar', ancho: 'max-w-lg',
      nota: `Un fijo hace todos los días menos su libranza (${diasTexto((c.descansoTurno || {})[turno]) || 'ahora no libra'}).`,
    });
    if (!v) return;
    const uuid = v.uuid || null;
    // Lo mismo que había: no se escribe nada. Salvo que se adelante el «desde»
    // de quien ya estaba (corregir desde cuándo lleva la plaza): eso sí se manda.
    if (uuid === (actual ? actual.uuid : null) && !(actual && actual.desde && v.desde && v.desde < actual.desde)) {
      Dialogo.hecho('Ya estaba así.', { tono: 'info' });
      return;
    }
    const r = await escribir('/barcelona/api/asignar', { matricula: mat, turno, rol: 'fijo', uuid, desde: v.desde || DIA },
      { titulo: 'No se pudo guardar' });
    if (!r) return;
    hecho(r, r.cambio === false ? 'Ya estaba así.' : r.movidaDe ? `Hecho. Se ha movido desde ${r.movidaDe}.` : 'Hecho.');
  }

  /**
   * Lo que ya coge la casilla de ese turno sin contar esta plaza: esos días este
   * fijo no puede librar (Camilo: «si el coche xxxx tiene como libranza el de día
   * el L, no puede haber otro coche descansando de día el L»). Es una ayuda: la
   * regla, con las fechas, la mira el servidor.
   */
  function yaCoge(c, turno, k) {
    if (!k) return '';
    const otras = cubreOrdenado(k).filter(x => !(x.matricula === c.matricula && x.turno === turno));
    return otras.length
      ? `La casilla de ${jornadaDe(k.jornada).nombre} ya coge ${otras.map(x => textoCoge(x, k)).join(' · ')}: esos días este fijo no puede librar, porque la casilla no coge dos plazas a la vez.`
      : '';
  }

  // La libranza de un fijo: sus días, con el sol o la luna. Qué pasa esos días
  // depende del cuadrante, y la nota lo dice.
  async function fijarDescansoTurno(mat, turno) {
    const c = cochePorMat.get(mat);
    if (!c) return;
    const t = nombreTurno(turno);
    const cu = cuadDe(c);
    const k = casillaDelTurno(cu, turno);
    const actual = ((c.descansoTurno || {})[turno] || []).map(Number);
    const queDias = k
      ? `Esos días lo lleva la casilla de ${jornadaDe(k.jornada).nombre} del ${tituloCuad(cu)}${k.persona ? ` (${k.persona.nombre})` : ', ahora vacía: serían huecos'}.`
      : cu ? `El ${tituloCuad(cu)} no tiene CT de ${t}: esos días, el turno de ${t} no sale.`
        : `El coche no está en ningún cuadrante, así que no lleva CT: esos días, el turno de ${t} no sale.`;
    const v = await Dialogo.formulario(`Libranza del fijo de ${t} · ${mat}`, [
      { id: 'dias', etiqueta: 'Días que libra', tipo: 'semana', valor: actual,
        ayuda: [yaCoge(c, turno, k), 'Sin ninguno marcado, no libra.'].filter(Boolean).join(' ') },
    ], { textoBoton: 'Guardar', ancho: 'max-w-lg', nota: `Desde el ${isoAes(DIA)}. Los días que libra el fijo de ${t}. ${queDias}` });
    if (!v) return;
    if (mismosDias(v.dias, actual)) { Dialogo.hecho('Ya estaba así.', { tono: 'info' }); return; }
    const r = await escribir('/barcelona/api/descanso', { matricula: mat, turno, dias: v.dias, desde: DIA },
      { titulo: 'No se pudo guardar la libranza' });
    if (r) hecho(r, `El fijo de ${t} de ${mat} ${v.dias.length ? 'libra ' + diasTexto(v.dias) : 'no libra'}.`);
  }

  /**
   * «+ CT»: AGREGAR CT AL CUADRANTE. Camilo: «se abre con 3 opciones: día,
   * noche, todoturno. Si se escoge día o noche no se puede elegir luego el
   * todoturno y viceversa». Lo que se puede agregar lo dice el servidor
   * (`puedeAgregar`); aquí se dice por qué no lo otro.
   *
   * El selector de la casa (Dialogo.elegir, la lista de Dialogo.formulario) no
   * tiene opciones apagadas: se ofrecen solo las que caben y, debajo, las que no
   * y por qué. Va todo en un formulario —la casilla y desde cuándo— porque son
   * las dos preguntas de lo mismo. Nace vacía: la persona se pone pulsándola.
   */
  async function agregarCasilla(cu) {
    const pa = cu.puedeAgregar || {};
    const tiene = j => casillasDe(cu).some(k => k.jornada === j);
    const porQueNo = j => {
      if (tiene(j)) return 'ya la tiene';
      if (j === 'todoturno' && (tiene('dia') || tiene('noche'))) {
        return `no va junto a ${tiene('dia') && tiene('noche') ? 'la de día y la de noche' : tiene('dia') ? 'la de día' : 'la de noche'}`;
      }
      if (j !== 'todoturno' && tiene('todoturno')) return 'ya tiene la todoturno, que coge los dos turnos';
      return 'dos fijos que cogería libran el mismo día, y una casilla no coge dos plazas a la vez: cambia antes esas libranzas';
    };
    const si = JORNADAS.filter(j => pa[j]);
    const no = JORNADAS.filter(j => !pa[j]);
    if (!si.length) {
      await Dialogo.aviso({ titulo: `No se puede agregar CT al ${tituloCuad(cu)}`, tono: 'aviso',
        texto: no.map(j => `${jornadaDe(j).opcion}: ${porQueNo(j)}.`).join('\n') });
      return;
    }
    const DETALLE = {
      dia: 'Con el sol. Coge los días que libran los fijos de día.',
      noche: 'Con la luna. Coge los días que libran los fijos de noche.',
      todoturno: 'Sin icono. Una sola casilla para los dos turnos: coge los días que libra cualquier fijo, de día o de noche. No va con la de día ni con la de noche.',
    };
    const v = await Dialogo.formulario(`Agregar CT al ${tituloCuad(cu)}`, [
      { id: 'jornada', etiqueta: 'Qué casilla', tipo: 'lista', obligatorio: true, valor: si.length === 1 ? si[0] : '',
        opciones: si.map(j => ({ valor: j, texto: jornadaDe(j).opcion, detalle: DETALLE[j] })),
        ayuda: no.length ? `No se ofrece: ${no.map(j => `${jornadaDe(j).opcion.toLowerCase()} (${porQueNo(j)})`).join('; ')}.` : undefined },
      // Como pronto hoy, como al quitarla (barcelona.service.fechaCT): un día
      // pasado lo guardaría el servidor desde hoy igualmente.
      { id: 'desde', etiqueta: 'Desde', tipo: 'fecha', valor: isoAes(T.hoy && DIA < T.hoy ? T.hoy : DIA), obligatorio: true,
        ayuda: 'La casilla vale desde ese día hasta que se quite. Como pronto hoy: una casilla no se agrega hacia atrás.' },
    ], {
      textoBoton: 'Agregar CT', ancho: 'max-w-lg',
      nota: 'Una sola casilla que coge, cada día, la plaza que no se trabaja porque libra su fijo, en todos los coches del cuadrante. ' +
        'Ninguna plaza se repite: no coge dos coches a la vez. Nace vacía; luego se pone a la persona pulsándola.',
    });
    if (!v || !v.jornada) return;
    const r = await escribir(`/barcelona/api/cuadrantes/${encodeURIComponent(cu.id)}/casillas`, { jornada: v.jornada, desde: v.desde || DIA },
      { titulo: 'No se pudo agregar el CT' });
    if (r) hecho(r, `${tituloCuad(cu)}: casilla de ${jornadaDe(v.jornada).nombre} agregada. Púlsala para poner a la persona.`);
  }

  /**
   * Poner, cambiar o vaciar a la persona de una casilla. Una persona está en una
   * sola casilla y no de fijo en un turno que se pise: lo mira el servidor y, si
   * no, lo dice.
   */
  async function asignarCasilla(cu, jornada) {
    const k = casillasDe(cu).find(x => x.jornada === jornada);
    if (!k) return;
    const J = jornadaDe(jornada);
    const actual = k.persona || null;
    const desdeActual = actual ? (actual.desde || k.desde) : null;
    const coge = cubreOrdenado(k).map(x => textoCoge(x, k)).join(' · ');
    const v = await Dialogo.formulario(`${J.nombre} · ${tituloCuad(cu)}`, [
      { id: 'uuid', etiqueta: 'Correturnos', tipo: 'lista', opciones: opcionesConductores(actual), valor: actual ? actual.uuid : '',
        buscador: buscadorConductor, ayuda: '«Sin dato» deja la casilla vacía: sigue en el cuadrante, y los días que coge son huecos.' },
      { id: 'desde', etiqueta: 'Desde', tipo: 'fecha', valor: isoAes(DIA),
        ayuda: 'Vale todos los días desde esa fecha hasta que se cambie. Lo de antes se cierra la víspera.' },
    ], {
      textoBoton: 'Guardar', ancho: 'max-w-lg',
      nota: (coge ? `Coge ${coge}; libra ${textoLibra(k)}. ` : 'Todavía no coge nada: ningún fijo que coja libra. ') +
        'Una persona solo puede estar en una casilla, y no de fijo en un turno que se pise con ella.',
    });
    if (!v) return;
    const uuid = v.uuid || null;
    if (uuid === (actual ? actual.uuid : null) && !(desdeActual && v.desde && v.desde < desdeActual)) {
      Dialogo.hecho('Ya estaba así.', { tono: 'info' });
      return;
    }
    const r = await escribir(`/barcelona/api/cuadrantes/${encodeURIComponent(cu.id)}/casillas/${encodeURIComponent(jornada)}`,
      { uuid, desde: v.desde || DIA }, { titulo: 'No se pudo guardar la casilla' });
    if (r) hecho(r, uuid ? `${nombreDe(uuid)}, ${J.nombre} del ${tituloCuad(cu)}.` : `La casilla de ${J.nombre} del ${tituloCuad(cu)} queda vacía.`);
  }

  /**
   * Quitar una casilla del cuadrante desde el día que se mira, con confirmación.
   * Nunca antes de hoy (barcelona.service.fechaCT): el pasado de ese cuadrante
   * fue como fue y su reporte tiene que seguir cuadrando. Mirando un día pasado,
   * se quita desde hoy, y el diálogo lo dice.
   */
  async function quitarCasilla(cu, jornada) {
    const k = casillasDe(cu).find(x => x.jornada === jornada);
    if (!k) return;
    const J = jornadaDe(jornada);
    const pasado = !!T.hoy && DIA < T.hoy;
    const desde = pasado ? T.hoy : DIA;
    const ok = await Dialogo.confirmar({
      titulo: `Quitar la casilla de ${J.nombre} · ${tituloCuad(cu)}`, tono: 'aviso', ancho: 'max-w-lg', si: 'Quitar la casilla', no: 'Cancelar',
      html: `<p class="text-sm mb-2">Desde ${pasado ? 'hoy, ' : ''}el <b>${esc(isoAes(desde))}</b>, el ${esc(tituloCuad(cu))} deja de tener ${esc(J.nombre)}:</p>
        <ul class="text-sm list-disc pl-5 space-y-1 mb-2">
          <li>${k.persona ? `<b>${esc(k.persona.nombre)}</b> sale de la casilla; si no tiene otra plaza, pasa a «Sin plaza».` : 'La casilla está vacía: no sale nadie.'}</li>
          <li>Los días que libre un fijo ${jornada === 'todoturno' ? 'del cuadrante' : `de ${nombreTurno(jornada)}`}, ese turno el coche no sale (no es hueco).</li>
          ${pasado ? `<li>Se mira un día pasado, pero una casilla no se quita hacia atrás: hasta ayer sigue como estaba y los reportes no cambian. Después se verá el ${esc(isoAes(desde))}.</li>` : ''}
        </ul>`,
    });
    if (!ok) return;
    const r = await escribir(`/barcelona/api/cuadrantes/${encodeURIComponent(cu.id)}/casillas/${encodeURIComponent(jornada)}?desde=${encodeURIComponent(desde)}`,
      { desde }, { metodo: 'DELETE', titulo: 'No se pudo quitar la casilla' });
    if (r) hecho(r, `El ${tituloCuad(cu)} ya no tiene ${J.nombre}.`);
  }

  // ── Zonas (como gestionarZonas de Madrid, sin ubicación) ────────────────────

  async function gestionarZonas() {
    const zonas = T.zonas || [];
    if (!zonas.length) { await editarZona(null); return; }
    const opciones = zonas.map(z => ({ valor: String(z.id), texto: z.nombre,
      detalle: z.coches ? `${plural(z.coches, 'coche')} en ${plural(z.cuadrantes, 'cuadrante')}`
        : (z.cuadrantes ? `${plural(z.cuadrantes, 'cuadrante')} sin coches` : 'sin cuadrantes') }));
    opciones.push({ valor: '__nueva__', texto: 'Nueva zona…' });
    const v = await Dialogo.formulario('Zonas', [
      { id: 'zona', etiqueta: 'Elige una para cambiarle el nombre o retirarla', tipo: 'lista', opciones, obligatorio: true },
    ], { textoBoton: 'Seguir', nota: 'Las zonas agrupan los cuadrantes, como las bases de Madrid. A un cuadrante se le cambia la zona desde su cabecera.' });
    if (!v || !v.zona) return;
    if (v.zona === '__nueva__') { await editarZona(null); return; }
    const z = zonas.find(x => String(x.id) === v.zona);
    if (!z) return;
    const que = await Dialogo.elegir({
      titulo: `Zona ${z.nombre}`,
      texto: z.cuadrantes ? `Tiene ${plural(z.cuadrantes, 'cuadrante')}: para retirarla, pásalos antes a otra zona.` : 'No tiene cuadrantes.',
      opciones: [
        { texto: 'Cancelar', valor: null },
        { texto: 'Retirarla', valor: 'retirar' },
        { texto: 'Cambiar el nombre', valor: 'nombre', principal: true },
      ],
    });
    if (que === 'nombre') await editarZona(z);
    else if (que === 'retirar') await retirarZona(z);
  }

  /** Crear una zona (`z` null) o renombrarla. Si el servidor no la acepta, el formulario vuelve con lo escrito y el motivo. */
  async function editarZona(z) {
    let nombre = z ? z.nombre : '';
    for (;;) {
      const v = await Dialogo.formulario(z ? `Zona ${z.nombre}` : 'Nueva zona', [
        { id: 'nombre', etiqueta: 'Nombre', tipo: 'texto', valor: nombre, obligatorio: true, max: 60, marcador: 'Eixample' },
      ], {
        textoBoton: z ? 'Guardar' : 'Crear zona',
        nota: z ? 'El nombre nuevo sale a la vez en todas sus tarjetas y cuadrantes.'
          : 'Nace sin cuadrantes. Después creas uno en ella, o pasas uno que ya existe desde su cabecera.',
      });
      if (!v) return;
      nombre = v.nombre;
      if (z && nombre === z.nombre) return;
      try {
        await enviar(z ? `/barcelona/api/zonas/${encodeURIComponent(z.id)}` : '/barcelona/api/zonas', { nombre }, z ? 'PUT' : 'POST');
        // Si la renombrada es la zona abierta, la dirección cambia con ella.
        if (z && ZONA === String(z.id)) elegirZona(ZONA, { apilar: false });
        Dialogo.hecho(z ? `Zona ${nombre} guardada.` : `Zona ${nombre} creada.`);
        return;
      } catch (e) {
        if (e.estado === 401) return;
        await Dialogo.aviso({ titulo: z ? 'No se pudo guardar la zona' : 'No se pudo crear la zona', texto: e.message, tono: 'error' });
      }
    }
  }

  async function retirarZona(z) {
    const ok = await Dialogo.confirmar({
      titulo: `Retirar la zona ${z.nombre}`, tono: 'aviso', si: 'Retirar la zona', no: 'Cancelar',
      texto: 'Deja de salir en el planificador. Solo se puede si no tiene cuadrantes.',
    });
    if (!ok) return;
    const r = await escribir(`/barcelona/api/zonas/${encodeURIComponent(z.id)}`, { activa: false }, { metodo: 'PUT', titulo: 'No se pudo retirar la zona' });
    if (!r) return;
    if (ZONA === String(z.id)) elegirZona('', { apilar: false });
    Dialogo.hecho(`Zona ${z.nombre} retirada.`);
  }

  // ── Cuadrantes ──────────────────────────────────────────────────────────────

  const opcionesZona = () => (T.zonas || []).map(z => ({ valor: String(z.id), texto: z.nombre }))
    .concat({ valor: SIN, texto: 'Sin zona', detalle: 'Se le pone luego desde su cabecera' });

  /**
   * Crea un cuadrante y lleva la vista hasta él. Devuelve su id, o null. Con
   * `seguido` (desde «Meter en un cuadrante») no se para a enseñarlo: el coche
   * entra justo después y es ese aviso el que cuenta.
   */
  async function nuevoCuadrante({ seguido = false } = {}) {
    const v = await Dialogo.formulario('Nuevo cuadrante', [
      { id: 'zona', etiqueta: 'Zona', tipo: 'lista', opciones: opcionesZona(), obligatorio: true,
        valor: ZONA || ((T.zonas || []).length ? '' : SIN) },
      { id: 'nombre', etiqueta: 'Nombre (opcional)', tipo: 'texto', max: 60, marcador: 'Sants',
        ayuda: 'El número se pone solo, el siguiente libre. El nombre es por si se le quiere llamar de otra forma.' },
    ], { textoBoton: 'Crear cuadrante', nota: 'Nace vacío y sin CT. Después le metes los coches con «+ Coche» y, si lleva correturnos, su casilla con «+ CT».' });
    if (!v || !v.zona) return null;
    const antes = new Set((T.cuadrantes || []).map(cu => String(cu.id)));
    const r = await escribir('/barcelona/api/cuadrantes',
      { zonaId: v.zona === SIN ? null : aId(v.zona), nombre: (v.nombre || '').trim() || null },
      { titulo: 'No se pudo crear el cuadrante' });
    if (!r) return null;
    const nuevo = (r.cuadrante && cuadPorId.get(String(r.cuadrante.id))) || (r.id != null && cuadPorId.get(String(r.id)))
      || (T.cuadrantes || []).find(cu => !antes.has(String(cu.id)));
    if (!nuevo) { if (!seguido) Dialogo.hecho('Cuadrante creado.'); return null; }
    // Con otra zona abierta se va a la suya: si no, no se vería.
    if (ZONA && zonaDeCuad(nuevo) !== ZONA) elegirZona(zonaDeCuad(nuevo), { apilar: false });
    if (seguido) return String(nuevo.id);
    resaltar(document.querySelector(`[data-cuadrante="${CSS.escape(String(nuevo.id))}"]`));
    Dialogo.hecho(`${tituloCuad(nuevo)} creado.`);
    return String(nuevo.id);
  }

  function resaltar(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('tc-resalte');
    setTimeout(() => el.classList.remove('tc-resalte'), 1600);
  }

  async function cambiarZonaCuad(cu) {
    const n = cochesDe(cu).length;
    const v = await Dialogo.formulario(`Zona del ${tituloCuad(cu)}`, [
      { id: 'zona', etiqueta: 'Zona', tipo: 'lista', opciones: opcionesZona(), obligatorio: true, valor: zonaDeCuad(cu) },
    ], {
      textoBoton: 'Cambiar zona',
      nota: n ? `${n === 1 ? 'Su coche pasa' : `Sus ${n} coches pasan`} con él: la zona de un coche es la de su cuadrante.` : 'Todavía no tiene coches.',
    });
    if (!v || !v.zona || v.zona === zonaDeCuad(cu)) return;
    const r = await escribir(`/barcelona/api/cuadrantes/${encodeURIComponent(cu.id)}`,
      { zonaId: v.zona === SIN ? null : aId(v.zona) }, { metodo: 'PUT', titulo: 'No se pudo cambiar la zona' });
    if (r) hecho(r, `${tituloCuad(cu)} pasa a ${nombreZona(v.zona)}.`);
  }

  async function nombrarCuad(cu) {
    const v = await Dialogo.formulario(`Nombre del C${cu.numero}`, [
      { id: 'nombre', etiqueta: 'Nombre', tipo: 'texto', valor: cu.nombre || '', max: 60, marcador: 'Sants',
        ayuda: 'Vacío = sin nombre: queda «C' + cu.numero + '». El número no cambia.' },
    ], { textoBoton: 'Guardar' });
    if (!v) return;
    const nombre = (v.nombre || '').trim();
    if (nombre === (cu.nombre || '')) return;
    const r = await escribir(`/barcelona/api/cuadrantes/${encodeURIComponent(cu.id)}`, { nombre: nombre || null },
      { metodo: 'PUT', titulo: 'No se pudo cambiar el nombre' });
    if (r) hecho(r, nombre ? `C${cu.numero} se llama ${nombre}.` : `C${cu.numero} ya no tiene nombre.`);
  }

  async function borrarCuad(cu) {
    const n = cochesDe(cu).length;
    if (n) {
      await Dialogo.aviso({ titulo: `${tituloCuad(cu)} tiene coches`, tono: 'aviso',
        texto: `Para borrarlo, saca antes sus ${plural(n, 'coche')} (el botón de cada fila) o pásalos a otro cuadrante.` });
      return;
    }
    const ok = await Dialogo.confirmar({ titulo: `Borrar el cuadrante ${tituloCuad(cu)}`, tono: 'aviso', si: 'Borrar', no: 'Cancelar',
      texto: 'Está vacío. Su número queda libre para el próximo que se cree.' });
    if (!ok) return;
    const r = await escribir(`/barcelona/api/cuadrantes/${encodeURIComponent(cu.id)}`, undefined, { metodo: 'DELETE', titulo: 'No se pudo borrar el cuadrante' });
    if (r) Dialogo.hecho(`${tituloCuad(cu)} borrado.`);
  }

  /** Las libranzas de un coche, en una línea: «día libra L M · noche no libra». */
  const libranzasTexto = c => ['dia', 'noche'].map(t => {
    const d = diasTexto((c.descansoTurno || {})[t]);
    return `${nombreTurno(t)} ${d ? 'libra ' + d : 'no libra'}`;
  }).join(' · ');
  /** Las casillas de un cuadrante, en palabras: «CT de día y CT de noche», o «sin CT». */
  const casillasTexto = cu => casillasDe(cu).map(k => jornadaDe(k.jornada).nombre).join(' y ') || 'sin CT';

  /** «+ Coche»: los coches que no están en ningún cuadrante. */
  async function cocheAlCuad(cu) {
    const libres = (T.coches || []).filter(c => c.cuadranteId == null);
    if (!libres.length) {
      await Dialogo.aviso({ titulo: 'No hay coches sueltos', tono: 'aviso',
        texto: 'Todos los coches están ya en un cuadrante. Para pasar uno de otro cuadrante, sácalo primero de allí.' });
      return;
    }
    // Con CT en el cuadrante, las libranzas del coche no pueden caer en un día
    // que la casilla ya coge (lo mira el servidor al meterlo, con las fechas).
    const coge = casillasDe(cu).filter(k => cubreOrdenado(k).length)
      .map(k => `la de ${jornadaDe(k.jornada).nombre} coge ${cubreOrdenado(k).map(x => textoCoge(x, k)).join(' · ')}`);
    const v = await Dialogo.formulario(`Meter un coche en el ${tituloCuad(cu)}`, [
      { id: 'mat', etiqueta: 'Matrícula', tipo: 'lista', obligatorio: true,
        buscador: { marcador: 'Busca por matrícula o modelo', tope: 12 },
        opciones: libres.map(c => ({ valor: c.matricula, texto: c.matricula, detalle: [c.modelo, libranzasTexto(c)].filter(Boolean).join(' · ') })) },
    ], { textoBoton: 'Meter', nota: casillasDe(cu).length
      ? `El ${tituloCuad(cu)} tiene ${casillasTexto(cu)}: sus casillas cogerán también este coche, y sus libranzas no pueden repetir día con lo que ya cogen${coge.length ? ` (${coge.join('; ')})` : ''}.`
      : undefined });
    if (!v || !v.mat) return;
    // Con el día que se mira: el servidor devuelve el tablero de ese día (si no,
    // el de hoy, y la pantalla saltaría de día sin que nadie lo pida).
    const r = await escribir(`/barcelona/api/cuadrantes/${encodeURIComponent(cu.id)}/coche`, { matricula: v.mat, fecha: DIA },
      { titulo: 'No se pudo meter el coche' });
    if (r) hecho(r, `${v.mat} entra en el ${tituloCuad(cu)}.`);
  }

  /** Desde «Coches sin cuadrante»: a qué cuadrante va (o uno nuevo). */
  async function meterEnCuad(mat) {
    const opciones = (T.cuadrantes || []).map(cu => ({ valor: String(cu.id), texto: tituloCuad(cu),
      detalle: `${cu.zona || 'Sin zona'} · ${plural(cochesDe(cu).length, 'coche')} · ${casillasTexto(cu)}` }));
    opciones.push({ valor: '__nuevo__', texto: 'Nuevo cuadrante…' });
    const v = await Dialogo.formulario(`Meter ${mat} en un cuadrante`, [
      { id: 'cua', etiqueta: 'Cuadrante', tipo: 'lista', opciones, obligatorio: true },
    ], { textoBoton: 'Seguir', nota: 'Si el cuadrante tiene CT, su casilla coge también este coche: sus libranzas no pueden repetir día con lo que ya coge.' });
    if (!v || !v.cua) return;
    let id = v.cua;
    if (id === '__nuevo__') { id = await nuevoCuadrante({ seguido: true }); if (!id) return; }
    const cu = cuadPorId.get(String(id));
    const r = await escribir(`/barcelona/api/cuadrantes/${encodeURIComponent(id)}/coche`, { matricula: mat, fecha: DIA },
      { titulo: 'No se pudo meter el coche' });
    if (r) hecho(r, `${mat} entra en el ${cu ? tituloCuad(cu) : 'cuadrante'}.`);
  }

  // Sin diálogo de por medio: el botón se apaga mientras dura, porque un doble
  // clic lo mandaría dos veces (lo mismo que sacarDeCuadrante en Madrid).
  async function sacarDeCuad(mat, boton) {
    const c = cochePorMat.get(mat);
    if (!c || c.cuadranteId == null) return;
    const cu = cuadDe(c);
    const r = await escribir(`/barcelona/api/cuadrantes/${encodeURIComponent(c.cuadranteId)}/coche`, { matricula: mat, quitar: true },
      { titulo: 'No se pudo sacar el coche', boton });
    if (r) hecho(r, `${mat} sale del ${cu ? tituloCuad(cu) : 'cuadrante'}: ahora está en «Coches sin cuadrante», sin CT.`);
  }

  // ── Exportar a Excel ────────────────────────────────────────────────────────
  // Camilo (06/11/2026): «no era imprimir sino exportar en excel». El Excel lo
  // monta el servidor (/barcelona/planificador/excel) con lo que se está viendo:
  // el día, la zona abierta y el texto del buscador, con los mismos valores que
  // el filtro de la pantalla. La zona va como su id, «libres» para la tarjeta
  // «Sin zona» (los cuadrantes sin zona y los coches sin cuadrante) o vacía si
  // se ven todas. Se baja como en los reportes de Barcelona: fetch y blob, para
  // que un fallo se diga en un aviso y no deje la pantalla en una página de error.

  async function exportarExcel(boton) {
    if (!T || T.faltaMigracion || !DIA) return;
    const params = new URLSearchParams({ fecha: DIA, zona: !ZONA ? '' : ZONA === SIN ? 'libres' : ZONA, q: $('#bp-busca').value.trim() });
    const antes = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>Preparando…';
    try {
      let r;
      try {
        r = await fetch('/barcelona/planificador/excel?' + params.toString(), { credentials: 'same-origin' });
      } catch (_) {
        throw new Error('No hay conexión con el servidor. Comprueba la red y vuelve a intentarlo.');
      }
      const tipo = r.headers.get('content-type') || '';
      // Con la sesión caducada, el servidor manda al login: llega una página,
      // no un Excel. Se dice en vez de descargar un .xlsx que no abre.
      if (!r.ok || /json|html/.test(tipo)) {
        const j = tipo.includes('json') ? await r.json().catch(() => ({})) : {};
        throw new Error(j.msg || j.error || (r.status === 401 || r.redirected
          ? 'La sesión ha caducado: recarga la página y vuelve a entrar.' : 'No se pudo preparar el Excel.'));
      }
      const disp = r.headers.get('content-disposition') || '';
      const m = disp.match(/filename\*=UTF-8''([^;]+)/i) || disp.match(/filename="?([^";]+)"?/i);
      // El nombre lo pone el servidor, como los de los reportes de Barcelona
      // («Planificador Barcelona 06-11-2026.xlsx»); este es por si no llegara.
      const nombre = (m && decodeURIComponent(m[1])) || `Planificador Barcelona ${DIA.split('-').reverse().join('-')}.xlsx`;
      const fichero = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement('a'), { href: fichero, download: nombre });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(fichero), 5000);
    } catch (e) {
      Dialogo.aviso({ titulo: 'No se pudo exportar', texto: e.message, tono: 'error' });
    } finally {
      boton.disabled = false;
      boton.innerHTML = antes;
    }
  }

  // ══════════ EL ARRANQUE ══════════

  // Todas las acciones de los cuadrantes por un solo escuchador: se repinta con
  // innerHTML a cada guardado, y así no hay que volver a enganchar nada.
  $('#bp-cuadrantes').addEventListener('click', e => {
    const b = e.target.closest('[data-accion], [data-zona]');
    if (!b || !T) return;
    if (b.dataset.zona) { elegirZona(b.dataset.zona); return; }
    const fila = b.closest('tr[data-mat]');
    const mat = fila ? fila.dataset.mat : null;
    const sec = b.closest('[data-cuadrante]');
    const cu = sec ? cuadPorId.get(sec.dataset.cuadrante) : null;
    switch (b.dataset.accion) {
      case 'plaza': return asignarPlaza(mat, b.dataset.turno);
      case 'desc-turno': return fijarDescansoTurno(mat, b.dataset.turno);
      case 'sacar': return sacarDeCuad(mat, b);
      case 'meter': return meterEnCuad(mat);
      case 'nuevo-cua': return nuevoCuadrante();
      case 'zona-cua': return cu && cambiarZonaCuad(cu);
      case 'nombre-cua': return cu && nombrarCuad(cu);
      case 'borrar-cua': return cu && borrarCuad(cu);
      case 'coche-cua': return cu && cocheAlCuad(cu);
      case 'ct-agregar': return cu && agregarCasilla(cu);
      case 'casilla': return cu && asignarCasilla(cu, b.dataset.jornada);
      case 'quitar-casilla': return cu && quitarCasilla(cu, b.dataset.jornada);
      default: return undefined;
    }
  });

  // Las tarjetas de zona: pinchar una la abre; pinchar la abierta vuelve a todas.
  $('#bp-zonas').addEventListener('click', e => {
    const b = e.target.closest('[data-zona]');
    if (b && T) elegirZona(b.dataset.zona === ZONA ? '' : b.dataset.zona);
  });
  $('#bp-todas').addEventListener('click', () => elegirZona(''));
  // «Atrás» y «adelante» del navegador recorren las zonas abiertas.
  window.addEventListener('popstate', () => {
    if (!T) return;
    ZONA = claveDeSlug(zonaDeLaUrl());
    pintarZonas();
    pintarCuadrantes();
  });
  // La cifra de «Sin plaza» lleva a su lista.
  $('#bp-kpis').addEventListener('click', e => {
    const b = e.target.closest('[data-ir]');
    const destino = b && document.querySelector(b.dataset.ir);
    if (destino) destino.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  { let espera; $('#bp-busca').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => { if (T) pintarCuadrantes(); }, 150); }); }
  $('#bp-fecha').addEventListener('change', e => { const iso = esAiso(e.target.value); if (iso && iso !== DIA) cargar(iso); });
  $('#bp-prev').addEventListener('click', () => { if (DIA) cargar(sumarDias(DIA, -1)); });
  $('#bp-next').addEventListener('click', () => { if (DIA) cargar(sumarDias(DIA, 1)); });
  $('#bp-hoy').addEventListener('click', () => cargar(T && T.hoy ? T.hoy : ''));
  // Sin la migración no hay zonas ni cuadrantes que tocar: los botones no hacen nada.
  const listo = () => !!T && !T.faltaMigracion;
  $('#bp-btn-zonas').addEventListener('click', () => { if (listo()) gestionarZonas(); });
  $('#bp-btn-cuadrante').addEventListener('click', () => { if (listo()) nuevoCuadrante(); });
  $('#bp-btn-excel').addEventListener('click', e => { if (listo()) exportarExcel(e.currentTarget); });

  // La zona de la dirección (#zona=eixample) se abre en cuanto llegue el
  // tablero, que es quien sabe qué zonas hay. Sin fecha, el servidor da hoy.
  ZONA_PEDIDA = zonaDeLaUrl() || null;
  cargar('');
})();
