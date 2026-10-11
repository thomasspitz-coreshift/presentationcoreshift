// Gabarits de slides. Chaque gabarit reçoit le contenu d'une slide (objet issu du YAML ou du studio)
// et renvoie du HTML. Ce fichier tourne aussi bien dans Node (build, PDF, vidéo) que dans le navigateur (studio).
//
// Attributs posés sur les éléments :
//   data-a / data-d / data-dur  animation d'entrée, délai et durée en ms (voir runtime.js)
//   data-f                      chemin du champ affiché, pour l'édition directe dans le studio

const esc = (s = '') =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Typographie française : espaces fines insécables, apostrophe courbe, pas de « à » ou « de » en fin de ligne.
const fr = (s) =>
  s
    .replace(/'/g, '’')
    .replace(/ ([:;!?»€%])/g, ' $1')
    .replace(/« /g, '« ')
    .replace(/(?<=^|[\s*])(à|À|a|y|de|en|et|le|la|un) /g, '$1 ');

// *mot* → mot en couleur d'accent ; retour à la ligne → <br>
// Un mot collé à l'accent (« rythme*. ») reste soudé à lui : pas de point orphelin en début de ligne.
export const rich = (s = '') =>
  fr(esc(s))
    .replace(/(\S*)\*([^*]+)\*(\S*)/g, (_, pre, inner, post) => {
      const words = inner.split(' ').map((w) => `<em>${w}</em>`);
      const last = words.length - 1;
      words[0] = pre + words[0];
      words[last] += post;
      const glued = new Set([pre ? 0 : -1, post ? last : -1]);
      return words.map((w, i) => (glued.has(i) ? `<span class="nw">${w}</span>` : w)).join(' ');
    })
    .replace(/\n/g, '<br>');

const plain = (s = '') => fr(esc(s));
const pad = (n) => String(n).padStart(2, '0');
const slug = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const n2 = (v) => Math.round(v * 10) / 10;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const list = (v) => (Array.isArray(v) ? v : []);
const ed = (path) => ` data-f="${path}"`;
const edr = (path) => ` data-f="${path}" data-rich="1"`; // champ qui accepte *mot* en orange
export const fmt = (v, dec = 0) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);

// Logo Coreshift : losange à quatre nœuds, le nœud gauche en orange.
const NODES = [[100, 36], [164, 100], [100, 164], [36, 100]];
const EDGES = [[0, 1], [0, 3], [2, 1], [2, 3]];
export const logo = (cls = '') =>
  `<svg class="logo ${cls}" viewBox="0 0 200 200" aria-hidden="true"><g class="logo-lines">${EDGES.map(
    ([a, b]) => `<line x1="${NODES[a][0]}" y1="${NODES[a][1]}" x2="${NODES[b][0]}" y2="${NODES[b][1]}"/>`
  ).join('')}</g>${NODES.map(
    ([x, y], i) => `<circle cx="${x}" cy="${y}" r="22"${i === 3 ? ' class="logo-accent"' : ''}/>`
  ).join('')}</svg>`;

// Même logo, mais qui se construit : nœuds puis liaisons.
const logoAnimated = (d0 = 0, cls = '') =>
  `<svg class="logo ${cls}" viewBox="0 0 200 200" aria-hidden="true"><g class="logo-lines">${EDGES.map(
    ([a, b], i) =>
      `<line x1="${NODES[a][0]}" y1="${NODES[a][1]}" x2="${NODES[b][0]}" y2="${NODES[b][1]}" data-a="draw" data-d="${d0 + 350 + i * 120}" data-dur="700"/>`
  ).join('')}</g>${NODES.map(
    ([x, y], i) =>
      `<circle cx="${x}" cy="${y}" r="22"${i === 3 ? ' class="logo-accent"' : ''} data-a="pop" data-d="${d0 + [0, 90, 180, 520][i]}"/>`
  ).join('')}</svg>`;

const eyebrow = (s, d = 0, f = 'eyebrow') =>
  s ? `<div class="eyebrow" data-a="up" data-d="${d}"${edr(f)}>${rich(s)}</div>` : '';

const CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Courbe lissée (Catmull-Rom → Bézier) pour les graphiques.
function smooth(pts) {
  if (!pts.length) return '';
  let d = `M${n2(pts[0][0])},${n2(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${n2(c1[0])},${n2(c1[1])} ${n2(c2[0])},${n2(c2[1])} ${n2(p2[0])},${n2(p2[1])}`;
  }
  return d;
}

// ——— Visuels de cartes ———

function cardViz(v, d, f) {
  v = v || {};
  if (v.type === 'progress') {
    return `<div class="viz-progress">
      <div class="viz-row"><span${ed(f + '.label')}>${plain(v.label)}</span><b${ed(f + '.value')}>${plain(v.value)}</b></div>
      <div class="bar"><i data-a="grow-x" data-d="${d + 300}" data-dur="1600"></i></div>
      ${list(v.steps).map((s, i) => `<div class="viz-step" data-a="fade" data-d="${d + 900 + i * 250}">${CHECK}<span${ed(`${f}.steps.${i}`)}>${plain(s)}</span></div>`).join('')}
    </div>`;
  }
  if (v.type === 'checklist') {
    return `<ul class="viz-check">${list(v.items)
      .map((s, i) => `<li data-a="left" data-d="${d + 300 + i * 160}">${CHECK}<span${ed(`${f}.items.${i}`)}>${plain(s)}</span></li>`)
      .join('')}</ul>`;
  }
  if (v.type === 'twin') {
    return `<div class="viz-twin"><svg viewBox="0 0 320 110" aria-hidden="true">
      <circle class="tw-a" cx="72" cy="36" r="17" data-a="pop" data-d="${d + 200}"/>
      <path class="tw-a" d="M40,104 C40,70 104,70 104,104 Z" data-a="pop" data-d="${d + 260}"/>
      <path class="tw-link" d="M128,62 L192,62" data-a="draw" data-d="${d + 600}" data-dur="600"/>
      <path class="tw-link" d="M184,54 L193,62 L184,70" data-a="draw" data-d="${d + 1000}" data-dur="300"/>
      <circle class="tw-b" cx="248" cy="36" r="17" data-a="draw" data-d="${d + 1100}" data-dur="900"/>
      <path class="tw-b" d="M216,104 C216,70 280,70 280,104 Z" data-a="draw" data-d="${d + 1250}" data-dur="1100"/>
    </svg><div class="viz-row"><span${ed(f + '.left')}>${plain(v.left || '')}</span><span class="accent"${ed(f + '.right')}>${plain(v.right || '')}</span></div></div>`;
  }
  return '';
}

function kpiViz(v, d, f) {
  v = v || {};
  if (v.type === 'days' || v.type === 'segments') {
    const n = Math.min(40, Math.max(1, num(v.count, 12)));
    const lit = v.lit ?? n;
    const hs = list(v.heights);
    return `<div class="viz-seg ${v.type}">${Array.from({ length: n }, (_, i) => {
      const h = hs.length ? Math.round(30 + 70 * hs[i % hs.length]) : 100;
      return `<i class="${i < lit ? 'on' : ''}" style="height:${h}%" data-a="grow-y" data-d="${d + i * 55}" data-dur="700"></i>`;
    }).join('')}</div>`;
  }
  if (v.type === 'ring') {
    const p = Math.min(0.999, Math.max(0.001, num(v.value, 0.5)));
    const a = p * Math.PI * 2, r = 30;
    const x = 36 + r * Math.sin(a), y = 36 - r * Math.cos(a);
    return `<div class="viz-ring"><svg viewBox="0 0 72 72" aria-hidden="true">
      <circle class="ring-track" cx="36" cy="36" r="${r}"/>
      <path class="ring-arc" d="M36,6 A${r},${r} 0 ${p > 0.5 ? 1 : 0} 1 ${n2(x)},${n2(y)}" data-a="draw" data-d="${d}" data-dur="1500"/>
    </svg><span${ed(f + '.label')}>${plain(v.label || '')}</span></div>`;
  }
  if (v.type === 'bar') {
    return `<div class="viz-bar"><div class="bar"><i style="width:${Math.min(1, num(v.value, 1)) * 100}%" data-a="grow-x" data-d="${d}" data-dur="1500"></i></div><span${ed(f + '.label')}>${plain(v.label || '')}</span></div>`;
  }
  if (v.type === 'spark') {
    const vs = list(v.values).map((x) => num(x));
    if (vs.length < 2) return '';
    const max = Math.max(...vs), min = Math.min(...vs);
    const pts = vs.map((y, i) => [4 + (i / (vs.length - 1)) * 292, 64 - ((y - min) / (max - min || 1)) * 56]);
    return `<div class="viz-spark"><svg viewBox="0 0 300 70" aria-hidden="true"><path d="${smooth(pts)}" data-a="draw" data-d="${d}" data-dur="1800"/></svg><span${ed(f + '.label')}>${plain(v.label || '')}</span></div>`;
  }
  return '';
}

// ——— Gabarits ———

export const layouts = {
  hero(s) {
    const f = s.feed;
    return `
      <div class="hero-copy">
        ${eyebrow(s.eyebrow)}
        <h1 class="t-hero" data-a="words" data-d="150"${edr('title')}>${rich(s.title)}</h1>
        ${s.lead ? `<p class="t-lead" data-a="up" data-d="800"${edr('lead')}>${rich(s.lead)}</p>` : ''}
        ${list(s.actions).length ? `<div class="actions" data-a="up" data-d="1000">${s.actions.map((a, i) => `<span class="btn${i ? ' btn-ghost' : ''}"${ed(`actions.${i}`)}>${plain(a)}</span>`).join('')}</div>` : ''}
        ${s.note ? `<p class="t-mono note" data-a="fade" data-d="1250"${edr('note')}>${rich(s.note)}</p>` : ''}
      </div>
      ${f ? `<div class="panel feed" data-a="right" data-d="450">
        <div class="panel-head"><span class="dot"></span><span${ed('feed.title')}>${plain(f.title)}</span><span class="grow"></span><span${ed('feed.tag')}>${plain(f.tag || 'Exemple')}</span></div>
        <ul class="feed-list">${list(f.items).map(([time, text, status] = [], i) => `<li data-a="up" data-d="${900 + i * 200}">
          <time${ed(`feed.items.${i}.0`)}>${esc(time)}</time><span${edr(`feed.items.${i}.1`)}>${rich(text)}</span><b class="badge badge-${slug(status)}"${ed(`feed.items.${i}.2`)}>${plain(status)}</b></li>`).join('')}</ul>
      </div>` : ''}`;
  },

  chat(s) {
    const c = s.chat || {};
    const prompt = String(c.prompt || '');
    const typeStart = 1300;
    const typeDur = Math.max(900, prompt.length * 28);
    const reply = typeStart + typeDur + 450;
    const items = list(c.items);
    return `
      <div class="split">
        <div class="copy">
          ${eyebrow(s.eyebrow)}
          <h2 class="t-h2" data-a="words" data-d="120"${edr('title')}>${rich(s.title)}</h2>
          ${s.text ? `<p class="t-lead" data-a="up" data-d="700"${edr('text')}>${rich(s.text)}</p>` : ''}
        </div>
        <div class="panel app" data-a="right" data-d="400">
          <div class="app-bar">${(list(c.tabs).length ? c.tabs : ['Verso']).map((t, i) => `<span class="${i ? '' : 'on'}"${ed(`chat.tabs.${i}`)}>${plain(t)}</span>`).join('')}<span class="grow"></span><span class="app-space"${ed('chat.space')}>${plain(c.space || '')}</span></div>
          <div class="app-body">
            <div class="msg msg-user" data-a="up" data-d="${typeStart - 250}"><span data-a="type" data-d="${typeStart}" data-dur="${typeDur}"${ed('chat.prompt')}>${plain(prompt)}</span></div>
            <div class="msg msg-ai" data-a="up" data-d="${reply}">
              <div class="ai-name"><span class="dot"></span><span${ed('chat.name')}>${plain(c.name || 'Verso')}</span></div>
              <p${edr('chat.reply')}>${rich(c.reply)}</p>
              ${items.length ? `<ul class="ai-items">${items.map(([a, b] = [], i) => `<li data-a="left" data-d="${reply + 450 + i * 170}"><span${ed(`chat.items.${i}.0`)}>${plain(a)}</span><b class="badge badge-a-valider"${ed(`chat.items.${i}.1`)}>${plain(b)}</b></li>`).join('')}</ul>` : ''}
              ${c.action ? `<span class="btn" data-a="pop" data-d="${reply + 550 + items.length * 170}"${ed('chat.action')}>${plain(c.action)}</span>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  },

  grid(s) {
    return `
      <div class="grid-head">
        ${eyebrow(s.eyebrow)}
        <h2 class="t-h2" data-a="words" data-d="120"${edr('title')}>${rich(s.title)}</h2>
      </div>
      <ol class="tiles">${list(s.items).map(([t, sub] = [], i) => {
        const d = 600 + i * 90;
        return `<li><i class="rule" data-a="grow-x" data-d="${d}" data-dur="1100"></i>
          <span class="t-mono" data-a="fade" data-d="${d + 100}">${pad(i + 1)}</span>
          <h3 class="t-h3" data-a="up" data-d="${d + 150}"${ed(`items.${i}.0`)}>${plain(t)}</h3>
          <p class="t-body" data-a="up" data-d="${d + 230}"${ed(`items.${i}.1`)}>${plain(sub)}</p></li>`;
      }).join('')}</ol>`;
  },

  cards(s) {
    return `
      <div class="head-row">
        <div>${eyebrow(s.eyebrow)}<h2 class="t-h2" data-a="words" data-d="120"${edr('title')}>${rich(s.title)}</h2></div>
        ${s.text ? `<p class="t-body" data-a="up" data-d="600"${edr('text')}>${rich(s.text)}</p>` : ''}
      </div>
      <div class="cards">${list(s.cards).map((c = {}, i) => {
        const d = 600 + i * 170;
        return `<article class="panel card" data-a="up" data-d="${d}">
          <div class="card-viz">${cardViz(c.viz, d, `cards.${i}.viz`)}</div>
          <div class="t-mono tag"${ed(`cards.${i}.tag`)}>${plain(c.tag)}</div>
          <h3 class="t-h3"${edr(`cards.${i}.title`)}>${rich(c.title)}</h3>
          <p class="t-body"${edr(`cards.${i}.text`)}>${rich(c.text)}</p>
          ${c.cta ? `<span class="link"><span${ed(`cards.${i}.cta`)}>${plain(c.cta)}</span> →</span>` : ''}
        </article>`;
      }).join('')}</div>`;
  },

  punchline(s) {
    return `
      <div class="zoom" data-a="zoom" data-dur="1500">
        <div class="zoom-inner">
          <div class="big-logo">${logoAnimated(500)}</div>
          <blockquote class="t-quote" data-a="words" data-d="800"${edr('quote')}>${rich(s.quote)}</blockquote>
          ${s.caption ? `<p class="t-mono" data-a="fade" data-d="1700"${ed('caption')}>${plain(s.caption)}</p>` : ''}
        </div>
      </div>`;
  },

  chart(s, ctx) {
    const c = s.chart || {};
    const vs = list(c.values).map((v) => num(v));
    if (vs.length < 2) vs.push(0, 0);
    const threshold = num(c.threshold, 0);
    const W = 900, H = 470, x0 = 64, x1 = 870, y0 = 46, y1 = 400;
    const vmax = Math.max(10, Math.ceil((Math.max(...vs, threshold) * 1.15) / 10) * 10);
    const X = (i) => x0 + (i / (vs.length - 1)) * (x1 - x0);
    const Y = (v) => y1 - (Math.max(0, v) / vmax) * (y1 - y0);
    const pts = vs.map((v, i) => [X(i), Y(v)]);
    const line = smooth(pts);
    const area = `${line} L${x1},${y1} L${x0},${y1} Z`;
    const step = (x1 - x0) / (vs.length - 1);
    const risk = vs.map((v, i) => (v < threshold ? i : -1)).filter((i) => i >= 0);
    const lo = vs.indexOf(Math.min(...vs));
    const gid = `area-${ctx.uid}`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(vmax * t));
    const label = plain(c.callout || '');
    const lw = c.callout ? String(c.callout).length * 8.6 + 30 : 0;
    const lx = Math.min(x1 - lw, Math.max(x0, X(lo) - lw / 2));
    return `
      <div class="split">
        <div class="copy">
          ${eyebrow(s.eyebrow)}
          <h2 class="t-h2" data-a="words" data-d="120"${edr('title')}>${rich(s.title)}</h2>
          ${s.text ? `<p class="t-body" data-a="up" data-d="700"${edr('text')}>${rich(s.text)}</p>` : ''}
          ${list(s.modules).length ? `<ul class="modules">${s.modules.map((m, i) => `<li class="${m === s.active ? 'on' : ''}" data-a="left" data-d="${900 + i * 110}"><span class="t-mono">${pad(i + 1)}</span><span${ed(`modules.${i}`)}>${plain(m)}</span></li>`).join('')}</ul>` : ''}
        </div>
        <div class="panel chart" data-a="right" data-d="350">
          <div class="panel-head"><span class="dot"></span><span${ed('chart.label')}>${plain(c.label)}</span><span class="grow"></span><span${ed('chart.tag')}>${plain(c.tag || 'Exemple')}</span></div>
          <svg class="chart-svg" viewBox="0 0 ${W} ${H}" aria-hidden="true">
            <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stop-a"/><stop offset="1" class="stop-b"/></linearGradient></defs>
            <g class="ch-grid" data-a="fade" data-d="500">${ticks.map((t) => `<line x1="${x0}" x2="${x1}" y1="${n2(Y(t))}" y2="${n2(Y(t))}"/><text x="${x0 - 14}" y="${n2(Y(t) + 4)}" text-anchor="end">${t}</text>`).join('')}
              ${vs.map((_, i) => `<text x="${n2(X(i))}" y="${y1 + 32}" text-anchor="middle">${esc(c.xPrefix ?? 'S')}${i + 1}</text>`).join('')}
              <text x="${x0 - 14}" y="${y0 - 22}" text-anchor="end">${plain(c.unit || '')}</text></g>
            ${risk.length ? `<rect class="ch-risk" x="${n2(X(risk[0]) - step / 2)}" y="${y0}" width="${n2(step * (risk[risk.length - 1] - risk[0] + 1))}" height="${y1 - y0}" rx="6" data-a="fade" data-d="2300"/>` : ''}
            <path class="ch-area" d="${area}" fill="url(#${gid})" data-a="fade" data-d="1700" data-dur="1400"/>
            ${c.threshold != null ? `<line class="ch-threshold" x1="${x0}" x2="${x1}" y1="${n2(Y(threshold))}" y2="${n2(Y(threshold))}" data-a="fade" data-d="1900"/>
            <text class="ch-threshold-label" x="${x1}" y="${n2(Y(threshold) - 10)}" text-anchor="end" data-a="fade" data-d="1900">${plain(c.thresholdLabel || '')}</text>` : ''}
            <path class="ch-line" d="${line}" data-a="draw" data-d="800" data-dur="2000"/>
            <circle class="ch-dot" cx="${n2(X(lo))}" cy="${n2(Y(vs[lo]))}" r="8" data-a="pop" data-d="2500"/>
            ${c.callout ? `<g class="ch-callout" data-a="pop" data-d="2700"><rect x="${n2(lx)}" y="${n2(Y(vs[lo]) + 24)}" width="${n2(lw)}" height="36" rx="6"/><text x="${n2(lx + lw / 2)}" y="${n2(Y(vs[lo]) + 47)}" text-anchor="middle">${label}</text></g>` : ''}
          </svg>
        </div>
      </div>`;
  },

  kpis(s) {
    return `
      <div class="head-row">
        <div>${eyebrow(s.eyebrow)}<h2 class="t-h2" data-a="words" data-d="120"${edr('title')}>${rich(s.title)}</h2></div>
        ${s.text ? `<p class="t-body" data-a="up" data-d="600"${edr('text')}>${rich(s.text)}</p>` : ''}
      </div>
      <div class="kpis">${list(s.items).map((k = {}, i) => {
        const d = 600 + i * 160;
        const dec = num(k.decimals, 0);
        return `<div class="kpi">
          ${i ? `<i class="vrule" data-a="grow-y" data-d="${d - 100}" data-dur="1100"></i>` : ''}
          <div class="t-mono" data-a="fade" data-d="${d}"${ed(`items.${i}.label`)}>${plain(k.label)}</div>
          <div class="kpi-value" data-a="up" data-d="${d}"><span data-a="count" data-to="${num(k.value)}" data-dec="${dec}" data-d="${d + 100}" data-dur="1700"${ed(`items.${i}.value`)} data-num="1">${fmt(num(k.value), dec)}</span><small${ed(`items.${i}.unit`)}>${plain(k.unit || '')}</small></div>
          <div class="kpi-viz">${kpiViz(k.viz, d + 400, `items.${i}.viz`)}</div>
          <p class="t-body" data-a="up" data-d="${d + 250}"${edr(`items.${i}.text`)}>${rich(k.text || '')}</p>
        </div>`;
      }).join('')}</div>`;
  },

  hub(s, ctx) {
    const pos = [[18, 20], [82, 20], [18, 80], [82, 80]];
    const W = 1000, H = 640, cx = W / 2, cy = H / 2;
    const nodes = list(s.nodes).slice(0, 4);
    return `
      <div class="split">
        <div class="copy">
          ${eyebrow(s.eyebrow)}
          <h2 class="t-h2" data-a="words" data-d="120"${edr('title')}>${rich(s.title)}</h2>
          ${s.text ? `<p class="t-body" data-a="up" data-d="650"${edr('text')}>${rich(s.text)}</p>` : ''}
          ${list(s.facts).length ? `<dl class="facts">${s.facts.map(([k, v] = [], i) => `<div data-a="left" data-d="${900 + i * 120}"><dt class="t-mono"${ed(`facts.${i}.0`)}>${plain(k)}</dt><dd${ed(`facts.${i}.1`)}>${plain(v)}</dd></div>`).join('')}</dl>` : ''}
        </div>
        <div class="hub">
          <svg class="hub-svg" viewBox="0 0 ${W} ${H}" aria-hidden="true">
            ${nodes.map((_, i) => {
              const [px, py] = pos[i];
              const x = (px / 100) * W, y = (py / 100) * H;
              const mx = (cx + x) / 2;
              return `<path id="hub-${ctx.uid}-${i}" class="hub-link" d="M${cx},${cy} C${mx},${cy} ${mx},${y} ${x},${y}" data-a="draw" data-d="${700 + i * 140}" data-dur="1100"/>
                <circle class="hub-pulse" r="5" data-a="pulse" data-path="hub-${ctx.uid}-${i}" data-d="${1900 + i * 300}"/>`;
            }).join('')}
          </svg>
          <div class="hub-center" data-a="pop" data-d="300">${logo()}</div>
          ${nodes.map(([k, v] = [], i) => `<div class="hub-node" style="left:${pos[i][0]}%;top:${pos[i][1]}%"><div class="panel hub-card" data-a="pop" data-d="${1100 + i * 140}"><span class="t-mono"${ed(`nodes.${i}.0`)}>${plain(k)}</span><b${ed(`nodes.${i}.1`)}>${plain(v)}</b></div></div>`).join('')}
        </div>
      </div>`;
  },

  cta(s) {
    const c = s.card || {};
    const items = list(c.items);
    return `
      <div class="split">
        <div class="copy">
          <div class="cta-logo">${logoAnimated(0)}</div>
          ${eyebrow(s.eyebrow, 200)}
          <h2 class="t-h2" data-a="words" data-d="300"${edr('title')}>${rich(s.title)}</h2>
          ${s.text ? `<p class="t-lead" data-a="up" data-d="900"${edr('text')}>${rich(s.text)}</p>` : ''}
        </div>
        <div class="offer" data-a="scale" data-d="550">
          <div class="t-mono"${ed('card.label')}>${plain(c.label || '')}</div>
          <h3${edr('card.title')}>${rich(c.title || '')}</h3>
          <ul>${items.map((it, i) => `<li data-a="left" data-d="${1000 + i * 160}">${CHECK}<span${edr(`card.items.${i}`)}>${rich(it)}</span></li>`).join('')}</ul>
          ${c.action ? `<span class="btn btn-ink" data-a="pop" data-d="${1100 + items.length * 160}"${ed('card.action')}>${plain(c.action)}</span>` : ''}
        </div>
      </div>
      ${list(s.status).length ? `<div class="status-line" data-a="fade" data-d="1500">${s.status.map((t, i) => `<span><i></i><span${ed(`status.${i}`)}>${plain(t)}</span></span>`).join('')}</div>` : ''}`;
  },
};

// Noms et descriptions affichés dans le studio.
export const LAYOUTS = {
  hero: { name: 'Ouverture', desc: 'Grand titre, accroche, boutons, flux d’activité Verso' },
  chat: { name: 'Démo Verso', desc: 'Une demande tapée en direct et la réponse de Verso' },
  grid: { name: 'Grille', desc: 'Jusqu’à 8 tuiles : secteurs, cas d’usage, étapes' },
  cards: { name: 'Trois cartes', desc: 'Offres ou étapes, chacune avec un visuel animé' },
  punchline: { name: 'Citation', desc: 'Une phrase forte, plein écran sur fond orange' },
  chart: { name: 'Graphique', desc: 'Courbe qui se trace, seuil et point d’alerte' },
  kpis: { name: 'Chiffres clés', desc: 'Quatre chiffres qui défilent jusqu’à leur valeur' },
  hub: { name: 'Schéma', desc: 'Logo au centre, quatre satellites, liste de faits' },
  cta: { name: 'Conclusion', desc: 'Appel à l’action et carte de contact orange' },
};

export const BACKGROUNDS = {
  hero: 'Faisceau central',
  left: 'Faisceau à gauche',
  right: 'Faisceau à droite',
  low: 'Horizon bas',
  calm: 'Discret',
  grid: 'Grille de carrés',
  off: 'Sans animation',
};

// Contenu de départ de chaque gabarit (studio : « Ajouter une slide »).
export const TEMPLATES = {
  hero: {
    layout: 'hero', section: 'Introduction', bg: 'hero',
    eyebrow: 'Coreshift · Intégrateur Mistral AI',
    title: 'Un titre clair, avec un *mot clé*.',
    lead: 'Une phrase qui résume ce que vous apportez au client.',
    actions: ['Demander une démo', 'Voir la plateforme'],
    note: 'Une précision en petit',
    feed: { title: 'Verso · activité', tag: 'Exemple', items: [['09:15', 'Devis sans réponse : relance rédigée', 'À valider'], ['11:40', 'Planning du chantier mis à jour', 'Fait'], ['18:00', 'Trésorerie à 90 jours mise à jour', 'Prêt']] },
  },
  chat: {
    layout: 'chat', section: 'Verso', bg: 'right',
    eyebrow: 'Vous parlez, Verso agit',
    title: 'Une demande en français, *le travail est prêt*.',
    text: 'Verso prépare, vous validez.',
    chat: { tabs: ['Verso', 'Clients', 'Agents'], space: 'Votre entreprise (exemple)', prompt: 'Relance les devis sans réponse depuis plus de 10 jours.', reply: '2 devis concernés. J’ai rédigé une relance pour chacun.', items: [['Devis 2026-0427', 'J+12'], ['Devis 2026-0431', 'J+15']], action: 'Envoyer les relances' },
  },
  grid: {
    layout: 'grid', section: 'Métiers', bg: 'grid', theme: 'light',
    eyebrow: 'Secteurs',
    title: 'Huit tuiles pour *tout montrer*.',
    items: [['Premier point', 'Une ligne de détail'], ['Deuxième point', 'Une ligne de détail'], ['Troisième point', 'Une ligne de détail'], ['Quatrième point', 'Une ligne de détail']],
  },
  cards: {
    layout: 'cards', section: 'Offres', bg: 'left',
    eyebrow: 'Trois étapes',
    title: 'Commencez petit. *Allez plus loin ensuite.*',
    text: 'Une phrase de contexte.',
    cards: [
      { tag: '01 · Démarrage', title: 'Première étape', text: 'Ce que le client obtient tout de suite.', cta: 'Plateforme', viz: { type: 'progress', label: 'Mise en route', value: '30 min', steps: ['Contacts importés', 'Première action faite'] } },
      { tag: '02 · Cadrage', title: 'Deuxième étape', text: 'Ce que l’on construit ensemble.', cta: 'Conseil', viz: { type: 'checklist', items: ['Audit', 'Feuille de route', 'Formation'] } },
      { tag: '03 · Transmission', title: 'Troisième étape', text: 'Ce qui reste quand on part.', cta: 'TwinsAI', viz: { type: 'twin', left: 'L’expert', right: 'Son jumeau' } },
    ],
  },
  punchline: {
    layout: 'punchline', section: 'Conviction',
    quote: 'Une phrase que le client doit *retenir*.',
    caption: 'La conviction Coreshift',
  },
  chart: {
    layout: 'chart', section: 'Données', bg: 'low',
    eyebrow: 'Trésorerie',
    title: 'Voir venir *avant que ça arrive*.',
    text: 'Une phrase qui explique la courbe.',
    modules: ['CRM & pipeline', 'Facturation', 'Trésorerie', 'Agents'], active: 'Trésorerie',
    chart: { label: 'Trésorerie prévue · 13 semaines', tag: 'Exemple', unit: 'k€', values: [42, 45, 39, 36, 31, 24, 16, 21, 28, 33, 38, 44, 48], threshold: 20, thresholdLabel: 'Seuil de sécurité', callout: 'S7 · Acompte à relancer' },
  },
  kpis: {
    layout: 'kpis', section: 'Chiffres', bg: 'calm',
    eyebrow: 'En chiffres',
    title: 'Quatre chiffres. *Aucun discours.*',
    text: 'Une phrase de contexte sur la source des chiffres.',
    items: [
      { label: 'Indicateur 1', value: 9, unit: '€', text: 'Ce que ce chiffre veut dire.', viz: { type: 'bar', value: 1, label: 'Libellé' } },
      { label: 'Indicateur 2', value: 14, unit: 'jours', text: 'Ce que ce chiffre veut dire.', viz: { type: 'days', count: 14 } },
      { label: 'Indicateur 3', value: 30, unit: 'min', text: 'Ce que ce chiffre veut dire.', viz: { type: 'ring', value: 0.5, label: '30 / 60 min' } },
      { label: 'Indicateur 4', value: 90, unit: 'jours', text: 'Ce que ce chiffre veut dire.', viz: { type: 'spark', values: [3, 5, 4, 6, 8, 7, 9], label: 'Tendance' } },
    ],
  },
  hub: {
    layout: 'hub', section: 'Architecture', bg: 'low',
    eyebrow: 'Le socle',
    title: 'Tout est relié, *rien ne sort*.',
    text: 'Une phrase sur la sécurité ou l’architecture.',
    facts: [['Hébergement', 'France'], ['Isolation', 'Par entreprise']],
    nodes: [['Base de données', 'Paris'], ['Modèles', 'Mistral AI'], ['Vos données', 'Isolées'], ['Déploiement', 'Cloud privé']],
  },
  cta: {
    layout: 'cta', section: 'Contact', bg: 'hero',
    eyebrow: 'Toulouse · France',
    title: 'Parlons de votre entreprise, *à votre rythme*.',
    text: 'Nous revenons vers vous pour échanger sur votre activité.',
    card: { label: 'Prochaine étape', title: 'Un premier rendez-vous *concret*.', items: ['Une démonstration de 30 minutes', 'Un audit offert de 1 h 30'], action: 'contact@coreshift.fr' },
    status: ['Base de données à Paris', 'Intégrateur Mistral AI', 'coreshift.fr'],
  },
};

const themeOf = (s) => s.theme || (s.layout === 'punchline' ? 'accent' : 'dark');

export function renderSlide(s, ctx) {
  const layout = layouts[s.layout];
  if (!layout) throw new Error(`Slide ${ctx.index + 1} : gabarit inconnu « ${s.layout} » (disponibles : ${Object.keys(layouts).join(', ')})`);
  const c = { uid: ctx.index, ...ctx };
  return `<section class="slide layout-${s.layout} theme-${themeOf(s)}" data-index="${ctx.index}" aria-label="Slide ${ctx.index + 1}">
    <header class="chrome"><div class="brand">${logo()}<span>${plain(ctx.deck?.brand || 'Coreshift')}</span></div>
      <div class="chrome-meta"><span>${plain(s.section || '')}</span><span class="chrome-num">${pad(ctx.index + 1)} / ${pad(ctx.total)}</span></div></header>
    <div class="content">${layout(s, c)}</div>
  </section>`;
}

export const slideMeta = (s) => ({
  layout: s.layout,
  theme: themeOf(s),
  bg: s.bg || 'hero',
  section: s.section || '',
  duration: s.duration || null,
});
