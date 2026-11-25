import {
  addDays,
  clockMinutes,
  displayTime,
  routineStart,
  type Outcome,
  type Project,
  type Routine,
  type State,
  type Task,
} from "./model";
import { projectHealth, scheduledTaskIds, taskDue } from "./engine";
import { deadlineEntries } from "./deadlines";

function daysBetween(fromDay: string, toDay: string): number {
  const fromMs = Date.parse(fromDay + "T12:00:00Z");
  const toMs = Date.parse(toDay + "T12:00:00Z");
  return Math.round((toMs - fromMs) / 86_400_000);
}

export type TaskBucketEntry = {
  task: Task;
  due: string | null;
  projectTitle: string | null;
  sessionCount: number;
  completedSessionCount: number;
  scheduled: boolean;
  remainingMinutes: number | null;
};

export type TaskBuckets = {
  entries: TaskBucketEntry[];
  urgent: TaskBucketEntry[];
  unscheduled: TaskBucketEntry[];
  scheduled: TaskBucketEntry[];
  needsEstimate: TaskBucketEntry[];
  completed: TaskBucketEntry[];
};

export function classifyTaskBuckets(state: State, today: string): TaskBuckets {
  const scheduledSet = scheduledTaskIds(state);
  const projectMap = new Map(state.projects.map((p) => [p.id, p.title]));
  const sessionStats = new Map<string, { total: number; done: number }>();

  for (const s of state.sessions) {
    const cur = sessionStats.get(s.taskId) ?? { total: 0, done: 0 };
    cur.total += 1;
    if (s.outcome === "completed") cur.done += 1;
    sessionStats.set(s.taskId, cur);
  }

  const soonLimit = addDays(today, 3);
  const entries: TaskBucketEntry[] = state.tasks
    .filter((t) => !t.deletedProject)
    .map((task) => {
      const due = taskDue(state, task);
      const stats = sessionStats.get(task.id) ?? { total: 0, done: 0 };
      const scheduled = scheduledSet.has(task.id);
      return {
        task,
        due,
        projectTitle: task.projectId
          ? (projectMap.get(task.projectId) ?? null)
          : null,
        sessionCount: stats.total,
        completedSessionCount: stats.done,
        scheduled,
        remainingMinutes: task.remaining ?? task.estimate,
      };
    });

  const active = entries.filter((e) => e.task.status === "active");
  const urgent = active.filter(
    (e) =>
      e.task.importance === "high" || (e.due !== null && e.due <= soonLimit),
  );
  const unscheduled = active.filter((e) => !e.scheduled);
  const scheduled = active.filter((e) => e.scheduled);
  const needsEstimate = active.filter((e) => e.task.estimate === null);
  const completed = entries.filter((e) => e.task.status === "completed");

  return {
    entries,
    urgent,
    unscheduled,
    scheduled,
    needsEstimate,
    completed,
  };
}

export type RoutineDaySlot = {
  dayIndex: number;
  shortLabel: string;
  active: boolean;
  isToday: boolean;
};

export type RoutineCadenceItem = {
  routine: Routine;
  todayScheduled: boolean;
  todayOutcome: Outcome;
  recentCompleted: number;
  weeklyMask: RoutineDaySlot[];
  startMinute: number | null;
  startLabel: string;
  daysPerWeek: number;
};

const WEEKDAY_ORDER = [
  { dayIndex: 1, shortLabel: "Mo" },
  { dayIndex: 2, shortLabel: "Tu" },
  { dayIndex: 3, shortLabel: "We" },
  { dayIndex: 4, shortLabel: "Th" },
  { dayIndex: 5, shortLabel: "Fr" },
  { dayIndex: 6, shortLabel: "Sa" },
  { dayIndex: 0, shortLabel: "Su" },
] as const;

export function computeRoutineCadenceSummary(
  state: State,
  today: string,
): RoutineCadenceItem[] {
  const todayDow = new Date(today + "T12:00:00Z").getUTCDay();
  const windowStart = addDays(today, -13);

  return state.routines
    .filter((r) => !r.deletedAt)
    .map((routine) => {
      const inRange =
        today >= routine.since && (!routine.until || today <= routine.until);
      const todayScheduled =
        !routine.paused && inRange && routine.days.includes(todayDow);

      const todayRecord = state.routineRecords.find(
        (rec) => rec.routineId === routine.id && rec.date === today,
      );
      const todayOutcome: Outcome = todayRecord?.outcome ?? "pending";

      const recentCompleted = state.routineRecords.filter(
        (rec) =>
          rec.routineId === routine.id &&
          rec.outcome === "completed" &&
          rec.date >= windowStart &&
          rec.date <= today,
      ).length;

      const weeklyMask: RoutineDaySlot[] = WEEKDAY_ORDER.map(
        ({ dayIndex, shortLabel }) => ({
          dayIndex,
          shortLabel,
          active: routine.days.includes(dayIndex),
          isToday: dayIndex === todayDow,
        }),
      );

      const startStr = routine.untimed ? null : routineStart(routine, today);
      const startMinute = startStr ? clockMinutes(startStr) : null;
      const startLabel = routine.untimed
        ? "Any time"
        : displayTime(startStr!);

      return {
        routine,
        todayScheduled,
        todayOutcome,
        recentCompleted,
        weeklyMask,
        startMinute,
        startLabel,
        daysPerWeek: routine.days.length,
      };
    });
}

export type DeadlineUrgencyBand =
  | "overdue"
  | "today"
  | "soon"
  | "horizon"
  | "resolved";

export type DeadlineUrgencyItem = {
  key: string;
  kind: "deadline" | "milestone" | "project";
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  title: string;
  date: string;
  time: string | null;
  notes: string;
  resolved: boolean;
  daysAway: number;
  countdownLabel: string;
  band: DeadlineUrgencyBand;
  linkedTotal: number;
  linkedDone: number;
};

export function formatCountdownLabel(daysAway: number, resolved: boolean): string {
  if (resolved) return "Resolved";
  if (daysAway < 0) return `${Math.abs(daysAway)}d overdue`;
  if (daysAway === 0) return "Due today";
  if (daysAway === 1) return "Tomorrow";
  return `In ${daysAway}d`;
}

export function computeDeadlineUrgency(
  state: State,
  today: string,
  showResolved: boolean,
): DeadlineUrgencyItem[] {
  const projectMap = new Map(state.projects.map((p) => [p.id, p.title]));
  const items: DeadlineUrgencyItem[] = [];

  for (const d of state.deadlines) {
    const resolved = d.status === "resolved";
    if (!showResolved && resolved) continue;
    const daysAway = daysBetween(today, d.date);
    const linked = state.tasks.filter((t) => t.deadlineId === d.id);
    const linkedDone = linked.filter((t) => t.status === "completed").length;
    const band: DeadlineUrgencyBand = resolved
      ? "resolved"
      : daysAway < 0
        ? "overdue"
        : daysAway === 0
          ? "today"
          : daysAway <= 7
            ? "soon"
            : "horizon";

    items.push({
      key: `deadline:${d.id}`,
      kind: "deadline",
      id: d.id,
      projectId: null,
      projectTitle: null,
      title: d.title,
      date: d.date,
      time: d.time || null,
      notes: d.notes || "",
      resolved,
      daysAway,
      countdownLabel: formatCountdownLabel(daysAway, resolved),
      band,
      linkedTotal: linked.length,
      linkedDone,
    });
  }

  for (const entry of deadlineEntries(state)) {
    if (entry.kind === "deadline") continue;
    if (!showResolved && entry.resolved) continue;
    const daysAway = daysBetween(today, entry.date);
    const band: DeadlineUrgencyBand = entry.resolved
      ? "resolved"
      : daysAway < 0
        ? "overdue"
        : daysAway === 0
          ? "today"
          : daysAway <= 7
            ? "soon"
            : "horizon";

    items.push({
      key: `${entry.kind}:${entry.id}`,
      kind: entry.kind,
      id: entry.id,
      projectId: entry.projectId ?? null,
      projectTitle: entry.projectId
        ? (projectMap.get(entry.projectId) ?? null)
        : null,
      title: entry.title,
      date: entry.date,
      time: null,
      notes: "",
      resolved: entry.resolved,
      daysAway,
      countdownLabel: formatCountdownLabel(daysAway, entry.resolved),
      band,
      linkedTotal: 0,
      linkedDone: 0,
    });
  }

  return items.sort(
    (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
  );
}

export type ProjectTimelineMilestone = {
  id: string;
  title: string;
  date: string;
  posPct: number;
  completed: boolean;
  approved: boolean;
};

export type ProjectTimelineSpan = {
  id: string;
  title: string;
  outcome: string;
  deadline: string;
  status: Project["status"];
  healthLabel: string;
  healthReason: string;
  startPct: number;
  endPct: number;
  doneMilestones: number;
  totalMilestones: number;
  activeTaskCount: number;
  milestones: ProjectTimelineMilestone[];
};

export function computeProjectTimelineSpans(
  state: State,
  projects: Project[],
  today: string,
): {
  minDate: string;
  maxDate: string;
  todayPct: number;
  spans: ProjectTimelineSpan[];
} {
  if (!projects.length) {
    return {
      minDate: today,
      maxDate: addDays(today, 28),
      todayPct: 0,
      spans: [],
    };
  }

  const allDates: string[] = [today];
  for (const p of projects) {
    allDates.push(p.deadline);
    for (const m of p.milestones) {
      allDates.push(m.date);
    }
  }
  allDates.sort();
  const minDate = allDates[0];
  let maxDate = allDates[allDates.length - 1];
  if (daysBetween(minDate, maxDate) < 14) {
    maxDate = addDays(minDate, 14);
  }
  const totalDays = Math.max(14, daysBetween(minDate, maxDate));

  const toPct = (d: string) =>
    Math.max(
      0,
      Math.min(100, Number(((daysBetween(minDate, d) / totalDays) * 100).toFixed(1))),
    );

  const spans: ProjectTimelineSpan[] = projects.map((p) => {
    const health = projectHealth(state, p);
    const sortedMilestones = [...p.milestones].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const earliestDate = sortedMilestones[0]?.date ?? today;
    const spanStartDate = earliestDate < today ? earliestDate : today;
    const startPct = toPct(spanStartDate);
    const endPct = Math.max(startPct + 6, toPct(p.deadline));
    const activeTaskCount = state.tasks.filter(
      (t) => t.projectId === p.id && t.status === "active",
    ).length;

    return {
      id: p.id,
      title: p.title,
      outcome: p.outcome,
      deadline: p.deadline,
      status: p.status,
      healthLabel: health.label,
      healthReason: health.reason,
      startPct,
      endPct: Math.min(100, endPct),
      doneMilestones: p.milestones.filter((m) => m.completed).length,
      totalMilestones: p.milestones.length,
      activeTaskCount,
      milestones: sortedMilestones.map((m) => ({
        id: m.id,
        title: m.title,
        date: m.date,
        posPct: toPct(m.date),
        completed: m.completed,
        approved: m.approved,
      })),
    };
  });

  return {
    minDate,
    maxDate,
    todayPct: toPct(today),
    spans,
  };
}
