/* Coreshift Slides — le studio.
   Bibliothèque de decks, édition directe dans la slide, mode présentation, exports PDF / HTML / JSON,
   génération et réécriture avec Claude. Les decks vivent dans la base de l'artefact (partagée avec
   l'équipe) ; hors de claude.ai, ils sont gardés dans le navigateur. */
(function () {
  'use strict';

  const L = window.CoreshiftLayouts;
  const P = window.CoreshiftPlayer;
  const TEMPLATE_DECK = window.CORESHIFT_TEMPLATE_DECK || { title: 'Présentation Coreshift', slides: [] };
  const LIBS = window.STUDIO_LIBS || {};
  const META_KEYS = ['layout', 'section', 'bg', 'theme', 'duration'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s = '') => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  let uidSeq = 0;
  const uid = () => 'u' + ++uidSeq;
  const app = $('#app');

  const ICON = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  };

  // ——— Bibliothèques chargées à la demande (CDN dans l'artefact, intégrées en local) ———
  const GLOBALS = { jsyaml: 'jsyaml', htmlToImage: 'htmlToImage', jspdf: 'jspdf' };
  const libLoads = {};
  function lib(name) {
    const g = GLOBALS[name];
    if (window[g]) return Promise.resolve(window[g]);
    if (!LIBS[name]) return Promise.reject(new Error(`bibliothèque ${name} indisponible`));
    return (libLoads[name] ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIBS[name];
      s.onload = () => (window[g] ? resolve(window[g]) : reject(new Error(`bibliothèque ${name} vide`)));
      s.onerror = () => { delete libLoads[name]; reject(new Error(`impossible de charger ${name}`)); };
      document.head.append(s);
    }));
  }
  // YAML pour le panneau « contenu détaillé » ; JSON si la bibliothèque ne charge pas.
  const Y = {
    dump: (o) => (window.jsyaml ? window.jsyaml.dump(o, { lineWidth: 100, noRefs: true }) : JSON.stringify(o, null, 2)),
    load: (t) => (window.jsyaml ? window.jsyaml.load(t) : JSON.parse(t)),
  };

  // ——— Capacités de claude.ai (null hors de claude.ai) ———
  const caps = { db: null, downloads: null, sample: null, user: null };
  async function initCaps() {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    const names = ['db', 'downloads', 'sample', 'user'];
    const got = await Promise.all(names.map((n) => window.claude.use(n).catch(() => null)));
    names.forEach((n, i) => { caps[n] = got[i]; });
  }

  // ——— Stockage des decks ———
  const LOCAL_KEY = 'coreshift-slides:decks';
  const memory = {};
  const Store = {
    mode: 'loading',
    init() {
      if (caps.db) {
        this.mode = 'db';
        caps.db.collection('decks').orderBy('updatedAt', 'desc').limit(300).onSnapshot(
          (snap) => onDecks(snap.docs.filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() }))),
          () => toast('La base des decks ne répond plus. Rechargez la page.', true)
        );
      } else {
        this.mode = 'local';
        onDecks(this.readLocal());
        window.addEventListener('storage', (e) => { if (e.key === LOCAL_KEY) onDecks(this.readLocal()); });
      }
    },
    readLocal() {
      let map = memory;
      try { map = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch {}
      return Object.entries(map).map(([id, d]) => ({ id, ...d })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    writeLocal(fn) {
      let map = memory;
      try { map = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch {}
      fn(map);
      Object.assign(memory, map);
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(map)); } catch {}
      onDecks(this.readLocal());
    },
    newId() {
      return this.mode === 'db'
        ? caps.db.collection('decks').doc().id
        : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },
    async save(id, body) {
      if (this.mode === 'db') return caps.db.doc('decks/' + id).set(body);
      this.writeLocal((m) => { m[id] = body; });
    },
    async remove(id) {
      if (this.mode === 'db') return caps.db.doc('decks/' + id).delete();
      this.writeLocal((m) => { delete m[id]; });
    },
  };

  // ——— État ———
  const S = {
    decks: [], loaded: false, routed: false, view: 'library',
    deckId: null, deck: null, sel: 0,
    dirty: false, saving: false, pending: false, lastJSON: '', saveError: false,
    undo: [], editing: null, yamlSnap: null, readOnly: false, player: null,
  };
  const deckJSON = (d) => JSON.stringify({ title: d.title, slides: d.slides });
  const normalize = (d) => ({
    title: d.title || 'Sans titre',
    slides: Array.isArray(d.slides) ? d.slides.filter((s) => s && typeof s === 'object') : [],
    createdAt: d.createdAt || Date.now(),
    updatedAt: d.updatedAt || Date.now(),
  });

  function onDecks(list) {
    S.decks = list;
    S.loaded = true;
    if (S.view === 'library') renderLibrary();
    else if (S.view === 'editor') {
      const remote = list.find((d) => d.id === S.deckId);
      if (!remote) {
        if (!S.dirty && !S.saving) { toast('Ce deck a été supprimé.'); goLibrary(); }
      } else {
        const json = deckJSON(normalize(remote));
        if (json !== S.lastJSON && !S.dirty && !S.saving && !S.editing && !S.yamlSnap) {
          S.deck = normalize(clone(remote));
          S.lastJSON = json;
          S.sel = clamp(S.sel, 0, Math.max(0, S.deck.slides.length - 1));
          renderEditor();
          toast('Deck mis à jour depuis un autre appareil.');
        }
      }
    }
    if (!S.routed) {
      S.routed = true;
      const m = location.hash.match(/^#d-([A-Za-z0-9._~-]+)$/);
      if (m && list.some((d) => d.id === m[1])) openDeck(m[1]);
    }
  }

  // ——— Enregistrement ———
  let saveTimer = 0;
  function changed() {
    S.dirty = true;
    renderSaveStatus();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    if (!S.deck || !S.dirty) return;
    if (S.saving) { S.pending = true; return; }
    S.saving = true;
    S.dirty = false;
    const body = { title: S.deck.title, slides: S.deck.slides, createdAt: S.deck.createdAt, updatedAt: Date.now() };
    S.lastJSON = deckJSON(body);
    renderSaveStatus();
    try {
      await Store.save(S.deckId, clone(body));
      S.saveError = false;
    } catch (e) {
      S.dirty = true;
      S.saveError = true;
      if (e && e.code === 'invalid_argument') {
        S.readOnly = true;
        toast('Vous pouvez lire ce deck mais pas le modifier.', true);
      } else if (e && e.code === 'quota_exceeded') toast('La base des decks est pleine : supprimez d’anciens decks.', true);
    } finally {
      S.saving = false;
      renderSaveStatus();
      if (S.pending || (S.dirty && !S.saveError)) { S.pending = false; changed(); }
    }
  }
  function renderSaveStatus() {
    const el = $('#save-status');
    if (!el) return;
    el.classList.toggle('err', S.saveError);
    el.textContent = S.readOnly ? 'Lecture seule'
      : S.saveError ? 'Non enregistré'
      : S.saving || S.dirty ? 'Enregistrement…'
      : Store.mode === 'db' ? 'Enregistré' : 'Enregistré dans ce navigateur';
    const u = $('#undo-btn');
    if (u) u.disabled = !S.undo.length || S.readOnly;
  }
  function checkpoint(snapshot) {
    S.undo.push(snapshot || deckJSON(S.deck));
    if (S.undo.length > 60) S.undo.shift();
  }
  function undo() {
    if (!S.undo.length || S.readOnly) return;
    const prev = JSON.parse(S.undo.pop());
    S.deck.title = prev.title;
    S.deck.slides = prev.slides;
    S.sel = clamp(S.sel, 0, Math.max(0, S.deck.slides.length - 1));
    renderEditor();
    changed();
  }

  // ——— Rendu des slides ———
  function safeRender(slide, index, total, deck) {
    try {
      return L.renderSlide(slide, { index, total, deck: { brand: 'Coreshift', ...(deck || {}) }, uid: uid() });
    } catch (e) {
      return `<section class="slide layout-error theme-dark"><div class="content"><p class="t-lead">Slide illisible : ${esc(e.message)}</p></div></section>`;
    }
  }
  const thumbRO = new ResizeObserver((entries) => {
    for (const e of entries) {
      const inner = e.target.firstElementChild;
      if (inner) inner.style.transform = `scale(${e.contentRect.width / 1920})`;
    }
  });
  function mountThumb(el, slide, index, total, deck) {
    el.textContent = '';
    if (!slide) return;
    const wrap = document.createElement('div');
    wrap.className = 'deck-static';
    const cv = document.createElement('canvas');
    cv.className = 'bg-static';
    cv.width = 384; cv.height = 216;
    wrap.append(cv);
    wrap.insertAdjacentHTML('beforeend', safeRender(slide, index, total, deck));
    wrap.style.transform = `scale(${(el.clientWidth || 240) / 1920})`;
    el.append(wrap);
    P.paintBackground(cv, L.slideMeta(slide), index);
    thumbRO.observe(el);
  }

  // ——— Bibliothèque ———
  function ago(ts) {
    if (!ts) return '';
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'à l’instant';
    if (m < 60) return `il y a ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `il y a ${h} h`;
    return 'le ' + new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  function setHash(h) {
    try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch {}
  }
  function goLibrary() {
    if (S.dirty) saveNow();
    S.view = 'library';
    S.deck = null; S.deckId = null; S.editing = null; S.yamlSnap = null;
    hideFmt();
    renderLibrary();
  }
  function renderLibrary() {
    S.view = 'library';
    setHash('');
    thumbRO.disconnect();
    const n = S.decks.length;
    app.innerHTML = `
      <header class="topbar">
        <div class="s-brand">${L.logo()}Coreshift <span>Slides</span></div>
        <div class="grow"></div>
        <span class="mono store-badge hide-phone ${Store.mode === 'db' ? '' : 'local'}">${Store.mode === 'db' ? 'Base partagée de l’équipe' : Store.mode === 'local' ? 'Enregistré dans ce navigateur' : 'Connexion…'}</span>
        ${S.readOnly ? '' : '<button class="b b-primary" data-act="new-deck">Nouveau deck</button>'}
      </header>
      <main class="lib">
        <div class="lib-head"><div>
          <div class="mono">Bibliothèque</div>
          <h1>Vos présentations</h1>
          <p>${n ? `${n} deck${n > 1 ? 's' : ''}. Modifiez le texte directement dans les slides, présentez en plein écran, exportez en PDF.` : 'Chaque deck se modifie directement dans les slides, se présente en plein écran et s’exporte en PDF.'}</p>
        </div></div>
        ${!S.loaded ? '<div class="loading">Chargement des decks…</div>'
          : n ? `<div class="deck-grid">${S.decks.map(deckCard).join('')}</div>`
          : `<div class="empty"><h2>Aucune présentation pour l’instant</h2><p>Partez du modèle Coreshift (9 slides prêtes à adapter) ou décrivez votre rendez-vous à Claude pour obtenir un premier jet.</p>
              ${S.readOnly ? '' : '<div class="row"><button class="b b-primary" data-act="quick-template">Partir du modèle Coreshift</button><button class="b" data-act="new-deck">Autres options</button></div>'}</div>`}
      </main>`;
    $$('[data-thumb-deck]').forEach((el) => {
      const d = S.decks.find((x) => x.id === el.dataset.thumbDeck);
      const slides = Array.isArray(d?.slides) ? d.slides : [];
      mountThumb(el, slides[0], 0, slides.length || 1, d);
    });
  }
  function deckCard(d) {
    const n = Array.isArray(d.slides) ? d.slides.length : 0;
    const id = esc(d.id);
    return `<article class="deck-card">
      <button class="thumb-btn" data-act="open" data-id="${id}" aria-label="Ouvrir ${esc(d.title)}"><div class="thumb" data-thumb-deck="${id}"></div></button>
      <div class="deck-info"><h3 title="${esc(d.title)}">${esc(d.title || 'Sans titre')}</h3><p>${n} slide${n > 1 ? 's' : ''} · modifié ${ago(d.updatedAt)}</p></div>
      <div class="deck-actions">
        <button class="b" data-act="open" data-id="${id}">${S.readOnly ? 'Voir' : 'Modifier'}</button>
        <button class="b" data-act="present" data-id="${id}">${ICON.play}Présenter</button>
        ${S.readOnly ? '' : `<button class="b b-ghost" data-act="dup-deck" data-id="${id}">Dupliquer</button>
        <button class="b b-ghost b-danger" data-act="del-deck" data-id="${id}">Supprimer</button>`}
      </div>
    </article>`;
  }

  async function createDeck(title, slides) {
    const id = Store.newId();
    const now = Date.now();
    const body = { title: title || 'Nouvelle présentation', slides, createdAt: now, updatedAt: now };
    await Store.save(id, clone(body));
    if (!S.decks.some((d) => d.id === id)) S.decks.unshift({ id, ...body });
    openDeck(id);
  }

  // ——— Éditeur ———
  async function openDeck(id, sel = 0) {
    const d = S.decks.find((x) => x.id === id);
    if (!d) return;
    S.deckId = id;
    S.deck = normalize(clone(d));
    S.lastJSON = deckJSON(S.deck);
    S.sel = clamp(sel, 0, Math.max(0, S.deck.slides.length - 1));
    S.undo = []; S.dirty = false; S.saveError = false; S.editing = null; S.yamlSnap = null;
    S.view = 'editor';
    setHash('d-' + id);
    renderEditor();
    if (!window.jsyaml) lib('jsyaml').then(() => { if (S.view === 'editor' && !S.yamlSnap) renderInspector(); }).catch(() => {});
  }

  function renderEditor() {
    hideFmt();
    app.innerHTML = `
      <header class="topbar">
        <button class="b b-icon b-ghost" data-act="home" aria-label="Retour à la bibliothèque" title="Bibliothèque">${ICON.back}</button>
        <input class="deck-title" id="deck-title" value="${esc(S.deck.title)}" aria-label="Titre du deck" maxlength="140" ${S.readOnly ? 'readonly' : ''}>
        <span class="mono save-status hide-phone" id="save-status"></span>
        <div class="grow"></div>
        <button class="b b-ghost hide-phone" data-act="undo" id="undo-btn" title="Annuler (Ctrl+Z)">Annuler</button>
        <button class="b only-narrow" data-act="toggle-insp" aria-controls="inspector">Réglages</button>
        <div class="menu">
          <button class="b" data-act="export-menu" aria-haspopup="true" aria-expanded="false">Exporter</button>
          <div class="menu-pop" id="export-pop" hidden>
            <button data-act="export-pdf">PDF<small>Une page par slide, comme en présentation</small></button>
            <button data-act="export-pdf-light">PDF clair<small>Fond papier, pour imprimer</small></button>
            <button data-act="export-html">Présentation hors ligne (.html)<small>S’ouvre sans connexion. Imprimer depuis Chrome donne un PDF vectoriel.</small></button>
            <button data-act="export-json">Contenu (.json)<small>Pour le dépôt GitHub : vidéo MP4, PDF vectoriel</small></button>
          </div>
        </div>
        <button class="b b-primary" data-act="present-current">${ICON.play}<span class="hide-phone">Présenter</span></button>
      </header>
      <div class="editor">
        <nav class="rail" id="rail" aria-label="Slides"></nav>
        <section class="stage-area" id="stage-area">
          <div class="canvas-wrap" id="canvas-wrap"></div>
          <p class="canvas-hint hide-phone">${S.readOnly ? 'Lecture seule.' : 'Cliquez sur un texte pour le modifier. Sélectionnez des mots pour les passer en orange. <kbd>Entrée</kbd> valide, <kbd>Maj</kbd>+<kbd>Entrée</kbd> va à la ligne, <kbd>Échap</kbd> annule.'}</p>
        </section>
        <aside class="inspector" id="inspector" aria-label="Réglages de la slide"></aside>
      </div>`;
    renderRail();
    renderCanvas();
    renderInspector();
    renderSaveStatus();
    stageRO.disconnect();
    stageRO.observe($('#stage-area'));
  }

  function renderRail() {
    const rail = $('#rail');
    if (!rail) return;
    thumbRO.disconnect();
    const n = S.deck.slides.length;
    rail.innerHTML = S.deck.slides.map((s, i) => `
      <div class="rail-item ${i === S.sel ? 'on' : ''}" data-i="${i}">
        <span class="rail-num">${i + 1}</span>
        <button class="rail-thumb" data-act="select" data-i="${i}" aria-label="Slide ${i + 1} : ${esc(L.LAYOUTS[s.layout]?.name || s.layout)}" ${i === S.sel ? 'aria-current="true"' : ''}><div class="thumb" data-rail-thumb="${i}"></div></button>
        ${S.readOnly ? '' : `<div class="rail-tools">
          <button data-act="move-up" data-i="${i}" title="Monter" aria-label="Monter la slide ${i + 1}" ${i ? '' : 'disabled'}>↑</button>
          <button data-act="move-down" data-i="${i}" title="Descendre" aria-label="Descendre la slide ${i + 1}" ${i < n - 1 ? '' : 'disabled'}>↓</button>
          <button data-act="dup-slide" data-i="${i}" title="Dupliquer" aria-label="Dupliquer la slide ${i + 1}">⧉</button>
          <button data-act="del-slide" data-i="${i}" title="Supprimer" aria-label="Supprimer la slide ${i + 1}">✕</button>
        </div>`}
      </div>`).join('') + (S.readOnly ? '' : '<button class="b rail-add" data-act="add-slide">+ Slide</button>');
    $$('[data-rail-thumb]', rail).forEach((el) => {
      const i = +el.dataset.railThumb;
      mountThumb(el, S.deck.slides[i], i, n, S.deck);
    });
  }
  function refreshThumb(i) {
    const el = $(`[data-rail-thumb="${i}"]`);
    if (el) mountThumb(el, S.deck.slides[i], i, S.deck.slides.length, S.deck);
  }

  const stageRO = new ResizeObserver(() => fitCanvas());
  function fitCanvas() {
    const area = $('#stage-area'), wrap = $('#canvas-wrap');
    if (!area || !wrap) return;
    const hint = $('.canvas-hint', area);
    const w = area.clientWidth - 32;
    const h = area.clientHeight - 32 - (hint && hint.offsetParent ? hint.offsetHeight + 12 : 0);
    const s = Math.max(0.05, Math.min(w / 1920, h / 1080));
    wrap.style.width = `${Math.floor(1920 * s)}px`;
    wrap.style.height = `${Math.floor(1080 * s)}px`;
    const ds = wrap.firstElementChild;
    if (ds) ds.style.transform = `scale(${s})`;
  }

  function renderCanvas() {
    const wrap = $('#canvas-wrap');
    if (!wrap) return;
    const s = S.deck.slides[S.sel];
    wrap.textContent = '';
    if (!s) {
      wrap.innerHTML = '<div class="empty" style="height:100%;border:0"><h2>Deck vide</h2><p>Ajoutez une première slide.</p><button class="b b-primary" data-act="add-slide">+ Slide</button></div>';
      fitCanvas();
      return;
    }
    const ds = document.createElement('div');
    ds.className = 'deck-static' + (S.readOnly ? '' : ' editable');
    const cv = document.createElement('canvas');
    cv.className = 'bg-static';
    cv.width = 1280; cv.height = 720;
    ds.append(cv);
    ds.insertAdjacentHTML('beforeend', safeRender(s, S.sel, S.deck.slides.length, S.deck));
    wrap.append(ds);
    P.paintBackground(cv, L.slideMeta(s), S.sel);
    if (!S.readOnly) {
      for (const el of $$('[data-f]', ds)) {
        el.contentEditable = 'true';
        el.spellcheck = true;
        el.setAttribute('role', 'textbox');
      }
    }
    fitCanvas();
  }

  function renderInspector() {
    const insp = $('#inspector');
    if (!insp) return;
    const s = S.deck.slides[S.sel];
    if (!s) { insp.innerHTML = ''; return; }
    const meta = L.slideMeta(s);
    const content = {};
    for (const [k, v] of Object.entries(s)) if (!META_KEYS.includes(k)) content[k] = v;
    const dis = S.readOnly ? 'disabled' : '';
    insp.innerHTML = `
      <h2>Slide ${S.sel + 1}<span class="mono">${esc(L.LAYOUTS[s.layout]?.name || s.layout)}</span></h2>
      <label class="field"><span>Gabarit</span><select id="i-layout" ${dis}>${Object.entries(L.LAYOUTS).map(([k, v]) => `<option value="${k}" ${k === s.layout ? 'selected' : ''}>${esc(v.name)} — ${esc(v.desc)}</option>`).join('')}</select></label>
      <label class="field"><span>Section (en haut à droite)</span><input id="i-section" value="${esc(s.section || '')}" ${dis}></label>
      ${s.layout === 'punchline' ? '' : `
      <div class="field"><span>Fond</span><div class="seg" role="group" aria-label="Fond">
        <button data-act="theme" data-v="dark" class="${meta.theme === 'dark' ? 'on' : ''}" aria-pressed="${meta.theme === 'dark'}" ${dis}>Sombre</button>
        <button data-act="theme" data-v="light" class="${meta.theme === 'light' ? 'on' : ''}" aria-pressed="${meta.theme === 'light'}" ${dis}>Clair</button>
      </div></div>
      <label class="field"><span>Animation du fond</span><select id="i-bg" ${dis}>${Object.entries(L.BACKGROUNDS).map(([k, v]) => `<option value="${k}" ${k === meta.bg ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`}
      <label class="field"><span>Durée en lecture automatique (s)</span><input id="i-duration" type="number" min="2" max="120" step="1" placeholder="Automatique" value="${s.duration || ''}" ${dis}></label>
      <div class="field"><span>Contenu détaillé</span>
        <textarea id="i-yaml" class="yaml" spellcheck="false" aria-describedby="yaml-state" ${S.readOnly ? 'readonly' : ''}>${esc(Y.dump(content))}</textarea>
        <div class="yaml-state" id="yaml-state">Listes, chiffres, courbes : modifiez ici, l’aperçu suit.</div>
      </div>
      ${caps.sample && !S.readOnly ? `<div class="box ai"><h3>Réécrire avec Claude</h3>
        <p>Claude garde le gabarit et réécrit le contenu selon votre consigne.</p>
        <textarea id="ai-slide" placeholder="Ex. : adapte cette slide à un cabinet comptable de 8 personnes"></textarea>
        <button class="b" data-act="ai-slide">Réécrire la slide</button></div>` : ''}
      ${S.readOnly ? '' : `<div class="row"><button class="b" data-act="dup-slide" data-i="${S.sel}">Dupliquer la slide</button><button class="b b-danger" data-act="del-slide" data-i="${S.sel}">Supprimer</button></div>`}`;
  }

  // Garde le panneau « contenu détaillé » en phase avec les modifications faites dans la slide.
  function refreshYaml() {
    const t = $('#i-yaml');
    const s = S.deck && S.deck.slides[S.sel];
    if (!t || !s || document.activeElement === t) return;
    const content = {};
    for (const [k, v] of Object.entries(s)) if (!META_KEYS.includes(k)) content[k] = v;
    t.value = Y.dump(content);
  }

  function select(i) {
    if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
    S.sel = clamp(i, 0, Math.max(0, S.deck.slides.length - 1));
    $$('.rail-item').forEach((el) => {
      const on = +el.dataset.i === S.sel;
      el.classList.toggle('on', on);
      const b = $('.rail-thumb', el);
      if (b) on ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current');
    });
    $(`.rail-item[data-i="${S.sel}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    renderCanvas();
    renderInspector();
  }

  // Modifications structurelles : une étape d'annulation, puis rendu et enregistrement.
  function mutate(fn, { sel, inspector = true } = {}) {
    if (S.readOnly) return;
    checkpoint();
    fn(S.deck.slides);
    if (sel != null) S.sel = sel;
    S.sel = clamp(S.sel, 0, Math.max(0, S.deck.slides.length - 1));
    renderRail();
    renderCanvas();
    if (inspector) renderInspector();
    changed();
  }
  function changeLayout(layout) {
    const old = S.deck.slides[S.sel];
    const tpl = clone(L.TEMPLATES[layout]);
    const keep = {};
    for (const k of ['section', 'eyebrow', 'title', 'text', 'lead']) if (old[k] && k in tpl) keep[k] = old[k];
    const next = { ...tpl, ...keep, section: old.section || tpl.section };
    if (layout === 'punchline' && old.title && !old.quote) next.quote = old.title;
    mutate((sl) => { sl[S.sel] = next; });
  }

  // ——— Édition directe dans la slide ———
  function readField(el) {
    let out = '';
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.textContent;
        else if (c.nodeName === 'BR') out += '\n';
        else if (c.nodeName === 'EM') { out += '*'; walk(c); out += '*'; }
        else if (c.nodeName === 'DIV' || c.nodeName === 'P') { if (out && !out.endsWith('\n')) out += '\n'; walk(c); }
        else walk(c);
      }
    };
    walk(el);
    return out
      .replace(/[  ]/g, ' ')
      .replace(/\*(\s+)\*/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/^\s+|\s+$/g, '');
  }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach((k, i) => {
      const nextIsIndex = /^\d+$/.test(keys[i + 1]);
      if (o[k] == null || typeof o[k] !== 'object') o[k] = nextIsIndex ? [] : {};
      o = o[k];
    });
    o[keys[keys.length - 1]] = value;
  }
  function applyField(el) {
    const slide = S.deck.slides[S.sel];
    if (!slide) return;
    const raw = readField(el);
    if (el.dataset.num) {
      const v = parseFloat(raw.replace(/[\s  ]/g, '').replace(',', '.'));
      if (!Number.isFinite(v)) return;
      setPath(slide, el.dataset.f, v);
    } else setPath(slide, el.dataset.f, raw);
    changed();
  }
  const editableOf = (node) => {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const f = el && el.closest('[data-f]');
    return f && f.isContentEditable && f.closest('#canvas-wrap') ? f : null;
  };

  document.addEventListener('focusin', (e) => {
    const el = editableOf(e.target);
    if (!el) return;
    S.editing = { el, snapshot: deckJSON(S.deck) };
  });
  document.addEventListener('input', (e) => {
    const el = editableOf(e.target);
    if (el) applyField(el);
  });
  document.addEventListener('focusout', (e) => {
    const el = editableOf(e.target);
    if (!el || !S.editing) return;
    const { snapshot } = S.editing;
    const idx = S.sel;
    if (deckJSON(S.deck) !== snapshot) checkpoint(snapshot);
    S.editing = null;
    hideFmt();
    setTimeout(() => {
      refreshThumb(idx);
      refreshYaml();
      renderSaveStatus();
      // Re-rend la slide (typographie, mots en orange) sauf si l'on est passé à un autre texte.
      if (!editableOf(document.activeElement)) renderCanvas();
    }, 0);
  });
  document.addEventListener('keydown', (e) => {
    const el = editableOf(e.target);
    if (!el) return;
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); }
    else if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      const snap = JSON.parse(S.editing.snapshot);
      S.deck.slides = snap.slides;
      S.editing = null;
      renderCanvas();
      refreshThumb(S.sel);
      changed();
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B') && el.dataset.rich) { e.preventDefault(); toggleAccent(); }
  });
  document.addEventListener('paste', (e) => {
    const el = editableOf(e.target);
    if (!el) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, text);
  });

  // Barre « mettre en orange » au-dessus de la sélection.
  const fmt = document.createElement('div');
  fmt.className = 'fmt-bar';
  fmt.hidden = true;
  fmt.innerHTML = '<button type="button" data-fmt="accent"><span class="swatch"></span><span>Mettre en orange</span></button>';
  document.body.append(fmt);
  fmt.addEventListener('mousedown', (e) => e.preventDefault());
  fmt.addEventListener('click', toggleAccent);
  function hideFmt() { fmt.hidden = true; }
  const emOf = (node, host) => {
    let n = node && (node.nodeType === 1 ? node : node.parentElement);
    while (n && n !== host) { if (n.nodeName === 'EM') return n; n = n.parentElement; }
    return null;
  };
  document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return hideFmt();
    const r = sel.getRangeAt(0);
    const host = editableOf(r.commonAncestorContainer);
    if (!host || !host.dataset.rich) return hideFmt();
    const rect = r.getBoundingClientRect();
    fmt.style.left = `${clamp(rect.left + rect.width / 2, 80, window.innerWidth - 80)}px`;
    fmt.style.top = `${Math.max(48, rect.top)}px`;
    $('span:last-child', fmt).textContent = emOf(r.commonAncestorContainer, host) ? 'Retirer l’orange' : 'Mettre en orange';
    fmt.hidden = false;
  });
  function unwrap(el) { el.replaceWith(...el.childNodes); }
  function toggleAccent() {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const host = editableOf(r.commonAncestorContainer);
    if (!host) return;
    const em = emOf(r.commonAncestorContainer, host);
    if (em) unwrap(em);
    else {
      const frag = r.extractContents();
      frag.querySelectorAll('em').forEach(unwrap);
      const wrap = document.createElement('em');
      wrap.append(frag);
      r.insertNode(wrap);
      const nr = document.createRange();
      nr.selectNodeContents(wrap);
      sel.removeAllRanges();
      sel.addRange(nr);
    }
    applyField(host);
    hideFmt();
  }

  // ——— Inspecteur ———
  let yamlTimer = 0;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'deck-title') { S.deck.title = t.value; changed(); }
    else if (t.id === 'i-section') {
      S.deck.slides[S.sel].section = t.value;
      renderCanvas();
      changed();
    } else if (t.id === 'i-duration') {
      const v = parseFloat(t.value);
      if (Number.isFinite(v) && v > 0) S.deck.slides[S.sel].duration = v; else delete S.deck.slides[S.sel].duration;
      changed();
    } else if (t.id === 'i-yaml') {
      clearTimeout(yamlTimer);
      yamlTimer = setTimeout(() => applyYaml(t.value), 350);
    }
  });
  document.addEventListener('focusin', (e) => {
    if (e.target.id === 'i-yaml' || e.target.id === 'i-section' || e.target.id === 'i-duration') S.yamlSnap = deckJSON(S.deck);
  });
  document.addEventListener('focusout', (e) => {
    if (!['i-yaml', 'i-section', 'i-duration'].includes(e.target.id) || !S.yamlSnap) return;
    if (e.target.id === 'i-yaml') { clearTimeout(yamlTimer); applyYaml(e.target.value); }
    if (deckJSON(S.deck) !== S.yamlSnap) checkpoint(S.yamlSnap);
    S.yamlSnap = null;
    refreshThumb(S.sel);
    renderSaveStatus();
  });
  function applyYaml(text) {
    const state = $('#yaml-state');
    let data;
    try { data = Y.load(text); } catch (err) {
      if (state) { state.textContent = (err.mark ? `Ligne ${err.mark.line + 1} : ` : '') + (err.reason || err.message); state.classList.add('err'); }
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      if (state) { state.textContent = 'Le contenu doit être une liste de champs « nom: valeur ».'; state.classList.add('err'); }
      return;
    }
    const cur = S.deck.slides[S.sel];
    const next = {};
    for (const k of META_KEYS) if (cur[k] !== undefined) next[k] = cur[k];
    for (const [k, v] of Object.entries(data)) if (!META_KEYS.includes(k)) next[k] = v;
    if (JSON.stringify(next) === JSON.stringify(cur)) return;
    S.deck.slides[S.sel] = next;
    if (state) { state.textContent = 'Appliqué.'; state.classList.remove('err'); }
    renderCanvas();
    changed();
  }
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (S.view !== 'editor' || !S.deck) return;
    if (t.id === 'i-layout') changeLayout(t.value);
    else if (t.id === 'i-bg') mutate((sl) => { sl[S.sel].bg = t.value; });
  });

  // ——— Fenêtres ———
  function modal(html, { wide = false, onClose } = {}) {
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    scrim.addEventListener('click', (e) => { if (e.target === scrim || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.append(scrim);
    setTimeout(() => $('input, textarea, button.b-primary', scrim)?.focus(), 30);
    return { el: scrim, close };
  }
  function confirmBox(title, text, okLabel) {
    return new Promise((resolve) => {
      let done = false;
      const m = modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="modal-actions"><button class="b" data-close>Annuler</button><button class="b b-primary" data-ok>${esc(okLabel)}</button></div>`,
        { onClose: () => { if (!done) resolve(false); } });
      $('[data-ok]', m.el).addEventListener('click', () => { done = true; m.close(); resolve(true); });
    });
  }
  function progressBox(title) {
    const m = modal(`<h2>${esc(title)}</h2><div class="progress-box"><p id="pg-text">Préparation…</p><div class="progress-bar"><i id="pg-bar"></i></div></div>`);
    return {
      set(i, n, text) { $('#pg-text', m.el).textContent = text || `Slide ${Math.min(i + 1, n)} sur ${n}…`; $('#pg-bar', m.el).style.width = `${(i / n) * 100}%`; },
      close: m.close,
    };
  }
  let toastTimer = 0;
  function toast(msg, err = false) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg;
    t.classList.toggle('err', err);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, err ? 6000 : 3200);
  }

  function newDeckDialog() {
    const ai = !!caps.sample;
    const m = modal(`
      <h2>Nouveau deck</h2>
      <label class="field"><span>Titre</span><input id="nd-title" value="Nouvelle présentation" maxlength="140"></label>
      <div class="choices" role="radiogroup" aria-label="Point de départ">
        <label class="choice"><input type="radio" name="nd-src" value="template" checked><b>Partir du modèle Coreshift</b><span>Les 9 slides de la démo, prêtes à adapter</span></label>
        <label class="choice"><input type="radio" name="nd-src" value="blank"><b>Deck court</b><span>Une ouverture et une conclusion, à compléter</span></label>
        ${ai ? '<label class="choice"><input type="radio" name="nd-src" value="ai"><b>Générer avec Claude</b><span>À partir d’un brief : client, contexte, objectif du rendez-vous</span></label>' : ''}
      </div>
      <textarea id="nd-brief" hidden placeholder="Ex. : rendez-vous avec la Menuiserie Dubreuil, 12 salariés à Toulouse. Ils perdent du temps sur les devis et les relances d’impayés. Objectif : montrer Verso et proposer l’audit offert."></textarea>
      <div class="modal-actions"><button class="b" data-close>Annuler</button><button class="b b-primary" id="nd-go">Créer</button></div>`);
    const brief = $('#nd-brief', m.el);
    m.el.addEventListener('change', () => {
      const v = $('input[name="nd-src"]:checked', m.el).value;
      brief.hidden = v !== 'ai';
      $('#nd-go', m.el).textContent = v === 'ai' ? 'Générer' : 'Créer';
      if (v === 'ai') brief.focus();
    });
    $('#nd-go', m.el).addEventListener('click', async () => {
      const src = $('input[name="nd-src"]:checked', m.el).value;
      const title = $('#nd-title', m.el).value.trim();
      const btn = $('#nd-go', m.el);
      try {
        btn.disabled = true;
        if (src === 'template') { m.close(); await createDeck(title || TEMPLATE_DECK.title, clone(TEMPLATE_DECK.slides)); }
        else if (src === 'blank') { m.close(); await createDeck(title, [clone(L.TEMPLATES.hero), clone(L.TEMPLATES.cta)]); }
        else {
          if (brief.value.trim().length < 20) { toast('Décrivez le rendez-vous en une ou deux phrases.', true); btn.disabled = false; return; }
          btn.textContent = 'Claude rédige le deck…';
          const out = await generateDeck(brief.value.trim());
          m.close();
          await createDeck(title && title !== 'Nouvelle présentation' ? title : out.title, out.slides);
          toast('Premier jet prêt : relisez chaque slide avant de l’envoyer.');
        }
      } catch (e) {
        btn.disabled = false;
        btn.textContent = src === 'ai' ? 'Générer' : 'Créer';
        toast(errorText(e), true);
      }
    });
  }
  function layoutPicker() {
    const m = modal(`<h2>Ajouter une slide</h2><p>Elle s’insère après la slide ${S.sel + 1}.</p>
      <div class="layout-grid">${Object.entries(L.LAYOUTS).map(([k, v]) => `
        <button class="layout-card" data-pick="${k}"><div class="thumb" data-tpl="${k}"></div><b>${esc(v.name)}</b><small>${esc(v.desc)}</small></button>`).join('')}</div>
      <div class="modal-actions"><button class="b" data-close>Annuler</button></div>`, { wide: true });
    $$('[data-tpl]', m.el).forEach((el) => mountThumb(el, L.TEMPLATES[el.dataset.tpl], 0, 1, {}));
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      m.close();
      const at = S.deck.slides.length ? S.sel + 1 : 0;
      mutate((sl) => sl.splice(at, 0, clone(L.TEMPLATES[b.dataset.pick])), { sel: at });
    });
  }

  // ——— Claude ———
  const errorText = (e) => {
    const c = e && e.code;
    if (c === 'not_granted') return 'Claude n’est pas autorisé sur cette page.';
    if (c === 'rate_limited') return 'Trop de demandes d’affilée : réessayez dans une minute.';
    if (c === 'invalid_json') return 'La réponse de Claude n’était pas exploitable. Reformulez la consigne.';
    if (c === 'cancelled') return 'Demande annulée.';
    return (e && e.message) || 'Une erreur est survenue.';
  };
  const CONTEXT = `Coreshift (Toulouse) met l'IA au travail dans les TPE et PME : une plateforme de gestion avec Verso, l'assistante propulsée par Mistral AI ; un cabinet de conseil (audit offert, conformité AI Act, formation, feuille de route) ; TwinsAI, des jumeaux numériques du savoir-faire. Faits publics utilisables : 9 € par utilisateur et par mois IA incluse, essai de 14 jours sans carte, 30 minutes pour ouvrir son compte, prévision de trésorerie à 90 jours, base de données à Paris, données isolées par entreprise, intégrateur Mistral AI.`;
  const RULES = `Règles d'écriture : français, phrases courtes et concrètes, vouvoiement. Dans les titres, entourez 1 à 4 mots d'astérisques (*mot*) pour les passer en orange. N'inventez aucun chiffre, client ni témoignage présentés comme réels : utilisez seulement les chiffres du brief ou les faits publics ci-dessus ; une courbe ou un exemple d'interface porte le tag "Exemple".`;
  async function generateDeck(brief) {
    const schema = Object.entries(L.TEMPLATES).map(([k, t]) => `- "${k}" (${L.LAYOUTS[k].name} : ${L.LAYOUTS[k].desc}) : ${JSON.stringify(t)}`).join('\n');
    const prompt = `Tu prépares une présentation commerciale Coreshift à partir d'un brief.\n\n${CONTEXT}\n\n${RULES}\n\nGabarits disponibles, avec un exemple de contenu pour chacun (reprends exactement les mêmes clés) :\n${schema}\n\nConstruis 6 à 10 slides : la première "hero", la dernière "cta", au plus une "punchline", des gabarits variés. Le champ "bg" vaut l'un de : ${Object.keys(L.BACKGROUNDS).join(', ')}. Le champ "theme" vaut "dark" ou "light" (au plus deux slides "light").\n\nRéponds uniquement avec un objet JSON de la forme {"title": "...", "slides": [ ... ]}.\n\nBrief :\n${brief}`;
    const out = await caps.sample.json(prompt, { modelTier: 'default' });
    const slides = Array.isArray(out?.slides) ? out.slides.filter((s) => s && L.LAYOUTS[s.layout]) : [];
    if (!slides.length) throw new Error('Claude n’a pas renvoyé de slides exploitables. Précisez le brief.');
    return { title: String(out.title || 'Nouvelle présentation'), slides };
  }
  async function rewriteSlide(instr) {
    const s = S.deck.slides[S.sel];
    const prompt = `Tu modifies une slide d'une présentation Coreshift.\n\n${CONTEXT}\n\n${RULES}\n\nConsigne : ${instr}\n\nGarde le gabarit "${s.layout}" et exactement les mêmes clés ; tu peux changer le nombre d'éléments d'une liste. Réponds uniquement avec l'objet JSON de la slide modifiée.\n\nSlide actuelle :\n${JSON.stringify(s)}`;
    const out = await caps.sample.json(prompt, { modelTier: 'default' });
    if (!out || typeof out !== 'object' || Array.isArray(out)) throw new Error('Réponse inattendue de Claude.');
    const next = { ...out, layout: s.layout };
    for (const k of ['section', 'bg', 'theme', 'duration']) if (s[k] !== undefined && out[k] === undefined) next[k] = s[k];
    mutate((sl) => { sl[S.sel] = next; });
  }

  // ——— Présentation ———
  let idleTimer = 0;
  function present(deck, start = 0) {
    const n = deck.slides.length;
    if (!n) return toast('Ce deck n’a pas encore de slide.', true);
    hideFmt();
    const ov = $('#present');
    const stage = $('#p-stage');
    stage.className = '';
    stage.innerHTML = `<div class="chrome-live theme-dark"><div class="brand">${L.logo()}<span>Coreshift</span></div><div class="chrome-meta"><span class="chrome-section"></span><span class="chrome-num"></span></div></div><div class="progress"><i></i></div>`
      + deck.slides.map((s, i) => safeRender(s, i, n, deck)).join('');
    ov.hidden = false;
    const count = $('#p-count');
    S.player = P.createPlayer({
      viewport: $('#p-viewport'), stage, canvas: $('#p-bg'),
      slides: $$('.slide', stage), metas: deck.slides.map(L.slideMeta),
      start: clamp(start, 0, n - 1), controls: true, input: ov, fullscreenTarget: ov,
      onExit: closePresent,
      onChange: (i) => { count.textContent = `${i + 1} / ${n}`; },
    });
    ov.requestFullscreen?.().catch(() => {});
    wakeUI();
  }
  function wakeUI() {
    const ui = $('.p-ui');
    ui.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ui.classList.add('idle'), 2500);
  }
  function closePresent() {
    if (!S.player) return;
    S.player.destroy();
    S.player = null;
    $('#p-stage').innerHTML = '';
    $('#present').hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  $('#present').addEventListener('mousemove', wakeUI);
  $('#present').addEventListener('touchstart', wakeUI, { passive: true });

  // ——— Exports ———
  const fileBase = (t) => (String(t || 'presentation').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'presentation');
  async function saveFile(filename, data) {
    if (caps.downloads) {
      try { await caps.downloads.save({ filename, data }); toast('Fichier enregistré.'); }
      catch (e) { if (e && e.code !== 'declined') toast(`Enregistrement impossible (${e.code || e.message}).`, true); }
      return;
    }
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  async function exportPDF(light) {
    const deck = S.deck;
    const n = deck.slides.length;
    if (!n) return toast('Ajoutez au moins une slide.', true);
    const pg = progressBox(light ? 'PDF clair' : 'PDF');
    const root = $('#export-root');
    try {
      const [h2i, jsp] = await Promise.all([lib('htmlToImage'), lib('jspdf')]);
      const pdf = new jsp.jsPDF({ orientation: 'landscape', unit: 'px', format: [1920, 1080], hotfixes: ['px_scaling'], compress: true });
      let fontCSS = null;
      for (let i = 0; i < n; i++) {
        pg.set(i, n);
        let s = deck.slides[i];
        if (light && L.slideMeta(s).theme === 'dark') s = { ...s, theme: 'light' };
        const meta = L.slideMeta(s);
        root.innerHTML = `<div class="deck-static">${meta.theme === 'accent' ? '' : `<img class="bg-static" alt="" src="${P.backgroundURL(meta, i, { width: 1920, height: 1080, quality: 0.86 })}">`}${safeRender(s, i, n, deck)}</div>`;
        const node = root.firstElementChild;
        const img = $('img', node);
        if (img) await img.decode().catch(() => {});
        if (fontCSS === null) fontCSS = await h2i.getFontEmbedCSS(node).catch(() => '');
        const url = await h2i.toJpeg(node, {
          width: 1920, height: 1080, pixelRatio: 1, quality: 0.9, cacheBust: false,
          backgroundColor: meta.theme === 'light' ? '#f2f1ef' : '#14110e',
          ...(fontCSS ? { fontEmbedCSS: fontCSS } : {}),
        });
        if (i) pdf.addPage([1920, 1080], 'landscape');
        pdf.addImage(url, 'JPEG', 0, 0, 1920, 1080, undefined, 'FAST');
        await new Promise((r) => setTimeout(r, 0));
      }
      pg.set(n, n, 'Enregistrement du fichier…');
      await saveFile(`${fileBase(deck.title)}${light ? '-clair' : ''}.pdf`, pdf.output('blob'));
    } catch (e) {
      toast('L’export PDF a échoué : ' + errorText(e), true);
    } finally {
      root.innerHTML = '';
      pg.close();
    }
  }
  function standaloneHTML(deck) {
    const n = deck.slides.length;
    const css = $('#deck-css').textContent;
    const js = $('#deck-runtime').textContent;
    const slides = deck.slides.map((s, i) => safeRender(s, i, n, deck)).join('\n');
    const data = JSON.stringify({ title: deck.title, slides: deck.slides.map(L.slideMeta) }).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(deck.title)}</title>
<style>${css}</style>
</head>
<body>
<canvas id="bg" aria-hidden="true"></canvas>
<div id="viewport">
<main id="stage">
  <div class="chrome-live theme-dark"><div class="brand">${L.logo()}<span>Coreshift</span></div><div class="chrome-meta"><span class="chrome-section"></span><span class="chrome-num"></span></div></div>
  <div class="progress"><i></i></div>
${slides}
</main>
</div>
<div class="hint">← → naviguer · F plein écran · Ctrl+P pour un PDF</div>
<div class="rotate">Tournez le téléphone pour agrandir</div>
<script type="application/json" id="deck-data">${data}<\/script>
<script>${js}<\/script>
</body>
</html>`;
  }

  // ——— Actions ———
  document.addEventListener('click', async (e) => {
    const pop = $('#export-pop');
    if (pop && !pop.hidden && !e.target.closest('.menu')) { pop.hidden = true; $('[data-act="export-menu"]')?.setAttribute('aria-expanded', 'false'); }
    const t = e.target.closest('[data-act]');
    if (!t || t.closest('.scrim') && !t.closest('.modal')) return;
    const act = t.dataset.act;
    const id = t.dataset.id;
    const i = t.dataset.i != null ? +t.dataset.i : null;
    switch (act) {
      case 'new-deck': return newDeckDialog();
      case 'quick-template': return createDeck(TEMPLATE_DECK.title, clone(TEMPLATE_DECK.slides)).catch((err) => toast(errorText(err), true));
      case 'open': return openDeck(id);
      case 'present': {
        const d = S.decks.find((x) => x.id === id);
        return d && present(normalize(d), 0);
      }
      case 'dup-deck': {
        const d = S.decks.find((x) => x.id === id);
        if (!d) return;
        const id2 = Store.newId(), now = Date.now();
        const body = { title: `${d.title} (copie)`, slides: clone(d.slides || []), createdAt: now, updatedAt: now };
        return Store.save(id2, body).then(() => toast('Deck dupliqué.')).catch((err) => toast(errorText(err), true));
      }
      case 'del-deck': {
        const d = S.decks.find((x) => x.id === id);
        if (!d || !(await confirmBox('Supprimer ce deck ?', `« ${d.title} » sera supprimé pour toute l’équipe. Cette action est définitive.`, 'Supprimer'))) return;
        return Store.remove(id).then(() => toast('Deck supprimé.')).catch((err) => toast(errorText(err), true));
      }
      case 'home': return goLibrary();
      case 'undo': return undo();
      case 'select': return select(i);
      case 'add-slide': return layoutPicker();
      case 'move-up': return i > 0 && mutate((sl) => sl.splice(i - 1, 0, ...sl.splice(i, 1)), { sel: i - 1 });
      case 'move-down': return i < S.deck.slides.length - 1 && mutate((sl) => sl.splice(i + 1, 0, ...sl.splice(i, 1)), { sel: i + 1 });
      case 'dup-slide': return mutate((sl) => sl.splice(i + 1, 0, clone(sl[i])), { sel: i + 1 });
      case 'del-slide':
        if (!(await confirmBox('Supprimer cette slide ?', `La slide ${i + 1} sera retirée du deck. « Annuler » permet de la récupérer.`, 'Supprimer'))) return;
        return mutate((sl) => sl.splice(i, 1), { sel: Math.max(0, i - (i >= S.deck.slides.length - 1 ? 1 : 0)) });
      case 'theme': return mutate((sl) => { if (t.dataset.v === 'dark') delete sl[S.sel].theme; else sl[S.sel].theme = t.dataset.v; });
      case 'toggle-insp': return $('#inspector')?.classList.toggle('open');
      case 'export-menu': {
        const p = $('#export-pop');
        p.hidden = !p.hidden;
        t.setAttribute('aria-expanded', String(!p.hidden));
        return;
      }
      case 'export-pdf': case 'export-pdf-light':
        $('#export-pop').hidden = true;
        await saveNow();
        return exportPDF(act === 'export-pdf-light');
      case 'export-html':
        $('#export-pop').hidden = true;
        return saveFile(`${fileBase(S.deck.title)}.html`, standaloneHTML(S.deck));
      case 'export-json':
        $('#export-pop').hidden = true;
        return saveFile(`${fileBase(S.deck.title)}.json`, JSON.stringify({ title: S.deck.title, brand: 'Coreshift', slides: S.deck.slides }, null, 2));
      case 'present-current': await saveNow(); return present(S.deck, S.sel);
      case 'p-prev': return S.player?.prev();
      case 'p-next': return S.player?.next();
      case 'p-exit': return closePresent();
      case 'ai-slide': {
        const box = $('#ai-slide');
        const instr = box?.value.trim();
        if (!instr) return toast('Écrivez une consigne pour Claude.', true);
        t.disabled = true;
        t.textContent = 'Claude réécrit la slide…';
        try { await rewriteSlide(instr); toast('Slide réécrite. « Annuler » revient à la version précédente.'); }
        catch (err) { toast(errorText(err), true); t.disabled = false; t.textContent = 'Réécrire la slide'; }
        return;
      }
    }
  });

  // Raccourcis de l'éditeur (hors saisie de texte).
  document.addEventListener('keydown', (e) => {
    if (S.view !== 'editor' || S.player || $('.scrim')) return;
    const tgt = e.target;
    const typing = tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName);
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && !typing) { e.preventDefault(); undo(); }
    else if (!typing && (e.key === 'ArrowDown' || e.key === 'PageDown')) { e.preventDefault(); select(S.sel + 1); }
    else if (!typing && (e.key === 'ArrowUp' || e.key === 'PageUp')) { e.preventDefault(); select(S.sel - 1); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && S.dirty) saveNow(); });

  // ——— Démarrage ———
  async function start() {
    renderLibrary();
    await initCaps();
    if (caps.user) {
      try { if ((await caps.user.can('data.write')) === false) S.readOnly = true; } catch {}
    }
    Store.init();
    lib('jsyaml').catch(() => {});
  }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(start);
})();
