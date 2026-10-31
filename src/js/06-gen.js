/* =========================================================================
   Génération : boucles calées sur la séance, allers-retours, côtes.
   Principe : on sonde le relief autour du départ, on pose des points de passage
   sur des cercles orientés vers le bon relief, on laisse le moteur suivre les
   sentiers, puis on mesure, on note et on ajuste la taille de la boucle.
   ========================================================================= */

/* --- Parcours : mesures communes --- */
async function buildRoute(raw, meta) {
  let pts = raw.pts, nat = raw.nat, z0 = raw.z;
  if (meta.trim !== false) {
    const t = trimSpurs(pts, z0 ? [nat, z0] : [nat]);
    pts = t.pts; nat = t.attrs[0]; z0 = z0 ? t.attrs[1] : null;
  }
  const z = await zFor(pts, raw.prov, z0);
  return finishRoute(Object.assign({ prov: raw.prov }, meta, { pts, nat, z }));
}
function finishRoute(r) {
  r.id = r.id || uid('r');
  const cum = cumDist(r.pts);
  const dist = cum[cum.length - 1];
  const prof = profileOf(r.pts, r.z);
  const by = [0, 0, 0, 0];
  for (let i = 0; i < r.pts.length - 1; i++) by[(r.nat && r.nat[i]) || 0] += cum[i + 1] - cum[i];
  const known = by[1] + by[2] + by[3];
  r.share = dist > 0 && known > dist * 0.3 ? { sentier: by[1] / dist, chemin: (by[2] + by[0]) / dist, route: by[3] / dist } : null;
  r.cum = cum;
  r.dist = dist;
  r.prof = prof;
  r.dplus = prof.dplus;
  r.dminus = prof.dminus;
  if (r.overlap == null) r.overlap = overlapShare(r.pts);
  r.climbs = findClimbs(prof);
  return r;
}
function scoreRoute(r, spec) {
  const eD = Math.abs(r.dist - spec.D) / spec.D;
  const eH = Math.abs(r.dplus - spec.H) / Math.max(spec.H, 80);
  const road = r.share ? (spec.terrain === 'roulant' ? r.share.route * 0.25 : spec.terrain === 'mixte' ? r.share.route * 0.6 : r.share.route) : 0.2;
  const ov = spec.shape === 'ar' ? 0 : r.overlap;
  return 2.2 * eD + 1.1 * Math.min(eH, 2) + 0.9 * road + 0.8 * ov;
}
function fitFlags(r, spec) {
  const eD = Math.abs(r.dist - spec.D) / spec.D;
  const dH = r.dplus - spec.H;
  return { dOk: eD <= 0.08, hOk: Math.abs(dH) <= Math.max(40, spec.H * 0.25), eD, dH };
}

/* --- Points de passage --- */
function circleWps(start, th, r, n, dir) {
  const c = dest(start, th, r);
  const out = [];
  for (let k = 1; k <= n; k++) out.push(dest(c, th + 180 + (dir * k * 360) / (n + 1), r));
  return out;
}
function teardropWps(start, p, scale) {
  const th = bearing(start, p), ds = hav(start, p);
  return [dest(start, th - 38, ds * 0.62 * scale), p, dest(start, th + 38, ds * 0.62 * scale)];
}

/* --- Boucles --- */
async function generateLoops(spec, start, ui) {
  const prov = providerFor(start);
  if (needKey(prov)) throw new ApiError('Hors de France : ajoute ta clé OpenRouteService dans les réglages', 'key');
  if (spec.shape === 'ar') return generateOutBack(spec, start, prov, ui);
  const D = spec.D, H = spec.H;
  // sinuosité des sentiers (mesurée sur l'IGN à la Sainte-Baume : ~1,5 ; l'ajustement corrige ensuite)
  const tau = spec.terrain === 'roulant' ? 1.3 : spec.terrain === 'mixte' ? 1.38 : 1.45;
  const r0 = clamp(D / (2 * Math.PI * tau), 150, 15000);
  ui.step('Lecture du relief autour du départ', 0.05);
  const DIRS = 12, K = 16;
  const probe = [];
  for (let i = 0; i < DIRS; i++) {
    const th = (i * 360) / DIRS;
    const c = dest(start, th, r0);
    for (let k = 0; k < K; k++) probe.push(dest(c, th + 180 + (k * 360) / K, r0));
  }
  let zs = null;
  try { zs = await elevations(probe, prov); } catch (e) { if (e.code === 'key') throw e; }
  const cands = [];
  for (let i = 0; i < DIRS; i++) {
    let est = null;
    if (zs) {
      const ring = zs.slice(i * K, i * K + K);
      est = 0;
      for (let k = 1; k <= K; k++) est += Math.max(0, ring[k % K] - ring[k - 1]);
      est *= 1.4;
    }
    const seed = spec.seed || 0;
    cands.push({ kind: 'circle', th: ((i * 360) / DIRS + seed * 17) % 360, est, dir: (i + seed) % 2 ? -1 : 1 });
  }
  const rank = (c) => (c.est == null ? 0 : Math.abs(c.est - H) / Math.max(H, 80));
  cands.sort((a, b) => rank(a) - rank(b));
  const queue = [];
  for (const c of cands) if (queue.every((o) => angDiff(o.th, c.th) >= 55)) queue.push(c);
  // Relief insuffisant pour le D+ visé : boucle en goutte d'eau par le point le plus haut accessible
  const bestEst = Math.max(...cands.map((c) => c.est || 0));
  if (zs && H > 120 && bestEst < H * 0.7) {
    const reach = (0.42 * D) / tau;
    let hi = null;
    probe.forEach((p, k) => { if (hav(start, p) <= reach && hav(start, p) > 300 && (!hi || zs[k] > hi.z)) hi = { p, z: zs[k] }; });
    if (hi) queue.splice(1, 0, { kind: 'summit', p: hi.p, th: bearing(start, hi.p), est: null });
  }
  const make = (c, scale) => {
    const wps = c.kind === 'summit' ? teardropWps(start, c.p, scale) : circleWps(start, c.th, r0 * scale, 3, c.dir);
    return routeVia([start, ...wps, start], { prov, terrain: spec.terrain })
      .then((raw) => buildRoute(raw, { kind: 'boucle', wps: [start, ...wps, start], gen: Object.assign({}, c, { scale }) }))
      .then((r) => { r.score = scoreRoute(r, spec); return r; });
  };
  const pool = [];
  let tried = 0, done = 0;
  const batch = async (list) => {
    tried += list.length;
    const res = await Promise.all(list.map((c) => make(c, 1).catch((e) => { if (e.code === 'key') throw e; return null; }).finally(() => { done++; ui.step(`Recherche des sentiers (${done}/${tried})`, 0.1 + 0.5 * (done / Math.max(tried, 6))); })));
    pool.push(...res.filter(Boolean));
  };
  const off = (spec.seed || 0) % 2 ? 2 : 0;
  await batch(queue.slice(off, off + 5));
  let picked = pickDistinct(pool, 3, spec.avoid);
  if (picked.length < 3 && queue.length > 5) { await batch(queue.filter((c) => !pool.some((r) => r.gen.th === c.th)).slice(0, 3)); picked = pickDistinct(pool, 3, spec.avoid); }
  if (!picked.length) throw new ApiError('Aucune boucle trouvée autour de ce départ. Essaie un autre point de départ.', 'noroute');
  ui.step('Ajustement de la distance', 0.65);
  let n = 0;
  const refined = await Promise.all(picked.map((r) => refineScale(r, spec, (s) => make(r.gen, s)).finally(() => { n++; ui.step(`Ajustement de la distance (${n}/${picked.length})`, 0.65 + 0.3 * (n / picked.length)); })));
  return finalizeSet(refined, spec);
}
function pickDistinct(pool, n, avoid) {
  const sorted = pool.slice().sort((a, b) => a.score - b.score);
  const out = [];
  for (const r of sorted) {
    if (avoid && avoid.some((pts) => similarity(r.pts, pts) > 0.7)) continue;
    if (out.every((o) => similarity(r.pts, o.pts) < 0.6 && similarity(o.pts, r.pts) < 0.6)) out.push(r);
    if (out.length >= n) break;
  }
  return out;
}
async function refineScale(r, spec, rebuild) {
  let best = r;
  for (let it = 0; it < 2; it++) {
    const e = (best.dist - spec.D) / spec.D;
    if (Math.abs(e) <= 0.06) break;
    const scale = best.gen.scale * clamp(spec.D / best.dist, 0.5, 1.8);
    let next = null;
    try { next = await rebuild(scale); } catch (err) { if (err.code === 'key') throw err; }
    if (!next) break;
    if (next.score < best.score || Math.abs(next.dist - spec.D) < Math.abs(best.dist - spec.D) * 0.7) best = next;
    else break;
  }
  return best;
}
function finalizeSet(list, spec) {
  const out = list.filter(Boolean).sort((a, b) => a.score - b.score);
  out.forEach((r, i) => { r.slot = i; r.target = { D: spec.D, H: spec.H }; r.fit = fitFlags(r, spec); });
  return out;
}

/* --- Allers-retours --- */
async function generateOutBack(spec, start, prov, ui) {
  const tau = spec.terrain === 'roulant' ? 1.25 : 1.35;
  const L = clamp(spec.D / 2 / tau, 150, 30000);
  ui.step('Lecture du relief autour du départ', 0.05);
  const DIRS = 12, N = 8;
  const ray = [start];
  for (let i = 0; i < DIRS; i++) for (let k = 1; k <= N; k++) ray.push(dest(start, (i * 360) / DIRS, (L * k) / N));
  let zs = null;
  try { zs = await elevations(ray, prov); } catch (e) { if (e.code === 'key') throw e; }
  const cands = [];
  for (let i = 0; i < DIRS; i++) {
    let est = null;
    if (zs) {
      let prev = zs[0];
      est = 0;
      for (let k = 1; k <= N; k++) { const v = zs[i * N + k]; est += Math.abs(v - prev); prev = v; }
      est *= 1.25;
    }
    cands.push({ th: (i * 360) / DIRS, est });
  }
  cands.sort((a, b) => (a.est == null ? 0 : Math.abs(a.est - spec.H)) - (b.est == null ? 0 : Math.abs(b.est - spec.H)));
  const queue = [];
  for (const c of cands) { if (queue.every((o) => angDiff(o.th, c.th) >= 50)) queue.push(c); if (queue.length >= 5) break; }
  const make = async (c, scale) => {
    const end = dest(start, c.th, L * scale);
    const raw = await routeVia([start, end], { prov, terrain: spec.terrain });
    const t = trimSpurs(raw.pts, raw.z ? [raw.nat, raw.z] : [raw.nat]);
    const back = t.pts.slice(0, -1).reverse();
    const pts = t.pts.concat(back);
    const nat = t.attrs[0].concat(t.attrs[0].slice(0, -1).reverse());
    const z = raw.z ? t.attrs[1].concat(t.attrs[1].slice(0, -1).reverse()) : null;
    const turn = t.pts[t.pts.length - 1];
    const r = await buildRoute({ pts, nat, z, prov: raw.prov }, { kind: 'ar', wps: [start, turn, start], gen: Object.assign({}, c, { scale }), trim: false, overlap: 1 });
    r.marks = [{ p: t.pts[t.pts.length - 1], name: 'Demi-tour' }];
    r.score = scoreRoute(r, spec);
    return r;
  };
  let done = 0;
  const pool = (await Promise.all(queue.map((c) => make(c, 1).catch((e) => { if (e.code === 'key') throw e; return null; }).finally(() => { done++; ui.step(`Recherche des sentiers (${done}/${queue.length})`, 0.1 + 0.5 * (done / queue.length)); })))).filter(Boolean);
  const picked = pickDistinct(pool, 3, spec.avoid);
  if (!picked.length) throw new ApiError('Aucun aller-retour trouvé autour de ce départ.', 'noroute');
  ui.step('Ajustement de la distance', 0.7);
  const refined = await Promise.all(picked.map((r) => refineScale(r, spec, (s) => make(r.gen, s))));
  return finalizeSet(refined, spec);
}

/* --- Côtes --- */
async function generateClimbs(spec, start, ui) {
  const prov = providerFor(start);
  if (needKey(prov)) throw new ApiError('Hors de France : ajoute ta clé OpenRouteService dans les réglages', 'key');
  const cl = spec.climb;
  const gMid = (cl.g[0] + cl.g[1]) / 2;
  const need = cl.len * gMid;
  const R = clamp(spec.warm * 1.4 + cl.len * 1.1, 900, 6500);
  ui.step('Recherche des pentes autour du départ', 0.05);
  const DIRS = 16, N = 12;
  const ray = [start];
  for (let i = 0; i < DIRS; i++) for (let k = 1; k <= N; k++) ray.push(dest(start, (i * 360) / DIRS, (R * k) / N));
  let zs = null;
  try { zs = await elevations(ray, prov); } catch (e) { if (e.code === 'key') throw e; }
  const dirs = [];
  for (let i = 0; i < DIRS; i++) {
    let rise = 0, hiK = N, hiZ = -Infinity, loK = N, loZ = Infinity;
    if (zs) {
      let mn = zs[0], mx = zs[0];
      for (let k = 1; k <= N; k++) {
        const v = zs[i * N + k];
        rise = Math.max(rise, v - mn, mx - v); // plus forte montée ou descente le long du rayon
        mn = Math.min(mn, v); mx = Math.max(mx, v);
        if (v > hiZ) { hiZ = v; hiK = k; }
        if (v < loZ) { loZ = v; loK = k; }
      }
    }
    const up = zs ? hiZ - zs[0] : 0, down = zs ? zs[0] - loZ : 0;
    const k = up >= down ? hiK : loK;
    dirs.push({ th: (i * 360) / DIRS, rise, target: dest(start, (i * 360) / DIRS, Math.min(R, (R * (k + 1.5)) / N)) });
  }
  dirs.sort((a, b) => b.rise - a.rise);
  const chosen = [];
  for (const d of dirs) { if (chosen.every((o) => angDiff(o.th, d.th) >= 40)) chosen.push(d); if (chosen.length >= 6) break; }
  let done = 0;
  const paths = (await Promise.all(chosen.map((d) => routeVia([start, d.target], { prov, terrain: 'mixte' })
    .then(async (raw) => {
      const t = trimSpurs(raw.pts, raw.z ? [raw.nat, raw.z] : [raw.nat]);
      const z = await zFor(t.pts, raw.prov, raw.z ? t.attrs[1] : null);
      return { pts: t.pts, nat: t.attrs[0], z, prov: raw.prov, th: d.th };
    })
    .catch((e) => { if (e.code === 'key') throw e; return null; })
    .finally(() => { done++; ui.step(`Repérage des montées (${done}/${chosen.length})`, 0.1 + 0.55 * (done / chosen.length)); })))).filter(Boolean);
  if (!paths.length) throw new ApiError('Aucun chemin trouvé autour de ce départ.', 'noroute');
  // Fenêtres de pente dans les deux sens de chaque chemin
  const found = [];
  for (const p of paths) {
    const prof = profileOf(p.pts, p.z, 10);
    if (prof.len < cl.len * 0.9) continue;
    const warm = spec.warm;
    const pen = (i) => 0.35 * Math.min(1.5, Math.abs(prof.d[i] - warm) / Math.max(warm, 500));
    const fw = bestClimbWindow(prof, cl.len, cl.g[0], cl.g[1], { penalty: (i) => pen(i) });
    if (fw) found.push({ p, prof, base: prof.d[fw.i], top: prof.d[fw.j], avg: fw.avg, reg: fw.reg, score: fw.score });
    const mir = Object.assign({}, prof, { z: prof.z.map((v) => -v) });
    const bw = bestClimbWindow(mir, cl.len, cl.g[0], cl.g[1], { penalty: (i, j) => pen(j) });
    if (bw) found.push({ p, prof, base: prof.d[bw.j], top: prof.d[bw.i], avg: bw.avg, reg: bw.reg, score: bw.score + 0.1 });
  }
  found.sort((a, b) => a.score - b.score);
  const picked = [];
  for (const f of found) {
    const bp = pointAt(f.p.pts, cumDist(f.p.pts), f.base);
    if ((spec.avoidClimbs || []).some((q) => hav(q, bp) < 150)) continue;
    if (picked.every((o) => hav(o.bp, bp) > 150)) picked.push(Object.assign(f, { bp }));
    if (picked.length >= 3) break;
  }
  if (!picked.length) throw new ApiError(`Pas de montée régulière à ${Math.round(cl.g[0] * 100)}–${Math.round(cl.g[1] * 100)} % assez près. Essaie un autre départ ou une autre pente.`, 'noclimb');
  ui.step('Construction des séances de côte', 0.8);
  const out = picked.map((f, i) => {
    const r = climbRoute(f.p, f.base, f.top, cl.reps, spec.includeReps !== false);
    r.climb = { reps: cl.reps, len: Math.abs(f.top - f.base), avg: f.avg, reg: f.reg, gain: Math.abs(f.avg * (f.top - f.base)), approach: f.base, g: cl.g };
    r.score = f.score + i * 0.001;
    return r;
  });
  return finalizeSet(out, spec).map((r) => {
    // séance de côte : on juge la pente et la distance, le D+ total découle des répétitions
    r.fit = Object.assign(r.fit || {}, { hOk: true, gOk: r.climb.avg >= cl.g[0] - 0.01 && r.climb.avg <= cl.g[1] + 0.015 });
    return r;
  });
}
/* Tracé d'une séance de côte : approche, répétitions montée/descente, retour */
function climbRoute(path, base, top, reps, includeReps) {
  const cum = cumDist(path.pts);
  const lo = Math.min(base, top), hi = Math.max(base, top);
  const seg = slicePath(path.pts, cum, lo, hi, path.z);
  let up = { pts: seg.pts, z: seg.z };
  if (base > top) up = { pts: seg.pts.slice().reverse(), z: seg.z.slice().reverse() };
  const app = base > 1 ? slicePath(path.pts, cum, 0, base, path.z) : { pts: [path.pts[0]], z: [path.z[0]] };
  const pts = [], z = [];
  const add = (P, Z, skipFirst) => { for (let i = skipFirst ? 1 : 0; i < P.length; i++) { pts.push(P[i]); z.push(Z[i]); } };
  add(app.pts, app.z, false);
  const n = includeReps ? reps : 1;
  for (let k = 0; k < n; k++) {
    add(up.pts, up.z, true);
    add(up.pts.slice().reverse(), up.z.slice().reverse(), true);
  }
  add(app.pts.slice().reverse(), app.z.slice().reverse(), true);
  const nat = pts.map((p) => {
    const nn = nearestOn(path.pts, p, cum);
    return path.nat ? path.nat[nn.i] || 0 : 0;
  });
  const r = finishRoute({ kind: 'cote', pts, z, nat, prov: path.prov, wps: [path.pts[0]], overlap: 1 });
  r.marks = [{ p: up.pts[0], name: 'Pied de côte' }, { p: up.pts[up.pts.length - 1], name: 'Haut de côte' }];
  r.climbSeg = { pts: up.pts };
  return r;
}
