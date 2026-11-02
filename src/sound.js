// The player's sound (an AudioWorklet): blocks of samples posted by the page, played in order; run
// dry, it gathers a little before playing again; too far behind, it drops the oldest.
// (After nes-explorer's src/play/sound.js; maps-run's run-page.js posts to it.)
class Feed extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.queued = 0;
    this.primed = false;
    this.port.onmessage = (e) => {
      this.queue.push(e.data);
      this.queued += e.data.length;
      while (this.queued > sampleRate * 0.2 && this.queue.length > 1) {
        const q = this.queue.shift();
        this.queued -= q.length - this.offset;
        this.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!this.primed && this.queued >= sampleRate * 0.05) this.primed = true;
    let i = 0;
    if (this.primed) {
      while (i < out.length && this.queue.length) {
        const q = this.queue[0];
        const n = Math.min(out.length - i, q.length - this.offset);
        out.set(q.subarray(this.offset, this.offset + n), i);
        i += n;
        this.offset += n;
        this.queued -= n;
        if (this.offset >= q.length) {
          this.queue.shift();
          this.offset = 0;
        }
      }
      if (i < out.length) this.primed = false;
    }
    out.fill(0, i);
    return true;
  }
}
registerProcessor('feed', Feed);
