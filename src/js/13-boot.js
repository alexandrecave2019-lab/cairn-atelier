/* =========================================================================
   Démarrage
   ========================================================================= */

const INSTALL = { evt: null };
function isStandalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
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
async function runProbe() {
  const out = {};
  const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('timeout'), ms))]);
  out.fetch = await within(fetch(API.ign + '/geocodage/search?q=Plan-d%27Aups&limit=1').then((r) => 'ok ' + r.status).catch(() => 'blocked'), 8000);
  out.post = await within(fetch(API.ign + '/altimetrie/1.0/calcul/alti/rest/elevation.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lon: '5.75', lat: '43.33', resource: 'ign_rge_alti_wld', zonly: 'true' }) }).then((r) => 'ok ' + r.status).catch(() => 'blocked'), 8000);
  try { out.geo = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (e) { out.geo = 'n/a'; }
  try { out.geoPolicy = document.featurePolicy ? String(document.featurePolicy.allowsFeature('geolocation')) : 'n/a'; } catch (e) { out.geoPolicy = 'err'; }
  try { localStorage.setItem('atelier:probe', '1'); out.ls = 'ok'; } catch (e) { out.ls = 'blocked'; }
  out.origin = String(self.origin);
  try { parent.postMessage({ atelierProbe: out }, '*'); } catch (e) { /* rien */ }
}
function boot() {
  if (location.hash === '#probe' && window.parent !== window) { runProbe(); return; }
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
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    INSTALL.evt = e;
    S.ui.canInstall = true;
    render();
  });
  window.addEventListener('appinstalled', () => { INSTALL.evt = null; S.ui.canInstall = false; toast('Atelier installé : il est sur ton écran d’accueil'); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
