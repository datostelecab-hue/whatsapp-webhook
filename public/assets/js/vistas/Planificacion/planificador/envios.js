// El planificador · envios — Enviar los turnos de un cuadrante por WhatsApp.
//
// Uno de los ficheros del planificador (FRO-4, 04/11/2026). Todos comparten el
// ámbito global de la página: el estado (T, ZONA, DIA…), los ayudantes ($, esc…)
// y el arranque están en ../planificadorV2.js, que se carga el ÚLTIMO. Aquí solo
// hay funciones y constantes que no ejecutan nada al cargar. Las sangrías son las
// de la IIFE de la que salieron, a propósito: hay plantillas de texto (mensajes)
// que las llevan dentro. Para escribir al servidor, fetchPlan, no fetch: es el
// que respeta el «solo lectura».


  // ── Enviar los turnos del CUADRANTE por WhatsApp (un botón por cuadrante) ──
  // Avisa a toda la gente colocada en esos coches que trabaja en la semana que se
  // está MIRANDO (en la actual, de hoy a 7 días); el detalle (coche, de quién
  // recibe y a quién entrega) lo sirve el bot cuando el conductor pulsa su
  // botón, y son sus turnos de ESE día a 7 días (28/09/2026). Reusa la
  // maquinaria de Cobertura: manda con ritmo para no pasarse de los límites de Meta.
  const lunesDeIso = iso => sumarDias(iso, -((new Date(iso + 'T00:00:00').getDay() + 6) % 7));
  async function enviarTurnosCuadrante(nombre, lista, btn) {
    const ids = [...new Set(lista.flatMap(c => (c.personas || []).filter(p => p && p.id).map(p => String(p.id))))];
    if (!ids.length) { await Dialogo.aviso({ titulo: 'Nadie colocado', texto: 'En estos coches no hay ningún conductor al que avisar.', tono: 'aviso' }); return; }
    const off = Math.round((new Date(T.lunes + 'T00:00:00') - new Date(lunesDeIso(hoyISO()) + 'T00:00:00')) / 6048e5);
    if (off < 0) { await Dialogo.aviso({ titulo: 'Semana pasada', texto: 'Estás mirando una semana que ya pasó: no tiene sentido avisar de esos turnos.', tono: 'aviso' }); return; }
    if (off > 8) { await Dialogo.aviso({ titulo: 'Demasiado lejos', texto: 'Solo se pueden avisar turnos hasta 8 semanas vista.', tono: 'aviso' }); return; }
    const sinTel = ids.filter(id => !((porId.get(id) || {}).telefono)).length;
    const ok = await Dialogo.confirmar({
      titulo: `Enviar turnos · ${nombre}`, tono: 'pregunta', si: 'Enviar', no: 'Cancelar',
      html: `<p class="text-sm">Se avisa por WhatsApp a la gente de ${lista.length === 1 ? 'este coche' : `estos ${lista.length} coches`} — ${ids.length} persona(s)${sinTel ? `, ${sinTel} sin teléfono` : ''} — de que tienen sus turnos listos. ${off === 0 ? 'Solo a quienes trabajan de hoy a 7 días.' : `Solo a quienes trabajan la semana del <b>${isoAes(T.fechas[0])}</b>.`}</p><p class="text-sm mt-2 text-telecab-muted">Al pulsar «Ver mis turnos», cada uno ve los suyos de ese día a 7 días: su coche, de quién lo recibe y a quién se lo entrega. A quien haya escrito a Telecab en las últimas 24 h le llegan sus turnos directamente en un texto, sin la plantilla (que Meta cobra); si cambiaron desde el último aviso, con «Cambios en tus turnos».</p>`,
    });
    if (!ok) return;
    const previo = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando…';
    try {
      const r = await fetchPlan('/cobertura/enviar-turnos-varios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // `cuadrante` va al registro: "William avisó al cuadrante X a tal hora".
        body: JSON.stringify({ ids, semana: off, cuadrante: nombre }),
      });
      const j = await r.json();
      if (j.status !== 'ok') throw new Error(j.msg || 'No se pudo iniciar el envío');
      seguirEnvio(btn, previo);
    } catch (e) {
      btn.disabled = false; btn.innerHTML = previo;
      await Dialogo.aviso({ titulo: 'No se pudo enviar', texto: e.message, tono: 'error' });
    }
  }

  // El progreso del envío, en el propio botón (el estado es el de Cobertura).
  async function seguirEnvio(btn, previo) {
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 3000));
      let p;
      try { p = ((await (await fetchPlan('/cobertura/enviar-turnos/estado')).json()).progreso) || {}; }
      catch (_) { continue; }
      if (p.activo) { btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${p.enviados}/${p.total}`; continue; }
      const extra = (p.errores ? ` · ${p.errores} err` : '') + (p.sinTel ? ` · ${p.sinTel} sin tel` : '');
      btn.innerHTML = `<i class="fa-solid fa-check"></i> ${p.enviados}/${p.total} enviados${extra}`;
      btn.disabled = false;
      cargarAvisosTurnos();   // el envío acaba de apuntarse: que el chip se ponga verde
      return;
    }
    btn.disabled = false; btn.innerHTML = previo;
  }

  // LOS DOS DÍAS PUEDEN SER DE SEMANAS DISTINTAS (Camilo, 28/10/2026; db/223).
  // Antes tenían que caer en la semana que se estaba mirando.
  async function libranzaExcepcional(persona) {
    const datos = await Dialogo.formulario(
      `Libranza excepcional · ${persona.nombre}`,
      [
        { id: 'trabaja', etiqueta: 'Trabaja el día (que normalmente libra)', tipo: 'fecha', obligatorio: true },
        { id: 'libra', etiqueta: 'Libra el día (que normalmente trabaja)', tipo: 'fecha', obligatorio: true,
          ayuda: 'Puede ser de otra semana' },
        { id: 'motivo', etiqueta: 'Motivo', tipo: 'texto' },
      ],
      { nota: 'Cambia un día de libranza por uno de trabajo, de la misma semana o de otra. Solo esos dos días: el resto sigue con su patrón.' }
    );
    if (!datos) return;
    // `formulario` ya devuelve las fechas en ISO (aaaa-mm-dd).
    const diaTrabaja = datos.trabaja, diaLibra = datos.libra;
    if (!diaTrabaja || !diaLibra) { alert('Faltan las fechas'); return; }
    if (diaTrabaja === diaLibra) { alert('El día que trabaja y el que libra no pueden ser el mismo'); return; }
    try {
      const r = await fetchPlan('/planificador-v2/api/libranza-excepcional', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conductorId: persona.id, diaTrabaja, diaLibra, motivo: datos.motivo, dia: DIA }),
      });
      const j = await r.json();
      if (!r.ok || j.status === 'error') throw new Error(j.msg || 'No se pudo guardar');
      if (j.tablero) aplicar(j.tablero);
    } catch (e) { alert(e.message); }
  }
