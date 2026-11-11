import { NextRequest, NextResponse } from "next/server";
import { failure, limited, requireUser } from "@/lib/server/auth";
import { checkAI } from "@/lib/server/ai";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    await limited(user.id, "ai-status", 15);
    return NextResponse.json(await checkAI());
  } catch (err) {
    return failure(err);
  }
}
