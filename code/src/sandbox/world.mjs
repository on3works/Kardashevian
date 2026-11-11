// Random-world sandbox, family "rover" (sandbox-v2): a top-down
// differential-drive rover must visit checkpoints in order and then reach a
// flag in a 40 m × 40 m arena. Every world has hidden physics; every course
// has barrier walls with narrow gaps, dead-end pockets and scattered rocks.
// Models only ever see the public brief and simulator feedback.
//
// v2 (28 Sep 2026) replaced v1 after GPT-6 Luna scored 132 of 150 on a v1
// practice course: v1 was a straight dash past a few rocks.

export const SANDBOX_PROTOCOL = 'sandbox-v2';
export const ARENA = 40;
export const DT = 0.05;
export const MAX_TIME = 90;
export const WHEEL_BASE = 0.6;
export const MAX_WHEEL_SPEED = 3;
export const ROVER_RADIUS = 0.35;
export const TARGET_RADIUS = 1;
export const SENSOR_RANGE = 10;
export const RAY_ANGLES = [-60, -30, 0, 30, 60];
export const EVAL_VARIANTS = 10;

// Small, fast, deterministic PRNG. Same seed, same world, on every machine.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, lo, hi) => lo + (hi - lo) * r();
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const deg = rad => rad * 180 / Math.PI;
const wrapDeg = d => ((d + 180) % 360 + 360) % 360 - 180;

export function generateWorld(seed) {
  const r = rng(seed);
  const imbalance = between(r, 0.06, 0.3) * (r() < 0.5 ? -1 : 1); // + means the left motor is weaker
  const hidden = {
    leftMotorGain: round(1 - Math.max(0, imbalance)),
    rightMotorGain: round(1 - Math.max(0, -imbalance)),
    deadzone: round(between(r, 0.03, 0.2), 2), // commands smaller than this do nothing
    commandDelayTicks: int(r, 2, 7), // 100–350 ms
    traction: round(between(r, 1.5, 4.5)), // how fast wheels reach the commanded speed
    gravity: round(between(r, 4, 14), 2), // strength of the hills
    compassBiasDeg: round(between(r, -12, 12), 1),
    compassDriftDegPerS: round(between(r, -0.5, 0.5), 2), // the compass error grows during a run
    gpsNoise: round(between(r, 0.05, 0.3), 2),
    gpsRateHz: int(r, 2, 5), // position only updates this often; stale in between
    rangeBias: round(between(r, -0.8, 0.8), 2),
    rangeNoise: round(between(r, 0.02, 0.18), 3),
    rangeDropout: round(between(r, 0, 0.12), 2), // chance a reading misses everything
    sensorReach: round(between(r, 6, 9.5), 1), // beyond this the sensors see nothing
    windSpeed: round(between(r, 0, 0.4), 2), // m/s of drift
    windDirDeg: round(between(r, -180, 180), 0),
    gustAmplitude: round(between(r, 0, 0.3), 2),
    gustPeriod: round(between(r, 6, 20), 1),
    hills: Array.from({ length: int(r, 3, 5) }, () => ({ x: round(between(r, 8, 32), 1), y: round(between(r, 5, 35), 1), height: round(between(r, 0.6, 2), 2) * (r() < 0.25 ? -1 : 1), spread: round(between(r, 3, 6), 1) })),
    ice: Array.from({ length: int(r, 2, 4) }, () => ({ x: round(between(r, 8, 32), 1), y: round(between(r, 5, 35), 1), r: round(between(r, 2, 4.5), 1) })),
    iceGrip: round(between(r, 0.2, 0.45), 2), // traction multiplier on ice
  };
  return { family: 'rover', seed, hidden };
}

// Course style. Practice is always the same medium style; the unseen courses
// draw from a wider range so that tuning to the practice layout does not pay.
function courseStyle(r, variant) {
  if (variant === 0) return { barriers: 2, rocks: 10, gap: 2.6, pockets: 1, checkpoints: 2, mirrored: false };
  return { barriers: int(r, 1, 4), rocks: int(r, 6, 20), gap: round(between(r, 2.2, 3.2), 2), pockets: int(r, 0, 2), checkpoints: int(r, 1, 4), mirrored: r() < 0.5 };
}

function blockedGrid(obstacles, step = 0.5, pad = ROVER_RADIUS + 0.15) {
  const n = Math.round(ARENA / step);
  const blocked = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = (i + 0.5) * step, y = (j + 0.5) * step;
    if (x < pad || y < pad || x > ARENA - pad || y > ARENA - pad || obstacles.some(o => Math.hypot(x - o.x, y - o.y) < o.r + pad)) blocked[i * n + j] = 1;
  }
  return { n, step, blocked };
}
function reachable(grid, a, b) {
  const { n, step, blocked } = grid;
  const cell = p => [clamp(Math.floor(p.x / step), 0, n - 1), clamp(Math.floor(p.y / step), 0, n - 1)];
  const [ai, aj] = cell(a), [bi, bj] = cell(b);
  if (blocked[ai * n + aj] || blocked[bi * n + bj]) return false;
  const seen = new Uint8Array(n * n); const queue = [ai * n + aj]; seen[ai * n + aj] = 1;
  while (queue.length) {
    const c = queue.pop(); const i = Math.floor(c / n), j = c % n;
    if (i === bi && j === bj) return true;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const k = ni * n + nj;
      if (!seen[k] && !blocked[k]) { seen[k] = 1; queue.push(k); }
    }
  }
  return false;
}

// A layout is the part that changes between the practice run and the held-out
// evaluation runs: start, checkpoints, flag and obstacles. Physics stay the
// same. Every layout is checked to be solvable; unsolvable draws are redrawn.
export function generateLayout(seed, variant) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = rng((seed * 7919 + variant * 104729 + attempt * 1299709 + 17) >>> 0);
    const style = courseStyle(r, variant);
    const fx = x => style.mirrored ? ARENA - x : x;
    const start = { x: round(fx(between(r, 2.5, 4.5))), y: round(between(r, 5, 35)), heading: round(wrapDeg(between(r, -40, 40) + (style.mirrored ? 180 : 0)), 1) };
    const goal = { x: round(fx(between(r, 35, 37.5))), y: round(between(r, 5, 35)) };
    const obstacles = [];
    // Barrier walls across the arena, each with one or two narrow gaps.
    const span = 26 / (style.barriers + 1);
    const barrierXs = Array.from({ length: style.barriers }, (_, k) => 7 + span * (k + 1) + between(r, -1.5, 1.5));
    for (const bx of barrierXs) {
      const gaps = Array.from({ length: r() < 0.35 ? 2 : 1 }, () => between(r, 4, 36));
      for (let y = 0.6; y < ARENA; y += 1.1) {
        if (gaps.some(g => Math.abs(y - g) < style.gap / 2 + 0.8)) continue;
        obstacles.push({ x: round(fx(bx), 2), y: round(y, 2), r: 0.8 });
      }
    }
    // Dead-end pockets: a cup of rocks opening back toward the start.
    for (let p = 0; p < style.pockets; p++) {
      const cx = between(r, 12, 28), cy = between(r, 8, 32), rad = between(r, 2.8, 4);
      for (let a = -100; a <= 100; a += 18) {
        const t = a * Math.PI / 180;
        obstacles.push({ x: round(fx(cx + rad * Math.cos(t)), 2), y: round(cy + rad * Math.sin(t), 2), r: 0.7 });
      }
    }
    // Checkpoints, visited in order, spread along the way to the flag.
    const checkpoints = [];
    for (let c = 0; c < style.checkpoints; c++) {
      const cx = 6 + (28 * (c + 1)) / (style.checkpoints + 1) + between(r, -2, 2);
      checkpoints.push({ x: round(fx(cx)), y: round(between(r, 4, 36)) });
    }
    const targets = [...checkpoints, goal];
    const keepClear = [start, ...targets];
    const clearOf = (o, gap) => keepClear.every(p => Math.hypot(o.x - p.x, o.y - p.y) > o.r + gap);
    const kept = obstacles.filter(o => clearOf(o, 1.6));
    // Scattered rocks.
    for (let tries = 0, added = 0; added < style.rocks && tries < 600; tries++) {
      const o = { x: round(between(r, 8, 32), 2), y: round(between(r, 2, 38), 2), r: round(between(r, 0.6, 1.8), 2) };
      if (!clearOf(o, 2.2) || Math.hypot(o.x - start.x, o.y - start.y) < o.r + 4) continue;
      if (kept.some(q => Math.hypot(o.x - q.x, o.y - q.y) < o.r + q.r + 0.9)) continue;
      kept.push(o); added++;
    }
    const grid = blockedGrid(kept);
    let ok = true, from = start;
    for (const t of targets) { if (!reachable(grid, from, t)) { ok = false; break; } from = t; }
    if (ok) return { variant, style, start, checkpoints, goal, obstacles: kept };
  }
  throw new Error(`Could not build a solvable course for seed ${seed} variant ${variant}`);
}

export function heightAt(hidden, x, y) {
  let h = 0;
  for (const hill of hidden.hills) h += hill.height * Math.exp(-((x - hill.x) ** 2 + (y - hill.y) ** 2) / (2 * hill.spread ** 2));
  return h;
}
function slopeAlong(hidden, x, y, heading) {
  const e = 0.05;
  const gx = (heightAt(hidden, x + e, y) - heightAt(hidden, x - e, y)) / (2 * e);
  const gy = (heightAt(hidden, x, y + e) - heightAt(hidden, x, y - e)) / (2 * e);
  return gx * Math.cos(heading) + gy * Math.sin(heading);
}

// Distance from (x, y) along heading to the first obstacle or wall.
export function rayDistance(layout, x, y, heading, limit = SENSOR_RANGE) {
  const dx = Math.cos(heading), dy = Math.sin(heading);
  let best = limit;
  const walls = [dx > 0 ? (ARENA - x) / dx : dx < 0 ? -x / dx : Infinity, dy > 0 ? (ARENA - y) / dy : dy < 0 ? -y / dy : Infinity];
  for (const w of walls) if (w >= 0 && w < best) best = w;
  for (const o of layout.obstacles) {
    const fx = x - o.x, fy = y - o.y;
    const b = fx * dx + fy * dy;
    if (b > 0 && fx * fx + fy * fy > (o.r + best) ** 2) continue;
    const c = fx * fx + fy * fy - o.r * o.r;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

function shape(cmd, deadzone) {
  const a = Math.abs(cmd);
  return a <= deadzone ? 0 : Math.sign(cmd) * (a - deadzone) / (1 - deadzone);
}

// Runs one episode. `controller(obs)` returns { left, right } (or throws).
// Returns the score, outcome and an optional downsampled trace.
export function simulate(world, layout, controller, { traceEvery = 0, pathEvery = 0 } = {}) {
  const h = world.hidden;
  const noise = rng((world.seed * 31 + layout.variant * 977 + 5) >>> 0);
  const gauss = () => { let u = 0, v = 0; while (!u) u = noise(); while (!v) v = noise(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let x = layout.start.x, y = layout.start.y, heading = layout.start.heading * Math.PI / 180;
  let vL = 0, vR = 0;
  const queue = Array.from({ length: h.commandDelayTicks }, () => ({ left: 0, right: 0 }));
  const targets = [...layout.checkpoints, layout.goal];
  let reached = 0, legStart = { x, y };
  const trace = [], path = [];
  const steps = Math.round(MAX_TIME / DT);
  const gpsEvery = Math.max(1, Math.round(1 / (h.gpsRateHz * DT)));
  let gps = { x, y };
  const windDir = h.windDirDeg * Math.PI / 180;
  let outcome = 'timeout', message = null, t = 0;
  for (let i = 0; i <= steps; i++) {
    t = i * DT;
    if (i % gpsEvery === 0) gps = { x: x + gauss() * h.gpsNoise, y: y + gauss() * h.gpsNoise };
    const reach = Math.min(SENSOR_RANGE, h.sensorReach);
    const rays = RAY_ANGLES.map(a => {
      if (noise() < h.rangeDropout) return SENSOR_RANGE;
      const d = rayDistance(layout, x, y, heading + a * Math.PI / 180, reach);
      return d >= reach ? SENSOR_RANGE : round(clamp(d + h.rangeBias + gauss() * h.rangeNoise, 0, SENSOR_RANGE), 2);
    });
    const target = targets[reached];
    const obs = {
      t: round(t, 2),
      x: round(gps.x, 2), y: round(gps.y, 2),
      heading: round(wrapDeg(deg(heading) + h.compassBiasDeg + h.compassDriftDegPerS * t + gauss() * 0.7), 1),
      speed: round((vL + vR) / 2 + gauss() * 0.03, 2),
      rays, distanceAhead: rays[2],
      targetX: target.x, targetY: target.y, targetIndex: reached, targetsLeft: targets.length - reached,
      targets: targets.map(p => ({ x: p.x, y: p.y })),
      goalX: layout.goal.x, goalY: layout.goal.y,
    };
    let cmd;
    try {
      const out = controller(obs);
      cmd = { left: Number.isFinite(out?.left) ? clamp(out.left, -1, 1) : 0, right: Number.isFinite(out?.right) ? clamp(out.right, -1, 1) : 0 };
    } catch (e) {
      outcome = 'error'; message = String(e?.message || e).slice(0, 300); break;
    }
    if (traceEvery && i % traceEvery === 0) trace.push({ t: obs.t, x: obs.x, y: obs.y, heading: obs.heading, speed: obs.speed, rays: obs.rays.join('|'), target: reached, left: round(cmd.left, 2), right: round(cmd.right, 2) });
    if (pathEvery && i % pathEvery === 0) path.push([round(x, 2), round(y, 2)]);
    queue.push(cmd);
    const applied = queue.shift();
    // Wheel speeds chase the (dead-zoned, imbalanced) command with limited
    // traction, less on ice; hills push back; wind drifts the whole rover.
    const onIce = h.ice.some(p => Math.hypot(x - p.x, y - p.y) < p.r);
    const k = Math.min(1, h.traction * (onIce ? h.iceGrip : 1) * DT);
    const slope = slopeAlong(h, x, y, heading);
    vL += (shape(applied.left, h.deadzone) * MAX_WHEEL_SPEED * h.leftMotorGain - vL) * k - h.gravity * slope * DT * 0.35;
    vR += (shape(applied.right, h.deadzone) * MAX_WHEEL_SPEED * h.rightMotorGain - vR) * k - h.gravity * slope * DT * 0.35;
    const forward = (vL + vR) / 2;
    heading += (vR - vL) / WHEEL_BASE * DT;
    // Wind pushes a moving rover sideways; a stopped rover holds its ground.
    const wind = (h.windSpeed + h.gustAmplitude * Math.sin(2 * Math.PI * t / h.gustPeriod)) * Math.min(1, Math.abs(forward) / 1.5);
    x += (forward * Math.cos(heading) + wind * Math.cos(windDir)) * DT;
    y += (forward * Math.sin(heading) + wind * Math.sin(windDir)) * DT;
    if (x < ROVER_RADIUS || y < ROVER_RADIUS || x > ARENA - ROVER_RADIUS || y > ARENA - ROVER_RADIUS) { outcome = 'crash'; message = 'Hit the arena wall'; break; }
    if (layout.obstacles.some(o => Math.hypot(x - o.x, y - o.y) < o.r + ROVER_RADIUS)) { outcome = 'crash'; message = 'Hit an obstacle'; break; }
    if (Math.hypot(target.x - x, target.y - y) < TARGET_RADIUS) {
      reached++; legStart = { x, y };
      if (reached === targets.length) { outcome = 'goal'; break; }
    }
  }
  if (pathEvery) path.push([round(x, 2), round(y, 2)]);
  // Progress: finished legs plus the share of the current leg covered.
  const current = targets[Math.min(reached, targets.length - 1)];
  const legLength = Math.max(1, Math.hypot(current.x - legStart.x, current.y - legStart.y));
  const partial = reached >= targets.length ? 0 : clamp(1 - Math.hypot(current.x - x, current.y - y) / legLength, 0, 1);
  const progress = clamp((reached + partial) / targets.length, 0, 1);
  const score = outcome === 'goal' ? 100 + 50 * (1 - t / MAX_TIME) : 90 * progress - (outcome === 'crash' || outcome === 'error' ? 15 : 0);
  return { score: round(score, 2), outcome, time: round(t, 2), progress: round(progress, 3), checkpoints: `${Math.min(reached, layout.checkpoints.length)}/${layout.checkpoints.length}`, endDistance: round(Math.hypot(current.x - x, current.y - y), 2), message, trace, path };
}

export function publicBrief(attempts) {
  return `AlphaElo sandbox · rover world (v2)
You control a two-wheeled rover (differential drive, wheel base ${WHEEL_BASE} m, radius ${ROVER_RADIUS} m) in a ${ARENA} m × ${ARENA} m walled arena seen from above. x grows to the right, y grows upward, heading is in degrees (0 = +x, 90 = +y).
Goal: visit every checkpoint in order and then reach the flag, getting within ${TARGET_RADIUS} m of each, as fast as possible, within ${MAX_TIME} s. The course has walls of rocks with narrow gaps, dead-end pockets and scattered rocks. You only see them through five range sensors. Touching a rock or the arena wall ends the run.

Every tick (${DT} s) your function receives:
  obs = { t, x, y, heading, speed, rays, distanceAhead, targetX, targetY, targetIndex, targetsLeft, targets, goalX, goalY }
  - x, y: position in metres from a GPS
  - heading: compass reading in degrees, -180..180
  - speed: forward speed in m/s
  - rays: five range readings in metres at ${RAY_ANGLES.join(', ')} degrees relative to your heading (negative = to your right); ${SENSOR_RANGE} means nothing seen. distanceAhead = rays[2]
  - targetX, targetY: the checkpoint (or finally the flag) you must reach next; targetIndex counts those already reached
  - targets: every checkpoint in order, then the flag
and must return { left, right }: motor commands between -1 and 1 (1 = full forward).

This world has physics you do not know and must discover from results. Expect imperfect motors, lag, sensors, terrain and weather: for example commands that take time to act, motors of unequal strength or that ignore small commands, a compass that is off and may drift, a GPS that is noisy or slow to update, range sensors that are biased, noisy, short-sighted or sometimes miss things, hills, slippery ground and wind. Nothing here is guaranteed to be ideal.

Write plain JavaScript (no imports, no network, no timers):
  function act(obs, mem) { ... return { left, right }; }
\`mem\` is an object you can use to keep state between ticks. Each call must finish quickly.

You get ${attempts} attempts. After each attempt you see the result on the practice course: outcome, score, checkpoints reached, and a trace sampled every 0.5 s. Your best practice controller is then scored on ${EVAL_VARIANTS} unseen courses with the same physics but different layouts: the number of walls, gaps, pockets, rocks and checkpoints changes, and some courses run right to left. Build something that generalises; do not hard-code this one course.
Score per course: finishing (all checkpoints, then the flag) = 100 + up to 50 for speed. Otherwise up to 90 for progress (checkpoints reached plus progress toward the next one), minus 15 for a crash.`;
}
