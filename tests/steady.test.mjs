// node --test tests/
// "Less finicky" tests: the same exercises as exercises.test.mjs, but with a shaky pose
// model: every joint jitters, about one frame in 25 has a joint thrown far off, and the
// joints' visibility wobbles around the threshold. Poses go through PoseSmoother first,
// as they do in the app.
import test from "node:test";
import assert from "node:assert/strict";
import { CASES, run } from "./run_all.mjs";
import { setSeed } from "./synthBody.mjs";
import { ORDER } from "../js/exercises.js";
import { robustMax } from "../js/geometry.js";
import { PoseSmoother, Debounced } from "../js/smooth.js";

const NOISE = { jitter: 0.005, spikeEvery: 25, visFlicker: true };   // jitter: +/- 0.5% of body length

for (const seed of [7, 2024]) for (const fps of [30, 15]) {
  test(`shaky poses (seed ${seed}, ${fps} frames/s): right rep count, no false errors, no missed errors`, () => {
    setSeed(seed);
    for (const ex of ORDER) for (const [view, list] of Object.entries(CASES[ex])) for (const c of list) {
      const [err, prof] = Array.isArray(c) ? c : [c, {}];
      for (const op of ["right", "left"]) {
        const r = run(ex, view, err, prof, op, 3, { noise: NOISE, smooth: true, fps });
        const what = `${ex}/${view}/${op}/${err ?? "clean"}`;
        assert.ok(r.reps.length === 3 || r.reps.length === 4, `${what}: ${r.reps.length} reps`);
        for (const rep of r.reps) {
          const ids = rep.errors.map((e) => e.id);
          assert.deepEqual(ids.filter((i) => i !== err), [], `${what} rep ${rep.n}: false flag`);
          if (err && !(ex === "heel_slide" && err === "partial" && rep.peak >= 90)) assert.ok(ids.includes(err), `${what} rep ${rep.n}: missed ${err}`);
        }
      }
    }
  });
}

const lmAt = (x, y, v = 0.9) => Array.from({ length: 33 }, () => ({ x, y, z: 0, visibility: v }));

test("smoother: a one-frame jump is removed", () => {
  const sm = new PoseSmoother();
  let worst = 0;
  for (let i = 0; i < 60; i++) {
    const out = sm.update(lmAt(i === 30 ? 0.8 : 0.5, 0.5), i / 30, 720, 1280);
    worst = Math.max(worst, Math.abs(out[0].x - 0.5));
  }
  assert.ok(worst < 1e-9, `moved ${worst}`);
});

test("smoother: jitter on a still joint is cut by more than half", () => {
  const sm = new PoseSmoother(), raw = [], out = [];
  let s = 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  for (let i = 0; i < 300; i++) {
    const x = 0.5 + rnd() * 0.01;
    raw.push(x); out.push(sm.update(lmAt(x, 0.5), i / 30, 720, 1280)[0].x);
  }
  const sd = (a) => { const m = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / a.length); };
  assert.ok(sd(out.slice(30)) < 0.5 * sd(raw.slice(30)), `${sd(out.slice(30))} vs ${sd(raw.slice(30))}`);
});

test("smoother: a moving joint lags by less than 0.1 s", () => {
  const sm = new PoseSmoother();
  const speed = 0.15;                       // image heights per second: a slow limb movement
  let out;
  for (let i = 0; i <= 90; i++) out = sm.update(lmAt(0.5, 0.2 + speed * (i / 30)), i / 30, 720, 1280);
  const lagS = (0.2 + speed * 3 - out[0].y) / speed;
  assert.ok(lagS >= 0 && lagS < 0.1, `lag ${lagS.toFixed(3)} s`);
});

test("smoother: visibility near the threshold doesn't flicker, but a hidden joint is dropped", () => {
  const sm = new PoseSmoother();
  let flips = 0, last = null;
  for (let i = 0; i < 90; i++) {
    const v = sm.update(lmAt(0.5, 0.5, i % 2 ? 0.44 : 0.62), i / 30, 720, 1280)[0].visibility >= 0.5;
    if (last !== null && v !== last) flips++;
    last = v;
  }
  assert.equal(flips, 0);
  assert.equal(last, true);
  let v;
  for (let i = 90; i < 120; i++) v = sm.update(lmAt(0.5, 0.5, 0.1), i / 30, 720, 1280)[0].visibility;
  assert.ok(v < 0.5);
});

test("smoother: starts fresh after the pose was lost", () => {
  const sm = new PoseSmoother();
  for (let i = 0; i < 30; i++) sm.update(lmAt(0.2, 0.2), i / 30, 720, 1280);
  const out = sm.update(lmAt(0.8, 0.8), 3, 720, 1280);
  assert.ok(Math.abs(out[0].x - 0.8) < 1e-9);
});

test("robustMax ignores a single-frame spike but keeps a held value", () => {
  assert.equal(robustMax([1, 1, 9, 1, 1]), 1);
  assert.equal(robustMax([1, 1, 5, 5, 1]), 5);
  assert.ok(Number.isNaN(robustMax([])));
});

test("on-screen cue: needs to persist to appear, stays readable, then clears", () => {
  const d = new Debounced({ onS: 0.4, offS: 0.6, minShowS: 1.5 });
  assert.equal(d.update("Keep the knee straight", 0), null);
  assert.equal(d.update(null, 0.1), null);                       // one-frame blip: never shown
  assert.equal(d.update("Keep the knee straight", 0.2), null);
  assert.equal(d.update("Keep the knee straight", 0.7), "Keep the knee straight");
  assert.equal(d.update(null, 0.8), "Keep the knee straight");  // still up: minimum display time
  assert.equal(d.update(null, 1.5), "Keep the knee straight");
  assert.equal(d.update(null, 2.3), null);
});
