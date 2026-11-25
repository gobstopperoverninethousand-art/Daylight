"use client";
import { useState } from "react";
import {
  Plus,
  Search,
  ArrowUpRight,
  Check,
  Clock3,
  Flag,
  MoreHorizontal,
  Pause,
  Play,
  Repeat2,
  ChevronRight,
  Sparkles,
  FolderOpen,
  ArrowRight,
  GitBranch,
  Trash2,
} from "lucide-react";
import {
  State,
  Outcome,
  dayKey,
  formatDate,
  displayTime,
  durationLabel,
  audit,
  finishTask,
  hoursLabel,
  routineStart,
} from "@/lib/model";
import { projectHealth, scheduledTaskIds, taskDue } from "@/lib/engine";

import { EditorState } from "./editor";
import { Field, Badge, Empty, IconButton, SectionHead, DAYS } from "./ui";
import { deadlineEntries } from "@/lib/deadlines";
import { MilestoneFlow } from "./milestone-flow";
export type ViewProps = {
  state: State;
  update: (f: (s: State) => void) => void;
  edit: (m: EditorState) => void;
  notify: (s: string) => void;
};
export function Tasks({ state, update, edit, notify }: ViewProps) {
  const [filter, setFilter] = useState("active"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const scheduled = scheduledTaskIds(state);
  const tasks = state.tasks.filter(
    (t) =>
      !t.deletedProject &&
      (filter === "all" || filter === "completed"
        ? filter === "all" || t.status === "completed"
        : t.status === "active") &&
      (filter !== "unscheduled" || !scheduled.has(t.id)) &&
      (filter !== "missing" || t.estimate === null) &&
      t.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="list-panel">
        <div className="list-toolbar">
          <div className="tab-row">
            {[
              ["active", "Active"],
              ["unscheduled", "Unscheduled"],
              ["missing", "Needs estimate"],
              ["completed", "Completed"],
              ["all", "All"],
            ].map(([v, l]) => (
              <button
                key={v}
                className={filter === v ? "active" : ""}
                onClick={() => {
                  setFilter(v);
                  setPage(0);
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Search tasks"
              placeholder="Find a task…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        {tasks.length ? (
          <>
            <div className="task-table">
              <div className="task-table-head">
                <span>Task</span>
                <span>Estimated work</span>
                <span>Deadline</span>
                <span>Sessions</span>
                <span />
              </div>
              {tasks.slice(page * 10, page * 10 + 10).map((t) => {
                const p = state.projects.find((p) => p.id === t.projectId),
                  due = taskDue(state, t),
                  sessions = state.sessions.filter((s) => s.taskId === t.id);
                return (
                  <div className="task-table-row" key={t.id}>
                    <div className="task-cell">
                      <button
                        className={
                          "task-check " +
                          (t.status === "completed" ? "checked" : "")
                        }
                        aria-label={`${t.status === "completed" ? "Reopen" : "Complete"} ${t.title}`}
                        onClick={() => {
                          update((s) =>
                            finishTask(s, t.id, t.status !== "completed"),
                          );
                          notify(
                            t.status === "completed"
                              ? "Task reopened."
                              : "Task finished; pending sessions flagged for review.",
                          );
                        }}
                      >
                        {t.status === "completed" && <Check size={13} />}
                      </button>
                      <button
                        className="plain"
                        onClick={() => edit({ kind: "task", id: t.id })}
                      >
                        <strong
                          className={t.status === "completed" ? "strike" : ""}
                        >
                          {t.title}
                        </strong>
                        <small>
                          {p?.title || "Standalone task"}
                          {t.importance === "high" ? " · High importance" : ""}
                        </small>
                      </button>
                    </div>
                    <span className={t.estimate === null ? "amber-text" : ""}>
                      {durationLabel(t.remaining ?? t.estimate)}
                      <small>
                        {t.estimate !== null &&
                        t.remaining !== null &&
                        t.remaining !== t.estimate
                          ? "remaining · " +
                            durationLabel(t.estimate) +
                            " original"
                          : "user estimate"}
                      </small>
                    </span>
                    <span>
                      {due ? (
                        <Badge tone={due < dayKey() ? "peach" : "neutral"}>
                          {formatDate(due)}
                        </Badge>
                      ) : (
                        <span className="muted">No deadline</span>
                      )}
                    </span>
                    <span>
                      {sessions.length ? (
                        <span>
                          {
                            sessions.filter((s) => s.outcome === "completed")
                              .length
                          }{" "}
                          completed / {sessions.length}
                          <small>sessions, not task progress</small>
                        </span>
                      ) : (
                        <span className="muted">Not scheduled</span>
                      )}
                    </span>
                    <div className="row-actions">
                      {t.status === "active" && (
                        <IconButton
                          label={"Schedule " + t.title}
                          onClick={() =>
                            edit({ kind: "session", taskId: t.id })
                          }
                        >
                          <Plus size={16} />
                        </IconButton>
                      )}
                      <IconButton
                        label={"Edit " + t.title}
                        onClick={() => edit({ kind: "task", id: t.id })}
                      >
                        <MoreHorizontal size={18} />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
            <Pagination page={page} count={tasks.length} setPage={setPage} />
          </>
        ) : (
          <Empty
            title={
              query
                ? "Nothing matches that search."
                : filter === "completed"
                  ? "Good work will live here."
                  : "A little clarity starts here."
            }
            description={
              query
                ? "Try a different name."
                : "Add a task with your own rough estimate. The rest can wait."
            }
            action={() => edit({ kind: "task" })}
          />
        )}
      </div>
      <div className="quiet-note">
        <Clock3 size={15} />
        Finishing a session never automatically finishes a task. Mark the task
        done when the work is truly complete.
      </div>
    </>
  );
}
export function Deadlines({ state, update, edit, notify }: ViewProps) {
  const [showResolved, setShowResolved] = useState(false);
  const items = state.deadlines
    .filter((d) => showResolved || d.status === "active")
    .sort((a, b) => a.date.localeCompare(b.date));
  const projectDates = deadlineEntries(state)
    .filter(
      (entry) => entry.kind !== "deadline" && (showResolved || !entry.resolved),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <>
      <div className="section-head">
        <h2>
          Upcoming deadlines{" "}
          <span className="count">{items.length + projectDates.length}</span>
        </h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Show resolved
        </label>
      </div>
      {items.length || projectDates.length ? (
        <div className="deadline-grid">
          {items.map((d) => {
            const linked = state.tasks.filter((t) => t.deadlineId === d.id),
              done = linked.filter((t) => t.status === "completed").length;
            return (
              <article
                className={
                  "deadline-card " + (d.status === "resolved" ? "resolved" : "")
                }
                key={d.id}
              >
                <div className="deadline-date">
                  <span>
                    {formatDate(d.date, { month: "short" }).toUpperCase()}
                  </span>
                  <strong>{Number(d.date.slice(-2))}</strong>
                  <small>{formatDate(d.date, { weekday: "short" })}</small>
                </div>
                <div className="deadline-info">
                  <div className="card-topline">
                    <Badge
                      tone={
                        d.status === "resolved"
                          ? "sage"
                          : d.date < dayKey()
                            ? "peach"
                            : "neutral"
                      }
                    >
                      {d.status === "resolved"
                        ? "Resolved"
                        : d.date < dayKey()
                          ? "Past due"
                          : d.date === dayKey()
                            ? "Due today"
                            : "Upcoming"}
                    </Badge>
                    <IconButton
                      label={"Edit " + d.title}
                      onClick={() => edit({ kind: "deadline", id: d.id })}
                    >
                      <MoreHorizontal size={18} />
                    </IconButton>
                  </div>
                  <h3>{d.title}</h3>
                  <p>
                    {d.time ? displayTime(d.time) + " · " : ""}
                    {d.notes || "A date to work toward."}
                  </p>
                  <div className="deadline-meta">
                    {linked.length
                      ? `${done} of ${linked.length} linked tasks finished`
                      : "No linked tasks yet"}
                  </div>
                  {linked.length > 0 &&
                    done === linked.length &&
                    d.status !== "resolved" && (
                      <p className="sage-text small-text">
                        Linked work is finished. Review this deadline.
                      </p>
                    )}
                  <div className="card-actions">
                    <button
                      className="text-button"
                      onClick={() => edit({ kind: "task", deadlineId: d.id })}
                    >
                      Link work
                      <Plus size={13} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        update((s) => {
                          s.deadlines.find((x) => x.id === d.id)!.status =
                            d.status === "resolved" ? "active" : "resolved";
                          audit(
                            s,
                            "Deadline " +
                              (d.status === "resolved"
                                ? "reopened"
                                : "resolved by user"),
                            d.id,
                          );
                        });
                        notify(
                          "Deadline updated. Its calendar marker is preserved.",
                        );
                      }}
                    >
                      {d.status === "resolved" ? "Reopen" : "Mark resolved"}
                      <Check size={13} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          {projectDates.map((entry) => (
            <article
              className={"deadline-card " + (entry.resolved ? "resolved" : "")}
              key={entry.kind + ":" + entry.id}
            >
              <div className="deadline-date">
                <span>
                  {formatDate(entry.date, { month: "short" }).toUpperCase()}
                </span>
                <strong>{Number(entry.date.slice(-2))}</strong>
                <small>{formatDate(entry.date, { weekday: "short" })}</small>
              </div>
              <div className="deadline-info">
                <div className="card-topline">
                  <Badge tone={entry.resolved ? "sage" : "lavender"}>
                    {entry.resolved
                      ? "Resolved"
                      : entry.kind === "milestone"
                        ? "Milestone"
                        : "Project deadline"}
                  </Badge>
                  <IconButton
                    label={"Edit " + entry.title}
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
                    <MoreHorizontal size={18} />
                  </IconButton>
                </div>
                <h3>{entry.title}</h3>
                {entry.kind === "milestone" && (
                  <p>
                    {
                      state.projects.find(
                        (project) => project.id === entry.projectId,
                      )?.title
                    }
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="Nothing looming."
          description="Add an assignment, test, or deliverable. Link the tasks whenever you know what needs doing."
          action={() => edit({ kind: "deadline" })}
          label="Add a deadline"
        />
      )}
    </>
  );
}
export function Routines({ state, update, edit, notify }: ViewProps) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const routines = state.routines.filter((r) => !r.deletedAt);
  return (
    <>
      {routines.length ? (
        <div className="routine-grid">
          {routines.map((r) => (
            <article
              className={"routine-card " + (r.paused ? "paused" : "")}
              key={r.id}
            >
              <div className="card-topline">
                <span className={"routine-icon " + r.color}>
                  <Repeat2 size={20} />
                </span>
                <div className="row-actions">
                  <Badge tone={r.paused ? "neutral" : "sage"}>
                    {r.paused ? "Paused" : "Repeating"}
                  </Badge>
                  <IconButton
                    label={"Edit " + r.title}
                    onClick={() => edit({ kind: "routine", id: r.id })}
                  >
                    <MoreHorizontal size={18} />
                  </IconButton>
                </div>
              </div>
              <h3>{r.title}</h3>
              <p>
                <Clock3 size={14} />
                {r.untimed
                  ? "Any time"
                  : displayTime(routineStart(r, dayKey())) +
                    (r.timeSchedules?.some((schedule) =>
                      schedule.weekdays.some(Boolean),
                    )
                      ? " · varies by day"
                      : "") +
                    " · " +
                    durationLabel(r.duration)}
              </p>
              <div className="routine-days">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <span
                    title={DAYS[d]}
                    key={d}
                    className={r.days.includes(d) ? "active" : ""}
                  >
                    {DAYS[d].slice(0, 2)}
                  </span>
                ))}
              </div>
              <div className="routine-footer">
                <span>
                  From {formatDate(r.since)}
                  {r.until ? " · until " + formatDate(r.until) : ""}
                </span>
                <button
                  className="text-button"
                  onClick={() => {
                    update((s) => {
                      const routine = s.routines.find((x) => x.id === r.id)!;
                      const today = dayKey();
                      const periods =
                        routine.pausePeriods ??
                        (routine.paused
                          ? [
                              {
                                start:
                                  s.audit
                                    .filter(
                                      (a) =>
                                        a.recordId === r.id &&
                                        a.action === "Routine paused",
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
                      } else periods.push({ start: today, end: null });
                      routine.pausePeriods = periods;
                      routine.paused = !r.paused;
                      audit(
                        s,
                        r.paused ? "Routine resumed" : "Routine paused",
                        r.id,
                      );
                    });
                    notify(
                      r.paused
                        ? "Routine resumed."
                        : "Routine paused. Sync to update Google Calendar.",
                    );
                  }}
                >
                  {r.paused ? <Play size={13} /> : <Pause size={13} />}{" "}
                  {r.paused ? "Resume" : "Pause"}
                </button>
                {deleting === r.id ? (
                  <div role="group" aria-label={`Delete ${r.title}`}>
                    <p>
                      Keep past occurrences, or remove every occurrence
                      including history?
                    </p>
                    <button
                      className="text-button danger"
                      onClick={() => {
                        update((s) => {
                          const routine = s.routines.find(
                            (x) => x.id === r.id,
                          )!;
                          routine.deletedAt = dayKey();
                          audit(s, "Removed routine, kept history", r.id);
                        });
                        setDeleting(null);
                        notify(
                          "Routine removed; past occurrences kept. Sync to update Google Calendar.",
                        );
                      }}
                    >
                      Keep past
                    </button>{" "}
                    <button
                      className="text-button danger"
                      onClick={() => {
                        update((s) => {
                          s.routines = s.routines.filter((x) => x.id !== r.id);
                          s.routineRecords = s.routineRecords.filter(
                            (x) => x.routineId !== r.id,
                          );
                          s.exceptions = s.exceptions.filter(
                            (x) => x.routineId !== r.id,
                          );
                          audit(s, "Removed routine and history", r.id);
                        });
                        setDeleting(null);
                        notify(
                          "Routine and all occurrences removed. Sync to update Google Calendar.",
                        );
                      }}
                    >
                      Delete all
                    </button>{" "}
                    <button
                      className="text-button"
                      onClick={() => setDeleting(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="text-button danger"
                    onClick={() => setDeleting(r.id)}
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="Build a rhythm that works for you."
          description="A walk, a workout, language practice. Choose the days and time; Daylight saves the space."
          label="Add a routine"
          action={() => edit({ kind: "routine" })}
        />
      )}
      <div className="quiet-note">
        <Repeat2 size={15} />
        For a one-off change, open an occurrence in the planner. Completing one
        occurrence keeps the series going.
      </div>
    </>
  );
}
export function Projects({
  state,
  update,
  edit,
  notify,
  propose,
  proposeTasks,
  busy,
  aiReady,
}: {
  state: State;
  update: ViewProps["update"];
  edit: ViewProps["edit"];
  notify: ViewProps["notify"];
  propose: (id: string) => void;
  proposeTasks: (id: string, milestoneId: string) => void;
  busy: boolean;
  aiReady: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const visibleProjects = state.projects.filter(
    (p) => (p.status === "completed") === archived,
  );
  const [taskMilestone, setTaskMilestone] = useState("");
  const project = state.projects.find((p) => p.id === selected);
  const latestMilestoneProposal = state.aiRuns.findLast(
    (run) =>
      run.kind === "milestones" &&
      (run.snapshot.project as { id?: string } | undefined)?.id === project?.id,
  );
  const selectedTaskMilestone = project?.milestones.find(
    (m) => m.id === taskMilestone && m.approved && !m.completed,
  );
  const currentTasks = state.tasks.filter(
    (task) => task.projectId === project?.id && task.status === "active",
  );
  const currentWorkGroups = project
    ? [
        ...[...project.milestones]
          .sort(
            (a, b) =>
              a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
          )
          .map((milestone) => ({
            id: milestone.id,
            title: milestone.title,
            tasks: currentTasks.filter(
              (task) => task.milestoneId === milestone.id,
            ),
          })),
        {
          id: "unassigned",
          title: "No milestone",
          tasks: currentTasks.filter(
            (task) =>
              !project.milestones.some(
                (milestone) => milestone.id === task.milestoneId,
              ),
          ),
        },
      ].filter((group) => group.tasks.length > 0)
    : [];
  return (
    <>
      <div className="tab-row" aria-label="Project lists">
        {([false, true] as const).map((value) => (
          <button
            key={String(value)}
            className={value === archived ? "active" : ""}
            aria-pressed={value === archived}
            onClick={() => {
              setArchived(value);
              setSelected(null);
            }}
          >
            {value ? "Archived projects" : "Active projects"}
          </button>
        ))}
      </div>
      {project ? (
        <>
          <button
            className="text-button back-link"
            onClick={() => setSelected(null)}
          >
            ← All projects
          </button>
          <button
            className="button secondary small"
            onClick={() => edit({ kind: "project", id: project.id })}
          >
            Edit project
          </button>
          <div className="project-detail-grid">
            <div>
              <div className="project-summary panel">
                <div>
                  <span className="eyebrow">FINAL DELIVERABLE</span>
                  <h3>
                    {formatDate(project.deadline, {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </h3>
                  <p>
                    {project.startingPoint || "Starting point not recorded."}
                  </p>
                </div>
                <div>
                  <Badge
                    tone={
                      projectHealth(state, project).label === "At risk"
                        ? "peach"
                        : "sage"
                    }
                  >
                    {projectHealth(state, project).label}
                  </Badge>
                  <p>{projectHealth(state, project).reason}</p>
                </div>
              </div>
              <SectionHead
                title="The path forward"
                subtitle="Only approved dates become commitments."
                action={() =>
                  edit({ kind: "milestone", projectId: project.id })
                }
                label="Add milestone"
              />
              {project.milestones.length > 0 && (
                <MilestoneFlow
                  milestones={project.milestones}
                  onSelect={(id) =>
                    edit({ kind: "milestone", projectId: project.id, id })
                  }
                />
              )}
              <div className="milestone-list">
                {project.milestones.length ? (
                  project.milestones
                    .slice()
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((m, i) => (
                      <article
                        key={m.id}
                        className={
                          "milestone-card " + (!m.approved ? "draft" : "")
                        }
                      >
                        <div className="milestone-node">
                          {m.completed ? (
                            <Check size={17} />
                          ) : (
                            String(i + 1).padStart(2, "0")
                          )}
                        </div>
                        <div className="milestone-main">
                          <div className="card-topline">
                            <h3>{m.title}</h3>
                            <Badge
                              tone={
                                m.completed
                                  ? "sage"
                                  : m.approved
                                    ? "neutral"
                                    : "peach"
                              }
                            >
                              {m.completed
                                ? "Finished"
                                : m.approved
                                  ? "Approved"
                                  : "Draft · needs approval"}
                            </Badge>
                          </div>
                          <p>
                            {formatDate(m.date, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                            {m.estimate !== null
                              ? " · " + hoursLabel(m.estimate) + " workload"
                              : ""}
                            {m.timeBudgetMinutes != null
                              ? " · " +
                                hoursLabel(m.timeBudgetMinutes) +
                                " budget"
                              : ""}
                          </p>
                          {m.dependsOn.length > 0 && (
                            <small className="dependency-text">
                              <GitBranch size={12} />
                              After{" "}
                              {m.dependsOn
                                .map(
                                  (id) =>
                                    project.milestones.find((x) => x.id === id)
                                      ?.title,
                                )
                                .join(", ")}
                            </small>
                          )}
                          {m.reason && (
                            <p className="milestone-reason">{m.reason}</p>
                          )}
                          <div className="card-actions">
                            <button
                              className="text-button"
                              onClick={() =>
                                edit({
                                  kind: "milestone",
                                  projectId: project.id,
                                  id: m.id,
                                })
                              }
                            >
                              {m.approved
                                ? "Edit milestone"
                                : "Review & approve"}
                              <ArrowUpRight size={13} />
                            </button>
                            {m.approved && (
                              <button
                                className="text-button"
                                onClick={() => {
                                  if (
                                    !m.completed &&
                                    m.dependsOn.some(
                                      (id) =>
                                        !project.milestones.find(
                                          (x) => x.id === id,
                                        )?.completed,
                                    )
                                  ) {
                                    notify(
                                      "Finish or review the dependency milestones first.",
                                    );
                                    return;
                                  }
                                  update((s) => {
                                    s.projects
                                      .find((p) => p.id === project.id)!
                                      .milestones.find(
                                        (x) => x.id === m.id,
                                      )!.completed = !m.completed;
                                    audit(
                                      s,
                                      m.completed
                                        ? "Milestone reopened"
                                        : "Milestone deliverable confirmed complete",
                                      m.id,
                                    );
                                  });
                                }}
                              >
                                <Check size={13} />
                                {m.completed ? "Reopen" : "Mark delivered"}
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    ))
                ) : (
                  <Empty
                    title="What does the first meaningful step look like?"
                    description="Add a verifiable deliverable, then choose its target date."
                    label="Add a milestone"
                    action={() =>
                      edit({ kind: "milestone", projectId: project.id })
                    }
                  />
                )}
              </div>
            </div>
            <aside className="project-aside">
              <div className="panel ai-panel">
                <Sparkles size={22} />
                <h3>A second perspective.</h3>
                <p>
                  Ask AI for a small set of milestone proposals based on your
                  outcome, estimates, and calendar capacity.
                </p>
                {typeof latestMilestoneProposal?.output.summary ===
                  "string" && <p>{latestMilestoneProposal.output.summary}</p>}
                <button
                  className="button secondary"
                  disabled={busy || !aiReady}
                  onClick={() => propose(project.id)}
                >
                  {busy
                    ? "Considering your plan…"
                    : "Propose milestones with AI"}
                </button>
                <Field label="Milestone for task suggestions">
                  <select
                    value={selectedTaskMilestone?.id ?? ""}
                    onChange={(event) => setTaskMilestone(event.target.value)}
                  >
                    <option value="">Select a milestone</option>
                    {project.milestones
                      .filter((m) => m.approved && !m.completed)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title}
                        </option>
                      ))}
                  </select>
                </Field>
                <button
                  className="button secondary"
                  style={{ marginTop: 10 }}
                  disabled={busy || !aiReady || !selectedTaskMilestone}
                  onClick={() =>
                    selectedTaskMilestone &&
                    proposeTasks(project.id, selectedTaskMilestone.id)
                  }
                >
                  Suggest next tasks with AI
                </button>
                <small>
                  {aiReady
                    ? "Proposals stay drafts until you approve them."
                    : "Configure an AI provider and sign in to enable proposals."}
                </small>
              </div>
              <div className="panel">
                <SectionHead
                  title="Current work"
                  action={() => edit({ kind: "task", projectId: project.id })}
                  label="Add"
                />
                {currentWorkGroups.map((group) => (
                  <section className="project-work-group" key={group.id}>
                    <h4>{group.title}</h4>
                    {group.tasks.map((task) => (
                      <button
                        className="project-task"
                        key={task.id}
                        onClick={() => edit({ kind: "task", id: task.id })}
                      >
                        {task.title}
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </section>
                ))}
                {!currentTasks.length && (
                  <p>
                    No active tasks. Expand your current milestone when you’re
                    ready.
                  </p>
                )}
              </div>
              <button
                className="button secondary"
                onClick={() => {
                  update((s) => {
                    s.projects.find((p) => p.id === project.id)!.status =
                      project.status === "active" ? "completed" : "active";
                    audit(
                      s,
                      "Project " +
                        (project.status === "active"
                          ? "completed"
                          : "reopened"),
                      project.id,
                    );
                  });
                  setArchived(project.status === "active");
                  setSelected(null);
                  notify(
                    project.status === "active"
                      ? "Project archived."
                      : "Project reopened.",
                  );
                }}
              >
                {project.status === "active"
                  ? "Finish project"
                  : "Reopen project"}
              </button>
            </aside>
          </div>
        </>
      ) : visibleProjects.length ? (
        <div className="project-grid">
          {visibleProjects.map((p) => {
            const health = projectHealth(state, p),
              done = p.milestones.filter((m) => m.completed).length;
            return (
              <article key={p.id} className="project-card">
                <div className="card-topline">
                  <span className="project-icon">
                    <FolderOpen size={22} />
                  </span>
                  <Badge
                    tone={
                      health.label === "At risk"
                        ? "peach"
                        : health.label === "On track" ||
                            health.label === "Completed"
                          ? "sage"
                          : "neutral"
                    }
                  >
                    {health.label}
                  </Badge>
                </div>
                <button className="plain" onClick={() => setSelected(p.id)}>
                  <h3>{p.title}</h3>
                </button>
                <p>{p.outcome}</p>
                <div className="project-path">
                  {p.milestones.length ? (
                    p.milestones.map((m, i) => (
                      <span
                        key={m.id}
                        className={
                          "path-stop " +
                          (m.completed
                            ? "complete"
                            : !m.approved
                              ? "draft"
                              : "")
                        }
                        title={m.title}
                      >
                        {m.completed ? <Check size={12} /> : i + 1}
                      </span>
                    ))
                  ) : (
                    <span className="muted">
                      Your first milestone starts here.
                    </span>
                  )}
                </div>
                <div className="project-card-meta">
                  <span>
                    {done} of {p.milestones.length} milestones delivered
                  </span>
                  <span>
                    <Flag size={12} />
                    {formatDate(p.deadline)}
                  </span>
                </div>
                <p className="health-reason">{health.reason}</p>
                <button
                  className="project-open"
                  onClick={() => setSelected(p.id)}
                >
                  Open project
                  <ArrowUpRight size={16} />
                </button>
              </article>
            );
          })}
        </div>
      ) : archived ? (
        <p>No archived projects yet.</p>
      ) : (
        <Empty
          title="Give your next idea a home."
          description="Start with the outcome, the final deadline, and what you already know."
          action={() => edit({ kind: "project" })}
          label="Create a project"
        />
      )}
    </>
  );
}
export function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
  label,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action && (
        <button className="button primary" onClick={action}>
          <Plus size={16} />
          {label}
        </button>
      )}
    </div>
  );
}
function Pagination({
  page,
  count,
  setPage,
}: {
  page: number;
  count: number;
  setPage: (n: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {page * 10 + 1}–{Math.min(page * 10 + 10, count)} of {count} tasks
      </span>
      <div>
        <button
          disabled={!page}
          className="button small secondary"
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <button
          disabled={(page + 1) * 10 >= count}
          className="button small secondary"
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
