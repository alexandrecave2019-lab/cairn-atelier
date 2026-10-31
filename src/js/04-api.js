/* =========================================================================
   Services : itinéraire piéton, altitude, recherche d'adresse.
   France : Géoplateforme IGN (sans clé). Ailleurs : OpenRouteService (clé gratuite).
   ========================================================================= */

const API = { ign: 'https://data.geopf.fr', ors: 'https://api.openrouteservice.org' };

function makeLimiter(perSec, conc) {
  const q = [];
  let active = 0, last = 0, timer = null;
  const pump = () => {
    timer = null;
    while (q.length && active < conc) {
      const wait = last + 1000 / perSec - Date.now();
      if (wait > 0) { if (!timer) timer = setTimeout(pump, wait); return; }
      last = Date.now();
      active++;
      const { fn, res, rej } = q.shift();
      Promise.resolve().then(fn).then(res, rej).finally(() => { active--; pump(); });
    }
  };
  return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); pump(); });
}
const LIM = { ign: makeLimiter(4, 3), ors: makeLimiter(0.6, 2) };

class ApiError extends Error {
  constructor(msg, code, status) { super(msg); this.code = code; this.status = status; }
}
async function fetchJSON(url, init, o = {}) {
  const lim = o.lim || ((f) => f());
  const retries = o.retries ?? 2;
  for (let a = 0; ; a++) {
    try {
      return await lim(async () => {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), o.timeout || 30000);
        try {
          const r = await fetch(url, Object.assign({}, init || {}, { signal: ctl.signal }));
          const txt = await r.text();
          let j = null;
          try { j = JSON.parse(txt); } catch (e) { /* réponse non JSON */ }
          if (!r.ok) {
            const m = (j && (j.message || (j.error && (j.error.message || j.error)) || j.detail)) || txt.slice(0, 160) || 'HTTP ' + r.status;
            throw new ApiError(typeof m === 'string' ? m : JSON.stringify(m), 'http', r.status);
          }
          if (j == null) throw new ApiError('Réponse illisible du service', 'parse', r.status);
          return j;
        } catch (e) {
          if (e.name === 'AbortError') throw new ApiError('Le service met trop de temps à répondre', 'timeout');
          if (e instanceof ApiError) throw e;
          throw new ApiError('Service injoignable (connexion ?)', 'network');
        } finally { clearTimeout(t); }
      });
    } catch (e) {
      const transient = e.code === 'timeout' || e.code === 'network' || e.status === 429 || (e.status >= 500);
      if (a >= retries || !transient) throw e;
      await sleep(700 * (a + 1) + (e.status === 429 ? 1800 : 0));
    }
  }
}

/* --- Choix du moteur --- */
function providerFor(p) {
  const eng = S.settings.engine;
  if (eng === 'ign') return 'ign';
  if (eng === 'ors') return 'ors';
  return inFrance(p) ? 'ign' : 'ors';
}
function needKey(prov) { return prov === 'ors' && !S.settings.orsKey; }
const ll = (p) => round(p[0], 6) + ',' + round(p[1], 6);

/* Nature des voies : 1 sentier, 2 chemin / piste, 3 route, 0 inconnue */
function natIGN(n) {
  n = String(n || '').toLowerCase();
  if (!n) return 0;
  if (n.startsWith('sentier') || n.startsWith('escalier')) return 1;
  if (n.startsWith('chemin') || n.startsWith('route empierr') || n.startsWith('piste')) return 2;
  return 3;
}
function natORS(v) { return v === 4 || v === 7 || v === 8 ? 1 : v === 5 || v === 6 || v === 0 ? 2 : 3; }

/* --- Itinéraire --- */
const routeCache = new Map();
async function routeVia(pts, o = {}) {
  const prov = o.prov || providerFor(pts[0]);
  const key = prov + '|' + (o.terrain || '') + '|' + pts.map(ll).join(';');
  if (routeCache.has(key)) return routeCache.get(key);
  const p = (prov === 'ors' ? routeORS(pts, o) : routeIGN(pts, o)).catch((e) => { routeCache.delete(key); throw e; });
  routeCache.set(key, p);
  return p;
}
async function routeIGN(pts, o = {}) {
  const q = new URLSearchParams({
    resource: 'bdtopo-pgr', profile: 'pedestrian', optimization: 'shortest',
    start: ll(pts[0]), end: ll(pts[pts.length - 1]),
    geometryFormat: 'geojson', getSteps: 'true', getBbox: 'false', waysAttributes: 'nature',
    distanceUnit: 'meter', timeUnit: 'second', crs: 'EPSG:4326',
  });
  if (pts.length > 2) q.set('intermediates', pts.slice(1, -1).map(ll).join('|'));
  const avoid = o.terrain === 'sentiers' ? 4 : o.terrain === 'roulant' ? 2 : 3;
  const withC = new URLSearchParams(q);
  withC.set('constraints', JSON.stringify({ constraintType: 'avoid', key: 'importance', operator: '<=', value: avoid }));
  let j;
  try {
    j = await fetchJSON(API.ign + '/navigation/itineraire?' + withC.toString(), null, { lim: LIM.ign, timeout: 35000 });
  } catch (e) {
    if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) j = await fetchJSON(API.ign + '/navigation/itineraire?' + q.toString(), null, { lim: LIM.ign, timeout: 35000 });
    else throw e;
  }
  return parseIGN(j);
}
function parseIGN(j) {
  const coords = [], nat = [], legStart = [0];
  const add = (p, c) => {
    const n = coords.length;
    if (n && Math.abs(coords[n - 1][0] - p[0]) < 1e-7 && Math.abs(coords[n - 1][1] - p[1]) < 1e-7) { nat[n - 1] = c; return; }
    coords.push([p[0], p[1]]); nat.push(c);
  };
  const portions = j.portions || [];
  let any = false;
  portions.forEach((po, k) => {
    if (k > 0) legStart.push(Math.max(0, coords.length - 1));
    for (const st of po.steps || []) {
      const g = st.geometry && st.geometry.coordinates;
      if (!g || !g.length) continue;
      any = true;
      const c = natIGN(st.attributes && st.attributes.nature);
      for (const p of g) add(p, c);
    }
  });
  if (!any) {
    const g = (j.geometry && j.geometry.coordinates) || [];
    for (const p of g) add(p, 0);
  }
  if (coords.length < 2) throw new ApiError('Aucun itinéraire trouvé par ici', 'noroute');
  if (nat.length) nat[nat.length - 1] = nat[nat.length - 2] ?? 0;
  return { pts: coords, nat, z: null, legStart, prov: 'ign' };
}
async function routeORS(pts, o = {}) {
  const key = S.settings.orsKey;
  if (!key) throw new ApiError('Hors de France : ajoute ta clé OpenRouteService dans les réglages', 'key');
  const body = { coordinates: pts.map((p) => [round(p[0], 6), round(p[1], 6)]), elevation: true, instructions: false, extra_info: ['waytype'], preference: 'recommended', radiuses: pts.map(() => 2000) };
  const j = await fetchJSON(API.ors + '/v2/directions/foot-hiking/geojson', {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/json, application/geo+json' },
    body: JSON.stringify(body),
  }, { lim: LIM.ors, timeout: 35000 });
  return parseORS(j);
}
function parseORS(j) {
  const f = j.features && j.features[0];
  if (!f) throw new ApiError('Aucun itinéraire trouvé par ici', 'noroute');
  const c = f.geometry.coordinates;
  const nat = new Array(c.length).fill(0);
  const ex = f.properties && f.properties.extras && f.properties.extras.waytype;
  if (ex && ex.values) for (const [a, b, v] of ex.values) for (let i = a; i <= Math.min(b, c.length - 1); i++) nat[i] = natORS(v);
  const wp = (f.properties && f.properties.way_points) || [0, c.length - 1];
  return { pts: c.map((p) => [p[0], p[1]]), nat, z: c.map((p) => (p.length > 2 ? p[2] : null)), legStart: wp.slice(0, -1), prov: 'ors' };
}

/* --- Altitude --- */
let ignPostOK = true;
async function elevations(pts, prov) {
  prov = prov || providerFor(pts[0]);
  if (!pts.length) return [];
  return prov === 'ors' ? elevORS(pts) : elevIGN(pts);
}
async function elevIGN(pts) {
  const out = [];
  const url = API.ign + '/altimetrie/1.0/calcul/alti/rest/elevation.json';
  const fmt = (a, k) => a.map((p) => p[k].toFixed(6)).join('|');
  for (let i = 0; i < pts.length; ) {
    let chunk, j;
    if (ignPostOK) {
      chunk = pts.slice(i, i + 4800);
      try {
        j = await fetchJSON(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lon: fmt(chunk, 0), lat: fmt(chunk, 1), resource: 'ign_rge_alti_wld', delimiter: '|', indent: 'false', measures: 'false', zonly: 'true' }),
        }, { lim: LIM.ign });
      } catch (e) {
        if (e.code === 'network' || (e.status && e.status !== 429 && e.status < 500)) { ignPostOK = false; continue; }
        throw e;
      }
    } else {
      chunk = pts.slice(i, i + 110);
      j = await fetchJSON(url + '?' + new URLSearchParams({ lon: fmt(chunk, 0), lat: fmt(chunk, 1), resource: 'ign_rge_alti_wld', zonly: 'true' }), null, { lim: LIM.ign });
    }
    const z = (j.elevations || []).map((v) => (typeof v === 'object' ? v.z : v)).map(Number);
    if (z.length !== chunk.length) throw new ApiError('Altitudes incomplètes', 'parse');
    out.push(...z);
    i += chunk.length;
  }
  return fillGaps(out);
}
async function elevORS(pts) {
  const key = S.settings.orsKey;
  if (!key) throw new ApiError('Hors de France : ajoute ta clé OpenRouteService dans les réglages', 'key');
  const out = [];
  for (let i = 0; i < pts.length; i += 1900) {
    const chunk = pts.slice(i, i + 1900).map((p) => [round(p[0], 6), round(p[1], 6)]);
    const geom = chunk.length === 1 ? [chunk[0], chunk[0]] : chunk;
    const j = await fetchJSON(API.ors + '/elevation/line', {
      method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ format_in: 'polyline', format_out: 'polyline', geometry: geom }),
    }, { lim: LIM.ors });
    const g = (j.geometry || []).map((p) => p[2]);
    out.push(...g.slice(0, chunk.length));
  }
  return fillGaps(out);
}
function fillGaps(z) {
  const ok = (v) => Number.isFinite(v) && v > -1000;
  let last = z.find(ok) ?? 0;
  const out = z.slice();
  for (let i = 0; i < out.length; i++) {
    if (ok(out[i])) { last = out[i]; continue; }
    let k = i + 1;
    while (k < out.length && !ok(out[k])) k++;
    const next = k < out.length ? out[k] : last;
    for (let m = i; m < k; m++) out[m] = last + ((next - last) * (m - i + 1)) / (k - i + 1);
    i = k - 1;
  }
  return out;
}
/* Altitude de chaque sommet d'un tracé */
async function zFor(pts, prov, zKnown) {
  if (zKnown && zKnown.length === pts.length && zKnown.every((v) => Number.isFinite(v))) return zKnown;
  const cum = cumDist(pts);
  const L = cum[cum.length - 1];
  const step = Math.max(15, L / 4000);
  const rs = resample(pts, step, cum);
  const zs = await elevations(rs.pts, prov);
  return interp(rs.d, zs, cum);
}

/* --- Recherche de lieux --- */
async function geocode(q, near) {
  q = String(q || '').trim();
  if (q.length < 3) return [];
  const out = [];
  try {
    const p = new URLSearchParams({ q, limit: '6', index: 'address,poi' });
    if (near) { p.set('lat', round(near[1], 5)); p.set('lon', round(near[0], 5)); }
    const j = await fetchJSON(API.ign + '/geocodage/search?' + p.toString(), null, { lim: LIM.ign, retries: 1 });
    for (const f of j.features || []) {
      const pr = f.properties || {};
      const name = pr.label || pr.toponym || (Array.isArray(pr.name) ? pr.name[0] : pr.name);
      if (!name || !f.geometry) continue;
      const sub = [Array.isArray(pr.category) ? pr.category[pr.category.length - 1] : '', Array.isArray(pr.city) ? pr.city[0] : pr.city || (Array.isArray(pr.postcode) ? pr.postcode[0] : pr.postcode || '')].filter(Boolean).join(' · ');
      out.push({ label: name, sub, p: f.geometry.coordinates.slice(0, 2) });
    }
  } catch (e) { /* hors service : on tente ORS */ }
  if (!out.length && S.settings.orsKey) {
    try {
      const p = new URLSearchParams({ api_key: S.settings.orsKey, text: q, size: '6' });
      if (near) { p.set('focus.point.lon', near[0]); p.set('focus.point.lat', near[1]); }
      const j = await fetchJSON(API.ors + '/geocode/search?' + p.toString(), null, { lim: LIM.ors, retries: 1 });
      for (const f of j.features || []) out.push({ label: f.properties.name || f.properties.label, sub: f.properties.label, p: f.geometry.coordinates.slice(0, 2) });
    } catch (e) { /* rien */ }
  }
  return out;
}
/* Nom d'un lieu remarquable près d'un point (sommet, col, chapelle…) */
async function placeName(p) {
  if (!inFrance(p)) return null;
  try {
    const j = await fetchJSON(API.ign + '/geocodage/reverse?' + new URLSearchParams({ lon: round(p[0], 5), lat: round(p[1], 5), index: 'poi', limit: '6' }).toString(), null, { lim: LIM.ign, retries: 0, timeout: 8000 });
    const fs = (j.features || []).filter((f) => (f.properties.distance ?? 0) < 900);
    const nice = (f) => (f.properties.category || []).join(' ').match(/sommet|col|pic|orograph|crête|plateau|chapelle|lac|source|grotte|refuge|ruine/i);
    const f = fs.find(nice) || fs.find((x) => !(x.properties.category || []).includes('commune')) || fs[0];
    if (!f) return null;
    const pr = f.properties;
    return pr.toponym || (Array.isArray(pr.name) ? pr.name[0] : pr.name) || null;
  } catch (e) { return null; }
}
async function testOrsKey(key) {
  const j = await fetchJSON(API.ors + '/v2/directions/foot-hiking/geojson', {
    method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: [[8.681495, 49.41461], [8.687872, 49.420318]] }),
  }, { retries: 0, timeout: 15000 });
  return !!(j.features && j.features.length);
}
