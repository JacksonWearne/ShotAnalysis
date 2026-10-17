import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { courtLayout, drawArc, drawCourt, drawLaunch, drawPreRelease3D, drawVariation, fitCanvas, flightXScale, invertGraphZoom, screenToCourt, sideOrbit, SIDE_ORBIT, ZOOM_SCALE, type GraphZoom, type OrbitView, type PrePoint, type PreTrail } from "./draw";
import {
  compareGroups,
  contestBreakdown,
  clipFlight,
  displayRange,
  filterShots,
  medianGather,
  type GatherSample,
  leagueAngle,
  medianShot,
  samplePath,
  shotSpread,
  shotSpot,
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
  range: "three",
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
  const [docsOpen, setDocsOpen] = useState(false);
  const [zoomPages, setZoomPages] = useState<Record<View, boolean>>({ average: false, individual: false });
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
  const zoomOn = zoomPages[view];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Shot Arc</h1>
          <p>2015–16 SportVU. Paths are the ball, not a player’s joints.</p>
        </div>
        <div className="topbar-controls">
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
          <SettingsMenu
            zoomOn={zoomOn}
            threes={filters.range === "three"}
            docsOpen={docsOpen}
            onZoom={() => setZoomPages((pages) => ({ ...pages, [view]: !pages[view] }))}
            onThrees={() => setFilters((current) => ({ ...current, range: current.range === "three" ? "mid" : "three" }))}
            onDocs={() => setDocsOpen((open) => !open)}
          />
        </div>
      </header>
      {docsOpen ? <DocsOverlay onClose={() => setDocsOpen(false)} /> : null}
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
            zoomOn={zoomOn}
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
              zoomOn={zoomOn}
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
  zoomOn,
  showTypes,
  onShowTypes,
  onOpenIndividual,
  league,
}: {
  player: PlayerFile;
  filters: Filters;
  view: View;
  zoomOn: boolean;
  showTypes: boolean;
  onShowTypes: (value: boolean) => void;
  onOpenIndividual: () => void;
  league: LeagueCell[] | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [courtZoom, setCourtZoom] = useState<GraphZoom>(FIT_ZOOM);
  const [preZoom, setPreZoom] = useState<GraphZoom>(FIT_ZOOM);
  const [fullZooms, setFullZooms] = useState<Record<View, GraphZoom>>({ average: FIT_ZOOM, individual: FIT_ZOOM });
  const fullZoom = fullZooms[view];
  const [shotsOpen, setShotsOpen] = useState(true);
  const preRef = useRef<HTMLCanvasElement>(null);
  const courtRef = useRef<HTMLCanvasElement>(null);
  const fullRef = useRef<HTMLCanvasElement>(null);
  const launchRef = useRef<HTMLCanvasElement>(null);
  const spreadRef = useRef<HTMLCanvasElement>(null);
  const playRef = useRef({ playing: false, time: 0 });
  const clockRef = useRef<Record<View, { playing: boolean; time: number }>>({
    average: { playing: false, time: 0 },
    individual: { playing: false, time: 0 },
  });
  const viewRef = useRef(view);
  const pathRef = useRef<number[][]>([]);
  const paintRef = useRef<() => void>(() => {});
  const orbitRef = useRef<OrbitView>({ ...SIDE_ORBIT });
  const orbitDrag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  useEffect(() => {
    if (zoomOn) return;
    if (view === "average") {
      setPreZoom(FIT_ZOOM);
      setFullZooms((pages) => ({ ...pages, average: FIT_ZOOM }));
      return;
    }
    setCourtZoom(FIT_ZOOM);
    setFullZooms((pages) => ({ ...pages, individual: FIT_ZOOM }));
  }, [zoomOn, view]);

  function setFullZoom(zoom: GraphZoom) {
    setFullZooms((pages) => ({ ...pages, [view]: zoom }));
  }

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
  const gatherCurves = useMemo(() => {
    if (byType) {
      return groupCurves.map((group) => ({
        color: group.color,
        dash: group.dash,
        shot: group.shot as Shot | null,
        points: medianGather(group.shots),
      }));
    }
    return [{ color: "#0c2340", dash: [] as number[], shot: median, points: medianGather(filtered) }];
  }, [byType, groupCurves, filtered, median]);
  const representative = (byType ? groupCurves[0]?.shot : median) ?? median;
  const playback = (view === "individual" ? selected ?? median : representative) ?? null;
  const activePath = playback ? clipFlight(playback) : [];
  const t0 = activePath[0]?.[0] ?? 0;
  const t1 = activePath[activePath.length - 1]?.[0] ?? 1;

  playRef.current.playing = playing;
  if (!playing) playRef.current.time = playTime;
  pathRef.current = activePath;

  const medianKey = median ? shotId(median) : "";
  const representativeRef = useRef(representative);
  representativeRef.current = representative;

  useLayoutEffect(() => {
    if (viewRef.current === view) return;
    clockRef.current[viewRef.current] = { playing: playRef.current.playing, time: playRef.current.time };
    const next = clockRef.current[view];
    playRef.current.playing = next.playing;
    playRef.current.time = next.time;
    setPlaying(next.playing);
    setPlayTime(next.time);
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    if (view !== "individual") return;
    // Shot changes keep the current angle. Reset is the control that returns to a side view.
    orbitRef.current = sideOrbit(pathRef.current);
  }, [view]);

  useEffect(() => {
    const shot = representativeRef.current;
    const start = shot ? (clipFlight(shot)[0]?.[0] ?? 0) : 0;
    clockRef.current.average = { playing: false, time: start };
    if (viewRef.current !== "average") return;
    playRef.current.time = start;
    playRef.current.playing = false;
    setPlayTime(start);
    setPlaying(false);
  }, [medianKey, byType]);

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
    if (pre && view === "individual") {
      const flight = playback ? clipFlight(playback) : [];
      const after = flightPoints(flight);
      const trails: PreTrail[] = playback
        ? [
            {
              points: releasePoints(flight),
              color: "#0c2340",
              width: 3,
              dash: [],
              tempo: true,
            },
            ...(after.length > 1
              ? [
                  {
                    points: after,
                    color: "#0c2340",
                    width: 2.4,
                    dash: [1, 9],
                  },
                ]
              : []),
          ]
        : [];
      const spot = ballOnTrail(
        flight.map((point) => ({ t: point[0], f: point[1], l: point[2], z: point[3], cx: point[4], cy: point[5] })),
        playRef.current.time,
      );
      const balls = spot ? [{ cx: spot.cx, cy: spot.cy, z: spot.z, color: "#0c2340" }] : [];
      drawPreRelease3D(pre.ctx, pre.width, pre.height, trails, balls, orbitRef.current);
    }
    if (pre && view === "average") {
      pre.ctx.clearRect(0, 0, pre.width, pre.height);
      const focusPath = playback ? clipFlight(playback) : [];
      const focusSample = focusPath.length ? samplePath(focusPath, playRef.current.time) : null;
      const focusRelease = throughRelease(focusPath).at(-1) ?? null;
      const tracked = focusSample ? (focusSample[0] <= 0 ? { f: focusSample[1], z: focusSample[3] } : focusRelease) : null;
      const formSeries = gatherCurves.flatMap((group) => {
        const points =
          group.points.length >= 2
            ? group.points.map((point) => ({
                t: point.t,
                f: point.f,
                z: point.z,
                l: point.l,
                zLo: point.zLo,
                zHi: point.zHi,
              }))
            : group.shot
              ? clipToRelease(asCurve(group.shot))
              : [];
        if (points.length < 2) return [];
        return [
          {
            points,
            color: group.color,
            width: byType ? 2.6 : 3,
            dash: group.dash,
            band: false,
            tempo: !byType && group.points.length >= 2,
          },
        ];
      });
      const primary = gatherCurves.find((group) => group.points.length >= 2)?.points ?? [];
      const preBall = primary.length ? sampleGather(primary, playRef.current.time) : tracked;
      const xScale = full
        ? flightXScale(
            full.width,
            full.height,
            fullSeries.flatMap((line) => line.points.map((point) => ({ f: point.f, z: point.z }))),
            rimDist,
          )
        : 1;
      const gather = gatherCurves
        .filter((group) => group.points.length >= 2)
        .map((group) => ({ points: group.points, color: group.color }));
      drawArc(pre.ctx, pre.width, pre.height, [], formSeries, preBall, null, preZoom, {
        fit: true,
        tight: true,
        xScale,
        gather,
      });
    }
    if (full) {
      drawArc(full.ctx, full.width, full.height, [], fullSeries, ball, rimDist, fullZoom, {
        ticks: timeTicks(activePath),
      });
    }
    const launch = launchRef.current ? fitCanvas(launchRef.current) : null;
    if (launch && view === "average") drawLaunch(launch.ctx, launch.width, launch.height, stats.angle, leagueMean);
    const spread = spreadRef.current ? fitCanvas(spreadRef.current) : null;
    if (spread && view === "average") drawVariation(spread.ctx, spread.width, spread.height, shotSpread(filtered));
    if (court && view === "individual") {
      const marks = filtered
        .map((shot) => {
          const spot = shotSpot(shot);
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

  function pickCourt(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = courtRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const layout = courtLayout(rect.width, rect.height);
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const [px, py] = invertGraphZoom(
      localX,
      localY,
      rect.width,
      rect.height,
      zoomOn ? zoomAt(localX, localY, rect.width, rect.height) : FIT_ZOOM,
    );
    const [x, y] = screenToCourt(px, py, layout);
    let best: Shot | null = null;
    let bestDist = 1.6;
    for (const shot of filtered) {
      const spot = shotSpot(shot);
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
            One real attempt whose arc and gather stay closest to the median · {formatDate(median.d)} · {median.a}
          </p>
        ) : selected ? (
          <p className="context">
            {formatDate(selected.d)} · Q{selected.p} {selected.c} · {selected.a} · {STYLE_LABEL[selected.s]} · {CONTEST_LABEL[selected.k]} · {RANGE_LABEL[displayRange(selected)]}
            {median && shotId(median) !== shotId(selected) ? " · Dashed line is the median shot." : ""}
          </p>
        ) : null}
        <div className="viz">
          <div className="viz-top">
            {view === "average" ? (
              <GraphFrame
                caption="Pre-release"
                hint="The line is the median path into the shot. The shade is the middle half of these paths, so a thinner shade is a more consistent gather."
                hoverZoom={zoomOn}
                canvasRef={preRef}
                canvasLabel="Pre-release form"
                frameClass="pre-release"
                onPointerMove={(event) => {
                  if (!zoomOn) return;
                  setPreZoom(zoomForCanvas(event));
                }}
                onPointerLeave={() => setPreZoom(FIT_ZOOM)}
              />
            ) : (
              <GraphFrame
                caption="Pre-release"
                hint="Drag to move the view. The dotted line is the ball after release. Reset returns to a side view of the shot."
                canvasRef={preRef}
                canvasLabel="Three-dimensional path on the court. The dotted line is the ball after release. Drag to move the view."
                frameClass="pre-release"
                orbit
                action={
                  <button
                    type="button"
                    className="view-reset"
                    onClick={() => {
                      orbitRef.current = sideOrbit(pathRef.current);
                    }}
                  >
                    Reset
                  </button>
                }
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  orbitDrag.current = {
                    x: event.clientX,
                    y: event.clientY,
                    yaw: orbitRef.current.yaw,
                    pitch: orbitRef.current.pitch,
                  };
                }}
                onPointerMove={(event) => {
                  const drag = orbitDrag.current;
                  if (!drag) return;
                  orbitRef.current = {
                    yaw: drag.yaw - (event.clientX - drag.x) * 0.008,
                    pitch: Math.min(1.35, Math.max(0.02, drag.pitch + (event.clientY - drag.y) * 0.006)),
                  };
                }}
                onPointerUp={() => {
                  orbitDrag.current = null;
                }}
              />
            )}
            {view === "average" ? (
              <GraphFrame
                caption="Launch angle"
                hint="Solid line is this player. Dashed line is the league."
                canvasRef={launchRef}
                canvasLabel="Launch angle versus the league"
                frameClass="launch-angle"
              />
            ) : null}
            {view === "average" ? (
              <GraphFrame
                caption="Consistency"
                hint="The number above the mark is the typical shot. Under the bar, the darker pair is half of the shots and the lighter pair is the outer edges."
                canvasRef={spreadRef}
                canvasLabel="Variation in release, launch, apex, touch, and defender"
                frameClass="consistency"
              />
            ) : null}
            {view === "individual" ? (
              <GraphFrame
                caption="Shot chart"
                hint="Green is a make, red is a miss. Click a spot to open it."
                hoverZoom={zoomOn}
                canvasRef={courtRef}
                canvasLabel="Shot chart"
                onClick={pickCourt}
                onPointerMove={(event) => {
                  if (!zoomOn) return;
                  setCourtZoom(zoomForCanvas(event));
                }}
                onPointerLeave={() => setCourtZoom(FIT_ZOOM)}
              />
            ) : null}
          </div>
          <GraphFrame
            caption="Full shot"
            hint="Ball height versus distance to the rim."
            hoverZoom={zoomOn}
            canvasRef={fullRef}
            canvasLabel="Full shot"
            frameClass="full-shot"
            onPointerMove={(event) => {
              if (!zoomOn) return;
              setFullZoom(zoomForCanvas(event));
            }}
            onPointerLeave={() => setFullZoom(FIT_ZOOM)}
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
                      {shot.a} · {STYLE_LABEL[shot.s]} · {CONTEST_LABEL[shot.k]} · {RANGE_LABEL[displayRange(shot)]}
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
        <caption>Threes or mid-range, and the result filter, apply to every row.</caption>
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
        <small>{selected ? selected.team : allowNone ? "Add a second player" : ""}</small>
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
                <small>{item.team}</small>
              </button>
            ))}
            {shown.length === 0 ? <p className="note">No players match.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const DOC_SECTIONS: { title: string; note?: string; items: { term: string; text: string }[] }[] = [
  {
    title: "Style",
    items: [
      {
        term: "Catch and shoot",
        text: "No dribble. The ball stays within 3.8 feet of the shooter for 0.08 to 2 seconds before release.",
      },
      {
        term: "Pull-up",
        text: "At least one dribble before release. A dribble is the ball dropping to 2.5 feet or lower and rising at least 1.5 feet. The next one counts only after 0.28 seconds.",
      },
      {
        term: "Other",
        text: "No dribble, and the touch is shorter than 0.08 seconds or longer than 2 seconds. A hold without a dribble lands here, and so does a tip or putback the tracking barely caught.",
      },
    ],
  },
  {
    title: "Contest",
    items: [
      { term: "Open", text: "The nearest defender is at least 4 feet away at release." },
      { term: "Contested", text: "The nearest defender is inside 4 feet at release." },
    ],
  },
  {
    title: "Measures",
    note: "On Average, each number is the mean of the shots that match the filters. On Individual, it is that shot.",
    items: [
      { term: "Shots", text: "Attempts that match the filters." },
      { term: "FG%", text: "Makes divided by those attempts." },
      { term: "Release", text: "Height of the ball, in feet, when it leaves the hand." },
      { term: "Launch", text: "Angle of the ball, in degrees, during the first 0.08 seconds after release." },
      { term: "Apex", text: "Highest point of the ball on the flight, in feet." },
      {
        term: "Touch",
        text: "Average seconds the player has the ball in his hands before shooting.",
      },
      { term: "Defender", text: "Distance, in feet, to the nearest opponent at release." },
    ],
  },
  {
    title: "Charts",
    items: [
      {
        term: "Pre-release",
        text: "On Average, the line is the median path into the release. The shade is the middle half of those paths, from the 25th to the 75th percentile, so the line sits inside it. A thinner shade is a more consistent gather. On Individual, a 3D view of that path on the court. The dotted line is the ball after release. Drag to move the camera, and Reset returns to a side view of the shot. Lighter blue is a slower part of the move.",
      },
      {
        term: "Launch angle",
        text: "The solid line is this player's mean launch angle. The dashed line is the league mean for jump shots with the same style, contest, range, and result.",
      },
      {
        term: "Consistency",
        text: "Release, launch, apex, touch, and defender for the shots that match the filters. The number above the mark is the typical shot. Under the bar, the darker pair is where half of the shots land, and the lighter pair is the outer edges. A shorter solid bar is more consistent.",
      },
      { term: "Full shot", text: "Ball height against distance to the rim." },
      { term: "Shot chart", text: "Green is a make, red is a miss. Click a spot to open that shot." },
      {
        term: "Playback",
        text: "Quarter speed. Each dot is 0.04 seconds. On the close-up, lighter blue is slower.",
      },
    ],
  },
  {
    title: "Individual",
    items: [
      {
        term: "Median line",
        text: "A dashed line of the median shot, drawn when the opened shot is a different attempt.",
      },
      { term: "Shot list", text: "The attempts that match the filters, grouped by date." },
    ],
  },
  {
    title: "Controls",
    items: [
      {
        term: "Zoom",
        text: "Turn it on in this menu. The chart under the pointer magnifies. Average and Individual each keep their own switch.",
      },
      {
        term: "Threes Only",
        text: "On by default, under Zoom. Turn it off to see mid-range jumpers instead. The two ranges are never shown together.",
      },
      { term: "Compare", text: "A second player, using the same filters and the same page." },
    ],
  },
];

function DocsOverlay({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="docs-backdrop" onMouseDown={onClose}>
      <div
        className="docs"
        role="dialog"
        aria-modal="true"
        aria-labelledby="docs-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="docs-bar">
          <h2 id="docs-title">Docs</h2>
          <button ref={closeRef} type="button" className="docs-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="docs-sheet">
          <header className="docs-lead">
            <p className="lede">
              How the labels on this page are measured. Paths are the ball, from the 2015–16 SportVU games released before the feed was removed. The charts keep jump shots released at least 8 feet from the rim, with a path that travels toward the basket and comes down. Layups, dunks, tips, and rim attempts stay out.
            </p>
          </header>
          {DOC_SECTIONS.map((section) => (
            <section key={section.title} className="docs-section">
              <h3 className="section">{section.title}</h3>
              {section.note ? <p className="context">{section.note}</p> : null}
              <dl>
                {section.items.map((item) => (
                  <div key={item.term} className="docs-term">
                    <dt>{item.term}</dt>
                    <dd>{item.text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsMenu({
  zoomOn,
  threes,
  docsOpen,
  onZoom,
  onThrees,
  onDocs,
}: {
  zoomOn: boolean;
  threes: boolean;
  docsOpen: boolean;
  onZoom: () => void;
  onThrees: () => void;
  onDocs: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="settings" ref={rootRef}>
      <button
        type="button"
        className="settings-button"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="settings-mark" aria-hidden="true" />
      </button>
      {open ? (
        <div className="settings-menu" role="menu" aria-label="Settings">
          <button type="button" className="settings-item" role="menuitemcheckbox" aria-checked={zoomOn} onClick={onZoom}>
            <span>Zoom</span>
            <span className={zoomOn ? "switch on" : "switch"} aria-hidden="true" />
          </button>
          <button type="button" className="settings-item" role="menuitemcheckbox" aria-checked={threes} onClick={onThrees}>
            <span>Threes Only</span>
            <span className={threes ? "switch on" : "switch"} aria-hidden="true" />
          </button>
          <div className="settings-rule" role="separator" />
          <button
            type="button"
            className="settings-item"
            role="menuitem"
            aria-pressed={docsOpen}
            onClick={() => {
              setOpen(false);
              onDocs();
            }}
          >
            <span>Docs</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

const FIT_ZOOM: GraphZoom = { on: false, panX: 0, panY: 0 };

function zoomAt(x: number, y: number, width: number, height: number): GraphZoom {
  return {
    on: true,
    panX: (x - width / 2) * (1 - ZOOM_SCALE),
    panY: (y - height / 2) * (1 - ZOOM_SCALE),
  };
}

function zoomForCanvas(event: ReactPointerEvent<HTMLCanvasElement>): GraphZoom {
  const rect = event.currentTarget.getBoundingClientRect();
  return zoomAt(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
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

function throughRelease(path: number[][]): { f: number; z: number }[] {
  const points: { f: number; z: number }[] = [];
  for (const point of path) {
    points.push({ f: point[1], z: point[3] });
    if (point[0] >= 0) break;
  }
  return points;
}

function sampleGather(points: GatherSample[], time: number): { f: number; z: number } {
  const last = points[points.length - 1];
  if (time >= last.t) return { f: last.f, z: last.z };
  const first = points[0];
  if (time <= first.t) return { f: first.f, z: first.z };
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point.t < time) continue;
    const previous = points[index - 1];
    const span = point.t - previous.t || 1e-6;
    const mix = (time - previous.t) / span;
    return {
      f: previous.f + (point.f - previous.f) * mix,
      z: previous.z + (point.z - previous.z) * mix,
    };
  }
  return { f: last.f, z: last.z };
}

function clipToRelease(points: CurvePoint[]): CurvePoint[] {
  const kept: CurvePoint[] = [];
  for (const point of points) {
    kept.push(point);
    if (point.t >= 0) break;
  }
  return kept;
}

function toPrePoint(point: number[]): PrePoint {
  return { t: point[0], f: point[1], l: point[2], z: point[3], cx: point[4], cy: point[5] };
}

function releasePoints(path: number[][]): PrePoint[] {
  const points: PrePoint[] = [];
  for (const point of path) {
    points.push(toPrePoint(point));
    if (point[0] >= 0) break;
  }
  return points;
}

function flightPoints(path: number[][]): PrePoint[] {
  const release = releasePoints(path).at(-1);
  if (!release || release.t < 0) return [];
  const after = path.filter((point) => point[0] > release.t).map(toPrePoint);
  return after.length ? [release, ...after] : [];
}

function ballOnTrail(points: PrePoint[], time: number): PrePoint | null {
  if (points.length < 2) return points[0] ?? null;
  const end = points[points.length - 1];
  const start = points[0];
  const t = Math.min(end.t, Math.max(start.t, time));
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (point.t < t) continue;
    const span = point.t - previous.t || 1e-6;
    const mix = (t - previous.t) / span;
    return {
      t,
      f: previous.f + (point.f - previous.f) * mix,
      l: previous.l + (point.l - previous.l) * mix,
      z: previous.z + (point.z - previous.z) * mix,
      cx: previous.cx + (point.cx - previous.cx) * mix,
      cy: previous.cy + (point.cy - previous.cy) * mix,
    };
  }
  return end;
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

function GraphFrame({
  caption,
  hint,
  hoverZoom,
  canvasRef,
  canvasLabel,
  frameClass,
  orbit,
  action,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
}: {
  caption: string;
  hint?: string;
  hoverZoom?: boolean;
  orbit?: boolean;
  action?: React.ReactNode;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvasLabel: string;
  frameClass?: string;
  onClick?: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
}) {
  const graphClass = ["graph", hoverZoom ? "can-zoom" : "", orbit ? "can-orbit" : ""].filter(Boolean).join(" ");
  return (
    <figure className={frameClass ? `graph-frame ${frameClass}` : "graph-frame"}>
      <figcaption>
        <span className="graph-title">
          <span>{caption}</span>
          {action}
        </span>
        {hint ? <span className="graph-hint">{hint}</span> : null}
      </figcaption>
      <div className={graphClass}>
        <canvas
          ref={canvasRef}
          aria-label={canvasLabel}
          onClick={onClick}
          onPointerDown={onPointerDown}
          onPointerEnter={onPointerMove}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
        />
      </div>
    </figure>
  );
}

function shotId(shot: Shot): string {
  return `${shot.g}|${shot.p}|${shot.c}|${shot.d}|${shot.a}|${shot.dist}`;
}

function asCurve(shot: Shot): CurvePoint[] {
  return clipFlight(shot).map((point) => ({
    t: point[0],
    f: point[1],
    l: point[2],
    z: point[3],
    zLo: point[3],
    zHi: point[3],
  }));
}
