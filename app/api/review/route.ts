import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { stateSchema, daySchema, validateReferences } from "@/lib/model";
import { requireUser, limited, readBody, failure } from "@/lib/server/auth";
import { callAI, validateAIResult } from "@/lib/server/ai";
import {
  allProgressDestinations,
  interpretationSchema,
} from "@/lib/progress-update";
import { commitmentHistory } from "@/lib/commitment-context";
export const maxDuration = 120;
export const PROGRESS_PROMPT = `Clean up the user's open-ended progress account without changing its meaning. You are a smart updater, not a pacing assessor. Preserve all material accomplishments, unfinished work, quality, difficulty, estimates, blockers, dependencies, postponements and reasons, uncertainty, future constraints and miscellaneous context. Every factual claim requires user-reported or recorded evidence; absence remains unknown for ALL categories. Never invent completion, pace or effort. A completed session is not a completed task. Keep the assigned report date distinct from submission time. Prior history supplies identity/context only; do not copy earlier progress into this day's account.
Return JSON {overview:string,questions:string[],updates:[{keys:string[],note:string}]}. Each updates entry is a visually separate, complete cleaned portion of the account. Preserve every material detail across these entries, including unassigned miscellaneous context. overview is a separate cohesive paragraph giving today's overall deadline/milestone/project progress; it saves ONLY to daily and weekly reports, never record histories. Generate the overview from the update sections. Ask up to THREE DISTINCT material questions about unclear meaning or destinations; ask none if unnecessary. Each update contains the relevant detailed portion and all relevant keys from destinations. Use an empty keys array when uncertain; never guess an ambiguous destination. Include relevant task/milestone/deadline/project connections; one section may have multiple keys so all destinations receive the same final edited text. Do not alter dates, task status or estimates. The user will edit the interpretation, update text and dropdown destinations before saving. No information is saved until confirmation. If given a revised interpretation and follow-up answers, incorporate those corrections and return a new draft for verification; do not invent new questions beyond the original three. Examples: PCB placement/routing comments map to the PCB milestone of Robotics; distinguish PCB #1 from PCB #2. Unrelated biology comments map to biology. Unknown scope stays uncertain. Preserve open-ended detail without forcing categories.`;
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const data = z
      .object({
        mode: z.enum(["organize", "overview"]).default("organize"),
        updates: z
          .array(
            z.object({
              keys: z.array(z.string()),
              note: z.string().trim().min(1),
            }),
          )
          .optional(),
        state: stateSchema,
        date: daySchema,
        focus: z.string().default(""),
        blocker: z.string().default(""),
        accomplishment: z.string().default(""),
        confirmedInterpretation: z.string().optional(),
        followUps: z
          .array(z.object({ question: z.string(), answer: z.string() }))
          .max(3)
          .optional(),
      })
      .parse(await readBody(req));
    await limited(
      user.id,
      data.mode === "overview" ? "ai-review-overview" : "ai-review",
      data.mode === "overview" ? 60 : 12,
    );
    validateReferences(data.state);
    const destinations = allProgressDestinations(data.state, data.date);
    const keys = new Set(destinations.map((d) => d.key));
    if (data.mode === "overview") {
      if (
        !data.updates?.length ||
        data.updates.some((update) => update.keys.some((key) => !keys.has(key)))
      )
        throw new Error("Check the update sections and destinations.");
      return NextResponse.json(
        validateAIResult(
          z.object({ overview: z.string().trim().min(1) }),
          await callAI(
            "Return JSON {overview:string}. Write one cohesive paragraph describing today's overall deadline/milestone/project progress using ONLY the supplied edited sections and their selected destination names. These sections are the source of truth. Preserve uncertainty; do not invent completion, effort, pace or risks. Do not reintroduce removed or corrected claims. Do not rewrite the sections or change destinations. This overview is for daily and weekly reports only.",
            {
              assigned_report_date: data.date,
              updates: data.updates.map((update) => ({
                note: update.note,
                destinations: update.keys.map(
                  (key) =>
                    destinations.find((destination) => destination.key === key)
                      ?.label,
                ),
              })),
            },
          ),
        ),
      );
    }
    const result = validateAIResult(
      interpretationSchema,
      await callAI(PROGRESS_PROMPT, {
        assigned_report_date: data.date,
        destinations,
        account: data.confirmedInterpretation ?? data.accomplishment,
        focus: data.focus,
        blocker: data.blocker,
        follow_ups: data.followUps,
        commitment_history: commitmentHistory({
          ...data.state,
          reviews: data.state.reviews.filter((r) => r.date < data.date),
        }),
      }),
    );
    if (result.updates.some((u) => u.keys.some((key) => !keys.has(key))))
      throw new Error("Unknown designation");
    return NextResponse.json(result);
  } catch (e) {
    return failure(e);
  }
}
