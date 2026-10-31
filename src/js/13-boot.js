/* =========================================================================
   Démarrage
   ========================================================================= */

function loadBrief(b) {
  S.brief = b;
  lsPut(LS.brief, b);
  const m = lsJSON(LS.manual, {});
  S.manual = m && m.briefId === b.id ? m : {};
  delete S.manual.briefId;
  S.gen = Object.assign(S.gen, { results: [], sel: 0, err: null, seed: 0 });
  S.mode = 'seance';
  applyTheme();
}
function boot() {
  loadAll();
  const h = readHash();
  if (h.brief) loadBrief(h.brief);
  else {
    const last = lsJSON(LS.brief, null);
    const b = last ? normBrief(last) : null;
    if (b && b.date && b.date >= addDays(todayISO(), -1)) loadBrief(b);
    else {
      const m = lsJSON(LS.manual, {});
      S.manual = m && m.briefId == null ? m : {};
      delete S.manual.briefId;
    }
  }
  if (h.mode && MODES.some((m) => m.id === h.mode)) S.mode = h.mode;
  if (location.protocol === 'file:') window.__atelier = { S, render, currentSpec, routeOf };
  applyTheme();
  applySheet();
  initMap();
  bindEvents();
  render();
  if (!lsJSON(LS.view, null) && S.start) focusPoint(S.start.p, 13);
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { MAP.sig = {}; syncMap(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
