import { NextRequest, NextResponse } from "next/server";
import { unseal } from "@/lib/server/crypto";
import { storeTokens, oauthRedirect, appUrl } from "@/lib/server/google";
export async function GET(req: NextRequest) {
  let status = "error";
  try {
    const raw = req.cookies.get("daylight_oauth")?.value;
    if (!raw) throw new Error();
    const state = unseal<{ userId: string; nonce: string; expires: number }>(
      raw,
    );
    const code = req.nextUrl.searchParams.get("code");
    if (
      state.expires < Date.now() ||
      state.nonce !== req.nextUrl.searchParams.get("state") ||
      !code
    )
      throw new Error();
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: oauthRedirect(),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error();
    const t = await r.json();
    if (!t.access_token || !t.refresh_token) throw new Error();
    await storeTokens(state.userId, {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: Date.now() + t.expires_in * 1000,
    });
    status = "connected";
  } catch {}
  const response = NextResponse.redirect(appUrl() + "/?google=" + status);
  response.cookies.delete("daylight_oauth");
  return response;
}
