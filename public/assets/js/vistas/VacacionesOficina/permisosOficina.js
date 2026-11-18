// Los permisos de la oficina (db/271, 18/11/2026): asuntos propios y teletrabajo.
//
// Camilo: «que también podamos solicitar 2 días de asuntos propios o permisos
// especiales, como medio día de teletrabajo, todo un día de teletrabajo, etc., y
// que quede un histórico de esos permisos». Aquí se pinta: el banco de asuntos
// propios de quien mira, pedir un permiso, su histórico (con lo rechazado y lo
// retirado) y, para quien lleva Usuarios y permisos, lo que espera aprobación.
// Las reglas son del servidor (modules/VacacionesOficina/vacacionesOficina.service.js).
(function (global) {
  'use strict';
  const esc = Casa.esc;
  const API = '/mis-vacaciones/api/permisos';
  const f = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
  const num = n => Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: 2 });
  const dias = n => `${num(n)} ${Math.abs(Number(n)) === 1 ? 'día' : 'días'}`;
  const hoyIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  const TONO = { pedido: 'tc-pastilla--aviso', aprobado: 'tc-pastilla--verde', rechazado: 'tc-pastilla--rojo', anulado: 'tc-pastilla--rojo', retirado: '' };
  const pastilla = (g) => `<span class="tc-pastilla ${TONO[g.estado] || ''}">${esc(g.etiquetaEstado)}</span>`;
  const rango = g => (g.desde === g.hasta ? f(g.desde) : `${f(g.desde)} al ${f(g.hasta)}`);
  const aviso = (texto, tono = 'warn') => `<p class="px-5 py-3 text-sm ${tono === 'warn' ? 'text-telecab-warn' : 'text-telecab-muted'}">${texto}</p>`;

  /** El banco de asuntos propios: lo que tiene, lo gastado y lo programado. */
  function bancoHtml(b, alta) {
    if (!alta) return aviso('Sin fecha de alta no genera días de asuntos propios: la pone quien lleva Usuarios y permisos.');
    const celda = (etq, valor, nota = '') => `<div class="rounded-xl bg-telecab-card2 border border-telecab-border px-3 py-2">
      <p class="text-[11px] uppercase tracking-wide text-telecab-muted">${esc(etq)}</p>
      <p class="text-lg font-semibold tabular-nums">${valor}</p>
      ${nota ? `<p class="text-[11px] text-telecab-muted">${esc(nota)}</p>` : ''}</div>`;
    const saldo = b.saldo;
    return `<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 px-5 py-4">
      ${celda('Le queda', `<span class="${saldo < 0 ? 'text-telecab-red' : 'text-telecab-green'}">${dias(saldo)}</span>`, `de ${num(b.generados)} generados desde ${b.anoInicio}`)}
      ${celda('Usados', dias(b.usados), 'ya pasados')}
      ${celda('Programados', dias(b.programados), 'aprobados, aún por llegar')}
      ${celda('Pedidos', dias(b.pedidos), 'esperando aprobación')}
    </div>`;
  }

  /** Una solicitud de la lista. `aprueba`: los botones de quien lleva Usuarios y permisos. */
  function filaHtml(g, { propia, aprueba }) {
    const pv = g.prevision;
    const botones = [];
    if (propia && g.estado === 'pedido') botones.push(`<button type="button" class="tc-boton tc-boton--chico" data-permiso-retirar="${g.grupo}"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i>Retirar</button>`);
    if (aprueba && g.estado === 'pedido') {
      botones.push(`<button type="button" class="tc-boton tc-boton--chico tc-boton--principal" data-permiso-aprobar="${g.grupo}"><i class="fa-solid fa-check" aria-hidden="true"></i>Aprobar</button>`);
      botones.push(`<button type="button" class="tc-boton tc-boton--chico" data-permiso-rechazar="${g.grupo}">No aprobar</button>`);
    }
    if (aprueba && g.estado === 'aprobado') botones.push(`<button type="button" class="tc-boton tc-boton--chico" data-permiso-anular="${g.grupo}">Anular</button>`);
    return `<li class="px-5 py-3 flex flex-wrap items-start gap-3 border-t border-telecab-border/60">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          ${aprueba && !propia ? `<span class="font-semibold text-sm">${esc(g.nombre)}</span>` : ''}
          <span class="text-sm font-semibold">${esc(g.etiquetaTipo)}</span>
          <span class="text-xs text-telecab-muted">${esc(g.etiquetaFraccion.toLowerCase())}</span>
          ${pastilla(g)}
        </div>
        <p class="text-xs text-telecab-muted mt-0.5 tabular-nums">${esc(rango(g))} · ${esc(dias(g.valor))}${g.nota ? ` · «${esc(g.nota)}»` : ''}</p>
        ${g.resueltoNota && g.estado !== 'pedido' ? `<p class="text-[11px] text-telecab-muted mt-0.5">${esc(g.estado === 'aprobado' ? 'Aprobado' : 'Resuelto')}${g.resueltoPor ? ` por ${esc(g.resueltoPor)}` : ''}: «${esc(g.resueltoNota)}»</p>` : ''}
        ${pv && pv.sePasa ? `<p class="text-[11px] text-telecab-red mt-0.5">Si se aprueban todos los pendientes, le quedarían ${num(pv.quedaria)} días: se pasa.</p>` : ''}
      </div>
      <div class="flex flex-wrap gap-1.5">${botones.join('')}</div>
    </li>`;
  }

  /** El bloque entero, en la caja que le da «Mis vacaciones». */
  function pintar(caja, mios, lista) {
    const pedidos = lista ? lista.permisos.filter(g => g.estado === 'pedido') : [];
    caja.innerHTML = `
      <div class="bg-telecab-card border border-telecab-border rounded-2xl overflow-hidden">
        <div class="px-5 py-3 border-b border-telecab-border flex flex-wrap items-center gap-2">
          <i class="fa-solid fa-user-clock text-telecab-gold text-sm" aria-hidden="true"></i>
          <h3 class="font-semibold text-sm uppercase tracking-wide text-telecab-muted">Asuntos propios y teletrabajo</h3>
          <button type="button" class="tc-boton tc-boton--chico tc-boton--principal ml-auto" data-permiso-pedir><i class="fa-solid fa-plus" aria-hidden="true"></i>Pedir un permiso</button>
        </div>
        ${bancoHtml(mios.banco, mios.alta)}
        ${mios.banco && mios.banco.saldo < 0 ? aviso('Se pasa de su banco de asuntos propios: quien aprueba lo ve antes de aprobar.', 'warn') : ''}
        ${lista && pedidos.length ? `
          <div class="px-5 pt-3 pb-1 text-[11px] uppercase tracking-wide text-telecab-muted font-semibold">Por aprobar en la oficina (${pedidos.length})</div>
          <ul>${pedidos.map(g => filaHtml(g, { propia: false, aprueba: true })).join('')}</ul>` : ''}
        <div class="px-5 pt-3 pb-1 text-[11px] uppercase tracking-wide text-telecab-muted font-semibold">Mis permisos (histórico)</div>
        ${mios.permisos.length
          ? `<ul>${mios.permisos.map(g => filaHtml(g, { propia: true, aprueba: false })).join('')}</ul>`
          : aviso('Todavía no has pedido ningún permiso.', 'muted')}
      </div>`;
  }

  /** Pide un permiso: lo que pesa (lo dice el servidor), y se confirma. */
  async function pedir(recargar) {
    const v = await Dialogo.formulario('Pedir un permiso', [
      { id: 'tipo', etiqueta: 'Qué es', tipo: 'lista', obligatorio: true, valor: 'asuntos_propios',
        opciones: [{ valor: 'asuntos_propios', texto: 'Asuntos propios' }, { valor: 'teletrabajo', texto: 'Teletrabajo' }] },
      { id: 'fraccion', etiqueta: 'Cuánto', tipo: 'lista', obligatorio: true, valor: 'dia',
        opciones: [{ valor: 'dia', texto: 'Día completo' }, { valor: 'manana', texto: 'Media mañana' }, { valor: 'tarde', texto: 'Media tarde' }] },
      { id: 'desde', etiqueta: 'Desde', tipo: 'fecha', obligatorio: true, valor: f(hoyIso()) },
      { id: 'hasta', etiqueta: 'Hasta', tipo: 'fecha', ayuda: 'Déjalo vacío si es un solo día. El medio día es siempre un solo día.' },
      { id: 'nota', etiqueta: 'Motivo (opcional)', tipo: 'texto-largo', max: 1000 },
    ], { textoBoton: 'Seguir', nota: 'Los asuntos propios salen de tu banco de 2 días al año; el teletrabajo solo se pide y se aprueba.' });
    if (!v) return;
    const tipo = v.tipo, fraccion = v.fraccion, desde = v.desde, hasta = v.hasta || v.desde;
    const sim = await Api.post(`${API}/simular`, { tipo, fraccion, desde, hasta }, { aviso: 'No se puede pedir eso' });
    if (!sim) return;
    const s = sim.simulacion;
    let detalle = `${esc(s.etiquetaTipo)} · ${esc(s.etiquetaFraccion.toLowerCase())} · <b>${esc(dias(s.cuentan))}</b>`;
    detalle += s.banco
      ? `<p class="mt-2">Te quedarían <b class="${s.quedaria < 0 ? 'text-telecab-red' : ''}">${num(s.quedaria)} días</b> de asuntos propios, contando lo ya pedido.</p>`
      : '<p class="mt-2">El teletrabajo no gasta nada: queda en tu histórico.</p>';
    if (s.sePasa) detalle += `<p class="mt-2 text-telecab-red">Te pasas ${num(-s.quedaria)} días de tu banco. Se puede pedir igualmente, pero quien aprueba lo verá.</p>`;
    const ok = await Dialogo.confirmar({ titulo: 'Pedir este permiso', html: detalle, si: 'Pedirlo', no: 'Cambiar' });
    if (!ok) return;
    const r = await Api.post(`${API}/pedir`, { tipo, fraccion, desde, hasta, nota: v.nota || '' }, { aviso: 'No se ha podido pedir' });
    if (!r) return;
    Dialogo.hecho('Pedido: lo aprueba quien lleva Usuarios y permisos');
    recargar();
  }

  /** Aprobar, no aprobar, anular o retirar una solicitud (con su motivo cuando hace falta). */
  async function accion(recargar, boton, g, lo) {
    let r = null;
    if (lo === 'aprobar') {
      if (g.prevision && g.prevision.sePasa && !await Dialogo.confirmar({
        titulo: `Se pasa ${num(-g.prevision.quedaria)} días`,
        texto: `${g.nombre} pidió ${g.etiquetaTipo.toLowerCase()} (${dias(g.valor)}). Si se aprueba, le quedarían ${num(g.prevision.quedaria)} días de su banco.`,
        si: 'Aprobar igualmente', no: 'Cancelar',
      })) return;
      r = await Api.post(`${API}/${g.grupo}/aprobar`, {}, { boton, aviso: 'No se ha podido aprobar' });
      if (r) Dialogo.hecho('Aprobado');
    } else if (lo === 'retirar') {
      if (!await Dialogo.confirmar({ titulo: 'Retirar el permiso', texto: `Dejará de esperar aprobación (${rango(g)}).`, si: 'Retirarlo', no: 'Cancelar' })) return;
      r = await Api.post(`${API}/${g.grupo}/retirar`, {}, { boton, aviso: 'No se ha podido retirar' });
    } else {
      const anular = lo === 'anular';
      const m = await Dialogo.formulario(anular ? `Anular el permiso de ${g.nombre || 'la persona'}` : `No aprobar el permiso de ${g.nombre || 'la persona'}`, [
        { id: 'motivo', etiqueta: 'Por qué (le llega a quien lo pidió)', tipo: 'texto-largo', obligatorio: true, minimo: 3, max: 1000 },
      ], { textoBoton: anular ? 'Anularlo' : 'No aprobarlo' });
      if (!m) return;
      r = await Api.post(`${API}/${g.grupo}/${anular ? 'anular' : 'rechazar'}`, { motivo: m.motivo }, { aviso: 'No se ha podido' });
    }
    if (r) recargar();
  }

  /**
   * Monta el bloque en `caja`. Pide lo de quien mira y, si aprueba, lo que espera.
   */
  async function montar(caja) {
    // Lo último que se pidió: los botones buscan su solicitud aquí.
    let ultimos = { mios: null, lista: null };
    const buscar = id => [
      ...(ultimos.lista ? ultimos.lista.permisos : []),
      ...(ultimos.mios ? ultimos.mios.permisos : []),
    ].find(x => String(x.grupo) === String(id));
    const recargar = async () => {
      const [mios, lista] = await Promise.all([
        Api.get(`${API}/mios`).catch(() => null),
        Api.get(`${API}/lista?estado=pedido`).catch(() => null),
      ]);
      if (!mios || mios.sinMigracion) {
        caja.innerHTML = aviso('Falta aplicar la migración db/271 (los permisos de la oficina).');
        return;
      }
      ultimos = { mios, lista: mios.aprueba ? lista : null };
      pintar(caja, mios, ultimos.lista);
    };
    // Un solo oyente para toda la caja: el bloque se repinta, el oyente se queda.
    caja.addEventListener('click', ev => {
      const b = ev.target.closest('[data-permiso-pedir],[data-permiso-retirar],[data-permiso-aprobar],[data-permiso-rechazar],[data-permiso-anular]');
      if (!b || !caja.contains(b)) return;
      if ('permisoPedir' in b.dataset) return pedir(recargar);
      const lo = ['retirar', 'aprobar', 'rechazar', 'anular'].find(x => b.dataset['permiso' + x[0].toUpperCase() + x.slice(1)] !== undefined);
      const id = b.dataset['permiso' + lo[0].toUpperCase() + lo.slice(1)];
      const g = buscar(id);
      if (g) accion(recargar, b, g, lo);
      else recargar();
    });
    await recargar();
  }

  global.PermisosOficina = { montar };
})(window);
