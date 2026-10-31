/* =========================================================================
   CAIRN Atelier — noyau (repris de CAIRN) : gabarits HTML échappés, réconciliation du DOM, formats.
   ========================================================================= */

const RAW = Symbol('raw');
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toHtml(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (Array.isArray(v)) return v.map(toHtml).join('');
  if (typeof v === 'object' && v[RAW]) return v.s;
  return esc(v);
}
function html(strings, ...vals) {
  let s = strings[0];
  for (let i = 0; i < vals.length; i++) s += toHtml(vals[i]) + strings[i + 1];
  return { [RAW]: true, s };
}
function raw(s) { return { [RAW]: true, s: String(s) }; }
function icon(name, cls) {
  return raw(`<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`);
}
function attr(name, cond) { return cond ? raw(' ' + name) : ''; }

/* --- Réconciliation : on garde les nœuds existants (focus, défilement, saisies) --- */
function keyOf(n) { return n.nodeType === 1 ? n.getAttribute('data-key') : null; }
function sameKind(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  return a.nodeName === b.nodeName && keyOf(a) === keyOf(b);
}
function morphNode(from, to) {
  if (from.nodeType === 3 || from.nodeType === 8) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  if (from.hasAttribute('data-keep')) return; // élément piloté à la main (lecture du profil)
  // attributs
  const toAttrs = to.attributes;
  for (let i = 0; i < toAttrs.length; i++) {
    const a = toAttrs[i];
    if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
  }
  const fromAttrs = Array.from(from.attributes);
  for (const a of fromAttrs) if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
  // champs de formulaire : on ne touche pas à celui qu'on est en train de taper
  const tag = from.nodeName;
  const focused = from === document.activeElement;
  if (tag === 'INPUT') {
    const type = from.type;
    if (type === 'checkbox' || type === 'radio') {
      from.checked = to.hasAttribute('checked');
    } else if (!focused || from.hasAttribute('data-force')) {
      const v = to.getAttribute('value') ?? '';
      if (from.value !== v) from.value = v;
    }
  } else if (tag === 'TEXTAREA') {
    if (!focused || from.hasAttribute('data-force')) {
      const v = to.value;
      if (from.value !== v) from.value = v;
    }
    return; // le contenu d'un textarea n'est pas un enfant à réconcilier
  } else if (tag === 'SELECT') {
    morphChildren(from, to);
    const sel = Array.from(to.options).find((o) => o.hasAttribute('selected'));
    if (sel && from.value !== sel.value) from.value = sel.value;
    return;
  }
  morphChildren(from, to);
}
function morphChildren(from, to) {
  const oldNodes = Array.from(from.childNodes);
  const newNodes = Array.from(to.childNodes);
  const keyed = new Map();
  for (const n of oldNodes) { const k = keyOf(n); if (k) keyed.set(k, n); }
  let cursor = 0; // position dans oldNodes pour les nœuds non clés
  const used = new Set();
  let ref = from.firstChild;
  for (const nn of newNodes) {
    let match = null;
    const k = keyOf(nn);
    if (k) {
      const cand = keyed.get(k);
      if (cand && !used.has(cand) && sameKind(cand, nn)) match = cand;
    } else {
      while (cursor < oldNodes.length) {
        const cand = oldNodes[cursor];
        if (used.has(cand) || keyOf(cand)) { cursor++; continue; }
        if (sameKind(cand, nn)) { match = cand; cursor++; }
        break;
      }
    }
    if (match) {
      used.add(match);
      morphNode(match, nn);
      if (match !== ref) from.insertBefore(match, ref);
      ref = match.nextSibling;
    } else {
      from.insertBefore(nn, ref);
      used.add(nn);
      ref = nn.nextSibling;
    }
  }
  for (const n of oldNodes) if (!used.has(n) && n.parentNode === from) from.removeChild(n);
}

/* --- Petites aides --- */
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = (p = 's') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v) => { if (v === '' || v === null || v === undefined) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const round = (v, d = 0) => { const f = 10 ** d; return Math.round(v * f) / f; };
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (o[k] == null || typeof o[k] !== 'object') o[k] = nextIsIndex ? [] : {};
    o = o[k];
  }
  o[parts[parts.length - 1]] = value;
}
function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* stockage indisponible */ } }
/* --- Dates (toujours en heure locale, à midi pour éviter les décalages) --- */
const pad = (n) => String(n).padStart(2, '0');
function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseISO(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 12); }
function isISO(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function todayISO() { return iso(new Date()); }
function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }
function dow(s) { return (parseISO(s).getDay() + 6) % 7; } // 0 = lundi
function mondayOf(s) { return addDays(s, -dow(s)); }
function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
const DAY_KEYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const DAY_INIT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function fmtDay(s) { const d = parseISO(s); return DAY_NAMES[dow(s)].slice(0, 3) + '. ' + d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()]; }
function fmtDayLong(s) { const d = parseISO(s); return DAY_NAMES[dow(s)] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
function fmtShort(s) { const d = parseISO(s); return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()]; }
function fmtFull(s) { const d = parseISO(s); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
function fmtRange(a, b) { return fmtShort(a) + ' – ' + fmtShort(b); }

/* --- Durées, allures --- */
function fmtMin(m) {
  if (m == null || !Number.isFinite(m)) return '—';
  m = Math.round(m);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return h + ' h' + (r ? ' ' + pad(r) : '');
}
function fmtHours(m) { return m == null ? '—' : round(m / 60, 1).toString().replace('.', ',') + ' h'; }
function parseChrono(str) { // "mm:ss" ou "h:mm:ss" → secondes
  if (str == null || str === '') return null;
  const parts = String(str).trim().replace(/h/i, ':').replace(/[’'′]/g, ':').split(':').filter((x) => x !== '').map(Number);
  if (!parts.length || parts.some((x) => !Number.isFinite(x))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 60;
}
function parseHM(str) { // "8:30" ou "8h30" → minutes
  if (str == null || str === '') return null;
  const parts = String(str).trim().toLowerCase().replace('h', ':').split(':').filter((x) => x !== '').map(Number);
  if (!parts.length || parts.some((x) => !Number.isFinite(x))) return null;
  return parts.length >= 2 ? parts[0] * 60 + parts[1] : parts[0] * 60;
}
function fmtPace(minPerKm) {
  if (!Number.isFinite(minPerKm) || minPerKm <= 0) return '—';
  let m = Math.floor(minPerKm), s = Math.round((minPerKm - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return m + ':' + pad(s);
}
function fmtKm(v) { return v == null ? '—' : String(round(v, 1)).replace('.', ',') + ' km'; }
function fmtNum(v) { return v == null ? '—' : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }


/* --- Ajouts de l'Atelier --- */
function fmtKm1(m) { return m == null ? '—' : String(round(m / 1000, 1)).replace('.', ',') + ' km'; }
function fmtM(m) { return m == null ? '—' : fmtNum(m) + ' m'; }
function fmtPct(x) { return Math.round(x * 100) + ' %'; }
function fmtGrade(g) { return String(round(g * 100, 1)).replace('.', ',') + ' %'; }
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function lsJSON(key, fallback) {
  const v = lsGet(key);
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}
function lsPut(key, val) { lsSet(key, JSON.stringify(val)); }
function nowISO() { return new Date().toISOString(); }
function fmtDayISO(s) { return isISO(s) ? fmtDay(s) : ''; }
