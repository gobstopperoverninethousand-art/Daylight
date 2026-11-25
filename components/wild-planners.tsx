"use client";
import { useState, type FormEvent, type DragEvent } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CornerDownLeft,
  Flag,
  FolderOpen,
  GripVertical,
  Plus,
  RefreshCw,
  Repeat2,
  Sparkles,
  Sun,
  Terminal as TerminalIcon,
  Zap,
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
  type Outcome,
  type State,
  type Task,
} from "@/lib/model";
import {
  type Block,
  blocksForDay,
  calendarEventIntervals,
  taskDue,
} from "@/lib/engine";
import { computeDayTelemetry, type ExperienceId } from "@/lib/experiences";
import {
  computeFocusSummary,
  findNextOpenSlot,
  groupBlocksByTrack,
  parseTerminalCommand,
  solarPoint,
  solarRingWedgePath,
} from "@/lib/wild-planner";
import type { EditorState } from "./editor";

export type WildNavView =
  | "planner"
  | "tasks"
  | "projects"
  | "deadlines"
  | "routines"
  | "progress"
  | "settings";

export type WildPlannerProps = {
  experience: ExperienceId;
  state: State;
  date: string;
  today: string;
  nowMinute: number;
  setDate: (d: string) => void;
  edit: (item: EditorState) => void;
  setOutcome: (kind: string, id: string, date: string, value: Outcome) => void;
  scheduleTask: (taskId: string, date: string, start: string) => void;
  unscheduleSession: (id: string) => boolean;
  openGoogleEvent: (id: string) => void;
  events: ReturnType<typeof calendarEventIntervals>;
  blocks: Block[];
  bank: "recommended" | "unscheduled" | "active";
  setBank: (b: "recommended" | "unscheduled" | "active") => void;
  queuedTasks: { task: Task; reason?: string }[];
  aiPriorities: { summary: string; stale: boolean; createdAt: string } | null;
  aiExtras: { summary: string; stale: boolean } | null;
  extraTasks: Task[];
  aiReady: boolean;
  aiNeedsSignIn: boolean;
  aiBusy: boolean;
  prioritiesRefreshing: boolean;
  requestPriorities: () => void;
  requestExtras: () => void;
  addExtraToToday: (task: Task) => void;
  onSwitchToCalendarView: (
    view: "Week" | "Month" | "Year" | "Year Columns",
  ) => void;
  wildModeLabel: string;
  onSearch?: () => void;
  onLoadDemo?: () => void;
  isDemo?: boolean;
  onNavigateView?: (v: WildNavView) => void;
  onNotify?: (msg: string) => void;
};

export const TASK_DRAG_TYPE = "application/daylight-task";

export function openBlockEditor(
  block: Block,
  date: string,
  edit: (item: EditorState) => void,
  openGoogleEvent: (id: string) => void,
) {
  if (block.kind === "external") {
    openGoogleEvent(block.sourceId);
  } else if (block.kind === "routine") {
    edit({ kind: "occurrence", id: block.sourceId, date });
  } else {
    edit({ kind: "session", id: block.id });
  }
}

export function WildViewSwitcher({
  wildLabel,
  onSwitchToCalendarView,
}: {
  wildLabel: string;
  onSwitchToCalendarView: (
    view: "Week" | "Month" | "Year" | "Year Columns",
  ) => void;
}) {
  return (
    <div className="view-switch wild-view-switch" role="group" aria-label="Planner layout">
      <button type="button" className="active" aria-pressed="true">
        {wildLabel}
      </button>
      {(["Week", "Month", "Year", "Year Columns"] as const).map((v) => (
        <button
          type="button"
          key={v}
          aria-pressed="false"
          onClick={() => onSwitchToCalendarView(v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export function snapTaskToDay(
  task: Task,
  state: State,
  date: string,
  today: string,
  nowMinute: number,
  events: ReturnType<typeof calendarEventIntervals>,
  scheduleTask: (taskId: string, date: string, start: string) => void,
  edit: (item: EditorState) => void,
  onNotify?: (msg: string) => void,
) {
  const duration = defaultSessionDuration(task);
  const minMin = date === today ? nowMinute : undefined;
  const slot =
    findNextOpenSlot(state, date, duration, events, minMin) ??
    findNextOpenSlot(state, date, duration, events);
  if (slot) {
    scheduleTask(task.id, date, slot);
    onNotify?.(`Scheduled "${task.title}" at ${displayTime(slot)}`);
  } else {
    edit({ kind: "session", taskId: task.id, date });
  }
}

/* ============================================================================
   6. SUNDIAL — 24-Hour Orbital Clockface Planner
   ============================================================================ */
export function SundialPlanner(props: WildPlannerProps) {
  const {
    state,
    date,
    today,
    nowMinute,
    setDate,
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
    aiPriorities,
    aiReady,
    aiBusy,
    prioritiesRefreshing,
    requestPriorities,
    onSwitchToCalendarView,
    wildModeLabel,
    onNotify,
  } = props;

  const timedBlocks = blocks
    .filter((b) => !b.allDay)
    .sort((a, b) => a.start - b.start);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverHour, setHoverHour] = useState<number | null>(null);
  const selectedBlock =
    timedBlocks.find((b) => b.id === selectedId) ?? timedBlocks[0] ?? null;

  const telemetry = computeDayTelemetry(state, date);
  const workStartMin = clockMinutes(state.settings.workStart);
  const workEndMin = clockMinutes(state.settings.workEnd);
  const weekStart = addDays(date, -3);
  const orbitDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const cx = 260;
  const cy = 260;
  const innerR = 118;
  const outerR = 204;

  const nowPointOuter = solarPoint(cx, cy, outerR + 12, nowMinute);
  const nowPointInner = solarPoint(cx, cy, innerR - 14, nowMinute);

  const colorFill: Record<Block["color"], { fill: string; stroke: string }> = {
    sage: { fill: "rgba(52, 211, 153, 0.34)", stroke: "#34D399" },
    lavender: { fill: "rgba(167, 139, 250, 0.36)", stroke: "#A78BFA" },
    peach: { fill: "rgba(251, 146, 60, 0.36)", stroke: "#FB923C" },
    blue: { fill: "rgba(56, 189, 248, 0.34)", stroke: "#38BDF8" },
    holiday: { fill: "rgba(250, 204, 21, 0.32)", stroke: "#FACC15" },
  };

  function handleDialDrop(e: DragEvent<SVGSVGElement>) {
    const taskId = e.dataTransfer.getData(TASK_DRAG_TYPE);
    if (!taskId) return;
    e.preventDefault();
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
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
    );
  }

  return (
    <div className="wild-sundial">
      <header className="wild-bar sundial-bar">
        <div className="wild-bar-left">
          <Sun size={18} className="sundial-accent-icon" aria-hidden="true" />
          <div>
            <h2>
              {formatDate(date, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h2>
            <p className="tabular-num">
              {hoursLabel(telemetry.scheduledMinutes)} scheduled ·{" "}
              {hoursLabel(telemetry.openMinutes)} open in solar window
            </p>
          </div>
        </div>
        <div className="wild-bar-right">
          <div className="nav-arrows">
            <button
              type="button"
              className="icon-button"
              aria-label="Previous day"
              onClick={() => setDate(addDays(date, -1))}
            >
              <ChevronLeft size={16} />
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
              className="icon-button"
              aria-label="Next day"
              onClick={() => setDate(addDays(date, 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <WildViewSwitcher
            wildLabel={wildModeLabel}
            onSwitchToCalendarView={onSwitchToCalendarView}
          />
          <button
            type="button"
            className="button primary small"
            onClick={() => edit({ kind: "session", date })}
          >
            <Plus size={14} />
            Book arc
          </button>
        </div>
      </header>

      <div className="sundial-stage">
        <section className="sundial-orb-panel" aria-label="24-hour orbital dial">
          <svg
            viewBox="0 0 520 520"
            className="sundial-svg"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={handleDialDrop}
          >
            <defs>
              <radialGradient id="sundialGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(245, 183, 79, 0.16)" />
                <stop offset="70%" stopColor="rgba(56, 189, 248, 0.05)" />
                <stop offset="100%" stopColor="rgba(9, 13, 22, 0)" />
              </radialGradient>
            </defs>

            <circle cx={cx} cy={cy} r={240} fill="url(#sundialGlow)" />
            <circle
              cx={cx}
              cy={cy}
              r={outerR}
              fill="none"
              stroke="rgba(148, 163, 184, 0.16)"
              strokeWidth={1.5}
            />
            <circle
              cx={cx}
              cy={cy}
              r={(innerR + outerR) / 2}
              fill="none"
              stroke="rgba(148, 163, 184, 0.09)"
              strokeDasharray="3 6"
              strokeWidth={1}
            />
            <circle
              cx={cx}
              cy={cy}
              r={innerR}
              fill="rgba(15, 23, 42, 0.85)"
              stroke="rgba(245, 183, 79, 0.35)"
              strokeWidth={1.5}
            />

            {/* Daylight Work Window Glow Band */}
            {workEndMin > workStartMin && (
              <path
                d={solarRingWedgePath(
                  cx,
                  cy,
                  outerR + 4,
                  outerR + 12,
                  workStartMin,
                  workEndMin,
                )}
                fill="rgba(245, 183, 79, 0.42)"
              />
            )}

            {/* Clickable 24 Hour Empty Slices */}
            {Array.from({ length: 24 }, (_, h) => {
              const startMin = h * 60;
              const endMin = (h + 1) * 60;
              const labelPt = solarPoint(cx, cy, outerR + 26, startMin);
              const isCardinal = h % 6 === 0;
              const tickInner = solarPoint(cx, cy, outerR - 4, startMin);
              const tickOuter = solarPoint(cx, cy, outerR + 3, startMin);
              const hourTag =
                h === 0
                  ? "12a"
                  : h === 6
                    ? "6a"
                    : h === 12
                      ? "12p"
                      : h === 18
                        ? "6p"
                        : h % 3 === 0
                          ? String(h)
                          : "";
              return (
                <g key={h}>
                  <path
                    d={solarRingWedgePath(
                      cx,
                      cy,
                      innerR + 2,
                      outerR - 2,
                      startMin,
                      endMin,
                    )}
                    className={
                      "sundial-hour-slice " +
                      (hoverHour === h ? "is-hovered" : "")
                    }
                    onMouseEnter={() => setHoverHour(h)}
                    onMouseLeave={() => setHoverHour(null)}
                    onClick={() =>
                      edit({
                        kind: "session",
                        date,
                        start: clockTime(startMin),
                      })
                    }
                  >
                    <title>Click to book at {displayTime(clockTime(startMin))}</title>
                  </path>
                  <line
                    x1={tickInner.x}
                    y1={tickInner.y}
                    x2={tickOuter.x}
                    y2={tickOuter.y}
                    stroke={
                      isCardinal
                        ? "rgba(245, 183, 79, 0.75)"
                        : "rgba(148, 163, 184, 0.25)"
                    }
                    strokeWidth={isCardinal ? 2 : 1}
                  />
                  {hourTag && (
                    <text
                      x={labelPt.x}
                      y={labelPt.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className={
                        isCardinal ? "sundial-cardinal-label" : "sundial-hour-label"
                      }
                    >
                      {hourTag}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Scheduled Session / Routine / Event Arc Wedges */}
            {timedBlocks.map((block) => {
              const palette = colorFill[block.color];
              const isSelected = selectedBlock?.id === block.id;
              const isDone = block.outcome === "completed";
              const midPt = solarPoint(
                cx,
                cy,
                (innerR + outerR) / 2,
                block.start + block.duration / 2,
              );
              return (
                <g
                  key={block.id}
                  className="sundial-block-wedge"
                  onClick={() => {
                    setSelectedId(block.id);
                  }}
                  onDoubleClick={() =>
                    openBlockEditor(block, date, edit, openGoogleEvent)
                  }
                >
                  <path
                    d={solarRingWedgePath(
                      cx,
                      cy,
                      innerR + 6,
                      outerR - 6,
                      block.start,
                      block.start + block.duration,
                    )}
                    fill={palette.fill}
                    stroke={isSelected ? "#FFFFFF" : palette.stroke}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    opacity={isDone ? 0.52 : 1}
                  >
                    <title>
                      {block.title} · {displayTime(clockTime(block.start))} (
                      {durationLabel(block.duration)})
                    </title>
                  </path>
                  {block.duration >= 45 && (
                    <circle
                      cx={midPt.x}
                      cy={midPt.y}
                      r={isSelected ? 4.5 : 3}
                      fill={isDone ? "#34D399" : "#FFFFFF"}
                    />
                  )}
                </g>
              );
            })}

            {/* Live Solar Hand */}
            {date === today && (
              <g className="sundial-now-hand" pointerEvents="none">
                <line
                  x1={nowPointInner.x}
                  y1={nowPointInner.y}
                  x2={nowPointOuter.x}
                  y2={nowPointOuter.y}
                  stroke="#F5B74F"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
                <circle cx={nowPointOuter.x} cy={nowPointOuter.y} r={5} fill="#F5B74F" />
              </g>
            )}

            {/* Center Telemetry Hub */}
            <text
              x={cx}
              y={cy - 34}
              textAnchor="middle"
              className="sundial-hub-kicker"
            >
              {date === today ? "SOLAR NOW" : formatDate(date, { weekday: "short" }).toUpperCase()}
            </text>
            <text
              x={cx}
              y={cy + 2}
              textAnchor="middle"
              className="sundial-hub-clock"
            >
              {date === today
                ? displayTime(clockTime(nowMinute))
                : formatDate(date, { month: "short", day: "numeric" })}
            </text>
            <text
              x={cx}
              y={cy + 30}
              textAnchor="middle"
              className="sundial-hub-meta"
            >
              {timedBlocks.length} blocks · {hoursLabel(telemetry.scheduledMinutes)}
            </text>
            <text
              x={cx}
              y={cy + 50}
              textAnchor="middle"
              className="sundial-hub-sub"
            >
              {hoverHour !== null
                ? `Click to book at ${displayTime(clockTime(hoverHour * 60))}`
                : "Click any hour arc to schedule"}
            </text>
          </svg>

          <div className="sundial-day-list" aria-label="Day arc breakdown">
            {timedBlocks.length ? (
              timedBlocks.map((b) => (
                <div
                  key={b.id}
                  className={
                    "sundial-arc-row " +
                    b.color +
                    (selectedBlock?.id === b.id ? " is-selected" : "")
                  }
                >
                  {b.kind !== "external" ? (
                    <button
                      type="button"
                      className={
                        "task-check " + (b.outcome === "completed" ? "checked" : "")
                      }
                      aria-label={`Mark ${b.title} ${b.outcome === "completed" ? "not recorded" : "completed"}`}
                      onClick={() =>
                        setOutcome(
                          b.kind,
                          b.sourceId,
                          date,
                          b.outcome === "completed" ? "pending" : "completed",
                        )
                      }
                    >
                      {b.outcome === "completed" && <Check size={12} />}
                    </button>
                  ) : (
                    <Clock3 size={13} aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    className="plain sundial-arc-btn"
                    onClick={() => {
                      setSelectedId(b.id);
                      openBlockEditor(b, date, edit, openGoogleEvent);
                    }}
                  >
                    <strong className={b.outcome === "completed" ? "strike" : ""}>
                      {b.title}
                    </strong>
                    <span className="tabular-num">
                      {displayTime(clockTime(b.start))} · {durationLabel(b.duration)}
                    </span>
                  </button>
                </div>
              ))
            ) : (
              <p className="sundial-empty-note">
                Solar ring is clear. Click an hour slice on the dial or snap a task
                from the dock.
              </p>
            )}
          </div>
        </section>

        <aside className="sundial-dock">
          <div className="sundial-orbit-strip" role="group" aria-label="Week orbit">
            {orbitDays.map((d) => (
              <button
                type="button"
                key={d}
                className={
                  "sundial-orbit-day " +
                  (d === date ? "active " : "") +
                  (d === today ? "is-today" : "")
                }
                onClick={() => setDate(d)}
              >
                <span>{formatDate(d, { weekday: "short" }).slice(0, 2)}</span>
                <strong className="tabular-num">{Number(d.slice(-2))}</strong>
              </button>
            ))}
          </div>

          {selectedBlock && (
            <section className="sundial-inspector" aria-label="Selected arc">
              <div className="sundial-inspector-head">
                <span>Selected arc</span>
                <span className="tabular-num">
                  {displayTime(clockTime(selectedBlock.start))} –{" "}
                  {displayTime(clockTime(selectedBlock.start + selectedBlock.duration))}
                </span>
              </div>
              <h3>{selectedBlock.title}</h3>
              <div className="sundial-inspector-actions">
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() =>
                    openBlockEditor(selectedBlock, date, edit, openGoogleEvent)
                  }
                >
                  Open details
                </button>
                {selectedBlock.kind !== "external" && (
                  <button
                    type="button"
                    className="button primary small"
                    onClick={() =>
                      setOutcome(
                        selectedBlock.kind,
                        selectedBlock.sourceId,
                        date,
                        selectedBlock.outcome === "completed"
                          ? "pending"
                          : "completed",
                      )
                    }
                  >
                    <Check size={13} />
                    {selectedBlock.outcome === "completed"
                      ? "Completed"
                      : "Complete"}
                  </button>
                )}
                {selectedBlock.kind === "session" &&
                  selectedBlock.outcome === "pending" && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => unscheduleSession(selectedBlock.id)}
                    >
                      Unschedule
                    </button>
                  )}
              </div>
            </section>
          )}

          <section className="sundial-queue" aria-label="Orbital task dock">
            <div className="sundial-queue-head">
              <div>
                <h3>Auto-slot queue</h3>
                <p>
                  {aiPriorities?.summary ||
                    "Snap tasks into the next open window on the dial."}
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                title="Refresh AI suggestions"
                aria-label="Refresh AI suggestions"
                disabled={!aiReady || aiBusy}
                onClick={requestPriorities}
              >
                <RefreshCw
                  size={14}
                  className={prioritiesRefreshing ? "spin" : ""}
                />
              </button>
            </div>
            <div className="bank-tabs" role="group" aria-label="Task queue filter">
              {(["recommended", "unscheduled", "active"] as const).map((tab) => (
                <button
                  type="button"
                  key={tab}
                  className={bank === tab ? "active" : ""}
                  onClick={() => setBank(tab)}
                >
                  {tab === "recommended"
                    ? "Suggested"
                    : tab === "unscheduled"
                      ? "Unscheduled"
                      : "All"}
                </button>
              ))}
            </div>
            <div className="sundial-queue-list">
              {queuedTasks.length ? (
                queuedTasks.map(({ task, reason }) => (
                  <article
                    key={task.id}
                    className="sundial-queue-card"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    <div className="sundial-queue-info">
                      <button
                        type="button"
                        className="plain"
                        onClick={() => edit({ kind: "task", id: task.id })}
                      >
                        <strong>{task.title}</strong>
                      </button>
                      <small className="tabular-num">
                        {durationLabel(defaultSessionDuration(task))}
                        {reason ? ` · ${reason}` : ""}
                      </small>
                    </div>
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
                      <Zap size={12} />
                      Snap
                    </button>
                  </article>
                ))
              ) : (
                <p className="sundial-empty-note">No unscheduled tasks in queue.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ============================================================================
   7. TIMELINE — Horizontal DAW Multi-Track Tape
   ============================================================================ */
export function TimelinePlanner(props: WildPlannerProps) {
  const {
    state,
    date,
    today,
    nowMinute,
    setDate,
    edit,
    setOutcome,
    scheduleTask,
    openGoogleEvent,
    events,
    blocks,
    bank,
    setBank,
    queuedTasks,
    onSwitchToCalendarView,
    wildModeLabel,
    onNotify,
  } = props;

  const [fullDay, setFullDay] = useState(false);
  const [tapeSpan, setTapeSpan] = useState<"day" | "week">("day");
  const startHour = fullDay ? 0 : 6;
  const endHour = fullDay ? 24 : 23;
  const totalHours = endHour - startHour;
  const startMin = startHour * 60;
  const totalMin = totalHours * 60;
  const trackMinWidth = totalHours * 74;

  const tracks = groupBlocksByTrack(
    blocks.filter((b) => !b.allDay),
    state,
  );
  const allDayItems = blocks.filter((b) => b.allDay);
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    addDays(addDays(date, -3), i),
  );
  const nowVisible =
    date === today && nowMinute >= startMin && nowMinute <= startMin + totalMin;
  const nowPct = ((nowMinute - startMin) / totalMin) * 100;

  return (
    <div className="wild-timeline">
      <header className="wild-bar timeline-bar">
        <div className="wild-bar-left">
          <div>
            <h2>
              Tape ·{" "}
              {tapeSpan === "week"
                ? `${formatDate(weekDays[0], { month: "short", day: "numeric" })} – ${formatDate(weekDays[6], { month: "short", day: "numeric" })}`
                : formatDate(date, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
            </h2>
            <p>
              {tapeSpan === "week"
                ? "7-day parallel horizontal tracks running left to right across the week."
                : "Time flows left to right across Tasks, Projects, Routines & Calendar tracks."}
            </p>
          </div>
        </div>
        <div className="wild-bar-right">
          <div className="nav-arrows">
            <button
              type="button"
              className="icon-button"
              aria-label="Previous day"
              onClick={() => setDate(addDays(date, -1))}
            >
              <ChevronLeft size={16} />
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
              className="icon-button"
              aria-label="Next day"
              onClick={() => setDate(addDays(date, 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="bank-tabs" role="group" aria-label="Tape mode">
            <button
              type="button"
              className={tapeSpan === "day" ? "active" : ""}
              aria-pressed={tapeSpan === "day"}
              onClick={() => setTapeSpan("day")}
            >
              1-Day Lanes
            </button>
            <button
              type="button"
              className={tapeSpan === "week" ? "active" : ""}
              aria-pressed={tapeSpan === "week"}
              onClick={() => setTapeSpan("week")}
            >
              7-Day Reel
            </button>
          </div>
          <button
            type="button"
            className="button secondary small"
            onClick={() => setFullDay((v) => !v)}
          >
            {fullDay ? "Focus 6am–11pm" : "Full 24h tape"}
          </button>
          <WildViewSwitcher
            wildLabel={wildModeLabel}
            onSwitchToCalendarView={onSwitchToCalendarView}
          />
          <button
            type="button"
            className="button primary small"
            onClick={() => edit({ kind: "session", date })}
          >
            <Plus size={14} />
            New clip
          </button>
        </div>
      </header>

      <div className="timeline-day-ribbon" role="group" aria-label="Days of week">
        {weekDays.map((d) => (
          <button
            type="button"
            key={d}
            className={
              "timeline-day-pill " +
              (d === date ? "active " : "") +
              (d === today ? "is-today" : "")
            }
            onClick={() => setDate(d)}
          >
            <span>{formatDate(d, { weekday: "short" })}</span>
            <strong className="tabular-num">{formatDate(d, { day: "numeric" })}</strong>
          </button>
        ))}
        {allDayItems.length > 0 && (
          <div className="timeline-allday-summary">
            <Flag size={12} aria-hidden="true" />
            <span>
              {allDayItems.length} all-day / routine{" "}
              {allDayItems.length === 1 ? "item" : "items"}
            </span>
          </div>
        )}
      </div>

      <section className="timeline-tape-scroll" aria-label="Horizontal multi-track tape">
        <div
          className="timeline-tape-canvas"
          style={{ minWidth: trackMinWidth + 140 }}
        >
          {/* Top Scrubber Ruler */}
          <div className="timeline-ruler-row">
            <div className="timeline-track-label ruler-corner">
              {tapeSpan === "week" ? "WEEK DAYS" : "TRACKS"}
            </div>
            <div className="timeline-ruler-hours">
              {Array.from({ length: totalHours }, (_, i) => {
                const h = startHour + i;
                return (
                  <div key={h} className="timeline-ruler-tick tabular-num">
                    <span>{displayTime(clockTime(h * 60))}</span>
                  </div>
                );
              })}
              {nowVisible && (
                <div
                  className="timeline-playhead-cap"
                  style={{ left: `${nowPct}%` }}
                >
                  NOW
                </div>
              )}
            </div>
          </div>

          {tapeSpan === "week"
            ? weekDays.map((dayStr) => {
                const dayBlocks = blocksForDay(state, dayStr, events).filter(
                  (b) => !b.allDay,
                );
                const isSelectedDay = dayStr === date;
                const isTodayRow = dayStr === today;
                return (
                  <div
                    key={dayStr}
                    className={
                      "timeline-lane-row " +
                      (isSelectedDay ? "is-active-day-row" : "")
                    }
                  >
                    <button
                      type="button"
                      className={
                        "plain timeline-track-label timeline-day-track-btn " +
                        (isTodayRow ? "tone-peach" : "tone-sage")
                      }
                      onClick={() => setDate(dayStr)}
                    >
                      <span className="timeline-track-dot" />
                      <strong>
                        {formatDate(dayStr, { weekday: "short", day: "numeric" })}
                      </strong>
                      <small className="tabular-num">{dayBlocks.length}</small>
                    </button>
                    <div className="timeline-lane-grid">
                      <div
                        className="timeline-lane-cells"
                        style={{
                          gridTemplateColumns: `repeat(${totalHours}, minmax(0, 1fr))`,
                        }}
                      >
                        {Array.from({ length: totalHours }, (_, i) => {
                          const h = startHour + i;
                          const hourStart = clockTime(h * 60);
                          return (
                            <button
                              type="button"
                              key={h}
                              className="timeline-hour-cell"
                              aria-label={`Schedule on ${dayStr} at ${displayTime(hourStart)}`}
                              onClick={() =>
                                edit({
                                  kind: "session",
                                  date: dayStr,
                                  start: hourStart,
                                })
                              }
                              onDragOver={(e) => {
                                if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) {
                                  e.preventDefault();
                                  e.currentTarget.classList.add("drag-over");
                                }
                              }}
                              onDragLeave={(e) =>
                                e.currentTarget.classList.remove("drag-over")
                              }
                              onDrop={(e) => {
                                e.currentTarget.classList.remove("drag-over");
                                const taskId = e.dataTransfer.getData(TASK_DRAG_TYPE);
                                if (!taskId) return;
                                e.preventDefault();
                                scheduleTask(taskId, dayStr, hourStart);
                              }}
                            />
                          );
                        })}
                      </div>
                      {isTodayRow &&
                        nowMinute >= startMin &&
                        nowMinute <= startMin + totalMin && (
                          <div
                            className="timeline-playhead-line"
                            style={{ left: `${nowPct}%` }}
                            aria-hidden="true"
                          />
                        )}
                      {dayBlocks.map((block) => {
                        const clippedStart = Math.max(startMin, block.start);
                        const clippedEnd = Math.min(
                          startMin + totalMin,
                          block.start + block.duration,
                        );
                        if (clippedEnd <= clippedStart) return null;
                        const leftPct =
                          ((clippedStart - startMin) / totalMin) * 100;
                        const widthPct =
                          ((clippedEnd - clippedStart) / totalMin) * 100;
                        const done = block.outcome === "completed";
                        return (
                          <div
                            key={block.id}
                            className={`timeline-clip ${block.color} ${done ? "is-done" : ""}`}
                            style={{
                              left: `${leftPct}%`,
                              width: `max(64px, ${widthPct}%)`,
                            }}
                          >
                            {block.kind !== "external" && (
                              <button
                                type="button"
                                className={"task-check " + (done ? "checked" : "")}
                                aria-label={`Mark ${block.title} ${done ? "not recorded" : "completed"}`}
                                onClick={() =>
                                  setOutcome(
                                    block.kind,
                                    block.sourceId,
                                    dayStr,
                                    done ? "pending" : "completed",
                                  )
                                }
                              >
                                {done && <Check size={11} />}
                              </button>
                            )}
                            <button
                              type="button"
                              className="plain timeline-clip-body"
                              onClick={() =>
                                openBlockEditor(block, dayStr, edit, openGoogleEvent)
                              }
                            >
                              <strong className={done ? "strike" : ""}>
                                {block.title}
                              </strong>
                              <small className="tabular-num">
                                {displayTime(clockTime(block.start))} ·{" "}
                                {durationLabel(block.duration)}
                              </small>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            : tracks.map((track) => (
                <div key={track.key} className="timeline-lane-row">
                  <div className={`timeline-track-label tone-${track.color}`}>
                    <span className="timeline-track-dot" />
                    <strong>{track.label}</strong>
                    <small className="tabular-num">{track.blocks.length}</small>
                  </div>
                  <div className="timeline-lane-grid">
                    {/* Hour Drop & Click Cells */}
                    <div
                      className="timeline-lane-cells"
                      style={{
                        gridTemplateColumns: `repeat(${totalHours}, minmax(0, 1fr))`,
                      }}
                    >
                      {Array.from({ length: totalHours }, (_, i) => {
                        const h = startHour + i;
                        const hourStart = clockTime(h * 60);
                        return (
                          <button
                            type="button"
                            key={h}
                            className="timeline-hour-cell"
                            aria-label={`Schedule ${track.label} at ${displayTime(hourStart)}`}
                            onClick={() =>
                              edit({
                                kind: "session",
                                date,
                                start: hourStart,
                              })
                            }
                            onDragOver={(e) => {
                              if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) {
                                e.preventDefault();
                                e.currentTarget.classList.add("drag-over");
                              }
                            }}
                            onDragLeave={(e) =>
                              e.currentTarget.classList.remove("drag-over")
                            }
                            onDrop={(e) => {
                              e.currentTarget.classList.remove("drag-over");
                              const taskId = e.dataTransfer.getData(TASK_DRAG_TYPE);
                              if (!taskId) return;
                              e.preventDefault();
                              scheduleTask(taskId, date, hourStart);
                            }}
                          />
                        );
                      })}
                    </div>

                    {/* Playhead Line */}
                    {nowVisible && (
                      <div
                        className="timeline-playhead-line"
                        style={{ left: `${nowPct}%` }}
                        aria-hidden="true"
                      />
                    )}

                    {/* Horizontal Clips */}
                    {track.blocks.map((block) => {
                      const clippedStart = Math.max(startMin, block.start);
                      const clippedEnd = Math.min(
                        startMin + totalMin,
                        block.start + block.duration,
                      );
                      if (clippedEnd <= clippedStart) return null;
                      const leftPct = ((clippedStart - startMin) / totalMin) * 100;
                      const widthPct =
                        ((clippedEnd - clippedStart) / totalMin) * 100;
                      const done = block.outcome === "completed";
                      return (
                        <div
                          key={block.id}
                          className={`timeline-clip ${block.color} ${done ? "is-done" : ""}`}
                          style={{
                            left: `${leftPct}%`,
                            width: `max(64px, ${widthPct}%)`,
                          }}
                        >
                          {block.kind !== "external" && (
                            <button
                              type="button"
                              className={"task-check " + (done ? "checked" : "")}
                              aria-label={`Mark ${block.title} ${done ? "not recorded" : "completed"}`}
                              onClick={() =>
                                setOutcome(
                                  block.kind,
                                  block.sourceId,
                                  date,
                                  done ? "pending" : "completed",
                                )
                              }
                            >
                              {done && <Check size={11} />}
                            </button>
                          )}
                          <button
                            type="button"
                            className="plain timeline-clip-body"
                            onClick={() =>
                              openBlockEditor(block, date, edit, openGoogleEvent)
                            }
                          >
                            <strong className={done ? "strike" : ""}>
                              {block.title}
                            </strong>
                            <small className="tabular-num">
                              {displayTime(clockTime(block.start))} ·{" "}
                              {durationLabel(block.duration)}
                            </small>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
        </div>
      </section>

      <section className="timeline-clip-rack" aria-label="Backlog clip rack">
        <div className="timeline-rack-head">
          <div>
            <h3>Clip rack · Drag onto any track hour or snap to slot</h3>
          </div>
          <div className="bank-tabs" role="group" aria-label="Clip rack filter">
            {(["recommended", "unscheduled", "active"] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                className={bank === tab ? "active" : ""}
                onClick={() => setBank(tab)}
              >
                {tab === "recommended"
                  ? "Suggested"
                  : tab === "unscheduled"
                    ? "Unscheduled"
                    : "All active"}
              </button>
            ))}
          </div>
        </div>
        <div className="timeline-rack-grid">
          {queuedTasks.length ? (
            queuedTasks.map(({ task }) => (
              <article
                key={task.id}
                className="timeline-rack-card"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                <GripVertical size={13} aria-hidden="true" />
                <button
                  type="button"
                  className="plain timeline-rack-title"
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
                  Snap
                </button>
              </article>
            ))
          ) : (
            <p className="timeline-rack-empty">
              No queued tasks here. Click + New clip or add a task from Quick add.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

/* ============================================================================
   8. TERMINAL — CRT Phosphor Console & Command Bar
   ============================================================================ */
export function TerminalPlanner(props: WildPlannerProps) {
  const {
    state,
    date,
    today,
    nowMinute,
    setDate,
    edit,
    setOutcome,
    scheduleTask,
    unscheduleSession,
    openGoogleEvent,
    events,
    blocks,
    queuedTasks,
    onSwitchToCalendarView,
    wildModeLabel,
    onSearch,
    onNavigateView,
    onNotify,
  } = props;

  const [cmd, setCmd] = useState("");
  const [cmdLog, setCmdLog] = useState<string>(
    "TTY READY · Commands: new <title>, today, next, prev, tasks, projects, /search, help",
  );

  const telemetry = computeDayTelemetry(state, date);
  const sortedBlocks = [...blocks].sort((a, b) => a.start - b.start);

  const workStartH = Math.floor(clockMinutes(state.settings.workStart) / 60);
  const workEndH = Math.ceil(clockMinutes(state.settings.workEnd) / 60);
  const asciiHours = Array.from(
    { length: Math.max(8, workEndH - workStartH) },
    (_, i) => workStartH + i,
  );

  function submitCommand(e: FormEvent) {
    e.preventDefault();
    const intent = parseTerminalCommand(cmd);
    setCmd("");
    switch (intent.type) {
      case "help":
        setCmdLog(
          "CMDS: [new <task>] [book] [today] [next] [prev] [tasks|projects|deadlines|routines|progress|cfg] [/<query>]",
        );
        break;
      case "today":
        setDate(today);
        setCmdLog(`JUMP -> ${today}`);
        break;
      case "shift": {
        const nextD = addDays(date, intent.days);
        setDate(nextD);
        setCmdLog(`DATE -> ${nextD}`);
        break;
      }
      case "view":
        onNavigateView?.(intent.view);
        setCmdLog(`VIEW -> ${intent.view.toUpperCase()}`);
        break;
      case "newSession":
        edit({ kind: "session", date });
        setCmdLog("OPENED SESSION BUFFER");
        break;
      case "newTask":
        edit({ kind: "task" });
        setCmdLog(
          intent.title
            ? `NEW TASK MODAL (${intent.title})`
            : "OPENED NEW TASK BUFFER",
        );
        break;
      case "search":
        onSearch?.();
        setCmdLog(`SEARCH -> ${intent.query || "*"}`);
        break;
      case "unknown":
        setCmdLog(`ERR: UNKNOWN CMD "${intent.raw}" — TYPE "help"`);
        break;
    }
  }

  return (
    <div className="wild-terminal">
      <section className="terminal-cli-box" aria-label="Terminal command input">
        <form className="terminal-cli-form" onSubmit={submitCommand}>
          <span className="terminal-prompt">
            <TerminalIcon size={14} aria-hidden="true" />
            <span>daylight@{date}:$</span>
          </span>
          <input
            type="text"
            className="terminal-cli-input"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder="type command (today, next, tasks, new, book, help)…"
            aria-label="Terminal command line"
          />
          <button type="submit" className="button primary small">
            <CornerDownLeft size={13} />
            EXEC
          </button>
        </form>
        <div className="terminal-cli-status">
          <span>{cmdLog}</span>
          <WildViewSwitcher
            wildLabel={wildModeLabel}
            onSwitchToCalendarView={onSwitchToCalendarView}
          />
        </div>
      </section>

      <section className="terminal-gantt-box" aria-label="Hourly occupation matrix">
        <div className="terminal-box-head">
          <strong>
            MATRIX // {formatDate(date, { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}
          </strong>
          <span className="tabular-num">
            USED:{hoursLabel(telemetry.scheduledMinutes)} · FREE:
            {hoursLabel(telemetry.openMinutes)} · DONE:{telemetry.completedBlocks}/
            {telemetry.totalBlocks}
          </span>
          <div className="terminal-date-ops">
            <button type="button" onClick={() => setDate(addDays(date, -1))}>
              [PREV]
            </button>
            <button type="button" onClick={() => setDate(today)}>
              [TODAY]
            </button>
            <button type="button" onClick={() => setDate(addDays(date, 1))}>
              [NEXT]
            </button>
            <button
              type="button"
              onClick={() => edit({ kind: "session", date })}
            >
              [+BOOK]
            </button>
          </div>
        </div>
        <div className="terminal-ascii-bar">
          {asciiHours.map((h) => {
            const hStart = h * 60;
            const hEnd = (h + 1) * 60;
            const busyCount = sortedBlocks.filter(
              (b) => !b.allDay && b.start < hEnd && b.start + b.duration > hStart,
            ).length;
            const isNowHour =
              date === today && nowMinute >= hStart && nowMinute < hEnd;
            return (
              <button
                type="button"
                key={h}
                className={
                  "terminal-ascii-cell " +
                  (busyCount > 0 ? "is-busy " : "") +
                  (isNowHour ? "is-now" : "")
                }
                onClick={() =>
                  edit({ kind: "session", date, start: clockTime(hStart) })
                }
                title={`Click to book ${displayTime(clockTime(hStart))}`}
              >
                <span>{String(h).padStart(2, "0")}</span>
                <strong>{busyCount > 0 ? "████" : "░░░░"}</strong>
              </button>
            );
          })}
        </div>
      </section>

      <div className="terminal-columns">
        <section className="terminal-ledger-box" aria-label="Schedule ledger">
          <div className="terminal-box-head">
            <strong>SCHEDULE LEDGER ({sortedBlocks.length})</strong>
            <button type="button" onClick={() => edit({ kind: "session", date })}>
              [+ ADD BLOCK]
            </button>
          </div>
          {sortedBlocks.length ? (
            <div className="terminal-table-wrap">
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th>TIME</th>
                    <th>DUR</th>
                    <th>KIND</th>
                    <th>ITEM</th>
                    <th>OPS</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedBlocks.map((b) => {
                    const done = b.outcome === "completed";
                    return (
                      <tr key={b.id} className={done ? "is-done" : ""}>
                        <td className="tabular-num">
                          {b.allDay ? "ALLDAY" : displayTime(clockTime(b.start))}
                        </td>
                        <td className="tabular-num">
                          {b.allDay ? "--" : durationLabel(b.duration)}
                        </td>
                        <td>{b.kind.toUpperCase()}</td>
                        <td>
                          <button
                            type="button"
                            className="plain terminal-item-link"
                            onClick={() =>
                              openBlockEditor(b, date, edit, openGoogleEvent)
                            }
                          >
                            {done ? "[X] " : "[ ] "}
                            {b.title}
                          </button>
                        </td>
                        <td className="terminal-row-ops">
                          {b.kind !== "external" && (
                            <button
                              type="button"
                              onClick={() =>
                                setOutcome(
                                  b.kind,
                                  b.sourceId,
                                  date,
                                  done ? "pending" : "completed",
                                )
                              }
                            >
                              {done ? "[UNDO]" : "[DONE]"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              openBlockEditor(b, date, edit, openGoogleEvent)
                            }
                          >
                            [EDIT]
                          </button>
                          {b.kind === "session" && b.outcome === "pending" && (
                            <button
                              type="button"
                              onClick={() => unscheduleSession(b.id)}
                            >
                              [DROP]
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="terminal-empty">
              BUFFER EMPTY FOR {date}. CLICK [+ ADD BLOCK] OR SELECT AN HOUR ABOVE.
            </p>
          )}
        </section>

        <aside className="terminal-queue-box" aria-label="Task queue buffer">
          <div className="terminal-box-head">
            <strong>TASK BUFFER ({queuedTasks.length})</strong>
            <button type="button" onClick={() => edit({ kind: "task" })}>
              [+ NEW]
            </button>
          </div>
          <div className="terminal-queue-list">
            {queuedTasks.length ? (
              queuedTasks.map(({ task }, idx) => (
                <div key={task.id} className="terminal-queue-row">
                  <button
                    type="button"
                    className="plain terminal-queue-title"
                    onClick={() => edit({ kind: "task", id: task.id })}
                  >
                    <span className="tabular-num">
                      [{String(idx + 1).padStart(2, "0")}]
                    </span>{" "}
                    {task.title}
                  </button>
                  <button
                    type="button"
                    className="terminal-slot-btn"
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
                    [+SLOT]
                  </button>
                </div>
              ))
            ) : (
              <p className="terminal-empty">NO QUEUED TASKS.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ============================================================================
   9. RETRO 98 — Daylight 98 Multi-Window Beveled Desktop
   ============================================================================ */
export function Retro98Planner(props: WildPlannerProps) {
  const {
    state,
    date,
    today,
    nowMinute,
    setDate,
    edit,
    setOutcome,
    scheduleTask,
    openGoogleEvent,
    events,
    blocks,
    bank,
    setBank,
    queuedTasks,
    onSwitchToCalendarView,
    wildModeLabel,
    onNotify,
  } = props;

  const sortedBlocks = [...blocks].sort((a, b) => a.start - b.start);
  const routineBlocks = blocks.filter((b) => b.kind === "routine");
  const telemetry = computeDayTelemetry(state, date);

  return (
    <div className="wild-retro98">
      <div className="retro98-window retro98-main-win">
        <div className="retro98-titlebar">
          <span>
            Schedule.exe —{" "}
            {formatDate(date, {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <div className="retro98-win-btns" aria-hidden="true">
            <span>_</span>
            <span>□</span>
            <span>×</span>
          </div>
        </div>
        <div className="retro98-menubar">
          <button type="button" onClick={() => setDate(addDays(date, -1))}>
            &lt; Prev Day
          </button>
          <button type="button" onClick={() => setDate(today)}>
            Today
          </button>
          <button type="button" onClick={() => setDate(addDays(date, 1))}>
            Next Day &gt;
          </button>
          <span className="spacer" />
          <WildViewSwitcher
            wildLabel={wildModeLabel}
            onSwitchToCalendarView={onSwitchToCalendarView}
          />
          <button
            type="button"
            className="retro98-btn"
            onClick={() => edit({ kind: "session", date })}
          >
            + New Block...
          </button>
        </div>

        <div className="retro98-inset-pane">
          {sortedBlocks.length ? (
            <div className="retro98-schedule-list">
              {sortedBlocks.map((b) => {
                const done = b.outcome === "completed";
                return (
                  <div key={b.id} className={`retro98-row ${b.color}`}>
                    {b.kind !== "external" ? (
                      <input
                        type="checkbox"
                        checked={done}
                        aria-label={`Mark ${b.title} completed`}
                        onChange={(e) =>
                          setOutcome(
                            b.kind,
                            b.sourceId,
                            date,
                            e.target.checked ? "completed" : "pending",
                          )
                        }
                      />
                    ) : (
                      <span className="retro98-ext-tag">CAL</span>
                    )}
                    <span className="retro98-time tabular-num">
                      {b.allDay ? "All day" : displayTime(clockTime(b.start))}
                    </span>
                    <button
                      type="button"
                      className="plain retro98-title-btn"
                      onClick={() =>
                        openBlockEditor(b, date, edit, openGoogleEvent)
                      }
                    >
                      <strong className={done ? "strike" : ""}>{b.title}</strong>
                    </button>
                    <span className="retro98-dur tabular-num">
                      {b.allDay ? "—" : durationLabel(b.duration)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="retro98-empty">
              <p>No time blocks found for {date}.</p>
              <button
                type="button"
                className="retro98-btn"
                onClick={() => edit({ kind: "session", date })}
              >
                Schedule First Block
              </button>
            </div>
          )}

          <div className="retro98-quick-hours">
            <span>Quick book hour:</span>
            {[9, 10, 11, 13, 14, 15, 16].map((h) => (
              <button
                type="button"
                key={h}
                className="retro98-btn"
                onClick={() =>
                  edit({ kind: "session", date, start: clockTime(h * 60) })
                }
              >
                {displayTime(clockTime(h * 60))}
              </button>
            ))}
          </div>
        </div>
        <div className="retro98-statusbar tabular-num">
          <span>Booked: {hoursLabel(telemetry.scheduledMinutes)}</span>
          <span>Open: {hoursLabel(telemetry.openMinutes)}</span>
          <span>Due 7d: {telemetry.dueSoonCount}</span>
        </div>
      </div>

      <div className="retro98-side-stack">
        <div className="retro98-window">
          <div className="retro98-titlebar">
            <span>To-Do_Queue.exe</span>
            <div className="retro98-win-btns" aria-hidden="true">
              <span>_</span>
              <span>×</span>
            </div>
          </div>
          <div className="retro98-tabs">
            {(["recommended", "unscheduled", "active"] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                className={bank === tab ? "active" : ""}
                onClick={() => setBank(tab)}
              >
                {tab === "recommended"
                  ? "Suggested"
                  : tab === "unscheduled"
                    ? "Unscheduled"
                    : "All"}
              </button>
            ))}
          </div>
          <div className="retro98-inset-pane retro98-queue-pane">
            {queuedTasks.length ? (
              queuedTasks.map(({ task }) => (
                <div key={task.id} className="retro98-queue-item">
                  <button
                    type="button"
                    className="plain"
                    onClick={() => edit({ kind: "task", id: task.id })}
                  >
                    {task.title}
                  </button>
                  <button
                    type="button"
                    className="retro98-btn"
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
                    Slot →
                  </button>
                </div>
              ))
            ) : (
              <p className="retro98-empty-text">Queue clear.</p>
            )}
          </div>
        </div>

        <div className="retro98-window">
          <div className="retro98-titlebar">
            <span>Routines_&_Deadlines.exe</span>
            <div className="retro98-win-btns" aria-hidden="true">
              <span>×</span>
            </div>
          </div>
          <div className="retro98-inset-pane retro98-routines-pane">
            {routineBlocks.map((r) => (
              <label key={r.id} className="retro98-routine-check">
                <input
                  type="checkbox"
                  checked={r.outcome === "completed"}
                  onChange={(e) =>
                    setOutcome(
                      "routine",
                      r.sourceId,
                      date,
                      e.target.checked ? "completed" : "pending",
                    )
                  }
                />
                <span>{r.title}</span>
              </label>
            ))}
            {state.deadlines
              .filter((d) => d.status === "active")
              .slice(0, 4)
              .map((d) => (
                <button
                  type="button"
                  key={d.id}
                  className="retro98-deadline-row"
                  onClick={() => edit({ kind: "deadline", id: d.id })}
                >
                  <Flag size={12} aria-hidden="true" />
                  <span>{d.title}</span>
                  <small className="tabular-num">{d.date}</small>
                </button>
              ))}
            {routineBlocks.length === 0 &&
              state.deadlines.filter((d) => d.status === "active").length === 0 && (
                <p className="retro98-empty-text">
                  No routines or active deadlines for this day.
                </p>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   10. MISSION — Focus Deck (Now Focusing Stage + Twin Horizon + Velocity)
   ============================================================================ */
export function MissionPlanner(props: WildPlannerProps) {
  const {
    state,
    date,
    today,
    nowMinute,
    setDate,
    edit,
    setOutcome,
    scheduleTask,
    openGoogleEvent,
    events,
    queuedTasks,
    onSwitchToCalendarView,
    wildModeLabel,
    onNotify,
  } = props;

  const summary = computeFocusSummary(state, date, today, nowMinute, events);
  const focal = summary.activeBlock ?? summary.nextBlock;
  const ringCircumference = 2 * Math.PI * 34;
  const ringOffset =
    ringCircumference - (summary.activeProgressPct / 100) * ringCircumference;

  return (
    <div className="wild-mission">
      <div className="wild-bar mission-bar">
        <div className="wild-bar-left">
          <div>
            <h2>
              Focus Deck ·{" "}
              {formatDate(date, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </h2>
            <p className="tabular-num">
              {summary.completedCount}/{summary.actionableCount} complete today
            </p>
          </div>
        </div>
        <div className="wild-bar-right">
          <div className="nav-arrows">
            <button
              type="button"
              className="icon-button"
              aria-label="Previous day"
              onClick={() => setDate(addDays(date, -1))}
            >
              <ChevronLeft size={16} />
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
              className="icon-button"
              aria-label="Next day"
              onClick={() => setDate(addDays(date, 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <WildViewSwitcher
            wildLabel={wildModeLabel}
            onSwitchToCalendarView={onSwitchToCalendarView}
          />
          <button
            type="button"
            className="button primary small"
            onClick={() => edit({ kind: "session", date })}
          >
            <Plus size={14} />
            Book block
          </button>
        </div>
      </div>

      {/* Hero Now-Focusing Stage */}
      <section className="mission-hero-stage" aria-label="Current focus">
        <div className="mission-hero-copy">
          <span className="mission-kicker">
            {summary.activeBlock
              ? "ACTIVE NOW"
              : focal
                ? "UP NEXT"
                : "CLEAR HORIZON"}
          </span>
          <h2>
            {focal
              ? focal.title
              : "No pending blocks remaining for this day."}
          </h2>
          {focal ? (
            <p className="tabular-num">
              {displayTime(clockTime(focal.start))} –{" "}
              {displayTime(clockTime(focal.start + focal.duration))} ·{" "}
              {durationLabel(focal.duration)}
            </p>
          ) : (
            <p>
              Select a queued task below to snap it into your next open window,
              or add a fresh block.
            </p>
          )}
          <div className="mission-hero-actions">
            {focal ? (
              <>
                {focal.kind !== "external" && (
                  <button
                    type="button"
                    className="button primary"
                    onClick={() =>
                      setOutcome(
                        focal.kind,
                        focal.sourceId,
                        date,
                        focal.outcome === "completed" ? "pending" : "completed",
                      )
                    }
                  >
                    <Check size={15} />
                    Mark complete
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    openBlockEditor(focal, date, edit, openGoogleEvent)
                  }
                >
                  Open details
                </button>
              </>
            ) : queuedTasks[0] ? (
              <button
                type="button"
                className="button primary"
                onClick={() =>
                  snapTaskToDay(
                    queuedTasks[0].task,
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
                <Zap size={15} />
                Slot “{queuedTasks[0].task.title}”
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                onClick={() => edit({ kind: "task" })}
              >
                <Plus size={15} />
                Add new task
              </button>
            )}
          </div>
        </div>

        <div className="mission-hero-ring">
          <svg width="96" height="96" viewBox="0 0 84 84" aria-hidden="true">
            <circle
              cx="42"
              cy="42"
              r="34"
              fill="none"
              stroke="rgba(255,255,255,0.14)"
              strokeWidth="6"
            />
            <circle
              cx="42"
              cy="42"
              r="34"
              fill="none"
              stroke="#FF4D1C"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={ringCircumference}
              strokeDashoffset={ringOffset}
              transform="rotate(-90 42 42)"
            />
            <text
              x="42"
              y="46"
              textAnchor="middle"
              fill="#FFFFFF"
              fontSize="14"
              fontWeight="700"
            >
              {summary.activeBlock
                ? `${summary.activeProgressPct}%`
                : `${summary.completedCount}/${summary.actionableCount}`}
            </text>
          </svg>
          <small>
            {summary.activeBlock ? "Elapsed in block" : "Blocks done"}
          </small>
        </div>
      </section>

      {/* Twin Horizon: Today vs Tomorrow */}
      <div className="mission-twin-grid">
        {[
          {
            title: "Today’s river",
            day: summary.date,
            items: summary.todayBlocks,
          },
          {
            title: "Tomorrow’s horizon",
            day: summary.tomorrowDate,
            items: summary.tomorrowBlocks,
          },
        ].map((col) => (
          <section key={col.day} className="mission-card">
            <div className="mission-card-head">
              <div>
                <h3>{col.title}</h3>
                <small>
                  {formatDate(col.day, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </small>
              </div>
              <button
                type="button"
                className="button secondary small"
                onClick={() => edit({ kind: "session", date: col.day })}
              >
                <Plus size={13} />
                Add
              </button>
            </div>
            {col.items.length ? (
              <div className="mission-river-list">
                {col.items.map((b) => {
                  const done = b.outcome === "completed";
                  return (
                    <article key={b.id} className={`mission-river-item ${b.color}`}>
                      {b.kind !== "external" ? (
                        <button
                          type="button"
                          className={"task-check " + (done ? "checked" : "")}
                          aria-label={`Mark ${b.title} ${done ? "not recorded" : "completed"}`}
                          onClick={() =>
                            setOutcome(
                              b.kind,
                              b.sourceId,
                              col.day,
                              done ? "pending" : "completed",
                            )
                          }
                        >
                          {done && <Check size={12} />}
                        </button>
                      ) : (
                        <Clock3 size={13} aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        className="plain mission-river-link"
                        onClick={() =>
                          openBlockEditor(b, col.day, edit, openGoogleEvent)
                        }
                      >
                        <strong className={done ? "strike" : ""}>
                          {b.title}
                        </strong>
                        <span className="tabular-num">
                          {b.allDay
                            ? "All day"
                            : `${displayTime(clockTime(b.start))} · ${durationLabel(b.duration)}`}
                        </span>
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="mission-muted">Open day — no blocks scheduled.</p>
            )}
          </section>
        ))}
      </div>

      {/* Bottom Tactical Bento Trio */}
      <div className="mission-bento-trio">
        <section className="mission-card">
          <div className="mission-card-head">
            <h3>Priority queue</h3>
            <Sparkles size={14} aria-hidden="true" />
          </div>
          {queuedTasks.length ? (
            <div className="mission-mini-list">
              {queuedTasks.slice(0, 5).map(({ task }) => (
                <div key={task.id} className="mission-mini-row">
                  <button
                    type="button"
                    className="plain"
                    onClick={() => edit({ kind: "task", id: task.id })}
                  >
                    <strong>{task.title}</strong>
                    <small className="tabular-num">
                      {durationLabel(defaultSessionDuration(task))}
                      {taskDue(state, task)
                        ? ` · Due ${formatDate(taskDue(state, task)!, { month: "short", day: "numeric" })}`
                        : ""}
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
                    Slot
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mission-muted">All active tasks are scheduled.</p>
          )}
        </section>

        <section className="mission-card">
          <div className="mission-card-head">
            <h3>Project velocity</h3>
            <FolderOpen size={14} aria-hidden="true" />
          </div>
          {summary.projectVelocity.length ? (
            <div className="mission-velocity-list">
              {summary.projectVelocity.map((proj) => {
                const pct =
                  proj.totalMilestones > 0
                    ? Math.round(
                        (proj.doneMilestones / proj.totalMilestones) * 100,
                      )
                    : 0;
                return (
                  <button
                    type="button"
                    key={proj.id}
                    className="plain mission-velocity-row"
                    onClick={() => edit({ kind: "project", id: proj.id })}
                  >
                    <div className="mission-velocity-top">
                      <strong>{proj.title}</strong>
                      <span className="tabular-num">
                        {proj.doneMilestones}/{proj.totalMilestones}
                      </span>
                    </div>
                    <div className="mission-progress-track">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <small>
                      {proj.nextMilestone
                        ? `Next: ${proj.nextMilestone}`
                        : "All approved milestones done"}
                    </small>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mission-muted">No active projects tracked.</p>
          )}
        </section>

        <section className="mission-card">
          <div className="mission-card-head">
            <h3>Deadline radar</h3>
            <Flag size={14} aria-hidden="true" />
          </div>
          {summary.urgentDeadlines.length ? (
            <div className="mission-mini-list">
              {summary.urgentDeadlines.map((entry) => (
                <button
                  type="button"
                  key={entry.kind + ":" + entry.id}
                  className="plain mission-deadline-row"
                  onClick={() =>
                    edit({
                      kind: entry.kind,
                      id: entry.id,
                      projectId:
                        entry.kind === "milestone"
                          ? (entry.projectId ?? undefined)
                          : undefined,
                    })
                  }
                >
                  <span>{entry.title}</span>
                  <strong className="tabular-num">
                    {formatDate(entry.date, { month: "short", day: "numeric" })}
                  </strong>
                </button>
              ))}
            </div>
          ) : (
            <p className="mission-muted">No upcoming deadlines.</p>
          )}
        </section>
      </div>
    </div>
  );
}
