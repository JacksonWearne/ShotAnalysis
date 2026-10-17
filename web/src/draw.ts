import { clipFlight, type CurvePoint, type GatherSample } from "./stats";
import { CORNER_X, CORNER_Y, COURT_H, COURT_W, HOOP_X, HOOP_Y, THREE_RADIUS } from "./court";
import type { Shot } from "./types";

const INK = "#0c2340";
const INK_SOFT = "rgba(12, 35, 64, 0.55)";
const GRID = "rgba(12, 35, 64, 0.12)";
const GRID_MID = "rgba(12, 35, 64, 0.28)";
const COURT_FILL = "#e7eef6";
const COURT_LINE = "rgba(12, 35, 64, 0.72)";
const LANE_FILL = "rgba(12, 35, 64, 0.06)";
const MAKE = "#1b7a46";
const MISS = "#b42318";
const LEAGUE = "#2f6fad";
const FONT = "Inter, 'Segoe UI', sans-serif";

export type ScreenRect = { x0: number; y0: number; scale: number };

export function courtLayout(width: number, height: number): ScreenRect {
  const pad = 18;
  const scale = Math.min((width - pad * 2) / COURT_W, (height - pad * 2) / COURT_H);
  const drawnW = COURT_W * scale;
  const drawnH = COURT_H * scale;
  return { x0: (width - drawnW) / 2, y0: (height - drawnH) / 2, scale };
}

export function courtToScreen(x: number, y: number, layout: ScreenRect): [number, number] {
  return [layout.x0 + x * layout.scale, layout.y0 + y * layout.scale];
}

export function screenToCourt(px: number, py: number, layout: ScreenRect): [number, number] {
  return [(px - layout.x0) / layout.scale, (py - layout.y0) / layout.scale];
}

function trace(ctx: CanvasRenderingContext2D, points: [number, number][]) {
  if (!points.length) return;
  ctx.beginPath();
  points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
}

export type GraphZoom = { on: boolean; panX: number; panY: number };

export const ZOOM_SCALE = 2.4;

export function applyGraphZoom(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  zoom: GraphZoom,
) {
  if (!zoom.on) return;
  ctx.translate(width / 2 + zoom.panX, height / 2 + zoom.panY);
  ctx.scale(ZOOM_SCALE, ZOOM_SCALE);
  ctx.translate(-width / 2, -height / 2);
}

export function invertGraphZoom(
  px: number,
  py: number,
  width: number,
  height: number,
  zoom: GraphZoom,
): [number, number] {
  if (!zoom.on) return [px, py];
  return [
    (px - zoom.panX - width / 2) / ZOOM_SCALE + width / 2,
    (py - zoom.panY - height / 2) / ZOOM_SCALE + height / 2,
  ];
}

export function drawCourt(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shots: { shot: Shot; x: number; y: number; selected: boolean }[],
  selected: Shot | null,
  zoom: GraphZoom,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  applyGraphZoom(ctx, width, height, zoom);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const layout = courtLayout(width, height);
  const pt = (x: number, y: number) => courtToScreen(x, y, layout);

  ctx.fillStyle = COURT_FILL;
  ctx.beginPath();
  ctx.roundRect(layout.x0, layout.y0, COURT_W * layout.scale, COURT_H * layout.scale, 6);
  ctx.fill();

  strokeHalfCourt(ctx, pt, layout.scale);

  if (selected) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    clipFlight(selected).forEach((point, index) => {
      const [sx, sy] = pt(point[4], point[5]);
      if (index === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    if (selected.foot.length > 1) {
      ctx.strokeStyle = INK_SOFT;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      selected.foot.forEach((point, index) => {
        const [sx, sy] = pt(point[1], point[2]);
        if (index === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (selected.def) {
      const [dx, dy] = pt(selected.def[0], selected.def[1]);
      ctx.fillStyle = LEAGUE;
      ctx.fillRect(dx - 3.5, dy - 3.5, 7, 7);
    }
  }

  for (const mark of shots) {
    const [sx, sy] = pt(mark.x, mark.y);
    ctx.beginPath();
    ctx.fillStyle = mark.shot.m ? MAKE : MISS;
    ctx.arc(sx, sy, mark.selected ? 5.5 : 3.2, 0, Math.PI * 2);
    ctx.fill();
    if (mark.selected) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  ctx.restore();
  return layout;
}

function arcPoints(
  pt: (x: number, y: number) => [number, number],
  cx: number,
  cy: number,
  radius: number,
  a0: number,
  a1: number,
  steps = 48,
): [number, number][] {
  const points: [number, number][] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = a0 + ((a1 - a0) * step) / steps;
    points.push(pt(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)));
  }
  return points;
}

function strokeHalfCourt(
  ctx: CanvasRenderingContext2D,
  pt: (x: number, y: number) => [number, number],
  scale: number,
) {
  ctx.strokeStyle = COURT_LINE;
  ctx.lineWidth = 1.25;
  ctx.fillStyle = LANE_FILL;

  const boundary = [pt(0, 0), pt(COURT_W, 0), pt(COURT_W, COURT_H), pt(0, COURT_H)];
  trace(ctx, [...boundary, boundary[0]]);
  ctx.stroke();

  const lane = [pt(17, 0), pt(33, 0), pt(33, 19), pt(17, 19)];
  trace(ctx, lane);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  trace(ctx, arcPoints(pt, HOOP_X, 19, 6, 0, Math.PI));
  ctx.stroke();

  ctx.setLineDash([4, 4]);
  trace(ctx, arcPoints(pt, HOOP_X, 19, 6, Math.PI, Math.PI * 2));
  ctx.stroke();
  ctx.setLineDash([]);

  trace(ctx, arcPoints(pt, HOOP_X, HOOP_Y, 4, 0, Math.PI));
  ctx.stroke();

  trace(ctx, [pt(CORNER_X, 0), pt(CORNER_X, CORNER_Y)]);
  ctx.stroke();
  trace(ctx, [pt(COURT_W - CORNER_X, 0), pt(COURT_W - CORNER_X, CORNER_Y)]);
  ctx.stroke();
  const aRight = Math.atan2(CORNER_Y - HOOP_Y, COURT_W - CORNER_X - HOOP_X);
  const aLeft = Math.atan2(CORNER_Y - HOOP_Y, CORNER_X - HOOP_X);
  trace(ctx, arcPoints(pt, HOOP_X, HOOP_Y, THREE_RADIUS, aRight, aLeft, 64));
  ctx.stroke();

  trace(ctx, [pt(0, COURT_H), pt(COURT_W, COURT_H)]);
  ctx.stroke();
  trace(ctx, arcPoints(pt, HOOP_X, COURT_H, 6, Math.PI, Math.PI * 2));
  ctx.stroke();

  drawRim(ctx, pt, scale, false);
}

function drawRim(
  ctx: CanvasRenderingContext2D,
  pt: (x: number, y: number) => [number, number],
  scale: number,
  emphasis: boolean,
) {
  const [bx1, by1] = pt(22, 4);
  const [bx2, by2] = pt(28, 4);
  ctx.strokeStyle = emphasis ? INK : COURT_LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx1, by1);
  ctx.lineTo(bx2, by2);
  ctx.stroke();
  const [hx, hy] = pt(HOOP_X, HOOP_Y);
  ctx.lineWidth = emphasis ? 1.6 : 1.25;
  ctx.beginPath();
  ctx.arc(hx, hy, emphasis ? Math.max(4, 0.75 * scale) : 0.75 * scale, 0, Math.PI * 2);
  ctx.stroke();
  if (!emphasis) return;
  ctx.fillStyle = INK;
  ctx.font = `11px ${FONT}`;
  ctx.fillText("Rim", hx + 8, hy - 8);
}

export type FloorPoint = { t: number; x: number; y: number };
export type PlotRegion = { x: number; y: number; w: number; h: number };

export function preLayout(width: number, height: number): { floor: PlotRegion; form: PlotRegion; stacked: boolean } {
  if (width >= 360) {
    const formW = Math.round(Math.max(148, width * 0.4));
    return {
      floor: { x: 0, y: 0, w: width - formW - 10, h: height },
      form: { x: width - formW, y: 0, w: formW, h: height },
      stacked: false,
    };
  }
  const floorH = Math.round(height * 0.5);
  return {
    floor: { x: 0, y: 0, w: width, h: floorH - 4 },
    form: { x: 0, y: floorH + 4, w: width, h: height - floorH - 4 },
    stacked: true,
  };
}

function focusCourt(
  viewW: number,
  viewH: number,
  points: { x: number; y: number }[],
): { pt: (x: number, y: number) => [number, number]; scale: number } {
  let x0 = HOOP_X;
  let x1 = HOOP_X;
  let y0 = HOOP_Y;
  let y1 = HOOP_Y;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    x0 = Math.min(x0, point.x);
    x1 = Math.max(x1, point.x);
    y0 = Math.min(y0, point.y);
    y1 = Math.max(y1, point.y);
  }
  const padFt = 3.2;
  x0 -= padFt;
  x1 += padFt;
  y0 -= padFt;
  y1 += padFt;
  const margin = { left: 8, right: 8, top: 22, bottom: 12 };
  const plotW = Math.max(20, viewW - margin.left - margin.right);
  const plotH = Math.max(20, viewH - margin.top - margin.bottom);
  let spanX = Math.max(12, x1 - x0);
  let spanY = Math.max(12, y1 - y0);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const aspect = plotW / plotH;
  if (spanX / spanY < aspect) spanX = spanY * aspect;
  else spanY = spanX / aspect;
  x0 = cx - spanX / 2;
  y0 = cy - spanY / 2;
  const scale = plotW / spanX;
  const originX = margin.left - x0 * scale;
  const originY = margin.top - y0 * scale;
  const pt = (x: number, y: number): [number, number] => [originX + x * scale, originY + y * scale];
  return { pt, scale };
}

export function drawFloor(
  ctx: CanvasRenderingContext2D,
  tracks: { color: string; dash: number[]; ball: FloorPoint[]; foot: FloorPoint[] }[],
  ball: { x: number; y: number } | null,
  feet: { x: number; y: number } | null,
  distance: number | null,
  zoom: GraphZoom,
  region: PlotRegion,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(region.x, region.y, region.w, region.h);
  ctx.clip();
  ctx.clearRect(region.x, region.y, region.w, region.h);
  ctx.translate(region.x, region.y);
  applyGraphZoom(ctx, region.w, region.h, zoom);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const spots = tracks.flatMap((track) => [...track.ball, ...track.foot]);
  const { pt, scale } = focusCourt(region.w, region.h, spots);
  const [fx0, fy0] = pt(0, 0);
  const [fx1, fy1] = pt(COURT_W, COURT_H);
  ctx.fillStyle = COURT_FILL;
  ctx.beginPath();
  ctx.rect(fx0, fy0, fx1 - fx0, fy1 - fy0);
  ctx.fill();
  strokeHalfCourt(ctx, pt, scale);

  for (const track of tracks) {
    const flight = track.ball.filter((point) => point.t > 0);
    const gather = track.ball.filter((point) => point.t <= 0);
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = track.color;
    ctx.lineWidth = 1.4;
    ctx.setLineDash(track.dash);
    ctx.beginPath();
    track.ball.forEach((point, index) => {
      const [x, y] = pt(point.x, point.y);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = track.color;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([]);
    ctx.beginPath();
    gather.forEach((point, index) => {
      const [x, y] = pt(point.x, point.y);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (flight.length) {
      const [sx, sy] = pt(gather.at(-1)?.x ?? flight[0].x, gather.at(-1)?.y ?? flight[0].y);
      const [ex, ey] = pt(flight[0].x, flight[0].y);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    if (track.foot.length > 1) {
      ctx.strokeStyle = INK_SOFT;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      track.foot.forEach((point, index) => {
        const [x, y] = pt(point.x, point.y);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawRim(ctx, pt, scale, true);

  if (feet) {
    const [x, y] = pt(feet.x, feet.y);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = `11px ${FONT}`;
    ctx.fillText("Feet", x + 8, y + 4);
  }
  if (ball) {
    const [x, y] = pt(ball.x, ball.y);
    ctx.fillStyle = "#f4f1ea";
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = INK_SOFT;
  ctx.font = `11px ${FONT}`;
  ctx.fillText(distance == null ? "Floor" : `${distance.toFixed(0)} ft from the rim`, 8, 14);
  ctx.restore();
}

type ArcPoint = { f: number; z: number };

function strokeLine(
  ctx: CanvasRenderingContext2D,
  points: ArcPoint[],
  sx: (f: number) => number,
  sy: (z: number) => number,
) {
  if (!points.length) return;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = sx(point.f);
    const y = sy(point.z);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function speedColor(feetPerSecond: number): string {
  const mix = Math.min(1, Math.max(0, (feetPerSecond - 6) / 16));
  const r = Math.round(142 + (12 - 142) * mix);
  const g = Math.round(171 + (35 - 171) * mix);
  const b = Math.round(201 + (64 - 201) * mix);
  return `rgb(${r}, ${g}, ${b})`;
}

function strokeTempo(
  ctx: CanvasRenderingContext2D,
  points: CurvePoint[],
  sx: (f: number) => number,
  sy: (z: number) => number,
  width: number,
) {
  ctx.lineWidth = width;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const dt = point.t - previous.t;
    if (dt <= 0) continue;
    const speed = Math.hypot(point.f - previous.f, point.z - previous.z) / dt;
    ctx.strokeStyle = speedColor(speed);
    ctx.beginPath();
    ctx.moveTo(sx(previous.f), sy(previous.z));
    ctx.lineTo(sx(point.f), sy(point.z));
    ctx.stroke();
  }
}

function drawTicks(
  ctx: CanvasRenderingContext2D,
  ticks: ArcPoint[],
  sx: (f: number) => number,
  sy: (z: number) => number,
) {
  for (const tick of ticks) {
    const x = sx(tick.f);
    const y = sy(tick.z);
    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.arc(x, y, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = INK;
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

const ARC_PAD = { left: 46, right: 32, top: 28, bottom: 32 };

function flightFrame(points: { f: number; z: number }[], rimDist: number | null) {
  let fMin = -1.5;
  let fMax = 12;
  let zMax = 16;
  for (const point of points) {
    fMin = Math.min(fMin, point.f);
    fMax = Math.max(fMax, point.f);
    zMax = Math.max(zMax, point.z);
  }
  if (rimDist != null) fMax = Math.max(fMax, rimDist + 1.5);
  fMin -= 0.4;
  fMax += 0.8;
  return { fMin, fMax, zMin: 0, zMax: Math.max(16, zMax + 0.8) };
}

/** Horizontal pixels-per-foot divided by vertical pixels-per-foot on the full shot. */
export function flightXScale(width: number, height: number, points: { f: number; z: number }[], rimDist: number | null): number {
  const frame = flightFrame(points, rimDist);
  const plotW = Math.max(1, width - ARC_PAD.left - ARC_PAD.right);
  const plotH = Math.max(1, height - ARC_PAD.top - ARC_PAD.bottom);
  const pxF = plotW / Math.max(1, frame.fMax - frame.fMin);
  const pxZ = plotH / Math.max(1, frame.zMax - frame.zMin);
  return Math.min(6, Math.max(0.5, pxF / pxZ));
}

/** Sleeve around the median gather. Edges are the 25th and 75th percentile box, so the median sits between them. */
function gatherOutline(points: GatherSample[]): { f: number; z: number }[] {
  if (points.length < 2) return [];
  const normals: { f: number; z: number }[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    let df = next.f - prev.f;
    let dz = next.z - prev.z;
    const length = Math.hypot(df, dz);
    if (length < 1e-6) {
      normals.push(normals[index - 1] ?? { f: 0, z: 1 });
      continue;
    }
    df /= length;
    dz /= length;
    let normal = { f: -dz, z: df };
    const previous = normals[index - 1];
    if (previous && normal.f * previous.f + normal.z * previous.z < 0) normal = { f: -normal.f, z: -normal.z };
    normals.push(normal);
  }
  const upper: { f: number; z: number }[] = [];
  const lower: { f: number; z: number }[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const normal = normals[index];
    let low = 0;
    let high = 0;
    for (const corner of [
      [point.fLo, point.zLo],
      [point.fLo, point.zHi],
      [point.fHi, point.zLo],
      [point.fHi, point.zHi],
    ]) {
      const offset = (corner[0] - point.f) * normal.f + (corner[1] - point.z) * normal.z;
      low = Math.min(low, offset);
      high = Math.max(high, offset);
    }
    upper.push({ f: point.f + normal.f * high, z: point.z + normal.z * high });
    lower.push({ f: point.f + normal.f * low, z: point.z + normal.z * low });
  }
  return [...upper, ...lower.reverse()];
}

export function drawArc(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  ghosts: { points: ArcPoint[]; color: string; alpha: number; width: number }[],
  series: { points: CurvePoint[]; color: string; width: number; dash: number[]; band: boolean; tempo?: boolean; ticks?: ArcPoint[] }[],
  ball: ArcPoint | null,
  rimDist: number | null,
  zoom: GraphZoom,
  options?: {
    fit?: boolean;
    tight?: boolean;
    ticks?: ArcPoint[];
    region?: PlotRegion;
    compact?: boolean;
    xScale?: number;
    gather?: { points: GatherSample[]; color: string }[];
  },
) {
  const region = options?.region;
  const viewW = region?.w ?? width;
  const viewH = region?.h ?? height;
  if (region) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(region.x, region.y, region.w, region.h);
    ctx.clip();
    ctx.clearRect(region.x, region.y, region.w, region.h);
    ctx.translate(region.x, region.y);
  } else {
    ctx.clearRect(0, 0, width, height);
  }
  ctx.save();
  applyGraphZoom(ctx, viewW, viewH, zoom);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const pad = options?.compact
    ? { left: 32, right: 8, top: 22, bottom: 20 }
    : ARC_PAD;
  const fit = options?.fit ?? false;
  let fMin = fit ? Infinity : -1.5;
  let fMax = fit ? -Infinity : 12;
  let zMin = fit ? Infinity : 0;
  let zMax = fit ? -Infinity : 16;
  const consider = (f: number, z: number) => {
    fMin = Math.min(fMin, f);
    fMax = Math.max(fMax, f);
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  };
  ghosts.forEach((ghost) => ghost.points.forEach((point) => consider(point.f, point.z)));
  series.forEach((line) => line.points.forEach((point) => consider(point.f, Math.max(point.z, point.zHi))));
  if (!Number.isFinite(fMin) || !Number.isFinite(zMin)) {
    fMin = -1;
    fMax = fit ? 4 : 12;
    zMin = 0;
    zMax = fit ? 12 : 16;
  }
  if (fit) {
    const tight = options?.tight ?? false;
    if (tight) {
      zMin = 0;
      zMax = 12;
    } else {
      if (fMax - fMin < 6) {
        const mid = (fMin + fMax) / 2;
        fMin = mid - 3;
        fMax = mid + 3;
      }
      if (zMax - zMin < 8) zMin = Math.min(zMin, zMax - 8);
      zMin = Math.max(0, zMin);
      fMin -= 0.35;
      fMax += 0.35;
      zMax += 0.6;
    }
  } else {
    const frame = flightFrame(
      [
        ...ghosts.map((ghost) => ghost.points).flat(),
        ...series.map((line) => line.points.map((point) => ({ f: point.f, z: Math.max(point.z, point.zHi) }))).flat(),
      ],
      rimDist,
    );
    fMin = frame.fMin;
    fMax = frame.fMax;
    zMin = frame.zMin;
    zMax = frame.zMax;
  }

  const plotW = viewW - pad.left - pad.right;
  const plotH = viewH - pad.top - pad.bottom;
  if (fit && (options?.tight ?? false)) {
    const pxPerFtZ = plotH / Math.max(1, zMax - zMin);
    const xScale = Math.min(6, Math.max(0.5, options?.xScale ?? 1));
    const fTarget = plotW / (pxPerFtZ * xScale);
    // Release stays at the same fraction of the chart so players and filters line up.
    const releaseAt = 0.7;
    fMin = -releaseAt * fTarget;
    fMax = fMin + fTarget;
  }
  const zSpan = Math.max(1, zMax - zMin);
  const sx = (f: number) => pad.left + ((f - fMin) / (fMax - fMin)) * plotW;
  const sy = (z: number) => pad.top + ((zMax - z) / zSpan) * plotH;

  ctx.strokeStyle = GRID;
  ctx.fillStyle = INK_SOFT;
  ctx.lineWidth = 1;
  ctx.font = `11px ${FONT}`;
  const zStep = (options?.tight ?? false) ? 1 : zSpan <= 8 ? 1 : zSpan <= 14 ? 2 : 5;
  for (let z = Math.ceil(zMin / zStep) * zStep; z <= zMax + 0.01; z += zStep) {
    ctx.beginPath();
    ctx.moveTo(pad.left, sy(z));
    ctx.lineTo(viewW - pad.right, sy(z));
    ctx.stroke();
    ctx.fillText(`${z}`, 8, sy(z) + 4);
  }
  ctx.fillText("ft", 8, 12);
  if ((options?.tight ?? false) && zMin <= 0 && zMax >= 0) {
    ctx.strokeStyle = GRID_MID;
    ctx.beginPath();
    ctx.moveTo(pad.left, sy(0));
    ctx.lineTo(viewW - pad.right, sy(0));
    ctx.stroke();
  }

  ctx.strokeStyle = GRID_MID;
  ctx.beginPath();
  ctx.moveTo(sx(0), pad.top);
  ctx.lineTo(sx(0), viewH - pad.bottom);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.fillText("Release", sx(0) + 6, pad.top + 12);

  if (!fit && zMin <= 10 && zMax >= 10) {
    ctx.strokeStyle = "rgba(47, 111, 173, 0.45)";
    ctx.beginPath();
    ctx.moveTo(pad.left, sy(10));
    ctx.lineTo(viewW - pad.right, sy(10));
    ctx.stroke();
  }

  if (!fit && rimDist != null) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx(rimDist), sy(10), 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText("Rim", sx(rimDist) - 10, sy(10) - 12);
  }

  const clipPaths = (options?.tight ?? false) && fit;
  if (clipPaths) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, plotW, plotH);
    ctx.clip();
  }

  for (const shade of options?.gather ?? []) {
    const outline = gatherOutline(shade.points);
    if (outline.length < 3) continue;
    ctx.beginPath();
    outline.forEach((point, index) => {
      const x = sx(point.f);
      const y = sy(point.z);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = shade.color;
    ctx.fill();
    ctx.restore();
  }

  for (const ghost of ghosts) {
    ctx.save();
    ctx.globalAlpha = ghost.alpha;
    ctx.strokeStyle = ghost.color;
    ctx.lineWidth = ghost.width;
    strokeLine(ctx, ghost.points, sx, sy);
    ctx.restore();
  }

  for (const line of series) {
    if (line.band && line.points.length > 2) {
      const flight = line.points.filter((point) => point.t >= 0);
      if (flight.length > 2) {
        const hi = flight.map((point) => ({ f: point.f, z: point.zHi }));
        const lo = flight.map((point) => ({ f: point.f, z: point.zLo }));
        ctx.beginPath();
        hi.forEach((point, index) => {
          const x = sx(point.f);
          const y = sy(point.z);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        for (let index = lo.length - 1; index >= 0; index -= 1) {
          ctx.lineTo(sx(lo[index].f), sy(lo[index].z));
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(12, 35, 64, 0.08)";
        ctx.fill();
      }
    }
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.width;
    ctx.setLineDash(line.dash);
    if (line.tempo) {
      strokeTempo(ctx, line.points, sx, sy, line.width);
    } else {
      strokeLine(
        ctx,
        line.points.map((point) => ({ f: point.f, z: point.z })),
        sx,
        sy,
      );
    }
    ctx.setLineDash([]);
  }

  for (const line of series) {
    if (line.ticks?.length) drawTicks(ctx, line.ticks, sx, sy);
  }
  if (options?.ticks?.length) drawTicks(ctx, options.ticks, sx, sy);

  if (ball) {
    ctx.fillStyle = "#f4f1ea";
    ctx.beginPath();
    ctx.arc(sx(ball.f), sy(ball.z), 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (clipPaths) ctx.restore();

  ctx.fillStyle = INK_SOFT;
  ctx.fillText(options?.compact ? "To basket" : "Feet toward the basket", pad.left, viewH - 8);
  ctx.restore();
  if (region) ctx.restore();
}

const LAUNCH_SPAN = 70;

export function drawLaunch(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  player: number | null,
  league: number | null,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.font = `12px ${FONT}`;

  const compact = height < 280 || width < 360;
  const originX = compact ? 28 : 36;
  const originY = height - (compact ? 22 : 28);
  const textBlock = compact ? 80 : 96;
  const radius = Math.max(36, Math.min(width - originX - (compact ? 24 : 40), originY - textBlock));
  const at = (degrees: number, length: number): [number, number] => {
    const radians = (Math.min(LAUNCH_SPAN, Math.max(0, degrees)) * Math.PI) / 180;
    return [originX + Math.cos(radians) * length, originY - Math.sin(radians) * length];
  };

  ctx.strokeStyle = GRID_MID;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  const [flatX, flatY] = at(0, radius);
  ctx.lineTo(flatX, flatY);
  ctx.stroke();

  ctx.strokeStyle = GRID;
  ctx.beginPath();
  ctx.arc(originX, originY, radius, -((LAUNCH_SPAN * Math.PI) / 180), 0);
  ctx.stroke();

  ctx.fillStyle = INK_SOFT;
  ctx.textAlign = "center";
  ctx.font = `11px ${FONT}`;
  const step = radius < 105 ? 30 : radius < 145 ? 20 : 10;
  let lastLabel: [number, number] | null = null;
  for (let degrees = 0; degrees <= LAUNCH_SPAN; degrees += step) {
    const [innerX, innerY] = at(degrees, radius - 8);
    const [outerX, outerY] = at(degrees, radius);
    ctx.strokeStyle = GRID_MID;
    ctx.beginPath();
    ctx.moveTo(innerX, innerY);
    ctx.lineTo(outerX, outerY);
    ctx.stroke();
    const [labelX, labelY] = at(degrees, radius + (compact ? 12 : 16));
    if (lastLabel && Math.hypot(labelX - lastLabel[0], labelY - lastLabel[1]) < 16) continue;
    if (labelX < 8 || labelX > width - 8 || labelY < textBlock - 8 || labelY > height - 4) continue;
    ctx.fillText(`${degrees}`, labelX, labelY + 4);
    lastLabel = [labelX, labelY];
  }

  const strokeRay = (degrees: number, color: string, lineWidth: number, dash: number[], length: number) => {
    const [x, y] = at(degrees, length);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
  };

  if (league != null) strokeRay(league, LEAGUE, 2.4, [7, 5], radius * 0.96);
  if (player != null) strokeRay(player, INK, 2.8, [], radius * 0.78);

  ctx.textAlign = "left";
  const numberY = compact ? 20 : 32;
  const playerY = compact ? 36 : 50;
  const leagueY = compact ? 50 : 68;
  const gapY = compact ? 64 : 86;
  ctx.fillStyle = INK;
  ctx.font = `600 ${compact ? 18 : 28}px ${FONT}`;
  ctx.fillText(player == null ? "—" : `${player.toFixed(0)}°`, 12, numberY);
  ctx.font = `${compact ? 11 : 12}px ${FONT}`;
  ctx.fillStyle = INK_SOFT;
  ctx.fillText("Player", 12, playerY);
  ctx.fillStyle = LEAGUE;
  ctx.fillText(league == null ? "League —" : `League ${league.toFixed(0)}°`, 12, leagueY);
  if (player != null && league != null) {
    const gap = player - league;
    const sign = gap > 0.5 ? "+" : "";
    ctx.fillStyle = INK;
    ctx.fillText(`${sign}${gap.toFixed(0)}° vs league`, 12, gapY);
  }
  ctx.restore();
}

export function drawVariation(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rows: { label: string; unit: string; digits: number; median: number; p10: number; p25: number; p75: number; p90: number; domain: [number, number] }[],
) {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.font = `12px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  if (!rows.length) {
    ctx.fillStyle = INK_SOFT;
    ctx.fillText("Not enough shots.", 12, 22);
    ctx.restore();
    return;
  }

  const padX = 10;
  const rowH = height / rows.length;
  const gutter = 78;
  rows.forEach((row, index) => {
    const y = rowH * index;
    const barH = Math.max(6, Math.min(10, rowH * 0.16));
    const blockH = 16 + barH + 16;
    const barY = y + (rowH - blockH) / 2 + 16;
    const barX = padX + gutter;
    const barW = Math.max(24, width - barX - padX);
    const low = row.domain[0];
    const high = row.domain[1];
    const span = Math.max(high - low, 1e-6);
    const xOf = (value: number) => barX + ((Math.min(high, Math.max(low, value)) - low) / span) * barW;

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = INK;
    ctx.font = `600 13px ${FONT}`;
    ctx.fillText(row.label, padX, barY + barH / 2);

    ctx.fillStyle = "rgba(12, 35, 64, 0.08)";
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 4);
    ctx.fill();

    const outerL = xOf(row.p10);
    const outerR = xOf(row.p90);
    ctx.fillStyle = "rgba(12, 35, 64, 0.2)";
    ctx.beginPath();
    ctx.roundRect(outerL, barY, Math.max(2, outerR - outerL), barH, 4);
    ctx.fill();

    const innerL = xOf(row.p25);
    const innerR = xOf(row.p75);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(innerL, barY, Math.max(3, innerR - innerL), barH, 3);
    ctx.fill();

    const mark = xOf(row.median);
    ctx.fillStyle = "#fff";
    ctx.fillRect(mark - 1, barY - 1, 2, barH + 2);

    const num = (value: number) => value.toFixed(row.digits);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    ctx.font = `600 12px ${FONT}`;
    const typical = `${num(row.median)} ${row.unit}`;
    const typicalW = ctx.measureText(typical).width;
    const typicalX = Math.min(width - padX - typicalW / 2, Math.max(barX + typicalW / 2, mark));
    ctx.fillStyle = INK;
    ctx.fillText(typical, typicalX, barY - 5);

    ctx.font = `11px ${FONT}`;
    const below: { x: number; text: string; strong: boolean }[] = [
      { x: outerL, text: num(row.p10), strong: false },
      { x: innerL, text: num(row.p25), strong: true },
      { x: innerR, text: num(row.p75), strong: true },
      { x: outerR, text: num(row.p90), strong: false },
    ];
    const placed = below.map((item) => {
      const textW = ctx.measureText(item.text).width;
      return { ...item, textW, start: item.x - textW / 2 };
    });
    let cursor = barX;
    for (const item of placed) {
      item.start = Math.max(item.start, cursor);
      cursor = item.start + item.textW + 3;
    }
    const overflow = cursor - 3 - (barX + barW);
    if (overflow > 0) {
      for (const item of placed) item.start -= overflow;
    }
    if (placed[0].start < 4) {
      const shift = 4 - placed[0].start;
      for (const item of placed) item.start += shift;
    }
    const belowY = barY + barH + 13;
    for (const item of placed) {
      ctx.textAlign = "left";
      ctx.fillStyle = item.strong ? INK : INK_SOFT;
      ctx.font = item.strong ? `600 11px ${FONT}` : `11px ${FONT}`;
      ctx.fillText(item.text, item.start, belowY);
    }
  });
  ctx.restore();
}

export type OrbitView = { yaw: number; pitch: number };

const SIDE_PITCH = 0.16;

/** Fallback when a shot has no direction: camera outside a sideline. */
export const SIDE_ORBIT: OrbitView = { yaw: Math.PI / 2, pitch: SIDE_PITCH };

/** Side-on to this shot: the camera looks across the path toward the basket. */
export function sideOrbit(path: number[][]): OrbitView {
  const release = [...path].reverse().find((point) => point[0] <= 0) ?? path[0];
  if (!release) return { ...SIDE_ORBIT };
  const towardHoopX = HOOP_X - release[4];
  const towardHoopZ = HOOP_Y - release[5];
  if (Math.hypot(towardHoopX, towardHoopZ) < 1) return { ...SIDE_ORBIT };
  return { yaw: Math.atan2(-towardHoopZ, towardHoopX), pitch: SIDE_PITCH };
}

export type PrePoint = { t: number; f: number; l: number; z: number; cx: number; cy: number };

export type PreTrail = {
  points: PrePoint[];
  color: string;
  width: number;
  dash: number[];
  tempo?: boolean;
};

type Vec3 = { x: number; y: number; z: number };

function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x + b.x, a.y + b.y, a.z + b.z);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z);
}

function scale(a: Vec3, k: number): Vec3 {
  return vec(a.x * k, a.y * k, a.z * k);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(a.x, a.y, a.z) || 1;
  return scale(a, 1 / length);
}

/** Court width, then length from the offensive baseline, then height. */
function courtPoint(across: number, along: number, height: number): Vec3 {
  return vec(across, height, along);
}

const COURT_LENGTH = 94;
const RIM_HEIGHT = 10;
const RIM_RADIUS = 0.75;
const NEAR_RIM = 5.25;
const FAR_RIM = COURT_LENGTH - NEAR_RIM;

/** World bounds around the ball and the offensive basket, so the shot fills the view. */
function shotFrame(trails: PreTrail[], balls: { cx: number; cy: number; z: number }[]): { target: Vec3; span: number; corners: Vec3[] } | null {
  const samples: Vec3[] = [];
  for (const trail of trails) {
    for (const point of trail.points) samples.push(courtPoint(point.cx, point.cy, point.z));
  }
  for (const ball of balls) samples.push(courtPoint(ball.cx, ball.cy, ball.z));
  if (!samples.length) return null;

  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  const take = (point: Vec3) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return;
    x0 = Math.min(x0, point.x);
    x1 = Math.max(x1, point.x);
    y0 = Math.min(y0, point.y);
    y1 = Math.max(y1, point.y);
    z0 = Math.min(z0, point.z);
    z1 = Math.max(z1, point.z);
  };
  samples.forEach(take);
  if (!Number.isFinite(x0)) return null;
  take(courtPoint(22, NEAR_RIM - 1.25, 9));
  take(courtPoint(28, NEAR_RIM - 1.25, 13));
  take(courtPoint(25, NEAR_RIM, RIM_HEIGHT));

  const pad = 2;
  x0 -= pad;
  x1 += pad;
  y0 -= pad;
  y1 += pad;
  z0 -= pad;
  z1 += pad;

  const minWide = 14;
  const minLong = 20;
  const midX = (x0 + x1) / 2;
  const midZ = (z0 + z1) / 2;
  if (x1 - x0 < minWide) {
    x0 = midX - minWide / 2;
    x1 = midX + minWide / 2;
  }
  if (z1 - z0 < minLong) {
    z0 = midZ - minLong / 2;
    z1 = midZ + minLong / 2;
  }

  const corners: Vec3[] = [];
  for (const x of [x0, x1]) {
    for (const y of [y0, y1]) {
      for (const z of [z0, z1]) corners.push(vec(x, y, z));
    }
  }
  const size = Math.max(x1 - x0, y1 - y0, z1 - z0);
  return {
    target: vec((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
    span: Math.max(32, size * 1.15),
    corners,
  };
}

/** Orbiting view of the ball on the court. A dotted trail is the flight after release. */
export function drawPreRelease3D(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  trails: PreTrail[],
  balls: { cx: number; cy: number; z: number; color: string }[],
  orbit: OrbitView,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.font = `12px ${FONT}`;

  const hasPath = trails.some((trail) => trail.points.length > 0);
  const framed = shotFrame(trails, balls);
  const target = framed?.target ?? vec(COURT_W / 2, 8, COURT_LENGTH / 2);
  const span = framed?.span ?? 80;
  const pitch = Math.min(1.35, Math.max(0.02, orbit.pitch));
  const eye = add(
    target,
    vec(
      span * Math.cos(pitch) * Math.sin(orbit.yaw),
      span * Math.sin(pitch),
      span * Math.cos(pitch) * Math.cos(orbit.yaw),
    ),
  );
  const forward = normalize(sub(target, eye));
  const right = normalize(cross(forward, vec(0, 1, 0)));
  const up = cross(right, forward);

  const toCamera = (point: Vec3) => {
    const delta = sub(point, eye);
    return { x: dot(delta, right), y: dot(delta, up), z: Math.max(0.35, dot(delta, forward)) };
  };

  const fitted: Vec3[] = framed?.corners ?? [
    courtPoint(0, 0, 0),
    courtPoint(COURT_W, 0, 0),
    courtPoint(0, COURT_LENGTH, 0),
    courtPoint(COURT_W, COURT_LENGTH, 0),
    courtPoint(22, NEAR_RIM - 1.2, 13),
    courtPoint(28, FAR_RIM + 1.2, 13),
  ];
  let reach = 0.001;
  for (const point of fitted) {
    const camera = toCamera(point);
    reach = Math.max(reach, Math.abs(camera.x) / camera.z, Math.abs(camera.y) / camera.z);
  }
  const focal = (Math.min(width, height) * (framed ? 0.54 : 0.46)) / reach;
  const project = (point: Vec3) => {
    const camera = toCamera(point);
    const scale = focal / camera.z;
    return { x: width / 2 + camera.x * scale, y: height / 2 - camera.y * scale, depth: camera.z, scale };
  };

  type Stroke = { depth: number; draw: () => void };
  const strokes: Stroke[] = [];
  const pushLine = (a: Vec3, b: Vec3, color: string, lineWidth: number, dash: number[] = []) => {
    const pa = project(a);
    const pb = project(b);
    strokes.push({
      depth: (pa.depth + pb.depth) / 2,
      draw: () => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      },
    });
  };
  const pushLoop = (points: Vec3[], color: string, lineWidth: number, fill?: string) => {
    if (points.length < 2) return;
    const projected = points.map(project);
    const depth = projected.reduce((sum, point) => sum + point.depth, 0) / projected.length;
    strokes.push({
      depth,
      draw: () => {
        ctx.beginPath();
        projected.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
        ctx.closePath();
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([]);
        ctx.stroke();
      },
    });
  };

  const boundary = [
    courtPoint(0, 0, 0),
    courtPoint(COURT_W, 0, 0),
    courtPoint(COURT_W, COURT_LENGTH, 0),
    courtPoint(0, COURT_LENGTH, 0),
  ];
  pushLoop(boundary, COURT_LINE, 1.6, "rgba(231, 238, 246, 0.55)");
  pushLine(courtPoint(0, COURT_LENGTH / 2, 0), courtPoint(COURT_W, COURT_LENGTH / 2, 0), GRID_MID, 1.25);

  const rimRing = (across: number, along: number) => {
    const points: Vec3[] = [];
    for (let step = 0; step <= 24; step += 1) {
      const angle = (step / 24) * Math.PI * 2;
      points.push(courtPoint(across + Math.cos(angle) * RIM_RADIUS, along + Math.sin(angle) * RIM_RADIUS, RIM_HEIGHT));
    }
    return points;
  };
  const drawBasket = (rimAlong: number, boardAlong: number) => {
    const board = [
      courtPoint(22, boardAlong, 9),
      courtPoint(28, boardAlong, 9),
      courtPoint(28, boardAlong, 13),
      courtPoint(22, boardAlong, 13),
    ];
    pushLoop(board, COURT_LINE, 1.4, "rgba(12, 35, 64, 0.08)");
    pushLine(courtPoint(25, boardAlong, 0), courtPoint(25, boardAlong, 9), COURT_LINE, 1.6);
    pushLine(courtPoint(25, boardAlong, RIM_HEIGHT), courtPoint(25, rimAlong, RIM_HEIGHT), COURT_LINE, 1.4);
    const ring = rimRing(25, rimAlong);
    for (let index = 1; index < ring.length; index += 1) pushLine(ring[index - 1], ring[index], INK, 1.6);
  };
  drawBasket(NEAR_RIM, NEAR_RIM - 1.25);
  drawBasket(FAR_RIM, FAR_RIM + 1.25);

  const place = (point: PrePoint) => courtPoint(point.cx, point.cy, point.z);
  for (const trail of trails) {
    if (trail.dash.length && trail.points.length > 1) {
      const projected = trail.points.map((point) => project(place(point)));
      let traveled = 0;
      for (let index = 1; index < projected.length; index += 1) {
        const previous = projected[index - 1];
        const point = projected[index];
        const offset = traveled;
        traveled += Math.hypot(point.x - previous.x, point.y - previous.y);
        strokes.push({
          depth: (previous.depth + point.depth) / 2,
          draw: () => {
            ctx.strokeStyle = trail.color;
            ctx.lineWidth = trail.width;
            ctx.setLineDash(trail.dash);
            ctx.lineDashOffset = -offset;
            ctx.beginPath();
            ctx.moveTo(previous.x, previous.y);
            ctx.lineTo(point.x, point.y);
            ctx.stroke();
          },
        });
      }
      continue;
    }
    for (let index = 1; index < trail.points.length; index += 1) {
      const previous = trail.points[index - 1];
      const point = trail.points[index];
      const dt = point.t - previous.t;
      let color = trail.color;
      if (trail.tempo && dt > 0) {
        const speed = Math.hypot(point.f - previous.f, point.l - previous.l, point.z - previous.z) / dt;
        color = speedColor(speed);
      }
      pushLine(place(previous), place(point), color, trail.width);
    }
  }

  strokes.sort((a, b) => b.depth - a.depth);
  for (const stroke of strokes) stroke.draw();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  const markers = balls.map((ball) => ({ ball, screen: project(courtPoint(ball.cx, ball.cy, ball.z)) }));
  markers.sort((a, b) => b.screen.depth - a.screen.depth);
  for (const marker of markers) {
    const radius = Math.max(3.5, Math.min(8, 0.45 * marker.screen.scale));
    ctx.beginPath();
    ctx.fillStyle = "#fff";
    ctx.arc(marker.screen.x, marker.screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = marker.ball.color;
    ctx.stroke();
  }

  if (!hasPath) {
    ctx.fillStyle = INK_SOFT;
    ctx.textAlign = "left";
    ctx.fillText("No path for these filters.", 12, 22);
  }
  ctx.restore();
}

export function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const nextW = Math.floor(width * dpr);
  const nextH = Math.floor(height * dpr);
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW;
    canvas.height = nextH;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}
