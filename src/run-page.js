// The page around a game's level maps with a run played over them — one for every game.
//
// It builds the page and runs the run: the header (prev / the level list / next, zoom, the run bar,
// the run's path, the game's own switches), the map with the game's frame laid on it at the camera,
// full screen with the run bar alone, the view following the camera, the sound with music and
// effects apart. The game gives an adapter for its run and whatever layers and switches are its own.
// First made for Alien 3 (~/alien3-levels, its page as it was is the model) and Circus Charlie.
//
//   import { mountRunPage } from '…/maps-run/src/run-page.js';
//   const page = mountRunPage({
//     title: 'Alien 3', levelWord: 'level',
//     levels: [{ n: 1, label: 'Level 1' }, …],
//     image: (n) => `01.png`,                    // the map of level n
//     field: { w: 256, h: 176 },                 // the game's frame on the map, in map pixels
//     run: adapter,                              // below
//     trail: { url, label, title, shift },       // the run's path: { levels: { n: { segments, frames } } }
//     runTitle, soundTitle, musicTitle, effectsTitle,   // tooltips of the run bar
//     headerHtml, layersBelow, layersAbove, afterStage, css,   // the game's own parts
//     onPick(n), onZoom(), onMouse(x, y),        // the game's hooks
//   });
//
// The adapter:
//   load(): Promise<{ frames, spans: [[n, first, last], …] }>  — n the level as listed; a span the
//           frames the level is shown on (between spans the page shows no frame)
//   seek(f)           the state after frame f (anew)          apply(f)   frame f over the state of f-1
//   draw(f, ctx)      draws the frame into `ctx` (the field's size) → { x, y } where its top-left
//                     corner lies on the map, in map pixels
//   writesOf(f, each) the frame's sound-chip writes: each(address $4000-$4017, value, owner) with
//                     owner $40 the music's, $80 an effect's, 0 both's
//   memory(address)   (optional) a CPU byte for the DMC's samples
//   onFrame(f)        (optional) after each drawn frame — the game's own layers
//
// The sound: a frame's writes, then a frame of samples through @xromdev/apu (`apu` in the config:
// { Apu, mixApu, OutputFilters }), an AudioWorklet (`soundWorklet`: the URL of sound.js beside this
// file) playing the blocks. Only at ×1; after a seek or a change of speed the 3 s before are run
// through the chip silently so it stands as it would — first given the last $4015/$4017 the run
// wrote before them (a game may switch the channels on once, at power-on: Circus Charlie, frame 4).
// A write whose owner is switched off is dropped and its channel silenced once, so that a note the
// other owner left on it does not hang.

const HZ = 60.0988;

const CSS = `
:root{color-scheme:dark}body{margin:0;background:#111;color:#ddd;font:14px system-ui,sans-serif}
header{position:sticky;top:0;background:#1b1b1b;padding:8px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;z-index:2;border-bottom:1px solid #333}
button,select{background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 10px;cursor:pointer;font:inherit}button.on{background:#3d5a80;border-color:#5b7fb0}button:disabled{opacity:.4;cursor:default}
#lvlNav{display:flex;gap:4px;align-items:center}
#wrap{overflow:auto;height:calc(100vh - var(--head,50px))}
/* Full screen: the map alone, the run's controls in a bar at the bottom that hides while the mouse rests */
html:fullscreen #wrap{height:100vh}
html:fullscreen header{position:fixed;top:auto;bottom:0;left:0;right:0;justify-content:center;background:#1b1b1bd9;border:0;border-top:1px solid #333;padding:8px 64px 8px 12px;transition:opacity .3s}
html:fullscreen header>:not(#tkBar){display:none!important}
html:fullscreen #tkBar{border:0}html:fullscreen #tkSeek{width:min(40vw,520px)!important}
html:fullscreen.idle header,html:fullscreen.idle #fsBtn{opacity:0}html:fullscreen.idle{cursor:none}
#fsBtn{position:fixed;right:14px;bottom:14px;z-index:3;width:34px;height:34px;padding:0;display:grid;place-items:center;opacity:.75}#fsBtn:hover{opacity:1}#stage{position:relative}
#stage img{display:block;image-rendering:pixelated;position:absolute;left:0;top:0}
#live{position:absolute;image-rendering:pixelated;pointer-events:none;outline:2px solid #fff8;box-shadow:0 0 12px #000;display:none}
#trail{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
#trail polyline{fill:none;stroke:#b48cff;stroke-width:2.5;stroke-linejoin:round;vector-effect:non-scaling-stroke;filter:drop-shadow(0 0 1px #000)}
#pos{font-variant-numeric:tabular-nums;color:#aaa}
.legend{color:#888}
`;

const label = (id, title, inner) => `<label style="display:flex;gap:4px;align-items:center"${title ? ` title="${title}"` : ''}>${inner}</label>`;

export function mountRunPage(cfg) {
  const word = cfg.levelWord ?? 'level';
  const Word = word[0].toUpperCase() + word.slice(1);
  const style = document.createElement('style');
  style.textContent = CSS + (cfg.css ?? '');
  document.head.append(style);
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<header>
<span id="lvlNav"><button id="prevLvl" title="The ${word} before">◀ prev</button><select id="lvl">${cfg.levels.map((l) => `<option value="${l.n}">${l.label}</option>`).join('')}</select><button id="nextLvl" title="The ${word} after">next ▶</button></span>
<span>Zoom:</span><button data-z="0.25">¼</button><button data-z="0.5">½</button><button data-z="1" class="on">1×</button><button data-z="2">2×</button><button data-z="fitw" title="The ${word}'s width in the window">fit width</button><button data-z="fith" title="The ${word}'s height in the window">fit height</button>
<span id="tkBar" style="display:flex;gap:6px;align-items:center;border:1px solid #444;border-radius:6px;padding:2px 8px"${cfg.runTitle ? ` title="${cfg.runTitle}"` : ''}>
 <button id="tkPlay">▶</button>
 <select id="tkSpeed"><option value="1">×1</option><option value="4">×4</option><option value="16">×16</option></select>
 <input type="range" id="tkSeek" min="0" max="1" value="0" style="width:200px">
 ${label('', '', '<input type="checkbox" id="tkFollow" checked> follow')}
 ${label('', cfg.soundTitle, '<input type="checkbox" id="tkSound" checked> sound <input type="range" id="tkVol" min="0" max="1" step="0.05" value="0.6" style="width:60px">')}
 ${label('', cfg.musicTitle, '<input type="checkbox" id="tkMusic" checked> music')}
 ${label('', cfg.effectsTitle, '<input type="checkbox" id="tkEffects" checked> effects')}
 <span id="tkLabel" class="legend"></span></span>
${cfg.trail ? `<label style="display:flex;gap:6px;align-items:center;cursor:pointer"${cfg.trail.title ? ` title="${cfg.trail.title}"` : ''}><input type="checkbox" id="trailBox" checked> ${cfg.trail.label} <span id="trailN" class="legend"></span></label>` : ''}
${cfg.headerHtml ?? ''}
<span id="pos"></span>
</header>
<button id="fsBtn" title="Full screen (Space plays and pauses the run)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5"/></svg></button>
<div id="wrap"><div id="stage"><img id="iLevel" alt="">${cfg.layersBelow ?? ''}<canvas id="live" width="${cfg.field.w}" height="${cfg.field.h}"></canvas><svg id="trail"></svg>${cfg.layersAbove ?? ''}</div>${cfg.afterStage ?? ''}</div>`,
  );
  const $ = (id) => document.getElementById(id);
  const L = $('iLevel'), st = $('stage'), wrap = $('wrap'), lvl = $('lvl');
  const page = { cur: cfg.levels[0].n, z: 1, pick, zoomed, $ };

  // ------------------------------------------------------------------ the map, zoom, full screen

  function size() { st.style.width = L.naturalWidth * page.z + 'px'; st.style.height = L.naturalHeight * page.z + 'px'; L.style.width = L.naturalWidth * page.z + 'px'; }
  // Zoom: a fixed scale, or "fit width" / "fit height" — the level's width or height in the window,
  // worked out again as the window, the level or full screen change.
  let fit = false;
  const fitZoom = () => { const W = L.naturalWidth || 2048, H = L.naturalHeight || cfg.field.h; return fit === 'fith' ? (wrap.clientHeight - 2) / H : (wrap.clientWidth - 2) / W; };
  function zoomed() { size(); showTrail(); cfg.onZoom?.(); if (data && frame >= 0) draw(); }
  function refit() { if (fit && L.naturalWidth) { const f = fitZoom(); if (f !== page.z) { page.z = f; zoomed(); } } }
  L.onload = () => { if (fit) page.z = fitZoom(); size(); showTrail(); cfg.onZoom?.(); };
  document.querySelectorAll('[data-z]').forEach((b) => (b.onclick = () => {
    fit = b.dataset.z.startsWith('fit') && b.dataset.z;
    page.z = fit ? fitZoom() : +b.dataset.z;
    document.querySelectorAll('[data-z]').forEach((x) => x.classList.toggle('on', x === b));
    zoomed();
  }));
  addEventListener('resize', refit);
  // The map takes the window below the header, however many lines the header wraps to.
  new ResizeObserver(() => { document.documentElement.style.setProperty('--head', document.querySelector('header').offsetHeight + 'px'); refit(); }).observe(document.querySelector('header'));
  $('fsBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  // In full screen the bar and the button fade out after 2.5 s without the mouse moving.
  let idleT = 0;
  const awake = () => { document.documentElement.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (document.fullscreenElement) document.documentElement.classList.add('idle'); }, 2500); };
  addEventListener('mousemove', awake);
  document.addEventListener('fullscreenchange', () => { awake(); $('fsBtn').classList.toggle('on', !!document.fullscreenElement); setTimeout(refit, 50); });
  st.addEventListener('mousemove', (e) => { const r = st.getBoundingClientRect(); cfg.onMouse?.(Math.floor((e.clientX - r.left) / page.z), Math.floor((e.clientY - r.top) / page.z)); });

  // The run's path (cfg.trail.url), fetched when first shown. While the run plays, only the way
  // still ahead of the player. `shift`: what a point's frame is ahead of the run's frame numbers.
  let TRAIL = null;
  async function showTrail() {
    if (!cfg.trail) return;
    const svg = $('trail'), box = $('trailBox'), n = $('trailN');
    if (!box.checked) { svg.innerHTML = ''; n.textContent = ''; return; }
    if (!TRAIL) { try { TRAIL = (await (await fetch(cfg.trail.url, { cache: 'no-store' })).json()).levels; } catch { TRAIL = {}; } }
    const T = TRAIL[page.cur], W = L.naturalWidth || 2048, H = L.naturalHeight || cfg.field.h;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.width = W * page.z + 'px';
    svg.style.height = H * page.z + 'px';
    n.textContent = T ? `(${(T.frames / HZ).toFixed(0)} s)` : '(none)';
    const shift = cfg.trail.shift ?? 0;
    const ahead = (sg) => (data && frame >= 0 && onLevel() ? sg.filter((p) => p[2] - shift >= frame) : sg);
    svg.innerHTML = T ? T.segments.map(ahead).filter((sg) => sg.length > 1).map((sg) => `<polyline points="${sg.map((p) => p[0] + ',' + p[1]).join(' ')}"/>`).join('') : '';
  }
  if (cfg.trail) $('trailBox').onchange = showTrail;

  function pick(n) {
    page.cur = n;
    lvl.value = String(n);
    L.src = cfg.image(n);
    $('prevLvl').disabled = n <= cfg.levels[0].n;
    $('nextLvl').disabled = n >= cfg.levels[cfg.levels.length - 1].n;
    document.title = `${cfg.title} — ${word} ${n}`;
    showTrail();
    cfg.onPick?.(n);
  }
  // Choosing a level — in the list or with prev / next — takes the run, once loaded, to its start.
  function choose(n) {
    pick(n);
    if (!data) return;
    const span = spans.find(([l]) => l === n);
    if (span) seek(span[1]);
  }
  lvl.onchange = () => choose(+lvl.value);
  const step = (d) => { const i = cfg.levels.findIndex((l) => l.n === page.cur) + d; if (cfg.levels[i]) choose(cfg.levels[i].n); };
  $('prevLvl').onclick = () => step(-1);
  $('nextLvl').onclick = () => step(1);

  // ------------------------------------------------------------------ the run

  const run = cfg.run;
  const ui = { play: $('tkPlay'), speed: $('tkSpeed'), seek: $('tkSeek'), label: $('tkLabel'), follow: $('tkFollow') };
  const live = $('live'), ctx = live.getContext('2d');
  let data = null, frames = 0, spans = [], frame = -1, playing = false, debt = 0, last = 0, lastTrail = -1e9;
  const onLevel = () => spans.some(([, a, b]) => frame >= a && frame <= b);

  async function load() {
    ui.label.textContent = 'loading…';
    ({ frames, spans } = await run.load());
    data = true;
    // The channel switches the run writes ($4015/$4017), for a chip brought anew.
    for (let f = 0; f < frames; f++) run.writesOf(f, (a, v) => { if (a === 0x4015 || a === 0x4017) enables.push([f, a, v]); });
    const first = spans.find(([l]) => l === page.cur) ?? spans[0];
    seek(first[1]);
  }
  function seek(f) {
    run.seek(f);
    frame = f;
    soundAt = -1;
    draw();
  }

  function draw() {
    const span = spans.find(([, a, b]) => frame >= a && frame <= b);
    if (!span) {
      // A card, a tally, the menus: the game shows no level now.
      live.style.display = 'none';
      ui.label.textContent = `between ${word}s (frame ${frame})`;
      return;
    }
    const n = span[0];
    // The map follows the level the run is on.
    if (page.cur !== n) pick(n);
    const at = run.draw(frame, ctx);
    const z = page.z;
    window.takeFrame = frame;
    if (frame - lastTrail >= 4 || frame < lastTrail) { lastTrail = frame; showTrail(); }
    live.style.left = at.x * z + 'px';
    live.style.top = at.y * z + 'px';
    live.style.width = cfg.field.w * z + 'px';
    live.style.height = cfg.field.h * z + 'px';
    live.style.display = 'block';
    run.onFrame?.(frame);
    // The slider runs over the level being played, its time from the level's first frame.
    if (ui.seek.min !== String(span[1]) || ui.seek.max !== String(span[2])) { ui.seek.min = String(span[1]); ui.seek.max = String(span[2]); }
    ui.seek.value = String(frame);
    ui.label.textContent = `${word} ${n} · ${((frame - span[1]) / HZ).toFixed(1)} of ${((span[2] - span[1] + 1) / HZ).toFixed(0)} s`;
    // Keep the camera's field in view with room around it: on each axis the field stays inside the
    // middle of the window (a margin of 40 % of the space left over), the view easing after it rather
    // than jumping once the field has reached the edge. A seek or a new level: straight there.
    if (ui.follow.checked) {
      const x = follow(wrap.scrollLeft, wrap.clientWidth, at.x * z, cfg.field.w * z), y = follow(wrap.scrollTop, wrap.clientHeight, at.y * z, cfg.field.h * z);
      if (x !== wrap.scrollLeft || y !== wrap.scrollTop) wrap.scrollTo(x, y);
    }
  }
  /** The scroll on one axis: `at` now, `size` the window, the field from `from`, `span` long. */
  function follow(at, size, from, span) {
    const room = Math.max(0, size - span), margin = room * 0.4;
    if (room === 0) return from + span / 2 - size / 2;
    const lo = from + span + margin - size, hi = from - margin; // the scrolls that keep the margin
    if (at >= lo && at <= hi) return at;
    const want = at < lo ? lo : hi;
    if (Math.abs(want - at) > size) return want;
    // Ease, but never so slowly that the field itself leaves the window.
    const eased = at + (want - at) * 0.2;
    return Math.min(Math.max(eased, from + span - size), from);
  }

  // ------------------------------------------------------------------ the sound

  const enables = [];
  let snd = null, sampleDebt = 0, soundAt = -1;
  async function startAudio() {
    if (snd || !$('tkSound').checked || !cfg.apu) return;
    const context = new AudioContext({ latencyHint: 'interactive' });
    await context.audioWorklet.addModule(cfg.soundWorklet);
    const node = new AudioWorkletNode(context, 'feed', { outputChannelCount: [1] });
    node.connect(context.destination);
    const rate = context.sampleRate, k = Math.ceil(rate / HZ) + 2;
    snd = { context, node, rate, chip: null, filters: null, lv: { pulse1: new Uint8Array(k), pulse2: new Uint8Array(k), triangle: new Uint8Array(k), noise: new Float64Array(k), dmc: new Uint8Array(k) } };
    preroll(frame);
  }
  /** Silenced: the channels (0-3) a dropped write left quiet, until a heard write comes to them. */
  const quiet = new Set();
  function hear(a, v, owner) {
    const music = $('tkMusic').checked, effects = $('tkEffects').checked;
    const ch = (a - 0x4000) >> 2;
    if ((owner === 0x40 && !music) || (owner === 0x80 && !effects)) {
      if (!quiet.has(ch)) { quiet.add(ch); snd.chip.write(0x4000 + ch * 4, ch === 2 ? 0x80 : 0x30); }
      return;
    }
    if (owner) quiet.delete(ch);
    snd.chip.write(a, v);
  }
  const writes = (f, each) => { if (data && f >= 0 && f < frames) run.writesOf(f, each); };
  /** A fresh chip brought to frame f: the channels as the run left them, then the 3 s before, rendered and thrown away. */
  function preroll(f) {
    if (!snd || !data) return;
    const { Apu, OutputFilters } = cfg.apu;
    snd.chip = new Apu(snd.rate, { memory: run.memory ?? (() => 0) });
    snd.filters = new OutputFilters(snd.rate, false);
    const from = Math.max(0, f - 180);
    for (const reg of [0x4017, 0x4015]) { const e = enables.filter(([g, a]) => g < from && a === reg).pop(); if (e) snd.chip.write(reg, e[2]); }
    const per = Math.round(snd.rate / HZ);
    quiet.clear();
    for (let g = from; g <= f; g++) { writes(g, hear); snd.chip.render(per, snd.lv, 0); }
    soundAt = f;
  }
  function soundFrame(f) {
    if (!snd || !snd.chip) return;
    if (!$('tkSound').checked || Number(ui.speed.value) !== 1) { soundAt = -1; return; }
    if (soundAt !== f - 1) preroll(f - 1);
    writes(f, hear);
    sampleDebt += snd.rate / HZ;
    const count = Math.floor(sampleDebt);
    sampleDebt -= count;
    snd.chip.render(count, snd.lv, 0);
    const vol = Number($('tkVol').value), lv = snd.lv, out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = vol * 2.2 * snd.filters.step(cfg.apu.mixApu(lv.pulse1[i], lv.pulse2[i], lv.triangle[i], lv.noise[i], lv.dmc[i]));
    snd.node.port.postMessage(out, [out.buffer]);
    soundAt = f;
  }
  $('tkSound').addEventListener('change', () => { if ($('tkSound').checked) startAudio(); });
  // Switching music or effects back on: the chip brought anew to this frame, so a held note returns.
  for (const id of ['tkMusic', 'tkEffects']) $(id).addEventListener('change', () => { soundAt = -1; });

  // ------------------------------------------------------------------ playing

  function tick(now) {
    if (playing) {
      debt += Math.min(0.25, (now - last) / 1000) * HZ * Number(ui.speed.value);
      while (debt >= 1 && frame < frames - 1) {
        run.apply(++frame);
        soundFrame(frame);
        debt -= 1;
        // Past a level's end (its exit): on to the next level's first frame, the tally and card skipped.
        const ended = spans.findIndex(([, , b]) => frame === b + 1);
        if (ended >= 0 && spans[ended + 1]) { seek(spans[ended + 1][1]); debt = 0; break; }
      }
      if (frame >= frames - 1) { playing = false; ui.play.textContent = '▶'; }
      draw();
    }
    last = now;
    requestAnimationFrame(tick);
  }
  ui.play.onclick = async () => {
    if (!data) await load();
    startAudio();
    // Not on a level (the menus, a card, a tally): straight to the start of the level the page shows.
    if (!onLevel()) {
      const span = spans.find(([l]) => l === page.cur) ?? spans[0];
      seek(span[1]);
    }
    playing = !playing;
    ui.play.textContent = playing ? '⏸' : '▶';
    live.style.display = 'block';
  };
  ui.seek.oninput = () => { if (data) seek(Number(ui.seek.value)); };
  requestAnimationFrame(tick);
  // Space plays and pauses — the only way to in full screen, where the header is hidden.
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.target.closest?.('input, select, textarea')) return;
    e.preventDefault();
    ui.play.click();
  });

  pick(page.cur);
  return page;
}
