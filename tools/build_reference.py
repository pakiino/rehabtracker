# Usage: python3 build.py   (run inside the output folder from export.mjs; needs numpy + matplotlib)
# Writes by_exercise/<exercise>/ angles CSVs, reps.csv, curves.csv, profile.json and profile.png.
# Edit PT_FLAGS in export.mjs to mark the reps the PT called wrong before running.
import json, os, csv, numpy as np, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
D = json.load(open("all.json")); A, T = D["all"], D["T"]; OUT = "by_exercise"; os.makedirs(OUT, exist_ok=True)
TKEY = {"heel_slide":"heel_slide","straight_leg_raise":"slr","sitting_knee_bend":"sitting_bend","standing_knee_bend":"standing_bend","seated_knee_extension":"seated_ext","sit_to_stand":"sit_to_stand","mini_squat":"mini_squat","step_up":"step_up","glute_bridge":"bridge","side_lying_abduction":"abduction"}
summary = []
for ex, e in A.items():
    d = f"{OUT}/{ex}"; os.makedirs(d, exist_ok=True)
    for c in e["clips"]:
        if c["rows"]:
            with open(f"{d}/{c['clip']}_angles.csv", "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(c["rows"][0].keys())); w.writeheader(); w.writerows(c["rows"])
    reps = [r for c in e["clips"] for r in c["reps"]]
    cols = [k for k in reps[0].keys() if k != "curve"]
    for r in reps:
        for k in cols: r.setdefault(k, "")
    with open(f"{d}/{ex}_reps.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore"); w.writeheader(); w.writerows(reps)
    with open(f"{d}/{ex}_curves.csv", "w", newline="") as f:
        w = csv.writer(f); w.writerow(["clip","rep","pt_label"] + [f"p{i}" for i in range(101)])
        for r in reps: w.writerow([r["clip"], r["rep"], r["pt_label"]] + ["" if v is None else v for v in r["curve"]])
    good = [r for r in reps if r["pt_label"] == "correct"]; bad = [r for r in reps if r["pt_label"] != "correct"]
    num = [k for k in cols if all(isinstance(r.get(k), (int, float)) and not isinstance(r.get(k), bool) for r in good) and k not in ("rep","start_video_s","end_video_s")]
    stats = {}
    for k in num:
        v = np.array([r[k] for r in good], float)
        stats[k] = {"n": int(len(v)), "mean": round(float(v.mean()),3), "sd": round(float(v.std(ddof=1)) if len(v)>1 else 0,3), "min": round(float(v.min()),3),
                    "p10": round(float(np.percentile(v,10)),3), "p50": round(float(np.percentile(v,50)),3), "p90": round(float(np.percentile(v,90)),3), "max": round(float(v.max()),3)}
    C = np.array([r["curve"] for r in good if None not in r["curve"]], float)
    prof = {"exercise": ex, "view": e["view"], "signal": e["signal"], "session": "2026-11-20", "pt_approved": True,
            "clips": [c["clip"] for c in e["clips"]], "people": sorted({c["clip"].split("_P-")[1][:6] for c in e["clips"]}),
            "reps_total": len(reps), "reps_correct_used": len(good), "reps_excluded_wrong": [f"{r['clip']} rep {r['rep']} ({r['pt_label']})" for r in bad],
            "metrics": stats, "mean_curve": [round(x,3) for x in C.mean(0)], "sd_curve": [round(x,3) for x in C.std(0)],
            "app_limits": T.get(TKEY[ex], {}), "note": "Built from PT-approved reps only. Curves are time-normalized 0-100% of each rep."}
    json.dump(prof, open(f"{d}/{ex}_profile.json","w"), indent=1)
    fig, ax = plt.subplots(1, 2, figsize=(13, 4.6), gridspec_kw={"width_ratios":[1.6,1]})
    x = np.arange(101)
    for r in good:
        if None not in r["curve"]: ax[0].plot(x, r["curve"], color="0.75", lw=.8)
    for r in bad: ax[0].plot(x, r["curve"], color="tab:red", lw=1.4, label=f"PT: {r['pt_label']} (rep {r['rep']})")
    m, s = C.mean(0), C.std(0); ax[0].fill_between(x, m-s, m+s, color="tab:green", alpha=.2); ax[0].plot(x, m, color="tab:green", lw=2.5, label=f"mean of {len(C)} correct reps ±1 SD")
    ax[0].set_xlabel("% of rep"); ax[0].set_ylabel(f"{e['signal']['label']} ({e['signal']['unit']})"); ax[0].legend(fontsize=8, loc="best"); ax[0].set_title(f"{ex.replace('_',' ')}: movement curve")
    shows = [k for k in num if k not in ("duration_s",)][:6]
    for i, k in enumerate(shows):
        gv = [r[k] for r in good]; bv = [r[k] for r in bad if isinstance(r.get(k),(int,float))]
        ax[1].scatter(np.full(len(gv), i) + np.random.uniform(-.15,.15,len(gv)), (np.array(gv)-np.mean(gv))/(np.std(gv) or 1), s=14, color="0.4")
        if bv: ax[1].scatter(np.full(len(bv), i), (np.array(bv)-np.mean(gv))/(np.std(gv) or 1), s=40, color="tab:red", marker="x")
        ax[1].text(i, ax[1].get_ylim()[0] if False else -3.6, f"{stats[k]['p50']:.1f}", ha="center", fontsize=7, color="tab:green")
    ax[1].set_xticks(range(len(shows))); ax[1].set_xticklabels(shows, rotation=35, ha="right", fontsize=8); ax[1].set_ylabel("spread (SD from mean)"); ax[1].set_ylim(-4, 4)
    ax[1].set_title("per-rep measures (green = median)", fontsize=10); ax[1].axhline(0, color="tab:green", lw=.8)
    fig.tight_layout(); fig.savefig(f"{d}/{ex}_profile.png", dpi=80); plt.close(fig)
    summary.append((ex, len(e["clips"]), len(reps), len(good), len(bad)))
for s in summary: print(s)
