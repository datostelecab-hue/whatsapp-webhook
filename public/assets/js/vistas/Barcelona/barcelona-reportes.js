// modules/Barcelona/vistas/barcelona-reportes.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.

(function () {
  const DEL_SERVIDOR = Casa.datos();
  const $ = s => document.querySelector(s);
  const HOY = DEL_SERVIDOR.hoy;
  const aDdmm = iso => iso.split('-').reverse().join('/');
  const aIso = v => { const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  // Sumar días a mediodía UTC: nunca cae en el día equivocado por el cambio de hora.
  const sumar = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

  const poner = (d, h) => { $('#r-desde').value = aDdmm(d); $('#r-hasta').value = aDdmm(h); };
  const RAPIDO = {
    ayer: () => poner(sumar(HOY, -1), sumar(HOY, -1)),
    semana: () => poner(sumar(HOY, -7), sumar(HOY, -1)),
    mes: () => poner(HOY.slice(0, 8) + '01', HOY),
  };
  document.querySelectorAll('[data-rapido]').forEach(b => b.addEventListener('click', () => RAPIDO[b.dataset.rapido]()));
  RAPIDO.ayer();

  $('#r-excel').addEventListener('click', () => {
    const d = aIso($('#r-desde').value), h = aIso($('#r-hasta').value) || d;
    if (!d) return Dialogo.aviso({ titulo: 'Falta la fecha', texto: 'Elige desde qué día quieres el reporte.', tono: 'aviso' });
    descargar('#r-excel', `/barcelona/reporte/excel?desde=${d}&hasta=${h}`, 'Horas Barcelona.xlsx');
  });
  // LA SEMANA: se elige cualquier día en el calendario de la casa y vale su
  // semana, de lunes a domingo. Debajo se dice cuál es, para no equivocarse.
  const lunesDe = iso => sumar(iso, -((new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7));
  const corta = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  function pintarSemana() {
    const iso = aIso($('#s-dia').value);
    if (!iso) { $('#s-rango').textContent = 'Elige un día: el reporte sale de su semana.'; return; }
    const l = lunesDe(iso), d = sumar(l, 6);
    const estado = l > HOY ? ' · todavía no ha empezado' : d >= HOY ? ' · en curso: los días que faltan van en blanco' : '';
    $('#s-rango').textContent = `Semana del lunes ${corta(l)} al domingo ${corta(d)}${estado}.`;
  }
  $('#s-dia').addEventListener('change', pintarSemana);
  document.querySelectorAll('[data-semana]').forEach(b => b.addEventListener('click', () => {
    $('#s-dia').value = aDdmm(sumar(HOY, 7 * Number(b.dataset.semana)));
    pintarSemana();
  }));
  $('#s-dia').value = aDdmm(HOY);
  pintarSemana();

  $('#s-excel').addEventListener('click', () => {
    const iso = aIso($('#s-dia').value);
    if (!iso) return Dialogo.aviso({ titulo: 'Falta el día', texto: 'Elige un día de la semana que quieres.', tono: 'aviso' });
    descargar('#s-excel', '/barcelona/reporte-semanal/excel?lunes=' + lunesDe(iso), 'Horas semanales Barcelona.xlsx');
  });

  // Bajar un Excel: el botón dice que está preparándolo y, si falla, se explica por qué.
  async function descargar(selBoton, url, porDefecto) {
    const boton = $(selBoton);
    const antes = boton.innerHTML;
    boton.disabled = true;
    boton.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Preparando…';
    try {
      const r = await fetch(url);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.msg || 'No se pudo preparar el Excel.');
      }
      const nombre = (decodeURIComponent((r.headers.get('Content-Disposition') || '').split('filename="')[1] || '').replace(/"$/, '')) || porDefecto;
      const fichero = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement('a'), { href: fichero, download: nombre });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(fichero), 5000);
    } catch (e) {
      Dialogo.aviso({ titulo: 'No se pudo descargar', texto: e.message, tono: 'error' });
    } finally {
      boton.disabled = false;
      boton.innerHTML = antes;
    }
  }
})();
