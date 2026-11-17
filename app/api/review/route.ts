import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  stateSchema,
  daySchema,
  assessmentSchema,
  commitmentUpdateSchema,
  validateReferences,
} from "@/lib/model";
import { assess, makeSnapshot } from "@/lib/engine";
import { requireUser, limited, readBody, failure } from "@/lib/server/auth";
import { callAI, AI_PROMPT_VERSION, validateAIResult } from "@/lib/server/ai";
import { commitmentHistory } from "@/lib/commitment-context";
import { deadlineEntries } from "@/lib/deadlines";
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
        commitmentKey: z.string().max(180).optional(),
        stage: z.enum(["interpret", "report"]).default("report"),
        followUp: z
          .object({
            question: z.string().trim().min(1).max(300),
            answer: z.string().trim().max(1500),
          })
          .optional(),
        confirmedInterpretation: z.string().trim().min(1).max(2500).optional(),
      })
      .parse(await readBody(req));
    const commitments = deadlineEntries(data.state).map((entry) => ({
      ...entry,
      key: entry.kind + ":" + entry.id,
    }));
    const linkedCommitment = commitments.find((entry) => entry.key === data.commitmentKey);
    if (data.stage === "interpret") {
      const schema = z.object({
        interpretation: z.string().trim().min(1).max(2500),
        question: z.string().trim().min(1).max(300).nullable(),
      });
      const result = await callAI(
        "Restate the user’s account in one short paragraph. Distinguish what moved forward, what remains, and what is blocked. Use the names the user supplied for deadlines or milestones. Preserve uncertainty and avoid guessing which commitment they meant. Mention focus only when reported. Do not assess pacing or infer additional progress. If one missing detail would materially change pacing or the next action, ask one brief question naming the relevant task or milestone when its identity is clear. Otherwise return null for question. Return {interpretation:string,question:string|null}.",
        {
          linked_commitment: linkedCommitment,
          commitments,
          focus: data.focus,
          blocker: data.blocker,
          accomplishment: data.accomplishment,
          sessions: data.state.sessions
            .filter((session) => session.date === data.date)
            .map(({ taskId, outcome, note }) => ({
              title: data.state.tasks.find((task) => task.id === taskId)?.title,
              outcome,
              note,
            })),
        },
      );
      return NextResponse.json(validateAIResult(schema, result));
    }
    const snapshot = makeSnapshot(
      validateReferences(data.state),
      data.date,
      data.focus,
      data.blocker,
      data.accomplishment,
    );
    const recordedAssessment = assess(snapshot);
    const reportSnapshot = {
      ...snapshot,
      linked_commitment: linkedCommitment,
      recorded_pacing: recordedAssessment.pacing_status,
      confirmed_interpretation: data.confirmedInterpretation,
      follow_up: data.followUp,
    };
    const commitmentKeys = new Set(commitments.map((entry) => entry.key));
    const reportSchema = assessmentSchema.extend({
      commitmentUpdates: z.array(commitmentUpdateSchema).refine(
        (updates) =>
          new Set(updates.map(({ key }) => key)).size === updates.length &&
          updates.every(({ key }) => commitmentKeys.has(key)),
      ),
    });
    const result = await callAI(
      'Also include commitmentUpdates: [{key:string,note:string}] in the same JSON object. Write one concise new progress note for each clearly affected project, deadline, or milestone using its exact key from commitments. Use today’s confirmed account (or original answers if unconfirmed) and any follow-up answer. A manually selected commitment is a hint. Include all clearly affected commitments, including a parent project when the update materially changes its progress. Keep each note specific to that record and under 600 characters. Do not restate or rewrite past notes, copy unrelated details, infer completion, or guess an ambiguous match. Return an empty array if no update is supported. Return {commitmentUpdates, pacing_status: "on-track"|"needs-attention"|"at-risk"|"blocked"|"insufficient-information", summary:string, time_use_observation:string, focus_observation:string, evidence:string[], missing_information:string[], next_action:string, questions_if_needed:string[]}. Use linked commitment history for context, distinguish earlier updates from today’s changes, and treat session outcomes as records of work rather than confirmation that a commitment is finished. Lead with what changed today and how it affects the named deadline or milestone. Distinguish work the user reports as finished from work still open. Surface the most consequential pacing risk and suggest one concrete next action, leaving session length to the user. Use recorded_pacing as the pacing status and ground the explanation in the supplied evidence. When estimated remaining work exceeds recorded capacity, cite both quantities. Report actual time only when actual_time_reports is positive. Only ask a follow-up when the answer could change the next action or pacing assessment. Ask at most one specific question. When confirmed_interpretation is present, use any follow_up answer as user-reported evidence. For an empty follow_up answer, record material uncertainty without repeating the question. Return an empty questions_if_needed array for the confirmed flow. Mention missing or stale calendar data when it limits confidence. If confirmed_interpretation is present, use it as the user’s corrected account of their answers.',
      {
        ...reportSnapshot,
        commitments,
        commitment_history: commitmentHistory(data.state),
      },
    );
    const { commitmentUpdates, ...assessment } = validateAIResult(reportSchema, result);
    return NextResponse.json({
      assessment: {
        ...assessment,
        pacing_status: recordedAssessment.pacing_status,
        ...(data.confirmedInterpretation ? { questions_if_needed: [] } : {}),
      },
      commitmentUpdates,
      snapshot: reportSnapshot,
      version: AI_PROMPT_VERSION + "/review-v6",
    });
  } catch (e) {
    return failure(e);
  }
}
