"use client";
import { useState, FormEvent } from "react";
import { Trash2, AlertTriangle, Check, Undo2 } from "lucide-react";
import {
  State,
  defaultSessionDuration,
  Task,
  Session,
  Project,
  uid,
  dayKey,
  clockMinutes,
  clockTime,
  audit,
  finishTask,
  recordSessionOutcome,
  removeTask,
  removeProject,
  routineStart,
} from "@/lib/model";
import { overlap, zonedParts } from "@/lib/engine";
import { Dialog, Field, DAYS, OUTCOMES } from "./ui";
export type EditorState = {
  kind:
    | "task"
    | "deadline"
    | "routine"
    | "project"
    | "milestone"
    | "session"
    | "occurrence";
  id?: string;
  taskId?: string;
  projectId?: string;
  deadlineId?: string;
  milestoneId?: string;
  date?: string;
  start?: string;
};
export function Editor({
  modal,
  state,
  update,
  onClose,
  onSaved,
  onUnschedule,
}: {
  modal: EditorState;
  state: State;
  update: (f: (s: State) => void) => void;
  onClose: () => void;
  onSaved: (text: string) => void;
  onUnschedule: (id: string) => boolean;
}) {
  const task = state.tasks.find((t) => t.id === modal.id),
    deadline = state.deadlines.find((d) => d.id === modal.id),
    routine = state.routines.find((r) => r.id === modal.id),
    project = state.projects.find(
      (p) => p.id === (modal.projectId || modal.id),
    ),
    session = state.sessions.find((s) => s.id === modal.id),
    milestone = project?.milestones.find((m) => m.id === modal.id),
    occurrence = state.exceptions.find(
      (x) => x.routineId === modal.id && x.date === modal.date,
    );
  const [error, setError] = useState(""),
    [projectId, setProjectId] = useState(
      task?.projectId || modal.projectId || "",
    ),
    [deadlineChoice, setDeadlineChoice] = useState(
      task?.milestoneId
        ? "milestone:" + task.milestoneId
        : task?.deadlineId || modal.deadlineId
          ? "deadline:" + (task?.deadlineId || modal.deadlineId)
          : modal.milestoneId
            ? "milestone:" + modal.milestoneId
            : "",
    ),
    [chosenTask, setChosenTask] = useState(
      session?.taskId ||
        modal.taskId ||
        state.tasks.find((t) => t.status === "active" && !t.deletedProject)
          ?.id ||
        "",
    ),
    [untimed, setUntimed] = useState(!!routine?.untimed);
  const type = modal.kind,
    isEdit =
      type === "milestone"
        ? !!milestone
        : type === "session"
          ? !!session
          : type === "occurrence"
            ? true
            : !!modal.id;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget),
      str = (k: string) => String(f.get(k) || "").trim(),
      num = (k: string) => (str(k) === "" ? null : Number(str(k))),
      hours = (k: string) =>
        num(k) === null ? null : Math.round(num(k)! * 60),
      check = (k: string) => f.get(k) === "on";
    try {
      const recordId = modal.id || uid();
      update((s) => {
        if (type === "task") {
          const estimate = num("estimate"),
            remaining = num("remaining");
          const value: Task = {
            id: recordId,
            title: str("title"),
            estimate,
            remaining: remaining ?? estimate,
            deadlineId: deadlineChoice.startsWith("deadline:")
              ? (() => {
                  const selectedDeadline = s.deadlines.find(
                    (d) => d.id === deadlineChoice.slice(9),
                  );
                  return selectedDeadline &&
                    (!str("projectId") ||
                      selectedDeadline.projectId === str("projectId"))
                    ? selectedDeadline.id
                    : null;
                })()
              : deadlineChoice === "milestone:" + task?.milestoneId
                ? task?.deadlineId || null
                : null,
            projectId: str("projectId") || null,
            milestoneId: deadlineChoice.startsWith("milestone:")
              ? deadlineChoice.slice(10)
              : null,
            importance: str("importance") as Task["importance"],
            aiTodoDate: task?.aiTodoDate,
            generatedForProjectId: task?.generatedForProjectId,
            includeDate: str("includeDate") || null,
            status: task?.status || "active",
            notes: str("notes"),
            createdAt: task?.createdAt || new Date().toISOString(),
            completedAt: task?.completedAt || null,
          };
          const idx = s.tasks.findIndex((x) => x.id === recordId);
          if (idx >= 0) s.tasks[idx] = value;
          else s.tasks.push(value);
        }
        if (type === "deadline") {
          const value = {
            id: recordId,
            title: str("title"),
            date: str("date"),
            time: str("time") || null,
            workMode:
              str("workMode") === "multiple"
                ? ("multiple" as const)
                : ("single" as const),
            remainingMinutes: num("remainingMinutes"),
            projectId: str("projectId") || null,
            status: check("resolved")
              ? ("resolved" as const)
              : ("active" as const),
            notes: str("notes"),
          };
          const idx = s.deadlines.findIndex((x) => x.id === recordId);
          if (idx >= 0) s.deadlines[idx] = value;
          else s.deadlines.push(value);
        }
        if (type === "routine") {
          const value = {
            id: recordId,
            title: str("title"),
            recurrenceInterval: num("recurrenceInterval") || 1,
            recurrenceUnit: str("recurrenceUnit") as
              "days" | "weeks" | "months",
            start: str("start") || routine?.start || "09:00",
            duration: num("duration") || routine?.duration || 30,
            untimed: check("untimed"),
            days: f.getAll("days").map(Number),
            since: str("since"),
            until: str("until") || null,
            paused: routine?.paused || false,
            timeSchedules: routine?.timeSchedules,
            pausePeriods: routine?.pausePeriods,
            deletedAt: routine?.deletedAt,
            color: str("color") as "sage" | "peach" | "blue" | "lavender",
          };
          if (!value.untimed) {
            const effective = routine ? str("timeEffective") : value.since;
            if (!effective)
              throw new Error("Choose when the time change takes effect.");
            const weekdays = DAYS.map((_, i) => str(`weekdayTime${i}`) || null);
            for (const time of [
              value.start,
              ...weekdays.filter((x): x is string => !!x),
            ]) {
              if (clockMinutes(time) + value.duration > 1440)
                throw new Error("Routine times must end on the same day.");
            }
            const previous =
              routine?.timeSchedules ||
              (routine
                ? [
                    {
                      effective: routine.since,
                      start: routine.start,
                      weekdays: Array(7).fill(null),
                    },
                  ]
                : []);
            value.timeSchedules = [
              ...previous.filter((entry) => entry.effective !== effective),
              { effective, start: value.start, weekdays },
            ].sort((a, b) => a.effective.localeCompare(b.effective));
            if (routine) value.start = routine.start;
          }
          if (value.until && value.until < value.since)
            throw new Error("End date must be on or after the start date.");
          const idx = s.routines.findIndex((x) => x.id === recordId);
          if (idx >= 0) s.routines[idx] = value;
          else s.routines.push(value);
        }
        if (type === "project") {
          const value: Project = {
            id: recordId,
            title: str("title"),
            outcome: str("outcome"),
            deadline: str("date"),
            startingPoint: str("startingPoint"),
            budgetMinutes: project?.budgetMinutes,
            availableMinutes: project?.availableMinutes,
            notes: str("notes"),
            milestones: project?.milestones || [],
            status: project?.status || "active",
          };
          const idx = s.projects.findIndex((x) => x.id === recordId);
          if (idx >= 0) s.projects[idx] = value;
          else s.projects.push(value);
        }
        if (type === "milestone") {
          const p = s.projects.find((p) => p.id === modal.projectId)!;
          const value = {
            id: recordId,
            title: str("title"),
            date: str("date"),
            approved: check("approve"),
            completed: milestone?.completed || false,
            dependsOn: f.getAll("dependsOn").map(String),
            estimate: hours("workload"),
            timeBudgetMinutes: hours("budget"),
            reason: str("reason"),
          };
          if (value.date > p.deadline)
            throw new Error(
              "A milestone must be on or before the final project deadline.",
            );
          if (
            value.dependsOn.some(
              (id) => p.milestones.find((m) => m.id === id)!.date > value.date,
            )
          )
            throw new Error(
              "A dependency is scheduled after this milestone. Review the dates.",
            );
          const idx = p.milestones.findIndex((m) => m.id === recordId);
          if (idx >= 0) p.milestones[idx] = value;
          else p.milestones.push(value);
          if (value.approved)
            audit(
              s,
              "Milestone name and target date approved by user",
              recordId,
            );
        }
        if (type === "session") {
          const start = str("start"),
            duration = num("duration")!,
            date = str("date");
          if (
            overlap(s, date, clockMinutes(start), duration, modal.id) &&
            !check("allowOverlap")
          )
            throw new Error(
              "This time overlaps a commitment. Choose another time, or explicitly allow the overlap.",
            );
          const value: Session = {
            id: recordId,
            taskId: str("taskId"),
            date,
            start,
            duration,
            outcome: str("outcome") as Session["outcome"],
            actualMinutes: num("actual"),
            focus: (str("sessionFocus") || undefined) as Session["focus"],
            note: str("note"),
            needsReview: session?.needsReview || false,
          };
          const idx = s.sessions.findIndex((x) => x.id === recordId);
          if (idx >= 0) s.sessions[idx] = value;
          else s.sessions.push(value);
          recordSessionOutcome(s, recordId, value.outcome, session?.outcome);
          const bookedTask = s.tasks.find((task) => task.id === value.taskId);
          if (bookedTask) delete bookedTask.aiTodoDate;
        }
        if (type === "occurrence") {
          const value = {
            routineId: modal.id!,
            date: modal.date!,
            skip: check("skip"),
            start: str("start") || routine?.start || "09:00",
            duration: num("duration") || routine?.duration || 30,
          };
          const idx = s.exceptions.findIndex(
            (x) => x.routineId === modal.id && x.date === modal.date,
          );
          if (idx >= 0) s.exceptions[idx] = value;
          else s.exceptions.push(value);
        }
        audit(s, (isEdit ? "Updated " : "Created ") + type, recordId);
      });
      onSaved(
        type === "session"
          ? str("outcome") === "completed"
            ? "Task finished. Deadline completion is tracked separately."
            : "Session saved."
          : type === "milestone"
            ? "Milestone saved."
            : `${type[0].toUpperCase() + type.slice(1)} saved.`,
      );
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.name === "ZodError"
            ? "Check the required fields, dates, and durations."
            : e.message
          : "Could not save.",
      );
    }
  }
  function remove() {
    const message =
      type === "project"
        ? `Delete “${project?.title}”? Past calendar records will be kept. Upcoming project deadlines, milestones, sessions, and unscheduled project tasks will be removed.`
        : type === "task"
          ? "Delete this task and all of its scheduled sessions? This cannot be undone. Google events will be removed on your next sync."
          : "Remove this " +
            type +
            "? This cannot be undone. Google changes apply only on your next sync.";
    if (type !== "session" && !confirm(message)) return;
    if (
      type === "project" &&
      !confirm(`Permanently delete “${project?.title}”? This cannot be undone.`)
    )
      return;
    try {
      update((s) => {
        if (type === "project") {
          const { day, minute } = zonedParts(
            new Date().toISOString(),
            s.settings.timezone,
          );
          if (!removeProject(s, modal.id!, day, minute))
            throw new Error("Project not found.");
        }
        if (type === "task") {
          if (!removeTask(s, modal.id!)) throw new Error("Task not found.");
          return;
        }
        if (type === "session")
          s.sessions = s.sessions.filter((x) => x.id !== modal.id);
        if (type === "deadline") {
          s.deadlines = s.deadlines.filter((x) => x.id !== modal.id);
          s.tasks.forEach((t) => {
            if (t.deadlineId === modal.id) t.deadlineId = null;
          });
        }
        if (type === "milestone") {
          const p = s.projects.find((p) => p.id === modal.projectId)!;
          if (p.milestones.some((m) => m.dependsOn.includes(modal.id!)))
            throw new Error("Remove this milestone from its dependents first.");
          p.milestones = p.milestones.filter((m) => m.id !== modal.id);
          s.tasks.forEach((t) => {
            if (t.milestoneId === modal.id) t.milestoneId = null;
          });
        }
        audit(s, "Removed " + type, modal.id!);
      });
      onClose();
      onSaved(
        type === "task"
          ? "Task deleted with its scheduled sessions."
          : type === "session"
            ? "Session removed."
            : "Record removed.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const sessionTask = state.tasks.find((entry) => entry.id === session?.taskId);
  const linkedTask =
    type === "session"
      ? state.tasks.find((entry) => entry.id === chosenTask)
      : task;
  const linkedDeadlineId =
    type === "task" && deadlineChoice.startsWith("deadline:")
      ? deadlineChoice.slice(9)
      : linkedTask?.deadlineId;
  const linkedDeadline = state.deadlines.find(
    (entry) => entry.id === linkedDeadlineId,
  );
  const archivedProject = state.projects.find(
    (entry) =>
      entry.status === "completed" &&
      ((type === "milestone" && entry.id === project?.id) ||
        ((type === "task" || type === "session") &&
          (entry.id === (type === "task" ? projectId : linkedTask?.projectId) ||
            entry.id === linkedDeadline?.projectId))),
  );
  const deletedProject =
    task?.deletedProject ??
    deadline?.deletedProject ??
    sessionTask?.deletedProject;
  if (deletedProject) {
    const historicalTitle =
      task?.title ?? deadline?.title ?? sessionTask?.title;
    const historicalTask = task ?? sessionTask;
    const canDeleteHistoricalRecord =
      !!historicalTask ||
      !!(deadline?.deletedProject && deadline.historicalKind);
    return (
      <Dialog
        title="Deleted project"
        subtitle={deletedProject}
        onClose={onClose}
      >
        <div className="editor-form">
          <p>{historicalTitle}</p>
          <p>This record was kept in your calendar history.</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Close
            </button>
            {canDeleteHistoricalRecord && (
              <button
                type="button"
                className="button secondary danger"
                onClick={() => {
                  const confirmText = historicalTask
                    ? `Delete “${historicalTask.title}” and its scheduled sessions from history?`
                    : `Delete the past ${deadline?.historicalKind} “${deadline?.title}” from history? Its Google Calendar marker will be removed on the next sync.`;
                  if (!confirm(confirmText)) return;
                  update((state) => {
                    if (historicalTask) {
                      if (!removeTask(state, historicalTask.id))
                        throw new Error("Task not found.");
                    } else if (deadline) {
                      state.deadlines = state.deadlines.filter(
                        (entry) => entry.id !== deadline.id,
                      );
                      audit(state, "Deleted past project record", deadline.id);
                    }
                  });
                  onSaved(
                    historicalTask
                      ? "Past task and sessions deleted."
                      : "Past milestone deleted.",
                  );
                  onClose();
                }}
              >
                <Trash2 size={15} /> Delete from history
              </button>
            )}
          </div>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog
      title={
        (isEdit ? "Edit " : "New ") +
        (type === "occurrence"
          ? "routine occurrence"
          : type === "session"
            ? "work session"
            : type)
      }
      subtitle={
        type === "session"
          ? "You choose the time. One session is one part of the work."
          : type === "milestone"
            ? "A concrete deliverable with a date you approve."
            : type === "occurrence"
              ? "Only this date changes. The recurring series stays in place."
              : undefined
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="editor-form">
        {archivedProject && (
          <p className="notice archived-project-notice">
            <strong>Project archived</strong>
            <span>{archivedProject.title} is finished.</span>
          </p>
        )}
        {["task", "deadline", "routine", "project", "milestone"].includes(
          type,
        ) && (
          <Field label={type === "project" ? "Project name" : "Title"}>
            <input
              name="title"
              required
              maxLength={200}
              placeholder={
                type === "task"
                  ? "What needs doing?"
                  : type === "project"
                    ? "What are you working toward?"
                    : "Give it a clear name"
              }
              defaultValue={
                type === "task"
                  ? task?.title
                  : type === "deadline"
                    ? deadline?.title
                    : type === "routine"
                      ? routine?.title
                      : type === "project"
                        ? project?.title
                        : milestone?.title
              }
              autoFocus
            />
          </Field>
        )}
        {type === "task" && (
          <>
            <div className="form-grid">
              <Field
                label="Your estimate · minutes"
                hint="Leave blank to estimate later."
              >
                <input
                  type="number"
                  min="1"
                  max="525600"
                  name="estimate"
                  defaultValue={task?.estimate ?? ""}
                  placeholder="90"
                />
              </Field>
              <Field
                label="Remaining work · minutes"
                hint="Your estimate, never inferred from sessions."
              >
                <input
                  type="number"
                  min="1"
                  max="525600"
                  name="remaining"
                  defaultValue={task?.remaining ?? ""}
                  placeholder="Same as estimate"
                />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Linked deadline">
                <select
                  value={deadlineChoice}
                  onChange={(e) => setDeadlineChoice(e.target.value)}
                >
                  <option value="">No deadline</option>
                  {state.deadlines
                    .filter(
                      (d) =>
                        (!projectId || d.projectId === projectId) &&
                        (d.status === "active" || d.id === task?.deadlineId),
                    )
                    .map((d) => (
                      <option key={d.id} value={"deadline:" + d.id}>
                        {d.title}
                        {d.status === "resolved" ? " · Completed" : ""}
                      </option>
                    ))}
                  {projectId &&
                    state.projects
                      .find((p) => p.id === projectId)
                      ?.milestones.filter(
                        (m) =>
                          (m.approved && !m.completed) ||
                          m.id === task?.milestoneId,
                      )
                      .map((m) => (
                        <option key={m.id} value={"milestone:" + m.id}>
                          {m.title} · Milestone
                          {m.completed
                            ? " · Completed"
                            : !m.approved
                              ? " · Draft"
                              : ""}
                        </option>
                      ))}
                </select>
              </Field>
              <Field label="Importance">
                <select
                  name="importance"
                  defaultValue={task?.importance || "normal"}
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </Field>
            </div>
            <Field label="Project">
              <select
                name="projectId"
                value={projectId}
                onChange={(e) => {
                  const nextProjectId = e.target.value;
                  setProjectId(nextProjectId);
                  if (deadlineChoice.startsWith("milestone:"))
                    setDeadlineChoice("");
                  else if (deadlineChoice.startsWith("deadline:")) {
                    const selectedDeadline = state.deadlines.find(
                      (d) => d.id === deadlineChoice.slice(9),
                    );
                    if (
                      selectedDeadline &&
                      nextProjectId &&
                      selectedDeadline.projectId !== nextProjectId
                    )
                      setDeadlineChoice("");
                  }
                }}
              >
                <option value="">Standalone task</option>
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notes · optional">
              <textarea
                name="notes"
                rows={2}
                maxLength={4000}
                defaultValue={task?.notes}
              />
            </Field>
            <Field
              label="Include in today’s to-do list on · optional"
              hint="Gemini will prioritize this task on the selected date."
            >
              <input
                type="date"
                name="includeDate"
                defaultValue={task?.includeDate || ""}
              />
            </Field>
          </>
        )}
        {type === "deadline" && (
          <>
            <div className="form-grid">
              <Field label="Due date">
                <input
                  type="date"
                  name="date"
                  required
                  defaultValue={deadline?.date || modal.date || dayKey()}
                />
              </Field>
              <Field label="Due time · optional">
                <input
                  type="time"
                  name="time"
                  defaultValue={deadline?.time || ""}
                />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Work sessions">
                <select
                  name="workMode"
                  defaultValue={deadline?.workMode ?? "single"}
                >
                  <option value="single">One session</option>
                  <option value="multiple">Multiple sessions</option>
                </select>
              </Field>
              <Field label="Work remaining · minutes (optional)">
                <input
                  name="remainingMinutes"
                  type="number"
                  min={1}
                  max={525600}
                  defaultValue={deadline?.remainingMinutes ?? ""}
                />
              </Field>
            </div>
            <Field label="Project · optional">
              <select name="projectId" defaultValue={deadline?.projectId || ""}>
                <option value="">No project</option>
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notes · optional">
              <textarea
                name="notes"
                rows={2}
                defaultValue={deadline?.notes}
                maxLength={4000}
              />
            </Field>
            {isEdit && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  name="resolved"
                  defaultChecked={deadline?.status === "resolved"}
                />
                Mark this deadline as completed
              </label>
            )}
            <p className="form-hint">
              This appears as a deadline marker, not a reserved work block.
            </p>
          </>
        )}
        {type === "routine" && (
          <>
            <label className="checkbox">
              <input
                type="checkbox"
                name="untimed"
                checked={untimed}
                onChange={(e) => setUntimed(e.target.checked)}
              />
              No specific time
            </label>
            <div className="form-grid">
              {!untimed && (
                <Field label="Starts at">
                  <input
                    type="time"
                    name="start"
                    required
                    defaultValue={
                      routine?.timeSchedules
                        ?.filter((entry) => entry.effective <= dayKey())
                        .sort((a, b) =>
                          b.effective.localeCompare(a.effective),
                        )[0]?.start ||
                      routine?.start ||
                      "18:30"
                    }
                  />
                </Field>
              )}
              <Field
                label={
                  untimed ? "Default duration · minutes" : "Duration · minutes"
                }
              >
                <input
                  type="number"
                  name="duration"
                  min="1"
                  max="1440"
                  required
                  defaultValue={routine?.duration || 30}
                />
              </Field>
            </div>
            {!untimed && (
              <details>
                <summary>Set a different time for each day</summary>
                <p className="form-hint">
                  Leave a day blank to use the default start time.
                </p>
                <div className="form-grid">
                  {DAYS.map((day, i) => (
                    <Field key={day} label={day}>
                      <input
                        type="time"
                        name={`weekdayTime${i}`}
                        defaultValue={
                          routine?.timeSchedules
                            ?.filter((entry) => entry.effective <= dayKey())
                            .sort((a, b) =>
                              b.effective.localeCompare(a.effective),
                            )[0]?.weekdays[i] || ""
                        }
                      />
                    </Field>
                  ))}
                </div>
              </details>
            )}
            {routine && !untimed && (
              <Field label="Apply time changes from">
                <input
                  type="date"
                  name="timeEffective"
                  required
                  defaultValue={dayKey()}
                />
              </Field>
            )}
            <fieldset className="days-field">
              <legend>Repeats on</legend>
              <div className="day-options">
                {DAYS.map((d, i) => (
                  <label key={d}>
                    <input
                      type="checkbox"
                      name="days"
                      value={i}
                      defaultChecked={
                        routine?.days.includes(i) ?? [1, 3, 4].includes(i)
                      }
                    />
                    <span title={d}>{d.slice(0, 2)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="form-grid">
              <Field label="Repeats every">
                <input
                  type="number"
                  name="recurrenceInterval"
                  min="1"
                  max="52"
                  required
                  defaultValue={routine?.recurrenceInterval || 1}
                />
              </Field>
              <Field label="Frequency">
                <select
                  name="recurrenceUnit"
                  defaultValue={routine?.recurrenceUnit || "weeks"}
                >
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                  <option value="months">Months</option>
                </select>
              </Field>
            </div>
            <div className="form-grid">
              <Field label="From">
                <input
                  type="date"
                  name="since"
                  required
                  defaultValue={routine?.since || dayKey()}
                />
              </Field>
              <Field label="Until · optional">
                <input
                  type="date"
                  name="until"
                  defaultValue={routine?.until || ""}
                />
              </Field>
            </div>
            <Field label="Calendar color">
              <select name="color" defaultValue={routine?.color || "sage"}>
                <option value="sage">Sage</option>
                <option value="peach">Apricot</option>
                <option value="blue">Sky</option>
                <option value="lavender">Lavender</option>
              </select>
            </Field>
            {isEdit && (
              <p className="form-hint">
                Time changes apply from the chosen date. Other edits apply to
                the series. For a one-off change, open an occurrence in the
                planner.
              </p>
            )}
          </>
        )}
        {type === "project" && (
          <>
            <Field label="Finished outcome">
              <textarea
                name="outcome"
                required
                rows={2}
                defaultValue={project?.outcome}
                placeholder="What will exist when this is done?"
                maxLength={4000}
              />
            </Field>
            <Field label="Final deadline">
              <input
                type="date"
                name="date"
                required
                defaultValue={project?.deadline || dayKey()}
              />
            </Field>
            <Field label="Starting point">
              <input
                name="startingPoint"
                defaultValue={project?.startingPoint}
                placeholder="What is already finished?"
                maxLength={4000}
              />
            </Field>
            <Field label="Requirements or risks · optional">
              <textarea
                name="notes"
                rows={2}
                defaultValue={project?.notes}
                maxLength={4000}
              />
            </Field>
          </>
        )}
        {type === "milestone" && (
          <>
            <div className="form-grid">
              <Field label="Target date">
                <input
                  type="date"
                  name="date"
                  required
                  defaultValue={milestone?.date || project?.deadline}
                  max={project?.deadline}
                />
              </Field>
              <Field
                label="Workload · hours"
                hint="Your estimate of the work needed for this milestone."
              >
                <input
                  type="number"
                  name="workload"
                  step="any"
                  min="0.01"
                  max="8760"
                  defaultValue={
                    milestone?.estimate == null ? "" : milestone.estimate / 60
                  }
                />
              </Field>
            </div>
            <Field
              label="Time budget · hours"
              hint="How much time you can set aside for this milestone."
            >
              <input
                type="number"
                name="budget"
                step="any"
                min="0.01"
                max="8760"
                defaultValue={
                  milestone?.timeBudgetMinutes == null
                    ? ""
                    : milestone.timeBudgetMinutes / 60
                }
              />
            </Field>
            {!!project?.milestones.filter((m) => m.id !== modal.id).length && (
              <fieldset className="dependency-field">
                <legend>Depends on</legend>
                {project.milestones
                  .filter((m) => m.id !== modal.id)
                  .map((m) => (
                    <label className="checkbox" key={m.id}>
                      <input
                        type="checkbox"
                        name="dependsOn"
                        value={m.id}
                        defaultChecked={milestone?.dependsOn.includes(m.id)}
                      />
                      {m.title}
                    </label>
                  ))}
              </fieldset>
            )}
            <Field label="Evidence or planning notes">
              <textarea
                name="reason"
                rows={2}
                defaultValue={milestone?.reason}
                maxLength={4000}
              />
            </Field>
            <label className="checkbox approval">
              <input
                name="approve"
                type="checkbox"
                defaultChecked={milestone?.approved}
              />
              <span>I approve this milestone and its target date.</span>
            </label>
          </>
        )}
        {type === "session" && (
          <>
            <Field label="Task">
              <select
                name="taskId"
                required
                value={chosenTask}
                onChange={(e) => setChosenTask(e.target.value)}
              >
                <option value="" disabled>
                  Select a task
                </option>
                {state.tasks
                  .filter(
                    (t) =>
                      (t.status === "active" && !t.deletedProject) ||
                      t.id === session?.taskId,
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Date">
              <input
                type="date"
                name="date"
                required
                defaultValue={modal.date || session?.date || dayKey()}
              />
            </Field>
            <div className="form-grid">
              <Field label="Start time">
                <input
                  type="time"
                  name="start"
                  required
                  defaultValue={modal.start || session?.start || "09:00"}
                />
              </Field>
              <Field label="Allocated time · minutes">
                <input
                  type="number"
                  name="duration"
                  min="1"
                  max="1440"
                  required
                  defaultValue={
                    session?.duration ||
                    defaultSessionDuration(
                      state.tasks.find((t) => t.id === chosenTask),
                    )
                  }
                />
              </Field>
            </div>
            {isEdit ? (
              <>
                <div className="form-grid">
                  <Field label="Outcome">
                    <select name="outcome" defaultValue={session?.outcome}>
                      {OUTCOMES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Actual work · minutes"
                    hint="Optional; leave blank if unknown."
                  >
                    <input
                      type="number"
                      name="actual"
                      min="0"
                      max="1440"
                      defaultValue={session?.actualMinutes ?? ""}
                    />
                  </Field>
                </div>
                <Field label="Session focus · optional">
                  <select
                    name="sessionFocus"
                    defaultValue={session?.focus ?? ""}
                  >
                    <option value="">Unreported</option>
                    <option>Focused</option>
                    <option>Mixed</option>
                    <option>Distracted</option>
                  </select>
                </Field>
                <Field label="What changed? · optional">
                  <textarea
                    rows={2}
                    name="note"
                    defaultValue={session?.note}
                    maxLength={4000}
                  />
                </Field>
              </>
            ) : (
              <>
                <input type="hidden" name="outcome" value="pending" />
                <input type="hidden" name="note" value="" />
              </>
            )}
            <label className="checkbox">
              <input type="checkbox" name="allowOverlap" />
              Allow an overlapping commitment
            </label>
            {session?.needsReview && (
              <div className="notice">
                <AlertTriangle size={16} />
                The parent task is complete. Review whether this pending session
                is still needed.
              </div>
            )}
          </>
        )}
        {type === "occurrence" && routine && (
          <>
            <div className="notice">
              {routine.title} · {modal.date}
            </div>
            {(!routine.untimed || occurrence) && (
              <div className="form-grid">
                <Field label="Start time">
                  <input
                    type="time"
                    name="start"
                    required
                    defaultValue={
                      occurrence?.start || routineStart(routine, modal.date!)
                    }
                  />
                </Field>
                <Field label="Duration · minutes">
                  <input
                    type="number"
                    name="duration"
                    min="1"
                    required
                    defaultValue={occurrence?.duration || routine.duration}
                  />
                </Field>
              </div>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                name="skip"
                defaultChecked={occurrence?.skip}
              />
              Skip this occurrence
            </label>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {type === "session" &&
            session?.outcome === "pending" &&
            session.actualMinutes === null &&
            !session.note.trim() && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  if (onUnschedule(session.id)) onClose();
                }}
              >
                <Undo2 size={15} /> Put back in task list
              </button>
            )}
          {isEdit &&
            ["task", "session", "deadline", "milestone", "project"].includes(
              type,
            ) && (
              <button
                type="button"
                className={
                  type === "project"
                    ? "button secondary danger"
                    : "icon-button danger"
                }
                onClick={remove}
                aria-label={"Delete " + type}
              >
                <Trash2 size={17} />
                {type === "project" && "Delete project"}
              </button>
            )}
          {type === "task" && task && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                try {
                  update((s) =>
                    finishTask(s, task.id, task.status !== "completed"),
                  );
                  onClose();
                  onSaved(
                    task.status === "completed"
                      ? "Task reopened."
                      : "Task completed. Pending sessions flagged for review.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Check size={15} />
              {task.status === "completed" ? "Reopen" : "Finish task"}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            {isEdit
              ? "Save changes"
              : type === "session"
                ? "Schedule session"
                : "Create " + type}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
