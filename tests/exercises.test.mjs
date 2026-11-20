// node --test tests/
// Every exercise and camera view: a clean recording gives the right rep count and no
// errors, and each injected common error is flagged on every rep.
import test from "node:test";
import assert from "node:assert/strict";
import { CASES, run } from "./run_all.mjs";
import { synth, period, rotateLandmarks } from "./synthBody.mjs";
import { toFrame, facingOf, unrotateLandmarks } from "../js/geometry.js";
import { analyze, chooseLeg, viewCheck } from "../js/engine.js";
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

test("wrong leg selected, or the model mixes up left and right: the leg that moves is tracked", () => {
  // Every single-leg side-view exercise, with the menu set to the leg that is NOT moving.
  for (const [ex, errs] of [["heel_slide", [null, "hip_lifts"]], ["straight_leg_raise", [null, "knee_bends"]], ["sitting_knee_bend", [null, "slides_forward"]],
    ["standing_knee_bend", [null, "thigh_swings"]], ["seated_knee_extension", [null, "not_straight"]], ["step_up", [null]]]) {
    for (const err of errs) for (const moving of ["right", "left"]) {
      const frames = [];
      for (let t = 0; t < 3 * period() + 1; t += 1 / 30) {
        const { lm, W, H } = synth(ex, "side", t, { op: moving, err });
        frames.push(toFrame(lm, W, H, t));
      }
      const menu = moving === "left" ? "right" : "left";
      const r = analyze(frames, EXERCISES[ex], { view: "side", op: menu, good: moving, facing: facingOf(frames[0]) });
      assert.equal(r.leg, moving, `${ex}: tracked ${r.leg}`);
      assert.equal(r.legAuto, true);
      assert.equal(r.reps.length, 3, ex);
      for (const rep of r.reps) assert.deepEqual(rep.errors.map((e) => e.id), err ? [err] : [], `${ex} ${err}`);
    }
  }
});

test("the tracked leg doesn't flip at rest, and the previous choice is kept unless the other leg clearly moves", () => {
  const still = [], moving = [];
  for (let t = 0; t < 1.4; t += 1 / 30) { const { lm, W, H } = synth("standing_knee_bend", "side", t, { op: "right" }); still.push(toFrame(lm, W, H, t)); }
  for (let t = 0; t < 8; t += 1 / 30) { const { lm, W, H } = synth("standing_knee_bend", "side", t, { op: "right" }); moving.push(toFrame(lm, W, H, t)); }
  const v = EXERCISES.standing_knee_bend.views.side;
  assert.equal(chooseLeg(still, v, { view: "side", op: "left", facing: 1 }), "left");                    // nothing moved: keep the menu's leg
  assert.equal(chooseLeg(still, v, { view: "side", op: "left", prefer: "right", facing: 1 }), "right");  // ...or the last choice
  assert.equal(chooseLeg(moving, v, { view: "side", op: "left", facing: 1 }), "right");
});

test("one side only: with the shoulders out of the picture the leg is still measured, trunk checks are skipped", () => {
  for (const ex of ["seated_knee_extension", "standing_knee_bend", "mini_squat"]) {
    const frames = [];
    for (let t = 0; t < 3 * period() + 1; t += 1 / 30) {
      const { lm, W, H } = synth(ex, "side", t, { op: "right", err: ex === "mini_squat" ? "trunk_leans" : null });
      for (const i of [0, 11, 12, 13, 14, 15, 16]) lm[i].visibility = 0.1;      // head, shoulders, arms not seen
      frames.push(toFrame(lm, W, H, t));
    }
    const r = analyze(frames, EXERCISES[ex], { view: "side", op: "right", good: "left", facing: 1 });
    assert.equal(r.reps.length, 3, ex);
    assert.equal(r.valid.length, r.rows.length, ex);
    for (const rep of r.reps) assert.deepEqual(rep.errors, [], ex);
  }
});

test("view check: a side-on body with Front selected (and the reverse) is caught", () => {
  const rec = (ex, view) => { const fr = []; for (let t = 0; t < 4; t += 1 / 15) { const { lm, W, H } = synth(ex, view, t, {}); fr.push(toFrame(lm, W, H, t)); } return fr; };
  assert.equal(viewCheck(rec("seated_knee_extension", "side"), "front").mismatch, "side_as_front");
  assert.equal(viewCheck(rec("seated_knee_extension", "side"), "side").mismatch, null);
  assert.equal(viewCheck(rec("mini_squat", "front"), "side").mismatch, "front_as_side");
  for (const [ex, view] of [["mini_squat", "front"], ["step_up", "front"], ["sit_to_stand", "front"], ["glute_bridge", "front"], ["side_lying_abduction", "front"],
    ["heel_slide", "side"], ["glute_bridge", "side"], ["sit_to_stand", "side"]]) assert.equal(viewCheck(rec(ex, view), view).mismatch, null, `${ex}/${view}`);
});

test("a huge 'rep' at the end (getting up, walking to the phone) is rejected, not reported", () => {
  const frames = [];
  for (let t = 0; t < 3 * period() + 3; t += 1 / 30) {
    const { lm, W, H } = synth("mini_squat", "front", Math.min(t, 3 * period() + 0.5), {});
    const walk = t > 3 * period() + 1 && t < 3 * period() + 2.5 ? 0.25 : 0;       // whole body jumps down the picture
    frames.push(toFrame(lm.map((q) => ({ ...q, y: q.y + walk })), W, H, t));
  }
  const r = analyze(frames, EXERCISES.mini_squat, { view: "front", op: "right", good: "left", facing: 1 });
  assert.equal(r.reps.length, 3);
  assert.equal(r.rejected, 1);
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
