/* =========================================================================
   Géométrie : points [lon, lat] en degrés WGS84, distances en mètres.
   ========================================================================= */

const R_EARTH = 6371008.8;
const D2R = Math.PI / 180;

function hav(a, b) {
  const dLat = (b[1] - a[1]) * D2R;
  const dLon = (b[0] - a[0]) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}
function dest(p, brgDeg, d) {
  const br = brgDeg * D2R, lat1 = p[1] * D2R, lon1 = p[0] * D2R, dr = d / R_EARTH;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2));
  return [round(lon2 / D2R, 6), round(lat2 / D2R, 6)];
}
function bearing(a, b) {
  const la1 = a[1] * D2R, la2 = b[1] * D2R, dl = (b[0] - a[0]) * D2R;
  const y = Math.sin(dl) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}
function angDiff(a, b) { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; }
function samePt(a, b, tol = 0.5) { return hav(a, b) < tol; }

/* Projection locale (équirectangulaire) pour les calculs plans */
function projector(origin) {
  const ky = R_EARTH * D2R;
  const kx = Math.cos(origin[1] * D2R) * ky;
  return {
    fwd: (p) => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    inv: (x) => [origin[0] + x[0] / kx, origin[1] + x[1] / ky],
  };
}
function cumDist(pts) {
  const c = new Array(pts.length);
  c[0] = 0;
  for (let i = 1; i < pts.length; i++) c[i] = c[i - 1] + hav(pts[i - 1], pts[i]);
  return c;
}
function pathLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += hav(pts[i - 1], pts[i]); return s; }

/* Point à la distance x le long du tracé (cum = cumDist(pts)) */
function pointAt(pts, cum, x) {
  if (x <= 0) return pts[0].slice(0, 2);
  const L = cum[cum.length - 1];
  if (x >= L) return pts[pts.length - 1].slice(0, 2);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= x) lo = m; else hi = m; }
  const t = cum[hi] > cum[lo] ? (x - cum[lo]) / (cum[hi] - cum[lo]) : 0;
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
}
function idxAt(cum, x) { // dernier indice i tel que cum[i] <= x
  let lo = 0, hi = cum.length - 1;
  if (x >= cum[hi]) return hi;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= x) lo = m; else hi = m; }
  return lo;
}
/* Rééchantillonnage tous les `step` mètres (premier et dernier points inclus) */
function resample(pts, step, cum) {
  cum = cum || cumDist(pts);
  const L = cum[cum.length - 1];
  const n = Math.max(2, Math.round(L / step) + 1);
  const st = L / (n - 1);
  const out = [], d = [];
  for (let i = 0; i < n; i++) { const x = Math.min(L, i * st); out.push(pointAt(pts, cum, x)); d.push(x); }
  return { pts: out, d, step: st };
}
/* Valeurs (z…) connues aux distances `xs` → interpolées aux distances `at` */
function interp(xs, ys, at) {
  const out = new Array(at.length);
  let j = 0;
  for (let i = 0; i < at.length; i++) {
    const x = at[i];
    while (j < xs.length - 2 && xs[j + 1] < x) j++;
    const x0 = xs[j], x1 = xs[Math.min(j + 1, xs.length - 1)];
    const t = x1 > x0 ? clamp((x - x0) / (x1 - x0), 0, 1) : 0;
    const y0 = ys[j], y1 = ys[Math.min(j + 1, ys.length - 1)];
    out[i] = y0 + (y1 - y0) * t;
  }
  return out;
}
/* Sous-tracé entre deux distances (extrémités interpolées) ; z suit si fourni */
function slicePath(pts, cum, a, b, z) {
  const out = [pointAt(pts, cum, a)], oz = z ? [interp(cum, z, [a])[0]] : null;
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] > a && cum[i] < b) { out.push(pts[i].slice(0, 2)); if (oz) oz.push(z[i]); }
  }
  out.push(pointAt(pts, cum, b));
  if (oz) oz.push(interp(cum, z, [b])[0]);
  return { pts: out, z: oz };
}

/* Douglas-Peucker (en mètres) ; garde les indices pour suivre z / nature */
function simplifyIdx(pts, tol) {
  if (pts.length < 3) return pts.map((_, i) => i);
  const P = projector(pts[0]);
  const xy = pts.map(P.fwd);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
      t = clamp(t, 0, 1);
      const qx = ax + t * dx - px, qy = ay + t * dy - py;
      const d2 = qx * qx + qy * qy;
      if (d2 > best) { best = d2; bi = i; }
    }
    if (best > t2 && bi > 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const idx = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) idx.push(i);
  return idx;
}

/* Plus proche point d'un tracé : { i (segment), t, d (m), along (m) } */
function nearestOn(pts, p, cum) {
  cum = cum || cumDist(pts);
  const P = projector(p);
  let best = { i: 0, t: 0, d: Infinity, along: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = P.fwd(pts[i]), b = P.fwd(pts[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? clamp((-a[0] * dx - a[1] * dy) / l2, 0, 1) : 0;
    const qx = a[0] + t * dx, qy = a[1] + t * dy;
    const d = Math.hypot(qx, qy);
    if (d < best.d) best = { i, t, d, along: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  return best;
}
function bboxOf(pts) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of pts) { if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; }
  return [w, s, e, n];
}

/* Angle de virage en b (0 = tout droit, 180 = demi-tour) */
function turnAngle(a, b, c) {
  const P = projector(b);
  const u = P.fwd(a), w = P.fwd(c);
  const v1 = [-u[0], -u[1]], v2 = w;
  const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
  if (!n1 || !n2) return 0;
  const cos = clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2), -1, 1);
  return Math.acos(cos) / D2R;
}

/* Supprime les allers-retours en cul-de-sac (points de passage tombés hors sentier).
   `attrs` : tableaux parallèles (nature…) conservés avec les points. */
function trimSpurs(pts, attrs) {
  const st = [], sa = attrs ? attrs.map(() => []) : null;
  const push = (i) => { st.push(pts[i]); if (sa) attrs.forEach((a, k) => sa[k].push(a[i])); };
  const pop = () => { st.pop(); if (sa) sa.forEach((a) => a.pop()); };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let n = st.length;
    if (n && hav(st[n - 1], p) < 0.6) { if (sa) attrs.forEach((a, k) => { sa[k][n - 1] = a[i]; }); continue; }
    let popped = false;
    while (n >= 2 && hav(st[n - 2], p) < Math.max(3, 0.3 * hav(st[n - 2], st[n - 1])) && turnAngle(st[n - 2], st[n - 1], p) > 150) {
      pop(); n--; popped = true;
    }
    if (popped && hav(st[n - 1], p) < 3) { if (sa) attrs.forEach((a, k) => { sa[k][n - 1] = a[i]; }); continue; }
    push(i);
  }
  return { pts: st, attrs: sa };
}

/* Part du tracé parcourue deux fois (aller-retour, tronçons communs) */
function overlapShare(pts) {
  if (pts.length < 2) return 0;
  const P = projector(pts[0]);
  const rs = resample(pts, 10);
  const cell = 14;
  const seen = new Map();
  let over = 0;
  for (let i = 0; i < rs.pts.length; i++) {
    const [x, y] = P.fwd(rs.pts[i]);
    const cx = Math.round(x / cell), cy = Math.round(y / cell);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1; dy++) {
      const v = seen.get((cx + dx) + ':' + (cy + dy));
      if (v != null && rs.d[i] - v > 90) { hit = true; break; }
    }
    if (hit) over += rs.step;
    const k = cx + ':' + cy;
    if (!seen.has(k)) seen.set(k, rs.d[i]);
  }
  return clamp(over / (rs.d[rs.d.length - 1] || 1), 0, 1);
}
/* Ressemblance de deux tracés : part de a qui longe b à moins de 30 m */
function similarity(a, b) {
  const P = projector(a[0]);
  const cell = 30;
  const grid = new Set();
  for (const p of resample(b, 15).pts) { const [x, y] = P.fwd(p); grid.add(Math.round(x / cell) + ':' + Math.round(y / cell)); }
  const ra = resample(a, 25).pts;
  let near = 0;
  for (const p of ra) {
    const [x, y] = P.fwd(p);
    const cx = Math.round(x / cell), cy = Math.round(y / cell);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1; dy++) if (grid.has((cx + dx) + ':' + (cy + dy))) { hit = true; break; }
    if (hit) near++;
  }
  return near / ra.length;
}

/* Encodage compact (algorithme « polyline ») pour l'enregistrement */
function encNum(v, out) {
  v = v < 0 ? ~(v << 1) : v << 1;
  while (v >= 0x20) { out.push(String.fromCharCode((0x20 | (v & 0x1f)) + 63)); v >>>= 5; }
  out.push(String.fromCharCode(v + 63));
}
function decNum(s, i) {
  let shift = 0, res = 0, b;
  do { b = s.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i <= s.length);
  return { v: res & 1 ? ~(res >>> 1) : res >>> 1, i };
}
function encodePolyline(pts) {
  const out = [];
  let la = 0, lo = 0;
  for (const p of pts) {
    const a = Math.round(p[1] * 1e5), o = Math.round(p[0] * 1e5);
    encNum(a - la, out); encNum(o - lo, out);
    la = a; lo = o;
  }
  return out.join('');
}
function decodePolyline(s) {
  const out = [];
  let i = 0, la = 0, lo = 0;
  while (i < s.length) {
    const r1 = decNum(s, i); la += r1.v; i = r1.i;
    if (i >= s.length) break;
    const r2 = decNum(s, i); lo += r2.v; i = r2.i;
    out.push([lo / 1e5, la / 1e5]);
  }
  return out;
}
function encodeInts(arr) { const out = []; let prev = 0; for (const v of arr) { const n = Math.round(v); encNum(n - prev, out); prev = n; } return out.join(''); }
function decodeInts(s) { const out = []; let i = 0, prev = 0; while (i < s.length) { const r = decNum(s, i); prev += r.v; i = r.i; out.push(prev); } return out; }

/* Couverture IGN : France métropolitaine (contour simplifié, marge en mer), Corse, outre-mer */
const FR_POLY = [
  [1.40, 51.20], [2.55, 51.12], [2.62, 50.95], [2.84, 50.73], [3.02, 50.79], [3.15, 50.80], [3.27, 50.67], [3.32, 50.55],
  [3.60, 50.50], [3.70, 50.34], [3.90, 50.34], [4.12, 50.31], [4.18, 50.13], [4.24, 49.97], [4.68, 49.99], [4.80, 50.15],
  [4.89, 50.13], [4.87, 49.80], [5.10, 49.77], [5.30, 49.66], [5.47, 49.50], [5.81, 49.55], [6.04, 49.46], [6.37, 49.47],
  [6.55, 49.42], [6.72, 49.18], [7.03, 49.19], [7.30, 49.12], [7.55, 49.08], [7.94, 49.05], [8.23, 48.97], [7.97, 48.73],
  [7.80, 48.58], [7.68, 48.30], [7.58, 48.12], [7.53, 47.80], [7.59, 47.59], [7.42, 47.45], [7.13, 47.50], [6.99, 47.45],
  [6.94, 47.29], [6.70, 47.06], [6.45, 46.95], [6.43, 46.76], [6.12, 46.59], [6.11, 46.42], [5.97, 46.21], [6.06, 46.15],
  [6.31, 46.25], [6.55, 46.45], [6.81, 46.43], [6.79, 46.18], [6.95, 46.05], [7.04, 45.92], [6.80, 45.83], [7.00, 45.65],
  [7.13, 45.47], [7.10, 45.25], [6.75, 45.14], [6.62, 45.10], [6.75, 44.91], [7.03, 44.83], [6.95, 44.63], [6.86, 44.43],
  [7.00, 44.24], [7.36, 44.12], [7.71, 44.14], [7.53, 43.79], [7.55, 43.68], [7.05, 43.45], [6.70, 43.05], [5.95, 42.95],
  [5.20, 43.15], [4.40, 43.30], [3.45, 43.20], [3.12, 42.75], [3.18, 42.43], [2.88, 42.45], [2.55, 42.33], [1.98, 42.36],
  [1.72, 42.49], [1.44, 42.59], [1.36, 42.72], [0.86, 42.83], [0.66, 42.84], [0.30, 42.69], [-0.32, 42.84], [-0.73, 42.95],
  [-1.30, 43.05], [-1.42, 43.27], [-1.79, 43.37], [-1.95, 43.45], [-1.55, 44.20], [-1.35, 44.70], [-1.40, 45.30],
  [-1.65, 45.90], [-2.45, 46.60], [-2.80, 47.20], [-3.55, 47.60], [-4.55, 47.75], [-4.95, 48.00], [-5.25, 48.45],
  [-4.80, 48.75], [-3.50, 48.95], [-2.60, 48.75], [-1.90, 48.80], [-1.95, 49.30], [-2.05, 49.75], [-1.25, 49.78],
  [-0.70, 49.42], [0.00, 49.55], [0.90, 50.00], [1.45, 50.50],
];
const FR_BOXES = [
  [8.45, 41.30, 9.65, 43.10], [-61.85, 15.80, -61.00, 16.55], [-61.25, 14.38, -60.80, 14.90],
  [-54.60, 2.10, -51.60, 5.80], [55.20, -21.40, 55.85, -20.85], [45.00, -13.05, 45.30, -12.60],
];
function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inFrance(p) {
  if (!p) return false;
  if (FR_BOXES.some((b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3])) return true;
  return inPoly(p, FR_POLY);
}
