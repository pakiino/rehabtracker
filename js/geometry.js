// 2D geometry on MediaPipe Pose landmarks, in pixels (image y points down).
// Pure functions: no DOM, no MediaPipe.

export const VIS_OK = 0.5;

// MediaPipe Pose landmark indices (person's own left/right).
export const IDX = {
  nose: 0,
  shoulder: { left: 11, right: 12 }, elbow: { left: 13, right: 14 }, wrist: { left: 15, right: 16 },
  hip: { left: 23, right: 24 }, knee: { left: 25, right: 26 }, ankle: { left: 27, right: 28 },
  heel: { left: 29, right: 30 }, toe: { left: 31, right: 32 },
};
export const POINTS = ["shoulder", "elbow", "wrist", "hip", "knee", "ankle", "heel", "toe"];

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Normalized landmarks -> frame {t, nose, shoulder:{left,right}, ...}, points [x, y, visibility] in px. */
export function toFrame(lm, W, H, t) {
  const pt = (i) => {
    const p = lm[i];
    return [r1(p.x * W), r1(p.y * H), r3(Number.isFinite(p.visibility) ? p.visibility : 0)];
  };
  const f = { t: r3(t), nose: pt(IDX.nose) };
  for (const name of POINTS) f[name] = { left: pt(IDX[name].left), right: pt(IDX[name].right) };
  return f;
}

export const other = (side) => (side === "left" ? "right" : "left");
export const vis = (...pts) => pts.every((p) => p && p[2] >= VIS_OK);
export const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.min(a[2], b[2])];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const deg = (r) => (r * 180) / Math.PI;

/** Included angle ABC in degrees (0..180). */
export function angle(a, b, c) {
  const ux = a[0] - b[0], uy = a[1] - b[1], vx = c[0] - b[0], vy = c[1] - b[1];
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!n) return NaN;
  return deg(Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n))));
}

/** Flexion at B: 0 when A, B, C are in a straight line. */
export const flexion = (a, b, c) => 180 - angle(a, b, c);

/** Angle (deg) of vector a->b from straight up (0..180). */
export function fromUp(a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], n = Math.hypot(vx, vy);
  return n ? deg(Math.acos(Math.max(-1, Math.min(1, -vy / n)))) : NaN;
}

/** Angle (deg) of vector a->b from straight down (0..180). */
export const fromDown = (a, b) => 180 - fromUp(a, b);

/** Signed angle (deg) of vector a->b from straight up; + when it leans toward +x * facing. */
export function leanFromUp(a, b, facing = 1) {
  const vx = (b[0] - a[0]) * facing, vy = b[1] - a[1];
  return deg(Math.atan2(vx, -vy));
}

/** Signed angle (deg) of the line a->b from horizontal (+ when b is higher than a). */
export function tiltFromHorizontal(a, b) {
  return deg(Math.atan2(a[1] - b[1], Math.abs(b[0] - a[0]) || 1e-9));
}

/** Distance from p to the segment a-b. */
export function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  if (!L2) return dist(p, a);
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dy));
}

/** How far p is above the line a-b (image "up" = smaller y), signed, in px. */
export function heightAboveLine(p, a, b) {
  if (b[0] === a[0]) return NaN;
  const yLine = a[1] + (b[1] - a[1]) * (p[0] - a[0]) / (b[0] - a[0]);
  return yLine - p[1];
}

export function median(values) {
  const s = values.filter(Number.isFinite).sort((x, y) => x - y);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * Largest value that is held for more than one frame: the max after a 3-frame median.
 * A single-frame glitch in the pose can't set it.
 */
export function robustMax(arr) {
  const v = arr.filter(Number.isFinite);
  if (v.length < 3) return v.length ? Math.min(...v) : NaN;
  let m = -Infinity;
  for (let i = 1; i < v.length - 1; i++) {
    const a = v[i - 1], b = v[i], c = v[i + 1];
    m = Math.max(m, Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)));
  }
  return m;
}

export const maxOf = (arr) => { const v = arr.filter(Number.isFinite); return v.length ? Math.max(...v) : NaN; };
export const minOf = (arr) => { const v = arr.filter(Number.isFinite); return v.length ? Math.min(...v) : NaN; };

/** Facing direction in a side view: +1 if the person faces +x (toes ahead of heels), else -1. */
/**
 * Which way the person faces in a side view: +1 = image right, -1 = image left.
 * A vote of every clue that is visible: the nose is ahead of the shoulders (counts double),
 * and each foot's toes are ahead of its heel. Doesn't depend on which leg is tracked.
 */
export function facingOf(f) {
  let votes = 0;
  const sh = vis(f.shoulder.left) ? (vis(f.shoulder.right) ? mid(f.shoulder.left, f.shoulder.right) : f.shoulder.left) : f.shoulder.right;
  if (vis(f.nose, sh) && Math.abs(f.nose[0] - sh[0]) > 2) votes += 2 * Math.sign(f.nose[0] - sh[0]);
  for (const s of ["left", "right"]) {
    const toe = f.toe[s], heel = f.heel[s];
    if (vis(toe, heel) && Math.abs(toe[0] - heel[0]) > 2) votes += Math.sign(toe[0] - heel[0]);
  }
  return votes >= 0 ? 1 : -1;
}

// ---------- lying down: rotate the image so the pose model sees the person upright ----------
// 90 (clockwise): original (x, y) -> rotated (H - y, x); -90: (x, y) -> (y, W - x).
export function rotationForHead(headLeft) { return headLeft ? 90 : -90; }

export function unrotateLandmarks(lm, rotation) {
  if (!rotation) return lm;
  return lm.map((p) => {
    const u = p.x, v = p.y;
    const [x, y] = rotation === 90 ? [v, 1 - u] : [1 - v, u];
    return { ...p, x, y };
  });
}

export function drawRotated(ctx, source, W, H, rotation) {
  ctx.save();
  if (rotation === 90) { ctx.translate(H, 0); ctx.rotate(Math.PI / 2); }
  else { ctx.translate(0, W); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(source, 0, 0, W, H);
  ctx.restore();
}
