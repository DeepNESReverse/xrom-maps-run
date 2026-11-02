# maps-run

The page around a game's level maps with a run (a TAS) played over them, the same for every game:
the header (◀ prev / the level list / next ▶, zoom ¼ ½ 1× 2× fit width fit height, the run bar,
the run's path, the game's own switches), the map with the game's frame laid on it at the camera,
full screen with the run bar alone (fading after 2.5 s), the view following the camera, Space to
play, the sound through `@xromdev/apu` with music and effects apart.

`src/run-page.js` — `mountRunPage(config)`; its header comment is the contract (the config and the
run adapter a game gives). `src/sound.js` — the AudioWorklet the sound is played through.

Plain JavaScript, no build: the workshops serve it as it is (each game's repo links it as
`src/maps-run` → `../../xrom-libs/maps-run/src`, so its server's `/src/…` route serves it), and a
public build bundles it (esbuild).

Used by: ~/alien3-levels (Alien 3), ~/circus-charlie-levels (Circus Charlie).
Not published; no remote.
