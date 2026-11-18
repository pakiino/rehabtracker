// Steadying helpers: joint smoothing for the pose stream and debouncing for on-screen text.
// Pure functions and classes: no DOM, no MediaPipe.

const med3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

/** One Euro filter (Casiez et al. 2012): heavy smoothing when still, light when moving. */
class OneEuro {
  constructor(minCutoff, beta, dCutoff = 1) { Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0 }); }
  filter(x, dt) {
    if (this.x === null) { this.x = x; return x; }
    const a = (fc) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
    this.dx += a(this.dCutoff) * ((x - this.x) / dt - this.dx);
    this.x += a(this.minCutoff + this.beta * Math.abs(this.dx)) * (x - this.x);
    return this.x;
  }
}

export const SMOOTHING = {
  minCutoffHz: 1.5,   // jitter cut-off while a joint is still
  beta: 30,           // how fast the cut-off opens up with speed (speed in long-sides per second)
  visAlpha: 0.4,      // visibility moving average
  visOn: 0.5,         // a joint counts as visible from here...
  visOff: 0.35,       // ...until its averaged visibility drops below here
  resetGapS: 0.5,     // pose lost for longer than this: start fresh
};

/**
 * Smooths MediaPipe landmarks frame to frame.
 * 1. median of the last 3 raw positions (removes one-frame jumps),
 * 2. One Euro filter (removes jitter without lagging real movement),
 * 3. visibility: averaged, with hysteresis so a joint near the threshold doesn't flicker.
 */
export class PoseSmoother {
  constructor(params = {}) { this.p = { ...SMOOTHING, ...params }; this.reset(); }
  reset() { this.pts = null; this.t = null; }

  /** @param lm normalized landmarks [{x,y,z,visibility}], t seconds, W/H image size in px */
  update(lm, t, W, H) {
    const p = this.p;
    if (this.t !== null && (t - this.t > p.resetGapS || t < this.t)) this.reset();
    const dt = this.t === null ? 1 / 30 : Math.max(1e-3, t - this.t);
    this.t = t;
    const S = Math.max(W, H), sx = W / S, sy = H / S;   // filter in units of the image's long side
    this.pts ??= lm.map(() => ({ raw: [], fx: new OneEuro(p.minCutoffHz, p.beta), fy: new OneEuro(p.minCutoffHz, p.beta), v: null, on: false }));
    return lm.map((q, i) => {
      const s = this.pts[i];
      s.raw.push([q.x * sx, q.y * sy]);
      if (s.raw.length > 3) s.raw.shift();
      const r = s.raw, n = r.length;
      const mx = n < 3 ? r[n - 1][0] : med3(r[0][0], r[1][0], r[2][0]);
      const my = n < 3 ? r[n - 1][1] : med3(r[0][1], r[1][1], r[2][1]);
      const v = Number.isFinite(q.visibility) ? q.visibility : 0;
      s.v = s.v === null ? v : s.v + p.visAlpha * (v - s.v);
      s.on = s.on ? s.v >= p.visOff : s.v >= p.visOn;
      return { ...q, x: s.fx.filter(mx, dt) / sx, y: s.fy.filter(my, dt) / sy,
               visibility: s.on ? Math.max(s.v, p.visOn) : Math.min(s.v, p.visOn - 0.01) };
    });
  }
}

/**
 * Debounces a value that is shown on screen (a cue or a warning), so it doesn't flash.
 * A new value must persist for onS before it is shown, is shown for at least minShowS,
 * and is cleared only after it has been absent for offS.
 */
export class Debounced {
  constructor({ onS = 0.4, offS = 0.6, minShowS = 1.5 } = {}) {
    Object.assign(this, { onS, offS, minShowS, cand: null, candSince: 0, shown: null, shownAt: -Infinity });
  }
  reset() { this.cand = null; this.shown = null; this.shownAt = -Infinity; }
  update(value, t) {
    value ??= null;
    if (value !== this.cand) { this.cand = value; this.candSince = t; }
    const held = t - this.candSince, up = t - this.shownAt;
    if (this.cand !== null && this.cand !== this.shown && held >= this.onS && (this.shown === null || up >= this.minShowS)) {
      this.shown = this.cand; this.shownAt = t;
    } else if (this.cand === null && this.shown !== null && held >= this.offS && up >= this.minShowS) {
      this.shown = null;
    }
    return this.shown;
  }
}
