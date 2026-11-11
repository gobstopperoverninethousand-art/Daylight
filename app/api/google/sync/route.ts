import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { stateSchema, validateReferences } from "@/lib/model";
import { requireUser, limited, readBody, failure } from "@/lib/server/auth";
import { accessToken } from "@/lib/server/google";
import { synchronizeWorkspace } from "@/lib/server/sync";
export const maxDuration = 300;
// Pull runs about once a minute and push runs after edits, so each gets its own
// hourly allowance instead of sharing one tiny bucket with manual syncs.
const allowance = { full: 120, push: 360, pull: 600 } as const;
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { state, mode } = z
      .object({
        state: stateSchema,
        mode: z.enum(["full", "push", "pull"]).default("full"),
      })
      .parse(await readBody(req));
    await limited(user.id, "google-sync-" + mode, allowance[mode]);
    validateReferences(state);
    return NextResponse.json(
      await synchronizeWorkspace(
        state,
        user.id,
        await accessToken(user.id),
        mode,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
