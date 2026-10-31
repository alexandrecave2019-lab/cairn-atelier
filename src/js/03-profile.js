/* =========================================================================
   Profils : altitude le long du tracé, D+ / D−, montées, recherche de côte.
   ========================================================================= */

const PROF_STEP = 20;

function smoothArr(z, r) {
  if (r <= 0) return z.slice();
  const out = new Array(z.length);
  for (let i = 0; i < z.length; i++) {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(z.length - 1, i + r); k++) { s += z[k]; n++; }
    out[i] = s / n;
  }
  return out;
}
/* D+ / D− avec hystérésis (évite de compter le bruit du relief) */
function upDown(z, thr = 1.5) {
  let up = 0, down = 0, ref = z[0];
  for (let i = 1; i < z.length; i++) {
    const d = z[i] - ref;
    if (d >= thr) { up += d; ref = z[i]; } else if (d <= -thr) { down -= d; ref = z[i]; }
  }
  return { up, down };
}
/* Profil régulier (pas ~20 m) à partir des sommets du tracé et de leur altitude */
function profileOf(pts, z, step = PROF_STEP) {
  const cum = cumDist(pts);
  const L = cum[cum.length - 1] || 0;
  const n = Math.max(2, Math.round(L / step) + 1);
  const st = L / (n - 1) || step;
  const d = [];
  for (let i = 0; i < n; i++) d.push(Math.min(L, i * st));
  const zr = interp(cum, z, d);
  const zs = smoothArr(zr, 1);
  const { up, down } = upDown(zs);
  let zmin = Infinity, zmax = -Infinity;
  for (const v of zs) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
  // cumuls (sans seuil) pour les sous-tronçons
  const cu = [0], cd = [0];
  for (let i = 1; i < n; i++) {
    const dz = zs[i] - zs[i - 1];
    cu.push(cu[i - 1] + Math.max(0, dz));
    cd.push(cd[i - 1] + Math.max(0, -dz));
  }
  return { d, z: zs, step: st, len: L, dplus: up, dminus: down, zmin, zmax, cu, cd };
}
/* D+ et D− entre deux indices du profil (cumuls lissés) */
function segUpDown(prof, i, j) { return { up: prof.cu[j] - prof.cu[i], down: prof.cd[j] - prof.cd[i] }; }

/* Pente moyenne sur ~100 m autour de chaque point */
function grades(prof) {
  const r = Math.max(1, Math.round(50 / prof.step));
  const out = new Array(prof.z.length);
  for (let i = 0; i < prof.z.length; i++) {
    const a = Math.max(0, i - r), b = Math.min(prof.z.length - 1, i + r);
    const dx = prof.d[b] - prof.d[a];
    out[i] = dx > 0 ? (prof.z[b] - prof.z[a]) / dx : 0;
  }
  return out;
}
function slopeClass(g) { const a = Math.abs(g); return a < 0.05 ? 0 : a < 0.1 ? 1 : a < 0.15 ? 2 : 3; }

/* Montées notables (façon ClimbPro) : gain >= minGain, pente moyenne >= minAvg */
function findClimbs(prof, o = {}) {
  const minGain = o.minGain ?? 50, minAvg = o.minAvg ?? 0.04, tol = o.tol ?? 15;
  const { d, z } = prof;
  const out = [];
  let s = 0, peak = 0;
  const close = () => {
    const gain = z[peak] - z[s], len = d[peak] - d[s];
    if (peak > s && gain >= minGain && len > 0 && gain / len >= minAvg) out.push({ i: s, j: peak, from: d[s], to: d[peak], len, gain, avg: gain / len });
  };
  for (let i = 1; i < z.length; i++) {
    if (z[i] > z[peak]) peak = i;
    if (peak === s && z[i] < z[s]) { s = i; peak = i; continue; }
    if (z[peak] - z[i] > tol) { close(); s = i; peak = i; }
  }
  close();
  // pente maximale sur 100 m dans chaque montée
  const g = grades(prof);
  for (const c of out) { let m = 0; for (let k = c.i; k <= c.j; k++) m = Math.max(m, g[k]); c.max = m; }
  return out;
}

/* Meilleure fenêtre de longueur `len` dont la pente vise [gMin, gMax] (fractions).
   Renvoie { i, j, avg, reg, score } ou null. `from` : indice minimal du pied. */
function bestClimbWindow(prof, len, gMin, gMax, o = {}) {
  const { d, z, step } = prof;
  const w = Math.max(2, Math.round(len / step));
  if (z.length <= w) return null;
  const gt = (gMin + gMax) / 2;
  const sub = Math.max(1, Math.round(60 / step));
  let best = null;
  for (let i = o.from || 0; i + w < z.length; i++) {
    const j = i + w;
    const avg = (z[j] - z[i]) / (d[j] - d[i]);
    if (avg < gMin * 0.6) continue;
    // régularité : part des sous-tronçons de 60 m dans la plage (± 2 points), descentes internes
    let inside = 0, cnt = 0, drop = 0;
    for (let k = i; k + sub <= j; k += sub) {
      const g = (z[k + sub] - z[k]) / (d[k + sub] - d[k]);
      if (g >= gMin - 0.02 && g <= gMax + 0.03) inside++;
      if (g < 0) drop += z[k] - z[k + sub];
      cnt++;
    }
    const reg = cnt ? inside / cnt : 0;
    const err = avg < gMin ? (gMin - avg) / gt : avg > gMax ? (avg - gMax) / gt : 0;
    const score = err * 2 + (1 - reg) * 0.8 + Math.min(1, drop / Math.max(5, z[j] - z[i])) + (o.penalty ? o.penalty(i, j) : 0);
    if (!best || score < best.score) best = { i, j, avg, reg, score };
  }
  return best;
}
