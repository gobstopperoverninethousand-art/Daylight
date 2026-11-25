"use client";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  Clock3,
  FileText,
  Flag,
  FolderOpen,
  Landmark,
  Pause,
  PenLine,
  Play,
  Plus,
  Repeat2,
  Ruler,
  Search,
  Sparkles,
  TrainFront,
  Trash2,
} from "lucide-react";
import {
  audit,
  durationLabel,
  finishTask,
  formatDate,
  type Routine,
  type State,
  type Task,
} from "@/lib/model";
import { projectHealth, zonedParts } from "@/lib/engine";
import { workspaceDay } from "@/lib/ai-freshness";
import { findNextOpenSlot } from "@/lib/wild-planner";
import { calendarEventIntervals } from "@/lib/engine";
import { defaultSessionDuration, displayTime } from "@/lib/model";
import {
  classifyTaskBuckets,
  computeDeadlineUrgency,
  computeProjectTimelineSpans,
  computeRoutineCadenceSummary,
  type DeadlineUrgencyItem,
  type RoutineCadenceItem,
  type TaskBucketEntry,
} from "@/lib/work-view-models";
import {
  computeHabitInkMatrix,
  computeProjectMetroStations,
} from "@/lib/wild-planner-extra";
import { Empty } from "./ui";
import { MilestoneFlow } from "./milestone-flow";
import { DailyReviewDialog } from "./daily-review-dialog";
import { Report, WeeklyProgress } from "./review";
import type {
  WildProgressProps,
  WildProjectsProps,
  WildWorkProps,
} from "./wild-work-views";

export type ExtraExperienceId = "transit" | "blueprint" | "notebook" | "gallery";

export function isExtraWildExperience(exp: string): exp is ExtraExperienceId {
  return (
    exp === "transit" ||
    exp === "blueprint" ||
    exp === "notebook" ||
    exp === "gallery"
  );
}

function useSlotAction(
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

function togglePause(
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

function toggleMilestone(
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

function toggleDeadline(
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
   1. TASKS — 4 Distinct Extra Experiences
   ============================================================================ */
export function ExtraWildTasksView(props: WildWorkProps) {
  const { experience, state, update, edit, notify, scheduleTask } = props;
  const { today, slotTask } = useSlotAction(state, scheduleTask, edit, notify);
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

  const sharedControls = (
    <div className="extra-filter-strip">
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
      <div className="extra-search-actions">
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

  /* --- 1A. TRANSIT: Route Dispatch Board --- */
  if (experience === "transit") {
    return (
      <div className="extra-work-shell transit-work">
        <header className="extra-work-head">
          <div>
            <span className="extra-kicker">ROUTE DISPATCH BOARD</span>
            <h1>System Tasks &amp; Sidings</h1>
          </div>
          {sharedControls}
        </header>

        {filtered.length ? (
          <div className="transit-dispatch-table">
            <div className="transit-dispatch-header tabular-num">
              <span>LINE</span>
              <span>DESTINATION / TASK</span>
              <span>DUE</span>
              <span>DURATION</span>
              <span>DISPATCH</span>
            </div>
            {filtered.map((entry, idx) => {
              const lineCode = entry.projectTitle
                ? "A2"
                : entry.task.importance === "high"
                  ? "R1"
                  : "B4";
              const lineHex = entry.projectTitle
                ? "#D97706"
                : entry.task.importance === "high"
                  ? "#DC2626"
                  : "#0284C7";
              const done = entry.task.status === "completed";
              return (
                <div
                  key={entry.task.id}
                  className={"transit-dispatch-row " + (done ? "is-done" : "")}
                >
                  <span className="transit-line-cell tabular-num">
                    <i style={{ backgroundColor: lineHex }}>{lineCode}</i>
                    <span>#{String(idx + 1).padStart(2, "0")}</span>
                  </span>
                  <button
                    type="button"
                    className="plain transit-task-name"
                    onClick={() => edit({ kind: "task", id: entry.task.id })}
                  >
                    <strong className={done ? "strike" : ""}>{entry.task.title}</strong>
                    {entry.projectTitle && <small>{entry.projectTitle}</small>}
                  </button>
                  <span className="tabular-num">
                    {entry.due
                      ? formatDate(entry.due, { month: "short", day: "numeric" })
                      : "—"}
                  </span>
                  <span className="tabular-num">
                    {entry.remainingMinutes !== null
                      ? durationLabel(entry.remainingMinutes)
                      : "Needs est."}
                  </span>
                  <div className="transit-row-actions">
                    {!done && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => slotTask(entry.task)}
                      >
                        Board today
                      </button>
                    )}
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => toggleDone(entry.task)}
                    >
                      <Check size={13} />
                      {done ? "Reopen" : "Complete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            title="No tasks match this route filter."
            description="Add a new task or broaden your line filter."
            action={() => edit({ kind: "task" })}
            label="Add task"
          />
        )}
      </div>
    );
  }

  /* --- 1B. BLUEPRINT: Bill of Materials / Spec Sheet --- */
  if (experience === "blueprint") {
    return (
      <div className="extra-work-shell blueprint-work">
        <header className="extra-work-head">
          <div>
            <span className="extra-kicker">BILL OF MATERIALS · SPECIFICATION INDEX</span>
            <h1>Work Specifications</h1>
          </div>
          {sharedControls}
        </header>

        {filtered.length ? (
          <div className="blueprint-spec-grid">
            {filtered.map((entry, idx) => {
              const done = entry.task.status === "completed";
              return (
                <article
                  key={entry.task.id}
                  className={"blueprint-spec-card " + (done ? "is-done" : "")}
                >
                  <div className="blueprint-spec-top tabular-num">
                    <span>SPEC-{String(idx + 1).padStart(2, "0")}</span>
                    <span>
                      {entry.task.importance === "high" ? "TOLERANCE: HIGH" : "STANDARD"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="plain blueprint-spec-link"
                    onClick={() => edit({ kind: "task", id: entry.task.id })}
                  >
                    <strong className={done ? "strike" : ""}>{entry.task.title}</strong>
                  </button>
                  <div className="blueprint-spec-meta tabular-num">
                    <span>
                      {entry.remainingMinutes !== null
                        ? durationLabel(entry.remainingMinutes)
                        : "Unestimated"}
                    </span>
                    <span>·</span>
                    <span>
                      {entry.due
                        ? `Cutoff ${formatDate(entry.due, { month: "short", day: "numeric" })}`
                        : "Open cutoff"}
                    </span>
                    {entry.projectTitle && (
                      <>
                        <span>·</span>
                        <span>{entry.projectTitle}</span>
                      </>
                    )}
                  </div>
                  <div className="blueprint-spec-footer">
                    {!done && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => slotTask(entry.task)}
                      >
                        Draft today
                      </button>
                    )}
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => toggleDone(entry.task)}
                    >
                      <Check size={13} /> {done ? "Reopen" : "Verify"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty
            title="No specifications in this view."
            description="Create a new task specification to draft onto your schedule."
            action={() => edit({ kind: "task" })}
            label="Add specification"
          />
        )}
      </div>
    );
  }

  /* --- 1C. NOTEBOOK: Bullet Journal Rapid Collection --- */
  if (experience === "notebook") {
    return (
      <div className="extra-work-shell notebook-work">
        <header className="extra-work-head">
          <div>
            <span className="extra-kicker">INDEX COLLECTION · RAPID TASK LOG</span>
            <h1>Task Collection</h1>
          </div>
          {sharedControls}
        </header>

        <div className="notebook-sheet-panel">
          {filtered.length ? (
            filtered.map((entry) => {
              const done = entry.task.status === "completed";
              return (
                <div
                  key={entry.task.id}
                  className={"notebook-line " + (done ? "is-done" : "")}
                >
                  <button
                    type="button"
                    className="notebook-signifier"
                    aria-label={`Toggle ${entry.task.title}`}
                    onClick={() => toggleDone(entry.task)}
                  >
                    {done ? "×" : "•"}
                  </button>
                  <button
                    type="button"
                    className="plain notebook-entry-title"
                    onClick={() => edit({ kind: "task", id: entry.task.id })}
                  >
                    <strong className={done ? "strike" : ""}>{entry.task.title}</strong>
                    <small className="tabular-num">
                      {entry.remainingMinutes !== null
                        ? durationLabel(entry.remainingMinutes)
                        : "no estimate"}
                      {entry.projectTitle ? ` · ${entry.projectTitle}` : ""}
                      {entry.due
                        ? ` · due ${formatDate(entry.due, { month: "short", day: "numeric" })}`
                        : ""}
                    </small>
                  </button>
                  {!done && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => slotTask(entry.task)}
                    >
                      <ArrowRight size={12} /> Schedule
                    </button>
                  )}
                </div>
              );
            })
          ) : (
            <Empty
              title="No entries on this page."
              description="Write a new task entry to add it to your collection."
              action={() => edit({ kind: "task" })}
              label="New entry"
            />
          )}
        </div>
      </div>
    );
  }

  /* --- 1D. GALLERY: Curatorial Catalogue Wall (3-Tier Salience) --- */
  const featured =
    filtered.find((e) => e.task.status === "active" && e.task.importance === "high") ??
    filtered.find((e) => e.task.status === "active") ??
    filtered[0] ??
    null;
  const catalogue = filtered.filter((e) => e.task.id !== featured?.task.id);

  return (
    <div className="extra-work-shell gallery-work">
      <header className="extra-work-head">
        <div>
          <span className="extra-kicker">CURATORIAL ARCHIVE · ACQUISITION LIST</span>
          <h1>Catalogue of Works</h1>
        </div>
        {sharedControls}
      </header>

      {featured ? (
        <>
          <section className="gallery-featured-placard">
            <div className="gallery-plaque-meta tabular-num">
              <span>LEAD ACQUISITION · FEATURED FOCUS</span>
              <span>
                {featured.remainingMinutes !== null
                  ? durationLabel(featured.remainingMinutes)
                  : "Unestimated"}
              </span>
            </div>
            <button
              type="button"
              className="plain gallery-featured-title"
              onClick={() => edit({ kind: "task", id: featured.task.id })}
            >
              <h2>{featured.task.title}</h2>
            </button>
            <p className="gallery-featured-sub">
              {featured.projectTitle || "Independent study"}
              {featured.due
                ? ` · Closing ${formatDate(featured.due, { month: "long", day: "numeric" })}`
                : ""}
            </p>
            <div className="gallery-plaque-actions">
              {featured.task.status === "active" && (
                <button
                  type="button"
                  className="button primary small"
                  onClick={() => slotTask(featured.task)}
                >
                  Place in today’s wing
                </button>
              )}
              <button
                type="button"
                className="button secondary small"
                onClick={() => toggleDone(featured.task)}
              >
                <Check size={13} />
                {featured.task.status === "completed" ? "Restore" : "Mark complete"}
              </button>
            </div>
          </section>

          <div className="gallery-catalogue-list">
            {catalogue.map((entry, idx) => {
              const done = entry.task.status === "completed";
              return (
                <article
                  key={entry.task.id}
                  className={"gallery-catalogue-row " + (done ? "is-done" : "")}
                >
                  <span className="gallery-acc-num tabular-num">
                    ACC.{String(idx + 2).padStart(2, "0")}
                  </span>
                  <button
                    type="button"
                    className="plain gallery-catalogue-link"
                    onClick={() => edit({ kind: "task", id: entry.task.id })}
                  >
                    <strong className={done ? "strike" : ""}>{entry.task.title}</strong>
                    <small className="tabular-num">
                      {entry.remainingMinutes !== null
                        ? durationLabel(entry.remainingMinutes)
                        : "Unestimated"}
                      {entry.projectTitle ? ` · ${entry.projectTitle}` : ""}
                    </small>
                  </button>
                  <div className="gallery-plaque-actions">
                    {!done && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => slotTask(entry.task)}
                      >
                        Schedule
                      </button>
                    )}
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => toggleDone(entry.task)}
                    >
                      <Check size={13} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <Empty
          title="No catalogue works in this filter."
          description="Acquire a new task to exhibit on your schedule."
          action={() => edit({ kind: "task" })}
          label="New acquisition"
        />
      )}
    </div>
  );
}

/* ============================================================================
   2. PROJECTS — 4 Distinct Extra Experiences
   ============================================================================ */
export function ExtraWildProjectsView(props: WildProjectsProps) {
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
  const { today } = useSlotAction(state, props.scheduleTask, edit, notify);
  const [archived, setArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskMilestone, setTaskMilestone] = useState("");

  const visibleProjects = state.projects.filter(
    (p) => (p.status === "completed") === archived,
  );
  const project =
    visibleProjects.find((p) => p.id === selectedId) ?? visibleProjects[0] ?? null;

  const projectControls = (
    <div className="extra-filter-strip">
      <div className="bank-tabs" role="group" aria-label="Project status filter">
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
  );

  if (!project) {
    return (
      <div className="extra-work-shell">
        <header className="extra-work-head">
          <div>
            <span className="extra-kicker">PROJECTS</span>
            <h1>{archived ? "Archived Projects" : "Active Projects"}</h1>
          </div>
          {projectControls}
        </header>
        <Empty
          title={archived ? "No archived projects" : "No active projects yet"}
          description="Create a project with an outcome and target deadline to map milestones."
          action={() => edit({ kind: "project" })}
          label="New project"
        />
      </div>
    );
  }

  const health = projectHealth(state, project);
  const timeline = computeProjectTimelineSpans(state, visibleProjects, today);
  const linkedTasks = state.tasks.filter(
    (t) => t.projectId === project.id && t.status === "active",
  );
  const metroStations = computeProjectMetroStations(project);

  return (
    <div className={`extra-work-shell extra-proj-${experience}`}>
      <header className="extra-work-head">
        <div>
          <span className="extra-kicker">
            {experience === "transit"
              ? "MULTI-STOP LINE DIRECTORY"
              : experience === "blueprint"
                ? "STRUCTURAL ELEVATION SHEETS"
                : experience === "notebook"
                  ? "PROJECT COLLECTION INDEX"
                  : "EXHIBITION MONOGRAPHS"}
          </span>
          <h1>Projects</h1>
        </div>
        {projectControls}
      </header>

      {/* Experience-unique top visualization per mode */}
      {experience === "transit" && (
        <section className="transit-project-map" aria-label="Project route lines">
          {visibleProjects.map((proj, pIdx) => {
            const stations = computeProjectMetroStations(proj);
            const active = proj.id === project.id;
            const hex = ["#DC2626", "#0284C7", "#059669", "#D97706"][pIdx % 4]!;
            return (
              <div
                key={proj.id}
                className={"transit-proj-route " + (active ? "is-selected" : "")}
                onClick={() => setSelectedId(proj.id)}
              >
                <div className="transit-proj-route-head">
                  <span className="transit-line-pill tabular-num" style={{ backgroundColor: hex }}>
                    L{pIdx + 1}
                  </span>
                  <strong>{proj.title}</strong>
                  <span className="tabular-num">
                    Terminus {formatDate(proj.deadline, { month: "short", day: "numeric" })}
                  </span>
                </div>
                <div className="transit-stations-strip">
                  {stations.map((st) => (
                    <div
                      key={st.id}
                      className={
                        "transit-stop-chip" +
                        (st.completed ? " is-done" : "") +
                        (st.isTerminus ? " is-terminus" : "")
                      }
                    >
                      <span
                        className="transit-stop-dot"
                        style={{
                          borderColor: hex,
                          backgroundColor: st.completed ? hex : "var(--paper)",
                        }}
                      />
                      <small className="tabular-num">{st.code}</small>
                      <span>{st.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {experience === "blueprint" && (
        <section className="blueprint-proj-spans" aria-label="Blueprint project timeline">
          {timeline.spans.map((span, idx) => (
            <button
              type="button"
              key={span.id}
              className={"blueprint-span-row " + (span.id === project.id ? "is-selected" : "")}
              onClick={() => setSelectedId(span.id)}
            >
              <div className="blueprint-span-meta tabular-num">
                <span>ELEV-{String(idx + 1).padStart(2, "0")}</span>
                <strong>{span.title}</strong>
                <span>
                  {span.doneMilestones}/{span.totalMilestones} milestones
                </span>
              </div>
              <div className="blueprint-span-track">
                <div
                  className="blueprint-span-bar"
                  style={{
                    left: `${span.startPct}%`,
                    width: `${Math.max(8, span.endPct - span.startPct)}%`,
                  }}
                />
              </div>
            </button>
          ))}
        </section>
      )}

      {(experience === "notebook" || experience === "gallery") && (
        <div className="extra-proj-tabs" role="tablist" aria-label="Select project">
          {visibleProjects.map((p, idx) => (
            <button
              type="button"
              role="tab"
              aria-selected={p.id === project.id}
              key={p.id}
              className={"extra-proj-tab " + (p.id === project.id ? "is-selected" : "")}
              onClick={() => setSelectedId(p.id)}
            >
              <span className="tabular-num">
                {experience === "notebook"
                  ? `p.${idx + 1}`
                  : `EXH.${String(idx + 1).padStart(2, "0")}`}
              </span>
              <strong>{p.title}</strong>
            </button>
          ))}
        </div>
      )}

      {/* Detailed selected project workspace preserving MilestoneFlow & AI proposals */}
      <section className="extra-proj-detail">
        <div className="extra-proj-detail-head">
          <div>
            <h2>{project.title}</h2>
            <p>
              {project.outcome || "No target outcome recorded."} · Deadline{" "}
              <strong className="tabular-num">{formatDate(project.deadline)}</strong> ·{" "}
              <span>{health.label}</span>
            </p>
          </div>
          <div className="extra-proj-actions">
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

        <div className="extra-proj-subgrid">
          <div>
            <div className="extra-subhead">
              <strong>Milestones</strong>
              <span className="tabular-num">{project.milestones.length}</span>
            </div>
            {project.milestones.length ? (
              <div className="extra-list-stack">
                {project.milestones
                  .slice()
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((m, i) => (
                    <div key={m.id} className="extra-list-row">
                      <button
                        type="button"
                        className={"task-check " + (m.completed ? "checked" : "")}
                        aria-label={`Toggle milestone ${m.title}`}
                        onClick={() => toggleMilestone(project, m, update, notify)}
                      >
                        {m.completed && <Check size={12} />}
                      </button>
                      <button
                        type="button"
                        className="plain extra-row-main"
                        onClick={() =>
                          edit({ kind: "milestone", id: m.id, projectId: project.id })
                        }
                      >
                        <strong className={m.completed ? "strike" : ""}>
                          {experience === "transit"
                            ? `${metroStations[i]?.code ?? ""} · ${m.title}`
                            : m.title}
                        </strong>
                        <small className="tabular-num">
                          {formatDate(m.date, { month: "short", day: "numeric" })} ·{" "}
                          {m.approved ? "Approved" : "Draft"}
                        </small>
                      </button>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="muted">No milestones added yet.</p>
            )}
          </div>

          <div>
            <div className="extra-subhead">
              <strong>Linked Active Tasks</strong>
              <div className="extra-inline-controls">
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
              <div className="extra-list-stack">
                {linkedTasks.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className="extra-list-row is-clickable"
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
              <p className="muted">No active tasks linked to this project.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ============================================================================
   3. DEADLINES — 4 Distinct Extra Experiences
   ============================================================================ */
export function ExtraWildDeadlinesView(props: WildWorkProps) {
  const { experience, state, update, edit, notify } = props;
  const { today } = useSlotAction(state, props.scheduleTask, edit, notify);
  const [showResolved, setShowResolved] = useState(false);
  const items = computeDeadlineUrgency(state, today, showResolved);

  const editEntry = (item: DeadlineUrgencyItem) => {
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

  const toggleEntryResolved = (item: DeadlineUrgencyItem) => {
    if (item.kind !== "deadline") return;
    const raw = state.deadlines.find((d) => d.id === item.id);
    if (raw) toggleDeadline(raw, update, notify);
  };

  return (
    <div className={`extra-work-shell extra-dl-${experience}`}>
      <header className="extra-work-head">
        <div>
          <span className="extra-kicker">
            {experience === "transit"
              ? "TERMINUS & EXPRESS SCHEDULE"
              : experience === "blueprint"
                ? "LOAD-BEARING CUTOFFS"
                : experience === "notebook"
                  ? "FUTURE LOG SPREAD"
                  : "OPENINGS & CLOSING DATES"}
          </span>
          <h1>Deadlines</h1>
        </div>
        <div className="extra-filter-strip">
          <label className="check-label">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            <span>Show resolved</span>
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
        <div className="extra-deadline-grid">
          {items.map((item) => (
            <article
              key={item.key}
              className={
                `extra-deadline-card band-${item.band}` +
                (item.resolved ? " is-resolved" : "")
              }
            >
              <div className="extra-dl-countdown tabular-num">
                <strong>{item.countdownLabel}</strong>
                <span>{formatDate(item.date, { month: "short", day: "numeric" })}</span>
              </div>
              <button
                type="button"
                className="plain extra-dl-main"
                onClick={() => editEntry(item)}
              >
                <strong className={item.resolved ? "strike" : ""}>{item.title}</strong>
                <small>
                  {item.kind === "deadline"
                    ? "Standalone deadline"
                    : item.projectTitle
                      ? `Project · ${item.projectTitle}`
                      : "Project cutoff"}
                  {item.linkedTotal > 0
                    ? ` · ${item.linkedDone}/${item.linkedTotal} linked tasks`
                    : ""}
                </small>
              </button>
              <div className="extra-dl-actions">
                {item.kind === "deadline" && (
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => toggleEntryResolved(item)}
                  >
                    <Check size={13} /> {item.resolved ? "Reopen" : "Resolve"}
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => editEntry(item)}
                >
                  Edit
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="No upcoming deadlines."
          description="Add a hard cutoff or milestone deadline to track clearance."
          action={() => edit({ kind: "deadline" })}
          label="New deadline"
        />
      )}
    </div>
  );
}

/* ============================================================================
   4. ROUTINES — 4 Distinct Extra Experiences (incl. 14-Day Habit Ink Matrix!)
   ============================================================================ */
export function ExtraWildRoutinesView(props: WildWorkProps) {
  const { experience, state, update, edit, notify, setOutcome } = props;
  const { today } = useSlotAction(state, props.scheduleTask, edit, notify);
  const items = computeRoutineCadenceSummary(state, today);
  const inkMatrix = computeHabitInkMatrix(state, today, 14);
  const [deleting, setDeleting] = useState<string | null>(null);

  const toggleToday = (item: RoutineCadenceItem) => {
    setOutcome(
      "routine",
      item.routine.id,
      today,
      item.todayOutcome === "completed" ? "pending" : "completed",
    );
  };

  function deleteControls(routine: Routine) {
    if (deleting !== routine.id) {
      return (
        <button
          type="button"
          className="button secondary small danger"
          onClick={() => setDeleting(routine.id)}
        >
          <Trash2 size={13} /> Delete
        </button>
      );
    }
    return (
      <div className="routine-delete-confirm">
        <button
          type="button"
          className="text-button danger"
          onClick={() => {
            update((s) => {
              const r = s.routines.find((x) => x.id === routine.id)!;
              r.deletedAt = today;
              audit(s, "Removed routine, kept history", routine.id);
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
              s.routines = s.routines.filter((x) => x.id !== routine.id);
              s.routineRecords = s.routineRecords.filter(
                (x) => x.routineId !== routine.id,
              );
              s.exceptions = s.exceptions.filter(
                (x) => x.routineId !== routine.id,
              );
              audit(s, "Removed routine and history", routine.id);
            });
            notify("Routine and all occurrences removed.");
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
    );
  }

  return (
    <div className={`extra-work-shell extra-rt-${experience}`}>
      <header className="extra-work-head">
        <div>
          <span className="extra-kicker">
            {experience === "notebook"
              ? "14-DAY HABIT INK TRACKER"
              : experience === "transit"
                ? "LOOP LINE TIMETABLE"
                : experience === "blueprint"
                  ? "REPEATING CADENCE MATRIX"
                  : "DOCENT DAILY PRACTICE WALL"}
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
          description="Create a daily or weekly routine to track cadence and check-offs."
          action={() => edit({ kind: "routine" })}
          label="New routine"
        />
      ) : experience === "notebook" ? (
        <section className="notebook-habit-matrix-wrap" aria-label="14-day habit ink matrix">
          <div className="notebook-habit-scroll">
            <table className="notebook-habit-table">
              <thead>
                <tr>
                  <th>HABIT / ROUTINE</th>
                  {inkMatrix.dates.map((d) => (
                    <th
                      key={d.date}
                      className={d.isToday ? "is-today" : ""}
                      title={d.date}
                    >
                      <span>{d.weekdayChar}</span>
                      <strong className="tabular-num">{d.dayNum}</strong>
                    </th>
                  ))}
                  <th>14D</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {inkMatrix.rows.map((row) => {
                  const summary = items.find((i) => i.routine.id === row.routine.id)!;
                  return (
                    <tr key={row.routine.id}>
                      <td>
                        <button
                          type="button"
                          className="plain notebook-habit-name"
                          onClick={() => edit({ kind: "routine", id: row.routine.id })}
                        >
                          <strong>{row.routine.title}</strong>
                          <small className="tabular-num">{summary.startLabel}</small>
                        </button>
                      </td>
                      {row.cells.map((cell) => (
                        <td
                          key={cell.date}
                          className={
                            "notebook-ink-cell" +
                            (cell.isToday ? " is-today" : "") +
                            (cell.scheduled ? " is-sched" : "")
                          }
                        >
                          {cell.isToday ? (
                            <button
                              type="button"
                              className={
                                "notebook-ink-box" +
                                (cell.outcome === "completed" ? " is-inked" : "")
                              }
                              aria-label={`Ink today for ${row.routine.title}`}
                              onClick={() => toggleToday(summary)}
                            >
                              {cell.outcome === "completed" ? "×" : "•"}
                            </button>
                          ) : (
                            <span
                              className={
                                "notebook-ink-dot" +
                                (cell.outcome === "completed"
                                  ? " is-inked"
                                  : cell.scheduled
                                    ? " is-scheduled"
                                    : "")
                              }
                            >
                              {cell.outcome === "completed"
                                ? "×"
                                : cell.scheduled
                                  ? "·"
                                  : ""}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="tabular-num">
                        {row.completedInWindow}/{Math.max(1, row.scheduledInWindow)}
                      </td>
                      <td>
                        <div className="notebook-habit-actions">
                          <button
                            type="button"
                            className="button secondary small"
                            onClick={() => togglePause(row.routine, today, update, notify)}
                          >
                            {row.routine.paused ? "Resume" : "Pause"}
                          </button>
                          {deleteControls(row.routine)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="extra-routine-grid">
          {items.map((item) => (
            <article
              key={item.routine.id}
              className={
                "extra-routine-card" + (item.routine.paused ? " is-paused" : "")
              }
            >
              <div className="extra-routine-top">
                <button
                  type="button"
                  className="plain extra-routine-title"
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
              <div className="extra-routine-days" aria-label="Operating days">
                {item.weeklyMask.map((slot) => (
                  <span
                    key={slot.dayIndex}
                    className={
                      "extra-day-cell" +
                      (slot.active ? " is-active" : "") +
                      (slot.isToday ? " is-today" : "")
                    }
                  >
                    {slot.shortLabel}
                  </span>
                ))}
              </div>
              <div className="extra-routine-actions">
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => togglePause(item.routine, today, update, notify)}
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
                {deleteControls(item.routine)}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   5. PROGRESS — 4 Distinct Extra Experiences
   ============================================================================ */
export function ExtraWildProgressView(props: WildProgressProps) {
  const { experience, state, update, api, aiReady, initialDate } = props;
  const [date, setDate] = useState(() => initialDate ?? workspaceDay(state));
  const [tab, setTab] = useState<"today" | "week" | "history">("today");
  const [editing, setEditing] = useState(false);

  const sortedReviews = [...state.reviews].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const review = sortedReviews.find((r) => r.date === date);

  const titleByExp: Record<ExtraExperienceId, { kicker: string; heading: string }> = {
    transit: { kicker: "DRIVER SERVICE LOG", heading: "Route Progress & Reviews" },
    blueprint: { kicker: "FIELD REVISION LEDGER", heading: "Inspection & Revisions" },
    notebook: { kicker: "DAILY REFLECTION PAGES", heading: "Journal Archive" },
    gallery: { kicker: "PROVENANCE & RETROSPECTIVE", heading: "Exhibition Logbook" },
  };
  const copy = titleByExp[experience as ExtraExperienceId] ?? titleByExp.gallery;

  return (
    <div className={`extra-work-shell extra-prog-${experience}`}>
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

      <header className="extra-work-head">
        <div>
          <span className="extra-kicker">{copy.kicker}</span>
          <h1>{copy.heading}</h1>
        </div>
        <div className="extra-filter-strip">
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
