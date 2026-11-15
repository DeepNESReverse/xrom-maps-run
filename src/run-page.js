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
//     levels: [{ n: 1, label: 'Level 1' }, …],    // one level: no prev / list / next
//     image: (n) => `01.png`,                    // the map of level n
//     field: { w: 256, h: 176 },                 // the game's frame on the map, in map pixels
//     zoom: 'fitw',                              // (optional) the zoom it opens with: a button's
//                                                // data-z — 0.25 0.5 1 2 fitw fith; 1 if not given
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
/* The header in two bands: the map's (the level, the zoom, the layers) and the run's (its player) */
header{position:sticky;top:0;z-index:4;background:#151515;border-bottom:1px solid #2a2a2a}
header .row{display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:8px 14px}
button,select{background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}button.on{background:#3d5a80;border-color:#5b7fb0}button:disabled{opacity:.4;cursor:default}
.grp{display:flex;gap:8px;align-items:center}.grp[hidden]{display:none}
.cap{color:#7f8590;font-size:11px;letter-spacing:.1em;text-transform:uppercase}
/* Pills (.seg): the level's ‹ list › and the zoom, in the dark of the layers' round switches */
.seg{display:inline-flex;align-items:center;gap:2px;padding:3px;border:1px solid #3a4150;border-radius:999px;background:#1c2029}
.seg button{border:0;border-radius:999px;background:none;color:#9aa3b5;padding:4px 11px;min-width:30px;display:grid;place-items:center;transition:background .15s,color .15s}
.seg button:hover:not(:disabled){background:#2a3040;color:#fff}
.seg button.on,.seg button.on:hover{background:#dfe4ee;color:#151820}
.seg button svg{width:16px;height:16px}.seg button:disabled{opacity:.3}
.seg .div{width:1px;height:18px;background:#3a4150;margin:0 3px}
#zSlider{width:110px;margin:0 6px;accent-color:#dfe4ee}
.zpct{display:flex;align-items:center;color:#9aa3b5;padding-right:9px;font-variant-numeric:tabular-nums}
#zNum{width:38px;background:none;border:0;border-radius:6px;color:#e6e9ef;text-align:right;font:inherit;padding:2px 2px}
#zNum:hover,#zNum:focus{background:#2a3040;outline:none}
.seg select{appearance:none;-webkit-appearance:none;border:0;background:transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239aa3b5' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") no-repeat right 8px center/12px;color:#e6e9ef;padding:4px 28px 4px 10px;border-radius:999px;font-weight:600}
.seg select:hover{background-color:#2a3040}.seg select option{background:#1c2029;color:#e6e9ef}
/* The run's speed and sound in the same dark pills */
#tkSpeed{appearance:none;-webkit-appearance:none;border:1px solid #3a4150;background:#1c2029 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239aa3b5' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") no-repeat right 8px center/11px;color:#e6e9ef;padding:5px 26px 5px 12px;border-radius:999px}
#tkSpeed:hover,#sndBtn:hover{background-color:#2a3040}#tkSpeed option{background:#1c2029}
#sndBtn{border-radius:999px;border-color:#3a4150;background:#1c2029;color:#cfd4de}
#tkBar input[type=checkbox]{accent-color:#b48cff}
#pos[hidden]{display:none}
/* The run's band, in the purple of its path */
#tkBar{border-top:1px solid #2a2433;background:#19151f;gap:12px}#tkBar[hidden]{display:none}
#tkPlay{display:grid;place-items:center;width:36px;height:36px;padding:0;border-radius:50%;background:#b48cff;color:#160b26;border:0;font-size:15px;flex:none}
#tkPlay:hover{background:#c6a6ff}
#tkPlay.start{display:inline-flex;gap:10px;align-items:baseline;width:auto;height:auto;border-radius:8px;padding:8px 18px;font-size:15px;font-weight:600}
#tkPlay .sub{font-weight:400;opacity:.7;font-size:13px}
#tkTime{font-variant-numeric:tabular-nums;color:#cfc8dc;white-space:nowrap}
#tkSeek{flex:1;min-width:120px;accent-color:#b48cff}
#tkBar.idle #tkTime,#tkBar.idle #tkSeek,#tkBar.idle .more{opacity:.4}
/* A pop-up under a small button (.pop > .popBtn + .popBody): settings that must not move the header */
.pop{position:relative;display:inline-flex}.popBtn{display:grid;place-items:center;width:34px;height:30px;padding:0}.popBtn svg{width:18px;height:18px}
.popBtn.small{width:24px;height:24px;border-color:#3a3a3a;background:#1d1d1d;color:#8f97a6}.popBtn.small svg{width:14px;height:14px}
.popBody{display:none;position:absolute;left:0;top:calc(100% + 8px);background:#202020;border:1px solid #3a3a3a;border-radius:8px;padding:10px 12px;flex-direction:column;gap:8px;white-space:nowrap;box-shadow:0 8px 24px #000a;z-index:6}
.popBody.right{left:auto;right:0}.pop.open .popBody{display:flex}
/* Before the run is first played: a poster over the map, as on a video */
#mapBox{position:relative}
#poster{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;z-index:3;background:radial-gradient(closest-side,#000b,#0000)}
#poster[hidden]{display:none}
#poster .card{pointer-events:auto;text-align:center;background:#111e;border:1px solid #ffffff1f;border-radius:16px;padding:22px 30px}
#poster .big{width:78px;height:78px;border-radius:50%;background:#b48cff;color:#160b26;border:0;display:grid;place-items:center;margin:0 auto 14px;padding:0;box-shadow:0 0 30px #b48cff66}
#poster .big:hover{background:#c6a6ff}#poster .big svg{width:32px;height:32px;margin-left:5px}
#poster .t{font-size:19px;font-weight:600;color:#fff}
#poster .s{color:#a9a3b5;margin-top:5px}
#poster .skip{margin-top:14px;background:none;border:0;color:#8f97a6;text-decoration:underline;padding:0}
#poster .skip:hover{color:#ddd}
html:fullscreen #poster{display:none}
/* The map's window: room for its scroll bar kept from the start (else the bar, coming as the map
   grows, takes width from a "fit width" and a second bar appears under it); thin and dark */
#wrap{overflow:auto;height:calc(100vh - var(--head,50px));scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:#3a3a3a transparent}
#wrap.fitw{overflow-x:hidden}#wrap.fith{overflow-y:hidden}
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
#trail polyline{fill:none;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
#trail .shade{stroke:#000;stroke-opacity:.6;stroke-width:4.5}#trail .line{stroke:#b48cff;stroke-width:2.5}
#pos{font-variant-numeric:tabular-nums;color:#aaa}
/* A layer's switch as a round button with its icon (iconToggle): the box stays, hidden, for the code */
label.tg{display:flex;gap:7px;align-items:center;cursor:pointer;position:relative;user-select:none}
label.tg input{position:absolute;opacity:0;width:0;height:0;margin:0}
label.tg .ic{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#1c2029;border:1px solid #3a4150;color:#7d8699;transition:background .15s,border-color .15s,box-shadow .15s,color .15s}
label.tg .ic svg{width:18px;height:18px}label.tg .ic img{height:22px;image-rendering:pixelated;filter:grayscale(1) brightness(.7)}
label.tg input:checked+.ic{background:color-mix(in srgb,var(--tg) 22%,#14161c);border-color:var(--tg);color:#fff;box-shadow:0 0 10px color-mix(in srgb,var(--tg) 55%,transparent)}
label.tg input:checked+.ic img{filter:none}
label.tg input:focus-visible+.ic{outline:2px solid #fff;outline-offset:2px}
label.tg:hover .ic{border-color:var(--tg)}
.legend{color:#888}
`;

// Icons for the switches every game has.
export const ICONS = {
  // A winding route to a pin: the run's path.
  path: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h6a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h7a3 3 0 0 0 0-6h-1"/><circle cx="4" cy="20" r="1.8" fill="currentColor"/><path d="M21 13.5c0 2.6-3 5.5-3 5.5s-3-2.9-3-5.5a3 3 0 0 1 6 0z" fill="currentColor" stroke="none"/></svg>',
};

// A layer's switch: a round button with an icon, lit in the layer's colour while on. It is a
// checkbox underneath (id, .checked, onchange), so the code switching the layer stays as it was.
//   iconToggle({ id, icon, label, colour, title, count, checked })  — count: the id of a span after
//   the label for a number ("(7)"), filled by the game.
export function iconToggle({ id, icon, label: text, colour, title, count, checked = false }) {
  return `<label class="tg" style="--tg:${colour}"${title ? ` title="${title}"` : ''}><input type="checkbox" id="${id}"${checked ? ' checked' : ''}><span class="ic">${icon}</span><span>${text}${count ? ` <span id="${count}" class="legend"></span>` : ''}</span></label>`;
}

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const CHEVRON_L = svg('<path d="M15 6l-6 6 6 6"/>');
const CHEVRON_R = svg('<path d="M9 6l6 6-6 6"/>');
// Fit width: an arrow across between two walls; fit height: the same, up and down.
const FIT_W = svg('<path d="M3 5v14M21 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3"/>');
const FIT_H = svg('<path d="M5 3h14M5 21h14M12 7v10M9 10l3-3 3 3M9 14l3 3 3-3"/>');
/** The zoom's slider and typed value: from a tenth to four times the map's pixels. */
const Z_MIN = 0.1, Z_MAX = 4;
const SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path class="w" d="M16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13"/><path class="x" d="M17 9l5 6M22 9l-5 6" style="display:none"/></svg>';
/** m:ss of a count of frames. */
const clock = (frames) => { const t = Math.max(0, Math.round(frames / HZ)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

const label = (id, title, inner) => `<label style="display:flex;gap:4px;align-items:center"${title ? ` title="${title}"` : ''}>${inner}</label>`;

export function mountRunPage(cfg) {
  // `?view=map`: the maps alone, without the run's band or poster (the site's maps chapter; its run
  // chapter opens `?view=run`, the same as no view).
  if (new URLSearchParams(location.search).get('view') === 'map') cfg = { ...cfg, run: null };
  const word = cfg.levelWord ?? 'level';
  // The cursor's place on the map (cfg.onMouse writes it into #pos): the workshop's alone, not on
  // the site's copy (served under /maps/), unless cfg.dev says otherwise.
  const dev = cfg.dev ?? !/\/maps\//.test(location.pathname);
  const Word = word[0].toUpperCase() + word.slice(1);
  const style = document.createElement('style');
  style.textContent = CSS + (cfg.css ?? '');
  document.head.append(style);
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<header>
<div class="row" id="mapRow">
<span id="lvlNav" class="grp seg"${cfg.levels.length < 2 ? ' hidden' : ''}><button id="prevLvl" title="The ${word} before" aria-label="The ${word} before">${CHEVRON_L}</button><select id="lvl">${cfg.levels.map((l) => `<option value="${l.n}">${l.label}</option>`).join('')}</select><button id="nextLvl" title="The ${word} after" aria-label="The ${word} after">${CHEVRON_R}</button></span>
<span class="grp"><span class="cap">Zoom</span><span class="seg"><button data-z="0.25">¼</button><button data-z="0.5">½</button><button data-z="1" class="on">1×</button><button data-z="2">2×</button><span class="div"></span><button data-z="fitw" title="Fit the ${word}'s width in the window" aria-label="Fit width">${FIT_W}</button><button data-z="fith" title="Fit the ${word}'s height in the window" aria-label="Fit height">${FIT_H}</button><span class="div"></span><input type="range" id="zSlider" min="${Math.log(Z_MIN)}" max="${Math.log(Z_MAX)}" step="0.01" title="Any zoom" aria-label="Zoom"><label class="zpct" title="Type a zoom"><input id="zNum" type="text" inputmode="decimal" aria-label="Zoom in per cent">%</label></span></span>
<span class="grp" id="layers"${cfg.trail || cfg.headerHtml ? '' : ' hidden'}><span class="cap">Show</span>${cfg.trail ? iconToggle({ id: 'trailBox', icon: ICONS.path, label: cfg.trail.label, colour: '#b48cff', title: cfg.trail.title, count: 'trailN', checked: true }) : ''}
${cfg.headerHtml ?? ''}</span>
<span id="pos"${dev ? '' : ' hidden'}></span>
</div>
<div class="row idle" id="tkBar"${cfg.run ? '' : ' hidden'}${cfg.runTitle ? ` title="${cfg.runTitle}"` : ''}>
 <button id="tkPlay" class="start">▶ Watch the speedrun${cfg.runName ? `<span class="sub">${cfg.runName}</span>` : ''}</button>
 <span id="tkTime"></span>
 <input type="range" id="tkSeek" min="0" max="1" value="0">
 <span class="grp more"><select id="tkSpeed" title="Speed"><option value="1">×1</option><option value="4">×4</option><option value="16">×16</option></select>
 ${label('', 'The view keeps the game&#39;s frame in sight', '<input type="checkbox" id="tkFollow" checked> follow')}
 <span class="pop" id="snd"><button class="popBtn" id="sndBtn" title="Sound">${SPEAKER}</button><span class="popBody right" id="sndPop">
 ${label('', cfg.soundTitle, '<input type="checkbox" id="tkSound" checked> sound <input type="range" id="tkVol" min="0" max="1" step="0.05" value="0.6" style="width:80px">')}
 ${label('', cfg.musicTitle, '<input type="checkbox" id="tkMusic" checked> music')}
 ${label('', cfg.effectsTitle, '<input type="checkbox" id="tkEffects" checked> effects')}</span></span></span>
 <span id="tkLabel" class="legend"></span>
</div>
</header>
<button id="fsBtn" title="Full screen (Space plays and pauses the run)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5"/></svg></button>
<div id="mapBox"><div id="wrap"><div id="stage"><img id="iLevel" alt="">${cfg.layersBelow ?? ''}<canvas id="live" width="${cfg.field.w}" height="${cfg.field.h}"></canvas><svg id="trail"></svg>${cfg.layersAbove ?? ''}</div>${cfg.afterStage ?? ''}</div>
${cfg.run ? `<div id="poster"><div class="card"><button class="big" id="posterPlay" aria-label="Watch the speedrun"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l15 8-15 8z"/></svg></button><div class="t">Watch the speedrun of this ${word}</div><div class="s">${cfg.runName ?? 'A TAS'}, with the game&#39;s music and sound</div><button class="skip" id="posterSkip">or look at the map</button></div></div>` : ''}</div>`,
  );
  const $ = (id) => document.getElementById(id);
  const L = $('iLevel'), st = $('stage'), wrap = $('wrap'), lvl = $('lvl');
  const page = { cur: cfg.levels[0].n, z: 1, pick, zoomed, $, field: cfg.field };

  // ------------------------------------------------------------------ the map, zoom, full screen

  function size() { st.style.width = L.naturalWidth * page.z + 'px'; st.style.height = L.naturalHeight * page.z + 'px'; L.style.width = L.naturalWidth * page.z + 'px'; }
  // Zoom: a fixed scale, or "fit width" / "fit height" — the level's width or height in the window,
  // worked out again as the window, the level or full screen change.
  let fit = false;
  const fitZoom = () => { const W = L.naturalWidth || 2048, H = L.naturalHeight || cfg.field.h; return fit === 'fith' ? (wrap.clientHeight - 2) / H : (wrap.clientWidth - 2) / W; };
  function zoomed() { size(); showTrail(); cfg.onZoom?.(); if (data && frame >= 0) draw(); showZoom(); }
  function refit() { if (fit && L.naturalWidth) { const f = fitZoom(); if (f !== page.z) { page.z = f; zoomed(); } } }
  L.onload = () => { if (fit) page.z = fitZoom(); size(); showTrail(); cfg.onZoom?.(); showZoom(); };
  document.querySelectorAll('[data-z]').forEach((b) => (b.onclick = () => {
    fit = b.dataset.z.startsWith('fit') && b.dataset.z;
    // A fit never scrolls across it: no bar for the pixel or two a rounding leaves over.
    wrap.classList.toggle('fitw', fit === 'fitw');
    wrap.classList.toggle('fith', fit === 'fith');
    page.z = fit ? fitZoom() : +b.dataset.z;
    document.querySelectorAll('[data-z]').forEach((x) => x.classList.toggle('on', x === b));
    zoomed();
  }));
  addEventListener('resize', refit);
  // Any zoom: the slider (even steps on a log scale) or a number typed in per cent. Either leaves
  // the buttons and any fit; the middle of the view stays where it is on the map.
  const zSlider = $('zSlider'), zNum = $('zNum');
  function showZoom() {
    zSlider.value = String(Math.log(page.z));
    if (document.activeElement !== zNum) zNum.value = String(Math.round(page.z * 100));
  }
  function setZoom(z) {
    z = Math.min(Z_MAX, Math.max(Z_MIN, z));
    const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / page.z, cy = (wrap.scrollTop + wrap.clientHeight / 2) / page.z;
    fit = false;
    wrap.classList.remove('fitw', 'fith');
    document.querySelectorAll('[data-z]').forEach((x) => x.classList.remove('on'));
    page.z = z;
    zoomed();
    wrap.scrollTo(cx * z - wrap.clientWidth / 2, cy * z - wrap.clientHeight / 2);
  }
  zSlider.oninput = () => setZoom(Math.exp(Number(zSlider.value)));
  zNum.onchange = () => { const v = parseFloat(zNum.value.replace(',', '.')); if (v > 0) setZoom(v / 100); showZoom(); };
  zNum.onkeydown = (e) => { if (e.key === 'Enter') zNum.blur(); };
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
  // still ahead of the player. `shift`: how far a point's frame number runs ahead of the run's.
  //
  // The path is built once per level as short pieces (PIECE points each, every piece sharing its
  // last point with the next): as the run goes, the pieces behind the player are hidden and only
  // the piece he is on is redrawn, so the browser repaints a few small boxes, not a path as big as
  // the level. Its shadow is a wider dark line under it, not a filter. Without a GPU (Windows XP)
  // a drop-shadow over the whole path, redrawn every 4 frames, took more than a core at 2×
  // (bench/bench.mjs: raster 1 297 → 57 ms a second with the path hidden).
  const PIECE = 24;
  let TRAIL = null, builtFor = null, pieces = [];
  const SVG = 'http://www.w3.org/2000/svg';
  const pointsOf = (pts) => pts.map((p) => p[0] + ',' + p[1]).join(' ');
  // Every shadow lies under every line: a piece's own shadow over the end of the piece before it
  // cut the path into dashes at each join (seen in the short, where the path is wide).
  function buildTrail(svg, T) {
    svg.textContent = '';
    pieces = [];
    const shades = document.createElementNS(SVG, 'g'), lines = document.createElementNS(SVG, 'g');
    svg.append(shades, lines);
    for (const sg of T?.segments ?? []) {
      for (let i = 0; i < sg.length - 1; i += PIECE) {
        const pts = sg.slice(i, i + PIECE + 1);
        const shade = document.createElementNS(SVG, 'polyline'), line = document.createElementNS(SVG, 'polyline');
        shade.setAttribute('class', 'shade');
        line.setAttribute('class', 'line');
        shades.append(shade);
        lines.append(line);
        pieces.push({ pts, shade, line, from: -1, shown: true });
      }
    }
  }
  let trailLoading = null;
  /** The path's file, fetched once: its levels' points and frame counts. */
  function trailData() {
    trailLoading ??= fetch(cfg.trail.url, { cache: 'no-store' }).then((r) => r.json()).then((j) => (TRAIL = j.levels), () => (TRAIL = {}));
    return trailLoading;
  }
  /**
   * How long the run is on the level shown, once the run is loaded (its spans; the path's frame
   * counts take in the menus and cards before a level, so they would say more — 123 s for Alien 3's
   * first level, played for 97). Loading it only for the number would cost megabytes.
   */
  function runLength() {
    if (!cfg.run) return;
    const span = spans.find(([l]) => l === page.cur);
    if (span && !started) $('tkTime').textContent = `0:00 / ${clock(span[2] - span[1] + 1)}`;
  }
  async function showTrail() {
    if (!cfg.trail) return;
    const svg = $('trail'), box = $('trailBox'), n = $('trailN');
    if (!box.checked) { svg.textContent = ''; builtFor = null; n.textContent = ''; return; }
    await trailData();
    const T = TRAIL[page.cur], W = L.naturalWidth || 2048, H = L.naturalHeight || cfg.field.h;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.width = W * page.z + 'px';
    svg.style.height = H * page.z + 'px';
    n.textContent = T ? '' : '(none)';
    if (builtFor !== page.cur) { buildTrail(svg, T); builtFor = page.cur; }
    // window.takeFrame: the last frame drawn on a level (unset before the run is first played).
    const shift = cfg.trail.shift ?? 0, tf = window.takeFrame;
    // page.trailTo: the path ends at that frame (the short draws it out ahead of the player).
    const upTo = page.trailTo ?? Infinity;
    for (const piece of pieces) {
      // From which point the piece is still ahead (its points' frames rise); the DOM only when that changes.
      let from = 0, to = piece.pts.length;
      if (tf != null) while (from < piece.pts.length && piece.pts[from][2] - shift < tf) from++;
      if (upTo !== Infinity) { to = from; while (to < piece.pts.length && piece.pts[to][2] - shift <= upTo) to++; }
      if (from > piece.pts.length - 2 || to - from < 2) from = to = piece.pts.length;
      const key = from * 100000 + to;
      if (key === piece.from) continue;
      piece.from = key;
      const shown = from !== piece.pts.length;
      if (shown !== piece.shown) {
        piece.shown = shown;
        for (const el of [piece.shade, piece.line]) shown ? el.removeAttribute('display') : el.setAttribute('display', 'none');
      }
      if (!shown) continue;
      const pts = pointsOf(piece.pts.slice(from, to));
      piece.shade.setAttribute('points', pts);
      piece.line.setAttribute('points', pts);
    }
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
    runLength();
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
  const ui = { play: $('tkPlay'), speed: $('tkSpeed'), seek: $('tkSeek'), label: $('tkLabel'), follow: $('tkFollow'), time: $('tkTime') };
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
    runLength();
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
    page.at = at;
    const z = page.z;
    window.takeFrame = frame;
    // Read the page first, then write: a read after a write makes the browser lay the page out
    // again in the middle of the frame (the costliest script here on a slow machine).
    const view = ui.follow.checked && { left: wrap.scrollLeft, top: wrap.scrollTop, width: wrap.clientWidth, height: wrap.clientHeight };
    if (frame - lastTrail >= 4 || frame < lastTrail) { lastTrail = frame; showTrail(); }
    // The frame moves by a transform (no layout); its size changes only with the zoom.
    if (liveZ !== z) { liveZ = z; live.style.left = '0px'; live.style.top = '0px'; live.style.width = cfg.field.w * z + 'px'; live.style.height = cfg.field.h * z + 'px'; }
    live.style.transform = `translate(${at.x * z}px, ${at.y * z}px)`;
    live.style.display = 'block';
    run.onFrame?.(frame);
    // The slider runs over the level being played, its time from the level's first frame.
    if (ui.seek.min !== String(span[1]) || ui.seek.max !== String(span[2])) { ui.seek.min = String(span[1]); ui.seek.max = String(span[2]); }
    ui.seek.value = String(frame);
    const text = `${clock(frame - span[1])} / ${clock(span[2] - span[1] + 1)}`;
    if (ui.time.textContent !== text) ui.time.textContent = text;
    if (ui.label.textContent) ui.label.textContent = '';
    // Keep the camera's field in view with room around it: on each axis the field stays inside the
    // middle of the window (a margin of 40 % of the space left over), the view easing after it rather
    // than jumping once the field has reached the edge. A seek or a new level: straight there.
    if (view) {
      const x = follow(view.left, view.width, at.x * z, cfg.field.w * z), y = follow(view.top, view.height, at.y * z, cfg.field.h * z);
      if (Math.round(x) !== view.left || Math.round(y) !== view.top) wrap.scrollTo(x, y);
    }
  }
  let liveZ = 0;
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
  // Until first played, the button says what it does (and how long the run is); then it is a round
  // play / pause, and the poster over the map is gone.
  let started = false;
  function start() {
    if (started) return;
    started = true;
    ui.play.classList.remove('start');
    ui.play.title = 'Play / pause (Space)';
    $('tkBar').classList.remove('idle');
    $('poster')?.setAttribute('hidden', '');
  }
  ui.play.onclick = async () => {
    if (!cfg.run) return;
    start();
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
  ui.seek.oninput = () => { if (data) { start(); seek(Number(ui.seek.value)); } };
  if (cfg.run) {
    $('posterPlay').onclick = () => ui.play.click();
    $('posterSkip').onclick = () => $('poster').setAttribute('hidden', '');
  }
  // Every pop-up (the sound's, and a game's own): its button opens it, a click elsewhere closes it.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.popBtn'), mine = btn?.closest('.pop');
    for (const p of document.querySelectorAll('.pop.open')) if (p !== mine && !p.contains(e.target)) p.classList.remove('open');
    if (mine) mine.classList.toggle('open');
  });
  // The speaker shows a cross while the sound is off.
  const muted = () => { const off = !$('tkSound').checked; $('sndBtn').querySelector('.w').style.display = off ? 'none' : ''; $('sndBtn').querySelector('.x').style.display = off ? '' : 'none'; };
  $('tkSound').addEventListener('change', muted);
  requestAnimationFrame(tick);
  // Space plays and pauses — the only way to in full screen, where the header is hidden.
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !cfg.run || e.target.closest?.('input, select, textarea')) return;
    e.preventDefault();
    ui.play.click();
  });

  // `#level=5` in the address opens on that level, and changing it moves there (the site's page
  // links each level's map to its place in the player this way).
  const fromHash = () => {
    const n = Number(/level=(\d+)/.exec(location.hash)?.[1]);
    return cfg.levels.some((l) => l.n === n) ? n : null;
  };
  addEventListener('hashchange', () => { const n = fromHash(); if (n) choose(n); });
  // What the vertical short (short.js) drives: the run a frame at a time, its sound, the path.
  Object.assign(page, {
    load: async () => { if (!data) await load(); },
    seek,
    /** The run on to frame f: applied frame by frame from where it stands, or sought anew. */
    goTo(f, withSound) {
      if (f < frame || f - frame > 600) { seek(f); return; }
      while (frame < f) { run.apply(++frame); if (withSound) soundFrame(frame); }
      draw();
    },
    frame: () => frame,
    spans: () => spans,
    showTrail,
    startAudio,
    /** The run's sound from frame `from`, `count` frames, as samples at `rate` (Float32, -1…1). */
    renderSound(from, count, rate) {
      const { Apu, OutputFilters, mixApu } = cfg.apu;
      const chip = new Apu(rate, { memory: run.memory ?? (() => 0) }), filters = new OutputFilters(rate, false);
      const k = Math.ceil(rate / HZ) + 2;
      const lv = { pulse1: new Uint8Array(k), pulse2: new Uint8Array(k), triangle: new Uint8Array(k), noise: new Float64Array(k), dmc: new Uint8Array(k) };
      const start = Math.max(0, from - 180);
      for (const reg of [0x4017, 0x4015]) { const e = enables.filter(([g, a]) => g < start && a === reg).pop(); if (e) chip.write(reg, e[2]); }
      const out = new Float32Array(Math.ceil((count / HZ) * rate) + k);
      let debt = 0, n = 0;
      for (let g = start; g < from + count; g++) {
        writes(g, (a, v) => chip.write(a, v));
        debt += rate / HZ;
        const c = Math.floor(debt);
        debt -= c;
        chip.render(c, lv, 0);
        for (let i = 0; i < c; i++) {
          const y = 2.2 * filters.step(mixApu(lv.pulse1[i], lv.pulse2[i], lv.triangle[i], lv.noise[i], lv.dmc[i]));
          if (g >= from && n < out.length) out[n++] = y;
        }
      }
      return out.subarray(0, n);
    },
  });
  pick(fromHash() ?? page.cur);
  // The zoom it opens with, as if its button were pressed (a fit is worked out again once the map loads).
  if (cfg.zoom) document.querySelector(`[data-z="${cfg.zoom}"]`)?.click();
  // `?short`: the page as a vertical promo (short.js, the game's cfg.short).
  if (cfg.short && new URLSearchParams(location.search).has('short')) {
    $('poster')?.setAttribute('hidden', '');
    import('./short.js').then((m) => m.mountShort(page, cfg.short));
  }
  return page;
}
