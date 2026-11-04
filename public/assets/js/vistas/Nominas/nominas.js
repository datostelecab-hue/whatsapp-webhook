// modules/Nominas/vistas/nominas.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026). Lo que le deja el servidor llega por Casa.datos(), del bloque
// <script type="application/json" id="datos-servidor"> de la vista.

const CFG = Casa.datos();
const $ = s => document.querySelector(s);
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const esc = Casa.esc;
const eur = n => (Number(n)||0).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' €';
let RESULTADO = null, FUENTE = '', cargando = false;

// ── Selectores de mes/año ──
MESES.forEach((m,i)=>{ const o=document.createElement('option'); o.value=i+1; o.textContent=m; if(i+1===CFG.mesActual)o.selected=true; $('#mes').appendChild(o); });
$('#ano').value = CFG.anoActual;
const mes = () => parseInt($('#mes').value,10);
const ano = () => parseInt($('#ano').value,10);

// ── Config ──
$('#cfg-toggle').addEventListener('click', () => { $('#cfg-body').classList.toggle('hidden'); $('#cfg-chev').classList.toggle('rotate-180'); });
function pintarConfig(cfg) {
  $('#cfg-grid').innerHTML = CFG.campos.map(c => `
    <label class="block">
      <span class="text-xs text-telecab-muted">${c.usado?'<span class="text-telecab-gold">●</span> ':''}${esc(c.label)}</span>
      <input data-key="${c.key}" type="number" step="0.01" value="${cfg[c.key]}"
        class="cfg-in mt-1 w-full px-3 py-2 rounded-lg bg-telecab-card2 border border-telecab-border text-telecab-text">
    </label>`).join('');
}
const recogerConfig = () => { const o={}; document.querySelectorAll('.cfg-in').forEach(i=>o[i.dataset.key]=parseFloat(i.value)); return o; };
// Todo por Api (public/assets/js/api.js, 03/11/2026): un fallo de red o la
// sesión caducada llegan como un error con su mensaje, y no como un
// «Unexpected token <» o un «Congelando…» que no termina nunca.
async function cargarConfig() {
  try { pintarConfig((await Api.get('/nominas/config')).config); }
  catch (e) { $('#cfg-grid').innerHTML = `<p class="text-sm text-telecab-red">No se pudo leer la configuración: ${esc(e.message)}</p>`; }
}
$('#btn-guardar-cfg').addEventListener('click', async e => {
  try {
    const r = await Api.post('/nominas/config', { config: recogerConfig() }, { boton: e.currentTarget });
    pintarConfig(r.config); msg('Config guardada. Vuelve a recalcular el mes para verla aplicada.');
  } catch (err) { msg('No se pudo guardar la config: ' + err.message, true); }
});

// ── Cargar el mes ──
// Si está congelado sale lo congelado; si no, se calcula al vuelo. Una nómina
// congelada NO se recalcula: es lo que se pagó.
async function cargar() {
  if (cargando) return;
  cargando = true;
  RESULTADO = null; $('#tabla-wrap').classList.add('hidden'); $('#btn-congelar').disabled = true;
  $('#btn-descargar').classList.add('hidden'); $('#fuente').innerHTML = ''; $('#avisos').innerHTML = '';
  if ($('#btn-descongelar')) $('#btn-descongelar').classList.add('hidden');
  msg('Calculando el mes…');
  try {
    const r = await Api.get(`/nominas/cargar?mes=${mes()}&ano=${ano()}`);
    if (r.resultado) {
      RESULTADO = r.resultado; FUENTE = r.fuente; render();
      msg(r.fuente==='congelada'
        ? `Nómina congelada el ${fecha(RESULTADO.congeladaAt)}${RESULTADO.congeladaPor?' por '+RESULTADO.congeladaPor:''}. Es la que se pagó: no se recalcula.`
        : 'Calculada con los datos de la base. Revisa y congela cuando esté conforme.');
    } else msg(''+(r.msg||'no se pudo calcular'), true);
  } catch (e) { msg('No se pudo cargar: ' + e.message, true); }
  cargando = false;
}
$('#mes').addEventListener('change', cargar);
$('#ano').addEventListener('change', cargar);
$('#btn-recargar').addEventListener('click', cargar);

// ── Probar una config sin guardarla ──
// LAS TRES ACCIONES DE LA NÓMINA (03/11/2026): con el Dialogo de la casa, no
// con el confirm() del navegador —que salía con el dominio arriba y se aceptaba
// con Enter por reflejo—, diciendo cuántos conductores toca, y sin quedarse en
// «Congelando…» si la red falla: Api desactiva el botón mientras trabaja y el
// error se dice.
const conductoresEnPantalla = () => (RESULTADO && RESULTADO.filas ? RESULTADO.filas.filter(f => !f.ett).length : 0);

$('#btn-probar').addEventListener('click', async e => {
  const b = e.currentTarget;
  if (FUENTE === 'congelada' && !(await Dialogo.confirmar({
    titulo: `${MESES[mes()-1]} ${ano()} está congelado`, tono: 'aviso', si: 'Probar', no: 'Cancelar',
    texto: 'Lo que pruebes no cambia lo congelado: es solo para ver qué saldría con esos valores.',
  }))) return;
  msg('Recalculando con esos valores…');
  try {
    const r = await Api.post('/nominas/calcular', { mes: mes(), ano: ano(), config: recogerConfig() }, { boton: b });
    RESULTADO = r.resultado; FUENTE = 'prueba'; render(); msg('Simulación con esos valores. No está guardado ni congelado.');
  } catch (err) { msg('No se pudo recalcular: ' + err.message, true); }
});

// ── Congelar / descongelar ──
$('#btn-congelar').addEventListener('click', async e => {
  const b = e.currentTarget;
  const dm = RESULTADO && RESULTADO.mesDatosNombre ? ` (trabajo de ${RESULTADO.mesDatosNombre})` : '';
  const n = conductoresEnPantalla();
  if (!(await Dialogo.confirmar({
    titulo: `Congelar la nómina de ${MESES[mes()-1]} ${ano()}${dm}`, tono: 'aviso', si: 'Congelar', no: 'Cancelar',
    texto: `Se guardan los números de ${n} conductor${n === 1 ? '' : 'es'} tal cual. A partir de ahí no se recalculan, pase lo que pase con los datos.`,
  }))) return;
  msg('Congelando…');
  try {
    const r = await Api.post('/nominas/congelar', { mes: mes(), ano: ano() }, { boton: b });
    msg(`Congelada · ${r.conductores} conductores · total ${eur(r.total)}`); cargar();
  } catch (err) { msg('No se pudo congelar: ' + err.message, true); }
});
if ($('#btn-descongelar')) $('#btn-descongelar').addEventListener('click', async e => {
  const b = e.currentTarget;
  const n = conductoresEnPantalla();
  const cuando = RESULTADO && RESULTADO.congeladaAt
    ? ` el ${fecha(RESULTADO.congeladaAt)}${RESULTADO.congeladaPor ? ' por ' + RESULTADO.congeladaPor : ''}` : '';
  if (!(await Dialogo.confirmar({
    titulo: `Descongelar ${MESES[mes()-1]} ${ano()}`, tono: 'peligro', enterCancela: true,
    si: `Borrar la nómina de ${n} conductor${n === 1 ? '' : 'es'}`, no: 'Cancelar',
    texto: `Se BORRA la nómina que se congeló${cuando}, con los números de ${n} conductor${n === 1 ? '' : 'es'}, y vuelve a calcularse con los datos de hoy.\n\nSi ya se pagó, los números pueden salir distintos de lo pagado.`,
  }))) return;
  try {
    const r = await Api.post('/nominas/descongelar', { mes: mes(), ano: ano() }, { boton: b });
    msg(r.borrada?'Descongelada. Vuelve a calcularse en vivo.':'No había ninguna congelada.'); cargar();
  } catch (err) { msg('No se pudo descongelar: ' + err.message, true); }
});

$('#btn-descargar').addEventListener('click', e => { e.preventDefault(); window.open(`/nominas/nomina.xlsx?mes=${mes()}&ano=${ano()}`,'_blank'); });

// ── El parte de la ETT, por mes TRABAJADO ──
// Arranca en el mes en curso, que es lo que se pide el 90 % de las veces.
MESES.forEach((m,i)=>{ const o=document.createElement('option'); o.value=i+1; o.textContent=m; if(i+1===CFG.mesActual)o.selected=true; $('#ett-mes').appendChild(o); });
$('#ett-ano').value = CFG.anoActual;
$('#btn-ett').addEventListener('click', () => {
  const m = parseInt($('#ett-mes').value,10), a = parseInt($('#ett-ano').value,10);
  window.open(`/nominas/ett.xlsx?mes=${m}&ano=${a}`,'_blank');
  msg(`Bajando el parte de la ETT del trabajo de ${MESES[m-1]} ${a}.`);
});

// ── Render ──
const pct = x => Math.round((Number(x)||0)*100) + ' %';
// Lo que suman para el objetivo las vacaciones y los permisos (16/10/2026).
const vacPerm = f => (Number(f.horasVacaciones)||0) + (Number(f.horasPermiso)||0);
function render() {
  if (!RESULTADO || !RESULTADO.filas) { $('#tabla-wrap').classList.add('hidden'); return; }
  $('#tabla-wrap').classList.remove('hidden');
  $('#btn-congelar').disabled = false;
  $('#btn-descargar').classList.remove('hidden');
  if ($('#btn-descongelar')) $('#btn-descongelar').classList.toggle('hidden', FUENTE !== 'congelada');
  const badge = FUENTE==='congelada' ? ['congelada','bg-telecab-violet/15 text-telecab-violet']
    : FUENTE==='prueba' ? ['simulación','bg-telecab-warn/15 text-telecab-warn']
    : ['calculada en vivo','bg-telecab-card2 text-telecab-muted'];
  $('#fuente').innerHTML = `<span class="px-2 py-0.5 rounded-full ${badge[1]}">${badge[0]}</span>`;
  pintarAvisos(RESULTADO.avisos, RESULTADO.config);
  filtrarYpintar();
}
function filtrarYpintar() {
  const q = ($('#filtro').value||'').toLowerCase().trim();
  // Se busca por CUALQUIERA de los tres nombres y por el DNI: RRHH escribe el de
  // la ficha y Trafico el de BOLT, y son distintos a proposito.
  // Una nómina congelada antes del 16/10/2026 podía traer filas de ETT: aquí
  // no se enseñan, como en las de ahora.
  const filas = RESULTADO.filas.filter(f => !f.ett &&
    (!q || [f.nombre, f.nombreBolt, f.nombreSS, f.dni].join(' ').toLowerCase().includes(q)));
  $('#resumen-tabla').textContent = `${filas.length} conductores · Nómina ${MESES[RESULTADO.mes-1]} ${RESULTADO.ano}` +
    (RESULTADO.mesDatosNombre ? ` · datos de ${RESULTADO.mesDatosNombre} ${RESULTADO.anoDatos}` : '');
  $('#tbody').innerHTML = filas.map(f => `<tr class="border-t border-telecab-border/50 hover:bg-telecab-card2/40">
    <td class="px-3 py-2 text-telecab-text">${esc(f.nombre)}${mismoNombre(f)?'':`<br><span class="text-[11px] text-telecab-muted">BOLT: ${esc(f.nombreBolt)}</span>`}</td>
    <td class="px-3 py-2 text-telecab-muted">${esc(f.dni)||'<span class="text-telecab-red/70">—</span>'}</td>
    <td class="px-3 py-2 text-telecab-muted whitespace-nowrap">${f.jornada?f.jornada+' horas':'<span class="text-telecab-muted/50">—</span>'}</td>
    <td class="px-3 py-2 text-right text-telecab-muted" title="${esc(arranque(f))}">${f.primerDia}${f.origenArranque==='primer-log'?' <span class="text-telecab-warn">*</span>':''}</td>
    <td class="px-3 py-2 text-right">${(Number(f.horas)||0).toFixed(1)}</td>
    <td class="px-3 py-2 text-right ${f.horasEsperaQuitadas>0?'text-telecab-warn':'text-telecab-muted/40'}" title="${f.horasEsperaQuitadas>0?`No llega al ${pct(RESULTADO.config.utilUmbral)}: se le retiran ${(Number(f.horasEsperaQuitadas)||0).toFixed(1)} h de espera para dejarlo en el ${pct(RESULTADO.config.utilExigida)}`:`Llega al ${pct(RESULTADO.config.utilUmbral)} de utilización: no se le quita nada`}">${f.horasEsperaQuitadas>0?'−'+(Number(f.horasEsperaQuitadas)||0).toFixed(1):'0,0'}</td>
    <td class="px-3 py-2 text-right ${f.horasJustificadas>0?'text-telecab-azul':'text-telecab-muted/50'}" title="${f.diasJustificados||0} día(s) con justificante aprobado">${(Number(f.horasJustificadas)||0).toFixed(1)}${f.diasJustificados?` <span class="text-[10px] text-telecab-muted">(${f.diasJustificados}d)</span>`:''}</td>
    <td class="px-3 py-2 text-right ${vacPerm(f)>0?'text-telecab-azul':'text-telecab-muted/50'}" title="${[f.diasVacaciones?`${f.diasVacaciones} día(s) de vacaciones`:'',f.diasPermiso?`${f.diasPermiso} día(s) de permiso`:''].filter(Boolean).join(' · ')||'Sin vacaciones ni permisos ese mes'}">${vacPerm(f).toFixed(1)}</td>
    <td class="px-3 py-2 text-right ${f.deltaHoras>0?'text-telecab-green':'text-telecab-muted'}" title="Rodadas ${(Number(f.horas)||0).toFixed(1)} + justificadas ${(Number(f.horasJustificadas)||0).toFixed(1)} = ${((Number(f.horas)||0)+(Number(f.horasJustificadas)||0)).toFixed(1)} h · diferencia ${(Number(f.deltaHoras)||0).toFixed(1)} h">${(Number(f.horasObjetivo)||0).toFixed(1)}</td>
    <td class="px-3 py-2 text-right ${f.horasNoJustificadas>0?'text-telecab-red font-semibold':'text-telecab-muted/40'}" title="${f.horasNoJustificadas>0?'Le faltan horas y no hay J que las explique':'Cubrió su objetivo'}">${(Number(f.horasNoJustificadas)||0).toFixed(1)}</td>
    <td class="px-3 py-2 text-right ${f.deltaHoras>0?'text-telecab-green font-medium':'text-telecab-muted/50'}">${f.deltaHoras>0?'+':''}${(Number(f.deltaHoras)||0).toFixed(1)}</td>
    <td class="px-3 py-2 text-right">${eur(f.propinas)}</td>
    <td class="px-3 py-2 text-right">${eur(f.peajes)}</td>
    <td class="px-3 py-2 text-right" title="${f.nocturnasHorasQuitadas>0?`${(Number(f.nocturnasHoras)||0).toFixed(1)} h nocturnas: se le quitan ${(Number(f.nocturnasHorasQuitadas)||0).toFixed(1)} h con la espera descontada`:`${(Number(f.nocturnasHoras)||0).toFixed(1)} h nocturnas`}">${eur(f.nocturnas)}</td>
    <td class="px-3 py-2 text-right ${f.compensacion>0?'text-telecab-muted/60':''}">${eur(f.mboFAS)}</td>
    <td class="px-3 py-2 text-right ${f.compensacion>0?'':'text-telecab-muted/50'}">${eur(f.compensacion)}</td>
    <td class="px-3 py-2 text-right ${f.diasExtra>0?'':'text-telecab-muted/50'}">${(Number(f.diasExtra)||0).toFixed(2)}</td>
    <td class="px-3 py-2 text-right">${f.utilPct==null?'<span class="text-telecab-red/70">—</span>':f.utilPct.toFixed(0)+'%'}</td>
    <td class="px-3 py-2 text-right font-semibold text-telecab-text">${eur(f.total)}</td></tr>`).join('')
    || '<tr><td colspan="19" class="px-3 py-6 text-center text-telecab-muted">Sin coincidencias</td></tr>';
  const t = filas.reduce((a,f)=>{['horas','horasEsperaQuitadas','horasJustificadas','horasNoJustificadas','propinas','peajes','nocturnas','mboFAS','compensacion','diasExtra','total'].forEach(k=>a[k]+=f[k]||0);a.vacPerm+=vacPerm(f);return a;},{horas:0,horasEsperaQuitadas:0,horasJustificadas:0,horasNoJustificadas:0,propinas:0,peajes:0,nocturnas:0,mboFAS:0,compensacion:0,diasExtra:0,total:0,vacPerm:0});
  $('#tfoot').innerHTML = `<tr>
    <td class="px-3 py-2" colspan="4">TOTAL (${filas.length})</td>
    <td class="px-3 py-2 text-right">${t.horas.toFixed(1)}</td>
    <td class="px-3 py-2 text-right ${t.horasEsperaQuitadas>0?'text-telecab-warn':''}">${t.horasEsperaQuitadas>0?'−':''}${t.horasEsperaQuitadas.toFixed(1)}</td>
    <td class="px-3 py-2 text-right text-telecab-azul">${t.horasJustificadas.toFixed(1)}</td>
    <td class="px-3 py-2 text-right text-telecab-azul">${t.vacPerm.toFixed(1)}</td>
    <td></td>
    <td class="px-3 py-2 text-right ${t.horasNoJustificadas>0?'text-telecab-red':''}">${t.horasNoJustificadas.toFixed(1)}</td>
    <td></td>
    <td class="px-3 py-2 text-right">${eur(t.propinas)}</td>
    <td class="px-3 py-2 text-right">${eur(t.peajes)}</td>
    <td class="px-3 py-2 text-right">${eur(t.nocturnas)}</td>
    <td class="px-3 py-2 text-right">${eur(t.mboFAS)}</td>
    <td class="px-3 py-2 text-right">${eur(t.compensacion)}</td>
    <td class="px-3 py-2 text-right">${t.diasExtra.toFixed(2)}</td>
    <td></td>
    <td class="px-3 py-2 text-right text-telecab-gold">${eur(t.total)}</td></tr>`;
}
// Los dos nombres son la misma persona escrita de dos formas; solo se ensena el
// de BOLT cuando de verdad difiere, o la tabla se llena de ruido.
const norm = s2 => String(s2||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const mismoNombre = f => !f.nombreBolt || norm(f.nombre).split('').sort().join('') === norm(f.nombreBolt).split('').sort().join('');

const arranque = f => f.origenArranque==='alta-anterior' ? 'Ya estaba de alta: mes completo'
  : f.origenArranque==='alta-en-mes' ? ('Alta el '+(dia(f.alta)||'?')+': objetivo prorrateado desde ese día')
  : 'SIN fecha de alta: se usa su primer día con horas';
$('#filtro').addEventListener('input', filtrarYpintar);

function pintarAvisos(a, cfg) {
  if (!a) { $('#avisos').innerHTML=''; return; }
  const av=[];
  const mesD = RESULTADO ? RESULTADO.mesDatosNombre : 'el mes';
  if (a.sinDinero) av.push(['red','Ninguna persona tiene propinas, peajes ni facturación en ese mes: falta la ingesta de pedidos de BOLT.']);
  if (a.sinDni>0) av.push(['amber',`${a.sinDni} conductor(es) sin DNI/NIE en su ficha (aparecen con —). Complétalos en la ficha del conductor.`]);
  if (a.trabajoIncompleto) av.push(['amber',`El mes de trabajo (${mesD}) aún no ha terminado: los datos están incompletos. Esta nómina se cierra el mes siguiente.`]);
  const exc = (a.excluidos||[]);
  if (exc.length) av.push(['red',`${exc.length} conductor(es) con horas pero FECHA DE ALTA posterior a ${mesD}: fuera de esta nómina. Revisa su alta si es un error → ${exc.map(e=>`${e.nombre} (alta ${dia(e.alta)||'—'}, ${e.horas} h)`).join(' · ')}`]);
  if (a.sinAlta>0) av.push(['amber',`${a.sinAlta} conductor(es) SIN fecha de alta (marcados con *): se les prorratea desde su primer día con horas. Rellénales el alta en su periodo de empleo.`]);
  if (a.altaEnMes>0) av.push(['muted',`${a.altaEnMes} conductor(es) se dieron de alta durante ${mesD}: son los únicos con el objetivo prorrateado.`]);
  if (a.jPendientes>0) av.push(['amber',`${a.jPendientes} justificante(s) de ${mesD} siguen PENDIENTES de aprobar: todavía no cuentan. Si se aprueban, las horas justificadas suben y las no justificadas bajan. Se revisan en /justificantes.`]);
  if (a.conJ>0) av.push(['muted',`${a.conJ} conductor(es) tienen días justificados. Cada J vale las horas que se le pusieron al justificarla, y se suman a las rodadas ese día, igual que en la bitácora. Las justificadas CUENTAN para la diferencia: un día justificado no le resta a nadie sus horas extra.`]);
  if (a.conVacaciones>0 || a.conPermiso>0) av.push(['muted',`${a.conVacaciones||0} conductor(es) con vacaciones y ${a.conPermiso||0} con permisos retribuidos en ${mesD}: suman para el objetivo, ${String(Math.round(((cfg||{}).horasMetaDia||8)*((cfg||{}).pctDiaVacaciones||0.73)*100)/100).replace('.',',')} h por día natural de vacaciones (libranzas incluidas) y ${(cfg||{}).horasMetaDia||8} h por día de permiso. Es la columna «Vac./perm.».`]);
  if (a.jSinHoras>0) av.push(['amber',`${a.jSinHoras} J aprobada(s) no tienen horas puestas: no suman nada. Si cubrían horas, hay que ponérselas en el justificante.`]);
  if (a.jTapadas>0) av.push(['amber',`${a.jTapadas} J aprobada(s) caen en días de vacaciones, permiso o baja: no cuentan. Ese día manda su marca, como en la bitácora.`]);
  if (a.conRecorte>0) av.push(['amber',`${a.conRecorte} conductor(es) no llegan al ${pct((cfg||{}).utilUmbral)} de utilización: a esos se les exige el ${pct((cfg||{}).utilExigida)}, y se les retiran ${(RESULTADO?RESULTADO.totales.horasEsperaQuitadas:0).toFixed(1)} h de ESPERA en total para dejarlos ahí. Nunca se quita viaje, y a quien llega al ${pct((cfg||{}).utilUmbral)} no se le toca nada.` + (a.recortadosSinExtra>0?` A ${a.recortadosSinExtra} de ellos el recorte les deja sin las horas extra que tenían.`:'')]);
  if (a.conHorasSinJustificar>0) av.push(['amber',`${a.conHorasSinJustificar} conductor(es) siguen por debajo de su objetivo después de contarles las J: son las "horas no justificadas" de la columna roja.`]);
  if (a.ett>0) av.push(['muted',`Solo plantilla propia. Los ${a.ett} de ETT no salen aquí ni en el Excel de la nómina: su nocturnidad, propinas, peajes y horas van en el "Parte de trabajo de la ETT", que se baja por mes trabajado.`]);
  if (a.sinNombreBolt>0) av.push(['muted',`${a.sinNombreBolt} conductor(es) sin nombre de BOLT: en el Excel sale el de la ficha en su lugar.`]);
  if (a.sinApellidosSeparados>0) av.push(['muted',`${a.sinApellidosSeparados} conductor(es) tienen el nombre en una sola pieza (la ficha no separa apellidos de nombres), as\u00ed que en la columna "Nombre de la seguridad social" salen sin la coma. No se parte a ojo: en unos casos son dos apellidos y en otros uno, y alguno va en orden inverso. Se arregla rellen\u00e1ndoles los apellidos en su ficha.`]);
  const ss = (a.sinSellar||[]);
  if (ss.length) av.push(['muted',`${ss.length} conductor(es) trabajaron y la bitácora no los tiene NI UNA HORA (se les enlazó la cuenta de BOLT después de cerrar el mes): la nómina sí los cuenta. Se arregla resellando el mes desde la bitácora → ${ss.map(x=>x.nombre).join(' · ')}`]);
  // No confundir esto con "las horas no cuadran entre las dos pantallas": a
  // quien trabaja de noche no le cuadran nunca, porque la nómina mide el día
  // natural y la bitácora la jornada 05→05. Es a propósito.
  av.push(['muted',`Las horas de esta pantalla van por DÍA NATURAL (del 1 a las 00:00 al último a las 23:59), no por la jornada 05→05 de la bitácora: una nómina paga lo que pasó en el mes. Para quien trabaja de noche los dos números no coinciden, y es correcto.`]);
  const c = cfg || {};
  const n2 = x => (Number(x)||0).toLocaleString('es-ES',{maximumFractionDigits:2});
  av.push(['muted',`Esto son las VARIABLES (mes vencido). La nómina entera —el salario base bruto del 26 al 25 a ${n2(c.eurHoraBase)} €/h, con tope de ${n2(c.sueldoBase40)} € con 40 h y ${n2(c.sueldoBase32)} € con 32 h, más estas variables— va en la pestaña «Nómina base» del Excel.`]);
  av.push(['muted',`Hora extra: ${n2(c.eurHoraExtra)} €/h × utilización · Nocturna: ${n2(c.eurHoraNoc)} € × h × ${n2(c.factorNoc)} (${n2((c.eurHoraNoc||0)*(c.factorNoc||0))} € cada hora) · FAS: (neto − umbral) × ${n2(c.pctMBOFAS)} · umbral 40h=${n2(c.umbralFAS40)} / 32h=${n2(c.umbralFAS32)} · objetivo ${n2(c.horasMetaMes40)} h al mes con 40 h · utilización: sin recorte desde el ${pct(c.utilUmbral)}, exigido el ${pct(c.utilExigida)}`]);
  $('#avisos').innerHTML = av.map(([c2,t])=>`<div class="rounded-lg px-3 py-2 text-sm ${c2==='red'?'bg-telecab-red/10 text-telecab-red border border-telecab-red/30':c2==='amber'?'bg-telecab-warn/15 text-telecab-warn border border-telecab-warn/35':'bg-telecab-card2/40 text-telecab-muted'}">${esc(t)}</div>`).join('');
}

const fecha = v => { try { return new Date(v).toLocaleString('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); } catch(e) { return ''; } };
// Las fechas de alta vienen en AAAA-MM-DD (que es como se guardan) y se enseñan
// como se leen aquí. Se le da la vuelta al texto y ya: pasarlas por Date las
// movería un día, que es el fallo clásico de este proyecto con las fechas.
const dia = iso => (iso ? String(iso).slice(0,10).split('-').reverse().join('/') : '');
function msg(txt, err) {
  const p = $('#progreso'); p.classList.remove('hidden');
  p.textContent = txt; p.style.color = err ? 'var(--tc-red, #f87171)' : '';
}

cargarConfig();
cargar();
