import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireUser, limited, failure, HttpError } from "@/lib/server/auth";
import { seal } from "@/lib/server/crypto";
import { oauthRedirect, appUrl } from "@/lib/server/google";
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (req.nextUrl.origin !== new URL(appUrl()).origin)
      throw new HttpError(
        "Open Daylight at " +
          new URL(appUrl()).origin +
          " before connecting Google so the OAuth cookie returns to the same origin.",
      );
    await limited(user.id, "google-connect", 12);
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      throw new HttpError("Google OAuth is not configured.", 503);
    const nonce = randomBytes(24).toString("base64url");
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: oauthRedirect(),
      response_type: "code",
      scope:
        "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      access_type: "offline",
      prompt: "consent",
      state: nonce,
    });
    const response = NextResponse.json({
      url: "https://accounts.google.com/o/oauth2/v2/auth?" + params,
    });
    response.cookies.set(
      "daylight_oauth",
      seal({ userId: user.id, nonce, expires: Date.now() + 600000 }),
      {
        httpOnly: true,
        secure: appUrl().startsWith("https:"),
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      },
    );
    return response;
  } catch (e) {
    return failure(e);
  }
}
