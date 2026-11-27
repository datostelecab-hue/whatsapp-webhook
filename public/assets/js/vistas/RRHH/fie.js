// modules/RRHH/vistas/ausencias.ejs — la pestaña «Fichero FIE» (db/312, 27/11/2026).
//
// El fichero FIE que manda la gestoría cada día (lo legal: quién está de baja
// médica, desde cuándo y hasta cuándo). Llega a datos@telecab.es y se lee cada
// hora. Cada proceso de IT con lo que dice el FIE y lo que cambiaría (o cambió)
// en la baja de su ficha. Hasta el primer «Aplicar» es una previa; después se
// aplica solo. Abajo, las bajas del ERP que no salen en ningún FIE.

(function () {
  const { esc, etiqueta } = Listado.fmt;
  const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const ESTADOS = {
    pendiente: ['Por aplicar', 'warn'], aplicado: ['Aplicado', 'green'], al_dia: ['Ya cuadraba', 'muted'],
    sin_ficha: ['Sin ficha', 'red'], error: ['Error', 'red'],
  };
  const est = f => ESTADOS[f.sin_ficha ? 'sin_ficha' : f.estado] || [f.estado, 'muted'];
  const PUEDE = !!Casa.datos().puedeValidar;
  let lista = null, EXTRA = {};

  function montar() {
    if (lista) return lista.recargar();
    lista = Listado.montar({
      raiz: '#au-fie',
      titulo: 'Fichero FIE de la gestoría',
      icono: 'fa-file-medical',
      clave: 'id',
      url: false,
      origen: '/ausencias/api/fie',
      vacio: 'Aún no se ha leído ningún fichero FIE.',
      filtrosIniciales: { cambia: 'si' },
      buscar: { texto: 'Buscar persona…', campos: ['nombre', 'nombre_erp'] },
      subtitulo: (v, t, extra) => `Desde el ${dmy((extra && extra.desde) || '2026-09-27')} · ${v.length} de ${t.length} procesos de baja`,
      kpis: (filas, extra) => {
        EXTRA = extra || {};
        return [
          { etiqueta: EXTRA.automatico ? 'Por aplicar' : 'Cambiarían al aplicar', valor: filas.filter(f => f.cambia).length, tono: 'warn', filtro: { id: 'cambia', valor: 'si' } },
          { etiqueta: 'Sin ficha en el ERP', valor: filas.filter(f => f.sin_ficha).length, tono: 'red', filtro: { id: 'cambia', valor: 'sin_ficha' } },
          { etiqueta: 'Bajas del ERP sin FIE', valor: (EXTRA.sinFie || []).length, tono: 'muted' },
          { etiqueta: 'Procesos leídos', valor: filas.length },
        ];
      },
      nota: (filas, extra) => {
        const e = extra || {};
        const n = [];
        if (e.sinTabla) n.push({ tono: 'aviso', icono: 'fa-database', texto: 'Falta aplicar la migración db/312 en Migraciones.' });
        n.push(e.automatico
          ? { icono: 'fa-bolt', texto: 'Automático: cada FIE que llega a datos@telecab.es (se mira cada hora) corrige solo las bajas de su ficha. El FIE es lo legal.' }
          : { tono: 'aviso', icono: 'fa-eye', texto: 'PREVIA: nada se ha tocado todavía. Revisa lo que cambiaría y pulsa «Aplicar»; desde entonces, cada FIE nuevo se aplicará solo.' });
        if (e.ultimo) n.push({ icono: 'fa-envelope-open-text', texto: `Último fichero leído: ${e.ultimo.nombre} (${e.ultimo.cuando}). ${e.ultimo.total} en total.` });
        if ((e.sinFie || []).length) {
          n.push({ icono: 'fa-circle-question', html: `<b>Bajas del ERP que no salen en ningún FIE</b> (no se tocan; míralas por si son un error): `
            + e.sinFie.slice(0, 12).map(b => `${esc(b.nombre)} desde el ${esc(dmy(b.desde))}${b.hasta ? ` hasta el ${esc(dmy(b.hasta))}` : ''}`).join(' · ')
            + (e.sinFie.length > 12 ? ` · y ${e.sinFie.length - 12} más` : '') });
        }
        return n;
      },
      filtros: [
        { id: 'cambia', etiqueta: 'Qué', textoTodos: 'Todos', opciones: [
          { valor: 'si', texto: 'Cambia algo en el ERP' }, { valor: 'no', texto: 'Ya cuadra' }, { valor: 'sin_ficha', texto: 'Sin ficha' }],
          pasa: (f, v) => (v === 'si' ? f.cambia : v === 'no' ? !f.cambia && !f.sin_ficha : !!f.sin_ficha) },
        { id: 'abierta', etiqueta: 'Baja', textoTodos: 'Abiertas y con alta', opciones: [{ valor: 'si', texto: 'Sin alta' }, { valor: 'no', texto: 'Con alta' }],
          pasa: (f, v) => (v === 'si' ? !f.fecha_fin || f.alta_anulada : !!f.fecha_fin && !f.alta_anulada) },
      ],
      acciones: PUEDE ? [
        { texto: 'Aplicar', icono: 'fa-check-double', onClick: lst => aplicar(lst) },
        { texto: 'Leer el buzón ahora', icono: 'fa-envelope', principal: false, onClick: lst => leer(lst) },
        { texto: 'Subir un FIE', icono: 'fa-file-arrow-up', principal: false, onClick: lst => subir(lst) },
      ] : [],
      columnas: [
        { titulo: 'Persona', valor: f => f.nombre_erp || f.nombre, clase: 'font-semibold',
          pinta: (v, f) => esc(v) + (f.nombre_erp && f.nombre && f.nombre_erp !== f.nombre ? `<span class="block text-xs font-normal text-telecab-muted">En el FIE: ${esc(f.nombre)}</span>` : '') },
        { titulo: 'Baja', valor: f => f.fecha_baja, clase: 'whitespace-nowrap tabular-nums', pinta: v => esc(dmy(v)) },
        { titulo: 'Alta', valor: f => f.fecha_fin || '', clase: 'whitespace-nowrap tabular-nums',
          pinta: (v, f) => (f.baja_anulada ? etiqueta('Parte de baja anulado', 'red') : f.alta_anulada ? etiqueta('Alta anulada', 'warn')
            : v ? esc(dmy(v)) : '<span class="text-telecab-muted">Sin alta</span>') },
        { titulo: 'Qué cambia en el ERP', valor: f => (f.cambia ? f.acciones.join(' · ') : (f.sin_ficha ? f.acciones[0] : 'Nada: ya cuadra')),
          clase: 'max-w-[30rem]', pinta: (v, f) => (f.cambia ? esc(v) : `<span class="text-telecab-muted">${esc(v)}</span>`) },
        { titulo: 'Estado', valor: f => est(f)[0], pinta: (v, f) => etiqueta(v, est(f)[1]) },
        { titulo: 'Del FIE del', valor: f => f.registro || '', clase: 'whitespace-nowrap tabular-nums text-telecab-muted', pinta: v => esc(dmy(v)) },
      ],
    });
  }

  async function aplicar(lst) {
    const n = EXTRA.porAplicar || 0;
    const ok = await Dialogo.confirmar({ titulo: 'Aplicar el fichero FIE', si: 'Aplicar', no: 'Cancelar', tono: 'aviso',
      texto: `Se corrigen las bajas de su ficha con lo que dice el FIE${n ? ` (${n} procesos con cambios)` : ''}: se abren, se rectifican, se les pone el alta o se reabren, con su parte «fichero FIE». `
        + (EXTRA.automatico ? '' : 'Desde ahora, cada FIE nuevo se aplicará solo.') });
    if (!ok) return;
    const r = await Api.post('/ausencias/api/fie/aplicar', {}, { aviso: 'No se ha podido aplicar', bloquea: true });
    if (!r) return;
    Dialogo.hecho(`${r.aplicados} aplicados · ${r.alDia} ya cuadraban${r.errores ? ` · ${r.errores} con error` : ''}`);
    await lst.recargar();
  }

  async function leer(lst) {
    const r = await Api.post('/ausencias/api/fie/leer', {}, { aviso: 'No se ha podido leer el buzón', bloquea: true });
    if (!r) return;
    Dialogo.hecho(`${r.nuevos || 0} ficheros nuevos${r.repetidos ? `, ${r.repetidos} ya leídos` : ''}${(r.errores || []).length ? `, ${r.errores.length} con error` : ''}`);
    await lst.recargar();
  }

  async function subir(lst) {
    const v = await Dialogo.formulario('Subir un fichero FIE', [
      { id: 'fichero', etiqueta: 'El Excel del FIE', tipo: 'ficheros', multiple: false, obligatorio: true, accept: '.xlsx,.xls',
        ayuda: 'Tal cual lo manda la gestoría. Normalmente no hace falta: llega solo a datos@telecab.es.' },
    ], { textoBoton: 'Subir' });
    if (!v || !v.fichero || !v.fichero[0]) return;
    const f = v.fichero[0];
    const base64 = await new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = ko; fr.readAsDataURL(f); });
    const r = await Api.post('/ausencias/api/fie/subir', { base64, nombre: f.name }, { aviso: 'No se ha podido subir', bloquea: true });
    if (!r) return;
    Dialogo.hecho(`${r.procesos} procesos leídos (${r.nuevos} nuevos, ${r.cambian} con cambios)`);
    await lst.recargar();
  }

  window.AusenciasFie = { montar };
})();
