import { synth, period } from "./synthBody.mjs";
import { toFrame, facingOf } from "../js/geometry.js";
import { analyze } from "../js/engine.js";
import { EXERCISES, ORDER } from "../js/exercises.js";
export const CASES = {
  heel_slide: { side: [null, "hip_lifts", "partial", ["too_fast", { rise: 0.8 }]] },
  straight_leg_raise: { side: [null, "knee_bends", "back_arches", "too_high"] },
  sitting_knee_bend: { side: [null, "slides_forward"] },
  standing_knee_bend: { side: [null, "thigh_swings", "trunk_leans"] },
  seated_knee_extension: { side: [null, "not_straight", "kicks_fast", "leans_back"] },
  sit_to_stand: { side: [null, "pushes_hands", "leans_far"], front: [null, "weight_shift"] },
  mini_squat: { side: [null, "too_deep", "trunk_leans"], front: [null, "knee_caves"] },
  step_up: { side: [null], front: [null, "hip_drops", "knee_caves"] },
  glute_bridge: { side: [null, "arches", "partial"], front: [null, "pelvis_tilts"] },
  side_lying_abduction: { front: [null, "hip_rolls", "too_high"] },
};
export function run(ex, view, err, prof = {}, op = "right", nReps = 3) {
  const P = period(prof), dur = nReps * P + 1.0, frames = [];
  for (let t = 0; t < dur; t += 1 / 30) {
    const { lm, W, H } = synth(ex, view, t, { op, err, prof });
    frames.push(toFrame(lm, W, H, t));
  }
  const good = op === "left" ? "right" : "left";
  const facing = view === "side" ? facingOf(frames[0], op) : 1;
  return analyze(frames, EXERCISES[ex], { view, op, good, facing });
}
if (process.argv[1]?.endsWith("run_all.mjs")) {
  for (const ex of ORDER) for (const [view, list] of Object.entries(CASES[ex])) for (const c of list) {
    const [err, prof] = Array.isArray(c) ? c : [c, {}];
    for (const op of ["right", "left"]) {
      const r = run(ex, view, err, prof, op);
      const errs = r.reps.map((x) => x.errors.map((e) => e.id).join("+") || "-").join(" | ");
      const pk = r.reps.map((x) => x.peak.toFixed(1)).join(",");
      console.log(`${ex.padEnd(22)} ${view.padEnd(5)} ${op.padEnd(5)} ${String(err).padEnd(14)} reps=${r.reps.length} valid=${r.valid.length}/${r.rows.length} peak=[${pk}] errs=${errs}`);
    }
  }
}
