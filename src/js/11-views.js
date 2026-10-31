/* =========================================================================
   Interface : barre du haut, outils de carte, panneau (4 modes), fenêtres.
   ========================================================================= */

const MODES = [
  { id: 'seance', label: 'Séance', ic: 'target' },
  { id: 'main', label: 'À la main', ic: 'hand' },
  { id: 'course', label: 'Course', ic: 'flag' },
  { id: 'mes', label: 'Enregistrés', ic: 'save' },
];
const SLOT = ['a', 'b', 'c'];

function App() {
  return html`${TopBar()}${MapTools()}${S.ui.pick ? PickBar() : ''}${Panel()}${Modal()}${Toast()}`;
}

function TopBar() {
  const b = S.brief;
  const titles = { seance: b ? b.title : 'Parcours sur mesure', main: 'Tracé à la main', course: S.race ? S.race.name : 'Ta course', mes: 'Mes parcours' };
  const sub = S.mode === 'seance' && b ? [b.date ? fmtDay(b.date) : '', 'séance CAIRN'].filter(Boolean).join(' · ') : 'Atelier parcours';
  const back = (b && b.back) || CAIRN_URL;
  return html`<header class="topbar">
    <a class="fab glass" href="${back}" aria-label="Retour à CAIRN">${icon('back')}</a>
    <div class="title-pill glass">${icon('cairn', 'logo')}<span class="t"><b>${titles[S.mode]}</b><span>${sub}</span></span></div>
    <button class="fab glass" data-act="settings" aria-label="Réglages">${icon('gear')}</button>
  </header>`;
}
function MapTools() {
  const ctx = activeCtx();
  return html`<div class="maptools">
    ${S.ui.layers ? LayerPop() : ''}
    <button class="fab glass" data-act="layers" aria-pressed="${S.ui.layers ? 'true' : 'false'}" aria-label="Fond de carte">${icon('layers')}</button>
    <button class="fab glass" data-act="locate" aria-label="Ma position">${S.ui.locating ? html`<span class="spin"></span>` : icon('locate')}</button>
    ${ctx || (S.mode === 'course' && S.race) ? html`<button class="fab glass" data-act="fit" aria-label="Voir tout le parcours">${icon('fit')}</button>` : ''}
  </div>`;
}
function LayerPop() {
  const cur = S.settings.layer || 'auto';
  const opt = (id, label, note, sw) => html`<button data-act="layer-set" data-id="${id}" aria-pressed="${cur === id ? 'true' : 'false'}"><span class="sw" style="background:${sw}"></span><span><span>${label}</span><br><span class="tiny muted">${note}</span></span></button>`;
  return html`<div class="layer-pop glass">
    ${opt('auto', 'Automatique', 'IGN en France, Topo ailleurs', 'conic-gradient(#efe9d8 0 50%,#c9d7b4 0)')}
    ${Object.entries(LAYERS).map(([id, d]) => opt(id, d.label, d.note, d.sw))}
  </div>`;
}
function PickBar() {
  return html`<div class="pickbar glass">${icon('pin')}<span>Touche la carte pour placer le départ</span><button class="btn btn-sm btn-tonal" data-act="pick-cancel">Annuler</button></div>`;
}

function Panel() {
  const body = S.mode === 'seance' ? SeancePanel() : S.mode === 'main' ? DrawPanel() : S.mode === 'course' ? CoursePanel() : SavedPanel();
  return html`<section class="panel" data-key="panel">
    <button class="grip" data-act="sheet-cycle" aria-label="Agrandir ou réduire le panneau"><span></span></button>
    <div class="panel-head"><div class="segbar" role="tablist">${MODES.map((m) => html`<button role="tab" data-act="mode" data-mode="${m.id}" aria-pressed="${S.mode === m.id ? 'true' : 'false'}">${icon(m.ic)}<span>${m.label}</span></button>`)}</div></div>
    <div class="panel-scroll" data-key="scroll-${S.mode}">${body}<p class="foot-credits">Cartes et itinéraires : IGN Géoplateforme · OpenStreetMap · OpenRouteService</p></div>
  </section>`;
}

/* ---------- Séance ---------- */
function SeancePanel() {
  const g = S.gen;
  const spec = currentSpec();
  if (g.results.length && !S.ui.edit && !g.busy) {
    const r = g.results[g.sel];
    return html`${SummaryLine(spec)}${Results(g.results, g.sel, 'gen', spec)}${RouteDetail(r, spec, 'gen')}`;
  }
  return html`${SessionCard(spec)}${StartBlock()}${OptionsBlock(spec)}${GenBlock(spec)}`;
}
function targetChips(spec) {
  return html`<span class="mx-row lg">${mx('dist', fmtKm1(spec.D))}${mx('dplus', fmtNum(spec.H) + ' m D+')}${spec.climb ? mx('reps', climbText(spec.climb)) : ''}</span>`;
}
function mx(kind, text) { return html`<span class="mx mx-${kind}">${icon(kind === 'dist' ? 'dist' : kind === 'dplus' ? 'mountain' : kind === 'dur' ? 'clock' : kind === 'reps' ? 'hill' : kind === 'trail' ? 'route' : 'info')}${text}</span>`; }
function climbText(cl) { return `${cl.reps} × ${cl.len >= 1000 ? fmtKm1(cl.len) : Math.round(cl.len / 10) * 10 + ' m'} à ${Math.round(cl.g[0] * 100)}${cl.g[1] - cl.g[0] > 0.005 ? '–' + Math.round(cl.g[1] * 100) : ''} %`; }
function SummaryLine(spec) {
  return html`<div class="spread">
    <div class="stack" style="gap:4px;min-width:0"><span class="label">${S.start ? 'Départ : ' + S.start.label : 'Cible'}</span>${targetChips(spec)}</div>
    <button class="btn btn-sm btn-tonal" data-act="edit-inputs">${icon('sliders')}Modifier</button>
  </div>`;
}
function SessionCard(spec) {
  const b = S.brief;
  const t = TYPES[spec.type];
  if (!b) {
    return html`<section class="stack">
      <div class="label">Séance</div>
      <div class="hscroll">${['endurance', 'sortie_longue', 'recup', 'cotes', 'qualite'].map((k) => html`<button class="chip-opt" data-act="type-set" data-type="${k}" aria-pressed="${spec.type === k ? 'true' : 'false'}">${icon(TYPES[k].icon)}${TYPES[k].label}</button>`)}</div>
      ${TargetInputs(spec)}
    </section>`;
  }
  const blocks = b.blocks.length ? html`<div class="stack" style="gap:6px">${b.blocks.map((x) => html`<div class="blk"><span class="k">${x.k === 'echauffement' ? 'Échauff.' : x.k === 'retour' ? 'Retour' : 'Corps'}${x.min ? ' · ' + x.min + "'" : ''}</span><span>${x.l}${x.n ? html`<br><span class="muted tiny">${x.n}</span>` : ''}</span></div>`)}</div>` : '';
  return html`<section class="card session t-${spec.type}">
    <div class="session-top"><span class="ticon">${icon(t.icon)}</span><span class="grow"><span class="label">${t.label}${b.date ? ' · ' + fmtDay(b.date) : ''}</span><b>${b.title}</b></span></div>
    <span class="mx-row lg">${b.min ? mx('dur', fmtMin(b.min)) : ''}${mx('dist', fmtKm1(spec.D))}${mx('dplus', fmtNum(spec.H) + ' m D+')}</span>
    ${blocks ? Fold('blocks', 'Détail de la séance', blocks) : ''}
    ${Fold('target', 'Ajuster la distance et le D+', TargetInputs(spec))}
  </section>`;
}
function TargetInputs(spec) {
  return html`<div class="grid2">
    <label class="field"><span class="field-label">Distance</span><span class="input-wrap"><input class="input has-unit" inputmode="decimal" data-in="km" value="${round(spec.D / 1000, 1)}"><span class="unit">km</span></span></label>
    <label class="field"><span class="field-label">Dénivelé</span><span class="input-wrap"><input class="input has-unit" inputmode="numeric" data-in="dp" value="${Math.round(spec.H)}"><span class="unit">m D+</span></span></label>
  </div>`;
}
function Fold(key, label, body) {
  const open = !!S.ui.folds[key];
  return html`<div><button class="fold-btn" data-act="fold" data-key="${key}" aria-expanded="${open ? 'true' : 'false'}"><span>${label}</span>${icon('chevron-down')}</button>${open ? html`<div class="stack">${body}</div>` : ''}</div>`;
}
function StartBlock() {
  const st = S.start;
  const prov = st ? providerFor(st.p) : null;
  return html`<section class="stack">
    <div class="label">Départ</div>
    <div class="card start-row">
      <span class="ticon">${icon('pin')}</span>
      <span class="where"><b>${st ? st.label : 'Choisis ton point de départ'}</b><span class="small muted">${st ? (prov === 'ors' ? 'Hors de France · OpenRouteService' : 'France · IGN') : 'Ta position, un lieu enregistré ou un point sur la carte'}</span></span>
      ${st && st.src !== 'place' ? html`<button class="link small" data-act="place-save">Enregistrer</button>` : ''}
    </div>
    <div class="hscroll">
      <button class="chip-opt" data-act="start-gps">${icon('locate')}Ma position</button>
      ${S.settings.places.map((pl) => html`<button class="chip-opt" data-act="start-place" data-id="${pl.id}" aria-pressed="${st && st.placeId === pl.id ? 'true' : 'false'}">${icon('home')}${pl.name}</button>`)}
      <button class="chip-opt" data-act="start-pick" aria-pressed="${S.ui.pick === 'start' ? 'true' : 'false'}">${icon('pin')}Sur la carte</button>
      <button class="chip-opt" data-act="start-search">${icon('search')}Adresse</button>
    </div>
    ${st && prov === 'ors' && !S.settings.orsKey ? html`<div class="note note-warn">${icon('key')}<span>Ce départ est hors de France. Ajoute ta clé OpenRouteService gratuite dans les <button class="link" data-act="settings">réglages</button>.</span></div>` : ''}
  </section>`;
}
function OptionsBlock(spec) {
  if (spec.mode === 'cote') {
    const cl = spec.climb;
    return html`<section class="stack">
      <div class="label">Côte recherchée</div>
      <div class="card stack">
        <span class="mx-row lg">${mx('reps', climbText(cl))}</span>
        <p class="small muted">L'Atelier cherche une montée régulière près du départ : échauffement jusqu'au pied, ${cl.reps > 1 ? 'répétitions montée / descente' : 'montée'}, puis retour.</p>
        ${Fold('climb', 'Ajuster la côte', html`<div class="grid3">
          <label class="field"><span class="field-label">Répét.</span><input class="input" inputmode="numeric" data-in="reps" value="${cl.reps}"></label>
          <label class="field"><span class="field-label">Longueur</span><span class="input-wrap"><input class="input has-unit" inputmode="numeric" data-in="clen" value="${Math.round(cl.len)}"><span class="unit">m</span></span></label>
          <label class="field"><span class="field-label">Pente</span><span class="input-wrap"><input class="input has-unit" inputmode="text" data-in="cgrade" value="${Math.round(cl.g[0] * 100)}${cl.g[1] - cl.g[0] > 0.005 ? '-' + Math.round(cl.g[1] * 100) : ''}"><span class="unit">%</span></span></label>
        </div>
        <div class="spread"><span class="small">Répétitions dans le tracé GPX</span><button class="toggle" data-act="reps-toggle" aria-pressed="${spec.includeReps ? 'true' : 'false'}" aria-label="Répétitions dans le tracé"></button></div>`)}
      </div>
      <button class="link small" data-act="climb-off" style="align-self:flex-start">Plutôt une boucle classique</button>
    </section>`;
  }
  return html`<section class="stack">
    <div class="label">Forme et terrain</div>
    <div class="segbar sm">${[['boucle', 'Boucle', 'loop'], ['ar', 'Aller-retour', 'outback']].map(([k, l, ic]) => html`<button data-act="shape-set" data-v="${k}" aria-pressed="${spec.shape === k ? 'true' : 'false'}">${icon(ic)}${l}</button>`)}</div>
    <div class="segbar sm">${Object.entries(TERRAINS).map(([k, l]) => html`<button data-act="terrain-set" data-v="${k}" aria-pressed="${spec.terrain === k ? 'true' : 'false'}">${l}</button>`)}</div>
    ${S.manual.noClimb && S.brief && parseClimb(S.brief) ? html`<button class="link small" data-act="climb-on" style="align-self:flex-start">Revenir à la recherche de côte</button>` : ''}
  </section>`;
}
function GenBlock(spec) {
  const g = S.gen;
  if (g.busy) return Progress(g.step, g.pct, 'gen-cancel');
  return html`<section class="stack">
    ${g.err ? html`<div class="note note-warn">${icon('alert')}<span>${g.err}</span></div>` : ''}
    <button class="btn btn-primary btn-block" data-act="generate" ${S.start ? '' : raw('disabled')}>${icon('wand')}${spec.mode === 'cote' ? 'Trouver une côte' : 'Proposer 3 parcours'}</button>
    ${!S.start ? html`<p class="small muted" style="text-align:center">Choisis d'abord un départ.</p>` : ''}
    ${g.results.length ? html`<button class="btn btn-sm btn-ghost" data-act="edit-done">Revoir les propositions</button>` : ''}
  </section>`;
}
function Progress(step, pct, cancelAct) {
  return html`<div class="progress">
    <div class="spread"><span class="row-nw"><span class="spin"></span><b>${step || 'Calcul en cours'}</b></span>${cancelAct ? html`<button class="btn btn-sm btn-ghost" data-act="${cancelAct}">Annuler</button>` : ''}</div>
    <div class="bar"><span style="width:${Math.round(clamp(pct || 0.03, 0.03, 1) * 100)}%"></span></div>
    <p class="tiny muted">Les sentiers et le relief sont lus en direct sur les cartes IGN.</p>
  </div>`;
}

/* ---------- Propositions et détail ---------- */
function Results(list, sel, ctx, spec) {
  return html`<div class="rcards" role="list">${list.map((r, i) => {
    const ok = r.fit ? r.fit.dOk && r.fit.hOk && r.fit.gOk !== false : true;
    return html`<button class="rcard rc-${SLOT[i % 3]}" role="listitem" data-act="pick-result" data-ctx="${ctx}" data-i="${i}" aria-pressed="${i === sel ? 'true' : 'false'}">
      <span class="rn"><b>${r.name || 'Parcours ' + 'ABC'[i]}</b>${spec ? (ok ? icon('check', 'ok-ic ic-sm') : icon('info', 'off-ic ic-sm')) : ''}</span>
      <span class="rv"><span>${fmtKm1(r.dist)}</span><span>${fmtNum(r.dplus)} m D+</span></span>
      <span class="rs">${r.climb ? fmtGrade(r.climb.avg) + ' de moyenne' : r.share ? 'Hors route ' + fmtPct(1 - r.share.route) : r.kind === 'course' ? 'Sur le parcours' : ''}</span>
    </button>`;
  })}</div>`;
}
function RouteDetail(r, spec, ctx) {
  if (!r) return '';
  const fit = spec && r.fit;
  const mins = estMinutes(r.dist, r.dplus, S.brief);
  const dTxt = fit ? (fit.dOk ? 'pile la cible' : (r.dist > spec.D ? '+' : '−') + fmtKm1(Math.abs(r.dist - spec.D))) : 'D− ' + fmtNum(r.dminus) + ' m';
  const hTxt = fit ? (fit.hOk ? 'dans la cible' : (fit.dH > 0 ? '+' : '−') + fmtNum(Math.abs(fit.dH)) + ' m') : 'max ' + fmtNum(r.prof.zmax) + ' m';
  return html`<section class="stack" data-key="detail-${r.id}">
    <div class="kpis">
      <div class="kpi"><span class="label">Distance</span><span class="v">${fmtKm1(r.dist)}</span><span class="d ${fit ? (fit.dOk ? 'ok' : 'off') : ''}">${dTxt}</span></div>
      <div class="kpi"><span class="label">D+</span><span class="v">${fmtNum(r.dplus)}<small> m</small></span><span class="d ${fit ? (fit.hOk ? 'ok' : 'off') : ''}">${hTxt}</span></div>
      <div class="kpi"><span class="label">Durée</span><span class="v">${fmtMin(mins)}</span><span class="d">à ton allure</span></div>
    </div>
    ${r.climb ? ClimbInfo(r) : ''}
    ${Profile(r)}
    ${r.share ? ShareBar(r.share) : ''}
    ${RouteActions(r, ctx)}
  </section>`;
}
function ClimbInfo(r) {
  const c = r.climb;
  const inRange = c.g ? c.avg >= c.g[0] - 0.01 && c.avg <= c.g[1] + 0.015 : true;
  return html`<div class="note ${inRange ? 'note-good' : 'note-warn'}">${icon('hill')}<span><b>Côte de ${fmtM(Math.round(c.len / 10) * 10)} à ${fmtGrade(c.avg)}</b> (${fmtNum(c.gain)} m de montée)${c.reps > 1 ? html`, à répéter ${c.reps} fois` : ''}.${c.approach != null ? html` Pied de côte à ${fmtKm1(c.approach)} du départ.` : ''}${inRange ? '' : html` Pente un peu ${c.g && c.avg < c.g[0] ? 'douce' : 'raide'} par rapport à la séance.`}</span></div>`;
}
function ShareBar(sh) {
  const p = (x) => Math.round(x * 100);
  return html`<div class="stack" style="gap:6px">
    <div class="share"><i class="s1" style="width:${p(sh.sentier)}%"></i><i class="s2" style="width:${p(sh.chemin)}%"></i><i class="s3" style="width:${p(sh.route)}%"></i></div>
    <div class="share-l"><span><i style="background:var(--r-c)"></i>Sentiers ${p(sh.sentier)} %</span><span><i style="background:color-mix(in srgb,var(--r-c) 45%,var(--line-strong))"></i>Chemins ${p(sh.chemin)} %</span><span><i style="background:var(--fg-faint)"></i>Routes ${p(sh.route)} %</span></div>
  </div>`;
}
function RouteActions(r, ctx) {
  const saved = isSaved(r);
  const canEdit = r.kind !== 'cote' && !(r.kind === 'course' && r.race && r.race.how === 'cote');
  return html`<div class="stack">
    <button class="btn btn-primary btn-block" data-act="gpx" data-ctx="${ctx}">${icon('watch')}Envoyer à la montre</button>
    <div class="btn-grid">
      ${ctx === 'view' ? '' : html`<button class="btn btn-secondary btn-sm" data-act="save-route" data-ctx="${ctx}" ${saved ? raw('disabled') : ''}>${icon(saved ? 'check' : 'save')}${saved ? 'Enregistré' : 'Enregistrer'}</button>`}
      ${canEdit ? html`<button class="btn btn-secondary btn-sm" data-act="edit-route" data-ctx="${ctx}">${icon('edit')}Modifier</button>` : ''}
      ${canEdit ? html`<button class="btn btn-secondary btn-sm" data-act="reverse" data-ctx="${ctx}">${icon('swap')}Inverser</button>` : ''}
      ${ctx === 'gen' ? html`<button class="btn btn-secondary btn-sm" data-act="regen">${icon('refresh')}Autres idées</button>` : ''}
      ${ctx === 'view' ? html`<button class="btn btn-secondary btn-sm btn-danger" data-act="del-saved" data-id="${r.id}">${icon('trash')}Supprimer</button>` : ''}
      ${r.race || r.kind === 'course' ? html`<a class="btn btn-secondary btn-sm" href="${driveUrl(r.start || r.pts[0])}" target="_blank" rel="noopener">${icon('car')}Y aller</a>` : ''}
    </div>
  </div>`;
}
function driveUrl(p) { return `https://www.google.com/maps/dir/?api=1&destination=${p[1].toFixed(5)},${p[0].toFixed(5)}`; }

/* Profil d'altitude (SVG) coloré selon la pente ; survol / glisser pour lire la carte */
function Profile(r, o = {}) {
  const P = r.prof;
  if (!P || P.len <= 0) return '';
  const W = 600, H = 132, L0 = 34, B = 18, T = 6;
  const z0 = Math.floor(P.zmin / 10) * 10, z1 = Math.max(Math.ceil(P.zmax / 10) * 10, z0 + 40);
  const X = (d) => L0 + (d / P.len) * (W - L0 - 2);
  const Y = (z) => T + (1 - (z - z0) / (z1 - z0)) * (H - T - B);
  const step = Math.max(1, Math.floor(P.d.length / 400));
  let area = `M${X(0).toFixed(1)},${H - B}`;
  for (let i = 0; i < P.d.length; i += step) area += `L${X(P.d[i]).toFixed(1)},${Y(P.z[i]).toFixed(1)}`;
  area += `L${X(P.len).toFixed(1)},${Y(P.z[P.z.length - 1]).toFixed(1)}L${X(P.len).toFixed(1)},${H - B}Z`;
  const gr = grades(P);
  let lines = '';
  let cls = slopeClass(gr[0]), path = `M${X(P.d[0]).toFixed(1)},${Y(P.z[0]).toFixed(1)}`;
  for (let i = step; i < P.d.length; i += step) {
    const c = slopeClass(gr[i]);
    path += `L${X(P.d[i]).toFixed(1)},${Y(P.z[i]).toFixed(1)}`;
    if (c !== cls || i + step >= P.d.length) {
      lines += `<path d="${path}" fill="none" stroke="var(--sl${cls})" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
      cls = c;
      path = `M${X(P.d[i]).toFixed(1)},${Y(P.z[i]).toFixed(1)}`;
    }
  }
  let bands = '';
  const bandList = o.bands || (r.climbSeg && r.climb ? [] : []);
  for (const b of bandList) bands += `<rect class="${b.cls || 'climb-band'}" x="${X(b.from).toFixed(1)}" y="${T}" width="${Math.max(1, X(b.to) - X(b.from)).toFixed(1)}" height="${H - T - B}"/>`;
  const kmStep = P.len > 40000 ? 10000 : P.len > 16000 ? 5000 : P.len > 6000 ? 2000 : P.len > 2500 ? 1000 : 500;
  let ticks = '';
  for (let x = 0; x <= P.len + 1; x += kmStep) ticks += `<text class="tick" x="${X(x).toFixed(1)}" y="${H - 4}" text-anchor="${x === 0 ? 'start' : 'middle'}">${String(round(x / 1000, 1)).replace('.', ',')}</text>`;
  ticks += `<text class="tick" x="0" y="${T + 8}">${fmtNum(z1)}</text><text class="tick" x="0" y="${H - B}">${fmtNum(z0)}</text>`;
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Profil d'altitude">
    ${bands}<path class="area" d="${area}"/>${lines}
    <line class="axis" x1="${L0}" y1="${H - B}" x2="${W}" y2="${H - B}"/>
    ${ticks}
    <line class="cross" data-cross data-keep x1="0" y1="${T}" x2="0" y2="${H - B}" visibility="hidden"/>
    <circle class="cross-dot" data-dot data-keep r="4" cx="0" cy="0" visibility="hidden"/>
  </svg>`;
  return html`<div class="stack" style="gap:6px"><div class="prof" data-key="prof-${r.id}-${Math.round(P.len)}" data-rid="${r.id}" data-l0="${L0}" data-w="${W}">${raw(svg)}<div class="bubble" data-keep hidden></div></div>
    <div class="legend-sl"><span><i style="background:var(--sl0)"></i>&lt; 5 %</span><span><i style="background:var(--sl1)"></i>5–10 %</span><span><i style="background:var(--sl2)"></i>10–15 %</span><span><i style="background:var(--sl3)"></i>&gt; 15 %</span></div></div>`;
}

/* ---------- À la main ---------- */
function DrawPanel() {
  const d = S.draw;
  const n = d.wps.length;
  const closed = n > 2 && samePt(d.wps[0], d.wps[n - 1], 2);
  return html`
    ${!n ? html`<div class="note note-accent">${icon('hand')}<span>Touche la carte pour poser le <b>départ</b>, puis chaque point de passage. Le tracé suit les sentiers ; déplace un point en le faisant glisser.</span></div>` : ''}
    <div class="spread"><span class="row-nw"><button class="toggle" data-act="draw-follow" aria-pressed="${d.follow ? 'true' : 'false'}" aria-label="Suivre les sentiers"></button><span class="small"><b>Suivre les sentiers</b><br><span class="muted">${d.follow ? 'Le tracé colle aux chemins' : 'Ligne droite (hors sentier)'}</span></span></span>${d.busy ? html`<span class="spin"></span>` : ''}</div>
    <div class="btn-grid">
      <button class="btn btn-secondary btn-sm" data-act="draw-undo" ${n ? '' : raw('disabled')}>${icon('undo')}Annuler</button>
      <button class="btn btn-secondary btn-sm" data-act="draw-loop" ${n > 1 && !closed ? '' : raw('disabled')}>${icon('loop')}Boucler</button>
      <button class="btn btn-secondary btn-sm" data-act="draw-outback" ${n > 1 && !closed ? '' : raw('disabled')}>${icon('outback')}Aller-retour</button>
      <button class="btn btn-secondary btn-sm" data-act="draw-clear" ${n ? '' : raw('disabled')}>${icon('trash')}Effacer</button>
    </div>
    ${d.sel != null && d.wps[d.sel] ? html`<div class="card spread"><span class="small"><b>${d.sel === 0 ? 'Départ' : 'Point ' + d.sel}</b> sélectionné</span><button class="btn btn-sm btn-danger" data-act="draw-del">${icon('trash')}Retirer</button></div>` : ''}
    ${d.err ? html`<div class="note note-warn">${icon('alert')}<span>${d.err}</span></div>` : ''}
    ${d.route ? RouteDetail(d.route, null, 'draw') : n === 1 ? html`<p class="small muted">Ajoute un deuxième point pour tracer.</p>` : ''}`;
}

/* ---------- Course ---------- */
function CoursePanel() {
  const rc = S.race;
  if (S.ui.raceBusy) return Progress('Lecture du tracé de la course', 0.4);
  if (!rc) {
    return html`<div class="empty">${icon('flag')}<b>Importe le tracé de ta course</b><p class="small">Le fichier GPX se trouve en général sur la page de l'épreuve (site de l'organisateur, Tracedetrail, Livetrail…).</p></div>
      <label class="btn btn-primary btn-block">${icon('upload')}Choisir le fichier GPX<input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" data-file="race" hidden></label>`;
  }
  const spec = currentSpec();
  const how = S.rplan.how === 'cote' && !spec.climb ? 'ar' : S.rplan.how;
  const P = S.rplan;
  const ctxRoute = P.results[P.sel];
  const raceView = { id: 'race', prof: rc.prof };
  const bands = rc.climbs.map((c) => ({ from: c.from, to: c.to }));
  if (P.a != null && P.b != null && P.b > P.a) bands.push({ from: P.a * 1000, to: P.b * 1000, cls: 'sel-band' });
  return html`
    <section class="card stack">
      <div class="spread"><span class="stack" style="gap:2px;min-width:0"><span class="label">Ta course</span><b>${rc.name}</b></span><button class="icon-btn" data-act="race-remove" aria-label="Retirer la course">${icon('trash')}</button></div>
      <span class="mx-row lg">${mx('dist', fmtKm1(rc.dist))}${mx('dplus', fmtNum(rc.dplus) + ' m D+')}${mx('reps', rc.climbs.length + ' montées clés')}</span>
      ${Profile(raceView, { bands, ctx: 'racefull' })}
      ${Fold('climbs', 'Montées clés', html`<div>${rc.climbs.map((c, i) => html`<div class="climb-row"><span class="n">${i + 1}</span><span>km ${String(round(c.from / 1000, 1)).replace('.', ',')} → ${String(round(c.to / 1000, 1)).replace('.', ',')}<br><span class="muted tiny">${fmtM(Math.round(c.gain))} sur ${fmtKm1(c.len)}</span></span><span class="mono strong">${fmtGrade(c.avg)}</span></div>`)}</div>`)}
    </section>
    <section class="stack">
      <div class="label">S'entraîner sur le parcours</div>
      <div class="spread"><span>${targetChips(spec)}</span><button class="btn btn-sm btn-tonal" data-act="fold" data-key="target">${icon('sliders')}Cible</button></div>
      ${S.ui.folds.target ? TargetInputs(spec) : ''}
      <div class="segbar sm">${[['ar', 'Aller-retour'], ['boucle', 'Boucle'], ...(spec.climb ? [['cote', 'Côte']] : []), ['aller', 'Aller simple']].map(([k, l]) => html`<button data-act="race-how" data-v="${k}" aria-pressed="${how === k ? 'true' : 'false'}">${l}</button>`)}</div>
      ${P.busy ? Progress(P.step, P.pct) : html`${P.err ? html`<div class="note note-warn">${icon('alert')}<span>${P.err}</span></div>` : ''}<button class="btn btn-primary btn-block" data-act="race-plan">${icon('wand')}Proposer des tronçons</button>`}
      ${P.results.length && !P.busy ? html`${Results(P.results, P.sel, 'race', spec)}${RouteDetail(ctxRoute, spec, 'race')}` : ''}
      ${Fold('manual', 'Choisir un tronçon à la main', ManualRange(rc, how))}
    </section>`;
}
function ManualRange(rc, how) {
  const max = round(rc.dist / 1000, 1);
  const a = S.rplan.a ?? 0, b = S.rplan.b ?? Math.min(max, 10);
  const { up, down } = raceUpDown(rc, a * 1000, b * 1000);
  return html`<div class="stack">
    <label class="field"><span class="spread"><span class="field-label">Début</span><span class="mono small">km ${String(a).replace('.', ',')}</span></span><input type="range" min="0" max="${max}" step="0.1" value="${a}" data-in="ra"></label>
    <label class="field"><span class="spread"><span class="field-label">Fin</span><span class="mono small">km ${String(b).replace('.', ',')}</span></span><input type="range" min="0" max="${max}" step="0.1" value="${b}" data-in="rb"></label>
    <p class="small muted">Tronçon de ${fmtKm1(Math.max(0, b - a) * 1000)} · ${fmtNum(up)} m D+ · ${fmtNum(down)} m D−. Forme : ${how === 'ar' ? 'aller-retour' : how === 'boucle' ? 'boucle (retour par les sentiers)' : how === 'cote' ? 'répétitions en côte' : 'aller simple'}.</p>
    <button class="btn btn-secondary btn-block" data-act="race-manual" ${b > a ? '' : raw('disabled')}>${icon('route')}Créer ce tronçon</button>
  </div>`;
}

/* ---------- Enregistrés ---------- */
function SavedPanel() {
  if (S.view) {
    return html`<button class="btn btn-sm btn-ghost" data-act="view-close" style="align-self:flex-start">${icon('left')}Tous mes parcours</button>
      <div class="stack" style="gap:2px"><span class="label">${S.view.session && S.view.session.date ? fmtDay(S.view.session.date) + ' · ' + S.view.session.title : 'Parcours enregistré'}</span><h2>${S.view.name}</h2></div>
      ${RouteDetail(S.view, null, 'view')}`;
  }
  if (!S.saved.length) return html`<div class="empty">${icon('save')}<b>Aucun parcours enregistré</b><p class="small">Enregistre un parcours pour le retrouver ici, même sans réseau.</p></div>`;
  return html`<div class="list">${S.saved.map((o) => html`<button class="item" data-act="open-saved" data-id="${o.id}">
    <span class="ticon t-${o.session ? o.session.type : 'endurance'}">${icon(o.kind === 'cote' ? 'hill' : o.kind === 'course' ? 'flag' : o.kind === 'main' ? 'hand' : 'route')}</span>
    <span style="min-width:0"><span class="item-title">${o.name}</span><span class="item-sub mx-row">${fmtKm1(o.dist)} · ${fmtNum(o.dplus)} m D+${o.session && o.session.date ? ' · ' + fmtDay(o.session.date) : ''}</span></span>
    ${icon('right', 'faint')}
  </button>`)}</div>`;
}

/* ---------- Fenêtres ---------- */
function Modal() {
  const m = S.ui.modal;
  if (!m) return '';
  const body = m === 'settings' ? SettingsModal() : m === 'gpx' ? GpxModal() : m === 'search' ? SearchModal() : m === 'place' ? PlaceModal() : '';
  const titles = { settings: 'Réglages', gpx: 'Envoyer à la montre', search: 'Chercher un départ', place: 'Enregistrer ce lieu' };
  return html`<div class="modal-layer" data-key="modal-${m}"><button class="modal-scrim" data-act="modal-close" aria-label="Fermer"></button>
    <div class="modal" role="dialog" aria-modal="true" aria-label="${titles[m]}">
      <div class="modal-head"><span class="grow"><h2>${titles[m]}</h2></span><button class="icon-btn" data-act="modal-close" aria-label="Fermer">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>
    </div></div>`;
}
function SettingsModal() {
  const st = S.settings;
  return html`
    <section class="stack"><div class="label">Moteur de calcul</div>
      <div class="segbar sm">${[['auto', 'Auto'], ['ign', 'IGN'], ['ors', 'ORS (monde)']].map(([k, l]) => html`<button data-act="set-engine" data-v="${k}" aria-pressed="${st.engine === k ? 'true' : 'false'}">${l}</button>`)}</div>
      <p class="small muted">Automatique : IGN en France (gratuit, sans compte), OpenRouteService ailleurs.</p>
    </section>
    <section class="stack"><div class="label">Clé OpenRouteService</div>
      <div class="row-nw"><input class="input" data-in="orsKey" value="${st.orsKey || ''}" placeholder="Colle ta clé ici" autocomplete="off" spellcheck="false"><button class="btn btn-secondary btn-sm" data-act="ors-test" ${st.orsKey ? '' : raw('disabled')}>Tester</button></div>
      ${S.ui.orsMsg ? html`<p class="small ${S.ui.orsOk ? 'ok-ic' : 'off-ic'}">${S.ui.orsMsg}</p>` : ''}
      ${Fold('orshelp', 'Comment obtenir une clé gratuite', html`<ol class="steps-list"><li><span>Va sur <a class="link" href="https://openrouteservice.org/dev/#/signup" target="_blank" rel="noopener">openrouteservice.org</a> et crée un compte gratuit.</span></li><li><span>Dans ton tableau de bord, crée une clé de type <b>Standard</b>.</span></li><li><span>Copie-la et colle-la ci-dessus. Elle reste sur ton téléphone.</span></li></ol>`)}
    </section>
    <section class="stack"><div class="label">Allure d'endurance</div>
      <label class="field"><span class="input-wrap"><input class="input has-unit" data-in="pace" inputmode="text" value="${fmtPace(st.pace || 6.5)}"><span class="unit">/km</span></span><span class="field-help">Sert à estimer les durées quand l'Atelier est ouvert sans séance CAIRN.</span></label>
    </section>
    <section class="stack"><div class="label">Lieux enregistrés</div>
      ${st.places.length ? html`<div class="list">${st.places.map((pl) => html`<div class="item"><span class="ticon">${icon('home')}</span><span class="item-title">${pl.name}</span><button class="icon-btn" data-act="place-del" data-id="${pl.id}" aria-label="Supprimer ${pl.name}">${icon('trash')}</button></div>`)}</div>` : html`<p class="small muted">Aucun lieu. Choisis un départ puis « Enregistrer ».</p>`}
    </section>
    <section class="stack"><div class="label">Thème</div>
      <div class="segbar sm">${[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) => html`<button data-act="set-theme" data-v="${k}" aria-pressed="${(st.theme || 'auto') === k ? 'true' : 'false'}">${l}</button>`)}</div>
    </section>
    <p class="tiny muted">Tes lieux, parcours et clé restent sur cet appareil. Fonds de carte : © IGN, © OpenTopoMap, © OpenStreetMap. Version ${APP_VERSION}.</p>`;
}
function GpxModal() {
  const f = S.ui.gpxName || 'parcours.gpx';
  return html`<p>Le fichier <b class="mono small">${f}</b> vient d'être téléchargé.</p>
    <ol class="steps-list">
      <li><span>Ouvre-le depuis la notification ou le dossier <b>Téléchargements</b>.</span></li>
      <li><span>Choisis l'appli <b>Garmin Connect</b>, type <b>Course à pied</b> (ou Trail), puis <b>Enregistrer</b>.</span></li>
      <li><span>Touche <b>Envoyer vers l'appareil</b> et synchronise ta montre.</span></li>
      <li><span>Sur la montre : lance l'activité, puis <b>Navigation → Parcours</b>.</span></li>
    </ol>
    ${Fold('gpxpc', 'Depuis un ordinateur', html`<p class="small">Sur connect.garmin.com : <b>Entraînement et planification → Parcours → Importer</b>, choisis le fichier, puis envoie-le à la montre.</p>`)}
    <button class="btn btn-secondary btn-block" data-act="gpx-again">${icon('download')}Télécharger à nouveau</button>`;
}
function SearchModal() {
  const s = S.ui.search;
  return html`<div class="input-wrap"><input class="input" data-in="q" value="${s.q}" placeholder="Adresse, village, parking, sommet…" autocomplete="off" enterkeyhint="search" data-autofocus></div>
    ${s.busy ? html`<div class="row-nw"><span class="spin"></span><span class="small muted">Recherche…</span></div>` : ''}
    ${s.res.length ? html`<div class="result-list">${s.res.map((x, i) => html`<button data-act="search-pick" data-i="${i}"><b>${x.label}</b>${x.sub ? html`<small>${x.sub}</small>` : ''}</button>`)}</div>` : s.q.length >= 3 && !s.busy ? html`<p class="small muted">Aucun résultat.</p>` : ''}`;
}
function PlaceModal() {
  return html`<div class="chips">${['Maison', 'Travail', 'Parking trail'].map((n) => html`<button class="chip-opt" data-act="place-name" data-v="${n}" aria-pressed="${S.ui.placeName === n ? 'true' : 'false'}">${n}</button>`)}</div>
    <input class="input" data-in="placeName" value="${S.ui.placeName}" placeholder="Nom du lieu" maxlength="30">
    <button class="btn btn-primary btn-block" data-act="place-confirm" ${S.ui.placeName.trim() ? '' : raw('disabled')}>${icon('save')}Enregistrer</button>
    <p class="tiny muted">Le lieu reste uniquement sur cet appareil.</p>`;
}
function Toast() {
  const t = S.ui.toast;
  if (!t) return '';
  return html`<div class="toast-layer"><div class="toast" role="status" data-key="toast-${t.id}"><span>${t.text}</span>${t.act ? html`<button class="btn btn-sm" data-act="${t.act}">${t.actLabel}</button>` : ''}</div></div>`;
}
