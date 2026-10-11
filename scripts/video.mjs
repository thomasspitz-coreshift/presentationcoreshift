// Exporte la présentation en vidéo MP4, image par image (rendu fluide et identique à chaque export).
// Usage : npm run video [-- <nom>] [--fps=30] [--scale=1]   (--scale=0.5 : aperçu rapide en 960×540)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { build, deckName } from './build.mjs';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? Number(a.split('=')[1]) : d;
};
const name = deckName();
const fps = arg('fps', 30);
const scale = arg('scale', 1);
const { out } = await build(name);

const W = Math.round(1920 * scale), H = Math.round(1080 * scale);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(pathToFileURL(out).href + '?capture');
await page.waitForFunction(() => window.__deckReady === true, null, { timeout: 60_000 });

const mp4 = path.join(path.dirname(out), `${name}.mp4`);
const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const ffDone = new Promise((res, rej) => ff.on('close', (c) => (c ? rej(new Error(`ffmpeg ${c}`)) : res())));

const step = 1000 / fps;
const tail = Math.round(fps * 1.5); // garde la dernière slide 1,5 s de plus
let frames = 0, extra = -1;
const t0 = Date.now();
while (extra !== 0) {
  const done = await page.evaluate((ms) => window.__deck.advance(ms), step);
  if (done && extra < 0) extra = tail;
  if (extra > 0) extra--;
  const jpg = await page.screenshot({ type: 'jpeg', quality: 92 });
  if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
  frames++;
  if (frames % (fps * 5) === 0) process.stdout.write(`\r… ${(frames / fps).toFixed(0)} s rendues`);
}
ff.stdin.end();
await ffDone;
await browser.close();

const size = fs.statSync(mp4).size;
console.log(`\r✓ Vidéo → ${path.relative(process.cwd(), mp4)} (${(frames / fps).toFixed(1)} s, ${(size / 1024 / 1024).toFixed(1)} Mo, rendue en ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
