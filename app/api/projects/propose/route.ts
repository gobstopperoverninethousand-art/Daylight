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
  milestones: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        date: daySchema,
        dependsOn: z.array(z.number().int().min(0)),
        reason: z.string().max(4000),
      }),
    )
    .min(1)
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
          title: m.title,
          date: m.date,
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
      'Propose 3 to 6 major verifiable milestones, using dependency order and backward planning from the final deadline. Use existing milestone budgets when present and do not duplicate existing milestones. Leave workload and budget estimates to the user. Be brief: summary at most two sentences, at most four assumptions of one short sentence each, and each milestone reason one sentence under 30 words. Return {summary:string, assumptions:string[], milestones:[{title:string,date:"YYYY-MM-DD",dependsOn:number[] (zero-based indices into your new milestone list, earlier indices only),reason:string}]}. Do not create task backlogs.',
      snapshot,
    );
    const parsed = validateAIResult(resultSchema, raw);
    if (
      parsed.milestones.some(
        (m, i) =>
          m.date < today ||
          m.date > project.deadline ||
          m.dependsOn.some((d) => d >= i || parsed.milestones[d].date > m.date),
      )
    )
      throw new HttpError(
        "The proposal failed date/dependency validation. No milestones were added.",
        502,
      );
    const ids = parsed.milestones.map(() => uid());
    return NextResponse.json({
      ...parsed,
      snapshot,
      version: AI_PROMPT_VERSION,
      milestones: parsed.milestones.map((m, i) => ({
        ...m,
        id: ids[i],
        dependsOn: m.dependsOn.map((d) => ids[d]),
        approved: false,
        completed: false,
        estimate: null,
        timeBudgetMinutes: null,
      })),
    });
  } catch (e) {
    return failure(e);
  }
}
