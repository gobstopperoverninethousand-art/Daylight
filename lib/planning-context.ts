import { taskSchema, type State, type Task } from "./model";
import { commitmentHistory } from "./commitment-context";

export function taskCommitment(task: Task) {
  return task.deadlineId
    ? `deadline:${task.deadlineId}`
    : task.milestoneId
      ? `milestone:${task.milestoneId}`
      : task.projectId
        ? `project:${task.projectId}`
        : null;
}

export function planningContext(state: State, candidates: Task[]) {
  const history = commitmentHistory(state);
  const sourceRecords = candidates.map((task) => {
    const commitment = taskCommitment(task);
    const scoped = history.find((item) => item.key === commitment);
    const deadline = state.deadlines.find(
      (item) => item.id === task.deadlineId,
    );
    const project = state.projects.find((item) => item.id === task.projectId);
    const milestone = project?.milestones.find(
      (item) => item.id === task.milestoneId,
    );
    return {
      taskId: task.id,
      records: [
        task.title,
        task.notes,
        deadline?.notes,
        project?.notes,
        project?.outcome,
        project?.startingPoint,
        milestone?.reason,
        ...(scoped?.updates.map((item) => item.note) ?? []),
        ...(scoped?.recent_sessions.map((item) => item.note) ?? []),
        ...state.sessions
          .filter((session) => session.taskId === task.id)
          .map((session) => session.note),
      ].filter((text): text is string => !!text),
    };
  });
  const activeKeys = new Set(history.map((item) => item.key));
  return {
    deleted_tasks: deletedPlanningTasks(state),
    commitment_history: history,
    confirmed_daily_reports: state.reviews.map((review) => ({
      date: review.date,
      account:
        review.snapshot.confirmed_interpretation ?? review.accomplishment,
      updates: review.commitmentUpdates ?? [],
    })),
    task_history: state.tasks.map((task) => ({
      ...task,
      commitment: taskCommitment(task),
      updates: [...state.reviews]
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            a.createdAt.localeCompare(b.createdAt),
        )
        .flatMap((review) =>
          (review.commitmentUpdates ?? [])
            .filter((update) => update.key === "task:" + task.id)
            .map((update) => ({
              date: review.date,
              note: update.note,
              reported_account: review.accomplishment,
              reported_blocker: review.blocker,
              confirmed_account: review.snapshot.confirmed_interpretation,
              earlier_report_changed: review.snapshot.earlier_report_changed,
            })),
        ),
      sessions: state.sessions
        .filter((session) => session.taskId === task.id)
        .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)),
    })),
    source_tasks: candidates.filter((task) => task.status === "active"),
    source_records: sourceRecords,
    prior_commitment_dates: state.aiRuns.flatMap((run) => {
      if (
        run.kind !== "priorities" ||
        !Array.isArray(run.snapshot.open_commitments)
      )
        return [];
      return run.snapshot.open_commitments
        .filter((item) => item && activeKeys.has(`${item.kind}:${item.id}`))
        .map((item) => ({
          recordedAt: run.createdAt,
          commitment: `${item.kind}:${item.id}`,
          date: item.date,
          time: item.time,
        }));
    }),
    prior_decisions: state.aiRuns.flatMap((run) => {
      if (run.kind !== "priorities" && run.kind !== "extras") return [];
      if (state.reviews.some((review) => review.createdAt > run.createdAt))
        return [];
      const decisions = run.output.decisionMemory;
      if (!Array.isArray(decisions)) return [];
      return decisions
        .filter(
          (item) =>
            item &&
            typeof item.commitment === "string" &&
            activeKeys.has(item.commitment) &&
            typeof item.rationale === "string",
        )
        .map((item) => ({
          date: run.createdAt,
          kind: run.kind,
          commitment: item.commitment,
          rationale: item.rationale,
        }));
    }),
  };
}

export function deletedPlanningTasks(state: State): Task[] {
  return state.audit
    .filter((entry) => entry.action === "Task deleted with scheduled sessions")
    .flatMap((entry) => {
      if (state.tasks.some((task) => task.id === entry.recordId)) return [];
      if (entry.deletedTask) return [entry.deletedTask];
      // Older deletion records have only an ID. Recover their identity from
      // the snapshots already saved with previous planner runs.
      for (const run of [...state.aiRuns].reverse()) {
        const history = run.snapshot.task_history;
        if (!Array.isArray(history)) continue;
        const task = history.find((item) => item?.id === entry.recordId);
        const parsed = taskSchema.safeParse(task);
        if (parsed.success) return [parsed.data];
      }
      return [];
    });
}
