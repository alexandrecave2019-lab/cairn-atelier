/* =========================================================================
   GPX : export vers Garmin Connect (parcours), import du tracé d'une course.
   ========================================================================= */

function xmlEsc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])); }

function routeDesc(r) {
  return `${fmtKm1(r.dist)} · ${fmtNum(r.dplus)} m D+ · CAIRN Atelier`;
}
function toGPX(r) {
  const name = r.name || 'Parcours CAIRN';
  const pts = r.pts, z = r.z || [];
  // Garmin : un point tous les 5 m minimum suffit ; on garde la forme exacte (Douglas-Peucker 1,5 m)
  const keep = pts.length > 2500 ? simplifyIdx(pts, 1.5) : pts.map((_, i) => i);
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<gpx version="1.1" creator="CAIRN Atelier" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">');
  lines.push(`  <metadata><name>${xmlEsc(name)}</name><desc>${xmlEsc(routeDesc(r))}</desc><time>${new Date().toISOString()}</time></metadata>`);
  for (const m of r.marks || []) {
    const zi = z.length ? interp(r.cum || cumDist(pts), z, [nearestOn(pts, m.p, r.cum).along])[0] : null;
    lines.push(`  <wpt lat="${m.p[1].toFixed(6)}" lon="${m.p[0].toFixed(6)}">${zi != null ? `<ele>${zi.toFixed(1)}</ele>` : ''}<name>${xmlEsc(m.name)}</name><sym>Flag, Blue</sym></wpt>`);
  }
  lines.push(`  <trk><name>${xmlEsc(name)}</name><type>running</type><trkseg>`);
  for (const i of keep) {
    const p = pts[i];
    const e = Number.isFinite(z[i]) ? `<ele>${z[i].toFixed(1)}</ele>` : '';
    lines.push(`    <trkpt lat="${p[1].toFixed(6)}" lon="${p[0].toFixed(6)}">${e}</trkpt>`);
  }
  lines.push('  </trkseg></trk>');
  lines.push('</gpx>');
  return lines.join('\n') + '\n';
}
function gpxFileName(r) {
  const base = (r.session && r.session.date ? r.session.date + '-' : '') + (r.name || 'parcours');
  const slug = base.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return 'cairn-' + (slug || 'parcours') + '.gpx';
}
function downloadText(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

/* Lecture d'un GPX (trace ou route) : [[lon, lat, ele?], …] */
function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ApiError('Fichier GPX illisible', 'gpx');
  const pick = (tag) => Array.from(doc.getElementsByTagNameNS('*', tag));
  let nodes = pick('trkpt');
  if (nodes.length < 2) nodes = pick('rtept');
  if (nodes.length < 2) throw new ApiError('Ce GPX ne contient pas de tracé', 'gpx');
  const pts = [];
  for (const n of nodes) {
    const lat = Number(n.getAttribute('lat')), lon = Number(n.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const e = n.getElementsByTagNameNS('*', 'ele')[0];
    const z = e ? Number(e.textContent) : NaN;
    const p = [lon, lat];
    if (Number.isFinite(z)) p.push(z);
    if (!pts.length || hav(pts[pts.length - 1], p) > 0.5) pts.push(p);
  }
  const nameNode = doc.getElementsByTagNameNS('*', 'metadata')[0]?.getElementsByTagNameNS('*', 'name')[0] || doc.getElementsByTagNameNS('*', 'trk')[0]?.getElementsByTagNameNS('*', 'name')[0] || doc.getElementsByTagNameNS('*', 'name')[0];
  return { name: nameNode ? nameNode.textContent.trim() : '', pts };
}
