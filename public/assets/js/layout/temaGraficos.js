// views/layout-gestion.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

(function () {
  if (!window.Chart) return;
  const css = getComputedStyle(document.documentElement);
  const tk = (n, a) => 'rgb(' + css.getPropertyValue(n).trim() + (a == null ? '' : ' / ' + a) + ')';
  const d = Chart.defaults;
  d.font.family = "'IBM Plex Sans', system-ui, sans-serif";
  d.font.size = 11;
  d.color = tk('--tc-muted');
  d.borderColor = tk('--tc-border', .7);
  d.elements.bar.borderRadius = 3;
  d.elements.bar.borderSkipped = 'start';
  d.elements.line.borderWidth = 2;
  d.plugins.legend.labels.boxWidth = 10;
  d.plugins.legend.labels.boxHeight = 10;
  Object.assign(d.plugins.tooltip, {
    backgroundColor: tk('--tc-card'), borderColor: tk('--tc-border'), borderWidth: 1,
    titleColor: tk('--tc-text'), bodyColor: tk('--tc-text'), footerColor: tk('--tc-muted'),
    padding: 10, cornerRadius: 6, boxPadding: 4, displayColors: true,
  });
})();
