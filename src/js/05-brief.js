/* =========================================================================
   Séance reçue de CAIRN → cible de parcours (distance, D+, terrain, côte).
   ========================================================================= */

const TYPES = {
  endurance: { label: 'Endurance', icon: 'endurance', terrain: 'sentiers' },
  sortie_longue: { label: 'Sortie longue', icon: 'long', terrain: 'sentiers' },
  recup: { label: 'Récupération', icon: 'recovery', terrain: 'roulant' },
  qualite: { label: 'Fractionné', icon: 'quality', terrain: 'roulant' },
  cotes: { label: 'Côtes', icon: 'hill', terrain: 'sentiers' },
  test: { label: 'Test', icon: 'test', terrain: 'roulant' },
  course: { label: 'Course', icon: 'race', terrain: 'sentiers' },
};
const TERRAINS = { sentiers: 'Sentiers', mixte: 'Mixte', roulant: 'Roulant' };
const DEFAULT_PACE = { Z1: 7.1, Z2: 6.5, Z3: 5.8, Z4: 5.2, Z5: 4.7 }; // min/km sur le plat

function typeOf(t) { return TYPES[t] ? t : 'endurance'; }

/* Lecture du lien : #s=<séance encodée>&m=<mode> */
function readHash() {
  const h = location.hash.replace(/^#/, '');
  if (!h) return {};
  const p = new URLSearchParams(h);
  let brief = null;
  const s = p.get('s');
  if (s) { try { brief = normBrief(JSON.parse(b64urlDecode(s))); } catch (e) { brief = null; } }
  return { brief, mode: p.get('m') || null };
}
function normBrief(b) {
  if (!b || typeof b !== 'object') return null;
  const n = (v) => { const x = num(v); return x != null && x >= 0 ? x : null; };
  const pz = {};
  if (b.pz && typeof b.pz === 'object') for (const z of ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']) {
    const r = b.pz[z];
    const v = Array.isArray(r) ? (num(r[0]) + num(r[1])) / 2 : num(r);
    if (Number.isFinite(v) && v > 2.5 && v < 15) pz[z] = v;
  }
  return {
    id: String(b.id || ''),
    date: isISO(b.date) ? b.date : null,
    type: typeOf(b.type),
    title: String(b.title || 'Séance').slice(0, 80),
    min: n(b.min),
    km: n(b.km),
    dp: n(b.dp),
    terrain: String(b.terrain || '').slice(0, 160),
    blocks: Array.isArray(b.blocks) ? b.blocks.slice(0, 12).map((x) => ({
      k: ['echauffement', 'corps', 'retour'].includes(x && x.k) ? x.k : 'corps',
      min: n(x && x.min), z: /^Z[1-5]$/.test(x && x.z) ? x.z : null,
      l: String((x && x.l) || '').slice(0, 160), n: String((x && x.n) || '').slice(0, 300),
    })) : [],
    pz,
    back: typeof b.back === 'string' && /^https:\/\/claude\.ai\//.test(b.back) ? b.back : null,
    th: ['light', 'dark'].includes(b.th) ? b.th : null,
  };
}

function paceOf(z, brief) {
  const pz = (brief && brief.pz) || {};
  const base = S.settings.pace || DEFAULT_PACE.Z2;
  const scale = base / DEFAULT_PACE.Z2;
  return pz[z] || (z && DEFAULT_PACE[z] ? DEFAULT_PACE[z] * scale : base);
}
/* Vitesse (m/s) en montée : 100 m de D+ ≈ 1 km de plat */
function climbSpeed(z, g, brief) { return 1000 / (paceOf(z, brief) * 60) / (1 + 10 * Math.max(0, g)); }

/* « 4 × 8 min à 6 % », « 10 × 30 s en côte à 8-10 % », « 6 × 200 m » */
function parseClimb(brief) {
  if (!brief) return null;
  const corps = brief.blocks.filter((b) => b.k === 'corps');
  const hilly = brief.type === 'cotes';
  for (const b of corps) {
    const t = (b.l + ' ' + b.n).replace(/ /g, ' ');
    const mentions = /c[ôo]te|pente|mont[ée]e|grimp|d[ée]nivel|D\+/i.test(t);
    if (!mentions && !hilly) continue;
    const rm = /(\d{1,2})\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*(min(?:utes?)?|s(?:ec(?:ondes?)?)?|m|km)\b(?:\s*(\d{1,2})\s*(?:s\b)?)?/i.exec(t);
    const gm = /(\d{1,2}(?:[.,]\d)?)\s*(?:%|(?:[-–à]|à)\s*(\d{1,2}(?:[.,]\d)?)\s*%)/.exec(t);
    if (!rm && !gm && !hilly) continue;
    let g1 = gm ? num(gm[1]) : 6, g2 = gm && gm[2] ? num(gm[2]) : g1;
    if (!gm) { g1 = 6; g2 = 10; }
    if (g1 > g2) [g1, g2] = [g2, g1];
    g1 = clamp(g1, 2, 30) / 100; g2 = clamp(g2, 2, 30) / 100;
    const gm2 = gm ? (g1 + g2) / 2 : 0.08;
    let reps, len = null, sec = null;
    if (rm) {
      reps = clamp(num(rm[1]), 1, 30);
      const v = num(rm[2]), u = rm[3].toLowerCase();
      if (u.startsWith('min')) sec = v * 60 + (num(rm[4]) || 0);
      else if (u.startsWith('s')) sec = v;
      else if (u === 'm') len = v;
      else if (u === 'km') len = v * 1000;
    } else if (gm) { reps = 1; sec = (b.min || 10) * 60; } // montée continue (« 12 min à 4 % »)
    else { reps = 6; sec = 90; }
    if (sec != null) len = sec * climbSpeed(b.z || 'Z4', gm2, brief);
    len = clamp(Math.round(len / 10) * 10, 60, 2500);
    return { reps, len, g: [g1, g2], sec, zone: b.z || null, text: b.l };
  }
  return null;
}
function blockMeters(brief, kind) {
  let m = 0;
  for (const b of brief.blocks.filter((x) => x.k === kind)) if (b.min) m += (b.min * 60 * 1000) / (paceOf(b.z || 'Z1', brief) * 60);
  return m;
}

/* Cible de parcours */
function specFrom(brief, manual) {
  const m = manual || {};
  const type = typeOf(m.type || (brief && brief.type));
  let km = m.km ?? (brief && brief.km);
  const dp = m.dp ?? (brief && brief.dp) ?? 0;
  if (!km && brief && brief.min) km = Math.max(1, brief.min / paceOf('Z2', brief) - dp / 100);
  km = clamp(km || 8, 0.5, 120);
  let climb = m.noClimb ? null : m.climb || parseClimb(brief ? Object.assign({}, brief, { type }) : { type, blocks: [] });
  if (!climb && type === 'cotes' && !m.noClimb) climb = { reps: 6, len: Math.round(90 * climbSpeed('Z4', 0.08, brief) / 10) * 10, g: [0.06, 0.1], sec: 90, zone: 'Z4', text: '6 × 1 min 30 en côte' };
  return {
    type,
    D: km * 1000,
    H: clamp(dp, 0, 8000),
    terrain: m.terrain || TYPES[type].terrain,
    shape: m.shape || 'boucle',
    mode: climb ? 'cote' : 'boucle',
    climb,
    warm: brief ? Math.max(600, blockMeters(brief, 'echauffement')) : 1500,
    cool: brief ? Math.max(400, blockMeters(brief, 'retour')) : 800,
  };
}
/* Durée estimée (min) : 100 m de D+ ≈ 1 km de plat, à l'allure d'endurance */
function estMinutes(dist, dplus, brief) { return ((dist / 1000) + dplus / 100) * paceOf('Z2', brief); }
