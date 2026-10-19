export type ShotStyle = "catch_and_shoot" | "pull_up" | "other";
export type ShotContest = "open" | "contested";
export type ShotRange = "rim" | "mid" | "three";

export type Shot = {
  g: string;
  d: string;
  p: number;
  c: string;
  m: number;
  a: string;
  j: number;
  r: ShotRange;
  s: ShotStyle;
  k: ShotContest;
  defDist: number;
  touch: number;
  dribbles: number;
  relH: number;
  angle: number;
  dist: number;
  apex: number;
  path: number[][];
  foot: number[][];
  def?: number[];
};

export type PlayerFile = {
  id: number;
  name: string;
  team: string;
  shots: Shot[];
};

export type IndexPlayer = {
  id: number;
  name: string;
  team: string;
  shots: number;
  jumpers: number;
};

export type Catalog = {
  season: string;
  games: number;
  shots: number;
  players: IndexPlayer[];
};

export const STYLE_OPTIONS: ShotStyle[] = ["catch_and_shoot", "pull_up", "other"];
export const CONTEST_OPTIONS: ShotContest[] = ["open", "contested"];
export const RESULT_OPTIONS: ("make" | "miss")[] = ["make", "miss"];

export type Filters = {
  style: ShotStyle[];
  contest: ShotContest[];
  range: "all" | "mid" | "three";
  result: ("make" | "miss")[];
};

export type View = "average" | "individual";

export const STYLE_LABEL: Record<ShotStyle, string> = {
  catch_and_shoot: "Catch and shoot",
  pull_up: "Pull-up",
  other: "Other",
};

export const CONTEST_LABEL: Record<ShotContest, string> = {
  open: "Open",
  contested: "Contested",
};

export const RANGE_LABEL: Record<ShotRange, string> = {
  rim: "Rim",
  mid: "Mid-range",
  three: "Three",
};
