// node --test tests/
// Every exercise and camera view: a clean recording gives the right rep count and no
// errors, and each injected common error is flagged on every rep.
import test from "node:test";
import assert from "node:assert/strict";
import { CASES, run } from "./run_all.mjs";
import { synth, period, rotateLandmarks } from "./synthBody.mjs";
import { toFrame, facingOf, unrotateLandmarks } from "../js/geometry.js";
import { analyze } from "../js/engine.js";
import { EXERCISES, ORDER } from "../js/exercises.js";

const TRUTH_PEAK = {   // true value of the rep signal at the top of a clean rep
  heel_slide: 110, straight_leg_raise: 40, sitting_knee_bend: 120, standing_knee_bend: 98,
  seated_knee_extension: 5, mini_squat: 43, side_lying_abduction: 30,
};

test("every exercise in the spec is defined with its views", () => {
  assert.equal(ORDER.length, 10);
  for (const id of ORDER) {
    assert.ok(EXERCISES[id], id);
    assert.deepEqual(Object.keys(EXERCISES[id].views).sort(), Object.keys(CASES[id]).sort(), id);
  }
});

for (const ex of ORDER) for (const [view, list] of Object.entries(CASES[ex])) for (const c of list) {
  const [err, prof] = Array.isArray(c) ? c : [c, {}];
  for (const op of ["right", "left"]) {
    test(`${ex} / ${view} / ${op} leg / ${err ?? "clean"}`, () => {
      const r = run(ex, view, err, prof, op);
      assert.ok(r.reps.length >= 3, `found ${r.reps.length} reps`);
      // The synthetic partial heel slide does every second rep short; those are the ones to flag.
      const reps = ex === "heel_slide" && err === "partial" ? r.reps.filter((x) => x.peak < 90) : r.reps;
      if (ex === "heel_slide" && err === "partial") {
        assert.ok(reps.length >= 1);
        for (const x of r.reps.filter((y) => y.peak >= 90)) assert.deepEqual(x.errors, []);
      }
      for (const rep of reps) {
        const ids = rep.errors.map((e) => e.id);
        if (err) assert.ok(ids.includes(err), `rep ${rep.n}: expected ${err}, got [${ids}]`);
        else assert.deepEqual(ids, [], `clean rep ${rep.n} flagged [${ids}]`);
      }
      if (!err && view === "side" && TRUTH_PEAK[ex] !== undefined || !err && ex === "side_lying_abduction") {
        for (const rep of r.reps) assert.ok(Math.abs(rep.peak - TRUTH_PEAK[ex]) < 3, `peak ${rep.peak.toFixed(1)} vs ${TRUTH_PEAK[ex]}`);
      }
    });
  }
}

test("slow reps (4 s up, 4 s down) are still counted once each", () => {
  for (const ex of ["heel_slide", "seated_knee_extension", "glute_bridge", "mini_squat"]) {
    const r = run(ex, ex === "glute_bridge" || ex === "heel_slide" || ex === "seated_knee_extension" ? "side" : "front",
      null, { rise: 4, fall: 4, hold: 2 });
    assert.equal(r.reps.length, 3, ex);
  }
});

test("15 fps and dropped frames still give the same reps", () => {
  const ex = "standing_knee_bend", frames = [];
  for (let t = 0; t < 3 * period() + 1; t += 1 / 15) {
    const { lm, W, H } = synth(ex, "side", t, { op: "left" });
    if (Math.random() < 0.15) lm.forEach((p) => { p.visibility = 0.2; });   // pose lost
    frames.push(toFrame(lm, W, H, t));
  }
  const r = analyze(frames, EXERCISES[ex], { view: "side", op: "left", good: "right", facing: facingOf(frames[0], "left") });
  assert.equal(r.reps.length, 3);
  assert.ok(r.valid.length < r.rows.length);
  for (const rep of r.reps) assert.deepEqual(rep.errors, []);
});

test("wrong leg selected: the operated leg is hidden, so frames are rejected rather than mis-measured", () => {
  const frames = [];
  for (let t = 0; t < 2 * period() + 1; t += 1 / 30) {
    const { lm, W, H } = synth("heel_slide", "side", t, { op: "right", visOp: 0.95, visGood: 0.3 });
    frames.push(toFrame(lm, W, H, t));
  }
  const r = analyze(frames, EXERCISES.heel_slide, { view: "side", op: "left", good: "right", facing: 1 });
  assert.equal(r.valid.length, 0);
  assert.equal(r.reps.length, 0);
});

test("lying exercises: rotate for the model, unrotate, same landmarks", () => {
  for (const rot of [90, -90]) {
    const { lm } = synth("straight_leg_raise", "side", 3, {});
    const back = unrotateLandmarks(rotateLandmarks(lm, rot), rot);
    lm.forEach((p, i) => {
      assert.ok(Math.abs(p.x - back[i].x) < 1e-9 && Math.abs(p.y - back[i].y) < 1e-9);
    });
  }
});

test("partial heel slide against a target angle", () => {
  const frames = [];
  for (let t = 0; t < 3 * period() + 1; t += 1 / 30) {
    const { lm, W, H } = synth("heel_slide", "side", t, {});
    frames.push(toFrame(lm, W, H, t));
  }
  const ctx = { view: "side", op: "right", good: "left", facing: 1 };
  const hi = analyze(frames, EXERCISES.heel_slide, ctx, { target: 120 });
  const lo = analyze(frames, EXERCISES.heel_slide, ctx, { target: 100 });
  assert.ok(hi.reps.every((r) => r.errors.some((e) => e.id === "partial")));
  assert.ok(lo.reps.every((r) => r.errors.length === 0));
});

test("recording that starts mid-movement still finds the starting position", () => {
  for (const [ex, view] of [["heel_slide", "side"], ["seated_knee_extension", "side"], ["mini_squat", "side"]]) {
    const frames = [];
    for (let t = 2.2; t < 3 * period() + 2.5; t += 1 / 30) {     // starts 0.7 s into the first rise
      const { lm, W, H } = synth(ex, view, t, {});
      frames.push(toFrame(lm, W, H, t));
    }
    const r = analyze(frames, EXERCISES[ex], { view, op: "right", good: "left", facing: facingOf(frames[0], "right") });
    assert.ok(r.reps.length >= 3, `${ex}: ${r.reps.length} reps`);
    for (const rep of r.reps.slice(1)) assert.deepEqual(rep.errors.map((e) => e.id), [], `${ex} rep ${rep.n}`);
  }
});
