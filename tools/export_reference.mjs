import fs from "fs";
// Usage: node export.mjs <clips_folder_with_json> <output_folder>   (run from the repo root: node tools/export_reference.mjs clips refdb_out)
import { analyze } from "../js/engine.js";
import { EXERCISES, T } from "../js/exercises.js";
import { facingOf } from "../js/geometry.js";
const SRC = (process.argv[2] ?? "clips") + "/", OUT = (process.argv[3] ?? "refdb_out") + "/";
// PT labels: every rep approved except these (clip -> rep numbers -> reason)
const PT_FLAGS = { "standing_knee_bend_P-anon-01_202611200102": { 11: "trunk leans", 12: "trunk leans" },
                   "side_lying_abduction_P-anon-01_202611200130": { 2: "too high", 10: "too high" } };
const all = {};
for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith(".json"))) {
  const clip = f.slice(0, -5), d = JSON.parse(fs.readFileSync(SRC + f, "utf8"));
  const ex = d.exercise, view = d.camera_view, op = d.operated_leg, fr = d.frames, off = d.video.t_offset_s;
  const facing = view === "side" ? (fr.map(facingOf).reduce((a, b) => a + b, 0) >= 0 ? 1 : -1) : 1;
  const r = analyze(fr, EXERCISES[ex], { view, op, good: op === "left" ? "right" : "left", facing, prefer: op }, {});
  const key = r.signal.key, sc = r.signal.scale;
  const med = (a) => { const b = a.filter(Number.isFinite).sort((p, q) => p - q); return b.length ? b[Math.floor(b.length / 2)] : 1; };
  const scale = sc ? med(r.rows.map((y) => y[sc])) : 1;
  const rowKeys = [...new Set(r.rows.flatMap((x) => Object.keys(x)))].filter((k) => !["t", "ok", "valid"].includes(k) && r.rows.some((x) => typeof x[k] === "number"));
  const rows = r.rows.map((x) => ({ video_t: +(x.t - off).toFixed(3), ...Object.fromEntries(rowKeys.map((k) => [k, Number.isFinite(x[k]) ? +(+x[k]).toFixed(3) : ""])) }));
  const reps = r.reps.map((x) => {
    const pt = PT_FLAGS[clip]?.[x.n] ?? "";
    const seg = r.rows.filter((y) => y.t >= x.t_start && y.t <= x.t_end && Number.isFinite(y[key]));
    const curve = Array.from({ length: 101 }, (_, i) => {
      if (seg.length < 2) return null;
      const tt = x.t_start + (x.t_end - x.t_start) * i / 100; let j = seg.findIndex((y) => y.t >= tt);
      const v0 = sc ? seg[0][key] : 0;
      const val = j <= 0 ? seg[0][key] : (() => { const a = seg[j - 1], b = seg[j]; return a[key] + (b[key] - a[key]) * (tt - a.t) / (b.t - a.t || 1); })();
      return +(((val - v0) / scale)).toFixed(3);
    });
    const metrics = Object.fromEntries(Object.entries(x).filter(([k, v]) => typeof v === "number" && !["n", "peakIndex"].includes(k)).map(([k, v]) => [k, +v.toFixed(3)]));
    return { clip, exercise: ex, view, rep: x.n, start_video_s: +(x.t_start - off).toFixed(2), end_video_s: +(x.t_end - off).toFixed(2),
      ...Object.fromEntries(Object.entries(metrics).filter(([k]) => !["t_start", "t_end"].includes(k))),
      app_flags: x.errors.map((e) => e.id).join("|"), pt_label: pt ? "wrong: " + pt : "correct", curve };
  });
  (all[ex] ??= { view, signal: { key, label: r.signal.label, unit: sc ? (r.signal.unit ?? sc + " lengths") + " (from rep start)" : (r.signal.unit ?? "°") }, clips: [] }).clips.push({ clip, leg: r.leg, rows, reps });
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + "all.json", JSON.stringify({ all, T }));
for (const [ex, e] of Object.entries(all)) console.log(ex, e.clips.map((c) => `${c.clip.slice(-14)}:${c.reps.length}`).join(" "));
