/* =========================================================================
   Actions : rendu, panneau, départ, génération, tracé à la main, course, GPX.
   ========================================================================= */

let rafPending = false;
function render() {
  rafPending = false;
  const app = document.getElementById('app');
  const tpl = document.createElement('div');
  tpl.innerHTML = App().s;
  morphChildren(app, tpl);
  const af = app.querySelector('[data-autofocus]');
  if (af && document.activeElement !== af && !af.dataset.focused) { af.dataset.focused = '1'; af.focus(); }
  syncMap();
}
function scrollPanelTop() { const el = document.querySelector('.panel-scroll'); if (el) el.scrollTop = 0; }
function renderSoon() { if (!rafPending) { rafPending = true; requestAnimationFrame(render); } }
let toastTimer = null;
function toast(text, ms = 3600, act, actLabel) {
  S.ui.toast = { id: uid('t'), text, act, actLabel };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.ui.toast = null; render(); }, ms);
  render();
}
function applyTheme() {
  const th = S.settings.theme && S.settings.theme !== 'auto' ? S.settings.theme : (S.brief && S.brief.th) || null;
  if (th) document.documentElement.setAttribute('data-theme', th);
  else document.documentElement.removeAttribute('data-theme');
}

/* --- Panneau : trois hauteurs, glisser la poignée --- */
function sheetPx(state) {
  const vh = window.innerHeight;
  if (state === 'min') return 150;
  if (state === 'max') return Math.max(320, vh - 84);
  return clamp(Math.round(vh * 0.46), 300, 560);
}
function applySheet() { document.documentElement.style.setProperty('--sheet-h', sheetPx(S.ui.sheet) + 'px'); }
function setSheet(state) { S.ui.sheet = state; applySheet(); }
function cycleSheet() { setSheet(S.ui.sheet === 'mid' ? 'max' : S.ui.sheet === 'max' ? 'min' : 'mid'); }
let suppressClick = 0;
function bindSheetDrag() {
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.grip');
    if (!g) return;
    drag = { y: e.clientY, h: sheetPx(S.ui.sheet), moved: false, id: e.pointerId };
    g.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = drag.y - e.clientY;
    if (Math.abs(dy) > 6) drag.moved = true;
    if (!drag.moved) return;
    const h = clamp(drag.h + dy, 120, window.innerHeight - 60);
    document.querySelector('.panel')?.classList.add('dragging');
    document.documentElement.style.setProperty('--sheet-h', h + 'px');
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    document.querySelector('.panel')?.classList.remove('dragging');
    if (!d.moved) return;
    suppressClick = Date.now();
    const h = d.h + (d.y - e.clientY);
    const opts = ['min', 'mid', 'max'].map((s) => [s, Math.abs(sheetPx(s) - h)]).sort((a, b) => a[1] - b[1]);
    setSheet(opts[0][0]);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}

/* --- Modes --- */
function setMode(m) {
  if (S.mode === m) return;
  S.mode = m;
  S.ui.pick = null;
  hideScrub();
  if (m === 'main' && !S.draw.wps.length) setSheet('min');
  render();
  fitCurrent(true);
}
function fitCurrent(soft) {
  const ctx = activeCtx();
  const r = ctx && routeOf(ctx);
  if (r) return fitPts(r.pts);
  if (S.mode === 'course' && S.race) return fitPts(S.race.pts);
  if (!soft && S.start) focusPoint(S.start.p, 14);
}

/* --- Carte --- */
function onMapClick(e) {
  const p = [round(e.latlng.lng, 6), round(e.latlng.lat, 6)];
  if (S.ui.layers) { S.ui.layers = false; render(); return; }
  if (S.ui.pick === 'start') {
    S.ui.pick = null;
    setStart({ p, label: 'Point sur la carte', src: 'map' });
    if (S.ui.sheet === 'min') setSheet('mid');
    render();
    return;
  }
  if (S.mode === 'main') addWaypoint(p);
}
function locateMe(center) {
  if (!navigator.geolocation) { toast('Position indisponible sur cet appareil'); return Promise.resolve(null); }
  S.ui.locating = true;
  render();
  return new Promise((res) => {
    navigator.geolocation.getCurrentPosition((pos) => {
      S.ui.locating = false;
      S.me = [round(pos.coords.longitude, 6), round(pos.coords.latitude, 6)];
      if (center) focusPoint(S.me, 15);
      render();
      res(S.me);
    }, (err) => {
      S.ui.locating = false;
      toast(err.code === 1 ? 'Autorise la localisation pour utiliser ta position' : 'Position introuvable pour le moment');
      res(null);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}

/* --- Départ --- */
function setStart(st) {
  S.start = st;
  saveStart();
  if (S.gen.results.length) { S.gen.results = []; S.gen.sel = 0; }
  S.gen.err = null;
  S.gen.seed = 0;
  focusPoint(st.p, Math.max(MAP.m ? MAP.m.getZoom() : 13, 13));
  render();
}
async function startFromGPS() {
  const p = await locateMe(false);
  if (p) setStart({ p, label: 'Ma position', src: 'gps' });
}
function startFromPlace(id) {
  const pl = S.settings.places.find((x) => x.id === id);
  if (pl) setStart({ p: pl.p, label: pl.name, src: 'place', placeId: pl.id });
}
function savePlace() {
  const name = S.ui.placeName.trim().slice(0, 30);
  if (!name || !S.start) return;
  const pl = { id: uid('p'), name, p: S.start.p };
  S.settings.places.push(pl);
  saveSettings();
  S.start = Object.assign({}, S.start, { label: name, src: 'place', placeId: pl.id });
  saveStart();
  S.ui.modal = null;
  S.ui.placeName = '';
  toast(`« ${name} » enregistré`);
}
const doSearch = debounce(async () => {
  const s = S.ui.search;
  const q = s.q;
  if (q.trim().length < 3) { s.res = []; s.busy = false; render(); return; }
  s.busy = true;
  render();
  const c = MAP.m ? MAP.m.getCenter() : null;
  const res = await geocode(q, c ? [c.lng, c.lat] : null);
  if (S.ui.search.q !== q) return;
  s.res = res;
  s.busy = false;
  render();
}, 380);

/* --- Cible --- */
function setManual(patch) {
  S.manual = Object.assign({}, S.manual, patch);
  for (const k of Object.keys(S.manual)) if (S.manual[k] == null) delete S.manual[k];
  saveManual();
  S.gen.err = null;
  render();
}

/* --- Génération --- */
function stepper(store, token, tokenKey) {
  return { step: (t, p) => { if (store[tokenKey] !== token) return; store.step = t; store.pct = p; renderSoon(); } };
}
async function runGenerate(again) {
  if (!S.start) { toast('Choisis d\'abord un départ'); return; }
  const g = S.gen;
  if (again) g.seed = (g.seed || 0) + 1;
  const prev = again ? g.results.map((r) => r.pts) : [];
  const spec = currentSpec();
  spec.avoid = prev;
  spec.avoidClimbs = again ? g.results.filter((r) => r.climbSeg).map((r) => r.climbSeg.pts[0]) : [];
  const token = ++g.token;
  Object.assign(g, { busy: true, step: 'Préparation', pct: 0.02, err: null, results: [], sel: 0 });
  S.ui.edit = false;
  if (S.ui.sheet === 'min') setSheet('mid');
  render();
  try {
    const res = spec.mode === 'cote' ? await generateClimbs(spec, S.start.p, stepper(g, token, 'token')) : await generateLoops(spec, S.start.p, stepper(g, token, 'token'));
    if (token !== g.token) return;
    const sess = sessionMeta();
    res.forEach((r, i) => {
      r.session = sess;
      r.name = r.kind === 'cote' ? `Côte ${'ABC'[i]}` : r.kind === 'ar' ? `Aller-retour ${'ABC'[i]}` : `Boucle ${'ABC'[i]}`;
    });
    Object.assign(g, { busy: false, results: res, sel: 0 });
    render();
    scrollPanelTop();
    fitPts(res[0].pts);
    nameRoutes(res, token);
  } catch (e) {
    if (token !== g.token) return;
    Object.assign(g, { busy: false, err: friendly(e) });
    render();
  }
}
async function nameRoutes(list, token) {
  for (const r of list) {
    let p;
    if (r.climbSeg) p = r.climbSeg.pts[r.climbSeg.pts.length - 1];
    else { let k = 0; for (let i = 1; i < r.z.length; i++) if (r.z[i] > r.z[k]) k = i; p = r.pts[k]; }
    const n = await placeName(p);
    if (S.gen.token !== token || !n) continue;
    const short = n.length > 26 ? n.slice(0, 25) + '…' : n;
    r.name = r.kind === 'cote' ? `Côte vers ${short}` : `Par ${short}`;
    render();
  }
}
function selectResult(ctx, i) {
  if (ctx === 'gen') S.gen.sel = i;
  if (ctx === 'race') S.rplan.sel = i;
  hideScrub();
  render();
  const r = routeOf(ctx);
  if (r && MAP.m && !MAP.m.getBounds().contains(L.latLngBounds(r.pts.map(ll2)))) fitPts(r.pts);
}
function replaceRoute(ctx, nr) {
  if (ctx === 'gen') S.gen.results[S.gen.sel] = nr;
  else if (ctx === 'race') S.rplan.results[S.rplan.sel] = nr;
  else if (ctx === 'draw') S.draw.route = nr;
  else if (ctx === 'view') S.view = nr;
}

/* --- Actions sur un parcours --- */
function exportGPX(ctx) {
  const r = routeOf(ctx || S.ui.gpxCtx);
  if (!r) return;
  const name = gpxFileName(r);
  downloadText(name, toGPX(r));
  S.ui.gpxName = name;
  S.ui.gpxCtx = ctx || S.ui.gpxCtx;
  S.ui.modal = 'gpx';
  render();
}
function saveRoute(ctx) {
  const r = routeOf(ctx);
  if (!r || isSaved(r)) return;
  r.at = nowISO();
  S.saved.unshift(packRoute(r));
  saveSaved();
  toast('Parcours enregistré', 3200, 'mode-mes', 'Voir');
}
function reverseRoute(ctx) {
  const r = routeOf(ctx);
  if (!r) return;
  const n = r.pts.length;
  const nat = r.nat ? r.nat.slice(0, n - 1).reverse().concat([r.nat[0]]) : null;
  const nr = finishRoute({
    kind: r.kind, name: r.name, session: r.session, race: r.race, climb: r.climb, overlap: r.overlap, target: r.target, start: r.start,
    pts: r.pts.slice().reverse(), z: r.z.slice().reverse(), nat, wps: r.wps ? r.wps.slice().reverse() : null, marks: r.marks, prov: r.prov,
  });
  if (r.climbSeg) nr.climbSeg = r.climbSeg;
  if (r.target) nr.fit = fitFlags(nr, { D: r.target.D, H: r.target.H });
  replaceRoute(ctx, nr);
  render();
  toast('Sens inversé : le profil est retourné');
}
function natAlong(r, pts) {
  if (!r.nat) return pts.map(() => 0);
  return pts.map((p) => r.nat[nearestOn(r.pts, p, r.cum).i] || 0);
}
function nearestFrom(r, p, from) {
  const i0 = idxAt(r.cum, from);
  const sub = r.pts.slice(i0);
  const nn = nearestOn(sub, p);
  return Math.max(from, r.cum[i0] + nn.along);
}
function editRoute(ctx) {
  const r = routeOf(ctx);
  if (!r) return;
  let wps0 = r.wps && r.wps.length >= 2 ? r.wps : [r.pts[0], r.pts[r.pts.length - 1]];
  const along = [0];
  for (let k = 1; k < wps0.length - 1; k++) along.push(nearestFrom(r, wps0[k], along[along.length - 1]));
  along.push(r.dist);
  const wps = [r.pts[0]], legs = [];
  let prev = 0;
  for (let k = 1; k < along.length; k++) {
    if (along[k] - prev < 40 && k < along.length - 1) continue;
    const s = slicePath(r.pts, r.cum, prev, along[k], r.z);
    legs.push({ pts: s.pts, z: s.z, nat: natAlong(r, s.pts), follow: true });
    wps.push(s.pts[s.pts.length - 1]);
    prev = along[k];
  }
  S.draw = { wps, legs, follow: true, busy: 0, sel: null, route: null, err: null, ver: 0, from: r };
  rebuildDraw();
  S.mode = 'main';
  S.ui.pick = null;
  render();
  toast('Fais glisser les points pour modifier le parcours');
}

/* --- Tracé à la main --- */
function legKey(a, b, follow) { return ll(a) + '>' + ll(b) + (follow ? 's' : 'd'); }
async function computeLeg(i) {
  const d = S.draw;
  const a = d.wps[i], b = d.wps[i + 1];
  if (!a || !b) return;
  const follow = d.legs[i] && d.legs[i].follow != null ? d.legs[i].follow : d.follow;
  const key = legKey(a, b, follow);
  d.legs[i] = { key, pending: true, follow, pts: [a, b], z: null, nat: [0, 0] };
  d.busy++;
  render();
  try {
    const prov = providerFor(a);
    let leg;
    if (follow) {
      const raw = await routeVia([a, b], { prov, terrain: 'sentiers' });
      const t = trimSpurs(raw.pts, raw.z ? [raw.nat, raw.z] : [raw.nat]);
      const pts = t.pts.slice(), nat = t.attrs[0].slice();
      // relie exactement les points posés à la main au chemin trouvé
      if (hav(pts[0], a) > 3) { pts.unshift(a); nat.unshift(0); }
      if (hav(pts[pts.length - 1], b) > 3) { pts.push(b); nat.push(0); }
      const z = await zFor(pts, raw.prov, null);
      leg = { key, follow, pts, z, nat };
    } else {
      const n = Math.max(2, Math.ceil(hav(a, b) / 25) + 1);
      const pts = [];
      for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / (n - 1), a[1] + ((b[1] - a[1]) * k) / (n - 1)]);
      const z = await zFor(pts, prov, null);
      leg = { key, follow, pts, z, nat: pts.map(() => 0) };
    }
    const cur = S.draw.legs[i];
    if (S.draw === d && cur && cur.key === key) { d.legs[i] = leg; d.err = null; }
  } catch (e) {
    const cur = d.legs[i];
    if (cur && cur.key === key) { d.legs[i] = null; d.err = friendly(e); }
  } finally {
    d.busy--;
    if (S.draw === d) { rebuildDraw(); render(); }
  }
}
function rebuildDraw() {
  const d = S.draw;
  if (d.wps.length < 2 || d.legs.some((l) => !l || l.pending || !l.z)) {
    if (d.wps.length < 2) d.route = null;
    return;
  }
  const pts = [], z = [], nat = [];
  d.legs.forEach((l, k) => {
    for (let i = k ? 1 : 0; i < l.pts.length; i++) { pts.push(l.pts[i]); z.push(l.z[i]); nat.push(l.nat[i] || 0); }
  });
  if (pts.length < 2) { d.route = null; return; }
  const prev = d.route;
  d.route = finishRoute({ kind: 'main', pts, z, nat, wps: d.wps.slice(), name: prev && prev.name ? prev.name : d.from ? d.from.name + ' (modifié)' : 'Tracé à la main', session: sessionMeta() });
  if (d.from && d.from.target) d.route.target = d.from.target;
}
function addWaypoint(p) {
  const d = S.draw;
  const n = d.wps.length;
  if (n > 2 && samePt(d.wps[0], d.wps[n - 1], 2)) { toast('Boucle fermée : annule le dernier point pour continuer'); return; }
  d.wps.push(p);
  d.sel = null;
  if (n >= 1) { d.legs.push(null); computeLeg(n - 1); }
  else render();
}
function moveWaypoint(i, p) {
  const d = S.draw;
  const closed = d.wps.length > 2 && samePt(d.wps[0], d.wps[d.wps.length - 1], 2);
  d.wps[i] = p;
  if (i === 0 && closed) d.wps[d.wps.length - 1] = p;
  if (i > 0) computeLeg(i - 1);
  if (i < d.wps.length - 1) computeLeg(i);
  if (i === 0 && closed) computeLeg(d.wps.length - 2);
}
function selectWaypoint(i) { S.draw.sel = S.draw.sel === i ? null : i; render(); }
function deleteWaypoint() {
  const d = S.draw;
  const i = d.sel;
  if (i == null) return;
  d.sel = null;
  if (d.wps.length <= 2) { clearDraw(); return; }
  d.wps.splice(i, 1);
  if (i === 0) { d.legs.splice(0, 1); }
  else if (i >= d.wps.length) { d.legs.splice(i - 1, 1); }
  else { d.legs.splice(i - 1, 2, null); computeLeg(i - 1); }
  rebuildDraw();
  render();
}
function undoDraw() {
  const d = S.draw;
  if (!d.wps.length) return;
  d.wps.pop();
  d.legs.pop();
  d.sel = null;
  rebuildDraw();
  if (d.wps.length < 2) d.route = null;
  render();
}
function clearDraw() { S.draw = { wps: [], legs: [], follow: S.draw.follow, busy: 0, sel: null, route: null, err: null, ver: 0 }; render(); }
function loopDraw() {
  const d = S.draw;
  if (d.wps.length < 2) return;
  d.wps.push(d.wps[0]);
  d.legs.push(null);
  computeLeg(d.wps.length - 2);
}
function outbackDraw() {
  const d = S.draw;
  if (d.wps.length < 2 || d.legs.some((l) => !l || l.pending)) { toast('Patiente, le tracé se calcule'); return; }
  const back = d.legs.slice().reverse().map((l) => ({ key: 'rev' + l.key, follow: l.follow, pts: l.pts.slice().reverse(), z: l.z.slice().reverse(), nat: l.nat.slice().reverse() }));
  const wb = d.wps.slice(0, -1).reverse();
  d.wps.push(...wb);
  d.legs.push(...back);
  rebuildDraw();
  render();
}

/* --- Course --- */
async function importRace(file) {
  if (!file) return;
  S.ui.raceBusy = true;
  render();
  try {
    const txt = await file.text();
    const g = parseGPX(txt);
    const rc = await makeRace(g.name || file.name.replace(/\.gpx$/i, ''), g.pts);
    S.race = rc;
    saveRace();
    Object.assign(S.rplan, { results: [], sel: 0, a: null, b: null, err: null });
    S.ui.raceBusy = false;
    render();
    fitPts(rc.pts);
    toast(`Course importée : ${fmtKm1(rc.dist)} · ${fmtNum(rc.dplus)} m D+`);
  } catch (e) {
    S.ui.raceBusy = false;
    toast(friendly(e), 5000);
    render();
  }
}
async function runRacePlan(manual) {
  if (!S.race) return;
  const spec = currentSpec();
  const how = S.rplan.how === 'cote' && !spec.climb ? 'ar' : S.rplan.how;
  const P = S.rplan;
  const token = ++P.token;
  Object.assign(P, { busy: true, step: 'Analyse du parcours', pct: 0.05, err: null, results: [], sel: 0 });
  render();
  try {
    let res;
    if (manual) {
      const a = P.a * 1000, b = P.b * 1000;
      const ia = raceIdx(S.race, a), ib = raceIdx(S.race, b);
      const avg = (S.race.prof.z[ib] - S.race.prof.z[ia]) / Math.max(1, b - a);
      const r = await raceRoute(S.race, { how, a, b, avg }, spec);
      r.fit = fitFlags(r, spec);
      r.slot = 0;
      res = [r];
    } else res = await racePlans(S.race, spec, how, stepper(P, token, 'token'));
    if (token !== P.token) return;
    const sess = sessionMeta();
    res.forEach((r) => { r.session = sess; });
    Object.assign(P, { busy: false, results: res, sel: 0 });
    render();
    const rc = document.querySelector('.rcards');
    if (rc) rc.scrollIntoView({ block: 'start', behavior: 'smooth' });
    fitPts(res[0].pts);
  } catch (e) {
    if (token !== P.token) return;
    Object.assign(P, { busy: false, err: friendly(e) });
    render();
  }
}

/* --- Profil : lecture au doigt --- */
function profRoute(el) {
  const id = el.dataset.rid;
  if (id === 'race') return S.race ? { pts: S.race.pts, cum: S.race.cum, prof: S.race.prof } : null;
  const all = [...S.gen.results, ...S.rplan.results, S.draw.route, S.view].filter(Boolean);
  return all.find((r) => r.id === id) || null;
}
function scrubAt(el, clientX) {
  const r = profRoute(el);
  if (!r) return;
  const P = r.prof;
  const svg = el.querySelector('svg');
  const box = svg.getBoundingClientRect();
  const W = Number(el.dataset.w), L0 = Number(el.dataset.l0);
  const vx = clamp(((clientX - box.left) / box.width) * W, L0, W - 2);
  const d = ((vx - L0) / (W - L0 - 2)) * P.len;
  const i = clamp(Math.round(d / P.step), 0, P.z.length - 1);
  const gr = grades(P)[i];
  const z0 = Math.floor(P.zmin / 10) * 10, z1 = Math.max(Math.ceil(P.zmax / 10) * 10, z0 + 40);
  const vy = 6 + (1 - (P.z[i] - z0) / (z1 - z0)) * (132 - 6 - 18);
  const cross = svg.querySelector('[data-cross]'), dot = svg.querySelector('[data-dot]');
  cross.setAttribute('x1', vx); cross.setAttribute('x2', vx); cross.setAttribute('visibility', 'visible');
  dot.setAttribute('cx', vx); dot.setAttribute('cy', vy); dot.setAttribute('visibility', 'visible');
  const b = el.querySelector('.bubble');
  b.hidden = false;
  b.textContent = `km ${String(round(P.d[i] / 1000, 2)).replace('.', ',')} · ${fmtNum(P.z[i])} m · ${gr >= 0 ? '+' : '−'}${Math.abs(Math.round(gr * 100))} %`;
  b.style.left = clamp(((vx / W) * box.width), 60, box.width - 60) + 'px';
  showScrub(pointAt(r.pts, r.cum, P.d[i]));
}
function scrubEnd(el) {
  const svg = el.querySelector('svg');
  svg.querySelector('[data-cross]')?.setAttribute('visibility', 'hidden');
  svg.querySelector('[data-dot]')?.setAttribute('visibility', 'hidden');
  const b = el.querySelector('.bubble');
  if (b) b.hidden = true;
  hideScrub();
}

/* --- Table des actions --- */
const ACTIONS = {
  mode: (d) => setMode(d.mode),
  'mode-mes': () => { S.ui.toast = null; setMode('mes'); },
  'sheet-cycle': () => { if (Date.now() - suppressClick > 400) cycleSheet(); },
  settings: () => { S.ui.modal = 'settings'; S.ui.layers = false; render(); },
  'modal-close': () => { S.ui.modal = null; render(); },
  layers: () => { S.ui.layers = !S.ui.layers; render(); },
  'layer-set': (d) => { S.settings.layer = d.id; saveSettings(); updateBase(true); S.ui.layers = false; render(); },
  locate: () => locateMe(true),
  fit: () => fitCurrent(),
  fold: (d) => { S.ui.folds[d.key] = !S.ui.folds[d.key]; render(); },
  'start-gps': () => startFromGPS(),
  'start-place': (d) => startFromPlace(d.id),
  'start-pick': () => { S.ui.pick = S.ui.pick === 'start' ? null : 'start'; if (S.ui.pick && S.ui.sheet !== 'min') setSheet('min'); render(); },
  'pick-cancel': () => { S.ui.pick = null; setSheet('mid'); render(); },
  'start-search': () => { S.ui.modal = 'search'; S.ui.search = { q: '', busy: false, res: [] }; render(); },
  'search-pick': (d) => { const x = S.ui.search.res[Number(d.i)]; if (!x) return; S.ui.modal = null; setStart({ p: x.p, label: x.label, src: 'search' }); },
  'place-save': () => { S.ui.modal = 'place'; S.ui.placeName = ''; render(); },
  'place-name': (d) => { S.ui.placeName = d.v; render(); },
  'place-confirm': () => savePlace(),
  'place-del': (d) => { S.settings.places = S.settings.places.filter((p) => p.id !== d.id); saveSettings(); if (S.start && S.start.placeId === d.id) { S.start = Object.assign({}, S.start, { src: 'map', placeId: null, label: 'Point sur la carte' }); saveStart(); } render(); },
  'type-set': (d) => setManual({ type: d.type, climb: null, noClimb: null }),
  'shape-set': (d) => setManual({ shape: d.v }),
  'terrain-set': (d) => setManual({ terrain: d.v }),
  'climb-off': () => setManual({ noClimb: true }),
  'climb-on': () => setManual({ noClimb: null }),
  'reps-toggle': () => setManual({ includeReps: S.manual.includeReps === false ? null : false }),
  generate: () => runGenerate(false),
  regen: () => runGenerate(true),
  'gen-cancel': () => { S.gen.token++; S.gen.busy = false; render(); },
  'edit-inputs': () => { S.ui.edit = true; render(); },
  'edit-done': () => { S.ui.edit = false; render(); },
  'pick-result': (d) => selectResult(d.ctx, Number(d.i)),
  gpx: (d) => exportGPX(d.ctx),
  'gpx-again': () => exportGPX(S.ui.gpxCtx),
  'save-route': (d) => saveRoute(d.ctx),
  'edit-route': (d) => editRoute(d.ctx),
  reverse: (d) => reverseRoute(d.ctx),
  'draw-follow': () => { S.draw.follow = !S.draw.follow; render(); },
  'draw-undo': () => undoDraw(),
  'draw-loop': () => loopDraw(),
  'draw-outback': () => outbackDraw(),
  'draw-clear': () => clearDraw(),
  'draw-del': () => deleteWaypoint(),
  'race-remove': () => { S.race = null; saveRace(); Object.assign(S.rplan, { results: [], a: null, b: null }); render(); },
  'race-how': (d) => { S.rplan.how = d.v; S.rplan.results = []; S.rplan.err = null; render(); },
  'race-plan': () => runRacePlan(false),
  'race-manual': () => runRacePlan(true),
  'open-saved': (d) => { const o = S.saved.find((x) => x.id === d.id); if (!o) return; try { S.view = unpackRoute(o); } catch (e) { toast('Parcours illisible'); return; } render(); fitPts(S.view.pts); },
  'view-close': () => { S.view = null; render(); },
  'del-saved': (d) => { S.saved = S.saved.filter((o) => o.id !== d.id); saveSaved(); S.view = null; render(); toast('Parcours supprimé'); },
  'set-engine': (d) => { S.settings.engine = d.v; saveSettings(); render(); },
  'set-theme': (d) => { S.settings.theme = d.v; saveSettings(); applyTheme(); MAP.sig = {}; render(); },
  'ors-test': async () => {
    S.ui.orsMsg = 'Test en cours…'; S.ui.orsOk = null; render();
    try { const ok = await testOrsKey(S.settings.orsKey); S.ui.orsOk = ok; S.ui.orsMsg = ok ? 'Clé valide ✓' : 'Réponse inattendue'; }
    catch (e) { S.ui.orsOk = false; S.ui.orsMsg = e.status === 401 || e.status === 403 ? 'Clé refusée' : friendly(e); }
    render();
  },
};
const INPUTS = {
  km: (v) => { const x = num(v); if (x && x > 0.2 && x < 200) setManual({ km: x }); },
  dp: (v) => { const x = num(v); if (x != null && x >= 0 && x < 9000) setManual({ dp: x }); },
  reps: (v) => { const x = num(v); const cl = currentSpec().climb; if (cl && x && x >= 1 && x <= 30) setManual({ climb: Object.assign({}, cl, { reps: Math.round(x) }) }); },
  clen: (v) => { const x = num(v); const cl = currentSpec().climb; if (cl && x && x >= 50 && x <= 5000) setManual({ climb: Object.assign({}, cl, { len: x }) }); },
  cgrade: (v) => {
    const m = /^\s*(\d{1,2}(?:[.,]\d)?)\s*(?:[-–à]\s*(\d{1,2}(?:[.,]\d)?))?\s*%?\s*$/.exec(v);
    const cl = currentSpec().climb;
    if (!m || !cl) return;
    let a = num(m[1]) / 100, b = m[2] ? num(m[2]) / 100 : a;
    if (a > b) [a, b] = [b, a];
    if (a >= 0.02 && b <= 0.35) setManual({ climb: Object.assign({}, cl, { g: [a, b] }) });
  },
  q: (v) => { S.ui.search.q = v; doSearch(); },
  placeName: (v) => { S.ui.placeName = v; render(); },
  orsKey: (v) => { S.settings.orsKey = v.trim(); saveSettings(); S.ui.orsMsg = null; },
  pace: (v) => { const s = parseChrono(v); if (s && s >= 150 && s <= 900) { S.settings.pace = s / 60; saveSettings(); } },
  ra: (v) => { S.rplan.a = num(v); if (S.rplan.b != null && S.rplan.a > S.rplan.b) S.rplan.b = S.rplan.a; renderSoon(); },
  rb: (v) => { S.rplan.b = num(v); if (S.rplan.a != null && S.rplan.b < S.rplan.a) S.rplan.a = S.rplan.b; if (S.rplan.a == null) S.rplan.a = 0; renderSoon(); },
};
function bindEvents() {
  const app = document.getElementById('app');
  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset, el); }
  });
  app.addEventListener('input', (e) => {
    const el = e.target.closest('[data-in]');
    if (el && INPUTS[el.dataset.in]) INPUTS[el.dataset.in](el.value, el);
  });
  app.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('input[type=file][data-file=race]')) { importRace(el.files && el.files[0]); el.value = ''; }
    if (el.matches('[data-in=km],[data-in=dp],[data-in=reps],[data-in=clen],[data-in=cgrade],[data-in=pace]')) render();
  });
  app.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-in=placeName]')) savePlace();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (S.ui.modal) S.ui.modal = null; else if (S.ui.pick) S.ui.pick = null; else if (S.ui.layers) S.ui.layers = false; else return;
    render();
  });
  // lecture du profil au doigt / à la souris
  let scrubEl = null;
  app.addEventListener('pointerdown', (e) => { const el = e.target.closest('.prof'); if (el) { scrubEl = el; scrubAt(el, e.clientX); } });
  app.addEventListener('pointermove', (e) => {
    const el = e.target.closest('.prof');
    if (el && (e.pointerType === 'mouse' || scrubEl === el)) scrubAt(el, e.clientX);
  });
  const stop = (e) => { if (scrubEl) { const el = scrubEl; scrubEl = null; if (e.pointerType !== 'mouse') setTimeout(() => scrubEnd(el), 1400); } };
  app.addEventListener('pointerup', stop);
  app.addEventListener('pointercancel', stop);
  app.addEventListener('pointerout', (e) => { const el = e.target.closest('.prof'); if (el && e.pointerType === 'mouse' && !el.contains(e.relatedTarget)) scrubEnd(el); });
  bindSheetDrag();
  window.addEventListener('resize', debounce(() => { applySheet(); }, 150));
  window.addEventListener('hashchange', () => { const h = readHash(); if (h.brief) { loadBrief(h.brief); render(); } });
}
