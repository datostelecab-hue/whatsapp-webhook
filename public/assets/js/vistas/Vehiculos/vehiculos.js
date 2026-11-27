// modules/Vehiculos/vistas/vehiculos.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.

(function () {
  const DEL_SERVIDOR = Casa.datos();
  // El color de cada estado del coche es de la casa (nucleo.js), el mismo que en el Planificador.
  const tonoEstado = Casa.tonoEstadoCoche;
  // Quién puede cambiar el estado de las piezas (el servidor lo comprueba igual).
  const PUEDE_PIEZAS = DEL_SERVIDOR.puedePiezas;
  // Abrir y cerrar el coche (27/11/2026): el desarrollador o la llave de puertas.
  const PUEDE_PUERTAS = !!DEL_SERVIDOR.puedePuertas;
  const { fecha, fechaHora, hace, km, etiqueta, caduca, esc } = Listado.fmt;
  const VER_SEDES = DEL_SERVIDOR.verTodasLasSedes;

  // ---------- las fotos de los conductores (24/11/2026) ----------
  const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const diaLargo = iso => {
    const [a, m, d] = String(iso).split('-').map(Number);
    const dt = new Date(Date.UTC(a, m - 1, d, 12));
    return `${DIAS_SEMANA[dt.getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  };
  async function fotosConductores(hueco, d) {
    hueco.innerHTML = '<p class="text-sm text-telecab-muted">Cargando las fotos…</p>';
    let r;
    try {
      const res = await fetch(`/vehiculos/api/ficha/${encodeURIComponent(d.id)}/fotos`);
      r = await res.json();
      if (!res.ok || r.status !== 'ok') throw new Error(r.msg || `Error ${res.status}`);
    } catch (e) {
      hueco.innerHTML = `<p class="text-sm text-telecab-red">No se han podido cargar las fotos: ${esc(e.message)}</p>`;
      return;
    }
    const nota = `<p class="text-xs text-telecab-muted mb-3">Las que hacen los conductores al desvincular el coche desde el portal. Se guardan ${r.dias} días: las de antes del ${esc(fecha(r.desde))} ya se han borrado.</p>`;
    if (!r.porDia.length) {
      hueco.innerHTML = nota + '<p class="text-sm text-telecab-muted">No hay fotos de este coche en los últimos ' + r.dias + ' días.</p>';
      return;
    }
    hueco.innerHTML = nota + r.porDia.map(dia => `
      <section class="mb-4 last:mb-0">
        <h4 class="text-sm font-semibold capitalize mb-2">${esc(diaLargo(dia.dia))}</h4>
        <div class="flex flex-col gap-3">
          ${dia.veces.map(v => `
            <div class="rounded-xl border border-telecab-border p-3">
              <p class="text-sm mb-2"><span class="font-semibold">${esc(v.quien)}</span>
                <span class="text-telecab-muted">· vinculado el ${esc(v.desde)}, desvinculado a las ${esc(v.hasta)}${v.oficina ? ' · viaje de la oficina' : ''}</span></p>
              <ul class="grid grid-cols-3 sm:grid-cols-5 gap-2">
                ${v.fotos.map(f => `<li>
                  <button type="button" class="block w-full text-left group" data-foto="${esc(f.url)}" data-titulo="${esc(d.matricula + ' · ' + f.etiqueta)}"
                          data-pie="${esc(v.quien + ' · ' + diaLargo(dia.dia) + ', ' + v.hasta)}">
                    <img src="${esc(f.url)}" alt="${esc(f.etiqueta)}" loading="lazy" decoding="async"
                         class="w-full aspect-[4/3] object-cover rounded-lg border border-telecab-border bg-telecab-card2 group-hover:border-telecab-gold transition">
                    <span class="block text-[11px] text-telecab-muted mt-1">${esc(f.etiqueta)}</span>
                  </button></li>`).join('')}
              </ul>
            </div>`).join('')}
        </div>
      </section>`).join('');
    // En grande, con zoom y descarga: el visor de la casa.
    hueco.querySelectorAll('[data-foto]').forEach(b => b.addEventListener('click', () =>
      VisorFoto.abrir({ src: b.dataset.foto, titulo: b.dataset.titulo, pie: b.dataset.pie, descargar: true })));
  }

  // ---------- la pantalla ----------

  const flota = Listado.montar({
    raiz: '#modulo',
    titulo: 'Vehículos',
    icono: 'fa-car-side',
    clave: 'id',
    origen: '/vehiculos/api/lista',
    vacio: 'No hay vehículos que coincidan.',
    buscar: { texto: 'Buscar matrícula, modelo…', campos: ['matricula', 'marca_modelo', 'zona'] },

    subtitulo: (visibles, todas) =>
      visibles.length === todas.length
        ? `${todas.length} vehículos`
        : `${visibles.length} de ${todas.length} vehículos`,

    kpis: (filas, extra) => {
      const r = (extra && extra.resumen) || {};
      const a = r.alertas || {};
      const operativos = filas.filter(f => f.es_operativo).length;
      return [
        { etiqueta: 'Operativos', valor: `${operativos} / ${filas.length}`, tono: 'green',
          filtro: { id: 'estado', valor: 'O' } },
        { etiqueta: 'ITV', valor: Number(a.itv_caducada || 0) + Number(a.itv_pronto || 0),
          tono: Number(a.itv_caducada) ? 'red' : 'warn',
          pie: `${a.itv_caducada || 0} caducadas · ${a.itv_pronto || 0} en 30 días` },
        { etiqueta: 'Seguro', valor: Number(a.seguro_caducado || 0) + Number(a.seguro_pronto || 0),
          tono: Number(a.seguro_caducado) ? 'red' : 'warn',
          pie: `${a.seguro_caducado || 0} vencidos · ${a.seguro_pronto || 0} en 30 días` },
        { etiqueta: 'Odómetro', valor: filas.filter(f => f.km_odometro_m).length,
          tono: 'gold', pie: `${a.odometro_viejo || 0} sin refrescar` },
      ];
    },

    filtros: [{
      id: 'estado',
      campo: 'estado_operativo',
      etiqueta: 'Estado',
      textoTodos: 'Todos',
      // Las opciones salen de los datos, no de una lista escrita a mano: si
      // mañana se añade un estado en la base, aparece aquí solo.
      opciones: (filas, extra) => ((extra.resumen && extra.resumen.porEstado) || [])
        .filter(e => e.coches > 0)
        .map(e => ({ valor: e.codigo, texto: e.etiqueta, cuenta: e.coches })),
    }],

    acciones: [
      { texto: 'Nuevo vehículo', icono: 'fa-plus', onClick: () => abrirForm(null) },
      { texto: 'Mapon', icono: 'fa-satellite-dish', principal: false, onClick: sincronizarMapon },
    ],

    columnas: [
      { titulo: 'Matrícula', campo: 'matricula', clase: 'font-semibold whitespace-nowrap' },
      { titulo: 'Modelo', campo: 'marca_modelo',
        pinta: (v, f) => esc(v || '') + (f.anio ? ` <span class="text-telecab-muted">${f.anio}</span>` : '') },
      { titulo: 'Estado', campo: 'estado_etiqueta',
        pinta: (v, f) => etiqueta(v, tonoEstado(f.estado_operativo)) },
      { titulo: 'ITV', campo: 'itv_caduca', clase: 'whitespace-nowrap',
        pinta: (v, f) => caduca(f.dias_itv, fecha(v)) },
      { titulo: 'Seguro', campo: 'seguro_caduca', clase: 'whitespace-nowrap',
        pinta: (v, f) => caduca(f.dias_seguro, fecha(v)) },
      { titulo: 'Zona', campo: 'zona' },
      ...(VER_SEDES ? [{ titulo: 'Sede', campo: 'sede',
        pinta: v => etiqueta(v === 'barcelona' ? 'Barcelona' : 'Madrid',
          v === 'barcelona' ? 'violet' : 'muted') }] : []),
      { titulo: 'Kilómetros', campo: 'km_odometro_m', clase: 'whitespace-nowrap tabular-nums',
        pinta: (v, f) => v
          ? `${km(v)} <span class="text-telecab-muted text-xs">${esc(hace(f.km_odometro_at))}</span>`
          : '<span class="text-telecab-muted">—</span>' },
      // Las piezas en mal estado (db/158): de un vistazo, qué coche tiene algo.
      { titulo: 'Piezas', campo: 'piezas_mal', clase: 'whitespace-nowrap',
        pinta: (v, f) => Number(v)
          ? etiqueta(`${v} mal${Number(f.piezas_cambio) ? ` · ${f.piezas_cambio} cambio` : ''}`, 'red')
          : '<span class="text-telecab-muted text-xs">bien</span>' },
      { titulo: 'Plazas', campo: 'plazas_ocupadas', clase: 'tabular-nums',
        pinta: v => `${v}<span class="text-telecab-muted"> / 6</span>` },
    ],

    // ---------- la ficha ----------

    detalle: {
      origen: id => `/vehiculos/api/ficha/${id}`,
      titulo: d => d.matricula,
      subtitulo: d => [d.marca_modelo, d.anio, d.zona].filter(Boolean).join(' · '),

      acciones: [
        { texto: 'Editar', icono: 'fa-pen', principal: true, onClick: d => abrirForm(d) },
        { texto: 'Abrir puertas', icono: 'fa-lock-open', visible: d => PUEDE_PUERTAS && !d.baja_at, onClick: d => puertas(d, true) },
        { texto: 'Cerrar puertas', icono: 'fa-lock', visible: d => PUEDE_PUERTAS && !d.baja_at, onClick: d => puertas(d, false) },
        { texto: 'Dar de baja', icono: 'fa-ban', peligro: true,
          visible: d => !d.baja_at, onClick: darDeBaja },
      ],

      bloques: [
        {
          titulo: 'Datos del vehículo', icono: 'fa-circle-info',
          campos: [
            { etiqueta: 'Matrícula', valor: d => d.matricula, clase: 'font-semibold' },
            { etiqueta: 'Estado', html: true,
              valor: d => etiqueta(d.estado_etiqueta, tonoEstado(d.estado_operativo)) },
            { etiqueta: 'Zona', valor: d => d.zona },
            { etiqueta: 'Marca y modelo', valor: d => d.marca_modelo },
            { etiqueta: 'Año', valor: d => d.anio },
            { etiqueta: 'Matriculación', valor: d => fecha(d.fecha_matriculacion) },
            { etiqueta: 'Caduca la ITV', html: true, valor: d => caduca(dias(d.itv_caduca), fecha(d.itv_caduca)) },
            { etiqueta: 'Aseguradora', valor: d => d.aseguradora },
            { etiqueta: 'Vence el seguro', html: true, valor: d => caduca(dias(d.seguro_caduca), fecha(d.seguro_caduca)) },
            { etiqueta: 'Kilómetros', valor: d => km(d.km_odometro_m) },
            { etiqueta: 'Última lectura', valor: d => d.km_odometro_at ? `${fechaHora(d.km_odometro_at)} (${hace(d.km_odometro_at)})` : '' },
            { etiqueta: 'Notas', valor: d => d.notas, ancho: 'sm:col-span-2 lg:col-span-3' },
          ],
        },
        {
          // LAS FOTOS DE LOS CONDUCTORES (24/11/2026): las cinco de cada vez que
          // alguien lo desvinculó desde el portal, por día. Se guardan 20 días.
          titulo: 'Fotos de los conductores', icono: 'fa-camera',
          pinta: (d, hueco) => fotosConductores(hueco, d),
        },
        {
          // El dibujo del coche para marcar el estado de cada pieza (db/158).
          titulo: 'Estado de las piezas', icono: 'fa-car-burst',
          pinta: (d, hueco, lista) => PiezasCoche.montar(hueco, { vehiculoId: d.id, puedeEditar: PUEDE_PIEZAS, lista }),
        },
        {
          titulo: 'Plazas y conductores', icono: 'fa-users',
          tabla: {
            datos: d => d.plazas,
            vacio: 'Este coche no tiene plazas.',
            columnas: [
              { titulo: 'Turno', campo: 'turno' },
              { titulo: 'Rol', campo: 'rol' },
              { titulo: 'Conductor', campo: 'conductor',
                pinta: v => v ? esc(v) : '<span class="text-telecab-muted">Libre</span>' },
              { titulo: 'Desde', campo: 'desde', pinta: v => fecha(v) },
            ],
          },
        },
        {
          titulo: 'Enlaces con sistemas externos', icono: 'fa-link',
          tabla: {
            datos: d => d.enlaces,
            vacio: 'Sin enlazar. Este coche no recibe kilometraje.',
            columnas: [
              { titulo: 'Sistema', campo: 'sistema', clase: 'uppercase font-semibold' },
              { titulo: 'Identificador', campo: 'externo_id', clase: 'tabular-nums' },
              { titulo: 'Matrícula allí', campo: 'externo_matricula',
                // Si allí está escrita distinta, se avisa: es el descuadre que
                // deja a un coche sin kilómetros sin que nadie se entere.
                pinta: (v, f, d) => norm(v) === norm(d.matricula)
                  ? esc(v)
                  : `<span class="text-telecab-warn">${esc(v)} <i class="fa-solid fa-triangle-exclamation"></i></span>` },
              { titulo: 'Desde', campo: 'visto_desde', pinta: v => fecha(v) },
            ],
          },
        },
        {
          titulo: 'Historial de estado', icono: 'fa-clock-rotate-left',
          tabla: {
            datos: d => d.historialEstado,
            vacio: 'Sin cambios registrados.',
            columnas: [
              { titulo: 'Estado', campo: 'etiqueta',
                pinta: (v, f) => etiqueta(v || f.estado_codigo, tonoEstado(f.estado_codigo)) },
              { titulo: 'Desde', campo: 'desde', pinta: v => fecha(v) },
              { titulo: 'Hasta', campo: 'hasta',
                pinta: v => v ? fecha(v) : '<span class="text-telecab-green">Ahora</span>' },
            ],
          },
        },
        {
          // Lo que se le ha hecho al coche, uno por uno (12/11/2026, db/241): de
          // las facturas del taller, apuntado a mano o piezas del inventario.
          titulo: 'Mantenimientos', icono: 'fa-screwdriver-wrench',
          pinta: (d, hueco) => MantenimientosCoche.pintar(hueco, d.mantenimientos, {
            vacio: d.mantenimientos === null
              ? 'No se han podido cargar los mantenimientos. Recarga la ficha.'
              : 'Ningún mantenimiento apuntado todavía.',
          }),
        },
        {
          titulo: 'Historial de zona', icono: 'fa-location-dot',
          visible: d => (d.historialZona || []).length > 0,
          tabla: {
            datos: d => d.historialZona,
            columnas: [
              { titulo: 'Zona', campo: 'etiqueta' },
              { titulo: 'Desde', campo: 'desde', pinta: v => fecha(v) },
              { titulo: 'Hasta', campo: 'hasta',
                pinta: v => v ? fecha(v) : '<span class="text-telecab-green">Ahora</span>' },
            ],
          },
        },
      ],
    },
  });

  function norm(m) { return String(m || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); }
  function dias(f) {
    if (!f) return null;
    return Math.round((new Date(f) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  }

  // ---------- el formulario ----------

  const modal = document.getElementById('ficha-modal');
  const form  = document.getElementById('fm-form');
  const error = document.getElementById('fm-error');
  const campo = id => document.getElementById('fm-' + id);

  // `sede` solo está en el formulario de quien ve las dos sedes, así que se
  // añade solo si existe: si no, el campo NO viaja y el servidor no lo toca.
  const CAMPOS = ['matricula', 'estado', 'marcaModelo', 'anio', 'matriculacion',
                  'itv', 'aseguradora', 'venceSeguro', 'zonaId', 'notas']
    .concat(document.getElementById('fm-sede') ? ['sede'] : []);

  // La ficha guarda las fechas en ISO y el formulario las enseña dd/mm/aaaa.
  const aISO = v => {
    const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : (v || null);
  };

  function abrirForm(d) {
    error.classList.add('hidden');
    document.getElementById('fm-titulo').textContent = d ? `Editar ${d.matricula}` : 'Nuevo vehículo';
    campo('id').value = d ? d.id : '';

    campo('matricula').value    = d ? d.matricula || '' : '';
    campo('estado').value       = d ? d.estado_operativo || 'O' : 'O';
    campo('marcaModelo').value  = d ? d.marca_modelo || '' : '';
    campo('anio').value         = d ? d.anio || '' : '';
    campo('matriculacion').value= d ? fecha(d.fecha_matriculacion) : '';
    campo('itv').value          = d ? fecha(d.itv_caduca) : '';
    campo('aseguradora').value  = d ? d.aseguradora || '' : '';
    campo('venceSeguro').value  = d ? fecha(d.seguro_caduca) : '';
    campo('zonaId').value       = d && d.base_zona_id ? String(d.base_zona_id) : '';
    if (campo('sede')) campo('sede').value = (d && d.sede) || 'madrid';
    campo('notas').value        = d ? d.notas || '' : '';
    // Los selectores de la casa leen su valor del input oculto, así que se les
    // dice que repinten después de rellenarlo.
    if (window.Selector) Selector.montar(modal);

    // La matrícula no se cambia desde aquí: es la identidad del coche y hay
    // enlaces externos colgando de ella. Para eso, baja y alta.
    campo('matricula').readOnly = !!d;
    campo('matricula').classList.toggle('opacity-60', !!d);

    modal.classList.remove('hidden');
    (d ? campo('marcaModelo') : campo('matricula')).focus();
  }

  function cerrarForm() { modal.classList.add('hidden'); }
  document.getElementById('fm-cerrar').addEventListener('click', cerrarForm);
  document.getElementById('fm-cancelar').addEventListener('click', cerrarForm);
  modal.addEventListener('click', e => { if (e.target === modal) cerrarForm(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    error.classList.add('hidden');

    const datos = {};
    CAMPOS.forEach(k => { datos[k] = campo(k).value.trim(); });
    datos.matricula = datos.matricula.toUpperCase();
    ['matriculacion', 'itv', 'venceSeguro'].forEach(k => { datos[k] = aISO(datos[k]); });
    datos.anio = datos.anio ? Number(datos.anio) : null;

    const id = campo('id').value;
    const boton = document.getElementById('fm-guardar');
    boton.disabled = true;

    try {
      const r = await fetch(id ? `/vehiculos/api/vehiculo/${id}` : '/vehiculos/api/vehiculo', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
      });
      const j = await r.json();
      if (!r.ok || j.status === 'error') throw new Error(j.msg || 'No se pudo guardar');

      cerrarForm();
      await flota.recargar();
      // Si se estaba editando desde la ficha, se vuelve a pintar con lo nuevo.
      if (id && flota.abierto) await flota.abrir(id, { historial: false });
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove('hidden');
    } finally {
      boton.disabled = false;
    }
  });

  // ---------- acciones ----------

  // LAS PUERTAS (27/11/2026): la misma orden que el bot de WhatsApp, a Mapon, y
  // apuntada con tu nombre. Mapon solo dice que la aceptó: no que el coche abrió.
  async function puertas(d, abrir) {
    const ok = await Dialogo.confirmar({
      titulo: `${abrir ? 'Abrir' : 'Cerrar'} el ${d.matricula}`, si: abrir ? 'Abrir' : 'Cerrar', no: 'Cancelar', tono: abrir ? 'aviso' : 'info',
      texto: `Se manda a Mapon la orden de ${abrir ? 'abrir' : 'cerrar'} las puertas del ${d.matricula}. Queda apuntada a tu nombre.`,
    });
    if (!ok) return;
    const r = await Api.post('/puertas/api/orden', { matricula: d.matricula, abrir }, { aviso: 'No se ha podido mandar la orden', bloquea: true });
    if (!r) return;
    if (r.ok) Dialogo.hecho(r.titulo);
    await Dialogo.aviso({ titulo: r.titulo, texto: r.texto, tono: r.ok ? 'info' : 'error' });
  }

  async function darDeBaja(d) {
    const ok = await Dialogo.confirmar({
      titulo: `Dar de baja ${d.matricula}`,
      tono: 'peligro', si: 'Dar de baja', no: 'Cancelar',
      html: `<p>Se cierran sus plazas y las asignaciones vivas.</p>
             <p class="text-telecab-muted">Nadie conduce un coche dado de baja. Su historial se conserva.</p>`,
    });
    if (!ok) return;
    const r = await fetch(`/vehiculos/api/vehiculo/${d.id}`, { method: 'DELETE' });
    const j = await r.json();
    if (!r.ok || j.status === 'error') return alert(j.msg || 'No se pudo dar de baja');
    flota.volver();
    await flota.recargar();
  }

  async function sincronizarMapon() {
    const ok = await Dialogo.confirmar({
      titulo: 'Sincronizar con Mapon',
      si: 'Sincronizar', no: 'Cancelar',
      html: `<p>Se traen los enlaces que falten y se refresca el kilometraje.</p>
             <p class="text-telecab-muted">Solo se lee de Mapon; lo único que se escribe es en nuestra base.</p>`,
    });
    if (!ok) return;
    try {
      const r = await fetch('/vehiculos/api/mapon/sincronizar', { method: 'POST' });
      const j = await r.json();
      if (!r.ok || j.status === 'error') throw new Error(j.msg || 'Mapon no respondió');

      const e = j.enlaces || {}, o = j.odometros || {};
      const lineas = [
        `${o.actualizados || 0} odómetros al día`,
        `${e.nuevos || 0} enlaces nuevos`,
      ];
      if ((e.cambios || []).length) {
        lineas.push('', 'Enlaces corregidos al equipo bueno:');
        e.cambios.forEach(c => lineas.push(`  ${c.matricula}: ${c.de} → ${c.unitId}` +
          (c.sinCan ? ' (sin CAN: si tenía ancla en el taller, hay que volver a tomarla)' : '')));
      }
      if ((e.dobles || []).length) {
        lineas.push('', 'Matrículas con VARIAS unidades en Mapon (se usa la primera; conviene dar de baja la otra allí):');
        e.dobles.forEach(d => lineas.push(`  ${d.matricula}: ${d.elegida} · sobra ${d.dejadas.join(', ')}`));
      }
      if ((e.traspasos || []).length) {
        lineas.push('', 'GPS que han cambiado de coche (el que lo pierde enlaza su equipo nuevo en la siguiente pasada; sin CAN, hay que volver a tomar el ancla):');
        e.traspasos.forEach(t => lineas.push(`  unidad ${t.unitId}: ${t.de} → ${t.a}`));
      }
      if ((e.rechazados || []).length) {
        lineas.push('', 'Enlaces que no se han podido hacer:');
        e.rechazados.forEach(x => lineas.push('  ' + x));
      }
      if ((e.sinUnidad || []).length) {
        lineas.push('', `Sin GPS: ${e.sinUnidad.join(', ')}`);
      }
      alert(lineas.join('\n'));
      await flota.recargar();
    } catch (err) {
      alert('Mapon: ' + err.message);
    }
  }
})();
