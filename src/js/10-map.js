/* =========================================================================
   Carte (Leaflet) : fonds IGN / OpenTopoMap, départ, parcours, tracé à la main.
   ========================================================================= */

const IGN_WMTS = (layer, fmt) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${fmt}`;
const LAYERS = {
  plan: { label: 'Plan IGN', note: 'France · sentiers', url: IGN_WMTS('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), max: 19, native: 19, attr: '© <a href="https://www.ign.fr/">IGN</a>', sw: 'linear-gradient(135deg,#efe9d8,#d9e5cf)' },
  topo: { label: 'Topo', note: 'Monde · courbes de niveau', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', sub: 'abc', max: 19, native: 17, attr: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', sw: 'linear-gradient(135deg,#e4ead2,#c9d7b4)' },
  photo: { label: 'Photo', note: 'France · vue aérienne', url: IGN_WMTS('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), max: 19, native: 19, attr: '© <a href="https://www.ign.fr/">IGN</a>', sw: 'linear-gradient(135deg,#69735a,#3f4a39)' },
};
const MAP = { m: null, base: null, baseId: null, groups: {}, sig: {}, scrub: null, me: null };
const ll2 = (p) => [p[1], p[0]];
const RCOL = ['--r-a', '--r-b', '--r-c'];
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#2A72A6'; }

function initMap() {
  if (typeof L === 'undefined') return;
  const v = lsJSON(LS.view, null);
  MAP.m = L.map('map', { zoomControl: false, attributionControl: true, worldCopyJump: true, zoomSnap: 0.5, tapTolerance: 18 })
    .setView(v ? [v.lat, v.lon] : S.start ? ll2(S.start.p) : [46.6, 2.5], v ? v.z : S.start ? 13 : 6);
  MAP.m.attributionControl.setPrefix(false);
  L.control.scale({ imperial: false, position: 'bottomleft', maxWidth: 110 }).addTo(MAP.m);
  MAP.m.on('click', onMapClick);
  MAP.m.on('moveend', () => {
    const c = MAP.m.getCenter();
    lsPut(LS.view, { lat: round(c.lat, 5), lon: round(c.lng, 5), z: MAP.m.getZoom() });
    updateBase();
  });
  updateBase();
}
function baseId() {
  const pref = S.settings.layer;
  if (pref && pref !== 'auto' && LAYERS[pref]) return pref;
  const c = MAP.m.getCenter();
  return inFrance([c.lng, c.lat]) ? 'plan' : 'topo';
}
function updateBase(force) {
  if (!MAP.m) return;
  const id = baseId();
  if (id === MAP.baseId && !force) return;
  if (MAP.base) MAP.m.removeLayer(MAP.base);
  const d = LAYERS[id];
  MAP.base = L.tileLayer(d.url, { maxZoom: d.max, maxNativeZoom: d.native, subdomains: d.sub || 'abc', attribution: d.attr, detectRetina: false }).addTo(MAP.m);
  MAP.base.bringToBack();
  MAP.baseId = id;
}

/* --- Scène --- */
function setGroup(name, sig, draw) {
  if (MAP.sig[name] === sig) return;
  MAP.sig[name] = sig;
  if (MAP.groups[name]) MAP.groups[name].remove();
  const g = L.layerGroup().addTo(MAP.m);
  MAP.groups[name] = g;
  if (sig) draw(g);
}
function themeSig() { return document.documentElement.getAttribute('data-theme') || 'auto'; }
function syncMap() {
  if (!MAP.m) return;
  const th = themeSig();
  setGroup('start', S.start && S.mode === 'seance' ? th + ll(S.start.p) : '', (g) => {
    L.marker(ll2(S.start.p), { icon: L.divIcon({ className: '', html: `<div class="pin pin-start"><svg class="ic"><use href="#i-cairn"/></svg></div>`, iconSize: [34, 34], iconAnchor: [17, 34] }), interactive: false, keyboard: false }).addTo(g);
  });
  // parcours du mode courant
  let list = [], sel = 0, ctx = null;
  if (S.mode === 'seance') { list = S.gen.results; sel = S.gen.sel; ctx = 'gen'; }
  if (S.mode === 'course') { list = S.rplan.results; sel = S.rplan.sel; ctx = 'race'; }
  if (S.mode === 'mes' && S.view) { list = [S.view]; sel = 0; ctx = 'view'; }
  setGroup('routes', list.length ? th + ctx + sel + list.map((r) => r.id + r.dist.toFixed(0)).join(',') : '', (g) => drawRouteSet(g, list, sel, ctx));
  setGroup('race', S.race && S.mode === 'course' ? th + S.race.at + (S.rplan.a ?? '') + ':' + (S.rplan.b ?? '') + (S.rplan.results.length ? 'r' : '') : '', (g) => drawRace(g));
  const d = S.draw;
  setGroup('draw', S.mode === 'main' && d.wps.length ? th + d.wps.map(ll).join(';') + '|' + (d.route ? d.route.id + d.route.dist.toFixed(0) : '') + '|' + d.sel : '', (g) => drawDraw(g));
  setGroup('me', S.me ? th + ll(S.me) : '', (g) => {
    L.marker(ll2(S.me), { icon: L.divIcon({ className: '', html: '<div class="pin pin-me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, keyboard: false }).addTo(g);
  });
}
function colorFor(i, r) { return cssVar(r && r.kind === 'course' && S.mode === 'course' && i == null ? '--r-race' : RCOL[(i || 0) % 3]); }
function drawLine(g, pts, color, sel, onClick) {
  if (sel) L.polyline(pts.map(ll2), { color: cssVar('--casing'), weight: 9, opacity: 0.92, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
  const line = L.polyline(pts.map(ll2), { color, weight: sel ? 5 : 4, opacity: sel ? 1 : 0.6, dashArray: sel ? null : '1 8', lineCap: 'round', lineJoin: 'round' }).addTo(g);
  if (onClick) line.on('click', (e) => { L.DomEvent.stop(e); onClick(); });
  return line;
}
function drawRouteSet(g, list, sel, ctx) {
  list.forEach((r, i) => { if (i !== sel) drawLine(g, r.pts, colorFor(i, r), false, () => selectResult(ctx, i)); });
  const r = list[sel];
  if (!r) return;
  drawLine(g, r.pts, colorFor(sel, r), true);
  if (r.climbSeg) L.polyline(r.climbSeg.pts.map(ll2), { color: cssVar('--r-climb'), weight: 7, opacity: 1, lineCap: 'round', interactive: false }).addTo(g);
  if (r.overlap < 0.5) kmMarkers(g, r, r.dist > 30000 ? 5000 : 1000, '');
  for (const m of r.marks || []) flag(g, m.p, m.name);
}
function kmMarkers(g, r, every, cls) {
  for (let x = every; x < r.dist - every * 0.3; x += every) {
    const p = pointAt(r.pts, r.cum, x);
    L.marker(ll2(p), { icon: L.divIcon({ className: '', html: `<div class="pin-km ${cls}">${Math.round(x / 1000)}</div>`, iconSize: [22, 20], iconAnchor: [11, 10] }), interactive: false, keyboard: false }).addTo(g);
  }
}
function flag(g, p, name) {
  L.marker(ll2(p), { icon: L.divIcon({ className: '', html: `<div style="position:relative"><div class="pin-flag">${esc(name)}</div></div>`, iconSize: [0, 0] }), interactive: false, keyboard: false }).addTo(g);
}
function drawRace(g) {
  const rc = S.race;
  const col = cssVar('--r-race');
  L.polyline(rc.pts.map(ll2), { color: col, weight: S.rplan.results.length ? 3 : 4, opacity: S.rplan.results.length ? 0.45 : 0.85, dashArray: '6 6', interactive: false }).addTo(g);
  if (!S.rplan.results.length) {
    for (const c of rc.climbs) {
      const s = slicePath(rc.pts, rc.cum, c.from, c.to);
      L.polyline(s.pts.map(ll2), { color: cssVar('--r-climb'), weight: 5, opacity: 0.9, interactive: false }).addTo(g);
    }
    kmMarkers(g, rc, rc.dist > 25000 ? 5000 : 2000, 'race');
  }
  if (S.rplan.a != null && S.rplan.b != null && S.rplan.b > S.rplan.a) {
    const s = slicePath(rc.pts, rc.cum, S.rplan.a * 1000, S.rplan.b * 1000);
    L.polyline(s.pts.map(ll2), { color: col, weight: 7, opacity: 0.9, interactive: false }).addTo(g);
  }
}
function drawDraw(g) {
  const d = S.draw;
  if (d.route) drawLine(g, d.route.pts, colorFor(0), true);
  else if (d.wps.length > 1) L.polyline(d.wps.map(ll2), { color: cssVar('--r-a'), weight: 3, dashArray: '4 6', interactive: false }).addTo(g);
  d.wps.forEach((p, i) => {
    const last = i === d.wps.length - 1 && i > 0 && samePt(p, d.wps[0], 2);
    if (last) return;
    const mk = L.marker(ll2(p), {
      draggable: true, autoPan: true,
      icon: L.divIcon({ className: '', html: `<div class="pin pin-wp${i === 0 ? ' first' : ''}${d.sel === i ? ' sel' : ''}">${i === 0 ? 'D' : i}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
    }).addTo(g);
    mk.on('click', (e) => { L.DomEvent.stop(e); selectWaypoint(i); });
    mk.on('dragend', () => { const q = mk.getLatLng(); moveWaypoint(i, [round(q.lng, 6), round(q.lat, 6)]); });
  });
}

/* --- Cadrage --- */
function panelPad() {
  const wide = window.innerWidth >= 900;
  const panel = document.querySelector('.panel');
  const h = panel && !wide ? panel.getBoundingClientRect().height : 0;
  return { tl: [wide ? 440 : 18, 78], br: [64, h + 18] };
}
function fitPts(pts, maxZoom) {
  if (!MAP.m || !pts || !pts.length) return;
  const pad = panelPad();
  const b = L.latLngBounds(pts.map(ll2));
  MAP.m.fitBounds(b, { paddingTopLeft: pad.tl, paddingBottomRight: pad.br, maxZoom: maxZoom || 16, animate: true });
}
function focusPoint(p, z) {
  if (!MAP.m) return;
  const pad = panelPad();
  const zoom = z || Math.max(MAP.m.getZoom(), 14);
  const pt = MAP.m.project(ll2(p), zoom);
  const dy = (pad.br[1] - pad.tl[1]) / 2, dx = (pad.tl[0] - pad.br[0]) / 2;
  MAP.m.setView(MAP.m.unproject(pt.add([-dx, dy]), zoom), zoom, { animate: true });
}
function showScrub(p) {
  if (!MAP.m) return;
  if (!MAP.scrub) MAP.scrub = L.marker(ll2(p), { icon: L.divIcon({ className: '', html: '<div class="pin-scrub"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(MAP.m);
  else MAP.scrub.setLatLng(ll2(p));
}
function hideScrub() { if (MAP.scrub) { MAP.scrub.remove(); MAP.scrub = null; } }
