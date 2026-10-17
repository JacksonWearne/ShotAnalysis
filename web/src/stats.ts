import { STYLE_LABEL, type Filters, type Shot, type ShotContest, type ShotStyle } from "./types";

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
  let maxForward = -Infinity;
  let maxStep = 0;
  for (let index = 0; index < path.length; index += 1) {
    maxForward = Math.max(maxForward, path[index][1]);
    if (index === 0) continue;
    const step = Math.hypot(path[index][1] - path[index - 1][1], path[index][3] - path[index - 1][3]);
    maxStep = Math.max(maxStep, step);
  }
  if (maxStep > 12) return false;
  if (shot.dist > 8 && maxForward < shot.dist * 0.35) return false;
  return true;
}

export function filterShots(shots: Shot[], filters: Filters): Shot[] {
  return shots.filter((shot) => {
    const spot = releaseCourt(shot);
    // A normalized release past half court means the basket side was wrong.
    if (!spot || spot[0] < -1 || spot[0] > 51 || spot[1] < -1 || spot[1] > 47.5) return false;
    if (!coherent(shot)) return false;
    if (shot.j !== 1 || shot.r === "rim") return false;
    if (filters.style !== "all" && shot.s !== filters.style) return false;
    if (filters.contest !== "all" && shot.k !== filters.contest) return false;
    if (filters.range !== "all" && shot.r !== filters.range) return false;
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

function medianByRelease(shots: Shot[]): Shot {
  const ranked = [...shots].sort((a, b) => a.relH - b.relH || a.apex - b.apex);
  return ranked[Math.floor((ranked.length - 1) / 2)];
}

// The drawn average is one real attempt: the shot whose path stays closest to the
// pointwise median, including the gather before release.
export function medianShot(shots: Shot[]): Shot | null {
  if (!shots.length) return null;
  if (shots.length < 5) return medianByRelease(shots);
  const starts = shots.map((shot) => shot.path[0]?.[0] ?? 0);
  const ends = shots.map((shot) => shot.path[shot.path.length - 1]?.[0] ?? 0);
  const t0 = quantile(starts, 0.5);
  const t1 = quantile(ends, 0.5);
  const times: number[] = [];
  for (let t = t0; t <= t1 + 1e-6; t += 0.04) times.push(Math.round(t * 1000) / 1000);
  const need = Math.max(4, Math.ceil(shots.length * 0.2));
  const target: ({ f: number; l: number; z: number } | null)[] = times.map((t) => {
    const forward: number[] = [];
    const lateral: number[] = [];
    const height: number[] = [];
    for (const shot of shots) {
      const f = at(shot.path, t, 1);
      const l = at(shot.path, t, 2);
      const z = at(shot.path, t, 3);
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
  for (const shot of shots) {
    const start = shot.path[0]?.[0] ?? 0;
    if (start > t0 + 0.08) continue;
    let error = 0;
    let count = 0;
    for (let index = 0; index < times.length; index += 1) {
      const goal = target[index];
      if (!goal) continue;
      const f = at(shot.path, times[index], 1);
      const l = at(shot.path, times[index], 2);
      const z = at(shot.path, times[index], 3);
      if (f == null || l == null || z == null) continue;
      const weight = times[index] < 0 ? 1.4 : 1;
      error += weight * ((f - goal.f) ** 2 + (z - goal.z) ** 2 + 0.35 * (l - goal.l) ** 2);
      count += 1;
    }
    if (count < times.length * 0.6) continue;
    const score = error / count + Math.abs(start - t0) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = shot;
    }
  }
  return best ?? medianByRelease(shots);
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

export function compareGroups(shots: Shot[], filters: Filters): { label: string; color: string; dash: number[]; shots: Shot[] }[] {
  const groups: { label: string; color: string; dash: number[]; style?: ShotStyle; contest?: ShotContest }[] = [
    { label: "Catch and shoot", color: "#0c2340", dash: [], style: "catch_and_shoot" },
    { label: "Pull-up", color: "#2f6fad", dash: [], style: "pull_up" },
    { label: "Open", color: "#1b7a46", dash: [7, 5], contest: "open" },
    { label: "Contested", color: "#b42318", dash: [7, 5], contest: "contested" },
  ];
  return groups
    .map((group) => ({
      label: group.label,
      color: group.color,
      dash: group.dash,
      shots: filterShots(shots, {
        ...filters,
        style: group.style ?? filters.style,
        contest: group.contest ?? filters.contest,
      }),
    }))
    .filter((group) => group.shots.length >= 5);
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
