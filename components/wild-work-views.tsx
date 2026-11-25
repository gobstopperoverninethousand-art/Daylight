"use client";
import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Flag,
  Folder,
  FolderOpen,
  GitBranch,
  MoreHorizontal,
  Pause,
  PenLine,
  Play,
  Plus,
  Repeat2,
  Search,
  Sparkles,
  Sun,
  Terminal as TerminalIcon,
  Trash2,
  Zap,
} from "lucide-react";
import {
  addDays,
  audit,
  clockTime,
  defaultSessionDuration,
  displayTime,
  durationLabel,
  finishTask,
  formatDate,
  hoursLabel,
  type Outcome,
  type State,
  type Task,
} from "@/lib/model";
import {
  calendarEventIntervals,
  projectHealth,
  zonedParts,
} from "@/lib/engine";
import { workspaceDay } from "@/lib/ai-freshness";
import { type ExperienceId } from "@/lib/experiences";
import {
  findNextOpenSlot,
  parseTerminalCommand,
  solarPoint,
  solarRingWedgePath,
} from "@/lib/wild-planner";
import {
  classifyTaskBuckets,
  computeDeadlineUrgency,
  computeProjectTimelineSpans,
  computeRoutineCadenceSummary,
  type DeadlineUrgencyItem,
  type RoutineCadenceItem,
  type TaskBucketEntry,
} from "@/lib/work-view-models";
import type { EditorState } from "./editor";
import { Badge, Empty, Field, IconButton } from "./ui";
import { MilestoneFlow } from "./milestone-flow";
import { DailyReviewDialog } from "./daily-review-dialog";
import { Report, WeeklyProgress } from "./review";
import {
  ExtraWildDeadlinesView,
  ExtraWildProgressView,
  ExtraWildProjectsView,
  ExtraWildRoutinesView,
  ExtraWildTasksView,
  isExtraWildExperience,
} from "./wild-work-views-extra";
import {
  Extra2WildDeadlinesView,
  Extra2WildProgressView,
  Extra2WildProjectsView,
  Extra2WildRoutinesView,
  Extra2WildTasksView,
  isExtra2WildExperience,
} from "./wild-work-views-extra2";

export type WildWorkProps = {
  experience: ExperienceId;
  state: State;
  update: (f: (s: State) => void) => void;
  edit: (m: EditorState) => void;
  notify: (s: string) => void;
  scheduleTask: (taskId: string, date: string, start: string) => void;
  setOutcome: (kind: string, id: string, date: string, value: Outcome) => void;
  onNavigatePlanner: () => void;
};

export type WildProjectsProps = WildWorkProps & {
  propose: (id: string) => void;
  proposeTasks: (id: string, milestoneId: string) => void;
  busy: boolean;
  aiReady: boolean;
};

export type WildProgressProps = WildWorkProps & {
  api: (path: string, body?: unknown, method?: string) => Promise<any>;
  aiReady: boolean;
  initialDate?: string;
};

function useAutoSlot(
  state: State,
  scheduleTask: WildWorkProps["scheduleTask"],
  edit: WildWorkProps["edit"],
  notify: WildWorkProps["notify"],
) {
  const { day: today, minute: nowMinute } = zonedParts(
    new Date().toISOString(),
    state.settings.timezone,
  );
  return {
    today,
    nowMinute,
    slotTask(task: Task) {
      const events = calendarEventIntervals(state);
      const duration = defaultSessionDuration(task);
      const slot =
        findNextOpenSlot(state, today, duration, events, nowMinute) ??
        findNextOpenSlot(state, today, duration, events);
      if (slot) {
        scheduleTask(task.id, today, slot);
        notify(`Scheduled "${task.title}" today at ${displayTime(slot)}`);
      } else {
        edit({ kind: "session", taskId: task.id, date: today });
      }
    },
  };
}

function toggleRoutinePaused(
  r: State["routines"][number],
  today: string,
  update: WildWorkProps["update"],
  notify: WildWorkProps["notify"],
) {
  update((s) => {
    const routine = s.routines.find((x) => x.id === r.id)!;
    const periods =
      routine.pausePeriods ??
      (routine.paused
        ? [
            {
              start:
                s.audit
                  .filter(
                    (a) =>
                      a.recordId === r.id && a.action === "Routine paused",
                  )
                  .at(-1)
                  ?.at.slice(0, 10) || today,
              end: null,
            },
          ]
        : []);
    if (routine.paused) {
      const open = periods.findLast((period) => !period.end);
      if (open) open.end = today;
    } else {
      periods.push({ start: today, end: null });
    }
    routine.pausePeriods = periods;
    routine.paused = !r.paused;
    audit(s, r.paused ? "Routine resumed" : "Routine paused", r.id);
  });
  notify(
    r.paused
      ? "Routine resumed."
      : "Routine paused. Sync to update Google Calendar.",
  );
}

function deleteRoutineKeepPast(
  r: State["routines"][number],
  today: string,
  update: WildWorkProps["update"],
  notify: WildWorkProps["notify"],
) {
  update((s) => {
    const routine = s.routines.find((x) => x.id === r.id)!;
    routine.deletedAt = today;
    audit(s, "Removed routine, kept history", r.id);
  });
  notify("Routine removed; past occurrences kept. Sync to update Google Calendar.");
}

function deleteRoutineAll(
  r: State["routines"][number],
  update: WildWorkProps["update"],
  notify: WildWorkProps["notify"],
) {
  update((s) => {
    s.routines = s.routines.filter((x) => x.id !== r.id);
    s.routineRecords = s.routineRecords.filter((x) => x.routineId !== r.id);
    s.exceptions = s.exceptions.filter((x) => x.routineId !== r.id);
    audit(s, "Removed routine and history", r.id);
  });
  notify("Routine and all occurrences removed. Sync to update Google Calendar.");
}

function toggleDeadlineStatus(
  d: State["deadlines"][number],
  update: WildWorkProps["update"],
  notify: WildWorkProps["notify"],
) {
  update((s) => {
    const found = s.deadlines.find((x) => x.id === d.id);
    if (!found) return;
    found.status = found.status === "resolved" ? "active" : "resolved";
    audit(
      s,
      "Deadline " +
        (d.status === "resolved" ? "reopened" : "resolved by user"),
      d.id,
    );
  });
  notify("Deadline updated. Its calendar marker is preserved.");
}

function toggleMilestoneComplete(
  project: State["projects"][number],
  milestone: State["projects"][number]["milestones"][number],
  update: WildWorkProps["update"],
  notify: WildWorkProps["notify"],
) {
  if (
    !milestone.completed &&
    milestone.dependsOn.some(
      (id) => !project.milestones.find((x) => x.id === id)?.completed,
    )
  ) {
    notify("Finish or review the dependency milestones first.");
    return;
  }
  update((s) => {
    const p = s.projects.find((x) => x.id === project.id);
    const m = p?.milestones.find((x) => x.id === milestone.id);
    if (!m) return;
    m.completed = !milestone.completed;
    audit(
      s,
      milestone.completed
        ? "Milestone reopened"
        : "Milestone deliverable confirmed complete",
      milestone.id,
    );
  });
}

/* ============================================================================
   1. TASKS — 5 Wild Structural Interpretations
   ============================================================================ */
export function WildTasksView(props: WildWorkProps) {
  if (isExtraWildExperience(props.experience)) {
    return <ExtraWildTasksView {...props} />;
  }
  if (isExtra2WildExperience(props.experience)) {
    return <Extra2WildTasksView {...props} />;
  }
  const { experience, state, update, edit, notify, scheduleTask } = props;
  const { today, slotTask } = useAutoSlot(state, scheduleTask, edit, notify);
  const buckets = classifyTaskBuckets(state, today);

  const [filter, setFilter] = useState<
    "active" | "unscheduled" | "missing" | "completed" | "all"
  >("active");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cliText, setCliText] = useState("");
  const [timelineBoardMode, setTimelineBoardMode] = useState<"board" | "list">(
    "board",
  );

  const filterList = (list: TaskBucketEntry[]) =>
    list.filter((e) => {
      if (filter === "active" && e.task.status !== "active") return false;
      if (filter === "completed" && e.task.status !== "completed") return false;
      if (filter === "unscheduled" && (e.task.status !== "active" || e.scheduled))
        return false;
      if (
        filter === "missing" &&
        (e.task.status !== "active" || e.task.estimate !== null)
      )
        return false;
      if (query && !e.task.title.toLowerCase().includes(query.toLowerCase()))
        return false;
      return true;
    });

  const filtered = filterList(buckets.entries);
  const toggleDone = (t: Task) => {
    update((s) => finishTask(s, t.id, t.status !== "completed"));
    notify(
      t.status === "completed"
        ? "Task reopened."
        : "Task finished; pending sessions flagged for review.",
    );
  };

  /* --- 1A. SUNDIAL: Orbital Effort Radar + Telemetry Inspector --- */
  if (experience === "sundial") {
    const activeEntries = buckets.entries.filter(
      (e) => e.task.status === "active",
    );
    const totalRemainingMin = activeEntries.reduce(
      (sum, e) => sum + (e.remainingMinutes ?? 30),
      0,
    );
    const selected =
      filtered.find((e) => e.task.id === selectedId) ?? filtered[0] ?? null;

    const ringItems = activeEntries.slice(0, 12);
    const totalSliceSpan = ringItems.reduce(
      (s, e) => s + Math.max(20, e.remainingMinutes ?? 30),
      0,
    );
    let cursor = 0;

    return (
      <div className="wild-sundial wild-work-sundial">
        <header className="wild-bar sundial-bar">
          <div className="wild-bar-left">
            <Sun size={18} className="sundial-accent-icon" aria-hidden="true" />
            <div>
              <h2>Orbital Task Queue</h2>
              <p className="tabular-num">
                {activeEntries.length} active ·{" "}
                {buckets.unscheduled.length} unscheduled ·{" "}
                {hoursLabel(totalRemainingMin)} total load
              </p>
            </div>
          </div>
          <div className="wild-bar-right">
            <label className="search wild-search-compact">
              <Search size={14} />
              <input
                aria-label="Filter orbital queue"
                placeholder="Filter queue…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="button primary small"
              onClick={() => edit({ kind: "task" })}
            >
              <Plus size={14} /> New task
            </button>
          </div>
        </header>

        <div className="sundial-stage">
          <section className="sundial-orb-panel" aria-label="Task workload ring">
            <svg viewBox="0 0 360 360" className="sundial-work-svg">
              <circle
                cx={180}
                cy={180}
                r={142}
                fill="none"
                stroke="rgba(148,163,184,0.16)"
                strokeWidth={1.2}
              />
              <circle
                cx={180}
                cy={180}
                r={84}
                fill="rgba(15,23,42,0.88)"
                stroke="rgba(245,183,79,0.35)"
                strokeWidth={1.2}
              />
              {ringItems.map((entry) => {
                const weight = Math.max(20, entry.remainingMinutes ?? 30);
                const startM = (cursor / Math.max(1, totalSliceSpan)) * 1440;
                cursor += weight;
                const endM = (cursor / Math.max(1, totalSliceSpan)) * 1440 - 10;
                const isSel = selected?.task.id === entry.task.id;
                const urgent = entry.task.importance === "high" || !!entry.due;
                const stroke = urgent
                  ? "#F5B74F"
                  : entry.scheduled
                    ? "#34D399"
                    : "#38BDF8";
                const fill = urgent
                  ? "rgba(245,183,79,0.28)"
                  : entry.scheduled
                    ? "rgba(52,211,153,0.26)"
                    : "rgba(56,189,248,0.24)";
                return (
                  <path
                    key={entry.task.id}
                    d={solarRingWedgePath(180, 180, 92, 136, startM, endM)}
                    fill={fill}
                    stroke={isSel ? "#FFFFFF" : stroke}
                    strokeWidth={isSel ? 2.5 : 1.2}
                    className="sundial-work-wedge"
                    onClick={() => setSelectedId(entry.task.id)}
                  >
                    <title>
                      {entry.task.title} ·{" "}
                      {durationLabel(entry.remainingMinutes)}
                    </title>
                  </path>
                );
              })}
              <text
                x={180}
                y={166}
                textAnchor="middle"
                className="sundial-hub-kicker"
              >
                ACTIVE LOAD
              </text>
              <text
                x={180}
                y={196}
                textAnchor="middle"
                className="sundial-hub-clock"
              >
                {hoursLabel(totalRemainingMin)}
              </text>
              <text
                x={180}
                y={220}
                textAnchor="middle"
                className="sundial-hub-meta"
              >
                {buckets.unscheduled.length} unslotted
              </text>
            </svg>

            <div className="sundial-day-list">
              <div className="bank-tabs" role="group" aria-label="Task filters">
                {(
                  [
                    ["active", "Active"],
                    ["unscheduled", "Unslotted"],
                    ["missing", "No est."],
                    ["completed", "Done"],
                    ["all", "All"],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    type="button"
                    key={v}
                    className={filter === v ? "active" : ""}
                    onClick={() => setFilter(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {filtered.length ? (
                filtered.map((entry) => (
                  <div
                    key={entry.task.id}
                    className={
                      "sundial-arc-row " +
                      (entry.scheduled ? "sage" : "blue") +
                      (selected?.task.id === entry.task.id ? " is-selected" : "")
                    }
                  >
                    <button
                      type="button"
                      className={
                        "task-check " +
                        (entry.task.status === "completed" ? "checked" : "")
                      }
                      aria-label={`Complete ${entry.task.title}`}
                      onClick={() => toggleDone(entry.task)}
                    >
                      {entry.task.status === "completed" && <Check size={12} />}
                    </button>
                    <button
                      type="button"
                      className="plain sundial-arc-btn"
                      onClick={() => setSelectedId(entry.task.id)}
                    >
                      <strong
                        className={
                          entry.task.status === "completed" ? "strike" : ""
                        }
                      >
                        {entry.task.title}
                      </strong>
                      <small className="tabular-num">
                        {durationLabel(entry.remainingMinutes)}
                        {entry.due ? " · Due " + formatDate(entry.due) : ""}
                      </small>
                    </button>
                    {entry.task.status === "active" && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => slotTask(entry.task)}
                      >
                        <Zap size={12} /> Snap
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="sundial-empty-note">No matching tasks.</p>
              )}
            </div>
          </section>

          <aside className="sundial-dock">
            <section className="sundial-inspector" aria-label="Task inspector">
              <div className="sundial-inspector-head">
                <span className="eyebrow">TELEMETRY DOSSIER</span>
                {selected && (
                  <span className="tabular-num">
                    {durationLabel(selected.remainingMinutes)}
                  </span>
                )}
              </div>
              {selected ? (
                <>
                  <h3>{selected.task.title}</h3>
                  <p className="sundial-inspector-meta">
                    {selected.projectTitle || "Standalone task"}
                    {selected.task.importance === "high"
                      ? " · High importance"
                      : ""}
                    {selected.due
                      ? " · Due " + formatDate(selected.due)
                      : " · No fixed deadline"}
                  </p>
                  {selected.task.notes && (
                    <p className="sundial-inspector-meta">
                      {selected.task.notes}
                    </p>
                  )}
                  <div className="sundial-inspector-actions">
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() =>
                        edit({ kind: "task", id: selected.task.id })
                      }
                    >
                      Edit details
                    </button>
                    {selected.task.status === "active" && (
                      <>
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() =>
                            edit({ kind: "session", taskId: selected.task.id })
                          }
                        >
                          Pick time…
                        </button>
                        <button
                          type="button"
                          className="button primary small"
                          onClick={() => slotTask(selected.task)}
                        >
                          <Zap size={13} /> Snap to dial
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <p className="sundial-empty-note">
                  Select any task wedge or row to inspect or slot it.
                </p>
              )}
            </section>
          </aside>
        </div>
      </div>
    );
  }

  /* --- 1B. TIMELINE: Studio Cue Board (4-Column Lanes or Cue List) --- */
  if (experience === "timeline") {
    const lanes: { key: string; title: string; tone: string; items: TaskBucketEntry[] }[] = [
      {
        key: "missing",
        title: "Needs Estimate",
        tone: "peach",
        items: buckets.needsEstimate.filter(
          (e) => !query || e.task.title.toLowerCase().includes(query.toLowerCase()),
        ),
      },
      {
        key: "unscheduled",
        title: "Ready / Unslotted",
        tone: "blue",
        items: buckets.unscheduled.filter(
          (e) =>
            e.task.estimate !== null &&
            (!query || e.task.title.toLowerCase().includes(query.toLowerCase())),
        ),
      },
      {
        key: "scheduled",
        title: "Booked on Tape",
        tone: "sage",
        items: buckets.scheduled.filter(
          (e) => !query || e.task.title.toLowerCase().includes(query.toLowerCase()),
        ),
      },
      {
        key: "completed",
        title: "Wrapped / Done",
        tone: "lavender",
        items: buckets.completed.filter(
          (e) => !query || e.task.title.toLowerCase().includes(query.toLowerCase()),
        ),
      },
    ];

    return (
      <div className="wild-timeline">
        <header className="wild-bar timeline-bar">
          <div className="wild-bar-left">
            <div>
              <h2>Cue Sheet · Task Takes</h2>
              <p className="tabular-num">
                {buckets.unscheduled.length} ready to record ·{" "}
                {buckets.scheduled.length} booked on calendar ·{" "}
                {buckets.completed.length} wrapped
              </p>
            </div>
          </div>
          <div className="wild-bar-right">
            <label className="search wild-search-compact">
              <Search size={14} />
              <input
                aria-label="Search cues"
                placeholder="Filter cues…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="bank-tabs" role="group" aria-label="Cue view mode">
              <button
                type="button"
                className={timelineBoardMode === "board" ? "active" : ""}
                onClick={() => setTimelineBoardMode("board")}
              >
                Cue Board
              </button>
              <button
                type="button"
                className={timelineBoardMode === "list" ? "active" : ""}
                onClick={() => setTimelineBoardMode("list")}
              >
                Take Sheet
              </button>
            </div>
            <button
              type="button"
              className="button primary small"
              onClick={() => edit({ kind: "task" })}
            >
              <Plus size={14} /> New take
            </button>
          </div>
        </header>

        {timelineBoardMode === "board" ? (
          <div className="timeline-cue-board">
            {lanes.map((lane) => (
              <section key={lane.key} className="timeline-cue-col">
                <div className={`timeline-cue-col-head tone-${lane.tone}`}>
                  <strong>{lane.title}</strong>
                  <span className="tabular-num">{lane.items.length}</span>
                </div>
                <div className="timeline-cue-col-list">
                  {lane.items.length ? (
                    lane.items.map((entry) => (
                      <article key={entry.task.id} className="timeline-cue-card">
                        <div className="timeline-cue-card-top">
                          <button
                            type="button"
                            className={
                              "task-check " +
                              (entry.task.status === "completed"
                                ? "checked"
                                : "")
                            }
                            aria-label={`Complete ${entry.task.title}`}
                            onClick={() => toggleDone(entry.task)}
                          >
                            {entry.task.status === "completed" && (
                              <Check size={12} />
                            )}
                          </button>
                          <button
                            type="button"
                            className="plain timeline-cue-title"
                            onClick={() =>
                              edit({ kind: "task", id: entry.task.id })
                            }
                          >
                            <strong
                              className={
                                entry.task.status === "completed"
                                  ? "strike"
                                  : ""
                              }
                            >
                              {entry.task.title}
                            </strong>
                          </button>
                        </div>
                        <div className="timeline-cue-meta tabular-num">
                          <span>{durationLabel(entry.remainingMinutes)}</span>
                          {entry.projectTitle && (
                            <span>· {entry.projectTitle}</span>
                          )}
                          {entry.due && <span>· {formatDate(entry.due)}</span>}
                        </div>
                        <div className="timeline-cue-actions">
                          {entry.task.status === "active" && (
                            <button
                              type="button"
                              className="button secondary small"
                              onClick={() => slotTask(entry.task)}
                            >
                              <Zap size={12} /> Slot today
                            </button>
                          )}
                          <button
                            type="button"
                            className="button secondary small"
                            onClick={() =>
                              edit({ kind: "task", id: entry.task.id })
                            }
                          >
                            Edit
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="timeline-rack-empty">Empty lane</p>
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="timeline-rack-grid">
            {filtered.map((entry) => (
              <article key={entry.task.id} className="timeline-rack-card">
                <button
                  type="button"
                  className={
                    "task-check " +
                    (entry.task.status === "completed" ? "checked" : "")
                  }
                  aria-label={`Complete ${entry.task.title}`}
                  onClick={() => toggleDone(entry.task)}
                >
                  {entry.task.status === "completed" && <Check size={12} />}
                </button>
                <button
                  type="button"
                  className="plain timeline-rack-title"
                  onClick={() => edit({ kind: "task", id: entry.task.id })}
                >
                  <strong>{entry.task.title}</strong>
                  <small className="tabular-num">
                    {durationLabel(entry.remainingMinutes)} ·{" "}
                    {entry.projectTitle || "Standalone"}
                  </small>
                </button>
                {entry.task.status === "active" && (
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => slotTask(entry.task)}
                  >
                    Snap
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* --- 1C. TERMINAL: PROC_QUEUE // Interactive Phosphor Task Table --- */
  if (experience === "terminal") {
    function runTaskCmd(e: FormEvent) {
      e.preventDefault();
      const raw = cliText.trim();
      if (!raw) return;
      setCliText("");
      const lower = raw.toLowerCase();
      if (lower.startsWith("/")) {
        setQuery(raw.slice(1).trim());
        return;
      }
      if (lower === "clear") {
        setQuery("");
        setFilter("active");
        return;
      }
      if (lower === "all" || lower === "active" || lower === "unscheduled" || lower === "completed") {
        setFilter(lower);
        return;
      }
      const intent = parseTerminalCommand(raw);
      if (intent.type === "newTask") {
        edit({ kind: "task" });
        return;
      }
      if (intent.type === "search") {
        setQuery(intent.query);
        return;
      }
      // Treat plain text as quick search or open task modal
      setQuery(raw);
    }

    return (
      <div className="wild-terminal">
        <section className="terminal-cli-box" aria-label="Task console prompt">
          <form className="terminal-cli-form" onSubmit={runTaskCmd}>
            <span className="terminal-prompt">
              <TerminalIcon size={14} aria-hidden="true" />
              <span>proc_queue@tasks:~$</span>
            </span>
            <input
              type="text"
              className="terminal-cli-input"
              aria-label="Filter or run task command"
              placeholder="filter: /query, active, unscheduled, completed, clear, or new"
              value={cliText}
              onChange={(e) => setCliText(e.target.value)}
            />
            <button type="submit" className="button primary small">
              EXEC
            </button>
          </form>
          <div className="terminal-cli-status tabular-num">
            <span>
              ACTIVE:{buckets.entries.filter((e) => e.task.status === "active").length} ·
              UNSLOTTED:{buckets.unscheduled.length} · DONE:{buckets.completed.length}
            </span>
            <div className="terminal-date-ops">
              {(["active", "unscheduled", "missing", "completed", "all"] as const).map(
                (f) => (
                  <button
                    key={f}
                    type="button"
                    className={filter === f ? "is-active-cmd" : ""}
                    onClick={() => setFilter(f)}
                  >
                    [{f.toUpperCase()}]
                  </button>
                ),
              )}
              <button type="button" onClick={() => edit({ kind: "task" })}>
                [+NEW_TASK]
              </button>
            </div>
          </div>
        </section>

        <section className="terminal-ledger-box" aria-label="Task process table">
          <div className="terminal-box-head">
            <span>PROCESS BUFFER ({filtered.length})</span>
            {query && (
              <button type="button" onClick={() => setQuery("")}>
                [CLR_FILTER: &quot;{query}&quot;]
              </button>
            )}
          </div>
          {filtered.length ? (
            <div className="terminal-table-wrap">
              <table className="terminal-table tabular-num">
                <thead>
                  <tr>
                    <th>STAT</th>
                    <th>EST</th>
                    <th>DUE</th>
                    <th>SESS</th>
                    <th>TITLE</th>
                    <th>OPS</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => {
                    const done = entry.task.status === "completed";
                    return (
                      <tr key={entry.task.id} className={done ? "is-done" : ""}>
                        <td>{done ? "[X]" : entry.task.importance === "high" ? "[!]" : "[ ]"}</td>
                        <td>{durationLabel(entry.remainingMinutes)}</td>
                        <td>{entry.due || "--"}</td>
                        <td>
                          {entry.completedSessionCount}/{entry.sessionCount}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="plain terminal-item-link"
                            onClick={() => edit({ kind: "task", id: entry.task.id })}
                          >
                            {entry.task.title}
                          </button>
                        </td>
                        <td className="terminal-row-ops">
                          <button
                            type="button"
                            onClick={() => toggleDone(entry.task)}
                          >
                            {done ? "[REOPEN]" : "[DONE]"}
                          </button>
                          {!done && (
                            <button
                              type="button"
                              onClick={() => slotTask(entry.task)}
                            >
                              [SLOT]
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => edit({ kind: "task", id: entry.task.id })}
                          >
                            [EDIT]
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="terminal-empty">EMPTY BUFFER // PRESS [+NEW_TASK]</p>
          )}
        </section>
      </div>
    );
  }

  /* --- 1D. RETRO 98: Task_Manager.exe Split Explorer & ListView --- */
  if (experience === "retro98") {
    const selected =
      filtered.find((e) => e.task.id === selectedId) ?? filtered[0] ?? null;

    return (
      <div className="wild-retro98-single">
        <section className="retro98-window" aria-label="Task Manager">
          <div className="retro98-titlebar">
            <span>Task_Manager.exe — {filter.toUpperCase()}</span>
            <div className="retro98-win-btns" aria-hidden="true">
              <span>_</span>
              <span>□</span>
              <span>×</span>
            </div>
          </div>

          <div className="retro98-menubar">
            <button type="button" onClick={() => edit({ kind: "task" })}>
              New Task...
            </button>
            {selected && selected.task.status === "active" && (
              <button type="button" onClick={() => slotTask(selected.task)}>
                Auto-Slot Selected
              </button>
            )}
            {selected && (
              <button type="button" onClick={() => toggleDone(selected.task)}>
                {selected.task.status === "completed" ? "Reopen" : "Mark Done"}
              </button>
            )}
            <span className="spacer" />
            <input
              type="text"
              className="retro98-inline-find"
              aria-label="Find task"
              placeholder="Find…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="retro98-explorer-split">
            <aside className="retro98-tree-pane" aria-label="Task folders">
              {(
                [
                  ["active", "Active Tasks", buckets.entries.filter((e) => e.task.status === "active").length],
                  ["unscheduled", "Unscheduled", buckets.unscheduled.length],
                  ["missing", "Needs Estimate", buckets.needsEstimate.length],
                  ["completed", "Completed", buckets.completed.length],
                  ["all", "All Tasks", buckets.entries.length],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  type="button"
                  key={key}
                  className={"retro98-tree-node " + (filter === key ? "active" : "")}
                  onClick={() => setFilter(key)}
                >
                  <Folder size={14} aria-hidden="true" />
                  <span>{label}</span>
                  <small className="tabular-num">({count})</small>
                </button>
              ))}
            </aside>

            <div className="retro98-inset-pane retro98-listview-pane">
              {filtered.length ? (
                <table className="retro98-table tabular-num">
                  <thead>
                    <tr>
                      <th />
                      <th>Task Title</th>
                      <th>Project</th>
                      <th>Estimate</th>
                      <th>Due</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entry) => (
                      <tr
                        key={entry.task.id}
                        className={selected?.task.id === entry.task.id ? "is-selected" : ""}
                        onClick={() => setSelectedId(entry.task.id)}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={entry.task.status === "completed"}
                            aria-label={`Complete ${entry.task.title}`}
                            onChange={() => toggleDone(entry.task)}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="plain retro98-title-btn"
                            onClick={() => edit({ kind: "task", id: entry.task.id })}
                          >
                            <span
                              className={
                                entry.task.status === "completed" ? "strike" : ""
                              }
                            >
                              {entry.task.title}
                            </span>
                          </button>
                        </td>
                        <td>{entry.projectTitle || "—"}</td>
                        <td>{durationLabel(entry.remainingMinutes)}</td>
                        <td>{entry.due ? formatDate(entry.due) : "—"}</td>
                        <td className="retro98-row-ops">
                          {entry.task.status === "active" && (
                            <button
                              type="button"
                              className="retro98-btn"
                              onClick={() => slotTask(entry.task)}
                            >
                              Slot
                            </button>
                          )}
                          <button
                            type="button"
                            className="retro98-btn"
                            onClick={() => edit({ kind: "task", id: entry.task.id })}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="retro98-empty">No objects match the selected folder.</p>
              )}
            </div>
          </div>

          <div className="retro98-statusbar tabular-num">
            <span>{filtered.length} object(s)</span>
            <span>Unscheduled: {buckets.unscheduled.length}</span>
            <span>Missing est: {buckets.needsEstimate.length}</span>
          </div>
        </section>
      </div>
    );
  }

  /* --- 1E. MISSION: Focus Triage Matrix (Hero Spotlight + Bento Columns) --- */
  const heroTask =
    buckets.urgent.find((e) => !e.scheduled) ??
    buckets.urgent[0] ??
    buckets.unscheduled[0] ??
    buckets.scheduled[0] ??
    null;

  return (
    <div className="wild-mission">
      <header className="wild-bar mission-bar">
        <div className="wild-bar-left">
          <div>
            <h2>Task Triage Deck</h2>
            <p className="tabular-num">
              {buckets.urgent.length} priority · {buckets.unscheduled.length} ready to slot ·{" "}
              {buckets.completed.length} finished
            </p>
          </div>
        </div>
        <div className="wild-bar-right">
          <label className="search wild-search-compact">
            <Search size={14} />
            <input
              aria-label="Search triage deck"
              placeholder="Search tasks…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="button primary small"
            onClick={() => edit({ kind: "task" })}
          >
            <Plus size={14} /> New task
          </button>
        </div>
      </header>

      {heroTask && (
        <section className="mission-hero-stage" aria-label="Next task triage spotlight">
          <div className="mission-hero-left">
            <span className="mission-hero-kicker">
              {heroTask.task.importance === "high"
                ? "HIGH PRIORITY FOCUS"
                : "NEXT UNSCHEDULED"}
            </span>
            <button
              type="button"
              className="plain mission-hero-title"
              onClick={() => edit({ kind: "task", id: heroTask.task.id })}
            >
              <h1>{heroTask.task.title}</h1>
            </button>
            <p className="mission-hero-time tabular-num">
              {durationLabel(heroTask.remainingMinutes)}
              {heroTask.projectTitle ? " · " + heroTask.projectTitle : ""}
              {heroTask.due ? " · Due " + formatDate(heroTask.due) : ""}
            </p>
            <div className="mission-hero-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => slotTask(heroTask.task)}
              >
                <Zap size={14} /> Snap into today
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => toggleDone(heroTask.task)}
              >
                <Check size={14} /> Mark finished
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => edit({ kind: "task", id: heroTask.task.id })}
              >
                Edit details
              </button>
            </div>
          </div>
          <div className="mission-hero-ring">
            <div className="mission-ring-meta tabular-num">
              <strong style={{ fontSize: 28 }}>
                {buckets.unscheduled.length}
              </strong>
              <span>Unslotted</span>
            </div>
          </div>
        </section>
      )}

      <div className="mission-bento-trio">
        {(
          [
            {
              title: "Unslotted Ready",
              items: filterList(buckets.unscheduled),
            },
            {
              title: "Scheduled Sessions",
              items: filterList(buckets.scheduled),
            },
            {
              title: "Completed",
              items: filterList(buckets.completed),
            },
          ] as const
        ).map((col) => (
          <section key={col.title} className="mission-bento-card">
            <div className="mission-card-head">
              <h3>{col.title}</h3>
              <span className="tabular-num">{col.items.length}</span>
            </div>
            {col.items.length ? (
              <div className="mission-stack">
                {col.items.slice(0, 12).map((entry) => (
                  <div key={entry.task.id} className="mission-mini-row">
                    <button
                      type="button"
                      className={
                        "task-check " +
                        (entry.task.status === "completed" ? "checked" : "")
                      }
                      aria-label={`Complete ${entry.task.title}`}
                      onClick={() => toggleDone(entry.task)}
                    >
                      {entry.task.status === "completed" && <Check size={11} />}
                    </button>
                    <button
                      type="button"
                      className="plain"
                      onClick={() => edit({ kind: "task", id: entry.task.id })}
                    >
                      <strong
                        className={
                          entry.task.status === "completed" ? "strike" : ""
                        }
                      >
                        {entry.task.title}
                      </strong>
                      <small className="tabular-num">
                        {durationLabel(entry.remainingMinutes)}
                        {entry.due ? " · " + formatDate(entry.due) : ""}
                      </small>
                    </button>
                    {entry.task.status === "active" && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => slotTask(entry.task)}
                      >
                        Slot
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mission-muted">Nothing in this bucket.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

/* ============================================================================
   2. PROJECTS — 5 Wild Structural Interpretations
   ============================================================================ */
export function WildProjectsView(props: WildProjectsProps) {
  if (isExtraWildExperience(props.experience)) {
    return <ExtraWildProjectsView {...props} />;
  }
  if (isExtra2WildExperience(props.experience)) {
    return <Extra2WildProjectsView {...props} />;
  }
  const {
    experience,
    state,
    update,
    edit,
    notify,
    propose,
    proposeTasks,
    busy,
    aiReady,
  } = props;
  const { today } = useAutoSlot(state, props.scheduleTask, edit, notify);
  const [archived, setArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskMilestone, setTaskMilestone] = useState("");

  const visibleProjects = state.projects.filter(
    (p) => (p.status === "completed") === archived,
  );
  const project =
    experience === "retro98"
      ? state.projects.find((p) => p.id === selectedId) ??
        visibleProjects[0] ??
        null
      : state.projects.find((p) => p.id === selectedId) ?? null;

  const toggleProjectArchived = (p: State["projects"][number]) => {
    update((s) => {
      s.projects.find((x) => x.id === p.id)!.status =
        p.status === "active" ? "completed" : "active";
      audit(
        s,
        "Project " + (p.status === "active" ? "completed" : "reopened"),
        p.id,
      );
    });
    setArchived(p.status === "active");
    if (experience !== "retro98") setSelectedId(null);
    notify(p.status === "active" ? "Project archived." : "Project reopened.");
  };

  function renderProjectDetailPane(p: State["projects"][number], backButton: boolean) {
    const health = projectHealth(state, p);
    const currentTasks = state.tasks.filter(
      (t) => t.projectId === p.id && t.status === "active",
    );
    const selectedTaskMilestone = p.milestones.find(
      (m) => m.id === taskMilestone && m.approved && !m.completed,
    );
    const sortedMilestones = [...p.milestones].sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    return (
      <div className="wild-project-detail">
        <div className="wild-detail-top">
          <div>
            {backButton && (
              <button
                type="button"
                className="text-button back-link"
                onClick={() => setSelectedId(null)}
              >
                <ArrowLeft size={14} /> All projects
              </button>
            )}
            <h2>{p.title}</h2>
            {p.outcome && <p className="wild-detail-outcome">{p.outcome}</p>}
            <p className="wild-detail-meta tabular-num">
              Deliverable: {formatDate(p.deadline)} · {health.label} ·{" "}
              {health.reason}
            </p>
          </div>
          <div className="wild-bar-right">
            <button
              type="button"
              className="button secondary small"
              onClick={() => edit({ kind: "project", id: p.id })}
            >
              Edit project
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => toggleProjectArchived(p)}
            >
              {p.status === "active" ? "Finish project" : "Reopen project"}
            </button>
          </div>
        </div>

        {p.milestones.length > 0 && (
          <MilestoneFlow
            milestones={p.milestones}
            onSelect={(id) => edit({ kind: "milestone", projectId: p.id, id })}
          />
        )}

        <div className="wild-detail-split">
          <section className="wild-detail-main">
            <div className="wild-subhead">
              <h3>Milestones ({sortedMilestones.length})</h3>
              <button
                type="button"
                className="button secondary small"
                onClick={() => edit({ kind: "milestone", projectId: p.id })}
              >
                <Plus size={13} /> Add milestone
              </button>
            </div>
            {sortedMilestones.length ? (
              <div className="wild-milestone-stack">
                {sortedMilestones.map((m, i) => (
                  <article
                    key={m.id}
                    className={
                      "wild-milestone-row " +
                      (m.completed ? "is-done" : !m.approved ? "is-draft" : "")
                    }
                  >
                    <div className="wild-ms-index tabular-num">
                      {m.completed ? <Check size={14} /> : String(i + 1).padStart(2, "0")}
                    </div>
                    <div className="wild-ms-body">
                      <strong>{m.title}</strong>
                      <small className="tabular-num">
                        {formatDate(m.date)} ·{" "}
                        {m.completed
                          ? "Finished"
                          : m.approved
                            ? "Approved"
                            : "Draft"}
                        {m.estimate !== null ? ` · ${hoursLabel(m.estimate)}` : ""}
                      </small>
                      {m.dependsOn.length > 0 && (
                        <small className="dependency-text">
                          <GitBranch size={11} /> After{" "}
                          {m.dependsOn
                            .map(
                              (id) =>
                                p.milestones.find((x) => x.id === id)?.title,
                            )
                            .join(", ")}
                        </small>
                      )}
                    </div>
                    <div className="wild-ms-actions">
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() =>
                          edit({ kind: "milestone", projectId: p.id, id: m.id })
                        }
                      >
                        {m.approved ? "Edit" : "Approve"}
                      </button>
                      {m.approved && (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() =>
                            toggleMilestoneComplete(p, m, update, notify)
                          }
                        >
                          {m.completed ? "Reopen" : "Deliver"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No milestones yet.</p>
            )}
          </section>

          <aside className="wild-detail-aside">
            <div className="wild-subhead">
              <h3>Project Tasks ({currentTasks.length})</h3>
              <button
                type="button"
                className="button secondary small"
                onClick={() => edit({ kind: "task", projectId: p.id })}
              >
                <Plus size={13} /> Add task
              </button>
            </div>
            <div className="wild-aside-tasks">
              {currentTasks.length ? (
                currentTasks.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className="wild-aside-task-btn"
                    onClick={() => edit({ kind: "task", id: t.id })}
                  >
                    <span>{t.title}</span>
                    <small className="tabular-num">
                      {durationLabel(t.remaining ?? t.estimate)}
                    </small>
                  </button>
                ))
              ) : (
                <p className="muted">No active tasks.</p>
              )}
            </div>

            <div className="wild-ai-box">
              <div className="wild-ai-head">
                <Sparkles size={15} />
                <strong>AI Milestone &amp; Task Proposals</strong>
              </div>
              <button
                type="button"
                className="button secondary small"
                disabled={busy || !aiReady}
                onClick={() => propose(p.id)}
              >
                {busy ? "Working…" : "Propose milestones"}
              </button>
              <Field label="Target milestone">
                <select
                  value={selectedTaskMilestone?.id ?? ""}
                  onChange={(e) => setTaskMilestone(e.target.value)}
                >
                  <option value="">Select approved milestone</option>
                  {p.milestones
                    .filter((m) => m.approved && !m.completed)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                </select>
              </Field>
              <button
                type="button"
                className="button secondary small"
                disabled={busy || !aiReady || !selectedTaskMilestone}
                onClick={() =>
                  selectedTaskMilestone &&
                  proposeTasks(p.id, selectedTaskMilestone.id)
                }
              >
                Suggest next tasks
              </button>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  /* --- 2A. RETRO98: Project_Explorer.exe Split Folder Tree --- */
  if (experience === "retro98") {
    return (
      <div className="wild-retro98-single">
        <section className="retro98-window" aria-label="Project Explorer">
          <div className="retro98-titlebar">
            <span>Project_Explorer.exe — {archived ? "Archived" : "Active"}</span>
            <div className="retro98-win-btns" aria-hidden="true">
              <span>_</span>
              <span>□</span>
              <span>×</span>
            </div>
          </div>
          <div className="retro98-menubar">
            <button type="button" onClick={() => edit({ kind: "project" })}>
              New Project...
            </button>
            <button
              type="button"
              onClick={() => {
                setArchived(false);
                setSelectedId(null);
              }}
            >
              Active ({state.projects.filter((p) => p.status === "active").length})
            </button>
            <button
              type="button"
              onClick={() => {
                setArchived(true);
                setSelectedId(null);
              }}
            >
              Archived (
              {state.projects.filter((p) => p.status === "completed").length})
            </button>
          </div>
          <div className="retro98-explorer-split">
            <aside className="retro98-tree-pane" aria-label="Project folders">
              {visibleProjects.length ? (
                visibleProjects.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className={
                      "retro98-tree-node " +
                      (project?.id === p.id ? "active" : "")
                    }
                    onClick={() => setSelectedId(p.id)}
                  >
                    <FolderOpen size={14} aria-hidden="true" />
                    <span>{p.title}</span>
                  </button>
                ))
              ) : (
                <p className="retro98-empty">No folders</p>
              )}
            </aside>
            <div className="retro98-inset-pane retro98-detail-pane">
              {project ? (
                renderProjectDetailPane(project, false)
              ) : (
                <p className="retro98-empty">
                  Create a project to populate Explorer.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  }

  /* --- 2B. If viewing single project detail in non-retro98 wild modes --- */
  if (project) {
    return (
      <div className={`wild-proj-wrap is-${experience}`}>
        {renderProjectDetailPane(project, true)}
      </div>
    );
  }

  /* --- 2C. TIMELINE: Multi-Track Horizontal Release Gantt --- */
  if (experience === "timeline") {
    const timeline = computeProjectTimelineSpans(state, visibleProjects, today);
    return (
      <div className="wild-timeline">
        <header className="wild-bar timeline-bar">
          <div className="wild-bar-left">
            <div>
              <h2>Release Gantt · Master Projects</h2>
              <p className="tabular-num">
                {formatDate(timeline.minDate)} → {formatDate(timeline.maxDate)} ·
                Click any project or milestone marker to inspect
              </p>
            </div>
          </div>
          <div className="wild-bar-right">
            <div className="bank-tabs" role="group" aria-label="Project status">
              <button
                type="button"
                className={!archived ? "active" : ""}
                onClick={() => setArchived(false)}
              >
                Active
              </button>
              <button
                type="button"
                className={archived ? "active" : ""}
                onClick={() => setArchived(true)}
              >
                Archived
              </button>
            </div>
            <button
              type="button"
              className="button primary small"
              onClick={() => edit({ kind: "project" })}
            >
              <Plus size={14} /> New project
            </button>
          </div>
        </header>

        {timeline.spans.length ? (
          <section className="timeline-gantt-sheet" aria-label="Project Gantt chart">
            <div className="timeline-gantt-ruler tabular-num">
              <span>PROJECT TRACK</span>
              <div className="timeline-gantt-dates">
                <span>{formatDate(timeline.minDate)}</span>
                <span className="timeline-gantt-today-label">TODAY</span>
                <span>{formatDate(timeline.maxDate)}</span>
              </div>
            </div>
            {timeline.spans.map((span) => (
              <div key={span.id} className="timeline-gantt-row">
                <button
                  type="button"
                  className="plain timeline-gantt-label"
                  onClick={() => setSelectedId(span.id)}
                >
                  <strong>{span.title}</strong>
                  <small className="tabular-num">
                    {span.doneMilestones}/{span.totalMilestones} milestones ·{" "}
                    {span.healthLabel}
                  </small>
                </button>
                <div className="timeline-gantt-lane">
                  <div
                    className="timeline-playhead-line"
                    style={{ left: `${timeline.todayPct}%` }}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="timeline-gantt-bar"
                    style={{
                      left: `${span.startPct}%`,
                      width: `${Math.max(8, span.endPct - span.startPct)}%`,
                    }}
                    onClick={() => setSelectedId(span.id)}
                  >
                    <span className="tabular-num">
                      Due {formatDate(span.deadline)}
                    </span>
                  </button>
                  {span.milestones.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      className={
                        "timeline-gantt-diamond " +
                        (m.completed ? "is-done" : !m.approved ? "is-draft" : "")
                      }
                      style={{ left: `${m.posPct}%` }}
                      title={`${m.title} · ${formatDate(m.date)}`}
                      aria-label={`${m.title} (${formatDate(m.date)})`}
                      onClick={() =>
                        edit({ kind: "milestone", projectId: span.id, id: m.id })
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : (
          <Empty
            title="No projects in this track."
            description="Add a long-horizon project with outcome and deadline."
            action={() => edit({ kind: "project" })}
            label="Create project"
          />
        )}
      </div>
    );
  }

  /* --- 2D. TERMINAL: REPO_TREE // ASCII Project Directory --- */
  if (experience === "terminal") {
    return (
      <div className="wild-terminal">
        <section className="terminal-gantt-box">
          <div className="terminal-box-head">
            <span>REPO_TREE // {archived ? "ARCHIVED" : "ACTIVE"} PROJECTS</span>
            <div className="terminal-date-ops">
              <button type="button" onClick={() => setArchived(false)}>
                [ACTIVE]
              </button>
              <button type="button" onClick={() => setArchived(true)}>
                [ARCHIVED]
              </button>
              <button type="button" onClick={() => edit({ kind: "project" })}>
                [+NEW_REPO]
              </button>
            </div>
          </div>
          {visibleProjects.length ? (
            <div className="terminal-repo-list">
              {visibleProjects.map((p, idx) => {
                const health = projectHealth(state, p);
                const done = p.milestones.filter((m) => m.completed).length;
                const branch = idx === visibleProjects.length - 1 ? "└──" : "├──";
                return (
                  <article key={p.id} className="terminal-repo-node">
                    <div className="terminal-repo-line">
                      <span>{branch}</span>
                      <button
                        type="button"
                        className="plain terminal-item-link"
                        onClick={() => setSelectedId(p.id)}
                      >
                        <strong>{p.title}/</strong>
                      </button>
                      <span className="tabular-num">
                        [{health.label.toUpperCase()}] DUE:{p.deadline} MS:{done}/
                        {p.milestones.length}
                      </span>
                      <button
                        type="button"
                        className="terminal-slot-btn"
                        onClick={() => setSelectedId(p.id)}
                      >
                        [OPEN]
                      </button>
                    </div>
                    <div className="terminal-repo-pipeline tabular-num">
                      {p.milestones.length
                        ? p.milestones.map((m) => (
                            <span key={m.id}>
                              {m.completed ? "[✓]" : m.approved ? "[●]" : "[~]"}{" "}
                              {m.title}
                            </span>
                          ))
                        : "NO_MILESTONES"}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="terminal-empty">0 REPOSITORIES FOUND</p>
          )}
        </section>
      </div>
    );
  }

  /* --- 2E. SUNDIAL (Constellation) & MISSION (Velocity Bento) --- */
  return (
    <div className={`wild-proj-list is-${experience}`}>
      <header className={`wild-bar ${experience}-bar`}>
        <div className="wild-bar-left">
          <div>
            <h2>
              {experience === "sundial"
                ? "Project Constellations"
                : "Project Portfolio & Velocity"}
            </h2>
            <p className="tabular-num">
              {visibleProjects.length}{" "}
              {archived ? "archived" : "active"} initiatives
            </p>
          </div>
        </div>
        <div className="wild-bar-right">
          <div className="bank-tabs" role="group" aria-label="Project status">
            <button
              type="button"
              className={!archived ? "active" : ""}
              onClick={() => setArchived(false)}
            >
              Active
            </button>
            <button
              type="button"
              className={archived ? "active" : ""}
              onClick={() => setArchived(true)}
            >
              Archived
            </button>
          </div>
          <button
            type="button"
            className="button primary small"
            onClick={() => edit({ kind: "project" })}
          >
            <Plus size={14} /> New project
          </button>
        </div>
      </header>

      {visibleProjects.length ? (
        <div className="wild-project-grid">
          {visibleProjects.map((p) => {
            const health = projectHealth(state, p);
            const done = p.milestones.filter((m) => m.completed).length;
            const pct = p.milestones.length
              ? Math.round((done / p.milestones.length) * 100)
              : 0;
            return (
              <article key={p.id} className="wild-project-card">
                <div className="wild-card-top">
                  <span className="wild-card-kicker tabular-num">
                    {health.label} · Due {formatDate(p.deadline)}
                  </span>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => setSelectedId(p.id)}
                  >
                    Open <ArrowUpRight size={13} />
                  </button>
                </div>
                <button
                  type="button"
                  className="plain"
                  onClick={() => setSelectedId(p.id)}
                >
                  <h3>{p.title}</h3>
                </button>
                <p className="wild-project-outcome">{p.outcome}</p>

                {experience === "sundial" ? (
                  <svg
                    viewBox="0 0 280 56"
                    className="sundial-constellation-svg"
                    aria-hidden="true"
                  >
                    <path
                      d="M 16 38 Q 140 8 264 28"
                      fill="none"
                      stroke="rgba(245,183,79,0.4)"
                      strokeWidth={1.6}
                      strokeDasharray="3 4"
                    />
                    {(p.milestones.length ? p.milestones : [{ id: "end", completed: false, approved: true }]).map(
                      (m, idx, arr) => {
                        const x =
                          arr.length === 1
                            ? 140
                            : 24 + (idx / (arr.length - 1)) * 232;
                        const y = 32 - Math.sin((x / 280) * Math.PI) * 18;
                        return (
                          <circle
                            key={m.id}
                            cx={x}
                            cy={y}
                            r={m.completed ? 6 : 5}
                            fill={
                              m.completed
                                ? "#34D399"
                                : m.approved
                                  ? "#F5B74F"
                                  : "#090D16"
                            }
                            stroke="#F5B74F"
                            strokeWidth={1.6}
                          />
                        );
                      },
                    )}
                  </svg>
                ) : (
                  <div className="mission-progress-track">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                )}

                <div className="wild-project-foot tabular-num">
                  <span>
                    {done} of {p.milestones.length} milestones ({pct}%)
                  </span>
                  <span>{health.reason}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          title="No projects here yet."
          description="Start with an outcome, final deadline, and milestones."
          action={() => edit({ kind: "project" })}
          label="New project"
        />
      )}
    </div>
  );
}

/* ============================================================================
   3. DEADLINES — 5 Wild Structural Interpretations
   ============================================================================ */
export function WildDeadlinesView(props: WildWorkProps) {
  if (isExtraWildExperience(props.experience)) {
    return <ExtraWildDeadlinesView {...props} />;
  }
  if (isExtra2WildExperience(props.experience)) {
    return <Extra2WildDeadlinesView {...props} />;
  }
  const { experience, state, update, edit, notify } = props;
  const { today } = useAutoSlot(state, props.scheduleTask, edit, notify);
  const [showResolved, setShowResolved] = useState(false);
  const items = computeDeadlineUrgency(state, today, showResolved);

  const editItem = (item: DeadlineUrgencyItem) => {
    if (item.kind === "deadline") {
      edit({ kind: "deadline", id: item.id });
    } else {
      edit({
        kind: item.kind,
        id: item.id,
        projectId: item.kind === "milestone" ? (item.projectId ?? undefined) : undefined,
      });
    }
  };

  const toggleResolved = (item: DeadlineUrgencyItem) => {
    if (item.kind !== "deadline") return;
    const raw = state.deadlines.find((d) => d.id === item.id);
    if (raw) toggleDeadlineStatus(raw, update, notify);
  };

  /* --- TERMINAL: WATCHDOG // Chrono Table --- */
  if (experience === "terminal") {
    return (
      <div className="wild-terminal">
        <section className="terminal-ledger-box" aria-label="Deadline watchdog">
          <div className="terminal-box-head">
            <span>CHRONO_WATCHDOG // MARKERS ({items.length})</span>
            <div className="terminal-date-ops">
              <button
                type="button"
                onClick={() => setShowResolved((v) => !v)}
              >
                {showResolved ? "[HIDE_RESOLVED]" : "[SHOW_RESOLVED]"}
              </button>
              <button type="button" onClick={() => edit({ kind: "deadline" })}>
                [+NEW_MARKER]
              </button>
            </div>
          </div>
          {items.length ? (
            <div className="terminal-table-wrap">
              <table className="terminal-table tabular-num">
                <thead>
                  <tr>
                    <th>T-MINUS</th>
                    <th>DATE</th>
                    <th>KIND</th>
                    <th>LINKED</th>
                    <th>TITLE</th>
                    <th>OPS</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.key}
                      className={item.resolved ? "is-done" : ""}
                    >
                      <td>{item.countdownLabel.toUpperCase()}</td>
                      <td>{item.date}</td>
                      <td>{item.kind.toUpperCase()}</td>
                      <td>
                        {item.kind === "deadline"
                          ? `${item.linkedDone}/${item.linkedTotal}`
                          : "--"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="plain terminal-item-link"
                          onClick={() => editItem(item)}
                        >
                          {item.title}
                        </button>
                      </td>
                      <td className="terminal-row-ops">
                        {item.kind === "deadline" && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                edit({ kind: "task", deadlineId: item.id })
                              }
                            >
                              [+WORK]
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleResolved(item)}
                            >
                              {item.resolved ? "[REOPEN]" : "[RESOLVE]"}
                            </button>
                          </>
                        )}
                        <button type="button" onClick={() => editItem(item)}>
                          [EDIT]
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="terminal-empty">0 UPCOMING MARKERS</p>
          )}
        </section>
      </div>
    );
  }

  /* --- RETRO98: Deadline_Tracker.exe --- */
  if (experience === "retro98") {
    return (
      <div className="wild-retro98-single">
        <section className="retro98-window" aria-label="Deadline Tracker">
          <div className="retro98-titlebar">
            <span>Deadline_Tracker.exe</span>
            <div className="retro98-win-btns" aria-hidden="true">
              <span>_</span>
              <span>□</span>
              <span>×</span>
            </div>
          </div>
          <div className="retro98-menubar">
            <button type="button" onClick={() => edit({ kind: "deadline" })}>
              New Marker...
            </button>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
              Show resolved
            </label>
          </div>
          <div className="retro98-inset-pane">
            {items.length ? (
              <table className="retro98-table tabular-num">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Marker</th>
                    <th>Kind</th>
                    <th>Linked Work</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.key}>
                      <td>{item.countdownLabel}</td>
                      <td>{formatDate(item.date)}</td>
                      <td>
                        <button
                          type="button"
                          className="plain retro98-title-btn"
                          onClick={() => editItem(item)}
                        >
                          {item.title}
                        </button>
                      </td>
                      <td>{item.kind}</td>
                      <td>
                        {item.kind === "deadline"
                          ? `${item.linkedDone}/${item.linkedTotal}`
                          : item.projectTitle || "—"}
                      </td>
                      <td className="retro98-row-ops">
                        {item.kind === "deadline" && (
                          <>
                            <button
                              type="button"
                              className="retro98-btn"
                              onClick={() =>
                                edit({ kind: "task", deadlineId: item.id })
                              }
                            >
                              Link
                            </button>
                            <button
                              type="button"
                              className="retro98-btn"
                              onClick={() => toggleResolved(item)}
                            >
                              {item.resolved ? "Reopen" : "Resolve"}
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="retro98-btn"
                          onClick={() => editItem(item)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="retro98-empty">No active deadlines.</p>
            )}
          </div>
        </section>
      </div>
    );
  }

  /* --- SUNDIAL / TIMELINE / MISSION: Banded Horizon Trajectory & Cue Strip --- */
  const bands: { key: string; title: string; filter: (i: DeadlineUrgencyItem) => boolean }[] = [
    {
      key: "immediate",
      title: "Immediate & Past Due",
      filter: (i) => i.band === "overdue" || i.band === "today",
    },
    {
      key: "soon",
      title: "Next 7 Days",
      filter: (i) => i.band === "soon",
    },
    {
      key: "horizon",
      title: "Horizon & Resolved",
      filter: (i) => i.band === "horizon" || i.band === "resolved",
    },
  ];

  return (
    <div className={`wild-deadlines is-${experience}`}>
      <header className={`wild-bar ${experience}-bar`}>
        <div className="wild-bar-left">
          <div>
            <h2>
              {experience === "sundial"
                ? "Orbital Deadlines"
                : experience === "timeline"
                  ? "Mastering Cue Markers"
                  : "Deadline Radar"}
            </h2>
            <p className="tabular-num">
              {items.length} date markers across assignments &amp; milestones
            </p>
          </div>
        </div>
        <div className="wild-bar-right">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            Show resolved
          </label>
          <button
            type="button"
            className="button primary small"
            onClick={() => edit({ kind: "deadline" })}
          >
            <Plus size={14} /> New deadline
          </button>
        </div>
      </header>

      {items.length ? (
        <div className="wild-deadline-bands">
          {bands.map((b) => {
            const list = items.filter(b.filter);
            if (!list.length) return null;
            return (
              <section key={b.key} className="wild-deadline-band">
                <div className="wild-subhead">
                  <h3>{b.title}</h3>
                  <span className="tabular-num">{list.length}</span>
                </div>
                <div className="wild-deadline-rows">
                  {list.map((item) => (
                    <article
                      key={item.key}
                      className={
                        "wild-deadline-card " +
                        item.band +
                        (item.resolved ? " is-resolved" : "")
                      }
                    >
                      <div className="wild-dl-countdown tabular-num">
                        <strong>{item.countdownLabel}</strong>
                        <small>{formatDate(item.date)}</small>
                      </div>
                      <div className="wild-dl-main">
                        <button
                          type="button"
                          className="plain"
                          onClick={() => editItem(item)}
                        >
                          <h3>{item.title}</h3>
                        </button>
                        <p className="wild-dl-meta">
                          {item.kind === "deadline"
                            ? `${item.linkedDone} of ${item.linkedTotal} linked tasks done`
                            : item.projectTitle
                              ? `${item.projectTitle} · ${item.kind}`
                              : item.kind}
                          {item.time ? " · " + displayTime(item.time) : ""}
                        </p>
                      </div>
                      <div className="wild-dl-actions">
                        {item.kind === "deadline" && (
                          <>
                            <button
                              type="button"
                              className="button secondary small"
                              onClick={() =>
                                edit({ kind: "task", deadlineId: item.id })
                              }
                            >
                              Link work
                            </button>
                            <button
                              type="button"
                              className="button secondary small"
                              onClick={() => toggleResolved(item)}
                            >
                              {item.resolved ? "Reopen" : "Resolve"}
                            </button>
                          </>
                        )}
                        <IconButton
                          label={"Edit " + item.title}
                          onClick={() => editItem(item)}
                        >
                          <MoreHorizontal size={16} />
                        </IconButton>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Empty
          title="Horizon is clear."
          description="Add a deadline marker or project milestone to track approaching dates."
          action={() => edit({ kind: "deadline" })}
          label="New deadline"
        />
      )}
    </div>
  );
}

/* ============================================================================
   4. ROUTINES — 5 Wild Structural Interpretations
   ============================================================================ */
export function WildRoutinesView(props: WildWorkProps) {
  if (isExtraWildExperience(props.experience)) {
    return <ExtraWildRoutinesView {...props} />;
  }
  if (isExtra2WildExperience(props.experience)) {
    return <Extra2WildRoutinesView {...props} />;
  }
  const { experience, state, update, edit, notify, setOutcome } = props;
  const { today } = useAutoSlot(state, props.scheduleTask, edit, notify);
  const [deleting, setDeleting] = useState<string | null>(null);
  const items = computeRoutineCadenceSummary(state, today);

  const toggleTodayRoutine = (item: RoutineCadenceItem) => {
    setOutcome(
      "routine",
      item.routine.id,
      today,
      item.todayOutcome === "completed" ? "pending" : "completed",
    );
  };

  function renderDeleteConfirm(item: RoutineCadenceItem) {
    if (deleting !== item.routine.id) {
      return (
        <button
          type="button"
          className="button secondary small danger"
          onClick={() => setDeleting(item.routine.id)}
        >
          <Trash2 size={13} /> Delete
        </button>
      );
    }
    return (
      <div
        className="routine-delete-confirm"
        role="group"
        aria-label={`Delete ${item.routine.title}`}
      >
        <p>Keep past occurrences, or delete history?</p>
        <div className="routine-delete-buttons">
          <button
            type="button"
            className="text-button danger"
            onClick={() => {
              deleteRoutineKeepPast(item.routine, today, update, notify);
              setDeleting(null);
            }}
          >
            Keep past
          </button>
          <button
            type="button"
            className="text-button danger"
            onClick={() => {
              deleteRoutineAll(item.routine, update, notify);
              setDeleting(null);
            }}
          >
            Delete all
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setDeleting(null)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  /* --- 4A. TIMELINE: TR-808 7-Day Habit Step Sequencer --- */
  if (experience === "timeline") {
    return (
      <div className="wild-timeline">
        <header className="wild-bar timeline-bar">
          <div className="wild-bar-left">
            <div>
              <h2>Habit Step Sequencer · Weekly Pattern</h2>
              <p className="tabular-num">
                {items.filter((i) => !i.routine.paused).length} active loops ·
                Click today&apos;s step pad to record completion
              </p>
            </div>
          </div>
          <div className="wild-bar-right">
            <button
              type="button"
              className="button primary small"
              onClick={() => edit({ kind: "routine" })}
            >
              <Plus size={14} /> New loop
            </button>
          </div>
        </header>

        {items.length ? (
          <section className="timeline-sequencer-grid" aria-label="7-day routine sequencer">
            <div className="timeline-seq-head tabular-num">
              <span>ROUTINE TRACK</span>
              <div className="timeline-seq-days">
                {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <span>CONTROLS</span>
            </div>
            {items.map((item) => {
              const r = item.routine;
              return (
                <div
                  key={r.id}
                  className={
                    "timeline-seq-row " + (r.paused ? "is-paused" : "")
                  }
                >
                  <button
                    type="button"
                    className="plain timeline-seq-title"
                    onClick={() => edit({ kind: "routine", id: r.id })}
                  >
                    <strong>{r.title}</strong>
                    <small className="tabular-num">
                      {item.startLabel} · {durationLabel(r.duration)} ·{" "}
                      {item.daysPerWeek}d/wk
                    </small>
                  </button>
                  <div className="timeline-seq-pads">
                    {item.weeklyMask.map((slot) => {
                      const todayDone =
                        slot.isToday && item.todayOutcome === "completed";
                      return (
                        <button
                          type="button"
                          key={slot.dayIndex}
                          disabled={!slot.isToday}
                          className={
                            "timeline-seq-pad " +
                            (slot.active ? "is-lit " : "") +
                            (slot.isToday ? "is-today " : "") +
                            (todayDone ? "is-checked" : "")
                          }
                          title={
                            slot.isToday
                              ? `Toggle ${r.title} for today`
                              : slot.shortLabel
                          }
                          onClick={() => slot.isToday && toggleTodayRoutine(item)}
                        >
                          {todayDone ? <Check size={12} /> : slot.shortLabel}
                        </button>
                      );
                    })}
                  </div>
                  <div className="timeline-seq-ops">
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => toggleRoutinePaused(r, today, update, notify)}
                    >
                      {r.paused ? "Resume" : "Pause"}
                    </button>
                    {renderDeleteConfirm(item)}
                  </div>
                </div>
              );
            })}
          </section>
        ) : (
          <Empty
            title="No routine loops yet."
            description="Create a repeating routine to see its weekly pattern."
            action={() => edit({ kind: "routine" })}
            label="New routine"
          />
        )}
      </div>
    );
  }

  /* --- 4B. TERMINAL: CRON_TAB // Recurring Daemon Schedule --- */
  if (experience === "terminal") {
    return (
      <div className="wild-terminal">
        <section className="terminal-ledger-box" aria-label="Crontab routine schedule">
          <div className="terminal-box-head">
            <span>CRON_TAB // RECURRING DAEMONS ({items.length})</span>
            <button type="button" onClick={() => edit({ kind: "routine" })}>
              [+ADD_CRON]
            </button>
          </div>
          {items.length ? (
            <div className="terminal-table-wrap">
              <table className="terminal-table tabular-num">
                <thead>
                  <tr>
                    <th>SCHEDULE</th>
                    <th>CADENCE</th>
                    <th>14D</th>
                    <th>DAEMON</th>
                    <th>OPS</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const r = item.routine;
                    const daysStr = item.weeklyMask
                      .filter((d) => d.active)
                      .map((d) => d.shortLabel.toUpperCase())
                      .join(",");
                    const doneToday = item.todayOutcome === "completed";
                    return (
                      <tr key={r.id} className={r.paused ? "is-done" : ""}>
                        <td>
                          {r.untimed ? "* * *" : item.startLabel} ({durationLabel(r.duration)})
                        </td>
                        <td>{daysStr || "NONE"}</td>
                        <td>{item.recentCompleted}x</td>
                        <td>
                          <button
                            type="button"
                            className="plain terminal-item-link"
                            onClick={() => edit({ kind: "routine", id: r.id })}
                          >
                            {r.title} {r.paused ? "[PAUSED]" : ""}
                          </button>
                        </td>
                        <td className="terminal-row-ops">
                          <button
                            type="button"
                            onClick={() => toggleTodayRoutine(item)}
                          >
                            {doneToday ? "[DONE✓]" : "[RUN_NOW]"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              toggleRoutinePaused(r, today, update, notify)
                            }
                          >
                            {r.paused ? "[RESUME]" : "[PAUSE]"}
                          </button>
                          <button
                            type="button"
                            onClick={() => edit({ kind: "routine", id: r.id })}
                          >
                            [EDIT]
                          </button>
                          {deleting === r.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  deleteRoutineKeepPast(r, today, update, notify);
                                  setDeleting(null);
                                }}
                              >
                                [KEEP_HIST]
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  deleteRoutineAll(r, update, notify);
                                  setDeleting(null);
                                }}
                              >
                                [PURGE]
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleting(null)}
                              >
                                [ESC]
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeleting(r.id)}
                            >
                              [RM]
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
            <p className="terminal-empty">CRONTAB EMPTY // PRESS [+ADD_CRON]</p>
          )}
        </section>
      </div>
    );
  }

  /* --- 4C. RETRO98: Scheduled_Tasks.exe --- */
  if (experience === "retro98") {
    return (
      <div className="wild-retro98-single">
        <section className="retro98-window" aria-label="Scheduled Tasks">
          <div className="retro98-titlebar">
            <span>Scheduled_Tasks.exe</span>
            <div className="retro98-win-btns" aria-hidden="true">
              <span>_</span>
              <span>□</span>
              <span>×</span>
            </div>
          </div>
          <div className="retro98-menubar">
            <button type="button" onClick={() => edit({ kind: "routine" })}>
              Add Scheduled Task...
            </button>
          </div>
          <div className="retro98-inset-pane">
            {items.length ? (
              <table className="retro98-table tabular-num">
                <thead>
                  <tr>
                    <th>Today</th>
                    <th>Job Name</th>
                    <th>Window</th>
                    <th>Days</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const r = item.routine;
                    return (
                      <tr key={r.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={item.todayOutcome === "completed"}
                            aria-label={`Complete ${r.title} today`}
                            onChange={() => toggleTodayRoutine(item)}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="plain retro98-title-btn"
                            onClick={() => edit({ kind: "routine", id: r.id })}
                          >
                            {r.title}
                          </button>
                        </td>
                        <td>
                          {item.startLabel} ({durationLabel(r.duration)})
                        </td>
                        <td>
                          {item.weeklyMask
                            .filter((d) => d.active)
                            .map((d) => d.shortLabel)
                            .join(", ")}
                        </td>
                        <td>{r.paused ? "Paused" : "Active"}</td>
                        <td className="retro98-row-ops">
                          <button
                            type="button"
                            className="retro98-btn"
                            onClick={() =>
                              toggleRoutinePaused(r, today, update, notify)
                            }
                          >
                            {r.paused ? "Resume" : "Pause"}
                          </button>
                          <button
                            type="button"
                            className="retro98-btn"
                            onClick={() => edit({ kind: "routine", id: r.id })}
                          >
                            Edit
                          </button>
                          {deleting === r.id ? (
                            <>
                              <button
                                type="button"
                                className="retro98-btn"
                                onClick={() => {
                                  deleteRoutineKeepPast(r, today, update, notify);
                                  setDeleting(null);
                                }}
                              >
                                Keep past
                              </button>
                              <button
                                type="button"
                                className="retro98-btn"
                                onClick={() => {
                                  deleteRoutineAll(r, update, notify);
                                  setDeleting(null);
                                }}
                              >
                                Purge
                              </button>
                              <button
                                type="button"
                                className="retro98-btn"
                                onClick={() => setDeleting(null)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="retro98-btn"
                              onClick={() => setDeleting(r.id)}
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="retro98-empty">No scheduled routines yet.</p>
            )}
          </div>
        </section>
      </div>
    );
  }

  /* --- 4D. SUNDIAL (Circadian 24h Habit Ring) & MISSION (Today Habit Deck + Cadence Matrix) --- */
  const timedItems = items.filter((i) => !i.routine.paused && i.startMinute !== null);
  const todayScheduled = items.filter((i) => i.todayScheduled);

  return (
    <div className={`wild-routines is-${experience}`}>
      <header className={`wild-bar ${experience}-bar`}>
        <div className="wild-bar-left">
          <div>
            <h2>
              {experience === "sundial"
                ? "Circadian Cadence Ring"
                : "Habit & Routine Deck"}
            </h2>
            <p className="tabular-num">
              {todayScheduled.length} scheduled today ·{" "}
              {todayScheduled.filter((i) => i.todayOutcome === "completed").length}{" "}
              completed today
            </p>
          </div>
        </div>
        <div className="wild-bar-right">
          <button
            type="button"
            className="button primary small"
            onClick={() => edit({ kind: "routine" })}
          >
            <Plus size={14} /> New routine
          </button>
        </div>
      </header>

      <div className="wild-routines-layout">
        {experience === "sundial" ? (
          <section className="sundial-orb-panel" aria-label="24-hour routine anchors">
            <svg viewBox="0 0 320 320" className="sundial-work-svg">
              <circle
                cx={160}
                cy={160}
                r={120}
                fill="none"
                stroke="rgba(148,163,184,0.18)"
                strokeWidth={1.5}
              />
              <circle
                cx={160}
                cy={160}
                r={68}
                fill="rgba(15,23,42,0.88)"
                stroke="rgba(245,183,79,0.35)"
              />
              {timedItems.map((item) => {
                const startM = item.startMinute!;
                const endM = startM + Math.max(20, item.routine.duration);
                const pt = solarPoint(160, 160, 128, startM);
                return (
                  <g key={item.routine.id}>
                    <path
                      d={solarRingWedgePath(160, 160, 74, 114, startM, endM)}
                      fill="rgba(52,211,153,0.32)"
                      stroke="#34D399"
                      strokeWidth={1.5}
                      className="sundial-work-wedge"
                      onClick={() =>
                        edit({ kind: "routine", id: item.routine.id })
                      }
                    >
                      <title>
                        {item.routine.title} · {item.startLabel}
                      </title>
                    </path>
                    <circle cx={pt.x} cy={pt.y} r={3.5} fill="#F5B74F" />
                  </g>
                );
              })}
              <text
                x={160}
                y={152}
                textAnchor="middle"
                className="sundial-hub-kicker"
              >
                ANCHORS
              </text>
              <text
                x={160}
                y={178}
                textAnchor="middle"
                className="sundial-hub-clock"
              >
                {items.filter((i) => !i.routine.paused).length}
              </text>
            </svg>
          </section>
        ) : (
          <section className="mission-hero-stage" aria-label="Today's habit check-in">
            <div className="mission-hero-left" style={{ width: "100%" }}>
              <span className="mission-hero-kicker">TODAY&apos;S RITUALS</span>
              <div className="mission-today-habits">
                {todayScheduled.length ? (
                  todayScheduled.map((item) => {
                    const done = item.todayOutcome === "completed";
                    return (
                      <button
                        type="button"
                        key={item.routine.id}
                        className={"mission-habit-chip " + (done ? "is-done" : "")}
                        onClick={() => toggleTodayRoutine(item)}
                      >
                        {done ? <Check size={14} /> : <Repeat2 size={14} />}
                        <span>{item.routine.title}</span>
                        <small className="tabular-num">{item.startLabel}</small>
                      </button>
                    );
                  })
                ) : (
                  <p className="mission-muted">
                    No active routines anchor today.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        <div className="wild-routine-cards">
          {items.length ? (
            items.map((item) => {
              const r = item.routine;
              const doneToday = item.todayOutcome === "completed";
              return (
                <article
                  key={r.id}
                  className={"wild-routine-card " + (r.paused ? "is-paused" : "")}
                >
                  <div className="wild-card-top">
                    <span className="wild-card-kicker tabular-num">
                      {r.paused ? "Paused" : `${item.daysPerWeek}d/wk`} ·{" "}
                      {item.recentCompleted} in 14d
                    </span>
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => edit({ kind: "routine", id: r.id })}
                    >
                      Edit
                    </button>
                  </div>
                  <h3>{r.title}</h3>
                  <p className="wild-detail-meta tabular-num">
                    <Clock3 size={13} /> {item.startLabel} ·{" "}
                    {durationLabel(r.duration)}
                  </p>
                  <div className="routine-days">
                    {item.weeklyMask.map((slot) => (
                      <span
                        key={slot.dayIndex}
                        className={slot.active ? "active" : ""}
                      >
                        {slot.shortLabel}
                      </span>
                    ))}
                  </div>
                  <div className="wild-routine-actions">
                    <button
                      type="button"
                      className={
                        "button small " + (doneToday ? "primary" : "secondary")
                      }
                      onClick={() => toggleTodayRoutine(item)}
                    >
                      <Check size={13} />
                      {doneToday ? "Done today" : "Check today"}
                    </button>
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() =>
                        toggleRoutinePaused(r, today, update, notify)
                      }
                    >
                      {r.paused ? <Play size={13} /> : <Pause size={13} />}
                      {r.paused ? "Resume" : "Pause"}
                    </button>
                    {renderDeleteConfirm(item)}
                  </div>
                </article>
              );
            })
          ) : (
            <Empty
              title="No routines yet."
              description="Anchor recurring walks, workouts, or study blocks."
              action={() => edit({ kind: "routine" })}
              label="Add routine"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   5. PROGRESS — 5 Wild Structural Interpretations
   ============================================================================ */
export function WildProgressView(props: WildProgressProps) {
  if (isExtraWildExperience(props.experience)) {
    return <ExtraWildProgressView {...props} />;
  }
  if (isExtra2WildExperience(props.experience)) {
    return <Extra2WildProgressView {...props} />;
  }
  const { experience, state, update, api, aiReady, initialDate } = props;
  const [date, setDate] = useState(() => initialDate ?? workspaceDay(state));
  const [tab, setTab] = useState<"today" | "week" | "history">("today");
  const [editing, setEditing] = useState(false);

  const review = state.reviews
    .filter((r) => r.date === date)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const sortedReviews = [...state.reviews].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  const dialog = editing && (
    <DailyReviewDialog
      state={state}
      date={date}
      aiReady={aiReady}
      api={api}
      update={update}
      onClose={() => setEditing(false)}
    />
  );

  /* --- 5A. RETRO98: Notepad_Log.exe --- */
  if (experience === "retro98") {
    return (
      <div className="wild-retro98-single">
        {dialog}
        <section className="retro98-window" aria-label="Progress Notepad Log">
          <div className="retro98-titlebar">
            <span>Notepad_Log.exe — {formatDate(date)}</span>
            <div className="retro98-win-btns" aria-hidden="true">
              <span>_</span>
              <span>□</span>
              <span>×</span>
            </div>
          </div>
          <div className="retro98-menubar">
            <button type="button" onClick={() => setEditing(true)}>
              Write Entry...
            </button>
            <button type="button" onClick={() => setTab("today")}>
              Daily Log
            </button>
            <button type="button" onClick={() => setTab("week")}>
              7-Day Stream
            </button>
            <button type="button" onClick={() => setTab("history")}>
              Archive ({sortedReviews.length})
            </button>
            <span className="spacer" />
            <input
              type="date"
              aria-label="Review date"
              max={workspaceDay(state)}
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </div>
          <div className="retro98-inset-pane">
            {tab === "today" ? (
              review ? (
                <Report review={review} />
              ) : (
                <p className="retro98-empty">
                  No log recorded for {formatDate(date)}. Click &quot;Write Entry...&quot;
                  to create a verified record.
                </p>
              )
            ) : tab === "week" ? (
              <WeeklyProgress state={state} date={date} />
            ) : sortedReviews.length ? (
              <div className="history-list">
                {sortedReviews.map((r) => (
                  <details key={r.id} className="history-item">
                    <summary>
                      <strong>{formatDate(r.date)}</strong>
                    </summary>
                    <Report review={r} />
                  </details>
                ))}
              </div>
            ) : (
              <p className="retro98-empty">Archive is empty.</p>
            )}
          </div>
        </section>
      </div>
    );
  }

  /* --- 5B. TERMINAL: /var/log/daylight Stream --- */
  if (experience === "terminal") {
    return (
      <div className="wild-terminal">
        {dialog}
        <section className="terminal-cli-box">
          <div className="terminal-box-head">
            <span>VAR_LOG // PROGRESS JOURNAL ({sortedReviews.length} RECORDS)</span>
            <div className="terminal-date-ops">
              <button type="button" onClick={() => setTab("today")}>
                [TODAY]
              </button>
              <button type="button" onClick={() => setTab("week")}>
                [7D_ACCUM]
              </button>
              <button type="button" onClick={() => setTab("history")}>
                [ALL_LOGS]
              </button>
              <button type="button" onClick={() => setEditing(true)}>
                [+WRITE_ENTRY]
              </button>
            </div>
          </div>
          <div className="terminal-cli-status">
            <span>TARGET_DATE: {date}</span>
            <input
              type="date"
              aria-label="Review date"
              max={workspaceDay(state)}
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              style={{ width: "auto" }}
            />
          </div>
        </section>
        {tab === "today" ? (
          review ? (
            <Report review={review} />
          ) : (
            <section className="terminal-ledger-box">
              <p className="terminal-empty">
                NO RECORD AT {date} // CLICK [+WRITE_ENTRY]
              </p>
            </section>
          )
        ) : tab === "week" ? (
          <WeeklyProgress state={state} date={date} />
        ) : (
          <div className="history-list">
            {sortedReviews.map((r) => (
              <details key={r.id} className="history-item">
                <summary>
                  <span>
                    <FileText size={14} /> <strong>{r.date}</strong>
                  </span>
                  <span>{r.source.toUpperCase()}</span>
                </summary>
                <Report review={r} />
              </details>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* --- 5C. SUNDIAL / TIMELINE / MISSION: 2-Column Logbook & Archive --- */
  return (
    <div className={`wild-progress is-${experience}`}>
      {dialog}
      <header className={`wild-bar ${experience}-bar`}>
        <div className="wild-bar-left">
          <div>
            <h2>
              {experience === "sundial"
                ? "Observatory Logbook"
                : experience === "timeline"
                  ? "Studio Liner Notes"
                  : "Reflection & Progress Deck"}
            </h2>
            <p className="tabular-num">
              {sortedReviews.length} confirmed daily records · Viewing{" "}
              {formatDate(date)}
            </p>
          </div>
        </div>
        <div className="wild-bar-right">
          <div className="bank-tabs" role="group" aria-label="Progress views">
            {(
              [
                ["today", "Daily"],
                ["week", "7-Day"],
                ["history", "Archive"],
              ] as const
            ).map(([k, label]) => (
              <button
                type="button"
                key={k}
                className={tab === k ? "active" : ""}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="date"
            aria-label="Review date"
            max={workspaceDay(state)}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            style={{ width: "auto" }}
          />
          <button
            type="button"
            className="button primary small"
            onClick={() => setEditing(true)}
          >
            <PenLine size={14} /> Write update
          </button>
        </div>
      </header>

      <div className="wild-progress-split">
        <div className="wild-progress-main">
          {tab === "today" ? (
            review ? (
              <Report review={review} />
            ) : (
              <Empty
                title={`No confirmed update for ${formatDate(date)}`}
                description="Write what moved forward in your own words to save a verified record."
                action={() => setEditing(true)}
                label="Write progress update"
              />
            )
          ) : tab === "week" ? (
            <WeeklyProgress state={state} date={date} />
          ) : (
            <div className="history-list">
              {sortedReviews.length ? (
                sortedReviews.map((r) => (
                  <details key={r.id} className="history-item">
                    <summary>
                      <span>
                        <FileText size={15} />
                        <strong>{formatDate(r.date)}</strong>
                      </span>
                      <Badge tone={r.source === "ai" ? "lavender" : "neutral"}>
                        {r.source === "ai" ? "AI" : "Manual"}
                      </Badge>
                    </summary>
                    <Report review={r} />
                  </details>
                ))
              ) : (
                <Empty
                  title="No saved records yet."
                  description="Your reflection log will build here over time."
                  action={() => setEditing(true)}
                  label="Write update"
                />
              )}
            </div>
          )}
        </div>

        <aside className="wild-progress-rail" aria-label="Recent entries">
          <div className="wild-subhead">
            <h3>Recent Records</h3>
            <span className="tabular-num">{sortedReviews.length}</span>
          </div>
          {sortedReviews.length ? (
            <div className="wild-recent-list">
              {sortedReviews.slice(0, 8).map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className={
                    "wild-recent-entry " + (r.date === date ? "is-active" : "")
                  }
                  onClick={() => {
                    setDate(r.date);
                    setTab("today");
                  }}
                >
                  <strong className="tabular-num">{formatDate(r.date)}</strong>
                  <span>
                    {typeof r.snapshot.daily_overview === "string"
                      ? r.snapshot.daily_overview.slice(0, 80)
                      : r.accomplishment.slice(0, 80)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">No saved daily records yet.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
