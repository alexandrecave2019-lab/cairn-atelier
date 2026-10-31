/* Monde simulé pour les tests : relief (crête au sud, colline au nord-est), sentiers sinueux
   avec culs-de-sac aux points de passage, natures de voies, géocodage. Remplace fetch. */
(() => {
  const D2R = Math.PI / 180;
  const R = 6371008.8;
  const hav = (a, b) => {
    const dLat = (b[1] - a[1]) * D2R, dLon = (b[0] - a[0]) * D2R;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  };
  const Z = (lon, lat) => {
    let z = 420;
    z += 460 * Math.exp(-(((lat - 43.312) / 0.018) ** 2)); // crête est-ouest au sud
    z += 170 * Math.exp(-(((lon - 5.79) ** 2 + (lat - 43.352) ** 2) / 0.012 ** 2)); // colline nord-est
    z += 14 * Math.sin(lon * 900) * Math.cos(lat * 1100); // petits reliefs
    return Math.round(z * 100) / 100;
  };
  const natAt = (p) => {
    const v = Math.sin(p[0] * 420) + Math.cos(p[1] * 560);
    return v > 0.35 ? 'Sentier' : v > -0.55 ? 'Chemin' : 'Route à 1 chaussée';
  };
  window.__mockStats = { route: 0, elev: 0, elevPts: 0, geo: 0, ors: 0 };
  const leg = (a, b, seed) => {
    const d = hav(a, b);
    const n = Math.max(2, Math.ceil(d / 22));
    const kx = Math.cos(a[1] * D2R) * R * D2R, ky = R * D2R;
    const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
    const L = Math.hypot(dx, dy) || 1;
    const px = -dy / L, py = dx / L;
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const w = Math.sin(t * Math.PI) * (0.1 * L * Math.sin(t * Math.PI * 3 + seed) + 0.04 * L * Math.sin(t * Math.PI * 9 + seed * 2));
      out.push([a[0] + (dx * t + px * w) / kx, a[1] + (dy * t + py * w) / ky]);
    }
    return out;
  };
  const spur = (w, seed) => {
    const kx = Math.cos(w[1] * D2R) * R * D2R, ky = R * D2R;
    const ang = seed * 1.7;
    const p1 = [w[0] + (Math.cos(ang) * 18) / kx, w[1] + (Math.sin(ang) * 18) / ky];
    const p2 = [w[0] + (Math.cos(ang) * 36) / kx, w[1] + (Math.sin(ang) * 36) / ky];
    return [p1, p2, p1, w];
  };
  const steps = (coords) => {
    const out = [];
    let cur = null;
    for (let i = 0; i < coords.length; i++) {
      const nat = natAt(coords[i]);
      if (!cur || cur.attributes.nature !== nat) {
        if (cur) cur.geometry.coordinates.push(coords[i]);
        cur = { geometry: { type: 'LineString', coordinates: [coords[i]] }, attributes: { nature: nat, nom_1_gauche: '' }, distance: 0, duration: 0, instruction: {} };
        out.push(cur);
      } else cur.geometry.coordinates.push(coords[i]);
    }
    for (const s of out) { let dd = 0; const g = s.geometry.coordinates; for (let i = 1; i < g.length; i++) dd += hav(g[i - 1], g[i]); s.distance = Math.round(dd * 10) / 10; s.duration = dd / 1.1; }
    return out.filter((s) => s.geometry.coordinates.length > 1);
  };
  const pt = (s) => s.split(',').map(Number);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);
  window.__mockFail = null;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!/data\.geopf\.fr|openrouteservice\.org/.test(url)) return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 25));
    if (window.__mockFail && url.includes(window.__mockFail)) return json({ message: 'Service indisponible (test)' }, 503);
    const u = new URL(url);
    if (u.pathname.includes('/navigation/itineraire')) {
      window.__mockStats.route++;
      const q = u.searchParams;
      const pts = [pt(q.get('start'))].concat(q.get('intermediates') ? q.get('intermediates').split('|').map(pt) : [], [pt(q.get('end'))]);
      // « accroche » au réseau : léger décalage du départ
      const portions = [];
      let all = [];
      for (let k = 0; k < pts.length - 1; k++) {
        let c = leg(pts[k], pts[k + 1], k + 1 + Math.round(pts[k][0] * 1000) % 5);
        if (k < pts.length - 2) c = c.concat(spur(pts[k + 1], k + 3));
        const st = steps(c);
        let dd = 0; for (let i = 1; i < c.length; i++) dd += hav(c[i - 1], c[i]);
        portions.push({ start: c[0].join(','), end: c[c.length - 1].join(','), distance: dd, duration: dd / 1.1, steps: st });
        all = all.concat(k ? c.slice(1) : c);
      }
      let dist = 0; for (let i = 1; i < all.length; i++) dist += hav(all[i - 1], all[i]);
      return json({ resource: 'bdtopo-pgr', start: q.get('start'), end: q.get('end'), geometry: { type: 'LineString', coordinates: all }, distance: dist, duration: dist / 1.1, portions, constraints: [] });
    }
    if (u.pathname.includes('/altimetrie/')) {
      let lon, lat;
      if (init && init.method === 'POST') { const b = JSON.parse(init.body); lon = b.lon; lat = b.lat; }
      else { lon = u.searchParams.get('lon'); lat = u.searchParams.get('lat'); }
      const L1 = lon.split('|').map(Number), L2 = lat.split('|').map(Number);
      window.__mockStats.elev++; window.__mockStats.elevPts += L1.length;
      return json({ elevations: L1.map((x, i) => Z(x, L2[i])) });
    }
    if (u.pathname.includes('/geocodage/search')) {
      window.__mockStats.geo++;
      return json({ type: 'FeatureCollection', features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [5.7564, 43.3326] }, properties: { label: 'Hôtellerie de la Sainte-Baume', city: 'Plan-d\'Aups-Sainte-Baume', _type: 'poi', category: ['lieu-dit'] } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [5.7329, 43.3312] }, properties: { label: 'Plan-d\'Aups-Sainte-Baume', _type: 'address' } },
      ] });
    }
    if (u.pathname.includes('/geocodage/reverse')) {
      return json({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [5.76, 43.32] }, properties: { toponym: 'Pas de la Cabre', name: ['Pas de la Cabre'], category: ['col', 'détail orographique'], distance: 120 } }] });
    }
    if (/openrouteservice/.test(url)) { window.__mockStats.ors++; return json({ error: { message: 'non simulé' } }, 400); }
    return json({ message: 'inconnu' }, 404);
  };
  window.__Z = Z;
})();
