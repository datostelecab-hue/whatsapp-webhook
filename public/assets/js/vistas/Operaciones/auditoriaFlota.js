// modules/Operaciones/vistas/auditoriaFlota.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

const $ = s => document.querySelector(s);
const esc = Casa.esc;
let DATA = { dias: [], km: [], eventos: [], ofensores: { fuera: [], repostaje: [] }, pendientes: [], segmentos: {}, etiquetas: {} };
let tab = 'km', filtroEv = '', busqueda = '', cargando = false, error = null, gen = 0, poll = null;
// Tramo que se está viendo: 'turnos' (los dos en paralelo), 'dia', 'noche' o 'completo'.
let segmento = 'turnos';
// La pestaña "Por conductor" tiene su propio tramo: mirar por persona pide
// separar los relevos (día / noche), y mirar por coche no.
let segCond = 'dia', condFilas = null, condCargando = false;
const SEGS_COND = [
  { id: 'dia', txt: 'Turno de día' },
  { id: 'noche', txt: 'Turno de noche' },
  { id: 'completo', txt: 'Día natural' }
];
const SEGS = [
  { id: 'turnos', txt: 'Turnos (día + noche)' },
  { id: 'dia', txt: 'Solo turno de día' },
  { id: 'noche', txt: 'Solo turno de noche' },
  { id: 'completo', txt: 'Día natural (00–24)' }
];

const pad = n => String(n).padStart(2, '0');
const fmt = d => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
const ddmm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const nkm = v => (v == null ? '' : Number(v).toLocaleString('es-ES', { maximumFractionDigits: 1 }));
// Los km buenos son los del odómetro del coche; unos pocos solo tienen la
// estimación del GPS, y eso hay que poder verlo de un vistazo en la tabla.
const marcaGps = k => (k.fuenteKm === 'gps' || k.fuenteKm === 'mixta'
  ? ` <span class="rounded px-1 py-[1px] text-[9px] font-bold bg-amber-500/15 text-amber-400" title="${k.fuenteKm === 'gps'
      ? 'KM POR GPS: el equipo de este coche no da el odómetro. Es la estimación de Mapon uniendo los puntos.'
      : 'KM POR GPS en parte del rango: algunos días este coche no dio odómetro.'}">GPS</span>`
  : '');

// Los KPI y los contadores siguen el filtro de matrícula: si no, junto a la fila de
// un solo coche se leían los totales de toda la flota como si fueran suyos.
const coincide = o => { const q = busqueda.trim().toLowerCase(); return !q || (`${o.matricula} ${o.vehiculo || ''}`).toLowerCase().includes(q); };
// Los KPI siguen el tramo elegido: en "Turnos" se suman día + noche.
const kmFiltrado = () => (segmento === 'turnos'
  ? [...(DATA.segmentos.dia || []), ...(DATA.segmentos.noche || [])]
  : filasSegmento()).filter(coincide);
const evFiltrado = () => DATA.eventos.filter(coincide);

/**
 * Tarjetas de cabecera. Los km se agrupan en DOS bloques que suman el total, para que
 * no quede kilometraje sin explicar:
 *   · TRABAJANDO EN BOLT = de viaje + de camino + en espera (los tres son trabajo:
 *     llevar al cliente, ir a por él y estar disponible esperando).
 *   · NO DISPONIBLE      = descanso (marcado ocupado) + app cerrada. Es el km "basura".
 * Cada tarjeta lleva debajo su desglose, que era justo lo que faltaba.
 */
function kpis() {
  const k = kmFiltrado();
  const t = f => Math.round(k.reduce((s, x) => s + (x[f] || 0), 0));
  const total = t('totalMapon');
  const viaje = t('totalPasajero'), camino = t('totalIda'), espera = t('totalEspera');
  const desc = t('totalDescanso'), cerrada = t('totalFuera');
  const enBolt = viaje + camino + espera, noDisp = desc + cerrada;
  const hDesc = Math.round(k.reduce((s, x) => s + (x.hDescanso || 0), 0));
  const hFuera = Math.round(k.reduce((s, x) => s + (x.hFuera || 0), 0));
  const n = v => v.toLocaleString('es-ES');
  const pc = v => total > 0 ? Math.round(v / total * 100) + '%' : '—';

  const kpi = (valor, titulo, detalle, cls) => `<div class="bg-telecab-card border border-telecab-border rounded-xl px-4 py-3">
    <div class="text-2xl font-bold ${cls}">${cargando ? '…' : valor}</div>
    <div class="text-xs text-telecab-text mt-0.5 font-medium">${titulo}</div>
    <div class="text-[11px] text-telecab-muted mt-0.5 leading-relaxed">${cargando ? '' : detalle}</div></div>`;

  $('#a-kpis').innerHTML =
    kpi(n(total) + ' km', 'KM totales (Mapon)',
      `${k.length} registro(s) · todo lo que rodó la flota`, 'text-telecab-text') +
    kpi(n(enBolt) + ' km', `Trabajando en BOLT · ${pc(enBolt)}`,
      `${n(viaje)} de viaje · ${n(camino)} de camino · ${n(espera)} en espera`, 'text-telecab-green') +
    kpi(n(noDisp) + ' km', `No disponible · ${pc(noDisp)}`,
      `${n(desc)} en descanso · ${n(cerrada)} con la app cerrada`, noDisp > 0 ? 'text-telecab-red' : 'text-telecab-muted') +
    kpi(n(hDesc + hFuera) + ' h', 'Horas sin estar disponible',
      `${n(hDesc)} h marcado ocupado · ${n(hFuera)} h con la app cerrada`, (hDesc + hFuera) > 0 ? 'text-amber-400' : 'text-telecab-muted');
  $('#a-kpi-filtro').classList.toggle('hidden', !busqueda.trim());
}

function barra(k) {
  const t = k.totalMapon || 1;
  const seg = (v, c) => v > 0 ? `<span class="${c}" style="width:${(v / t * 100).toFixed(1)}%"></span>` : '';
  return `<span class="flex h-2 rounded-full overflow-hidden bg-telecab-dark w-full" title="pasajero / ida / espera / descanso / fuera">
    ${seg(k.totalPasajero, 'bg-telecab-green')}${seg(k.totalIda, 'bg-telecab-gold')}${seg(k.totalEspera, 'bg-telecab-muted/50')}${seg(k.totalDescanso, 'bg-amber-500')}${seg(k.totalFuera, 'bg-telecab-red')}</span>`;
}

/** Filas del tramo elegido (para las vistas de un solo tramo). */
function filasSegmento() {
  if (segmento === 'turnos') return [];
  return (DATA.segmentos && DATA.segmentos[segmento]) || DATA.km || [];
}

function pintarSelector() {
  $('#a-segmentos').innerHTML = SEGS.map(s => {
    const on = segmento === s.id;
    return `<button data-seg="${s.id}" class="a-seg px-3 py-1.5 rounded-lg text-xs font-medium transition border
      ${on ? 'bg-telecab-gold text-telecab-dark border-telecab-gold' : 'bg-telecab-card border-telecab-border text-telecab-muted hover:text-telecab-text'}">${s.txt}</button>`;
  }).join('') + (DATA.etiquetas && DATA.etiquetas.dia
    ? `<span class="ml-2 self-center text-[11px] text-telecab-muted">${esc(DATA.etiquetas[segmento === 'turnos' ? 'dia' : segmento] || '')}${segmento === 'turnos' ? ' · ' + esc(DATA.etiquetas.noche) : ''}</span>` : '');
  document.querySelectorAll('.a-seg').forEach(b => b.onclick = () => { segmento = b.dataset.seg; pintarKm(); });
  // La tabla combinada y la de detalle se alternan según el tramo elegido.
  const esTurnos = segmento === 'turnos';
  const t1 = document.querySelector('[data-vista="turnos"]'), t2 = document.querySelector('[data-vista="detalle"]');
  if (t1) t1.classList.toggle('hidden', !esTurnos || cargando);
  if (t2) t2.classList.toggle('hidden', esTurnos || cargando);
}

function pintarKm() {
  pintarSelector();
  if (segmento === 'turnos') { pintarTurnos(); return; }
  const t = busqueda.toLowerCase();
  const filas = filasSegmento().filter(k => !t || (`${k.matricula} ${k.vehiculo}`).toLowerCase().includes(t));
  const vacio = !filas.length && !cargando && !error;
  $('#a-vacio-km').classList.toggle('hidden', !vacio);
  if (vacio) $('#a-vacio-km-txt').textContent = DATA.km.length ? 'Ninguna matrícula coincide con el filtro.' : 'Sin datos procesados en este rango.';
  $('#a-tbody-km').innerHTML = filas.map(k => {
    const cls = k.pctNoDisp >= 25 ? 'text-telecab-red font-bold' : k.pctNoDisp >= 10 ? 'text-telecab-gold font-semibold' : 'text-telecab-muted';
    const hd = k.hDescanso >= 4 ? 'text-telecab-red font-bold' : k.hDescanso >= 2 ? 'text-amber-400 font-semibold' : 'text-telecab-muted';
    return `<tr class="hover:bg-telecab-card2/50 transition ${k.pctNoDisp >= 25 ? 'bg-telecab-red/[0.04]' : ''}">
      <td class="px-4 py-2.5 font-semibold sticky left-0 bg-telecab-card whitespace-nowrap" title="${esc(k.vehiculo)}">${esc(k.matricula)}</td>
      <td class="px-3 py-2.5 text-right">${nkm(k.totalMapon)}${marcaGps(k)}</td>
      <td class="px-3 py-2.5 text-right text-telecab-green">${nkm(k.totalPasajero)}</td>
      <td class="px-3 py-2.5 text-right text-telecab-gold">${nkm(k.totalIda)}</td>
      <td class="px-3 py-2.5 text-right text-telecab-muted">${nkm(k.totalEspera)}</td>
      <td class="px-3 py-2.5 text-right ${k.totalDescanso > 0 ? 'text-amber-400' : 'text-telecab-muted'}">${nkm(k.totalDescanso)}</td>
      <td class="px-3 py-2.5 text-right ${k.totalFuera > 0 ? 'text-telecab-red' : 'text-telecab-muted'}">${nkm(k.totalFuera)}</td>
      <td class="px-3 py-2.5 text-right font-semibold ${k.totalNoDisp > 0 ? 'text-telecab-red' : 'text-telecab-muted'}">${nkm(k.totalNoDisp)}</td>
      <td class="px-3 py-2.5 text-right ${cls}">${k.pctNoDisp == null ? '' : k.pctNoDisp + '%'}</td>
      <td class="px-3 py-2.5 text-right ${hd}">${k.hDescanso ? nkm(k.hDescanso) + ' h' : ''}</td>
      <td class="px-3 py-2.5 text-xs text-telecab-muted">${conductoresTxt(k.conductores)}</td>
      <td class="px-3 py-2.5">${barra(k)}</td>
    </tr>`;
  }).join('');
}

// ── Por conductor ───────────────────────────────────────────────────────────
// Se pide aparte y solo cuando se abre la pestaña: es una consulta distinta y no
// tiene sentido pagarla cada vez que alguien mira los kilómetros por coche.
async function cargarConductores() {
  if (condCargando) return;
  condCargando = true;
  pintarCond();
  try {
    const q = new URLSearchParams(rango());
    q.set('tramo', segCond);
    const r = await fetch('/operaciones/api/auditoria/conductores?' + q.toString());
    const j = await r.json();
    if (j.status !== 'ok') throw new Error(j.msg || 'no se pudo cargar');
    condFilas = j.filas || [];
  } catch (e) {
    condFilas = [];
    aviso('Por conductor: ' + e.message);
  } finally {
    condCargando = false;
    pintarCond();
  }
}

function pintarCond() {
  $('#a-cond-seg').innerHTML = SEGS_COND.map(x => {
    const on = segCond === x.id;
    return `<button data-segc="${x.id}" class="a-segc px-2.5 py-1.5 rounded-lg border text-xs transition ${on
      ? 'bg-telecab-gold/15 border-telecab-gold/50 text-telecab-gold font-semibold'
      : 'bg-telecab-card border-telecab-border text-telecab-muted hover:text-telecab-text'}">${x.txt}</button>`;
  }).join('');
  document.querySelectorAll('.a-segc').forEach(b => b.onclick = () => {
    if (segCond === b.dataset.segc) return;
    segCond = b.dataset.segc; condFilas = null; cargarConductores();
  });

  const cuerpo = $('#a-tbody-cond'), vacio = $('#a-vacio-cond');
  if (condCargando) {
    $('#a-cond-cuenta').textContent = '';
    cuerpo.innerHTML = '<tr><td colspan="9" class="px-4 py-8 text-center text-telecab-muted">' +
      '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Cargando…</td></tr>';
    vacio.classList.add('hidden');
    return;
  }
  const filas = (condFilas || []).filter(f => {
    const q = busqueda.trim().toLowerCase();
    return !q || String(f.conductor || '').toLowerCase().includes(q);
  });
  $('#a-cond-cuenta').textContent = filas.length
    ? filas.length + (filas.length === 1 ? ' conductor' : ' conductores')
    : '';
  vacio.classList.toggle('hidden', filas.length > 0);
  if (!filas.length) { cuerpo.innerHTML = ''; return; }

  // La escala de la barra es el MAYOR de la lista: comparar entre personas es la
  // razón de esta pestaña, y una barra sobre el total de la flota no compara nada.
  const tope = Math.max(...filas.map(f => (f.km_descanso || 0) + (f.km_fuera || 0)), 1);

  cuerpo.innerHTML = filas.map(f => {
    const noDisp = (f.km_descanso || 0) + (f.km_fuera || 0);
    const porDia = f.dias ? noDisp / f.dias : 0;
    const grave = porDia >= 100, medio = porDia >= 50;
    const anchoD = Math.round((f.km_descanso || 0) / tope * 100);
    const anchoF = Math.round((f.km_fuera || 0) / tope * 100);
    return `<tr class="hover:bg-telecab-card2/50 transition ${grave ? 'bg-telecab-red/[0.04]' : ''}">
      <td class="px-4 py-2.5 sticky left-0 bg-telecab-card whitespace-nowrap">
        <span class="font-semibold">${esc(f.conductor)}</span>
        ${f.conductor_id
          ? `<a href="/plantilla?id=${f.conductor_id}" class="ml-1.5 text-telecab-muted hover:text-telecab-gold" title="Abrir su ficha"><i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i></a>`
          : '<span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-telecab-card2 text-telecab-muted" title="Su cuenta de BOLT no está enlazada con ninguna ficha">sin ficha</span>'}
      </td>
      <td class="px-3 py-2.5 text-center tabular-nums text-telecab-muted">${f.dias}</td>
      <td class="px-3 py-2.5 text-center tabular-nums text-telecab-muted">${f.coches}</td>
      <td class="px-3 py-2.5 text-right tabular-nums ${f.km_descanso > 0 ? 'text-amber-400' : 'text-telecab-muted'}">${nkm(f.km_descanso)}</td>
      <td class="px-3 py-2.5 text-right tabular-nums ${f.km_fuera > 0 ? 'text-telecab-red' : 'text-telecab-muted'}">${nkm(f.km_fuera)}</td>
      <td class="px-3 py-2.5 text-right tabular-nums font-bold text-telecab-red">${nkm(noDisp)}</td>
      <td class="px-3 py-2.5 text-right tabular-nums ${grave ? 'text-telecab-red font-bold' : medio ? 'text-telecab-gold font-semibold' : 'text-telecab-muted'}">${nkm(porDia)}</td>
      <td class="px-3 py-2.5 text-right tabular-nums ${(f.h_descanso || 0) >= 4 ? 'text-telecab-red font-semibold' : 'text-telecab-muted'}">${f.h_descanso ? nkm(f.h_descanso) + ' h' : ''}</td>
      <td class="px-3 py-2.5">
        <div class="h-2 rounded-full bg-telecab-dark overflow-hidden flex" title="Ámbar: marcado ocupado · Rojo: app cerrada">
          <div class="h-full bg-amber-400" style="width:${anchoD}%"></div>
          <div class="h-full bg-telecab-red" style="width:${anchoF}%"></div>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// Quién usó el coche según BOLT en ese tramo (no según el planificador).
function conductoresTxt(lista) {
  const c = lista || [];
  if (!c.length) return '<span class="text-telecab-muted/40">sin conductor en BOLT</span>';
  const txt = c.map(esc).join(' · ');
  return c.length > 2
    ? `<span title="${esc(c.join(' · '))}">${esc(c[0])} +${c.length - 1}</span>`
    : txt;
}

// ── Tabla combinada de los dos turnos ──
function pintarTurnos() {
  const t = busqueda.trim().toLowerCase();
  const dia = new Map((DATA.segmentos.dia || []).map(k => [k.placa, k]));
  const noche = new Map((DATA.segmentos.noche || []).map(k => [k.placa, k]));
  const placas = [...new Set([...dia.keys(), ...noche.keys()])]
    .map(p => ({ p, d: dia.get(p), n: noche.get(p) }))
    .filter(x => { const m = (x.d || x.n).matricula || ''; return !t || m.toLowerCase().includes(t); })
    .map(x => ({ ...x, noDisp: ((x.d && x.d.totalNoDisp) || 0) + ((x.n && x.n.totalNoDisp) || 0) }))
    .sort((a, b) => b.noDisp - a.noDisp);

  const vacio = !placas.length && !cargando && !error;
  $('#a-vacio-turnos').classList.toggle('hidden', !vacio);

  const celdas = k => {
    if (!k) return `<td class="px-3 py-2.5 text-right text-telecab-muted/30">·</td>
      <td class="px-3 py-2.5 text-right text-telecab-muted/30">·</td>
      <td class="px-3 py-2.5 text-right text-telecab-muted/30">·</td>
      <td class="px-3 py-2.5 text-xs text-telecab-muted/40">—</td>`;
    const cls = k.pctNoDisp >= 25 ? 'text-telecab-red font-bold' : k.pctNoDisp >= 10 ? 'text-telecab-gold font-semibold' : 'text-telecab-muted';
    return `<td class="px-3 py-2.5 text-right border-l border-telecab-border/40">${nkm(k.totalMapon)}</td>
      <td class="px-3 py-2.5 text-right ${k.totalNoDisp > 0 ? 'text-telecab-red font-semibold' : 'text-telecab-muted'}">${nkm(k.totalNoDisp)}</td>
      <td class="px-3 py-2.5 text-right ${cls}">${k.pctNoDisp == null ? '' : k.pctNoDisp + '%'}</td>
      <td class="px-3 py-2.5 text-xs text-telecab-muted">${conductoresTxt(k.conductores)}</td>`;
  };

  $('#a-tbody-turnos').innerHTML = placas.map(x => {
    const mat = (x.d || x.n).matricula;
    const totKm = ((x.d && x.d.totalMapon) || 0) + ((x.n && x.n.totalMapon) || 0);
    return `<tr class="hover:bg-telecab-card2/50 transition ${x.noDisp > 0 ? 'bg-telecab-red/[0.03]' : ''}">
      <td class="px-4 py-2.5 font-semibold sticky left-0 bg-telecab-card whitespace-nowrap">${esc(mat)}</td>
      ${celdas(x.d)}${celdas(x.n)}
      <td class="px-3 py-2.5 text-right font-semibold border-l border-telecab-border/40">${nkm(round1(totKm))}</td>
      <td class="px-3 py-2.5 text-right font-bold ${x.noDisp > 0 ? 'text-telecab-red' : 'text-telecab-muted'}">${nkm(round1(x.noDisp))}</td>
    </tr>`;
  }).join('');
}
const round1 = v => Math.round(v * 10) / 10;

function filtrosEv() {
  const base = evFiltrado();
  const n = tp => base.filter(e => !tp || e.tipo === tp).length;
  $('#a-filtros-ev').innerHTML = [{ id: '', txt: `Todos (${n('')})` }, { id: 'repostaje', txt: `Repostajes (${n('repostaje')})` }, { id: 'caida', txt: `Caídas (${n('caida')})` }]
    .map(o => { const on = filtroEv === o.id;
      return `<button data-f="${o.id}" class="px-3 py-1.5 rounded-lg text-xs font-medium transition border
        ${on ? 'bg-telecab-gold text-telecab-dark border-telecab-gold' : 'bg-telecab-card border-telecab-border text-telecab-muted hover:text-telecab-text'}">${o.txt}</button>`; }).join('');
  $('#a-filtros-ev').querySelectorAll('button').forEach(b => b.onclick = () => { filtroEv = b.dataset.f; filtrosEv(); pintarEv(); });
}
function pintarEv() {
  const t = busqueda.toLowerCase();
  const lista = DATA.eventos.filter(e => (!filtroEv || e.tipo === filtroEv) && (!t || (`${e.matricula} ${e.vehiculo}`).toLowerCase().includes(t)));
  const vacio = !lista.length && !cargando && !error;
  $('#a-vacio-ev').classList.toggle('hidden', !vacio);
  if (vacio) $('#a-vacio-ev-txt').textContent = DATA.eventos.length ? 'Ningún evento coincide con el filtro.' : 'Sin eventos de combustible en este rango.';
  $('#a-tbody-ev').innerHTML = lista.map(e => {
    const esRep = e.tipo === 'repostaje';
    const lugar = e.direccion ? esc(e.direccion) : (e.lat != null ? `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}` : '—');
    const mapa = e.lat != null ? ` <a href="https://maps.google.com/?q=${e.lat},${e.lng}" target="_blank" rel="noopener" class="text-telecab-gold hover:underline text-xs" aria-label="Ver en el mapa"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i></a>` : '';
    return `<tr class="hover:bg-telecab-card2/50 transition ${esRep ? '' : 'bg-telecab-red/[0.04]'}">
      <td class="px-4 py-3 whitespace-nowrap">${ddmm(e.dia)}</td>
      <td class="px-4 py-3 font-medium whitespace-nowrap">${esc(e.hora)}</td>
      <td class="px-4 py-3 font-semibold">${esc(e.matricula)}</td>
      <td class="px-4 py-3"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${esRep ? 'bg-telecab-green/15 text-telecab-green' : 'bg-telecab-red/15 text-telecab-red'}">${esRep ? 'Repostaje' : 'Caída'}</span></td>
      <td class="px-4 py-3 text-right font-semibold ${esRep ? 'text-telecab-green' : 'text-telecab-red'}">${esRep ? '+' : ''}${nkm(e.litros)} l</td>
      <td class="px-4 py-3 text-right text-telecab-muted">${e.nivelAntes != null ? nkm(e.nivelAntes) + ' l' : '—'}</td>
      <td class="px-4 py-3 text-telecab-muted">${lugar}${mapa}</td>
    </tr>`;
  }).join('');
}

function pintarTop() {
  const fila = (izq, der, sub, cls) => `<div class="flex items-center gap-3 px-4 py-3">
    <span class="min-w-0 flex-1"><span class="block font-semibold text-telecab-text">${esc(izq)}</span><span class="block text-xs text-telecab-muted">${sub}</span></span>
    <span class="text-right font-bold whitespace-nowrap ${cls || 'text-telecab-text'}">${der}</span></div>`;
  const f = DATA.ofensores.fuera;
  $('#a-top-fuera').innerHTML = f.length ? f.map(o => fila(o.matricula, `${nkm(o.noDisp)} km`,
      `${o.pct == null ? '' : o.pct + '% de sus ' + nkm(o.mapon) + ' km'} · ${nkm(o.descanso)} descanso + ${nkm(o.fuera)} cerrada`, 'text-telecab-red')).join('')
    : '<p class="p-4 text-sm text-telecab-green"><i class="fa-solid fa-circle-check mr-1"></i> Nadie rodó estando no disponible.</p>';
  const d = DATA.ofensores.descanso || [];
  $('#a-top-desc').innerHTML = d.length ? d.map(o => fila(o.matricula, `${nkm(o.horas)} h`,
      `marcado «En descanso»${o.km ? ' · rodó ' + nkm(o.km) + ' km' : ' · sin rodar'}`, 'text-amber-400')).join('')
    : '<p class="p-4 text-sm text-telecab-muted">Nadie se marcó en descanso.</p>';
  const r = DATA.ofensores.repostaje;
  $('#a-top-rep').innerHTML = r.length ? r.map(o => fila(o.matricula, `${nkm(o.litros)} l`, `${o.veces} repostaje${o.veces === 1 ? '' : 's'}`)).join('')
    : '<p class="p-4 text-sm text-telecab-muted">Sin repostajes.</p>';
}

function pintarPendientes() {
  const p = DATA.pendientes || [];
  $('#a-pendientes').classList.toggle('hidden', !p.length || cargando);
  if (p.length) $('#a-pend-txt').innerHTML = `<b>${p.length} día(s) sin procesar</b> en este rango: ${p.map(ddmm).join(', ')}. Los datos mostrados no los incluyen.`;
}

// ════════ Flujo de KM (Sankey en SVG, sin librerías) ════════
// Estructura fija: TOTAL → {día, noche} → {pasajero, ida, espera, descanso, fuera}.
// El ancho de cada cinta es proporcional a los km, así que de un vistazo se ve cuánto
// del total se va en cada estado y qué turno aporta más km no disponibles.
const BUCKETS = [
  { id: 'totalPasajero', txt: 'Con pasajero', color: 'var(--tc-green)' },
  { id: 'totalIda', txt: 'Ida a recoger', color: 'var(--tc-gold)' },
  { id: 'totalEspera', txt: 'Espera (disponible)', color: 'var(--tc-muted)' },
  { id: 'totalDescanso', txt: 'Descanso (ocupado)', color: '245 158 11' },
  { id: 'totalFuera', txt: 'Fuera (app cerrada)', color: 'var(--tc-red)' }
];
// Los colores se guardan como 'var(--tc-green)' o como triplete '245 158 11'; en ambos
// casos `rgb(...)` los acepta, así el gráfico sigue el tema claro/oscuro sin tocar nada.

/** Suma los totales de un tramo (aplicando el filtro de matrícula). */
function totalesDe(lista) {
  const a = { totalMapon: 0, coches: 0 };
  BUCKETS.forEach(b => a[b.id] = 0);
  (lista || []).filter(coincide).forEach(k => {
    a.totalMapon += k.totalMapon || 0; a.coches++;
    BUCKETS.forEach(b => a[b.id] += k[b.id] || 0);
  });
  return a;
}

/**
 * Dibuja un Sankey. `tramos` son los dos nodos del medio (turnos, o mitades del día);
 * el gráfico es el mismo, solo cambia por dónde se parte el tiempo.
 */
function pintarFlujo(cfg) {
  const { destino, tramos: defTramos, kpis: idKpis, rango: idRango, vacio: idVacio } = cfg;
  const tot = defTramos.map(t => ({ ...t, tot: totalesDe(DATA.segmentos[t.seg]) }));
  const total = tot.reduce((s, t) => s + t.tot.totalMapon, 0);
  const nCoches = new Set(defTramos.flatMap(t => DATA.segmentos[t.seg] || [])
    .filter(coincide).map(k => k.placa)).size;
  $(idRango).innerHTML = `${esc($('#a-desde').value)} → ${esc($('#a-hasta').value)}` +
    ` · <b>${nCoches}</b> matrículas con actividad en BOLT`;
  const vacio = !(total > 0) && !cargando;
  $(idVacio).classList.toggle('hidden', !vacio);
  $(destino).innerHTML = '';
  if (!(total > 0)) { if (idKpis) $(idKpis).innerHTML = ''; return; }

  const dia = tot[0].tot, noche = tot[1] ? tot[1].tot : totalesDe([]);
  const W = 940, H = 440, M = 24, NW = 15, GAP = 16;
  const X = [M, W / 2 - NW / 2, W - M - NW];
  const turnos = tot.filter(t => t.tot.totalMapon > 0);

  // Una sola escala para las tres columnas: la manda la más apretada (la de 5 nodos).
  const alto = H - M * 2;
  const esc0 = alto / total;
  const esc1 = (alto - GAP * (turnos.length - 1)) / total;
  const esc2 = (alto - GAP * (BUCKETS.length - 1)) / total;
  const E = Math.min(esc0, esc1, esc2);

  const apilar = (items, valor) => {   // centra la columna verticalmente
    const altoCol = items.reduce((s, i) => s + valor(i) * E, 0) + GAP * (items.length - 1);
    let y = M + (alto - altoCol) / 2;
    return items.map(i => { const h = valor(i) * E; const n = { item: i, y, h }; y += h + GAP; return n; });
  };

  // Cada bucket suma lo de TODOS los tramos (no solo dos), para que el gráfico valga
  // igual con turnos que con mitades del día.
  const sumaBucket = id => turnos.reduce((s, t) => s + (t.tot[id] || 0), 0);
  const nTotal = [{ item: null, y: M + (alto - total * E) / 2, h: total * E }];
  const nTurnos = apilar(turnos, t => t.tot.totalMapon);
  const nBuckets = apilar(BUCKETS.filter(b => sumaBucket(b.id) > 0), b => sumaBucket(b.id));

  // Cinta de enlace: dos curvas cúbicas que unen los bordes de origen y destino.
  const cinta = (x1, y1, x2, y2, h1, h2) => {
    const xm = (x1 + x2) / 2;
    return `M${x1},${y1} C${xm},${y1} ${xm},${y2} ${x2},${y2} L${x2},${y2 + h2} C${xm},${y2 + h2} ${xm},${y1 + h1} ${x1},${y1 + h1} Z`;
  };

  const partes = [];
  // Nivel 0 → 1
  let yT = nTotal[0].y;
  const cursorTurno = new Map();
  nTurnos.forEach(nt => {
    const h = nt.h;
    partes.push(`<path d="${cinta(X[0] + NW, yT, X[1], nt.y, h, h)}" fill="rgb(${nt.item.color})" opacity=".28"><title>${esc(nt.item.txt)}: ${nkm(round1(h / E))} km</title></path>`);
    yT += h;
    cursorTurno.set(nt.item.id, nt.y);
  });
  // Nivel 1 → 2 (cada bucket recibe primero lo del día y luego lo de la noche)
  const cursorBucket = new Map(nBuckets.map(nb => [nb.item.id, nb.y]));
  nTurnos.forEach(nt => {
    let y1 = cursorTurno.get(nt.item.id);
    nBuckets.forEach(nb => {
      const v = nt.item.tot[nb.item.id] || 0;
      if (v <= 0) return;
      const h = v * E;
      const y2 = cursorBucket.get(nb.item.id);
      partes.push(`<path d="${cinta(X[1] + NW, y1, X[2], y2, h, h)}" fill="rgb(${nb.item.color})" opacity=".38"><title>${esc(nt.item.txt)} → ${esc(nb.item.txt)}: ${nkm(round1(v))} km</title></path>`);
      y1 += h; cursorBucket.set(nb.item.id, y2 + h);
    });
  });

  // Nodos y etiquetas
  const nodo = (x, y, h, color, anclaje, texto, sub) => {
    const tx = anclaje === 'start' ? x + NW + 8 : x - 8;
    return `<rect x="${x}" y="${y}" width="${NW}" height="${Math.max(h, 1)}" rx="3" fill="rgb(${color})" opacity=".9"/>
      <text x="${tx}" y="${y + h / 2 - 2}" text-anchor="${anclaje}" fill="rgb(var(--tc-text))" font-size="12" font-weight="600">${texto}</text>
      <text x="${tx}" y="${y + h / 2 + 13}" text-anchor="${anclaje}" fill="rgb(var(--tc-muted))" font-size="11">${sub}</text>`;
  };
  const pc = v => total > 0 ? Math.round(v / total * 100) + '%' : '';
  partes.push(nodo(X[0], nTotal[0].y, nTotal[0].h, 'var(--tc-text)', 'start', 'KM totales', `${nkm(round1(total))} km`));
  nTurnos.forEach(nt => partes.push(nodo(X[1], nt.y, nt.h, nt.item.color, 'start', nt.item.txt, `${nkm(round1(nt.item.tot.totalMapon))} km · ${pc(nt.item.tot.totalMapon)}`)));
  nBuckets.forEach(nb => {
    const v = sumaBucket(nb.item.id);
    partes.push(nodo(X[2], nb.y, nb.h, nb.item.color, 'end', nb.item.txt, `${nkm(round1(v))} km · ${pc(v)}`));
  });

  $(destino).innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-height:460px">${partes.join('')}</svg>`;
  if (!idKpis) return;

  // Mismas categorías que las tarjetas de arriba, para que no se contradigan:
  // trabajando en BOLT (viaje + camino + espera) frente a no disponible (descanso + cerrada).
  const s = sumaBucket;
  const viaje = s('totalPasajero'), camino = s('totalIda'), espera = s('totalEspera');
  const desc = s('totalDescanso'), cerrada = s('totalFuera');
  const enBolt = viaje + camino + espera, noDisp = desc + cerrada;
  const tarjeta = (t, v, sub, cls) => `<div class="bg-telecab-card border border-telecab-border rounded-xl px-4 py-3">
    <div class="text-xs text-telecab-text font-medium">${t}</div>
    <div class="text-2xl font-bold ${cls}">${v}</div>
    <div class="text-[11px] text-telecab-muted mt-0.5">${sub}</div></div>`;
  $(idKpis).innerHTML =
    tarjeta('Trabajando en BOLT', `${pc(enBolt)} · ${nkm(round1(enBolt))} km`,
      `${nkm(round1(viaje))} de viaje · ${nkm(round1(camino))} de camino · ${nkm(round1(espera))} en espera`, 'text-telecab-green') +
    tarjeta('No disponible', `${pc(noDisp)} · ${nkm(round1(noDisp))} km`,
      `${nkm(round1(desc))} en descanso · ${nkm(round1(cerrada))} con la app cerrada`, noDisp > 0 ? 'text-telecab-red' : 'text-telecab-muted');
}

/** Los dos flujos: por turno (05–17 / 17–05) y por día natural partido a mediodía. */
function pintarFlujos() {
  pintarFlujo({
    destino: '#a-sankey', kpis: '#a-flujo-kpis', rango: '#a-flujo-rango', vacio: '#a-flujo-vacio',
    tramos: [
      { seg: 'dia', id: 'dia', txt: 'Turno de día', color: 'var(--tc-gold)' },
      { seg: 'noche', id: 'noche', txt: 'Turno de noche', color: '96 165 250' }
    ]
  });
  pintarFlujo({
    destino: '#a-sankey2', kpis: null, rango: '#a-flujo2-rango', vacio: '#a-flujo2-vacio',
    tramos: [
      { seg: 'manana', id: 'manana', txt: '00:00 – 12:00', color: 'var(--tc-gold)' },
      { seg: 'tarde', id: 'tarde', txt: '12:00 – 24:00', color: '96 165 250' }
    ]
  });
}

function pintarTodo() { kpis(); pintarKm(); filtrosEv(); pintarEv(); pintarTop(); pintarFlujos(); pintarPendientes(); }

function activarTab(t) {
  tab = t;
  document.querySelectorAll('.a-tab').forEach(b => {
    const on = b.dataset.tab === t;
    b.className = 'a-tab px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition ' +
      (on ? 'text-telecab-gold border-telecab-gold' : 'text-telecab-muted border-transparent hover:text-telecab-text');
  });
  document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== t || cargando));
  if (t === 'km' && !cargando) pintarSelector();   // alterna tabla combinada / detalle
  // Se pide al abrirla, no al cargar la página: es otra consulta.
  if (t === 'cond' && !cargando) { if (condFilas === null) cargarConductores(); else pintarCond(); }
}
function aviso(t) { const b = $('#a-aviso'); if (!t) { b.classList.add('hidden'); return; } b.classList.remove('hidden'); b.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-2"></i>${esc(t)}`; }
function rango() {
  const p = new URLSearchParams();
  if ($('#a-desde').value.trim()) p.set('desde', $('#a-desde').value.trim());
  if ($('#a-hasta').value.trim()) p.set('hasta', $('#a-hasta').value.trim());
  return p.toString();
}

async function cargar() {
  const mine = ++gen;
  error = null; aviso('');
  const q = rango();
  // Las descargas se arman al pulsar (usan el rango vigente), no hace falta href aquí.
  $('#a-resumen').textContent = `${$('#a-desde').value} → ${$('#a-hasta').value}`;
  $('#a-consultar').disabled = true;
  cargando = true; $('#a-cargando').classList.remove('hidden');
  document.querySelectorAll('[data-panel]').forEach(p => p.classList.add('hidden'));
  $('#a-pendientes').classList.add('hidden');
  kpis();
  try {
    const d = await (await fetch('/operaciones/api/auditoria?' + q)).json();
    if (mine !== gen) return;
    if (d.status !== 'ok') throw new Error(d.msg || 'error');
    DATA = { dias: d.dias || [], km: d.km || [], eventos: d.eventos || [], ofensores: d.ofensores || { fuera: [], repostaje: [] },
      pendientes: d.pendientes || [], segmentos: d.segmentos || {}, etiquetas: d.etiquetas || {},
      matriculasBolt: d.matriculasBolt || 0 };
    $('#a-pie').textContent = `${DATA.km.length} matrículas · ${DATA.dias.length} días · datos del histórico (los procesa el cron a las 5:00).`;
  } catch (e) {
    if (mine !== gen) return;
    error = e.message; aviso('No se pudo cargar: ' + e.message);
    DATA = { dias: [], km: [], eventos: [], ofensores: { fuera: [], repostaje: [] }, pendientes: [], segmentos: {}, etiquetas: {} };
  } finally {
    if (mine === gen) { cargando = false; $('#a-cargando').classList.add('hidden'); $('#a-consultar').disabled = false; pintarTodo(); activarTab(tab); }
  }
}

// ── Procesado manual (backfill) ──
function arrancarPoll() { if (!poll) poll = setInterval(sondearProgreso, 3000); }

async function sondearProgreso() {
  try {
    const d = await (await fetch('/operaciones/auditoria/procesar/estado')).json();
    const p = d.progreso || {};
    if (p.activo) {
      $('#a-progreso').classList.remove('hidden');
      $('#a-prog-txt').textContent = `Procesando ${p.dia || ''}… ${p.hechos}/${p.total} días`;
      $('#a-prog-bar').style.width = (p.total ? (p.hechos / p.total * 100) : 0) + '%';
      arrancarPoll();   // si el backfill lo lanzó otra pestaña, esta también sigue el progreso
    } else {
      $('#a-progreso').classList.add('hidden');
      if (poll) { clearInterval(poll); poll = null; if (p.error) aviso('Procesado: ' + p.error); cargar(); }
    }
  } catch (_) {}
}
$('#a-procesar').onclick = async () => {
  const p = DATA.pendientes || []; if (!p.length) return;
  if (!(await Dialogo.confirmar({
    titulo: `Procesar ${p.length} día${p.length === 1 ? '' : 's'}`, si: 'Procesar', no: 'Cancelar',
    texto: 'Es pesado: consulta el recorrido de cada coche en Mapon.',
  }))) return;
  $('#a-procesar').disabled = true;
  try {
    // Se manda la LISTA exacta de días pendientes: mandando solo los extremos se
    // reprocesaban también los días de en medio que ya estaban bien.
    const r = await (await fetch('/operaciones/auditoria/procesar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dias: p }) })).json();
    if (r.status !== 'ok') throw new Error(r.msg);
    $('#a-progreso').classList.remove('hidden');
    arrancarPoll();
  } catch (e) { aviso('No se pudo iniciar: ' + e.message); }
  $('#a-procesar').disabled = false;
};

(function () {
  const hoy = new Date(); const hace7 = new Date(); hace7.setDate(hace7.getDate() - 7);
  $('#a-desde').value = fmt(hace7); $('#a-hasta').value = fmt(hoy);
  document.querySelectorAll('.a-tab').forEach(b => b.onclick = () => activarTab(b.dataset.tab));
  activarTab('km');

  // ── Descargas: cada tabla su Excel, cada gráfico su PDF ──
  // Se navega a la URL en el momento de pulsar para que lleve SIEMPRE el rango vigente.
  const descargar = url => { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };
  const menu = $('#a-desc-menu');
  $('#a-desc-btn').onclick = e => { e.stopPropagation(); menu.classList.toggle('hidden'); };
  document.addEventListener('click', () => menu.classList.add('hidden'));
  menu.addEventListener('click', e => e.stopPropagation());
  document.querySelectorAll('.a-dl').forEach(a => a.onclick = () => {
    descargar(`/operaciones/auditoria/excel?${rango()}&tabla=${encodeURIComponent(a.dataset.x)}`);
    menu.classList.add('hidden');
  });
  document.querySelectorAll('.a-dlp').forEach(a => a.onclick = () => {
    descargar(`/operaciones/auditoria/pdf?${rango()}&flujo=${encodeURIComponent(a.dataset.p)}`);
    menu.classList.add('hidden');
  });
  $('#a-consultar').onclick = cargar;
  $('#a-buscar').oninput = e => { busqueda = e.target.value; kpis(); pintarKm(); filtrosEv(); pintarEv(); pintarFlujos(); };
  ['#a-desde', '#a-hasta'].forEach(s => $(s).addEventListener('change', cargar));
  cargar(); sondearProgreso();
})();
