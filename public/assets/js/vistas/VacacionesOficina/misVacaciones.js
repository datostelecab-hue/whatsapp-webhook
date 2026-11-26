// modules/VacacionesOficina/vistas/misVacaciones.ejs — las vacaciones de la oficina (db/263).
//
// «Mías»: las cifras (para usar hoy, generadas, gastadas, programadas,
// pedidas), el simulador (fechas y sus dos días de libranza: lo que gastaría y
// lo que tendrá ese día, también lo que generará hasta entonces), desde donde
// se piden, sus vacaciones con su estado y el mes a mes. «La oficina», solo a
// quien lleva Usuarios y permisos: el Listado de todos y, al pulsar una
// persona, su ficha en el Panel, donde se aprueban o se rechazan.

(function () {
  const esc = Casa.esc;
  const API = '/mis-vacaciones/api';
  const caja = document.querySelector('#mv-mias');
  const num = (n, d = 2) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: d });
  const f = d => (d ? String(d).split('-').reverse().join('/') : '');
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const mesTxt = m => `${MESES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
  let R = null;          // las reglas (tasa, tope, días del horario…)
  let yo = null;         // lo mío
  let oficina = null;    // el Listado de «La oficina», si aprueba
  let calCargado = false;
  const refrescarOficina = () => { if (oficina) { oficina.recargar(); cargarCalendario(); } };

  // ── Piezas ─────────────────────────────────────────────────────────────────
  const ESTADO = {
    pedida: ['tc-pastilla--aviso', 'Esperando aprobación'],
    aprobada: ['tc-pastilla--verde', 'Aprobadas'],
    rechazada: ['tc-pastilla--rojo', 'No aprobadas'],
    anulada: ['', 'Anuladas'],
  };
  const pastilla = e => `<span class="tc-pastilla ${ESTADO[e] ? ESTADO[e][0] : ''}">${esc(ESTADO[e] ? ESTADO[e][1] : e)}</span>`;
  const kpi = (etiqueta, valor, pie, tono = 'text', ayuda = '') => `
    <div class="tc-kpi" data-tono="${tono}"${ayuda ? ` title="${esc(ayuda)}"` : ''}>
      <p class="tc-kpi-etiqueta">${esc(etiqueta)}</p>
      <p class="tc-kpi-valor">${valor}</p>
      ${pie ? `<p class="tc-kpi-pie">${esc(pie)}</p>` : ''}
    </div>`;
  const aviso = (html, tono = 'warn') => `
    <div class="flex items-start gap-2 px-4 py-3 rounded-xl border text-sm bg-telecab-${tono}/10 border-telecab-${tono}/30 text-telecab-${tono}">
      <i class="fa-solid fa-triangle-exclamation mt-0.5 text-xs" aria-hidden="true"></i><span>${html}</span></div>`;

  function cifras(d) {
    return `<div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
      ${kpi('Para usar hoy', num(d.saldo), d.programadas ? `tras lo programado, ${num(d.saldoTras)}` : 'días', d.saldo < 0 ? 'red' : 'gold')}
      ${d.cierreAno
        ? kpi(`Al cierre de ${d.cierreAno.ano}`, num(d.cierreAno.generadas), `generadas el 31/12; te quedarán ${num(d.cierreAno.quedaran)}`, d.cierreAno.quedaran < 0 ? 'red' : 'text',
          `Solo informativo: lo que habrás generado el 31/12/${d.cierreAno.ano} (${num(R.tope)} por mes completo) menos lo aprobado hasta ese día: ${num(d.cierreAno.gastadas, 0)} días. Se sigue generando igual el año que viene.`)
        : kpi('Generadas', num(d.generadas), d.inicio ? `desde el ${f(d.inicio)}` : 'sin fecha de alta', 'text',
          `${num(R.tope)} por mes completo, todos los años. Lo que sobra o falta pasa al año siguiente.`)}
      ${kpi('Gastadas', num(d.disfrutadas, 0), 'vacaciones ya pasadas')}
      ${kpi('Programadas', num(d.programadas, 0), 'aprobadas, aún por llegar')}
      ${kpi('Pedidas', num(d.pedidas, 0), 'esperan aprobación', d.pedidas ? 'warn' : 'text')}
    </div>`;
  }

  // Sus vacaciones: con sus acciones según quién mira.
  // Si una petición cuadra o se pasa (la previsión del servidor, como el
  // simulador): en rojo cuántos días se pasa; en verde, cuántos le sobran.
  const prevision = pv => {
    const ayuda = `El día que se va tendrá ${num(pv.alIrse)} (con lo que genere hasta entonces) y gasta ${pv.gasta}. Al volver: ${num(pv.alVolver)}${pv.generaDurante ? `, contando ${num(pv.generaDurante)} que genera durante las vacaciones` : ''}.`;
    return `<span class="block mt-1" title="${esc(ayuda)}">
      <span class="tc-pastilla ${pv.sePasa ? 'tc-pastilla--rojo' : 'tc-pastilla--verde'}">${pv.sePasa ? `Se pasa ${num(-pv.alVolver)} días` : `Sobran ${num(pv.alVolver)} días`}</span>
      <span class="block text-[11px] text-telecab-muted mt-0.5">tendrá ${num(pv.alIrse)} al irse</span></span>`;
  };

  function tablaVacaciones(d, { propio, aprueba }) {
    if (!d.vacaciones.length) return '<p class="text-sm text-telecab-muted px-5 py-4">Todavía no hay vacaciones pedidas.</p>';
    const fila = v => {
      const botones = [];
      if (propio && v.estado === 'pedida') botones.push(`<button type="button" class="tc-boton tc-boton--chico" data-retirar="${v.id}">Retirar</button>`);
      if (aprueba && v.estado === 'pedida') {
        botones.push(`<button type="button" class="tc-boton tc-boton--chico tc-boton--principal" data-aprobar="${v.id}">Aprobar</button>`);
        botones.push(`<button type="button" class="tc-boton tc-boton--chico tc-boton--peligro" data-rechazar="${v.id}">No aprobar</button>`);
      }
      if (aprueba && v.estado === 'aprobada' && v.hasta >= d.hoy) botones.push(`<button type="button" class="tc-boton tc-boton--chico tc-boton--peligro" data-anular="${v.id}">Anular</button>`);
      const gasta = v.estado === 'aprobada'
        ? `${num(v.dias, 0)}${v.futuros && v.pasados ? `<span class="block text-[11px] text-telecab-muted">${v.pasados} ya, ${v.futuros} por llegar</span>` : ''}`
        : `<span class="text-telecab-muted">${num(v.dias, 0)}</span>`;
      const nota = [v.nota ? esc(v.nota) : '', v.resueltaNota && v.estado !== 'aprobada'
        ? `<span class="block text-[11px] text-telecab-muted">${esc(v.resueltaNota)}</span>` : ''].join('');
      const pv = v.prevision;
      return `<tr class="border-t border-telecab-border/60 align-top${pv && pv.sePasa ? ' bg-telecab-red/5' : ''}">
        <td class="py-2 pr-3 whitespace-nowrap tabular-nums">${f(v.desde)} → ${f(v.hasta)}<span class="block text-[11px] text-telecab-muted">libra ${esc(v.libraTexto)}</span></td>
        <td class="py-2 px-3 text-right tabular-nums">${gasta}</td>
        <td class="py-2 px-3">${pastilla(v.estado)}${pv ? prevision(pv) : ''}</td>
        <td class="py-2 px-3 text-sm text-telecab-muted">${nota}</td>
        <td class="py-2 pl-3 text-right whitespace-nowrap"><div class="inline-flex flex-wrap gap-1 justify-end">${botones.join('')}</div></td>
      </tr>`;
    };
    return `<div class="px-5 py-3 overflow-x-auto"><table class="w-full text-sm">
      <thead class="text-xs text-telecab-muted"><tr>
        <th class="text-left font-medium pb-1 pr-3">Fechas</th>
        <th class="text-right font-medium pb-1 px-3" title="Días que gastan: sin sus dos días de libranza ni los festivos">Gastan</th>
        <th class="text-left font-medium pb-1 px-3">Estado</th><th class="text-left font-medium pb-1 px-3">Nota</th><th class="pb-1 pl-3"></th>
      </tr></thead>
      <tbody>${d.vacaciones.slice().reverse().map(fila).join('')}</tbody></table></div>`;
  }

  function tablaMeses(d) {
    if (!d.meses.length) return '<p class="text-sm text-telecab-muted px-5 py-4">Aún no ha generado nada.</p>';
    return `<div class="px-5 py-3 overflow-x-auto"><table class="w-full text-sm">
      <thead class="text-xs text-telecab-muted"><tr>
        <th class="text-left font-medium pb-1 pr-3">Mes</th>
        <th class="text-right font-medium pb-1 px-3" title="Días del horario de la oficina (${esc(R.laborablesTexto)}), aunque sean festivos o esté de vacaciones">Días laborables</th>
        <th class="text-right font-medium pb-1 px-3">Generadas</th>
        <th class="text-right font-medium pb-1 pl-3">Gastadas</th>
      </tr></thead>
      <tbody>${d.meses.slice().reverse().map(m => `<tr class="border-t border-telecab-border/60">
        <td class="py-2 pr-3 capitalize">${mesTxt(m.mes)}</td>
        <td class="py-2 px-3 text-right tabular-nums">${m.dias}</td>
        <td class="py-2 px-3 text-right tabular-nums">+ ${num(m.generadas)}<span class="block text-[11px] text-telecab-muted">${
          m.completo ? 'mes completo' : `${m.dias} × ${num(R.tasa, 4)}`}</span></td>
        <td class="py-2 pl-3 text-right tabular-nums">${m.gastadas ? '− ' + m.gastadas : '—'}</td></tr>`).join('')}</tbody></table>
      <p class="text-xs text-telecab-muted mt-3">Cada mes completo genera ${num(R.tope)}, tenga los días laborables que tenga, todos los años; lo que sobra o falta pasa al año siguiente. El que va en curso (y el de la fecha de alta, si entró a mitad) genera el promedio, ${num(R.tasa, 4)} por cada día de ${esc(R.laborablesTexto)} (${num(R.tope)} entre los ${num(R.diasMes)} días de un mes medio), también festivos y días de vacaciones, sin pasar de ${num(R.tope)}. Cuenta desde la fecha de alta, o desde el ${f(R.desde)} si entró antes. Gastan los días de vacaciones que no son sus dos días de libranza ni festivos.</p></div>`;
  }

  const bloque = (titulo, icono, html, extra = '') => `
    <section class="rounded-2xl bg-telecab-card border border-telecab-border overflow-hidden">
      <header class="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-telecab-border">
        <h2 class="font-semibold flex items-center gap-2 flex-1"><i class="fa-solid ${icono} text-telecab-gold" aria-hidden="true"></i>${esc(titulo)}</h2>${extra}
      </header>${html}</section>`;

  // ── Lo mío ─────────────────────────────────────────────────────────────────
  function pintarMias() {
    const d = yo;
    const sinAlta = !d.alta
      ? aviso('Aún no tienes fecha de alta. La pone quien lleva Usuarios y permisos; hasta entonces no generas vacaciones ni puedes simularlas.') : '';
    caja.innerHTML = `
      ${sinAlta}
      ${cifras(d)}
      ${bloque('Simular y pedir', 'fa-wand-magic-sparkles', `
        <div class="px-5 py-4 text-sm text-telecab-muted">
          Pon las fechas y tus dos días de libranza: te dice cuántos días gastarías y cuántos tendrás ese día, contando lo que aún vas a generar hasta entonces. Si te cuadra, las pides desde ahí y esperan aprobación.
        </div>`, `<button type="button" class="tc-boton tc-boton--principal" data-simular ${d.alta ? '' : 'disabled'}>
          <i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>Simular unas vacaciones</button>`)}
      ${bloque('Mis vacaciones', 'fa-umbrella-beach', tablaVacaciones(d, { propio: true, aprueba: false }))}
      <div id="mv-permisos" class="mt-4"></div>
      ${bloque('Mes a mes', 'fa-calendar-days', tablaMeses(d))}`;
    caja.querySelector('[data-simular]').addEventListener('click', () => simular(d));
    // Los asuntos propios y el teletrabajo (db/271): su bloque, con lo de quien mira.
    if (window.PermisosOficina) PermisosOficina.montar(caja.querySelector('#mv-permisos'));
  }
  // Una vez: la caja se repinta, pero el escuchador se queda y lee lo de ahora.
  engancharAcciones(caja, () => yo, { recargar: () => cargarMias() });

  async function cargarMias() {
    const r = await Api.get(`${API}/mias`).catch(err => ({ error: err }));
    if (r.error) { caja.innerHTML = aviso(`No se han podido leer tus vacaciones: ${esc(r.error.message)}`); return; }
    if (r.sinMigracion) { caja.innerHTML = aviso('Falta aplicar la migración db/263 (las vacaciones de la oficina).'); return; }
    R = r.reglas; yo = r;
    pintarMias();
    if (r.aprueba && !oficina) montarOficina();
  }

  // ── El simulador ───────────────────────────────────────────────────────────
  async function simular(d, antes) {
    const v = await Dialogo.formulario(d.id === yo.id ? 'Simular unas vacaciones' : `Simular vacaciones de ${d.nombre}`, [
      { id: 'desde', etiqueta: 'Primer día', tipo: 'fecha', obligatorio: true, valor: antes ? f(antes.desde) : '' },
      { id: 'hasta', etiqueta: 'Último día', tipo: 'fecha', obligatorio: true, valor: antes ? f(antes.hasta) : '' },
      { id: 'libra', etiqueta: 'Tus dos días de libranza en esas vacaciones', tipo: 'semana', exactos: 2,
        valor: antes ? antes.libra : R.libraPorDefecto, ayuda: 'Esos días no gastan vacaciones. Los festivos tampoco.' },
    ], { textoBoton: 'Simular', textoCancelar: 'Cerrar', nota: 'No se guarda nada hasta que las pidas.' });
    if (!v) return;
    const r = await Api.post(`${API}/simular`, {
      desde: Dialogo.aISO(v.desde) || v.desde, hasta: Dialogo.aISO(v.hasta) || v.hasta, libra: v.libra || [],
      usuarioId: d.id === yo.id ? null : d.id,
    }, { aviso: 'No se ha podido simular' });
    if (!r) return;
    const s = r.simulacion;
    const puedePedir = d.id === yo.id && s.desde >= yo.hoy && s.nuevos > 0 && !s.yaPedidas;
    const elegido = await Dialogo.elegir({
      titulo: `Del ${f(s.desde)} al ${f(s.hasta)}`, tono: 'info', ancho: 'max-w-3xl', html: resultado(s),
      opciones: [
        ...(puedePedir ? [{ texto: `Pedir estas vacaciones (${s.nuevos} días)`, valor: 'pedir', principal: true }] : []),
        { texto: 'Otras fechas', valor: 'otra' }, { texto: 'Cerrar', valor: true, principal: !puedePedir },
      ],
    });
    if (elegido === 'otra') return simular(d, s);
    if (elegido === 'pedir') return pedir(s);
  }

  function resultado(s) {
    const neg = s.alVolver < 0;
    const cifra = (txt, valor, nota) => `<div class="rounded-xl bg-telecab-card2 border border-telecab-border px-3 py-2">
      <p class="text-xs text-telecab-muted">${esc(txt)}</p><p class="text-xl font-bold tabular-nums">${valor}</p>${nota ? `<p class="text-[11px] text-telecab-muted">${esc(nota)}</p>` : ''}</div>`;
    const avisos = [];
    if (s.yaAprobadas) avisos.push(`${s.yaAprobadas} de esos días ya los tienes aprobados: no se cuentan dos veces.`);
    if (s.yaPedidas) avisos.push('Esas fechas pisan unas vacaciones que ya pediste y esperan aprobación.');
    if (s.desde < yo.hoy) avisos.push('Empiezan antes de hoy: se pueden simular, pero se piden de hoy en adelante.');
    return `
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        ${cifra('Días naturales', s.naturales, `libras el ${s.libraTexto}`)}
        ${cifra('Gastarías', s.nuevos, `${s.libranzas} de libranza${s.festivos ? `, ${s.festivos} festivo(s)` : ''} no cuentan`)}
        ${cifra('Tendrás ese día', num(s.disponible), `hoy ${num(s.saldoHoy)}${s.generaraHastaEntonces ? ` + ${num(s.generaraHastaEntonces)} que generarás` : ''}${s.programadas ? ` − ${s.programadas} programadas` : ''}`)}
        ${cifra('Te quedarán al volver', `<span class="${s.alVolver < 0 ? 'text-telecab-red' : ''}">${num(s.alVolver)}</span>`,
          s.generaDurante ? `con ${num(s.generaDurante)} que generas durante las vacaciones` : (neg ? 'más de lo que tendrás' : ''))}
      </div>
      ${avisos.length ? `<p class="text-sm text-telecab-warn mb-3">${avisos.map(esc).join(' ')}</p>` : ''}
      <div class="grid gap-4 sm:grid-cols-2">${calendario(s)}</div>
      <p class="text-xs text-telecab-muted mt-3"><span class="inline-block w-3 h-3 rounded bg-telecab-gold/20 border border-telecab-gold/40 align-middle mr-1"></span>gastan ·
        <span class="line-through">12</span> libranza o festivo (F) · el punto, días que ya tienen vacaciones · debajo de cada día, el banco al acabarlo: cada día laborable suma ${num(R.tasa, 4)}, también en vacaciones y festivos (un mes completo, ${num(R.tope)} justos)</p>`;
  }

  function calendario(s) {
    const SEM = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    const porMes = new Map();
    s.dias.forEach(x => { const m = x.dia.slice(0, 7); if (!porMes.has(m)) porMes.set(m, []); porMes.get(m).push(x); });
    const celda = x => {
      const titulo = [x.cuenta ? 'Gasta un día de vacaciones' : x.libra ? 'Libranza: no gasta' : 'Festivo: no gasta',
        x.ya ? (x.ya === 'aprobada' ? 'Ya tienes vacaciones aprobadas' : 'Ya lo pediste') : '',
        `Banco al acabar el día: ${num(x.banco)}`].filter(Boolean).join(' · ');
      const clase = x.cuenta ? 'bg-telecab-gold/20 text-telecab-text border border-telecab-gold/40 font-semibold'
        : 'bg-telecab-card2 text-telecab-muted line-through decoration-telecab-muted/60';
      return `<div class="h-10 rounded-lg flex flex-col items-center justify-center text-sm tabular-nums relative ${clase}" title="${esc(titulo)}">
        <span class="leading-none">${Number(x.dia.slice(8))}</span><span class="text-[9px] leading-none text-telecab-muted tabular-nums mt-0.5">${num(x.banco, 1)}</span>${x.ya ? '<span class="absolute top-0.5 right-1 w-1.5 h-1.5 rounded-full bg-telecab-text/60" aria-hidden="true"></span>' : ''}
        ${x.festivo ? '<span class="absolute bottom-0.5 left-1 text-[9px] leading-none text-telecab-gold" aria-hidden="true">F</span>' : ''}</div>`;
    };
    return [...porMes].map(([m, lista]) => `<div>
        <p class="text-sm font-semibold mb-2 capitalize">${mesTxt(m)}</p>
        <div class="grid grid-cols-7 gap-1 text-[11px] text-telecab-muted text-center mb-1">${SEM.map(x => `<span>${x}</span>`).join('')}</div>
        <div class="grid grid-cols-7 gap-1">${'<div></div>'.repeat(lista[0].dow - 1)}${lista.map(celda).join('')}</div>
      </div>`).join('');
  }

  // REGISTRAR UNAS YA DISFRUTADAS (17/11/2026): quien aprueba apunta unas
  // vacaciones que empezaron antes de hoy; entran aprobadas y se restan. Antes
  // de guardar, dice cuántos días gastan (sin libranzas ni festivos).
  async function registrar(d, alAcabar, antes) {
    const v = await Dialogo.formulario(`Vacaciones ya disfrutadas de ${d.nombre}`, [
      { id: 'desde', etiqueta: 'Primer día', tipo: 'fecha', obligatorio: true, valor: antes ? f(antes.desde) : '' },
      { id: 'hasta', etiqueta: 'Último día', tipo: 'fecha', obligatorio: true, valor: antes ? f(antes.hasta) : '' },
      { id: 'libra', etiqueta: 'Sus dos días de libranza en esas vacaciones', tipo: 'semana', exactos: 2,
        valor: antes ? antes.libra : R.libraPorDefecto, ayuda: 'Esos días no gastan vacaciones. Los festivos tampoco.' },
      { id: 'nota', etiqueta: 'Una nota (si hace falta)', tipo: 'texto-largo', max: 1000, valor: antes ? antes.nota : '' },
    ], { textoBoton: 'Calcular los días', nota: 'Las que ya empezaron. Entran aprobadas y se restan de lo que tiene hoy.' });
    if (!v) return;
    const datos = { usuarioId: d.id, desde: Dialogo.aISO(v.desde) || v.desde, hasta: Dialogo.aISO(v.hasta) || v.hasta, libra: v.libra || [], nota: v.nota || '' };
    const r = await Api.post(`${API}/simular`, datos, { aviso: 'No se han podido calcular' });
    if (!r) return;
    const s = r.simulacion;
    const pisa = s.yaAprobadas || s.yaPedidas;
    const no = [s.libranzas ? `${s.libranzas} de libranza` : '', s.festivos ? `${s.festivos} festivo(s)` : ''].filter(Boolean).join(' y ');
    const eleccion = await Dialogo.elegir({
      titulo: `Del ${f(s.desde)} al ${f(s.hasta)}: ${s.cuentan} ${s.cuentan === 1 ? 'día' : 'días'}`, tono: 'info',
      html: `<p class="text-sm">De ${s.naturales} días naturales gastan <b>${s.cuentan}</b>${no ? ` (${no} no cuentan)` : ''}.</p>
        <p class="text-sm mt-2">${esc(d.nombre)} tiene hoy <b>${num(s.saldoHoy)}</b>; con estas, <b class="${s.saldoHoy - s.cuentan < 0 ? 'text-telecab-red' : ''}">${num(s.saldoHoy - s.cuentan)}</b>.</p>
        ${pisa ? '<p class="text-sm text-telecab-warn mt-2">Esas fechas pisan otras vacaciones suyas: no se pueden registrar encima.</p>' : ''}`,
      opciones: [
        ...(pisa ? [] : [{ texto: `Registrar (${s.cuentan} días)`, valor: 'si', principal: true }]),
        { texto: 'Otras fechas', valor: 'otra' }, { texto: 'Cancelar', valor: false },
      ],
    });
    if (eleccion === 'otra') return registrar(d, alAcabar, { ...datos, desde: s.desde, hasta: s.hasta });
    if (eleccion !== 'si') return;
    const hecho = await Api.post(`${API}/registrar`, datos, { aviso: 'No se han podido registrar' });
    if (!hecho) return;
    Dialogo.hecho(`Registradas: ${hecho.dias} días restados`);
    if (alAcabar) await alAcabar();
    if (d.id === yo.id) await cargarMias();
    refrescarOficina();
  }

  async function pedir(s) {
    const v = await Dialogo.formulario(`Pedir del ${f(s.desde)} al ${f(s.hasta)}`, [
      { id: 'nota', etiqueta: 'Una nota para quien las aprueba (si hace falta)', tipo: 'texto-largo', max: 1000 },
    ], { textoBoton: `Pedir (${s.nuevos} días)`, nota: `Libras el ${s.libraTexto}. Hasta que se aprueben no restan de tu saldo.` });
    if (!v) return;
    const r = await Api.post(`${API}/pedir`, { desde: s.desde, hasta: s.hasta, libra: s.libra, nota: v.nota || '' }, { aviso: 'No se han podido pedir' });
    if (!r) return;
    Dialogo.hecho('Pedidas: esperan aprobación');
    await cargarMias();
    refrescarOficina();
  }

  // ── Aprobar, rechazar, retirar, anular (en la tabla de vacaciones) ─────────
  function engancharAcciones(raiz, deAhora, { recargar }) {
    raiz.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-retirar],[data-aprobar],[data-rechazar],[data-anular]');
      const d = deAhora();
      if (!b || !raiz.contains(b) || !d) return;
      const v = d.vacaciones.find(x => String(x.id) === (b.dataset.retirar || b.dataset.aprobar || b.dataset.rechazar || b.dataset.anular));
      if (!v) return;
      const fechas = `del ${f(v.desde)} al ${f(v.hasta)}`;
      let r = null;
      if (b.dataset.retirar) {
        if (!await Dialogo.confirmar({ titulo: 'Retirar la petición', texto: `Tus vacaciones ${fechas} dejan de esperar aprobación.`, si: 'Retirarla', no: 'Cancelar' })) return;
        r = await Api.post(`${API}/${v.id}/retirar`, {}, { boton: b, aviso: 'No se ha podido retirar' });
      } else if (b.dataset.aprobar) {
        const pv = v.prevision;
        if (pv && pv.sePasa && !await Dialogo.confirmar({
          titulo: `Se pasa ${num(-pv.alVolver)} días`,
          texto: `Las vacaciones ${fechas} gastan ${pv.gasta} días. El día que se va tendrá ${num(pv.alIrse)} y al volver le faltarán ${num(-pv.alVolver)}, aun contando lo que genera durante las vacaciones.`,
          si: 'Aprobar igualmente', no: 'Cancelar',
        })) return;
        r = await Api.post(`${API}/${v.id}/aprobar`, {}, { boton: b, aviso: 'No se han podido aprobar' });
        if (r) Dialogo.hecho('Aprobadas');
      } else {
        const anular = !!b.dataset.anular;
        const m = await Dialogo.formulario(anular ? `Anular las vacaciones ${fechas}` : `No aprobar las vacaciones ${fechas}`, [
          { id: 'motivo', etiqueta: 'Por qué (le llega a quien las pidió)', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 1000 },
        ], { textoBoton: anular ? 'Anularlas' : 'No aprobarlas' });
        if (!m) return;
        r = await Api.post(`${API}/${v.id}/${anular ? 'anular' : 'rechazar'}`, { motivo: m.motivo }, { aviso: 'No se ha podido' });
      }
      if (r) { await recargar(); refrescarOficina(); }
    });
  }

  // ── La oficina (quien aprueba) ─────────────────────────────────────────────
  function montarOficina() {
    document.getElementById('mv-pestanas').hidden = false;
    Pestanas.montar(document.getElementById('mv-pestanas'), {
      pestanas: [
        { id: 'mias', texto: 'Mías', icono: 'fa-user' },
        { id: 'oficina', texto: 'La oficina', icono: 'fa-users', contador: 'vacaciones_oficina.pedidas' },
      ],
      param: 'vista',
      alCambiar: id => mostrar(id),
    });
    oficina = Listado.montar({
      raiz: '#mv-oficina',
      titulo: 'La oficina',
      icono: 'fa-users',
      clave: 'id',
      origen: `${API}/lista`,
      vacio: 'Nadie en la oficina.',
      buscar: { texto: 'Persona o puesto…', campos: ['nombre', 'puesto'] },
      subtitulo: (v, todas) => `${todas.length} personas · el saldo de hoy y lo que espera aprobación`,
      kpis: filas => [
        { etiqueta: 'Por aprobar', valor: filas.reduce((n, x) => n + x.porAprobar, 0), tono: filas.some(x => x.porAprobar) ? 'warn' : 'text',
          pie: 'peticiones', filtro: { id: 'estado', valor: 'aprobar' } },
        { etiqueta: 'Sin fecha de alta', valor: filas.filter(x => !x.alta).length, tono: filas.some(x => !x.alta) ? 'warn' : 'text',
          pie: 'no generan: se pone en Usuarios', filtro: { id: 'estado', valor: 'sin-alta' } },
      ],
      filtros: [{
        id: 'estado', etiqueta: 'Mostrar', textoTodos: 'Todos',
        opciones: filas => [
          { valor: 'aprobar', texto: 'Con algo por aprobar', cuenta: filas.filter(x => x.porAprobar).length },
          { valor: 'sin-alta', texto: 'Sin fecha de alta', cuenta: filas.filter(x => !x.alta).length },
        ],
        pasa: (x, v) => (v === 'aprobar' ? x.porAprobar > 0 : !x.alta),
      }],
      columnas: [
        { titulo: 'Persona', campo: 'nombre', pinta: (v, x) => `<span class="font-semibold">${esc(v)}</span>${x.puesto ? `<span class="block text-[11px] text-telecab-muted">${esc(x.puesto)}</span>` : ''}` },
        { titulo: 'Alta', campo: 'alta', clase: 'whitespace-nowrap tabular-nums', pinta: v => (v ? f(v) : '<span class="tc-pastilla tc-pastilla--aviso">Sin poner</span>') },
        { titulo: 'Generadas', campo: 'generadas', clase: 'text-right tabular-nums', pinta: v => num(v) },
        { titulo: 'Gastadas', campo: 'disfrutadas', clase: 'text-right tabular-nums', pinta: v => num(v, 0) },
        { titulo: 'Programadas', campo: 'programadas', clase: 'text-right tabular-nums', pinta: v => (v ? num(v, 0) : '—') },
        { titulo: 'Para usar hoy', campo: 'saldo', clase: 'text-right tabular-nums', pinta: v => `<b class="${v < 0 ? 'text-telecab-red' : ''}">${num(v)}</b>` },
        { titulo: 'Por aprobar', campo: 'porAprobar', pinta: v => (v ? `<span class="tc-pastilla tc-pastilla--aviso">${v}</span>` : '—') },
      ],
      alAbrir: x => abrirPersona(x),
    });
    mostrar(new URLSearchParams(location.search).get('vista') || 'mias');
  }
  function mostrar(id) {
    const ofi = id === 'oficina';
    caja.classList.toggle('hidden', ofi);
    document.getElementById('mv-oficina').classList.toggle('hidden', !ofi);
    document.getElementById('mv-calendario-pantalla').classList.toggle('hidden', !ofi);
    if (ofi && !calCargado) cargarCalendario();
  }

  // ── EL CALENDARIO DE LA OFICINA (17/11/2026, Camilo: «Hazlo tipo calendario
  // para saber gráficamente quién se va y cuándo… ya hay algo parecido en
  // bitácora llamado "Vacaciones por meses", recicla ese»). Es esa parrilla, la
  // pieza global VacacionesPorMeses: aquí además con las que esperan
  // aprobación y los días que no gastan (su libranza y los festivos). Al
  // pulsar a alguien, su ficha, donde se aprueban.
  const calCaja = document.getElementById('mv-calendario');

  async function cargarCalendario() {
    const c = await Api.get(`${API}/calendario`).catch(err => ({ error: err }));
    if (c.error) { calCaja.innerHTML = aviso(`No se ha podido leer el calendario: ${esc(c.error.message)}`); return; }
    calCargado = true;
    VacacionesPorMeses.pintar(calCaja, {
      hoy: c.hoy, desde: c.desde, festivos: c.festivos, periodos: c.periodos, sinVacaciones: c.sinVacaciones,
      titulo: 'Vacaciones por meses',
      ayuda: 'Quién se va y cuándo, seguido: arrastra la parrilla para ver quién pisa a quién. En violeta, los asuntos propios; en verde, los permisos retribuidos. En gris, sus días de libranza y los festivos, que no gastan. Pulsa a alguien para ver su ficha y aprobar.',
      // Un permiso que ya pasó y no se pidió (20/11/2026): se apunta y sale aquí.
      botones: [{ html: '<i class="fa-solid fa-clock-rotate-left mr-1" aria-hidden="true"></i>Apuntar un permiso pasado',
        titulo: 'Asuntos propios, un permiso retribuido o teletrabajo que ya pasó: queda aprobado y en el mapa',
        alPulsar: () => PermisosOficina.registrarPasado({ personas: c.personas, alAcabar: cargarCalendario }) }],
      alAbrir: id => { const p = c.personas.find(x => String(x.id) === String(id)); if (p) abrirPersona(p); },
    });
  }

  async function abrirPersona(x) {
    const p = Panel.abrir({ titulo: x.nombre, subtitulo: x.alta ? `En Telecab desde el ${f(x.alta)}` : 'Sin fecha de alta', html: '<p class="text-sm text-telecab-muted">Cargando…</p>' });
    let d = null;
    const cargar = async () => {
      d = await Api.get(`${API}/personas/${x.id}`).catch(err => ({ error: err }));
      if (d.error) { p.poner({ html: aviso(esc(d.error.message)) }); return; }
      p.poner({ html: `${cifras(d)}
        <div class="flex justify-end flex-wrap gap-2 mt-3">
          <button type="button" class="tc-boton tc-boton--chico" data-registrar ${d.alta ? '' : 'disabled'} title="Unas vacaciones que ya disfrutó: se restan de lo que tiene hoy">
            <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>Registrar unas ya disfrutadas</button>
          <button type="button" class="tc-boton tc-boton--chico" data-permiso-pasado title="Asuntos propios, un permiso retribuido o teletrabajo que ya pasó">
            <i class="fa-solid fa-user-clock" aria-hidden="true"></i>Apuntar un permiso pasado</button>
          <button type="button" class="tc-boton tc-boton--chico" data-simular-otro ${d.alta ? '' : 'disabled'}>
          <i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>Simular sus vacaciones</button></div>
        <section class="tc-panel-seccion"><h4>Sus vacaciones</h4>${tablaVacaciones(d, { propio: d.id === yo.id, aprueba: true })}</section>
        <section class="tc-panel-seccion"><h4>Mes a mes</h4>${tablaMeses(d)}</section>` });
      p.cuerpo.querySelector('[data-simular-otro]').addEventListener('click', () => simular(d));
      p.cuerpo.querySelector('[data-registrar]').addEventListener('click', () => registrar(d, cargar));
      p.cuerpo.querySelector('[data-permiso-pasado]').addEventListener('click', () => PermisosOficina.registrarPasado({
        personas: [{ id: x.id, nombre: x.nombre }], persona: x.id,
        alAcabar: async () => { await cargar(); if (calCargado) cargarCalendario(); },
      }));
    };
    engancharAcciones(p.cuerpo, () => (d && !d.error ? d : null), { recargar: async () => { await cargar(); if (d && d.id === yo.id) await cargarMias(); } });
    await cargar();
  }

  cargarMias();
})();
