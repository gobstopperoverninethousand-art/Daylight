import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  addDays,
  projectPlanningData,
  stateSchema,
  uid,
  validateReferences,
  type Task,
} from "@/lib/model";
import {
  capacity,
  makeSnapshot,
  scheduledTaskIds,
  zonedParts,
} from "@/lib/engine";
import {
  requireUser,
  limited,
  readBody,
  failure,
  HttpError,
} from "@/lib/server/auth";
import { callAI, AI_PROMPT_VERSION, validateAIResult } from "@/lib/server/ai";
import { deadlineEntries } from "@/lib/deadlines";
import {
  commitmentHistory,
  expireGeneratedTodos,
} from "@/lib/commitment-context";

function todoTitle(title: string) {
  return title.replace(/^\s*work\s+on\s+/i, "").trim().slice(0, 200);
}

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { state: workspace, useLocalFallback } = z
      .object({ state: stateSchema, useLocalFallback: z.literal(true).optional() })
      .parse(await readBody(req));
    await limited(user.id, useLocalFallback ? "local-priorities" : "ai-priorities", 15);
    validateReferences(workspace);
    const archivedProjects = workspace.projects.filter((project) => project.status === "completed");
    const archivedIds = new Set(archivedProjects.map((project) => project.id));
    const excludedKeys = new Set(archivedProjects.flatMap((project) => [
      "project:" + project.id,
      ...project.milestones.map((milestone) => "milestone:" + milestone.id),
    ]));
    const excludedDeadlines = new Set(
      workspace.deadlines
        .filter((deadline) => deadline.deletedProject || (deadline.projectId && archivedIds.has(deadline.projectId)))
        .map((deadline) => {
          excludedKeys.add((deadline.historicalKind ?? "deadline") + ":" + deadline.id);
          return deadline.id;
        }),
    );
    const tasksForPlanning = workspace.tasks.filter(
      (task) => !task.deletedProject &&
        !(task.projectId && archivedIds.has(task.projectId)) &&
        !(task.deadlineId && excludedDeadlines.has(task.deadlineId)),
    );
    const taskIdsForPlanning = new Set(tasksForPlanning.map((task) => task.id));
    const sessionsForPlanning = workspace.sessions.filter((session) => {
      if (taskIdsForPlanning.has(session.taskId)) return true;
      excludedKeys.add("session:" + session.id);
      return false;
    });
    const excludedEventIds = new Set(
      workspace.links.filter((link) => excludedKeys.has(link.key)).map((link) => link.eventId),
    );
    const state = {
      ...workspace,
      projects: workspace.projects.filter((project) => !archivedIds.has(project.id)),
      deadlines: workspace.deadlines.filter((deadline) => !excludedDeadlines.has(deadline.id)),
      tasks: tasksForPlanning,
      sessions: sessionsForPlanning,
      events: workspace.events.filter((event) => !excludedEventIds.has(event.googleId ?? event.id)),
    };
    const now = new Date();
    const { day: today, minute } = zonedParts(
      now.toISOString(),
      state.settings.timezone,
    );
    const tomorrow = addDays(today, 1);
    const tasks = expireGeneratedTodos(state, today, minute);
    const scheduled = scheduledTaskIds(state);
    const generated = new Map<string, Task>();
    const additionalWorkCandidates = new Set<string>();
    const entries = deadlineEntries(state).filter((entry) => !entry.resolved);
    for (const entry of entries) {
      const matches = (task: Task) =>
        entry.kind === "deadline"
          ? task.deadlineId === entry.id
          : entry.kind === "milestone"
            ? task.milestoneId === entry.id
            : task.projectId === entry.id &&
              !task.deadlineId &&
              !task.milestoneId;
      const linkedUnscheduled = tasks.filter(
        (task) =>
          task.status === "active" && !task.deletedProject &&
          !scheduled.has(task.id) &&
          matches(task),
      );
      const manualWorkToday = linkedUnscheduled.some(
        (task) => !task.aiTodoDate && task.includeDate === today,
      );
      if (
        linkedUnscheduled.length &&
        (!manualWorkToday || linkedUnscheduled.some((task) => task.aiTodoDate))
      )
        continue;
      if (
        entry.kind === "project" &&
        entries.some(
          (child) => child.kind === "milestone" && child.projectId === entry.id,
        )
      )
        continue;
      const deadline =
        entry.kind === "deadline"
          ? state.deadlines.find((item) => item.id === entry.id)
          : undefined;
      if (
        deadline?.workMode === "single" &&
        tasks.some(
          (task) =>
            matches(task) &&
            (scheduled.has(task.id) || task.status === "completed"),
        )
      )
        continue;
      const milestone =
        entry.kind === "milestone"
          ? state.projects
              .find((item) => item.id === entry.projectId)
              ?.milestones.find((item) => item.id === entry.id)
          : undefined;
      const remaining =
        deadline?.remainingMinutes ?? milestone?.estimate ?? null;
      const task: Task = {
        id: uid(),
        title: todoTitle(entry.title),
        deadlineId: deadline?.id ?? null,
        projectId: entry.projectId,
        milestoneId: milestone?.id ?? null,
        status: "active",
        importance: entry.high ? "high" : "normal",
        estimate: null,
        remaining,
        notes: "",
        createdAt: now.toISOString(),
        completedAt: null,
        aiTodoDate: today,
      };
      generated.set(task.id, task);
      if (manualWorkToday) additionalWorkCandidates.add(task.id);
    }
    const candidates = [...tasks, ...generated.values()];
    const snapshot = {
      ...makeSnapshot({ ...state, tasks: candidates }, today, "", "", "", now),
      // Whole-day prose can describe archived projects. Use commitment-scoped history below.
      prior_review: null,
    };
    const eligible = candidates
      .filter((task) => task.status === "active" && !task.deletedProject && !scheduled.has(task.id))
      .map((task) => task.id);
    const included = tasks
      .filter(
        (task) =>
          task.status === "active" && !task.deletedProject &&
          !scheduled.has(task.id) &&
          task.includeDate === today,
      )
      .map((task) => task.id);
    if (!eligible.length)
      return NextResponse.json({
        summary: "All active tasks already have a place on the calendar.",
        recommendations: [],
        snapshot,
        version: AI_PROMPT_VERSION + "/priorities-v6",
      });
    const eligibleIds = new Set(eligible);
    const todayPicks = new Set(included);
    const candidatesById = new Map(candidates.map((task) => [task.id, task]));
    const taskFacts = snapshot.tasks
      .filter((task) => eligibleIds.has(task.id))
      .map((task) => {
        const minutesAfterToday =
          task.due && task.due >= tomorrow
            ? capacity(
                state,
                tomorrow,
                task.due,
                task.id,
                now,
                task.due_time || undefined,
              )
            : 0;
        const shortfall =
          !task.due ||
          task.remaining_minutes === null ||
          snapshot.calendar_stale
            ? null
            : Math.max(0, task.remaining_minutes - minutesAfterToday);
        const source = candidatesById.get(task.id)!;
        const deadline = state.deadlines.find(
          (entry) => entry.id === source.deadlineId,
        );
        const multiSession =
          deadline?.workMode === "multiple" || !!source.milestoneId;
        const needsBuffer =
          !snapshot.calendar_stale &&
          !!task.due &&
          task.remaining_minutes !== null &&
          minutesAfterToday <= task.remaining_minutes * 1.25;
        const tier =
          task.due && (task.due <= today || shortfall)
            ? 0
            : todayPicks.has(task.id) ||
                (task.due && task.due <= tomorrow) ||
                needsBuffer ||
                (multiSession &&
                  task.remaining_minutes === null &&
                  !!task.due &&
                  task.due <= addDays(today, 7))
              ? 1
              : 2;
        return {
          ...task,
          minutesAfterToday,
          shortfall,
          tier,
          multiSession,
          importance: source.importance,
          notes: source.notes,
          generatedCandidate: generated.has(source.id) || !!source.aiTodoDate,
          additionalWorkCandidate: additionalWorkCandidates.has(source.id),
          projectId: source.projectId ?? deadline?.projectId ?? null,
          commitment: source.deadlineId
            ? "deadline:" + source.deadlineId
            : source.milestoneId
              ? "milestone:" + source.milestoneId
              : source.projectId
                ? "project:" + source.projectId
                : null,
        };
      });
    const lastDue = taskFacts.reduce(
      (latest, task) => (task.due && task.due > latest ? task.due : latest),
      addDays(today, state.settings.horizon - 1),
    );
    const fallbackIds = () => taskFacts
      .filter((task) => task.tier < 2 && !task.additionalWorkCandidate)
      .sort(
        (a, b) =>
          a.tier - b.tier ||
          (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
          (a.due_time ?? "23:59").localeCompare(b.due_time ?? "23:59") ||
          (a.commitment ?? a.id).localeCompare(b.commitment ?? b.id) ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id),
      )
      .map((task) => task.id);
    const input = {
      ...snapshot,
      eligible_tasks: taskFacts.map(({ tier, ...facts }) => {
        void tier;
        return facts;
      }),
      open_commitments: entries,
      projects: state.projects
        .filter((project) => project.status !== "completed")
        .map(projectPlanningData),
      upcoming_commitments: state.events
        .filter(
          (event) =>
            !event.free &&
            !event.holiday &&
            (event.allDay
              ? event.start
              : zonedParts(event.start, state.settings.timezone).day) >=
              tomorrow &&
            (event.allDay
              ? event.start
              : zonedParts(event.start, state.settings.timezone).day) <=
              lastDue,
        )
        .map(({ title, start, end }) => ({ title, start, end })),

      included_for_consideration_task_ids: included,
    };
    let summary: string;
    let taskIds: string[];
    if (useLocalFallback) {
      taskIds = fallbackIds();
      summary = taskIds.length
        ? "Daylight’s local ranking uses due dates, recorded remaining work, and calendar availability."
        : "Daylight’s local rules found no unscheduled tasks to recommend today.";
    } else {
      try {
        const result = validateAIResult(
          z.object({
            summary: z.string().trim().min(1).max(12000),
            taskIds: z.array(z.string()).refine(
              (ids) =>
                new Set(ids).size === ids.length &&
                ids.every((id) => eligibleIds.has(id)) &&
                included.every((id) => ids.includes(id)),
            ),
          }),
          await callAI(
            `Choose today's to-dos from eligible_tasks and order them from highest to lowest priority. Return JSON {taskIds: string[], summary: string}. Use each selected ID once. There is no fixed count. Keep user tasks explicitly marked for today in the list, and include other tasks only when there is a concrete reason to work on them today. If none qualify, return an empty list and explain why.

Apply this decision process:
1. Assess deadlines, milestone and overall project dates, the nature of the work as recorded, and what the user's latest progress updates say is finished, blocked, or left to do. Use completed sessions and recorded focus as supporting evidence, never as proof of completion or pace. Use explicit importance and commitments. Do not guess consequences from titles.
2. Ask what becomes harder to finish if work waits until tomorrow. Use the user's remaining work estimates, shared capacity before each due date, and future fixed calendar blocks. A future commitment can justify starting a later deadline today. Do not cut the to-do list to fit today's calendar or use a fixed daily task count. Do not double count shared hours. Flag stale calendar data and distinguish unknown effort from a measured shortfall. When effort is unknown, use documented progress, deadline proximity and the need for multiple sessions as evidence for building a buffer.
3. Before selecting a generated candidate, check whether a manually entered task already advances the same deadline or milestone. Use explicit links first, then clear matches in titles and notes. Treat a manual task for today as covering that work and mention its contribution in the explanation. Add a generated item for the same commitment only when recorded progress, work remaining, or deadline risk supports doing additional work today beyond that task. Explain what evidence warrants the extra work without prescribing session steps. An additionalWorkCandidate is optional. Rank by supported risk of waiting. A nearer low-effort task may rank below a later commitment with a documented risk of running out of work time. When evidence is otherwise equal, use explicit importance, then earlier due date and time, then title. Add at most one generated work item per commitment, even when the work takes multiple sessions. The user chooses the session lengths, schedule, and what to do during each session. Do not invent or propose subtasks. Generated task titles should name the actual task or commitment directly; never prepend “Work on”.
4. Write one cohesive explanation of the selection and order with as much detail as the decisions warrant. Explain meaningful tradeoffs, manual-task coverage, and reasons for starting later deadlines now. Also explain why other relevant eligible tasks or milestone/deadline work were left out today (for example, already covered by a manual task, insufficient evidence that more work is needed today, lower supported risk, or missing effort/progress information). Focus on material omissions rather than listing every unrelated task. A short explanation is appropriate only when there is little to explain. Avoid filler and repetitive task descriptions. Point to concrete deadline, progress, or future calendar evidence and say where evidence is missing.`,
            { ...input, commitment_history: commitmentHistory(state) },
          ),
        );
        summary = result.summary;
        taskIds = result.taskIds;
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        return NextResponse.json({ aiError: error.message });
      }
    }
    const recommendations = taskIds.map((taskId) => ({
      taskId,
      reason: "",
    }));
    return NextResponse.json({
      summary,
      recommendations,
      generatedTasks: taskIds.flatMap((id) =>
        generated.has(id) ? [generated.get(id)!] : [],
      ),
      snapshot: input,
      version: useLocalFallback
        ? "daylight-local/priorities-v6"
        : AI_PROMPT_VERSION + "/priorities-v6",
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return failure(e);
  }
}
