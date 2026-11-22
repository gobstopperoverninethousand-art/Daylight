import type { Task } from "./model";

export function sameTodoWork(a: Task, b: Task) {
  const normalize = (title: string) =>
    title.normalize("NFKC").replace(/^\s*work\s+on\s+/i, "").replace(/\s+/g, " ").trim().toLowerCase();
  return normalize(a.title) === normalize(b.title) &&
    a.deadlineId === b.deadlineId &&
    a.milestoneId === b.milestoneId &&
    a.projectId === b.projectId;
}

export function manualTaskAliases(tasks: Task[], scheduled: Set<string>) {
  const aliases = new Map<string, string>();
  for (const task of tasks) {
    if (!task.aiTodoDate || task.status !== "active" || scheduled.has(task.id)) continue;
    const manual = tasks.find((other) =>
      !other.aiTodoDate && other.status === "active" &&
      !other.deletedProject && sameTodoWork(task, other),
    );
    if (manual) aliases.set(task.id, manual.id);
  }
  return aliases;
}
