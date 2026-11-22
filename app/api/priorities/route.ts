import { NextRequest, NextResponse } from "next/server";
import { sameTodoWork } from "@/lib/todo-identity";
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
  blocksForDay,
  calendarEventIntervals,
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
import { evidenceKey, priorityResultSchema } from "@/lib/ai-freshness";
import { planningContext, taskCommitment } from "@/lib/planning-context";
import {
  MAIN_TODO_PROMPT,
  EXTRA_RECOMMENDATIONS_PROMPT,
  PLANNING_PROMPT_VERSION,
} from "@/lib/server/planning-prompts";
import { deadlineEntries } from "@/lib/deadlines";
import { expireGeneratedTodos } from "@/lib/commitment-context";

function todoTitle(title: string) {
  return title
    .replace(/^\s*work\s+on\s+/i, "")
    .trim()
    .slice(0, 200);
}

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const {
      state: workspace,
      useLocalFallback,
      mode,
    } = z
      .object({
        state: stateSchema,
        useLocalFallback: z.literal(true).optional(),
        mode: z.enum(["main", "extras"]).default("main"),
      })
      .parse(await readBody(req));
    if (mode === "extras" && useLocalFallback)
      throw new HttpError("Extra recommendations require AI.");
    await limited(
      user.id,
      mode === "extras"
        ? "ai-extras"
        : useLocalFallback
          ? "local-priorities"
          : "ai-priorities",
      15,
    );
    validateReferences(workspace);
    const archivedProjects = workspace.projects.filter(
      (project) => project.status === "completed",
    );
    const archivedIds = new Set(archivedProjects.map((project) => project.id));
    const excludedKeys = new Set(
      archivedProjects.flatMap((project) => [
        "project:" + project.id,
        ...project.milestones.map((milestone) => "milestone:" + milestone.id),
      ]),
    );
    const excludedDeadlines = new Set(
      workspace.deadlines
        .filter(
          (deadline) =>
            deadline.deletedProject ||
            (deadline.projectId && archivedIds.has(deadline.projectId)),
        )
        .map((deadline) => {
          excludedKeys.add(
            (deadline.historicalKind ?? "deadline") + ":" + deadline.id,
          );
          return deadline.id;
        }),
    );
    const tasksForPlanning = workspace.tasks.filter(
      (task) =>
        !task.deletedProject &&
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
      workspace.links
        .filter((link) => excludedKeys.has(link.key))
        .map((link) => link.eventId),
    );
    const state = {
      ...workspace,
      projects: workspace.projects.filter(
        (project) => !archivedIds.has(project.id),
      ),
      deadlines: workspace.deadlines.filter(
        (deadline) => !excludedDeadlines.has(deadline.id),
      ),
      tasks: tasksForPlanning,
      sessions: sessionsForPlanning,
      events: workspace.events.filter(
        (event) => !excludedEventIds.has(event.googleId ?? event.id),
      ),
    };
    const now = new Date();
    const { day: today, minute } = zonedParts(
      now.toISOString(),
      state.settings.timezone,
    );
    const tomorrow = addDays(today, 1);
    const mainRun = workspace.aiRuns.findLast(
      (run) => run.kind === "priorities",
    );
    const mainResult = priorityResultSchema.safeParse(mainRun?.output);
    if (
      mode === "extras" &&
      (!mainResult.success ||
        mainRun?.inputKey !== evidenceKey(workspace, today))
    )
      throw new HttpError(
        "Refresh the main to-do list before requesting extra recommendations.",
        409,
      );
    const mainIds = new Set(
      mode === "extras" && mainResult.success
        ? mainResult.data.recommendations.map((item) => item.taskId)
        : [],
    );

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
          task.status === "active" &&
          !task.deletedProject &&
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
      .filter(
        (task) =>
          task.status === "active" &&
          !task.deletedProject &&
          !scheduled.has(task.id) &&
          (mode === "main" ||
            (!mainIds.has(task.id) && task.includeDate !== today)),
      )
      .map((task) => task.id);
    const included = tasks
      .filter(
        (task) =>
          task.status === "active" &&
          !task.deletedProject &&
          !scheduled.has(task.id) &&
          task.includeDate === today,
      )
      .map((task) => task.id);
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
    const fallbackIds = () =>
      taskFacts
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
      ["today's_fixed_blocks"]: blocksForDay(state, today)
        .filter((block) => !block.free && block.start + block.duration > minute)
        .map(({ title, date, start, duration, kind, allDay }) => ({
          title,
          date,
          startMinute: start,
          endMinute: start + duration,
          kind,
          allDay: !!allDay,
        })),
      eligible_tasks: taskFacts.map(({ tier, ...facts }) => {
        void tier;
        return facts;
      }),
      open_commitments: entries,
      projects: state.projects
        .filter((project) => project.status !== "completed")
        .map(projectPlanningData),
      upcoming_commitments: (() => {
        const intervals = calendarEventIntervals(state);
        const blocks = [];
        // Match the engine's capacity horizon (it caps calculation at 370 days).
        for (
          let day = tomorrow, count = 0;
          day <= lastDue && count < 370;
          day = addDays(day, 1), count++
        ) {
          blocks.push(
            ...blocksForDay(state, day, intervals)
              .filter((block) => !block.free)
              .map(({ title, date, start, duration, kind, allDay }) => ({
                title,
                date,
                startMinute: start,
                endMinute: start + duration,
                kind,
                allDay: !!allDay,
              })),
          );
        }
        return blocks;
      })(),
      current_main_list:
        mode === "extras" && mainResult.success
          ? {
              ...mainResult.data,
              tasks: tasks.filter((task) => mainIds.has(task.id)),
              generatedAt: mainRun?.createdAt,
            }
          : null,
      ...planningContext(state, candidates),
      included_for_consideration_task_ids: mode === "main" ? included : [],
      mainRunId: mode === "extras" ? mainRun?.id : null,
    };
    let summary: string;
    let taskIds: string[];
    let decisionMemory: { commitment: string; rationale: string }[] = [];
    if (useLocalFallback) {
      taskIds = fallbackIds();
      summary = taskIds.length
        ? "Daylight’s local ranking uses due dates, recorded remaining work, and calendar availability."
        : "Daylight’s local rules found no unscheduled tasks to recommend today.";
    } else {
      try {
        const result = validateAIResult(
          z.object({
            recordedWork: z
              .array(
                z.object({
                  sourceTaskId: z.string(),
                  title: z.string().trim().min(1).max(200),
                  evidenceQuote: z.string().trim().min(1).max(4000),
                }),
              )
              .default([]),
            decisionMemory: z
              .array(
                z.object({
                  commitment: z.string(),
                  rationale: z.string().trim().min(1).max(2500),
                }),
              )
              .default([]),
            summary: z.string().trim().min(1),
            taskIds: z
              .array(z.string())
              .refine((ids) => new Set(ids).size === ids.length, "Repeated task IDs.")
              .refine((ids) => ids.every((id) => eligibleIds.has(id)), "Unknown or ineligible task IDs.")
              .refine((ids) => mode === "extras" || included.every((id) => ids.includes(id)), "A user-selected task was omitted."),
          }),
          await callAI(
            mode === "extras" ? EXTRA_RECOMMENDATIONS_PROMPT : MAIN_TODO_PROMPT,
            input,
          ),
        );
        summary = result.summary;
        taskIds = [...result.taskIds];
        const commitmentKeys = new Set(
          entries.map((entry) => `${entry.kind}:${entry.id}`),
        );
        if (
          result.decisionMemory.some(
            (item) => !commitmentKeys.has(item.commitment),
          )
        )
          throw new HttpError(
            "AI returned an unknown commitment in its explanation memory.",
            502,
          );
        decisionMemory = result.decisionMemory;
        for (const item of result.recordedWork) {
          const source = candidatesById.get(item.sourceTaskId);
          if (!source || source.status !== "active")
            throw new HttpError("AI returned an unknown source task.", 502);
          const task: Task = {
            id: uid(),
            title: item.title,
            deadlineId: source.deadlineId,
            projectId: source.projectId,
            milestoneId: source.milestoneId,
            importance: source.importance,
            status: "active",
            estimate: null,
            remaining: null,
            notes: item.evidenceQuote,
            createdAt: now.toISOString(),
            completedAt: null,
            aiTodoDate: today,
          };
          const existing = [...candidates, ...generated.values()].find(
            (candidate) => candidate.status === "active" && !candidate.deletedProject &&
              sameTodoWork(candidate, task),
          );
          if (existing) {
            if (eligibleIds.has(existing.id)) taskIds.push(existing.id);
            continue;
          }
          generated.set(task.id, task);
          taskIds.push(task.id);
        }
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        return NextResponse.json({ aiError: error.message });
      }
    }
    taskIds = [...new Set(taskIds)];
    const recommendations = taskIds.map((taskId) => ({
      taskId,
      reason: "",
    }));
    return NextResponse.json({
      summary,
      recommendations,
      decisionMemory,
      mode,
      generatedTasks: taskIds.flatMap((id) =>
        generated.has(id) ? [generated.get(id)!] : [],
      ),
      snapshot: input,
      version: useLocalFallback
        ? "daylight-local/" + PLANNING_PROMPT_VERSION
        : AI_PROMPT_VERSION + "/" + PLANNING_PROMPT_VERSION + "/" + mode,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return failure(e);
  }
}
