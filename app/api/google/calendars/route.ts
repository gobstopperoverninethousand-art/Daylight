import { NextRequest, NextResponse } from "next/server";
import { requireUser, failure } from "@/lib/server/auth";
import {
  accessToken,
  googleCalendars,
  isHolidayCalendar,
  isWritableCalendar,
} from "@/lib/server/google";
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req),
      token = await accessToken(user.id);
    const calendars = await googleCalendars(token);
    return NextResponse.json({
      calendars: calendars.filter(isWritableCalendar).map((x) => ({
        id: x.id,
        name: x.summaryOverride || x.summary,
        primary: !!x.primary,
      })),
      holidays: calendars
        .filter((x) => isHolidayCalendar(x.id) && x.selected !== false)
        .map((x) => x.summaryOverride || x.summary),
    });
  } catch (e) {
    return failure(e);
  }
}
