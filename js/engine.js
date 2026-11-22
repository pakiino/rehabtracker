// Generic exercise engine: per-frame metrics -> reps -> per-rep measures -> error checks.
// Each exercise (exercises.js) supplies, per camera view, a metrics function, a rep
// signal, per-rep measures and checks. Pure functions only.
import { median, maxOf, vis, mid, dist } from "./geometry.js";

// Median filter on the rep signal: 5 samples at 12 frames/s or faster, otherwise 3.
// Removes glitches of one or two frames without rounding off a real turning point much.
function smoothSignal(rows, key) {
  const vals = rows.map((r) => r[key]);
  const dts = rows.slice(1).map((r, i) => r.t - rows[i].t);
  const w = dts.length && median(dts) <= 0.085 ? 2 : 1;
  return vals.map((v, i) => median(vals.slice(Math.max(0, i - w), i + w + 1)));
}

/** Median of each numeric metric over a list of metric rows. */
export function baseOf(rows) {
  const out = {};
  if (!rows.length) return out;
  for (const k of Object.keys(rows[0])) {
    if (typeof rows[0][k] === "number") out[k] = median(rows.map((r) => r[k]));
  }
  return out;
}

const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/**
 * Side views track ONE leg. Which one is worked out from the recording instead of trusted
 * from a left/right label: in a side view the pose model often can't tell left from right,
 * and people pick the wrong leg in the menu.
 *   "moving"  : the leg whose rep signal moves most (single-leg exercises)
 *   "<metric>": the leg whose named metric moves most (step-up: the knee)
 *   "visible" : the leg seen clearly in more frames (both legs do the same thing)
 * ctx.prefer (the leg chosen last time, else the operated leg) wins unless the other leg is
 * clearly better, so the choice doesn't flip back and forth at rest.
 */
export function chooseLeg(frames, v, ctx) {
  const prefer = ctx.prefer ?? ctx.op ?? "right", alt = prefer === "left" ? "right" : "left";
  const key = v.autoLeg === "moving" ? v.signal.key : v.autoLeg;
  const score = (leg) => {
    const rows = frames.map((f) => v.metrics(f, { ...ctx, leg })).filter((r) => r.ok && (key === "visible" || Number.isFinite(r[key])));
    if (key === "visible") return { n: rows.length, range: 0 };
    if (rows.length < Math.max(5, 0.2 * frames.length)) return { n: rows.length, range: -1 };
    const vals = rows.map((r) => r[key]).sort((a, b) => a - b);
    return { n: rows.length, range: pct(vals, 0.95) - pct(vals, 0.05) };
  };
  const a = score(prefer), b = score(alt);
  if (key === "visible") return b.n > 1.2 * a.n + 3 ? alt : prefer;
  const floor = key === v.signal.key && !v.signal.scale ? v.signal.start * 0.75 : 10;   // below this it's noise, not movement
  return b.range >= floor && b.range > 1.5 * Math.max(a.range, 0) ? alt : prefer;
}

/**
 * Does the body's turn match the selected camera view? Uses shoulder width over trunk
 * length: about 0.6-0.8 facing the camera, near 0 side-on.
 * @returns {ratio, looks: "front"|"side"|"between"|"unknown", mismatch: "side_as_front"|"front_as_side"|null}
 */
export function viewCheck(frames, view) {
  const r = [];
  for (const f of frames) {
    if (!vis(f.shoulder.left, f.shoulder.right, f.hip.left, f.hip.right)) continue;
    const trunk = dist(mid(f.shoulder.left, f.shoulder.right), mid(f.hip.left, f.hip.right));
    if (trunk > 1) r.push(dist(f.shoulder.left, f.shoulder.right) / trunk);
  }
  const ratio = r.length >= 8 ? median(r) : NaN;
  const looks = !Number.isFinite(ratio) ? "unknown" : ratio < 0.3 ? "side" : ratio > 0.55 ? "front" : "between";
  const mismatch = view === "front" && looks === "side" ? "side_as_front" : view === "side" && looks === "front" ? "front_as_side" : null;
  return { ratio, looks, mismatch };
}

/**
 * Analyze a recording.
 * @param frames  [{t, ...points}] from geometry.toFrame
 * @param ex      exercise definition (exercises.js)
 * @param ctx     {view, op, good, facing, leg?, prefer?}  leg: force the tracked leg (side views)
 * @param opts    {restS: seconds at the start treated as the starting position}
 * @returns       {..., leg: the leg that was tracked, legAuto: it was chosen from the recording}
 */
export function analyze(frames, ex, ctx, opts = {}) {
  const v = ex.views[ctx.view];
  if (!v) throw new Error(`${ex.id} has no ${ctx.view} view`);
  const legAuto = !!v.autoLeg && !ctx.leg;
  const leg = ctx.leg ?? (v.autoLeg ? chooseLeg(frames, v, ctx) : ctx.op);
  ctx = { ...ctx, leg };
  const sig = v.signal;
  const rows = frames.map((f) => ({ t: f.t, ...v.metrics(f, ctx) }));
  const valid = rows.filter((r) => r.ok && Number.isFinite(r[sig.key]));
  // Position signals are measured in pixels and divided by one body length for the whole
  // recording (median hip width or thigh length), not a per-frame one, which would add its jitter.
  const scale = sig.scale ? median(valid.map((r) => r[sig.scale])) || 1 : 1;
  const s = smoothSignal(valid, sig.key);
  valid.forEach((r, i) => { r.signal = s[i] / scale; });

  const restS = opts.restS ?? 1.0;
  const reps = [];
  let restRows = [];
  if (valid.length) {
    const t0 = valid[0].t;
    restRows = valid.filter((r) => r.t <= t0 + restS);
    if (restRows.length < 3) restRows = valid.slice(0, 3);
  }
  let base = baseOf(restRows);
  // Recording started mid-movement? Then the first second isn't the starting position.
  // Fall back to the frames nearest the resting end of the signal (lowest 15%).
  if (valid.length >= 20) {
    const sorted = valid.map((r) => sig.dir * r.signal).sort((a, b) => a - b);
    const p15 = sorted[Math.floor(sorted.length * 0.15)];
    // Also when the first second sits well BELOW the usual resting level (the person settled
    // after starting), or no rep would ever drop back far enough to end.
    if (Math.abs(sig.dir * base.signal - p15) > sig.start * 0.5) base = baseOf(valid.filter((r) => sig.dir * r.signal <= p15));
  }
  let cur = null, sinceRest = [];
  const endThr = sig.end ?? sig.start / 2;
  for (let i = 0; i < valid.length; i++) {
    const r = valid[i];
    const d = sig.dir * (r.signal - base.signal);
    // A rep starts or ends only when two frames in a row agree.
    const dNext = i + 1 < valid.length ? sig.dir * (valid[i + 1].signal - base.signal) : d;
    if (!cur) {
      if (d >= sig.start && dNext >= sig.start) { cur = { rows: [r], base: { ...base }, pre: sinceRest.slice(-45) }; }
      else {
        sinceRest.push(r);
        if (sinceRest.length > 50) sinceRest.shift();
      }
    } else {
      cur.rows.push(r);
      if (d <= endThr && dNext <= endThr) {
        finishRep(cur, sig, v, ctx, reps);
        cur = null;
        sinceRest = [];
      }
    }
    // The starting position drifts a little between reps: re-centre on recent frames,
    // but only while the person is still (so a slow rep isn't chased by the baseline).
    // "Still" = the signal stayed within a quarter of the start threshold for the last second.
    if (!cur && sinceRest.length >= 8) {
      const last = sinceRest.filter((x) => x.t >= r.t - 1.0), sv = last.map((x) => x.signal);
      if (last.length >= 8 && r.t - last[0].t >= 0.8 && Math.max(...sv) - Math.min(...sv) < sig.start * 0.25) base = baseOf(last);
    }
  }
  const unfinished = !!cur;

  // A "rep" several times bigger than the others is not a rep: it is the person getting up
  // or walking to the phone. Dropped, and reported as rejected.
  let rejected = 0;
  if (reps.length >= 3) {
    const typical = median(reps.map((r) => r.excursion));
    for (let i = reps.length - 1; i >= 0; i--) if (reps[i].excursion > 4 * typical) { reps.splice(i, 1); rejected++; }
    reps.forEach((r, i) => { r.n = i + 1; });
  }

  // Session-level checks (e.g. "partial" compares each rep with the best rep).
  const best = maxOf(reps.map((r) => r.excursion));
  for (const rep of reps) {
    for (const c of v.checks) {
      if (c.session && c.test(rep, { best, reps, ctx, opts })) rep.errors.push({ id: c.id, label: c.label(rep) });
    }
  }
  return { rows, valid, reps, unfinished, rejected, base, scale, leg, legAuto, summary: summarize(reps, v), signal: sig };
}

function finishRep(cur, sig, v, ctx, reps) {
  const rr = cur.rows;
  const dur = rr[rr.length - 1].t - rr[0].t;
  let pk = 0;
  rr.forEach((r, i) => { if (sig.dir * r.signal > sig.dir * rr[pk].signal) pk = i; });
  const excursion = sig.dir * (rr[pk].signal - cur.base.signal);
  if (excursion < sig.minExcursion || dur < 0.4) return;
  // rise_s = time from 10% to 90% of the movement (the frames just before the rep
  // started are kept in cur.pre for this), so slow starts and holds at the top don't count.
  const frac = (r) => sig.dir * (r.signal - cur.base.signal) / excursion;
  const pre = cur.pre ?? [];
  let i10 = pre.length;
  while (i10 > 0 && frac(pre[i10 - 1]) >= 0.1) i10--;
  const t10 = i10 < pre.length ? pre[i10].t : (rr.find((r) => frac(r) >= 0.1) ?? rr[0]).t;
  const up = rr.findIndex((r) => frac(r) >= 0.9);
  let down = pk;
  for (let i = rr.length - 1; i >= pk; i--) if (frac(rr[i]) >= 0.9) { down = i; break; }
  const rep = {
    n: reps.length + 1, t_start: rr[0].t, t_end: rr[rr.length - 1].t, duration_s: dur,
    rise_s: rr[up].t - t10, return_s: rr[rr.length - 1].t - rr[down].t,
    peak: rr[pk].signal, excursion, base: cur.base, rows: rr, peakIndex: pk,
  };
  Object.assign(rep, v.measure ? v.measure(rep, ctx) : {});
  rep.errors = [];
  for (const c of v.checks) {
    if (!c.session && c.test(rep, { ctx })) rep.errors.push({ id: c.id, label: c.label(rep) });
  }
  reps.push(rep);
}

function summarize(reps, v) {
  const errors = {};
  for (const rep of reps) for (const e of rep.errors) errors[e.id] = (errors[e.id] || 0) + 1;
  const keys = ["peak", "excursion", "duration_s", ...(v.summaryKeys ?? [])];
  const med = {};
  for (const k of keys) med[k] = median(reps.map((r) => r[k]));
  return { reps: reps.length, median: med, errors };
}

/** Live cue for the current frame relative to the starting position, or null. */
export function liveCue(ex, ctx, frame, base) {
  const v = ex.views[ctx.view];
  if (!v?.live || !base) return null;
  ctx = { ...ctx, leg: ctx.leg ?? ctx.op };
  const m = v.metrics(frame, ctx);
  if (!m.ok) return null;
  return v.live(m, base, ctx) ?? null;
}

/** Rows of one rep where the signal is at least `frac` of the way to its peak. */
export function topRows(rep, sig, frac = 0.7) {
  const thr = rep.base.signal + sig.dir * frac * rep.excursion;
  return rep.rows.filter((r) => sig.dir * (r.signal - thr) >= 0);
}
