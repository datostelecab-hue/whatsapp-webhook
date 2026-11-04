// ============================================================
// EL NÚCLEO DEL FRONT — lo que cada pantalla escribía a su manera
// ============================================================
// Cada vista traía su propio `esc` (35 copias, no todas iguales). Ahora es uno.
// Se carga el PRIMERO del layout, porque las vistas lo toman al arrancar
// (`const esc = Casa.esc;`).
//
//   Casa.esc(texto)              para meter un dato en HTML (los cinco: & < > " ')
//   Casa.tonoEstadoCoche(codigo) el color del estado de un coche (cat_estado_vehiculo)
//   Casa.datos()                 los datos que el servidor deja a la pantalla (FRO-4)
//
// Hablar con el servidor es Api (api.js); los formatos de una lista, Listado.fmt.

(function (global) {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESCAPES[c]);

  // EL COLOR DE CADA ESTADO DEL COCHE. El catálogo solo guarda el código («el
  // icono lo decide la interfaz»), y estaba copiado en el Planificador y en
  // Vehículos; en Vehículos faltaba Emergencia (E) y salía en gris.
  const TONO_ESTADO_COCHE = { O: 'green', R: 'gold', T: 'violet', X: 'warn', S: 'red', E: 'gold', B: 'muted', P: 'azul' };
  const tonoEstadoCoche = cod => TONO_ESTADO_COCHE[cod] || 'muted';

  // LOS DATOS DEL SERVIDOR DE UNA PANTALLA (FRO-4, 04/11/2026). El JavaScript
  // de las vistas vive en public/assets/js/vistas, donde EJS no llega: lo que
  // antes se escribía dentro del <script> con <%- json(x) %> va ahora en un
  // bloque que no se ejecuta, justo antes del script de la pantalla:
  //
  //   <script type="application/json" id="datos-servidor"><%- json({ a, b }) %></script>
  //
  // y el script lo lee con `const DEL_SERVIDOR = Casa.datos();`. scripts/comprobar-vistas
  // mira que cada DEL_SERVIDOR.x que se lee esté en el bloque.
  //
  // SIN BLOQUE, FALLA EN ALTO: un dato que no llega no puede quedarse en un
  // undefined callado, que en un permiso es un «no puede» sin aviso. El error
  // llega al log del servidor por /cliente-error (api.js).
  //
  // Y UNA CLAVE QUE NO LLEGÓ, SE AVISA. Si el servidor deja un valor en
  // undefined, JSON lo quita del bloque; antes, `<%- json(undefined) %>` dejaba
  // el script roto a la vista. Leerla sigue dando undefined, como en cualquier
  // objeto, pero sale en el log (una vez por clave). `reportError` dispara el
  // mismo evento que un error sin capturar, sin cortar el script: la pantalla
  // sigue funcionando con lo demás.
  const NO_SON_DATOS = new Set(['toJSON', 'then']);
  const datos = (id = 'datos-servidor') => {
    const el = document.getElementById(id);
    if (!el) throw new Error('Falta el bloque de datos #' + id + ' en esta pantalla');
    const d = JSON.parse(el.textContent);
    if (d === null || typeof d !== 'object') return d;
    const avisadas = new Set();
    return new Proxy(d, {
      get(t, k, r) {
        if (typeof k === 'string' && !(k in t) && !NO_SON_DATOS.has(k) && !avisadas.has(k)) {
          avisadas.add(k);
          const e = new Error('El servidor no ha mandado «' + k + '» en #' + id);
          if (typeof global.reportError === 'function') global.reportError(e); else console.error(e);
        }
        return Reflect.get(t, k, r);
      },
    });
  };

  global.Casa = { esc, TONO_ESTADO_COCHE, tonoEstadoCoche, datos };
})(window);
