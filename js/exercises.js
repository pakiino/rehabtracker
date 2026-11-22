// The 10 knee rehab exercises from Knee_Exercises_Tracking_Spec.xlsx.
// For each camera view: which points must be visible, per-frame metrics, the rep signal,
// per-rep measures and the common-error checks.
//
// THRESHOLDS are team-chosen screening defaults for a course prototype, not clinical
// standards. Angles are in degrees from 2D video (several degrees of error); distances
// are fractions of a body segment so they do not depend on how far the camera is.
import {
  vis, mid, dist, angle, flexion, leanFromUp, tiltFromHorizontal, distToSegment,
  heightAboveLine, median, robustMax,
} from "./geometry.js";
import { topRows } from "./engine.js";

// Calibrated 2026-11-20 against a PT-approved recording session (2 people, side views):
// every rep was approved (mini squat included) except standing knee bend reps 11-12 (trunk lean) and side-lying
// abduction reps 2 and 10 (too high). Each limit sits just outside the approved reps.
// Small sample: re-check with more people before clinical use.
export const T = {
  heel_slide: { hipLift: 0.12, riseS: 0.8, partial: 0.7 },
  slr: { kneeBend: 13, trunkMove: 8, tooHigh: 72 },
  sitting_bend: { hipForward: 0.10 },
  standing_bend: { thighForward: 20, trunkLean: 4 },
  seated_ext: { notStraight: 18, kickS: 0.6, leanBack: 10 },
  sit_to_stand: { handsFrac: 0.3, handsDist: 0.25, trunkLean: 62, weightShift: 0.15 },
  mini_squat: { tooDeep: 72, trunkLean: 36, valgus: 10 },
  step_up: { hipDrop: 6, valgus: 10 },
  bridge: { arch: 195, partial: 165, pelvisTilt: 6 },
  abduction: { roll: 15, tooHigh: 45 },
};

// ---------- shared metric helpers ----------
// Side views use ONE side of the body: the tracked leg and the shoulder on the same side
// (in a side view the two shoulders overlap, so the other one stands in if it is the clearer).
const otherSide = (s) => (s === "left" ? "right" : "left");
const shoulderOf = (f, s) => (vis(f.shoulder[s]) || !vis(f.shoulder[otherSide(s)]) ? f.shoulder[s] : f.shoulder[otherSide(s)]);
const hipMid = (f) => mid(f.hip.left, f.hip.right);
const legOk = (f, s) => vis(f.hip[s], f.knee[s], f.ankle[s]);
const kneeFlex = (f, s) => flexion(f.hip[s], f.knee[s], f.ankle[s]);
const thighLen = (f, s) => dist(f.hip[s], f.knee[s]);
const hipWidth = (f) => dist(f.hip.left, f.hip.right);
// Signed trunk lean from vertical (hip -> shoulder on the tracked side); + = forward (facing
// direction). NaN when no shoulder is visible: the trunk checks are then skipped, the leg is still measured.
const trunkLean = (f, s, facing) => (vis(shoulderOf(f, s)) ? leanFromUp(f.hip[s], shoulderOf(f, s), facing) : NaN);
// Signed thigh angle from vertical-down; + = knee in front of the hip.
const thighForward = (f, s, facing) => {
  const h = f.hip[s], k = f.knee[s];
  return (Math.atan2((k[0] - h[0]) * facing, k[1] - h[1]) * 180) / Math.PI;
};
// Front view: how far the knee sits inside the hip-ankle line, in pixels (+ = toward the
// body's midline). Turned into an angle with the STANDING leg length (kneeInDeg), not the
// leg as drawn in that frame: a bent knee points at the camera, the leg looks short, and the
// plain hip-knee-ankle angle then explodes (it read 55 degrees on a real step-up).
function kneeInPx(f, s) {
  const h = f.hip[s], k = f.knee[s], a = f.ankle[s];
  if (Math.abs(a[1] - h[1]) < 1) return NaN;
  const lineX = h[0] + (a[0] - h[0]) * (k[1] - h[1]) / (a[1] - h[1]);
  return (k[0] - lineX) * (Math.sign(hipMid(f)[0] - h[0]) || 1);
}
const legLen = (f, s) => dist(f.hip[s], f.knee[s]) + dist(f.knee[s], f.ankle[s]);
const deg = (r) => (r * 180) / Math.PI;
// Same number as the hip-knee-ankle angle when the leg is nearly straight and seen from the front.
const kneeInDeg = (px, standingLegLen) => 2 * deg(Math.atan((2 * px) / standingLegLen));
// Shoulder-hip-knee angle, signed so 180 = straight line, > 180 = hips pushed above the line.
function hipLine(f, s) {
  const sh = shoulderOf(f, s), h = f.hip[s], k = f.knee[s];
  const a = angle(sh, h, k);
  return heightAboveLine(h, sh, k) > 0 ? 360 - a : a;
}
const deltaMax = (rows, key, base, sign = 1) => robustMax(rows.map((r) => sign * (r[key] - base[key])));
const absDeltaMax = (rows, key, base) => robustMax(rows.map((r) => Math.abs(r[key] - base[key])));
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "--");

// ---------- exercises ----------
export const EXERCISES = {
  heel_slide: {
    label: "Heel slide", start: "Lying on back", tracks: "Shoulder, hip, knee, ankle, heel (operated leg)",
    views: {
      side: {
        lying: true,
        setup: "Lie on your back, side-on to the phone (landscape, on the floor, about 2 m away, operated leg nearest). " +
               "Slowly slide the heel toward your buttock as far as you can, then back. Repeat.",
        autoLeg: "moving",
        metrics: (f, { leg }) => {
          const ok = legOk(f, leg);
          return { ok, knee: ok ? kneeFlex(f, leg) : NaN, hipY: f.hip[leg][1], thigh: thighLen(f, leg) };
        },
        signal: { key: "knee", dir: 1, start: 20, end: 10, minExcursion: 25, label: "Knee bend", unit: "°" },
        measure: (rep) => ({
          knee_bend: rep.peak,
          hip_lift: deltaMax(rep.rows, "hipY", rep.base, -1) / rep.base.thigh,
        }),
        summaryKeys: ["knee_bend", "rise_s", "hip_lift"],
        checks: [
          { id: "hip_lifts", label: (r) => `Hip lifts (${fmt(r.hip_lift * 100)}% of thigh length)`, test: (r) => r.hip_lift > T.heel_slide.hipLift },
          { id: "too_fast", label: (r) => `Too fast (bend in ${fmt(r.rise_s, 1)} s)`, test: (r) => r.rise_s < T.heel_slide.riseS },
          { id: "partial", session: true, label: (r) => `Partial bend (${fmt(r.peak)}°)`,
            test: (r, { reps, opts }) => (opts?.target ? r.peak < opts.target - 5
              : reps.length > 1 && r.peak < T.heel_slide.partial * Math.max(...reps.map((x) => x.peak))) },
        ],
        live: (m, b) => ((b.hipY - m.hipY) / b.thigh > T.heel_slide.hipLift ? "Keep your hip down on the bed" : null),
      },
    },
  },

  straight_leg_raise: {
    label: "Straight leg raise", start: "Lying on back", tracks: "Shoulder, hip, knee, ankle (operated leg)",
    views: {
      side: {
        lying: true,
        setup: "Lie on your back, side-on to the phone (landscape, on the floor, operated leg nearest). Bend the other knee. " +
               "Tighten the thigh, lift the straight leg to the height of the other knee, hold, lower slowly.",
        autoLeg: "moving",
        metrics: (f, { leg }) => {
          const sh = shoulderOf(f, leg);
          const ok = legOk(f, leg) && vis(sh);
          return { ok, lift: ok ? flexion(sh, f.hip[leg], f.knee[leg]) : NaN, knee: ok ? kneeFlex(f, leg) : NaN,
                   trunk: ok ? leanFromUp(f.hip[leg], sh) : NaN };
        },
        signal: { key: "lift", dir: 1, start: 15, end: 8, minExcursion: 20, label: "Leg lift", unit: "°" },
        measure: (rep, ctx) => {
          const top = topRows(rep, ctx.signal ?? EXERCISES.straight_leg_raise.views.side.signal);
          return { lift: rep.peak, knee_bend_top: median(top.map((r) => r.knee)), trunk_move: absDeltaMax(rep.rows, "trunk", rep.base) };
        },
        summaryKeys: ["lift", "knee_bend_top", "trunk_move"],
        checks: [
          { id: "knee_bends", label: (r) => `Knee bends during the lift (${fmt(r.knee_bend_top)}°)`, test: (r) => r.knee_bend_top > T.slr.kneeBend },
          { id: "back_arches", label: (r) => `Back arches / trunk moves (${fmt(r.trunk_move)}°)`, test: (r) => r.trunk_move > T.slr.trunkMove },
          { id: "too_high", label: (r) => `Lifts too high (${fmt(r.lift)}°)`, test: (r) => r.lift > T.slr.tooHigh },
        ],
        live: (m, b) => (m.lift - b.lift > 15 && m.knee > T.slr.kneeBend ? "Keep the knee straight: tighten the thigh"
          : m.lift > T.slr.tooHigh ? "Lift only to the height of the other knee" : null),
      },
    },
  },

  sitting_knee_bend: {
    label: "Sitting knee bend", start: "Seated on chair", tracks: "Shoulder, hip, knee, ankle, heel (operated leg)",
    views: {
      side: {
        setup: "Sit side-on on a firm chair, phone at knee height about 2 m away, operated leg nearest. " +
               "Slide the foot back under the chair to bend the knee as far as you can, hold, return.",
        autoLeg: "moving",
        metrics: (f, { leg }) => {
          const ok = legOk(f, leg);
          return { ok, knee: ok ? kneeFlex(f, leg) : NaN, hipX: f.hip[leg][0], thigh: thighLen(f, leg) };
        },
        signal: { key: "knee", dir: 1, start: 8, end: 4, minExcursion: 10, label: "Knee bend", unit: "°" },
        measure: (rep, { facing }) => ({
          knee_bend: rep.peak,
          hip_forward: robustMax(rep.rows.map((r) => (r.hipX - rep.base.hipX) * facing)) / rep.base.thigh,
        }),
        summaryKeys: ["knee_bend", "hip_forward"],
        checks: [
          { id: "slides_forward", label: (r) => `Slides body forward instead of bending the knee (${fmt(r.hip_forward * 100)}% of thigh)`,
            test: (r) => r.hip_forward > T.sitting_bend.hipForward },
        ],
        live: (m, b, { facing }) => ((m.hipX - b.hipX) * facing / b.thigh > T.sitting_bend.hipForward ? "Keep your hips back; bend the knee" : null),
      },
    },
  },

  standing_knee_bend: {
    label: "Standing knee bend", start: "Standing, holding chair", tracks: "Hip, knee, ankle of the bending leg (shoulder for the trunk check)",
    views: {
      side: {
        setup: "Stand side-on holding a chair, operated leg nearest the phone. Bend the knee to bring the heel toward your buttock, keeping the thigh pointing down.",
        autoLeg: "moving",
        metrics: (f, { leg, facing }) => {
          const ok = legOk(f, leg);
          return { ok, knee: ok ? kneeFlex(f, leg) : NaN, thigh: thighForward(f, leg, facing), trunk: trunkLean(f, leg, facing) };
        },
        signal: { key: "knee", dir: 1, start: 20, end: 10, minExcursion: 30, label: "Knee bend", unit: "°" },
        measure: (rep, ctx) => {
          const top = topRows(rep, EXERCISES.standing_knee_bend.views.side.signal, 0.5);
          return { knee_bend: rep.peak, thigh_forward: robustMax(top.map((r) => r.thigh)), trunk_lean: absDeltaMax(rep.rows, "trunk", rep.base) };
        },
        summaryKeys: ["knee_bend", "thigh_forward", "trunk_lean"],
        checks: [
          { id: "thigh_swings", label: (r) => `Thigh swings forward (${fmt(r.thigh_forward)}°)`, test: (r) => r.thigh_forward > T.standing_bend.thighForward },
          { id: "trunk_leans", label: (r) => `Trunk leans (${fmt(r.trunk_lean)}°)`, test: (r) => r.trunk_lean > T.standing_bend.trunkLean },
        ],
        live: (m, b) => (m.thigh > T.standing_bend.thighForward ? "Keep the thigh pointing straight down"
          : Math.abs(m.trunk - b.trunk) > T.standing_bend.trunkLean ? "Stand tall" : null),
      },
    },
  },

  seated_knee_extension: {
    label: "Seated knee extension", start: "Seated on chair", tracks: "Hip, knee, ankle of the straightening leg (shoulder for the trunk check)",
    views: {
      side: {
        setup: "Sit side-on on a chair, operated leg nearest the phone. Slowly straighten the knee fully, hold, then lower.",
        autoLeg: "moving",
        metrics: (f, { leg, facing }) => {
          const ok = legOk(f, leg);
          return { ok, knee: ok ? kneeFlex(f, leg) : NaN, trunk: trunkLean(f, leg, facing) };
        },
        signal: { key: "knee", dir: -1, start: 20, end: 10, minExcursion: 30, label: "Knee angle", unit: "°" },
        measure: (rep) => ({ short_of_straight: rep.peak, lean_back: deltaMax(rep.rows, "trunk", rep.base, -1) }),
        summaryKeys: ["short_of_straight", "rise_s", "lean_back"],
        checks: [
          { id: "not_straight", label: (r) => `Doesn't fully straighten (${fmt(r.peak)}° short)`, test: (r) => r.peak > T.seated_ext.notStraight },
          { id: "kicks_fast", label: (r) => `Kicks fast (straightened in ${fmt(r.rise_s, 1)} s)`, test: (r) => r.rise_s < T.seated_ext.kickS },
          { id: "leans_back", label: (r) => `Leans back (${fmt(r.lean_back)}°)`, test: (r) => r.lean_back > T.seated_ext.leanBack },
        ],
        live: (m, b) => (b.trunk - m.trunk > T.seated_ext.leanBack ? "Sit tall; don't lean back" : null),
      },
    },
  },

  sit_to_stand: {
    label: "Sit-to-stand", start: "Seated → standing", tracks: "Shoulders, hips, knees, ankles (both legs), wrists",
    views: {
      side: {
        setup: "Sit side-on on a firm chair, arms crossed on your chest, phone about 2–3 m away. Stand up fully, then sit down slowly. Repeat.",
        autoLeg: "visible",
        metrics: (f, { leg: s, facing }) => {
          const ok = legOk(f, s);
          const th = thighLen(f, s);
          const wd = ["left", "right"].filter((w) => vis(f.wrist[w]) && legOk(f, w))
            .map((w) => distToSegment(f.wrist[w], f.hip[w], f.knee[w]) / th);
          return { ok, knee: ok ? kneeFlex(f, s) : NaN, trunk: trunkLean(f, s, facing), wristThigh: wd.length ? Math.min(...wd) : NaN };
        },
        signal: { key: "knee", dir: -1, start: 25, end: 12, minExcursion: 40, label: "Knee angle", unit: "°" },
        measure: (rep) => {
          const rise = rep.rows.slice(0, rep.peakIndex + 1);
          const near = rise.filter((r) => r.wristThigh < T.sit_to_stand.handsDist).length;
          return { knee_at_stand: rep.peak, trunk_lean_max: robustMax(rep.rows.map((r) => r.trunk)),
                   hands_on_thighs: rise.length ? near / rise.length : 0 };
        },
        summaryKeys: ["knee_at_stand", "trunk_lean_max", "rise_s"],
        checks: [
          { id: "pushes_hands", label: (r) => `Pushes with hands (${fmt(r.hands_on_thighs * 100)}% of the rise)`, test: (r) => r.hands_on_thighs > T.sit_to_stand.handsFrac },
          { id: "leans_far", label: (r) => `Leans too far forward (${fmt(r.trunk_lean_max)}°)`, test: (r) => r.trunk_lean_max > T.sit_to_stand.trunkLean },
        ],
        live: (m) => (m.wristThigh < T.sit_to_stand.handsDist ? "Cross your arms; stand with your legs"
          : m.trunk > T.sit_to_stand.trunkLean ? "Less forward lean" : null),
      },
      front: {
        setup: "Sit facing the phone, arms crossed, both feet flat, phone 2–3 m away at hip height. Stand up fully, then sit down slowly.",
        metrics: (f, { op, good }) => {
          const ok = vis(f.hip.left, f.hip.right, f.ankle.left, f.ankle.right);
          const hw = hipWidth(f);
          const am = mid(f.ankle.left, f.ankle.right), hm = hipMid(f);
          const towardGood = Math.sign(f.ankle[good][0] - f.ankle[op][0]) || 1;
          return { ok, hipUp: -hm[1], hw, shift: (hm[0] - am[0]) * towardGood / hw };
        },
        signal: { key: "hipUp", scale: "hw", dir: 1, start: 0.5, end: 0.25, minExcursion: 0.8, label: "Hip height", unit: "hip widths" },
        measure: (rep) => ({ weight_shift: deltaMax(rep.rows, "shift", rep.base) }),
        summaryKeys: ["weight_shift"],
        checks: [
          { id: "weight_shift", label: (r) => `Shifts weight to the good leg (${fmt(r.weight_shift * 100)}% of hip width)`, test: (r) => r.weight_shift > T.sit_to_stand.weightShift },
        ],
        live: (m, b) => (m.shift - b.shift > T.sit_to_stand.weightShift ? "Keep your weight even on both legs" : null),
      },
    },
  },

  mini_squat: {
    label: "Mini squat", start: "Standing, holding chair", tracks: "Shoulders, hips, knees, ankles, toes (both legs)",
    views: {
      side: {
        setup: "Stand side-on holding a chair, phone 2–3 m away at hip height. Bend both knees a little (mini squat), then straighten.",
        autoLeg: "visible",
        metrics: (f, { leg, facing }) => {
          const ok = legOk(f, leg);
          return { ok, knee: ok ? kneeFlex(f, leg) : NaN, trunk: trunkLean(f, leg, facing) };
        },
        signal: { key: "knee", dir: 1, start: 10, end: 5, minExcursion: 15, label: "Knee bend", unit: "°" },
        measure: (rep) => ({ depth: rep.peak, trunk_lean: deltaMax(rep.rows, "trunk", rep.base) }),
        summaryKeys: ["depth", "trunk_lean"],
        checks: [
          { id: "too_deep", label: (r) => `Squats too deep (${fmt(r.depth)}°)`, test: (r) => r.depth > T.mini_squat.tooDeep },
          { id: "trunk_leans", label: (r) => `Trunk leans forward (${fmt(r.trunk_lean)}°)`, test: (r) => r.trunk_lean > T.mini_squat.trunkLean },
        ],
        live: (m, b) => (m.knee > T.mini_squat.tooDeep ? "Only a small bend"
          : m.trunk - b.trunk > T.mini_squat.trunkLean ? "Keep your chest up" : null),
      },
      front: {
        setup: "Stand facing the phone holding a chair, feet hip-width apart, phone 2–3 m away at hip height. Bend both knees a little, then straighten.",
        metrics: (f) => {
          const ok = legOk(f, "left") && legOk(f, "right");
          return { ok, hipDown: hipMid(f)[1], hw: hipWidth(f), inL: kneeInPx(f, "left"), inR: kneeInPx(f, "right"),
                   lenL: legLen(f, "left"), lenR: legLen(f, "right") };
        },
        signal: { key: "hipDown", scale: "hw", dir: 1, start: 0.06, end: 0.03, minExcursion: 0.09, label: "Hip drop", unit: "hip widths" },
        measure: (rep) => {
          const top = topRows(rep, EXERCISES.mini_squat.views.front.signal, 0.5);
          return { valgus_left: kneeInDeg(robustMax(top.map((r) => r.inL - rep.base.inL)), rep.base.lenL),
                   valgus_right: kneeInDeg(robustMax(top.map((r) => r.inR - rep.base.inR)), rep.base.lenR) };
        },
        summaryKeys: ["valgus_left", "valgus_right"],
        checks: [
          { id: "knee_caves", label: (r) => `Knee caves in (left ${fmt(r.valgus_left)}°, right ${fmt(r.valgus_right)}°)`,
            test: (r) => Math.max(r.valgus_left, r.valgus_right) > T.mini_squat.valgus },
        ],
        live: (m, b) => (Math.max(kneeInDeg(m.inL - b.inL, b.lenL), kneeInDeg(m.inR - b.inR, b.lenR)) > T.mini_squat.valgus ? "Push your knees out over your toes" : null),
      },
    },
  },

  step_up: {
    label: "Step-up", start: "Standing at a low step", tracks: "Shoulders, both hips, knees, ankles, toes, wrists",
    notMeasured: ["Pulling with the rail: a camera can't see force. The app only reports when a hand is on the rail."],
    views: {
      side: {
        setup: "Stand side-on at a low step, operated leg nearest the phone. Step up with the operated leg, straighten it fully, step back down.",
        // Counted from the stepping foot: it lifts onto the step and stays there until it comes
        // back down. This works for a full step-up and for a low step where the body barely rises
        // (the hip rose only ~0.1 thigh lengths on a low stool in real recordings, too little to count).
        autoLeg: "knee",       // the stepping leg is the one whose knee bends most
        metrics: (f, { leg }) => {
          const ok = legOk(f, leg);
          const w = ["left", "right"].filter((s) => vis(f.wrist[s])).map((s) => f.wrist[s][1] < f.hip[s][1] ? 1 : 0);
          return { ok, footUp: -f.ankle[leg][1], shank: dist(f.knee[leg], f.ankle[leg]), hipUp: -f.hip[leg][1], thigh: thighLen(f, leg),
                   knee: ok ? kneeFlex(f, leg) : NaN, handHigh: w.length ? Math.max(...w) : 0 };
        },
        signal: { key: "footUp", scale: "shank", dir: 1, start: 0.12, end: 0.06, minExcursion: 0.18, label: "Foot on the step", unit: "shank lengths" },
        measure: (rep) => {
          const th = median(rep.rows.map((r) => r.thigh)) || 1, hips = rep.rows.map((r) => r.hipUp);
          return { knee_max: robustMax(rep.rows.map((r) => r.knee)), body_rise: (robustMax(hips) - Math.min(...hips.filter(Number.isFinite))) / th,
                   hand_on_rail: median(rep.rows.map((r) => r.handHigh)) >= 0.5 };
        },
        summaryKeys: ["knee_max", "body_rise", "hand_on_rail"],
        checks: [],
      },
      front: {
        setup: "Stand facing the phone at a low step, phone 2–3 m away at hip height. Step up with the operated leg, straighten it, step back down.",
        metrics: (f, { op, good }) => {
          const ok = vis(f.hip.left, f.hip.right) && legOk(f, op);
          const hw = hipWidth(f);
          // dropPx: + when the hip on the non-stepping side is lower than the stepping side.
          return { ok, hipUp: -hipMid(f)[1], hw, dropPx: f.hip[good][1] - f.hip[op][1], inPx: kneeInPx(f, op), len: legLen(f, op) };
        },
        signal: { key: "hipUp", scale: "hw", dir: 1, start: 0.2, end: 0.1, minExcursion: 0.3, label: "Body rise", unit: "hip widths" },
        // Judged only while the body is up on the stepping leg, not at the start, where the
        // foot is on the step, the knee points at the camera and the pelvis is naturally tilted.
        // Hip drop: upper half of the rise. Knee: from 30% of the rise on, scaled by the leg
        // length at its straightest in this rep.
        measure: (rep) => {
          const sig = EXERCISES.step_up.views.front.signal;
          const up = topRows(rep, sig, 0.3), top = topRows(rep, sig, 0.5);
          return { hip_drop: deg(Math.atan(robustMax(top.map((r) => r.dropPx)) / rep.base.hw)),
                   valgus: kneeInDeg(robustMax(up.map((r) => r.inPx)), robustMax(rep.rows.map((r) => r.len))) };
        },
        summaryKeys: ["hip_drop", "valgus"],
        checks: [
          { id: "hip_drops", label: (r) => `Hip drops on the other side (${fmt(r.hip_drop)}°)`, test: (r) => r.hip_drop > T.step_up.hipDrop },
          { id: "knee_caves", label: (r) => `Knee caves in (${fmt(r.valgus)}°)`, test: (r) => r.valgus > T.step_up.valgus },
        ],
        live: (m, b) => ((m.hipUp - b.hipUp) / b.hw < 0.3 ? null       // only once the body has risen
          : deg(Math.atan(m.dropPx / b.hw)) > T.step_up.hipDrop ? "Keep your hips level"
          : kneeInDeg(m.inPx, Math.max(m.len, b.len)) > T.step_up.valgus ? "Knee over your toes" : null),
      },
    },
  },

  glute_bridge: {
    label: "Glute bridge", start: "Lying, knees bent", tracks: "Shoulders, hips, knees, ankles (both legs)",
    views: {
      side: {
        lying: true,
        setup: "Lie on your back with knees bent, side-on to the phone (landscape, on the floor). Squeeze your glutes and lift the hips until shoulders, hips and knees are in a line, hold, lower.",
        autoLeg: "visible",
        metrics: (f, { leg }) => {
          const ok = vis(shoulderOf(f, leg), f.hip[leg], f.knee[leg]);
          return { ok, line: ok ? hipLine(f, leg) : NaN };
        },
        signal: { key: "line", dir: 1, start: 10, end: 5, minExcursion: 12, label: "Shoulder–hip–knee", unit: "°" },
        measure: (rep) => ({ top_line: rep.peak }),
        summaryKeys: ["top_line"],
        checks: [
          { id: "arches", label: (r) => `Arches the back: hips pushed past a straight line (${fmt(r.top_line)}°)`, test: (r) => r.top_line > T.bridge.arch },
          { id: "partial", label: (r) => `Hips not lifted to a straight line (${fmt(r.top_line)}°)`, test: (r) => r.top_line < T.bridge.partial },
        ],
        live: (m) => (m.line > T.bridge.arch ? "Squeeze the glutes; stop when your body is straight" : null),
      },
      front: {
        setup: "Lie on your back with knees bent, phone at your feet looking toward you. Lift the hips, keeping them level.",
        metrics: (f) => {
          const ok = vis(f.hip.left, f.hip.right);
          return { ok, hipUp: -hipMid(f)[1], hw: hipWidth(f), tilt: Math.abs(tiltFromHorizontal(f.hip.left, f.hip.right)) };
        },
        signal: { key: "hipUp", scale: "hw", dir: 1, start: 0.15, end: 0.08, minExcursion: 0.25, label: "Hip lift", unit: "hip widths" },
        measure: (rep) => ({ pelvis_tilt: robustMax(rep.rows.map((r) => r.tilt)) }),
        summaryKeys: ["pelvis_tilt"],
        checks: [
          { id: "pelvis_tilts", label: (r) => `Pelvis tilts (${fmt(r.pelvis_tilt)}°)`, test: (r) => r.pelvis_tilt > T.bridge.pelvisTilt },
        ],
        live: (m) => (m.tilt > T.bridge.pelvisTilt ? "Keep your hips level" : null),
      },
    },
  },

  side_lying_abduction: {
    label: "Side-lying hip abduction", start: "Lying on side", tracks: "Shoulders, both hips, knees, ankles",
    views: {
      front: {
        lying: true,
        setup: "Lie on your side with the operated leg on top, facing the phone (landscape, on the floor, about 2 m away). " +
               "Lift the top leg straight up a little, keeping the hips stacked, then lower.",
        metrics: (f, { op, good }) => {
          const ok = legOk(f, op) && legOk(f, good);
          const v1 = [f.ankle[op][0] - f.hip[op][0], f.ankle[op][1] - f.hip[op][1]];
          const v2 = [f.ankle[good][0] - f.hip[good][0], f.ankle[good][1] - f.hip[good][1]];
          const spread = angle([f.hip[op][0] + v1[0], f.hip[op][1] + v1[1]], f.hip[op], [f.hip[op][0] + v2[0], f.hip[op][1] + v2[1]]);
          const pelvis = (Math.atan2(f.hip[op][0] - f.hip[good][0], f.hip[good][1] - f.hip[op][1]) * 180) / Math.PI;
          return { ok, spread, pelvis };
        },
        signal: { key: "spread", dir: 1, start: 10, end: 5, minExcursion: 15, label: "Leg lift", unit: "°" },
        measure: (rep) => ({ lift: rep.peak, pelvis_roll: absDeltaMax(rep.rows, "pelvis", rep.base) }),
        summaryKeys: ["lift", "pelvis_roll"],
        checks: [
          { id: "hip_rolls", label: (r) => `Hip rolls backward (pelvis turns ${fmt(r.pelvis_roll)}°)`, test: (r) => r.pelvis_roll > T.abduction.roll },
          { id: "too_high", label: (r) => `Lifts too high (${fmt(r.lift)}°)`, test: (r) => r.lift > T.abduction.tooHigh },
        ],
        live: (m, b) => (Math.abs(m.pelvis - b.pelvis) > T.abduction.roll ? "Keep the top hip stacked over the bottom one"
          : m.spread > T.abduction.tooHigh ? "Lower: lift only a little" : null),
      },
    },
  },
};

export const ORDER = ["heel_slide", "straight_leg_raise", "sitting_knee_bend", "standing_knee_bend", "seated_knee_extension",
  "sit_to_stand", "mini_squat", "step_up", "glute_bridge", "side_lying_abduction"];
for (const id of ORDER) EXERCISES[id].id = id;
