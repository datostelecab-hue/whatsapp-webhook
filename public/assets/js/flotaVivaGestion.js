/* ============================================================
   FLOTA VIVA — cerrar una incidencia: llamando o ignorándola
   ============================================================
   Vive aquí y no dentro de una vista porque hacen falta EN DOS SITIOS: en el
   panel en vivo, para despachar lo que está pasando ahora, y en el parte del
   cierre, para atender lo que se quedó sin revisar. Son el mismo gesto y tienen
   que comportarse igual en los dos — mismo diálogo, mismo motivo obligatorio,
   mismo rastro.

   QUÉ GESTIONES HAY LO DICE LA BASE, no este fichero. Se piden a `/api/gestiones`
   y de ahí salen los botones: si mañana hay una tercera, aparece sola.

   Uso:
     await GestionIncidencia.cargar();
     ... GestionIncidencia.botones(inc.id) ...        // el HTML de los botones
     GestionIncidencia.enganchar(caja, buscar, hecho); // los clics
*/
window.GestionIncidencia = (function () {
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g,
    m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

  // El de siempre. Si la petición falla se sigue con este: quedarse sin forma de
  // cerrar una incidencia porque no cargó un catálogo sería peor que el fallo.
  let GESTIONES = [{
    codigo: 'llamada', etiqueta: 'Ya he llamado', detalle: '',
    creaLlamada: true, exigeMotivo: true,
  }];
  let pedido = null;

  function cargar() {
    if (pedido) return pedido;
    pedido = fetch('/flota-viva/api/gestiones')
      .then(r => r.json())
      .then(d => {
        if (d.status === 'ok' && d.gestiones && d.gestiones.length) GESTIONES = d.gestiones;
        return GESTIONES;
      })
      .catch(() => GESTIONES);
    return pedido;
  }

  /**
   * El botón "He llamado" — seguimiento, NO cierre.
   *
   * A diferencia de los de gestión, este no abre diálogo ni cierra la incidencia:
   * deja constancia de un intento de llamada y ya. Se puede pulsar tantas veces
   * como se llame; el número entre paréntesis son los intentos que ya hay.
   */
  function botonLlamar(id, veces) {
    return '<button data-llamar="' + esc(id) + '" ' +
      'title="Dejar constancia de que has llamado. No cierra la incidencia." ' +
      'class="px-3 py-1 rounded-lg border border-telecab-border text-sm whitespace-nowrap ' +
      'text-telecab-text hover:border-telecab-gold">' +
      '<i class="fa-solid fa-phone text-xs mr-1"></i>He llamado' +
      (Number(veces) > 0 ? ' <span class="text-telecab-muted">(' + esc(veces) + ')</span>' : '') +
      '</button>';
  }

  /** Los botones de una incidencia, listos para meter en el HTML. */
  function botones(id) {
    return GESTIONES.map(g =>
      '<button data-just="' + esc(id) + '" data-gestion="' + esc(g.codigo) + '" ' +
        'title="' + esc(g.detalle || '') + '" ' +
        'class="px-3 py-1 rounded-lg border text-sm whitespace-nowrap ' +
        (g.creaLlamada
          ? 'bg-telecab-card border-telecab-border text-telecab-text hover:border-telecab-gold'
          : 'border-transparent text-telecab-muted hover:text-telecab-text hover:border-telecab-border') +
        '">' + esc(g.etiqueta) + '</button>').join('');
  }

  /**
   * Engancha los clics de los botones que haya dentro de `raiz`.
   *
   * `buscar(id)` devuelve la incidencia —hace falta para el título y para contar
   * qué pasó antes de descolgar— y `hecho(id, respuesta)` se llama cuando se ha
   * guardado, para que cada pantalla repinte lo suyo.
   */
  function enganchar(raiz, buscar, hecho) {
    raiz.querySelectorAll('[data-just]').forEach(b =>
      b.addEventListener('click', async () => {
        const id = Number(b.dataset.just);
        const r = await abrir(buscar ? buscar(id) : { id }, b.dataset.gestion);
        if (r && hecho) hecho(id, r);
      }));

    // "He llamado": un POST y ya. No abre diálogo. Se deshabilita mientras vuela
    // para no apuntar dos intentos de un doble clic, y avisa con el número.
    raiz.querySelectorAll('[data-llamar]').forEach(b =>
      b.addEventListener('click', async () => {
        const id = Number(b.dataset.llamar);
        b.disabled = true;
        try {
          const res = await fetch('/flota-viva/api/incidencia/' + id + '/he-llamado', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
          });
          const d = await res.json();
          if (d.status !== 'ok') throw new Error(d.msg || 'No se pudo apuntar');
          if (window.Dialogo && Dialogo.hecho) Dialogo.hecho('Apuntado · intento nº ' + d.veces);
          if (hecho) hecho(id, d);
        } catch (e) {
          if (window.Dialogo) Dialogo.aviso({ titulo: 'No se pudo apuntar la llamada', texto: e.message, tono: 'error' });
        } finally { b.disabled = false; }
      }));
  }

  /**
   * El diálogo y el guardado.
   *
   * Llamar clasifica en el vocabulario del Call Center y queda registrada allí
   * como una llamada más, con sus KPIs y su reincidencia. Ignorar no crea
   * llamada — no ha habido llamada— pero pide motivo igual: un botón que quita
   * cosas de la pantalla sin dejar rastro sirve para vaciarla, no para
   * auditarla.
   */
  async function abrir(inc, gestion) {
    if (!inc || !inc.id) return null;
    const g = GESTIONES.find(x => x.codigo === gestion) || GESTIONES[0];

    // Los resultados válidos los dice el catálogo, no esta pantalla, y cambian
    // según el motivo. Solo hacen falta si esta gestión crea llamada.
    let cls = null;
    if (g.creaLlamada) {
      try {
        const d = await (await fetch('/flota-viva/api/incidencia/' + inc.id + '/clasificacion')).json();
        if (d.status === 'ok') cls = d.clasificacion;
      } catch (e) { /* se sigue: sin clasificación, se justifica solo aquí */ }
    }

    const campos = [];
    if (cls) {
      campos.push({ id: 'resultado', etiqueta: 'Cómo ha acabado la llamada', tipo: 'lista',
        obligatorio: true, valor: cls.resultados[0],
        opciones: cls.resultados.map(x => ({ valor: x, texto: x })) });
      if (cls.acciones.length) {
        campos.push({ id: 'accion', etiqueta: 'Qué se hace ahora', tipo: 'lista',
          opciones: [{ valor: '', texto: '—' }].concat(cls.acciones.map(x => ({ valor: x, texto: x }))) });
      }
    }
    campos.push({ id: 'motivo',
      etiqueta: g.creaLlamada ? 'Qué te ha dicho' : 'Por qué no hace falta llamar',
      tipo: 'texto-largo', obligatorio: !!g.exigeMotivo,
      ayuda: 'Queda en el parte del cierre con tu nombre y la hora.' });

    // QUÉ PASÓ va en el título y en la nota: el formulario solo sabe pintar
    // campos que se escriben, y esto es para leer antes de descolgar.
    const titulo = inc.matricula
      ? inc.matricula + ' · ' + (inc.etiqueta || '') + (inc.conductor ? ' — ' + inc.conductor : '')
      : g.etiqueta;
    const queHaPasado = inc.detalle || inc.duracion
      ? (inc.detalle || '') + (inc.duracion ? ' · lleva ' + inc.duracion : '') +
        (inc.veces > 1 ? ' · ha vuelto a pasar ' + inc.veces + ' veces' : '')
      : '';

    const v = await Dialogo.formulario(titulo, campos, {
      textoBoton: g.creaLlamada ? 'Guardar la llamada' : 'Ignorar y dejarlo anotado',
      nota: queHaPasado + (!g.creaLlamada
        ? '  ·  No se crea ninguna llamada. Queda anotado quién lo ha ignorado y por qué.'
        : cls
          ? '  ·  Se registra en el Call Center como ' + cls.cluster + ' › ' + cls.subcluster + ' › ' + cls.motivo
          : '  ·  Este tipo no tiene clasificación de Call Center: se guarda solo aquí.'),
    });
    if (!v || (g.exigeMotivo && !String(v.motivo || '').trim())) return null;

    try {
      const r = await fetch('/flota-viva/api/incidencia/' + inc.id + '/justificar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gestion: g.codigo, motivo: v.motivo, resultado: v.resultado, accion: v.accion }),
      });
      const d = await r.json();
      if (d.status !== 'ok') throw new Error(d.msg || 'No se pudo guardar');

      // ALGUIEN SE ADELANTO. No es un error: es exactamente para lo que esta el
      // guardian del servidor. Se dice quien y que dijo, que es lo que hace
      // falta para no volver a marcar ese numero.
      if (d.yaEstaba) {
        const cuando = d.cuando
          ? new Date(d.cuando).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          : '';
        Dialogo.aviso({
          titulo: 'Ya la había cerrado ' + (d.por || 'otra persona'),
          html: '<p class="text-sm">' +
              (d.gestionEtiqueta ? '<b>' + esc(d.gestionEtiqueta) + '</b>' : 'Cerrada') +
              (cuando ? ' a las ' + esc(cuando) : '') +
              (d.por ? ' por ' + esc(d.por) : '') + '.</p>' +
            (d.motivo ? '<p class="text-sm mt-2 text-telecab-muted">' + esc(d.motivo) + '</p>' : '') +
            '<p class="text-sm mt-3 text-telecab-muted">No se ha guardado nada de lo tuyo y no se ha ' +
            'creado ninguna llamada: la suya es la que vale.</p>',
          tono: 'aviso',
        });
      } else if (d.ensayo) {
        // Modo prueba: se enseña la llamada que SE HABRÍA creado, para poder
        // comprobar la clasificación sin escribir en su libro.
        Dialogo.aviso({
          titulo: 'Prueba: no se ha escrito en el Call Center',
          html: '<p class="text-sm text-telecab-muted">Esta es la llamada que se habría registrado:</p>' +
            '<div class="mt-2 text-sm space-y-1">' +
            [['Conductor', d.ensayo.conductor], ['Matrícula', d.ensayo.matricula],
             ['Turno', d.ensayo.turno], ['Clasificación',
              d.ensayo.cluster + ' › ' + d.ensayo.subcluster + ' › ' + d.ensayo.motivo],
             ['Resultado', d.ensayo.resultado], ['Acción', d.ensayo.accion || '—'],
             ['Notas', d.ensayo.notas]]
              .map(([k, v2]) => '<div><span class="text-telecab-muted">' + esc(k) + ':</span> ' + esc(v2) + '</div>')
              .join('') + '</div>' +
            '<p class="text-sm mt-3 text-telecab-muted">Quita <b>FLOTA_VIVA_CC=off</b> para que se registre de verdad.</p>',
          tono: 'aviso', ancho: 'max-w-lg',
        });
      } else if (d.sinLlamada) {
        // Solo se avisa cuando SE ESPERABA una llamada y no salió. Ignorar sin
        // llamada es lo correcto y no dice nada.
        Dialogo.aviso({
          titulo: 'Guardada, pero sin llamada en el Call Center',
          html: '<p class="text-sm">' + esc(d.sinLlamada) + '</p>' +
                '<p class="text-sm mt-2 text-telecab-muted">La incidencia queda cerrada y en el parte. ' +
                'Si hacía falta la llamada, apúntala a mano en el Call Center.</p>',
          tono: 'aviso',
        });
      }
      return d;
    } catch (e) {
      Dialogo.aviso({ titulo: 'No se pudo guardar', texto: e.message, tono: 'error' });
      return null;
    }
  }

  return { cargar, lista: () => GESTIONES, botones, botonLlamar, enganchar, abrir };
})();
