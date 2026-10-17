#!/usr/bin/env python3
"""Extract 2015-16 SportVU shot paths into per-player JSON for the visualizer.

Tracking: linouk23/NBA-Player-Movements 2016.NBA.Raw.SportVU.Game.Logs
Play-by-play: sumitrodatta/nba-alt-awards Historical/PBP Data/2015-16_pbp.csv
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import subprocess
import traceback
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
import py7zr

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SHOTS = DATA / "shots"
TMP = DATA / "tmp"
WEB_DATA = ROOT.parent / "web" / "public" / "data"
PLAYERS_DIR = WEB_DATA / "players"
GAMES_JSON = DATA / "games.json"
PBP_CSV = DATA / "pbp_2015_16.csv"
PBP_DB = DATA / "shots.sqlite"
PBP_URL = "https://github.com/sumitrodatta/nba-alt-awards/raw/main/Historical/PBP%20Data/2015-16_pbp.csv"
GAMES_API = "https://api.github.com/repos/linouk23/NBA-Player-Movements/contents/data/2016.NBA.Raw.SportVU.Game.Logs"

COURT_LEN = 94.0
COURT_WID = 50.0
LEFT_HOOP = (5.25, 25.0)
RIGHT_HOOP = (88.75, 25.0)
USER_AGENT = "shot-arc/1.0"

DIST_RE = re.compile(r"(\d+)'")
THREE_RE = re.compile(r"\b3PT\b", re.I)


def rnd(value: float, places: int) -> float:
    number = round(float(value), places)
    if number == 0:
        return 0.0
    return number


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.unlink(missing_ok=True)
    result = subprocess.run(
        ["curl", "-fsSL", "--retry", "4", "--retry-delay", "2", "-A", USER_AGENT, "-o", str(tmp), url],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not tmp.exists() or tmp.stat().st_size < 1000:
        tmp.unlink(missing_ok=True)
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(detail or f"curl failed for {url}")
    tmp.replace(dest)


def ensure_games() -> list[dict]:
    if GAMES_JSON.exists():
        return json.loads(GAMES_JSON.read_text())
    listing = DATA / "games_api.json"
    download(GAMES_API, listing)
    payload = json.loads(listing.read_text())
    games = [
        {"name": item["name"], "size": item["size"], "url": item["download_url"]}
        for item in payload
        if str(item["name"]).endswith(".7z")
    ]
    GAMES_JSON.parent.mkdir(parents=True, exist_ok=True)
    GAMES_JSON.write_text(json.dumps(games))
    return games


def ensure_pbp_db() -> None:
    if PBP_DB.exists():
        return
    if not PBP_CSV.exists():
        print("downloading play-by-play...", flush=True)
        download(PBP_URL, PBP_CSV)
    print("indexing play-by-play shots...", flush=True)
    usecols = [
        "GAME_ID",
        "EVENTNUM",
        "EVENTMSGTYPE",
        "PLAYER1_ID",
        "PLAYER1_NAME",
        "PLAYER1_TEAM_ID",
        "PLAYER1_TEAM_ABBREVIATION",
        "PCTIMESTRING",
        "PERIOD",
        "HOMEDESCRIPTION",
        "VISITORDESCRIPTION",
    ]
    frame = pd.read_csv(PBP_CSV, usecols=usecols)
    shots = frame[frame["EVENTMSGTYPE"].isin([1, 2])].copy()
    if PBP_DB.exists():
        PBP_DB.unlink()
    conn = sqlite3.connect(PBP_DB)
    shots.to_sql("shots", conn, index=False)
    conn.execute("CREATE INDEX idx_game ON shots (GAME_ID, EVENTNUM)")
    conn.commit()
    conn.close()
    print(f"indexed {len(shots)} shot rows", flush=True)


def load_game_shots(game_id: int) -> dict[int, dict]:
    conn = sqlite3.connect(PBP_DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM shots WHERE GAME_ID = ?", (game_id,)).fetchall()
    conn.close()
    events = {}
    for row in rows:
        player_raw = row["PLAYER1_ID"]
        if player_raw is None or player_raw != player_raw or int(player_raw) <= 0:
            continue
        events[int(row["EVENTNUM"])] = {
            "made": int(row["EVENTMSGTYPE"]) == 1,
            "player_id": int(player_raw),
            "name": row["PLAYER1_NAME"] or "Unknown",
            "team_id": int(row["PLAYER1_TEAM_ID"]) if row["PLAYER1_TEAM_ID"] == row["PLAYER1_TEAM_ID"] else 0,
            "team": row["PLAYER1_TEAM_ABBREVIATION"] or "",
            "clock": row["PCTIMESTRING"] or "",
            "period": int(row["PERIOD"]) if row["PERIOD"] == row["PERIOD"] else 0,
            "home": row["HOMEDESCRIPTION"] if isinstance(row["HOMEDESCRIPTION"], str) else "",
            "away": row["VISITORDESCRIPTION"] if isinstance(row["VISITORDESCRIPTION"], str) else "",
        }
    return events


def shot_text(info: dict) -> tuple[str, int | None, bool]:
    name = info["name"]
    last = name.split()[-1] if name else ""
    candidates = []
    for text in (info["home"], info["away"]):
        if text and DIST_RE.search(text):
            candidates.append(text)
    if not candidates:
        return "Shot", None, False
    chosen = candidates[0]
    for text in candidates:
        if last and last in text:
            chosen = text
            break
    is_three = bool(THREE_RE.search(chosen))
    dist_match = DIST_RE.search(chosen)
    text_dist = int(dist_match.group(1)) if dist_match else None
    cleaned = re.sub(r"\s*\([^)]*\)", "", chosen)
    cleaned = re.sub(r"^MISS\s+", "", cleaned.strip())
    cleaned = re.sub(r"^.*?\d+'\s*", "", cleaned).strip()
    return cleaned or "Shot", text_dist, is_three


def is_jumper(action: str) -> bool:
    lowered = action.lower()
    return not any(word in lowered for word in ("layup", "dunk", "tip"))


def moments_to_arrays(moments: list) -> dict | None:
    seen = set()
    times = []
    ball = []
    players = []
    for moment in moments:
        if not moment or len(moment) < 6 or not moment[5] or len(moment[5]) < 11:
            continue
        key = (int(moment[0]), round(float(moment[2]), 2))
        if key in seen:
            continue
        seen.add(key)
        ball_row = moment[5][0]
        times.append(float(moment[1]) / 1000.0)
        ball.append((float(ball_row[2]), float(ball_row[3]), float(ball_row[4])))
        frame_players = []
        for player in moment[5][1:11]:
            frame_players.append((int(player[0]), int(player[1]), float(player[2]), float(player[3])))
        players.append(frame_players)
    if len(times) < 12:
        return None
    order = np.argsort(np.asarray(times))
    times_a = np.asarray(times, dtype=np.float64)[order]
    # Shift so the first frame is t=0 and gaps stay in seconds.
    times_a = times_a - times_a[0]
    ball_a = np.asarray(ball, dtype=np.float64)[order]
    players_a = np.asarray(players, dtype=np.float64)[order]
    return {"t": times_a, "ball": ball_a, "players": players_a}


def rolling_mean(values: np.ndarray, width: int = 5) -> np.ndarray:
    if len(values) < width:
        return values.copy()
    kernel = np.ones(width) / width
    return np.convolve(values, kernel, mode="same")


def player_track(players: np.ndarray, player_id: int) -> tuple[np.ndarray, np.ndarray]:
    ids = players[:, :, 1]
    match = ids == float(player_id)
    found = match.any(axis=1)
    index = match.argmax(axis=1)
    rows = np.arange(len(players))
    xy = players[rows, index][:, 2:4].astype(np.float64)
    team = players[rows, index][:, 0].astype(np.float64)
    xy[~found] = np.nan
    team[~found] = np.nan
    return xy, team


def select_apex(
    z: np.ndarray,
    zs: np.ndarray,
    dist: np.ndarray,
    x: np.ndarray,
    y: np.ndarray,
    t: np.ndarray,
    in_event: np.ndarray,
    text_dist: int | None,
) -> int | None:
    """Pick the ball peak the shooter actually released, not an overlapping arc."""
    peaks = []
    for index in range(2, len(z) - 2):
        if z[index] < 8.0:
            continue
        if zs[index] + 0.08 < zs[index - 1] or zs[index] + 0.08 < zs[index + 1]:
            continue
        lo = int(np.searchsorted(t, t[index] - 0.55))
        pre = dist[lo:index]
        finite = pre[np.isfinite(pre)]
        if len(finite) == 0 or float(finite.min()) > 4.5:
            continue
        peaks.append(index)
    if not peaks:
        return None
    event_idx = np.flatnonzero(in_event)
    if len(event_idx):
        start_t = float(t[int(event_idx[0])])
        inside = [peak for peak in peaks if t[peak] >= start_t - 1.2]
        if inside:
            peaks = inside
    def finish(chosen: list[int]) -> int:
        last = chosen[-1]
        cluster = [peak for peak in chosen if t[last] - t[peak] <= 0.7]
        return max(cluster, key=lambda peak: float(z[peak]))

    if text_dist is None:
        return finish(peaks)

    def shot_distance(peak: int) -> float:
        lo = int(np.searchsorted(t, t[peak] - 0.5))
        segment = dist[lo:peak]
        finite = np.isfinite(segment)
        if not finite.any():
            frame = peak
        else:
            frame = lo + int(np.nanargmin(np.where(finite, segment, 1e9)))
        left = float(np.hypot(x[frame] - LEFT_HOOP[0], y[frame] - LEFT_HOOP[1]))
        right = float(np.hypot(x[frame] - RIGHT_HOOP[0], y[frame] - RIGHT_HOOP[1]))
        return min(left, right)

    ranked = sorted(peaks, key=lambda peak: (abs(shot_distance(peak) - text_dist), -peak))
    best = ranked[0]
    # A later rim attempt in the same event should not replace a jump shot from range.
    if abs(shot_distance(best) - text_dist) + 6 < abs(shot_distance(finish(peaks)) - text_dist):
        return best
    return finish(peaks)


def nearest_hoop(x: float, y: float, vx: float) -> tuple[float, float]:
    left = float(np.hypot(x - LEFT_HOOP[0], y - LEFT_HOOP[1]))
    right = float(np.hypot(x - RIGHT_HOOP[0], y - RIGHT_HOOP[1]))
    # A peak far from both rims is a heave: follow the ball instead of the rebound.
    if min(left, right) > 22.0:
        return RIGHT_HOOP if vx >= 0 else LEFT_HOOP
    return LEFT_HOOP if left <= right else RIGHT_HOOP


def build_timeline(game: dict) -> dict[int, dict]:
    periods: dict[int, dict] = {}
    for event in game.get("events") or []:
        for moment in event.get("moments") or []:
            if not moment or len(moment) < 6 or not moment[5] or len(moment[5]) < 11:
                continue
            period = int(moment[0])
            clock = round(float(moment[2]), 2)
            bucket = periods.get(period)
            if bucket is None:
                bucket = {}
                periods[period] = bucket
            if clock in bucket:
                continue
            ball = moment[5][0]
            players = tuple((int(player[0]), int(player[1]), float(player[2]), float(player[3])) for player in moment[5][1:11])
            bucket[clock] = (float(ball[2]), float(ball[3]), float(ball[4]), players)
    compiled = {}
    for period, bucket in periods.items():
        clocks = np.array(sorted(bucket), dtype=np.float64)
        ball = np.array([bucket[float(clock)][:3] for clock in clocks], dtype=np.float64)
        players = np.array([bucket[float(clock)][3] for clock in clocks], dtype=np.float64)
        compiled[period] = {"clock": clocks, "ball": ball, "players": players}
    return compiled


def slice_clocks(period_frames: dict, clock_lo: float, clock_hi: float) -> dict | None:
    clocks = period_frames["clock"]
    lo = int(np.searchsorted(clocks, clock_lo, side="left"))
    hi = int(np.searchsorted(clocks, clock_hi, side="right"))
    if hi - lo < 12:
        return None
    # Stored ascending by game clock, which runs backward. Flip so time increases.
    index = np.arange(hi - 1, lo - 1, -1)
    clock = clocks[index]
    return {
        "t": clock[0] - clock,
        "clock": clock,
        "ball": period_frames["ball"][index],
        "players": period_frames["players"][index],
    }


def halfcourt(x: float, y: float, left_hoop: bool) -> tuple[float, float]:
    if not left_hoop:
        x = COURT_LEN - x
        y = COURT_WID - y
    # Width across the court, then distance from the baseline.
    return y, x


def shot_range(distance: float, baseline: float) -> str:
    if distance < 8.0:
        return "rim"
    if baseline <= 14.0:
        three = distance >= 22.0
    else:
        three = distance >= 23.75
    return "three" if three else "mid"


def extract_shot(frames: dict, info: dict) -> tuple[dict | None, str]:
    t = frames["t"]
    ball = frames["ball"]
    x = ball[:, 0]
    y = ball[:, 1]
    z = ball[:, 2]
    xs = rolling_mean(x)
    ys = rolling_mean(y)
    zs = rolling_mean(z)
    in_event = frames["in_event"]
    shooter_xy, shooter_team = player_track(frames["players"], info["player_id"])
    if np.isfinite(shooter_xy).sum() < 8:
        return None, "no_shooter"
    dist_shooter = np.hypot(x - shooter_xy[:, 0], y - shooter_xy[:, 1])
    action, text_dist, text_three = shot_text(info)
    apex = select_apex(z, zs, dist_shooter, x, y, t, in_event, text_dist)
    if apex is None or apex >= len(t) - 2:
        return None, "no_apex"

    vx_hint = float(x[min(apex + 2, len(x) - 1)] - x[max(apex - 2, 0)])
    hoop = nearest_hoop(float(x[apex]), float(y[apex]), vx_hint)
    left = hoop == LEFT_HOOP

    valley = apex
    while valley > 1 and t[apex] - t[valley] < 1.05 and zs[valley - 1] <= zs[valley] + 0.12:
        valley -= 1
    if apex - valley < 4:
        lo = int(np.searchsorted(t, t[apex] - 0.8))
        valley = lo + int(np.argmin(zs[lo : apex + 1]))

    vz = np.gradient(zs, t)
    az = np.gradient(vz, t)
    # The release push is the strongest upward acceleration once the ball is
    # above a dribble and still next to the shooter. The floor bounce is higher
    # acceleration, but it happens below 6 feet.
    band = (
        (np.arange(len(t)) > valley)
        & (np.arange(len(t)) < apex)
        & (z >= 6.2)
        & (z <= 12.0)
        & np.isfinite(dist_shooter)
        & (dist_shooter <= 4.0)
    )
    if band.any():
        release = int(np.argmax(np.where(band, az, -1e9)))
    else:
        rising = (np.arange(len(t)) >= valley) & (np.arange(len(t)) < apex) & (vz > 0)
        held = np.flatnonzero(rising & np.isfinite(dist_shooter) & (dist_shooter <= 4.5) & (z >= 4.0))
        if len(held) == 0:
            return None, "no_release"
        release = int(held[-1])

    vx = np.gradient(xs, t)
    vy = np.gradient(ys, t)
    toward_x = hoop[0] - x[release]
    toward_y = hoop[1] - y[release]
    toward_norm = float(np.hypot(toward_x, toward_y)) or 1.0
    toward = vx * (toward_x / toward_norm) + vy * (toward_y / toward_norm)
    lo = int(np.searchsorted(t, t[release] - 1.2))
    hi = max(lo + 1, release)
    start = lo + int(np.argmax(toward[lo:hi]))
    if t[release] - t[start] < 0.15:
        start = int(np.searchsorted(t, t[release] - 0.45))
    start = int(np.clip(start, 0, release))

    hoop_dist = np.hypot(x - hoop[0], y - hoop[1])
    end = apex
    best = float(hoop_dist[apex])
    limit = min(len(t) - 1, int(np.searchsorted(t, t[apex] + 1.35)))
    for index in range(apex + 1, limit + 1):
        distance = float(hoop_dist[index])
        if distance < best:
            best = distance
            end = index
        elif distance > best + 1.15 and z[index] > z[index - 1]:
            break

    release_dist = float(np.hypot(x[release] - hoop[0], y[release] - hoop[1]))
    baseline = float(x[release] if left else COURT_LEN - x[release])

    # Possession and dribbles, walking back from the release.
    poss = release
    touch_limit = t[release] - 6.0
    while poss > 0 and t[poss] >= touch_limit and np.isfinite(dist_shooter[poss]) and dist_shooter[poss] <= 3.8:
        poss -= 1
    poss = min(poss + 1, release)
    touch = float(t[release] - t[poss])

    dribbles = 0
    last_dribble_t = -999.0
    dribble_end = max(poss, valley)
    for index in range(poss + 1, dribble_end - 1):
        if z[index] > 2.5 or z[index] > z[index - 1] or z[index] > z[index + 1]:
            continue
        rise = float(np.max(z[index : min(len(z), index + 12)]) - z[index])
        if rise >= 1.5 and t[index] - last_dribble_t >= 0.28:
            dribbles += 1
            last_dribble_t = float(t[index])

    if dribbles >= 1:
        style = "pull_up"
    elif 0.08 <= touch <= 2.0:
        style = "catch_and_shoot"
    else:
        style = "other"

    # Nearest defender at release, searching a couple frames if tracking blinks.
    defender = None
    release_slot = None
    for probe in (release, release - 1, release + 1, release - 2, release + 2):
        if probe < 0 or probe >= len(t) or not np.isfinite(shooter_xy[probe, 0]):
            continue
        team = shooter_team[probe]
        if not np.isfinite(team):
            continue
        release_slot = probe
        opponents = []
        for slot in range(frames["players"].shape[1]):
            opp_team, opp_id, opp_x, opp_y = frames["players"][probe, slot]
            if opp_id <= 0 or opp_team == team:
                continue
            opponents.append((float(np.hypot(opp_x - shooter_xy[probe, 0], opp_y - shooter_xy[probe, 1])), opp_x, opp_y))
        if opponents:
            defender = min(opponents, key=lambda item: item[0])
            break
    if defender is None or release_slot is None:
        return None, "no_defender"
    contest = "open" if defender[0] >= 4.0 else "contested"

    angle_i = release
    angle_limit = t[release] + 0.08
    while angle_i < apex - 1 and t[angle_i] < angle_limit:
        angle_i += 1
    speed_h = float(np.hypot(vx[angle_i], vy[angle_i]))
    angle = float(np.degrees(np.arctan2(vz[angle_i], max(speed_h, 1e-3))))
    apex_z = float(np.max(z[release : end + 1]))

    forward_x = (hoop[0] - x[release]) / (release_dist or 1.0)
    forward_y = (hoop[1] - y[release]) / (release_dist or 1.0)
    right_x, right_y = forward_y, -forward_x

    sample_n = np.linspace(start, end, 30)
    sample_idx = np.unique(np.concatenate([sample_n.astype(int), [release]])).astype(int)
    sample_idx = sample_idx[(sample_idx >= start) & (sample_idx <= end)]

    path = []
    foot = []
    for index in sample_idx:
        dx = float(x[index] - x[release])
        dy = float(y[index] - y[release])
        forward = dx * forward_x + dy * forward_y
        lateral = dx * right_x + dy * right_y
        cx, cy = halfcourt(float(x[index]), float(y[index]), left)
        path.append(
            [
                rnd(t[index] - t[release], 2),
                rnd(forward, 1),
                rnd(lateral, 1),
                rnd(z[index], 1),
                rnd(cx, 1),
                rnd(cy, 1),
            ]
        )
        if t[index] <= t[release] + 0.12 and np.isfinite(shooter_xy[index, 0]):
            sx, sy = halfcourt(float(shooter_xy[index, 0]), float(shooter_xy[index, 1]), left)
            foot.append([rnd(t[index] - t[release], 2), rnd(sx, 1), rnd(sy, 1)])

    def_x, def_y = halfcourt(defender[1], defender[2], left)
    record = {
        "g": info.get("game_id", ""),
        "d": info.get("date", ""),
        "p": info["period"],
        "c": info["clock"],
        "m": 1 if info["made"] else 0,
        "a": action,
        "j": 1 if is_jumper(action) else 0,
        "r": (
            "three"
            if text_three and release_dist >= 18.0
            else "mid"
            if text_dist is not None and not text_three and text_dist < 23 and release_dist >= 8.0
            else shot_range(release_dist, baseline)
        ),
        "s": style,
        "k": contest,
        "defDist": rnd(defender[0], 1),
        "touch": rnd(touch, 2),
        "dribbles": dribbles,
        "relH": rnd(z[release], 1),
        "angle": rnd(angle, 1),
        "dist": rnd(release_dist, 1),
        "apex": rnd(apex_z, 1),
        "path": path,
        "foot": foot,
        "def": [rnd(def_x, 1), rnd(def_y, 1)],
        "playerId": info["player_id"],
        "name": info["name"],
        "team": info["team"],
        "_textDist": text_dist,
        "_textThree": text_three,
    }
    return record, "ok"


def extract_game(game: dict, events: dict[int, dict]) -> tuple[list[dict], Counter]:
    reasons: Counter = Counter()
    shots = []
    game_id = str(game.get("gameid", ""))
    game_date = str(game.get("gamedate", ""))
    timeline = build_timeline(game)
    by_id = {str(event.get("eventId")): event for event in game.get("events", [])}
    for event_num, info in events.items():
        event = by_id.get(str(event_num))
        moments = (event or {}).get("moments") or []
        if not moments:
            reasons["no_event"] += 1
            continue
        period = int(moments[0][0])
        clocks = [float(moment[2]) for moment in moments if moment and len(moment) > 2]
        if period not in timeline or not clocks:
            reasons["short"] += 1
            continue
        clock_hi = max(clocks)
        clock_lo = min(clocks)
        frames = slice_clocks(timeline[period], clock_lo - 1.3, clock_hi + 2.2)
        if frames is None:
            reasons["short"] += 1
            continue
        frames["in_event"] = (frames["clock"] <= clock_hi + 0.021) & (frames["clock"] >= clock_lo - 0.021)
        info = dict(info)
        info["game_id"] = game_id
        info["date"] = game_date
        record, reason = extract_shot(frames, info)
        reasons[reason] += 1
        if record is not None:
            shots.append(record)
    return shots, reasons


def public_shot(record: dict) -> dict:
    return {key: value for key, value in record.items() if not key.startswith("_") and key not in {"playerId", "name", "team"}}


def process_archive(task: dict) -> dict:
    stem = task["name"][:-3]
    out = SHOTS / f"{stem}.json"
    if out.exists() and not task.get("force"):
        payload = json.loads(out.read_text())
        return summarize(stem, payload.get("shots", []), payload.get("pbp", 0), Counter())
    TMP.mkdir(parents=True, exist_ok=True)
    archive = TMP / task["name"]
    folder = TMP / stem
    try:
        if folder.exists():
            shutil.rmtree(folder)
        download(task["url"], archive)
        folder.mkdir(parents=True, exist_ok=True)
        with py7zr.SevenZipFile(archive, mode="r") as compressed:
            compressed.extractall(path=folder)
        json_path = next(folder.rglob("*.json"))
        with json_path.open() as handle:
            game = json.load(handle)
        game_num = int(game["gameid"])
        events = load_game_shots(game_num)
        shots, reasons = extract_game(game, events)
        stored = []
        for shot in shots:
            item = public_shot(shot)
            item["playerId"] = shot["playerId"]
            item["name"] = shot["name"]
            item["team"] = shot["team"]
            stored.append(item)
        payload = {"gameId": str(game["gameid"]), "date": game.get("gamedate", ""), "pbp": len(events), "shots": stored}
        out.parent.mkdir(parents=True, exist_ok=True)
        temporary = out.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, separators=(",", ":")))
        temporary.replace(out)
        summary = summarize(stem, shots, len(events), reasons)
        return summary
    finally:
        archive.unlink(missing_ok=True)
        if folder.exists():
            shutil.rmtree(folder, ignore_errors=True)


def summarize(stem: str, shots: list[dict], pbp_count: int, reasons: Counter) -> dict:
    jumpers = [shot for shot in shots if shot.get("j") == 1 or shot.get("jumper") == 1]
    # Stored shots use "j"; in-memory records do too.
    heights = [shot["relH"] for shot in jumpers]
    dist_errors = []
    three_text = 0
    three_agree = 0
    for shot in shots:
        text_dist = shot.get("_textDist")
        if text_dist is not None:
            dist_errors.append(abs(float(shot["dist"]) - float(text_dist)))
        if shot.get("_textThree"):
            three_text += 1
            if shot["r"] == "three":
                three_agree += 1
    styles = Counter(shot["s"] for shot in shots)
    return {
        "stem": stem,
        "shots": len(shots),
        "pbp": pbp_count,
        "makes": sum(int(shot["m"]) for shot in shots),
        "jumper_n": len(jumpers),
        "rel_sum": float(sum(heights)),
        "apex_sum": float(sum(shot["apex"] for shot in jumpers)),
        "angle_sum": float(sum(shot["angle"] for shot in jumpers)),
        "dist_err_sum": float(sum(dist_errors)),
        "dist_err_n": len(dist_errors),
        "three_text": three_text,
        "three_agree": three_agree,
        "styles": dict(styles),
        "reasons": dict(reasons),
    }


def clock_key(clock: str) -> int:
    try:
        minutes, seconds = clock.split(":")
        return int(minutes) * 60 + int(seconds)
    except (ValueError, AttributeError):
        return 0


def aggregate() -> None:
    PLAYERS_DIR.mkdir(parents=True, exist_ok=True)
    grouped: dict[int, list] = defaultdict(list)
    names: dict[int, Counter] = defaultdict(Counter)
    teams: dict[int, Counter] = defaultdict(Counter)
    games = 0
    for path in sorted(SHOTS.glob("*.json")):
        payload = json.loads(path.read_text())
        games += 1
        for shot in payload.get("shots", []):
            player_id = int(shot["playerId"])
            names[player_id][shot.get("name") or "Unknown"] += 1
            teams[player_id][shot.get("team") or ""] += 1
            grouped[player_id].append(public_shot(shot))
    index = []
    for player_id, shots in grouped.items():
        shots.sort(key=lambda shot: (shot.get("d") or "", shot.get("p") or 0, -clock_key(shot.get("c") or "")))
        name = names[player_id].most_common(1)[0][0]
        team = teams[player_id].most_common(1)[0][0]
        jumpers = sum(1 for shot in shots if shot["j"] == 1 and shot["r"] != "rim")
        document = {"id": player_id, "name": name, "team": team, "shots": shots}
        destination = PLAYERS_DIR / f"{player_id}.json"
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(document, separators=(",", ":")))
        temporary.replace(destination)
        index.append(
            {
                "id": player_id,
                "name": name,
                "team": team,
                "shots": len(shots),
                "jumpers": jumpers,
            }
        )
    index.sort(key=lambda player: (-player["jumpers"], player["name"]))
    summary = {
        "season": "2015-16",
        "games": games,
        "shots": sum(player["shots"] for player in index),
        "players": index,
    }
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    target = WEB_DATA / "index.json"
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(summary, separators=(",", ":")))
    temporary.replace(target)
    cells: dict[tuple, list[float]] = defaultdict(lambda: [0, 0.0])
    for shots in grouped.values():
        for shot in shots:
            key = (shot["j"], shot["s"], shot["k"], shot["r"], shot["m"])
            cells[key][0] += 1
            cells[key][1] += float(shot["angle"])
    league = {
        "cells": [
            {"j": key[0], "s": key[1], "k": key[2], "r": key[3], "m": key[4], "n": int(bucket[0]), "sum": round(bucket[1], 2)}
            for key, bucket in sorted(cells.items(), key=lambda item: str(item[0]))
        ]
    }
    league_target = WEB_DATA / "league.json"
    league_temporary = league_target.with_suffix(".json.tmp")
    league_temporary.write_text(json.dumps(league, separators=(",", ":")))
    league_temporary.replace(league_target)
    print(f"wrote {len(index)} players, {summary['shots']} shots from {games} games", flush=True)


def run_sample(path: Path) -> None:
    ensure_pbp_db()
    with path.open() as handle:
        game = json.load(handle)
    events = load_game_shots(int(game["gameid"]))
    shots, reasons = extract_game(game, events)
    print(f"game {game['gameid']} {game['gamedate']}")
    print(f"pbp shots {len(events)} extracted {len(shots)} reasons {dict(reasons)}")
    jumpers = [shot for shot in shots if "jump" in shot["a"].lower()]
    if jumpers:
        heights = np.array([shot["relH"] for shot in jumpers])
        apexes = np.array([shot["apex"] for shot in jumpers])
        angles = np.array([shot["angle"] for shot in jumpers])
        print(
            f"jump shots {len(jumpers)} relH p10 {np.quantile(heights, 0.1):.1f} "
            f"p50 {np.median(heights):.1f} p90 {np.quantile(heights, 0.9):.1f} "
            f"apex p50 {np.median(apexes):.1f} angle p50 {np.median(angles):.1f}"
        )
    errors = [abs(shot["dist"] - shot["_textDist"]) for shot in shots if shot["_textDist"] is not None]
    if errors:
        print(f"dist abs err p50 {np.median(errors):.1f} p90 {np.quantile(errors, 0.9):.1f}")
    threes = [shot for shot in shots if shot["_textThree"]]
    if threes:
        agree = sum(1 for shot in threes if shot["r"] == "three")
        print(f"3PT text {len(threes)} geometry agree {agree} ({agree / len(threes):.0%})")
    print("styles", dict(Counter(shot["s"] for shot in shots)))
    print("contest", dict(Counter(shot["k"] for shot in shots)))
    print("range", dict(Counter(shot["r"] for shot in shots)))
    print("makes", sum(shot["m"] for shot in shots), "of", len(shots))
    worst = sorted(
        [shot for shot in shots if shot["_textDist"] is not None],
        key=lambda shot: abs(shot["dist"] - shot["_textDist"]),
        reverse=True,
    )[:8]
    for shot in worst:
        print(
            f"  {shot['name']:22} {shot['a'][:28]:28} text {shot['_textDist']:2} "
            f"dist {shot['dist']:5.1f} relH {shot['relH']:4.1f} apex {shot['apex']:4.1f} "
            f"{shot['s']} {shot['k']} {shot['r']}"
        )
    if not jumpers or not (6.5 <= float(np.median([shot["relH"] for shot in jumpers])) <= 10.5):
        raise SystemExit("release heights look wrong")
    rate = len(shots) / max(len(events), 1)
    if rate < 0.7:
        raise SystemExit(f"extraction rate too low: {rate:.0%}")


def print_rollup(done: list[dict]) -> None:
    shots = sum(item["shots"] for item in done)
    pbp = sum(item["pbp"] for item in done)
    jumpers = sum(item["jumper_n"] for item in done)
    rel = sum(item["rel_sum"] for item in done)
    apex = sum(item["apex_sum"] for item in done)
    angle = sum(item["angle_sum"] for item in done)
    err_n = sum(item["dist_err_n"] for item in done)
    err = sum(item["dist_err_sum"] for item in done)
    three_text = sum(item["three_text"] for item in done)
    three_agree = sum(item["three_agree"] for item in done)
    print(
        f"games {len(done)} shots {shots}/{pbp} ({shots / max(pbp, 1):.0%}) "
        f"jumper relH {rel / max(jumpers, 1):.2f} apex {apex / max(jumpers, 1):.2f} "
        f"angle {angle / max(jumpers, 1):.1f} distErr {err / max(err_n, 1):.2f} "
        f"3PT {three_agree}/{three_text}",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=Path, help="extract one local SportVU JSON and print a report")
    parser.add_argument("--limit", type=int, default=0, help="process only the first N archives")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--aggregate-only", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.sample:
        run_sample(args.sample)
        return
    if args.aggregate_only:
        aggregate()
        return
    ensure_pbp_db()
    games = ensure_games()
    if args.limit:
        games = games[: args.limit]
    pending = []
    for game in games:
        stem = game["name"][:-3]
        if (SHOTS / f"{stem}.json").exists() and not args.force:
            continue
        pending.append(game)
    print(f"{len(games)} games, {len(pending)} to process", flush=True)
    SHOTS.mkdir(parents=True, exist_ok=True)
    done: list[dict] = []
    failures = []
    if not pending:
        aggregate()
        return
    workers = max(1, args.workers)
    if workers == 1:
        iterator = ((game, process_archive({**game, "force": args.force})) for game in pending)
        for game, summary in iterator:
            done.append(summary)
            if len(done) % 10 == 0:
                print_rollup(done)
    else:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(process_archive, {**game, "force": args.force}): game for game in pending}
            for future in as_completed(futures):
                game = futures[future]
                try:
                    summary = future.result()
                except Exception as exc:  # noqa: BLE001
                    failures.append(game["name"])
                    print(f"FAIL {game['name']}: {exc}", flush=True)
                    traceback.print_exc()
                    continue
                done.append(summary)
                print(f"ok {len(done)}/{len(pending)} {summary['stem']} {summary['shots']} shots", flush=True)
                if len(done) % 10 == 0:
                    print_rollup(done)
    if failures:
        (DATA / "failures.txt").write_text("\n".join(failures) + "\n")
    print_rollup(done)
    aggregate()


if __name__ == "__main__":
    main()
