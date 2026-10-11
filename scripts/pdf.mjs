// Exporte la présentation en PDF léger : texte vectoriel, polices embarquées, un fond JPEG par slide.
// Usage : npm run pdf [-- <nom>] [--light]   (--light : version claire, pratique pour imprimer)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { build, deckName } from './build.mjs';

const name = deckName();
const light = process.argv.includes('--light');
const { out } = await build(name);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(out).href + (light ? '?print&light' : '?print'));
await page.waitForFunction(() => window.__deckReady === true, null, { timeout: 60_000 });

const pdf = path.join(path.dirname(out), `${name}${light ? '-clair' : ''}.pdf`);
await page.pdf({ path: pdf, width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
await browser.close();

const size = fs.statSync(pdf).size;
console.log(`✓ PDF → ${path.relative(process.cwd(), pdf)} (${(size / 1024 / 1024).toFixed(2)} Mo)`);
