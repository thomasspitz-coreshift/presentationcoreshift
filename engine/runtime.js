/* Lecteur des présentations Coreshift.
   Expose window.CoreshiftPlayer (utilisé par le studio) et, si la page contient #deck-data,
   démarre tout seul comme présentation autonome. Modes de la page autonome, choisis par l'URL :
     (défaut)   lecture web animée, navigation clavier / clic / swipe
     ?print     toutes les slides dans leur état final, une par page (export PDF)
     ?capture   horloge virtuelle pilotée par le script vidéo (export MP4 image par image)
   Options : ?autoplay (enchaîne seul), ?loop, ?light (force le thème clair), ?noauto, #3 (ouvre la slide 3). */
(function (global) {
  'use strict';

  // ——— Courbes d'accélération ———
  const EASE = {
    lin: (t) => t,
    out: (t) => 1 - Math.pow(1 - t, 3),
    expo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    io: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    back: (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2),
  };
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const pad = (n) => String(n).padStart(2, '0');

  const fmtCache = {};
  const fmt = (v, dec) =>
    (fmtCache[dec] ||= new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })).format(v);

  // ——— Animations d'entrée (attribut data-a) ———
  const ANIM = {
    fade: { dur: 900, ease: 'out', f: (el, p) => { el.style.opacity = p; } },
    up: { dur: 1100, f: (el, p) => { el.style.opacity = clamp(p * 1.4); el.style.transform = `translate3d(0,${(1 - p) * 38}px,0)`; } },
    left: { dur: 1100, f: (el, p) => { el.style.opacity = clamp(p * 1.4); el.style.transform = `translate3d(${(p - 1) * 46}px,0,0)`; } },
    right: { dur: 1300, f: (el, p) => { el.style.opacity = clamp(p * 1.4); el.style.transform = `translate3d(${(1 - p) * 70}px,0,0)`; } },
    scale: { dur: 1300, f: (el, p) => { el.style.opacity = clamp(p * 1.6); el.style.transform = `scale(${0.92 + 0.08 * p})`; } },
    pop: { dur: 800, ease: 'back', f: (el, p) => { el.style.opacity = clamp(p * 2); el.style.transform = `scale(${0.5 + 0.5 * p})`; } },
    'grow-x': { dur: 1200, f: (el, p) => { el.style.transform = `scaleX(${p})`; } },
    'grow-y': { dur: 1000, f: (el, p) => { el.style.transform = `scaleY(${p})`; } },
    draw: {
      dur: 1600, ease: 'io',
      init: (el) => { el._len ??= el.getTotalLength(); el.style.strokeDasharray = el._len; },
      f: (el, p) => { el.style.strokeDashoffset = el._len * (1 - p); el.style.opacity = p > 0 ? 1 : 0; },
    },
    count: {
      dur: 1700,
      init: (el) => { el._to = +el.dataset.to; el._dec = +(el.dataset.dec || 0); },
      f: (el, p) => { el.textContent = fmt(el._to * p, el._dec); },
    },
    type: {
      dur: 1200, ease: 'lin',
      init: (el) => { el._txt ??= el.textContent; },
      f: (el, p) => {
        el.textContent = el._txt.slice(0, Math.round(el._txt.length * p));
        el.classList.toggle('typing', p < 1);
      },
    },
    zoom: {
      dur: 1500, ease: 'io',
      f: (el, p) => {
        const q = 1 - p;
        el.style.clipPath = `inset(${22 * q}% ${27 * q}% round ${44 * q}px)`;
      },
    },
  };

  // Découpe un titre en mots animables, en préservant les <em> et <br>.
  function splitWords(el) {
    if (el._words) return el._words;
    const out = [];
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          for (const part of child.textContent.split(/( +|\n)/)) {
            if (!part) continue;
            if (/^( +|\n)$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
            const s = document.createElement('span');
            s.className = 'wi';
            s.textContent = part;
            frag.appendChild(s);
            out.push(s);
          }
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.classList.contains('nw')) {
          child.classList.add('wi');
          out.push(child);
        } else if (child.nodeType === 1 && child.tagName !== 'BR') walk(child);
      }
    };
    walk(el);
    return (el._words = out);
  }

  // ——— Fond : rubans de lumière + grille ———
  const POSES = {
    hero:  { fx: .62, fy: .70, angle: -.55, spread: 1.0, twist: 1.0, bend: .35, amp: 1.0, intensity: 1.0, glow: 1.0, grid: 0 },
    left:  { fx: .20, fy: .74, angle: -.22, spread: .9, twist: 1.25, bend: -.3, amp: .8, intensity: .8, glow: .75, grid: 0 },
    right: { fx: .80, fy: .38, angle: -.78, spread: .95, twist: .9, bend: .4, amp: 1.0, intensity: .85, glow: .8, grid: 0 },
    low:   { fx: .50, fy: .98, angle: -.06, spread: .85, twist: 1.4, bend: .2, amp: .7, intensity: .7, glow: .6, grid: 0 },
    calm:  { fx: .78, fy: .88, angle: -.35, spread: .7, twist: 1.0, bend: .3, amp: .6, intensity: .45, glow: .4, grid: 0 },
    grid:  { fx: .86, fy: .12, angle: -.9, spread: .65, twist: 1.0, bend: .2, amp: .5, intensity: .5, glow: .35, grid: 1 },
    off:   { fx: .5, fy: .5, angle: 0, spread: .7, twist: 1, bend: 0, amp: .5, intensity: 0, glow: 0, grid: 0 },
  };
  function poseFor(meta) {
    const b = typeof meta.bg === 'string' ? { preset: meta.bg } : meta.bg || {};
    const p = { ...(POSES[b.preset] || POSES.hero), ...b, light: meta.theme === 'light' ? 1 : 0 };
    delete p.preset;
    if (p.light) p.intensity *= 0.6;
    return p;
  }

  // Générateur pseudo-aléatoire déterministe : même rendu à chaque export.
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const R = rng(11);
  const PALETTE = [[138, 42, 10], [213, 90, 31], [255, 106, 31], [255, 106, 31], [255, 150, 80], [255, 190, 130], [255, 226, 200]];
  const STRANDS = Array.from({ length: 64 }, (_, k) => {
    const s = k / 63 - 0.5;
    const centre = 1 - Math.abs(s) * 2;
    const ci = Math.min(PALETTE.length - 1, Math.floor(clamp(centre * 0.75 + R() * 0.45) * PALETTE.length));
    return { s, j: R() * 2 - 1, ph: R() * 6.283, w: 0.55 + R() * 0.9, c: PALETTE[ci] };
  });
  const DUST = Array.from({ length: 80 }, () => ({ x: R(), y: R(), z: 0.3 + R() * 0.7, ph: R() * 6.283 }));
  const INK = [20, 17, 14], PAPER = [242, 241, 239];
  const mixRGB = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  let glowSprite;
  function sprite() {
    if (glowSprite) return glowSprite;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,190,140,1)');
    gr.addColorStop(0.25, 'rgba(255,120,40,.55)');
    gr.addColorStop(1, 'rgba(255,106,31,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return (glowSprite = c);
  }

  function drawBackground(ctx, W, H, P, t) {
    const L = P.light;
    const dark = L < 0.5;
    const k = dark ? 1 - 2 * L : 2 * L - 1; // s'éteint à mi-transition clair/sombre
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgb(mixRGB(INK, PAPER, L));
    ctx.fillRect(0, 0, W, H);

    const I = P.intensity * k;
    const F = [P.fx * W, P.fy * H];

    // Halo chaud, comme un lever de soleil.
    if (dark && P.glow > 0) {
      const g = ctx.createRadialGradient(F[0], F[1], 0, F[0], F[1], H * 0.95);
      g.addColorStop(0, `rgba(255,106,31,${0.2 * P.glow * k})`);
      g.addColorStop(0.45, `rgba(213,90,31,${0.07 * P.glow * k})`);
      g.addColorStop(1, 'rgba(20,17,14,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Grille de carrés (motif du site), quelques cases s'allument.
    if (P.grid > 0.01) {
      const cell = H / 10.5, gap = cell * 0.14, size = cell - gap;
      const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
      const ox = (W % cell) / 2 - cell / 2, oy = (H % cell) / 2 - cell / 2;
      ctx.lineWidth = 1;
      ctx.strokeStyle = L > 0.5 ? `rgba(20,17,14,${0.07 * P.grid})` : `rgba(255,255,255,${0.05 * P.grid})`;
      ctx.beginPath();
      for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) ctx.rect(ox + x * cell + 0.5, oy + y * cell + 0.5, size, size);
      ctx.stroke();
      for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
        const h = Math.abs(Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1;
        if (h < 0.84) continue;
        const ph = (t * 0.12 + h * 7.3) % 1;
        const b = ph < 0.3 ? Math.sin((ph / 0.3) * Math.PI) : 0;
        if (b <= 0.01) continue;
        ctx.strokeStyle = `rgba(255,106,31,${0.75 * b * P.grid})`;
        ctx.fillStyle = `rgba(255,106,31,${0.1 * b * P.grid})`;
        ctx.fillRect(ox + x * cell, oy + y * cell, size, size);
        ctx.strokeRect(ox + x * cell + 0.5, oy + y * cell + 0.5, size, size);
      }
    }

    if (I <= 0.005) return;

    // Rubans : un faisceau de fils qui se tord et se resserre en points lumineux.
    const half = Math.hypot(W, H) * 0.62;
    const dir = [Math.cos(P.angle), Math.sin(P.angle)];
    const nor = [-dir[1], dir[0]];
    const width = P.spread * H * 0.42;
    const M = 84;
    const at = (u, s, j, ph) => {
      const tw = P.twist * u * 2.3 + t * 0.32 + 1.5708 + 0.5 * Math.sin(t * 0.17);
      const off = width * (0.16 + 0.84 * Math.pow(Math.abs(u), 1.1)) * s * Math.cos(tw)
        + j * H * 0.014 * Math.sin(u * 4 + t * 0.6 + ph);
      const ctr = P.bend * H * 0.35 * u * u + P.amp * H * 0.08 * Math.sin(u * 2.1 + t * 0.28);
      const d = ctr + off;
      return [F[0] + dir[0] * u * half + nor[0] * d, F[1] + dir[1] * u * half + nor[1] * d, tw];
    };

    ctx.globalCompositeOperation = dark ? 'lighter' : 'multiply';
    ctx.lineCap = 'round';
    const lw = Math.max(1, H / 900);
    for (const st of STRANDS) {
      const a0 = at(-1.15, st.s, st.j, st.ph), a1 = at(1.15, st.s, st.j, st.ph);
      const grad = ctx.createLinearGradient(a0[0], a0[1], a1[0], a1[1]);
      const al = (dark ? 0.2 : 0.14) * I * st.w;
      grad.addColorStop(0, rgb(st.c, 0));
      grad.addColorStop(0.3, rgb(st.c, al * 0.8));
      grad.addColorStop(0.5, rgb(st.c, al));
      grad.addColorStop(0.72, rgb(st.c, al * 0.7));
      grad.addColorStop(1, rgb(st.c, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = lw * (0.7 + st.w * 0.6);
      ctx.beginPath();
      for (let m = 0; m <= M; m++) {
        const p = at(-1.15 + (2.3 * m) / M, st.s, st.j, st.ph);
        m ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
      }
      ctx.stroke();
    }

    if (dark) {
      // Éclats aux points de resserrement.
      const sp = sprite();
      for (let m = 0; m <= 26; m++) {
        const u = -1 + (2 * m) / 26;
        const p = at(u, 0, 0, 0);
        const pinch = Math.pow(1 - Math.abs(Math.cos(p[2])), 4) * (1 - Math.abs(u) * 0.75);
        if (pinch < 0.02) continue;
        const r = H * (0.1 + 0.12 * pinch);
        ctx.globalAlpha = clamp(0.32 * pinch * I);
        ctx.drawImage(sp, p[0] - r, p[1] - r, r * 2, r * 2);
      }
      // Poussière lumineuse.
      ctx.globalAlpha = 1;
      for (const d of DUST) {
        const x = ((d.x + t * 0.006 * d.z * dir[0]) % 1 + 1) % 1;
        const y = ((d.y + t * 0.006 * d.z * dir[1]) % 1 + 1) % 1;
        const a = 0.35 * I * d.z * (0.5 + 0.5 * Math.sin(t * 1.3 + d.ph));
        ctx.fillStyle = `rgba(255,214,180,${a})`;
        const s = 1.6 * d.z * lw;
        ctx.fillRect(x * W, y * H, s, s);
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Fond figé d'une slide (miniatures, éditeur, PDF). Le temps varie avec l'index pour varier les poses.
  function paintBackground(canvas, meta, index) {
    const ctx = canvas.getContext('2d');
    drawBackground(ctx, canvas.width, canvas.height, poseFor(meta), 6 + index * 2.7);
  }
  let scratch;
  function backgroundURL(meta, index, { width = 1600, height = 900, quality = 0.82 } = {}) {
    scratch ||= document.createElement('canvas');
    scratch.width = width; scratch.height = height;
    paintBackground(scratch, meta, index);
    return scratch.toDataURL('image/jpeg', quality);
  }

  // ——— Lecteur ———
  // o : { viewport, stage, canvas, slides, metas, mode: 'live'|'capture', autoplay, loop, start,
  //       controls (clavier/clic/swipe), input (élément qui reçoit clics et swipes), hash, onChange(i), onExit() }
  function createPlayer(o) {
    const mode = o.mode || 'live';
    const reduced = mode === 'live' && global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const { stage, canvas, slides, metas } = o;
    const viewport = o.viewport || stage.parentElement;
    stage.classList.add('deck-live');

    let vt = 0;
    const now = () => (mode === 'capture' ? vt : performance.now());

    let tweens = [];
    let loops = [];
    function tween({ dur = 900, delay = 0, ease = EASE.expo, update, done, group }) {
      if (reduced) { dur = 1; delay = 0; }
      const tw = { start: now() + delay, dur, ease, update, done, group };
      update(0);
      tweens.push(tw);
      return tw;
    }
    const cancel = (group) => { tweens = tweens.filter((t) => t.group !== group); };
    function runTweens(t) {
      const list = tweens;
      tweens = [];
      for (const tw of list) {
        if (t < tw.start) { tweens.push(tw); continue; }
        const p = clamp((t - tw.start) / tw.dur);
        tw.update(tw.ease(p));
        if (p >= 1) tw.done && tw.done();
        else tweens.push(tw);
      }
    }

    // Prépare et lance toutes les animations d'une slide. Renvoie la fin de la dernière (ms).
    function enter(i, offset) {
      const slide = slides[i];
      let end = 0;
      for (const el of slide.querySelectorAll('[data-a]')) {
        const kind = el.dataset.a;
        const d = +(el.dataset.d || 0) + offset;
        if (kind === 'words') {
          splitWords(el).forEach((w, k) => {
            tween({
              group: i, delay: d + k * 55, dur: 1150, ease: EASE.expo,
              update: (p) => {
                w.style.opacity = clamp(p * 1.3);
                w.style.transform = `translate3d(0,${(1 - p) * 0.42}em,0)`;
                w.style.filter = p < 1 ? `blur(${(1 - p) * 12}px)` : '';
              },
            });
            end = Math.max(end, d + k * 55 + 1150);
          });
          continue;
        }
        if (kind === 'pulse') {
          const path = slide.querySelector(`[id="${el.dataset.path}"]`);
          if (!path) continue;
          const len = path.getTotalLength();
          const start = now() + d;
          el.style.opacity = 0;
          loops.push({
            group: i,
            f: (t) => {
              if (t < start) return;
              const u = ((t - start) / 2200) % 1;
              const pt = path.getPointAtLength(len * u);
              el.setAttribute('cx', pt.x);
              el.setAttribute('cy', pt.y);
              el.style.opacity = Math.sin(Math.PI * u).toFixed(3);
            },
          });
          continue;
        }
        const a = ANIM[kind];
        if (!a) continue;
        a.init && a.init(el);
        const dur = +(el.dataset.dur || a.dur);
        tween({ group: i, delay: d, dur, ease: EASE[el.dataset.e || a.ease || 'expo'], update: (p) => a.f(el, p) });
        end = Math.max(end, d + dur);
      }
      return end;
    }

    // Fond
    const bctx = canvas.getContext('2d');
    let cw = 0, ch = 0, dpr = 1;
    let pose = poseFor(metas[0] || {});
    function layout() {
      dpr = mode === 'capture' ? 1 : Math.min(global.devicePixelRatio || 1, 1.5);
      cw = viewport.clientWidth; ch = viewport.clientHeight;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      const s = Math.min(cw / 1920, ch / 1080);
      stage.style.transform = `translate(-50%,-50%) scale(${s})`;
    }
    const ro = global.ResizeObserver ? new ResizeObserver(layout) : null;
    ro ? ro.observe(viewport) : global.addEventListener('resize', layout);
    layout();

    // Chrome (logo, section, numéro) et barre de progression, s'ils existent dans la scène.
    const chrome = stage.querySelector('.chrome-live');
    const chromeSection = chrome && chrome.querySelector('.chrome-section');
    const chromeNum = chrome && chrome.querySelector('.chrome-num');
    const progress = stage.querySelector('.progress i');
    let progressValue = 0;
    function setChromeTheme(theme) {
      if (!chrome) return;
      chrome.classList.remove('theme-dark', 'theme-light', 'theme-accent');
      chrome.classList.add('theme-' + theme);
      stage.style.setProperty('--prog-track', theme === 'dark' ? 'rgba(255,255,255,.12)' : 'rgba(20,17,14,.14)');
    }

    let cur = -1;
    let nextAt = Infinity;
    let finished = false;

    function goTo(i) {
      i = clamp(i, 0, slides.length - 1);
      if (i === cur) return;
      const prev = cur;
      cur = i;
      const t0 = now();

      if (prev >= 0) {
        const out = slides[prev];
        cancel(prev);
        loops = loops.filter((l) => l.group !== prev);
        tween({
          group: prev, dur: 480, ease: EASE.io,
          update: (p) => { out.style.opacity = 1 - p; out.style.transform = `translate3d(0,${-26 * p}px,0)`; },
          done: () => { out.classList.remove('is-active'); out.style.opacity = ''; out.style.transform = ''; },
        });
      }

      const el = slides[i];
      cancel(i);
      loops = loops.filter((l) => l.group !== i);
      el.style.opacity = ''; el.style.transform = '';
      const end = enter(i, prev >= 0 ? 320 : 150);
      el.classList.add('is-active');

      // Fond : glissement fluide vers la pose de la nouvelle slide.
      const from = { ...pose }, to = poseFor(metas[i]);
      cancel('bg');
      tween({ group: 'bg', dur: 1700, ease: EASE.io, update: (p) => { for (const k in to) pose[k] = lerp(from[k] ?? to[k], to[k], p); } });

      const theme = metas[i].theme;
      cancel('chrome');
      if (chrome) {
        chromeSection.textContent = metas[i].section || '';
        chromeNum.textContent = `${pad(i + 1)} / ${pad(slides.length)}`;
        tween({ group: 'chrome', delay: theme === 'accent' ? 700 : 250, dur: 10, update: (p) => { if (p >= 1) setChromeTheme(theme); } });
        tween({ group: 'chrome', delay: 250, dur: 700, update: (p) => { chromeNum.style.opacity = p; chromeSection.style.opacity = p; } });
      }
      if (progress) {
        const p0 = progressValue, p1 = (i + 1) / slides.length;
        progressValue = p1;
        tween({ group: 'chrome', dur: 900, ease: EASE.io, update: (p) => { progress.style.transform = `scaleX(${lerp(p0, p1, p)})`; } });
      }

      nextAt = t0 + (metas[i].duration ? metas[i].duration * 1000 : end + 2600);
      if (o.hash) try { history.replaceState(null, '', `${location.search}#${i + 1}`); } catch {}
      o.onChange && o.onChange(i);
    }

    function frame() {
      const t = now();
      runTweens(t);
      for (const l of loops) l.f(t);
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBackground(bctx, cw, ch, pose, reduced ? 8 : t / 1000);
      if (o.autoplay && t >= nextAt) {
        if (cur < slides.length - 1) goTo(cur + 1);
        else if (o.loop) goTo(0);
        else { finished = true; nextAt = Infinity; }
      }
    }

    // Navigation
    const next = () => goTo(cur + 1);
    const prev = () => goTo(cur - 1);
    const offs = [];
    const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); offs.push(() => target.removeEventListener(type, fn, opts)); };
    if (o.controls && mode === 'live') {
      const input = o.input || global;
      on(global, 'keydown', (e) => {
        if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
        else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
        else if (e.key === 'Home') goTo(0);
        else if (e.key === 'End') goTo(slides.length - 1);
        else if (e.key === 'Escape' && o.onExit) o.onExit();
        else if (e.key === 'f' || e.key === 'F') {
          const target = o.fullscreenTarget || document.documentElement;
          const req = document.fullscreenElement ? document.exitFullscreen() : target.requestFullscreen?.();
          req?.catch?.(() => {});
        }
      });
      let tx = null, ty = null;
      on(input, 'touchstart', (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
      on(input, 'touchend', (e) => {
        if (tx === null) return;
        const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
        tx = null;
        if (e.target.closest && e.target.closest('[data-player-ui]')) return;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)();
        else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) (e.changedTouches[0].clientX > global.innerWidth * 0.3 ? next : prev)();
      });
      on(input, 'click', (e) => {
        if (e.pointerType === 'touch' || e.target.closest('a, button, [data-player-ui]')) return;
        (e.clientX > global.innerWidth * 0.3 ? next : prev)();
      });
    }

    let raf = 0, alive = true;
    if (mode === 'live') {
      const loop = () => { if (!alive) return; frame(); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    pose = poseFor(metas[o.start || 0] || {});
    goTo(o.start || 0);
    if (mode !== 'live') frame();

    return {
      goTo, next, prev,
      get index() { return cur; },
      get finished() { return finished; },
      get count() { return slides.length; },
      advance(ms) { vt += ms; frame(); return finished; },
      destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        offs.forEach((f) => f());
        ro ? ro.disconnect() : global.removeEventListener('resize', layout);
      },
    };
  }

  // Images de fond figées pour l'impression (PDF via ?print ou Imprimer du navigateur).
  function addPrintBackgrounds(slides, metas) {
    return Promise.all(slides.map((slide, i) => {
      if (metas[i].theme === 'accent' || slide.querySelector(':scope > .print-bg')) return Promise.resolve();
      const img = new Image();
      img.className = 'print-bg';
      img.alt = '';
      img.src = backgroundURL(metas[i], i);
      slide.prepend(img);
      return img.decode().catch(() => {});
    }));
  }

  // ——— Présentation autonome (fichier HTML construit) ———
  function boot() {
    const qs = new URLSearchParams(location.search);
    const MODE = qs.has('print') ? 'print' : qs.has('capture') ? 'capture' : 'live';
    const DATA = JSON.parse(document.getElementById('deck-data').textContent);
    const root = document.documentElement;
    root.classList.add('mode-' + MODE);
    const slides = [...document.querySelectorAll('#stage .slide')];
    const metas = DATA.slides;
    if (qs.has('light')) {
      slides.forEach((el, i) => {
        if (metas[i].theme === 'dark') { metas[i].theme = 'light'; el.classList.replace('theme-dark', 'theme-light'); }
      });
    }

    if (MODE === 'print') {
      Promise.all([document.fonts.ready, addPrintBackgrounds(slides, metas)]).then(() => { global.__deckReady = true; });
      return;
    }

    const start = MODE === 'live' ? clamp((parseInt(location.hash.slice(1), 10) || 1) - 1, 0, slides.length - 1) : 0;
    document.fonts.ready.then(() => {
      const player = createPlayer({
        viewport: document.getElementById('viewport'),
        stage: document.getElementById('stage'),
        canvas: document.getElementById('bg'),
        slides, metas, mode: MODE, start,
        autoplay: (qs.has('autoplay') || MODE === 'capture') && !qs.has('noauto'),
        loop: qs.has('loop'),
        controls: true,
        hash: MODE === 'live',
      });
      global.__deck = player;
      global.__deckReady = true;
      if (MODE === 'live') {
        global.addEventListener('hashchange', () => player.goTo((parseInt(location.hash.slice(1), 10) || 1) - 1));
        setTimeout(() => { const h = document.querySelector('.hint'); if (h) h.style.opacity = 0; }, 6000);
        // Prépare les fonds d'impression en tâche de fond : Fichier > Imprimer donne alors un PDF vectoriel.
        const prep = () => addPrintBackgrounds(slides, metas);
        global.requestIdleCallback ? global.requestIdleCallback(prep, { timeout: 4000 }) : setTimeout(prep, 2500);
      }
    });
  }

  global.CoreshiftPlayer = { createPlayer, drawBackground, paintBackground, backgroundURL, poseFor, POSES };
  if (document.getElementById('deck-data')) boot();
})(window);
