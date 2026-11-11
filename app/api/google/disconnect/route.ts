import { NextRequest, NextResponse } from "next/server";
import { requireUser, adminDb, failure, HttpError } from "@/lib/server/auth";
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { error } = await adminDb()
      .from("daylight_google_accounts")
      .delete()
      .eq("user_id", user.id);
    if (error) throw new HttpError("Could not remove connection.", 502);
    return NextResponse.json({ disconnected: true, revoked: false });
  } catch (e) {
    return failure(e);
  }
}
