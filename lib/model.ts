import { z } from "zod";
export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return !isNaN(+d) && d.toISOString().slice(0, 10) === v;
  }, "Choose a valid date");
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.string().min(1).max(160),
  title = z.string().trim().min(1).max(200),
  note = z.string().max(4000);
const minutes = z.number().int().min(1).max(525600);
export const outcomeSchema = z.enum([
  "pending",
  "completed",
  "partial-low",
  "partial-medium",
  "partial-high",
  "blocked",
  "skipped",
]);
export type Outcome = z.infer<typeof outcomeSchema>;
export const taskSchema = z.object({
  id,
  title,
  estimate: minutes.nullable(),
  remaining: minutes.nullable(),
  deadlineId: id.nullable(),
  projectId: id.nullable(),
  milestoneId: id.nullable(),
  importance: z.enum(["normal", "high"]),
  status: z.enum(["active", "completed"]),
  notes: note,
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export const deadlineSchema = z.object({
  id,
  title,
  date: daySchema,
  time: timeSchema.nullable(),
  projectId: id.nullable(),
  status: z.enum(["active", "resolved"]),
  notes: note,
});
export const sessionSchema = z
  .object({
    id,
    taskId: id,
    date: daySchema,
    start: timeSchema,
    duration: minutes.max(1440),
    outcome: outcomeSchema,
    actualMinutes: z.number().int().min(0).max(1440).nullable(),
    note,
    needsReview: z.boolean(),
  })
  .refine(
    (v) => clockMinutes(v.start) + v.duration <= 1440,
    "Session must end on the same day",
  );
export const routineSchema = z
  .object({
    id,
    title,
    days: z.array(z.number().int().min(0).max(6)).min(1),
    recurrenceInterval: z.number().int().min(1).optional(),
    recurrenceUnit: z.enum(["days", "weeks", "months"]).optional(),
    start: timeSchema,
    duration: minutes.max(1440),
    untimed: z.boolean().optional(),
    since: daySchema,
    until: daySchema.nullable(),
    paused: z.boolean(),
    color: z.enum(["sage", "peach", "lavender", "blue"]),
  })
  .refine(
    (v) => clockMinutes(v.start) + v.duration <= 1440,
    "Routine must end on the same day",
  );
export const routineRecordSchema = z.object({
  routineId: id,
  date: daySchema,
  outcome: outcomeSchema,
  note,
});
export const exceptionSchema = z
  .object({
    routineId: id,
    date: daySchema,
    skip: z.boolean(),
    start: timeSchema,
    duration: minutes.max(1440),
  })
  .refine(
    (v) => clockMinutes(v.start) + v.duration <= 1440,
    "Occurrence must end on the same day",
  );
export const milestoneSchema = z.object({
  id,
  title,
  date: daySchema,
  approved: z.boolean(),
  completed: z.boolean(),
  dependsOn: z.array(id),
  estimate: minutes.nullable(),
  timeBudgetMinutes: minutes.nullable().optional(),
  reason: note,
});
export const projectSchema = z.object({
  id,
  title,
  outcome: note.min(1),
  deadline: daySchema,
  startingPoint: note,
  // Retain legacy project totals in existing workspaces and exports.
  budgetMinutes: minutes.nullable().optional(),
  availableMinutes: minutes.nullable().optional(),
  notes: note,
  milestones: z.array(milestoneSchema),
  status: z.enum(["active", "completed"]),
});
export const eventSchema = z.object({
  id,
  title,
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  calendarId: z.string(),
  updated: z.string().optional(),
  googleId: z.string().optional(),
  etag: z.string().optional(),
  calendarName: z.string().optional(),
  canDelete: z.boolean().optional(),
  canEdit: z.boolean().optional(),
  recurring: z.boolean().optional(),
  holiday: z.boolean().optional(),
  free: z.boolean().optional(),
});
export const linkSchema = z.object({
  key: id,
  eventId: id,
  etag: z.string(),
  fingerprint: z.string(),
  calendarId: z.string(),
});
export const settingsSchema = z
  .object({
    name: z.string().max(80),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Invalid timezone"),
    workStart: timeSchema,
    workEnd: timeSchema,
    workDays: z.array(z.number().int().min(0).max(6)),
    horizon: z.number().int().min(1).max(30),
    calendarId: z.string(),
    calendarName: z.string(),
    syncHolidays: z.boolean().default(true),
    lastSync: z.string().nullable(),
  })
  .refine(
    (v) => v.workEnd > v.workStart,
    "Available time must end after it starts",
  );
export const assessmentSchema = z.object({
  pacing_status: z.enum([
    "on-track",
    "needs-attention",
    "at-risk",
    "blocked",
    "insufficient-information",
  ]),
  summary: z.string().max(2500),
  time_use_observation: z.string().max(1500),
  focus_observation: z.string().max(1000),
  evidence: z.array(z.string().max(1500)).max(20),
  missing_information: z.array(z.string().max(1000)).max(20),
  next_action: z.string().max(1500),
  questions_if_needed: z.array(z.string().max(300)).max(3),
});
export const reviewSchema = z.object({
  id,
  date: daySchema,
  createdAt: z.string(),
  source: z.enum(["rules", "ai"]),
  version: z.string(),
  inputKey: z.string().optional(),
  focus: z.string().max(80),
  blocker: note,
  accomplishment: note,
  assessment: assessmentSchema,
  snapshot: z.record(z.string(), z.unknown()),
});
export const auditSchema = z.object({
  id,
  at: z.string(),
  action: z.string().max(400),
  recordId: id,
});
export const stateSchema = z.object({
  schemaVersion: z.literal(1),
  tasks: z.array(taskSchema),
  deadlines: z.array(deadlineSchema),
  sessions: z.array(sessionSchema),
  routines: z.array(routineSchema),
  routineRecords: z.array(routineRecordSchema),
  exceptions: z.array(exceptionSchema),
  projects: z.array(projectSchema),
  events: z.array(eventSchema),
  links: z.array(linkSchema),
  reviews: z.array(reviewSchema),
  audit: z.array(auditSchema),
  aiRuns: z
    .array(
      z.object({
        id,
        kind: z.enum(["priorities", "milestones", "tasks"]),
        createdAt: z.string(),
        version: z.string(),
        inputKey: z.string().optional(),
        snapshot: z.record(z.string(), z.unknown()),
        output: z.record(z.string(), z.unknown()),
      }),
    )
    .default([]),
  settings: settingsSchema,
});
export type Task = z.infer<typeof taskSchema>;
export type Deadline = z.infer<typeof deadlineSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Routine = z.infer<typeof routineSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;
export type State = z.infer<typeof stateSchema>;
export type Assessment = z.infer<typeof assessmentSchema>;
export type Review = z.infer<typeof reviewSchema>;
export function projectPlanningData(project: Project) {
  const { budgetMinutes, availableMinutes, ...planning } = project;
  return planning;
}
export function hoursLabel(minutes: number | null) {
  return minutes === null
    ? "Not set"
    : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(minutes / 60)} h`;
}
export const uid = () => crypto.randomUUID();
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(day: string, n: number): string {
  const d = new Date(day + "T12:00:00");
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
export function weekday(day: string): number {
  return new Date(day + "T12:00:00").getDay();
}
export function clockMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}
export function clockTime(n: number): string {
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
export function defaultSessionDuration(task?: Task): number {
  return Math.min(task?.remaining ?? task?.estimate ?? 30, 1440);
}
export function durationLabel(n: number | null): string {
  if (n === null) return "Estimate needed";
  if (n === 0) return "0 min";
  return `${Math.floor(n / 60) ? Math.floor(n / 60) + "h" : ""}${n % 60 ? (n >= 60 ? " " : "") + (n % 60) + "m" : ""}`;
}
export function formatDate(
  day: string,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  return new Date(day + "T12:00:00").toLocaleDateString("en-US", opts);
}
export function displayTime(time: string): string {
  const n = clockMinutes(time);
  return `${Math.floor(n / 60) % 12 || 12}${n % 60 ? ":" + String(n % 60).padStart(2, "0") : ""}${n < 720 ? "am" : "pm"}`;
}
export function emptyState(): State {
  return {
    schemaVersion: 1,
    tasks: [],
    deadlines: [],
    sessions: [],
    routines: [],
    routineRecords: [],
    exceptions: [],
    projects: [],
    events: [],
    links: [],
    reviews: [],
    audit: [],
    aiRuns: [],
    settings: {
      name: "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      workStart: "09:00",
      workEnd: "18:00",
      workDays: [1, 2, 3, 4, 5],
      horizon: 7,
      calendarId: "primary",
      syncHolidays: true,
      calendarName: "Primary calendar",
      lastSync: null,
    },
  };
}
export function audit(state: State, action: string, recordId: string): void {
  state.audit.push({
    id: uid(),
    at: new Date().toISOString(),
    action,
    recordId,
  });
}
export function finishTask(state: State, id: string, done = true): void {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  task.status = done ? "completed" : "active";
  task.completedAt = done ? new Date().toISOString() : null;
  state.sessions
    .filter((s) => s.taskId === id && s.outcome === "pending")
    .forEach((s) => (s.needsReview = done));
  audit(
    state,
    done
      ? "Task completed; pending sessions flagged for review"
      : "Task reopened",
    id,
  );
}
export function removeTask(state: State, id: string): boolean {
  const exists = state.tasks.some((task) => task.id === id);
  if (!exists) return false;
  state.tasks = state.tasks.filter((task) => task.id !== id);
  state.sessions = state.sessions.filter((session) => session.taskId !== id);
  audit(state, "Task deleted with scheduled sessions", id);
  return true;
}
export function validateReferences(s: State): State {
  const tasks = new Set(s.tasks.map((t) => t.id)),
    projects = new Set(s.projects.map((p) => p.id)),
    deadlines = new Set(s.deadlines.map((d) => d.id)),
    routines = new Set(s.routines.map((r) => r.id));
  for (const list of [
    s.tasks,
    s.projects,
    s.deadlines,
    s.routines,
    s.sessions,
  ]) {
    if (new Set(list.map((x) => x.id)).size !== list.length)
      throw new Error("Duplicate record IDs");
  }
  for (const t of s.tasks) {
    if (
      (t.projectId && !projects.has(t.projectId)) ||
      (t.deadlineId && !deadlines.has(t.deadlineId))
    )
      throw new Error("Task references a missing record");
    if (
      t.milestoneId &&
      !s.projects.some(
        (p) =>
          p.id === t.projectId &&
          p.milestones.some((m) => m.id === t.milestoneId),
      )
    )
      throw new Error("Task references a missing milestone");
  }
  if (s.sessions.some((x) => !tasks.has(x.taskId)))
    throw new Error("Session references a missing task");
  if (s.deadlines.some((d) => d.projectId && !projects.has(d.projectId)))
    throw new Error("Deadline references a missing project");
  const milestoneIds = s.projects.flatMap((p) => p.milestones.map((m) => m.id));
  if (new Set(milestoneIds).size !== milestoneIds.length)
    throw new Error("Duplicate milestone IDs across projects");
  for (const records of [s.routineRecords, s.exceptions]) {
    if (
      new Set(records.map((r) => r.routineId + ":" + r.date)).size !==
      records.length
    )
      throw new Error("Duplicate routine occurrences");
  }
  if (
    [...s.routineRecords, ...s.exceptions].some(
      (x) => !routines.has(x.routineId),
    )
  )
    throw new Error("Occurrence references a missing routine");
  for (const p of s.projects) {
    const ids = new Set(p.milestones.map((m) => m.id));
    if (ids.size !== p.milestones.length)
      throw new Error("Duplicate milestone IDs");
    for (const m of p.milestones) {
      if (m.date > p.deadline)
        throw new Error("Milestone must be on or before the project deadline");
      if (m.dependsOn.some((d) => !ids.has(d) || d === m.id))
        throw new Error("Invalid milestone dependency");
      const visit = (id: string, seen: Set<string>): void => {
        if (seen.has(id))
          throw new Error("Milestone dependencies contain a cycle");
        const next = new Set(seen).add(id);
        p.milestones
          .find((m) => m.id === id)
          ?.dependsOn.forEach((d) => visit(d, next));
      };
      visit(m.id, new Set());
    }
  }
  return s;
}
