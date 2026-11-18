# Rehab tracker

Joint tracking for 10 knee rehab exercises, in a phone browser. The phone camera films the
exercise, [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
finds the body's joints, and the app counts reps, measures the joint angles each exercise
calls for, and flags the common errors from the exercise spec.

**Open it on a phone:** https://shanexf1.github.io/rehabtracker/ (after GitHub Pages is
turned on: Settings → Pages → Deploy from a branch → `main`, `/ (root)`).

Nothing is uploaded. The video is processed on the phone and only leaves it if you share
the JSON export.

## How to use it

1. Pick the **exercise**, the **camera view** (side or front, where the exercise has both)
   and the **operated leg**.
2. Set the phone up as the text under the menus says, then **Start camera**.
3. Hold the starting position for a second, press **Record**, do a few reps, press **Stop & review**.
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
js/engine.js     per-frame metrics -> reps -> per-rep measures -> error checks
js/exercises.js  the 10 exercises as configuration: points, rep signal, measures, checks, thresholds
js/app.js        camera, MediaPipe, live readout and cues, results, JSON export
tests/           synthetic body generator and tests
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

85 tests. `tests/synthBody.mjs` draws a stick figure doing each exercise, either cleanly or
with one error injected. For every exercise, view and leg, the tests check that a clean
recording gives the right rep count with no errors, and that each injected error is flagged
on every rep. They also cover slow reps, 15 fps with dropped frames, the wrong leg being
selected, and a recording that starts mid-movement.

The app itself was also run in headless Chrome with a stand-in pose model for all 10 exercises.

## JSON export

One file per recording: exercise, view, operated leg, rep count, per-rep measures and error
ids, error counts, medians, the thresholds used, and every recorded frame's joint positions
in pixels. Use a patient ID, not a name.

## AI use

Built with Claude (Anthropic) from the team's exercise spec
(`Knee_Exercises_Tracking_Spec.xlsx`): the code, the thresholds' starting values, the
synthetic tests and this README.
