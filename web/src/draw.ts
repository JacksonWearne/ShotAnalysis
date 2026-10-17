import type { CurvePoint } from "./stats";
import type { Shot } from "./types";

const COURT_W = 50;
const COURT_H = 47;
const HOOP_X = 25;
const HOOP_Y = 5.25;
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
    selected.path.forEach((point, index) => {
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

  const cornerY = 5.25 + Math.sqrt(23.75 ** 2 - 22 ** 2);
  trace(ctx, [pt(3, 0), pt(3, cornerY)]);
  ctx.stroke();
  trace(ctx, [pt(47, 0), pt(47, cornerY)]);
  ctx.stroke();
  const aRight = Math.atan2(cornerY - HOOP_Y, 47 - HOOP_X);
  const aLeft = Math.atan2(cornerY - HOOP_Y, 3 - HOOP_X);
  trace(ctx, arcPoints(pt, HOOP_X, HOOP_Y, 23.75, aRight, aLeft, 64));
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

export function drawArc(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  ghosts: { points: ArcPoint[]; color: string; alpha: number; width: number }[],
  series: { points: CurvePoint[]; color: string; width: number; dash: number[]; band: boolean; tempo?: boolean; ticks?: ArcPoint[] }[],
  ball: ArcPoint | null,
  rimDist: number | null,
  zoom: GraphZoom,
  options?: { fit?: boolean; tight?: boolean; ticks?: ArcPoint[]; region?: PlotRegion; compact?: boolean; xScale?: number },
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
