import { deadlineEntries } from "./deadlines";
import type { State } from "./model";

export function commitmentHistory(state: State) {
  const entries = deadlineEntries(state).filter((entry) => !entry.resolved);
  const taskById = new Map(state.tasks.map((task) => [task.id, task]));
  return entries.map((entry) => {
    const key = entry.kind + ":" + entry.id;
    const related = new Set([key]);
    if (entry.kind === "project") {
      for (const deadline of state.deadlines.filter(
        (item) => item.projectId === entry.id,
      ))
        related.add("deadline:" + deadline.id);
      for (const milestone of state.projects.find(
        (item) => item.id === entry.id,
      )?.milestones ?? [])
        related.add("milestone:" + milestone.id);
    }
    for (const task of state.tasks) {
      if (
        (entry.kind === "deadline" && task.deadlineId === entry.id) ||
        (entry.kind === "milestone" && task.milestoneId === entry.id) ||
        (entry.kind === "project" &&
          (task.projectId === entry.id ||
            state.deadlines.some(
              (deadline) =>
                deadline.id === task.deadlineId &&
                deadline.projectId === entry.id,
            )))
      )
        related.add("task:" + task.id);
    }
    const updates = [...state.reviews]
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.createdAt.localeCompare(b.createdAt),
      )
      .flatMap((review) =>
        review.commitmentUpdates
          ? review.commitmentUpdates
              .filter((update) => related.has(update.key))
              .map((update) => ({
                date: review.date,
                commitment: update.key,
                focus: review.focus,
                blocker: review.blocker,
                follow_up: review.snapshot.follow_up,
                note: update.note,
                reported_account: review.accomplishment,
                reported_blocker: review.blocker,
                confirmed_account: review.snapshot.confirmed_interpretation,
                earlier_report_changed: review.snapshot.earlier_report_changed,
              }))
          : review.commitmentKey && related.has(review.commitmentKey)
            ? [
                {
                  date: review.date,
                  commitment: review.commitmentKey,
                  focus: review.focus,
                  note:
                    typeof review.snapshot.confirmed_interpretation === "string"
                      ? review.snapshot.confirmed_interpretation
                      : review.accomplishment,
                  blocker: review.blocker,
                  follow_up: review.snapshot.follow_up,
                  reported_account: review.accomplishment,
                  reported_blocker: review.blocker,
                  confirmed_account: review.snapshot.confirmed_interpretation,
                  earlier_report_changed:
                    review.snapshot.earlier_report_changed,
                },
              ]
            : [],
      );
    const sessions = state.sessions.filter((session) => {
      const task = taskById.get(session.taskId);
      if (
        !task ||
        (session.outcome === "pending" &&
          !session.note &&
          !session.focus &&
          session.actualMinutes === null)
      )
        return false;
      if (entry.kind === "deadline") return task.deadlineId === entry.id;
      if (entry.kind === "milestone") return task.milestoneId === entry.id;
      return (
        task.projectId === entry.id ||
        state.deadlines.some(
          (deadline) =>
            deadline.id === task.deadlineId && deadline.projectId === entry.id,
        )
      );
    });
    return {
      key,
      updates,
      recorded_session_count: sessions.length,
      completed_session_count: sessions.filter(
        (session) => session.outcome === "completed",
      ).length,
      recent_sessions: sessions
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) || b.start.localeCompare(a.start),
        )
        .map(({ taskId, date, outcome, actualMinutes, note, focus }) => ({
          taskId,
          title: taskById.get(taskId)?.title,
          date,
          outcome,
          actualMinutes,
          focus,
          note,
        })),
    };
  });
}
