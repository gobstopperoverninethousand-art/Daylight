import { z } from "zod";
import { State, projectPlanningData, taskSchema } from "./model";
import { zonedParts } from "./engine";

export const priorityResultSchema = z.object({
  summary: z.string(),
  generatedTasks: z.array(taskSchema).optional(),
  decisionMemory: z
    .array(z.object({ commitment: z.string(), rationale: z.string() }))
    .default([]),
  recommendations: z.array(
    z.object({
      taskId: z.string(),
      reason: z.string().max(600),
    }),
  ),
});

export function workspaceDay(state: State) {
  return zonedParts(new Date().toISOString(), state.settings.timezone).day;
}

// A small change detector for saved results, not an authorization or integrity check.
function fingerprint(value: unknown) {
  // Server schema parsing can reorder object properties. Compare their values,
  // so a client key remains valid after the same records cross the API boundary.
  const input = JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++)
    hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return `v2:${input.length}:${(hash >>> 0).toString(16)}`;
}

export function evidenceKey(
  state: State,
  date: string,
  selfReport: string[] = [],
  today = workspaceDay(state),
) {
  const {
    timezone,
    workStart,
    workEnd,
    workDays,
    horizon,
    calendarId,
    lastSync,
  } = state.settings;
  const priorReview = state.reviews
    .filter((review) => review.date < date)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    )[0];
  const syncedAt = lastSync ? Date.parse(lastSync) : NaN;
  const calendarStale = !Number.isFinite(syncedAt) || Date.now() - syncedAt > 86400000;
  return fingerprint([
    date,
    today,
    selfReport,
    priorReview,
    state.reviews,
    state.tasks,
    state.deadlines,
    state.projects.map(projectPlanningData),
    state.sessions,
    state.routines,
    state.exceptions,
    state.routineRecords,
    state.events
      .filter((event) => !event.free && !event.holiday)
      .map(({ id, title, start, end, allDay }) => [
        id,
        title,
        start,
        end,
        allDay,
      ]),
    timezone,
    workStart,
    workEnd,
    workDays,
    horizon,
    calendarId,
    calendarStale,
  ]);
}

export function projectDraftKey(
  state: State,
  projectId: string,
  kind: "milestones" | "tasks",
) {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return "";
  const approved = project.milestones.filter((m) => m.approved);
  if (kind === "tasks")
    return fingerprint([
      { ...projectPlanningData(project), milestones: approved },
      state.tasks.filter((task) => task.projectId === projectId),
    ]);
  return evidenceKey(
    {
      ...state,
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, milestones: approved } : p,
      ),
    },
    workspaceDay(state),
  );
}
