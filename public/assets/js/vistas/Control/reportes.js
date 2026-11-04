// modules/Control/vistas/reportes.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  const $ = s => document.querySelector(s);

  // Hoy en la zona del navegador, 'YYYY-MM-DD'. A mediodía: sumar días nunca cae
  // en el día equivocado por el cambio de hora.
  const isoDia = off => {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + (off || 0));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  // Un control (select o fecha) solo cambia el ?param= del enlace de descarga.
  const sinc = (sel, a, param) => {
    const el = $(sel), link = $(a);
    const base = link.getAttribute('href').split('?')[0];
    const set = () => { link.href = el.value ? base + '?' + param + '=' + encodeURIComponent(el.value) : base; };
    el.addEventListener('change', set); set();
  };
  sinc('#r-turnos-dias', '#r-turnos', 'dias');
  $('#rt-dia').value = isoDia(0);
  sinc('#rt-dia', '#rt-excel', 'dia');
  $('#pl-dia').value = isoDia(0);
  sinc('#pl-dia', '#pl-excel', 'dia');
  // La semana: las opciones (y cuál va marcada) las pone el servidor en hora de Madrid.
  if ($('#js-semana')) sinc('#js-semana', '#js-excel', 'lunes');

  // El reporte del día baja DOS ficheros de un clic: el Excel de horas+KM y el PDF
  // del Sankey. Con un pequeño desfase, porque algunos navegadores frenan dos
  // descargas seguidas.
  const baja = url => {
    const a = document.createElement('a');
    a.href = url; a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
  };
  $('#r-horas').addEventListener('click', () => {
    const key = $('#r-horas-dia').value;
    baja('/control/reporte/excel?dia=' + encodeURIComponent(key));
    setTimeout(() => baja('/control/cascada/pdf?dia=' + encodeURIComponent(key)), 500);
  });
  // El Sankey sigue estando, aparte: a quien ya sabe leerlo le dice más que la
  // cascada, porque enseña los dos turnos a la vez y por dónde se va cada km.
  $('#r-sankey').addEventListener('click', () =>
    baja('/control/sankey/pdf?dia=' + encodeURIComponent($('#r-horas-dia').value)));

  // ── Asistencia ────────────────────────────────────────────────────────────
  // Las fechas por defecto las decide el SERVIDOR (día 1 del mes → ayer, en hora
  // de Madrid): calcularlas aquí saldría con el reloj del navegador, que no tiene
  // por qué ser el mismo, y a las 00:30 daría un mes distinto.
  const asSync = () => {
    const d = $('#as-desde').value, h = $('#as-hasta').value;
    const q = [];
    if (d) q.push('desde=' + encodeURIComponent(d));
    if (h) q.push('hasta=' + encodeURIComponent(h));
    const cola = q.length ? '?' + q.join('&') : '';
    $('#as-excel').href = '/control/asistencia/excel' + cola;
    $('#as-pdf').href = '/control/asistencia/pdf' + cola;
  };
  $('#as-desde').addEventListener('change', asSync);
  $('#as-hasta').addEventListener('change', asSync);
  fetch('/control/asistencia/periodo').then(r => r.json()).then(j => {
    if (j.status !== 'ok') return;
    $('#as-desde').value = j.desde;
    $('#as-hasta').value = j.hasta;
    asSync();
  }).catch(() => { /* sin fechas puestas, el enlace baja el periodo por defecto */ });
})();
