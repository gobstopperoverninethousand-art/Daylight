import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  stateSchema,
  uid,
  addDays,
  validateReferences,
  daySchema,
} from "@/lib/model";
import { capacity, zonedParts } from "@/lib/engine";
import {
  requireUser,
  limited,
  readBody,
  failure,
  HttpError,
} from "@/lib/server/auth";
import { callAI, AI_PROMPT_VERSION, validateAIResult } from "@/lib/server/ai";
const resultSchema = z.object({
  summary: z.string().max(3000),
  assumptions: z.array(z.string().max(1000)).max(12),
  existingDependencyUpdates: z.array(
    z.object({
      milestoneId: z.string(),
      dependsOn: z.array(z.string()),
    }),
  ),
  milestones: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        date: daySchema,
        dependsOn: z.array(z.string()),
        reason: z.string().max(4000),
      }),
    )
    .max(8),
});
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    await limited(user.id, "ai-project", 10);
    const body = z
      .object({ state: stateSchema, projectId: z.string() })
      .parse(await readBody(req));
    validateReferences(body.state);
    const project = body.state.projects.find((p) => p.id === body.projectId);
    if (!project) throw new HttpError("Project not found.", 404);
    const today = zonedParts(
      new Date().toISOString(),
      body.state.settings.timezone,
    ).day;
    // Send only what planning needs. Earlier AI text and notes are left out so
    // each run stays small, fast, and independent of previous drafts.
    const clip = (text: string, n: number) => text.slice(0, n);
    const snapshot = {
      today,
      project: {
        id: project.id,
        title: project.title,
        outcome: clip(project.outcome, 1200),
        startingPoint: clip(project.startingPoint, 800),
        notes: clip(project.notes, 800),
        deadline: project.deadline,
        existing_milestones: project.milestones.map((m) => ({
          id: m.id,
          title: m.title,
          date: m.date,
          reason: m.reason,
          approved: m.approved,
          completed: m.completed,
          dependsOn: m.dependsOn,
          timeBudgetMinutes: m.timeBudgetMinutes ?? null,
        })),
      },
      capacity_next_30_days: capacity(
        body.state,
        today,
        addDays(today, 29),
        undefined,
        new Date(),
      ),
      capacity_through_deadline: capacity(
        body.state,
        today,
        project.deadline,
        undefined,
        new Date(),
      ),
      availability: {
        timezone: body.state.settings.timezone,
        workStart: body.state.settings.workStart,
        workEnd: body.state.settings.workEnd,
        workDays: body.state.settings.workDays,
      },
      competing_deadlines: body.state.deadlines
        .filter(
          (d) =>
            d.status === "active" &&
            d.date >= today &&
            d.date <= project.deadline,
        )
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 25)
        .map((d) => ({ title: d.title, date: d.date, time: d.time })),
      active_tasks: body.state.tasks
        .filter((t) => t.status === "active")
        .slice(0, 40)
        .map((t) => ({
          title: t.title,
          estimate: t.estimate,
          remaining: t.remaining,
          importance: t.importance,
          inThisProject: t.projectId === project.id,
        })),
    };
    const raw = await callAI(
      'If there are no existing milestones, propose 3 to 6 major verifiable milestones using dependency order and backward planning from the final deadline. If milestones already exist, refine the existing plan by inserting useful, more specific verifiable checkpoints wherever they improve execution. Examine the entire remaining project, including work before, between, alongside, and after existing milestones up to the project deadline. Identify the actual planning gaps before choosing additions and their dates. Placement must follow the work and its prerequisites. Do not default to placing additions before the earliest existing milestone, and do not force additions into every interval or spread them evenly for appearance. It is valid for every addition to precede the first milestone if the identified gaps genuinely require that; explain why in the summary. Preserve the existing structure and add at most eight useful checkpoints per request, with no minimum for refinement. Return no new milestones if the existing plan needs no additional detail and explain that. Use existing milestone budgets when present and do not duplicate existing milestones. Leave workload and budget estimates to the user. Explain the refinement rationale in the summary with enough detail to justify where additions are concentrated. For each proposed milestone, its reason must explain the gap it fills, which existing milestone or outcome it supports, and why its date and dependencies place it there. Keep the reasoning specific and avoid filler. State material assumptions. Return {summary:string, assumptions:string[], milestones:[{title:string,date:"YYYY-MM-DD",dependsOn:string[] (existing IDs or new:INDEX references),reason:string}]}. For dependencies, use existing milestone IDs or new:0, new:1 etc for new proposal indices. Consider the complete combined project graph. Connect new milestones to existing prerequisites when appropriate. Use existingDependencyUpdates to add prerequisite links to incomplete existing milestones when a new proposal precedes and supports them. Preserve existing dependencies. Do not create separate chains simply because proposals come from different rounds. Use actual work prerequisites rather than dates alone. A single sequence, independent concurrent paths, branches, and later joins are all valid structures. None is preferred by default. Choose the structure that best advances this specific project efficiently, considering prerequisites, shared resources, coordination costs, and available capacity. Propose parallel paths or branches only when the evidence indicates that they improve the plan; their availability is not a reason to use them. Do not force independent work into a chain or force dependent work into parallel paths. Explain any meaningful efficiency benefit in the proposal reasons without assuming unlimited simultaneous work capacity. Never link a milestone to a later date or introduce cycles. Include existingDependencyUpdates: [{milestoneId:string,dependsOn:string[]}] in the JSON, empty if unnecessary. Do not create task backlogs.',
      snapshot,
    );
    const parsed = validateAIResult(resultSchema, raw);
    const ids = parsed.milestones.map(() => uid());
    const existing = new Map(project.milestones.map((m) => [m.id, m]));
    const resolve = (reference: string) => {
      if (existing.has(reference)) return reference;
      const match = /^new:(0|[1-9][0-9]*)$/.exec(reference);
      const id = match ? ids[Number(match[1])] : undefined;
      if (!id)
        throw new HttpError(
          "Gemini returned an unknown milestone dependency.",
          502,
        );
      return id;
    };
    const milestones = parsed.milestones.map((m, i) => ({
      ...m,
      id: ids[i],
      dependsOn: [...new Set(m.dependsOn.map(resolve))],
      approved: false,
      completed: false,
      estimate: null,
      timeBudgetMinutes: null,
    }));
    const dependencyUpdates = parsed.existingDependencyUpdates.map((update) => {
      const target = existing.get(update.milestoneId);
      if (!target || target.completed)
        throw new HttpError(
          "Gemini proposed dependencies for an unavailable milestone.",
          502,
        );
      return {
        milestoneId: target.id,
        dependsOn: [
          ...new Set([...target.dependsOn, ...update.dependsOn.map(resolve)]),
        ],
      };
    });
    if (
      new Set(dependencyUpdates.map((update) => update.milestoneId)).size !==
      dependencyUpdates.length
    )
      throw new HttpError("Gemini returned duplicate milestone updates.", 502);
    const combined = [
      ...project.milestones.map((milestone) => ({
        ...milestone,
        dependsOn:
          dependencyUpdates.find(
            (update) => update.milestoneId === milestone.id,
          )?.dependsOn ?? milestone.dependsOn,
      })),
      ...milestones,
    ];
    const dates = new Map(
      combined.map((milestone) => [milestone.id, milestone.date]),
    );
    if (
      milestones.some((m) => m.date < today || m.date > project.deadline) ||
      combined.some((m) =>
        m.dependsOn.some((id) => !dates.has(id) || dates.get(id)! > m.date),
      )
    )
      throw new HttpError(
        "The proposal failed date/dependency validation. No milestones were added.",
        502,
      );
    validateReferences({
      ...body.state,
      projects: body.state.projects.map((p) =>
        p.id === project.id ? { ...p, milestones: combined } : p,
      ),
    });
    return NextResponse.json({
      ...parsed,
      snapshot,
      version: AI_PROMPT_VERSION + "/milestones-v2",
      milestones,
      dependencyUpdates,
    });
  } catch (e) {
    return failure(e);
  }
}
