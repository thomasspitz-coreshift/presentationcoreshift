// Construit le studio Coreshift Slides.
//   dist/studio/studio.html  page à publier comme artefact claude.ai (bibliothèques chargées depuis les CDN autorisés)
//   dist/studio/index.html   studio autonome, utilisable hors ligne : decks gardés dans le navigateur
// Usage : npm run studio
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import { fontFaces } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const CDN = {
  jsyaml: 'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  htmlToImage: 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js',
};
const LOCAL_LIBS = [
  'js-yaml/dist/browser/js-yaml.umd.min.js',
  'jspdf/dist/jspdf.umd.min.js',
  'html-to-image/dist/html-to-image.js',
];

// Un script en ligne ne doit jamais contenir « </script » tel quel.
const inline = (js, id) => `<script${id ? ` id="${id}"` : ''}>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`;

export async function buildStudio() {
  // Les gabarits sont un module ES : on les transforme en script classique pour le navigateur.
  const layouts = read('engine/layouts.mjs').replace(/^export (const|function) /gm, '$1 ');
  const layoutsJS = `window.CoreshiftLayouts = (function () {\n${layouts}\nreturn { layouts, LAYOUTS, BACKGROUNDS, TEMPLATES, renderSlide, slideMeta, rich, logo, fmt };\n})();`;
  const demo = loadYaml(read('decks/coreshift-demo/deck.yaml'));
  const template = { title: 'Présentation Coreshift', slides: demo.slides };

  // Vérifie que les gabarits se chargent tels qu'ils seront servis.
  const { renderSlide, TEMPLATES } = await import(pathToFileURL(path.join(ROOT, 'engine', 'layouts.mjs')).href + `?t=${Date.now()}`);
  for (const t of Object.values(TEMPLATES)) renderSlide(t, { index: 0, total: 1, deck: {} });

  const markup = `
<div id="app"></div>
<div id="present" hidden>
  <div id="p-viewport"><canvas id="p-bg" aria-hidden="true"></canvas><div id="p-stage"></div></div>
  <div class="p-ui" data-player-ui>
    <button data-act="p-prev" aria-label="Slide précédente">←</button>
    <span class="mono" id="p-count"></span>
    <button data-act="p-next" aria-label="Slide suivante">→</button>
    <button data-act="p-exit" aria-label="Quitter la présentation">✕</button>
  </div>
</div>
<div id="export-root" aria-hidden="true"></div>`;

  const styles = `<style id="deck-css">\n${fontFaces()}\n${read('engine/theme.css')}\n</style>\n<style id="studio-css">\n${read('studio/studio.css')}\n</style>`;
  const scripts = (libs) => [
    inline("document.body.classList.add('studio');"),
    inline(`window.STUDIO_LIBS = ${JSON.stringify(libs ? {} : CDN)};`),
    ...(libs || []).map((js) => inline(js)),
    inline(read('engine/runtime.js'), 'deck-runtime'),
    inline(layoutsJS),
    inline(`window.CORESHIFT_TEMPLATE_DECK = ${JSON.stringify(template).replace(/</g, '\\u003c')};`),
    inline(read('studio/studio.js')),
  ].join('\n');

  const outDir = path.join(ROOT, 'dist', 'studio');
  fs.mkdirSync(outDir, { recursive: true });

  // Version artefact : pas de doctype ni de <head>, la plateforme les ajoute.
  const fragment = `<title>Coreshift Slides</title>\n${styles}\n${markup}\n${scripts(null)}\n`;
  fs.writeFileSync(path.join(outDir, 'studio.html'), fragment);

  // Version autonome : bibliothèques intégrées, fonctionne sans connexion.
  // Lecture directe dans node_modules : certains paquets n'exportent pas leur build navigateur.
  const libs = LOCAL_LIBS.map((p) => fs.readFileSync(path.join(ROOT, 'node_modules', p), 'utf8'));
  const full = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Coreshift Slides</title>
${styles}
</head>
<body class="studio">
${markup}
${scripts(libs)}
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'index.html'), full);
  return { fragment: Buffer.byteLength(fragment), full: Buffer.byteLength(full) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await buildStudio();
  console.log(`✓ Studio → dist/studio/studio.html (${(r.fragment / 1024).toFixed(0)} Ko, artefact) et dist/studio/index.html (${(r.full / 1024).toFixed(0)} Ko, hors ligne)`);
}
