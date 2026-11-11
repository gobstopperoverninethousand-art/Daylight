import type { State } from "./model";

export function deadlineEntries(state: State) {
  const high = state.tasks.filter(
    (task) => task.status === "active" && task.importance === "high",
  );
  return [
    ...state.deadlines.map((deadline) => ({
      kind: "deadline" as const,
      id: deadline.id,
      title: deadline.title,
      projectId: deadline.projectId,
      date: deadline.date,
      time: deadline.time,
      resolved: deadline.status === "resolved",
      high: high.some((task) => task.deadlineId === deadline.id),
    })),
    ...state.projects.flatMap((project) => [
      {
        kind: "project" as const,
        id: project.id,
        title: project.title,
        projectId: project.id,
        date: project.deadline,
        time: null,
        resolved: project.status === "completed",
        high: high.some((task) => task.projectId === project.id),
      },
      ...project.milestones
        .filter((milestone) => milestone.approved)
        .map((milestone) => ({
          kind: "milestone" as const,
          id: milestone.id,
          title: milestone.title,
          projectId: project.id,
          date: milestone.date,
          time: null,
          resolved: milestone.completed || project.status === "completed",
          high: high.some(
            (task) =>
              task.projectId === project.id &&
              task.milestoneId === milestone.id,
          ),
        })),
    ]),
  ];
}
