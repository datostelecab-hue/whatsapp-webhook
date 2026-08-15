// ============================================================
// ESTILO COMÚN DE LOS EXCEL QUE SALEN DE LA CASA
// ============================================================
// Los ficheros que se imprimen o se envían por correo (turnos de tráfico, reporte de
// horas…) comparten cabecera: banda oscura con el logo incrustado y una línea de
// contexto debajo. Se centraliza aquí para que todos salgan iguales y para no repetir
// la paleta en cada módulo.

const path = require('path');
const fs = require('fs');

// El logo va INCRUSTADO en el .xlsx (no enlazado): así el fichero viaja completo por
// correo. Si algún día faltara, la cabecera se genera igual sin él.
//
// Se usa la versión RECORTADA (el círculo con fondo transparente), no logo-256.png:
// esa otra es un cuadrado con su propio fondo oscuro, que sobre la banda se vería como
// un parche pegado. A 256 px se imprime nítido y solo pesa ~94 KB, y como se registra
// una vez por libro da igual cuántas hojas tenga el fichero.
const LOGO = path.join(__dirname, '..', 'public', 'assets', 'logo-sinfondo-256.png');

// Paleta de la casa (dorado Telecab) en ARGB.
const DARK = 'FF1F2430';
const GOLD = 'FFE8B84B';
const GRIS_BORDE = 'FFD8DCE3';
const CAB_BG = 'FF394150';
const TEXTO = 'FF374151';
const TENUE = 'FF6B7280';

const borde = { style: 'thin', color: { argb: GRIS_BORDE } };
const TODOS_BORDES = { top: borde, left: borde, bottom: borde, right: borde };

const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const colLetra = n => String.fromCharCode(64 + n);   // 1→A … 26→Z

let _logoOk = null;
const hayLogo = () => (_logoOk === null ? (_logoOk = fs.existsSync(LOGO)) : _logoOk);

/**
 * Registra el logo UNA vez por libro y devuelve su id (o null si no hay fichero).
 * Llamarlo por hoja duplicaría la imagen dentro del .xlsx.
 */
const registrarLogo = wb => (hayLogo() ? wb.addImage({ filename: LOGO, extension: 'png' }) : null);

/**
 * Banda superior: título con el logo sobre fondo oscuro y subtítulo de contexto.
 * Devuelve la primera fila libre (deja una en blanco de respiro).
 */
function bandaCabecera(ws, idLogo, titulo, subtitulo, nCols) {
  const ultima = colLetra(nCols);

  ws.mergeCells(`A1:${ultima}1`);
  const t = ws.getCell('A1');
  t.value = `TIBUS LUXURY · ${titulo}`;
  t.font = { name: 'Calibri', size: 15, bold: true, color: { argb: GOLD } };
  t.fill = relleno(DARK);
  // El texto arranca pasado el logo. Sin logo se pega al margen.
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: idLogo != null ? 9 : 1 };
  // Banda algo más alta que el logo para que respire por arriba y por abajo. A 48 px
  // el "telecab" del círculo ya se lee; más pequeño se emborrona.
  ws.getRow(1).height = 54;
  if (idLogo != null) {
    ws.addImage(idLogo, { tl: { col: 0.12, row: 0.08 }, ext: { width: 48, height: 48 }, editAs: 'absolute' });
  }

  ws.mergeCells(`A2:${ultima}2`);
  const s = ws.getCell('A2');
  s.value = subtitulo;
  s.font = { size: 10, color: { argb: TENUE } };
  s.fill = relleno('FFF7F8FA');
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 19;

  return 4;
}

/** Fila de cabecera de tabla: fondo oscuro, texto blanco, centrada. */
function cabeceraTabla(ws, fila, textos) {
  const r = ws.getRow(fila);
  textos.forEach((h, i) => {
    const c = r.getCell(i + 1);
    c.value = h;
    c.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = relleno(CAB_BG);
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = TODOS_BORDES;
  });
  r.height = 20;
  return fila + 1;
}

module.exports = {
  LOGO, DARK, GOLD, GRIS_BORDE, CAB_BG, TEXTO, TENUE,
  TODOS_BORDES, relleno, colLetra, hayLogo, registrarLogo, bandaCabecera, cabeceraTabla
};
