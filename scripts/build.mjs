// Construit une présentation : decks/<nom>/deck.yaml → dist/<nom>/index.html (fichier unique, autonome).
// Usage : npm run build [-- <nom>] [--watch]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load as loadYaml } from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export function deckName(argv = process.argv.slice(2)) {
  return argv.find((a) => !a.startsWith('--')) || 'coreshift-demo';
}

export function fontFaces() {
  const files = [
    ['Geist', 400, '@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff2'],
    ['Geist', 500, '@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff2'],
    ['Geist', 600, '@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2'],
    ['Geist Mono', 400, '@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2'],
    ['Geist Mono', 500, '@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2'],
    ['Geist Mono', 600, '@fontsource/geist-mono/files/geist-mono-latin-600-normal.woff2'],
  ];
  return files
    .map(([family, weight, file]) => {
      const b64 = fs.readFileSync(require.resolve(file)).toString('base64');
      return `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
    })
    .join('\n');
}

export async function build(name) {
  // deck.yaml (écrit à la main) ou deck.json (exporté depuis le studio).
  const deckFile = ['deck.yaml', 'deck.json'].map((f) => path.join(ROOT, 'decks', name, f)).find((f) => fs.existsSync(f));
  if (!deckFile) throw new Error(`Introuvable : decks/${name}/deck.yaml ou deck.json`);
  const deck = loadYaml(fs.readFileSync(deckFile, 'utf8'));

  // Import frais à chaque build pour que --watch prenne en compte les gabarits modifiés.
  const { renderSlide, slideMeta, logo } = await import(
    pathToFileURL(path.join(ROOT, 'engine', 'layouts.mjs')).href + `?t=${Date.now()}`
  );
  const css = fs.readFileSync(path.join(ROOT, 'engine', 'theme.css'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'engine', 'runtime.js'), 'utf8');

  const total = deck.slides.length;
  const html = deck.slides.map((s, index) => renderSlide(s, { index, total, deck })).join('\n');
  const data = JSON.stringify({ title: deck.title, slides: deck.slides.map(slideMeta) }).replace(/</g, '\\u003c');
  const title = String(deck.title || name).replace(/</g, '&lt;');

  const page = `<!doctype html>
<html lang="${deck.lang || 'fr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${String(deck.description || '').replace(/"/g, '&quot;')}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(logo().replace('class="logo "', 'xmlns="http://www.w3.org/2000/svg" color="#14110e"'))}">
<style>
${fontFaces()}
${css}
</style>
</head>
<body>
<canvas id="bg" aria-hidden="true"></canvas>
<div id="viewport">
<main id="stage">
  <div class="chrome-live theme-dark"><div class="brand">${logo()}<span>${deck.brand || 'Coreshift'}</span></div><div class="chrome-meta"><span class="chrome-section"></span><span class="chrome-num"></span></div></div>
  <div class="progress"><i></i></div>
${html}
</main>
</div>
<div class="hint">← → naviguer · F plein écran</div>
<div class="rotate">Tournez le téléphone pour agrandir</div>
<script type="application/json" id="deck-data">${data}</script>
<script>
${js}
</script>
</body>
</html>
`;

  const outDir = path.join(ROOT, 'dist', name);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'index.html');
  fs.writeFileSync(out, page);
  return { out, total, bytes: Buffer.byteLength(page) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const name = deckName();
  const run = async () => {
    try {
      const r = await build(name);
      console.log(`✓ ${r.total} slides → ${path.relative(ROOT, r.out)} (${(r.bytes / 1024).toFixed(0)} Ko)`);
    } catch (e) {
      console.error('✗', e.message);
      if (!process.argv.includes('--watch')) process.exit(1);
    }
  };
  await run();
  if (process.argv.includes('--watch')) {
    console.log('… surveillance de decks/ et engine/ (Ctrl+C pour arrêter)');
    let timer;
    for (const dir of ['decks', 'engine']) {
      fs.watch(path.join(ROOT, dir), { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(run, 120);
      });
    }
  }
}
