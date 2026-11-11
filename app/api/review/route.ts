import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  stateSchema,
  daySchema,
  assessmentSchema,
  validateReferences,
} from "@/lib/model";
import { makeSnapshot } from "@/lib/engine";
import { requireUser, limited, readBody, failure } from "@/lib/server/auth";
import { callAI, AI_PROMPT_VERSION, validateAIResult } from "@/lib/server/ai";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    await limited(user.id, "ai-review", 12);
    const data = z
      .object({
        state: stateSchema,
        date: daySchema,
        focus: z.string().max(80),
        blocker: z.string().max(4000),
        accomplishment: z.string().max(4000),
      })
      .parse(await readBody(req));
    const snapshot = makeSnapshot(
      validateReferences(data.state),
      data.date,
      data.focus,
      data.blocker,
      data.accomplishment,
    );
    const result = await callAI(
      'Return {pacing_status: "on-track"|"needs-attention"|"at-risk"|"blocked"|"insufficient-information", summary:string, time_use_observation:string, focus_observation:string, evidence:string[], missing_information:string[], next_action:string, questions_if_needed:string[]}. Keep it concise. Do not claim calendar capacity is complete when last sync is missing or stale.',
      snapshot,
    );
    return NextResponse.json({
      assessment: validateAIResult(assessmentSchema, result),
      snapshot,
      version: AI_PROMPT_VERSION,
    });
  } catch (e) {
    return failure(e);
  }
}
