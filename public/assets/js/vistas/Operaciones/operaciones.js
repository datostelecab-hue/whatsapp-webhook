// modules/Operaciones/vistas/operaciones.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.

const DEL_SERVIDOR = Casa.datos();
const TIPOS = DEL_SERVIDOR.tipos;
const UMBRAL = DEL_SERVIDOR.umbral;
const $ = s => document.querySelector(s);
let ALERTAS = [], filtroTipo = '', textoBusqueda = '', truncado = false;

const badge = (txt, cls) =>
  `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}">${txt}</span>`;

const pad = n => String(n).padStart(2, '0');
const fmt = d => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();

// Chip de gravedad. El rojo es el que en su día disparará el aviso por WhatsApp.
function chipGravedad(a) {
  if (a.severidad === 'alta') return badge(`≥ ${UMBRAL} km/h`, 'bg-telecab-red/15 text-telecab-red');
  if (a.severidad === 'media') return badge('Exceso', 'bg-telecab-gold/15 text-telecab-gold');
  return badge('Leve', 'bg-telecab-muted/20 text-telecab-muted');
}

// El detalle depende del tipo: velocidad contra límite en los excesos, zona en
// las de geocerca, y para el resto el propio texto que manda Mapon.
function celdaDetalle(a) {
  if (a.tipo === 'speeding' && a.velocidad) {
    const cls = a.severidad === 'alta' ? 'text-telecab-red font-semibold'
              : a.severidad === 'media' ? 'text-telecab-gold font-semibold' : 'text-telecab-text';
    const exceso = a.exceso > 0 ? ` <span class="text-telecab-muted text-xs">(+${a.exceso})</span>` : '';
    return `<span class="${cls}">${a.velocidad} km/h</span>${exceso}` +
           (a.limite ? `<span class="text-telecab-muted text-xs"> · límite ${a.limite}</span>` : '');
  }
  if (a.tipo === 'in_object' && a.zona) {
    const dentro = String(a.sentido).toUpperCase() === 'IN';
    return `<span class="text-telecab-text">${a.zona}</span> ` +
           badge(dentro ? 'Entrada' : 'Salida', dentro ? 'bg-telecab-green/15 text-telecab-green' : 'bg-telecab-card2 text-telecab-muted');
  }
  return `<span class="text-telecab-muted">${a.msg || '—'}</span>`;
}

function pintarKpis() {
  const total = ALERTAS.length;
  const graves = ALERTAS.filter(a => a.severidad === 'alta').length;
  const vehiculos = new Set(ALERTAS.map(a => a.matricula)).size;
  const puntas = ALERTAS.map(a => a.velocidad).filter(Boolean);
  const maxima = puntas.length ? Math.max(...puntas) : 0;

  const kpi = (n, txt, cls) => `
    <div class="bg-telecab-card border border-telecab-border rounded-xl px-4 py-3">
      <div class="text-2xl font-bold ${cls}">${n}</div>
      <div class="text-xs text-telecab-muted mt-0.5">${txt}</div>
    </div>`;

  $('#o-kpis').innerHTML =
    kpi(total, 'Alertas en el rango', 'text-telecab-text') +
    kpi(graves, `Excesos ≥ ${UMBRAL} km/h`, graves ? 'text-telecab-red' : 'text-telecab-muted') +
    kpi(vehiculos, 'Vehículos implicados', 'text-telecab-gold') +
    kpi(maxima ? maxima + ' km/h' : '—', 'Velocidad máxima', maxima >= UMBRAL ? 'text-telecab-red' : 'text-telecab-text');
}

// Solo se ofrecen los tipos que de verdad han aparecido: filtrar por uno que no
// tiene eventos deja la tabla vacía sin explicar por qué.
function pintarFiltros() {
  const presentes = [...new Set(ALERTAS.map(a => a.tipo))];
  const opciones = [{ id: '', txt: `Todas (${ALERTAS.length})` }].concat(
    presentes.map(t => ({
      id: t,
      txt: `${(TIPOS[t] && TIPOS[t].titulo) || t} (${ALERTAS.filter(a => a.tipo === t).length})`
    }))
  );
  $('#o-filtros').innerHTML = opciones.map(o => {
    const on = filtroTipo === o.id;
    return `<button data-tipo="${o.id}"
      class="px-3 py-1.5 rounded-lg text-xs font-medium transition border
             ${on ? 'bg-telecab-gold text-telecab-dark border-telecab-gold'
                  : 'bg-telecab-card border-telecab-border text-telecab-muted hover:text-telecab-text'}">${o.txt}</button>`;
  }).join('');
  $('#o-filtros').querySelectorAll('button').forEach(b =>
    b.onclick = () => { filtroTipo = b.dataset.tipo; pintarFiltros(); pintar(); });
}

function pintar() {
  const t = textoBusqueda.toLowerCase();
  const lista = ALERTAS.filter(a => {
    if (filtroTipo && a.tipo !== filtroTipo) return false;
    if (t && !(`${a.matricula} ${a.vehiculo}`.toLowerCase().includes(t))) return false;
    return true;
  });

  $('#o-vacio').classList.toggle('hidden', lista.length > 0);
  $('#o-tbody').innerHTML = lista.map(a => `
    <tr class="hover:bg-telecab-card2/50 transition ${a.severidad === 'alta' ? 'bg-telecab-red/[0.04]' : ''}">
      <td class="px-4 py-3 font-semibold">${a.matricula}</td>
      <td class="px-4 py-3 text-telecab-muted">${a.vehiculo}</td>
      <td class="px-4 py-3">
        <i class="fa-solid ${a.icono} text-telecab-muted mr-1.5"></i>${a.tipoTitulo}
      </td>
      <td class="px-4 py-3 whitespace-nowrap">${a.fecha}</td>
      <td class="px-4 py-3 font-medium whitespace-nowrap">${a.hora}</td>
      <td class="px-4 py-3">${celdaDetalle(a)}</td>
      <td class="px-4 py-3">${chipGravedad(a)}</td>
    </tr>`).join('');
}

function aviso(texto, error) {
  const box = $('#o-aviso');
  if (!texto) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.className = `mb-5 rounded-xl border p-4 text-sm ${error
    ? 'border-telecab-red/40 bg-telecab-red/5 text-telecab-red'
    : 'border-telecab-gold/30 bg-telecab-gold/5 text-telecab-gold'}`;
  box.innerHTML = `<i class="fa-solid ${error ? 'fa-circle-exclamation' : 'fa-circle-info'} mr-2"></i>${texto}`;
}

async function cargar() {
  const p = new URLSearchParams();
  if ($('#o-desde').value.trim()) p.set('desde', $('#o-desde').value.trim());
  if ($('#o-hasta').value.trim()) p.set('hasta', $('#o-hasta').value.trim());

  try {
    const r = await fetch('/operaciones/api/alertas?' + p.toString());
    const d = await r.json();

    if (d.status !== 'ok') {
      aviso(d.msg || 'No se han podido leer las alertas', true);
      ALERTAS = []; truncado = false;
    } else {
      ALERTAS = d.alertas || [];
      truncado = !!d.truncado;
      aviso(truncado
        ? 'Hay más eventos de los que caben en una consulta: acorta el rango de fechas para verlos todos.'
        : '', false);
    }
  } catch (e) {
    aviso('Error de conexión con Mapon: ' + e.message, true);
    ALERTAS = []; truncado = false;
  }

  // El filtro se reinicia porque los tipos disponibles cambian con el rango.
  filtroTipo = '';
  $('#o-resumen').textContent = ALERTAS.length
    ? `${ALERTAS.length} eventos · ${$('#o-desde').value} → ${$('#o-hasta').value}`
    : 'Sin eventos en el rango seleccionado';
  pintarKpis(); pintarFiltros(); pintar();
}

// ---------- Arranque ----------
(function () {
  // Por defecto, la última semana: es el rango con el que Operaciones revisa.
  const hoy = new Date();
  const hace7 = new Date(); hace7.setDate(hace7.getDate() - 7);
  $('#o-desde').value = fmt(hace7);
  $('#o-hasta').value = fmt(hoy);

  $('#o-consultar').onclick = cargar;
  $('#o-buscar').oninput = e => { textoBusqueda = e.target.value; pintar(); };
  // Cambiar una fecha ya consulta: evita el doble paso de elegir y luego pulsar.
  ['#o-desde', '#o-hasta'].forEach(s => $(s).addEventListener('change', cargar));

  cargar();
})();
