"use client";
import { useState, type DragEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Flag,
  Landmark,
  Plus,
  RefreshCw,
  Repeat2,
  Ruler,
  Sparkles,
  TrainFront,
} from "lucide-react";
import {
  addDays,
  clockMinutes,
  clockTime,
  defaultSessionDuration,
  displayTime,
  durationLabel,
  formatDate,
  hoursLabel,
  type Task,
} from "@/lib/model";
import { taskDue } from "@/lib/engine";
import { computeDayTelemetry } from "@/lib/experiences";
import {
  buildBlueprintElevationData,
  buildTransitRouteLines,
  computeOpenDaySlots,
  partitionGalleryWings,
  type TransitStation,
} from "@/lib/wild-planner-extra";
import {
  openBlockEditor,
  snapTaskToDay,
  TASK_DRAG_TYPE,
  WildViewSwitcher,
  type WildPlannerProps,
} from "./wild-planners";

function renderPeriodHeader(
  props: WildPlannerProps,
  extraMeta: string,
  title: string,
) {
  const {
    date,
    today,
    setDate,
    edit,
    onSwitchToCalendarView,
    wildModeLabel,
  } = props;
  return (
    <header className="extra-planner-bar">
      <div className="extra-bar-left">
        <span className="extra-bar-kicker">{extraMeta}</span>
        <h2>{title}</h2>
      </div>
      <div className="extra-bar-center">
        <button
          type="button"
          className="button secondary small"
          aria-label="Previous day"
          onClick={() => setDate(addDays(date, -1))}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          className="button secondary small"
          onClick={() => setDate(today)}
        >
          Today
        </button>
        <button
          type="button"
          className="button secondary small"
          aria-label="Next day"
          onClick={() => setDate(addDays(date, 1))}
        >
          <ChevronRight size={15} />
        </button>
        <button
          type="button"
          className="button primary small"
          onClick={() => edit({ kind: "session", date })}
        >
          <Plus size={14} /> Session
        </button>
      </div>
      <div className="extra-bar-right">
        <WildViewSwitcher
          wildLabel={wildModeLabel}
          onSwitchToCalendarView={onSwitchToCalendarView}
        />
      </div>
    </header>
  );
}

function dropTaskToTime(
  e: DragEvent<HTMLElement>,
  date: string,
  startClock: string,
  props: WildPlannerProps,
) {
  const taskId = e.dataTransfer.getData(TASK_DRAG_TYPE);
  if (!taskId) return;
  e.preventDefault();
  props.scheduleTask(taskId, date, startClock);
  const task = props.state.tasks.find((t) => t.id === taskId);
  if (task) {
    props.onNotify?.(`Scheduled "${task.title}" at ${displayTime(startClock)}`);
  }
}

/* ============================================================================
   11. TRANSIT — Metro Route Diagram Planner (Vignelli / Beck Cartography)
   ============================================================================ */
export function TransitPlanner(props: WildPlannerProps) {
  const {
    state,
    date,
    today,
    nowMinute,
    edit,
    setOutcome,
    scheduleTask,
    unscheduleSession,
    openGoogleEvent,
    events,
    blocks,
    bank,
    setBank,
    queuedTasks,
    aiReady,
    aiBusy,
    prioritiesRefreshing,
    requestPriorities,
    onNotify,
  } = props;

  const telemetry = computeDayTelemetry(state, date);
  const startHour = Math.min(6, Math.floor(clockMinutes(state.settings.workStart) / 60));
  const endHour = Math.max(22, Math.ceil(clockMinutes(state.settings.workEnd) / 60));
  const lines = buildTransitRouteLines(state, blocks, startHour, endHour);
  const openSlots = computeOpenDaySlots(state, date, events, 30);
  const allStations: TransitStation[] = lines.flatMap((line) => line.stations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [boardingTaskId, setBoardingTaskId] = useState<string | null>(null);

  const selectedStation =
    allStations.find((s) => s.block.id === selectedId) ?? allStations[0] ?? null;
  const boardingTask: Task | null =
    queuedTasks.find((q) => q.task.id === boardingTaskId)?.task ??
    queuedTasks[0]?.task ??
    null;

  const totalSpan = Math.max(60, (endHour - startHour) * 60);
  const nowPct =
    date === today
      ? Math.max(0, Math.min(100, ((nowMinute - startHour * 60) / totalSpan) * 100))
      : null;

  const hourMarks = Array.from(
    { length: Math.floor((endHour - startHour) / 2) + 1 },
    (_, i) => startHour + i * 2,
  );

  const svgWidth = 860;
  const lineSpacing = 78;
  const padLeft = 112;
  const padRight = 32;
  const mapWidth = svgWidth - padLeft - padRight;
  const svgHeight = 62 + lines.length * lineSpacing + 22;

  return (
    <div className="wild-shell transit-shell">
      {renderPeriodHeader(
        props,
        `SYSTEM MAP · ${formatDate(date, { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}`,
        `${telemetry.totalBlocks} Active Stops · ${hoursLabel(telemetry.openMinutes)} Open`,
      )}

      <div className="transit-grid">
        <section className="transit-map-panel" aria-label="Metro time route diagram">
          <div className="transit-panel-head">
            <div className="transit-legend">
              {lines.map((line) => (
                <span key={line.key} className="transit-legend-item">
                  <i style={{ backgroundColor: line.hex }} />
                  <strong className="tabular-num">{line.lineCode}</strong>
                  <span>{line.lineName.split("·")[1]?.trim()}</span>
                </span>
              ))}
            </div>
            <span className="transit-map-hint tabular-num">
              Click any station node to inspect · Select an interchange window to board a task
            </span>
          </div>

          <div className="transit-svg-scroll">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="transit-svg"
              role="img"
              aria-label="Daily metro schedule diagram"
            >
              {hourMarks.map((hr) => {
                const pct = ((hr - startHour) * 60) / totalSpan;
                const x = padLeft + pct * mapWidth;
                return (
                  <g key={hr}>
                    <line
                      x1={x}
                      y1={24}
                      x2={x}
                      y2={svgHeight - 16}
                      stroke="#DCD7CB"
                      strokeDasharray="3 4"
                      strokeWidth={1}
                    />
                    <text
                      x={x}
                      y={16}
                      textAnchor="middle"
                      className="transit-svg-hour"
                    >
                      {displayTime(clockTime(hr * 60))}
                    </text>
                  </g>
                );
              })}

              {nowPct !== null && (
                <g>
                  <line
                    x1={padLeft + (nowPct / 100) * mapWidth}
                    y1={24}
                    x2={padLeft + (nowPct / 100) * mapWidth}
                    y2={svgHeight - 16}
                    stroke="#DC2626"
                    strokeWidth={1.5}
                  />
                  <circle
                    cx={padLeft + (nowPct / 100) * mapWidth}
                    cy={24}
                    r={3.5}
                    fill="#DC2626"
                  />
                </g>
              )}

              {lines.map((line, lIdx) => {
                const y = 62 + lIdx * lineSpacing;
                return (
                  <g key={line.key}>
                    <rect
                      x={12}
                      y={y - 11}
                      width={26}
                      height={22}
                      rx={3}
                      fill={line.hex}
                    />
                    <text
                      x={25}
                      y={y + 4}
                      textAnchor="middle"
                      className="transit-svg-badge"
                    >
                      {line.lineCode}
                    </text>
                    <text x={44} y={y + 4} className="transit-svg-linename">
                      {line.lineName.split("·")[1]?.trim()}
                    </text>

                    <line
                      x1={padLeft}
                      y1={y}
                      x2={svgWidth - padRight}
                      y2={y}
                      stroke={line.hex}
                      strokeWidth={5}
                      strokeLinecap="round"
                      strokeOpacity={line.stations.length ? 0.92 : 0.25}
                    />

                    {line.stations.map((station, sIdx) => {
                      const cx = padLeft + (station.xPct / 100) * mapWidth;
                      const segW = Math.max(12, (station.widthPct / 100) * mapWidth);
                      const active = selectedStation?.block.id === station.block.id;
                      const labelAbove = sIdx % 2 === 0;
                      const labelAnchor =
                        cx < padLeft + 50
                          ? "start"
                          : cx > svgWidth - padRight - 50
                            ? "end"
                            : "middle";
                      const labelText =
                        station.block.title.length > 14
                          ? station.block.title.slice(0, 13) + "…"
                          : station.block.title;
                      return (
                        <g
                          key={station.block.id}
                          className="transit-station-node"
                          onClick={() => setSelectedId(station.block.id)}
                          role="button"
                          tabIndex={0}
                          aria-label={`${station.block.title} at ${displayTime(clockTime(station.block.start))}`}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              setSelectedId(station.block.id);
                            }
                          }}
                        >
                          <line
                            x1={cx}
                            y1={y}
                            x2={Math.min(svgWidth - padRight, cx + segW)}
                            y2={y}
                            stroke={line.hex}
                            strokeWidth={9}
                            strokeLinecap="round"
                            strokeOpacity={station.completed ? 0.35 : 0.9}
                          />
                          <circle
                            cx={cx}
                            cy={y}
                            r={14}
                            fill="transparent"
                          />
                          <circle
                            cx={cx}
                            cy={y}
                            r={active ? 8.5 : 6.5}
                            fill={station.completed ? line.hex : "#F7F5EE"}
                            stroke={active ? "#141518" : line.hex}
                            strokeWidth={active ? 3 : 2.5}
                          />
                          <text
                            x={cx}
                            y={labelAbove ? y - 20 : y + 27}
                            textAnchor={labelAnchor}
                            pointerEvents="none"
                            className="transit-svg-station-label"
                          >
                            {labelText}
                          </text>
                          <text
                            x={cx}
                            y={labelAbove ? y + 19 : y - 12}
                            textAnchor={labelAnchor}
                            pointerEvents="none"
                            className="transit-svg-station-time"
                          >
                            {displayTime(clockTime(station.block.start))}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="transit-interchanges">
            <div className="transit-subhead">
              <strong>Open Boarding Windows</strong>
              <span className="tabular-num">
                {boardingTask
                  ? `Next task: "${boardingTask.title}" (${durationLabel(defaultSessionDuration(boardingTask))})`
                  : "All queued tasks scheduled"}
              </span>
            </div>
            {openSlots.length ? (
              <div className="transit-gap-row">
                {openSlots.map((slot) => (
                  <button
                    type="button"
                    key={slot.startClock}
                    className="transit-gap-btn"
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) {
                        e.preventDefault();
                      }
                    }}
                    onDrop={(e) => dropTaskToTime(e, date, slot.startClock, props)}
                    onClick={() => {
                      if (boardingTask) {
                        scheduleTask(boardingTask.id, date, slot.startClock);
                        onNotify?.(
                          `Boarded "${boardingTask.title}" at ${displayTime(slot.startClock)}`,
                        );
                      } else {
                        edit({ kind: "session", date, start: slot.startClock });
                      }
                    }}
                  >
                    <strong className="tabular-num">
                      {displayTime(slot.startClock)} – {displayTime(slot.endClock)}
                    </strong>
                    <span>
                      {durationLabel(slot.duration)} open ·{" "}
                      {boardingTask ? "Board selected" : "Add session"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No open windows ≥ 30m inside today’s operating hours.</p>
            )}
          </div>
        </section>

        <aside className="transit-side-col">
          <section className="transit-card" aria-label="Station inspector">
            <div className="transit-subhead">
              <TrainFront size={15} aria-hidden="true" />
              <strong>Station Inspector</strong>
              {selectedStation && (
                <span className="tabular-num">{selectedStation.stationCode}</span>
              )}
            </div>
            {selectedStation ? (
              <div className="transit-inspector-body">
                <h3>{selectedStation.block.title}</h3>
                <p className="tabular-num">
                  {displayTime(clockTime(selectedStation.block.start))} ·{" "}
                  {durationLabel(selectedStation.block.duration)} ·{" "}
                  {selectedStation.completed ? "Completed" : "Scheduled"}
                </p>
                <div className="transit-btn-row">
                  {selectedStation.block.kind !== "external" && (
                    <button
                      type="button"
                      className="button primary small"
                      onClick={() =>
                        setOutcome(
                          selectedStation.block.kind,
                          selectedStation.block.sourceId,
                          date,
                          selectedStation.completed ? "pending" : "completed",
                        )
                      }
                    >
                      <Check size={13} />
                      {selectedStation.completed ? "Reopen stop" : "Complete stop"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() =>
                      openBlockEditor(
                        selectedStation.block,
                        date,
                        edit,
                        openGoogleEvent,
                      )
                    }
                  >
                    Edit details
                  </button>
                  {selectedStation.block.kind === "session" && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => unscheduleSession(selectedStation.block.id)}
                    >
                      Return to queue
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted">No timed blocks on this day yet. Board a task from the queue below.</p>
            )}
          </section>

          <section className="transit-card" aria-label="Dispatch boarding queue">
            <div className="transit-subhead">
              <strong>Dispatch Queue</strong>
              <div className="bank-tabs" role="group" aria-label="Task queue filter">
                {(
                  [
                    ["recommended", "Suggested"],
                    ["unscheduled", "Open"],
                    ["active", "All"],
                  ] as const
                ).map(([k, lbl]) => (
                  <button
                    type="button"
                    key={k}
                    className={bank === k ? "active" : ""}
                    onClick={() => setBank(k)}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="transit-queue-actions">
              <button
                type="button"
                className="button secondary small"
                disabled={!aiReady || aiBusy}
                onClick={requestPriorities}
              >
                <RefreshCw size={12} className={prioritiesRefreshing ? "spin" : ""} />
                Refresh AI list
              </button>
              <button
                type="button"
                className="button secondary small"
                onClick={() => edit({ kind: "task" })}
              >
                <Plus size={12} /> Task
              </button>
            </div>
            <div className="transit-queue-list">
              {queuedTasks.slice(0, 8).map(({ task }) => {
                const isPicked = boardingTask?.id === task.id;
                const due = taskDue(state, task);
                return (
                  <div
                    key={task.id}
                    className={"transit-queue-row " + (isPicked ? "is-selected" : "")}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
                    }}
                  >
                    <button
                      type="button"
                      className="plain transit-queue-select"
                      onClick={() => setBoardingTaskId(task.id)}
                    >
                      <strong>{task.title}</strong>
                      <small className="tabular-num">
                        {durationLabel(defaultSessionDuration(task))}
                        {due ? ` · Due ${formatDate(due, { month: "short", day: "numeric" })}` : ""}
                      </small>
                    </button>
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() =>
                        snapTaskToDay(
                          task,
                          state,
                          date,
                          today,
                          nowMinute,
                          events,
                          scheduleTask,
                          edit,
                          onNotify,
                        )
                      }
                    >
                      Board
                    </button>
                  </div>
                );
              })}
              {queuedTasks.length === 0 && (
                <p className="muted">All tasks in this filter are handled.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ============================================================================
   12. BLUEPRINT — CAD Drafting Sheet Planner
   ============================================================================ */
export function BlueprintPlanner(props: WildPlannerProps) {
  const {
    state,
    date,
    today,
    nowMinute,
    edit,
    setOutcome,
    scheduleTask,
    unscheduleSession,
    openGoogleEvent,
    events,
    blocks,
    queuedTasks,
    onNotify,
  } = props;

  const telemetry = computeDayTelemetry(state, date);
  const openSlots = computeOpenDaySlots(state, date, events, 30);
  const elevation = buildBlueprintElevationData(state, blocks, openSlots);
  const allBars = elevation.layers.flatMap((l) => l.bars);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeBar =
    allBars.find((b) => b.id === selectedId) ?? allBars[0] ?? null;

  const hours = Array.from(
    { length: elevation.endHour - elevation.startHour + 1 },
    (_, i) => elevation.startHour + i,
  );
  const utilization = telemetry.capacityMinutes
    ? Math.min(100, Math.round((telemetry.scheduledMinutes / telemetry.capacityMinutes) * 100))
    : 0;

  return (
    <div className="wild-shell blueprint-shell">
      {renderPeriodHeader(
        props,
        `DWG NO. ${date} · SCALE 1:${hours.length}H`,
        `${formatDate(date, { weekday: "long", month: "short", day: "numeric" })}`,
      )}

      <div className="blueprint-board">
        <div className="blueprint-elevation-panel">
          <div className="blueprint-ruler tabular-num">
            <span>LAYER</span>
            <div className="blueprint-ruler-hours">
              {hours
                .filter((_, idx) => idx % 2 === 0)
                .map((hr) => (
                  <span key={hr}>{displayTime(clockTime(hr * 60))}</span>
                ))}
            </div>
          </div>

          <div className="blueprint-layers">
            {elevation.layers.map((layer) => (
              <div key={layer.key} className="blueprint-layer-row">
                <div className="blueprint-layer-label">
                  <span className="tabular-num">{layer.layerCode}</span>
                  <strong>{layer.label}</strong>
                </div>
                <div className="blueprint-layer-track">
                  {layer.bars.map((bar) => {
                    const done = bar.block.outcome === "completed";
                    const selected = activeBar?.id === bar.id;
                    return (
                      <button
                        type="button"
                        key={bar.id}
                        className={
                          `blueprint-bar layer-${bar.layer}` +
                          (done ? " is-done" : "") +
                          (selected ? " is-selected" : "")
                        }
                        style={{
                          left: `${bar.xPct}%`,
                          width: `${bar.widthPct}%`,
                        }}
                        onClick={() => setSelectedId(bar.id)}
                        title={`${bar.specCode}: ${bar.block.title} (${durationLabel(bar.block.duration)})`}
                      >
                        <span className="blueprint-bar-code tabular-num">
                          {bar.specCode}
                        </span>
                        <span className="blueprint-bar-title">
                          {bar.block.title}
                        </span>
                      </button>
                    );
                  })}
                  {!layer.bars.length && (
                    <span className="blueprint-empty-axis">NO ALLOCATIONS ON LAYER</span>
                  )}
                </div>
              </div>
            ))}

            <div className="blueprint-layer-row blueprint-gap-layer">
              <div className="blueprint-layer-label">
                <span className="tabular-num">CALIPERS</span>
                <strong>Open Gaps</strong>
              </div>
              <div className="blueprint-layer-track">
                {elevation.gaps.map((gap) => (
                  <button
                    type="button"
                    key={gap.gapCode}
                    className="blueprint-gap-caliper"
                    style={{
                      left: `${gap.xPct}%`,
                      width: `${gap.widthPct}%`,
                    }}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) {
                        e.preventDefault();
                      }
                    }}
                    onDrop={(e) => dropTaskToTime(e, date, gap.slot.startClock, props)}
                    onClick={() =>
                      edit({ kind: "session", date, start: gap.slot.startClock })
                    }
                    title={`Open window ${displayTime(gap.slot.startClock)} (${durationLabel(gap.slot.duration)})`}
                  >
                    <span className="tabular-num">
                      ← {durationLabel(gap.slot.duration)} →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="blueprint-titleblock tabular-num">
            <div>
              <span>BOOKED LOAD</span>
              <strong>
                {hoursLabel(telemetry.scheduledMinutes)} / {hoursLabel(telemetry.capacityMinutes)} ({utilization}%)
              </strong>
            </div>
            <div>
              <span>AVAILABLE CLEARANCE</span>
              <strong>{hoursLabel(telemetry.openMinutes)}</strong>
            </div>
            <div>
              <span>ACTIVE SPECS</span>
              <strong>{telemetry.unscheduledTasks} unscheduled</strong>
            </div>
            <div>
              <span>VERIFIED BLOCKS</span>
              <strong>
                {telemetry.completedBlocks}/{telemetry.totalBlocks}
              </strong>
            </div>
          </div>
        </div>

        <aside className="blueprint-inspector-col">
          <section className="blueprint-spec-box">
            <div className="blueprint-box-head">
              <Ruler size={14} aria-hidden="true" />
              <strong>ELEMENT SPECIFICATION</strong>
              {activeBar && <span className="tabular-num">{activeBar.specCode}</span>}
            </div>
            {activeBar ? (
              <div className="blueprint-spec-body">
                <h3>{activeBar.block.title}</h3>
                <dl className="blueprint-dl tabular-num">
                  <div>
                    <dt>START</dt>
                    <dd>{displayTime(clockTime(activeBar.block.start))}</dd>
                  </div>
                  <div>
                    <dt>SPAN</dt>
                    <dd>{durationLabel(activeBar.block.duration)}</dd>
                  </div>
                  <div>
                    <dt>STATUS</dt>
                    <dd>{activeBar.block.outcome.toUpperCase()}</dd>
                  </div>
                </dl>
                <div className="blueprint-actions">
                  {activeBar.block.kind !== "external" && (
                    <button
                      type="button"
                      className="button primary small"
                      onClick={() =>
                        setOutcome(
                          activeBar.block.kind,
                          activeBar.block.sourceId,
                          date,
                          activeBar.block.outcome === "completed"
                            ? "pending"
                            : "completed",
                        )
                      }
                    >
                      <Check size={13} />
                      {activeBar.block.outcome === "completed"
                        ? "Mark pending"
                        : "Verify done"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() =>
                      openBlockEditor(activeBar.block, date, edit, openGoogleEvent)
                    }
                  >
                    Open editor
                  </button>
                  {activeBar.block.kind === "session" && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => unscheduleSession(activeBar.block.id)}
                    >
                      Remove from sheet
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted">Select a block on the drafting elevation or add a session.</p>
            )}
          </section>

          <section className="blueprint-spec-box">
            <div className="blueprint-box-head">
              <strong>UNPLACED SPECIFICATIONS</strong>
              <button
                type="button"
                className="button secondary small"
                onClick={() => edit({ kind: "task" })}
              >
                <Plus size={12} /> New
              </button>
            </div>
            <div className="blueprint-queue">
              {queuedTasks.slice(0, 7).map(({ task }, i) => (
                <div
                  key={task.id}
                  className="blueprint-queue-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
                  }}
                >
                  <button
                    type="button"
                    className="plain blueprint-queue-title"
                    onClick={() => edit({ kind: "task", id: task.id })}
                  >
                    <span className="tabular-num">S-{i + 1}</span>
                    <strong>{task.title}</strong>
                  </button>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() =>
                      snapTaskToDay(
                        task,
                        state,
                        date,
                        today,
                        nowMinute,
                        events,
                        scheduleTask,
                        edit,
                        onNotify,
                      )
                    }
                  >
                    Draft slot
                  </button>
                </div>
              ))}
              {queuedTasks.length === 0 && (
                <p className="muted">All queued specs are drafted on the sheet.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ============================================================================
   13. NOTEBOOK — Two-Page Dot-Grid Bullet Journal Spread
   ============================================================================ */
export function NotebookPlanner(props: WildPlannerProps) {
  const {
    state,
    date,
    today,
    nowMinute,
    edit,
    setOutcome,
    scheduleTask,
    unscheduleSession,
    openGoogleEvent,
    events,
    blocks,
    queuedTasks,
    onNotify,
  } = props;

  const telemetry = computeDayTelemetry(state, date);
  const openSlots = computeOpenDaySlots(state, date, events, 30);
  const sortedBlocks = [...blocks].sort((a, b) => a.start - b.start);

  return (
    <div className="wild-shell notebook-shell">
      {renderPeriodHeader(
        props,
        `PAGE INDEX · ${formatDate(date, { month: "short", day: "numeric", year: "numeric" })}`,
        `${formatDate(date, { weekday: "long", month: "long", day: "numeric" })}`,
      )}

      <div className="notebook-spread">
        <section className="notebook-page notebook-page-left" aria-label="Rapid Log page">
          <div className="notebook-page-head">
            <div>
              <span className="notebook-kicker">LEFT PAGE · RAPID LOG</span>
              <h3>Daily Entries &amp; Signifiers</h3>
            </div>
            <span className="notebook-key-legend">
              <span>• Task</span>
              <span>× Done</span>
              <span>○ Event</span>
              <span>↻ Habit</span>
            </span>
          </div>

          <div className="notebook-rapid-list">
            {sortedBlocks.length ? (
              sortedBlocks.map((block) => {
                const done = block.outcome === "completed";
                const glyph =
                  block.kind === "external"
                    ? "○"
                    : block.kind === "routine"
                      ? done
                        ? "×"
                        : "↻"
                      : done
                        ? "×"
                        : "•";
                return (
                  <div
                    key={block.id}
                    className={"notebook-line " + (done ? "is-done" : "")}
                  >
                    {block.kind !== "external" ? (
                      <button
                        type="button"
                        className="notebook-signifier"
                        aria-label={`Toggle ${block.title}`}
                        onClick={() =>
                          setOutcome(
                            block.kind,
                            block.sourceId,
                            date,
                            done ? "pending" : "completed",
                          )
                        }
                      >
                        {glyph}
                      </button>
                    ) : (
                      <span className="notebook-signifier is-static" aria-hidden="true">
                        {glyph}
                      </span>
                    )}
                    <button
                      type="button"
                      className="plain notebook-entry-title"
                      onClick={() =>
                        openBlockEditor(block, date, edit, openGoogleEvent)
                      }
                    >
                      <strong className={done ? "strike" : ""}>{block.title}</strong>
                      <small className="tabular-num">
                        {block.allDay
                          ? "All day"
                          : `${displayTime(clockTime(block.start))} (${durationLabel(block.duration)})`}
                      </small>
                    </button>
                    {block.kind === "session" && (
                      <button
                        type="button"
                        className="notebook-migrate-btn"
                        title="Return to unscheduled index"
                        onClick={() => unscheduleSession(block.id)}
                      >
                        ←
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="muted">Blank page. Migrate a task from the collection below.</p>
            )}
          </div>

          <div className="notebook-collection-box">
            <div className="notebook-subhead">
              <strong>Pending Tasks (Migrate → Today)</strong>
              <button
                type="button"
                className="button secondary small"
                onClick={() => edit({ kind: "task" })}
              >
                <Plus size={12} /> Entry
              </button>
            </div>
            {queuedTasks.slice(0, 7).map(({ task }) => (
              <div key={task.id} className="notebook-line">
                <span className="notebook-signifier is-static">•</span>
                <button
                  type="button"
                  className="plain notebook-entry-title"
                  onClick={() => edit({ kind: "task", id: task.id })}
                >
                  <strong>{task.title}</strong>
                  <small className="tabular-num">
                    {durationLabel(defaultSessionDuration(task))}
                  </small>
                </button>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() =>
                    snapTaskToDay(
                      task,
                      state,
                      date,
                      today,
                      nowMinute,
                      events,
                      scheduleTask,
                      edit,
                      onNotify,
                    )
                  }
                >
                  <ArrowRight size={12} /> Ink today
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="notebook-spine" aria-hidden="true" />

        <section className="notebook-page notebook-page-right" aria-label="Time Ledger page">
          <div className="notebook-page-head">
            <div>
              <span className="notebook-kicker">RIGHT PAGE · TIME LEDGER</span>
              <h3>Ink Time Brackets</h3>
            </div>
            <span className="tabular-num notebook-tally">
              {hoursLabel(telemetry.scheduledMinutes)} inked · {hoursLabel(telemetry.openMinutes)} clear
            </span>
          </div>

          <div className="notebook-time-ledger">
            {sortedBlocks
              .filter((b) => !b.allDay)
              .map((block) => (
                <button
                  type="button"
                  key={block.id}
                  className={
                    `notebook-bracket color-${block.color}` +
                    (block.outcome === "completed" ? " is-done" : "")
                  }
                  onClick={() =>
                    openBlockEditor(block, date, edit, openGoogleEvent)
                  }
                >
                  <span className="tabular-num">
                    {displayTime(clockTime(block.start))} –{" "}
                    {displayTime(clockTime(block.start + block.duration))}
                  </span>
                  <strong>{block.title}</strong>
                  <em>{durationLabel(block.duration)}</em>
                </button>
              ))}
          </div>

          <div className="notebook-open-windows">
            <div className="notebook-subhead">
              <BookOpen size={14} aria-hidden="true" />
              <strong>Available Margins</strong>
            </div>
            {openSlots.length ? (
              <div className="notebook-gap-list">
                {openSlots.map((slot) => (
                  <button
                    type="button"
                    key={slot.startClock}
                    className="notebook-gap-chip"
                    onClick={() =>
                      edit({ kind: "session", date, start: slot.startClock })
                    }
                  >
                    <span className="tabular-num">
                      {displayTime(slot.startClock)} – {displayTime(slot.endClock)}
                    </span>
                    <strong>+ Reserve {durationLabel(slot.duration)}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">Full day inked within work hours.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ============================================================================
   14. GALLERY — Curatorial Museum Wing Floorplan & Plinths
   ============================================================================ */
export function GalleryPlanner(props: WildPlannerProps) {
  const {
    state,
    date,
    today,
    nowMinute,
    edit,
    setOutcome,
    scheduleTask,
    unscheduleSession,
    openGoogleEvent,
    events,
    blocks,
    queuedTasks,
    onNotify,
  } = props;

  const telemetry = computeDayTelemetry(state, date);
  const openSlots = computeOpenDaySlots(state, date, events, 30);
  const { allDay, wings } = partitionGalleryWings(blocks, openSlots);
  const timedBlocks = blocks.filter((b) => !b.allDay).sort((a, b) => a.start - b.start);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const featuredBlock =
    timedBlocks.find((b) => b.id === selectedId) ?? timedBlocks[0] ?? null;

  return (
    <div className="wild-shell gallery-shell">
      {renderPeriodHeader(
        props,
        `EXHIBITION SCHEDULE · ${formatDate(date, { month: "long", day: "numeric", year: "numeric" }).toUpperCase()}`,
        `Day Catalogue · ${telemetry.totalBlocks} Exhibits Scheduled`,
      )}

      {allDay.length > 0 && (
        <div className="gallery-notices">
          <span className="gallery-kicker">GENERAL ADMISSION &amp; ALL-DAY NOTICES</span>
          <div className="gallery-notice-row">
            {allDay.map((b) => (
              <button
                type="button"
                key={b.id}
                className="gallery-notice-btn"
                onClick={() => openBlockEditor(b, date, edit, openGoogleEvent)}
              >
                {b.kind === "routine" && <Repeat2 size={12} aria-hidden="true" />}
                <span>{b.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="gallery-floorplan-layout">
        <div className="gallery-wings-grid">
          {wings.map((wing) => (
            <section key={wing.id} className="gallery-wing-room">
              <div className="gallery-wing-head">
                <span className="gallery-roman">{wing.roman}</span>
                <div>
                  <h3>{wing.label}</h3>
                  <small className="tabular-num">{wing.hoursLabel}</small>
                </div>
              </div>

              <div className="gallery-plinth-list">
                {wing.blocks.map((block, idx) => {
                  const done = block.outcome === "completed";
                  const active = featuredBlock?.id === block.id;
                  return (
                    <button
                      type="button"
                      key={block.id}
                      className={
                        "gallery-plinth-card" +
                        (active ? " is-selected" : "") +
                        (done ? " is-done" : "")
                      }
                      onClick={() => setSelectedId(block.id)}
                    >
                      <div className="gallery-plinth-meta tabular-num">
                        <span>FIG. {wing.roman}.{idx + 1}</span>
                        <span>
                          {displayTime(clockTime(block.start))} · {durationLabel(block.duration)}
                        </span>
                      </div>
                      <strong className={done ? "strike" : ""}>{block.title}</strong>
                    </button>
                  );
                })}
                {wing.openSlots.map((slot) => (
                  <button
                    type="button"
                    key={slot.startClock}
                    className="gallery-open-plinth"
                    onClick={() =>
                      edit({ kind: "session", date, start: slot.startClock })
                    }
                  >
                    <span className="tabular-num">
                      Open Plinth · {displayTime(slot.startClock)}
                    </span>
                    <small>{durationLabel(slot.duration)} available</small>
                  </button>
                ))}
                {wing.blocks.length === 0 && wing.openSlots.length === 0 && (
                  <p className="muted">No works placed in this wing.</p>
                )}
              </div>
            </section>
          ))}
        </div>

        <aside className="gallery-curatorial-rail">
          <section className="gallery-plaque" aria-label="Curatorial wall plaque">
            <div className="gallery-plaque-head">
              <Landmark size={15} aria-hidden="true" />
              <span>CURATORIAL WALL PLAQUE</span>
            </div>
            {featuredBlock ? (
              <div className="gallery-plaque-body">
                <h3>{featuredBlock.title}</h3>
                <dl className="gallery-accession-dl tabular-num">
                  <div>
                    <dt>Time</dt>
                    <dd>{displayTime(clockTime(featuredBlock.start))}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{durationLabel(featuredBlock.duration)}</dd>
                  </div>
                  <div>
                    <dt>Medium</dt>
                    <dd>{featuredBlock.kind}</dd>
                  </div>
                </dl>
                <div className="gallery-plaque-actions">
                  {featuredBlock.kind !== "external" && (
                    <button
                      type="button"
                      className="button primary small"
                      onClick={() =>
                        setOutcome(
                          featuredBlock.kind,
                          featuredBlock.sourceId,
                          date,
                          featuredBlock.outcome === "completed"
                            ? "pending"
                            : "completed",
                        )
                      }
                    >
                      <Check size={13} />
                      {featuredBlock.outcome === "completed"
                        ? "Mark active"
                        : "Mark complete"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() =>
                      openBlockEditor(featuredBlock, date, edit, openGoogleEvent)
                    }
                  >
                    Edit record
                  </button>
                  {featuredBlock.kind === "session" && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => unscheduleSession(featuredBlock.id)}
                    >
                      Return to vault
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted">Select an exhibit or place one from the archive vault below.</p>
            )}
          </section>

          <section className="gallery-plaque">
            <div className="gallery-plaque-head">
              <Compass size={15} aria-hidden="true" />
              <span>ARCHIVE VAULT</span>
              <button
                type="button"
                className="button secondary small"
                onClick={() => edit({ kind: "task" })}
              >
                <Plus size={12} /> Acquire
              </button>
            </div>
            <div className="gallery-vault-list">
              {queuedTasks.slice(0, 6).map(({ task }, idx) => (
                <div key={task.id} className="gallery-vault-row">
                  <button
                    type="button"
                    className="plain gallery-vault-title"
                    onClick={() => edit({ kind: "task", id: task.id })}
                  >
                    <span className="tabular-num">CAT.{String(idx + 1).padStart(2, "0")}</span>
                    <strong>{task.title}</strong>
                  </button>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() =>
                      snapTaskToDay(
                        task,
                        state,
                        date,
                        today,
                        nowMinute,
                        events,
                        scheduleTask,
                        edit,
                        onNotify,
                      )
                    }
                  >
                    Exhibit
                  </button>
                </div>
              ))}
              {queuedTasks.length === 0 && (
                <p className="muted">No unscheduled works in the vault.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
