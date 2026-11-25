import {
  addDays,
  clockMinutes,
  clockTime,
  defaultSessionDuration,
  type State,
  type Task,
} from "./model";
import { blocksForDay, type Block, type calendarEventIntervals } from "./engine";
import { deadlineEntries } from "./deadlines";

export type DeadlineEntry = ReturnType<typeof deadlineEntries>[number];

const STEP = 15;
const roundUpStep = (minute: number) => Math.ceil(minute / STEP) * STEP;

/**
 * Finds the earliest conflict-free [start..start+duration] slot inside the
 * day's work window. Returns "HH:MM" or null when no open gap fits.
 */
export function findNextOpenSlot(
  state: State,
  date: string,
  durationMinutes: number,
  events: ReturnType<typeof calendarEventIntervals>,
  minMinute?: number,
): string | null {
  const workStart = clockMinutes(state.settings.workStart);
  const workEnd = clockMinutes(state.settings.workEnd);
  if (workEnd <= workStart) return null;

  const duration = Math.max(15, Math.min(durationMinutes, workEnd - workStart));
  const earliest = Math.max(
    workStart,
    minMinute !== undefined ? roundUpStep(minMinute) : workStart,
  );
  if (earliest + duration > workEnd) return null;

  const busy = blocksForDay(state, date, events)
    .filter((b) => !b.allDay)
    .map((b) => ({ start: b.start, end: b.start + b.duration }))
    .sort((a, b) => a.start - b.start);

  let cursor = earliest;
  for (const interval of busy) {
    if (interval.end <= cursor) continue;
    if (cursor + duration <= interval.start) {
      return clockTime(cursor);
    }
    cursor = Math.max(cursor, roundUpStep(interval.end));
    if (cursor + duration > workEnd) return null;
  }

  return cursor + duration <= workEnd ? clockTime(cursor) : null;
}

export function recommendedSlotDuration(task: Task): number {
  return defaultSessionDuration(task);
}

/**
 * Converts a minute-of-day (0..1440) into an SVG angle (degrees) where:
 *   00:00 (0m)   -> 90°  (bottom nadir / 6 o'clock)
 *   06:00 (360m) -> 180° (left dawn / 9 o'clock)
 *   12:00 (720m) -> 270° (top noon zenith / 12 o'clock)
 *   18:00 (1080m)-> 0°   (right dusk / 3 o'clock)
 */
export function solarAngleDeg(minute: number): number {
  const normalized = ((minute % 1440) + 1440) % 1440;
  return ((normalized / 1440) * 360 + 90) % 360;
}

export function solarPoint(
  cx: number,
  cy: number,
  radius: number,
  minute: number,
): { x: number; y: number } {
  const rad = (solarAngleDeg(minute) * Math.PI) / 180;
  return {
    x: Number((cx + radius * Math.cos(rad)).toFixed(2)),
    y: Number((cy + radius * Math.sin(rad)).toFixed(2)),
  };
}

/**
 * Builds an SVG annular wedge path between startMin and endMin (clockwise).
 */
export function solarRingWedgePath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startMin: number,
  endMin: number,
): string {
  const span = Math.max(6, Math.min(1435, endMin - startMin));
  const clampedEnd = startMin + span;
  const p1 = solarPoint(cx, cy, outerRadius, startMin);
  const p2 = solarPoint(cx, cy, outerRadius, clampedEnd);
  const p3 = solarPoint(cx, cy, innerRadius, clampedEnd);
  const p4 = solarPoint(cx, cy, innerRadius, startMin);
  const largeArc = span > 720 ? 1 : 0;
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ");
}

export function solarArcStrokePath(
  cx: number,
  cy: number,
  radius: number,
  startMin: number,
  endMin: number,
): string {
  const span = Math.max(4, Math.min(1435, endMin - startMin));
  const clampedEnd = startMin + span;
  const p1 = solarPoint(cx, cy, radius, startMin);
  const p2 = solarPoint(cx, cy, radius, clampedEnd);
  const largeArc = span > 720 ? 1 : 0;
  return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${largeArc} 1 ${p2.x} ${p2.y}`;
}

export type SwimlaneTrackKey = "tasks" | "projects" | "routines" | "calendar";

export type SwimlaneGroup = {
  key: SwimlaneTrackKey;
  label: string;
  color: Block["color"];
  blocks: Block[];
};

export function groupBlocksByTrack(
  blocks: Block[],
  state: State,
): SwimlaneGroup[] {
  const taskProjectMap = new Map<string, string | null>(
    state.tasks.map((t) => [t.id, t.projectId]),
  );
  const sessionTaskMap = new Map<string, string>(
    state.sessions.map((s) => [s.id, s.taskId]),
  );

  const buckets: Record<SwimlaneTrackKey, Block[]> = {
    tasks: [],
    projects: [],
    routines: [],
    calendar: [],
  };

  for (const block of blocks) {
    if (block.kind === "external") {
      buckets.calendar.push(block);
    } else if (block.kind === "routine") {
      buckets.routines.push(block);
    } else {
      const taskId = sessionTaskMap.get(block.id) ?? block.sourceId;
      const projectId = taskProjectMap.get(taskId) ?? null;
      if (projectId || block.color === "lavender") {
        buckets.projects.push(block);
      } else {
        buckets.tasks.push(block);
      }
    }
  }

  return [
    { key: "tasks", label: "Tasks", color: "sage", blocks: buckets.tasks },
    {
      key: "projects",
      label: "Projects",
      color: "lavender",
      blocks: buckets.projects,
    },
    {
      key: "routines",
      label: "Routines",
      color: "peach",
      blocks: buckets.routines,
    },
    {
      key: "calendar",
      label: "Calendar",
      color: "blue",
      blocks: buckets.calendar,
    },
  ];
}

export type ProjectVelocityRow = {
  id: string;
  title: string;
  doneMilestones: number;
  totalMilestones: number;
  nextMilestone: string | null;
  deadline: string | null;
};

export type FocusDeckSummary = {
  date: string;
  tomorrowDate: string;
  activeBlock: Block | null;
  nextBlock: Block | null;
  activeProgressPct: number;
  todayBlocks: Block[];
  tomorrowBlocks: Block[];
  completedCount: number;
  actionableCount: number;
  projectVelocity: ProjectVelocityRow[];
  urgentDeadlines: DeadlineEntry[];
};

export function computeFocusSummary(
  state: State,
  date: string,
  todayKey: string,
  nowMinute: number,
  events: ReturnType<typeof calendarEventIntervals>,
): FocusDeckSummary {
  const todayBlocks = blocksForDay(state, date, events).sort(
    (a, b) => a.start - b.start,
  );
  const tomorrowDate = addDays(date, 1);
  const tomorrowBlocks = blocksForDay(state, tomorrowDate, events).sort(
    (a, b) => a.start - b.start,
  );

  const timedToday = todayBlocks.filter((b) => !b.allDay);
  const isViewingToday = date === todayKey;
  const activeBlock = isViewingToday
    ? timedToday.find(
        (b) =>
          b.outcome !== "completed" &&
          b.start <= nowMinute &&
          b.start + b.duration > nowMinute,
      ) ?? null
    : null;

  const nextBlock =
    activeBlock ??
    timedToday.find(
      (b) =>
        b.outcome !== "completed" &&
        (!isViewingToday || b.start >= nowMinute),
    ) ??
    timedToday.find((b) => b.outcome !== "completed") ??
    null;

  let activeProgressPct = 0;
  if (activeBlock && activeBlock.duration > 0) {
    activeProgressPct = Math.max(
      0,
      Math.min(
        100,
        Math.round(((nowMinute - activeBlock.start) / activeBlock.duration) * 100),
      ),
    );
  }

  const actionable = todayBlocks.filter((b) => b.kind !== "external");
  const completedCount = actionable.filter(
    (b) => b.outcome === "completed",
  ).length;

  const projectVelocity: ProjectVelocityRow[] = state.projects
    .filter((p) => p.status === "active")
    .slice(0, 5)
    .map((p) => {
      const approved = p.milestones.filter((m) => m.approved);
      const done = approved.filter((m) => m.completed).length;
      const next = approved.find((m) => !m.completed)?.title ?? null;
      return {
        id: p.id,
        title: p.title,
        doneMilestones: done,
        totalMilestones: approved.length,
        nextMilestone: next,
        deadline: p.deadline,
      };
    });

  const urgentDeadlines = deadlineEntries(state)
    .filter((d) => !d.resolved)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  return {
    date,
    tomorrowDate,
    activeBlock,
    nextBlock,
    activeProgressPct,
    todayBlocks,
    tomorrowBlocks,
    completedCount,
    actionableCount: actionable.length,
    projectVelocity,
    urgentDeadlines,
  };
}

export type TerminalIntent =
  | { type: "help" }
  | { type: "today" }
  | { type: "shift"; days: number }
  | {
      type: "view";
      view: "planner" | "tasks" | "projects" | "deadlines" | "routines" | "progress" | "settings";
    }
  | { type: "newTask"; title?: string }
  | { type: "newSession" }
  | { type: "search"; query: string }
  | { type: "unknown"; raw: string };

export function parseTerminalCommand(raw: string): TerminalIntent {
  const trimmed = raw.trim();
  if (!trimmed) return { type: "help" };
  const lower = trimmed.toLowerCase();

  if (lower === "help" || lower === "?") return { type: "help" };
  if (lower === "today" || lower === "now") return { type: "today" };
  if (lower === "next" || lower === "n") return { type: "shift", days: 1 };
  if (lower === "prev" || lower === "p") return { type: "shift", days: -1 };
  if (lower === "planner" || lower === "f1")
    return { type: "view", view: "planner" };
  if (lower === "tasks" || lower === "f2")
    return { type: "view", view: "tasks" };
  if (lower === "projects" || lower === "f3")
    return { type: "view", view: "projects" };
  if (lower === "deadlines" || lower === "f4")
    return { type: "view", view: "deadlines" };
  if (lower === "routines" || lower === "f5")
    return { type: "view", view: "routines" };
  if (lower === "progress" || lower === "f6")
    return { type: "view", view: "progress" };
  if (lower === "settings" || lower === "cfg" || lower === "f7")
    return { type: "view", view: "settings" };
  if (lower === "book" || lower === "session") return { type: "newSession" };

  if (lower === "new" || lower === "add") return { type: "newTask" };
  if (lower.startsWith("new ")) {
    return { type: "newTask", title: trimmed.slice(4).trim() };
  }
  if (lower.startsWith("add ")) {
    return { type: "newTask", title: trimmed.slice(4).trim() };
  }
  if (lower === "search") return { type: "search", query: "" };
  if (lower.startsWith("search ")) {
    return { type: "search", query: trimmed.slice(7).trim() };
  }
  if (lower.startsWith("/")) {
    return { type: "search", query: trimmed.slice(1).trim() };
  }

  return { type: "unknown", raw: trimmed };
}
