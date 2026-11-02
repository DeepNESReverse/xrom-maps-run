// How hard a maps page works while its run plays, on a machine like an old PC: Chromium with no GPU
// (everything drawn by the CPU), the page's main thread slowed down, a trace of what the browser did.
//   node bench/bench.mjs <url> [--zoom 2] [--seconds 6] [--throttle 4] [--css '<rules>'] [--label name]
// Prints the frames per second the page got and, per second of play, the milliseconds the browser
// spent scripting, on style and layout, painting and rasterising (from the trace).
import { createRequire } from 'node:module';
const require = createRequire('/Users/alex.m/battletoads_mega_hack copy/battletoads-tools-next/package.json');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const url = args[0];
const zoom = opt('--zoom', '2'), seconds = Number(opt('--seconds', '6')), throttle = Number(opt('--throttle', '4'));
const css = opt('--css', ''), label = opt('--label', 'baseline');

const browser = await chromium.launch({ args: ['--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer=false', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: 'load' });
if (css) await page.addStyleTag({ content: css });
await page.waitForTimeout(800);
await page.evaluate((z) => {
  document.querySelector(`[data-z="${z}"]`).click();
  document.getElementById('tkSound').checked = false;
}, zoom);
await page.click('#tkPlay');
await page.waitForTimeout(1500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
const events = [];
cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,viz,blink', transferMode: 'ReportEvents' });
const fps = await page.evaluate(async (secs) => {
  let n = 0, on = true;
  const step = () => { n++; if (on) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  await new Promise((r) => setTimeout(r, secs * 1000));
  on = false;
  return n / secs;
}, seconds);
await cdp.send('Tracing.end');
await done;
const sum = {};
const add = (k, d) => (sum[k] = (sum[k] ?? 0) + d / 1000);
const kinds = {
  script: ['FunctionCall', 'FireAnimationFrame', 'TimerFire', 'EvaluateScript'],
  style: ['UpdateLayoutTree', 'RecalculateStyles', 'Layout', 'UpdateLayer', 'PrePaint'],
  paint: ['Paint', 'PaintImage', 'Layerize', 'Commit'],
  raster: ['RasterTask', 'TileManager::RunTask', 'ImageDecodeTask', 'GpuRasterization', 'RasterizerTaskImpl::RunOnWorkerThread'],
};
for (const e of events) {
  if (e.ph !== 'X' || !e.dur) continue;
  for (const [k, names] of Object.entries(kinds)) if (names.includes(e.name)) add(k, e.dur);
}
const per = (k) => ((sum[k] ?? 0) / seconds).toFixed(0).padStart(4);
console.log(`${label.padEnd(22)} fps ${fps.toFixed(0).padStart(3)} | ms per second: script ${per('script')}  style+layout ${per('style')}  paint ${per('paint')}  raster ${per('raster')}`);
await browser.close();
