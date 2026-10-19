import { isBehindThree, onHalfCourt } from "./court";
import { STYLE_LABEL, STYLE_OPTIONS, CONTEST_OPTIONS, type Filters, type Shot, type ShotContest, type ShotRange, type ShotStyle } from "./types";

export type CurvePoint = {
  t: number;
  f: number;
  z: number;
  l: number;
  zLo: number;
  zHi: number;
};

function coherent(shot: Shot): boolean {
  const path = shot.path;
  if (path.length < 4) return false;
  let maxStep = 0;
  for (let index = 1; index < path.length; index += 1) {
    const step = Math.hypot(
      path[index][1] - path[index - 1][1],
      path[index][2] - path[index - 1][2],
      path[index][3] - path[index - 1][3],
    );
    maxStep = Math.max(maxStep, step);
  }
  // One sample jumping several feet is a broken track, not a shot.
  if (maxStep > 8) return false;
  const flight = path.filter((point) => point[0] >= 0);
  if (flight.length < 3) return false;
  let maxForward = -Infinity;
  let apexIndex = 0;
  let apex = -Infinity;
  for (let index = 0; index < flight.length; index += 1) {
    maxForward = Math.max(maxForward, flight[index][1]);
    if (flight[index][3] >= apex) {
      apex = flight[index][3];
      apexIndex = index;
    }
  }
  let minAfter = Infinity;
  for (let index = apexIndex; index < flight.length; index += 1) {
    minAfter = Math.min(minAfter, flight[index][3]);
  }
  // A jumper that stalls in the air, or dies well short of the rim, is not a shot arc.
  if (shot.dist > 10) {
    if (maxForward < shot.dist * 0.75) return false;
    if (minAfter > 12) return false;
  } else if (shot.dist > 8 && maxForward < shot.dist * 0.35) {
    return false;
  }
  return true;
}

/** Keep the gather, and stop the flight at the sample closest to the rim. */
export function clipFlight(shot: Shot): number[][] {
  const path = shot.path;
  if (path.length < 2) return path;
  let apexIndex = -1;
  let apex = -Infinity;
  for (let index = 0; index < path.length; index += 1) {
    if (path[index][0] < 0) continue;
    if (path[index][3] >= apex) {
      apex = path[index][3];
      apexIndex = index;
    }
  }
  if (apexIndex < 0) return path;
  let best = -1;
  let bestGap = Infinity;
  for (let index = apexIndex + 1; index < path.length; index += 1) {
    const forward = path[index][1];
    const height = path[index][3];
    if (forward < shot.dist - 4) continue;
    const gap = Math.hypot(forward - shot.dist, height - 10);
    if (gap < bestGap) {
      bestGap = gap;
      best = index;
    }
    if (height < 8 && forward >= shot.dist - 2) break;
  }
  if (best >= 0 && bestGap <= 3.5) return path.slice(0, best + 1);
  return path;
}

export function filterShots(shots: Shot[], filters: Filters): Shot[] {
  return shots.filter((shot) => {
    // Feet off the half court mean the basket side, or the player track, was wrong.
    if (!shotSpot(shot)) return false;
    if (!coherent(shot)) return false;
    if (shot.j !== 1 || shot.r === "rim") return false;
    if (!filters.style.includes(shot.s)) return false;
    if (!filters.contest.includes(shot.k)) return false;
    if (filters.range !== "all" && displayRange(shot) !== filters.range) return false;
    if (!filters.result.includes(shot.m === 1 ? "make" : "miss")) return false;
    return true;
  });
}

export function shotKey(shot: Shot): string {
  return `${shot.g}-${shot.p}-${shot.c}-${shot.d}-${shot.a}`;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - index) + sorted[hi] * (index - lo);
}

function at(path: number[][], t: number, column: number): number | null {
  if (path.length < 2 || t < path[0][0] || t > path[path.length - 1][0]) return null;
  for (let i = 1; i < path.length; i += 1) {
    if (path[i][0] >= t) {
      const span = path[i][0] - path[i - 1][0] || 1e-6;
      const mix = (t - path[i - 1][0]) / span;
      return path[i - 1][column] + (path[i][column] - path[i - 1][column]) * mix;
    }
  }
  return null;
}

export function samplePath(path: number[][], t: number): number[] | null {
  if (path.length < 2) return null;
  const clamped = Math.min(path[path.length - 1][0], Math.max(path[0][0], t));
  const values = [0, 1, 2, 3, 4, 5].map((column) => at(path, clamped, column));
  if (values.some((value) => value == null)) return null;
  return values as number[];
}

export type GatherSample = {
  t: number;
  f: number;
  z: number;
  l: number;
  fLo: number;
  fHi: number;
  zLo: number;
  zHi: number;
};

/**
 * Median gather through release, plus the middle half of the paths around it.
 * At each moment, f/z are the medians and the Lo/Hi fields are the 25th and 75th percentiles.
 * The window starts when half of the gathers have begun, so a few long gathers do not pull the path.
 */
export function medianGather(shots: Shot[]): GatherSample[] {
  const paths = shots.map((shot) => clipFlight(shot)).filter((path) => path.length >= 2);
  if (paths.length < 5) return [];
  const starts = paths.map((path) => path[0][0]).filter((time) => time <= 0).sort((a, b) => a - b);
  if (!starts.length) return [];
  const begin = starts[Math.floor((starts.length - 1) * 0.5)];
  const need = Math.max(4, Math.ceil(paths.length * 0.5));
  const samples: GatherSample[] = [];
  for (let time = begin; time < -0.001; time += 0.04) {
    const sample = gatherSample(paths, Math.round(time * 1000) / 1000, need);
    if (sample) samples.push(sample);
  }
  const release = gatherSample(paths, 0, need);
  if (release) samples.push(release);
  return samples;
}

function gatherSample(paths: number[][][], time: number, need: number): GatherSample | null {
  const forward: number[] = [];
  const lateral: number[] = [];
  const height: number[] = [];
  for (const path of paths) {
    const f = at(path, time, 1);
    const l = at(path, time, 2);
    const z = at(path, time, 3);
    if (f == null || l == null || z == null) continue;
    forward.push(f);
    lateral.push(l);
    height.push(z);
  }
  if (forward.length < need) return null;
  return {
    t: time,
    f: quantile(forward, 0.5),
    z: quantile(height, 0.5),
    l: quantile(lateral, 0.5),
    fLo: quantile(forward, 0.25),
    fHi: quantile(forward, 0.75),
    zLo: quantile(height, 0.25),
    zHi: quantile(height, 0.75),
  };
}

function flightWindow(shot: Shot): { path: number[][]; start: number; end: number } | null {
  const path = clipFlight(shot);
  let start = Infinity;
  let end = -Infinity;
  for (const point of path) {
    if (point[0] < 0) continue;
    start = Math.min(start, point[0]);
    end = Math.max(end, point[0]);
  }
  if (!Number.isFinite(start) || end <= start) return null;
  return { path, start, end };
}

type GatherShape = { dur: number; maxLat: number; pathLen: number; maxStep: number };

function gatherShape(shot: Shot): GatherShape | null {
  const pre: number[][] = [];
  for (const point of shot.path) {
    if (point[0] > 0) break;
    pre.push(point);
  }
  if (pre.length < 2) return null;
  let maxLat = 0;
  let pathLen = 0;
  let maxStep = 0;
  for (let index = 0; index < pre.length; index += 1) {
    maxLat = Math.max(maxLat, Math.abs(pre[index][2]));
    if (index === 0) continue;
    const step = Math.hypot(
      pre[index][1] - pre[index - 1][1],
      pre[index][2] - pre[index - 1][2],
      pre[index][3] - pre[index - 1][3],
    );
    pathLen += step;
    maxStep = Math.max(maxStep, step);
  }
  return { dur: -pre[0][0], maxLat, pathLen, maxStep };
}

function spread(values: number[]): { mid: number; scale: number } {
  const mid = quantile(values, 0.5);
  return { mid, scale: Math.max(0.35, quantile(values, 0.75) - mid) };
}

function excess(value: number, band: { mid: number; scale: number }): number {
  return Math.max(0, value - band.mid) / band.scale;
}

// One real attempt. The flight has to stay near the pointwise median arc.
// Among those, the move before release has to look like this player's usual gather,
// so a sideways pass or a broken track is not drawn as the typical shot.
export function medianShot(shots: Shot[]): Shot | null {
  if (!shots.length) return null;
  if (shots.length === 1) return shots[0];
  const windows = shots.map(flightWindow);
  const t0 = Math.max(0, quantile(windows.map((window) => window?.start ?? 0), 0.5));
  const t1 = quantile(windows.map((window) => window?.end ?? 0), 0.5);
  const times: number[] = [];
  for (let t = t0; t <= t1 + 1e-6; t += 0.04) times.push(Math.round(t * 1000) / 1000);
  if (times.length < 2) return shots[0];
  const need = shots.length < 5 ? Math.ceil(shots.length * 0.5) : Math.max(4, Math.ceil(shots.length * 0.2));
  const target: ({ f: number; l: number; z: number } | null)[] = times.map((t) => {
    const forward: number[] = [];
    const lateral: number[] = [];
    const height: number[] = [];
    for (const window of windows) {
      if (!window) continue;
      const f = at(window.path, t, 1);
      const l = at(window.path, t, 2);
      const z = at(window.path, t, 3);
      if (f == null || l == null || z == null) continue;
      forward.push(f);
      lateral.push(l);
      height.push(z);
    }
    if (forward.length < need) return null;
    return { f: quantile(forward, 0.5), l: quantile(lateral, 0.5), z: quantile(height, 0.5) };
  });
  const ranked: { shot: Shot; score: number; covered: boolean }[] = [];
  for (let shotIndex = 0; shotIndex < shots.length; shotIndex += 1) {
    const window = windows[shotIndex];
    if (!window) continue;
    let error = 0;
    let count = 0;
    for (let index = 0; index < times.length; index += 1) {
      const goal = target[index];
      if (!goal) continue;
      const f = at(window.path, times[index], 1);
      const l = at(window.path, times[index], 2);
      const z = at(window.path, times[index], 3);
      if (f == null || l == null || z == null) continue;
      error += (f - goal.f) ** 2 + (z - goal.z) ** 2 + 0.35 * (l - goal.l) ** 2;
      count += 1;
    }
    if (!count) continue;
    ranked.push({ shot: shots[shotIndex], score: error / count, covered: count >= times.length * 0.6 });
  }
  if (!ranked.length) return shots[0];
  const covered = ranked.filter((item) => item.covered);
  const pool = covered.length ? covered : ranked;
  const bestRmse = Math.sqrt(Math.min(...pool.map((item) => item.score)));
  const close = pool.filter((item) => Math.sqrt(item.score) <= bestRmse + 0.85);
  const gathers = close.map((item) => gatherShape(item.shot)).filter((shape): shape is GatherShape => shape != null);
  if (gathers.length < 2) return close.reduce((best, item) => (item.score < best.score ? item : best)).shot;
  const dur = spread(gathers.map((shape) => shape.dur));
  const lat = spread(gathers.map((shape) => shape.maxLat));
  const len = spread(gathers.map((shape) => shape.pathLen));
  const step = spread(gathers.map((shape) => shape.maxStep));
  let best = close[0];
  let bestCost = Infinity;
  for (const item of close) {
    const shape = gatherShape(item.shot);
    const cost = shape
      ? excess(shape.dur, dur) + excess(shape.maxLat, lat) * 1.4 + excess(shape.pathLen, len) + excess(shape.maxStep, step) * 1.2
      : 4;
    if (cost < bestCost - 1e-6 || (Math.abs(cost - bestCost) <= 1e-6 && item.score < best.score)) {
      bestCost = cost;
      best = item;
    }
  }
  return best.shot;
}

export type Summary = {
  attempts: number;
  makes: number;
  pct: number | null;
  release: number | null;
  angle: number | null;
  apex: number | null;
  touch: number | null;
  defender: number | null;
  distance: number | null;
};

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type Spread = {
  label: string;
  unit: string;
  digits: number;
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  domain: [number, number];
};

const SPREAD_SPECS: { label: string; unit: string; digits: number; domain: [number, number]; read: (shot: Shot) => number }[] = [
  { label: "Release", unit: "ft", digits: 1, domain: [5.5, 9.5], read: (shot) => shot.relH },
  { label: "Launch", unit: "°", digits: 0, domain: [35, 65], read: (shot) => shot.angle },
  { label: "Apex", unit: "ft", digits: 1, domain: [12, 18], read: (shot) => shot.apex },
  { label: "Touch", unit: "s", digits: 2, domain: [0, 2.5], read: (shot) => shot.touch },
  { label: "Defender", unit: "ft", digits: 1, domain: [1, 8], read: (shot) => shot.defDist },
];

/** Where these shots cluster, and how wide that cluster is. */
export function shotSpread(shots: Shot[]): Spread[] {
  if (shots.length < 5) return [];
  return SPREAD_SPECS.map((spec) => {
    const values = shots.map(spec.read).filter((value) => Number.isFinite(value));
    const p10 = quantile(values, 0.1);
    const p90 = quantile(values, 0.9);
    return {
      label: spec.label,
      unit: spec.unit,
      digits: spec.digits,
      median: quantile(values, 0.5),
      p10,
      p25: quantile(values, 0.25),
      p75: quantile(values, 0.75),
      p90,
      domain: [Math.min(spec.domain[0], p10), Math.max(spec.domain[1], p90)],
    };
  });
}

export function summarize(shots: Shot[]): Summary {
  const makes = shots.reduce((sum, shot) => sum + shot.m, 0);
  return {
    attempts: shots.length,
    makes,
    pct: shots.length ? makes / shots.length : null,
    release: mean(shots.map((shot) => shot.relH)),
    angle: mean(shots.map((shot) => shot.angle)),
    apex: mean(shots.map((shot) => shot.apex)),
    touch: mean(shots.map((shot) => shot.touch)),
    defender: mean(shots.map((shot) => shot.defDist)),
    distance: mean(shots.map((shot) => shot.dist)),
  };
}

export type LeagueCell = {
  j: number;
  s: Shot["s"];
  k: Shot["k"];
  r: Shot["r"];
  m: number;
  n: number;
  sum: number;
};

export function leagueAngle(cells: LeagueCell[], filters: Filters): number | null {
  let count = 0;
  let total = 0;
  for (const cell of cells) {
    if (cell.j !== 1 || cell.r === "rim") continue;
    if (!filters.style.includes(cell.s)) continue;
    if (!filters.contest.includes(cell.k)) continue;
    if (filters.range !== "all" && cell.r !== filters.range) continue;
    if (!filters.result.includes(cell.m === 1 ? "make" : "miss")) continue;
    count += cell.n;
    total += cell.sum;
  }
  return count ? total / count : null;
}

export function releaseCourt(shot: Shot): [number, number] | null {
  if (!shot.path.length) return null;
  let best = shot.path[0];
  let bestGap = Math.abs(best[0]);
  for (const point of shot.path) {
    const gap = Math.abs(point[0]);
    if (gap < bestGap) {
      best = point;
      bestGap = gap;
    }
  }
  return [best[4], best[5]];
}

/** Where the shot was taken: the feet at release, or the ball if the feet left the half court. */
export function shotSpot(shot: Shot): [number, number] | null {
  if (shot.foot.length) {
    let best = shot.foot[0];
    let bestGap = Math.abs(best[0]);
    for (const point of shot.foot) {
      const gap = Math.abs(point[0]);
      if (gap < bestGap) {
        best = point;
        bestGap = gap;
      }
    }
    if (onHalfCourt(best[1], best[2])) return [best[1], best[2]];
  }
  const ball = releaseCourt(shot);
  if (ball && onHalfCourt(ball[0], ball[1])) return ball;
  return null;
}

/** Range against the painted line. Rim labels stay rim. Stored mid/three labels do not. */
export function displayRange(shot: Shot): ShotRange {
  if (shot.r === "rim") return "rim";
  const spot = shotSpot(shot);
  if (!spot) return shot.r;
  return isBehindThree(spot[0], spot[1]) ? "three" : "mid";
}

export function compareGroups(
  shots: Shot[],
  filters: Filters,
  axis: "type" | "contest",
): { label: string; color: string; dash: number[]; shots: Shot[] }[] {
  const groups: { label: string; color: string; dash: number[]; style?: ShotStyle; contest?: ShotContest }[] = [
    { label: "Catch and shoot", color: "#0c2340", dash: [], style: "catch_and_shoot" },
    { label: "Pull-up", color: "#2f6fad", dash: [], style: "pull_up" },
    { label: "Other", color: "#6b7c93", dash: [], style: "other" },
    { label: "Open", color: "#1b7a46", dash: [7, 5], contest: "open" },
    { label: "Contested", color: "#b42318", dash: [7, 5], contest: "contested" },
  ];
  return groups.flatMap((group) => {
    if (axis === "type" && !group.style) return [];
    if (axis === "contest" && !group.contest) return [];
    if (group.style && !filters.style.includes(group.style)) return [];
    if (group.contest && !filters.contest.includes(group.contest)) return [];
    const matched = filterShots(shots, {
      ...filters,
      style: group.style ? [group.style] : filters.style,
      contest: group.contest ? [group.contest] : filters.contest,
    });
    if (matched.length < 5) return [];
    return [{ label: group.label, color: group.color, dash: group.dash, shots: matched }];
  });
}

export type BreakdownRow = {
  label: string;
  depth: 0 | 1;
  kind: "group" | "split" | "delta";
  attempts: number;
  pct: number | null;
  release: number | null;
  angle: number | null;
  apex: number | null;
  touch: number | null;
  defender: number | null;
};

const BREAKDOWN_STYLES: ShotStyle[] = ["catch_and_shoot", "pull_up", "other"];

function difference(open: Shot[], contested: Shot[]): Omit<BreakdownRow, "label" | "depth" | "kind"> {
  const left = summarize(open);
  const right = summarize(contested);
  const sub = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);
  return {
    attempts: left.attempts - right.attempts,
    pct: sub(left.pct, right.pct),
    release: sub(left.release, right.release),
    angle: sub(left.angle, right.angle),
    apex: sub(left.apex, right.apex),
    touch: sub(left.touch, right.touch),
    defender: sub(left.defender, right.defender),
  };
}

function fromSummary(summary: Summary): Omit<BreakdownRow, "label" | "depth" | "kind"> {
  return {
    attempts: summary.attempts,
    pct: summary.pct,
    release: summary.release,
    angle: summary.angle,
    apex: summary.apex,
    touch: summary.touch,
    defender: summary.defender,
  };
}

export function contestBreakdown(shots: Shot[], filters: Filters): BreakdownRow[] {
  const base = filterShots(shots, { ...filters, style: STYLE_OPTIONS, contest: CONTEST_OPTIONS });
  const buckets = (["open", "contested"] as const).map((contest) => {
    const group = base.filter((shot) => shot.k === contest);
    return {
      contest,
      group,
      byStyle: Object.fromEntries(
        BREAKDOWN_STYLES.map((style) => [style, group.filter((shot) => shot.s === style)]),
      ) as Record<ShotStyle, Shot[]>,
    };
  });
  const rows: BreakdownRow[] = [];
  for (const bucket of buckets) {
    rows.push({
      label: bucket.contest === "open" ? "Open" : "Contested",
      depth: 0,
      kind: "group",
      ...fromSummary(summarize(bucket.group)),
    });
    for (const style of BREAKDOWN_STYLES) {
      rows.push({
        label: STYLE_LABEL[style],
        depth: 1,
        kind: "split",
        ...fromSummary(summarize(bucket.byStyle[style])),
      });
    }
  }
  const [open, contested] = buckets;
  rows.push({ label: "Open − contested", depth: 0, kind: "delta", ...difference(open.group, contested.group) });
  for (const style of BREAKDOWN_STYLES) {
    rows.push({
      label: STYLE_LABEL[style],
      depth: 1,
      kind: "delta",
      ...difference(open.byStyle[style], contested.byStyle[style]),
    });
  }
  return rows;
}
