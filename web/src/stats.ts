import { isBehindThree, onHalfCourt } from "./court";
import { STYLE_LABEL, type Filters, type Shot, type ShotContest, type ShotRange, type ShotStyle } from "./types";

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
    const step = Math.hypot(path[index][1] - path[index - 1][1], path[index][3] - path[index - 1][3]);
    maxStep = Math.max(maxStep, step);
  }
  if (maxStep > 12) return false;
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
    if (filters.style !== "all" && shot.s !== filters.style) return false;
    if (filters.contest !== "all" && shot.k !== filters.contest) return false;
    if (filters.range !== "all" && displayRange(shot) !== filters.range) return false;
    if (filters.result === "make" && shot.m !== 1) return false;
    if (filters.result === "miss" && shot.m !== 0) return false;
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

// One real attempt: the shot whose flight stays closest to the pointwise median.
// The gather is not part of the match. The returned shot is the stored attempt.
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
  let best: Shot | null = null;
  let bestScore = Infinity;
  let partial: Shot | null = null;
  let partialScore = Infinity;
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
    const score = error / count;
    if (score < partialScore) {
      partialScore = score;
      partial = shots[shotIndex];
    }
    if (count < times.length * 0.6) continue;
    if (score < bestScore) {
      bestScore = score;
      best = shots[shotIndex];
    }
  }
  return best ?? partial ?? shots[0];
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
    if (filters.style !== "all" && cell.s !== filters.style) continue;
    if (filters.contest !== "all" && cell.k !== filters.contest) continue;
    if (filters.range !== "all" && cell.r !== filters.range) continue;
    if (filters.result === "make" && cell.m !== 1) continue;
    if (filters.result === "miss" && cell.m !== 0) continue;
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

export function compareGroups(shots: Shot[], filters: Filters): { label: string; color: string; dash: number[]; shots: Shot[] }[] {
  const groups: { label: string; color: string; dash: number[]; style?: ShotStyle; contest?: ShotContest }[] = [
    { label: "Catch and shoot", color: "#0c2340", dash: [], style: "catch_and_shoot" },
    { label: "Pull-up", color: "#2f6fad", dash: [], style: "pull_up" },
    { label: "Other", color: "#6b7c93", dash: [], style: "other" },
    { label: "Open", color: "#1b7a46", dash: [7, 5], contest: "open" },
    { label: "Contested", color: "#b42318", dash: [7, 5], contest: "contested" },
  ];
  return groups.flatMap((group) => {
    if (group.style && filters.style !== "all" && filters.style !== group.style) return [];
    if (group.contest && filters.contest !== "all" && filters.contest !== group.contest) return [];
    const matched = filterShots(shots, {
      ...filters,
      style: group.style ?? filters.style,
      contest: group.contest ?? filters.contest,
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
  const base = filterShots(shots, { ...filters, style: "all", contest: "all" });
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
