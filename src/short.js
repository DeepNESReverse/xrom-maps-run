// The maps page as a vertical promo (`?short`, `?short=tiktok`): 540 × 960, drawn at twice that for
// YouTube Shorts and TikTok. The game gives the script (cfg.short); everything moves by the clock —
// the camera, the dark around the game's frame, the clicks on the switches, the path drawn out, the
// captions — so any moment can be drawn on its own, as the workshop's renderer does
// (scripts/render-short.mjs: window.__short.at(t), then a picture).
//
//   short: {
//     game: 'Alien 3', folder: 'alien-3',      // the site's /games/<folder>
//     level: 8, start: 90,                     // the run from frame `start` of that level's span
//     music: 22,                               // when the end card comes (s); the short is 4 s longer
//     buttons: [{ id: 'trailBox', label: 'route' }, …],   // the switches shown big, from the header
//     initial: { trailBox: true, … },          // the switches at 0 s
//     cams: [{ t, dur, cam }],                 // cam: 'fit' (the whole level) or a zoom on the player,
//                                              // { z, clamp } — z 'frame': the game's frame fills the width
//     mask: [{ t, dur, to }],                  // the dark around the game's frame, 0…1
//     events: [{ t, click: id } | { t, set: { id: on } } | { t, reveal: s }],
//                                              // click: the pointer presses it; set: silently;
//                                              // reveal: the path drawn out ahead over `s` seconds
//     captions: [{ from, to, text, sub, big }],
//     end: { path: '/games/alien-3/maps', line: '…' },
//   }

const W = 540, H = 960, HZ = 60.0988;
/** Where the camera puts what it looks at: the middle of the room left by captions and switches. */
const EYE = { x: W / 2, y: 420 };
/** The end card's length after `music`, and the sound's fade into it. */
const OUTRO = 4, FADE = 2;
const POINTER_MOVE = 0.6, LINGER = 4;

const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const clamp01 = (k) => Math.max(0, Math.min(1, k));

const CSS = (base) => `
@font-face{font-family:SG;src:url(${base}fonts/geist-latin.woff2);font-weight:100 900}
@font-face{font-family:SM;src:url(${base}fonts/geist-mono-latin.woff2)}
html.short,html.short body{overflow:hidden;background:#000}
html.short header,html.short #fsBtn,html.short #pos{display:none!important}
#shRoot{position:fixed;inset:0;display:grid;place-items:center;background:#000;z-index:10}
#shStage{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#000;transform-origin:center;font-family:SG,system-ui,sans-serif;color:#fff}
#shStage #wrap{position:absolute;inset:0;height:auto!important;overflow:hidden}
#shStage #stage{transform-origin:0 0;will-change:transform}
/* The path made for a phone: wide when the whole level is small, as on the page when close (--tw, by the zoom) */
html.short #trail .shade{stroke-width:calc(var(--tw,2px) + 1.5px);stroke-opacity:.75}html.short #trail .line{stroke-width:var(--tw,2px)}
#shMask{position:absolute;left:0;top:0;pointer-events:none;box-shadow:0 0 0 2400px #000;border-radius:2px}
#shCap{position:absolute;left:24px;right:24px;top:64px;text-align:center;pointer-events:none}
#shCap .t{display:inline-block;font-weight:800;font-size:31px;line-height:1.12;letter-spacing:-.01em;padding:10px 18px;border-radius:14px;background:#000b;box-shadow:0 8px 30px #0008;text-wrap:balance}
#shCap.big .t{font-size:40px;background:#f5b301;color:#111;transform:rotate(-1.5deg)}
#shCap.cover{top:150px}#shCap.cover .t{font-size:62px;padding:14px 26px;border-radius:20px}#shCap.cover .s{display:inline-block;font-size:26px;margin-top:16px;padding:6px 14px;border-radius:10px;background:#000c;text-shadow:none}
#shCap .s{margin-top:10px;font-weight:600;font-size:19px;color:#cfd8ea;text-shadow:0 2px 8px #000,0 0 2px #000;text-wrap:balance}
#shBtns{position:absolute;left:26px;top:680px;display:flex;gap:22px;pointer-events:none}
#shBtns .b{display:flex;flex-direction:column;align-items:center;gap:7px}
#shBtns .ic{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;background:#1c2029e6;border:2px solid #3a4150;color:#7d8699}
#shBtns .ic svg{width:36px;height:36px}#shBtns .ic img{height:44px;image-rendering:pixelated;filter:grayscale(1) brightness(.7)}
#shBtns .b.on .ic{background:color-mix(in srgb,var(--tg) 25%,#14161c);border-color:var(--tg);color:#fff;box-shadow:0 0 22px color-mix(in srgb,var(--tg) 65%,transparent)}
#shBtns .b.on .ic img{filter:none}
#shBtns .l{font:600 14px SG,system-ui;color:#cfd8ea;text-shadow:0 1px 4px #000}
#shPointer{position:absolute;left:0;top:0;width:34px;height:34px;pointer-events:none;filter:drop-shadow(0 3px 6px #000a)}
#shRipple{position:absolute;left:0;top:0;border-radius:50%;border:3px solid #fff;pointer-events:none}
#shMark{position:absolute;top:44px;right:18px;font:700 15px SM,monospace;letter-spacing:.12em;color:#ffffffb0;text-shadow:0 1px 4px #000}
#shEnd{position:absolute;inset:0;display:grid;place-items:center;background:#05060aeb;padding:0 40px 120px 30px;text-align:center}
#shEnd .site{display:inline-block;font:800 60px SG,system-ui;letter-spacing:-.02em;padding:14px 30px;border-radius:20px;background:#f5b301;color:#111}
#shEnd .path{margin-top:18px;font:600 22px SM,monospace;color:#9fd8ff}
#shEnd .line{margin-top:26px;font:600 22px SG,system-ui;color:#cfd8ea;line-height:1.3}
#shEnd .game{font:600 16px SM,monospace;letter-spacing:.3em;color:#8b95a8;text-transform:uppercase;margin-bottom:26px}
#shZones{position:absolute;inset:0;pointer-events:none;display:none}
#shZones div{position:absolute;background:#ff000040;outline:1px dashed #f00}
#shHint{position:fixed;left:8px;bottom:8px;font:12px SM,monospace;color:#888;z-index:11}
`;

export function mountShort(page, script) {
  const platform = new URLSearchParams(location.search).get('short') === 'tiktok' ? 'tiktok' : 'youtube';
  const rendering = new URLSearchParams(location.search).has('r') || window.__videoRenderer;
  const base = new URL('.', import.meta.url).href;
  const $ = page.$;
  const style = document.createElement('style');
  style.textContent = CSS(base);
  document.head.append(style);
  document.documentElement.classList.add('short');

  // The stage, the map's window moved into it, the layers over it.
  const root = document.createElement('div');
  root.id = 'shRoot';
  root.dataset.shortRoot = '';
  root.innerHTML = `<div id="shStage"><div id="shCap"></div><div id="shBtns"></div><div id="shRipple"></div>
<svg id="shPointer" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2 3.8 7.2-3 1.6-3.8-7.3L4 20z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>
<div id="shMark">xrom.dev</div>
<div id="shEnd"><div><div class="game">${script.game} · NES</div><div class="site">xrom.dev</div><div class="path">${script.end.path}</div><div class="line">${script.end.line}</div></div></div>
<div id="shZones"><div style="left:0;right:0;top:0;height:40px"></div><div style="right:0;width:60px;top:380px;height:390px"></div><div style="left:0;right:0;top:770px;bottom:0"></div></div></div>`;
  document.body.append(root);
  const stageEl = $('shStage');
  stageEl.prepend($('wrap'));
  const wrap = $('wrap'), st = $('stage'), live = $('live'), L = $('iLevel');
  // The dark round the game's frame: a hole with a shadow wide enough for the stage (Chrome draws
  // nothing for a spread of tens of thousands of pixels), laid over the map's window.
  const mask = document.createElement('div');
  mask.id = 'shMask';
  wrap.after(mask);
  const fitWindow = () => { const k = Math.min(innerWidth / W, innerHeight / H); stageEl.style.transform = `scale(${k})`; };
  if (!rendering) { fitWindow(); addEventListener('resize', fitWindow); }
  // The page's own following and fitting stop: the short moves the camera.
  $('tkFollow').checked = false;
  document.querySelector('[data-z="1"]')?.click();

  // The switches, big: each a copy of the header's icon, lit as its box is.
  const buttons = script.buttons.map(({ id, label }) => {
    const box = $(id), tg = box.closest('label.tg');
    const el = document.createElement('div');
    el.className = 'b';
    el.style.setProperty('--tg', tg.style.getPropertyValue('--tg'));
    el.innerHTML = `<div class="ic">${tg.querySelector('.ic').innerHTML}</div><div class="l">${label}</div>`;
    $('shBtns').append(el);
    return { id, box, el, ic: el.querySelector('.ic') };
  });
  const setBox = (id, on) => {
    const box = $(id);
    if (box.checked === on) return;
    box.checked = on;
    box.dispatchEvent(new Event('change'));
  };

  // ------------------------------------------------------------------ the clock

  const music = script.music, duration = music + OUTRO;
  const level = () => page.spans().find(([n]) => n === script.level);
  const frameAt = (t) => level()[1] + script.start + Math.floor(t * HZ);
  let time = 0, ready = false;

  /** Where the camera looks for `cam`, now: { z, cx, cy } in map pixels. */
  function camOf(cam) {
    const mw = L.naturalWidth, mh = L.naturalHeight;
    if (cam === 'fit') { const z = (W - 8) / mw; return { z, cx: mw / 2, cy: mh / 2 }; }
    const z = cam.z === 'frame' ? W / page.field.w : cam.z;
    const at = page.at ?? { x: 0, y: 0 };
    let cx = at.x + page.field.w / 2, cy = at.y + page.field.h / 2;
    if (cam.clamp !== false) {
      if (mw * z > W) cx = Math.max(EYE.x / z, Math.min(mw - (W - EYE.x) / z, cx));
      if (mh * z > H) cy = Math.max(EYE.y / z, Math.min(mh - (H - EYE.y) / z, cy));
    }
    return { z, cx, cy };
  }
  function camera(t) {
    const keys = script.cams;
    let c = camOf(keys[0].cam);
    for (const key of keys.slice(1)) {
      if (t < key.t) break;
      const k = ease((t - key.t) / key.dur), to = camOf(key.cam);
      c = { z: Math.exp(Math.log(c.z) + (Math.log(to.z) - Math.log(c.z)) * k), cx: c.cx + (to.cx - c.cx) * k, cy: c.cy + (to.cy - c.cy) * k };
    }
    return c;
  }
  const tween = (keys, t, start = 0) => {
    let v = start;
    for (const key of keys) { if (t < key.t) break; v = v + (key.to - v) * ease((t - key.t) / key.dur); }
    return v;
  };
  /** The switches as the script has them at t. */
  function switchesAt(t) {
    const on = { ...script.initial };
    for (const e of script.events) {
      if (e.t > t) break;
      if (e.click) on[e.click] = !on[e.click];
      if (e.set) Object.assign(on, e.set);
    }
    return on;
  }
  /** The pointer: it glides in to a click, stays while the next comes soon, then fades away. */
  const START = { x: W * 0.62, y: H * 0.88 };
  function pointerAt(t) {
    const clicks = script.events.filter((e) => e.click);
    const where = (e) => { const r = buttons.find((b) => b.id === e.click).ic, b = r.offsetParent; return { x: b.offsetLeft + r.offsetLeft + 38, y: b.offsetTop + r.offsetTop + 40 }; };
    let cur = -1;
    for (let i = clicks.length - 1; i >= 0; i--) if (t >= clicks[i].t - 0.08 - POINTER_MOVE - 0.4) { cur = i; break; }
    if (cur < 0) return null;
    const c = clicks[cur], prev = clicks[cur - 1], next = clicks[cur + 1];
    const arrive = c.t - 0.08, leave = arrive - POINTER_MOVE;
    const fresh = !prev || c.t - prev.t > LINGER;
    const from = fresh ? START : where(prev), to = where(c);
    if (t < leave) return { ...from, o: fresh ? clamp01((t - leave + 0.4) / 0.4) : 1 };
    if (t <= arrive) { const k = ease((t - leave) / POINTER_MOVE); return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, o: 1 }; }
    const stays = next && next.t - c.t <= LINGER ? Infinity : c.t + 1.2;
    const o = 1 - clamp01((t - stays) / 0.3);
    return o > 0 ? { ...to, o, press: t >= c.t ? t - c.t : null } : null;
  }

  // ------------------------------------------------------------------ one moment

  let lastReveal = null;
  function at(t, withSound = false) {
    time = Math.max(0, Math.min(duration, t));
    const f = frameAt(time);
    // The switches first (they redraw their layers), then the run, which draws the path and the frame.
    const on = switchesAt(time);
    for (const [id, v] of Object.entries(on)) setBox(id, v);
    for (const b of buttons) b.el.classList.toggle('on', Boolean(on[b.id]));
    // The path drawn out ahead: from the click (reveal) to the level's last frame.
    const reveal = [...script.events].reverse().find((e) => e.reveal && e.t <= time);
    const end = level()[2];
    page.trailTo = reveal && time < reveal.t + reveal.reveal ? f + (end - f) * ease((time - reveal.t) / reveal.reveal) : undefined;
    page.goTo(f, withSound);
    if (page.trailTo !== undefined || lastReveal !== undefined) page.showTrail();
    lastReveal = page.trailTo;

    // The camera.
    const c = camera(time);
    if (Math.abs(c.z - page.z) > 1e-6) { page.z = c.z; page.zoomed(); }
    st.style.transform = `translate(${EYE.x - c.cx * c.z}px, ${EYE.y - c.cy * c.z}px)`;
    // The path's width: 2 px over the whole level, 1.3 px from a zoom of 0.6 (the user: 4.5, then 3, too heavy).
    st.style.setProperty('--tw', `${(1.3 + 0.7 * clamp01((0.6 - c.z) / 0.3)).toFixed(2)}px`);
    // The dark around the game's frame.
    const m = tween(script.mask, time);
    const a = page.at ?? { x: 0, y: 0 };
    mask.style.display = m > 0.002 ? 'block' : 'none';
    mask.style.width = page.field.w * c.z + 'px';
    mask.style.height = page.field.h * c.z + 'px';
    mask.style.transform = `translate(${EYE.x - c.cx * c.z + a.x * c.z}px, ${EYE.y - c.cy * c.z + a.y * c.z}px)`;
    mask.style.opacity = String(m);

    // Captions.
    const cap = $('shCap');
    const now = script.captions.find((k) => time >= k.from && time < k.to);
    if (now) {
      const html = `<div class="t">${now.text}</div>${now.sub ? `<div class="s">${now.sub}</div>` : ''}`;
      if (cap.dataset.key !== now.text) { cap.dataset.key = now.text; cap.innerHTML = html; cap.className = now.big ? 'big' : ''; }
      // The first caption is there from the very first frame: the hook is not faded in.
      const o = Math.min(now.from === 0 ? 1 : clamp01((time - now.from) / 0.25), clamp01((now.to - time) / 0.25));
      cap.style.opacity = String(o);
      cap.style.transform = `translateY(${(1 - o) * 10}px)`;
    } else cap.style.opacity = '0';

    // The pointer and its click.
    const p = pointerAt(time), ptr = $('shPointer'), rip = $('shRipple');
    if (p && p.o > 0) {
      const down = p.press != null && p.press < 0.15 ? 0.88 : 1;
      ptr.style.display = 'block';
      ptr.style.opacity = String(p.o);
      ptr.style.transform = `translate(${p.x - 6}px, ${p.y - 3}px) scale(${down})`;
    } else ptr.style.display = 'none';
    if (p?.press != null && p.press < 0.5) {
      const k = p.press / 0.5, r = 14 + 46 * k;
      rip.style.display = 'block';
      rip.style.width = rip.style.height = 2 * r + 'px';
      rip.style.transform = `translate(${p.x - r}px, ${p.y - r}px)`;
      rip.style.opacity = String(0.9 * (1 - k));
    } else rip.style.display = 'none';

    // The end card.
    const e = clamp01((time - music) / 0.45);
    $('shEnd').style.display = e > 0 ? 'grid' : 'none';
    $('shEnd').style.opacity = String(e);
    $('shEnd').firstElementChild.style.transform = `scale(${0.94 + 0.06 * e})`;
    $('shMark').style.opacity = String(1 - e);
    $('shBtns').style.opacity = String(1 - e);
    if (hint) hint.textContent = `${time.toFixed(2)} / ${duration} s · frame ${f} · ${platform} · Space play · Home · ←/→ 1 s · G safe zones`;
  }

  // ------------------------------------------------------------------ preview and render

  let hint = null, playing = false, last = 0;
  if (!rendering) {
    hint = document.createElement('div');
    hint.id = 'shHint';
    document.body.append(hint);
    const loop = (now) => {
      if (playing) {
        const t = time + Math.min(0.1, (now - last) / 1000);
        at(t, true);
        if (t >= duration) playing = false;
      }
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    addEventListener('keydown', async (e) => {
      if (!ready) return;
      if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); await page.startAudio(); if (time >= duration) at(0); playing = !playing; }
      else if (e.code === 'Home') at(0);
      else if (e.code === 'ArrowRight') at(time + 1);
      else if (e.code === 'ArrowLeft') at(time - 1);
      else if (e.code === 'KeyG') { const z = $('shZones'); z.style.display = z.style.display === 'block' ? 'none' : 'block'; }
    }, true);
  }

  const imageLoaded = () => L.complete && L.naturalWidth > 0;
  (async () => {
    await page.load();
    page.goTo(frameAt(0));
    if (page.cur !== script.level) page.pick(script.level);
    for (let i = 0; i < 200 && !imageLoaded(); i++) await new Promise((ok) => setTimeout(ok, 50));
    await document.fonts.load('800 30px SG');
    await document.fonts.load('600 15px SM');
    at(0);
    ready = true;
  })();

  /**
   * The cover (`script.cover`): the moment `t` with everything lit, the camera where the cover
   * wants it ({ z, cx, cy, eye } — `eye` the stage height the point lands at), the hook in big type,
   * no pointer — the words low enough to stay in TikTok's 3:4 profile crop (y 120…840 of the stage).
   * scripts/short-thumb.mjs takes the picture.
   */
  function cover() {
    const c = script.cover;
    at(c.t);
    page.z = c.z;
    page.zoomed();
    st.style.transform = `translate(${EYE.x - c.cx * c.z}px, ${(c.eye ?? EYE.y) - c.cy * c.z}px)`;
    st.style.setProperty('--tw', '2.4px');
    mask.style.display = 'none';
    for (const id of ['shPointer', 'shRipple', 'shEnd']) $(id).style.display = 'none';
    const cap = $('shCap');
    cap.className = 'big cover';
    cap.innerHTML = `<div class="t">${c.text}</div>${c.sub ? `<div class="s">${c.sub}</div>` : ''}`;
    cap.style.opacity = '1';
    cap.style.transform = 'none';
    return true;
  }

  window.__short = {
    cover: () => ready && cover(),
    plan: () => ready && { game: script.game, track: null, composer: null, folder: script.folder, duration, music },
    ready: () => ready && imageLoaded() && [...document.querySelectorAll('#stage img')].every((i) => i.complete),
    start() {},
    at: (t) => { at(t); return true; },
    get time() { return time; },
    /** The sound: the run's own chip writes from the short's first frame, faded into the end. */
    audio() {
      const rate = 48000, count = Math.ceil(duration * HZ) + 2;
      const pcm = page.renderSound(frameAt(0), count, rate);
      const n = Math.min(pcm.length, Math.round(duration * rate));
      let peak = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(pcm[i]));
      const gain = peak > 0 ? 0.89 / peak : 1, fadeFrom = (duration - FADE) * rate;
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const fade = i < fadeFrom ? 1 : Math.max(0, 1 - (i - fadeFrom) / (FADE * rate));
        out[i] = Math.round(Math.max(-1, Math.min(1, pcm[i] * gain * fade)) * 32767);
      }
      let bin = '';
      const bytes = new Uint8Array(out.buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { pcm: btoa(bin), sampleRate: rate };
    },
  };
}
