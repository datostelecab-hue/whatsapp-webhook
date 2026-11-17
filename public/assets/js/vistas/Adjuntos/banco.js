// modules/Adjuntos/vistas/adjuntosBanco.ejs — el banco de adjuntos (A6).
//
// Dice dónde se guardan los ficheros, deja PROBAR LA CONEXIÓN (escribe, lee y
// borra una sonda, y dice en español qué falla) y monta el componente de la
// casa sobre el «dueño de pruebas» del desarrollador (su id de usuario).

(async function () {
  const esc = Casa.esc;
  const caja = document.querySelector('#estado');

  let e;
  try {
    e = await Api.get('/adjuntos/api/estado');
  } catch (err) {
    caja.innerHTML = `<p class="text-sm text-telecab-warn">No se ha podido leer el estado del almacén: ${esc(err.message)}</p>`;
    return;
  }

  const donde = {
    r2: `Cloudflare R2${e.bucket ? ` · bucket <b>${esc(e.bucket)}</b>` : ''}${e.endpointPropio ? ' (dirección propia)' : ''}`,
    disco: 'El disco de este ordenador (solo vale en local y en las pruebas)',
  }[e.almacen];

  const avisoMal = texto => `
    <div class="flex items-start gap-2 px-4 py-3 rounded-xl border text-sm bg-telecab-warn/10 border-telecab-warn/30 text-telecab-warn">
      <i class="fa-solid fa-triangle-exclamation mt-0.5 text-xs" aria-hidden="true"></i><span>${texto}</span>
    </div>`;

  caja.innerHTML = e.almacen
    ? `<div class="bg-telecab-card border border-telecab-border rounded-2xl p-5 space-y-4">
         <div class="grid gap-4 sm:grid-cols-3">
           <div><p class="text-xs text-telecab-muted uppercase tracking-wide mb-1">Dónde se guardan</p><p class="text-sm">${donde}</p>
             ${e.direccion ? `<p class="text-[11px] text-telecab-muted mt-1 break-all">${esc(e.direccion)}</p>` : ''}</div>
           <div><p class="text-xs text-telecab-muted uppercase tracking-wide mb-1">Rutas</p><p class="text-sm">${
             e.prefijo ? `Empiezan por <b>${esc(e.prefijo)}</b> (servidor de pruebas)` : 'Las de producción'}</p></div>
           <div><p class="text-xs text-telecab-muted uppercase tracking-wide mb-1">Lo máximo por fichero</p><p class="text-sm tabular-nums">${esc(e.maxMb)} MB</p></div>
         </div>
         ${e.problema ? avisoMal(esc(e.problema)) : ''}
         <div class="flex flex-wrap items-center gap-3 pt-1">
           <button type="button" data-probar class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition
                   bg-telecab-card2 border-telecab-border text-telecab-muted hover:border-telecab-gold/50 hover:text-telecab-gold">
             <i class="fa-solid fa-plug mr-1" aria-hidden="true"></i>Probar conexión
           </button>
           <span data-resultado class="text-sm" role="status" aria-live="polite"></span>
         </div>
       </div>`
    : avisoMal(`No hay almacén: en Render hace falta Cloudflare R2. Pon <b>R2_ACCOUNT_ID</b>, <b>R2_ACCESS_KEY_ID</b>,
         <b>R2_SECRET_ACCESS_KEY</b> y <b>R2_BUCKET</b>, y vuelve a desplegar. Hasta entonces, nadie puede adjuntar.`);

  // PROBAR CONEXIÓN: escribe, lee y borra una sonda. Si falla, dice qué
  // revisar (la dirección, la clave, el secreto, el bucket, el permiso).
  const boton = caja.querySelector('[data-probar]');
  if (boton) {
    const resultado = caja.querySelector('[data-resultado]');
    const PASO = { escribir: 'Escribir', leer: 'Leer', borrar: 'Borrar' };
    boton.addEventListener('click', async () => {
      boton.disabled = true;
      resultado.className = 'text-sm text-telecab-muted';
      resultado.textContent = 'Probando…';
      try {
        const r = await Api.post('/adjuntos/api/probar', {});
        const pasos = (r.pasos || []).map(p => `${PASO[p.paso] || p.paso} ${p.ok ? 'bien' : 'falla'} (${p.ms} ms)`).join(' · ');
        resultado.className = `text-sm ${r.ok ? 'text-telecab-text' : 'text-telecab-warn'}`;
        resultado.innerHTML = r.ok
          ? `<i class="fa-solid fa-check text-telecab-gold mr-1" aria-hidden="true"></i>Funciona: ${esc(pasos)}`
          : `<i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>${esc(r.msg || 'No funciona')}${pasos ? `<span class="block text-[11px] text-telecab-muted mt-0.5">${esc(pasos)}</span>` : ''}`;
      } catch (err) {
        resultado.className = 'text-sm text-telecab-warn';
        resultado.textContent = `No se ha podido probar: ${err.message}`;
      } finally {
        boton.disabled = false;
      }
    });
  }

  if (e.almacen && e.yo) {
    Adjuntos.montar(document.querySelector('#adjuntos'), { tipo: 'prueba', dueno: e.yo, titulo: 'Mis ficheros de prueba', puedeQuitar: true, maxMb: e.maxMb });
  }
})();
