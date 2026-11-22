import type { Task } from "./model";

export function sameTodoWork(a: Task, b: Task) {
  const title = (value: string) => value.normalize("NFKC").replace(/^\s*work\s+on\s+/i, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const scope = (task: Task) => task.deadlineId ? `deadline:${task.deadlineId}` : task.milestoneId ? `milestone:${task.milestoneId}` : task.projectId ? `project:${task.projectId}` : "standalone";
  return title(a.title) === title(b.title) && scope(a) === scope(b);
}

// Alias only unbooked AI copies. Never merge two manual tasks, erase records,
// or redirect a task with its own session history.
export function todoAliases(tasks: Task[], booked: Set<string>) {
  const aliases = new Map<string, string>();
  const preferred = [...tasks].sort((a,b) =>
    Number(!!a.aiTodoDate) - Number(!!b.aiTodoDate) ||
    Number(booked.has(b.id)) - Number(booked.has(a.id)) ||
    Number(b.remaining !== null || b.estimate !== null) - Number(a.remaining !== null || a.estimate !== null) ||
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const task of preferred) {
    if (!task.aiTodoDate || booked.has(task.id) || task.status !== "active") continue;
    const canonical = preferred.find(other => other.id !== task.id && other.status === "active" && !other.deletedProject && !aliases.has(other.id) && sameTodoWork(task, other) && preferred.indexOf(other) < preferred.indexOf(task));
    if (canonical) aliases.set(task.id, canonical.id);
  }
  return aliases;
}
