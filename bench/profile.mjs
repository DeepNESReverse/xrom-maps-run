// Where a maps page's script time goes while its run plays: the CPU profile's self time by function.
//   node bench/profile.mjs <url> [--zoom 2] [--seconds 5]
import { createRequire } from 'node:module';
const require = createRequire('/Users/alex.m/battletoads_mega_hack copy/battletoads-tools-next/package.json');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const url = args[0], zoom = opt('--zoom', '2'), seconds = Number(opt('--seconds', '5'));
const browser = await chromium.launch({ args: ['--disable-gpu', '--disable-gpu-compositing'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(800);
await page.evaluate((z) => { document.querySelector(`[data-z="${z}"]`).click(); document.getElementById('tkSound').checked = false; }, zoom);
await page.click('#tkPlay');
await page.waitForTimeout(1500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await page.waitForTimeout(seconds * 1000);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const dt = new Map();
profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
for (const n of profile.nodes) {
  const f = n.callFrame;
  const key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-1)[0]}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt.get(n.id) ?? 0) / 1000);
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
for (const [k, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`${(ms / seconds).toFixed(1).padStart(6)} ms/s  ${k}`);
console.log(`total ${(total / seconds).toFixed(0)} ms/s sampled`);
await browser.close();
