import {
  State,
  Task,
  Assessment,
  dayKey,
  addDays,
  weekday,
  clockMinutes,
  durationLabel,
  projectPlanningData,
} from "./model";
export const RULE_VERSION = "daylight-review-v1.0";
export type Block = {
  id: string;
  title: string;
  date: string;
  start: number;
  duration: number;
  kind: "session" | "routine" | "external";
  color: string;
  outcome: string;
  sourceId: string;
  needsReview?: boolean;
  allDay?: boolean;
  free?: boolean;
};
export function zonedParts(
  iso: string,
  timezone: string,
): { day: string; minute: number } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value || "00";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minute: Number(get("hour")) * 60 + Number(get("minute")),
  };
}
export function calendarEventIntervals(s: State) {
  return s.events.map((event) => ({
    event,
    start: event.allDay
      ? { day: event.start.slice(0, 10), minute: 0 }
      : zonedParts(event.start, s.settings.timezone),
    end: event.allDay
      ? { day: event.end.slice(0, 10), minute: 0 }
      : zonedParts(event.end, s.settings.timezone),
  }));
}

function routineMatchesDate(
  since: string,
  date: string,
  interval: number,
  unit: "days" | "weeks" | "months",
) {
  if (unit === "days") {
    const start = new Date(since + "T12:00:00");
    const current = new Date(date + "T12:00:00");
    return (
      Math.round((current.getTime() - start.getTime()) / 86400000) %
        interval ===
      0
    );
  }
  if (unit === "months") {
    const start = new Date(since + "T12:00:00");
    const current = new Date(date + "T12:00:00");
    const months =
      (current.getFullYear() - start.getFullYear()) * 12 +
      current.getMonth() -
      start.getMonth();
    return months >= 0 && months % interval === 0;
  }
  const start = new Date(since + "T12:00:00");
  start.setDate(start.getDate() - start.getDay());
  const current = new Date(date + "T12:00:00");
  current.setDate(current.getDate() - current.getDay());
  return (
    (Math.round((current.getTime() - start.getTime()) / 86400000) / 7) %
      interval ===
    0
  );
}

export function blocksForDay(
  s: State,
  date: string,
  events = calendarEventIntervals(s),
): Block[] {
  const blocks: Block[] = s.sessions
    .filter((x) => x.date === date)
    .map((x) => ({
      id: x.id,
      sourceId: x.id,
      title: s.tasks.find((t) => t.id === x.taskId)?.title || "Task",
      date,
      start: clockMinutes(x.start),
      duration: x.duration,
      kind: "session",
      color: s.tasks.find((t) => t.id === x.taskId)?.projectId
        ? "lavender"
        : "sage",
      outcome: x.outcome,
      needsReview: x.needsReview,
    }));
  for (const r of s.routines) {
    const ex = s.exceptions.find(
      (e) => e.routineId === r.id && e.date === date,
    );
    const recurringOnDate =
      routineMatchesDate(
        r.since,
        date,
        r.recurrenceInterval || 1,
        r.recurrenceUnit || "weeks",
      ) &&
      (r.recurrenceUnit === "days" || r.days.includes(weekday(date)));
    if (
      r.paused ||
      date < r.since ||
      (r.until && date > r.until) ||
      (!recurringOnDate && !ex)
    )
      continue;
    if (ex?.skip) continue;
    blocks.push({
      id: `${r.id}:${date}`,
      sourceId: r.id,
      title: r.title,
      date,
      start: clockMinutes(ex?.start || r.start),
      duration: ex?.duration || r.duration,
      kind: "routine",
      color: r.color,
      outcome:
        s.routineRecords.find((x) => x.routineId === r.id && x.date === date)
          ?.outcome || "pending",
      allDay: !!r.untimed && !ex,
      free: !!r.untimed && !ex,
    });
  }
  for (const { event: e, start, end } of events) {
    if (
      date < start.day ||
      date > end.day ||
      (date === end.day && end.minute === 0)
    )
      continue;
    const lo = date === start.day ? start.minute : 0,
      hi = date === end.day ? end.minute : 1440;
    blocks.push({
      id: e.id,
      sourceId: e.id,
      title: e.title,
      date,
      start: lo,
      duration: hi - lo,
      kind: "external",
      color: e.holiday ? "holiday" : "blue",
      outcome: "pending",
      allDay: e.allDay,
      free: e.free || e.holiday,
    });
  }
  return blocks.sort((a, b) => a.start - b.start);
}
export function mergedMinutes(ranges: [number, number][]): number {
  const sorted = ranges.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0,
    end = -Infinity;
  for (const [a, b] of sorted) {
    total += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  return total;
}
export function capacity(
  s: State,
  from: string,
  to: string,
  excludeTaskId?: string | string[],
  asOf?: Date,
  dueTime?: string,
): number {
  const excluded = new Set(
    Array.isArray(excludeTaskId)
      ? excludeTaskId
      : excludeTaskId
        ? [excludeTaskId]
        : [],
  );
  const now = asOf ? zonedParts(asOf.toISOString(), s.settings.timezone) : null;
  const events = calendarEventIntervals(s);
  let total = 0;
  for (let d = from, n = 0; d <= to && n < 370; d = addDays(d, 1), n++) {
    if (!s.settings.workDays.includes(weekday(d))) continue;
    if (now && d < now.day) continue;
    const start = Math.max(
        clockMinutes(s.settings.workStart),
        now?.day === d ? now.minute : 0,
      ),
      end = Math.min(
        clockMinutes(s.settings.workEnd),
        d === to && dueTime ? clockMinutes(dueTime) : 1440,
      );
    const blocked = blocksForDay(s, d, events)
      .filter(
        (b) =>
          !b.free &&
          !(
            b.kind === "session" &&
            excluded.has(s.sessions.find((x) => x.id === b.id)?.taskId || "")
          ),
      )
      .map(
        (b) =>
          [Math.max(start, b.start), Math.min(end, b.start + b.duration)] as [
            number,
            number,
          ],
      );
    total += Math.max(0, end - start - mergedMinutes(blocked));
  }
  return total;
}
export function taskDueTime(s: State, t: Task): string | undefined {
  const deadline = s.deadlines.find(
    (d) => d.id === t.deadlineId && d.status === "active",
  );
  return deadline?.date === taskDue(s, t)
    ? deadline.time || undefined
    : undefined;
}
export function taskDue(s: State, t: Task): string | null {
  const direct = s.deadlines.find(
    (d) => d.id === t.deadlineId && d.status === "active",
  )?.date;
  const project = s.projects.find(
    (p) => p.id === t.projectId && p.status === "active",
  );
  const milestone = project?.milestones.find(
    (m) => m.id === t.milestoneId && m.approved && !m.completed,
  )?.date;
  return (
    [direct, milestone, project?.deadline].filter(Boolean).sort()[0] || null
  );
}
export function scheduledTaskIds(s: State) {
  return new Set(s.sessions.map((session) => session.taskId));
}

export function recommendations(s: State, date = dayKey(), asOf = new Date()) {
  const scheduled = scheduledTaskIds(s);
  return s.tasks
    .filter((t) => t.status === "active")
    .map((t) => {
      const due = taskDue(s, t),
        days = due
          ? Math.round(
              (+new Date(due + "T12:00:00") - +new Date(date + "T12:00:00")) /
                86400000,
            )
          : null;
      const latest = s.sessions
        .filter((x) => x.taskId === t.id && x.outcome !== "pending")
        .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start))[0];
      const rem = t.remaining ?? t.estimate,
        available =
          due && due >= date
            ? capacity(s, date, due, t.id, asOf, taskDueTime(s, t))
            : 0;
      let reason = "No upcoming deadline. Make room when it fits.";
      let score = t.importance === "high" ? 20 : 0;
      if (days !== null) {
        score += days < 0 ? 120 : Math.max(0, 75 - days * 5);
        reason =
          days < 0
            ? "Past its deadline. Review the commitment."
            : days === 0
              ? "Due today. Choose a session that moves it forward."
              : `Due in ${days} day${days === 1 ? "" : "s"}. ${durationLabel(available)} in your recorded availability.`;
        if (rem !== null && rem > available) {
          score += 30;
          reason = `${durationLabel(rem)} estimated work, ${durationLabel(available)} available before the deadline.`;
        }
      }
      if (rem === null) reason += " Add your estimate for pacing.";
      if (latest?.outcome === "blocked") {
        score += 15;
        reason = "Last session was blocked. Identify the next unblocking step.";
      }
      if (!scheduled.has(t.id) && days === null) {
        score += 5;
        reason = "Not scheduled yet. Choose a first step when you have room.";
      }
      return { task: t, due, reason, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.task.createdAt.localeCompare(b.task.createdAt),
    );
}
export function makeSnapshot(
  s: State,
  date: string,
  focus: string,
  blocker: string,
  accomplishment: string,
  asOf = new Date(),
) {
  const now = zonedParts(asOf.toISOString(), s.settings.timezone);
  // Historic reviews use today's remaining capacity, never elapsed time from the reviewed day.
  const planningDate = date < now.day ? now.day : date;
  const sessions = s.sessions.filter((x) => x.date === date);
  const active = s.tasks.filter((t) => t.status === "active");
  const upcoming = active.map((t) => ({
    id: t.id,
    title: t.title,
    due: taskDue(s, t),
    due_time: taskDueTime(s, t) || null,
    remaining_minutes: t.remaining ?? t.estimate,
    available_minutes:
      taskDue(s, t) && taskDue(s, t)! >= planningDate
        ? capacity(
            s,
            planningDate,
            taskDue(s, t)!,
            t.id,
            asOf,
            taskDueTime(s, t),
          )
        : 0,
  }));
  const end = addDays(planningDate, s.settings.horizon - 1);
  const competing_deadlines = [
    ...new Set(upcoming.filter((t) => t.due).map((t) => t.due!)),
  ]
    .sort()
    .map((due) => {
      const tasks = upcoming.filter((t) => t.due && t.due <= due);
      return {
        due,
        task_ids: tasks.map((t) => t.id),
        remaining_minutes: tasks.reduce(
          (n, t) => n + (t.remaining_minutes || 0),
          0,
        ),
        missing_estimates: tasks.filter((t) => t.remaining_minutes === null)
          .length,
        available_minutes: capacity(
          s,
          planningDate,
          due,
          tasks.map((t) => t.id),
          asOf,
        ),
      };
    });
  const lastSync = s.settings.lastSync ? Date.parse(s.settings.lastSync) : NaN;
  const calendarStale =
    !Number.isFinite(lastSync) || +asOf - lastSync > 24 * 60 * 60 * 1000;
  return {
    current_date: date,
    planning_date: planningDate,
    generated_at: asOf.toISOString(),
    rule_version: RULE_VERSION,
    timezone: s.settings.timezone,
    availability: {
      start: s.settings.workStart,
      end: s.settings.workEnd,
      days: s.settings.workDays,
      horizon_days: s.settings.horizon,
      free_minutes: capacity(s, planningDate, end, undefined, asOf),
      basis:
        "User-entered availability minus commitments. Elapsed time is excluded; concurrent commitments are counted once.",
    },
    calendar_last_sync: s.settings.lastSync,
    calendar_stale: calendarStale,
    calendar_scope:
      "Selected calendar only; the user must account for commitments outside it.",
    deadlines: s.deadlines.filter((d) => d.status === "active"),
    projects: s.projects
      .filter((p) => p.status === "active")
      .map(projectPlanningData),
    tasks: upcoming,
    competing_deadlines,
    sessions: sessions.map((x) => ({
      ...x,
      title: s.tasks.find((t) => t.id === x.taskId)?.title,
    })),
    routine_outcomes: s.routineRecords.filter((x) => x.date === date),
    planned_minutes: sessions.reduce((n, x) => n + x.duration, 0),
    confirmed_sessions: sessions.filter((x) => x.outcome !== "pending").length,
    confirmed_actual_minutes: sessions
      .filter((x) => x.outcome !== "pending" && x.actualMinutes !== null)
      .reduce((n, x) => n + x.actualMinutes!, 0),
    actual_time_reports: sessions.filter(
      (x) => x.outcome !== "pending" && x.actualMinutes !== null,
    ).length,
    actual_time_missing: sessions.filter(
      (x) => x.outcome !== "pending" && x.actualMinutes === null,
    ).length,
    unconfirmed_sessions: sessions.filter((x) => x.outcome === "pending")
      .length,
    self_report: {
      focus: focus || null,
      blocker: blocker || null,
      accomplishment: accomplishment || null,
    },
    prior_review:
      s.reviews
        .filter((r) => r.date < date)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        ?.assessment || null,
  };
}
export function assess(snapshot: ReturnType<typeof makeSnapshot>): Assessment {
  const risk = snapshot.tasks.filter(
    (t) =>
      t.due &&
      (t.due < snapshot.planning_date ||
        (t.remaining_minutes !== null &&
          t.remaining_minutes > t.available_minutes)),
  );
  const cumulative = snapshot.competing_deadlines.filter(
    (d) => d.remaining_minutes > d.available_minutes,
  );
  const unknown = snapshot.tasks.filter((t) => t.remaining_minutes === null);
  const blocked =
    snapshot.sessions.some((x) => x.outcome === "blocked") ||
    !!snapshot.self_report.blocker;
  const missing: string[] = [];
  if (snapshot.unconfirmed_sessions)
    missing.push(
      `${snapshot.unconfirmed_sessions} session outcome(s) are unconfirmed.`,
    );
  if (snapshot.actual_time_missing)
    missing.push(
      "Actual focused time was not supplied for every confirmed session.",
    );
  if (unknown.length)
    missing.push(`${unknown.length} active task(s) need your effort estimate.`);
  if (snapshot.calendar_stale)
    missing.push(
      "Calendar data is missing or older than 24 hours; available capacity may be overstated.",
    );
  if (!snapshot.tasks.some((t) => t.due))
    missing.push("No active task has an approved deadline to assess.");
  const shortfall = risk.length > 0 || cumulative.length > 0;
  const pacing: Assessment["pacing_status"] = blocked
    ? "blocked"
    : shortfall
      ? "at-risk"
      : unknown.length ||
          snapshot.calendar_stale ||
          !snapshot.tasks.some((t) => t.due)
        ? "insufficient-information"
        : "on-track";
  const evidence = [
    `${snapshot.confirmed_sessions} of ${snapshot.sessions.length} scheduled sessions have a confirmed outcome.`,
    ...risk.map(
      (t) =>
        `${t.title}: ${t.due! < snapshot.planning_date ? "deadline has passed" : `${durationLabel(t.remaining_minutes)} remaining versus ${durationLabel(t.available_minutes)} recorded capacity`}.`,
    ),
    ...cumulative
      .slice(0, 3)
      .map(
        (d) =>
          `Work due by ${d.due}: ${durationLabel(d.remaining_minutes)} competes for ${durationLabel(d.available_minutes)} of capacity, including its own reserved sessions.`,
      ),
  ];
  if (snapshot.self_report.accomplishment)
    evidence.push(
      "User-reported progress: " + snapshot.self_report.accomplishment,
    );
  return {
    pacing_status: pacing,
    summary: blocked
      ? "An obstacle needs attention before the next work session."
      : shortfall
        ? "Your current estimates point to a deadline shortfall. Review scope or make more time available."
        : pacing === "insufficient-information"
          ? "A few missing facts limit a reliable pacing assessment. Your confirmed outcomes are saved."
          : "The recorded estimates fit the available windows. This depends on the completeness of your calendar and remaining-work estimates.",
    time_use_observation: `${durationLabel(snapshot.planned_minutes)} was planned. ${snapshot.actual_time_reports ? durationLabel(snapshot.confirmed_actual_minutes) + " of actual time was self-reported." : "Actual work time is not known."} Calendar duration is not evidence of focused work.`,
    focus_observation: snapshot.self_report.focus
      ? `Self-reported focus: ${snapshot.self_report.focus}.`
      : "Focus was not reported; no attention rating inferred.",
    evidence,
    missing_information: missing,
    next_action: blocked
      ? "Identify the smallest action that removes the blocker, then choose a time."
      : risk.length
        ? `Review remaining work and the next step for ${risk[0].title}.`
        : cumulative.length
          ? "Review competing deadlines together; their combined estimated work exceeds available time."
          : unknown.length
            ? `Add your estimate for ${unknown[0].title}.`
            : "Choose one next action and place a session in the planner.",
    questions_if_needed:
      blocked &&
      !snapshot.self_report.blocker &&
      !snapshot.sessions.some((x) => x.outcome === "blocked" && x.note)
        ? ["Main blocker?"]
        : unknown.length
          ? ["Hours left?"]
          : [],
  };
}
export function projectHealth(
  s: State,
  p: State["projects"][number],
  today = dayKey(),
): { label: string; reason: string } {
  if (p.status === "completed")
    return { label: "Completed", reason: "Project marked complete by you." };
  const next = p.milestones
    .filter((m) => m.approved && !m.completed)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!next)
    return {
      label: "Plan needed",
      reason: "Approve a concrete next milestone.",
    };
  if (next.date < today)
    return {
      label: "At risk",
      reason: `${next.title} is past its approved date.`,
    };
  const tasks = s.tasks.filter(
    (t) =>
      t.projectId === p.id &&
      t.status === "active" &&
      t.milestoneId === next.id,
  );
  const taskEstimatesKnown =
    tasks.length > 0 &&
    tasks.every((t) => (t.remaining ?? t.estimate) !== null);
  const remaining = taskEstimatesKnown
    ? tasks.reduce((sum, t) => sum + (t.remaining ?? t.estimate!), 0)
    : next.estimate;
  if (remaining === null)
    return {
      label: "Needs estimate",
      reason: `Add workload hours for ${next.title} or estimates for its remaining tasks.`,
    };
  const calendarCapacity = capacity(
    s,
    today,
    next.date,
    tasks.map((t) => t.id),
    new Date(),
  );
  const available = Math.min(
    calendarCapacity,
    next.timeBudgetMinutes ?? Infinity,
  );
  const stale =
    !s.settings.lastSync ||
    Date.now() - Date.parse(s.settings.lastSync) > 86400000;

  return {
    label:
      remaining > available ? "At risk" : stale ? "Check calendar" : "On track",
    reason: `${durationLabel(remaining)} ${taskEstimatesKnown ? "estimated across remaining tasks" : "estimated for the milestone"}. ${durationLabel(available)} ${available < calendarCapacity ? "in the milestone time budget" : "capacity before " + next.title}.`,
  };
}
export function overlap(
  s: State,
  date: string,
  start: number,
  duration: number,
  excludeId?: string,
): boolean {
  return blocksForDay(s, date).some(
    (b) =>
      b.id !== excludeId &&
      !b.free &&
      start < b.start + b.duration &&
      start + duration > b.start,
  );
}
