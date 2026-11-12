// Sandbox v3, family "expedition" (11 Nov 2026).
//
// v2 was a 90-second dash to a flag with a hard cap of 150 points; low-cost
// models reached 125–137 on the practice course within three or four attempts.
// The expedition has no cap. A rover lands at a base on a 400 m × 400 m unknown
// map and has a 20-minute mission to find science sites, sample them and bring
// the samples home. More sites exist than any rover can visit, energy is
// limited, the physics is hidden and DIFFERENT ON EVERY COURSE, and parts fail
// mid-mission. The score is the science delivered, as a percentage of what a
// planner with the full map and the true physics delivers on the same course.

import { rng } from './world.mjs';

export const EXPEDITION_PROTOCOL = 'sandbox-v3';
export const SIZE = 400;
export const DT = 0.1;
export const MISSION = 1200;
export const WHEEL_BASE = 0.6;
export const MAX_WHEEL_SPEED = 3;
export const ROVER_RADIUS = 0.5;
export const RAY_ANGLES = [-80, -60, -40, -20, 0, 20, 40, 60, 80];
export const SENSOR_RANGE = 15;
export const CAPACITY = 5; // samples carried at once
export const DRILL_SECONDS = 6;
export const DRILL_RADIUS = 1.5;
export const DOCK_RADIUS = 3;
export const SITE_VIEW = 8; // a site's exact relative position is seen within this range
export const SCIENCE_RANGE = 40;
export const CRASH_SPEED = 1; // hitting a rock faster than this destroys the rover
export const EVAL_COURSES = 10;

const between = (r, lo, hi) => lo + (hi - lo) * r();
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const RAD = Math.PI / 180;
const wrapDeg = d => ((d + 180) % 360 + 360) % 360 - 180;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function generateExpedition(seed) { return { family: 'expedition', seed }; }

// ---------------------------------------------------------------------------
// A course: map, sites, orbital hints, hidden physics, faults and weather.
// Everything, including the physics, is drawn per course, so nothing learned
// about the practice course's numbers carries over to the unseen ones.
export function generateCourse(seed, variant) {
  const r = rng((seed * 7919 + variant * 104729 + 31) >>> 0);
  const base = { x: round(between(r, 130, 270), 1), y: round(between(r, 130, 270), 1) };
  const hills = Array.from({ length: int(r, 10, 18) }, () => ({ x: round(between(r, 20, 380), 1), y: round(between(r, 20, 380), 1), height: round(between(r, 2, 12) * (r() < 0.2 ? -1 : 1), 2), spread: round(between(r, 8, 28), 1) }));
  const rocks = [];
  const clearOfBase = o => dist(o, base) > o.r + 12;
  for (let k = int(r, 5, 9); k > 0; k--) { // ridges: lines of rock with a few gaps
    const a = between(r, 0, Math.PI), len = between(r, 60, 160), x0 = between(r, 30, 370), y0 = between(r, 30, 370);
    const gaps = Array.from({ length: int(r, 1, 2) }, () => ({ at: between(r, 0.15, 0.85) * len, w: between(r, 6, 9) }));
    for (let s = -len / 2; s < len / 2; s += 2.6) {
      if (gaps.some(g => Math.abs(s + len / 2 - g.at) < g.w / 2 + 1.6)) continue;
      const o = { x: round(x0 + s * Math.cos(a), 2), y: round(y0 + s * Math.sin(a), 2), r: 1.6 };
      if (o.x > 3 && o.y > 3 && o.x < SIZE - 3 && o.y < SIZE - 3 && clearOfBase(o)) rocks.push(o);
    }
  }
  const craters = [];
  for (let k = int(r, 3, 5); k > 0; k--) { // craters: a ring of rock with one opening
    const c = { x: round(between(r, 40, 360), 1), y: round(between(r, 40, 360), 1), rad: round(between(r, 10, 18), 1), open: between(r, 0, 2 * Math.PI) };
    if (dist(c, base) < c.rad + 25 || craters.some(q => dist(q, c) < q.rad + c.rad + 12)) continue;
    craters.push(c);
    const half = between(r, 3.5, 4.5) / c.rad + 1.4 / c.rad;
    for (let t = 0; t < 2 * Math.PI; t += 2.4 / c.rad) {
      const d = Math.abs(((t - c.open + Math.PI * 3) % (2 * Math.PI)) - Math.PI);
      if (d < half) continue;
      rocks.push({ x: round(c.x + c.rad * Math.cos(t), 2), y: round(c.y + c.rad * Math.sin(t), 2), r: 1.4 });
    }
  }
  for (let k = int(r, 120, 220), tries = 0; k > 0 && tries < 3000; tries++) { // scattered rocks
    const o = { x: round(between(r, 5, 395), 2), y: round(between(r, 5, 395), 2), r: round(between(r, 0.8, 3), 2) };
    if (!clearOfBase(o) || craters.some(c => dist(c, o) < c.rad - 1) || rocks.some(q => dist(q, o) < q.r + o.r + 3.6)) continue;
    rocks.push(o); k--;
  }
  const sand = Array.from({ length: int(r, 6, 10) }, () => ({ x: round(between(r, 20, 380), 1), y: round(between(r, 20, 380), 1), r: round(between(r, 12, 35), 1) })).filter(s => dist(s, base) > s.r + 15);

  // Science sites. Most are small and near; the rich ones are far away, in
  // craters or in sand.
  const sites = [];
  const place = (p, value) => {
    if (p.x < 10 || p.y < 10 || p.x > SIZE - 10 || p.y > SIZE - 10) return false;
    if (rocks.some(o => dist(o, p) < o.r + 3) || sites.some(s => dist(s, p) < 10) || dist(p, base) < 20) return false;
    sites.push({ x: round(p.x, 1), y: round(p.y, 1), value }); return true;
  };
  for (const c of craters) place(c, int(r, 12, 25));
  for (let n = int(r, 30, 45), tries = 0; sites.length < n && tries < 4000; tries++) {
    const u = r(), tier = u < 0.6 ? 0 : u < 0.9 ? 1 : 2;
    const d = tier === 0 ? between(r, 30, 150) : tier === 1 ? between(r, 60, 190) : between(r, 110, 260), a = between(r, 0, 2 * Math.PI);
    let p = { x: base.x + d * Math.cos(a), y: base.y + d * Math.sin(a) };
    if (tier === 2 && sand.length && r() < 0.5) { const s = sand[int(r, 0, sand.length - 1)]; p = { x: s.x + between(r, -0.5, 0.5) * s.r, y: s.y + between(r, -0.5, 0.5) * s.r }; }
    place(p, tier === 0 ? int(r, 1, 3) : tier === 1 ? int(r, 4, 8) : int(r, 12, 25));
  }
  // Hidden physics, per course.
  const imbalance = between(r, 0.05, 0.3) * (r() < 0.5 ? -1 : 1);
  const hidden = {
    leftMotorGain: round(1 - Math.max(0, imbalance)), rightMotorGain: round(1 - Math.max(0, -imbalance)),
    deadzone: round(between(r, 0.03, 0.2), 2), commandDelayTicks: int(r, 1, 4), traction: round(between(r, 1.5, 4.5)), gravity: round(between(r, 4, 10), 2),
    sandSpeed: round(between(r, 0.35, 0.6), 2), sandGrip: round(between(r, 0.3, 0.55), 2), sandEnergy: round(between(r, 2, 3.2), 2),
    compassBiasDeg: round(between(r, -12, 12), 1), compassDriftDegPerS: round(between(r, -0.04, 0.04), 3),
    gpsNoise: round(between(r, 0.3, 1.5), 2), gpsPeriodTicks: int(r, 5, 20),
    rangeBias: round(between(r, -0.8, 0.8), 2), rangeNoise: round(between(r, 0.02, 0.2), 3), rangeDropout: round(between(r, 0, 0.12), 2), sensorReach: round(between(r, 8, 14), 1),
    windSpeed: round(between(r, 0, 0.4), 2), windDirDeg: round(between(r, -180, 180), 0), gustAmplitude: round(between(r, 0, 0.3), 2), gustPeriod: round(between(r, 6, 20), 1),
    batterySize: round(between(r, 0.8, 1.2), 2), driveCost: round(between(r, 0.8, 1.3), 2), solarGain: round(between(r, 0.7, 1.3), 2),
    sunAzimuthDeg: [round(between(r, 0, 360), 0), 0], sunElevationDeg: [round(between(r, 45, 60), 0), round(between(r, 4, 10), 0)],
  };
  hidden.sunAzimuthDeg[1] = hidden.sunAzimuthDeg[0] + round(between(r, 60, 120), 0) * (r() < 0.5 ? -1 : 1);
  const faults = [];
  const kinds = ['motor', 'rays', 'compass', 'gps', 'battery'];
  for (let k = int(r, 1, 3); k > 0; k--) {
    const kind = kinds.splice(int(r, 0, kinds.length - 1), 1)[0], at = round(between(r, 150, 1000), 0);
    if (kind === 'motor') faults.push({ kind, at, side: r() < 0.5 ? 'left' : 'right', factor: round(between(r, 0.5, 0.75), 2) });
    if (kind === 'rays') faults.push({ kind, at, dead: Array.from({ length: int(r, 1, 3) }, () => int(r, 0, RAY_ANGLES.length - 1)), reads: r() < 0.5 ? SENSOR_RANGE : round(between(r, 0.5, 3), 1) });
    if (kind === 'compass') faults.push({ kind, at, jumpDeg: round(between(r, 20, 60) * (r() < 0.5 ? -1 : 1), 0) });
    if (kind === 'gps') faults.push({ kind, at, seconds: round(between(r, 60, 200), 0) });
    if (kind === 'battery') faults.push({ kind, at, loses: round(between(r, 0.15, 0.3), 2) });
  }
  const storm = r() < 0.6 ? { from: round(between(r, 200, 800), 0), seconds: round(between(r, 120, 300), 0) } : null;
  const course = { variant, base, start: { x: base.x, y: base.y, heading: round(between(r, -180, 180), 0) }, hills, rocks, craters, sand, sites, hidden, faults, storm };
  // Drop sites the rover cannot physically reach.
  const nav = navGrid(course), reach = travelField(nav, base);
  course.sites = sites.filter(s => Number.isFinite(reach.time[nav.cell(s.x, s.y)]));
  // Orbital survey: most real sites, misplaced and mis-valued, plus false positives.
  const hints = [];
  for (const s of course.sites) if (r() < 0.75) hints.push({ x: round(clamp(s.x + between(r, -14, 14), 5, SIZE - 5), 0), y: round(clamp(s.y + between(r, -14, 14), 5, SIZE - 5), 0), estimate: Math.max(1, Math.round(s.value * between(r, 0.5, 1.7))) });
  for (let k = int(r, 8, 12); k > 0; k--) hints.push({ x: round(between(r, 15, 385), 0), y: round(between(r, 15, 385), 0), estimate: int(r, 1, 18) });
  course.hints = hints.sort((a, b) => a.x - b.x || a.y - b.y);
  course.totalValue = course.sites.reduce((s, x) => s + x.value, 0);
  return course;
}

export function heightAt(course, x, y) {
  let h = 0;
  for (const k of course.hills) { const d2 = (x - k.x) ** 2 + (y - k.y) ** 2; if (d2 < 16 * k.spread * k.spread) h += k.height * Math.exp(-d2 / (2 * k.spread * k.spread)); }
  return h;
}
function slopeAlong(course, x, y, heading) {
  const e = 0.25;
  return ((heightAt(course, x + e, y) - heightAt(course, x - e, y)) * Math.cos(heading) + (heightAt(course, x, y + e) - heightAt(course, x, y - e)) * Math.sin(heading)) / (2 * e);
}
const inSand = (course, x, y) => course.sand.some(s => (x - s.x) ** 2 + (y - s.y) ** 2 < s.r * s.r);

// Rocks bucketed on a 10 m grid so rays and collisions only test nearby ones.
function rockIndex(course) {
  if (course._index) return course._index;
  const n = SIZE / 10, cells = Array.from({ length: n * n }, () => []);
  for (const o of course.rocks) {
    for (let i = Math.max(0, Math.floor((o.x - o.r) / 10)); i <= Math.min(n - 1, Math.floor((o.x + o.r) / 10)); i++)
      for (let j = Math.max(0, Math.floor((o.y - o.r) / 10)); j <= Math.min(n - 1, Math.floor((o.y + o.r) / 10)); j++) cells[i * n + j].push(o);
  }
  Object.defineProperty(course, '_index', { value: { n, cells }, enumerable: false });
  return course._index;
}
function near(course, x, y, reach) {
  const { n, cells } = rockIndex(course), out = [];
  for (let i = Math.max(0, Math.floor((x - reach) / 10)); i <= Math.min(n - 1, Math.floor((x + reach) / 10)); i++)
    for (let j = Math.max(0, Math.floor((y - reach) / 10)); j <= Math.min(n - 1, Math.floor((y + reach) / 10)); j++) for (const o of cells[i * n + j]) out.push(o);
  return out;
}
function rayDistance(rocksNear, x, y, heading, limit) {
  const dx = Math.cos(heading), dy = Math.sin(heading);
  let best = limit;
  const walls = [dx > 0 ? (SIZE - x) / dx : dx < 0 ? -x / dx : Infinity, dy > 0 ? (SIZE - y) / dy : dy < 0 ? -y / dy : Infinity];
  for (const w of walls) if (w >= 0 && w < best) best = w;
  for (const o of rocksNear) {
    const fx = x - o.x, fy = y - o.y, b = fx * dx + fy * dy, c = fx * fx + fy * fy - o.r * o.r, disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}
const shape = (cmd, dz) => { const a = Math.abs(cmd); return a <= dz ? 0 : Math.sign(cmd) * (a - dz) / (1 - dz); };

// Energy, in percent of a nominal battery.
const IDLE = 0.008, DRIVE = 0.15, CLIMB = 0.12, DRILL = 0.25, SOLAR = 0.05, SOLAR_MOVING = 0.6, DOCK_CHARGE = 0.6, CARRY = 0.05;

// ---------------------------------------------------------------------------
// One mission. `controller(obs, truth)` returns { left, right, drill }.
// `truth` (true pose and state) is only passed to privileged reference players.
export function simulate(world, course, controller, { traceEvery = 0, pathEvery = 0, privileged = false, reference = null } = {}) {
  const h = course.hidden;
  const noise = rng((world.seed * 31 + course.variant * 977 + 5) >>> 0);
  const gauss = () => { let u = 0, v = 0; while (!u) u = noise(); while (!v) v = noise(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let x = course.start.x, y = course.start.y, heading = course.start.heading * RAD, vL = 0, vR = 0;
  let gainL = h.leftMotorGain, gainR = h.rightMotorGain, compassJump = 0, gpsOffUntil = -1, deadRays = null;
  let capacity = 100 * h.batterySize, battery = capacity;
  const queue = Array.from({ length: h.commandDelayTicks }, () => ({ left: 0, right: 0, drill: false }));
  const sampled = new Uint8Array(course.sites.length);
  const carried = []; let delivered = 0, deliveredCount = 0, lost = 0, drillTicks = 0, drillSite = -1;
  let gps = { x, y }, shade = 0, solar = 0, bumped = false, docked = false;
  let distance = 0, sandSeconds = 0, bumps = 0, energyUsed = 0;
  const trace = [], path = [], events = [];
  const event = (t, what) => { if (events.length < 200) events.push({ t: round(t, 1), what }); };
  const steps = Math.round(MISSION / DT), windDir = h.windDirDeg * RAD;
  const pending = [...course.faults].sort((a, b) => a.at - b.at);
  let outcome = 'complete', message = null, t = 0;
  for (let i = 0; i <= steps; i++) {
    t = i * DT;
    while (pending.length && pending[0].at <= t) {
      const f = pending.shift();
      if (f.kind === 'motor') { if (f.side === 'left') gainL *= f.factor; else gainR *= f.factor; }
      if (f.kind === 'rays') deadRays = f;
      if (f.kind === 'compass') compassJump += f.jumpDeg;
      if (f.kind === 'gps') gpsOffUntil = t + f.seconds;
      if (f.kind === 'battery') { capacity *= 1 - f.loses; battery = Math.min(battery, capacity); }
    }
    const storm = course.storm && t >= course.storm.from && t < course.storm.from + course.storm.seconds;
    const frac = t / MISSION;
    const elevation = (h.sunElevationDeg[0] + (h.sunElevationDeg[1] - h.sunElevationDeg[0]) * frac) * RAD;
    if (i % 10 === 0) { // shadows from the hills, re-checked once a second
      const az = (h.sunAzimuthDeg[0] + (h.sunAzimuthDeg[1] - h.sunAzimuthDeg[0]) * frac) * RAD, here = heightAt(course, x, y), rise = Math.tan(elevation);
      shade = 0;
      for (let s = 1; s <= 12; s++) if (heightAt(course, x + s * 6 * Math.cos(az), y + s * 6 * Math.sin(az)) - here > s * 6 * rise) { shade = 1; break; }
    }
    if (i % h.gpsPeriodTicks === 0 && t >= gpsOffUntil) gps = { x: x + gauss() * h.gpsNoise, y: y + gauss() * h.gpsNoise };
    const reach = Math.min(SENSOR_RANGE, h.sensorReach) * (storm ? 0.4 : 1);
    const nearby = near(course, x, y, reach + 3.5);
    const rays = RAY_ANGLES.map((a, k) => {
      if (deadRays?.dead.includes(k)) return deadRays.reads;
      if (noise() < h.rangeDropout) return SENSOR_RANGE;
      const d = rayDistance(nearby, x, y, heading + a * RAD, reach);
      return d >= reach ? SENSOR_RANGE : round(clamp(d + h.rangeBias + gauss() * h.rangeNoise, 0, SENSOR_RANGE), 2);
    });
    // Science instruments.
    let science = 0, seen = null, seenD = Infinity, seenIndex = -1;
    for (let k = 0; k < course.sites.length; k++) {
      if (sampled[k]) continue;
      const s = course.sites[k], d = Math.hypot(s.x - x, s.y - y);
      if (d < SCIENCE_RANGE) science += s.value * Math.exp(-d / 12);
      if (d < SITE_VIEW && d < seenD) { seenD = d; seenIndex = k; seen = { distance: round(d, 2), bearing: round(wrapDeg((Math.atan2(s.y - y, s.x - x) - heading) / RAD), 1), value: s.value }; }
    }
    const baseD = Math.hypot(course.base.x - x, course.base.y - y);
    const forwardNow = (vL + vR) / 2;
    const obs = {
      t: round(t, 1), timeLeft: round(MISSION - t, 1),
      x: round(gps.x, 2), y: round(gps.y, 2),
      heading: round(wrapDeg(heading / RAD + h.compassBiasDeg + compassJump + h.compassDriftDegPerS * t + gauss() * 0.7), 1),
      wheelLeft: round(vL + gauss() * 0.03, 2), wheelRight: round(vR + gauss() * 0.03, 2),
      pitch: round(Math.atan(slopeAlong(course, x, y, heading)) / RAD + gauss() * 0.5, 1),
      rays, battery: round(clamp(battery / 100 + gauss() * 0.003, 0, 2), 3), solar: round(solar, 4),
      carried: carried.length, carriedValue: carried.reduce((s, v) => s + v, 0), delivered,
      science: round(science * (1 + gauss() * 0.05), 2), site: seen,
      beacon: baseD < 20 ? { distance: round(baseD, 2), bearing: round(wrapDeg((Math.atan2(course.base.y - y, course.base.x - x) - heading) / RAD), 1) } : null,
      docked, bumped, drilling: round(drillTicks * DT, 1),
    };
    if (i === 0) obs.mission = { size: SIZE, seconds: MISSION, base: course.base, capacity: CAPACITY, hints: course.hints };
    let cmd;
    try {
      const out = controller(obs, privileged ? { x, y, heading, vL, vR, battery, capacity, gainL, gainR, sampled, carried: carried.length, t, storm, shade } : undefined);
      cmd = { left: Number.isFinite(out?.left) ? clamp(out.left, -1, 1) : 0, right: Number.isFinite(out?.right) ? clamp(out.right, -1, 1) : 0, drill: Boolean(out?.drill) };
    } catch (e) { outcome = 'error'; message = String(e?.message || e).slice(0, 300); break; }
    if (traceEvery && i % traceEvery === 0) trace.push({ t: obs.t, x: obs.x, y: obs.y, heading: obs.heading, wl: obs.wheelLeft, wr: obs.wheelRight, pitch: obs.pitch, minRay: Math.min(...rays), battery: obs.battery, solar: round(solar, 3), carried: carried.length, delivered, science: obs.science, left: round(cmd.left, 2), right: round(cmd.right, 2), drill: cmd.drill ? 1 : 0 });
    if (pathEvery && i % pathEvery === 0) path.push([round(x, 1), round(y, 1)]);
    queue.push(cmd);
    const applied = queue.shift();
    bumped = false;
    // Motion.
    const sandHere = inSand(course, x, y);
    const k = Math.min(1, h.traction * (sandHere ? h.sandGrip : 1) * DT);
    const slope = slopeAlong(course, x, y, heading), top = MAX_WHEEL_SPEED * (sandHere ? h.sandSpeed : 1);
    vL += (shape(applied.left, h.deadzone) * top * gainL - vL) * k - h.gravity * slope * DT * 0.35;
    vR += (shape(applied.right, h.deadzone) * top * gainR - vR) * k - h.gravity * slope * DT * 0.35;
    const forward = (vL + vR) / 2;
    heading += (vR - vL) / WHEEL_BASE * DT;
    const wind = (h.windSpeed + h.gustAmplitude * Math.sin(2 * Math.PI * t / h.gustPeriod)) * (storm ? 2.5 : 1) * Math.min(1, Math.abs(forward) / 1.5);
    const nx = x + (forward * Math.cos(heading) + wind * Math.cos(windDir)) * DT, ny = y + (forward * Math.sin(heading) + wind * Math.sin(windDir)) * DT;
    const hit = nx < ROVER_RADIUS || ny < ROVER_RADIUS || nx > SIZE - ROVER_RADIUS || ny > SIZE - ROVER_RADIUS || nearby.some(o => (nx - o.x) ** 2 + (ny - o.y) ** 2 < (o.r + ROVER_RADIUS) ** 2);
    if (hit) {
      if (Math.abs(forward) > CRASH_SPEED) { outcome = 'crash'; message = `Hit a rock at ${round(Math.abs(forward), 1)} m/s`; break; }
      vL = 0; vR = 0; bumped = true; bumps++;
    } else { distance += Math.hypot(nx - x, ny - y); x = nx; y = ny; }
    if (sandHere) sandSeconds += DT;
    // Sampling: hold still on a site with the drill on.
    const still = Math.abs(forward) < 0.15;
    if (applied.drill && still && seenIndex >= 0 && seenD < DRILL_RADIUS && carried.length < CAPACITY) {
      if (drillSite !== seenIndex) { drillSite = seenIndex; drillTicks = 0; }
      if (++drillTicks >= DRILL_SECONDS / DT) { sampled[seenIndex] = 1; carried.push(course.sites[seenIndex].value); event(t, `sampled a site worth ${course.sites[seenIndex].value}`); drillTicks = 0; drillSite = -1; }
    } else { drillTicks = 0; drillSite = -1; }
    // Docking: stop at the base to unload and fast-charge.
    docked = Math.hypot(course.base.x - x, course.base.y - y) < DOCK_RADIUS && Math.abs(forward) < 0.3;
    if (docked && carried.length) { const v = carried.reduce((s, q) => s + q, 0); delivered += v; deliveredCount += carried.length; event(t, `delivered ${carried.length} sample${carried.length > 1 ? 's' : ''} worth ${v}`); carried.length = 0; }
    // Energy.
    const moving = Math.abs(forward) > 0.15;
    const use = (IDLE + DRIVE * (Math.abs(vL) + Math.abs(vR)) / (2 * MAX_WHEEL_SPEED) * (sandHere ? h.sandEnergy : 1) * (1 + CARRY * carried.length) + CLIMB * Math.max(0, slope * forward) + (applied.drill ? DRILL : 0)) * h.driveCost;
    solar = SOLAR * h.solarGain * Math.sin(elevation) / Math.sin(60 * RAD) * (shade ? 0.05 : 1) * (storm ? 0.15 : 1) * (moving ? SOLAR_MOVING : 1);
    battery = Math.min(capacity, battery - use * DT + (solar + (docked ? DOCK_CHARGE : 0)) * DT);
    energyUsed += use * DT;
    if (battery <= 0) { outcome = 'stranded'; message = 'Battery empty'; break; }
  }
  if (pathEvery) path.push([round(x, 1), round(y, 1)]);
  lost = carried.reduce((s, v) => s + v, 0);
  if (outcome !== 'complete') event(t, outcome === 'crash' ? 'rover destroyed' : outcome === 'stranded' ? 'battery empty, rover stranded' : 'controller error');
  const par = reference ?? null;
  const score = par ? round(100 * delivered / par, 2) : null;
  return { score, delivered, outcome, time: round(t, 1), message, samples: deliveredCount, lost, progress: round(delivered / Math.max(1, course.totalValue), 3), distance: round(distance, 0), energyUsed: round(energyUsed, 1), sandSeconds: round(sandSeconds, 0), bumps, batteryLeft: round(battery / 100, 3), events, trace, path };
}

// ---------------------------------------------------------------------------
// Navigation grid and travel times, used to check reachability and by the
// full-knowledge planner.
const CELL = 1.5;
export function navGrid(course, margin = 0.45) {
  const n = Math.ceil(SIZE / CELL), cost = new Float32Array(n * n).fill(1);
  const pad = ROVER_RADIUS + margin + CELL / 2;
  for (const o of course.rocks) {
    const R = o.r + pad;
    for (let i = Math.max(0, Math.floor((o.x - R) / CELL)); i <= Math.min(n - 1, Math.floor((o.x + R) / CELL)); i++)
      for (let j = Math.max(0, Math.floor((o.y - R) / CELL)); j <= Math.min(n - 1, Math.floor((o.y + R) / CELL)); j++)
        if (((i + 0.5) * CELL - o.x) ** 2 + ((j + 0.5) * CELL - o.y) ** 2 < R * R) cost[i * n + j] = Infinity;
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const k = i * n + j;
    if (i === 0 || j === 0 || i === n - 1 || j === n - 1) cost[k] = Infinity;
    else if (cost[k] === 1 && inSand(course, (i + 0.5) * CELL, (j + 0.5) * CELL)) cost[k] = 1 / course.hidden.sandSpeed;
  }
  return { n, cost, cell: (x, y) => clamp(Math.floor(x / CELL), 0, n - 1) * n + clamp(Math.floor(y / CELL), 0, n - 1), centre: k => ({ x: (Math.floor(k / n) + 0.5) * CELL, y: (k % n + 0.5) * CELL }) };
}
// Dijkstra from one point: seconds to every cell at full speed, and the way back.
export function travelField(nav, from) {
  const { n, cost } = nav, N = n * n, time = new Float64Array(N).fill(Infinity), parent = new Int32Array(N).fill(-1);
  const heap = [], push = (k, t) => { let i = heap.length; heap.push([t, k]); while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  let s = nav.cell(from.x, from.y);
  if (!Number.isFinite(cost[s])) { // start in a padded cell: use the nearest free one
    let best = -1, bd = Infinity; const ci = Math.floor(s / n), cj = s % n;
    for (let i = Math.max(1, ci - 4); i <= Math.min(n - 2, ci + 4); i++) for (let j = Math.max(1, cj - 4); j <= Math.min(n - 2, cj + 4); j++) { const k = i * n + j, d = (i - ci) ** 2 + (j - cj) ** 2; if (Number.isFinite(cost[k]) && d < bd) { bd = d; best = k; } }
    if (best < 0) return { time, parent }; s = best;
  }
  time[s] = 0; push(s, 0);
  const moves = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [t, k] = pop();
    if (t > time[k]) continue;
    const i = Math.floor(k / n), j = k % n;
    for (const [di, dj, len] of moves) {
      const q = (i + di) * n + (j + dj), c = cost[q];
      if (!Number.isFinite(c)) continue;
      if (di && dj && (!Number.isFinite(cost[(i + di) * n + j]) || !Number.isFinite(cost[i * n + j + dj]))) continue;
      const nt = t + len * CELL * (c + cost[k]) / 2 / MAX_WHEEL_SPEED;
      if (nt < time[q]) { time[q] = nt; parent[q] = k; push(q, nt); }
    }
  }
  return { time, parent, source: s };
}

// The full-knowledge planner: knows the map, every site and its value, the
// physics and its own true position. It picks the next site by value per
// second, always keeps enough time and energy to get home, and follows
// shortest paths. It is a strong heuristic, not the optimum, so scores above
// 100 are possible.
export function plannerController(course) {
  const nav = navGrid(course, 1), h = course.hidden;
  const fields = new Map();
  const clear = (a, b) => { const len = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.ceil(len / 0.7); for (let i = 1; i <= steps; i++) if (!Number.isFinite(nav.cost[nav.cell(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps)])) return false; return true; };
  const field = (key, p) => { if (!fields.has(key)) fields.set(key, travelField(nav, p)); return fields.get(key); };
  const home = field('base', course.base);
  const SLOW = 1.6; // real driving is slower than the grid's full-speed estimate
  let goal = null, route = [], drillFor = 0, backing = 0;
  const skip = new Set();
  const drive = (w, gain) => w === 0 ? 0 : Math.sign(w) * clamp(h.deadzone + (1 - h.deadzone) * Math.min(1, Math.abs(w) / gain), 0, 1);
  // Hold still, also on a slope, where an unpowered rover rolls downhill.
  const uphill = truth => { const sandy = inSand(course, truth.x, truth.y); return h.gravity * slopeAlong(course, truth.x, truth.y, truth.heading) * 0.35 / (h.traction * (sandy ? h.sandGrip : 1) * MAX_WHEEL_SPEED * (sandy ? h.sandSpeed : 1)); };
  const hold = truth => { const w = clamp(uphill(truth) - clamp(0.5 * (truth.vL + truth.vR) / 2 / MAX_WHEEL_SPEED, -0.35, 0.35), -1, 1); return { left: drive(w, truth.gainL), right: drive(w, truth.gainR) }; };
  let stallAt = { x: 0, y: 0, t: 0 };
  const energyFor = seconds => seconds * (0.16 * h.driveCost * 1.25);
  function routeTo(key, p, from) {
    const f = field(key, p); // field grown from the destination: follow parents from here
    const out = []; let k = nav.cell(from.x, from.y), guard = 0;
    if (!Number.isFinite(f.time[k])) { // standing in a padded cell: step to the best free neighbour
      let best = -1; const n = nav.n, ci = Math.floor(k / n), cj = k % n;
      for (let i = ci - 3; i <= ci + 3; i++) for (let j = cj - 3; j <= cj + 3; j++) { const q = i * n + j; if (q >= 0 && q < n * n && Number.isFinite(f.time[q]) && (best < 0 || f.time[q] < f.time[best])) best = q; }
      if (best < 0) return [p]; k = best; out.push(nav.centre(k));
    }
    while (f.parent[k] >= 0 && guard++ < 100000) { k = f.parent[k]; out.push(nav.centre(k)); }
    out.push({ x: p.x, y: p.y });
    return out;
  }
  function choose(truth) {
    const here = { x: truth.x, y: truth.y }, left = MISSION - truth.t;
    const hk = nav.cell(here.x, here.y);
    const toBase = home.time[hk] * SLOW;
    let best = null;
    if (truth.carried < CAPACITY) for (let k = 0; k < course.sites.length; k++) {
      if (truth.sampled[k] || skip.has(k)) continue;
      const s = course.sites[k], f = field(`s${k}`, s), go = f.time[hk] * SLOW;
      if (!Number.isFinite(go)) continue;
      const back = home.time[nav.cell(s.x, s.y)] * SLOW, need = go + DRILL_SECONDS + 4 + back + 25;
      if (need > left) continue;
      if (truth.battery - energyFor(go + back) - 3 < 8) continue;
      const rate = s.value / (go + DRILL_SECONDS + 8 + back * 0.25);
      if (!best || rate > best.rate) best = { rate, k, s };
    }
    return best ? { kind: 'site', key: `s${best.k}`, index: best.k, p: best.s } : { kind: 'base', key: 'base', p: course.base, toBase };
  }
  return function act(obs, truth) {
    const pose = { x: truth.x, y: truth.y };
    if (backing > 0) { if (--backing === 0) goal = null; return { left: -0.5, right: -0.5 }; }
    if (obs.bumped) { backing = 12; return { left: -0.5, right: -0.5 }; }
    if (goal?.kind === 'site' && truth.sampled[goal.index]) { goal = null; drillFor = 0; }
    if (goal?.kind === 'base' && obs.docked) {
      // Home: leave again only with enough charge for a worthwhile trip.
      const next = choose({ ...truth, carried: 0 });
      if (next.kind === 'base') return hold(truth); // nothing affordable: keep charging
      if (truth.battery < Math.min(truth.capacity * 0.9, 70) && MISSION - truth.t > 150) return hold(truth);
      goal = null;
    }
    if (!goal) { goal = choose(truth); route = routeTo(goal.key, goal.p, pose); }
    // Running short of time or energy for the trip home: go now.
    if (goal.kind === 'site') {
      const toBase = home.time[nav.cell(pose.x, pose.y)] * SLOW;
      if (truth.carried > 0 && (toBase + 20 > MISSION - truth.t || truth.battery - energyFor(toBase) < 6)) { goal = { kind: 'base', key: 'base', p: course.base }; route = routeTo('base', course.base, pose); }
    }
    const d = Math.hypot(goal.p.x - pose.x, goal.p.y - pose.y);
    if (goal.kind === 'site' && d < DRILL_RADIUS * 0.75) {
      if (++drillFor > 250) { skip.add(goal.index); goal = null; drillFor = 0; return hold(truth); } // cannot hold still here: give up on this site
      stallAt.t = truth.t;
      return { ...hold(truth), drill: Math.abs((truth.vL + truth.vR) / 2) < 0.12 };
    }
    if (goal.kind === 'base' && d < DOCK_RADIUS * 0.7) { stallAt.t = truth.t; return hold(truth); }
    // Aim at the farthest point of the route within 9 m that is in clear sight.
    while (route.length > 1 && Math.hypot(route[0].x - pose.x, route[0].y - pose.y) < 2) route.shift();
    let ahead = 0;
    for (let k = 1; k < route.length && k < 8; k++) { if (Math.hypot(route[k].x - pose.x, route[k].y - pose.y) > 9 || !clear(pose, route[k])) break; ahead = k; }
    if (ahead > 0) route.splice(0, ahead);
    const aim = route[0] || goal.p;
    const err = wrapDeg((Math.atan2(aim.y - pose.y, aim.x - pose.x) - truth.heading) / RAD);
    // Slow down close to rock: a touch above 1 m/s is fatal.
    let gap = 9;
    for (const o of course.rocks) { const g = Math.hypot(o.x - pose.x, o.y - pose.y) - o.r - ROVER_RADIUS; if (g < gap) gap = g; }
    const cap = gap < 0.8 ? 0.25 : clamp(gap / 3.5, 0.3, 1);
    // Gentle heading control: the rover turns at up to 190°/s if asked, far
    // faster than the command lag allows, so the turn rate is capped and damped.
    const yaw = (truth.vR - truth.vL) / WHEEL_BASE;
    const want = clamp(2 * err * RAD, -1.3, 1.3);
    const turn = clamp((want - 0.35 * (yaw - want)) * WHEEL_BASE / 2 / MAX_WHEEL_SPEED, -0.22, 0.22);
    const near = Math.min(d, 99), speed = clamp(1 - Math.abs(err) / 50, 0.05, 1) * (near < 6 ? Math.max(0.12, near / 6) : 1) * cap;
    const push = clamp(uphill(truth), -0.6, 0.6); // extra thrust to hold speed on a slope
    const wl = clamp(speed + push - turn, -1, 1), wr = clamp(speed + push + turn, -1, 1);
    // Not getting anywhere for 25 s (too steep, wedged): give this site up.
    if (Math.hypot(pose.x - stallAt.x, pose.y - stallAt.y) > 2) stallAt = { x: pose.x, y: pose.y, t: truth.t };
    else if (truth.t - stallAt.t > 25) { if (goal.kind === 'site') skip.add(goal.index); goal = null; stallAt = { x: pose.x, y: pose.y, t: truth.t }; return { left: -0.5, right: -0.5 }; }
    return { left: drive(wl, truth.gainL), right: drive(wr, truth.gainR) };
  };
}
export function plannerRun(world, course) { return simulate(world, course, plannerController(course), { privileged: true }); }
// What 100 means on a course: the planner's delivery, never less than a
// twentieth of the science on the map so a planner mishap cannot inflate scores.
export function referenceValue(world, course) { return Math.max(plannerRun(world, course).delivered, Math.ceil(course.totalValue * 0.05), 1); }

// ---------------------------------------------------------------------------
export function expeditionBrief(attempts) {
  return `Kardashevian lab · Sandbox · expedition (v3)
You write the controller of a two-wheeled science rover (differential drive, wheel base ${WHEEL_BASE} m, radius ${ROVER_RADIUS} m, top wheel speed about ${MAX_WHEEL_SPEED} m/s). It lands at a base on an unknown ${SIZE} m × ${SIZE} m map and has one mission of ${MISSION} s. x grows to the right, y grows upward, headings are in degrees (0 = +x, 90 = +y).

MISSION
Find science sites, sample them and bring the samples back to the base. Only samples delivered to the base count; each is worth its site's value. There are more sites than any rover can visit, so what you choose to do, and in what order, matters as much as how you drive.
- To sample: stop within ${DRILL_RADIUS} m of a site and hold drill = true with the rover still (under 0.15 m/s) for ${DRILL_SECONDS} s without a break. On a slope an unpowered rover rolls, so you may have to hold it with the motors. The drill uses energy whenever it is on. The rover carries at most ${CAPACITY} samples; each one carried makes driving cost more energy.
- To deliver: stop within ${DOCK_RADIUS} m of the base. Everything carried is unloaded at once and the battery fast-charges while you stay docked.
- Samples still on board when the mission ends, the battery runs out or the rover is destroyed are lost. What was already delivered still counts.

THE MAP (unknown to you)
Ridges of rock with a few gaps, craters ringed with rock with one opening, scattered boulders, hills and basins, and patches of soft sand where the rover is slow, grips badly and burns energy. Hitting a rock or the edge of the map faster than ${CRASH_SPEED} m/s destroys the rover; a slower touch just stops it (obs.bumped). Small sites tend to be near the base; rich ones tend to be far away, inside craters or in sand.
On the first tick only, obs.mission = { size, seconds, base: {x, y}, capacity, hints }. hints is an orbital survey: [{ x, y, estimate }]. It lists most but not all real sites, each misplaced by up to about 15–20 m with a rough value estimate, plus some false positives. Keep what you need in mem.

ENERGY
obs.battery is the charge (1 = a nominal full battery). Driving, climbing, sand, carried samples and drilling all drain it; an empty battery ends the mission. Solar panels recharge it slowly: more when the sun is high, far less when moving, almost nothing in the shadow of a hill or in a dust storm. The sun moves and sinks during the mission, so shadows shift and lengthen. obs.solar is the current solar charge rate.

EVERY TICK (${DT} s) your function receives
  obs = { t, timeLeft, x, y, heading, wheelLeft, wheelRight, pitch, rays, battery, solar, carried, carriedValue, delivered, science, site, beacon, docked, bumped, drilling }
  - x, y: GPS position in metres; heading: compass in degrees, -180..180
  - wheelLeft, wheelRight: wheel speeds in m/s; pitch: slope under the rover along its heading, in degrees (positive = uphill)
  - rays: nine range readings in metres at ${RAY_ANGLES.join(', ')} degrees relative to your heading (negative = to your right); ${SENSOR_RANGE} means nothing seen
  - science: strength of the science signal from unsampled sites within about ${SCIENCE_RANGE} m (stronger = closer or richer); no direction
  - site: null, or { distance, bearing, value } of the nearest unsampled site within ${SITE_VIEW} m (bearing in degrees relative to your heading, positive = to your left)
  - beacon: null, or { distance, bearing } of the base within 20 m
  - drilling: seconds of the current drill completed
and must return { left, right, drill }: motor commands between -1 and 1, and drill true or false.

WHAT YOU DO NOT KNOW
The physics is hidden, and it is DIFFERENT ON EVERY COURSE: motor strength and imbalance, dead zone, command lag, grip, how sand and slopes act, compass bias and drift, GPS noise and update rate, range-sensor bias, noise, reach and dropouts, wind, battery size, energy use and solar yield. Tuning constants to the practice course will not carry over. Your controller must measure what it needs while driving.
Parts also fail during a mission, without warning and without any flag in obs: a motor may weaken, range sensors may go blind or stick, the compass may jump, the GPS may freeze for minutes, the battery may lose capacity. A dust storm may cut solar power and sensor range for a while. A good controller notices from its own readings and adapts.

YOUR CODE
Write plain JavaScript (no imports, no network, no timers), at most 120,000 characters:
  function act(obs, mem) { ... return { left, right, drill }; }
\`mem\` is an object that persists between ticks of one mission (it starts empty on every course). Each call must finish within 50 ms and a whole mission within 60 s of your code's own computing time, or the mission ends there.

SCORING
You get ${attempts} attempts. After each you see the result on the practice course: outcome, score, an event log and a trace sampled every 5 s. Your best practice controller then flies ${EVAL_COURSES} unseen courses, each with its own map, sites, physics, faults and weather.
Score per course = 100 × value you delivered ÷ value delivered on the same course by our reference planner, which knows the whole map, every site's true value, the true physics and its own exact position. 100 means matching it. There is no upper limit.`;
}

// Reference players, flown on exactly the same courses as the models. They
// only see obs, like a model's controller.
export const EXPEDITION_BASELINES = {
  idle: { name: 'Do nothing', code: 'function act(obs, mem) { return { left: 0, right: 0, drill: false }; }' },
  random: { name: 'Random', code: 'function act(obs, mem) { if (!mem.c || Math.round(obs.t * 10) % 20 === 0) mem.c = { left: Math.random() * 2 - 1, right: Math.random() * 2 - 1, drill: Math.random() < 0.5 }; return mem.c; }' },
  reference: { name: 'Reference engineer', code: `function act(obs, mem) {
  // A careful but non-learning controller. It works through the orbital hints
  // by estimated value per metre, samples what it sees, and heads home with two
  // samples, a low battery or little time left. It trusts its sensors and never
  // adapts to the hidden physics or to faults.
  if (obs.mission) { mem.base = obs.mission.base; mem.hints = obs.mission.hints.map(function (h) { return { x: h.x, y: h.y, v: h.estimate, done: false }; }); mem.back = 0; mem.spin = 0; mem.search = 0; mem.drillFor = 0; }
  var r = obs.rays, stop = { left: 0, right: 0, drill: false };
  var toBase = Math.hypot(mem.base.x - obs.x, mem.base.y - obs.y);
  var home = obs.carried >= 2 || obs.battery < 0.35 || obs.timeLeft < toBase / 1.0 + 90 || (obs.carried > 0 && obs.timeLeft < toBase / 1.0 + 150);
  if (mem.back > 0) { mem.back--; return { left: -0.45, right: -0.45, drill: false }; }
  if (mem.spin > 0) { mem.spin--; return { left: -0.3 * mem.dir, right: 0.3 * mem.dir, drill: false }; }
  var goTo = function (bearing, distance) {
    var front = Math.min(r[3], r[4], r[5]);
    if (obs.bumped || r[4] < 1.3 || r[3] < 1.0 || r[5] < 1.0) { mem.back = 10; mem.spin = 8; mem.dir = (r[0] + r[1] + r[2] > r[6] + r[7] + r[8]) ? -1 : 1; return { left: -0.45, right: -0.45, drill: false }; }
    var turn = front < 4.5 ? ((r[5] + r[6] + r[7] > r[1] + r[2] + r[3]) ? 0.5 : -0.5) : Math.max(-0.6, Math.min(0.6, bearing / 50));
    var base = front < 4.5 ? 0.35 : (distance < 5 ? 0.3 : 0.55);
    return { left: base - turn * 0.25, right: base + turn * 0.25, drill: false };
  };
  if (home) {
    if (obs.docked) return (obs.battery < 0.8 && obs.timeLeft > 200) ? stop : (mem.hints.some(function (h) { return !h.done; }) && obs.timeLeft > 200 ? goTo(0, 99) : stop);
    if (obs.beacon) { if (obs.beacon.distance < 2) return stop; return goTo(obs.beacon.bearing, obs.beacon.distance); }
    var b = Math.atan2(mem.base.y - obs.y, mem.base.x - obs.x) * 180 / Math.PI;
    return goTo(((b - obs.heading + 540) % 360) - 180, toBase);
  }
  if (obs.docked && obs.battery < 0.8) return stop;
  if (obs.site && obs.carried < 5) {
    if (obs.site.distance < 1.2) { if (++mem.drillFor > 200) { mem.drillFor = 0; mem.spin = 20; mem.dir = 1; } return { left: 0, right: 0, drill: true }; }
    mem.drillFor = 0;
    return goTo(obs.site.bearing, obs.site.distance);
  }
  var best = null, bestRate = 0;
  for (var i = 0; i < mem.hints.length; i++) { var h = mem.hints[i]; if (h.done) continue; var d = Math.hypot(h.x - obs.x, h.y - obs.y); var rate = h.v / (d + 20); if (rate > bestRate) { bestRate = rate; best = h; } }
  if (!best) return stop;
  var dist = Math.hypot(best.x - obs.x, best.y - obs.y);
  if (dist < 8) { if (++mem.search > 150) { best.done = true; mem.search = 0; } return { left: 0.15, right: 0.4, drill: false }; }
  var want = Math.atan2(best.y - obs.y, best.x - obs.x) * 180 / Math.PI;
  return goTo(((want - obs.heading + 540) % 360) - 180, dist);
}` },
};
