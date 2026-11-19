// Scoring: turns an analyze() result into a 0-100 score per rep and per session.
// Pure functions only. Weights and targets are PROTOTYPE DEFAULTS for the PT to review.
//
// Rep score = Movement (how far, vs. the PT's target)  50 pts
//           + Form     (no common errors)               35 pts
//           + Control  (not rushed)                     15 pts
// If no target is set for an exercise, Movement is left out and Form + Control are
// scaled to 100. A session is not scored at all when tracking was unreliable.
import { dist, median } from "./geometry.js";

export const POINTS = { movement: 50, form: 35, control: 15 };
export const PENALTY = { form: 20, control: 15 };          // per error, floor at 0
export const QUALITY = { visible: 0.8, steady: 0.8, jump: 0.25 };

// Per exercise: how to read the movement amount, its default target, which checks are
// about speed (control), and which checks the Movement part already covers.
export const SCORE = {
  heel_slide: {
    movement: (rep) => rep.knee_bend, unit: "°",
    target: 77,   // mean peak knee bend of the draft reference profile; replace with the PT's target
    control: ["too_fast"], coveredByMovement: ["partial"],
    reference: { p10: 67, p90: 89 },   // draft reference profile (2 clips, 7 reps), for PT flags only
  },
  straight_leg_raise: { movement: (rep) => rep.lift, unit: "°", target: null, control: [] },
  sitting_knee_bend: { movement: (rep) => rep.peak, unit: "°", target: null, control: [] },
  standing_knee_bend: { movement: (rep) => rep.peak, unit: "°", target: null, control: [] },
  seated_knee_extension: { movement: null, target: null, control: ["kicks_fast"] },
  sit_to_stand: { movement: null, target: null, control: [] },
  mini_squat: { movement: null, target: null, control: [] },
  step_up: { movement: null, target: null, control: [] },
  glute_bridge: { movement: null, target: null, control: [] },
  side_lying_abduction: { movement: (rep) => rep.lift ?? rep.peak, unit: "°", target: null, control: [] },
};

export function band(score) {
  if (score == null) return { label: "Can't score", note: "Tracking was unreliable. Check the camera and try again." };
  if (score >= 85) return { label: "Great", note: "Keep it up." };
  if (score >= 70) return { label: "Good", note: "A small fix will help." };
  if (score >= 50) return { label: "Keep practicing", note: "Focus on the main fix below." };
  return { label: "Ask your PT", note: "Show this result to your physical therapist." };
}

/** Share of frames where the operated leg's thigh and shin keep a steady length. */
export function trackingQuality(frames, result, op) {
  const visible = result.rows.length ? result.valid.length / result.rows.length : 0;
  const lens = frames.map((f) => {
    const h = f.hip?.[op], k = f.knee?.[op], a = f.ankle?.[op];
    return h && k && a ? [dist(h, k), dist(k, a)] : null;
  });
  let ok = 0, n = 0;
  for (let i = 0; i < lens.length; i++) {
    if (!lens[i]) continue;
    const t = frames[i].t, win = [];
    for (let j = 0; j < lens.length; j++) if (lens[j] && Math.abs(frames[j].t - t) <= 0.5) win.push(lens[j]);
    const mt = median(win.map((w) => w[0])), ms = median(win.map((w) => w[1]));
    n++;
    if (Math.abs(lens[i][0] - mt) <= QUALITY.jump * mt && Math.abs(lens[i][1] - ms) <= QUALITY.jump * ms) ok++;
  }
  const steady = n ? ok / n : 0;
  return { visible, steady, reliable: visible >= QUALITY.visible && steady >= QUALITY.steady };
}

export function scoreRep(rep, exId, opts = {}) {
  const cfg = SCORE[exId] ?? { movement: null, target: null, control: [] };
  const target = opts.target ?? cfg.target;
  const useMovement = !!cfg.movement && Number.isFinite(target) && target > 0;
  const skip = useMovement ? cfg.coveredByMovement ?? [] : [];
  const errs = rep.errors.map((e) => e.id).filter((id) => !skip.includes(id));
  const ctrlErrs = errs.filter((id) => cfg.control.includes(id));
  const formErrs = errs.filter((id) => !cfg.control.includes(id));

  const parts = {
    form: Math.max(0, POINTS.form - PENALTY.form * formErrs.length),
    control: Math.max(0, POINTS.control - PENALTY.control * ctrlErrs.length),
  };
  let max = POINTS.form + POINTS.control;
  if (useMovement) {
    const amount = cfg.movement(rep);
    parts.movement = Number.isFinite(amount) ? POINTS.movement * Math.min(1, Math.max(0, amount / target)) : 0;
    max += POINTS.movement;
  }
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    n: rep.n, score: Math.round((100 * total) / max),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v)])),
    max_parts: { ...(useMovement ? { movement: POINTS.movement } : {}), form: POINTS.form, control: POINTS.control },
    lost_for: errs,
  };
}

/**
 * @param result  analyze() output
 * @param frames  the frames passed to analyze (for the tracking-quality gate)
 * @param exId    exercise id
 * @param ctx     {op, ...} as passed to analyze
 * @param opts    {target: PT movement target, prescribedReps: number}
 */
export function scoreSession(result, frames, exId, ctx, opts = {}) {
  const quality = trackingQuality(frames, result, ctx.op);
  const cfg = SCORE[exId] ?? {};
  const target = opts.target ?? cfg.target ?? null;
  const base = { exercise: exId, quality, movement_target: target, movement_unit: cfg.unit ?? null,
    weights: { points: POINTS, penalty: PENALTY }, note: "Prototype scoring weights, not a clinical score." };
  if (!quality.reliable) return { ...base, score: null, band: band(null), reps: [] };
  const reps = result.reps.map((r) => scoreRep(r, exId, opts));
  if (!reps.length) return { ...base, score: null, band: { label: "No reps", note: "No full reps were found." }, reps };
  // Score = how well the reps were done. Completion is reported separately, so a
  // patient who stops early to avoid pain isn't told their form was bad.
  const score = Math.round(reps.reduce((a, r) => a + r.score, 0) / reps.length);
  const completion = opts.prescribedReps ? Math.min(1, reps.length / opts.prescribedReps) : null;
  const counts = {};
  for (const r of reps) for (const id of r.lost_for) counts[id] = (counts[id] || 0) + 1;
  const mainFix = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { ...base, score, band: band(score), completion, main_fix: mainFix, reps };
}

// ---------- two views of the same session ----------
const FIX_TEXT = {
  hip_lifts: "Keep your hip down on the bed", too_fast: "Slide more slowly",
  partial: "Bend a little further if it's comfortable", knee_bends: "Keep the knee straight as you lift",
  back_arches: "Keep your back flat", too_high: "Don't lift so high", slides_forward: "Bend the knee, don't slide your body",
  thigh_swings: "Keep your thigh still", trunk_leans: "Stand up tall", not_straight: "Straighten the knee fully",
  kicks_fast: "Straighten slowly", leans_back: "Sit up straight", pushes_hands: "Try not to push with your hands",
  leans_far: "Don't lean so far forward", weight_shift: "Keep weight on both legs", too_deep: "Don't squat so deep",
  knee_caves: "Keep the knee over your toes", hip_drops: "Keep your hips level", arches: "Don't push the hips too high",
  pelvis_tilts: "Keep your hips level", hip_rolls: "Keep your hip facing forward",
};

/** Patient: one number, one word, one fix. Large-text friendly, no jargon. */
export function patientView(s, prescribedReps) {
  if (s.score == null) return { headline: s.band.label, message: s.band.note };
  const done = prescribedReps ? `${s.reps.length} of ${prescribedReps} reps` : `${s.reps.length} reps`;
  return {
    score: s.score, headline: s.band.label, reps: done,
    stars: Math.max(1, Math.round(s.score / 20)),
    tip: s.main_fix ? FIX_TEXT[s.main_fix] ?? s.main_fix : "Nice form. Keep it up!",
    message: s.band.note,
  };
}

/** PT: full breakdown, measured values next to targets, and flags that need review. */
export function ptView(s, result, previous = null) {
  const flags = [];
  if (!s.quality.reliable) flags.push(`Tracking unreliable (visible ${(s.quality.visible * 100).toFixed(0)}%, steady ${(s.quality.steady * 100).toFixed(0)}%): numbers not scored`);
  if (s.movement_target == null) flags.push("No movement target set: score uses form and control only");
  if (result.unfinished) flags.push("Last rep was not finished");
  const reps = result.reps.map((r, i) => ({
    n: r.n, peak: r.peak, excursion: r.excursion, duration_s: r.duration_s, rise_s: r.rise_s,
    ...Object.fromEntries(Object.entries(r).filter(([k, v]) => typeof v === "number" && !(k in { n: 1, t_start: 1, t_end: 1, peakIndex: 1 }))),
    errors: r.errors.map((e) => e.label),
    score: s.reps[i]?.score ?? null, parts: s.reps[i]?.parts ?? null,
  }));
  const peaks = result.reps.map((r) => r.peak);
  const spread = peaks.length > 1 ? Math.max(...peaks) - Math.min(...peaks) : 0;
  const ref = SCORE[s.exercise]?.reference;
  const med = median(peaks);
  if (ref && peaks.length && (med < ref.p10 - 10 || med > ref.p90 + 10))
    flags.push(`Median peak ${med.toFixed(0)}° is outside the reference range ${ref.p10}-${ref.p90}°: check tracking before trusting it`);
  if (s.completion != null && s.completion < 1) flags.push(`Completed ${s.reps.length} of the prescribed reps (${Math.round(s.completion * 100)}%)`);
  if (spread > 20) flags.push(`Peak varies ${spread.toFixed(0)}° between reps: check effort or tracking`);
  const trend = previous && previous.score != null && s.score != null
    ? { previous_score: previous.score, change: s.score - previous.score } : null;
  return {
    score: s.score, band: s.band.label, quality: s.quality, movement_target: s.movement_target,
    movement_unit: s.movement_unit, error_counts: result.summary.errors, medians: result.summary.median,
    reps, trend, flags, weights: s.weights, note: s.note,
  };
}
