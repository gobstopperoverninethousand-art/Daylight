import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new HttpError("Supabase server configuration is missing.", 503);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function requireUser(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new HttpError("Sign in to use this integration.", 401);
  const { data, error } = await adminDb().auth.getUser(token);
  if (error || !data.user)
    throw new HttpError("Your session expired. Please sign in again.", 401);
  return data.user;
}
export async function limited(userId: string, bucket: string, max = 20) {
  const { data, error } = await adminDb().rpc("daylight_rate_limit", {
    owner_id: userId,
    bucket_name: bucket,
    max_requests: max,
    window_seconds: 3600,
  });
  if (error)
    throw new HttpError(
      "Apply the Daylight database migration before using integrations.",
      503,
    );
  if (!data)
    throw new HttpError("Request limit reached. Please try again later.", 429);
}
export async function readBody(req: NextRequest) {
  const text = await req.text();
  if (text.length > 5_000_000)
    throw new HttpError("Request is too large.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError("Invalid JSON request.");
  }
}
export function failure(e: unknown) {
  if (e instanceof HttpError)
    return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof Error && e.name === "ZodError")
    return NextResponse.json(
      { error: "Some fields are invalid. Please review your entries." },
      { status: 400 },
    );
  return NextResponse.json(
    {
      error:
        "The integration could not complete. Your Daylight records have been preserved.",
    },
    { status: 502 },
  );
}
