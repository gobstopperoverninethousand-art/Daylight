"use client";
import { useState, useRef, useEffect, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Check,
  Flag,
  Repeat2,
  CalendarDays,
} from "lucide-react";
import {
  State,
  Task,
  dayKey,
  addDays,
  weekday,
  clockTime,
  formatDate,
  displayTime,
  durationLabel,
  Outcome,
} from "@/lib/model";
import {
  blocksForDay,
  Block,
  calendarEventIntervals,
  recommendations,
  scheduledTaskIds,
  zonedParts,
} from "@/lib/engine";
import { EditorState } from "./editor";
import type { EventDrop } from "@/lib/google-event-edit";
import { IconButton, OutcomeSelect } from "./ui";
import { DeadlineStrip } from "./deadline-strip";
const sessionDrag = "application/daylight-session";
const googleEventDrag = "application/daylight-google-event";
const taskDrag = "application/daylight-task";
const routineDrag = "application/daylight-routine";
const minutesPerPixel = 60 / 64;
const calendarStep = 15;
const snap = (minutes: number) =>
  Math.round(minutes / calendarStep) * calendarStep;
const clamp = (value: number, lower: number, upper: number) =>
  Math.min(upper, Math.max(lower, value));
type SessionTiming = {
  id: string;
  date: string;
  start: number;
  duration: number;
};
type ResizeGesture = {
  session: SessionTiming;
  edge: "start" | "end";
  pointerY: number;
};

function resizedSession(
  session: SessionTiming,
  edge: ResizeGesture["edge"],
  change: number,
) {
  if (!change) return session;
  const end = session.start + session.duration;
  const minDuration = Math.min(session.duration, calendarStep);
  if (edge === "start") {
    const start = clamp(snap(session.start + change), 0, end - minDuration);
    return { ...session, start, duration: end - start };
  }
  return {
    ...session,
    duration:
      clamp(snap(end + change), session.start + minDuration, 1440) -
      session.start,
  };
}
const calendarViews = ["Day", "Week", "Month", "Year", "Year Columns"] as const;
export type CalendarView = (typeof calendarViews)[number];
function TaskCard({
  task,
  reason,
  onSchedule,
  onEdit,
}: {
  task: Task;
  reason?: string;
  onSchedule: () => void;
  onEdit: () => void;
}) {
  return (
    <article
      className="task-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(taskDrag, task.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <button
        className="plain task-title"
        title={reason}
        aria-description={reason}
        onClick={onEdit}
      >
        {task.title}
      </button>
      <span className="todo-duration">
        {durationLabel(task.remaining ?? task.estimate)}
      </span>
      <button
        className="schedule-button"
        onClick={onSchedule}
        title="Choose a time"
        aria-label={"Schedule " + task.title}
      >
        <Plus size={14} />
      </button>
    </article>
  );
}
function layout(blocks: Block[]) {
  const result: { block: Block; lane: number; lanes: number }[] = [];
  let group: typeof result = [];
  let end = -1;
  const flush = () => {
    const lanes = Math.max(1, ...group.map((x) => x.lane + 1));
    group.forEach((x) => {
      x.lanes = lanes;
      result.push(x);
    });
    group = [];
  };
  for (const block of blocks) {
    if (block.start >= end) {
      flush();
      end = block.start + block.duration;
    } else end = Math.max(end, block.start + block.duration);
    let lane = 0;
    while (
      group.some(
        (x) =>
          x.lane === lane && x.block.start + x.block.duration > block.start,
      )
    )
      lane++;
    group.push({ block, lane, lanes: 1 });
  }
  flush();
  return result;
}
export function Planner({
  state,
  date,
  setDate,
  edit,
  openGoogleEvent,
  moveImportedEvent,
  resizeImportedEvent,
  scheduleTask,
  moveRoutineOccurrence,
  restoreRoutineOccurrence,
  canManageGoogle,
  unscheduleSession,
  adjustSession,
  setOutcome,
  aiReady,
  aiNeedsSignIn,
  aiBusy,
  requestPriorities,
  aiPriorities,
}: {
  state: State;
  date: string;
  setDate: (s: string) => void;
  edit: (s: EditorState) => void;
  openGoogleEvent: (id: string) => void;
  moveImportedEvent: (id: string, move: EventDrop) => Promise<void>;
  resizeImportedEvent: (
    id: string,
    date: string,
    start: string,
    duration: number,
  ) => Promise<void>;
  scheduleTask: (id: string, date: string, start: string) => void;
  moveRoutineOccurrence: (
    id: string,
    sourceDate: string,
    date: string,
    start: string,
    duration: number,
  ) => void;
  restoreRoutineOccurrence: (
    id: string,
    sourceDate: string,
    date: string,
  ) => void;
  canManageGoogle: boolean;
  unscheduleSession: (id: string) => boolean;
  adjustSession: (
    id: string,
    date: string,
    start: string,
    duration: number,
  ) => void;
  setOutcome: (kind: string, id: string, date: string, value: Outcome) => void;
  aiReady: boolean;
  aiNeedsSignIn: boolean;
  aiBusy: boolean;
  requestPriorities: () => void;
  aiPriorities: {
    summary: string;
    recommendations: { taskId: string; reason: string }[];
    stale: boolean;
    createdAt: string;
  } | null;
}) {
  const [view, setView] = useState<CalendarView>("Week"),
    [bank, setBank] = useState<"recommended" | "unscheduled" | "active">(
      "recommended",
    );
  const zonedNow = zonedParts(
    new Date().toISOString(),
    state.settings.timezone,
  );
  const today = zonedNow.day;
  const scheduled = scheduledTaskIds(state);
  const recommended = recommendations(state, date);
  const unscheduled = recommended.filter(({ task }) => !scheduled.has(task.id));
  const allScheduled = recommended.length > 0 && unscheduled.length === 0;
  const returnedIds = new Set(
    state.audit
      .filter(
        (entry) =>
          entry.action === "Returned task to planner" &&
          (!aiPriorities || entry.at >= aiPriorities.createdAt),
      )
      .reverse()
      .map((entry) => entry.recordId),
  );
  const returned = [...returnedIds].flatMap((id) => {
    const item = unscheduled.find(({ task }) => task.id === id);
    return item ? [{ ...item, reason: "Put back from the calendar." }] : [];
  });
  const editableEvents = new Set(
    canManageGoogle
      ? state.events.filter((event) => event.canEdit).map((event) => event.id)
      : [],
  );
  const suggested =
    bank === "recommended"
      ? aiPriorities
        ? aiPriorities.recommendations.flatMap((r) => {
            const task = unscheduled.find(
              ({ task }) => task.id === r.taskId,
            )?.task;
            return task
              ? [{ task, reason: r.reason, due: null, score: 0 }]
              : [];
          })
        : unscheduled.slice(0, 3)
      : bank === "active"
        ? recommended
        : unscheduled;
  const tasks =
    bank === "recommended"
      ? [
          ...returned,
          ...suggested.filter(({ task }) => !returnedIds.has(task.id)),
        ]
      : suggested;
  const yearly = view === "Year" || view === "Year Columns";
  const start = addDays(date, -weekday(date));
  const dates =
    view === "Day"
      ? [date]
      : Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const calendarEvents = useMemo(() => calendarEventIntervals(state), [state]);
  const days =
    view === "Day" || view === "Week"
      ? dates.map((d) => ({
          date: d,
          blocks: blocksForDay(state, d, calendarEvents),
        }))
      : [];
  const routines = (
    days.find((day) => day.date === date)?.blocks ??
    blocksForDay(state, date, calendarEvents)
  ).filter((block) => block.kind === "routine");
  const [sessionPreview, setSessionPreview] = useState<SessionTiming | null>(
    null,
  );
  const dragSession = useRef<{ id: string; grabMinutes: number } | null>(null);
  const resize = useRef<ResizeGesture | null>(null);
  function saveTiming(timing: SessionTiming) {
    adjustSession(
      timing.id,
      timing.date,
      clockTime(timing.start),
      timing.duration,
    );
  }
  function startSessionDrag(e: React.DragEvent<HTMLElement>, id: string) {
    if (resize.current) {
      e.preventDefault();
      return;
    }
    dragSession.current = {
      id,
      grabMinutes: e.currentTarget.closest(".day-column")
        ? Math.max(
            0,
            (e.clientY - e.currentTarget.getBoundingClientRect().top) *
              minutesPerPixel,
          )
        : 0,
    };
    e.dataTransfer.setData(sessionDrag, id);
    e.dataTransfer.effectAllowed = "move";
  }
  function dragRoutine(
    e: React.DragEvent<HTMLElement>,
    id: string,
    date: string,
  ) {
    e.dataTransfer.setData(routineDrag, JSON.stringify({ id, date }));
    e.dataTransfer.effectAllowed = "move";
  }
  function endSessionDrag() {
    dragSession.current = null;
    setSessionPreview(null);
  }
  function sessionAtPointer(
    e: React.DragEvent<HTMLDivElement>,
    date: string,
    id: string,
  ) {
    const session = state.sessions.find((entry) => entry.id === id);
    if (!session) return;
    const grabMinutes = dragSession.current?.grabMinutes ?? 0;
    const pointerMinutes =
      (e.clientY - e.currentTarget.getBoundingClientRect().top) *
      minutesPerPixel;
    const start = clamp(
      snap(pointerMinutes - grabMinutes),
      0,
      1440 - session.duration,
    );
    return { id, date, start, duration: session.duration };
  }
  function resizeControl(block: Block, edge: ResizeGesture["edge"]) {
    const session = {
      id: block.id,
      date: block.date,
      start: block.start,
      duration: block.duration,
    };
    return (
      <button
        type="button"
        className={`session-resize-handle ${edge}`}
        aria-label={`Resize ${edge} of ${block.title}`}
        title={`Drag to change ${edge} time`}
        onDragStart={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          resize.current = { session, edge, pointerY: e.clientY };
        }}
        onPointerMove={(e) => {
          const gesture = resize.current;
          if (gesture && e.currentTarget.hasPointerCapture(e.pointerId))
            setSessionPreview(
              resizedSession(
                gesture.session,
                gesture.edge,
                snap((e.clientY - gesture.pointerY) * minutesPerPixel),
              ),
            );
        }}
        onPointerUp={(e) => {
          const gesture = resize.current;
          if (!gesture || !e.currentTarget.hasPointerCapture(e.pointerId))
            return;
          resize.current = null;
          setSessionPreview(null);
          const next = resizedSession(
            gesture.session,
            gesture.edge,
            snap((e.clientY - gesture.pointerY) * minutesPerPixel),
          );
          if (block.kind === "routine")
            moveRoutineOccurrence(
              block.sourceId,
              block.date,
              block.date,
              clockTime(next.start),
              next.duration,
            );
          else if (block.kind === "external")
            void resizeImportedEvent(
              block.sourceId,
              block.date,
              clockTime(next.start),
              next.duration,
            );
          else saveTiming(next);
        }}
        onLostPointerCapture={() => {
          if (!resize.current) return;
          resize.current = null;
          setSessionPreview(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          const next = resizedSession(
            session,
            edge,
            e.key === "ArrowDown" ? calendarStep : -calendarStep,
          );
          if (block.kind === "routine")
            moveRoutineOccurrence(
              block.sourceId,
              block.date,
              block.date,
              clockTime(next.start),
              next.duration,
            );
          else if (block.kind === "external")
            void resizeImportedEvent(
              block.sourceId,
              block.date,
              clockTime(next.start),
              next.duration,
            );
          else saveTiming(next);
        }}
      />
    );
  }
  function showDay(d: string) {
    setDate(d);
    setView("Day");
  }
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 7 * 64;
  }, [view]);
  function move(n: number) {
    if (view === "Day") setDate(addDays(date, n));
    else if (view === "Week") setDate(addDays(date, n * 7));
    else {
      const d = new Date(date + "T12:00:00");
      d.setDate(1);
      if (yearly) d.setFullYear(d.getFullYear() + n);
      else d.setMonth(d.getMonth() + n);
      setDate(dayKey(d));
    }
  }
  function dropGoogleEvent(
    e: React.DragEvent<HTMLElement>,
    date: string,
    start?: string,
  ) {
    const id = e.dataTransfer.getData(googleEventDrag);
    if (!id || !editableEvents.has(id)) return false;
    e.preventDefault();
    e.stopPropagation();
    void moveImportedEvent(id, { date, start });
    return true;
  }
  function dropAtHour(
    e: React.DragEvent<HTMLElement>,
    date: string,
    start: string,
  ) {
    if (dropGoogleEvent(e, date, start)) return true;
    const taskId = e.dataTransfer.getData(taskDrag);
    if (taskId) {
      e.preventDefault();
      e.stopPropagation();
      scheduleTask(taskId, date, start);
      return true;
    }
    const routineData = e.dataTransfer.getData(routineDrag);
    if (routineData) {
      e.preventDefault();
      e.stopPropagation();
      const { id, date: sourceDate } = JSON.parse(routineData) as {
        id: string;
        date: string;
      };
      const routine = state.routines.find((r) => r.id === id);
      if (routine)
        moveRoutineOccurrence(id, sourceDate, date, start, routine.duration);
      return true;
    }
    return false;
  }
  function acceptGoogleDrop(e: React.DragEvent<HTMLElement>) {
    if (e.dataTransfer.types.includes(googleEventDrag)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }
  function dragGoogleEvent(e: React.DragEvent<HTMLElement>, id: string) {
    e.dataTransfer.setData(googleEventDrag, id);
    e.dataTransfer.effectAllowed = "move";
  }
  const routineDatePicker = (
    <input
      type="date"
      aria-label="Routine date"
      value={date}
      onChange={(e) => {
        if (e.target.value) setDate(e.target.value);
      }}
    />
  );
  return (
    <>
      {view === "Year Columns" && (
        <div className="year-overview-heading">
          <h1>Year at a glance</h1>
          <p>Select a date to open its day plan.</p>
        </div>
      )}
      <details
        className="planner-routines"
        open={view === "Day" || view === "Week"}
      >
        <summary>
          <Repeat2 size={16} aria-hidden="true" />
          <strong>Routines and dailies</strong>
          <span>
            {formatDate(date, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
          <span className="routine-tally">
            {routines.filter((block) => block.outcome === "completed").length}{" "}
            of {routines.length} done
          </span>
          <ChevronDown
            size={16}
            className="routine-chevron"
            aria-hidden="true"
          />
        </summary>
        <div className="planner-routine-body">
          <div className="planner-routine-label">{routineDatePicker}</div>
          {routines.length ? (
            <div
              className="planner-card-row"
              role="region"
              aria-label="Routine cards"
              tabIndex={0}
            >
              {routines.map((routine) => (
                <article
                  className="planner-item-card routine-strip-card"
                  key={routine.id}
                >
                  <span className="strip-card-date">
                    {routine.allDay
                      ? "Any time"
                      : displayTime(clockTime(routine.start)) +
                        " · " +
                        durationLabel(routine.duration)}
                  </span>
                  <button
                    className="plain"
                    onClick={() =>
                      edit({ kind: "occurrence", id: routine.sourceId, date })
                    }
                  >
                    <strong>{routine.title}</strong>
                  </button>
                  <OutcomeSelect
                    label={routine.title + " outcome"}
                    value={routine.outcome}
                    onChange={(value) =>
                      setOutcome(
                        "routine",
                        routine.sourceId,
                        date,
                        value as Outcome,
                      )
                    }
                  />
                </article>
              ))}
            </div>
          ) : (
            <p className="planner-strip-empty">
              No routines scheduled for this day.
            </p>
          )}
        </div>
      </details>
      <DeadlineStrip state={state} today={today} edit={edit} />
      {view !== "Year Columns" && (
        <section
          className="ai-todo-explanation"
          aria-label="AI to-do explanation"
        >
          <div>
            <p>
              {aiPriorities?.summary ||
                (aiNeedsSignIn
                  ? "Sign in under Settings to get an AI explanation for today’s to-do list."
                  : aiReady
                    ? "Refresh the AI to-do list to see how today’s tasks were chosen."
                    : "Local task suggestions are available while Gemini is disconnected.")}
            </p>
            {aiPriorities?.stale && (
              <span className="form-hint" role="status">
                Plan changed · Needs refresh
              </span>
            )}
          </div>
          <button
            className="button secondary small"
            disabled={!aiReady || aiBusy || unscheduled.length === 0}
            onClick={() => {
              setBank("recommended");
              requestPriorities();
            }}
          >
            {aiBusy ? "Refreshing…" : "Refresh AI to-do list"}
          </button>
        </section>
      )}
      <div
        className={
          view === "Year Columns"
            ? "planner-workspace calendar-only"
            : "planner-workspace"
        }
      >
        {view !== "Year Columns" && (
          <aside
            className="priority-strip todo-rail"
            aria-label="To-do list"
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(sessionDrag)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              e.currentTarget.classList.add("drag-over");
            }}
            onDragLeave={(e) => {
              if (
                !e.relatedTarget ||
                !e.currentTarget.contains(e.relatedTarget as Node)
              )
                e.currentTarget.classList.remove("drag-over");
            }}
            onDrop={(e) => {
              e.currentTarget.classList.remove("drag-over");
              const id = e.dataTransfer.getData(sessionDrag);
              if (!id) return;
              e.preventDefault();
              endSessionDrag();
              if (unscheduleSession(id)) setBank("recommended");
            }}
          >
            <div className="todo-rail-heading">
              <h2>To-do</h2>
              <button
                className="schedule-button"
                title="New task"
                aria-label="New task"
                onClick={() => edit({ kind: "task" })}
              >
                <Plus size={14} />
              </button>
            </div>
            <div
              className="bank-tabs"
              role="group"
              aria-label="Task bank filter"
            >
              <button
                className={bank === "recommended" ? "active" : ""}
                aria-pressed={bank === "recommended"}
                onClick={() => setBank("recommended")}
              >
                Suggested
              </button>
              <button
                className={bank === "unscheduled" ? "active" : ""}
                aria-pressed={bank === "unscheduled"}
                onClick={() => setBank("unscheduled")}
              >
                Unscheduled
              </button>
              <button
                className={bank === "active" ? "active" : ""}
                aria-pressed={bank === "active"}
                onClick={() => setBank("active")}
              >
                All active
              </button>
            </div>
            {tasks.length ? (
              <div className="todo-list">
                {tasks
                  .slice(0, bank === "recommended" ? 3 : 30)
                  .map(({ task, reason }) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      reason={reason}
                      onEdit={() => edit({ kind: "task", id: task.id })}
                      onSchedule={() =>
                        edit({ kind: "session", taskId: task.id, date })
                      }
                    />
                  ))}
              </div>
            ) : (
              <p className="todo-empty">
                {bank !== "active" && allScheduled
                  ? "All active tasks are scheduled."
                  : aiPriorities && bank === "recommended"
                    ? "No saved suggestions to schedule."
                    : "No tasks here yet."}
              </p>
            )}
          </aside>
        )}
        <section className="calendar-panel">
          <div className="calendar-toolbar">
            <div className="calendar-title">
              <CalendarDays size={19} />
              <h2>
                {yearly
                  ? date.slice(0, 4)
                  : formatDate(date, { month: "long", year: "numeric" })}
              </h2>
              <div className="nav-arrows">
                <IconButton label="Previous period" onClick={() => move(-1)}>
                  <ChevronLeft size={17} />
                </IconButton>
                <IconButton label="Next period" onClick={() => move(1)}>
                  <ChevronRight size={17} />
                </IconButton>
              </div>
              <button
                className="button small secondary"
                onClick={() => setDate(today)}
              >
                Today
              </button>
            </div>
            <div className="view-switch" aria-label="Calendar view">
              {calendarViews.map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={view === v ? "active" : ""}
                  aria-pressed={view === v}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          {view === "Day" || view === "Week" ? (
            <div className="calendar-scroll-x">
              <div
                className={
                  "week-calendar " + (view === "Day" ? "single-day" : "")
                }
              >
                <div
                  className="week-heading"
                  style={{
                    gridTemplateColumns: `58px repeat(${dates.length}, minmax(0, 1fr))`,
                  }}
                >
                  <div className="timezone-tag">
                    {
                      new Intl.DateTimeFormat("en", {
                        timeZone: state.settings.timezone,
                        timeZoneName: "short",
                      })
                        .formatToParts(new Date())
                        .find((p) => p.type === "timeZoneName")?.value
                    }
                  </div>
                  {dates.map((d) => (
                    <button
                      key={d}
                      className={
                        "day-heading " + (d === today ? "is-today" : "")
                      }
                      onClick={() => showDay(d)}
                      onDragOver={acceptGoogleDrop}
                      onDrop={(e) => dropGoogleEvent(e, d)}
                    >
                      <span>
                        {formatDate(d, { weekday: "short" }).toUpperCase()}
                      </span>
                      <strong>{new Date(d + "T12:00:00").getDate()}</strong>
                      {d === today && <i />}
                    </button>
                  ))}
                </div>
                <div
                  className="deadline-row"
                  style={{
                    gridTemplateColumns: `58px repeat(${dates.length}, minmax(0, 1fr))`,
                  }}
                >
                  <span className="deadline-label">
                    <Flag size={12} />
                  </span>
                  {days.map(({ date: d, blocks }) => (
                    <div
                      key={d}
                      className="deadline-cell"
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes(routineDrag)) {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        } else acceptGoogleDrop(e);
                      }}
                      onDrop={(e) => {
                        const data = e.dataTransfer.getData(routineDrag);
                        if (data) {
                          e.preventDefault();
                          const { id, date: sourceDate } = JSON.parse(data) as {
                            id: string;
                            date: string;
                          };
                          restoreRoutineOccurrence(id, sourceDate, d);
                          return;
                        }
                        dropGoogleEvent(e, d);
                      }}
                    >
                      {state.deadlines
                        .filter((x) => x.date === d && x.status === "active")
                        .map((x) => (
                          <button
                            className="deadline-chip"
                            key={x.id}
                            onClick={() => edit({ kind: "deadline", id: x.id })}
                          >
                            <span />
                            Due · {x.title}
                          </button>
                        ))}
                      {state.projects.flatMap((p) =>
                        p.milestones
                          .filter(
                            (m) => m.approved && !m.completed && m.date === d,
                          )
                          .map((m) => (
                            <button
                              className="deadline-chip lavender-text"
                              key={m.id}
                              onClick={() =>
                                edit({
                                  kind: "milestone",
                                  id: m.id,
                                  projectId: p.id,
                                })
                              }
                            >
                              ◇ {m.title}
                            </button>
                          )),
                      )}
                      {state.projects
                        .filter(
                          (p) => p.status === "active" && p.deadline === d,
                        )
                        .map((p) => (
                          <button
                            className="deadline-chip lavender-text"
                            key={p.id}
                            onClick={() => edit({ kind: "project", id: p.id })}
                          >
                            Due · {p.title}
                          </button>
                        ))}
                      {blocks
                        .filter((b) => b.allDay && b.kind === "external")
                        .map((b) => (
                          <button
                            className={`deadline-chip all-day-chip ${b.color}`}
                            key={b.id}
                            title={b.title}
                            draggable={editableEvents.has(b.sourceId)}
                            onDragStart={(e) => dragGoogleEvent(e, b.sourceId)}
                            onClick={() => openGoogleEvent(b.sourceId)}
                          >
                            {b.title}
                          </button>
                        ))}
                      {blocks.some((b) => b.allDay && b.kind === "routine") && (
                        <div
                          className="untimed-routine-group"
                          aria-label="Any-time routines"
                        >
                          {blocks
                            .filter((b) => b.allDay && b.kind === "routine")
                            .map((b) => (
                              <div className="deadline-chip" key={b.id}>
                                <label className="routine-completion">
                                  <input
                                    type="checkbox"
                                    checked={b.outcome === "completed"}
                                    aria-label={`Mark ${b.title} completed`}
                                    onChange={(e) =>
                                      setOutcome(
                                        "routine",
                                        b.sourceId,
                                        d,
                                        e.target.checked
                                          ? "completed"
                                          : "pending",
                                      )
                                    }
                                  />
                                  <span />
                                </label>
                                <button
                                  className="routine-deadline-title"
                                  draggable
                                  onDragStart={(e) =>
                                    dragRoutine(e, b.sourceId, d)
                                  }
                                  onClick={() =>
                                    edit({
                                      kind: "occurrence",
                                      id: b.sourceId,
                                      date: d,
                                    })
                                  }
                                >
                                  {b.title}
                                </button>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div ref={scroll} className="time-grid-scroll">
                  <div
                    className="time-grid"
                    style={{
                      gridTemplateColumns: `58px repeat(${dates.length}, minmax(0, 1fr))`,
                    }}
                  >
                    <div className="time-labels">
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} style={{ top: h * 64 }}>
                          {displayTime(clockTime(h * 60))}
                        </div>
                      ))}
                    </div>
                    {days.map(({ date: d, blocks }) => (
                      <div
                        key={d}
                        className={
                          "day-column " + (d === today ? "today-column" : "")
                        }
                        onDragOver={(e) => {
                          if (e.dataTransfer.types.includes(taskDrag)) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "copy";
                            return;
                          }
                          if (e.dataTransfer.types.includes(routineDrag)) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            return;
                          }
                          acceptGoogleDrop(e);
                          if (
                            !e.dataTransfer.types.includes(sessionDrag) ||
                            !dragSession.current
                          )
                            return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          const timing = sessionAtPointer(
                            e,
                            d,
                            dragSession.current.id,
                          );
                          if (timing)
                            setSessionPreview((previous) =>
                              previous?.id === timing.id &&
                              previous.date === timing.date &&
                              previous.start === timing.start
                                ? previous
                                : timing,
                            );
                        }}
                        onDragLeave={(e) => {
                          if (
                            !e.relatedTarget ||
                            !e.currentTarget.contains(e.relatedTarget as Node)
                          )
                            setSessionPreview((current) =>
                              current?.date === d && dragSession.current
                                ? null
                                : current,
                            );
                        }}
                        onDrop={(e) => {
                          const pointerMinutes =
                            (e.clientY -
                              e.currentTarget.getBoundingClientRect().top) *
                            minutesPerPixel;
                          const start = clockTime(
                            clamp(snap(pointerMinutes), 0, 1440 - calendarStep),
                          );
                          if (dropGoogleEvent(e, d, start)) return;
                          const taskId = e.dataTransfer.getData(taskDrag);
                          if (taskId) {
                            e.preventDefault();
                            scheduleTask(taskId, d, start);
                            return;
                          }
                          const routineData =
                            e.dataTransfer.getData(routineDrag);
                          if (routineData) {
                            e.preventDefault();
                            const { id, date: sourceDate } = JSON.parse(
                              routineData,
                            ) as {
                              id: string;
                              date: string;
                            };
                            const routine = state.routines.find(
                              (r) => r.id === id,
                            );
                            if (routine)
                              moveRoutineOccurrence(
                                id,
                                sourceDate,
                                d,
                                start,
                                routine.duration,
                              );
                            return;
                          }
                          const id = e.dataTransfer.getData(sessionDrag);
                          if (!id) return;
                          e.preventDefault();
                          const timing = sessionAtPointer(e, d, id);
                          endSessionDrag();
                          if (timing) saveTiming(timing);
                        }}
                      >
                        <div className="hour-slots">
                          {Array.from({ length: 24 }, (_, h) => (
                            <div
                              className="hour-slot"
                              key={h}
                              onDragOver={(e) => {
                                if (
                                  ![
                                    googleEventDrag,
                                    taskDrag,
                                    routineDrag,
                                  ].some((type) =>
                                    e.dataTransfer.types.includes(type),
                                  )
                                )
                                  return;
                                e.preventDefault();
                                e.currentTarget.classList.add("drag-over");
                              }}
                              onDragLeave={(e) =>
                                e.currentTarget.classList.remove("drag-over")
                              }
                              onDrop={(e) => {
                                e.currentTarget.classList.remove("drag-over");
                                dropAtHour(e, d, clockTime(h * 60));
                              }}
                            >
                              <button
                                aria-label={`Schedule on ${d} at ${clockTime(h * 60)}`}
                                onClick={() =>
                                  edit({
                                    kind: "session",
                                    date: d,
                                    start: clockTime(h * 60),
                                  })
                                }
                              />
                            </div>
                          ))}
                        </div>
                        {layout(blocks.filter((b) => !b.allDay)).map(
                          ({ block: b, lane, lanes }) => (
                            <div
                              key={b.id}
                              className={`calendar-block ${b.color} ${b.kind === "session" ? "session-block" : ""} ${sessionPreview?.id === b.id ? "session-adjusting" : ""} ${b.outcome === "completed" ? "done" : ""} ${b.outcome === "skipped" ? "skipped" : ""} ${b.duration < 35 ? "short-block" : ""}`}
                              style={{
                                top: (b.start / 60) * 64 + 2,
                                height: Math.max(
                                  27,
                                  (b.duration / 60) * 64 - 4,
                                ),
                                left: `calc(${(lane / lanes) * 100}% + 4px)`,
                                width: `calc(${100 / lanes}% - 8px)`,
                              }}
                              draggable={
                                b.kind === "session" ||
                                b.kind === "routine" ||
                                editableEvents.has(b.sourceId)
                              }
                              onDragStart={(e) => {
                                if (b.kind === "session")
                                  startSessionDrag(e, b.id);
                                else if (b.kind === "routine")
                                  dragRoutine(e, b.sourceId, d);
                                else if (editableEvents.has(b.sourceId))
                                  dragGoogleEvent(e, b.sourceId);
                              }}
                              onDragEnd={
                                b.kind === "session"
                                  ? endSessionDrag
                                  : undefined
                              }
                            >
                              <button
                                className="block-content"
                                title={`${b.title} · ${displayTime(clockTime(b.start))} · ${durationLabel(b.duration)}`}
                                onClick={() =>
                                  b.kind === "external"
                                    ? openGoogleEvent(b.sourceId)
                                    : edit(
                                        b.kind === "routine"
                                          ? {
                                              kind: "occurrence",
                                              id: b.sourceId,
                                              date: d,
                                            }
                                          : { kind: "session", id: b.id },
                                      )
                                }
                              >
                                <span className="block-title">
                                  {b.kind === "routine" && (
                                    <Repeat2 size={11} />
                                  )}{" "}
                                  {b.outcome === "completed" && (
                                    <Check size={11} />
                                  )}{" "}
                                  {b.title}
                                </span>
                                <span className="block-time">
                                  {displayTime(clockTime(b.start))} –{" "}
                                  {b.start + b.duration === 1440
                                    ? "12am"
                                    : displayTime(
                                        clockTime(b.start + b.duration),
                                      )}
                                  {b.needsReview ? " · Review" : ""}
                                </span>
                              </button>
                              {b.kind !== "external" && (
                                <div className="block-controls">
                                  <button
                                    aria-label={`Mark ${b.title} ${b.outcome === "completed" ? "not recorded" : "completed"}`}
                                    title="Toggle session completion"
                                    onClick={() =>
                                      setOutcome(
                                        b.kind,
                                        b.sourceId,
                                        d,
                                        b.outcome === "completed"
                                          ? "pending"
                                          : "completed",
                                      )
                                    }
                                  >
                                    <Check size={12} />
                                  </button>
                                  <OutcomeSelect
                                    compact
                                    value={b.outcome}
                                    onChange={(v) =>
                                      setOutcome(
                                        b.kind,
                                        b.sourceId,
                                        d,
                                        v as Outcome,
                                      )
                                    }
                                  />
                                </div>
                              )}
                              {(b.kind === "session" ||
                                b.kind === "routine" ||
                                (b.kind === "external" &&
                                  editableEvents.has(b.sourceId))) && (
                                <>
                                  {resizeControl(b, "start")}
                                  {resizeControl(b, "end")}
                                </>
                              )}
                            </div>
                          ),
                        )}
                        {sessionPreview?.date === d && (
                          <div
                            className="session-time-preview"
                            aria-hidden="true"
                            style={{
                              top: sessionPreview.start / minutesPerPixel + 2,
                              height: Math.max(
                                22,
                                sessionPreview.duration / minutesPerPixel - 4,
                              ),
                            }}
                          >
                            {displayTime(clockTime(sessionPreview.start))} ·{" "}
                            {durationLabel(sessionPreview.duration)}
                          </div>
                        )}
                        {d === today && (
                          <div
                            className="current-time"
                            style={{
                              top: (zonedNow.minute / 60) * 64,
                            }}
                          >
                            <i />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : view === "Month" ? (
            <Month
              state={state}
              date={date}
              events={calendarEvents}
              select={showDay}
              acceptGoogleDrop={acceptGoogleDrop}
              dropGoogleEvent={dropGoogleEvent}
              editableEvents={editableEvents}
              dragGoogleEvent={dragGoogleEvent}
              startSessionDrag={startSessionDrag}
              endSessionDrag={endSessionDrag}
              adjustSession={adjustSession}
            />
          ) : view === "Year Columns" ? (
            <YearColumns
              state={state}
              year={Number(date.slice(0, 4))}
              today={today}
              events={calendarEvents}
              select={showDay}
            />
          ) : (
            <div className="year-grid">
              {Array.from({ length: 12 }, (_, i) => (
                <MiniMonth
                  key={i}
                  year={Number(date.slice(0, 4))}
                  month={i}
                  state={state}
                  events={calendarEvents}
                  select={showDay}
                />
              ))}
            </div>
          )}
          <div className="calendar-footer">
            <div>
              <span className="legend-dot sage" />
              Tasks
              <span className="legend-dot lavender" />
              Projects
              <span className="legend-dot peach" />
              Routines
              <span className="legend-dot blue" />
              Google Calendar
              {state.events.some((event) => event.holiday) && (
                <>
                  <span className="legend-dot holiday" /> Holidays
                </>
              )}
            </div>
            <span>Your time, thoughtfully planned.</span>
          </div>
        </section>
      </div>
    </>
  );
}
function markersForDay(state: State, date: string) {
  return [
    ...state.deadlines
      .filter((d) => d.status === "active" && d.date === date)
      .map((d) => ({ id: d.id, title: d.title })),
    ...state.projects
      .filter((p) => p.status === "active")
      .flatMap((p) => [
        ...(p.deadline === date ? [{ id: p.id, title: p.title }] : []),
        ...p.milestones
          .filter((m) => m.approved && !m.completed && m.date === date)
          .map((m) => ({ id: m.id, title: m.title })),
      ]),
  ];
}

function YearColumns({
  state,
  year,
  today,
  events,
  select,
}: {
  state: State;
  year: number;
  today: string;
  events: ReturnType<typeof calendarEventIntervals>;
  select: (date: string) => void;
}) {
  return (
    <div
      className="year-columns-scroll"
      role="region"
      aria-label={`${year} year at a glance`}
      tabIndex={0}
    >
      <div className="year-columns">
        {Array.from({ length: 12 }, (_, month) => {
          const first = `${year}-${String(month + 1).padStart(2, "0")}-01`;
          const length = new Date(year, month + 1, 0).getDate();
          return (
            <section className="year-column" key={first}>
              <h3>{formatDate(first, { month: "short" })}</h3>
              {Array.from({ length }, (_, i) => {
                const date =
                  first.slice(0, -2) + String(i + 1).padStart(2, "0");
                const markers = markersForDay(state, date);
                const blocks = blocksForDay(state, date, events);
                const items = [
                  ...markers.map(({ title }) => ({
                    title: "Due: " + title,
                    color: "peach",
                  })),
                  ...blocks.map(({ title, color }) => ({ title, color })),
                ];
                const summary = items.map((item) => item.title).join(", ");
                const label = formatDate(date, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                });
                return (
                  <button
                    key={date}
                    onClick={() => select(date)}
                    aria-label={summary ? label + " — " + summary : label}
                    aria-current={date === today ? "date" : undefined}
                    title={summary ? label + " — " + summary : label}
                    className={`year-date ${[0, 6].includes(weekday(date)) ? "weekend" : ""}`}
                  >
                    <span className="year-date-number">{i + 1}</span>
                    {items.length > 0 && (
                      <>
                        <span className={`year-date-item ${items[0].color}`}>
                          {items[0].title}
                        </span>
                        {items.length > 1 && (
                          <span className="year-date-more">
                            +{items.length - 1}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Month({
  state,
  date,
  events,
  select,
  acceptGoogleDrop,
  dropGoogleEvent,
  editableEvents,
  dragGoogleEvent,
  startSessionDrag,
  endSessionDrag,
  adjustSession,
}: {
  state: State;
  date: string;
  events: ReturnType<typeof calendarEventIntervals>;
  select: (d: string) => void;
  acceptGoogleDrop: (e: React.DragEvent<HTMLElement>) => void;
  dropGoogleEvent: (e: React.DragEvent<HTMLElement>, date: string) => boolean;
  editableEvents: Set<string>;
  dragGoogleEvent: (e: React.DragEvent<HTMLElement>, id: string) => void;
  startSessionDrag: (e: React.DragEvent<HTMLElement>, id: string) => void;
  endSessionDrag: () => void;
  adjustSession: (
    id: string,
    date: string,
    start: string,
    duration: number,
  ) => void;
}) {
  const first = date.slice(0, 7) + "-01",
    start = addDays(first, -((weekday(first) + 6) % 7));
  return (
    <div className="month-view">
      {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d) => (
        <div key={d} className="month-weekday">
          {d}
        </div>
      ))}
      {Array.from({ length: 42 }, (_, i) => {
        const d = addDays(start, i),
          blocks = blocksForDay(state, d, events),
          deadlines = markersForDay(state, d);
        return (
          <button
            className={
              "month-day " +
              (d.slice(0, 7) !== date.slice(0, 7) ? "outside " : "") +
              (d === dayKey() ? "today" : "")
            }
            key={d}
            onClick={() => select(d)}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(sessionDrag)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              } else acceptGoogleDrop(e);
            }}
            onDrop={(e) => {
              if (dropGoogleEvent(e, d)) return;
              const id = e.dataTransfer.getData(sessionDrag);
              const session = state.sessions.find((entry) => entry.id === id);
              if (!session) return;
              e.preventDefault();
              endSessionDrag();
              adjustSession(id, d, session.start, session.duration);
            }}
          >
            <strong>{Number(d.slice(-2))}</strong>
            {deadlines.slice(0, 1).map((x) => (
              <span className="month-event peach" key={x.id}>
                ⚑ {x.title}
              </span>
            ))}
            {blocks.slice(0, 3 - deadlines.slice(0, 1).length).map((b) => (
              <span
                className={"month-event " + b.color}
                key={b.id}
                draggable={
                  b.kind === "session" || editableEvents.has(b.sourceId)
                }
                onDragStart={(e) => {
                  if (b.kind === "session") startSessionDrag(e, b.id);
                  else dragGoogleEvent(e, b.sourceId);
                }}
                onDragEnd={b.kind === "session" ? endSessionDrag : undefined}
              >
                {!b.allDay && displayTime(clockTime(b.start)) + " "}
                {b.title}
              </span>
            ))}
            {blocks.length + deadlines.length > 3 && (
              <small>+{blocks.length + deadlines.length - 3} more</small>
            )}
          </button>
        );
      })}
    </div>
  );
}
export function MiniMonth({
  year,
  month,
  state,
  events,
  select,
}: {
  year: number;
  month: number;
  state: State;
  events: ReturnType<typeof calendarEventIntervals>;
  select: (d: string) => void;
}) {
  const first = `${year}-${String(month + 1).padStart(2, "0")}-01`,
    start = addDays(first, -((weekday(first) + 6) % 7));
  return (
    <div className="mini-month">
      <h3>{formatDate(first, { month: "long" })}</h3>
      <div className="mini-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span className="mini-weekday" key={i}>
            {d}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const d = addDays(start, i),
            active = d.slice(0, 7) === first.slice(0, 7),
            has =
              markersForDay(state, d).length > 0 ||
              blocksForDay(state, d, events).length > 0;
          return (
            <button
              key={d}
              onClick={() => select(d)}
              className={
                (active ? "" : "outside ") +
                (d === dayKey() ? "selected " : "") +
                (has ? "has-event" : "")
              }
            >
              {Number(d.slice(-2))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
