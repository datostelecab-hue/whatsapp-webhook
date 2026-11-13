// modules/Adjuntos/vistas/adjuntosBanco.ejs — el banco de adjuntos (A6).
//
// Dice dónde se guardan los ficheros y monta el componente de la casa sobre el
// «dueño de pruebas» del desarrollador (su id de usuario).

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
    r2: `Cloudflare R2${e.bucket ? ` · bucket <b>${esc(e.bucket)}</b>` : ''}${e.endpointPropio ? ' (dirección propia: un S3 de pruebas)' : ''}`,
    disco: 'El disco de este ordenador (solo vale en local y en las pruebas)',
  }[e.almacen];

  caja.innerHTML = e.almacen
    ? `<div class="bg-telecab-card border border-telecab-border rounded-2xl p-5 grid gap-4 sm:grid-cols-3">
         <div><p class="text-xs text-telecab-muted uppercase tracking-wide mb-1">Dónde se guardan</p><p class="text-sm">${donde}</p></div>
         <div><p class="text-xs text-telecab-muted uppercase tracking-wide mb-1">Rutas</p><p class="text-sm">${
           e.prefijo ? `Empiezan por <b>${esc(e.prefijo)}</b> (servidor de pruebas)` : 'Las de producción'}</p></div>
         <div><p class="text-xs text-telecab-muted uppercase tracking-wide mb-1">Lo máximo por fichero</p><p class="text-sm tabular-nums">${esc(e.maxMb)} MB</p></div>
       </div>`
    : `<div class="flex items-start gap-2 px-4 py-3 rounded-xl border text-sm bg-telecab-warn/10 border-telecab-warn/30 text-telecab-warn">
         <i class="fa-solid fa-triangle-exclamation mt-0.5 text-xs" aria-hidden="true"></i>
         <span>No hay almacén: en producción hace falta Cloudflare R2. En Render, pon <b>R2_ACCOUNT_ID</b>, <b>R2_ACCESS_KEY_ID</b>,
         <b>R2_SECRET_ACCESS_KEY</b> y <b>R2_BUCKET</b>, y vuelve a desplegar. Hasta entonces, nadie puede adjuntar.</span>
       </div>`;

  if (e.almacen && e.yo) {
    Adjuntos.montar(document.querySelector('#adjuntos'), { tipo: 'prueba', dueno: e.yo, titulo: 'Mis ficheros de prueba', puedeQuitar: true });
  }
})();
