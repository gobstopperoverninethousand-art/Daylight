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
  GitBranch,
  Trash2,
  Zap,
} from "lucide-react";
import {
  State,
  Outcome,
  Task,
  dayKey,
  formatDate,
  displayTime,
  durationLabel,
  defaultSessionDuration,
  audit,
  finishTask,
  hoursLabel,
} from "@/lib/model";
import {
  calendarEventIntervals,
  projectHealth,
  zonedParts,
} from "@/lib/engine";
import {
  DEFAULT_EXPERIENCE,
  type ExperienceId,
  isWildExperience,
} from "@/lib/experiences";
import { findNextOpenSlot } from "@/lib/wild-planner";
import {
  classifyTaskBuckets,
  computeDeadlineUrgency,
  computeRoutineCadenceSummary,
  type TaskBucketEntry,
} from "@/lib/work-view-models";
import { EditorState } from "./editor";
import { Badge, Empty, IconButton, SectionHead, Field } from "./ui";
import { MilestoneFlow } from "./milestone-flow";
import {
  WildDeadlinesView,
  WildProjectsView,
  WildRoutinesView,
  WildTasksView,
} from "./wild-work-views";

export type ViewProps = {
  state: State;
  update: (f: (s: State) => void) => void;
  edit: (m: EditorState) => void;
  notify: (s: string) => void;
  experience?: ExperienceId;
  scheduleTask?: (taskId: string, date: string, start: string) => void;
  setOutcome?: (kind: string, id: string, date: string, value: Outcome) => void;
  onNavigatePlanner?: () => void;
};

function useClassicSlot(
  state: State,
  scheduleTask: ViewProps["scheduleTask"],
  edit: ViewProps["edit"],
  notify: ViewProps["notify"],
) {
  const { day: today, minute: nowMinute } = zonedParts(
    new Date().toISOString(),
    state.settings.timezone,
  );
  return {
    today,
    slotTask(task: Task) {
      if (!scheduleTask) {
        edit({ kind: "session", taskId: task.id, date: today });
        return;
      }
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

export function Tasks(props: ViewProps) {
  const experience = props.experience ?? DEFAULT_EXPERIENCE;
  if (isWildExperience(experience)) {
    return (
      <WildTasksView
        experience={experience}
        state={props.state}
        update={props.update}
        edit={props.edit}
        notify={props.notify}
        scheduleTask={
          props.scheduleTask ??
          ((_, d) => props.edit({ kind: "session", date: d }))
        }
        setOutcome={props.setOutcome ?? (() => {})}
        onNavigatePlanner={props.onNavigatePlanner ?? (() => {})}
      />
    );
  }

  const { state, update, edit, notify } = props;
  const { today, slotTask } = useClassicSlot(
    state,
    props.scheduleTask,
    edit,
    notify,
  );
  const [filter, setFilter] = useState("active"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);

  const buckets = classifyTaskBuckets(state, today);
  const counts = {
    active: buckets.entries.filter((e) => e.task.status === "active").length,
    unscheduled: buckets.unscheduled.length,
    missing: buckets.needsEstimate.length,
    completed: buckets.completed.length,
    all: buckets.entries.length,
  };

  const matchQuery = (e: TaskBucketEntry) =>
    !query || e.task.title.toLowerCase().includes(query.toLowerCase());

  const filteredEntries = buckets.entries.filter((e) => {
    if (filter === "completed" && e.task.status !== "completed") return false;
    if (
      filter !== "all" &&
      filter !== "completed" &&
      e.task.status !== "active"
    )
      return false;
    if (filter === "unscheduled" && e.scheduled) return false;
    if (filter === "missing" && e.task.estimate !== null) return false;
    return matchQuery(e);
  });

  const toggleDone = (t: Task) => {
    update((s) => finishTask(s, t.id, t.status !== "completed"));
    notify(
      t.status === "completed"
        ? "Task reopened."
        : "Task finished; pending sessions flagged for review.",
    );
  };

  /* --- BAUHAUS: 2x2 Numbered Swiss Quadrants --- */
  if (experience === "bauhaus") {
    const quadrants = [
      {
        num: "01",
        label: "URGENT & HIGH IMPORTANCE",
        items: buckets.urgent.filter(matchQuery),
      },
      {
        num: "02",
        label: "UNSCHEDULED BACKLOG",
        items: buckets.unscheduled.filter(matchQuery),
      },
      {
        num: "03",
        label: "BOOKED ON CALENDAR",
        items: buckets.scheduled.filter(matchQuery),
      },
      {
        num: "04",
        label: "COMPLETED ARCHIVE",
        items: buckets.completed.filter(matchQuery),
      },
    ];
    return (
      <div className="classic-work is-bauhaus">
        <PageHeading
          eyebrow="02 / WORK QUEUE"
          title="Task Quadrants"
          subtitle="Structured across priority, unslotted effort, scheduled blocks, and archive."
          action={() => edit({ kind: "task" })}
          label="New task"
        />
        <div className="classic-toolbar-row">
          <label className="search">
            <Search size={15} />
            <input
              aria-label="Search tasks"
              placeholder="Filter all quadrants…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="bauhaus-quadrant-grid">
          {quadrants.map((q) => (
            <section key={q.num} className="bauhaus-quadrant">
              <div className="bauhaus-q-head">
                <span className="bauhaus-q-num tabular-num">{q.num}</span>
                <strong>{q.label}</strong>
                <span className="bauhaus-q-count tabular-num">
                  {q.items.length}
                </span>
              </div>
              {q.items.length ? (
                <div className="bauhaus-q-list">
                  {q.items.slice(0, 8).map((e) => (
                    <div key={e.task.id} className="bauhaus-q-row">
                      <button
                        type="button"
                        className={
                          "task-check " +
                          (e.task.status === "completed" ? "checked" : "")
                        }
                        aria-label={`Complete ${e.task.title}`}
                        onClick={() => toggleDone(e.task)}
                      >
                        {e.task.status === "completed" && <Check size={12} />}
                      </button>
                      <button
                        type="button"
                        className="plain bauhaus-q-title"
                        onClick={() => edit({ kind: "task", id: e.task.id })}
                      >
                        <span
                          className={
                            e.task.status === "completed" ? "strike" : ""
                          }
                        >
                          {e.task.title}
                        </span>
                        <small className="tabular-num">
                          {durationLabel(e.remainingMinutes)}
                          {e.due ? " · " + formatDate(e.due) : ""}
                        </small>
                      </button>
                      {e.task.status === "active" && (
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => slotTask(e.task)}
                        >
                          Slot
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Zero entries in {q.num}.</p>
              )}
            </section>
          ))}
        </div>
      </div>
    );
  }

  /* --- FLOW: 3-Stream Organic Horizon Board --- */
  if (experience === "flow") {
    const streams = [
      {
        title: "Needs an estimate",
        subtitle: "Add rough minutes before committing time",
        items: buckets.needsEstimate.filter(matchQuery),
      },
      {
        title: "Ready to focus",
        subtitle: "Estimated & waiting for an open calendar pocket",
        items: buckets.unscheduled
          .filter((e) => e.task.estimate !== null)
          .filter(matchQuery),
      },
      {
        title: "In calendar flow",
        subtitle: "Booked onto sessions or recently finished",
        items: [...buckets.scheduled, ...buckets.completed.slice(0, 5)].filter(
          matchQuery,
        ),
      },
    ];
    return (
      <div className="classic-work is-flow">
        <PageHeading
          eyebrow="FLOW STREAMS"
          title="Tasks"
          subtitle="Tasks move gently from unestimated notes into calendar sessions."
          action={() => edit({ kind: "task" })}
          label="New task"
        />
        <div className="classic-toolbar-row">
          <label className="search">
            <Search size={15} />
            <input
              aria-label="Search tasks"
              placeholder="Find in streams…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="flow-task-streams">
          {streams.map((stream) => (
            <section key={stream.title} className="flow-stream-col">
              <div className="flow-stream-head">
                <div>
                  <h3>{stream.title}</h3>
                  <small>{stream.subtitle}</small>
                </div>
                <span className="tabular-num">{stream.items.length}</span>
              </div>
              <div className="flow-stream-cards">
                {stream.items.length ? (
                  stream.items.map((e) => (
                    <article key={e.task.id} className="flow-stream-card">
                      <div className="flow-card-top">
                        <button
                          type="button"
                          className={
                            "task-check " +
                            (e.task.status === "completed" ? "checked" : "")
                          }
                          aria-label={`Complete ${e.task.title}`}
                          onClick={() => toggleDone(e.task)}
                        >
                          {e.task.status === "completed" && <Check size={12} />}
                        </button>
                        <button
                          type="button"
                          className="plain flow-card-title"
                          onClick={() => edit({ kind: "task", id: e.task.id })}
                        >
                          <strong
                            className={
                              e.task.status === "completed" ? "strike" : ""
                            }
                          >
                            {e.task.title}
                          </strong>
                        </button>
                      </div>
                      <div className="flow-card-meta tabular-num">
                        <span>{durationLabel(e.remainingMinutes)}</span>
                        {e.projectTitle && <span>· {e.projectTitle}</span>}
                        {e.due && <span>· Due {formatDate(e.due)}</span>}
                      </div>
                      {e.task.status === "active" && (
                        <div className="flow-card-actions">
                          <button
                            type="button"
                            className="button secondary small"
                            onClick={() => slotTask(e.task)}
                          >
                            <Zap size={12} /> Auto-slot
                          </button>
                          <button
                            type="button"
                            className="button secondary small"
                            onClick={() =>
                              edit({ kind: "session", taskId: e.task.id })
                            }
                          >
                            Book
                          </button>
                        </div>
                      )}
                    </article>
                  ))
                ) : (
                  <p className="muted">Nothing waiting here.</p>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  /* --- ZEN: Centered Nocturnal/Paper Focus Sheet --- */
  if (experience === "zen") {
    const spotlight =
      buckets.urgent[0] ?? buckets.unscheduled[0] ?? filteredEntries[0] ?? null;
    return (
      <div className="classic-work is-zen zen-centered-sheet">
        <PageHeading
          eyebrow="QUIET BACKLOG"
          title="Tasks"
          subtitle="Pick one clear intention at a time."
          action={() => edit({ kind: "task" })}
          label="New task"
        />
        {spotlight && spotlight.task.status === "active" && (
          <section className="zen-spotlight-card" aria-label="Next clear task">
            <span className="eyebrow">ONE CLEAR NEXT STEP</span>
            <div className="zen-spotlight-body">
              <div>
                <h2>{spotlight.task.title}</h2>
                <p className="tabular-num">
                  {durationLabel(spotlight.remainingMinutes)}
                  {spotlight.projectTitle ? " · " + spotlight.projectTitle : ""}
                  {spotlight.due ? " · Due " + formatDate(spotlight.due) : ""}
                </p>
              </div>
              <div className="zen-spotlight-actions">
                <button
                  type="button"
                  className="button primary small"
                  onClick={() => slotTask(spotlight.task)}
                >
                  <Zap size={13} /> Place in today
                </button>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => edit({ kind: "task", id: spotlight.task.id })}
                >
                  Edit
                </button>
              </div>
            </div>
          </section>
        )}
        <div className="zen-filter-bar">
          <div className="tab-row" role="group" aria-label="Task filters">
            {(
              [
                ["active", "Active", counts.active],
                ["unscheduled", "Unslotted", counts.unscheduled],
                ["completed", "Done", counts.completed],
                ["all", "All", counts.all],
              ] as const
            ).map(([v, l, n]) => (
              <button
                type="button"
                key={v}
                className={filter === v ? "active" : ""}
                onClick={() => setFilter(v)}
              >
                {l} <span className="tab-count">{n}</span>
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={14} />
            <input
              aria-label="Search tasks"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="zen-task-list">
          {filteredEntries.length ? (
            filteredEntries.map((e) => (
              <div key={e.task.id} className="zen-task-line">
                <button
                  type="button"
                  className={
                    "task-check " +
                    (e.task.status === "completed" ? "checked" : "")
                  }
                  aria-label={`Complete ${e.task.title}`}
                  onClick={() => toggleDone(e.task)}
                >
                  {e.task.status === "completed" && <Check size={12} />}
                </button>
                <button
                  type="button"
                  className="plain zen-task-name"
                  onClick={() => edit({ kind: "task", id: e.task.id })}
                >
                  <strong className={e.task.status === "completed" ? "strike" : ""}>
                    {e.task.title}
                  </strong>
                  <small className="tabular-num">
                    {e.projectTitle || "Standalone"} ·{" "}
                    {durationLabel(e.remainingMinutes)}
                  </small>
                </button>
                {e.task.status === "active" && (
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => slotTask(e.task)}
                  >
                    Slot
                  </button>
                )}
              </div>
            ))
          ) : (
            <Empty
              title="Quiet list."
              description="Add a task when something deserves space."
              action={() => edit({ kind: "task" })}
            />
          )}
        </div>
      </div>
    );
  }

  /* --- BROADSHEET (Editorial Dispatch) & COCKPIT (Compact Workbench Table) --- */
  const leadDispatch =
    experience === "broadsheet"
      ? buckets.urgent[0] ?? buckets.unscheduled[0] ?? null
      : null;

  return (
    <div className={`classic-work is-${experience}`}>
      <PageHeading
        eyebrow={
          experience === "cockpit" ? "COMMAND QUEUE" : "MORNING DISPATCH INDEX"
        }
        title="Tasks"
        subtitle="Your own effort estimates paired with scheduled calendar sessions."
        action={() => edit({ kind: "task" })}
        label="New task"
      />
      {leadDispatch && leadDispatch.task.status === "active" && (
        <section
          className="broadsheet-lead-card"
          aria-label="Priority dispatch"
        >
          <div className="broadsheet-lead-copy">
            <span className="eyebrow">LEAD DISPATCH</span>
            <h2>{leadDispatch.task.title}</h2>
            <p className="tabular-num">
              {durationLabel(leadDispatch.remainingMinutes)}
              {leadDispatch.projectTitle
                ? " · " + leadDispatch.projectTitle
                : " · Standalone"}
              {leadDispatch.due
                ? " · Due " + formatDate(leadDispatch.due)
                : ""}
            </p>
          </div>
          <div className="broadsheet-lead-actions">
            <button
              type="button"
              className="button primary small"
              onClick={() => slotTask(leadDispatch.task)}
            >
              <Zap size={13} /> Auto-slot today
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                edit({ kind: "task", id: leadDispatch.task.id })
              }
            >
              Edit
            </button>
          </div>
        </section>
      )}
      <div className="list-panel">
        <div className="list-toolbar">
          <div className="tab-row" role="group" aria-label="Task filters">
            {(
              [
                ["active", "Active", counts.active],
                ["unscheduled", "Unscheduled", counts.unscheduled],
                ["missing", "Needs estimate", counts.missing],
                ["completed", "Completed", counts.completed],
                ["all", "All", counts.all],
              ] as const
            ).map(([v, l, n]) => (
              <button
                type="button"
                key={v}
                className={filter === v ? "active" : ""}
                aria-pressed={filter === v}
                onClick={() => {
                  setFilter(v);
                  setPage(0);
                }}
              >
                {l}
                <span className="tab-count">{n}</span>
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={15} />
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
        {filteredEntries.length ? (
          <>
            <div className="task-table">
              <div className="task-table-head">
                <span>Task</span>
                <span>Estimated work</span>
                <span>Deadline</span>
                <span>Sessions</span>
                <span />
              </div>
              {filteredEntries.slice(page * 10, page * 10 + 10).map((e) => {
                const t = e.task;
                return (
                  <div className="task-table-row" key={t.id}>
                    <div className="task-cell">
                      <button
                        type="button"
                        className={
                          "task-check " +
                          (t.status === "completed" ? "checked" : "")
                        }
                        aria-label={`${t.status === "completed" ? "Reopen" : "Complete"} ${t.title}`}
                        onClick={() => toggleDone(t)}
                      >
                        {t.status === "completed" && <Check size={13} />}
                      </button>
                      <button
                        type="button"
                        className="plain task-row-title-btn"
                        onClick={() => edit({ kind: "task", id: t.id })}
                      >
                        <strong
                          className={t.status === "completed" ? "strike" : ""}
                        >
                          {t.title}
                        </strong>
                        <small>
                          {e.projectTitle || "Standalone task"}
                          {t.importance === "high" ? " · High importance" : ""}
                        </small>
                      </button>
                    </div>
                    <div className="task-col-estimate">
                      <span
                        className={
                          "tabular-num " +
                          (t.estimate === null ? "amber-text" : "")
                        }
                      >
                        {durationLabel(e.remainingMinutes)}
                      </span>
                      <small>
                        {t.estimate !== null &&
                        t.remaining !== null &&
                        t.remaining !== t.estimate
                          ? "remaining · " +
                            durationLabel(t.estimate) +
                            " original"
                          : "user estimate"}
                      </small>
                    </div>
                    <div className="task-col-deadline">
                      {e.due ? (
                        <Badge tone={e.due < dayKey() ? "peach" : "neutral"}>
                          {formatDate(e.due)}
                        </Badge>
                      ) : (
                        <span className="muted">No deadline</span>
                      )}
                    </div>
                    <div className="task-col-sessions">
                      {e.sessionCount ? (
                        <span>
                          <span className="tabular-num">
                            {e.completedSessionCount} completed /{" "}
                            {e.sessionCount}
                          </span>
                          <small>sessions, not task progress</small>
                        </span>
                      ) : (
                        <span className="muted">Not scheduled</span>
                      )}
                    </div>
                    <div className="row-actions">
                      {t.status === "active" && (
                        <>
                          <button
                            type="button"
                            className="button secondary small"
                            title="Snap into next open slot today"
                            onClick={() => slotTask(t)}
                          >
                            <Zap size={12} /> Slot
                          </button>
                          <IconButton
                            label={"Schedule " + t.title}
                            onClick={() =>
                              edit({ kind: "session", taskId: t.id })
                            }
                          >
                            <Plus size={16} />
                          </IconButton>
                        </>
                      )}
                      <IconButton
                        label={"Edit " + t.title}
                        onClick={() => edit({ kind: "task", id: t.id })}
                      >
                        <MoreHorizontal size={17} />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
            <Pagination
              page={page}
              count={filteredEntries.length}
              setPage={setPage}
            />
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
    </div>
  );
}

/* ============================================================================
   DEADLINES
   ============================================================================ */
export function Deadlines(props: ViewProps) {
  const experience = props.experience ?? DEFAULT_EXPERIENCE;
  if (isWildExperience(experience)) {
    return (
      <WildDeadlinesView
        experience={experience}
        state={props.state}
        update={props.update}
        edit={props.edit}
        notify={props.notify}
        scheduleTask={
          props.scheduleTask ??
          ((_, d) => props.edit({ kind: "session", date: d }))
        }
        setOutcome={props.setOutcome ?? (() => {})}
        onNavigatePlanner={props.onNavigatePlanner ?? (() => {})}
      />
    );
  }

  const { state, update, edit, notify } = props;
  const { today } = useClassicSlot(state, props.scheduleTask, edit, notify);
  const [showResolved, setShowResolved] = useState(false);
  const entries = computeDeadlineUrgency(state, today, showResolved);

  const editItem = (item: (typeof entries)[number]) => {
    if (item.kind === "deadline") {
      edit({ kind: "deadline", id: item.id });
    } else {
      edit({
        kind: item.kind,
        id: item.id,
        projectId:
          item.kind === "milestone"
            ? (item.projectId ?? undefined)
            : undefined,
      });
    }
  };

  const toggleResolved = (item: (typeof entries)[number]) => {
    if (item.kind !== "deadline") return;
    update((s) => {
      const target = s.deadlines.find((x) => x.id === item.id);
      if (!target) return;
      target.status = item.resolved ? "active" : "resolved";
      audit(
        s,
        "Deadline " + (item.resolved ? "reopened" : "resolved by user"),
        item.id,
      );
    });
    notify("Deadline updated. Its calendar marker is preserved.");
  };

  /* --- COCKPIT: Compact Horizon Telemetry Table --- */
  if (experience === "cockpit") {
    return (
      <div className="classic-work is-cockpit">
        <PageHeading
          eyebrow="HORIZON TELEMETRY"
          title="Deadlines"
          subtitle="Target dates and milestone commitments sorted chronologically."
          action={() => edit({ kind: "deadline" })}
          label="New deadline"
        />
        <div className="list-panel">
          <div className="list-toolbar">
            <span className="tabular-num">
              {entries.length} upcoming markers
            </span>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
              Show resolved
            </label>
          </div>
          {entries.length ? (
            <div className="cockpit-table-wrap">
              <table className="cockpit-table tabular-num">
                <thead>
                  <tr>
                    <th>Countdown</th>
                    <th>Target</th>
                    <th>Kind</th>
                    <th>Title</th>
                    <th>Linked</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((item) => (
                    <tr key={item.key}>
                      <td>{item.countdownLabel}</td>
                      <td>{formatDate(item.date)}</td>
                      <td>{item.kind}</td>
                      <td>
                        <button
                          type="button"
                          className="plain"
                          onClick={() => editItem(item)}
                        >
                          <strong>{item.title}</strong>
                        </button>
                      </td>
                      <td>
                        {item.kind === "deadline"
                          ? `${item.linkedDone}/${item.linkedTotal}`
                          : item.projectTitle || "—"}
                      </td>
                      <td className="row-actions">
                        {item.kind === "deadline" && (
                          <>
                            <button
                              type="button"
                              className="button secondary small"
                              onClick={() =>
                                edit({ kind: "task", deadlineId: item.id })
                              }
                            >
                              Link
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
                          <MoreHorizontal size={15} />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Horizon clear."
              description="Add a deadline or project milestone."
              action={() => edit({ kind: "deadline" })}
              label="New deadline"
            />
          )}
        </div>
      </div>
    );
  }

  /* --- BAUHAUS / BROADSHEET / FLOW / ZEN --- */
  return (
    <div
      className={
        `classic-work is-${experience}` +
        (experience === "zen" ? " zen-centered-sheet" : "")
      }
    >
      <PageHeading
        eyebrow={
          experience === "bauhaus"
            ? "04 / DATE MARKERS"
            : experience === "broadsheet"
              ? "ALMANAC DATES"
              : "DATE MARKERS"
        }
        title="Deadlines"
        subtitle="Dates you are working toward, together with approved project milestones."
        action={() => edit({ kind: "deadline" })}
        label="New deadline"
      />
      <div className="section-head">
        <h2>
          Upcoming deadlines{" "}
          <span className="count tabular-num">{entries.length}</span>
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
      {entries.length ? (
        <div
          className={
            experience === "bauhaus"
              ? "bauhaus-deadline-grid"
              : experience === "zen"
                ? "zen-deadline-list"
                : "deadline-grid"
          }
        >
          {entries.map((item) => (
            <article
              className={
                "deadline-card " + (item.resolved ? "resolved" : "")
              }
              key={item.key}
            >
              <div className="deadline-date">
                <span>
                  {formatDate(item.date, { month: "short" }).toUpperCase()}
                </span>
                <strong className="tabular-num">
                  {Number(item.date.slice(-2))}
                </strong>
                <small>{formatDate(item.date, { weekday: "short" })}</small>
              </div>
              <div className="deadline-info">
                <div className="card-topline">
                  <span className="tabular-num wild-card-kicker">
                    {item.countdownLabel} ·{" "}
                    {item.kind === "deadline" ? "Deadline" : item.kind}
                  </span>
                  <IconButton
                    label={"Edit " + item.title}
                    onClick={() => editItem(item)}
                  >
                    <MoreHorizontal size={17} />
                  </IconButton>
                </div>
                <h3>{item.title}</h3>
                <p>
                  {item.time ? displayTime(item.time) + " · " : ""}
                  {item.notes ||
                    item.projectTitle ||
                    "A date to work toward."}
                </p>
                {item.kind === "deadline" && (
                  <>
                    <div className="deadline-meta tabular-num">
                      {item.linkedTotal
                        ? `${item.linkedDone} of ${item.linkedTotal} linked tasks finished`
                        : "No linked tasks yet"}
                    </div>
                    <div className="card-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          edit({ kind: "task", deadlineId: item.id })
                        }
                      >
                        Link work
                        <Plus size={13} />
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => toggleResolved(item)}
                      >
                        {item.resolved ? "Reopen" : "Mark resolved"}
                        <Check size={13} />
                      </button>
                    </div>
                  </>
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
    </div>
  );
}

/* ============================================================================
   ROUTINES
   ============================================================================ */
export function Routines(props: ViewProps) {
  const experience = props.experience ?? DEFAULT_EXPERIENCE;
  if (isWildExperience(experience)) {
    return (
      <WildRoutinesView
        experience={experience}
        state={props.state}
        update={props.update}
        edit={props.edit}
        notify={props.notify}
        scheduleTask={
          props.scheduleTask ??
          ((_, d) => props.edit({ kind: "session", date: d }))
        }
        setOutcome={props.setOutcome ?? (() => {})}
        onNavigatePlanner={props.onNavigatePlanner ?? (() => {})}
      />
    );
  }

  const { state, update, edit, notify } = props;
  const { today } = useClassicSlot(state, props.scheduleTask, edit, notify);
  const [deleting, setDeleting] = useState<string | null>(null);
  const cadenceItems = computeRoutineCadenceSummary(state, today);

  const toggleToday = (item: (typeof cadenceItems)[number]) => {
    props.setOutcome?.(
      "routine",
      item.routine.id,
      today,
      item.todayOutcome === "completed" ? "pending" : "completed",
    );
  };

  const pauseToggle = (r: State["routines"][number]) => {
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
      } else periods.push({ start: today, end: null });
      routine.pausePeriods = periods;
      routine.paused = !r.paused;
      audit(s, r.paused ? "Routine resumed" : "Routine paused", r.id);
    });
    notify(
      r.paused
        ? "Routine resumed."
        : "Routine paused. Sync to update Google Calendar.",
    );
  };

  const deleteControls = (r: State["routines"][number]) =>
    deleting === r.id ? (
      <div
        className="routine-delete-confirm"
        role="group"
        aria-label={`Delete ${r.title}`}
      >
        <p>Keep past occurrences, or remove every occurrence including history?</p>
        <div className="routine-delete-buttons">
          <button
            type="button"
            className="text-button danger"
            onClick={() => {
              update((s) => {
                const routine = s.routines.find((x) => x.id === r.id)!;
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
          </button>
          <button
            type="button"
            className="text-button danger"
            onClick={() => {
              update((s) => {
                s.routines = s.routines.filter((x) => x.id !== r.id);
                s.routineRecords = s.routineRecords.filter(
                  (x) => x.routineId !== r.id,
                );
                s.exceptions = s.exceptions.filter((x) => x.routineId !== r.id);
                audit(s, "Removed routine and history", r.id);
              });
              setDeleting(null);
              notify(
                "Routine and all occurrences removed. Sync to update Google Calendar.",
              );
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
    ) : (
      <button
        type="button"
        className="text-button danger"
        onClick={() => setDeleting(r.id)}
      >
        <Trash2 size={13} /> Delete
      </button>
    );

  /* --- BAUHAUS: 7-Column Mon–Sun Architecture Matrix --- */
  if (experience === "bauhaus") {
    const weekdayCols = [
      { idx: 1, name: "MON" },
      { idx: 2, name: "TUE" },
      { idx: 3, name: "WED" },
      { idx: 4, name: "THU" },
      { idx: 5, name: "FRI" },
      { idx: 6, name: "SAT" },
      { idx: 0, name: "SUN" },
    ];
    return (
      <div className="classic-work is-bauhaus">
        <PageHeading
          eyebrow="05 / WEEKLY CADENCE ARCHITECTURE"
          title="Routines"
          subtitle="7-day spatial distribution of active recurring commitments."
          action={() => edit({ kind: "routine" })}
          label="New routine"
        />
        {cadenceItems.length ? (
          <>
            <div className="bauhaus-week-matrix">
              {weekdayCols.map((col) => {
                const dayRoutines = cadenceItems.filter(
                  (i) => !i.routine.paused && i.routine.days.includes(col.idx),
                );
                return (
                  <section key={col.idx} className="bauhaus-day-col">
                    <header className="bauhaus-day-col-head">
                      <strong>{col.name}</strong>
                      <span className="tabular-num">{dayRoutines.length}</span>
                    </header>
                    <div className="bauhaus-day-col-items">
                      {dayRoutines.map((item) => (
                        <button
                          type="button"
                          key={item.routine.id}
                          className="bauhaus-routine-block"
                          onClick={() =>
                            edit({ kind: "routine", id: item.routine.id })
                          }
                        >
                          <strong>{item.routine.title}</strong>
                          <small className="tabular-num">
                            {item.startLabel} ·{" "}
                            {durationLabel(item.routine.duration)}
                          </small>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="routine-grid" style={{ marginTop: 20 }}>
              {cadenceItems.map((item) => (
                <article
                  key={item.routine.id}
                  className={
                    "routine-card " + (item.routine.paused ? "paused" : "")
                  }
                >
                  <div className="card-topline">
                    <strong>{item.routine.title}</strong>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => toggleToday(item)}
                      >
                        {item.todayOutcome === "completed"
                          ? "Done today ✓"
                          : "Mark today"}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => pauseToggle(item.routine)}
                      >
                        {item.routine.paused ? "Resume" : "Pause"}
                      </button>
                      {deleteControls(item.routine)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <Empty
            title="Build a weekly cadence."
            description="Add a recurring routine to populate all 7 columns."
            action={() => edit({ kind: "routine" })}
            label="Add routine"
          />
        )}
      </div>
    );
  }

  /* --- COCKPIT: Compact Telemetry Table --- */
  if (experience === "cockpit") {
    return (
      <div className="classic-work is-cockpit">
        <PageHeading
          eyebrow="RECURRING ANCHORS"
          title="Routines"
          subtitle="Recurring habits and reserved windows that stay anchored on their set days."
          action={() => edit({ kind: "routine" })}
          label="New routine"
        />
        <div className="list-panel">
          {cadenceItems.length ? (
            <div className="cockpit-table-wrap">
              <table className="cockpit-table tabular-num">
                <thead>
                  <tr>
                    <th>Today</th>
                    <th>Routine</th>
                    <th>Window</th>
                    <th>Days</th>
                    <th>14d</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cadenceItems.map((item) => {
                    const r = item.routine;
                    return (
                      <tr key={r.id}>
                        <td>
                          <button
                            type="button"
                            className={
                              "task-check " +
                              (item.todayOutcome === "completed"
                                ? "checked"
                                : "")
                            }
                            aria-label={`Toggle ${r.title} for today`}
                            onClick={() => toggleToday(item)}
                          >
                            {item.todayOutcome === "completed" && (
                              <Check size={12} />
                            )}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="plain"
                            onClick={() => edit({ kind: "routine", id: r.id })}
                          >
                            <strong>{r.title}</strong>
                          </button>
                        </td>
                        <td>
                          {item.startLabel} · {durationLabel(r.duration)}
                        </td>
                        <td>
                          {item.weeklyMask
                            .filter((d) => d.active)
                            .map((d) => d.shortLabel)
                            .join(" ")}
                        </td>
                        <td>{item.recentCompleted}x</td>
                        <td className="row-actions">
                          <button
                            type="button"
                            className="button secondary small"
                            onClick={() => pauseToggle(r)}
                          >
                            {r.paused ? "Resume" : "Pause"}
                          </button>
                          <IconButton
                            label={"Edit " + r.title}
                            onClick={() => edit({ kind: "routine", id: r.id })}
                          >
                            <MoreHorizontal size={15} />
                          </IconButton>
                          {deleteControls(r)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No recurring anchors."
              description="Add a daily or weekly routine."
              action={() => edit({ kind: "routine" })}
              label="Add routine"
            />
          )}
        </div>
      </div>
    );
  }

  /* --- BROADSHEET / FLOW / ZEN --- */
  return (
    <div
      className={
        `classic-work is-${experience}` +
        (experience === "zen" ? " zen-centered-sheet" : "")
      }
    >
      <PageHeading
        eyebrow="FIXED COMMITMENTS"
        title="Routines"
        subtitle="Recurring habits and reserved windows that stay anchored on their set days."
        action={() => edit({ kind: "routine" })}
        label="New routine"
      />
      {cadenceItems.length ? (
        <div
          className={
            experience === "zen" ? "zen-routine-list" : "routine-grid"
          }
        >
          {cadenceItems.map((item) => {
            const r = item.routine;
            const doneToday = item.todayOutcome === "completed";
            return (
              <article
                className={"routine-card " + (r.paused ? "paused" : "")}
                key={r.id}
              >
                <div className="card-topline">
                  <span className={"routine-icon " + r.color}>
                    <Repeat2 size={18} />
                  </span>
                  <div className="row-actions">
                    <span className="tabular-num wild-card-kicker">
                      {r.paused ? "Paused" : `${item.daysPerWeek}d/wk`} ·{" "}
                      {item.recentCompleted} in 14d
                    </span>
                    <IconButton
                      label={"Edit " + r.title}
                      onClick={() => edit({ kind: "routine", id: r.id })}
                    >
                      <MoreHorizontal size={17} />
                    </IconButton>
                  </div>
                </div>
                <h3>{r.title}</h3>
                <p className="tabular-num">
                  <Clock3 size={14} />
                  {item.startLabel} · {durationLabel(r.duration)}
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
                <div className="routine-footer">
                  <button
                    type="button"
                    className={
                      "button small " + (doneToday ? "primary" : "secondary")
                    }
                    onClick={() => toggleToday(item)}
                  >
                    <Check size={13} />
                    {doneToday ? "Done today" : "Check today"}
                  </button>
                  <div className="routine-footer-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => pauseToggle(r)}
                    >
                      {r.paused ? <Play size={13} /> : <Pause size={13} />}{" "}
                      {r.paused ? "Resume" : "Pause"}
                    </button>
                    {deleteControls(r)}
                  </div>
                </div>
              </article>
            );
          })}
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
    </div>
  );
}

/* ============================================================================
   PROJECTS
   ============================================================================ */
export function Projects(
  props: ViewProps & {
    propose: (id: string) => void;
    proposeTasks: (id: string, milestoneId: string) => void;
    busy: boolean;
    aiReady: boolean;
  },
) {
  const experience = props.experience ?? DEFAULT_EXPERIENCE;
  if (isWildExperience(experience)) {
    return (
      <WildProjectsView
        experience={experience}
        state={props.state}
        update={props.update}
        edit={props.edit}
        notify={props.notify}
        scheduleTask={
          props.scheduleTask ??
          ((_, d) => props.edit({ kind: "session", date: d }))
        }
        setOutcome={props.setOutcome ?? (() => {})}
        onNavigatePlanner={props.onNavigatePlanner ?? (() => {})}
        propose={props.propose}
        proposeTasks={props.proposeTasks}
        busy={props.busy}
        aiReady={props.aiReady}
      />
    );
  }

  const { state, update, edit, notify, propose, proposeTasks, busy, aiReady } =
    props;
  const [selected, setSelected] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const visibleProjects = state.projects.filter(
    (p) => (p.status === "completed") === archived,
  );
  const [taskMilestone, setTaskMilestone] = useState("");
  const project =
    experience === "cockpit"
      ? state.projects.find((p) => p.id === selected) ??
        visibleProjects[0] ??
        null
      : state.projects.find((p) => p.id === selected) ?? null;

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

  function renderProjectDetail(p: State["projects"][number], showBack: boolean) {
    return (
      <>
        <div className="project-detail-header">
          <div>
            {showBack && (
              <button
                type="button"
                className="text-button back-link"
                onClick={() => setSelected(null)}
              >
                ← All projects
              </button>
            )}
            <h1>{p.title}</h1>
            {p.outcome && (
              <p className="project-detail-outcome">{p.outcome}</p>
            )}
          </div>
          <div className="project-detail-actions">
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
              onClick={() => {
                update((s) => {
                  s.projects.find((x) => x.id === p.id)!.status =
                    p.status === "active" ? "completed" : "active";
                  audit(
                    s,
                    "Project " +
                      (p.status === "active" ? "completed" : "reopened"),
                    p.id,
                  );
                });
                setArchived(p.status === "active");
                if (experience !== "cockpit") setSelected(null);
                notify(
                  p.status === "active"
                    ? "Project archived."
                    : "Project reopened.",
                );
              }}
            >
              {p.status === "active" ? "Finish project" : "Reopen project"}
            </button>
          </div>
        </div>

        <div className="project-detail-grid">
          <div>
            <div className="project-summary panel">
              <div>
                <span className="eyebrow">FINAL DELIVERABLE</span>
                <h3>
                  {formatDate(p.deadline, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </h3>
                <p>
                  {p.startingPoint || "Starting point not recorded."}
                </p>
              </div>
              <div>
                <Badge
                  tone={
                    projectHealth(state, p).label === "At risk"
                      ? "peach"
                      : "sage"
                  }
                >
                  {projectHealth(state, p).label}
                </Badge>
                <p>{projectHealth(state, p).reason}</p>
              </div>
            </div>
            <SectionHead
              title="The path forward"
              subtitle="Only approved dates become commitments."
              action={() => edit({ kind: "milestone", projectId: p.id })}
              label="Add milestone"
            />
            {p.milestones.length > 0 && (
              <MilestoneFlow
                milestones={p.milestones}
                onSelect={(id) =>
                  edit({ kind: "milestone", projectId: p.id, id })
                }
              />
            )}
            <div className="milestone-list">
              {p.milestones.length ? (
                p.milestones
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
                          <Check size={16} />
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
                        <p className="tabular-num">
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
                                  p.milestones.find((x) => x.id === id)?.title,
                              )
                              .join(", ")}
                          </small>
                        )}
                        {m.reason && (
                          <p className="milestone-reason">{m.reason}</p>
                        )}
                        <div className="card-actions">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              edit({
                                kind: "milestone",
                                projectId: p.id,
                                id: m.id,
                              })
                            }
                          >
                            {m.approved ? "Edit milestone" : "Review & approve"}
                            <ArrowUpRight size={13} />
                          </button>
                          {m.approved && (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => {
                                if (
                                  !m.completed &&
                                  m.dependsOn.some(
                                    (id) =>
                                      !p.milestones.find((x) => x.id === id)
                                        ?.completed,
                                  )
                                ) {
                                  notify(
                                    "Finish or review the dependency milestones first.",
                                  );
                                  return;
                                }
                                update((s) => {
                                  s.projects
                                    .find((x) => x.id === p.id)!
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
                  action={() => edit({ kind: "milestone", projectId: p.id })}
                />
              )}
            </div>
          </div>
          <aside className="project-aside">
            <div className="panel ai-panel">
              <Sparkles size={20} />
              <h3>A second perspective.</h3>
              <p>
                Ask AI for milestone proposals based on your outcome,
                estimates, and calendar capacity.
              </p>
              {typeof latestMilestoneProposal?.output.summary === "string" && (
                <p>{latestMilestoneProposal.output.summary}</p>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={busy || !aiReady}
                onClick={() => propose(p.id)}
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
                className="button secondary"
                disabled={busy || !aiReady || !selectedTaskMilestone}
                onClick={() =>
                  selectedTaskMilestone &&
                  proposeTasks(p.id, selectedTaskMilestone.id)
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
                action={() => edit({ kind: "task", projectId: p.id })}
                label="Add"
              />
              {currentWorkGroups.map((group) => (
                <section className="project-work-group" key={group.id}>
                  <h4>{group.title}</h4>
                  {group.tasks.map((task) => (
                    <button
                      type="button"
                      className="project-task"
                      key={task.id}
                      onClick={() => edit({ kind: "task", id: task.id })}
                    >
                      <span>{task.title}</span>
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
          </aside>
        </div>
      </>
    );
  }

  /* --- COCKPIT: Master-Detail Split Workbench --- */
  if (experience === "cockpit") {
    return (
      <div className="classic-work is-cockpit">
        <PageHeading
          eyebrow="PROJECT WORKBENCH"
          title="Projects"
          subtitle="Select any initiative in the left rail to inspect milestones and tasks live."
          action={() => edit({ kind: "project" })}
          label="New project"
        />
        <div className="cockpit-master-detail">
          <aside className="cockpit-master-list panel">
            <div className="tab-row" role="group" aria-label="Project lists">
              {([false, true] as const).map((value) => (
                <button
                  type="button"
                  key={String(value)}
                  className={value === archived ? "active" : ""}
                  onClick={() => {
                    setArchived(value);
                    setSelected(null);
                  }}
                >
                  {value ? "Archived" : "Active"}
                </button>
              ))}
            </div>
            {visibleProjects.length ? (
              <div className="cockpit-proj-rows">
                {visibleProjects.map((p) => {
                  const health = projectHealth(state, p);
                  const done = p.milestones.filter((m) => m.completed).length;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      className={
                        "cockpit-proj-item " +
                        (project?.id === p.id ? "is-selected" : "")
                      }
                      onClick={() => setSelected(p.id)}
                    >
                      <strong>{p.title}</strong>
                      <small className="tabular-num">
                        {health.label} · {done}/{p.milestones.length} ·{" "}
                        {formatDate(p.deadline)}
                      </small>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="muted">No projects in this view.</p>
            )}
          </aside>
          <div className="cockpit-detail-canvas">
            {project ? (
              renderProjectDetail(project, false)
            ) : (
              <Empty
                title="Give your next idea a home."
                description="Start with the outcome, the final deadline, and what you already know."
                action={() => edit({ kind: "project" })}
                label="Create a project"
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  /* --- BROADSHEET (3-Tier Lead + Index), BAUHAUS (Numbered Posters), FLOW, ZEN --- */
  return (
    <div
      className={
        `classic-work is-${experience}` +
        (experience === "zen" ? " zen-centered-sheet" : "")
      }
    >
      {!project && (
        <>
          <PageHeading
            eyebrow={
              experience === "bauhaus"
                ? "03 / LONG-HORIZON INITIATIVES"
                : "LONG-HORIZON WORK"
            }
            title="Projects"
            subtitle="Clear outcomes, dependency-aware milestones, and approved commitment dates."
            action={() => edit({ kind: "project" })}
            label="New project"
          />
          <div className="project-filter-bar">
            <div className="tab-row" role="group" aria-label="Project lists">
              {([false, true] as const).map((value) => (
                <button
                  type="button"
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
          </div>
        </>
      )}
      {project ? (
        renderProjectDetail(project, true)
      ) : visibleProjects.length ? (
        <div
          className={
            experience === "broadsheet"
              ? "broadsheet-project-layout"
              : experience === "bauhaus"
                ? "bauhaus-project-grid"
                : "project-grid"
          }
        >
          {visibleProjects.map((p, idx) => {
            const health = projectHealth(state, p),
              done = p.milestones.filter((m) => m.completed).length;
            return (
              <article
                key={p.id}
                className={
                  "project-card " +
                  (experience === "broadsheet" && idx === 0
                    ? "is-lead-feature"
                    : "")
                }
              >
                <div className="card-topline">
                  <span className="project-icon tabular-num">
                    {experience === "bauhaus" ? (
                      <strong>P-{String(idx + 1).padStart(2, "0")}</strong>
                    ) : (
                      <FolderOpen size={20} />
                    )}
                  </span>
                  <span className="tabular-num wild-card-kicker">
                    {health.label} · {formatDate(p.deadline)}
                  </span>
                </div>
                <button
                  type="button"
                  className="plain"
                  onClick={() => setSelected(p.id)}
                >
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
                <div className="project-card-meta tabular-num">
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
                  type="button"
                  className="project-open"
                  onClick={() => setSelected(p.id)}
                >
                  Open project
                  <ArrowUpRight size={15} />
                </button>
              </article>
            );
          })}
        </div>
      ) : archived ? (
        <div className="panel">
          <p>No archived projects yet.</p>
        </div>
      ) : (
        <Empty
          title="Give your next idea a home."
          description="Start with the outcome, the final deadline, and what you already know."
          action={() => edit({ kind: "project" })}
          label="Create a project"
        />
      )}
    </div>
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
        <button type="button" className="button primary" onClick={action}>
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
      <span className="tabular-num">
        {page * 10 + 1}–{Math.min(page * 10 + 10, count)} of {count} tasks
      </span>
      <div>
        <button
          type="button"
          disabled={!page}
          className="button small secondary"
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
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
