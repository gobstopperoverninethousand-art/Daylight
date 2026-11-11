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
  removeTask,
} from "@/lib/model";
import { overlap } from "@/lib/engine";
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
    [chosenTask, setChosenTask] = useState(
      session?.taskId ||
        modal.taskId ||
        state.tasks.find((t) => t.status === "active")?.id ||
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
            deadlineId: str("deadlineId") || null,
            projectId: str("projectId") || null,
            milestoneId: str("milestoneId") || null,
            importance: str("importance") as Task["importance"],
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
            projectId: str("projectId") || null,
            status: deadline?.status || ("active" as const),
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
            color: str("color") as "sage" | "peach" | "blue" | "lavender",
          };
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
            note: str("note"),
            needsReview: session?.needsReview || false,
          };
          const idx = s.sessions.findIndex((x) => x.id === recordId);
          if (idx >= 0) s.sessions[idx] = value;
          else s.sessions.push(value);
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
          ? "Session saved. Task completion is tracked separately."
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
      type === "task"
        ? "Delete this task and all of its scheduled sessions? This cannot be undone. Google events will be removed on your next sync."
        : "Remove this " +
          type +
          "? This cannot be undone. Google changes apply only on your next sync.";
    if (type !== "session" && !confirm(message)) return;
    try {
      update((s) => {
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
                  name="deadlineId"
                  defaultValue={task?.deadlineId || modal.deadlineId || ""}
                >
                  <option value="">No deadline</option>
                  {state.deadlines.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
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
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Standalone task</option>
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </Field>
            {projectId && (
              <Field label="Milestone">
                <select
                  name="milestoneId"
                  key={projectId}
                  defaultValue={task?.milestoneId || modal.milestoneId || ""}
                >
                  <option value="">No milestone</option>
                  {state.projects
                    .find((p) => p.id === projectId)
                    ?.milestones.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                        {!m.approved ? " · draft" : ""}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field label="Notes · optional">
              <textarea
                name="notes"
                rows={2}
                maxLength={4000}
                defaultValue={task?.notes}
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
                    defaultValue={routine?.start || "18:30"}
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
                Edits apply to the series. For a one-off change, open an
                occurrence in the planner.
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
                    (t) => t.status === "active" || t.id === session?.taskId,
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
                    defaultValue={occurrence?.start || routine.start}
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
            ["task", "session", "deadline", "milestone"].includes(type) && (
              <button
                type="button"
                className="icon-button danger"
                onClick={remove}
                aria-label={"Delete " + type}
              >
                <Trash2 size={17} />
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
