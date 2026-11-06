// modules/Barcelona/vistas/barcelona-planificador.ejs — el JavaScript del planificador de Barcelona.
//
// EL PLANIFICADOR DE BARCELONA v2 (06/11/2026). Camilo: «ahora necesito agregarle
// días de libranzas desde el planificador, además de agregar los promedios de
// cada uno como en el planificador de Madrid, sin letra […] Además de que ahora
// también se van a agregar zonas de Barcelona así como en Madrid, no sé todavía
// si habrá o no CT allá pero actívalo de una vez, por defecto todos deben de
// venir con los CT desactivados». Y: «Prácticamente será el mismo diseño de
// Madrid, solo que la arquitectura y flujo de datos cambia».
//
// Por eso esto COPIA EL DISEÑO Y EL LENGUAJE del cuadrante de Madrid
// (public/assets/js/vistas/Planificacion/planificador/: cuadrante.js, bases.js,
// acciones.js, rendimiento.js) y NO su código: allí se habla con /planificador-v2
// y con plazas de la base; aquí, con /barcelona/api y con matrículas y cuentas de
// BOLT. Lo que se copia, con su nombre de allí para encontrarlo:
//   · las zonas como tarjetas que filtran (tarjetaBase / pintarBases);
//   · un bloque por cuadrante con su cabecera y su tabla (seccionCuadrante, filaCoche);
//   · el descanso: con correturnos, el bloque del coche; sin ellos, el del fijo de
//     día (sol) y el de noche (luna) (botonesLibranzaFijos, db/203);
//   · «Sin correturnos» y su aviso en la fila (chipSinCT, AVISO_SIN_CT, sinCorreturnosUI);
//   · el CT del cuadrante (asignarCTCuadrante) y sus «saltados»;
//   · el chip del promedio (chipRend), SIN la letra.
// Lo que NO se copia, a propósito: la letra, eventos y CT2, vacantes, libranza
// excepcional, fichaje, ausencias y banquillo. Barcelona no tiene RRHH: «no sé
// quién está de alta desde qué fecha, solo nos basamos si está activo o no en BOLT».
//
// AL REVÉS QUE MADRID, EL CORRETURNOS NACE APAGADO. En Madrid la marca es «sin
// correturnos»; aquí lo que se marca es tenerlo, y sin marca el coche no lo lleva.
// La pantalla habla igual que Madrid («Sin correturnos», «libra L M»), pero el
// botón del coche, por defecto, es para PONÉRSELO.
//
// LAS REGLAS SON DEL SERVIDOR (barcelona.plan.js): quién libra, quién trabaja,
// qué turno es hueco, el promedio. La pantalla solo pinta el tablero tal cual
// llega (la forma está en la especificación y es el contrato) y pide los cambios.
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
  // Sin tildes y en minúsculas: quien busca «Nunez» tiene que encontrar a «Núñez».
  const plano = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const slug = s => plano(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  /** Los ids son enteros (identity); si un día no lo fueran, se mandan tal cual. */
  const aId = v => (/^\d+$/.test(String(v)) ? Number(v) : v);

  // El aviso de Madrid, palabra por palabra (cuadrante.js): Camilo lo pidió así
  // para Madrid y aquí es el mismo coche.
  const AVISO_SIN_CT = 'Este coche no tiene correturnos: no se pueden agregar personas en esta matrícula.';
  const SIN = 'sin';                 // la clave de «Sin zona»

  // ── El estado ───────────────────────────────────────────────────────────────
  let T = null;                      // el tablero que llega del servidor (el contrato)
  let DIA = null;                    // el día que se mira (AAAA-MM-DD)
  let ZONA = '';                     // la zona abierta: su id en texto, SIN, o '' = todas
  let ZONA_PEDIDA = null;            // la de la dirección, hasta que llegue el tablero
  let turnoCarga = 0;                // una respuesta lenta no pinta encima de la buena
  // Índices del tablero, rehechos en cada `aplicar`.
  let cochePorMat = new Map();
  let cuadPorId = new Map();
  let plazasDe = new Map();          // uuid → [{ matricula, turno, rol, dias }]

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
    // Las plazas de cada persona ese día, sacadas de los coches: así el selector
    // dice dónde está ya cada uno sin depender de nada más que el contrato.
    plazasDe = new Map();
    (T.coches || []).forEach(c => {
      const p = c.plazas || {};
      [['fijoDia', 'dia', 'fijo'], ['fijoNoche', 'noche', 'fijo'], ['ctDia', 'dia', 'ct'], ['ctNoche', 'noche', 'ct']]
        .forEach(([clave, turno, rol]) => {
          const x = p[clave];
          if (!x || !x.uuid) return;
          if (!plazasDe.has(x.uuid)) plazasDe.set(x.uuid, []);
          plazasDe.get(x.uuid).push({ matricula: c.matricula, turno, rol, dias: x.dias || null });
        });
    });
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
  /** Desde cuándo vale poner o quitar el correturnos: el día que se mira, nunca antes de hoy. */
  const desdeCT = () => (T && T.hoy && DIA < T.hoy ? T.hoy : DIA);

  function pintarCabecera() {
    const av = $('#bp-aviso');
    // Sin la migración el servidor no puede montar el tablero y lo dice así (como
    // con db/181): mejor el aviso que un error.
    if (T.faltaMigracion) {
      av.classList.remove('hidden');
      av.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i> Falta aplicar la migración
        <b>${esc(typeof T.faltaMigracion === 'string' ? T.faltaMigracion : 'db/234')}</b> (en Migraciones). Hasta entonces el planificador de Barcelona no se puede pintar.`;
    } else {
      av.classList.add('hidden');
    }
    const dia = DIAS_NOMBRE[isodow(DIA) - 1];
    $('#bp-sub').textContent = `${dia.charAt(0).toUpperCase() + dia.slice(1)} ${isoAes(DIA)}${DIA === T.hoy ? ' · hoy' : ''}` +
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
    $('#bp-kpis').innerHTML = [
      kpi({ titulo: 'Coches', valor: n(r.coches), sub: n(r.conCT) ? `${plural(n(r.conCT), 'con correturnos', 'con correturnos')}` : 'ninguno con correturnos',
        ayuda: 'Los coches de Barcelona que se pueden planificar: los de su empresa de BOLT y los de Vehículos con sede Barcelona.\nPor defecto ninguno lleva correturnos: se le pone a cada coche con su botón.' }),
      kpi({ titulo: 'Turnos cubiertos', valor: `${n(r.cubiertos)} / ${n(r.turnos)}`, sub: cuando(),
        ayuda: 'Cada coche tiene dos turnos al día, de día y de noche.\nCubierto: alguien lo lleva ese día, su fijo o, si el fijo libra, el correturnos que cubre ese día.' }),
      kpi({ titulo: 'Huecos', valor: n(r.huecos), tono: n(r.huecos) ? 'text-telecab-red' : '', sub: 'turnos sin nadie',
        ayuda: 'Turnos que tenían que salir y no los lleva nadie: sin fijo, o el fijo libra y ningún correturnos cubre ese día.\nLo que libra un fijo en un coche sin correturnos no es hueco: ese turno no sale.' }),
      kpi({ titulo: 'Libran', valor: n(r.libran), sub: 'el coche no sale',
        ayuda: 'Turnos en los que el coche no sale porque libra su fijo y el coche no tiene correturnos.\nEs lo planificado: no cuenta como hueco.' }),
      kpi({ titulo: 'Sin plaza', valor: n(r.sinPlaza), sub: 'pincha para verlos', ir: '#bp-sinplaza-caja',
        ayuda: 'Cuentas activas en BOLT Barcelona que ese día no están en ninguna matrícula.\nEstán abajo, con su promedio.' }),
    ].join('');
  }

  // ── Las zonas (como las bases de Madrid) ────────────────────────────────────

  const zonaDeCuad = cu => (cu && cu.zonaId != null && cu.zonaId !== '' ? String(cu.zonaId) : SIN);
  const zonaDeCoche = c => (c.cuadranteId != null ? zonaDeCuad(cuadPorId.get(String(c.cuadranteId))) : SIN);
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
        `${cuando().charAt(0).toUpperCase() + cuando().slice(1)}: ${k.huecos} turno(s) sin nadie y ${k.libran} que libran.\n` +
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

  /** Las personas de un coche, para el buscador. */
  const gente = c => Object.values(c.plazas || {}).filter(Boolean);

  function pintarCuadrantes() {
    const cont = $('#bp-cuadrantes');
    if (T.faltaMigracion) { cont.innerHTML = ''; return; }
    const q = plano($('#bp-busca').value).trim();
    const pasa = c => !q || plano([c.matricula, c.modelo, ...gente(c).map(p => `${p.nombre} ${p.telefono || ''}`)].join(' ')).includes(q);

    const cuads = (T.cuadrantes || []).filter(cu => !ZONA || zonaDeCuad(cu) === ZONA);
    const sueltos = (!ZONA || ZONA === SIN) ? (T.coches || []).filter(c => c.cuadranteId == null).filter(pasa) : [];

    // Las zonas en el orden de sus tarjetas (el del servidor: por nombre), y al
    // final los cuadrantes sin zona.
    const orden = (T.zonas || []).map(z => String(z.id)).concat(SIN);
    const piezas = [];
    orden.forEach(clave => {
      const deZona = cuads.filter(cu => zonaDeCuad(cu) === clave)
        .map(cu => ({ cu, lista: cochesDe(cu).filter(pasa) }))
        // Buscando, un cuadrante sin nada que coincida se oculta: si no, parece
        // que el buscador no hace nada.
        .filter(x => !q || x.lista.length);
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
        Mientras, los coches están abajo, en «Coches sin cuadrante», y se planifican igual.</p>
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

  // La libranza de un CT = lo que NO cubre entre todos sus coches (como libraCT
  // de Madrid): la unión de sus días en cada matrícula, y el resto, libra.
  function libraCT(uuid) {
    const trabaja = new Set();
    (plazasDe.get(uuid) || []).filter(x => x.rol === 'ct').forEach(x => (x.dias || []).forEach(d => trabaja.add(Number(d))));
    if (!trabaja.size) return '';
    return [1, 2, 3, 4, 5, 6, 7].filter(d => !trabaja.has(d)).map(d => DIAS_LETRA[d - 1]).join(' ') || 'no libra';
  }

  function seccionCuadrante(cu, lista) {
    const todos = cochesDe(cu);
    const bloques = cu.bloques || [];
    const nSinCT = todos.filter(c => !c.conCT).length;
    // El CT del cuadrante es de los coches que llevan correturnos (los bloques).
    // Sin ninguno, sus chips no tendrían a quién poner: se quedan fuera y la
    // cabecera dice por qué.
    const chipCT = turno => {
      const quienes = ((cu.ct || {})[turno]) || [];
      const nombre = quienes.length === 1 ? quienes[0].nombre : quienes.length > 1 ? 'Varios' : null;
      const libra = quienes.length === 1 ? libraCT(quienes[0].uuid) : '';
      const tit = quienes.length > 1
        ? `Lo llevan ${quienes.map(p => p.nombre).join(', ')}. Pincha para poner a uno en todos los bloques.`
        : quienes.length ? `CT de ${nombreTurno(turno)} del cuadrante: cubre los días del bloque de cada coche con correturnos. Pincha para cambiarlo o quitarlo.`
          : `Poner un CT de ${nombreTurno(turno)} en todos los coches con correturnos de este cuadrante, cada uno con los días de su bloque.`;
      return `<button type="button" data-accion="ct-cua" data-turno="${turno}" title="${esc(tit)}"
                class="tc-pulsable inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border hover:border-telecab-gold/50
                       ${nombre ? 'bg-telecab-violet/10 text-telecab-violet border-telecab-violet/30' : 'border-dashed border-telecab-border text-telecab-muted'}">
                <i class="fa-solid fa-user-group" aria-hidden="true"></i>CT ${nombreTurno(turno)}: ${nombre ? esc(nombre) : 'asignar'}${libra ? ` <span class="text-telecab-muted">libra ${esc(libra)}</span>` : ''}</button>`;
    };
    return `<section data-cuadrante="${esc(cu.id)}" class="scroll-mt-24">
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-telecab-gold flex flex-wrap items-center gap-x-2">
          ${esc(tituloCuad(cu))}
          <span class="text-telecab-muted font-normal normal-case">·
            <button type="button" data-accion="zona-cua" title="Cambiar la zona de este cuadrante: sus coches van con él"
                    class="tc-pulsable inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-telecab-gold">
              <i class="fa-solid fa-location-dot text-[10px]" aria-hidden="true"></i>${cu.zona ? esc(cu.zona) : 'poner zona'}</button>
            · ${plural(bloques.length, 'bloque')}${nSinCT ? ` · ${nSinCT} sin correturnos` : ''}</span>
        </h3>
        <button type="button" data-accion="nombre-cua" aria-label="Cambiar el nombre del ${esc(tituloCuad(cu))}" title="Ponerle o cambiarle el nombre (el número no cambia)"
                class="tc-pulsable w-7 h-7 rounded-lg text-telecab-muted hover:bg-telecab-card2 hover:text-telecab-gold">
          <i class="fa-solid fa-pen text-[11px]" aria-hidden="true"></i></button>
        <button type="button" data-accion="coche-cua" title="Meter en este cuadrante un coche que no esté en ninguno"
                class="tc-pulsable px-2.5 py-1 rounded-lg text-xs font-semibold bg-telecab-card border border-telecab-border hover:border-telecab-gold/50">
          <i class="fa-solid fa-plus" aria-hidden="true"></i> Coche</button>
        ${bloques.length ? `<div class="flex flex-wrap items-center gap-2 ml-1">${chipCT('dia')}${chipCT('noche')}</div>` : ''}
        <span class="ml-auto"></span>
        <button type="button" data-accion="borrar-cua" class="text-xs text-telecab-muted hover:text-telecab-red"
                title="Dar de baja el cuadrante. Solo se puede vacío: antes hay que sacar sus coches.">
          <i class="fa-solid fa-trash" aria-hidden="true"></i> borrar cuadrante</button>
      </div>
      ${lista.length ? tablaCoches(lista, true)
        : `<p class="text-xs text-telecab-muted px-3 py-4 border border-dashed border-telecab-border rounded-2xl text-center">Cuadrante vacío. Pulsa «+ Coche» para meter una matrícula.</p>`}
    </section>`;
  }

  function seccionSueltos(lista) {
    return `<section data-sueltos class="scroll-mt-24 ${ZONA ? '' : 'pt-4 border-t border-telecab-border first:pt-0 first:border-t-0'}">
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-telecab-muted flex items-center gap-2"
            title="Coches que no están en ningún cuadrante. Se planifican igual; para darles zona, mételos en un cuadrante.">
          <i class="fa-solid fa-car-side" aria-hidden="true"></i>Coches sin cuadrante <span class="font-normal normal-case">${lista.length}</span></h3>
      </div>
      ${tablaCoches(lista, false)}
    </section>`;
  }

  // Las columnas: Fijo día/noche siempre; CT día/noche solo si algún coche de la
  // tabla lleva correturnos. Si ninguno (lo de por defecto), sobran (db/203).
  function tablaCoches(lista, enCuadrante) {
    const conColsCT = lista.some(c => c.conCT);
    const th = (txt, tit) => `<th class="text-left font-semibold px-3 py-2.5 whitespace-nowrap"${tit ? ` title="${esc(tit)}"` : ''}>${txt}</th>`;
    return `<div class="overflow-x-auto border border-telecab-border rounded-2xl">
      <table class="w-full text-sm border-collapse">
        <thead class="bg-telecab-card2 text-telecab-muted text-[11px] uppercase tracking-wide">
          <tr>
            ${th('Matrícula')}
            ${th('Descanso', 'Con correturnos, el bloque del coche: los dos fijos libran a la vez y el correturnos lo cubre. Sin ellos, cada fijo libra sus días.')}
            ${th('<i class="fa-solid fa-sun mr-1 text-telecab-gold" aria-hidden="true"></i>Fijo día', 'El turno de día: de 00:00 a 24:00.')}
            ${th('<i class="fa-solid fa-moon mr-1 text-telecab-gold" aria-hidden="true"></i>Fijo noche', 'El turno de noche: de 12:00 a 12:00 del día siguiente.')}
            ${conColsCT ? th('CT día', 'El correturnos de día: cubre los días que libra el fijo de día.') + th('CT noche', 'El correturnos de noche: cubre los días que libra el fijo de noche.') : ''}
            <th class="w-20" aria-label="Acciones"></th>
          </tr>
        </thead>
        <tbody>${lista.map(c => filaCoche(c, conColsCT, enCuadrante)).join('')}</tbody>
      </table>
    </div>`;
  }

  // 'deactivated' es el que de verdad da BOLT (sede_bolt_vehiculo.estado_bolt):
  // sin él la fila decía «deactivated en BOLT», en inglés.
  const estadoBolt = e => ({ inactive: 'desactivado', deactivated: 'desactivado', blocked: 'bloqueado', suspended: 'suspendido' }[String(e || '').toLowerCase()] || e || 'desactivado');

  function filaCoche(c, conColsCT, enCuadrante) {
    const aviso = !c.activo
      ? ` · <span class="text-telecab-warn">${esc(estadoBolt(c.estadoBolt))}${c.enBolt ? ' en BOLT' : ''}</span>`
      : !c.enBolt
        ? ' · <span class="text-telecab-warn" title="Está en Vehículos con sede Barcelona, pero no en la empresa de BOLT de Barcelona: hasta que se dé de alta, nadie puede trabajar con él en BOLT.">No está dado de alta en BOLT</span>'
        : '';
    const chipSinCT = c.conCT ? '' : `<div class="mt-1"><span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide
        bg-telecab-card2 border border-telecab-border text-telecab-muted"
        title="${esc(AVISO_SIN_CT + ' Cada fijo libra sus días. Para ponérselos, el botón de la persona a la derecha.')}">
        <i class="fa-solid fa-user-slash text-[9px]" aria-hidden="true"></i>Sin correturnos</span></div>`;
    const conCTDesde = c.conCT && c.conCTDesde
      ? `<div class="mt-1 text-[11px] text-telecab-muted">con correturnos desde ${esc(ddmm(c.conCTDesde))}</div>` : '';

    let ct = '';
    if (conColsCT) {
      ct = c.conCT
        ? `<td class="px-3 py-2.5">${celdaPlaza(c, 'dia', 'ct')}</td><td class="px-3 py-2.5">${celdaPlaza(c, 'noche', 'ct')}</td>`
        : `<td colspan="2" class="px-3 py-2.5 align-middle"><p class="text-xs text-telecab-muted flex items-center gap-2 max-w-md">
             <i class="fa-solid fa-user-slash shrink-0" aria-hidden="true"></i>${esc(AVISO_SIN_CT)}</p></td>`;
    }
    const tituloCT = c.conCT
      ? 'Quitar los correturnos de este coche: cada fijo pasa a librar los días del bloque'
      : 'Ponerle correturnos: los dos fijos libran a la vez unos días (el bloque) y el correturnos los cubre';
    return `<tr data-mat="${esc(c.matricula)}" class="border-t border-telecab-border/70 align-top scroll-mt-24 ${c.activo ? '' : 'opacity-70'}">
      <td class="px-3 py-2.5 whitespace-nowrap">
        <div class="font-mono font-semibold">${esc(c.matricula)}</div>
        <div class="text-xs text-telecab-muted">${esc(c.modelo || '')}${aviso}</div>
        ${chipSinCT}${conCTDesde}
      </td>
      <td class="px-3 py-2.5 whitespace-nowrap">${celdaDescanso(c)}</td>
      <td class="px-3 py-2.5">${celdaPlaza(c, 'dia', 'fijo')}</td>
      <td class="px-3 py-2.5">${celdaPlaza(c, 'noche', 'fijo')}</td>
      ${ct}
      <td class="px-2 py-2.5 text-right whitespace-nowrap">
        <button type="button" data-accion="${enCuadrante ? 'sacar' : 'meter'}" aria-label="${enCuadrante ? 'Sacar del cuadrante' : 'Meter en un cuadrante'} ${esc(c.matricula)}"
                title="${enCuadrante ? 'Sacar del cuadrante (queda en «Coches sin cuadrante»)' : 'Meter en un cuadrante'}"
                class="w-8 h-8 rounded-lg text-telecab-muted hover:bg-telecab-card2 hover:text-telecab-gold transition">
          <i class="fa-solid ${enCuadrante ? 'fa-object-ungroup' : 'fa-object-group'}" aria-hidden="true"></i></button>
        <button type="button" data-accion="ct-coche" aria-label="${c.conCT ? 'Quitar los correturnos de' : 'Ponerle correturnos a'} ${esc(c.matricula)}" title="${esc(tituloCT)}"
                class="w-8 h-8 rounded-lg text-telecab-muted hover:bg-telecab-card2 hover:text-telecab-gold transition">
          <i class="fa-solid ${c.conCT ? 'fa-user-slash' : 'fa-user-plus'}" aria-hidden="true"></i></button>
      </td>
    </tr>`;
  }

  // El descanso. Con correturnos, el del coche (el bloque): sus fijos libran
  // esos días y el CT los cubre. Sin ellos (lo de por defecto), uno por fijo:
  // el sol para el de día y la luna para el de noche (db/203 de Madrid).
  function celdaDescanso(c) {
    if (c.conCT) {
      const txt = diasTexto(c.descanso);
      return `<button type="button" data-accion="bloque" title="El descanso del coche: los dos fijos libran a la vez estos días y el correturnos los cubre. Pincha para cambiarlo."
                class="tc-pulsable px-2 py-1 rounded-lg text-xs font-semibold border hover:border-telecab-gold/50
                       ${txt ? 'bg-telecab-gold/10 text-telecab-gold border-telecab-gold/30' : 'border-dashed border-telecab-border text-telecab-muted'}">
                ${txt ? esc(txt) : 'sin descanso'}</button>`;
    }
    const boton = (turno, icono) => {
      const dias = ((c.descansoTurno || {})[turno]) || [];
      const txt = dias.length ? 'libra ' + diasTexto(dias) : 'no libra';
      return `<button type="button" data-accion="desc-turno" data-turno="${turno}"
                title="${esc(`Los días que libra el fijo de ${nombreTurno(turno)}. Ese turno, esos días, el coche no sale. Pincha para cambiarlos.`)}"
                class="tc-pulsable inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold border hover:border-telecab-gold/50
                       ${dias.length ? 'bg-telecab-gold/10 text-telecab-gold border-telecab-gold/30' : 'border-dashed border-telecab-border text-telecab-muted'}">
                <i class="fa-solid ${icono} text-[9px]" aria-hidden="true"></i>${esc(txt)}</button>`;
    };
    return `<div class="flex flex-col items-start gap-1">${boton('dia', 'fa-sun')}${boton('noche', 'fa-moon')}</div>`;
  }

  const CLAVE = { fijo: { dia: 'fijoDia', noche: 'fijoNoche' }, ct: { dia: 'ctDia', noche: 'ctNoche' } };

  /**
   * Una plaza. Libre: el botón de borde discontinuo «+ Asignar». Ocupada: el
   * nombre con su promedio, el teléfono, «libra L M» (fijo) o «días X J» (CT) y
   * «desde dd/mm»; tachada si la cuenta ya no está activa en BOLT. Debajo del
   * fijo, cómo está ESE turno ese día: «libra hoy» (gris) o «hueco» (rojo).
   */
  function celdaPlaza(c, turno, rol) {
    const p = (c.plazas || {})[CLAVE[rol][turno]];
    const datos = `data-accion="plaza" data-turno="${turno}" data-rol="${rol}"`;
    let html;
    if (!p) {
      html = `<button type="button" ${datos} title="Plaza libre. Pincha para poner a alguien."
                class="tc-pulsable text-left w-full px-2 py-1 rounded-lg border border-dashed border-telecab-border text-telecab-muted text-sm hover:border-telecab-gold/60 hover:text-telecab-text">
                <i class="fa-solid fa-plus text-xs mr-1" aria-hidden="true"></i>Asignar</button>`;
    } else {
      const sub = rol === 'fijo'
        ? (() => { const d = diasTexto(c.conCT ? c.descanso : (c.descansoTurno || {})[turno]); return d ? 'libra ' + d : 'no libra'; })()
        : (diasTexto(p.dias) ? 'días ' + diasTexto(p.dias) : 'sin días');
      html = `<button type="button" ${datos} class="text-left w-full group"
                title="${esc(`${p.nombre}, desde el ${isoAes(p.desde)}${p.hasta ? ' hasta el ' + isoAes(p.hasta) : ''}. Pincha para cambiarlo o dejar la plaza libre.`)}">
          <span class="flex flex-wrap items-center gap-1.5">
            <span class="${p.activa === false ? 'line-through text-telecab-muted' : 'font-medium group-hover:text-telecab-gold'} transition">${esc(p.nombre)}</span>
            ${chipPromedio(p.promedio)}
          </span>
          ${p.telefono ? `<span class="block text-[11px] text-telecab-muted font-mono tabular-nums">${esc(p.telefono)}</span>`
                       : '<span class="block text-[11px] text-telecab-warn/80">sin teléfono</span>'}
          <span class="block text-xs text-telecab-muted">${esc(sub)} · desde ${esc(ddmm(p.desde))}${p.hasta ? ` · hasta ${esc(ddmm(p.hasta))}` : ''}</span>
          ${p.activa === false ? '<span class="block text-[11px] text-telecab-warn font-semibold">ya no está activa en BOLT</span>' : ''}
        </button>`;
    }
    return html + (rol === 'fijo' ? lineaTurno(c, turno) : lineaCT(c, turno, p));
  }

  const pastilla = (txt, cls, tit, icono) => `<span class="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold border ${cls}" title="${esc(tit)}">
      ${icono ? `<i class="fa-solid ${icono} text-[9px]" aria-hidden="true"></i>` : ''}${esc(txt)}</span>`;
  const GRIS = 'bg-telecab-card2 border-telecab-border text-telecab-muted';
  const ROJO = 'bg-telecab-red/10 border-telecab-red/40 text-telecab-red';
  const AMBAR = 'bg-telecab-warn/10 border-telecab-warn/40 text-telecab-warn';
  const VIOLETA = 'bg-telecab-violet/10 border-telecab-violet/30 text-telecab-violet';

  /** Cómo está el turno ese día (`turnos` del tablero, que decide el servidor). */
  function lineaTurno(c, turno) {
    const st = (c.turnos || {})[turno];
    const fijo = (c.plazas || {})[CLAVE.fijo[turno]];
    const ct = (c.plazas || {})[CLAVE.ct[turno]];
    const t = nombreTurno(turno);
    // Un coche desactivado en BOLT (o que ya no es de la sede) no sale: su turno
    // sin nadie no es un hueco rojo que cubrir. Tampoco cuenta en la cifra de
    // Huecos ni en las tarjetas de zona.
    if (!c.activo && st === 'hueco') {
      const porque = c.enBolt ? 'coche desactivado' : 'ya no es de la sede';
      return pastilla(`no sale · ${porque}`, GRIS,
        `El coche no está activo (${porque}): ese turno no sale y no cuenta en las cifras de arriba. Si vuelve a estar activo, sale como cualquier otro.`, 'fa-ban');
    }
    if (st === 'libra') {
      return pastilla(`libra ${cuando()}`, GRIS,
        `Libra el fijo de ${t} y el coche no tiene correturnos: ese turno no sale. Es lo planificado, no un hueco.`, 'fa-mug-hot');
    }
    if (st === 'hueco') {
      const porque = !fijo ? `No tiene fijo de ${t}.`
        : !fijo.libraHoy ? ''
          : ct ? `Libra el fijo y ${ct.nombre} no cubre ese día.` : 'Libra el fijo y no hay correturnos que lo cubra.';
      // Si el fijo libra, se dice delante: el hueco es el día que no cubre nadie, no el fijo.
      return pastilla(`${fijo && fijo.libraHoy ? `libra ${cuando()} · hueco` : `hueco ${cuando()}`}`, ROJO,
        `Ese turno tiene que salir y no lo lleva nadie. ${porque}`.trim(), 'fa-triangle-exclamation');
    }
    if (st === 'trabaja' && fijo && fijo.libraHoy) {
      return pastilla(`libra ${cuando()} · cubre el CT`, GRIS, `Libra el fijo de ${t}; ese día lleva el coche el correturnos.`, 'fa-mug-hot');
    }
    return '';
  }

  /**
   * El CT que trabaja ese día, señalado. Si ese día el fijo de su turno también
   * trabaja, el CT no está cubriendo a nadie: sus días ya no son los del bloque
   * (se cambió el bloque después de ponerlo, y sus días no cambian solos, como
   * en Madrid, que los copia una vez al asignar). Decir «cubre» sería mentira:
   * se avisa en ámbar para que se le cambien los días en su plaza.
   */
  function lineaCT(c, turno, p) {
    if (!p || !p.trabajaHoy) return '';
    const fijo = (c.plazas || {})[CLAVE.fijo[turno]];
    if (fijo && fijo.trabajaHoy) {
      return pastilla(`trabaja ${cuando()} con el fijo`, AMBAR,
        `Sus días (${diasTexto(p.dias) || 'ninguno'}) no son los del bloque (${diasTexto(c.descanso) || 'sin días'}): ese día el fijo no libra y van los dos. ` +
        'Cámbiale los días en su plaza.', 'fa-triangle-exclamation');
    }
    return pastilla(`cubre ${cuando()}`, VIOLETA,
      fijo ? 'Ese día lleva el coche el correturnos: es uno de los días que libra el fijo.'
        : `Ese día lleva el coche el correturnos: no tiene fijo de ${nombreTurno(turno)}.`, 'fa-user-group');
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

  /** Dónde está ya alguien ese día, en palabras: «fijo de día en 1234ABC». */
  const textoPlaza = x => `${x.rol === 'ct' ? 'CT' : 'fijo'} de ${nombreTurno(x.turno)} en ${x.matricula}${x.rol === 'ct' && x.dias ? ` (${diasTexto(x.dias)})` : ''}`;

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
        detalle: 'Es quien tiene la plaza ahora' });
    }
    return ops;
  }

  /** Lo que ya libra el resto de bloques del cuadrante: dos bloques no pueden compartir día (los cubre el mismo CT). */
  function otrosBloques(c) {
    const cu = c && c.cuadranteId != null ? cuadPorId.get(String(c.cuadranteId)) : null;
    if (!cu) return '';
    const otros = (cu.bloques || []).filter(b => b.matricula !== c.matricula && (b.dias || []).length);
    return otros.length
      ? `En el ${tituloCuad(cu)} ya libran: ${otros.map(b => `${b.matricula} ${diasTexto(b.dias)}`).join(' · ')}. Dos bloques del mismo cuadrante no pueden compartir día: los cubre el mismo correturnos.`
      : '';
  }

  // Poner, cambiar o quitar a alguien de una plaza. Un FIJO no elige días: hace
  // todos menos su libranza. Un CT dice qué días trabaja EN ESTA MATRÍCULA
  // (puede llevar varios coches del mismo turno, cada uno sus días).
  async function asignarPlaza(mat, turno, rol) {
    const c = cochePorMat.get(mat);
    if (!c) return;
    const actual = (c.plazas || {})[CLAVE[rol][turno]] || null;
    const t = nombreTurno(turno);
    const esCT = rol === 'ct';
    const campos = [{
      id: 'uuid', etiqueta: esCT ? 'Correturnos' : 'Conductor', tipo: 'lista',
      opciones: opcionesConductores(actual), valor: actual ? actual.uuid : '',
      buscador: { marcador: 'Busca por nombre o teléfono', tope: 12 },
      ayuda: esCT ? '«Sin dato» deja la plaza libre.'
        : `Si ya era fijo de ${t} en otra matrícula, se mueve aquí. «Sin dato» deja la plaza libre.`,
    }];
    if (esCT) {
      campos.push({ id: 'dias', etiqueta: 'Qué días trabaja en esta matrícula', tipo: 'semana',
        valor: ((actual && actual.dias) || c.descanso || []).map(Number),
        ayuda: diasTexto(c.descanso) ? `El bloque del coche es ${diasTexto(c.descanso)}: los días que libran sus fijos.` : 'El coche aún no tiene bloque.' });
    }
    campos.push({ id: 'desde', etiqueta: 'Desde', tipo: 'fecha', valor: isoAes(DIA),
      ayuda: 'Vale todos los días desde esa fecha hasta que se cambie. Lo de antes se cierra la víspera.' });

    const v = await Dialogo.formulario(`${esCT ? 'CT' : 'Fijo'} ${t} · ${mat}`, campos, {
      textoBoton: 'Guardar', ancho: 'max-w-lg',
      nota: esCT
        ? 'Un correturnos puede llevar varios coches del mismo turno, cada uno con sus días; los días no pueden pisarse entre dos coches.'
        : `Un fijo hace todos los días menos su libranza (${diasTexto(c.conCT ? c.descanso : (c.descansoTurno || {})[turno]) || 'ahora no libra'}).`,
    });
    if (!v) return;
    const uuid = v.uuid || null;
    const dias = v.dias || [];
    if (esCT && uuid && !dias.length) {
      await Dialogo.aviso({ titulo: 'Faltan los días', tono: 'aviso', texto: 'Un correturnos sin días no cubre nada: marca al menos uno.' });
      return;
    }
    // Lo mismo que había: no se escribe nada. Salvo que se adelante el «desde»
    // de quien ya estaba (corregir desde cuándo lleva la plaza): eso sí se manda.
    const igual = uuid === (actual ? actual.uuid : null) && (!esCT || !uuid || mismosDias(dias, actual.dias));
    if (igual && !(actual && actual.desde && v.desde && v.desde < actual.desde)) {
      Dialogo.hecho('Ya estaba así.', { tono: 'info' });
      return;
    }
    const r = await escribir('/barcelona/api/asignar',
      { matricula: mat, turno, rol, uuid, desde: v.desde || DIA, ...(esCT && uuid ? { dias } : {}) },
      { titulo: 'No se pudo guardar' });
    if (!r) return;
    hecho(r, r.cambio === false ? 'Ya estaba así.' : r.movidaDe ? `Hecho. Se ha movido desde ${r.movidaDe}.` : 'Hecho.');
  }

  // El bloque de un coche con correturnos: los dos fijos libran a la vez esos
  // días, y el CT los cubre.
  async function fijarBloque(mat) {
    const c = cochePorMat.get(mat);
    if (!c) return;
    const v = await Dialogo.formulario(`Descanso de ${mat}`, [
      { id: 'dias', etiqueta: 'Días que libran los fijos', tipo: 'semana', valor: (c.descanso || []).map(Number), ayuda: otrosBloques(c) },
    ], { textoBoton: 'Guardar', nota: `Desde el ${isoAes(DIA)}. Los días que libran los fijos (día y noche a la vez). El correturnos cubre justo esos días.` });
    if (!v) return;
    if (mismosDias(v.dias, c.descanso)) { Dialogo.hecho('Ya estaba así.', { tono: 'info' }); return; }
    const r = await escribir('/barcelona/api/descanso', { matricula: mat, turno: null, dias: v.dias, desde: DIA },
      { titulo: 'No se pudo guardar el descanso' });
    if (!r) return;
    const texto = `Descanso de ${mat}: ${diasTexto(v.dias) || 'sin descanso'}.`;
    // Los días de cada CT no cambian con el bloque (como en Madrid: se copian al
    // ponerlo). Si ya no son los del bloque nuevo, el CT trabajaría días en que
    // el fijo no libra y dejaría otros sin cubrir: se dice quién y con qué
    // días, para cambiárselos en su columna. Se mira en el tablero que vuelve.
    const ahora = cochePorMat.get(mat) || {};
    const desfasados = [['dia', 'ctDia'], ['noche', 'ctNoche']]
      .map(([turno, k]) => [turno, (ahora.plazas || {})[k]])
      .filter(([, p]) => p && !mismosDias(p.dias, v.dias))
      .map(([turno, p]) => `${p.nombre} (CT de ${nombreTurno(turno)}) sigue con ${diasTexto(p.dias) || 'ningún día'}`);
    if (desfasados.length) {
      const varios = desfasados.length > 1;
      await Dialogo.aviso({ titulo: texto, tono: 'aviso',
        texto: `${desfasados.join(' y ')}. Sus días no cambian solos con el bloque: ` + ((v.dias || []).length
          ? `cámbialos en su columna para que ${varios ? 'cubran' : 'cubra'} ${diasTexto(v.dias)}.`
          : `ahora los fijos no libran ningún día; si ya no ${varios ? 'hacen falta, quítalos' : 'hace falta, quítalo'} en su columna.`) });
    } else {
      hecho(r, texto);
    }
  }

  // La libranza de un fijo en un coche sin correturnos (lo de por defecto).
  async function fijarDescansoTurno(mat, turno) {
    const c = cochePorMat.get(mat);
    if (!c) return;
    const t = nombreTurno(turno);
    const actual = ((c.descansoTurno || {})[turno] || []).map(Number);
    const v = await Dialogo.formulario(`Libranza del fijo de ${t} · ${mat}`, [
      { id: 'dias', etiqueta: 'Días que libra', tipo: 'semana', valor: actual, ayuda: 'Sin ninguno marcado, no libra.' },
    ], { textoBoton: 'Guardar', nota: `Desde el ${isoAes(DIA)}. Los días que libra el fijo de ${t}. El coche no tiene correturnos: esos días, el turno de ${t} no sale.` });
    if (!v) return;
    if (mismosDias(v.dias, actual)) { Dialogo.hecho('Ya estaba así.', { tono: 'info' }); return; }
    const r = await escribir('/barcelona/api/descanso', { matricula: mat, turno, dias: v.dias, desde: DIA },
      { titulo: 'No se pudo guardar la libranza' });
    if (r) hecho(r, `El fijo de ${t} de ${mat} ${v.dias.length ? 'libra ' + diasTexto(v.dias) : 'no libra'}.`);
  }

  /**
   * PONER O QUITAR EL CORRETURNOS de un coche (como sinCorreturnosUI de Madrid,
   * al revés: aquí nace sin él). Vale desde el día que se mira, nunca antes de hoy.
   * Ponerlo pide el bloque; quitarlo saca a sus CT y cada fijo pasa a librar el bloque.
   */
  async function correturnosCoche(mat) {
    const c = cochePorMat.get(mat);
    if (!c) return;
    const desde = desdeCT();
    if (!c.conCT) {
      const t = c.descansoTurno || {};
      const v = await Dialogo.formulario(`Ponerle correturnos · ${mat}`, [
        { id: 'dias', etiqueta: 'El descanso del coche (el bloque)', tipo: 'semana',
          valor: ((t.dia || []).length ? t.dia : (t.noche || [])).map(Number), ayuda: otrosBloques(c) },
      ], {
        textoBoton: 'Ponerle correturnos', ancho: 'max-w-lg',
        nota: `Desde el ${isoAes(desde)}. Los dos fijos pasan a librar a la vez estos días y el correturnos los cubre; ` +
          'la libranza que tenía cada fijo se cierra. Después se pone el correturnos, en su columna o con el CT del cuadrante.',
      });
      if (!v) return;
      if (!(v.dias || []).length) {
        await Dialogo.aviso({ titulo: 'Faltan los días', tono: 'aviso', texto: 'El bloque son los días que libran los fijos y cubre el correturnos: marca al menos uno.' });
        return;
      }
      const r = await escribir('/barcelona/api/ct', { matricula: mat, activar: true, dias: v.dias, desde },
        { titulo: 'No se pudo poner el correturnos' });
      if (r) hecho(r, `${mat} ya lleva correturnos.`);
      return;
    }
    const cts = [['dia', c.plazas && c.plazas.ctDia], ['noche', c.plazas && c.plazas.ctNoche]]
      .filter(([, p]) => p).map(([turno, p]) => `${p.nombre} (CT ${nombreTurno(turno)})`);
    const bloque = diasTexto(c.descanso);
    const ok = await Dialogo.confirmar({
      titulo: `Sin correturnos · ${mat}`, tono: 'aviso', ancho: 'max-w-lg', si: 'Quitar correturnos', no: 'Cancelar',
      html: `<p class="text-sm mb-2">Desde el <b>${esc(isoAes(desde))}</b> este coche no lleva correturnos:</p>
        <ul class="text-sm list-disc pl-5 space-y-1 mb-2">
          <li>${cts.length ? 'Se quitan de este coche: <b>' + cts.map(esc).join(', ') + '</b>. Si no tienen otra plaza, pasan a «Sin plaza».' : 'Ahora no tiene correturnos puestos.'}</li>
          <li>Se ocultan sus columnas de correturnos y no se pueden agregar personas en ellas.</li>
          <li>Cada fijo pasa a tener su propio descanso${bloque ? `; los dos empiezan con el del coche (<b>${esc(bloque)}</b>) y luego se cambia el de cada uno` : ''}. Los días que libre un fijo, ese turno el coche no sale.</li>
          <li>Puede seguir en su cuadrante.</li>
        </ul>`,
    });
    if (!ok) return;
    const r = await escribir('/barcelona/api/ct', { matricula: mat, activar: false, desde }, { titulo: 'No se pudo quitar el correturnos' });
    if (r) hecho(r, `${mat} sin correturnos.`);
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
    ], { textoBoton: 'Crear cuadrante', nota: 'Nace vacío. Después le metes los coches con «+ Coche».' });
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

  /** «+ Coche»: los coches que no están en ningún cuadrante. */
  async function cocheAlCuad(cu) {
    const libres = (T.coches || []).filter(c => c.cuadranteId == null);
    if (!libres.length) {
      await Dialogo.aviso({ titulo: 'No hay coches sueltos', tono: 'aviso',
        texto: 'Todos los coches están ya en un cuadrante. Para pasar uno de otro cuadrante, sácalo primero de allí.' });
      return;
    }
    const v = await Dialogo.formulario(`Meter un coche en el ${tituloCuad(cu)}`, [
      { id: 'mat', etiqueta: 'Matrícula', tipo: 'lista', obligatorio: true,
        buscador: { marcador: 'Busca por matrícula o modelo', tope: 12 },
        opciones: libres.map(c => ({ valor: c.matricula, texto: c.matricula,
          detalle: [c.modelo, c.conCT ? `con correturnos · bloque ${diasTexto(c.descanso) || 'sin días'}` : 'sin correturnos'].filter(Boolean).join(' · ') })) },
    ], { textoBoton: 'Meter', nota: (cu.bloques || []).length ? `Si el coche lleva correturnos, su bloque no puede compartir día con los de este cuadrante (${(cu.bloques || []).map(b => `${b.matricula} ${diasTexto(b.dias)}`).join(' · ')}).` : undefined });
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
      detalle: `${cu.zona || 'Sin zona'} · ${plural(cochesDe(cu).length, 'coche')}` }));
    opciones.push({ valor: '__nuevo__', texto: 'Nuevo cuadrante…' });
    const v = await Dialogo.formulario(`Meter ${mat} en un cuadrante`, [
      { id: 'cua', etiqueta: 'Cuadrante', tipo: 'lista', opciones, obligatorio: true },
    ], { textoBoton: 'Seguir' });
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
    const cu = cuadPorId.get(String(c.cuadranteId));
    const r = await escribir(`/barcelona/api/cuadrantes/${encodeURIComponent(c.cuadranteId)}/coche`, { matricula: mat, quitar: true },
      { titulo: 'No se pudo sacar el coche', boton });
    if (r) hecho(r, `${mat} sale del ${cu ? tituloCuad(cu) : 'cuadrante'}: ahora está en «Coches sin cuadrante».`);
  }

  /**
   * EL CT DEL CUADRANTE (como asignarCTCuadrante de Madrid): la persona pasa a
   * CT de ese turno en cada coche CON correturnos del cuadrante, con los días del
   * bloque de cada uno. Los que ya lleva otro esos días no se tocan: vuelven en
   * `saltados`. «Sin dato» lo quita de todos.
   */
  async function ctDelCuad(cu, turno) {
    const bloques = cu.bloques || [];
    const t = nombreTurno(turno);
    if (!bloques.length) {
      await Dialogo.aviso({ titulo: 'Ningún coche con correturnos', tono: 'aviso',
        texto: `Ningún coche del ${tituloCuad(cu)} lleva correturnos. Pónselo a un coche con su botón y después el CT del cuadrante.` });
      return;
    }
    const quienes = ((cu.ct || {})[turno]) || [];
    const actual = quienes.length === 1 ? quienes[0] : null;
    const reparto = bloques.map(b => `${b.matricula} (${diasTexto(b.dias) || 'sin días'})`).join(', ');
    const v = await Dialogo.formulario(`CT de ${t} del ${tituloCuad(cu)}`, [
      { id: 'uuid', etiqueta: 'Correturnos', tipo: 'lista', opciones: opcionesConductores(actual), valor: actual ? actual.uuid : '',
        buscador: { marcador: 'Busca por nombre o teléfono', tope: 12 },
        ayuda: quienes.length > 1 ? `Ahora lo llevan ${quienes.map(p => p.nombre).join(', ')}. «Sin dato» los quita de todos.` : '«Sin dato» lo quita de todos los bloques.' },
      { id: 'desde', etiqueta: 'Desde', tipo: 'fecha', valor: isoAes(DIA), ayuda: 'Vale todos los días desde esa fecha hasta que se cambie.' },
    ], {
      textoBoton: 'Guardar', ancho: 'max-w-lg',
      nota: `Se pone de CT de ${t} en cada coche con correturnos del cuadrante, con los días de su bloque: ${reparto}. Los coches sin correturnos se saltan.`,
    });
    if (!v) return;
    const uuid = v.uuid || null;
    if (!uuid && !quienes.length) { Dialogo.hecho('Ya estaba así.', { tono: 'info' }); return; }
    // Con «Varios» el selector sale sin nadie elegido, así que «Guardar» tal
    // cual los quitaría a todos sin querer (lo que opcionesConductores evita en
    // la plaza suelta; Madrid pide elegir «Dejar la plaza vacía» a mano). Se
    // pregunta antes, diciendo a quién y de dónde.
    if (!uuid && quienes.length > 1) {
      const ok = await Dialogo.confirmar({
        titulo: `Quitar el CT de ${t} del ${tituloCuad(cu)}`, tono: 'aviso', si: 'Quitarlos', no: 'Cancelar',
        texto: `Se quitan ${quienes.map(p => `${p.nombre} (${(p.matriculas || []).join(', ')})`).join(', ')} desde el ${isoAes(v.desde || DIA)}.`,
      });
      if (!ok) return;
    }
    const r = await escribir(`/barcelona/api/cuadrantes/${encodeURIComponent(cu.id)}/ct`, { turno, uuid, desde: v.desde || DIA },
      { titulo: 'No se ha podido' });
    if (!r) return;
    // Los coches que no se han tocado, por lo que son (el servidor dice el
    // motivo): los que ya lleva otro esos días (es decisión de una persona
    // sobre un coche: se hace coche a coche) y los que aún no tienen días en su
    // bloque (esos no los cubre nadie: primero el descanso). En Madrid solo
    // existía el primero; decirle «ya los cubre otro» al segundo era falso.
    const saltados = (r.saltados || []).filter(Boolean);
    if (saltados.length) {
      const otros = saltados.filter(s => s.nombre);
      const sinBloque = saltados.filter(s => !s.nombre);
      const partes = [];
      if (r.cambiados) partes.push(`Puesto en ${plural(r.cambiados, 'coche')}.`);
      if (otros.length) {
        partes.push(`${otros.map(s => `${s.matricula}, lo lleva ${s.nombre}`).join('; ')}: esos días ya los cubre otro; ` +
          'si aun así tiene que entrar, hazlo coche a coche desde su columna.');
      }
      if (sinBloque.length) {
        partes.push(`${sinBloque.map(s => s.matricula).join(', ')} no ${sinBloque.length === 1 ? 'tiene' : 'tienen'} días en su bloque: ` +
          `pon${sinBloque.length === 1 ? 'le' : 'les'} antes el descanso.`);
      }
      await Dialogo.aviso({ titulo: 'No se ha puesto en todos los coches', tono: 'aviso', texto: partes.join(' ') });
    } else {
      hecho(r, uuid ? 'Hecho.' : `CT de ${t} quitado del ${tituloCuad(cu)}.`);
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
      case 'plaza': return asignarPlaza(mat, b.dataset.turno, b.dataset.rol);
      case 'bloque': return fijarBloque(mat);
      case 'desc-turno': return fijarDescansoTurno(mat, b.dataset.turno);
      case 'ct-coche': return correturnosCoche(mat);
      case 'sacar': return sacarDeCuad(mat, b);
      case 'meter': return meterEnCuad(mat);
      case 'nuevo-cua': return nuevoCuadrante();
      case 'zona-cua': return cu && cambiarZonaCuad(cu);
      case 'nombre-cua': return cu && nombrarCuad(cu);
      case 'borrar-cua': return cu && borrarCuad(cu);
      case 'coche-cua': return cu && cocheAlCuad(cu);
      case 'ct-cua': return cu && ctDelCuad(cu, b.dataset.turno);
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

  // La zona de la dirección (#zona=eixample) se abre en cuanto llegue el
  // tablero, que es quien sabe qué zonas hay. Sin fecha, el servidor da hoy.
  ZONA_PEDIDA = zonaDeLaUrl() || null;
  cargar('');
})();
