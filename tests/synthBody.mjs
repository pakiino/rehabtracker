// Synthetic MediaPipe-style poses (33 normalized landmarks) for every exercise and view,
// clean or with a common error injected. Used by unit tests and the browser test stub.
const rad = (d) => (d * Math.PI) / 180;
// Absolute segment direction: angle a from straight down (+y), positive toward +x.
const dir = (a) => [Math.sin(rad(a)), Math.cos(rad(a))];
const add = (p, v, s = 1) => [p[0] + v[0] * s, p[1] + v[1] * s];
const sub = (p, v, s = 1) => [p[0] - v[0] * s, p[1] - v[1] * s];

let seed = 7;
export const setSeed = (v) => { seed = v; };
const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 3; };

/** 0 -> 1 -> 0 movement profile with rest, rise, hold, fall (seconds). */
export function profile(t, { rest = 1.5, rise = 2, hold = 1, fall = 2, offset = 0 } = {}) {
  const P = rest + rise + hold + fall;
  const u = (((t - offset) % P) + P) % P;
  const ease = (x) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, x)))) / 2;
  if (u < rest) return 0;
  if (u < rest + rise) return ease((u - rest) / rise);
  if (u < rest + rise + hold) return 1;
  return 1 - ease((u - rest - rise - hold) / fall);
}
export const period = (p = {}) => (p.rest ?? 1.5) + (p.rise ?? 2) + (p.hold ?? 1) + (p.fall ?? 2);

const IDX = {
  shoulder: { left: 11, right: 12 }, elbow: { left: 13, right: 14 }, wrist: { left: 15, right: 16 },
  hip: { left: 23, right: 24 }, knee: { left: 25, right: 26 }, ankle: { left: 27, right: 28 },
  heel: { left: 29, right: 30 }, toe: { left: 31, right: 32 },
};

// nz (all optional): { jitter: +/- px added to every joint, spikeEvery: about one frame in this
// many has one joint thrown far off for that frame, spikePx, visFlicker: joints' visibility
// wobbles around the 0.5 threshold }
function emit(pts, W, H, visOf, nz = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  const amp = nz.jitter ? nz.jitter / 1.5 : 1;
  const u = () => noise() / 3 + 0.5;                       // 0..1
  const spikeAt = nz.spikeEvery && u() < 1 / nz.spikeEvery ? [11, 12, 23, 24, 25, 26, 27, 28][Math.floor(u() * 8) % 8] : -1;
  const put = (i, p, v) => {
    let x = p[0] + noise() * amp, y = p[1] + noise() * amp;
    if (i === spikeAt) { const a = u() * 2 * Math.PI; x += Math.cos(a) * nz.spikePx; y += Math.sin(a) * nz.spikePx; }
    if (nz.visFlicker && v > 0.5 && i !== 0) v = 0.53 + (u() - 0.5) * 0.2;
    lm[i] = { x: x / W, y: y / H, z: 0, visibility: v };
  };
  put(0, pts.nose, 0.95);
  for (const name of Object.keys(IDX)) for (const s of ["left", "right"]) {
    if (pts[name]?.[s]) put(IDX[name][s], pts[name][s], visOf(s, name));
  }
  return lm;
}

/** Side view body. Angles are absolute (from straight down, + toward the facing direction +x). */
function sideBody({ anchor, at, trunkA = 180, op, legs, armA = 10, wrist = null, L }) {
  const Lt = 0.24 * L, Ls = 0.24 * L, Lb = 0.3 * L, La = 0.16 * L, Lf = 0.11 * L;
  const pts = { shoulder: {}, elbow: {}, wrist: {}, hip: {}, knee: {}, ankle: {}, heel: {}, toe: {} };
  const good = op === "left" ? "right" : "left";
  const lo = legs[op], lg = legs[good];
  const sOp = lo.thighA - lo.flex, sGood = lg.thighA - lg.flex;
  let hip;
  if (anchor === "ankle") hip = sub(sub(at, dir(sOp), Ls), dir(lo.thighA), Lt);
  else hip = at;
  const leg = (s, l, sA, off) => {
    const h = [hip[0] + off, hip[1]];
    const k = add(h, dir(l.thighA), Lt), a = add(k, dir(sA), Ls);
    const fd = dir(sA + 90);
    pts.hip[s] = h; pts.knee[s] = k; pts.ankle[s] = a;
    pts.heel[s] = add(sub(a, fd, 0.25 * Lf), dir(sA), 0.03 * L);
    pts.toe[s] = add(a, fd, 0.75 * Lf);
  };
  leg(op, lo, sOp, 0);
  leg(good, lg, sGood, 4);
  const sh = add(hip, dir(trunkA), Lb);
  for (const s of [op, good]) {
    const o = s === op ? 0 : 4;
    pts.shoulder[s] = [sh[0] + o, sh[1]];
    pts.elbow[s] = add(pts.shoulder[s], dir(armA), La);
    pts.wrist[s] = wrist ? [wrist[0] + o, wrist[1]] : add(pts.elbow[s], dir(armA + 20), La);
  }
  pts.nose = add(add(sh, dir(trunkA), 0.12 * L), dir(trunkA - 90), 0.05 * L);
  return { pts, Lt, Ls, Lb };
}

/** Front view body, facing the camera (person's right on image left). */
function frontBody({ cx, floorY, L, op, thighPitch, shankPitch, valgus = {}, hipTilt = 0, shift = 0, stepOp = 0, trunkLean = 0 }) {
  const Lt = 0.24 * L, Ls = 0.24 * L, Lb = 0.3 * L, hw = 0.16 * L;
  const pts = { shoulder: {}, elbow: {}, wrist: {}, hip: {}, knee: {}, ankle: {}, heel: {}, toe: {} };
  const xs = { right: cx - hw / 2, left: cx + hw / 2 };
  const legH = (s) => Lt * Math.cos(rad(thighPitch[s])) + Ls * Math.cos(rad(shankPitch[s]));
  const good = op === "left" ? "right" : "left";
  // Hip height set by the lower of the two legs' supports (the stance foot).
  const ankY = { [op]: floorY - stepOp, [good]: floorY };
  const hipYop = ankY[op] - legH(op), hipYgood = ankY[good] - legH(good);
  const baseHipY = Math.min(hipYop, hipYgood);
  const towardGood = Math.sign(xs[good] - xs[op]);
  for (const s of ["left", "right"]) {
    const tiltOff = s === good ? hipTilt : 0;                   // + = good-side hip lower (drop)
    const h = [xs[s] + shift * hw * towardGood, baseHipY + tiltOff];
    const a = [xs[s], s === good && hipYgood > baseHipY + 1 ? h[1] + legH(s) : ankY[s]];
    const kY = h[1] + Lt * Math.cos(rad(thighPitch[s]));
    const midX = h[0] + (a[0] - h[0]) * (kY - h[1]) / (a[1] - h[1]);
    const towardMid = Math.sign(cx - xs[s]);
    const k = [midX + towardMid * Math.tan(rad(valgus[s] ?? 0)) * Ls * 0.5, kY];
    pts.hip[s] = h; pts.knee[s] = k; pts.ankle[s] = a;
    pts.heel[s] = [a[0], a[1] + 0.02 * L]; pts.toe[s] = [a[0], a[1] + 0.04 * L];
    pts.shoulder[s] = [h[0] + trunkLean - towardMid * 0.03 * L, h[1] - Lb];   // shoulders wider than hips
    pts.elbow[s] = [pts.shoulder[s][0] - towardMid * 0.05 * L, pts.shoulder[s][1] + 0.16 * L];
    pts.wrist[s] = [pts.elbow[s][0], pts.elbow[s][1] + 0.15 * L];
  }
  pts.nose = [(pts.shoulder.left[0] + pts.shoulder.right[0]) / 2, pts.shoulder.left[1] - 0.1 * L];
  return { pts, hw };
}

/**
 * @param ex   exercise id
 * @param view "side" | "front"
 * @param t    seconds
 * @param o    { op: "right"|"left", err: error id or null, W, H, prof: profile params }
 * @returns { lm, W, H, truth }
 */
export function synth(ex, view, t, o = {}) {
  const op = o.op ?? "right", good = op === "left" ? "right" : "left", err = o.err ?? null;
  const p = profile(t, o.prof);
  const lying = ["heel_slide", "straight_leg_raise", "glute_bridge", "side_lying_abduction"].includes(ex) && !(ex === "glute_bridge" && view === "front");
  const W = o.W ?? (lying ? 1280 : 720), H = o.H ?? (lying ? 720 : 1280);
  const L = 0.9 * (lying ? W * 0.62 : H);
  const visSide = (s) => (s === op ? (o.visOp ?? 0.95) : (o.visGood ?? 0.85));
  const visAll = () => 0.93;
  let body, truth = {}, visOf = visSide;
  const straight = (a) => ({ thighA: a, flex: 0 });

  if (ex === "heel_slide") {
    // Supine, head left. Heel stays on the floor: hip flexion = knee bend / 2.
    const k = 5 + (err === "partial" && Math.floor(t / period(o.prof)) % 2 ? 60 : 105) * p;
    const hip = [0.45 * W, 0.66 * H - (err === "hip_lifts" ? 0.2 * 0.24 * L * p : 0)];
    body = sideBody({ anchor: "hip", at: hip, trunkA: -90, op, L, armA: 80,
      legs: { [op]: { thighA: 90 + k / 2, flex: k }, [good]: straight(90) } });
    truth = { knee: k };
  } else if (ex === "straight_leg_raise") {
    const lift = (err === "too_high" ? 85 : 40) * p;
    const knee = 2 + (err === "knee_bends" ? 20 : 0) * p;
    const trunkA = -90 - (err === "back_arches" ? 14 : 0) * p;
    body = sideBody({ anchor: "hip", at: [0.45 * W, 0.66 * H], trunkA, op, L, armA: 80,
      legs: { [op]: { thighA: 90 + lift, flex: knee }, [good]: { thighA: 135, flex: 90 } } });
    truth = { lift, knee };
  } else if (ex === "sitting_knee_bend") {
    const k = 90 + 30 * p;
    const hip = [0.22 * W + (err === "slides_forward" ? 0.2 * 0.24 * L * p : 0), 0.55 * H];
    body = sideBody({ anchor: "hip", at: hip, op, L, armA: 30,
      legs: { [op]: { thighA: 88, flex: k }, [good]: { thighA: 88, flex: 90 } } });
    truth = { knee: k };
  } else if (ex === "standing_knee_bend") {
    const k = 3 + 95 * p;
    const thighA = (err === "thigh_swings" ? 35 : 3) * p;
    const lean = (err === "trunk_leans" ? 25 : 2) * p;
    body = sideBody({ anchor: "hip", at: [0.5 * W, 0.45 * H], trunkA: 180 - lean, op, L, armA: 40,
      legs: { [op]: { thighA, flex: k }, [good]: straight(0) } });
    truth = { knee: k };
  } else if (ex === "seated_knee_extension") {
    const fast = err === "kicks_fast";
    const pr = fast ? { ...o.prof, rise: 0.5 } : o.prof;
    const q = profile(t, pr);
    const k = 90 - (err === "not_straight" ? 65 : 85) * q;
    const lean = 3 - (err === "leans_back" ? 18 : 0) * q;
    body = sideBody({ anchor: "hip", at: [0.22 * W, 0.55 * H], trunkA: 180 - lean, op, L, armA: 30,
      legs: { [op]: { thighA: 88, flex: k }, [good]: { thighA: 88, flex: 90 } } });
    truth = { knee: k };
  } else if (ex === "sit_to_stand" && view === "side") {
    const k = 92 * (1 - p) + 3;
    const shankA = 0.08 * k;
    const lean = 10 + (err === "leans_far" ? 60 : 35) * Math.sin(Math.PI * Math.min(1, Math.max(0, 1 - k / 95)) * 0.9 + 0.3) * (k > 10 ? 1 : 0.3);
    const legs = { [op]: { thighA: shankA + k, flex: k }, [good]: { thighA: shankA + k, flex: k } };
    const pre = sideBody({ anchor: "ankle", at: [0.55 * W, 0.86 * H], trunkA: 180 - lean, op, L, legs });
    let wrist = null;
    if (err === "pushes_hands") wrist = add(pre.pts.hip[op], sub(pre.pts.knee[op], pre.pts.hip[op]), 0.65);
    else wrist = add(pre.pts.shoulder[op], dir(180 - lean - 90), 0.05 * L);   // arms crossed on chest
    body = sideBody({ anchor: "ankle", at: [0.55 * W, 0.86 * H], trunkA: 180 - lean, op, L, legs, wrist });
    truth = { knee: k };
  } else if (ex === "sit_to_stand" && view === "front") {
    const k = 92 * (1 - p) + 3;
    const pitch = { left: k, right: k };
    body = frontBody({ cx: 0.5 * W, floorY: 0.86 * H, L, op, thighPitch: pitch, shankPitch: { left: 5, right: 5 },
      shift: err === "weight_shift" ? 0.35 * Math.sin(Math.PI * p) : 0.02 });
    visOf = visAll;
  } else if (ex === "mini_squat" && view === "side") {
    const k = 3 + (err === "too_deep" ? 80 : 40) * p;
    const shankA = 0.45 * k;
    const lean = 3 + (err === "trunk_leans" ? 45 : 0.35 * k) * (err === "trunk_leans" ? p : 1);
    body = sideBody({ anchor: "ankle", at: [0.5 * W, 0.88 * H], trunkA: 180 - lean, op, L, armA: 40,
      legs: { [op]: { thighA: shankA + k, flex: k }, [good]: { thighA: shankA + k, flex: k } } });
    truth = { knee: k };
  } else if (ex === "mini_squat" && view === "front") {
    const k = 3 + 40 * p;
    const v = err === "knee_caves" ? 22 * p : 0;
    body = frontBody({ cx: 0.5 * W, floorY: 0.88 * H, L, op, thighPitch: { left: 0.55 * k, right: 0.55 * k },
      shankPitch: { left: 0.45 * k, right: 0.45 * k }, valgus: { [op]: v, [good]: 0 } });
    visOf = visAll;
  } else if (ex === "step_up" && view === "side") {
    // Operated foot on a step; knee straightens as the body rises.
    const k = 75 * (1 - p) + 3;
    const shankA = 0.25 * k;
    // The operated foot lifts onto the step (0.08 L) and comes back down with the rep.
    body = sideBody({ anchor: "ankle", at: [0.55 * W, 0.86 * H - 0.08 * L * Math.min(1, 2 * p)], trunkA: 180 - 10 * (1 - p), op, L,
      legs: { [op]: { thighA: shankA + k, flex: k }, [good]: { thighA: 5, flex: 10 } }, armA: 30 });
    truth = { knee: k };
  } else if (ex === "step_up" && view === "front") {
    const k = 75 * (1 - p) + 3;
    body = frontBody({ cx: 0.5 * W, floorY: 0.88 * H, L, op, stepOp: 0.08 * L,
      thighPitch: { [op]: k * 0.75, [good]: 5 + 10 * p }, shankPitch: { [op]: k * 0.25, [good]: 5 },
      valgus: { [op]: err === "knee_caves" ? 20 * Math.sin(Math.PI * p) : 0 },
      hipTilt: err === "hip_drops" ? 0.16 * 0.24 * L * p : 0 });
    visOf = visAll;
  } else if (ex === "glute_bridge" && view === "side") {
    // Shoulders and feet on the floor; hips rise until shoulder-hip-knee is straight (or past it).
    const topDeg = err === "arches" ? 200 : err === "partial" ? 155 : 178;
    const sh = [0.18 * W, 0.68 * H], ank = [0.4 * W + 0.3 * L, 0.68 * H];
    const Lt = 0.24 * L, Ls = 0.24 * L;
    const lineAt = (hy) => {
      const hip = [0.4 * W, hy];
      const d = Math.hypot(ank[0] - hip[0], ank[1] - hip[1]);
      const a = (Lt * Lt - Ls * Ls + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, Lt * Lt - a * a));
      const m = [hip[0] + a * (ank[0] - hip[0]) / d, hip[1] + a * (ank[1] - hip[1]) / d];
      const knee = [m[0] + hh * (ank[1] - hip[1]) / d, m[1] - hh * (ank[0] - hip[0]) / d];
      return { hip, knee };
    };
    const lineDeg = (hip, knee) => {
      const ux = sh[0] - hip[0], uy = sh[1] - hip[1], vx = knee[0] - hip[0], vy = knee[1] - hip[1];
      let a = Math.acos((ux * vx + uy * vy) / Math.hypot(ux, uy) / Math.hypot(vx, vy)) * 180 / Math.PI;
      const yLine = sh[1] + (knee[1] - sh[1]) * (hip[0] - sh[0]) / (knee[0] - sh[0]);
      return yLine - hip[1] > 0 ? 360 - a : a;
    };
    const restY = 0.66 * H;
    let lo = restY - 0.5 * L, hi = restY;   // find hip height giving the target line angle
    const target = lineDeg(lineAt(restY).hip, lineAt(restY).knee) + (topDeg - lineDeg(lineAt(restY).hip, lineAt(restY).knee)) * p;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (lineDeg(lineAt(m).hip, lineAt(m).knee) < target) hi = m; else lo = m; }
    const { hip, knee } = lineAt((lo + hi) / 2);
    const pts = { shoulder: {}, elbow: {}, wrist: {}, hip: {}, knee: {}, ankle: {}, heel: {}, toe: {} };
    for (const [s, o2] of [[op, 0], [good, 4]]) {
      pts.shoulder[s] = [sh[0] + o2, sh[1]]; pts.hip[s] = [hip[0] + o2, hip[1]]; pts.knee[s] = [knee[0] + o2, knee[1]];
      pts.ankle[s] = [ank[0] + o2, ank[1]]; pts.heel[s] = [ank[0] - 10, ank[1] + 8]; pts.toe[s] = [ank[0] + 40, ank[1] + 6];
      pts.elbow[s] = [sh[0] + 0.12 * L, sh[1] + 4]; pts.wrist[s] = [sh[0] + 0.24 * L, sh[1] + 4];
    }
    pts.nose = [sh[0] - 0.1 * L, sh[1] - 0.04 * L];
    body = { pts };
    truth = { line: target };
  } else if (ex === "glute_bridge" && view === "front") {
    const hw = 0.16 * L, cx = 0.5 * W, y0 = 0.6 * H, lift = 0.5 * hw * p;
    const tilt = err === "pelvis_tilts" ? 0.25 * hw * p : 0;
    const pts = { shoulder: {}, elbow: {}, wrist: {}, hip: {}, knee: {}, ankle: {}, heel: {}, toe: {} };
    for (const s of ["left", "right"]) {
      const x = s === "right" ? cx - hw / 2 : cx + hw / 2;
      pts.hip[s] = [x, y0 - lift + (s === good ? tilt : 0)]; pts.knee[s] = [x, y0 + 0.2 * L]; pts.ankle[s] = [x, y0 + 0.35 * L];
      pts.shoulder[s] = [x, y0 - 0.2 * L]; pts.elbow[s] = [x, y0 - 0.1 * L]; pts.wrist[s] = [x, y0];
      pts.heel[s] = [x, y0 + 0.38 * L]; pts.toe[s] = [x, y0 + 0.4 * L];
    }
    pts.nose = [cx, y0 - 0.28 * L];
    body = { pts }; visOf = visAll;
  } else if (ex === "side_lying_abduction") {
    // Lying on the side, head left, camera in front; operated leg on top.
    const lift = (err === "too_high" ? 60 : 30) * p;
    const roll = (err === "hip_rolls" ? 25 : 0) * p;
    const hw = 0.16 * L, Lt = 0.24 * L, Ls = 0.24 * L, Lb = 0.3 * L;
    const hb = [0.45 * W, 0.7 * H];
    const ht = [hb[0] + hw * Math.sin(rad(roll)), hb[1] - hw * Math.cos(rad(roll))];
    const pts = { shoulder: {}, elbow: {}, wrist: {}, hip: {}, knee: {}, ankle: {}, heel: {}, toe: {} };
    pts.hip[good] = hb; pts.knee[good] = [hb[0] + Lt, hb[1]]; pts.ankle[good] = [hb[0] + Lt + Ls, hb[1]];
    const ld = [Math.cos(rad(lift)), -Math.sin(rad(lift))];
    pts.hip[op] = ht; pts.knee[op] = add(ht, ld, Lt); pts.ankle[op] = add(ht, ld, Lt + Ls);
    for (const s of ["left", "right"]) {
      pts.shoulder[s] = [pts.hip[s][0] - Lb, pts.hip[s][1]];
      pts.elbow[s] = [pts.shoulder[s][0] + 0.1 * L, pts.shoulder[s][1] + 0.05 * L]; pts.wrist[s] = [pts.elbow[s][0] + 0.12 * L, pts.elbow[s][1]];
      pts.heel[s] = [pts.ankle[s][0] + 8, pts.ankle[s][1] + 6]; pts.toe[s] = [pts.ankle[s][0] + 20, pts.ankle[s][1] - 6];
    }
    pts.nose = [hb[0] - Lb - 0.1 * L, hb[1] - hw / 2];
    body = { pts }; visOf = visAll;
    truth = { lift };
  } else throw new Error(`no synthetic pose for ${ex}/${view}`);
  const nz = o.noise ? { jitter: (o.noise.jitter ?? 0) * L, spikeEvery: o.noise.spikeEvery, spikePx: (o.noise.spike ?? 0.08) * L, visFlicker: o.noise.visFlicker } : {};
  return { lm: emit(body.pts, W, H, visOf, nz), W, H, truth, p };
}

// Rotate landmarks into the frame the model sees when the app turns the image
// (inverse of geometry.unrotateLandmarks).
export function rotateLandmarks(lm, rotation) {
  if (!rotation) return lm;
  return lm.map((q) => {
    const [u, v] = rotation === 90 ? [1 - q.y, q.x] : [q.y, 1 - q.x];
    return { ...q, x: u, y: v };
  });
}
