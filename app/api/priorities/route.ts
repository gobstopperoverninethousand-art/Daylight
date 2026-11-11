import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { stateSchema, validateReferences } from "@/lib/model";
import { makeSnapshot, scheduledTaskIds, zonedParts } from "@/lib/engine";
import {
  requireUser,
  limited,
  readBody,
  failure,
  HttpError,
} from "@/lib/server/auth";
import { callAI, AI_PROMPT_VERSION, validateAIResult } from "@/lib/server/ai";
import { priorityResultSchema } from "@/lib/ai-freshness";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    await limited(user.id, "ai-priorities", 15);
    const { state } = z
      .object({ state: stateSchema })
      .parse(await readBody(req));
    validateReferences(state);
    const today = zonedParts(
      new Date().toISOString(),
      state.settings.timezone,
    ).day;
    const snapshot = makeSnapshot(state, today, "", "", "");
    const scheduled = scheduledTaskIds(state);
    const eligible = state.tasks
      .filter((task) => task.status === "active" && !scheduled.has(task.id))
      .map((task) => task.id);
    if (!eligible.length)
      return NextResponse.json({
        summary: "All active tasks already have a place on the calendar.",
        recommendations: [],
        snapshot,
        version: AI_PROMPT_VERSION,
      });
    const result = validateAIResult(
      priorityResultSchema,
      await callAI(
        "Recommend up to three unscheduled active tasks. Consider latest confirmed progress, upcoming deadlines, and future availability. In summary, explain in one or two sentences why you chose these tasks for today, using specific evidence from the input. No scheduling or invented effort. Return {summary:string,recommendations:[{taskId:string,reason:string}]}. Only recommend task IDs in eligible_task_ids; explain any data limitations.",
        { ...snapshot, eligible_task_ids: eligible },
      ),
    );
    if (
      new Set(result.recommendations.map((r) => r.taskId)).size !==
        result.recommendations.length ||
      result.recommendations.some((r) => !eligible.includes(r.taskId))
    )
      throw new HttpError(
        "AI returned invalid task references; no suggestions were applied.",
        502,
      );
    return NextResponse.json({
      ...result,
      snapshot: { ...snapshot, eligible_task_ids: eligible },
      version: AI_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return failure(e);
  }
}
