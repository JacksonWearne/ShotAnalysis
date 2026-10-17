import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { courtLayout, drawArc, drawCourt, drawFloor, drawLaunch, fitCanvas, flightXScale, invertGraphZoom, preLayout, screenToCourt, type FloorPoint, type GraphZoom } from "./draw";
import {
  compareGroups,
  contestBreakdown,
  filterShots,
  leagueAngle,
  medianShot,
  releaseCourt,
  samplePath,
  summarize,
  type BreakdownRow,
  type CurvePoint,
  type LeagueCell,
} from "./stats";
import {
  CONTEST_LABEL,
  RANGE_LABEL,
  STYLE_LABEL,
  type Catalog,
  type Filters,
  type IndexPlayer,
  type PlayerFile,
  type Shot,
  type View,
} from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DEFAULT_FILTERS: Filters = {
  style: "all",
  contest: "all",
  range: "all",
  result: "all",
};

const playerCache = new Map<number, Promise<PlayerFile>>();

function loadPlayerFile(id: number): Promise<PlayerFile> {
  const existing = playerCache.get(id);
  if (existing) return existing;
  const pending = fetch(`/data/players/${id}.json`).then((response) => {
    if (!response.ok) throw new Error("missing");
    return response.json() as Promise<PlayerFile>;
  });
  playerCache.set(id, pending);
  pending.catch(() => playerCache.delete(id));
  return pending;
}

function usePlayer(id: number | null) {
  const [player, setPlayer] = useState<PlayerFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (id == null) {
      setPlayer(null);
      setLoading(false);
      setError(false);
      return;
    }
    let cancel = false;
    setPlayer((current) => (current?.id === id ? current : null));
    setLoading(true);
    setError(false);
    loadPlayerFile(id)
      .then((data) => {
        if (cancel) return;
        setPlayer(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancel) return;
        setPlayer(null);
        setLoading(false);
        setError(true);
      });
    return () => {
      cancel = true;
    };
  }, [id]);

  return { player, loading, error };
}

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [view, setView] = useState<View>("average");
  const [showTypes, setShowTypes] = useState(false);
  const [league, setLeague] = useState<LeagueCell[] | null>(null);
  const primary = usePlayer(playerId);
  const compared = usePlayer(compareId);

  useEffect(() => {
    fetch("/data/index.json")
      .then((response) => {
        if (!response.ok) throw new Error("missing");
        return response.json() as Promise<Catalog>;
      })
      .then((data) => {
        setCatalog(data);
        setPlayerId((current) => current ?? data.players[0]?.id ?? null);
      })
      .catch(() => setCatalogError("The shot library could not be loaded."));
    fetch("/data/league.json")
      .then((response) => {
        if (!response.ok) throw new Error("missing");
        return response.json() as Promise<{ cells: LeagueCell[] }>;
      })
      .then((data) => setLeague(data.cells))
      .catch(() => setLeague(null));
  }, []);

  const players = catalog?.players ?? [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Shot Arc</h1>
          <p>2015–16 SportVU. Paths are the ball, not a player’s joints.</p>
        </div>
        <div className="views" role="tablist" aria-label="Page">
          {(
            [
              ["average", "Average"],
              ["individual", "Individual"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className={compareId != null ? "workspace compare" : "workspace"}>
        <aside className="panel sidebar">
          <div className="sidebar-block">
            <h2 className="sidebar-heading">Players</h2>
            <div className="player-picks">
              <PlayerSelect
                label="Player"
                players={players}
                selectedId={playerId}
                onSelect={(id) => {
                  if (id == null) return;
                  setPlayerId(id);
                  setCompareId((current) => (current === id ? null : current));
                }}
              />
              <PlayerSelect
                label="Compare"
                players={players.filter((item) => item.id !== playerId)}
                selectedId={compareId}
                allowNone
                onSelect={setCompareId}
              />
              {catalogError ? <p className="note">{catalogError}</p> : null}
            </div>
          </div>
          <div className="filter-scroll">
            <h2 className="sidebar-heading">Filters</h2>
            <div className="filters">
              <Choice
                label="Style"
                value={filters.style}
                options={[
                  ["all", "All"],
                  ["catch_and_shoot", "Catch and shoot", "No dribble, touch under 2 seconds"],
                  ["pull_up", "Pull-up"],
                  ["other", "Other"],
                ]}
                onChange={(style) => setFilters({ ...filters, style })}
              />
              <Choice
                label="Contest"
                value={filters.contest}
                options={[
                  ["all", "All"],
                  ["open", "Open", "Defender at least 4 feet away"],
                  ["contested", "Contested", "Defender inside 4 feet"],
                ]}
                onChange={(contest) => setFilters({ ...filters, contest })}
              />
              <Choice
                label="Range"
                value={filters.range}
                options={[
                  ["all", "All", "Mid-range and three"],
                  ["mid", "Mid-range"],
                  ["three", "Three"],
                ]}
                onChange={(range) => setFilters({ ...filters, range })}
              />
              <Choice
                label="Result"
                value={filters.result}
                options={[
                  ["all", "All"],
                  ["make", "Makes"],
                  ["miss", "Misses"],
                ]}
                onChange={(result) => setFilters({ ...filters, result })}
              />
            </div>
          </div>
          <p className="sidebar-foot">Public archive of the 2015–16 games released before the feed was removed.</p>
        </aside>
        {primary.player ? (
          <PlayerPane
            key={primary.player.id}
            player={primary.player}
            filters={filters}
            view={view}
            showTypes={showTypes}
            onShowTypes={setShowTypes}
            onOpenIndividual={() => setView("individual")}
            league={league}
          />
        ) : (
          <section className="panel empty-stage">
            <p className="empty">{primary.error ? "Could not load this player." : primary.loading ? "Loading shots…" : "Choose a player."}</p>
          </section>
        )}
        {compareId != null ? (
          compared.player ? (
            <PlayerPane
              key={compared.player.id}
              player={compared.player}
              filters={filters}
              view={view}
              showTypes={showTypes}
              onShowTypes={setShowTypes}
              onOpenIndividual={() => setView("individual")}
              league={league}
            />
          ) : (
            <section className="panel empty-stage">
              <p className="empty">{compared.error ? "Could not load this player." : "Loading shots…"}</p>
            </section>
          )
        ) : null}
      </div>
    </div>
  );
}

function PlayerPane({
  player,
  filters,
  view,
  showTypes,
  onShowTypes,
  onOpenIndividual,
  league,
}: {
  player: PlayerFile;
  filters: Filters;
  view: View;
  showTypes: boolean;
  onShowTypes: (value: boolean) => void;
  onOpenIndividual: () => void;
  league: LeagueCell[] | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [preZoom, setPreZoom] = useState<GraphZoom>({ on: false, panX: 0, panY: 0 });
  const [courtZoom, setCourtZoom] = useState<GraphZoom>({ on: false, panX: 0, panY: 0 });
  const [fullZoom, setFullZoom] = useState<GraphZoom>({ on: false, panX: 0, panY: 0 });
  const [shotsOpen, setShotsOpen] = useState(true);
  const preRef = useRef<HTMLCanvasElement>(null);
  const courtRef = useRef<HTMLCanvasElement>(null);
  const fullRef = useRef<HTMLCanvasElement>(null);
  const launchRef = useRef<HTMLCanvasElement>(null);
  const playRef = useRef({ playing: false, time: 0 });
  const pathRef = useRef<number[][]>([]);
  const paintRef = useRef<() => void>(() => {});
  const preDrag = useRef<Drag | null>(null);
  const courtDrag = useRef<Drag | null>(null);
  const fullDrag = useRef<Drag | null>(null);

  const filtered = useMemo(() => filterShots(player.shots, filters), [player, filters]);
  const selected = filtered.find((shot) => shotId(shot) === selectedId) ?? null;
  const median = useMemo(() => medianShot(filtered), [filtered]);
  const byType = view === "average" && showTypes;
  const groups = useMemo(() => (byType ? compareGroups(player.shots, filters) : []), [player, filters, byType]);
  const groupCurves = useMemo(
    () =>
      groups
        .map((group) => ({ ...group, shot: medianShot(group.shots) }))
        .filter((group): group is typeof group & { shot: Shot } => group.shot != null),
    [groups],
  );
  const stats = useMemo(() => summarize(filtered), [filtered]);
  const leagueMean = useMemo(() => (league ? leagueAngle(league, filters) : null), [league, filters]);
  const representative = (byType ? groupCurves[0]?.shot : median) ?? median;
  const playback = (view === "individual" ? selected ?? median : representative) ?? null;
  const activePath = playback?.path ?? [];
  const t0 = activePath[0]?.[0] ?? 0;
  const t1 = activePath[activePath.length - 1]?.[0] ?? 1;

  playRef.current.playing = playing;
  if (!playing) playRef.current.time = playTime;
  pathRef.current = activePath;

  const medianKey = median ? shotId(median) : "";
  useEffect(() => {
    if (view !== "average") return;
    const start = pathRef.current[0]?.[0] ?? 0;
    playRef.current.time = start;
    playRef.current.playing = false;
    setPlayTime(start);
    setPlaying(false);
  }, [medianKey, view, byType]);

  useEffect(() => {
    if (view !== "individual") return;
    if (selectedId && filtered.some((shot) => shotId(shot) === selectedId)) return;
    const fallback = median ?? filtered[0];
    if (!fallback) return;
    setSelectedId(shotId(fallback));
    const start = fallback.path[0]?.[0] ?? 0;
    playRef.current.time = start;
    playRef.current.playing = false;
    setPlayTime(start);
    setPlaying(false);
  }, [view, filtered, median, selectedId]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const path = pathRef.current;
      if (playRef.current.playing) {
        const end = path[path.length - 1]?.[0] ?? 1;
        const start = path[0]?.[0] ?? 0;
        const next = playRef.current.time + ((now - last) / 1000) * PLAY_RATE;
        if (next > end) {
          playRef.current.time = start;
          playRef.current.playing = false;
          setPlaying(false);
          setPlayTime(start);
        } else {
          playRef.current.time = next;
          setPlayTime(next);
        }
      }
      last = now;
      paintRef.current();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  function paint() {
    const pre = preRef.current ? fitCanvas(preRef.current) : null;
    const full = fullRef.current ? fitCanvas(fullRef.current) : null;
    const court = courtRef.current ? fitCanvas(courtRef.current) : null;
    const sample = activePath.length ? samplePath(activePath, playRef.current.time) : null;
    const ball = sample ? { f: sample[1], z: sample[3] } : null;
    const focus = playback;
    const focusPath = focus?.path ?? [];
    const focusSample = focusPath.length ? samplePath(focusPath, playRef.current.time) : null;
    const focusRelease = throughRelease(focusPath).at(-1) ?? null;
    const preBall = focusSample ? (focusSample[0] <= 0 ? { f: focusSample[1], z: focusSample[3] } : focusRelease) : null;
    const typeLines = groupCurves.filter((group) => group.shot.path.length > 1);
    const fullSeries = byType
      ? typeLines.map((group) => ({
          points: asCurve(group.shot),
          color: group.color,
          width: 2.4,
          dash: group.dash,
          band: false,
        }))
      : [
          ...(view === "individual" && median && playback && shotId(median) !== shotId(playback)
            ? [{ points: asCurve(median), color: "rgba(12, 35, 64, 0.45)", width: 1.6, dash: [6, 5], band: false }]
            : []),
          ...(playback
            ? [{ points: asCurve(playback), color: "#0c2340", width: 2.6, dash: [] as number[], band: false, tempo: view === "individual" }]
            : []),
        ];
    const rimDist = playback ? playback.dist : stats.distance;
    const xScale = full
      ? flightXScale(
          full.width,
          full.height,
          fullSeries.flatMap((line) => line.points.map((point) => ({ f: point.f, z: point.z }))),
          rimDist,
        )
      : 1;
    if (pre) {
      pre.ctx.clearRect(0, 0, pre.width, pre.height);
      const layout = view === "individual" ? preLayout(pre.width, pre.height) : null;
      if (layout) {
        const floorShots = playback ? [{ shot: playback, color: "#0c2340", dash: [] as number[] }] : [];
        drawFloor(
          pre.ctx,
          floorShots.map((group) => ({
            color: group.color,
            dash: group.dash,
            ball: courtPoints(group.shot),
            foot: footPoints(group.shot),
          })),
          floorBall(focusPath, focusSample, false),
          focus ? sampleFoot(focus.foot, playRef.current.time) : null,
          focus ? focus.dist : null,
          preZoom,
          layout.floor,
        );
      }
      const formSeries = byType
        ? typeLines.map((group) => ({
            points: clipToRelease(asCurve(group.shot)),
            color: group.color,
            width: 2.6,
            dash: group.dash,
            band: false,
            ticks: timeTicks(group.shot.path, 0),
          }))
        : playback
          ? [
              ...(view === "individual" && median && shotId(median) !== shotId(playback)
                ? [
                    {
                      points: clipToRelease(asCurve(median)),
                      color: "rgba(12, 35, 64, 0.4)",
                      width: 1.5,
                      dash: [5, 4],
                      band: false,
                    },
                  ]
                : []),
              {
                points: clipToRelease(asCurve(playback)),
                color: "#0c2340",
                width: 3,
                dash: [] as number[],
                band: false,
                tempo: true,
                ticks: timeTicks(playback.path, 0),
              },
            ]
          : [];
      drawArc(pre.ctx, pre.width, pre.height, [], formSeries, preBall, null, preZoom, {
        fit: true,
        tight: true,
        region: layout?.form,
        compact: layout != null,
        xScale,
      });
      if (layout) {
        pre.ctx.save();
        pre.ctx.strokeStyle = "rgba(12, 35, 64, 0.16)";
        pre.ctx.beginPath();
        if (layout.stacked) {
          pre.ctx.moveTo(10, layout.form.y - 4);
          pre.ctx.lineTo(pre.width - 10, layout.form.y - 4);
        } else {
          pre.ctx.moveTo(layout.form.x - 5, 10);
          pre.ctx.lineTo(layout.form.x - 5, pre.height - 10);
        }
        pre.ctx.stroke();
        pre.ctx.restore();
      }
    }
    if (full) {
      drawArc(full.ctx, full.width, full.height, [], fullSeries, ball, rimDist, fullZoom, {
        ticks: timeTicks(activePath),
      });
    }
    const launch = launchRef.current ? fitCanvas(launchRef.current) : null;
    if (launch && view === "average") drawLaunch(launch.ctx, launch.width, launch.height, stats.angle, leagueMean);
    if (court && view === "individual") {
      const marks = filtered
        .map((shot) => {
          const spot = releaseCourt(shot);
          if (!spot) return null;
          return { shot, x: spot[0], y: spot[1], selected: selected != null && shotId(shot) === shotId(selected) };
        })
        .filter((mark): mark is { shot: Shot; x: number; y: number; selected: boolean } => mark != null);
      drawCourt(court.ctx, court.width, court.height, marks, selected, courtZoom);
    }
  }

  paintRef.current = paint;

  function chooseShot(shot: Shot, openIndividual = false) {
    setSelectedId(shotId(shot));
    if (openIndividual) onOpenIndividual();
    const start = shot.path[0]?.[0] ?? 0;
    playRef.current.time = start;
    playRef.current.playing = true;
    setPlayTime(start);
    setPlaying(true);
  }

  function pickCourt(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = courtRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const layout = courtLayout(rect.width, rect.height);
    const [px, py] = invertGraphZoom(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      courtZoom,
    );
    const [x, y] = screenToCourt(px, py, layout);
    let best: Shot | null = null;
    let bestDist = 1.6;
    for (const shot of filtered) {
      const spot = releaseCourt(shot);
      if (!spot) continue;
      const distance = Math.hypot(spot[0] - x, spot[1] - y);
      if (distance < bestDist) {
        best = shot;
        bestDist = distance;
      }
    }
    if (best) chooseShot(best);
  }

  return (
    <section className={`stage page-${view}${view === "individual" && !shotsOpen ? " shots-collapsed" : ""}`}>
      <div className="stage-main">
        <div className="stage-head">
          <div className="identity">
            <h2>{player.name}</h2>
            <p className="team">{player.team}</p>
            <p className="lede">
              {view === "average"
                ? "Typical mechanics for the shots that match the filters."
                : "Review one shot. Pick it from the chart or the list."}
            </p>
          </div>
          {view === "average" ? (
            <div className="views" role="group" aria-label="Typical shot">
              <button type="button" aria-pressed={!showTypes} onClick={() => onShowTypes(false)}>
                Median
              </button>
              <button type="button" aria-pressed={showTypes} onClick={() => onShowTypes(true)}>
                By type
              </button>
            </div>
          ) : null}
        </div>
        {view === "average" ? (
          <div className="stats">
            <Stat label="Shots" value={String(stats.attempts)} />
            <Stat label="FG%" value={stats.pct == null ? "—" : `${(stats.pct * 100).toFixed(1)}%`} />
            <Stat label="Release" value={formatNum(stats.release, 1, " ft")} />
            <Stat label="Launch" value={formatNum(stats.angle, 0, "°")} />
            <Stat label="Apex" value={formatNum(stats.apex, 1, " ft")} />
            <Stat label="Touch" value={formatNum(stats.touch, 2, " s")} />
            <Stat label="Defender" value={formatNum(stats.defender, 1, " ft")} />
          </div>
        ) : selected ? (
          <div className="stats">
            <Stat label="Result" value={selected.m ? "Make" : "Miss"} tone={selected.m ? "make" : "miss"} />
            <Stat label="Distance" value={formatNum(selected.dist, 0, " ft")} />
            <Stat label="Release" value={formatNum(selected.relH, 1, " ft")} />
            <Stat label="Launch" value={formatNum(selected.angle, 0, "°")} />
            <Stat label="Apex" value={formatNum(selected.apex, 1, " ft")} />
            <Stat label="Touch" value={formatNum(selected.touch, 2, " s")} />
            <Stat label="Defender" value={formatNum(selected.defDist, 1, " ft")} />
          </div>
        ) : (
          <p className="note">No shots match these filters.</p>
        )}
        {view === "average" && showTypes ? (
          <div className="legend">
            {groupCurves.map((group) => (
              <span key={group.label}>
                <i className="swatch" style={{ background: group.color }} />
                {group.label}
                <em>{group.shots.length}</em>
              </span>
            ))}
          </div>
        ) : view === "average" && median ? (
          <p className="context">
            Median of the filtered shots · {formatDate(median.d)} · {median.a}
          </p>
        ) : selected ? (
          <p className="context">
            {formatDate(selected.d)} · Q{selected.p} {selected.c} · {selected.a} · {STYLE_LABEL[selected.s]} · {CONTEST_LABEL[selected.k]} · {RANGE_LABEL[selected.r]}
            {median && shotId(median) !== shotId(selected) ? " · Dashed line is the median shot." : ""}
          </p>
        ) : null}
        <div className="viz">
          <div className="viz-top">
            <GraphFrame
              caption="Pre-release"
              hint={
                view === "average"
                  ? "Release shape, stopped when the ball leaves the hand."
                  : "Floor path and release shape, stopped at release."
              }
              zoom={preZoom}
              onToggle={() => setPreZoom((zoom) => ({ on: !zoom.on, panX: 0, panY: 0 }))}
              canvasRef={preRef}
              canvasLabel={view === "average" ? "Pre-release form" : "Pre-release on the floor versus the rim"}
              onPointerDown={(event) => beginDrag(event, preZoom, preDrag)}
              onPointerMove={(event) => dragZoom(event, preDrag, setPreZoom)}
              onPointerUp={() => {
                preDrag.current = null;
              }}
              onPointerCancel={() => {
                preDrag.current = null;
              }}
            />
            {view === "average" ? (
              <GraphFrame
                caption="Launch angle"
                hint="Solid line is this player. Dashed line is the league."
                canvasRef={launchRef}
                canvasLabel="Launch angle versus the league"
              />
            ) : null}
            {view === "individual" ? (
              <GraphFrame
                caption="Shot chart"
                hint="Green is a make, red is a miss. Click a spot to open it."
                zoom={courtZoom}
                onToggle={() => setCourtZoom((zoom) => ({ on: !zoom.on, panX: 0, panY: 0 }))}
                canvasRef={courtRef}
                canvasLabel="Shot chart"
                onPointerDown={(event) => beginDrag(event, courtZoom, courtDrag)}
                onPointerMove={(event) => dragZoom(event, courtDrag, setCourtZoom)}
                onPointerUp={(event) => {
                  const moved = courtDrag.current?.moved ?? false;
                  courtDrag.current = null;
                  if (!moved) pickCourt(event);
                }}
                onPointerCancel={() => {
                  courtDrag.current = null;
                }}
              />
            ) : null}
          </div>
          <GraphFrame
            caption="Full shot"
            hint="Ball height versus distance to the rim."
            zoom={fullZoom}
            onToggle={() => setFullZoom((zoom) => ({ on: !zoom.on, panX: 0, panY: 0 }))}
            canvasRef={fullRef}
            canvasLabel="Full shot"
            frameClass="full-shot"
            onPointerDown={(event) => beginDrag(event, fullZoom, fullDrag)}
            onPointerMove={(event) => dragZoom(event, fullDrag, setFullZoom)}
            onPointerUp={() => {
              fullDrag.current = null;
            }}
            onPointerCancel={() => {
              fullDrag.current = null;
            }}
          />
        </div>
        <div className="transport">
          <span className="transport-label">Playback</span>
          <button
            type="button"
            onClick={() => {
              if (playing) {
                setPlaying(false);
                return;
              }
              const start = playTime >= t1 - 0.02 ? t0 : playTime;
              playRef.current.time = start;
              playRef.current.playing = true;
              setPlayTime(start);
              setPlaying(true);
            }}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <span className="clock" aria-label="Time from release">
            {formatClock(playTime)}
          </span>
          <input
            type="range"
            min={t0}
            max={t1}
            step={0.02}
            value={Math.min(t1, Math.max(t0, playTime))}
            aria-label="Shot time"
            onChange={(event) => {
              const time = Number(event.target.value);
              playRef.current.playing = false;
              playRef.current.time = time;
              setPlaying(false);
              setPlayTime(time);
            }}
          />
        </div>
        <p className="note tempo-note">
          Quarter speed. Each dot is 0.04 seconds{byType ? "." : ". Lighter blue on the close-up is slower."}
        </p>
        {view === "average" ? <BreakdownTable shots={player.shots} filters={filters} /> : null}
      </div>
      {view === "individual" ? (
      <div className="pane-shots">
        <button
          type="button"
          className="shots-toggle"
          aria-expanded={shotsOpen}
          aria-label={shotsOpen ? "Hide shot list" : "Show shot list"}
          onClick={() => setShotsOpen((open) => !open)}
        >
          <span>Shots</span>
          {shotsOpen ? <span className="shots-action">Hide</span> : null}
        </button>
        {shotsOpen ? (
          <div className="shots">
            {filtered.map((shot, index) => {
              const previous = filtered[index - 1];
              const showDate = !previous || previous.d !== shot.d;
              return (
                <div key={shotId(shot)}>
                  {showDate ? <p className="shot-date">{formatDate(shot.d)}</p> : null}
                  <button
                    type="button"
                    className="shot"
                    aria-selected={shotId(shot) === selectedId}
                    onClick={() => chooseShot(shot)}
                  >
                    <span className="shot-line">
                      <span>
                        Q{shot.p} {shot.c}
                      </span>
                      <span className={shot.m ? "result-make" : "result-miss"}>{shot.m ? "Make" : "Miss"}</span>
                    </span>
                    <small>
                      {shot.a} · {STYLE_LABEL[shot.s]} · {CONTEST_LABEL[shot.k]} · {RANGE_LABEL[shot.r]}
                    </small>
                  </button>
                </div>
              );
            })}
            {filtered.length === 0 ? <p className="note">No shots match these filters.</p> : null}
          </div>
        ) : null}
      </div>
      ) : null}
    </section>
  );
}

function BreakdownTable({ shots, filters }: { shots: Shot[]; filters: Filters }) {
  const rows = useMemo(() => contestBreakdown(shots, filters), [shots, filters]);
  return (
    <div className="breakdown">
      <h3 className="section">Open versus contested</h3>
      <p className="context">Open minus contested, split by shot type. Style and contest filters stay expanded so both sides remain visible.</p>
      <table>
        <thead>
          <tr>
            <th>Group</th>
            <th>Shots</th>
            <th>FG%</th>
            <th>Release</th>
            <th>Launch</th>
            <th>Apex</th>
            <th>Touch</th>
            <th>Defender</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.kind}-${row.label}-${index}`} className={`${row.kind}${row.depth ? " split" : ""}`}>
              <th scope="row">{row.label}</th>
              <td>{row.kind === "delta" ? signed(row.attempts, 0) : String(row.attempts)}</td>
              <td>{row.kind === "delta" ? signed(row.pct == null ? null : row.pct * 100, 1, " pts") : formatNum(row.pct == null ? null : row.pct * 100, 1, "%")}</td>
              <td>{cell(row, row.release, 1, " ft")}</td>
              <td>{cell(row, row.angle, 0, "°")}</td>
              <td>{cell(row, row.apex, 1, " ft")}</td>
              <td>{cell(row, row.touch, 2, " s")}</td>
              <td>{cell(row, row.defender, 1, " ft")}</td>
            </tr>
          ))}
        </tbody>
        <caption>Range and result filters apply to every row.</caption>
      </table>
    </div>
  );
}

function PlayerSelect({
  label,
  players,
  selectedId,
  onSelect,
  allowNone = false,
}: {
  label: string;
  players: IndexPlayer[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  allowNone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = players.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const shown = players.filter((item) => {
    if (!needle) return true;
    return item.name.toLowerCase().includes(needle) || item.team.toLowerCase().includes(needle);
  });

  function close(id: number | null) {
    onSelect(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="combo" ref={rootRef}>
      <span className="combo-label" id={`${label}-label`}>
        {label}
      </span>
      <button
        type="button"
        className="combo-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${label}-label`}
        onClick={() => {
          setOpen((value) => !value);
          if (open) setQuery("");
        }}
      >
        <span>{selected ? selected.name : allowNone ? "None" : "Select a player"}</span>
        <small>{selected ? `${selected.team} · ${selected.jumpers} jump shots` : allowNone ? "Add a second player" : ""}</small>
      </button>
      {open ? (
        <div className="combo-menu" role="listbox" aria-label={label}>
          <input
            className="search"
            autoFocus
            placeholder="Search players"
            aria-label={`Search ${label.toLowerCase()}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
                setQuery("");
              }
            }}
          />
          <div className="combo-list">
            {allowNone ? (
              <button type="button" className="player" role="option" aria-selected={selectedId == null} onClick={() => close(null)}>
                None
                <small>Show one player</small>
              </button>
            ) : null}
            {shown.map((item) => (
              <button
                key={item.id}
                type="button"
                className="player"
                role="option"
                aria-selected={item.id === selectedId}
                onClick={() => close(item.id)}
              >
                {item.name}
                <small>
                  {item.team} · {item.jumpers} jump shots
                </small>
              </button>
            ))}
            {shown.length === 0 ? <p className="note">No players match.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Drag = { x: number; y: number; panX: number; panY: number; moved: boolean; active: boolean };

function beginDrag(event: ReactPointerEvent<HTMLCanvasElement>, zoom: GraphZoom, store: { current: Drag | null }) {
  store.current = {
    x: event.clientX,
    y: event.clientY,
    panX: zoom.panX,
    panY: zoom.panY,
    moved: false,
    active: zoom.on,
  };
  if (zoom.on) event.currentTarget.setPointerCapture(event.pointerId);
}

function dragZoom(
  event: ReactPointerEvent<HTMLCanvasElement>,
  store: { current: Drag | null },
  setZoom: (zoom: GraphZoom) => void,
) {
  const drag = store.current;
  if (!drag?.active) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (Math.hypot(dx, dy) > 3) drag.moved = true;
  setZoom({ on: true, panX: drag.panX + dx, panY: drag.panY + dy });
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string, string?])[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="choice">
      <legend>{label}</legend>
      <div className="segment" data-count={options.length} role="group" aria-label={label}>
        {options.map(([id, text, hint]) => (
          <button key={id} type="button" aria-pressed={value === id} title={hint} onClick={() => onChange(id)}>
            {text}
          </button>
        ))}
      </div>
      {options.find(([id]) => id === value)?.[2] ? <p className="choice-hint">{options.find(([id]) => id === value)?.[2]}</p> : null}
    </fieldset>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "make" | "miss" }) {
  return (
    <div className={tone ? `kpi kpi-${tone}` : "kpi"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function cell(row: BreakdownRow, value: number | null, digits: number, suffix: string): string {
  return row.kind === "delta" ? signed(value, digits, suffix) : formatNum(value, digits, suffix);
}

function signed(value: number | null, digits: number, suffix = ""): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}${suffix}`;
}

function formatNum(value: number | null, digits: number, suffix = ""): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

function formatDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${MONTHS[Number(month) - 1] ?? ""} ${Number(day)}`;
}

const PLAY_RATE = 0.25;

function formatClock(time: number): string {
  if (Math.abs(time) < 0.005) return "0.00s";
  const sign = time < 0 ? "−" : "+";
  return `${sign}${Math.abs(time).toFixed(2)}s`;
}

function courtPoints(shot: Shot, untilRelease = false): FloorPoint[] {
  const points = shot.path.map((point) => ({ t: point[0], x: point[4], y: point[5] }));
  if (!untilRelease) return points;
  const kept: FloorPoint[] = [];
  for (const point of points) {
    kept.push(point);
    if (point.t >= 0) break;
  }
  return kept;
}

function floorBall(path: number[][], sample: number[] | null, untilRelease: boolean): { x: number; y: number } | null {
  if (untilRelease && (!sample || sample[0] > 0)) {
    let release = path[0];
    if (!release) return null;
    let gap = Math.abs(release[0]);
    for (const point of path) {
      const next = Math.abs(point[0]);
      if (next < gap) {
        release = point;
        gap = next;
      }
    }
    return { x: release[4], y: release[5] };
  }
  return sample ? { x: sample[4], y: sample[5] } : null;
}

function footPoints(shot: Shot): FloorPoint[] {
  return shot.foot.map((point) => ({ t: point[0], x: point[1], y: point[2] }));
}

function sampleFoot(foot: number[][], time: number): { x: number; y: number } | null {
  if (!foot.length) return null;
  if (foot.length === 1 || time <= foot[0][0]) return { x: foot[0][1], y: foot[0][2] };
  const last = foot[foot.length - 1];
  if (time >= last[0]) return { x: last[1], y: last[2] };
  for (let index = 1; index < foot.length; index += 1) {
    if (foot[index][0] >= time) {
      const span = foot[index][0] - foot[index - 1][0] || 1e-6;
      const mix = (time - foot[index - 1][0]) / span;
      return {
        x: foot[index - 1][1] + (foot[index][1] - foot[index - 1][1]) * mix,
        y: foot[index - 1][2] + (foot[index][2] - foot[index - 1][2]) * mix,
      };
    }
  }
  return { x: last[1], y: last[2] };
}

function timeTicks(path: number[][], until?: number): { f: number; z: number }[] {
  if (path.length < 2) return [];
  const start = path[0][0];
  const end = until == null ? path[path.length - 1][0] : Math.min(path[path.length - 1][0], until);
  if (end < start) return [];
  const marks: { f: number; z: number }[] = [];
  for (let time = start; time <= end + 1e-4; time += 0.04) {
    const sample = samplePath(path, Math.min(Math.round(time * 1000) / 1000, end));
    if (!sample) continue;
    marks.push({ f: sample[1], z: sample[3] });
  }
  return marks;
}

function throughRelease(path: number[][]): { f: number; z: number }[] {
  const points: { f: number; z: number }[] = [];
  for (const point of path) {
    points.push({ f: point[1], z: point[3] });
    if (point[0] >= 0) break;
  }
  return points;
}

function clipToRelease(points: CurvePoint[]): CurvePoint[] {
  const kept: CurvePoint[] = [];
  for (const point of points) {
    kept.push(point);
    if (point.t >= 0) break;
  }
  return kept;
}

function GraphFrame({
  caption,
  hint,
  zoom,
  onToggle,
  canvasRef,
  canvasLabel,
  frameClass,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  caption: string;
  hint?: string;
  zoom?: GraphZoom;
  onToggle?: () => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvasLabel: string;
  frameClass?: string;
  onPointerDown?: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerCancel?: () => void;
}) {
  return (
    <figure className={frameClass ? `graph-frame ${frameClass}` : "graph-frame"}>
      <figcaption>
        {caption}
        {hint ? <span className="graph-hint">{hint}</span> : null}
      </figcaption>
      <div className={zoom?.on ? "graph zoomed" : "graph"}>
        {zoom && onToggle ? (
          <button
            type="button"
            className="zoom-toggle"
            aria-pressed={zoom.on}
            aria-label={zoom.on ? `Fit ${caption.toLowerCase()}` : `Zoom ${caption.toLowerCase()}`}
            title={zoom.on ? "Drag to look around" : "Zoom in"}
            onClick={onToggle}
          >
            {zoom.on ? "Fit" : "Zoom"}
          </button>
        ) : null}
        <canvas
          ref={canvasRef}
          aria-label={canvasLabel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
      </div>
    </figure>
  );
}

function shotId(shot: Shot): string {
  return `${shot.g}|${shot.p}|${shot.c}|${shot.d}|${shot.a}|${shot.dist}`;
}

function asCurve(shot: Shot): CurvePoint[] {
  return shot.path.map((point) => ({
    t: point[0],
    f: point[1],
    l: point[2],
    z: point[3],
    zLo: point[3],
    zHi: point[3],
  }));
}
