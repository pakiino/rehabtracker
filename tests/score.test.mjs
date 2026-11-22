import test from "node:test";
import assert from "node:assert/strict";
import { scoreRep5 } from "../js/score.js";
import { REFERENCE } from "../js/reference.js";

const ref = REFERENCE.heel_slide;
const rep = (over = {}) => ({ n: 1, excursion: ref.movement.p50, duration_s: ref.duration.p50, errors: [], ...over });

test("a rep like the reference scores 5", () => assert.equal(scoreRep5(rep(), "heel_slide").score, 5));
test("one form error costs 2 points", () => {
  const s = scoreRep5(rep({ errors: [{ id: "hip_lifts" }] }), "heel_slide");
  assert.equal(s.score, 3); assert.deepEqual(s.reasons, ["hip_lifts"]);
});
test("moving clearly less than the reference costs 1", () =>
  assert.equal(scoreRep5(rep({ excursion: ref.movement.p10 - 0.2 * ref.movement.p50 }), "heel_slide").score, 4));
test("moving much less costs 2", () => assert.equal(scoreRep5(rep({ excursion: 0.5 * ref.movement.p50 }), "heel_slide").score, 3));
test("much quicker than any approved rep costs 1", () =>
  assert.equal(scoreRep5(rep({ duration_s: 0.5 * ref.duration.p10 }), "heel_slide").score, 4));
test("a speed error is not counted twice", () =>
  assert.equal(scoreRep5(rep({ duration_s: 0.5 * ref.duration.p10, errors: [{ id: "too_fast" }] }), "heel_slide").score, 3));
test("score never drops below 1", () =>
  assert.equal(scoreRep5(rep({ excursion: 1, errors: [{ id: "a" }, { id: "b" }, { id: "c" }] }), "heel_slide").score, 1));
test("every exercise has a reference range", () => {
  for (const ex of ["heel_slide", "straight_leg_raise", "sitting_knee_bend", "standing_knee_bend", "seated_knee_extension",
    "sit_to_stand", "mini_squat", "step_up", "glute_bridge", "side_lying_abduction"]) assert.ok(REFERENCE[ex]?.movement.p50 > 0, ex);
});
