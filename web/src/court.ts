/** Half-court geometry shared by the painted line and the range classifier. */

export const COURT_W = 50;
export const COURT_H = 47;
export const HOOP_X = 25;
export const HOOP_Y = 5.25;
/** Above-the-break three-point distance, feet from the center of the rim. */
export const THREE_RADIUS = 23.75;
/** Corner line is 22 feet from the rim center, 3 feet in from the sideline. */
export const CORNER_OFFSET = 22;
export const CORNER_X = HOOP_X - CORNER_OFFSET;

export const CORNER_Y = HOOP_Y + Math.sqrt(THREE_RADIUS ** 2 - CORNER_OFFSET ** 2);

export function onHalfCourt(x: number, y: number): boolean {
  return x >= -1 && x <= 51 && y >= -1 && y <= COURT_H + 0.5;
}

/**
 * Signed feet relative to the painted three-point line.
 * Positive is behind the line. Negative is in front of it.
 */
export function threeMargin(x: number, y: number): number {
  const arc = Math.hypot(x - HOOP_X, y - HOOP_Y) - THREE_RADIUS;
  if (y > CORNER_Y) return arc;
  const corner = x <= HOOP_X ? CORNER_X - x : x - (COURT_W - CORNER_X);
  if (corner >= 0) return corner;
  return Math.max(arc, corner);
}

export function isBehindThree(x: number, y: number): boolean {
  return threeMargin(x, y) >= 0;
}
