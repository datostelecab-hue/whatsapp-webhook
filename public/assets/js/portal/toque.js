// ============================================================
// PORTAL — QUE EL IPHONE ENSEÑE EL TOQUE (24/11/2026)
// ============================================================
// Safari en iPhone no aplica :active (la tarjeta que se hunde un poco al
// pulsarla, portal.css) si la página no escucha ningún toque. Un escuchador
// vacío y pasivo basta: no hace nada ni frena el desplazamiento. Va en un
// fichero y no escrito como atributo del <body>: la política de seguridad del
// portal no deja manejadores escritos en el HTML.
'use strict';
document.addEventListener('touchstart', function () {}, { passive: true });
