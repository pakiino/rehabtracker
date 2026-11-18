// Rehab tracker: MediaPipe Pose in the phone browser -> per-exercise joint metrics,
// rep counting and common-error checks for the knee exercises in exercises.js.
import { FilesetResolver, PoseLandmarker } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs";
import { toFrame, facingOf, vis, rotationForHead, unrotateLandmarks, drawRotated, VIS_OK } from "./geometry.js";
import { analyze, liveCue } from "./engine.js";
import { EXERCISES, ORDER, T } from "./exercises.js";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";
const MODEL_URLS = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
};
const APP_VERSION = "1.0.0";
const ROTATION_CYCLE = [90, -90, 0];
const LIVE_WINDOW_S = 40;

const $ = (id) => document.getElementById(id);
const video = $("video"), canvas = $("overlay"), g = canvas.getContext("2d");
const ui = {
  status: $("modelStatus"), value: $("value"), hint: $("hint"), reps: $("reps"), cue: $("cue"),
  sigLabel: $("sigLabel"), stage: $("stage"), exercise: $("exercise"), view: $("view"), op: $("op"),
  btnCamera: $("btnCamera"), btnRecord: $("btnRecord"), file: $("fileInput"),
  rec: $("recBadge"), recTime: $("recTime"), progress: $("progress"), bar: $("progressBar"),
  facingCam: $("facingCam"), model: $("model"), rate: $("rate"), target: $("target"),
};

const state = {
  landmarker: null, modelKind: null, delegate: null, lastTs: 0,
  stream: null, looping: false, lastVideoTime: -1, wakeLock: null,
  recording: false, t0: 0, lastRecT: -Infinity, rec: null, live: [], frameNo: 0,
  rotation: 0, rotationSet: false, noPoseStreak: 0, rotCanvas: null,
  liveResult: null, result: null, session: null, lastFileName: null,
};
window.__tracker = state; // for browser tests (no personal data)

// Labels for the numbers each exercise measures: [label, unit, scale].
const KEYS = {
  peak: ["Top of rep", ""], duration_s: ["Rep time", "s"], rise_s: ["Movement time (10–90%)", "s"],
  knee_bend: ["Knee bend", "°"], hip_lift: ["Hip lift", "% thigh", 100], lift: ["Leg lift", "°"],
  knee_bend_top: ["Knee bend at the top", "°"], trunk_move: ["Trunk movement", "°"],
  hip_forward: ["Hip slide forward", "% thigh", 100], thigh_forward: ["Thigh forward of vertical", "°"],
  trunk_lean: ["Trunk lean", "°"], short_of_straight: ["Short of straight", "°"], lean_back: ["Lean back", "°"],
  knee_at_stand: ["Knee at standing", "°"], trunk_lean_max: ["Max forward lean", "°"],
  hands_on_thighs: ["Hands on thighs", "% of rise", 100], weight_shift: ["Shift to good leg", "% hip width", 100],
  depth: ["Squat depth (knee bend)", "°"], valgus_left: ["Left knee inward", "°"], valgus_right: ["Right knee inward", "°"],
  knee_at_start: ["Stepping knee at start", "°"], knee_at_top: ["Stepping knee at top", "°"],
  hand_on_rail: ["Hand up at rail height", ""],
  hip_drop: ["Hip drop (other side)", "°"], valgus: ["Knee inward", "°"],
  top_line: ["Shoulder–hip–knee at top", "°"], pelvis_tilt: ["Pelvis tilt", "°"], pelvis_roll: ["Pelvis roll", "°"],
};
const fmtKey = (k, v, sigUnit) => {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (!Number.isFinite(v)) return "--";
  const [, unit0, scale = 1] = KEYS[k] ?? [k, ""];
  const unit = k === "peak" || k === "excursion" ? sigUnit : unit0;
  const x = v * scale;
  const d = unit === "s" ? 1 : unit !== "°" && scale === 1 ? 2 : 0;
  return `${x.toFixed(d)}${unit === "°" ? "°" : unit ? ` ${unit}` : ""}`;
};

const ex = () => EXERCISES[ui.exercise.value];
const vw = () => ex().views[ui.view.value];
const ctxNow = (facing = state.facing ?? 1) => {
  const op = ui.op.value;
  return { view: ui.view.value, op, good: op === "left" ? "right" : "left", facing };
};
const opts = () => { const t = Number(ui.target.value); return ui.target.value !== "" && Number.isFinite(t) ? { target: t } : {}; };

// ---------- model ----------
let filesetPromise = null;
async function loadModel(kind) {
  setStatus("Loading pose model…");
  ui.btnCamera.disabled = true;
  if (state.landmarker) { state.landmarker.close(); state.landmarker = null; }
  filesetPromise ??= FilesetResolver.forVisionTasks(WASM);
  const fileset = await filesetPromise;
  for (const delegate of ["GPU", "CPU"]) {
    try {
      state.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URLS[kind], delegate },
        runningMode: "VIDEO", numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      Object.assign(state, { modelKind: kind, delegate });
      setStatus(`Model ready · ${kind} · ${delegate}`, "ok");
      ui.btnCamera.disabled = false;
      return;
    } catch (e) { console.warn(`Pose model failed on ${delegate}`, e); }
  }
  setStatus("Model failed to load", "err");
  setHint("Could not load the pose model. Check the connection and reload.", true);
}
function nextTs(p) { state.lastTs = Math.max(p, state.lastTs + 1); return state.lastTs; }

// ---------- menus ----------
function fillExercises() {
  ui.exercise.replaceChildren(...ORDER.map((id, i) => new Option(`${i + 1}. ${EXERCISES[id].label}`, id)));
}
function fillViews(keep) {
  const views = Object.keys(ex().views);
  ui.view.replaceChildren(...views.map((v) => new Option(v === "side" ? "Side" : "Front", v)));
  ui.view.value = views.includes(keep) ? keep : views[0];
  ui.view.disabled = views.length < 2;
}
function renderExercise() {
  const e = ex(), v = vw();
  $("setup").textContent = v.setup;
  $("tracks").textContent = `Starts: ${e.start}. Tracks: ${e.tracks}.`;
  $("notMeasured").hidden = !e.notMeasured;
  $("notMeasured").textContent = e.notMeasured ? `Not measured: ${e.notMeasured.join(" ")}` : "";
  $("targetWrap").hidden = e.id !== "heel_slide";
  ui.sigLabel.textContent = signalLabel(v.signal);
  ui.value.textContent = "--"; ui.reps.textContent = ""; showCue(null);
  state.live = []; state.liveResult = null; state.rotation = 0; state.rotationSet = false; state.facing = null;
  try { localStorage.setItem("rehabtracker", JSON.stringify({ ex: e.id, view: ui.view.value, op: ui.op.value })); } catch { /* optional */ }
}
const signalLabel = (sig) => sig.unit === "°"
  ? `${sig.label}${sig.key === "line" ? " (180° = straight line)" : sig.key === "knee" && sig.dir < 0 ? " (0° = straight)" : ""}`
  : `${sig.label} (change from start, ${sig.unit})`;

// ---------- camera ----------
async function startCamera() {
  if (state.stream) return stopCamera();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: ui.facingCam.value, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) { setHint("Camera blocked. Allow camera access for this site and try again.", true); console.error(e); return; }
  video.removeAttribute("src");
  video.srcObject = state.stream;
  await video.play();
  sizeCanvas();
  ui.stage.classList.toggle("mirror", ui.facingCam.value === "user");
  ui.btnCamera.textContent = "Stop camera"; ui.btnRecord.disabled = false;
  state.live = []; state.t0 = performance.now(); state.rotationSet = false; state.rotation = 0;
  try { state.wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* optional */ }
  state.looping = true;
  requestAnimationFrame(loop);
}
function stopCamera() {
  if (state.recording) toggleRecord();
  state.looping = false;
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null; video.srcObject = null;
  state.wakeLock?.release?.(); state.wakeLock = null;
  ui.btnCamera.textContent = "Start camera"; ui.btnRecord.disabled = true;
  g.clearRect(0, 0, canvas.width, canvas.height);
}
function sizeCanvas() {
  canvas.width = video.videoWidth || 720; canvas.height = video.videoHeight || 1280;
  ui.stage.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
}
function loop() {
  if (!state.looping || !state.landmarker) return;
  if (video.readyState >= 2 && video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;
    if (video.videoWidth && canvas.width !== video.videoWidth) sizeCanvas();
    const now = performance.now();
    onPose(detect(nextTs(now)), (now - state.t0) / 1000, true);
  }
  requestAnimationFrame(loop);
}

// Lying exercises: rotate the frame 90° so the model sees the person upright, then map back.
function detect(ts) {
  const W = video.videoWidth, H = video.videoHeight, lying = vw().lying;
  if (!lying) state.rotation = 0;
  let source = video;
  if (state.rotation) {
    state.rotCanvas ??= document.createElement("canvas");
    const rc = state.rotCanvas;
    if (rc.width !== H || rc.height !== W) { rc.width = H; rc.height = W; }
    drawRotated(rc.getContext("2d"), video, W, H, state.rotation);
    source = rc;
  }
  const lm = state.landmarker.detectForVideo(source, ts).landmarks?.[0];
  if (lm) {
    state.noPoseStreak = 0;
    const out = unrotateLandmarks(lm, state.rotation);
    if (lying && !state.rotationSet) {
      // First detection: turn so the head is up. Head left of the hips in the image -> rotate 90°.
      const hipX = (out[23].x + out[24].x) / 2;
      state.rotation = rotationForHead(out[0].x < hipX);
      state.rotationSet = true;
    }
    if (state.rec) state.rec.rotations[state.rotation] = (state.rec.rotations[state.rotation] || 0) + 1;
    return out;
  }
  if (lying && ++state.noPoseStreak >= 15) {
    state.noPoseStreak = 0;
    state.rotation = ROTATION_CYCLE[(ROTATION_CYCLE.indexOf(state.rotation) + 1) % ROTATION_CYCLE.length];
  }
  return undefined;
}

// ---------- per frame ----------
function onPose(lm, t, live) {
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  if (!lm) {
    ui.value.textContent = "--";
    setHint(vw().lying ? "No person found. Phone on the floor in landscape, whole body in the picture."
      : "No person found. Fit the whole body in the picture.", true);
    if (state.rec && (state.recording || !live)) state.rec.noPose++;
    return;
  }
  const f = toFrame(lm, W, H, t);
  drawBody(f);
  const v = vw(), sig = v.signal;
  if (ui.view.value === "side") {
    const fc = facingOf(f, ui.op.value);
    state.facingVotes = (state.facingVotes ?? 0) * 0.9 + fc;   // smoothed vote
    state.facing = state.facingVotes >= 0 ? 1 : -1;
  }
  const ctx = ctxNow();
  const m = v.metrics(f, ctx);
  state.live.push(f);
  while (state.live.length && state.live[0].t < t - LIVE_WINDOW_S && !state.recording) state.live.shift();
  if (!m.ok) setHint(`Can't see all the points this exercise needs: ${ex().tracks.toLowerCase()}. Keep the whole body in the picture.`, true);
  else setHint(`${ui.op.value === "left" ? "Left" : "Right"} leg${state.recording ? " · recording" : ""}`, false);

  if (m.ok) {
    if (sig.unit === "°") ui.value.textContent = `${Math.round(m[sig.key])}°`;
    else if (state.liveResult?.base?.[sig.key] != null) ui.value.textContent = (sig.dir * (m[sig.key] - state.liveResult.base[sig.key])).toFixed(2);
  } else ui.value.textContent = "--";

  // Rep counting and cues on the live buffer, a few times a second.
  if (++state.frameNo % 5 === 0) {
    const src = state.recording ? state.rec.frames : state.live;
    if (src.length > 10) {
      const r = analyze(src, ex(), ctxNow(), opts());
      state.liveResult = r;
      const last = r.reps[r.reps.length - 1];
      ui.reps.textContent = `Reps: ${r.reps.length}` + (last ? ` · last: ${last.errors.length ? last.errors.map((e) => e.label).join("; ") : "no errors"}` : "");
    }
  }
  showCue(m.ok && state.liveResult ? liveCue(ex(), ctx, f, state.liveResult.base) : null);

  const record = live ? state.recording : true;
  if (!record) return;
  if (live && t - state.lastRecT < 1 / clampRate()) return;
  state.lastRecT = t;
  state.rec.frames.push(f);
  ui.recTime.textContent = `${Math.round(t - state.rec.frames[0].t)} s`;
}

function showCue(text) { ui.cue.hidden = !text; ui.cue.textContent = text ?? ""; }

const BONES = [["shoulder", "hip"], ["hip", "knee"], ["knee", "ankle"], ["ankle", "heel"], ["heel", "toe"], ["ankle", "toe"],
  ["shoulder", "elbow"], ["elbow", "wrist"]];
function drawBody(f) {
  const lw = Math.max(3, canvas.width / 180), op = ui.op.value;
  g.lineCap = "round";
  const seg = (a, b, color, w) => {
    if (!vis(a, b)) return;
    g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  };
  seg(f.shoulder.left, f.shoulder.right, "#8f8e86", lw * 0.7);
  seg(f.hip.left, f.hip.right, "#8f8e86", lw * 0.7);
  for (const s of [op === "left" ? "right" : "left", op]) {
    const color = s === op ? "#3987e5" : "#8f8e86", w = s === op ? lw : lw * 0.7;
    for (const [a, b] of BONES) seg(f[a][s], f[b][s], color, w);
  }
  for (const s of ["left", "right"]) for (const name of ["shoulder", "hip", "knee", "ankle", "wrist"]) {
    const p = f[name][s];
    g.beginPath(); g.arc(p[0], p[1], lw * (s === op ? 1.5 : 1.1), 0, 2 * Math.PI);
    g.fillStyle = p[2] >= VIS_OK ? "#f0efec" : "#e66767"; g.fill();
    g.lineWidth = lw / 2; g.strokeStyle = "#121211"; g.stroke();
  }
}

function setHint(text, warn) { ui.hint.textContent = text; ui.hint.classList.toggle("warn", warn); }
function setStatus(text, cls) { ui.status.textContent = text; ui.status.className = `chip ${cls ?? ""}`; }
function clampRate() { return Math.min(30, Math.max(5, Number(ui.rate.value) || 15)); }

// ---------- recording ----------
const newRec = (mode) => ({ frames: [], noPose: 0, width: canvas.width, height: canvas.height, mode, rotations: {} });
function toggleRecord() {
  if (!state.recording) {
    state.rec = newRec("camera"); state.lastRecT = -Infinity; state.lastFileName = null;
    state.recording = true;
    ui.btnRecord.textContent = "Stop & review"; ui.btnRecord.classList.add("recording");
    ui.rec.hidden = false; ui.recTime.textContent = "0 s"; $("results").hidden = true;
  } else {
    state.recording = false;
    ui.btnRecord.textContent = "Record"; ui.btnRecord.classList.remove("recording");
    ui.rec.hidden = true;
    finalize();
  }
}

async function analyzeFile(file) {
  if (!file || !state.landmarker) return;
  stopCamera();
  ui.stage.classList.remove("mirror");
  video.src = URL.createObjectURL(file);
  await once(video, "loadedmetadata");
  await video.play().catch(() => {}); video.pause();
  sizeCanvas();
  state.rec = newRec("video_file"); state.live = []; state.rotationSet = false; state.rotation = 0; state.facingVotes = 0;
  const step = 1 / clampRate(), dur = video.duration;
  if (!Number.isFinite(dur) || dur <= 0) { setHint("Could not read this video's length.", true); return; }
  ui.progress.hidden = false; ui.btnCamera.disabled = true;
  const base = state.lastTs + 1;
  for (let t = 0; t < dur; t += step) {
    video.currentTime = t;
    await once(video, "seeked");
    onPose(detect(nextTs(base + t * 1000)), t, false);
    ui.bar.style.width = `${Math.min(100, (100 * t) / dur)}%`;
  }
  state.lastFileName = file.name;
  ui.progress.hidden = true; ui.btnCamera.disabled = false;
  finalize();
}
const once = (el, ev) => new Promise((r) => el.addEventListener(ev, r, { once: true }));

// Facing direction for a side view: majority over the recording (toes ahead of heels).
function recFacing(frames, op) {
  const votes = frames.map((f) => facingOf(f, op));
  return votes.reduce((a, b) => a + b, 0) >= 0 ? 1 : -1;
}

// ---------- results ----------
function finalize() {
  const rec = state.rec;
  if (!rec || rec.frames.length < 10) { setHint("Too few frames with a person in them. Record a few reps.", true); return; }
  const e = ex(), v = vw(), ctx = ctxNow(ui.view.value === "side" ? recFacing(rec.frames, ui.op.value) : 1);
  const r = analyze(rec.frames, e, ctx, opts());
  state.result = r;
  const rotUsed = Object.entries(rec.rotations).sort((a, b) => b[1] - a[1])[0]?.[0];
  const clean = (x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x);
  const repOut = r.reps.map((rep) => {
    const o = { n: rep.n };
    for (const k of ["t_start", "t_end", "duration_s", "rise_s", "return_s", "peak", "excursion", ...(v.summaryKeys ?? [])]) o[k] = clean(rep[k]);
    for (const k of Object.keys(rep)) if (!(k in o) && !["rows", "base", "errors", "peakIndex"].includes(k)) o[k] = clean(rep[k]);
    o.errors = rep.errors.map((x) => x.id);
    return o;
  });
  state.session = {
    patient_id: null, exercise: e.id, exercise_label: e.label, camera_view: ctx.view, operated_leg: ctx.op,
    facing: ui.view.value === "side" ? (ctx.facing > 0 ? "image_right" : "image_left") : "camera",
    rep_signal: { key: v.signal.key, label: v.signal.label, unit: v.signal.unit },
    reps_count: r.reps.length, last_rep_unfinished: r.unfinished,
    reps: repOut,
    error_counts: r.summary.errors,
    checks: v.checks.map((c) => c.id),
    medians: Object.fromEntries(Object.entries(r.summary.median).map(([k, x]) => [k, clean(x)])),
    thresholds: T[{ straight_leg_raise: "slr", sitting_knee_bend: "sitting_bend", standing_knee_bend: "standing_bend",
      seated_knee_extension: "seated_ext", side_lying_abduction: "abduction", glute_bridge: "bridge" }[e.id] ?? e.id],
    thresholds_note: "Prototype defaults chosen by the team, not clinical standards.",
    not_measured: e.notMeasured ?? [],
    target_knee_bend_deg: opts().target ?? null,
    coordinate_units: "pixels", image_width_px: rec.width, image_height_px: rec.height,
    frames: rec.frames,
    source: {
      app: "rehabtracker", app_version: APP_VERSION, pose_model: `mediapipe pose_landmarker_${state.modelKind}`,
      delegate: state.delegate, capture: rec.mode, file_name: state.lastFileName, sample_rate_hz: clampRate(),
      frames_without_pose: rec.noPose, frames_used: r.valid.length, detection_rotation_deg: rotUsed != null ? Number(rotUsed) : 0,
      recorded_at: new Date().toISOString(),
    },
  };
  renderResults(r, e, v, rec);
  $("results").hidden = false;
  $("results").scrollIntoView({ behavior: "smooth" });
}

function renderResults(r, e, v, rec) {
  $("resTitle").textContent = `${e.label} · ${ui.view.value} view · ${ui.op.value} leg`;
  const sig = v.signal, n = r.reps.length;
  const withErr = r.reps.filter((x) => x.errors.length).length;
  $("evalBox").innerHTML = n
    ? `<span class="big">${n}</span> rep${n > 1 ? "s" : ""} · <span class="big">${n - withErr}</span> without errors` +
      `<span class="sub2">${r.unfinished ? "The last rep was still going when recording stopped and isn't counted. " : ""}` +
      `A rep is counted when ${sig.label.toLowerCase()} changes by at least ${sig.minExcursion}${sig.unit === "°" ? "°" : ` ${sig.unit}`} and comes back.</span>`
    : `<span class="sub2">No reps found. Check the setup above, then do slow, full reps with the whole body in view.</span>`;
  $("errSummary").innerHTML = v.checks.length
    ? v.checks.map((c) => {
        const k = r.summary.errors[c.id] ?? 0;
        const name = c.label({ ...Object.fromEntries(Object.keys(KEYS).map((x) => [x, NaN])) }).replace(/\s*\(.*\)$/, "");
        return `<div class="err ${k ? "bad" : "ok"}"><span class="ico" aria-hidden="true">${k ? "!" : "✓"}</span>` +
          `<span>${esc(name)}</span><span class="cnt">${n ? `${k} of ${n} reps` : "--"}</span></div>`;
      }).join("")
    : `<p class="note">No automatic error checks for this view.${e.notMeasured ? " " + esc(e.notMeasured.join(" ")) : ""}</p>`;
  const keys = [...mainKeys(r, v), "duration_s"].filter((k) => Number.isFinite(r.summary.median[k]));
  $("stats").innerHTML = keys.map((k) => `<div><span class="k">${esc(keyLabel(k, sig))} · median</span>` +
    `<span class="v">${fmtKey(k, r.summary.median[k], sig.unit)}</span></div>`).join("");
  const q = [`${r.valid.length} of ${r.rows.length} frames had every point this exercise needs.`];
  if (rec.noPose) q.push(`${rec.noPose} frames had no person.`);
  if (r.valid.length < r.rows.length * 0.6) q.push("Many frames were missing points: re-record with the camera set up as described.");
  $("quality").textContent = q.join(" ");
  drawChart(r);
  drawRepTable(r, v);
}

// The rep signal's own number comes first: its value at the top for angles, the change from
// the starting position otherwise. Skipped when an exercise measure already reports it.
function mainKeys(r, v) {
  const sk = v.summaryKeys ?? [];
  if (v.signal.unit !== "°") return ["excursion", ...sk];
  const dup = sk.some((k) => r.reps.length && r.reps.every((rep) => rep[k] === rep.peak));
  return dup ? sk : ["peak", ...sk];
}
const keyLabel = (k, sig) => (k === "peak" ? `${sig.label} at top` : k === "excursion" ? sig.label : (KEYS[k]?.[0] ?? k));

function drawRepTable(r, v) {
  const keys = mainKeys(r, v);
  const unit = v.signal.unit;
  const head = `<tr><th>#</th><th>Start</th>${keys.map((k) => `<th>${esc(keyLabel(k, v.signal))}</th>`).join("")}<th>Errors</th></tr>`;
  const body = r.reps.map((rep) => `<tr><td>${rep.n}</td><td>${rep.t_start.toFixed(1)} s</td>` +
    keys.map((k) => `<td>${fmtKey(k, rep[k], unit)}</td>`).join("") +
    `<td class="${rep.errors.length ? "bad" : ""}">${rep.errors.length ? rep.errors.map((x) => esc(x.label)).join("<br>") : "none"}</td></tr>`).join("");
  $("repTable").innerHTML = r.reps.length ? `<table>${head}${body}</table>` : `<p class="note">No reps.</p>`;
}

function drawChart(r) {
  const svg = $("chart"), tip = $("tip");
  const W = svg.clientWidth || 600, H = 220, m = { l: 40, r: 10, t: 10, b: 24 };
  const rows = r.valid;
  const sig = r.signal, deg = sig.unit === "°";
  const val = (row) => deg ? row.signal : sig.dir * (row.signal - (r.reps[0]?.base.signal ?? rows[0]?.signal ?? 0));
  $("chartTitle").textContent = deg ? `${sig.label} over the session (°)` : `${sig.label}: change from the starting position (${sig.unit})`;
  const ns = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.replaceChildren();
  if (rows.length < 2) return;
  const t0 = r.rows[0].t, tMax = Math.max(t0 + 1, r.rows[r.rows.length - 1].t);
  const vals = rows.map(val);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x = (t) => m.l + ((t - t0) / (tMax - t0)) * (W - m.l - m.r);
  const y = (v) => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
  for (const rep of r.reps) {
    svg.append(el("rect", { class: rep.errors.length ? "band err" : "band", x: x(rep.t_start), y: m.t,
      width: Math.max(2, x(rep.t_end) - x(rep.t_start)), height: H - m.t - m.b, rx: 4 }));
    svg.append(el("text", { x: (x(rep.t_start) + x(rep.t_end)) / 2, y: m.t + 12, "text-anchor": "middle", class: "replbl" }, `${rep.n}${rep.errors.length ? " !" : ""}`));
  }
  const grid = el("g", { class: "grid" });
  for (let v = lo; v <= hi + 1e-9; v += step) {
    grid.append(el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    svg.append(el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, `${+v.toFixed(2)}`));
  }
  svg.prepend(grid);
  svg.append(el("text", { x: W - m.r, y: H - 6, "text-anchor": "end" }, `${(tMax - t0).toFixed(0)} s`));
  svg.append(el("text", { x: m.l, y: H - 6 }, "0 s"));
  svg.append(el("path", { class: "series", d: rows.map((row, i) => `${i ? "L" : "M"}${x(row.t).toFixed(1)},${y(val(row)).toFixed(1)}`).join("") }));
  const cross = el("line", { class: "cross", y1: m.t, y2: H - m.b, visibility: "hidden" });
  const dot = el("circle", { class: "pt", r: 4.5, visibility: "hidden" });
  svg.append(cross, dot);
  const show = (ev) => {
    const box = svg.getBoundingClientRect(), px = ((ev.clientX - box.left) / box.width) * W;
    let best = rows[0];
    for (const row of rows) if (Math.abs(x(row.t) - px) < Math.abs(x(best.t) - px)) best = row;
    const rep = r.reps.find((q) => best.t >= q.t_start && best.t <= q.t_end);
    cross.setAttribute("x1", x(best.t)); cross.setAttribute("x2", x(best.t)); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(best.t)); dot.setAttribute("cy", y(val(best))); dot.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.textContent = `${(best.t - t0).toFixed(1)} s · ${deg ? `${val(best).toFixed(0)}°` : val(best).toFixed(2)}` +
      (rep ? ` · rep ${rep.n}${rep.errors.length ? `: ${rep.errors.map((e) => e.label).join("; ")}` : ""}` : "");
    const left = (x(best.t) / W) * box.width;
    tip.style.left = `${Math.min(Math.max(0, left - 110), box.width - 230)}px`;
  };
  svg.onpointermove = show; svg.onpointerdown = show;
  svg.onpointerleave = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
}
function niceStep(s) { const p = 10 ** Math.floor(Math.log10(s || 1)); const f = s / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------- export ----------
function sessionFile() {
  const s = structuredClone(state.session);
  s.patient_id = $("pid").value.trim() || "P-anon";
  const pain = $("pain").value.trim();
  if (pain !== "") s.pain_0_10 = Number(pain);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return new File([JSON.stringify(s, null, 1)], `${s.exercise}_${s.patient_id}_${stamp}.json`, { type: "application/json" });
}
async function share() {
  if (!state.session) return;
  const file = sessionFile();
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Exercise session" }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  download(file);
}
function download(file = sessionFile()) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- wiring ----------
fillExercises();
try {
  const saved = JSON.parse(localStorage.getItem("rehabtracker") || "null");
  if (saved && EXERCISES[saved.ex]) { ui.exercise.value = saved.ex; ui.op.value = saved.op === "left" ? "left" : "right"; }
  fillViews(saved?.view);
} catch { fillViews(); }
renderExercise();

ui.exercise.onchange = () => { fillViews(ui.view.value); renderExercise(); $("results").hidden = true; };
ui.view.onchange = () => { renderExercise(); $("results").hidden = true; };
ui.op.onchange = () => { renderExercise(); if (!$("results").hidden && state.rec) finalize(); };
ui.target.onchange = () => { if (!$("results").hidden && state.rec) finalize(); };
ui.btnCamera.onclick = () => startCamera();
ui.btnRecord.onclick = () => toggleRecord();
ui.file.onchange = (e) => analyzeFile(e.target.files[0]).finally(() => { e.target.value = ""; });
ui.model.onchange = () => loadModel(ui.model.value);
ui.facingCam.onchange = () => { if (state.stream) { stopCamera(); startCamera(); } };
$("btnShare").onclick = () => share();
$("btnDownload").onclick = () => state.session && download();
window.addEventListener("resize", () => state.result && drawChart(state.result));
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && state.stream && !state.wakeLock) {
    try { state.wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* optional */ }
  }
});
if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) setHint("Camera needs HTTPS. Open the GitHub Pages link.", true);
loadModel("lite");
