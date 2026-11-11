import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  projectPlanningData,
  stateSchema,
  validateReferences,
} from "@/lib/model";
import {
  requireUser,
  limited,
  readBody,
  failure,
  HttpError,
} from "@/lib/server/auth";
import { callAI, AI_PROMPT_VERSION, validateAIResult } from "@/lib/server/ai";
const output = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        notes: z.string().max(4000),
      }),
    )
    .min(1)
    .max(5),
});
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    await limited(user.id, "ai-project-tasks", 12);
    const { state, projectId } = z
      .object({ state: stateSchema, projectId: z.string() })
      .parse(await readBody(req));
    validateReferences(state);
    const project = state.projects.find(
      (p) => p.id === projectId && p.status === "active",
    );
    if (!project) throw new HttpError("Active project not found.", 404);
    const milestone = project.milestones
      .filter((m) => m.approved && !m.completed)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!milestone)
      throw new HttpError(
        "Approve a current milestone before expanding it into tasks.",
      );
    const result = validateAIResult(
      output,
      await callAI(
        "Break ONLY the provided CURRENT milestone into up to five concrete next actions. Avoid duplicating existing tasks. Do not speculate about later milestones. No effort estimates or dates: the user supplies them. Return {tasks:[{title:string,notes:string}]}.",
        {
          project: projectPlanningData(project),
          milestone,
          existing_tasks: state.tasks.filter((t) => t.projectId === projectId),
        },
      ),
    );
    return NextResponse.json({
      ...result,
      projectId,
      milestoneId: milestone.id,
      version: AI_PROMPT_VERSION,
    });
  } catch (e) {
    return failure(e);
  }
}
