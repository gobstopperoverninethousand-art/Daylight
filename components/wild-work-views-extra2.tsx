"use client";
import { useState } from "react";
import {
  Check,
  FileText,
  Flag,
  Pause,
  PenLine,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  audit,
  defaultSessionDuration,
  displayTime,
  durationLabel,
  finishTask,
  formatDate,
  type Routine,
  type State,
  type Task,
} from "@/lib/model";
import { calendarEventIntervals, projectHealth, zonedParts } from "@/lib/engine";
import { workspaceDay } from "@/lib/ai-freshness";
import { findNextOpenSlot } from "@/lib/wild-planner";
import {
  classifyTaskBuckets,
  computeDeadlineUrgency,
  computeProjectTimelineSpans,
  computeRoutineCadenceSummary,
  type TaskBucketEntry,
} from "@/lib/work-view-models";
import { Empty } from "./ui";
import { MilestoneFlow } from "./milestone-flow";
import { DailyReviewDialog } from "./daily-review-dialog";
import { Report, WeeklyProgress } from "./review";
import type {
  WildProgressProps,
  WildProjectsProps,
  WildWorkProps,
} from "./wild-work-views";

export type Extra2ExperienceId = "constellation" | "synth" | "zine" | "arena";

export function isExtra2WildExperience(exp: string): exp is Extra2ExperienceId {
  return (
    exp === "constellation" ||
    exp === "synth" ||
    exp === "zine" ||
    exp === "arena"
  );
}

function useSlotAction2(
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

function togglePauseRoutine(
  r: Routine,
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
      const open = periods.findLast((p) => !p.end);
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

function toggleMilestone2(
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

function toggleDeadline2(
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

/* ============================================================================
   1. TASKS (Constellation Telemetry | Synth Patchbay | Zine Proof | Arena Reserve)
   ============================================================================ */
export function Extra2WildTasksView(props: WildWorkProps) {
  const { experience, state, update, edit, notify, scheduleTask } = props;
  const { today, slotTask } = useSlotAction2(state, scheduleTask, edit, notify);
  const buckets = classifyTaskBuckets(state, today);

  const [filter, setFilter] = useState<
    "active" | "unscheduled" | "missing" | "completed" | "all"
  >("active");
  const [query, setQuery] = useState("");

  const filtered: TaskBucketEntry[] = buckets.entries.filter((e) => {
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

  const toggleDone = (t: Task) => {
    update((s) => finishTask(s, t.id, t.status !== "completed"));
    notify(
      t.status === "completed" ? "Task moved back to active." : "Task completed.",
    );
  };

  const controls = (
    <div className="extra2-filter-strip">
      <div className="bank-tabs" role="group" aria-label="Task status filter">
        {(
          [
            ["active", "Active"],
            ["unscheduled", "Unscheduled"],
            ["missing", "Needs est."],
            ["completed", "Completed"],
            ["all", "All"],
          ] as const
        ).map(([k, label]) => (
          <button
            type="button"
            key={k}
            className={filter === k ? "active" : ""}
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="extra2-search-actions">
        <label className="search compact-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter tasks"
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
    </div>
  );

  const kicker =
    experience === "constellation"
      ? "DOCKING BAY TELEMETRY"
      : experience === "synth"
        ? "OSCILLATOR PATCH INVENTORY"
        : experience === "zine"
          ? "PROOF SHEET CUTOUTS"
          : "PIECE RESERVE & PAWN CHAIN";

  return (
    <div className={`extra2-work-shell extra2-tasks-${experience}`}>
      <header className="extra2-work-head">
        <div>
          <span className="extra2-kicker">{kicker}</span>
          <h1>Tasks</h1>
        </div>
        {controls}
      </header>

      {!filtered.length ? (
        <Empty
          title="No tasks match this filter."
          description="Try another filter or add a new task to populate this view."
          action={() => edit({ kind: "task" })}
          label="New task"
        />
      ) : experience === "constellation" ? (
        <div className="cosmos-table-wrap">
          <table className="cosmos-table">
            <thead>
              <tr>
                <th>OBJECT</th>
                <th>ORBIT / GROUP</th>
                <th>DUE DATE</th>
                <th>BURN EST.</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, idx) => (
                <tr key={e.task.id} className={e.task.status === "completed" ? "is-done" : ""}>
                  <td>
                    <button
                      type="button"
                      className="plain cosmos-row-title"
                      onClick={() => edit({ kind: "task", id: e.task.id })}
                    >
                      <span className="tabular-num">OBJ-{String(idx + 1).padStart(2, "0")}</span>
                      <strong>{e.task.title}</strong>
                    </button>
                  </td>
                  <td>{e.projectTitle || "Independent"}</td>
                  <td className="tabular-num">
                    {e.due
                      ? formatDate(e.due, { month: "short", day: "numeric" })
                      : "—"}
                  </td>
                  <td className="tabular-num">
                    {e.task.estimate ? durationLabel(e.task.estimate) : "—"}
                  </td>
                  <td>
                    <div className="extra2-row-btns">
                      {e.task.status === "active" && (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => slotTask(e.task)}
                        >
                          Schedule
                        </button>
                      )}
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => toggleDone(e.task)}
                      >
                        <Check size={12} />
                        {e.task.status === "completed" ? "Reopen" : "Complete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : experience === "synth" ? (
        <div className="synth-patch-grid">
          {filtered.map((e, idx) => (
            <article
              key={e.task.id}
              className={"synth-patch-card " + (e.task.status === "completed" ? "is-done" : "")}
            >
              <div className="synth-patch-head tabular-num">
                <span>MOD-{String(idx + 1).padStart(2, "0")}</span>
                <span>{e.task.estimate ? durationLabel(e.task.estimate) : "Unestimated"}</span>
              </div>
              <button
                type="button"
                className="plain synth-patch-title"
                onClick={() => edit({ kind: "task", id: e.task.id })}
              >
                <strong>{e.task.title}</strong>
                {e.projectTitle && <small>{e.projectTitle}</small>}
              </button>
              <div className="extra2-row-btns">
                {e.task.status === "active" && (
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => slotTask(e.task)}
                  >
                    Patch today
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => toggleDone(e.task)}
                >
                  {e.task.status === "completed" ? "Reopen" : "Complete"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : experience === "zine" ? (
        <div className="zine-tasks-collage">
          {filtered.map((e, idx) => (
            <article
              key={e.task.id}
              className={"zine-task-cutout " + (e.task.status === "completed" ? "is-done" : "")}
            >
              <div className="zine-clip-meta tabular-num">
                <span>ITEM #{idx + 1}</span>
                <span>
                  {e.task.estimate ? durationLabel(e.task.estimate) : "—"}
                  {e.due
                    ? ` · ${formatDate(e.due, { month: "short", day: "numeric" })}`
                    : ""}
                </span>
              </div>
              <button
                type="button"
                className="plain zine-cutout-head"
                onClick={() => edit({ kind: "task", id: e.task.id })}
              >
                <strong className={e.task.status === "completed" ? "strike" : ""}>
                  {e.task.title}
                </strong>
                {e.projectTitle && <small>{e.projectTitle}</small>}
              </button>
              <div className="extra2-row-btns">
                {e.task.status === "active" && (
                  <button
                    type="button"
                    className="button primary small"
                    onClick={() => slotTask(e.task)}
                  >
                    Schedule
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => toggleDone(e.task)}
                >
                  {e.task.status === "completed" ? "Reopen" : "Complete"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="arena-reserve-ledger">
          {filtered.map((e, idx) => (
            <div
              key={e.task.id}
              className={"arena-ledger-row " + (e.task.status === "completed" ? "is-done" : "")}
            >
              <span className="arena-piece-code tabular-num">
                {e.task.projectId ? "STRAT" : "PAWN"}·{idx + 1}
              </span>
              <button
                type="button"
                className="plain arena-ledger-main"
                onClick={() => edit({ kind: "task", id: e.task.id })}
              >
                <strong>{e.task.title}</strong>
                <small>
                  {e.projectTitle || "Independent"} ·{" "}
                  {e.task.estimate ? durationLabel(e.task.estimate) : "No estimate"}
                </small>
              </button>
              <div className="extra2-row-btns">
                {e.task.status === "active" && (
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => slotTask(e.task)}
                  >
                    Place today
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => toggleDone(e.task)}
                >
                  {e.task.status === "completed" ? "Reopen" : "Complete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   2. PROJECTS (Distinct Overview + Shared MilestoneFlow & AI Actions)
   ============================================================================ */
export function Extra2WildProjectsView(props: WildProjectsProps) {
  const { experience, state, update, edit, notify, propose, proposeTasks, busy, aiReady } =
    props;
  const { day: today } = zonedParts(new Date().toISOString(), state.settings.timezone);
  const activeProjects = state.projects.filter((p) => p.status === "active");
  const visibleProjects = activeProjects.length ? activeProjects : state.projects;
  const [selectedId, setSelectedId] = useState(visibleProjects[0]?.id || "");
  const [taskMilestone, setTaskMilestone] = useState("");

  const project =
    visibleProjects.find((p) => p.id === selectedId) ?? visibleProjects[0] ?? null;
  const timeline = computeProjectTimelineSpans(state, visibleProjects, today);

  if (!project) {
    return (
      <div className={`extra2-work-shell extra2-proj-${experience}`}>
        <header className="extra2-work-head">
          <h1>Projects</h1>
          <button
            type="button"
            className="button primary small"
            onClick={() => edit({ kind: "project" })}
          >
            <Plus size={14} /> New project
          </button>
        </header>
        <Empty
          title="No active projects."
          description="Create a project with milestones and a target deadline."
          action={() => edit({ kind: "project" })}
          label="New project"
        />
      </div>
    );
  }

  const health = projectHealth(state, project, today);
  const linkedTasks = state.tasks.filter(
    (t) => t.projectId === project.id && t.status === "active",
  );

  return (
    <div className={`extra2-work-shell extra2-proj-${experience}`}>
      <header className="extra2-work-head">
        <div>
          <span className="extra2-kicker">
            {experience === "constellation"
              ? "BINARY STAR SYSTEMS"
              : experience === "synth"
                ? "MULTI-VOICE SIGNAL CHAINS"
                : experience === "zine"
                  ? "PRINT SPREADS & COLOPHON"
                  : "CAMPAIGN ENDGAME CAMPAIGNS"}
          </span>
          <h1>Projects</h1>
        </div>
        <button
          type="button"
          className="button primary small"
          onClick={() => edit({ kind: "project" })}
        >
          <Plus size={14} /> New project
        </button>
      </header>

      {experience === "synth" ? (
        <section className="synth-signal-chains" aria-label="Project milestone signal chains">
          {visibleProjects.map((p, idx) => (
            <div
              key={p.id}
              className={"synth-chain-card " + (p.id === project.id ? "is-selected" : "")}
            >
              <button
                type="button"
                className="plain synth-chain-head"
                onClick={() => setSelectedId(p.id)}
              >
                <span className="tabular-num">VOICE {idx + 1}</span>
                <strong>{p.title}</strong>
                <small className="tabular-num">Due {formatDate(p.deadline, { month: "short", day: "numeric" })}</small>
              </button>
              <div className="synth-chain-nodes">
                {p.milestones.length ? (
                  p.milestones.map((m, mIdx) => (
                    <span
                      key={m.id}
                      className={"synth-chain-node " + (m.completed ? "is-done" : "")}
                    >
                      <strong>M{mIdx + 1}</strong> · {m.title}
                    </span>
                  ))
                ) : (
                  <span className="muted">No stages configured</span>
                )}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <div className="extra2-proj-selector" role="tablist" aria-label="Select project">
          {timeline.spans.map((span, idx) => (
            <button
              type="button"
              role="tab"
              aria-selected={span.id === project.id}
              key={span.id}
              className={"extra2-proj-pill " + (span.id === project.id ? "is-selected" : "")}
              onClick={() => setSelectedId(span.id)}
            >
              <span className="tabular-num">
                {experience === "constellation"
                  ? `SYS-${idx + 1}`
                  : experience === "zine"
                    ? `ISSUE #${idx + 1}`
                    : `MATCH ${idx + 1}`}
              </span>
              <strong>{span.title}</strong>
              <small className="tabular-num">
                {span.doneMilestones}/{span.totalMilestones} milestones
              </small>
            </button>
          ))}
        </div>
      )}

      <section className="extra2-proj-detail">
        <div className="extra2-proj-detail-head">
          <div>
            <h2>{project.title}</h2>
            <p>
              {project.outcome || "No outcome description."} · Deadline{" "}
              <strong className="tabular-num">{formatDate(project.deadline)}</strong> ·{" "}
              <span>{health.label}</span>
            </p>
          </div>
          <div className="extra2-row-btns">
            <button
              type="button"
              className="button secondary small"
              disabled={!aiReady || busy}
              onClick={() => propose(project.id)}
            >
              <Sparkles size={13} /> Propose milestones
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => edit({ kind: "milestone", projectId: project.id })}
            >
              <Plus size={13} /> Milestone
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => edit({ kind: "project", id: project.id })}
            >
              Edit project
            </button>
          </div>
        </div>

        <MilestoneFlow
          milestones={project.milestones}
          onSelect={(id) =>
            edit({ kind: "milestone", id, projectId: project.id })
          }
        />

        <div className="extra2-proj-subgrid">
          <div>
            <div className="extra2-subhead">
              <strong>Milestones</strong>
              <span className="tabular-num">{project.milestones.length}</span>
            </div>
            {project.milestones.length ? (
              <div className="extra2-list-stack">
                {project.milestones
                  .slice()
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((m) => (
                    <div key={m.id} className="extra2-list-row">
                      <button
                        type="button"
                        className={"task-check " + (m.completed ? "checked" : "")}
                        aria-label={`Toggle milestone ${m.title}`}
                        onClick={() => toggleMilestone2(project, m, update, notify)}
                      >
                        {m.completed && <Check size={12} />}
                      </button>
                      <button
                        type="button"
                        className="plain extra2-row-main"
                        onClick={() =>
                          edit({ kind: "milestone", id: m.id, projectId: project.id })
                        }
                      >
                        <strong className={m.completed ? "strike" : ""}>{m.title}</strong>
                        <small className="tabular-num">
                          {formatDate(m.date, { month: "short", day: "numeric" })} ·{" "}
                          {m.approved ? "Approved" : "Draft"}
                        </small>
                      </button>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="muted">No milestones yet.</p>
            )}
          </div>

          <div>
            <div className="extra2-subhead">
              <strong>Linked Active Tasks</strong>
              <div className="extra2-row-btns">
                {project.milestones.length > 0 && (
                  <select
                    aria-label="Draft tasks for milestone"
                    value={taskMilestone || project.milestones[0]?.id || ""}
                    onChange={(e) => setTaskMilestone(e.target.value)}
                  >
                    {project.milestones.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="button secondary small"
                  disabled={!aiReady || busy || !project.milestones.length}
                  onClick={() =>
                    proposeTasks(
                      project.id,
                      taskMilestone || project.milestones[0]!.id,
                    )
                  }
                >
                  <Sparkles size={12} /> Draft tasks
                </button>
              </div>
            </div>
            {linkedTasks.length ? (
              <div className="extra2-list-stack">
                {linkedTasks.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className="extra2-list-row is-clickable"
                    onClick={() => edit({ kind: "task", id: t.id })}
                  >
                    <strong>{t.title}</strong>
                    <small className="tabular-num">
                      {t.remaining !== null ? durationLabel(t.remaining) : "—"}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No linked active tasks yet.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ============================================================================
   3. DEADLINES
   ============================================================================ */
export function Extra2WildDeadlinesView(props: WildWorkProps) {
  const { experience, state, update, edit, notify } = props;
  const { day: today } = zonedParts(new Date().toISOString(), state.settings.timezone);
  const [showResolved, setShowResolved] = useState(false);
  const items = computeDeadlineUrgency(state, today, showResolved);

  return (
    <div className={`extra2-work-shell extra2-dl-${experience}`}>
      <header className="extra2-work-head">
        <div>
          <span className="extra2-kicker">
            {experience === "constellation"
              ? "IMPACT COUNTDOWN RADAR"
              : experience === "synth"
                ? "THRESHOLD COMPARATOR ALARMS"
                : experience === "zine"
                  ? "PRESS CUT-OFF DATES"
                  : "TOURNAMENT CLOCK TROUBLE"}
          </span>
          <h1>Deadlines</h1>
        </div>
        <div className="extra2-row-btns">
          <button
            type="button"
            className="button secondary small"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? "Hide resolved" : "Show resolved"}
          </button>
          <button
            type="button"
            className="button primary small"
            onClick={() => edit({ kind: "deadline" })}
          >
            <Plus size={14} /> New deadline
          </button>
        </div>
      </header>

      {!items.length ? (
        <Empty
          title="No open deadlines."
          description="Add a deadline to monitor upcoming due dates."
          action={() => edit({ kind: "deadline" })}
          label="New deadline"
        />
      ) : (
        <div className="extra2-deadline-grid">
          {items.map((item) => (
            <article
              key={item.key}
              className={`extra2-deadline-card band-${item.band} ${item.resolved ? "is-resolved" : ""}`}
            >
              <div className="extra2-dl-countdown tabular-num">
                <Flag size={13} aria-hidden="true" />
                <strong>{item.countdownLabel}</strong>
              </div>
              <button
                type="button"
                className="plain extra2-dl-main"
                onClick={() => {
                  if (item.kind === "deadline") {
                    edit({ kind: "deadline", id: item.id });
                  } else if (item.projectId) {
                    edit({ kind: "project", id: item.projectId });
                  }
                }}
              >
                <strong>{item.title}</strong>
                <small className="tabular-num">
                  {formatDate(item.date, { weekday: "short", month: "short", day: "numeric" })}
                  {item.time ? ` · ${displayTime(item.time)}` : ""}
                  {item.projectTitle ? ` · ${item.projectTitle}` : ""}
                </small>
              </button>
              {item.kind === "deadline" && (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => {
                    const dl = state.deadlines.find((x) => x.id === item.id);
                    if (dl) toggleDeadline2(dl, update, notify);
                  }}
                >
                  {item.resolved ? "Reopen" : "Resolve"}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   4. ROUTINES
   ============================================================================ */
export function Extra2WildRoutinesView(props: WildWorkProps) {
  const { experience, state, update, edit, notify, setOutcome } = props;
  const { day: today } = zonedParts(new Date().toISOString(), state.settings.timezone);
  const items = computeRoutineCadenceSummary(state, today);
  const [deleting, setDeleting] = useState<string | null>(null);

  const toggleToday = (item: (typeof items)[number]) => {
    const next = item.todayOutcome === "completed" ? "pending" : "completed";
    setOutcome("routine", item.routine.id, today, next);
    notify(next === "completed" ? "Routine checked off for today." : "Check-off cleared.");
  };

  return (
    <div className={`extra2-work-shell extra2-rt-${experience}`}>
      <header className="extra2-work-head">
        <div>
          <span className="extra2-kicker">
            {experience === "constellation"
              ? "PULSAR PERIODICITY TABLE"
              : experience === "synth"
                ? "LFO CLOCK DIVIDER"
                : experience === "zine"
                  ? "HABIT STAMP CARD"
                  : "OPENING REPERTOIRE"}
          </span>
          <h1>Routines</h1>
        </div>
        <button
          type="button"
          className="button primary small"
          onClick={() => edit({ kind: "routine" })}
        >
          <Plus size={14} /> New routine
        </button>
      </header>

      {!items.length ? (
        <Empty
          title="No recurring routines yet."
          description="Create a daily or weekly routine to track weekly cadence."
          action={() => edit({ kind: "routine" })}
          label="New routine"
        />
      ) : (
        <div className="extra2-routine-grid">
          {items.map((item) => (
            <article
              key={item.routine.id}
              className={"extra2-routine-card " + (item.routine.paused ? "is-paused" : "")}
            >
              <div className="extra2-rt-top">
                <button
                  type="button"
                  className="plain extra2-rt-title"
                  onClick={() => edit({ kind: "routine", id: item.routine.id })}
                >
                  <strong>{item.routine.title}</strong>
                  <small className="tabular-num">
                    {item.startLabel} · {durationLabel(item.routine.duration)} ·{" "}
                    {item.recentCompleted} checks (14d)
                  </small>
                </button>
                <button
                  type="button"
                  className={
                    "button small " +
                    (item.todayOutcome === "completed" ? "primary" : "secondary")
                  }
                  onClick={() => toggleToday(item)}
                >
                  <Check size={13} />
                  {item.todayOutcome === "completed" ? "Completed" : "Check today"}
                </button>
              </div>
              <div className="extra2-rt-days" aria-label="Weekly schedule">
                {item.weeklyMask.map((slot) => (
                  <span
                    key={slot.dayIndex}
                    className={
                      "extra2-day-cell" +
                      (slot.active ? " is-active" : "") +
                      (slot.isToday ? " is-today" : "")
                    }
                  >
                    {slot.shortLabel}
                  </span>
                ))}
              </div>
              <div className="extra2-row-btns">
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => togglePauseRoutine(item.routine, today, update, notify)}
                >
                  {item.routine.paused ? <Play size={12} /> : <Pause size={12} />}
                  {item.routine.paused ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => edit({ kind: "routine", id: item.routine.id })}
                >
                  Edit
                </button>
                {deleting === item.routine.id ? (
                  <>
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() => {
                        update((s) => {
                          const r = s.routines.find((x) => x.id === item.routine.id)!;
                          r.deletedAt = today;
                          audit(s, "Removed routine, kept history", item.routine.id);
                        });
                        notify("Routine removed; past occurrences kept.");
                        setDeleting(null);
                      }}
                    >
                      Keep past
                    </button>
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() => {
                        update((s) => {
                          s.routines = s.routines.filter((x) => x.id !== item.routine.id);
                          s.routineRecords = s.routineRecords.filter(
                            (x) => x.routineId !== item.routine.id,
                          );
                          s.exceptions = s.exceptions.filter(
                            (x) => x.routineId !== item.routine.id,
                          );
                          audit(s, "Removed routine and history", item.routine.id);
                        });
                        notify("Routine deleted.");
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
                  </>
                ) : (
                  <button
                    type="button"
                    className="button secondary small"
                    aria-label={`Remove ${item.routine.title}`}
                    onClick={() => setDeleting(item.routine.id)}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   5. PROGRESS (Shared DailyReviewDialog & WeeklyProgress wrapped cleanly)
   ============================================================================ */
export function Extra2WildProgressView(props: WildProgressProps) {
  const { experience, state, update, api, aiReady, initialDate } = props;
  const [date, setDate] = useState(() => initialDate ?? workspaceDay(state));
  const [tab, setTab] = useState<"today" | "week" | "history">("today");
  const [editing, setEditing] = useState(false);

  const sortedReviews = [...state.reviews].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const review = sortedReviews.find((r) => r.date === date);

  return (
    <div className={`extra2-work-shell extra2-pg-${experience}`}>
      {editing && (
        <DailyReviewDialog
          state={state}
          date={date}
          aiReady={aiReady}
          api={api}
          update={update}
          onClose={() => setEditing(false)}
        />
      )}

      <header className="extra2-work-head">
        <div>
          <span className="extra2-kicker">
            {experience === "constellation"
              ? "OBSERVATORY LOGBOOK"
              : experience === "synth"
                ? "SIGNAL SCOPE & DAILY LOG"
                : experience === "zine"
                  ? "PRINT ARCHIVE"
                  : "TOURNAMENT SCORE SHEET"}
          </span>
          <h1>Progress &amp; Review</h1>
        </div>
        <div className="extra2-filter-strip">
          <div className="bank-tabs" role="group" aria-label="Progress sections">
            {(
              [
                ["today", "Daily"],
                ["week", "7-Day"],
                ["history", "Archive"],
              ] as const
            ).map(([k, lbl]) => (
              <button
                type="button"
                key={k}
                className={tab === k ? "active" : ""}
                onClick={() => setTab(k)}
              >
                {lbl}
              </button>
            ))}
          </div>
          <input
            type="date"
            aria-label="Progress report date"
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
                title={`No saved update for ${formatDate(date)}`}
                description="Write a verified progress note for this date."
                action={() => setEditing(true)}
                label="Write update"
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
                      <span className="tabular-num">
                        {r.source === "ai" ? "AI" : "Manual"}
                      </span>
                    </summary>
                    <Report review={r} />
                  </details>
                ))
              ) : (
                <Empty
                  title="No saved records yet."
                  description="Your daily updates will build here over time."
                  action={() => setEditing(true)}
                  label="Write update"
                />
              )}
            </div>
          )}
        </div>

        <aside className="wild-progress-rail" aria-label="Recent records">
          <div className="wild-subhead">
            <h3>Recent Entries</h3>
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
            <p className="muted">No saved updates yet.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
