# Rehab tracker

Joint tracking for 10 knee rehab exercises, in a phone browser. The phone camera films the
exercise, [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
finds the body's joints, and the app counts reps, measures the joint angles each exercise
calls for, and flags the common errors from the exercise spec.

**Open it on a phone:** https://shanexf1.github.io/rehabtracker/ (after GitHub Pages is
turned on: Settings → Pages → Deploy from a branch → `main`, `/ (root)`).

**Version 1.2** (current) tracks one leg in side views and warns about a wrong camera view:
see [What changed in 1.2](#what-changed-in-12) and [1.1](#what-changed-in-11).
Version 1.0 is kept at https://shanexf1.github.io/rehabtracker/v1/ in case you want to compare.

Nothing is uploaded. The video is processed on the phone and only leaves it if you share
the JSON export.

## How to use it

1. Pick the **exercise**, the **camera view** (side or front, where the exercise has both)
   and the **operated leg**. In a side view the app tracks the one leg that moves, so keep
   that leg nearest the phone; keep head to feet in the picture.
2. Set the phone up as the text under the menus says, then **Start camera**.
3. Press **Record**. A 5-second countdown gives you time to get into the starting position;
   recording starts on the long beep. Do a few reps, then press **Stop & review**
   (or set "Stop by itself after N reps" in Settings so you don't have to get up).
4. The result shows the rep count, each common error with how many reps had it, the
   measured numbers per rep and a chart. **Share JSON** sends the session to a PT or an agent.

**Analyze a video** runs the same analysis on a clip filmed earlier.

For lying exercises, put the phone on the floor in landscape. The app turns the picture
so the pose model sees the person upright.

## The 10 exercises

| # | Exercise | View | Measured | Errors flagged (default threshold) |
|---|---|---|---|---|
| 1 | Heel slide | Side, lying | Knee bend, hip lift, movement time | Hip lifts (> 12% of thigh length) · too fast (< 0.8 s) · partial bend (< 85% of the best rep, or below a target angle) |
| 2 | Straight leg raise | Side, lying | Leg lift at the hip, knee bend at the top, trunk movement | Knee bends (> 10°) · back arches (trunk moves > 8°) · lifts too high (> 60°) |
| 3 | Sitting knee bend | Side | Knee bend, hip slide forward | Slides body forward (> 10% of thigh length) |
| 4 | Standing knee bend | Side | Knee bend, thigh angle, trunk lean | Thigh swings forward (> 20°) · trunk leans (> 15°) |
| 5 | Seated knee extension | Side | Degrees short of straight, movement time, lean back | Doesn't fully straighten (> 10° short) · kicks fast (< 0.6 s) · leans back (> 10°) |
| 6 | Sit-to-stand | Side | Knee angle, trunk lean, wrists near the thighs | Pushes with hands (> 30% of the rise) · leans too far (> 50°) |
|   |  | Front | Sideways hip shift | Shifts weight to the good leg (> 15% of hip width) |
| 7 | Mini squat | Side | Knee bend depth, trunk lean | Squats too deep (> 60°) · trunk leans (> 30°) |
|   |  | Front | Knee inward drift, both legs | Knee caves in (> 10°) |
| 8 | Step-up | Side | Stepping knee at start and top, hand up at rail height | (measures only) |
|   |  | Front | Pelvis level, knee inward drift | Hip drops (> 6°) · knee caves in (> 10°) |
| 9 | Glute bridge | Side, lying | Shoulder–hip–knee line (180° = straight) | Arches the back (> 190°) · hips not lifted to a straight line (< 165°) |
|   |  | Front | Pelvis level | Pelvis tilts (> 6°) |
| 10 | Side-lying hip abduction | Front, lying | Angle between the legs, pelvis roll | Hip rolls backward (> 15°) · lifts too high (> 45°) |

"Movement time" is the time to go from 10% to 90% of the movement, so a slow start or a
hold at the top doesn't count.

**Not measurable from video:** pulling with the rail on the step-up. A camera can't see
force, so the app only reports whether a hand is up on the rail.

## What changed in 1.2

From two real recordings (a standing knee bend and a seated knee extension) and one results
screen that was plainly wrong:

- **Side views track one leg, and only one side of the body.** Hip, knee and ankle of one
  leg, plus the shoulder on the same side for the trunk checks. The other leg and the arms
  are no longer measured or drawn.
- **The leg is the one that moves.** In a side view the pose model often can't tell left
  from right, and the menu is easy to set wrong, so the tracked leg is chosen from the
  movement itself. The Operated leg menu still matters for front views.
- **The leg no longer needs the shoulders.** If the head or shoulders are out of the
  picture the knee is still measured and the trunk checks are skipped. The results say so,
  because the pose model finds the body from the face and places joints less well without it.
- **Wrong camera view is caught.** A side-on body analysed as a front view produced the
  screen full of "hip drops 44 degrees / knee caves in 55 degrees". The app now compares
  shoulder width with trunk length, warns live, marks such results as not reliable, and
  re-analyzes the same recording when you correct the exercise or view in the menus.
- **Knee inward drift and hip drop (front views) are measured against the standing leg
  length and hip width**, and on the step-up only while the body is up on the stepping leg.
  The plain hip-knee-ankle angle blows up when a bent knee points at the camera.
- **A movement far bigger than the reps** (getting up, walking to the phone) is left out
  instead of being reported as a rep, and no longer flattens the chart.
- **Model: Auto** uses the more accurate Full model and drops to Lite only if the device
  can't keep up with the live camera. Heavy can be chosen by hand for saved videos.

## What changed in 1.1

Version 1.0 measured every frame as it came from the pose model, so a shaky joint could
miscount a rep or raise a false error. 1.1 adds:

- **Joint smoothing** (`js/smooth.js`): a 3-frame median removes one-frame jumps, then a
  One Euro filter removes jitter while the joint is still without lagging real movement
  (under 0.1 s).
- **Steady visibility:** a joint near the "can I see it" threshold no longer flickers in
  and out, so frames stop being dropped at random.
- **Errors need more than one frame:** per-rep maximums (hip lift, trunk lean, knee
  inward drift and so on) ignore a value that appears in a single frame.
- **Steadier rep counting:** a longer median on the rep signal, a rep starts and ends only
  when two frames agree, and position signals are scaled by one body length per recording
  rather than a noisy per-frame one.
- **Countdown and optional auto-stop**, so the recording doesn't include walking to and
  from the phone.
- **Calmer screen:** cues must persist 0.4 s before showing and stay up at least 1.5 s;
  "can't see" warnings wait 0.6 s; the big number updates about 8 times a second.
- **Lying exercises:** the picture is turned only after the person has been lying for
  several frames, corrects itself if it turned the wrong way, and no longer hunts for a
  new rotation the moment one frame is missed.
- **Wrong leg hint:** if the other leg is the one clearly in view, the app says so.

On 624 simulated recordings with a shaky pose model (every joint jittering by ±0.5% of
body length, one frame in 25 with a joint thrown far off, visibility wobbling around the
threshold), 1.0 miscounted reps in 73 recordings, wrongly flagged 97 reps and missed the
real error in 31 reps. 1.1 got all 624 right. These are simulated poses, not people: real
video will be harder.

## What to trust

- **The thresholds are prototype defaults picked by the team, not clinical standards.**
  They are all in one place (`T` at the top of `js/exercises.js`) so a PT can change them.
- Angles come from a 2D picture. Expect several degrees of error, more if the camera is
  not square to the movement. Use the results for feedback and trends, not diagnosis.
- The checks were tuned and tested on synthetic poses (below). They have not been
  validated on patients.
- "Shifts weight" is a proxy: the app sees the hips move sideways, not the load on each leg.

## How it works

```
js/geometry.js   angles, distances, picture rotation for lying exercises
js/smooth.js     joint smoothing and debouncing of on-screen text
js/engine.js     per-frame metrics -> reps -> per-rep measures -> error checks
js/exercises.js  the 10 exercises as configuration: points, rep signal, measures, checks, thresholds
js/app.js        camera, MediaPipe, live readout and cues, results, JSON export
tests/           synthetic body generator and tests
v1/              version 1.0, frozen
```

Each exercise names one **rep signal** (for example knee bend, or hip height). A rep starts
when the signal moves far enough from the starting position and ends when it comes back.
The starting position is the first second of the recording, re-centred whenever the person
is still between reps. Frames where a needed joint is not clearly visible are left out.

Adding an exercise means adding one entry to `js/exercises.js`.

## Tests

```
npm test
```

100 tests. `tests/synthBody.mjs` draws a stick figure doing each exercise, either cleanly or
with one error injected. For every exercise, view and leg, the tests check that a clean
recording gives the right rep count with no errors, and that each injected error is flagged
on every rep. They also cover slow reps, 15 fps with dropped frames, the wrong leg being
selected, and a recording that starts mid-movement. `tests/steady.test.mjs` repeats every
case with a shaky pose model and checks the smoother and the cue debouncing on their own.

The app itself was also run in headless Chrome with a stand-in pose model for all 10 exercises.

## JSON export

One file per recording: exercise, view, operated leg, rep count, per-rep measures and error
ids, error counts, medians, the thresholds used, and every recorded frame's joint positions
in pixels. Use a patient ID, not a name.

## AI use

Built with Claude (Anthropic) from the team's exercise spec
(`Knee_Exercises_Tracking_Spec.xlsx`): the code, the thresholds' starting values, the
synthetic tests and this README.
