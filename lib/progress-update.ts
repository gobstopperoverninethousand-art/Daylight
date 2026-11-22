import { z } from "zod";
import { type State } from "./model";
import { deadlineEntries } from "./deadlines";
export const designationSchema = z.object({
  keys: z.array(z.string()),
  note: z.string().trim().min(1),
});
export const interpretationSchema = z.object({
  overview: z.string().trim().min(1),
  questions: z.array(z.string().trim().min(1)).max(3),
  updates: z.array(designationSchema),
});
export function projectForKeys(state: State, currentKeys: string[] = []) {
  for (const key of currentKeys) {
    const [kind, id] = key.split(":");
    if (kind === "project") return id;
    if (kind === "milestone")
      return (
        state.projects.find((p) => p.milestones.some((m) => m.id === id))?.id ??
        ""
      );
    if (kind === "task")
      return state.tasks.find((t) => t.id === id)?.projectId ?? "";
    if (kind === "deadline")
      return state.deadlines.find((d) => d.id === id)?.projectId ?? "";
  }
  return "";
}
export function progressDestinations(
  state: State,
  date = new Date().toISOString().slice(0, 10),
  projectId = "",
) {
  const projects = new Map(state.projects.map((p) => [p.id, p.title]));
  const entries = deadlineEntries(state)
    .filter((e) => {
      if (
        projectId
          ? !(e.kind === "milestone" && e.projectId === projectId)
          : !(e.kind === "deadline" && !e.projectId)
      )
        return false;
      return (
        e.date >= date ||
        (e.resolved &&
          Date.parse(date + "T00:00:00") - Date.parse(e.date + "T00:00:00") <=
            2 * 86400000)
      );
    })
    .sort(
      (a, b) =>
        Math.abs(
          Date.parse(a.date + "T00:00:00") - Date.parse(date + "T00:00:00"),
        ) -
          Math.abs(
            Date.parse(b.date + "T00:00:00") - Date.parse(date + "T00:00:00"),
          ) || a.title.localeCompare(b.title),
    );
  return entries.map((e) => ({
    key: `${e.kind}:${e.id}`,
    label: [e.projectId && projects.get(e.projectId), e.title]
      .filter(Boolean)
      .join(" → "),
  }));
}
export function allProgressDestinations(
  state: State,
  date = new Date().toISOString().slice(0, 10),
) {
  const projects = new Map(state.projects.map((p) => [p.id, p.title]));
  return deadlineEntries(state)
    .filter(
      (e) =>
        e.date >= date ||
        (e.resolved &&
          Date.parse(date + "T00:00:00") - Date.parse(e.date + "T00:00:00") <=
            2 * 86400000),
    )
    .sort(
      (a, b) =>
        Math.abs(
          Date.parse(a.date + "T00:00:00") - Date.parse(date + "T00:00:00"),
        ) -
          Math.abs(
            Date.parse(b.date + "T00:00:00") - Date.parse(date + "T00:00:00"),
          ) || a.title.localeCompare(b.title),
    )
    .map((e) => ({
      key: `${e.kind}:${e.id}`,
      label: [e.projectId && projects.get(e.projectId), e.title]
        .filter(Boolean)
        .join(" → "),
    }));
}
