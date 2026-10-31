/* =========================================================================
   Ta course : import du GPX officiel, montées clés, entraînements sur tronçons.
   ========================================================================= */

async function makeRace(name, pts3, prov) {
  let pts = pts3.map((p) => [p[0], p[1]]);
  let z = pts3.map((p) => (p.length > 2 && Number.isFinite(p[2]) ? p[2] : null));
  // allège les traces très denses (montres : 1 point / s)
  if (pts.length > 4000) {
    const idx = simplifyIdx(pts, 2);
    pts = idx.map((i) => pts[i]);
    z = idx.map((i) => z[i]);
  }
  const known = z.filter((v) => v != null).length;
  if (known < pts.length * 0.9) z = await zFor(pts, prov || providerFor(pts[0]));
  else z = fillGaps(z.map((v) => (v == null ? NaN : v)));
  const race = { name: String(name || 'Ma course').slice(0, 80), pts, z, at: nowISO() };
  return enrichRace(race);
}
function enrichRace(race) {
  race.cum = cumDist(race.pts);
  race.prof = profileOf(race.pts, race.z);
  race.dist = race.prof.len;
  race.dplus = race.prof.dplus;
  race.climbs = findClimbs(race.prof, { minGain: 80, minAvg: 0.04, tol: 20 });
  race.loop = hav(race.pts[0], race.pts[race.pts.length - 1]) < 300;
  return race;
}
function raceIdx(race, x) { return clamp(Math.round(x / race.prof.step), 0, race.prof.d.length - 1); }
function raceUpDown(race, a, b) { return segUpDown(race.prof, raceIdx(race, a), raceIdx(race, b)); }

/* Tronçons candidats pour une séance (distance D, D+ H) */
function raceCandidates(race, spec, how) {
  const L = race.dist;
  const D = spec.D, H = spec.H;
  const out = [];
  const step = Math.max(100, L / 400);
  if (how === 'cote' && spec.climb) {
    const cl = spec.climb;
    for (const c of race.climbs) {
      if (c.len < cl.len * 0.8) continue;
      // meilleure fenêtre de la bonne longueur dans la montée
      const sub = { d: race.prof.d.slice(c.i, c.j + 1), z: race.prof.z.slice(c.i, c.j + 1), step: race.prof.step };
      const w = bestClimbWindow(sub, Math.min(cl.len, c.len), cl.g[0], cl.g[1]);
      if (!w) continue;
      out.push({ how, a: sub.d[w.i], b: sub.d[w.j], avg: w.avg, score: w.score, climb: c });
    }
    return out.sort((x, y) => x.score - y.score).slice(0, 3);
  }
  const span = how === 'ar' ? D / 2 : how === 'aller' ? D : D * 0.55;
  if (span >= L) {
    out.push({ how, a: 0, b: Math.min(L, span), score: 0 });
    return out;
  }
  for (let a = 0; a + span <= L; a += step) {
    const b = a + span;
    const { up, down } = raceUpDown(race, a, b);
    const got = how === 'ar' ? up + down : how === 'aller' ? up : up + Math.max(0, down - up) * 0.6 + up * 0.25;
    const err = Math.abs(got - H) / Math.max(H, 80);
    // bonus : tronçons qui contiennent une montée clé de la course
    const key = race.climbs.some((c) => c.from >= a - 50 && c.to <= b + 50 && c.gain >= 150) ? -0.08 : 0;
    out.push({ how, a, b, est: got, score: err + key });
  }
  out.sort((x, y) => x.score - y.score);
  const picked = [];
  for (const c of out) {
    if (picked.every((o) => Math.min(o.b, c.b) - Math.max(o.a, c.a) < 0.4 * (c.b - c.a))) picked.push(c);
    if (picked.length >= (how === 'boucle' ? 4 : 3)) break;
  }
  return picked;
}

/* Parcours d'entraînement à partir d'un tronçon */
async function raceRoute(race, c, spec) {
  const sec = slicePath(race.pts, race.cum, c.a, c.b, race.z);
  const kmA = round(c.a / 1000, 1), kmB = round(c.b / 1000, 1);
  const label = `km ${String(kmA).replace('.', ',')} → ${String(kmB).replace('.', ',')}`;
  let r;
  if (c.how === 'ar') {
    const pts = sec.pts.concat(sec.pts.slice(0, -1).reverse());
    const z = sec.z.concat(sec.z.slice(0, -1).reverse());
    r = finishRoute({ kind: 'course', pts, z, nat: null, overlap: 1, wps: [sec.pts[0], sec.pts[sec.pts.length - 1], sec.pts[0]] });
    r.marks = [{ p: sec.pts[sec.pts.length - 1], name: 'Demi-tour' }];
    r.name = `Aller-retour ${label}`;
  } else if (c.how === 'aller') {
    r = finishRoute({ kind: 'course', pts: sec.pts, z: sec.z, nat: null, wps: [sec.pts[0], sec.pts[sec.pts.length - 1]] });
    r.name = `Tronçon ${label}`;
  } else if (c.how === 'cote') {
    const reps = (spec.climb && spec.climb.reps) || 4;
    const pts = [], z = [];
    for (let k = 0; k < reps; k++) {
      const up = sec.pts, uz = sec.z;
      for (let i = k ? 1 : 0; i < up.length; i++) { pts.push(up[i]); z.push(uz[i]); }
      for (let i = up.length - 2; i >= 0; i--) { pts.push(up[i]); z.push(uz[i]); }
    }
    r = finishRoute({ kind: 'course', pts, z, nat: null, overlap: 1, wps: [sec.pts[0]] });
    r.marks = [{ p: sec.pts[0], name: 'Pied de côte' }, { p: sec.pts[sec.pts.length - 1], name: 'Haut de côte' }];
    r.climbSeg = { pts: sec.pts };
    r.climb = { reps, len: c.b - c.a, avg: c.avg, gain: (c.b - c.a) * c.avg, g: spec.climb ? spec.climb.g : null };
    r.name = `Côte du parcours, ${label}`;
  } else {
    const end = sec.pts[sec.pts.length - 1], start = sec.pts[0];
    const prov = providerFor(start);
    const raw = await routeVia([end, start], { prov, terrain: 'sentiers' });
    const t = trimSpurs(raw.pts, raw.z ? [raw.nat, raw.z] : [raw.nat]);
    const zr = await zFor(t.pts, raw.prov, raw.z ? t.attrs[1] : null);
    const pts = sec.pts.concat(t.pts.slice(1));
    const z = sec.z.concat(zr.slice(1));
    const nat = new Array(sec.pts.length).fill(1).concat(t.attrs[0].slice(1));
    r = finishRoute({ kind: 'course', pts, z, nat, wps: [start, end, start], prov: raw.prov });
    r.name = `Boucle ${label}`;
  }
  r.race = { a: c.a, b: c.b, how: c.how };
  r.start = sec.pts[0];
  return r;
}
async function racePlans(race, spec, how, ui) {
  const cands = raceCandidates(race, spec, how);
  if (!cands.length) throw new ApiError(how === 'cote' ? 'Aucune montée de la course ne correspond à cette pente.' : 'Aucun tronçon ne correspond.', 'noroute');
  const out = [];
  let n = 0;
  for (const c of cands) {
    try { out.push(await raceRoute(race, c, spec)); } catch (e) { if (e.code === 'key') throw e; }
    n++;
    if (ui) ui.step(`Préparation des tronçons (${n}/${cands.length})`, 0.2 + 0.7 * (n / cands.length));
  }
  if (!out.length) throw new ApiError('Impossible de construire un tronçon ici.', 'noroute');
  out.forEach((r) => { r.score = how === 'cote' ? r.score || 0 : scoreRoute(r, Object.assign({}, spec, { shape: 'ar', terrain: 'mixte' })); });
  return finalizeSet(out, spec).slice(0, 3);
}
