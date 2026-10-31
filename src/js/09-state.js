/* =========================================================================
   État de l'Atelier et enregistrement local (tout reste sur l'appareil).
   ========================================================================= */

const APP_VERSION = '__VERSION__';
const CAIRN_URL = 'https://claude.ai/artifact/17z7YGzWzaqGGUbwNtn7N4';
const LS = { settings: 'atelier:settings', saved: 'atelier:saved', race: 'atelier:race', start: 'atelier:start', brief: 'atelier:brief', manual: 'atelier:manual', view: 'atelier:view' };

const S = {
  brief: null,
  mode: 'seance',
  manual: {},
  start: null,
  gen: { busy: false, step: '', pct: 0, err: null, results: [], sel: 0, token: 0, seed: 0 },
  draw: { wps: [], legs: [], follow: true, busy: 0, sel: null, route: null, err: null, ver: 0 },
  race: null,
  rplan: { how: 'ar', busy: false, step: '', pct: 0, err: null, results: [], sel: 0, a: null, b: null, token: 0 },
  saved: [],
  view: null,
  settings: { engine: 'auto', orsKey: '', layer: 'auto', theme: 'auto', pace: 6.5, places: [] },
  ui: { sheet: 'mid', modal: null, pick: null, layers: false, toast: null, edit: false, folds: {}, search: { q: '', busy: false, res: [] }, placeName: '', locating: false, raceBusy: false },
  me: null,
};

function loadAll() {
  S.settings = Object.assign(S.settings, lsJSON(LS.settings, {}));
  if (!Array.isArray(S.settings.places)) S.settings.places = [];
  S.saved = lsJSON(LS.saved, []).filter((o) => o && o.poly);
  S.start = lsJSON(LS.start, null);
  const rc = lsJSON(LS.race, null);
  if (rc && rc.poly) { try { S.race = unpackRace(rc); } catch (e) { S.race = null; } }
}
function saveSettings() { lsPut(LS.settings, S.settings); }
function saveStart() { lsPut(LS.start, S.start); }
function saveSaved() { lsPut(LS.saved, S.saved); }
function saveManual() { lsPut(LS.manual, Object.assign({ briefId: S.brief ? S.brief.id : null }, S.manual)); }

/* --- Cible courante --- */
function currentSpec() {
  const sp = specFrom(S.brief, S.manual);
  sp.includeReps = S.manual.includeReps !== false;
  sp.seed = S.gen.seed || 0;
  return sp;
}
function sessionMeta() {
  const b = S.brief;
  return b ? { id: b.id, date: b.date, title: b.title, type: b.type } : null;
}

/* --- Parcours : compactage pour l'enregistrement --- */
function rle(arr) { const out = []; for (const v of arr || []) { const l = out[out.length - 1]; if (l && l[0] === v) l[1]++; else out.push([v, 1]); } return out; }
function unrle(r) { const out = []; for (const [v, n] of r || []) for (let i = 0; i < n; i++) out.push(v); return out; }
function packRoute(r) {
  return {
    id: r.id, name: r.name, kind: r.kind, at: r.at || nowISO(), session: r.session || null,
    poly: encodePolyline(r.pts), z: encodeInts(r.z.map((v) => v * 10)), nat: rle(r.nat || []),
    wps: r.wps ? encodePolyline(r.wps) : '', marks: r.marks || [], climb: r.climb || null,
    climbSeg: r.climbSeg ? encodePolyline(r.climbSeg.pts) : '', race: r.race || null, overlap: r.overlap,
    dist: r.dist, dplus: r.dplus,
  };
}
function unpackRoute(o) {
  const pts = decodePolyline(o.poly);
  const z = decodeInts(o.z).map((v) => v / 10);
  if (z.length !== pts.length) throw new Error('parcours abîmé');
  const nat = unrle(o.nat);
  const r = finishRoute({ id: o.id, name: o.name, kind: o.kind, at: o.at, session: o.session, pts, z, nat: nat.length === pts.length ? nat : null, wps: o.wps ? decodePolyline(o.wps) : null, marks: o.marks || [], climb: o.climb, race: o.race, overlap: o.overlap });
  if (o.climbSeg) r.climbSeg = { pts: decodePolyline(o.climbSeg) };
  r.savedAt = o.at;
  return r;
}
function packRace(rc) { return { name: rc.name, at: rc.at, poly: encodePolyline(rc.pts), z: encodeInts(rc.z.map((v) => v * 10)) }; }
function unpackRace(o) {
  const pts = decodePolyline(o.poly);
  const z = decodeInts(o.z).map((v) => v / 10);
  return enrichRace({ name: o.name, at: o.at, pts, z: z.length === pts.length ? z : pts.map(() => 0) });
}
function saveRace() {
  if (S.race) lsPut(LS.race, packRace(S.race));
  else { try { localStorage.removeItem(LS.race); } catch (e) { /* rien */ } }
}
function isSaved(r) { return !!(r && S.saved.some((o) => o.id === r.id)); }

/* --- Parcours affiché selon le contexte --- */
function routeOf(ctx) {
  if (ctx === 'gen') return S.gen.results[S.gen.sel] || null;
  if (ctx === 'race') return S.rplan.results[S.rplan.sel] || null;
  if (ctx === 'draw') return S.draw.route;
  if (ctx === 'view') return S.view;
  return null;
}
function activeCtx() {
  if (S.mode === 'seance') return S.gen.results.length ? 'gen' : null;
  if (S.mode === 'main') return S.draw.route ? 'draw' : null;
  if (S.mode === 'course') return S.rplan.results.length ? 'race' : null;
  if (S.mode === 'mes') return S.view ? 'view' : null;
  return null;
}
function friendly(e) {
  if (!e) return 'Erreur inconnue';
  if (e.code === 'network') return 'Pas de réponse du service de cartes. Vérifie ta connexion et réessaie.';
  if (e.code === 'timeout') return 'Le service de cartes met trop de temps à répondre. Réessaie dans un instant.';
  if (e.status === 401 || e.status === 403) return 'Clé OpenRouteService refusée. Vérifie-la dans les réglages.';
  if (e.status === 429) return 'Trop de demandes d\'un coup. Patiente une minute et réessaie.';
  return e.message || String(e);
}
