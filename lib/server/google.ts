import { adminDb, HttpError } from "./auth";
import { seal, unseal } from "./crypto";
type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
};
export function appUrl() {
  const url = process.env.APP_URL || "http://localhost:3000";
  return url.replace(/\/$/, "");
}
export function oauthRedirect() {
  return appUrl() + "/api/google/callback";
}
export async function storeTokens(userId: string, tokens: Tokens) {
  const { error } = await adminDb()
    .from("daylight_google_accounts")
    .upsert({
      user_id: userId,
      encrypted_tokens: seal(tokens),
      updated_at: new Date().toISOString(),
    });
  if (error)
    throw new HttpError(
      "Could not store the Google connection. Apply the database migration.",
      503,
    );
}
export async function accessToken(userId: string) {
  const { data, error } = await adminDb()
    .from("daylight_google_accounts")
    .select("encrypted_tokens")
    .eq("user_id", userId)
    .maybeSingle();
  if (error)
    throw new HttpError("Google connection storage is unavailable.", 503);
  if (!data) throw new HttpError("Connect Google Calendar first.", 409);
  const token = unseal<Tokens>(data.encrypted_tokens);
  if (token.expires_at > Date.now() + 60000) return token.access_token;
  if (!token.refresh_token)
    throw new HttpError("Reconnect Google Calendar to renew permission.", 401);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new HttpError(
      "Google permission expired. Reconnect your calendar.",
      401,
    );
  const next = await response.json();
  await storeTokens(userId, {
    ...token,
    access_token: next.access_token,
    expires_at: Date.now() + next.expires_in * 1000,
  });
  return next.access_token;
}
export async function googleFetch(
  token: string,
  path: string,
  init: RequestInit = {},
) {
  return fetch("https://www.googleapis.com/calendar/v3/" + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
}
export async function googleJson(
  token: string,
  path: string,
  init: RequestInit = {},
) {
  const r = await googleFetch(token, path, init);
  if (!r.ok)
    throw new HttpError(
      `Google Calendar request failed (${r.status}). No unrelated events were changed.`,
      502,
    );
  return r.json();
}

export type GoogleCalendar = {
  id: string;
  summary: string;
  summaryOverride?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole: string;
};

export function isHolidayCalendar(id: string) {
  // Google's holiday subscriptions use IDs such as en.usa#holiday@group.v.calendar.google.com.
  return /#holiday@group\.v\.calendar\.google\.com$/i.test(id);
}

export function isWritableCalendar(calendar?: GoogleCalendar) {
  return calendar?.accessRole === "owner" || calendar?.accessRole === "writer";
}

export async function googleCalendars(token: string) {
  const calendars: GoogleCalendar[] = [];
  let pageToken = "";
  for (let page = 0; page < 30; page++) {
    const params = new URLSearchParams({ maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await googleJson(token, "users/me/calendarList?" + params);
    calendars.push(...(data.items || []));
    pageToken = data.nextPageToken || "";
    if (!pageToken) return calendars;
  }
  throw new HttpError(
    "Could not read your complete Google calendar list.",
    502,
  );
}
