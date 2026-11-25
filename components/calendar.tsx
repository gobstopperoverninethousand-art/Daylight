"use client";
import { manualTaskAliases } from "@/lib/todo-identity";
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
  Sparkles,
  RefreshCw,
  GripVertical,
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
  googleOverrides,
} from "@/lib/model";
import {
  blocksForDay,
  Block,
  calendarEventIntervals,
  recommendations,
  scheduledTaskIds,
  taskDue,
  zonedParts,
} from "@/lib/engine";
import { EditorState } from "./editor";
import type { EventDrop } from "@/lib/google-event-edit";
import { IconButton, OutcomeSelect } from "./ui";
import { DeadlineStrip } from "./deadline-strip";
import {
  getExperience,
  isWildExperience,
  type ExperienceId,
} from "@/lib/experiences";
import {
  ExperiencePlannerHeader,
  TodayExecutionStream,
} from "./experience-chrome";
import {
  MissionPlanner,
  Retro98Planner,
  SundialPlanner,
  TerminalPlanner,
  TimelinePlanner,
  type WildNavView,
  type WildPlannerProps,
} from "./wild-planners";
import {
  BlueprintPlanner,
  GalleryPlanner,
  NotebookPlanner,
  TransitPlanner,
} from "./wild-planners-extra";
import {
  ArenaPlanner,
  ConstellationPlanner,
  SynthPlanner,
  ZinePlanner,
} from "./wild-planners-extra2";

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
  projectName,
  dueDate,
  reason,
  showReason,
  onSchedule,
  onEdit,
}: {
  task: Task;
  projectName?: string;
  dueDate: string | null;
  reason?: string;
  showReason: boolean;
  onSchedule: () => void;
  onEdit: () => void;
}) {
  const durationText = durationLabel(task.remaining ?? task.estimate);
  const metaParts = [
    projectName || (task.importance === "high" ? "High priority" : null),
    dueDate ? `Due ${formatDate(dueDate, { month: "short", day: "numeric" })}` : null,
  ].filter(Boolean);

  return (
    <article
      className={"task-card " + (task.importance === "high" ? "is-priority" : "")}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(taskDrag, task.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <span className="task-drag-grip" aria-hidden="true">
        <GripVertical size={13} />
      </span>
      <div className="task-card-main">
        <button
          type="button"
          className="plain task-title"
          title={reason}
          aria-description={reason}
          onClick={onEdit}
        >
          {task.title}
        </button>
        {(metaParts.length > 0 || (showReason && reason)) && (
          <div className="task-card-meta">
            {metaParts.length > 0 && <span>{metaParts.join(" · ")}</span>}
            {showReason && reason && (
              <p className="task-card-reason">{reason}</p>
            )}
          </div>
        )}
      </div>
      <div className="task-card-aside">
        <span className="todo-duration">{durationText}</span>
        <button
          type="button"
          className="schedule-button"
          onClick={onSchedule}
          title="Choose a time"
          aria-label={"Schedule " + task.title}
        >
          <Plus size={14} />
        </button>
      </div>
    </article>
  );
}

const blockTop = (start: number) => (start / 60) * 64 + 2;
const blockHeight = (duration: number) =>
  Math.max(27, (duration / 60) * 64 - 2);
const blockBottom = (block: Block) =>
  blockTop(block.start) + blockHeight(block.duration);

function layout(blocks: Block[], overlapView: "stacked" | "sideBySide") {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const overlapping = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (blockTop(sorted[j].start) >= blockBottom(sorted[i])) break;
      overlapping.add(sorted[i].id);
      overlapping.add(sorted[j].id);
    }
  }
  if (overlapView === "stacked")
    return sorted.map((block) => ({
      block,
      lane: 0,
      lanes: 1,
      overlapped: overlapping.has(block.id),
    }));
  const result: {
    block: Block;
    lane: number;
    lanes: number;
    overlapped: boolean;
  }[] = [];
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
  for (const block of sorted) {
    const top = blockTop(block.start);
    const bottom = blockBottom(block);
    if (top >= end) {
      flush();
      end = bottom;
    } else end = Math.max(end, bottom);
    let lane = 0;
    while (group.some((x) => x.lane === lane && blockBottom(x.block) > top))
      lane++;
    group.push({
      block,
      lane,
      lanes: 1,
      overlapped: overlapping.has(block.id),
    });
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
  prioritiesRefreshing,
  requestPriorities,
  aiPriorities,
  aiExtras,
  requestExtras,
  addExtraToToday,
  setOverlapView,
  experience = "broadsheet",
  onSearch,
  onLoadDemo,
  isDemo = false,
  onNavigateView,
  onNotify,
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
  prioritiesRefreshing: boolean;
  requestPriorities: () => void;
  requestExtras: () => void;
  addExtraToToday: (task: State["tasks"][number]) => void;
  aiExtras: {
    summary: string;
    recommendations: { taskId: string; reason: string }[];
    generatedTasks?: State["tasks"];
    stale: boolean;
    createdAt: string;
  } | null;
  aiPriorities: {
    summary: string;
    recommendations: { taskId: string; reason: string }[];
    stale: boolean;
    createdAt: string;
  } | null;
  setOverlapView: (view: "stacked" | "sideBySide") => void;
  experience?: ExperienceId;
  onSearch?: () => void;
  onLoadDemo?: () => void;
  isDemo?: boolean;
  onNavigateView?: (v: WildNavView) => void;
  onNotify?: (msg: string) => void;
}) {
  const [view, setView] = useState<CalendarView>("Week"),
    [bank, setBank] = useState<"recommended" | "unscheduled" | "active">(
      "recommended",
    ),
    [calendarOverride, setCalendarOverride] = useState(false);

  useEffect(() => {
    setCalendarOverride(false);
  }, [experience]);
  const zonedNow = zonedParts(
    new Date().toISOString(),
    state.settings.timezone,
  );
  const today = zonedNow.day;
  const scheduled = scheduledTaskIds(state);
  const overridden = googleOverrides(state);
  const aliases = manualTaskAliases(state.tasks, scheduled);
  const recommended = recommendations(state, date).filter(
    ({ task }) => !aliases.has(task.id),
  );
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
              ({ task }) => task.id === (aliases.get(r.taskId) ?? r.taskId),
            )?.task;
            return task
              ? [{ task, reason: r.reason, due: null, score: 0 }]
              : [];
          })
        : []
      : bank === "active"
        ? recommended
        : unscheduled;
  const bankTasks =
    bank === "recommended"
      ? [
          ...suggested,
          ...returned.filter(
            ({ task }) => !suggested.some((item) => item.task.id === task.id),
          ),
        ]
      : suggested;
  const tasks = bankTasks.filter(
    (item, index) =>
      bankTasks.findIndex((other) => other.task.id === item.task.id) === index,
  );

  // If Suggested is empty (e.g. local/demo workspace without AI run) while unscheduled tasks exist,
  // display a helpful nudge or show how many unscheduled tasks await in Unscheduled.
  const mainTaskIds = new Set(
    aiPriorities?.recommendations.map((item) => item.taskId),
  );
  const extraTasks =
    aiExtras?.recommendations.flatMap(({ taskId }) => {
      const task =
        state.tasks.find((item) => item.id === taskId) ??
        aiExtras.generatedTasks?.find((item) => item.id === taskId);
      if (
        !task ||
        task.status !== "active" ||
        task.deletedProject ||
        scheduled.has(taskId) ||
        mainTaskIds.has(taskId) ||
        task.includeDate === today
      )
        return [];
      if (
        task.projectId &&
        !state.projects.some(
          (project) =>
            project.id === task.projectId && project.status === "active",
        )
      )
        return [];
      if (
        task.deadlineId &&
        !state.deadlines.some(
          (deadline) =>
            deadline.id === task.deadlineId &&
            deadline.status === "active" &&
            !deadline.deletedProject,
        )
      )
        return [];
      return [task];
    }) ?? [];

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
    sourceDate: string,
  ) {
    e.dataTransfer.setData(routineDrag, JSON.stringify({ id, date: sourceDate }));
    e.dataTransfer.effectAllowed = "move";
  }
  function endSessionDrag() {
    dragSession.current = null;
    setSessionPreview(null);
  }
  function sessionAtPointer(
    e: React.DragEvent<HTMLDivElement>,
    targetDate: string,
    id: string,
  ) {
    const session = state.sessions.find((entry) => entry.id === id);
    if (!session) return;
    const grabMinutes = dragSession.current?.grabMinutes ?? 0;
    const pointerMinutes =
      (e.clientY - e.currentTarget.getBoundingClientRect().top) *
      minutesPerPixel;
    const blockStart = clamp(
      snap(pointerMinutes - grabMinutes),
      0,
      1440 - session.duration,
    );
    return { id, date: targetDate, start: blockStart, duration: session.duration };
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
    if (scroll.current) scroll.current.scrollTop = 7 * 64 - 20;
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
    targetDate: string,
    targetStart?: string,
  ) {
    const id = e.dataTransfer.getData(googleEventDrag);
    if (!id || !editableEvents.has(id)) return false;
    e.preventDefault();
    e.stopPropagation();
    void moveImportedEvent(id, { date: targetDate, start: targetStart });
    return true;
  }

  function dropAtHour(
    e: React.DragEvent<HTMLElement>,
    targetDate: string,
    targetStart: string,
  ) {
    if (dropGoogleEvent(e, targetDate, targetStart)) return true;
    const taskId = e.dataTransfer.getData(taskDrag);
    if (taskId) {
      e.preventDefault();
      e.stopPropagation();
      scheduleTask(taskId, targetDate, targetStart);
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
        moveRoutineOccurrence(
          id,
          sourceDate,
          targetDate,
          targetStart,
          routine.duration,
        );
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

  const completedRoutines = routines.filter(
    (block) => block.outcome === "completed",
  ).length;

  const experienceMeta = getExperience(experience);
  if (isWildExperience(experience) && !calendarOverride) {
    const activeDayBlocks =
      days.find((day) => day.date === date)?.blocks ??
      blocksForDay(state, date, calendarEvents);
    const wildQueued =
      bank === "recommended" && !aiPriorities ? unscheduled : tasks;
    const wildProps: WildPlannerProps = {
      experience,
      state,
      date,
      today,
      nowMinute: zonedNow.minute,
      setDate,
      edit,
      setOutcome,
      scheduleTask,
      unscheduleSession,
      openGoogleEvent,
      events: calendarEvents,
      blocks: activeDayBlocks,
      bank,
      setBank,
      queuedTasks: wildQueued,
      aiPriorities,
      aiExtras,
      extraTasks,
      aiReady,
      aiNeedsSignIn,
      aiBusy,
      prioritiesRefreshing,
      requestPriorities,
      requestExtras,
      addExtraToToday,
      wildModeLabel: experienceMeta.wildModeLabel || experienceMeta.shortName,
      onSwitchToCalendarView: (nextView) => {
        setView(nextView);
        setCalendarOverride(true);
      },
      onSearch,
      onLoadDemo,
      isDemo,
      onNavigateView,
      onNotify,
    };

    return (
      <div className="planner-root planner-wild-root">
        {experience === "sundial" && <SundialPlanner {...wildProps} />}
        {experience === "timeline" && <TimelinePlanner {...wildProps} />}
        {experience === "terminal" && <TerminalPlanner {...wildProps} />}
        {experience === "retro98" && <Retro98Planner {...wildProps} />}
        {experience === "mission" && <MissionPlanner {...wildProps} />}
        {experience === "transit" && <TransitPlanner {...wildProps} />}
        {experience === "blueprint" && <BlueprintPlanner {...wildProps} />}
        {experience === "notebook" && <NotebookPlanner {...wildProps} />}
        {experience === "gallery" && <GalleryPlanner {...wildProps} />}
        {experience === "constellation" && <ConstellationPlanner {...wildProps} />}
        {experience === "synth" && <SynthPlanner {...wildProps} />}
        {experience === "zine" && <ZinePlanner {...wildProps} />}
        {experience === "arena" && <ArenaPlanner {...wildProps} />}
      </div>
    );
  }

  return (
    <div className="planner-root">
      {!isWildExperience(experience) && (
        <ExperiencePlannerHeader
          experience={experience}
          state={state}
          date={date}
          edit={edit}
          onSearch={onSearch || (() => {})}
          onLoadDemo={onLoadDemo || (() => {})}
          isDemo={isDemo}
        />
      )}

      {view === "Year Columns" && (
        <div className="year-overview-heading">
          <h1>Year at a glance</h1>
          <p>Select any date to open its day plan.</p>
        </div>
      )}

      <div className="planner-context-strip">
        <details className="planner-routines planner-drawer">
          <summary className="planner-drawer-summary">
            <Repeat2 size={15} aria-hidden="true" />
            <strong>Routines &amp; dailies</strong>
            <span className="drawer-meta">
              {formatDate(date, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="drawer-tally">
              {completedRoutines} of {routines.length} done
            </span>
            <ChevronDown
              size={15}
              className="drawer-chevron"
              aria-hidden="true"
            />
          </summary>
          <div className="planner-drawer-body">
            <div className="planner-routine-label">
              <span>Day</span>
              {routineDatePicker}
            </div>
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
                      type="button"
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
      </div>

      <div
        className={
          view === "Year Columns"
            ? "planner-workspace calendar-only"
            : experience === "flow"
              ? "planner-workspace is-flow-3col"
              : "planner-workspace"
        }
      >
        <section className="calendar-panel">
          {experience === "retro98" && (
            <div className="retro98-titlebar">
              <span>Calendar.exe — {view}</span>
              <div className="retro98-win-btns" aria-hidden="true">
                <span>_</span>
                <span>□</span>
                <span>×</span>
              </div>
            </div>
          )}
          <div className="calendar-toolbar">
            <div className="calendar-title">
              <CalendarDays size={18} aria-hidden="true" />
              <h2>
                {yearly
                  ? date.slice(0, 4)
                  : formatDate(date, { month: "long", year: "numeric" })}
              </h2>
              <div className="nav-arrows">
                <IconButton label="Previous period" onClick={() => move(-1)}>
                  <ChevronLeft size={16} />
                </IconButton>
                <IconButton label="Next period" onClick={() => move(1)}>
                  <ChevronRight size={16} />
                </IconButton>
              </div>
              <button
                type="button"
                className="button small secondary"
                onClick={() => setDate(today)}
              >
                Today
              </button>
            </div>
            <div className="calendar-toolbar-controls">
              <div
                className="overlap-switch"
                role="group"
                aria-label="Overlapping block layout"
              >
                <span>Overlap</span>
                <button
                  type="button"
                  className={
                    state.settings.blockOverlapView === "stacked"
                      ? "active"
                      : ""
                  }
                  aria-pressed={state.settings.blockOverlapView === "stacked"}
                  onClick={() => setOverlapView("stacked")}
                >
                  Stacked
                </button>
                <button
                  type="button"
                  className={
                    state.settings.blockOverlapView === "sideBySide"
                      ? "active"
                      : ""
                  }
                  aria-pressed={
                    state.settings.blockOverlapView === "sideBySide"
                  }
                  onClick={() => setOverlapView("sideBySide")}
                >
                  Side by side
                </button>
              </div>
              <div
                className="view-switch"
                role="group"
                aria-label="Calendar view"
              >
                {isWildExperience(experience) && (
                  <button
                    type="button"
                    onClick={() => setCalendarOverride(false)}
                    className="wild-return-chip"
                  >
                    ← {experienceMeta.wildModeLabel || experienceMeta.shortName}
                  </button>
                )}
                {calendarViews.map((v) => (
                  <button
                    type="button"
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
                    gridTemplateColumns: `60px repeat(${dates.length}, minmax(0, 1fr))`,
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
                      type="button"
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
                    </button>
                  ))}
                </div>
                <div
                  className="deadline-row"
                  style={{
                    gridTemplateColumns: `60px repeat(${dates.length}, minmax(0, 1fr))`,
                  }}
                >
                  <span className="deadline-label" title="Deadlines and all-day items">
                    <Flag size={13} />
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
                        .filter(
                          (x) =>
                            x.date === d &&
                            (x.status === "active" ||
                              x.status === "resolved" ||
                              !!x.deletedProject) &&
                            !overridden.has(
                              (x.historicalKind ?? "deadline") + ":" + x.id,
                            ),
                        )
                        .map((x) => (
                          <button
                            type="button"
                            className={`deadline-chip ${x.status === "resolved" ? "deadline-completed" : ""}`}
                            key={x.id}
                            title={x.title}
                            onClick={() => edit({ kind: "deadline", id: x.id })}
                          >
                            <span className="deadline-chip-text">
                              {x.status === "resolved" ? "✓ " : "⚑ "}
                              {x.historicalKind === "milestone"
                                ? "Milestone"
                                : "Due"}{" "}
                              · {x.title}
                            </span>
                          </button>
                        ))}
                      {state.projects.flatMap((p) =>
                        p.milestones
                          .filter(
                            (m) =>
                              m.approved &&
                              m.date === d &&
                              !overridden.has("milestone:" + m.id),
                          )
                          .map((m) => (
                            <button
                              type="button"
                              className={`deadline-chip lavender-chip ${m.completed ? "deadline-completed" : ""}`}
                              key={m.id}
                              title={m.title}
                              onClick={() =>
                                edit({
                                  kind: "milestone",
                                  id: m.id,
                                  projectId: p.id,
                                })
                              }
                            >
                              <span className="deadline-chip-text">
                                {m.completed ? "✓ " : "◇ "}
                                {m.title}
                              </span>
                            </button>
                          )),
                      )}
                      {state.projects
                        .filter(
                          (p) =>
                            p.deadline === d &&
                            !overridden.has("project:" + p.id),
                        )
                        .map((p) => (
                          <button
                            type="button"
                            className={`deadline-chip lavender-chip ${p.status === "completed" ? "deadline-completed" : ""}`}
                            key={p.id}
                            title={p.title}
                            onClick={() => edit({ kind: "project", id: p.id })}
                          >
                            <span className="deadline-chip-text">
                              {p.status === "completed" ? "✓ " : "◇ "}Due ·{" "}
                              {p.title}
                            </span>
                          </button>
                        ))}
                      {blocks
                        .filter((b) => b.allDay && b.kind === "external")
                        .map((b) => (
                          <button
                            type="button"
                            className={`deadline-chip all-day-chip ${b.color}`}
                            key={b.id}
                            title={b.title}
                            draggable={editableEvents.has(b.sourceId)}
                            onDragStart={(e) => dragGoogleEvent(e, b.sourceId)}
                            onClick={() => openGoogleEvent(b.sourceId)}
                          >
                            <span className="deadline-chip-text">
                              {b.title}
                            </span>
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
                                  type="button"
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
                      gridTemplateColumns: `60px repeat(${dates.length}, minmax(0, 1fr))`,
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
                          const startTime = clockTime(
                            clamp(snap(pointerMinutes), 0, 1440 - calendarStep),
                          );
                          if (dropGoogleEvent(e, d, startTime)) return;
                          const taskId = e.dataTransfer.getData(taskDrag);
                          if (taskId) {
                            e.preventDefault();
                            scheduleTask(taskId, d, startTime);
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
                                startTime,
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
                                type="button"
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
                        {layout(
                          blocks.filter((b) => !b.allDay),
                          state.settings.blockOverlapView,
                        ).map(({ block: b, lane, lanes, overlapped }) => (
                          <div
                            key={b.id}
                            className={`calendar-block ${b.color} ${overlapped ? "overlapping-block" : ""} ${overlapped && state.settings.blockOverlapView === "stacked" ? "stacked-overlap" : ""} ${b.kind === "session" ? "session-block" : ""} ${sessionPreview?.id === b.id ? "session-adjusting" : ""} ${b.outcome === "completed" ? "done" : ""} ${b.outcome === "skipped" ? "skipped" : ""} ${b.duration < 35 ? "short-block" : b.duration <= 55 ? "compact-block" : ""}`}
                            style={{
                              top: blockTop(b.start),
                              height: blockHeight(b.duration),
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
                              b.kind === "session" ? endSessionDrag : undefined
                            }
                          >
                            <button
                              type="button"
                              className="block-content"
                              title={`${b.title} · ${displayTime(clockTime(b.start))} · ${durationLabel(b.duration)}`}
                              aria-label={`${b.title} · ${displayTime(clockTime(b.start))} · ${durationLabel(b.duration)}`}
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
                                  <Repeat2 size={11} aria-hidden="true" />
                                )}
                                {b.outcome === "completed" && (
                                  <Check size={11} aria-hidden="true" />
                                )}
                                <span className="block-title-text">
                                  {b.title}
                                </span>
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
                                  type="button"
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
                        ))}
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
            <div className="calendar-legend">
              <span>
                <i className="legend-swatch sage" />
                Tasks
              </span>
              <span>
                <i className="legend-swatch lavender" />
                Projects
              </span>
              <span>
                <i className="legend-swatch peach" />
                Routines
              </span>
              <span>
                <i className="legend-swatch blue" />
                Google Calendar
              </span>
              {state.events.some((event) => event.holiday) && (
                <span>
                  <i className="legend-swatch holiday" />
                  Holidays
                </span>
              )}
            </div>
            <span>Drag tasks onto the grid, or drag blocks to move &amp; resize.</span>
          </div>
        </section>

        {view !== "Year Columns" && (
          <div className="planner-side-rail">
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
                <div>
                  <h2>To-do</h2>
                  <p className="todo-rail-sub">
                    Drag to calendar or drop sessions here to unschedule
                  </p>
                </div>
                <button
                  type="button"
                  className="schedule-button"
                  title="New task"
                  aria-label="New task"
                  onClick={() => edit({ kind: "task" })}
                >
                  <Plus size={15} />
                </button>
              </div>

              <div
                className="bank-tabs"
                role="group"
                aria-label="Task bank filter"
              >
                <button
                  type="button"
                  className={bank === "recommended" ? "active" : ""}
                  aria-pressed={bank === "recommended"}
                  onClick={() => setBank("recommended")}
                >
                  Suggested
                </button>
                <button
                  type="button"
                  className={bank === "unscheduled" ? "active" : ""}
                  aria-pressed={bank === "unscheduled"}
                  onClick={() => setBank("unscheduled")}
                >
                  Unscheduled
                  {unscheduled.length > 0 && ` (${unscheduled.length})`}
                </button>
                <button
                  type="button"
                  className={bank === "active" ? "active" : ""}
                  aria-pressed={bank === "active"}
                  onClick={() => setBank("active")}
                >
                  All active
                </button>
              </div>

              <section
                className="ai-todo-explanation"
                aria-label="AI to-do explanation"
              >
                <div className="ai-todo-summary-row">
                  <Sparkles size={14} aria-hidden="true" />
                  <p>
                    {aiPriorities?.summary ||
                      (aiNeedsSignIn
                        ? "Sign in under Settings to get AI task recommendations."
                        : aiReady
                          ? "Refresh to see which tasks fit today’s remaining time."
                          : "Connect Gemini in Settings for AI suggestions.")}
                  </p>
                </div>
                <div className="ai-todo-meta-row">
                  <span>
                    {aiPriorities?.stale
                      ? "Plan changed · Needs refresh"
                      : aiPriorities
                        ? `Updated ${new Date(aiPriorities.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                        : unscheduled.length > 0 && bank === "recommended"
                          ? `${unscheduled.length} unscheduled ready`
                          : "Human-owned schedule"}
                  </span>
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={!aiReady || aiBusy}
                    onClick={() => requestPriorities()}
                  >
                    <RefreshCw
                      size={12}
                      className={prioritiesRefreshing ? "spin" : ""}
                    />
                    {prioritiesRefreshing ? "Refreshing…" : "Refresh AI to-do list"}
                  </button>
                </div>
              </section>

              {tasks.length ? (
                <div className="todo-list">
                  {tasks.map(({ task, reason }) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      projectName={
                        state.projects.find((p) => p.id === task.projectId)
                          ?.title
                      }
                      dueDate={taskDue(state, task)}
                      reason={reason}
                      showReason={bank === "recommended"}
                      onEdit={() => edit({ kind: "task", id: task.id })}
                      onSchedule={() =>
                        edit({ kind: "session", taskId: task.id, date })
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="todo-empty">
                  <p>
                    {bank !== "active" && allScheduled
                      ? "All active tasks are scheduled."
                      : aiPriorities && bank === "recommended"
                        ? "No saved suggestions remaining to schedule."
                        : bank === "recommended" && unscheduled.length > 0
                          ? "No AI suggestions yet. Switch to Unscheduled to schedule manually."
                          : "No tasks here yet."}
                  </p>
                  {bank === "recommended" && unscheduled.length > 0 && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setBank("unscheduled")}
                    >
                      View {unscheduled.length} unscheduled →
                    </button>
                  )}
                </div>
              )}
            </aside>

            <section
              className="extra-recommendations-bank"
              aria-labelledby="extra-bank-title"
            >
              <div className="extra-bank-heading">
                <div>
                  <h2 id="extra-bank-title">Extra-time bank</h2>
                  <p>
                    Optional recommendations · Separate from your main to-do
                    list
                  </p>
                </div>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={
                    !aiReady || aiBusy || !aiPriorities || aiPriorities.stale
                  }
                  onClick={requestExtras}
                >
                  {aiExtras
                    ? "Refresh extra recommendations"
                    : "Get extra recommendations"}
                </button>
              </div>
              {!aiPriorities || aiPriorities.stale ? (
                <p className="form-hint">
                  Refresh the main to-do list to request extras.
                </p>
              ) : null}
              {aiExtras && (
                <>
                  <p className="extra-bank-explanation">{aiExtras.summary}</p>
                  {aiExtras.stale && (
                    <p className="form-hint" role="status">
                      Plan changed · Refresh recommendations before adding
                      tasks.
                    </p>
                  )}
                  <div className="extra-bank-tasks">
                    {extraTasks.map((task) => (
                      <article className="extra-bank-task" key={task.id}>
                        <span>{task.title}</span>
                        <button
                          type="button"
                          className="button secondary small"
                          disabled={aiBusy || aiExtras.stale}
                          onClick={() => addExtraToToday(task)}
                        >
                          Add to today
                        </button>
                      </article>
                    ))}
                  </div>
                  {!extraTasks.length && (
                    <p className="form-hint">
                      No additional tasks in this bank.
                    </p>
                  )}
                </>
              )}
            </section>
          </div>
        )}
        {view !== "Year Columns" && experience === "flow" && (
          <TodayExecutionStream
            state={state}
            date={date}
            edit={edit}
            setOutcome={setOutcome}
            openGoogleEvent={openGoogleEvent}
          />
        )}
      </div>
    </div>
  );
}

function markersForDay(state: State, date: string) {
  const overridden = googleOverrides(state);
  return [
    ...state.deadlines
      .filter(
        (d) =>
          (d.status === "active" ||
            d.status === "resolved" ||
            !!d.deletedProject) &&
          d.date === date &&
          !overridden.has((d.historicalKind ?? "deadline") + ":" + d.id),
      )
      .map((d) => ({
        id: d.id,
        title: d.title,
        completed: d.status === "resolved",
      })),
    ...state.projects
      .filter((p) => p.status === "active")
      .flatMap((p) => [
        ...(p.deadline === date && !overridden.has("project:" + p.id)
          ? [{ id: p.id, title: p.title, completed: p.status === "completed" }]
          : []),
        ...p.milestones
          .filter(
            (m) =>
              m.approved &&
              m.date === date &&
              !overridden.has("milestone:" + m.id),
          )
          .map((m) => ({
            id: m.id,
            title: m.title,
            completed: m.completed || p.status === "completed",
          })),
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
                  ...markers.map(({ title, completed }) => ({
                    title: (completed ? "✓ " : "") + "Due: " + title,
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
                    type="button"
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
            type="button"
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
              <span
                className={`month-event peach ${x.completed ? "deadline-completed" : ""}`}
                key={x.id}
              >
                {x.completed ? "✓ " : "⚑ "}
                {x.title}
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
              type="button"
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
