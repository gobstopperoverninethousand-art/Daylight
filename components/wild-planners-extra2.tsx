"use client";
import { useState, type DragEvent } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Crown,
  Flame,
  Plus,
  Radio,
  RefreshCw,
  Scissors,
  Sliders,
  Sparkles,
} from "lucide-react";
import {
  addDays,
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
import { computeOpenDaySlots } from "@/lib/wild-planner-extra";
import {
  buildArenaBoardSquares,
  buildConstellationDiagram,
  buildSynthRackData,
  buildZineSpreadData,
} from "@/lib/wild-planner-extra2";
import {
  openBlockEditor,
  snapTaskToDay,
  TASK_DRAG_TYPE,
  WildViewSwitcher,
  type WildPlannerProps,
} from "./wild-planners";

function renderExtraHeader2(
  props: WildPlannerProps,
  kicker: string,
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
    <header className="extra2-planner-bar">
      <div className="extra2-bar-left">
        <span className="extra2-kicker">{kicker}</span>
        <h2>{title}</h2>
      </div>
      <div className="extra2-bar-center">
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
      <div className="extra2-bar-right">
        <WildViewSwitcher
          wildLabel={wildModeLabel}
          onSwitchToCalendarView={onSwitchToCalendarView}
        />
      </div>
    </header>
  );
}

function handleQueueDrop(
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
   15. ORBITAL CONSTELLATION (Astronomical Polar Star Map)
   ============================================================================ */
const TRACK_COLOR: Record<string, string> = {
  tasks: "#F6C453",
  projects: "#38BDF8",
  routines: "#34D399",
  calendar: "#A78BFA",
};

export function ConstellationPlanner(props: WildPlannerProps) {
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
  const openSlots = computeOpenDaySlots(state, date, events, 30);
  const diagram = buildConstellationDiagram(state, blocks, openSlots, 6, 22);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [launchTaskId, setLaunchTaskId] = useState<string | null>(null);

  const selectedStar =
    diagram.stars.find((s) => s.block.id === selectedId) ??
    diagram.stars[0] ??
    null;
  const launchTask: Task | null =
    queuedTasks.find((q) => q.task.id === launchTaskId)?.task ??
    queuedTasks[0]?.task ??
    null;

  const constellationPolyline = diagram.stars.map((s) => `${s.x},${s.y}`).join(" ");

  const labelYById = new Map<string, number>();
  for (const side of ["right", "left"] as const) {
    const group = diagram.stars
      .filter((s) => (side === "right" ? s.x >= diagram.center : s.x < diagram.center))
      .sort((a, b) => a.y - b.y);
    let lastY = -999;
    for (const s of group) {
      let y = Math.max(24, Math.min(478, s.y));
      if (y - lastY < 15) {
        y = lastY + 15;
      }
      labelYById.set(s.block.id, y);
      lastY = y;
    }
  }

  return (
    <div className="wild-shell cosmos-shell">
      {renderExtraHeader2(
        props,
        `EPHEMERIS · ${formatDate(date, { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}`,
        `${telemetry.totalBlocks} Celestial Nodes · ${hoursLabel(telemetry.openMinutes)} Clear Sky`,
      )}

      <div className="cosmos-layout">
        <section className="cosmos-chart-panel" aria-label="Polar orbital schedule chart">
          <div className="cosmos-chart-head">
            <div className="cosmos-legend">
              <span><i style={{ backgroundColor: "#F6C453" }} /> Tasks</span>
              <span><i style={{ backgroundColor: "#38BDF8" }} /> Projects</span>
              <span><i style={{ backgroundColor: "#34D399" }} /> Routines</span>
              <span><i style={{ backgroundColor: "#A78BFA" }} /> Calendar</span>
            </div>
            <span className="tabular-num cosmos-caption">
              Inner: Morning · Mid: Afternoon · Outer: Evening
            </span>
          </div>

          <div className="cosmos-svg-wrap">
            <svg
              viewBox="0 0 500 500"
              className="cosmos-svg"
              role="img"
              aria-label="Polar star map of today's schedule"
            >
              {/* Crosshair astrolabe axes */}
              <line x1="250" y1="24" x2="250" y2="476" stroke="rgba(148,163,184,0.16)" strokeDasharray="3 4" />
              <line x1="24" y1="250" x2="476" y2="250" stroke="rgba(148,163,184,0.16)" strokeDasharray="3 4" />

              {diagram.rings.map((ring) => (
                <g key={ring.orbit}>
                  <circle
                    cx={diagram.center}
                    cy={diagram.center}
                    r={ring.radius}
                    fill="none"
                    stroke="rgba(148,163,184,0.24)"
                    strokeWidth={1}
                  />
                  <text
                    x={diagram.center - 6}
                    y={diagram.center - ring.radius + 13}
                    textAnchor="end"
                    className="cosmos-ring-label"
                    pointerEvents="none"
                  >
                    {ring.label}
                  </text>
                </g>
              ))}

              {/* Constellation filament linking scheduled blocks */}
              {diagram.stars.length > 1 && (
                <polyline
                  points={constellationPolyline}
                  fill="none"
                  stroke="rgba(246,196,83,0.45)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              )}

              {/* Open orbital docking slots */}
              {diagram.docks.map((dock) => (
                <g
                  key={dock.slot.startClock}
                  className="cosmos-dock-node"
                  role="button"
                  tabIndex={0}
                  aria-label={`Dock task at ${displayTime(dock.slot.startClock)}`}
                  onClick={() => {
                    if (launchTask) {
                      scheduleTask(launchTask.id, date, dock.slot.startClock);
                      onNotify?.(
                        `Scheduled "${launchTask.title}" at ${displayTime(dock.slot.startClock)}`,
                      );
                    } else {
                      edit({ kind: "session", date, start: dock.slot.startClock });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (launchTask) {
                        scheduleTask(launchTask.id, date, dock.slot.startClock);
                      } else {
                        edit({ kind: "session", date, start: dock.slot.startClock });
                      }
                    }
                  }}
                >
                  <circle cx={dock.x} cy={dock.y} r={14} fill="transparent" />
                  <circle
                    cx={dock.x}
                    cy={dock.y}
                    r={5.5}
                    fill="rgba(56,189,248,0.12)"
                    stroke="#38BDF8"
                    strokeDasharray="2 2"
                    strokeWidth={1.3}
                  />
                </g>
              ))}

              {/* Scheduled stars */}
              {diagram.stars.map((star) => {
                const active = selectedStar?.block.id === star.block.id;
                const hex = TRACK_COLOR[star.track] ?? "#F6C453";
                const rightSide = star.x >= diagram.center;
                const anchor = rightSide ? "start" : "end";
                const labelY = labelYById.get(star.block.id) ?? star.y;
                const labelX = rightSide
                  ? star.x + star.radius + 10
                  : star.x - star.radius - 10;
                const shortTitle =
                  star.block.title.length > 14
                    ? star.block.title.slice(0, 13) + "…"
                    : star.block.title;
                return (
                  <g
                    key={star.block.id}
                    className="cosmos-star-node"
                    role="button"
                    tabIndex={0}
                    aria-label={`${star.block.title} at ${displayTime(clockTime(star.block.start))}`}
                    onClick={() => setSelectedId(star.block.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(star.block.id);
                      }
                    }}
                  >
                    <circle cx={star.x} cy={star.y} r={15} fill="transparent" />
                    {Math.abs(labelY - star.y) > 4 && (
                      <line
                        x1={star.x}
                        y1={star.y}
                        x2={rightSide ? labelX - 3 : labelX + 3}
                        y2={labelY}
                        stroke="rgba(148,163,184,0.35)"
                        strokeWidth={0.9}
                        pointerEvents="none"
                      />
                    )}
                    {active && (
                      <circle
                        cx={star.x}
                        cy={star.y}
                        r={star.radius + 5}
                        fill="none"
                        stroke="#F8FAFC"
                        strokeWidth={1.4}
                      />
                    )}
                    <circle
                      cx={star.x}
                      cy={star.y}
                      r={star.radius}
                      fill={star.completed ? hex : "#0B1120"}
                      stroke={hex}
                      strokeWidth={2.2}
                    />
                    <text
                      x={labelX}
                      y={labelY + 3}
                      textAnchor={anchor}
                      pointerEvents="none"
                      className="cosmos-star-label"
                    >
                      {shortTitle}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="cosmos-open-strip">
            <div className="cosmos-subhead">
              <strong>Open Orbital Windows</strong>
              <span>
                {launchTask
                  ? `Next in queue: "${launchTask.title}" (${durationLabel(defaultSessionDuration(launchTask))})`
                  : "Queue empty"}
              </span>
            </div>
            {openSlots.length ? (
              <div className="cosmos-dock-row">
                {openSlots.map((slot) => (
                  <button
                    type="button"
                    key={slot.startClock}
                    className="cosmos-dock-btn"
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) e.preventDefault();
                    }}
                    onDrop={(e) => handleQueueDrop(e, date, slot.startClock, props)}
                    onClick={() => {
                      if (launchTask) {
                        scheduleTask(launchTask.id, date, slot.startClock);
                        onNotify?.(`Scheduled "${launchTask.title}" at ${displayTime(slot.startClock)}`);
                      } else {
                        edit({ kind: "session", date, start: slot.startClock });
                      }
                    }}
                  >
                    <strong className="tabular-num">
                      {displayTime(slot.startClock)} – {displayTime(slot.endClock)}
                    </strong>
                    <small>
                      {durationLabel(slot.duration)} · {launchTask ? "Schedule selected" : "Add session"}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No open windows ≥ 30m within working hours.</p>
            )}
          </div>
        </section>

        <aside className="cosmos-side-col">
          <section className="cosmos-panel" aria-label="Star inspector">
            <div className="cosmos-subhead">
              <Compass size={15} aria-hidden="true" />
              <strong>Node Inspector</strong>
              {selectedStar && <span className="tabular-num">{selectedStar.starCode}</span>}
            </div>
            {selectedStar ? (
              <div className="cosmos-inspector-body">
                <h3>{selectedStar.block.title}</h3>
                <p className="tabular-num">
                  {displayTime(clockTime(selectedStar.block.start))} ·{" "}
                  {durationLabel(selectedStar.block.duration)} ·{" "}
                  {selectedStar.completed ? "Completed" : "Scheduled"}
                </p>
                <div className="cosmos-btn-row">
                  {selectedStar.block.kind !== "external" && (
                    <button
                      type="button"
                      className="button primary small"
                      onClick={() =>
                        setOutcome(
                          selectedStar.block.kind,
                          selectedStar.block.sourceId,
                          date,
                          selectedStar.completed ? "pending" : "completed",
                        )
                      }
                    >
                      <Check size={13} />
                      {selectedStar.completed ? "Reopen" : "Complete"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() =>
                      openBlockEditor(selectedStar.block, date, edit, openGoogleEvent)
                    }
                  >
                    Edit details
                  </button>
                  {selectedStar.block.kind === "session" && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => unscheduleSession(selectedStar.block.id)}
                    >
                      Return to queue
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted">No timed blocks today. Schedule a task from the bay below.</p>
            )}
          </section>

          <section className="cosmos-panel" aria-label="Unlaunched task queue">
            <div className="cosmos-subhead">
              <strong>Task Launch Bay</strong>
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
            <div className="cosmos-btn-row">
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
                <Plus size={12} /> New task
              </button>
            </div>
            <div className="cosmos-queue-list">
              {queuedTasks.slice(0, 7).map(({ task }) => {
                const active = launchTask?.id === task.id;
                const due = taskDue(state, task);
                return (
                  <div
                    key={task.id}
                    className={"cosmos-queue-row " + (active ? "is-selected" : "")}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
                    }}
                  >
                    <button
                      type="button"
                      className="plain cosmos-queue-select"
                      onClick={() => setLaunchTaskId(task.id)}
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
                      Schedule
                    </button>
                  </div>
                );
              })}
              {queuedTasks.length === 0 && (
                <p className="muted">All tasks in this filter are scheduled.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ============================================================================
   16. MODULAR PATCH RACK (16-Hour Eurorack Step Sequencer)
   ============================================================================ */
export function SynthPlanner(props: WildPlannerProps) {
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
  const rack = buildSynthRackData(state, blocks, openSlots, 6, 21);
  const timedBlocks = [...blocks]
    .filter((b) => !b.allDay)
    .sort((a, b) => a.start - b.start);

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const activeBlock =
    timedBlocks.find((b) => b.id === selectedBlockId) ?? timedBlocks[0] ?? null;
  const activeTask =
    queuedTasks.find((q) => q.task.id === selectedTaskId)?.task ??
    queuedTasks[0]?.task ??
    null;

  return (
    <div className="wild-shell synth-shell">
      {renderExtraHeader2(
        props,
        `SEQUENCER RACK · ${formatDate(date, { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}`,
        `${telemetry.totalBlocks} Patched Steps · ${hoursLabel(telemetry.scheduledMinutes)} / ${hoursLabel(telemetry.capacityMinutes)}`,
      )}

      <div className="synth-layout">
        <section className="synth-rack-panel" aria-label="16-hour modular sequencer">
          <div className="synth-rack-rail">
            <Sliders size={14} aria-hidden="true" />
            <strong>16-Hour Step Matrix (06:00 – 21:00)</strong>
            <span className="tabular-num">
              {rack.cables.length} signal links · Click any step to inspect
            </span>
          </div>

          <div className="synth-step-grid">
            {rack.steps.map((step, sIdx) => {
              const primary = step.activeBlocks[0];
              const isSelected = primary && activeBlock?.id === primary.block.id;
              const isDone = primary?.block.outcome === "completed";
              return (
                <div
                  key={step.hour}
                  className={
                    "synth-step-cell" +
                    (primary ? ` has-patch track-${primary.track}` : " is-empty") +
                    (isSelected ? " is-selected" : "") +
                    (isDone ? " is-done" : "")
                  }
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) e.preventDefault();
                  }}
                  onDrop={(e) => handleQueueDrop(e, date, step.clock, props)}
                >
                  <div className="synth-step-top tabular-num">
                    <span>S{String(sIdx + 1).padStart(2, "0")}</span>
                    <span>{displayTime(step.clock)}</span>
                  </div>
                  {primary ? (
                    <button
                      type="button"
                      className="plain synth-module-btn"
                      onClick={() => setSelectedBlockId(primary.block.id)}
                    >
                      <span className="synth-jack-dot" aria-hidden="true" />
                      <strong>{primary.block.title}</strong>
                      <small className="tabular-num">
                        {durationLabel(primary.block.duration)}
                        {step.activeBlocks.length > 1
                          ? ` +${step.activeBlocks.length - 1}`
                          : ""}
                      </small>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="plain synth-open-step-btn"
                      onClick={() => {
                        if (activeTask) {
                          scheduleTask(activeTask.id, date, step.clock);
                          onNotify?.(
                            `Patched "${activeTask.title}" at ${displayTime(step.clock)}`,
                          );
                        } else {
                          edit({ kind: "session", date, start: step.clock });
                        }
                      }}
                    >
                      <span className="synth-jack-open" aria-hidden="true" />
                      <span>{activeTask ? "Patch task" : "Open step"}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="synth-jack-bay">
            <div className="synth-subhead">
              <strong>Open Patch Windows (≥ 30m)</strong>
              <span className="tabular-num">{rack.jacks.length} open intervals</span>
            </div>
            {rack.jacks.length ? (
              <div className="synth-jack-row">
                {rack.jacks.map(({ slot, jackCode }) => (
                  <button
                    type="button"
                    key={jackCode}
                    className="synth-cv-jack"
                    onClick={() => {
                      if (activeTask) {
                        scheduleTask(activeTask.id, date, slot.startClock);
                        onNotify?.(
                          `Patched "${activeTask.title}" at ${displayTime(slot.startClock)}`,
                        );
                      } else {
                        edit({ kind: "session", date, start: slot.startClock });
                      }
                    }}
                  >
                    <strong className="tabular-num">
                      {jackCode} · {displayTime(slot.startClock)}
                    </strong>
                    <span>{durationLabel(slot.duration)} clear</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">All steps inside work hours are patched.</p>
            )}
          </div>
        </section>

        <aside className="synth-side-col">
          <section className="synth-module-box" aria-label="Active module inspector">
            <div className="synth-subhead">
              <Radio size={14} aria-hidden="true" />
              <strong>Module Inspector</strong>
            </div>
            {activeBlock ? (
              <div className="synth-inspector-body">
                <h3>{activeBlock.title}</h3>
                <p className="tabular-num">
                  {displayTime(clockTime(activeBlock.start))} ·{" "}
                  {durationLabel(activeBlock.duration)} ·{" "}
                  {activeBlock.outcome === "completed" ? "Completed" : "Scheduled"}
                </p>
                <div className="synth-btn-row">
                  {activeBlock.kind !== "external" && (
                    <button
                      type="button"
                      className="button primary small"
                      onClick={() =>
                        setOutcome(
                          activeBlock.kind,
                          activeBlock.sourceId,
                          date,
                          activeBlock.outcome === "completed" ? "pending" : "completed",
                        )
                      }
                    >
                      <Check size={13} />
                      {activeBlock.outcome === "completed" ? "Reopen" : "Complete"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() =>
                      openBlockEditor(activeBlock, date, edit, openGoogleEvent)
                    }
                  >
                    Edit details
                  </button>
                  {activeBlock.kind === "session" && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => unscheduleSession(activeBlock.id)}
                    >
                      Unpatch
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted">Select any step in the rack or add a session.</p>
            )}
          </section>

          <section className="synth-module-box" aria-label="Unpatched oscillator queue">
            <div className="synth-subhead">
              <strong>Oscillator Queue</strong>
              <button
                type="button"
                className="button secondary small"
                onClick={() => edit({ kind: "task" })}
              >
                <Plus size={12} /> Task
              </button>
            </div>
            <div className="synth-queue-list">
              {queuedTasks.slice(0, 7).map(({ task }) => {
                const picked = activeTask?.id === task.id;
                return (
                  <div
                    key={task.id}
                    className={"synth-queue-row " + (picked ? "is-selected" : "")}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
                    }}
                  >
                    <button
                      type="button"
                      className="plain synth-queue-btn"
                      onClick={() => setSelectedTaskId(task.id)}
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
                      Schedule
                    </button>
                  </div>
                );
              })}
              {queuedTasks.length === 0 && (
                <p className="muted">No unpatched tasks remaining.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ============================================================================
   17. RISOGRAPH ZINE (Two-Ink Collage Tear Sheet)
   ============================================================================ */
export function ZinePlanner(props: WildPlannerProps) {
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
  const spread = buildZineSpreadData(state, blocks, queuedTasks);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const focused =
    spread.clippings.find((c) => c.block.id === selectedId) ?? spread.leadClipping;

  return (
    <div className="wild-shell zine-shell">
      {renderExtraHeader2(
        props,
        `RISO ISSUE · ${formatDate(date, { month: "short", day: "numeric", year: "numeric" }).toUpperCase()}`,
        `${formatDate(date, { weekday: "long" })} Spread · ${spread.clippings.length} Clippings`,
      )}

      <div className="zine-spread-grid">
        <section className="zine-cover-panel" aria-label="Featured cover story block">
          <div className="zine-issue-stamp tabular-num">
            <span>COVER STORY</span>
            <span>
              {spread.completedCount}/{spread.clippings.length} STAMPED
            </span>
          </div>
          {focused ? (
            <div className="zine-cover-body">
              <h3>{focused.block.title}</h3>
              <p className="tabular-num">
                {displayTime(clockTime(focused.block.start))} ·{" "}
                {durationLabel(focused.block.duration)} ·{" "}
                {focused.completed ? "Stamped Done" : "In Press"}
              </p>
              <div className="zine-actions">
                {focused.block.kind !== "external" && (
                  <button
                    type="button"
                    className="button primary small"
                    onClick={() =>
                      setOutcome(
                        focused.block.kind,
                        focused.block.sourceId,
                        date,
                        focused.completed ? "pending" : "completed",
                      )
                    }
                  >
                    <Check size={13} />
                    {focused.completed ? "Reopen" : "Complete"}
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() =>
                    openBlockEditor(focused.block, date, edit, openGoogleEvent)
                  }
                >
                  Edit details
                </button>
                {focused.block.kind === "session" && (
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => unscheduleSession(focused.block.id)}
                  >
                    Return to queue
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="muted">No clippings on today’s spread yet. Add a session or stamp a cutout.</p>
          )}

          <div className="zine-open-box">
            <div className="zine-subhead">
              <Scissors size={14} aria-hidden="true" />
              <strong>Open Margins</strong>
            </div>
            {openSlots.length ? (
              <div className="zine-margin-list">
                {openSlots.map((slot) => (
                  <button
                    type="button"
                    key={slot.startClock}
                    className="zine-margin-chip"
                    onClick={() =>
                      edit({ kind: "session", date, start: slot.startClock })
                    }
                  >
                    <strong className="tabular-num">{displayTime(slot.startClock)}</strong>
                    <span>{durationLabel(slot.duration)} free</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">Full spread inked ({hoursLabel(telemetry.scheduledMinutes)}).</p>
            )}
          </div>
        </section>

        <section className="zine-clippings-panel" aria-label="Chronological schedule clippings">
          <div className="zine-subhead">
            <strong>Issue Clippings</strong>
            <span className="tabular-num">{hoursLabel(telemetry.openMinutes)} open</span>
          </div>
          {spread.clippings.length ? (
            <div className="zine-collage-grid">
              {spread.clippings.map((clip) => {
                const isSelected = focused?.block.id === clip.block.id;
                return (
                  <article
                    key={clip.block.id}
                    className={
                      `zine-clipping-card track-${clip.track}` +
                      (clip.completed ? " is-done" : "") +
                      (isSelected ? " is-selected" : "")
                    }
                    style={{ transform: `rotate(${clip.tiltDeg}deg)` }}
                  >
                    <div className="zine-clip-meta tabular-num">
                      <span>{clip.issueNumber}</span>
                      <span>
                        {displayTime(clockTime(clip.block.start))} · {durationLabel(clip.block.duration)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="plain zine-clip-title"
                      onClick={() => setSelectedId(clip.block.id)}
                    >
                      <strong className={clip.completed ? "strike" : ""}>
                        {clip.block.title}
                      </strong>
                    </button>
                    <div className="zine-clip-foot">
                      {clip.block.kind !== "external" && (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() =>
                            setOutcome(
                              clip.block.kind,
                              clip.block.sourceId,
                              date,
                              clip.completed ? "pending" : "completed",
                            )
                          }
                        >
                          {clip.completed ? "Reopen" : "Complete"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() =>
                          openBlockEditor(clip.block, date, edit, openGoogleEvent)
                        }
                      >
                        Edit
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="muted">No clippings scheduled for this date yet.</p>
          )}
        </section>

        <aside className="zine-cutouts-panel" aria-label="Unscheduled task cutouts">
          <div className="zine-subhead">
            <strong>Cutout Queue</strong>
            <button
              type="button"
              className="button secondary small"
              onClick={() => edit({ kind: "task" })}
            >
              <Plus size={12} /> Task
            </button>
          </div>
          <div className="zine-cutout-list">
            {spread.cutouts.slice(0, 7).map((task) => (
              <div key={task.id} className="zine-cutout-row">
                <button
                  type="button"
                  className="plain zine-cutout-title"
                  onClick={() => edit({ kind: "task", id: task.id })}
                >
                  <strong>{task.title}</strong>
                  <small className="tabular-num">
                    {durationLabel(defaultSessionDuration(task))}
                  </small>
                </button>
                <button
                  type="button"
                  className="button primary small"
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
                  Schedule
                </button>
              </div>
            ))}
            {spread.cutouts.length === 0 && (
              <p className="muted">All active tasks are placed.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ============================================================================
   18. TACTICAL BOARD ARENA (4x4 Algebraic Coordinate Board A1-D4)
   ============================================================================ */
export function ArenaPlanner(props: WildPlannerProps) {
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
  const squares = buildArenaBoardSquares(state, blocks, 6);
  const timedBlocks = [...blocks]
    .filter((b) => !b.allDay)
    .sort((a, b) => a.start - b.start);

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [reserveTaskId, setReserveTaskId] = useState<string | null>(null);

  const selectedBlock =
    timedBlocks.find((b) => b.id === selectedBlockId) ?? timedBlocks[0] ?? null;
  const reserveTask =
    queuedTasks.find((q) => q.task.id === reserveTaskId)?.task ??
    queuedTasks[0]?.task ??
    null;

  return (
    <div className="wild-shell arena-shell">
      {renderExtraHeader2(
        props,
        `TOURNAMENT BOARD · ${formatDate(date, { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}`,
        `${telemetry.completedBlocks}/${telemetry.totalBlocks} Completed · ${hoursLabel(telemetry.openMinutes)} Open`,
      )}

      <div className="arena-layout">
        <section className="arena-board-frame" aria-label="4 by 4 hourly time board">
          <div className="arena-board-head">
            <span>Coordinates A1 (6am) – D4 (9pm)</span>
            <span className="tabular-num">
              {reserveTask
                ? `Selected piece: "${reserveTask.title}" · Click an open square to place`
                : "Select any tile to inspect or modify"}
            </span>
          </div>

          <div className="arena-grid">
            {squares.map((sq) => {
              const occupied = !!sq.primaryBlock;
              const isSelected =
                occupied && selectedBlock?.id === sq.primaryBlock?.id;
              const isDone = sq.primaryBlock?.outcome === "completed";
              return (
                <button
                  type="button"
                  key={sq.coord}
                  className={
                    "arena-square " +
                    (sq.isDarkSquare ? "is-dark " : "is-light ") +
                    (occupied ? `has-piece track-${sq.primaryTrack} ` : "is-open ") +
                    (isSelected ? "is-selected " : "") +
                    (isDone ? "is-done " : "")
                  }
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) e.preventDefault();
                  }}
                  onDrop={(e) => handleQueueDrop(e, date, sq.startClock, props)}
                  onClick={() => {
                    if (sq.primaryBlock) {
                      setSelectedBlockId(sq.primaryBlock.id);
                    } else if (reserveTask) {
                      scheduleTask(reserveTask.id, date, sq.startClock);
                      onNotify?.(
                        `Placed "${reserveTask.title}" on ${sq.coord} (${displayTime(sq.startClock)})`,
                      );
                    } else {
                      edit({ kind: "session", date, start: sq.startClock });
                    }
                  }}
                >
                  <div className="arena-square-top tabular-num">
                    <span>{sq.coord}</span>
                    <span>{displayTime(sq.startClock)}</span>
                  </div>
                  {sq.primaryBlock ? (
                    <div className="arena-piece">
                      <strong className={isDone ? "strike" : ""}>
                        {sq.primaryBlock.title}
                      </strong>
                      <small className="tabular-num">
                        {durationLabel(sq.primaryBlock.duration)}
                        {sq.additionalCount > 0 ? ` +${sq.additionalCount}` : ""}
                      </small>
                    </div>
                  ) : (
                    <div className="arena-open-hint">
                      <span>{reserveTask ? "Place here" : "Add session"}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="arena-side-col">
          <section className="arena-panel" aria-label="Selected piece inspector">
            <div className="arena-subhead">
              <Crown size={15} aria-hidden="true" />
              <strong>Selected Piece</strong>
            </div>
            {selectedBlock ? (
              <div className="arena-inspector-body">
                <h3>{selectedBlock.title}</h3>
                <p className="tabular-num">
                  {displayTime(clockTime(selectedBlock.start))} ·{" "}
                  {durationLabel(selectedBlock.duration)} ·{" "}
                  {selectedBlock.outcome === "completed" ? "Completed" : "Active"}
                </p>
                <div className="arena-btn-row">
                  {selectedBlock.kind !== "external" && (
                    <button
                      type="button"
                      className="button primary small"
                      onClick={() =>
                        setOutcome(
                          selectedBlock.kind,
                          selectedBlock.sourceId,
                          date,
                          selectedBlock.outcome === "completed" ? "pending" : "completed",
                        )
                      }
                    >
                      <Check size={13} />
                      {selectedBlock.outcome === "completed" ? "Reopen" : "Complete"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() =>
                      openBlockEditor(selectedBlock, date, edit, openGoogleEvent)
                    }
                  >
                    Edit details
                  </button>
                  {selectedBlock.kind === "session" && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => unscheduleSession(selectedBlock.id)}
                    >
                      Return to reserve
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted">No timed blocks placed on today’s board.</p>
            )}
          </section>

          <section className="arena-panel" aria-label="Piece reserve bench">
            <div className="arena-subhead">
              <Flame size={15} aria-hidden="true" />
              <strong>Reserve Bench</strong>
              <button
                type="button"
                className="button secondary small"
                onClick={() => edit({ kind: "task" })}
              >
                <Plus size={12} /> Task
              </button>
            </div>
            <div className="arena-reserve-list">
              {queuedTasks.slice(0, 7).map(({ task }) => {
                const picked = reserveTask?.id === task.id;
                return (
                  <div
                    key={task.id}
                    className={"arena-reserve-row " + (picked ? "is-selected" : "")}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
                    }}
                  >
                    <button
                      type="button"
                      className="plain arena-reserve-title"
                      onClick={() => setReserveTaskId(task.id)}
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
                      Schedule
                    </button>
                  </div>
                );
              })}
              {queuedTasks.length === 0 && (
                <p className="muted">Reserve bench empty.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
